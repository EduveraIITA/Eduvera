import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { AuthenticatedRequest, AuthUser } from '../common/request.js';
import type { Database } from '../database/types.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { activityOccurrenceId } from '../schedule-planning/activity-occurrence.engine.js';
import { ActivityAttendanceService } from './activity-attendance.service.js';
import { participationRosterFingerprint, type ParticipationCaptureSources, type ParticipationStatus } from './activity-attendance.contracts.js';
import type { OwningParticipationSource } from './participation-context-authority.js';

type Tx = Transaction<Database>;
export interface OwnedParticipationPerson {
  student_id: string; person_id: string; label: string; person_revision: number;
  source_ref: string; source_revision: number; required: boolean;
}
export interface OwnedParticipationContext {
  school_id: string; source: OwningParticipationSource; source_id: string; context_ref: string;
  title: string; date: string; timezone: string; starts_at: Date; ends_at: Date; space_id: string | null;
  revision: number; locked: boolean; locked_by: string | null; locked_at: Date | null;
}
interface RetainedEntry {
  id: string; student_id: string; status: ParticipationStatus | 'not_recorded' | 'unrecorded';
  remarks: string; revision: number; recorded_by: string | null; observed_at: Date | null; updated_at: Date;
}

/**
 * Only owning domains call this adapter after their complete context checks.
 * Retained source rows are imported without inventing observations; all new
 * accepted decisions and lifecycle actions use ActivityAttendanceService.
 */
@Injectable()
export class OwnedParticipationBridge {
  constructor(private readonly attendance: ActivityAttendanceService) {}

