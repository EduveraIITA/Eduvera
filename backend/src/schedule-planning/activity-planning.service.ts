import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { retainOperatingDestination, retainTimetableContinuation } from '../institution-onboarding/operating-resume.js';
import { canManageActivityPlanning } from './activity-planning-readiness.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from '../campus-model-core/domain-command-gateway.port.js';
import { PLAN_OCCURRENCE_PORT, type PlanOccurrencePort, type PlanOccurrenceProjection } from '../campus-model-core/plan-occurrence.port.js';
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import { RESPONSIBILITY_PROJECTION_PORT, type ResponsibilityProjectionPort } from '../campus-model-core/responsibility-projection.port.js';
import { SchoolEventService } from '../school/school-event.service.js';
import { activityActionInput, activityPlanInput, activityRangeInput, activityOccurrenceRangeInput, activityRevisionInput, type ActivityOccurrence, type ActivityPlanInput } from './activity.contracts.js';
import { ActivityOccurrenceEngine, activityOccurrenceId, firstOccurrenceConflict, timezoneTransitionDates, type ActivityOccurrenceQuery, type PlanningDb } from './activity-occurrence.engine.js';
import { lockSchedule } from '../day-plans/schedule.js';
import { assessmentWorkHref, eventWorkHref } from '../workspace/canonical-application-links.js';
import { assertSpacesNotResidential } from '../common/campus-space-use.js';

interface PlanRow {
  id: string; school_id: string; class_section_id: string | null; term_id: string | null;
  state: 'draft' | 'published' | 'discarded' | 'cancelled'; starts_on: string; ends_on: string | null;
  revision: number; planning_origin: 'academic' | 'activity'; activity_title: string;
  activity_purpose: ActivityPlanInput['purpose']; activity_description: string; activity_timezone: string;
  recurrence_kind: 'once' | 'weekly'; attendance_mode: 'none' | 'roll_call';
  lead_person_id: string | null; recorder_person_id: string | null; reviewer_person_id: string | null;
  created_by: string; published_at: Date | string | null; cancelled_at: Date | string | null;
  location_kind: ActivityPlanInput['location_kind']; location_label: string; location_url: string;
  replaces_version_id: string | null; replaces_source_revision: number | null; revision_reason: string | null;
}
interface PeriodRow {
  id: string; weekday: number; period_number: number; starts_at: string; ends_at: string;
  end_day_offset: 0 | 1; space_id: string | null; subject_id: string | null;
  teacher_user_id: string | null; title: string;
}
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => isoDate(new Date(Date.parse(date) + days * 86400000));
const PAGE_SIZE = 25;
const OCCURRENCE_READ_BATCH_SIZE = 500;
interface ActivityCommandContext { prepared: PreparedDomainCommand | null; savepoint: boolean }
interface ActivityRefusalEnvelope { activity_command_refusal: { status_code: number; response: string | object } }

export function retainedRefusal(value: unknown): value is ActivityRefusalEnvelope {
  return Boolean(value && typeof value === 'object' && 'activity_command_refusal' in value);
}

@Injectable()
export class ActivityPlanningService {
  private readonly engine: ActivityOccurrenceEngine;
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SchoolEventService,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(PLAN_OCCURRENCE_PORT) private readonly projection: PlanOccurrencePort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(RESPONSIBILITY_PROJECTION_PORT) private readonly responsibilities: ResponsibilityProjectionPort,
  ) { this.engine = new ActivityOccurrenceEngine(identities, responsibilities); }

  private async command<T>(req: AuthenticatedRequest, schoolId: string, key: string, identity: unknown,
    run: (db: Transaction<Database>, context: ActivityCommandContext) => Promise<T>): Promise<T> {
    const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const refused: { error: HttpException | null } = { error: null };
    const result = await this.db.transaction().execute(async db => {
      await lockSchedule(db, schoolId);
      await this.manager(db, req.authUser, schoolId);
      const previous = (await sql<{ request_hash: string; result: T }>`SELECT request_hash,result FROM day_plan_commands
        WHERE school_id=${schoolId}::uuid AND actor_id=${req.authUser.id}::uuid AND command_key=${key}::uuid`.execute(db)).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException('This retry key belongs to a different action.');
        if (retainedRefusal(previous.result)) {
          refused.error = new HttpException(previous.result.activity_command_refusal.response, previous.result.activity_command_refusal.status_code);
          return undefined as T;
        }
        return previous.result;
      }
      const context: ActivityCommandContext = { prepared: null, savepoint: false };
      try {
        const result = await run(db, context);
        if (context.savepoint) await sql`RELEASE SAVEPOINT activity_domain_effects`.execute(db);
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result)
          VALUES(${schoolId}::uuid,${req.authUser.id}::uuid,${key}::uuid,${hash},${JSON.stringify(result)}::jsonb)`.execute(db);
        return result;
      } catch (error) {
        // Preserve a prepared, authorized intent when the owning domain refuses
        // it. Only its effects roll back; no unexpected SQL/system failure is
        // converted into an accepted or apparently safe domain outcome.
        if (!context.prepared || !context.savepoint || !(error instanceof HttpException)
          || ![400, 403, 409, 422].includes(error.getStatus())) throw error;
        await sql`ROLLBACK TO SAVEPOINT activity_domain_effects`.execute(db);
        await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: context.prepared.command_id,
          terminal_state: error.getStatus() === 409 ? 'conflicted' : 'rejected', code: 'activity_invariant_refused',
          explanation: error.message.slice(0, 500), resulting_revision: null, domain_event_id: null,
          metadata: { http_status: error.getStatus() }, completed_at: executionNow().toISOString() });
        await sql`RELEASE SAVEPOINT activity_domain_effects`.execute(db);
        const envelope: ActivityRefusalEnvelope = { activity_command_refusal: { status_code: error.getStatus(), response: error.getResponse() } };
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result)
          VALUES(${schoolId}::uuid,${req.authUser.id}::uuid,${key}::uuid,${hash},${JSON.stringify(envelope)}::jsonb)`.execute(db);
        refused.error = error;
        return undefined as T;
      }
    });
    if (refused.error) throw refused.error;
    return result;
  }

  private async manager(db: PlanningDb, user: AuthUser, schoolId: string, required = true) {
    const allowed = await canManageActivityPlanning(db, user, schoolId);
    if (!allowed && required) throw new ForbiddenException('A current institution timetable-management assignment is required.');
    return Boolean(allowed);
  }

  private async actingPerson(db: PlanningDb, user: AuthUser, schoolId: string) {
    const person = await this.identities.resolveAccountEndpoint(db as Transaction<Database>, {
      school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
    });
    if (!person.acting) throw new ForbiddenException('An active account-linked campus identity is required to view this timetable.');
    return person.person_id;
  }

  private async attendanceAuthority(db: PlanningDb, schoolId: string, userIds: string[]) {
    return (await sql<{ user_id: string; can_record: boolean; can_review: boolean }>`SELECT account.id AS user_id,
      EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=account.id AND membership.role='admin' AND membership.is_active)
        OR staff_has_resource_permission(${schoolId}::uuid,account.id,'attendance.record','institution',${schoolId}::uuid,
          (${executionNow().toISOString()}::timestamptz AT TIME ZONE school.timezone)::date) AS can_record,
      EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=account.id AND membership.role='admin' AND membership.is_active)
        OR staff_has_resource_permission(${schoolId}::uuid,account.id,'attendance.review','institution',${schoolId}::uuid,
          (${executionNow().toISOString()}::timestamptz AT TIME ZONE school.timezone)::date) AS can_review
      FROM users account JOIN schools school ON school.id=${schoolId}::uuid WHERE account.id=ANY(${userIds}::uuid[]) AND account.is_active`.execute(db)).rows;
  }

  async catalogue(user: AuthUser, schoolId: string) {
    const manager = await this.manager(this.db, user, schoolId, false);
    const school = (await sql<{ timezone: string }>`SELECT timezone FROM schools WHERE id=${schoolId}::uuid`.execute(this.db)).rows[0]!;
    if (!manager) {
      await this.actingPerson(this.db, user, schoolId);
      return { school_id: schoolId, timezone: school.timezone, can_manage: false, can_create_places: false, campuses: [], people: [], recorders: [], reviewers: [], groups: [], spaces: [], classes: [], subjects: [], terms: [],
        purposes: ['teaching', 'duty', 'training', 'meeting', 'other'], people_limit: 2000, people_truncated: false };
    }
    const people = (await sql<{ id: string; label: string; affiliations: string[] }>`SELECT person.id,
      concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,
      array_remove(ARRAY[
        CASE WHEN EXISTS(SELECT 1 FROM students learner WHERE learner.person_id=person.id) THEN 'learner' END,
        CASE WHEN EXISTS(SELECT 1 FROM staff_profiles worker WHERE worker.person_id=person.id AND worker.status<>'inactive') THEN 'worker' END
      ],NULL) AS affiliations
      FROM school_people person WHERE person.school_id=${schoolId}::uuid AND person.retired_at IS NULL
      ORDER BY person.first_name,person.last_name,person.id LIMIT 2000`.execute(this.db)).rows;
    const actingPeople = await this.db.transaction().execute(tx => this.identities.listActingPeople(tx, { school_id: schoolId, at: executionNow().toISOString() }));
    const eligible = await this.attendanceAuthority(this.db, schoolId, actingPeople.map(person => person.user_id));
    const recorders = actingPeople.filter(person => eligible.some(authority => authority.user_id === person.user_id && authority.can_record))
      .map(person => ({ id: person.person_id, label: person.label }));
    const reviewers = actingPeople.filter(person => eligible.some(authority => authority.user_id === person.user_id && authority.can_review))
      .map(person => ({ id: person.person_id, label: person.label }));
    const groups = (await sql<{ id: string; label: string; kind: string }>`
      SELECT 'class:'||id::text AS id,concat('Class ',grade,section) AS label,'class'::text AS kind FROM class_sections WHERE school_id=${schoolId}::uuid
      UNION ALL SELECT 'group:'||id::text,name,'group' FROM participation_groups WHERE school_id=${schoolId}::uuid AND is_active
      ORDER BY kind,label,id`.execute(this.db)).rows;
    groups.push(...(await this.db.transaction().execute(tx => this.responsibilities.listPlanningTeams(tx, { school_id: schoolId, at: executionNow().toISOString() })))
      .map(team => ({ id: `team:${team.id}`, label: team.label, kind: 'team' })));
    const spaces = (await sql<{ id: string; label: string }>`SELECT id,name AS label FROM campus_spaces WHERE school_id=${schoolId}::uuid AND status='active' ORDER BY name,id`.execute(this.db)).rows;
    const canCreatePlaces = (await sql<{ allowed: boolean }>`SELECT EXISTS(SELECT 1 FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active) AS allowed`.execute(this.db)).rows[0]?.allowed ?? false;
    const campuses = canCreatePlaces ? (await sql<{ id: string; label: string; is_primary: boolean }>`SELECT id,name AS label,is_primary
      FROM institution_campuses WHERE school_id=${schoolId}::uuid AND status='active' ORDER BY is_primary DESC,name,id`.execute(this.db)).rows : [];
    const classes = (await sql<{ id: string; label: string }>`SELECT id,concat('Class ',grade,section) AS label FROM class_sections WHERE school_id=${schoolId}::uuid ORDER BY grade,section,id`.execute(this.db)).rows;
    const subjects = (await sql<{ id: string; label: string }>`SELECT id,name AS label FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name,id`.execute(this.db)).rows;
    const terms = (await sql<{ id: string; label: string; starts_on: string; ends_on: string }>`SELECT id,name AS label,starts_on::text,ends_on::text FROM academic_terms WHERE school_id=${schoolId}::uuid ORDER BY starts_on DESC,id`.execute(this.db)).rows;
    return { school_id: schoolId, timezone: school.timezone, can_manage: true, can_create_places: canCreatePlaces, campuses, people, recorders, reviewers, groups, spaces, classes, subjects, terms,
      purposes: ['teaching', 'duty', 'training', 'meeting', 'other'], people_limit: 2000, people_truncated: people.length === 2000 };
  }

  private async row(db: PlanningDb, schoolId: string, id: string, lock = false): Promise<PlanRow> {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Choose a valid timetable plan.');
    const row = (await sql<PlanRow>`SELECT *,starts_on::text,ends_on::text FROM schedule_versions
      WHERE school_id=${schoolId}::uuid AND id=${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(db)).rows[0];
    if (!row || row.state === 'discarded') throw new NotFoundException('This timetable plan was not found in this institution.');
    return row;
  }

  private async view(db: PlanningDb, row: PlanRow) {
    const periods = (await sql<PeriodRow>`SELECT *,starts_at::text,ends_at::text FROM schedule_periods WHERE version_id=${row.id}::uuid ORDER BY weekday,period_number`.execute(db)).rows;
    const first = periods[0];
    const personIds = (await sql<{ id: string }>`SELECT person_id AS id FROM schedule_plan_people WHERE version_id=${row.id}::uuid ORDER BY person_id`.execute(db)).rows.map(item => item.id);
    const groupIds = (await sql<{ id: string }>`SELECT group_kind||':'||group_id::text AS id FROM schedule_plan_groups WHERE version_id=${row.id}::uuid ORDER BY group_kind,group_id`.execute(db)).rows.map(item => item.id);
    const supersessions = (await sql<{ replacement_plan_id:string;from:string;until:string|null;effective_from:Date;effective_until:Date|null;permanent:boolean }>`SELECT
      replacement_version_id AS replacement_plan_id,(effective_from AT TIME ZONE ${row.activity_timezone})::date::text AS "from",
      (effective_until AT TIME ZONE ${row.activity_timezone})::date::text AS until,effective_from,effective_until,
      (effective_until IS NULL OR (${row.ends_on}::date IS NOT NULL
        AND effective_until>=((${row.ends_on}::date+1)::timestamp AT TIME ZONE ${row.activity_timezone}))) AS permanent
      FROM schedule_plan_supersessions WHERE school_id=${row.school_id}::uuid AND previous_version_id=${row.id}::uuid ORDER BY effective_from`.execute(db)).rows;
    const permanent=supersessions.find(window=>window.permanent||row.recurrence_kind==='once');
    const upcoming=supersessions.filter(window=>!window.effective_until||new Date(window.effective_until)>executionNow());
    const pending=(await sql<{id:string}>`SELECT id FROM schedule_versions WHERE school_id=${row.school_id}::uuid
      AND replaces_version_id=${row.id}::uuid AND state='draft'`.execute(db)).rows[0];
    return { id: row.id, school_id: row.school_id, title: row.activity_title, purpose: row.activity_purpose,
      description: row.activity_description, timezone: row.activity_timezone, state: row.state, revision: row.revision,
      starts_on: row.starts_on, ends_on: row.ends_on, recurrence: row.recurrence_kind,
      weekdays: [...new Set(periods.map(period => period.weekday))], starts_at: first?.starts_at.slice(0, 5) ?? '09:00',
      ends_at: first?.ends_at.slice(0, 5) ?? '10:00', end_day_offset: first?.end_day_offset ?? 0,
      space_id: first?.space_id ?? null, person_ids: personIds, group_ids: groupIds,
      lead_person_id: row.lead_person_id, recorder_person_id: row.recorder_person_id, reviewer_person_id: row.reviewer_person_id,
      attendance_mode: row.attendance_mode, class_section_id: row.class_section_id, term_id: row.term_id,
      subject_id: first?.subject_id ?? null, source: row.planning_origin, source_ref: row.id,
      source_href: row.planning_origin === 'academic' ? `/areas/timetable/planning?class=${row.class_section_id}&term=${row.term_id}` : null,
      location_kind: row.location_kind, location_label: row.location_label, location_url: row.location_url,
      replaces_version_id: row.replaces_version_id, revision_reason: row.revision_reason, superseded_on: permanent?.from ?? null,
      replacement_windows:upcoming.slice(0,10).map(window=>({replacement_plan_id:window.replacement_plan_id,from:window.from,until:window.until})),
      replacement_window_count:upcoming.length,pending_revision_id:pending?.id??null,
      can_plan_change:row.planning_origin==='activity'&&row.state==='published'&&!pending
        &&(row.recurrence_kind==='once'?supersessions.length===0:!permanent||new Date(permanent.effective_from)>executionNow()),
      can_edit: row.planning_origin === 'activity' && row.state === 'draft', periods };
  }

  async listPlans(user: AuthUser, schoolId: string, query: unknown) {
    await this.manager(this.db, user, schoolId);
    const range = activityRangeInput.parse(query);
    const rows = (await sql<PlanRow>`SELECT *,starts_on::text,ends_on::text,count(*) OVER()::int AS total
      FROM schedule_versions WHERE school_id=${schoolId}::uuid AND NOT baseline AND state<>'discarded'
        AND starts_on<=${range.until}::date AND (ends_on IS NULL OR ends_on>=${range.from}::date)
      ORDER BY (schedule_versions.state='draft') DESC,schedule_versions.starts_on DESC,schedule_versions.created_at DESC,schedule_versions.id LIMIT ${PAGE_SIZE} OFFSET ${(range.page - 1) * PAGE_SIZE}`.execute(this.db)).rows;
    const count = (await sql<{ total: number }>`SELECT count(*)::int AS total FROM schedule_versions
      WHERE school_id=${schoolId}::uuid AND NOT baseline AND state<>'discarded'
        AND starts_on<=${range.until}::date AND (ends_on IS NULL OR ends_on>=${range.from}::date)`.execute(this.db)).rows[0]!.total;
    return { items: await Promise.all(rows.map(row => this.view(this.db, row))), ...range, page_size: PAGE_SIZE, total: count, total_pages: Math.ceil(count / PAGE_SIZE) };
  }

  async getPlan(user: AuthUser, schoolId: string, id: string) {
    const manager = await this.manager(this.db, user, schoolId, false);
    const row = await this.row(this.db, schoolId, id);
    if (!manager) {
      const personId = await this.actingPerson(this.db, user, schoolId);
      const owned = (await sql`SELECT occurrence.id FROM schedule_activity_occurrences occurrence
        WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.plan_version_id=${id}::uuid
          AND (EXISTS(SELECT 1 FROM schedule_activity_occurrence_people participant WHERE participant.occurrence_id=occurrence.id AND participant.person_id=${personId}::uuid)
            OR EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders recorder WHERE recorder.occurrence_id=occurrence.id AND recorder.person_id=${personId}::uuid)) LIMIT 1`.execute(this.db)).rows[0];
      if (!owned || row.state === 'draft') throw new ForbiddenException('This plan is outside your current timetable responsibilities.');
      const plan = await this.view(this.db, row);
      return { ...plan, person_ids: plan.person_ids.filter(person => person === personId), group_ids: [], can_edit: false,
        can_plan_change:false,pending_revision_id:null,replacement_windows:[],replacement_window_count:0 };
    }
    return this.view(this.db, row);
  }

  private async validate(db: PlanningDb, schoolId: string, input: ActivityPlanInput, publishing = false) {
    const today = (await sql<{ today: string }>`SELECT (${executionNow().toISOString()}::timestamptz AT TIME ZONE ${input.timezone})::date::text AS today`.execute(db)).rows[0]!.today;
    if (publishing && input.starts_on < today) throw new BadRequestException('Start on today or a future date. Historical attendance is not changed by a new plan.');
    if (publishing && input.class_section_id && input.starts_on <= today) throw new BadRequestException('A recurring class timetable starts after today. Use the existing Daily Plan for a same-day class change.');
    if (input.attendance_mode === 'roll_call' && publishing && (!input.recorder_person_id || !input.reviewer_person_id))
      throw new BadRequestException('Choose an attendance recorder and reviewer explicitly before publishing. Participation or timetable-management access does not grant attendance authority.');
    const selected = [...new Set([...input.person_ids, ...[input.lead_person_id, input.recorder_person_id, input.reviewer_person_id].filter((id): id is string => Boolean(id))])];
    const valid = (await sql<{ id: string }>`SELECT id FROM school_people WHERE school_id=${schoolId}::uuid AND id=ANY(${selected}::uuid[]) AND retired_at IS NULL FOR SHARE`.execute(db)).rows;
    if (valid.length !== selected.length) throw new BadRequestException('A selected person is inactive or outside this institution.');
    for (const [action, personId] of [['record', input.recorder_person_id], ['review', input.reviewer_person_id]] as const) if (personId) {
      const acting = await this.identities.resolvePersonAgent(db as Transaction<Database>, { school_id: schoolId, person_id: personId, at: executionNow().toISOString() });
      if (!acting.acting) throw new BadRequestException('Choose an active account-linked person to record or review attendance. A participant without login can still be included in the roster.');
      const permission = (await this.attendanceAuthority(db, schoolId, [acting.user_id]))[0];
      if (!permission || (action === 'record' ? !permission.can_record : !permission.can_review))
        throw new BadRequestException(`The selected ${action === 'record' ? 'recorder' : 'reviewer'} does not have current institution attendance ${action} authority. Scheduling an activity cannot grant this permission.`);
    }
    if (input.space_id && !(await sql`SELECT id FROM campus_spaces WHERE id=${input.space_id}::uuid AND school_id=${schoolId}::uuid AND status='active' FOR SHARE`.execute(db)).rows.length)
      throw new BadRequestException('Choose an active place in this institution.');
    if (input.class_section_id) {
      if (!input.ends_on || !(await sql`SELECT class.id FROM class_sections class JOIN academic_terms term ON term.school_id=class.school_id AND term.academic_year=class.academic_year
        WHERE class.id=${input.class_section_id}::uuid AND class.school_id=${schoolId}::uuid AND term.id=${input.term_id}::uuid
          AND ${input.starts_on}::date>=term.starts_on AND ${input.ends_on}::date<=term.ends_on FOR SHARE`.execute(db)).rows.length)
        throw new BadRequestException('Choose the class, term and a bounded date range within the same academic year.');
      if (!input.lead_person_id && publishing) throw new BadRequestException('Choose the responsible teaching person before publishing.');
      if (input.lead_person_id) {
        const teacher = await this.identities.resolvePersonAgent(db as Transaction<Database>, { school_id: schoolId, person_id: input.lead_person_id, at: executionNow().toISOString() });
        const eligible = teacher.acting && (await sql`SELECT id FROM school_memberships WHERE school_id=${schoolId}::uuid
          AND user_id=${teacher.user_id}::uuid AND role='staff' AND is_active`.execute(db)).rows.length > 0;
        if (!eligible) throw new BadRequestException('Choose an active teaching person for this academic class. Other participants can use a people group without academic context.');
      }
    }
    if (input.subject_id && !(await sql`SELECT id FROM subjects WHERE id=${input.subject_id}::uuid AND school_id=${schoolId}::uuid`.execute(db)).rows.length)
      throw new BadRequestException('Choose an academic subject from this institution.');
    for (const group of input.group_ids) {
      const [kind, id] = group.split(':');
      const found = kind === 'class'
        ? await sql`SELECT id FROM class_sections WHERE id=${id}::uuid AND school_id=${schoolId}::uuid`.execute(db)
        : kind === 'team'
          ? { rows: (await this.responsibilities.listPlanningTeams(db as Transaction<Database>, { school_id: schoolId, at: executionNow().toISOString() })).filter(team => team.id === id) }
          : await sql`SELECT id FROM participation_groups WHERE id=${id}::uuid AND school_id=${schoolId}::uuid AND is_active`.execute(db);
      if (!found.rows.length) throw new BadRequestException('A participant group is inactive or outside this institution.');
    }
  }

  private async prepare(db: Transaction<Database>, req: AuthenticatedRequest, schoolId: string, target: PlanRow | null,
    id: string, action: string, key: string, expected: number, context: Record<string, unknown>, commandContext: ActivityCommandContext) {
    await this.manager(db, req.authUser, schoolId);
    const command = await this.commands.prepareDomainCommand(db, {
      school_id: schoolId, actor_user_id: req.authUser.id, command_type: `timetable.activity.${action}`,
      handler_key: `schedule_planning.activity_${action}`, handler_version: 1, source_domain: 'timetable',
      target: { kind: 'schedule', domain: 'timetable', domain_id: id, label: target?.activity_title ?? (typeof context.title === 'string' ? context.title : 'Timetable activity'),
        lifecycle_state: target ? 'active' : 'planned', source_revision: target?.revision ?? 1, metadata: {} },
      current_revision: target?.revision ?? 0, expected_revision: expected, capability: 'schedule.manage', purpose: `timetable_activity_${action}`,
      requested_at: executionNow().toISOString(), correlation_id: req.requestId, causation_id: null,
      idempotency_key: `timetable-activity:${req.authUser.id}:${key}`, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: 'timetable', decision: 'allowed', reason_codes: ['current_timetable_manager'],
        authority_source_refs: [{ school_id: schoolId, user_id: req.authUser.id, action: 'schedule.manage' }], operating_rule_refs: [], valid_until: null },
      safe_context: context,
    });
    if (command.status === 'ready') {
      commandContext.prepared = command;
      await sql`SAVEPOINT activity_domain_effects`.execute(db);
      commandContext.savepoint = true;
    }
    return command;
  }

  private async audit(db: Transaction<Database>, req: AuthenticatedRequest, schoolId: string, id: string, action: string, revision: number) {
    await db.insertInto('audit_events').values({ school_id: schoolId, actor_id: req.authUser.id, action: `schedule.activity.${action}`,
      target_type: 'schedule', target_id: id, request_id: req.requestId, ip_hash: null, metadata: { revision } }).execute();
    const users=new Set([req.authUser.id]);
    if(action==='published'||action==='cancelled'){
      const people=(await sql<{person_id:string}>`SELECT person_id FROM schedule_plan_roster_sources WHERE school_id=${schoolId}::uuid AND version_id=${id}::uuid
        UNION SELECT recorder_person_id FROM schedule_versions WHERE id=${id}::uuid AND recorder_person_id IS NOT NULL
        UNION SELECT reviewer_person_id FROM schedule_versions WHERE id=${id}::uuid AND reviewer_person_id IS NOT NULL`.execute(db)).rows;
      const expected=new Set(people.map(person=>person.person_id));
      const acting=await this.identities.listActingPeople(db,{school_id:schoolId,at:executionNow().toISOString()});
      const managers=(await sql<{user_id:string}>`SELECT DISTINCT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        JOIN schools school ON school.id=membership.school_id WHERE membership.school_id=${schoolId}::uuid AND membership.is_active
          AND (membership.role='admin' OR staff_has_resource_permission(${schoolId}::uuid,membership.user_id,'schedule.manage','institution',${schoolId}::uuid,
            (${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date))`.execute(db)).rows;
      const allowedManagers=new Set(managers.map(manager=>manager.user_id));
      for(const actor of acting)if(expected.has(actor.person_id)||allowedManagers.has(actor.user_id))users.add(actor.user_id);
    }
    await this.events.enqueueUserEvent(db, { schoolId, eventType: 'timetable.updated', aggregateType: 'schedule', aggregateId: id,
      audienceUserIds: [...users], idempotencyKey: `activity:${id}:${revision}:${action}`,
      payload: { refresh: ['principal.timetable', 'activities', 'attendance', 'workspace', 'today'], change_kind: action } });
    return (await sql<{ id: string }>`SELECT id FROM event_outbox WHERE school_id=${schoolId}::uuid
      AND idempotency_key=${`activity:${id}:${revision}:${action}`}`.execute(db)).rows[0]!.id;
  }

  private async captureRosterSources(db: Transaction<Database>, row: PlanRow, actorId: string, publishedAt: string) {
    const sources = (await sql<{ person_id: string; label: string; participation_role: 'participant' | 'lead'; source_kind: string;
      source_ref: string; source_revision: number; person_revision: number; effective_from: Date | string; effective_until: Date | string | null }>`
      WITH plan AS (SELECT *,starts_on::timestamp AT TIME ZONE activity_timezone AS begins,
        CASE WHEN ends_on IS NULL THEN NULL ELSE (ends_on+1)::timestamp AT TIME ZONE activity_timezone END AS ends
        FROM schedule_versions WHERE id=${row.id}::uuid AND school_id=${row.school_id}::uuid),
      selected_classes AS (
        SELECT selected.group_id AS class_id,NULL::uuid AS term_id FROM schedule_plan_groups selected WHERE selected.version_id=${row.id}::uuid AND selected.group_kind='class'
        UNION SELECT class_section_id,term_id FROM plan WHERE class_section_id IS NOT NULL
      ), expected AS (
        SELECT person.id AS person_id,CASE WHEN person.id=plan.lead_person_id THEN 'lead' ELSE 'participant' END AS participation_role,
          'person'::text AS source_kind,person.id::text AS source_ref,person.revision AS source_revision,plan.begins AS effective_from,plan.ends AS effective_until
        FROM plan JOIN school_people person ON person.school_id=plan.school_id AND person.retired_at IS NULL
        WHERE person.id=plan.lead_person_id OR EXISTS(SELECT 1 FROM schedule_plan_people selected WHERE selected.version_id=plan.id AND selected.person_id=person.id)
        UNION ALL
        SELECT learner.person_id,'participant','class',enrollment.id::text,enrollment.revision,
          GREATEST(plan.begins,GREATEST(enrollment.enrolled_on,term.starts_on)::timestamp AT TIME ZONE plan.activity_timezone),
          LEAST(plan.ends,LEAST(enrollment.inactive_from,term.ends_on+1)::timestamp AT TIME ZONE plan.activity_timezone)
        FROM plan CROSS JOIN selected_classes selected
        JOIN enrollments enrollment ON enrollment.class_section_id=selected.class_id AND (selected.term_id IS NULL OR enrollment.term_id=selected.term_id)
        JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=plan.school_id
        JOIN students learner ON learner.id=enrollment.student_id AND learner.school_id=plan.school_id
        UNION ALL
        SELECT member.person_id,'participant','group',member.id::text,member.revision,
          GREATEST(plan.begins,member.starts_on::timestamp AT TIME ZONE plan.activity_timezone),
          LEAST(plan.ends,CASE WHEN member.ends_on IS NULL THEN NULL ELSE (member.ends_on+1)::timestamp AT TIME ZONE plan.activity_timezone END)
        FROM plan JOIN schedule_plan_groups selected ON selected.version_id=plan.id AND selected.group_kind='group'
        JOIN participation_groups selected_group ON selected_group.id=selected.group_id AND selected_group.school_id=plan.school_id AND selected_group.is_active
        JOIN participation_group_members member ON member.group_id=selected_group.id AND member.school_id=plan.school_id
      )
      SELECT DISTINCT expected.*,concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,person.revision AS person_revision
      FROM expected JOIN school_people person ON person.id=expected.person_id AND person.school_id=${row.school_id}::uuid AND person.retired_at IS NULL
      WHERE effective_until IS NULL OR effective_until>effective_from
      ORDER BY person_id,source_kind,source_ref,effective_from
    `.execute(db)).rows;
    const bounds = (await sql<{ from: Date | string; until: Date | string | null }>`SELECT
      (${row.starts_on}::date::timestamp AT TIME ZONE ${row.activity_timezone}) AS "from",
      CASE WHEN ${row.ends_on}::date IS NULL THEN NULL ELSE ((${row.ends_on}::date+1)::timestamp AT TIME ZONE ${row.activity_timezone}) END AS until`.execute(db)).rows[0]!;
    const teams = (await sql<{ id: string }>`SELECT group_id AS id FROM schedule_plan_groups WHERE version_id=${row.id}::uuid AND group_kind='team'`.execute(db)).rows;
    for (const team of teams) {
      const members = await this.responsibilities.snapshotPlanningTeamPeople(db, { school_id: row.school_id, team_id: team.id,
        from: new Date(bounds.from).toISOString(), until: bounds.until ? new Date(bounds.until).toISOString() : null });
      const people = (await sql<{ id: string; label: string; revision: number }>`SELECT id,concat_ws(' ',first_name,NULLIF(last_name,'')) AS label,revision
        FROM school_people WHERE school_id=${row.school_id}::uuid AND id=ANY(${members.map(member => member.person_id)}::uuid[]) AND retired_at IS NULL`.execute(db)).rows;
      for (const member of members) {
        const person = people.find(person => person.id === member.person_id);
        if (person) sources.push({ person_id: person.id, label: person.label, participation_role: 'participant', source_kind: 'team', source_ref: member.source_ref,
          source_revision: member.source_revision, person_revision: person.revision, effective_from: member.effective_from, effective_until: member.effective_until });
      }
    }
    if(sources.length)await sql`INSERT INTO schedule_plan_roster_sources(version_id,school_id,person_id,label,participation_role,source_kind,source_ref,source_revision,person_revision,effective_from,effective_until)
      SELECT ${row.id}::uuid,${row.school_id}::uuid,person_id,label,participation_role,source_kind,source_ref,source_revision,person_revision,effective_from,effective_until
      FROM jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) AS source(person_id uuid,label text,participation_role text,source_kind text,
        source_ref text,source_revision integer,person_revision integer,effective_from timestamptz,effective_until timestamptz)`.execute(db);
    const resources = (await sql<{ id: string; label: string; revision: number }>`SELECT DISTINCT space.id,COALESCE(NULLIF(period.room,''),space.name) AS label,space.revision
      FROM schedule_periods period JOIN campus_spaces space ON space.id=period.space_id AND space.school_id=${row.school_id}::uuid WHERE period.version_id=${row.id}::uuid ORDER BY space.id`.execute(db)).rows;
    await sql`INSERT INTO schedule_plan_publication_evidence(version_id,school_id,source_revision,snapshot_hash,published_at,published_by,resource_snapshots)
      VALUES(${row.id}::uuid,${row.school_id}::uuid,${row.revision + 1},${createHash('sha256').update(JSON.stringify(sources)).digest('hex')},${publishedAt}::timestamptz,${actorId}::uuid,${JSON.stringify(resources)}::jsonb)`.execute(db);
  }

  async create(req: AuthenticatedRequest, schoolId: string, body: unknown) { return this.save(req, schoolId, null, body); }
  async update(req: AuthenticatedRequest, schoolId: string, id: string, body: unknown) { return this.save(req, schoolId, id, body); }

  async revise(req: AuthenticatedRequest, schoolId: string, id: string, body: unknown) {
    const input = activityRevisionInput.parse(body);
    return this.command(req, schoolId, input.idempotency_key, { action: 'revise', id, ...input }, async (db, commandContext) => {
      const source = await this.row(db, schoolId, id, true);
      const command = await this.prepare(db, req, schoolId, source, id, 'revise', input.idempotency_key, input.expected_revision, { ...input, source_id: id }, commandContext);
      if (command.status === 'completed') return this.view(db, await this.row(db, schoolId, input.idempotency_key));
      if (source.planning_origin !== 'activity' || source.state !== 'published') throw new ConflictException('Choose a published activity plan. Academic changes use the owning dated timetable editor.');
      const existing = (await sql`SELECT id FROM schedule_versions WHERE replaces_version_id=${id}::uuid AND state='draft'`.execute(db)).rows[0];
      if (existing) throw new ConflictException('This plan already has a change being prepared or published. Open that dated plan to continue.');
      if (source.recurrence_kind !== 'once' && (input.starts_on < source.starts_on || (source.ends_on && input.starts_on > source.ends_on)))
        throw new BadRequestException('Choose a change date within this plan.');
      if(source.recurrence_kind==='once')await this.oneOffReplacementBounds(db,source);
      const covered=(await sql<{replacement_plan_id:string;from:string;until:string|null}>`SELECT replacement_version_id AS replacement_plan_id,
        (effective_from AT TIME ZONE ${source.activity_timezone})::date::text AS "from",(effective_until AT TIME ZONE ${source.activity_timezone})::date::text AS until
        FROM schedule_plan_supersessions WHERE school_id=${schoolId}::uuid AND previous_version_id=${id}::uuid
          AND (${source.recurrence_kind}='once' OR tstzrange(effective_from,effective_until,'[)') @>
            (${input.starts_on}::date::timestamp AT TIME ZONE ${source.activity_timezone})) ORDER BY effective_from LIMIT 1`.execute(db)).rows[0];
      if(covered)throw this.replacementConflict(covered);
      if(source.recurrence_kind!=='once'){
        const timing=(await sql<{from:Date;today:string}>`SELECT (${input.starts_on}::date::timestamp AT TIME ZONE ${source.activity_timezone}) AS "from",
          (${executionNow()}::timestamptz AT TIME ZONE ${source.activity_timezone})::date::text AS today`.execute(db)).rows[0]!;
        if(input.starts_on<timing.today)throw new BadRequestException('Choose today or a future date for this change. Earlier plans and attendance are retained.');
        await this.assertNoStartedReplacement(db,source,new Date(timing.from).toISOString(),null);
      }
      const newId = input.idempotency_key;
      await sql`INSERT INTO schedule_versions(id,school_id,class_section_id,term_id,state,starts_on,ends_on,created_by,planning_origin,
        activity_title,activity_purpose,activity_description,activity_timezone,recurrence_kind,attendance_mode,lead_person_id,recorder_person_id,reviewer_person_id,
        location_kind,location_label,location_url,replaces_version_id,replaces_source_revision,revision_reason)
        SELECT ${newId}::uuid,school_id,class_section_id,term_id,'draft',${input.starts_on}::date,
          CASE WHEN recurrence_kind='once' THEN ${input.starts_on}::date ELSE ends_on END,${req.authUser.id}::uuid,planning_origin,
          activity_title,activity_purpose,activity_description,activity_timezone,recurrence_kind,attendance_mode,lead_person_id,recorder_person_id,reviewer_person_id,
          location_kind,location_label,location_url,id,revision,${input.reason} FROM schedule_versions WHERE id=${id}::uuid`.execute(db);
      await sql`INSERT INTO schedule_periods(version_id,id,weekday,period_number,starts_at,ends_at,end_day_offset,subject_id,teacher_user_id,title,slot_type,room,space_id)
        SELECT ${newId}::uuid,gen_random_uuid(),CASE WHEN ${source.recurrence_kind}='once' THEN extract(isodow FROM ${input.starts_on}::date)::smallint ELSE weekday END,
          period_number,starts_at,ends_at,end_day_offset,subject_id,teacher_user_id,title,slot_type,room,space_id FROM schedule_periods WHERE version_id=${id}::uuid`.execute(db);
      await sql`INSERT INTO schedule_plan_people(version_id,school_id,person_id) SELECT ${newId}::uuid,school_id,person_id FROM schedule_plan_people WHERE version_id=${id}::uuid`.execute(db);
      await sql`INSERT INTO schedule_plan_groups(version_id,school_id,group_kind,group_id) SELECT ${newId}::uuid,school_id,group_kind,group_id FROM schedule_plan_groups WHERE version_id=${id}::uuid`.execute(db);
      const eventId = await this.audit(db, req, schoolId, newId, 'revision_prepared', 1);
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: command.command_id, terminal_state: 'accepted', code: 'activity_revision_prepared',
        explanation: 'A copy was prepared for a dated change. The existing plan is unchanged until review and publication.', resulting_revision: 1,
        domain_event_id: eventId, metadata: { plan_id: newId, replaces_version_id: id }, completed_at: executionNow().toISOString() });
      return this.view(db, await this.row(db, schoolId, newId));
    });
  }

  private async save(req: AuthenticatedRequest, schoolId: string, existingId: string | null, body: unknown) {
    const input = activityPlanInput.parse(body);
    if (existingId && !input.expected_revision) throw new BadRequestException('Refresh this draft and provide its current revision.');
    // A create key deterministically addresses its aggregate, allowing safe HTTP retries.
    const id = existingId ?? input.idempotency_key;
    return this.command(req, schoolId, input.idempotency_key, { action: existingId ? 'save' : 'create', id, ...input }, async (db, commandContext) => {
      await lockSchedule(db, schoolId);
      const current = existingId ? await this.row(db, schoolId, id, true) : null;
      const command = await this.prepare(db, req, schoolId, current, id, existingId ? 'save' : 'create', input.idempotency_key, input.expected_revision ?? 0, { ...input }, commandContext);
      if (command.status === 'completed') return this.view(db, await this.row(db, schoolId, id));
      if (current && (current.state !== 'draft' || current.planning_origin !== 'activity')) throw new ConflictException('Published plans are read-only. Use the owning academic calendar for academic drafts, or create a new dated activity.');
      await this.validate(db, schoolId, input);
      const endsOn = input.recurrence === 'once' ? input.starts_on : input.ends_on;
      let revision = 1;
      if (!current) await sql`INSERT INTO schedule_versions(id,school_id,class_section_id,term_id,state,starts_on,ends_on,created_by,
        planning_origin,activity_title,activity_purpose,activity_description,activity_timezone,recurrence_kind,attendance_mode,lead_person_id,recorder_person_id,reviewer_person_id,location_kind,location_label,location_url)
        VALUES(${id}::uuid,${schoolId}::uuid,${input.class_section_id}::uuid,${input.term_id}::uuid,'draft',${input.starts_on}::date,${endsOn}::date,${req.authUser.id}::uuid,
        'activity',${input.title},${input.purpose},${input.description},${input.timezone},${input.recurrence},${input.attendance_mode},${input.lead_person_id}::uuid,${input.recorder_person_id}::uuid,${input.reviewer_person_id}::uuid,${input.location_kind},${input.location_label},${input.location_url})`.execute(db);
      else {
        revision = current.revision + 1;
        await sql`UPDATE schedule_versions SET starts_on=${input.starts_on}::date,ends_on=${endsOn}::date,class_section_id=${input.class_section_id}::uuid,term_id=${input.term_id}::uuid,
          activity_title=${input.title},activity_purpose=${input.purpose},activity_description=${input.description},activity_timezone=${input.timezone},recurrence_kind=${input.recurrence},
          attendance_mode=${input.attendance_mode},lead_person_id=${input.lead_person_id}::uuid,recorder_person_id=${input.recorder_person_id}::uuid,reviewer_person_id=${input.reviewer_person_id}::uuid,revision=${revision}
          ,location_kind=${input.location_kind},location_label=${input.location_label},location_url=${input.location_url}
          WHERE id=${id}::uuid`.execute(db);
        await sql`DELETE FROM schedule_periods WHERE version_id=${id}::uuid`.execute(db);
        await sql`DELETE FROM schedule_plan_people WHERE version_id=${id}::uuid`.execute(db);
        await sql`DELETE FROM schedule_plan_groups WHERE version_id=${id}::uuid`.execute(db);
      }
      const weekdays = input.recurrence === 'once' ? [new Date(`${input.starts_on}T12:00:00Z`).getUTCDay() || 7] : input.weekdays;
      const teachingIdentity = input.class_section_id && input.lead_person_id
        ? await this.identities.resolvePersonAgent(db, { school_id: schoolId, person_id: input.lead_person_id, at: executionNow().toISOString() }) : null;
      const teachingAccount = teachingIdentity?.acting ? teachingIdentity.user_id : null;
      for (const weekday of weekdays) await sql`INSERT INTO schedule_periods(version_id,id,weekday,period_number,starts_at,ends_at,end_day_offset,subject_id,teacher_user_id,title,slot_type,room,space_id)
        VALUES(${id}::uuid,${randomUUID()}::uuid,${weekday},1,${input.starts_at}::time,${input.ends_at}::time,${input.end_day_offset},${input.subject_id}::uuid,${teachingAccount}::uuid,${input.title},
          ${input.class_section_id ? 'class' : 'activity'},COALESCE((SELECT name FROM campus_spaces WHERE id=${input.space_id}::uuid),''),${input.space_id}::uuid)`.execute(db);
      for (const personId of new Set(input.person_ids)) await sql`INSERT INTO schedule_plan_people(version_id,school_id,person_id) VALUES(${id}::uuid,${schoolId}::uuid,${personId}::uuid)`.execute(db);
      for (const group of new Set(input.group_ids)) { const [kind, groupId] = group.split(':'); await sql`INSERT INTO schedule_plan_groups(version_id,school_id,group_kind,group_id) VALUES(${id}::uuid,${schoolId}::uuid,${kind},${groupId}::uuid)`.execute(db); }
      const domainEventId = await this.audit(db, req, schoolId, id, existingId ? 'saved' : 'created', revision);
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: command.command_id, terminal_state: 'accepted', code: 'activity_draft_saved',
        explanation: 'The timetable draft was saved. It has not been published.', resulting_revision: revision, domain_event_id: domainEventId, metadata: { plan_id: id }, completed_at: executionNow().toISOString() });
      const saved = await this.row(db, schoolId, id);
      await retainTimetableContinuation(db, req.authUser, schoolId, saved);
      return this.view(db, saved);
    });
  }

  async publish(req: AuthenticatedRequest, schoolId: string, id: string, body: unknown) {
    const input = activityActionInput.parse(body);
    return this.command(req, schoolId, input.idempotency_key, { action: 'publish', id, ...input }, async (db, commandContext) => {
      await lockSchedule(db, schoolId);
      const row = await this.row(db, schoolId, id, true);
      const command = await this.prepare(db, req, schoolId, row, id, 'publish', input.idempotency_key, input.expected_revision, { plan_id: id }, commandContext);
      if (command.status === 'completed') return this.view(db, row);
      if (row.planning_origin !== 'activity' || row.state !== 'draft') throw new ConflictException('Only a current activity draft can be published here.');
      const replaced = row.replaces_version_id ? await this.row(db, schoolId, row.replaces_version_id, true) : null;
      if (replaced && (replaced.state !== 'published' || replaced.revision !== row.replaces_source_revision))
        throw new ConflictException('The original plan changed or already has a replacement. Prepare a fresh change from the current plan.');
      const view = await this.view(db, row);
      const editableFields = ['title', 'purpose', 'description', 'timezone', 'starts_on', 'ends_on', 'recurrence', 'weekdays',
        'starts_at', 'ends_at', 'end_day_offset', 'space_id', 'person_ids', 'group_ids', 'lead_person_id', 'recorder_person_id',
        'reviewer_person_id', 'attendance_mode', 'class_section_id', 'term_id', 'subject_id', 'location_kind', 'location_label', 'location_url'] as const;
      const editable = Object.fromEntries(editableFields.map(key => [key, view[key]]));
      await this.validate(db, schoolId, activityPlanInput.parse({ ...editable, idempotency_key: input.idempotency_key }), true);
      const publishedAt = executionNow().toISOString();
      // Capture effective source intervals once. Validation and later extension
      // use this same snapshot; a refusal rolls it back with the domain effects.
      await this.captureRosterSources(db, row, req.authUser.id, publishedAt);
      const until = row.ends_on && row.ends_on < addDays(row.starts_on, 30) ? row.ends_on : addDays(row.starts_on, 30);
      const occurrences = await this.engine.expand(db, schoolId, row.starts_on, until, id);
      const proposed = occurrences.filter(occurrence => occurrence.plan_version_id === id);
      if (!proposed.length) throw new BadRequestException('This plan has no occurrences in its date range.');
      if (proposed.some(occurrence => !occurrence.participants.some(person => person.attendance_expected !== false) && occurrence.attendance_mode !== 'none')) throw new BadRequestException('A participant group has no eligible people on an affected date. Add people or correct its effective membership.');
      const replacedBounds = replaced?.recurrence_kind==='once'?await this.oneOffReplacementBounds(db,replaced):replaced ? (await sql<{ from: Date | string; until: Date | string | null }>`SELECT
        (${row.starts_on}::date::timestamp AT TIME ZONE ${row.activity_timezone}) AS "from",
        CASE WHEN ${row.ends_on}::date IS NULL THEN NULL ELSE ((${row.ends_on}::date+1)::timestamp AT TIME ZONE ${row.activity_timezone}) END AS until`.execute(db)).rows[0]! : null;
      if(replaced&&replacedBounds){
        if(proposed.some(occurrence=>new Date(occurrence.starts_at).getTime()<=executionNow().getTime()))
          throw new ConflictException('The revised activity would already have started. Choose a later time today or start tomorrow. Earlier plans and attendance are retained.');
        await this.assertNoStartedReplacement(db,replaced,new Date(replacedBounds.from).toISOString(),replacedBounds.until?new Date(replacedBounds.until).toISOString():null);
      }
      const willReplace = (occurrence: ActivityOccurrence) => Boolean(replacedBounds && occurrence.plan_version_id === replaced!.id
        && occurrence.starts_at >= new Date(replacedBounds.from).toISOString()
        && (!replacedBounds.until || occurrence.starts_at < new Date(replacedBounds.until).toISOString()));
      if(replaced&&replacedBounds){
        const overlap=(await sql<{replacement_plan_id:string;from:string;until:string|null}>`SELECT replacement_version_id AS replacement_plan_id,
          (effective_from AT TIME ZONE ${replaced.activity_timezone})::date::text AS "from",(effective_until AT TIME ZONE ${replaced.activity_timezone})::date::text AS until
          FROM schedule_plan_supersessions WHERE school_id=${schoolId}::uuid AND previous_version_id=${replaced.id}::uuid
            AND tstzrange(effective_from,effective_until,'[)') && tstzrange(${new Date(replacedBounds.from).toISOString()}::timestamptz,
              ${replacedBounds.until?new Date(replacedBounds.until).toISOString():null}::timestamptz,'[)') ORDER BY effective_from LIMIT 1`.execute(db)).rows[0];
        if(overlap)throw this.replacementConflict(overlap);
      }
      await this.checkConflicts(db, schoolId, proposed, occurrences.filter(occurrence => occurrence.plan_version_id !== id && !willReplace(occurrence)));
      // Persist only a bounded month. Conflict validity is not limited to that
      // horizon: check a complete weekly cycle at every known change boundary.
      const laterStarts = (await sql<{ date: string }>`WITH boundaries AS (
        SELECT starts_on AS date FROM schedule_versions WHERE school_id=${schoolId}::uuid AND state='published'
        UNION SELECT ends_on+1 FROM schedule_versions WHERE school_id=${schoolId}::uuid AND state='published' AND ends_on IS NOT NULL
        UNION SELECT term.starts_on FROM academic_terms term WHERE term.school_id=${schoolId}::uuid
          AND EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.term_id=term.id)
        UNION SELECT term.ends_on+1 FROM academic_terms term WHERE term.school_id=${schoolId}::uuid
          AND EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.term_id=term.id)
        UNION SELECT date FROM day_plans WHERE school_id=${schoolId}::uuid AND published_version IS NOT NULL
        UNION SELECT starts_on FROM staff_leave_requests WHERE school_id=${schoolId}::uuid AND status='approved'
        UNION SELECT ends_on+1 FROM staff_leave_requests WHERE school_id=${schoolId}::uuid AND status='approved'
        UNION SELECT (source.effective_from AT TIME ZONE ${row.activity_timezone})::date FROM schedule_plan_roster_sources source
          JOIN schedule_versions version ON version.id=source.version_id WHERE source.school_id=${schoolId}::uuid AND (version.state='published' OR version.id=${id}::uuid)
        UNION SELECT (source.effective_until AT TIME ZONE ${row.activity_timezone})::date FROM schedule_plan_roster_sources source
          JOIN schedule_versions version ON version.id=source.version_id WHERE source.school_id=${schoolId}::uuid AND source.effective_until IS NOT NULL
            AND (version.state='published' OR version.id=${id}::uuid)
        UNION SELECT enrollment.enrolled_on FROM enrollments enrollment JOIN class_sections section ON section.id=enrollment.class_section_id
          WHERE section.school_id=${schoolId}::uuid
        UNION SELECT enrollment.inactive_from FROM enrollments enrollment JOIN class_sections section ON section.id=enrollment.class_section_id
          WHERE section.school_id=${schoolId}::uuid AND enrollment.inactive_from IS NOT NULL
        UNION SELECT local_date FROM schedule_activity_occurrences WHERE school_id=${schoolId}::uuid AND source IN ('event','examination') AND state='expected'
      ) SELECT DISTINCT date::text FROM boundaries WHERE date>${until}::date AND (${row.ends_on}::date IS NULL OR date<=${row.ends_on}::date) ORDER BY date`.execute(db)).rows;
      const zones=(await sql<{timezone:string}>`SELECT activity_timezone AS timezone FROM schedule_versions WHERE school_id=${schoolId}::uuid AND state='published'
        UNION SELECT timezone FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows.map(zone=>zone.timezone);
      const laterBoundaries=new Set([...laterStarts.map(boundary=>boundary.date),...[...new Set([row.activity_timezone,...zones])]
        .flatMap(zone=>timezoneTransitionDates(zone,row.starts_on)).filter(date=>date>until&&(!row.ends_on||date<=row.ends_on))]);
      for (const boundary of [...laterBoundaries].sort()) {
        const through = row.ends_on && row.ends_on < addDays(boundary, 7) ? row.ends_on : addDays(boundary, 7);
        const later = await this.engine.expand(db, schoolId, boundary, through, id);
        const expected=later.filter(occurrence => occurrence.plan_version_id === id);
        if(expected.some(occurrence=>!occurrence.participants.some(person=>person.attendance_expected!==false)&&occurrence.attendance_mode!=='none'))
          throw new BadRequestException(`The captured participant group has no eligible people on ${boundary}. Correct its effective membership or bound this plan before publishing.`);
        await this.checkConflicts(db, schoolId, expected,
          later.filter(occurrence => occurrence.plan_version_id !== id && !willReplace(occurrence)));
      }
      await sql`UPDATE schedule_versions SET state='published',published_at=${publishedAt}::timestamptz,revision=revision+1 WHERE id=${id}::uuid`.execute(db);
      const published = await this.row(db, schoolId, id);
      if (replaced && replacedBounds) {
        await sql`INSERT INTO schedule_plan_supersessions(school_id,previous_version_id,replacement_version_id,previous_source_revision,replacement_source_revision,effective_from,effective_until,reason,actor_id)
          VALUES(${schoolId}::uuid,${replaced.id}::uuid,${id}::uuid,${replaced.revision},${published.revision},${new Date(replacedBounds.from).toISOString()}::timestamptz,
            ${replacedBounds.until ? new Date(replacedBounds.until).toISOString() : null}::timestamptz,${row.revision_reason ?? 'Reviewed dated change'},${req.authUser.id}::uuid)`.execute(db);
        const superseded=(await sql<{id:string;projection_date:string}>`UPDATE schedule_activity_occurrences SET state='cancelled',revision=revision+1
          WHERE school_id=${schoolId}::uuid AND plan_version_id=${replaced.id}::uuid AND starts_at>=${new Date(replacedBounds.from).toISOString()}::timestamptz
            AND (${replacedBounds.until ? new Date(replacedBounds.until).toISOString() : null}::timestamptz IS NULL OR starts_at<${replacedBounds.until ? new Date(replacedBounds.until).toISOString() : null}::timestamptz)
            AND state='expected' RETURNING id,(starts_at AT TIME ZONE ${published.activity_timezone})::date::text AS projection_date`.execute(db)).rows;
        await this.projectRetainedChanges(db,req.authUser.id,published,superseded,req.requestId,
          { event_type: 'timetable.activity_superseded', occurred_at: new Date(published.published_at!).toISOString(), replacement_id: id,
            supersedes_plan: { domain: 'timetable', domain_id: replaced.id, source_revision: replaced.revision } });
      }
      const publishedOccurrences = (await this.engine.expand(db, schoolId, row.starts_on, until)).filter(occurrence => occurrence.plan_version_id === id);
      await this.engine.retain(db, publishedOccurrences);
      const receipt = await this.project(db, req.authUser.id, published, publishedOccurrences, row.starts_on, until, req.requestId);
      await sql`UPDATE schedule_plan_publication_evidence SET basis_event_id=${receipt.event_id}::uuid WHERE version_id=${id}::uuid`.execute(db);
      const domainEventId = await this.audit(db, req, schoolId, id, 'published', published.revision);
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: command.command_id, terminal_state: 'accepted', code: 'activity_published',
        explanation: 'The reviewed timetable plan is published.', resulting_revision: published.revision, domain_event_id: domainEventId,
        metadata: { plan_id: id, temporal_event_id: receipt.event_id, occurrence_count: publishedOccurrences.length, conflict_horizon_until: until }, completed_at: executionNow().toISOString() });
      if (published.attendance_mode === 'roll_call') await retainOperatingDestination(db, req.authUser, schoolId, 'attendance',
        '/areas/attendance/registers', { onlyPending: true, source: 'accepted_activity_publication' });
      await retainTimetableContinuation(db, req.authUser, schoolId, published);
      return { ...await this.view(db, published), conflict_horizon_until: until };
    });
  }

  private async oneOffReplacementBounds(db:PlanningDb,source:PlanRow){
    const bounds=(await sql<{from:Date;until:Date}>`SELECT
      min((${source.starts_on}::date+period.starts_at) AT TIME ZONE ${source.activity_timezone}) AS "from",
      ((${source.starts_on}::date+1)::timestamp AT TIME ZONE ${source.activity_timezone}) AS until
      FROM schedule_periods period WHERE period.version_id=${source.id}::uuid`.execute(db)).rows[0];
    if(!bounds?.from||new Date(bounds.from).getTime()<=executionNow().getTime())
      throw new ConflictException('This one-off activity has already started. Its planned time and evidence are retained; create a separate new activity instead.');
    return bounds;
  }

  private async assertNoStartedReplacement(db:PlanningDb,source:PlanRow,from:string,until:string|null){
    const now=executionNow();
    if(Date.parse(from)>now.getTime())return;
    const days=(await sql<{from:string;today:string}>`SELECT (${from}::timestamptz AT TIME ZONE ${source.activity_timezone})::date::text AS "from",
      (${now}::timestamptz AT TIME ZONE ${source.activity_timezone})::date::text AS today`.execute(db)).rows[0]!;
    // The ordinary recurring engine owns recurrence, exceptions and overnight
    // semantics. Check the affected current-day boundary without rewriting it.
    const occurrences=await this.engine.expand(db,source.school_id,days.from,days.today);
    if(occurrences.some(occurrence=>occurrence.plan_version_id===source.id&&occurrence.state==='expected'
      &&occurrence.starts_at>=from&&(!until||occurrence.starts_at<until)&&Date.parse(occurrence.starts_at)<=now.getTime()))
      throw new ConflictException('This dated change would replace an activity that has already started. Choose tomorrow or a later date. Earlier plans and attendance are retained.');
  }

  private replacementConflict(window:{replacement_plan_id:string;from:string;until:string|null}){
    return new ConflictException({message:`This date range already has a reviewed change from ${window.from}${window.until?` until ${window.until} (exclusive)`:' onward'}. Open that replacement to change its dates, or choose a disjoint range.`,
      replacement_plan_id:window.replacement_plan_id,from:window.from,until:window.until});
  }

  private async checkConflicts(db: PlanningDb, schoolId: string, proposed: ActivityOccurrence[], existing: ActivityOccurrence[]) {
    await assertSpacesNotResidential(db,schoolId,proposed.filter(item=>item.state==='expected').flatMap(item=>item.space_id?[item.space_id]:[]));
    const found=firstOccurrenceConflict(proposed,existing);
    if(found){const {conflict,other}=found;throw new ConflictException({message:`${conflict.label} conflicts with “${other.title}” on ${other.local_date}. Change the people, place or time before publishing.`,
      conflicts:[{...conflict,occurrence_id:other.id,activity_id:other.activity_id,local_date:other.local_date}]});}
    const personIds=[...new Set(proposed.flatMap(occurrence=>occurrence.participants.filter(person=>person.requirement==='required').map(person=>person.person_id)))];
    const leave=personIds.length?(await sql<{person_id:string;label:string;starts_at:Date;ends_at:Date}>`SELECT profile.person_id,
      concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,
      (leave.starts_on::timestamp AT TIME ZONE school.timezone) AS starts_at,((leave.ends_on+1)::timestamp AT TIME ZONE school.timezone) AS ends_at
      FROM staff_leave_requests leave JOIN staff_profiles profile ON profile.id=leave.staff_profile_id AND profile.school_id=leave.school_id
      JOIN school_people person ON person.id=profile.person_id AND person.school_id=profile.school_id JOIN schools school ON school.id=leave.school_id
      WHERE leave.school_id=${schoolId}::uuid AND leave.status='approved' AND profile.person_id=ANY(${personIds}::uuid[])`.execute(db)).rows:[];
    for (const occurrence of proposed) {
      const people=new Set(occurrence.participants.filter(person=>person.requirement==='required').map(person=>person.person_id));
      const unavailable=leave.find(row=>people.has(row.person_id)&&new Date(row.starts_at).toISOString()<occurrence.ends_at&&new Date(row.ends_at).toISOString()>occurrence.starts_at);
      if (unavailable) throw new ConflictException(`${unavailable.label} has approved leave during “${occurrence.title}” on ${occurrence.local_date}. Choose another person or change the time.`);
    }
  }

  private async project(db: Transaction<Database>, actor: string, row: PlanRow, occurrences: ActivityOccurrence[], from: string, until: string, correlation: string,
    change?: { event_type: string; occurred_at: string; replacement_id: string; supersedes_plan?: { domain: string; domain_id: string; source_revision: number } }, basisEventId?: string) {
    const bounds = (await sql<{ from: string; until: string }>`SELECT
      (${from}::date::timestamp AT TIME ZONE ${row.activity_timezone})::text AS "from",
      ((${until}::date+1)::timestamp AT TIME ZONE ${row.activity_timezone})::text AS until`.execute(db)).rows[0]!;
    const evidenceRows = (await sql<{ version_id: string; resource_snapshots: Array<{ id: string; label: string; revision: number }> }>`SELECT version_id,resource_snapshots
      FROM schedule_plan_publication_evidence WHERE version_id=ANY(${[...new Set([row.id, ...occurrences.map(occurrence => occurrence.plan_version_id).filter((id): id is string => Boolean(id))])]}::uuid[])`.execute(db)).rows;
    const resourceSnapshot = (occurrence: ActivityOccurrence) => evidenceRows.find(evidence => evidence.version_id === occurrence.plan_version_id)
      ?.resource_snapshots.find(space => space.id === occurrence.space_id);
    const projectionInput: PlanOccurrenceProjection = { school_id: row.school_id, actor_user_id: actor,
      plan: { kind: 'schedule', domain: 'timetable', domain_id: row.id, label: row.activity_title, lifecycle_state: 'active', source_revision: row.revision, metadata: change ? { replacement_id: change.replacement_id } : {} },
      source_revision: row.revision, event_type: basisEventId ? 'timetable.occurrences_materialized' : change?.event_type ?? (row.state === 'cancelled' ? 'timetable.activity_cancelled' : 'timetable.activity_published'),
      occurred_at: change?.occurred_at ?? new Date(row.cancelled_at ?? row.published_at!).toISOString(), correlation_id: correlation, causation_event_id: null,
      ...(change?.supersedes_plan ? { supersedes_plan: change.supersedes_plan } : {}),
      horizon: { from: new Date(bounds.from).toISOString(), until: new Date(bounds.until).toISOString() },
      occurrences: occurrences.filter(occurrence => Date.parse(occurrence.starts_at) >= Date.parse(bounds.from)
        && Date.parse(occurrence.starts_at) < Date.parse(bounds.until)).map(occurrence => ({ occurrence_key: occurrence.id,
        occurrence: { kind: 'schedule_occurrence', domain: 'timetable', domain_id: occurrence.id, label: occurrence.title, lifecycle_state: 'active', source_revision: row.revision, metadata: {} },
        local_date: occurrence.local_date, starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, time_zone: occurrence.timezone,
        context: occurrence.context_ref ? { kind: 'class', domain: 'academic_structure', domain_id: occurrence.context_ref, label: 'Class', lifecycle_state: 'active', source_revision: 1, metadata: {} } : null,
        participants: [...occurrence.participants].sort((a, b) => a.person_id.localeCompare(b.person_id) || a.participation_role.localeCompare(b.participation_role)).map(person => ({ person: { kind: 'person', domain: 'people', domain_id: person.person_id, label: person.label.slice(0, 200), lifecycle_state: 'active', source_revision: person.person_revision ?? person.source_revision, metadata: {} },
          role: person.participation_role, required: person.requirement === 'required', source_ref: person.source_ref, source_revision: person.source_revision })),
        resources: occurrence.space_id ? [{ kind: 'space', domain: 'campus_topology', domain_id: occurrence.space_id,
          label: resourceSnapshot(occurrence)?.label ?? occurrence.space_label ?? 'Place', lifecycle_state: 'active',
          source_revision: resourceSnapshot(occurrence)?.revision ?? 1, metadata: {} }] : [], state: occurrence.state })),
    };
    if (basisEventId) {
      const { actor_user_id: recordedPublisher, ...systemInput } = projectionInput;
      void recordedPublisher; // Materialization is not a new action by this human.
      return this.projection.extendPlanOccurrences(db, { ...systemInput, basis_event_id: basisEventId });
    }
    return this.projection.recordPlanOccurrences(db, projectionInput);
  }

  /** Change every retained future expectation, not an arbitrary next-year slice. */
  private async projectRetainedChanges(db:Transaction<Database>,actor:string,row:PlanRow,ids:Array<{id:string;projection_date:string}>,correlation:string,
    change?:Parameters<ActivityPlanningService['project']>[7]){
    const ordered=[...ids].sort((left,right)=>left.projection_date.localeCompare(right.projection_date)||left.id.localeCompare(right.id));
    const receipts=[];
    for(let start=0;start<ordered.length;start+=31){
      const selected=ordered.slice(start,start+31);
      const occurrences=await this.getOccurrences(row.school_id,selected.map(item=>item.id),db);
      receipts.push(await this.project(db,actor,row,occurrences,selected[0]!.projection_date,selected.at(-1)!.projection_date,correlation,change));
    }
    return receipts;
  }

  async cancel(req: AuthenticatedRequest, schoolId: string, id: string, body: unknown) {
    const input = activityActionInput.parse(body);
    if (!input.reason) throw new BadRequestException('Explain why this plan is being cancelled. Historical attendance is retained.');
    return this.command(req, schoolId, input.idempotency_key, { action: 'cancel', id, ...input }, async (db, commandContext) => {
      await lockSchedule(db, schoolId);
      const row = await this.row(db, schoolId, id, true);
      const command = await this.prepare(db, req, schoolId, row, id, 'cancel', input.idempotency_key, input.expected_revision, { plan_id: id, reason: input.reason }, commandContext);
      if (command.status === 'completed') return this.view(db, row);
      if (row.planning_origin !== 'activity' || row.state !== 'published') throw new ConflictException('Only a published activity plan can be cancelled here. Academic changes use the existing dated-change path.');
      const now = executionNow().toISOString();
      await sql`UPDATE schedule_versions SET state='cancelled',revision=revision+1,cancelled_at=${now}::timestamptz,cancelled_by=${req.authUser.id}::uuid,cancellation_reason=${input.reason} WHERE id=${id}::uuid`.execute(db);
      const cancelled=(await sql<{id:string;projection_date:string}>`UPDATE schedule_activity_occurrences SET state='cancelled',revision=revision+1
        WHERE school_id=${schoolId}::uuid AND plan_version_id=${id}::uuid AND starts_at>=${now}::timestamptz AND state='expected'
        RETURNING id,(starts_at AT TIME ZONE ${row.activity_timezone})::date::text AS projection_date`.execute(db)).rows;
      const updated = await this.row(db, schoolId, id);
      const receipts=await this.projectRetainedChanges(db,req.authUser.id,updated,cancelled,req.requestId);
      if(!receipts.length){
        const date=(await sql<{date:string}>`SELECT (${now}::timestamptz AT TIME ZONE ${row.activity_timezone})::date::text AS date`.execute(db)).rows[0]!.date;
        receipts.push(await this.project(db,req.authUser.id,updated,[],date,date,req.requestId));
      }
      const domainEventId = await this.audit(db, req, schoolId, id, 'cancelled', updated.revision);
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: command.command_id, terminal_state: 'accepted', code: 'activity_cancelled',
        explanation: 'Future activity occurrences are cancelled. Historical attendance remains unchanged.', resulting_revision: updated.revision, domain_event_id: domainEventId,
        metadata: { plan_id: id, temporal_event_ids: receipts.map(receipt=>receipt.event_id), cancelled_occurrences:cancelled.length }, completed_at: now });
      return this.view(db, updated);
    });
  }

  async ensureOccurrences(schoolId: string, from: string, until: string, transaction?: PlanningDb, query: ActivityOccurrenceQuery = {}): Promise<ActivityOccurrence[]> {
    const work = async (db: PlanningDb) => {
      const occurrences = await this.engine.expand(db, schoolId, from, until, undefined, query);
      await this.engine.retain(db, occurrences);
      const retained = await this.getOccurrences(schoolId, occurrences.map(occurrence => occurrence.id), db);
      for (const versionId of new Set(retained.filter(occurrence => occurrence.source === 'activity' && occurrence.state === 'expected').map(occurrence => occurrence.plan_version_id!))) {
        const row = await this.row(db, schoolId, versionId);
        if (row.state !== 'published') continue;
        const publication = (await sql<{ basis_event_id: string | null }>`SELECT basis_event_id FROM schedule_plan_publication_evidence WHERE version_id=${versionId}::uuid`.execute(db)).rows[0];
        if (!publication?.basis_event_id) throw new ConflictException('This plan has no captured publication evidence. Prepare a reviewed dated revision before extending it.');
        const selected = retained.filter(occurrence => occurrence.plan_version_id === versionId && occurrence.state === 'expected');
        await this.project(db as Transaction<Database>, row.created_by, row, selected, from, until,
          activityOccurrenceId(schoolId, 'materialization', `${versionId}:${row.revision}`, `${from}:${until}`), undefined, publication.basis_event_id);
      }
      return retained;
    };
    return transaction ? work(transaction) : this.db.transaction().execute(work);
  }
  async listOccurrencesForAttendance(schoolId: string, from: string, until: string) { return this.ensureOccurrences(schoolId, from, until); }
  async getOccurrence(schoolId: string, id: string, transaction?: PlanningDb): Promise<ActivityOccurrence> {
    return (await this.getOccurrences(schoolId, [id], transaction))[0]!;
  }

  /** Read immutable retained rosters, not today's people/group membership. */
  private async getOccurrences(schoolId: string, ids: readonly string[], transaction?: PlanningDb): Promise<ActivityOccurrence[]> {
    const db = transaction ?? this.db;
    const result: ActivityOccurrence[] = [];
    // A transaction has one connection: Promise.all of two reads per occurrence
    // only queues round trips. Bound each pair of indexed reads instead; retain
    // the caller's occurrence order and PostgreSQL's participant label ordering.
    for (let offset = 0; offset < ids.length; offset += OCCURRENCE_READ_BATCH_SIZE) {
      const selected = ids.slice(offset, offset + OCCURRENCE_READ_BATCH_SIZE);
      const uniqueIds = [...new Set(selected.map(id => id.toLowerCase()))];
      const rows = (await sql<Omit<ActivityOccurrence, 'participants'> & { starts_at: Date | string; ends_at: Date | string }>`SELECT occurrence.*,occurrence.local_date::text,space.name AS space_label,
        (SELECT person_id FROM schedule_activity_occurrence_recorders WHERE occurrence_id=occurrence.id AND action='record' LIMIT 1) AS recorder_person_id,
        (SELECT person_id FROM schedule_activity_occurrence_recorders WHERE occurrence_id=occurrence.id AND action='review' LIMIT 1) AS reviewer_person_id
        FROM schedule_activity_occurrences occurrence LEFT JOIN campus_spaces space ON space.id=occurrence.space_id AND space.school_id=occurrence.school_id
        WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.id=ANY(${uniqueIds}::uuid[])`.execute(db)).rows;
      const byId = new Map(rows.map(row => [row.id, row]));
      if (uniqueIds.some(id => !byId.has(id)))
        throw new NotFoundException('The planned occurrence is not available in this institution. Open its date in Timetable first.');
      const people = (await sql<ActivityOccurrence['participants'][number] & { occurrence_id: string }>`SELECT occurrence_id,person_id,label,participation_role,source_kind,source_ref,source_revision,person_revision,requirement,attendance_expected
        FROM schedule_activity_occurrence_people WHERE school_id=${schoolId}::uuid AND occurrence_id=ANY(${uniqueIds}::uuid[])
        ORDER BY occurrence_id,label,person_id`.execute(db)).rows;
      const participants = new Map<string, ActivityOccurrence['participants']>();
      for (const { occurrence_id, ...person } of people) {
        const roster = participants.get(occurrence_id) ?? [];
        roster.push(person);
        participants.set(occurrence_id, roster);
      }
      for (const id of selected) {
        const row = byId.get(id.toLowerCase())!;
        result.push({ ...row, starts_at: new Date(row.starts_at).toISOString(), ends_at: new Date(row.ends_at).toISOString(),
          participants: [...(participants.get(row.id) ?? [])] });
      }
    }
    return result;
  }
  async listOccurrences(user: AuthUser, schoolId: string, query: unknown) {
    const manager = await this.manager(this.db, user, schoolId, false);
    const personId = manager ? await this.db.transaction().execute(async tx => {
      const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
      return actor.acting ? actor.person_id : null;
    }) : await this.actingPerson(this.db, user, schoolId);
    const operatorAuthority = (await this.attendanceAuthority(this.db, schoolId, [user.id]))[0];
    const mayRecord = (occurrence: ActivityOccurrence) => Boolean(personId && occurrence.recorder_person_id === personId && operatorAuthority?.can_record);
    const mayReview = (occurrence: ActivityOccurrence) => Boolean(personId && occurrence.reviewer_person_id === personId && operatorAuthority?.can_review);
    const range = activityOccurrenceRangeInput.parse(query);
    const expanded = await this.ensureOccurrences(schoolId, range.from, range.until);
    const matching=expanded.filter(occurrence=>range.state==='all'||occurrence.state===range.state);
    const all = manager ? matching : matching.filter(occurrence => occurrence.recorder_person_id === personId
      || occurrence.reviewer_person_id === personId || occurrence.participants.some(person => person.person_id === personId))
      .map(occurrence => mayRecord(occurrence) || mayReview(occurrence) ? occurrence
        : { ...occurrence, participants: occurrence.participants.filter(person => person.person_id === personId) });
    const page = all.slice((range.page - 1) * PAGE_SIZE, range.page * PAGE_SIZE);
    const items = await Promise.all(page.map(async occurrence => {
      const academicAccess = occurrence.source === 'academic' && occurrence.context_ref
        ? (await sql<{ allowed: boolean }>`SELECT staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,
          'attendance.view',${occurrence.context_ref}::uuid,${occurrence.local_date}::date) AS allowed`.execute(this.db)).rows[0]?.allowed : false;
      const attending = Boolean(personId && occurrence.participants.some(person => person.person_id === personId && person.participation_role === 'participant'));
      const leading = Boolean(personId && occurrence.participants.some(person => person.person_id === personId && person.participation_role === 'lead'));
      const lessonPermission = leading && occurrence.purpose === 'teaching' ? (await sql<{allowed:boolean}>`SELECT EXISTS(
        SELECT 1 FROM staff_role_bindings binding JOIN staff_profiles profile ON profile.school_id=binding.school_id
          AND profile.user_id=binding.user_id AND profile.status='active' AND profile.person_id=${personId}::uuid
        JOIN schools campus ON campus.id=binding.school_id
        WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid AND binding.status='active' AND binding.role_active
          AND 'learning.sessions.manage'=ANY(binding.permissions)
          AND binding.starts_on<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
          AND(binding.ends_on IS NULL OR binding.ends_on>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
          AND(binding.context_kind='institution' AND binding.scope_id=campus.id OR binding.context_kind='class'
            AND binding.scope_id=${occurrence.context_ref}::uuid AND(binding.subject_id IS NULL OR binding.subject_id=${occurrence.subject_id}::uuid))) AS allowed`.execute(this.db)).rows[0]?.allowed : false;
      const lessonHref = occurrence.purpose === 'teaching' && occurrence.state === 'expected' && (attending || lessonPermission)
        ? `/areas/timetable/session?${new URLSearchParams(occurrence.source === 'academic'
          ? {date:occurrence.local_date,class_section_id:occurrence.context_ref!,period_number:String(occurrence.period_number)}
          : {date:occurrence.local_date,occurrence_id:occurrence.id}).toString()}` : null;
      return { ...occurrence, can_open_register: Boolean(occurrence.attendance_mode !== 'none' &&
        (mayRecord(occurrence) || mayReview(occurrence) || academicAccess)),
        teaching_session_href: lessonHref,
        source_href: occurrence.source === 'academic' ? `/areas/timetable/planning?class=${occurrence.context_ref}&date=${occurrence.local_date}`
          : occurrence.source === 'event' ? eventWorkHref(manager?'manage':'assigned',occurrence.context_ref)
            : occurrence.source === 'examination' ? assessmentWorkHref(manager?'manage':'assigned',occurrence.context_ref,[['focus','exam-day']]) : null };
    }));
    return { items,
      ...range, timezone: (await sql<{ timezone: string }>`SELECT timezone FROM schools WHERE id=${schoolId}::uuid`.execute(this.db)).rows[0]!.timezone,
      can_manage: manager, page_size: PAGE_SIZE, total: all.length, total_pages: Math.ceil(all.length / PAGE_SIZE) };
  }

  /** Called by the existing academic publication path inside its transaction. */
  async validateAcademicPublication(db: Transaction<Database>, schoolId: string, classId: string, from: string, until: string, versionId: string) {
    const all = await this.engine.expand(db, schoolId, from, until, versionId);
    const proposed = all.filter(occurrence => occurrence.source === 'academic' && occurrence.context_ref === classId);
    await this.checkConflicts(db, schoolId, proposed, all.filter(occurrence => !(occurrence.source === 'academic' && occurrence.context_ref === classId)));
    await this.engine.retain(db, proposed);
  }

  /** Owning event/exam publication, never an alternate authoring endpoint. */
  async validateOwnedPublication(db:Transaction<Database>,schoolId:string,source:'event'|'examination',contextId:string,from:string,until:string,
    overlay?:{class_ids:string[];subject_id:string}){
    const all=await this.engine.expand(db,schoolId,from,until);
    const proposed=all.filter(occurrence=>occurrence.source===source&&occurrence.context_ref===contextId);
    const existing=all.filter(occurrence=>!(occurrence.source===source&&occurrence.context_ref===contextId))
      .filter(occurrence=>!overlay||occurrence.source!=='academic'||!occurrence.context_ref||!overlay.class_ids.includes(occurrence.context_ref)
        ||occurrence.subject_id!==overlay.subject_id||!proposed.some(test=>test.starts_at>=occurrence.starts_at&&test.ends_at<=occurrence.ends_at));
    await this.checkConflicts(db,schoolId,proposed,existing);
  }
}