  async prepare(tx: Tx, user: AuthUser, context: OwnedParticipationContext, people: OwnedParticipationPerson[]) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`owned-participation:${context.school_id}:${context.source}:${context.source_id}`},0))`.execute(tx);
    const prior = (await sql<{ register_id: string; revision: number }>`SELECT link.register_id,register.revision
      FROM activity_attendance_source_contexts link JOIN activity_attendance_registers register ON register.id=link.register_id
      WHERE link.school_id=${context.school_id}::uuid AND link.source_kind=${context.source}
        AND link.source_id=${context.source_id} AND link.state='active' FOR UPDATE OF link,register`.execute(tx)).rows[0];
    if (prior) return prior;
    const entries = context.source === 'event'
      ? (await sql<RetainedEntry>`SELECT id,student_id,status,note AS remarks,revision,marked_by AS recorded_by,
          COALESCE(checked_out_at,checked_in_at) AS observed_at,updated_at
          FROM campus_event_attendance_records_legacy_source WHERE school_id=${context.school_id}::uuid
            AND session_id=${context.source_id}::uuid ORDER BY student_id FOR UPDATE`.execute(tx)).rows
      : (await sql<RetainedEntry>`SELECT id,student_id,status,note AS remarks,revision,recorded_by,observed_at,updated_at
          FROM assessment_candidate_attendance_legacy_source WHERE school_id=${context.school_id}::uuid
            AND sitting_id=${context.source_id}::uuid ORDER BY student_id FOR UPDATE`.execute(tx)).rows;
    const byStudent = new Map(people.map(person => [person.student_id, person]));
    if (entries.some(entry => !byStudent.has(entry.student_id))) {
      throw new ConflictException('A retained participation decision no longer resolves to the owning frozen roster. Reconcile this context before continuing.');
    }
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ context, people, entries })).digest('hex');
    const occurrenceId = activityOccurrenceId(context.school_id, context.source, context.source_id, context.date);
    const id = randomUUID();
    const now = executionNow();
    const revision = Math.max(1, context.revision, ...entries.map(entry => entry.revision));
    const sourceRoster = people.map(person => ({ person_id: person.person_id, source_kind: context.source,
      source_ref: person.source_ref, source_revision: person.source_revision, participation_role: 'participant',
      requirement: person.required ? 'required' : 'optional' }));
    const rosterHash = createHash('sha256').update(participationRosterFingerprint(sourceRoster)).digest('hex');
    await sql`INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,period_id,source,source_ref,source_revision,
      title,purpose,local_date,starts_at,ends_at,timezone,space_id,attendance_mode,context_kind,context_ref,state,revision)
      VALUES(${occurrenceId}::uuid,${context.school_id}::uuid,${context.source_id}::uuid,${context.source_id}::uuid,
        ${context.source},${context.source_id},${Math.max(1,context.revision)},${context.title},${context.source},${context.date}::date,
        ${context.starts_at},${context.ends_at},${context.timezone},${context.space_id}::uuid,'roll_call',${context.source},
        ${context.context_ref}::uuid,'expected',1)
      ON CONFLICT(id) DO NOTHING`.execute(tx);
    const occurrence=(await sql<{revision:number}>`SELECT revision FROM schedule_activity_occurrences
      WHERE id=${occurrenceId}::uuid AND school_id=${context.school_id}::uuid FOR SHARE`.execute(tx)).rows[0]!;
    await sql`INSERT INTO activity_attendance_registers(id,school_id,occurrence_id,state,revision,roster_fingerprint,
      roster_source_revision,policy_revision,policy_snapshot,submitted_by,submitted_at,locked_by,locked_at,finalization_source)
      VALUES(${id}::uuid,${context.school_id}::uuid,${occurrenceId}::uuid,${context.locked ? 'locked' : 'draft'},${revision},
        ${rosterHash},${occurrence.revision},0,${JSON.stringify({ finalization_mode: 'principal_review', auto_finalize_minutes: 0,
          configuration_state: 'manual_fallback', approved_by: null, approved_at: null, owning_domain: context.source })}::jsonb,
        ${context.locked ? context.locked_by : null}::uuid,${context.locked ? context.locked_at : null},
        ${context.locked_by}::uuid,${context.locked_at},${context.locked ? 'manual' : null})`.execute(tx);
    for (const person of people) {
      const requirement = person.required ? 'required' : 'optional';
      await sql`INSERT INTO schedule_activity_occurrence_people(occurrence_id,school_id,person_id,label,participation_role,
        source_kind,source_ref,source_revision,person_revision,requirement)
        VALUES(${occurrenceId}::uuid,${context.school_id}::uuid,${person.person_id}::uuid,${person.label},'participant',
          ${context.source},${person.source_ref},${person.source_revision},${person.person_revision},${requirement}) ON CONFLICT DO NOTHING`.execute(tx);
      await sql`INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,
        source_kind,source_ref,source_revision,academic_student_id,academic_source_revision) VALUES(${context.school_id}::uuid,${id}::uuid,${person.person_id}::uuid,
          ${person.label},'participant',${requirement},${context.source},${person.source_ref},${person.source_revision},${person.student_id}::uuid,${person.source_revision})`.execute(tx);
    }
    for (const entry of entries) {
      const status = entry.status === 'unrecorded' || entry.status === 'not_recorded' ? null : entry.status;
      if (status === null && context.source === 'examination') continue;
      const person = byStudent.get(entry.student_id)!;
      await sql`INSERT INTO activity_attendance_entries(id,school_id,register_id,person_id,status,remarks,capture_channel,
        observed_at,recorded_by,revision,created_at,updated_at,legacy_source_ref)
        VALUES(${entry.id}::uuid,${context.school_id}::uuid,${id}::uuid,${person.person_id}::uuid,${status},${entry.remarks},
          'legacy_import',${entry.observed_at},${entry.recorded_by}::uuid,${entry.revision},${entry.updated_at},${entry.updated_at},
          ${`${context.source}:${entry.id}`})`.execute(tx);
    }
    const snapshot = { context, entry_ids: entries.map(entry => entry.id),
      attribution: 'retained_owning_source_not_a_new_observation' };
    await sql`UPDATE activity_attendance_registers SET context_source_kind=${context.source},context_source_id=${context.source_id},
      context_imported_revision=${revision},context_imported_at=${now},context_state='active',context_activated_at=${now},
      context_snapshot=${JSON.stringify(snapshot)}::jsonb,context_source_fingerprint=${sourceFingerprint}
      WHERE id=${id}::uuid AND school_id=${context.school_id}::uuid`.execute(tx);
    await sql`INSERT INTO activity_attendance_import_receipts(school_id,register_id,source_kind,source_id,source_revision,
      source_fingerprint,source_refs,counts,requested_by)
      VALUES(${context.school_id}::uuid,${id}::uuid,${context.source},${context.source_id},${revision},${sourceFingerprint},
        ${JSON.stringify(snapshot)}::jsonb,${JSON.stringify({ people: people.length, entries: entries.length })}::jsonb,${user.id}::uuid)`.execute(tx);
    return { register_id: id, revision };
  }

  async save(tx: Tx, user: AuthUser, context: OwnedParticipationContext, people: OwnedParticipationPerson[],
    records: Array<{ student_id: string; status: ParticipationStatus | null; remarks: string; details?: Record<string, unknown> }>,
    request: AuthenticatedRequest, reason?: string, capture: ParticipationCaptureSources = {}) {
    const prepared = await this.prepare(tx, user, context, people);
    if (!records.length) return prepared;
    const map = new Map(people.map(person => [person.student_id, person.person_id]));
    const recordsByPerson = records.map(record => {
      const personId = map.get(record.student_id);
      if (!personId) throw new ConflictException('A participation decision is outside the owning context roster.');
      return { person_id: personId, status: record.status, remarks: record.remarks };
    });
    await this.attendance.marksInTransaction(tx, user, context.school_id, prepared.register_id,
      { expected_revision: prepared.revision, ...(reason ? { reason } : {}), records: recordsByPerson }, request, capture,
      { owning_adapter: context.source, context_fingerprint: createHash('sha256').update(JSON.stringify(records)).digest('hex'), force_revisions: true });
    for (const record of records) if (record.details) {
      const revision = (await sql<{ id: string }>`SELECT id FROM activity_attendance_entry_revisions
        WHERE school_id=${context.school_id}::uuid AND register_id=${prepared.register_id}::uuid
          AND person_id=${map.get(record.student_id)!}::uuid AND request_id=${request.requestId}::uuid
        ORDER BY id DESC LIMIT 1`.execute(tx)).rows[0];
      if (!revision) throw new ConflictException('The context evidence must refer to its accepted participation revision.');
      await sql`INSERT INTO activity_attendance_context_details(entry_revision_id,school_id,register_id,source_kind,details)
        VALUES(${revision.id}::bigint,${context.school_id}::uuid,${prepared.register_id}::uuid,${context.source},
          ${JSON.stringify(record.details)}::jsonb) ON CONFLICT DO NOTHING`.execute(tx);
    }
    return prepared;
  }

  async lifecycle(tx: Tx, user: AuthUser, context: OwnedParticipationContext, people: OwnedParticipationPerson[],
    action: 'finalize' | 'reopen', request: AuthenticatedRequest, reason: string) {
    const prepared = await this.prepare(tx, user, context, people);
    let register = (await sql<{ state: string; revision: number }>`SELECT state,revision FROM activity_attendance_registers
      WHERE id=${prepared.register_id}::uuid FOR UPDATE`.execute(tx)).rows[0]!;
    const baseKey = request.headers['idempotency-key'];
    const key = Array.isArray(baseKey) ? baseKey[0] : baseKey;
    const subrequest = (operation: string): AuthenticatedRequest => ({ ...request,
      headers: { ...request.headers, 'idempotency-key': `${key ?? request.requestId}:${operation}` } });
    if (action === 'finalize' && register.state === 'draft') {
      await this.attendance.transition(user, context.school_id, prepared.register_id, 'submit',
        { expected_revision: register.revision, reason }, subrequest('submit'), tx, { owning_adapter: context.source });
      register = (await sql<{ state: string; revision: number }>`SELECT state,revision FROM activity_attendance_registers
        WHERE id=${prepared.register_id}::uuid`.execute(tx)).rows[0]!;
    }
    await this.attendance.transition(user, context.school_id, prepared.register_id, action,
      { expected_revision: register.revision, reason }, subrequest(action), tx, { owning_adapter: context.source });
    return prepared;
  }
}
