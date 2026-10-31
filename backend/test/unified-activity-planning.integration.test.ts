import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ActivityPlanningService } from '../src/schedule-planning/activity-planning.service.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';
import { ProgressiveSetupService } from '../src/institution-activation/progressive-setup.service.js';
import { SchedulePlanningService } from '../src/schedule-planning/schedule-planning.service.js';
import { SchoolService } from '../src/school/school.service.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ActivityWorkspaceProjection } from '../src/workspace/activity-workspace.projection.js';
import type { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import type { WorkspaceRepositorySnapshot } from '../src/workspace/workspace.contracts.js';
import { institutionLocalDate } from '../src/institution-activation/progressive-setup.contracts.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
types.setTypeParser(1082, value => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused', max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
const service = new ActivityPlanningService(applicationDb, new SchoolEventService(applicationDb, core), core, core, core, new ResponsibilityProjectionService(core));
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
afterAll(async () => db.destroy());

async function fixture() {
  const suffix = randomUUID();
  const account = await db.insertInto('users').values({ username: `unified-${suffix}`, email: `unified-${suffix}@example.test`,
    password_hash: 'isolated-test-only-hash', first_name: 'Unified', last_name: 'Owner', role: 'admin' })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => provisioner.createForAccount(tx, account, 'Asia/Kolkata'));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const person = (await sql<{ id: string }>`SELECT agent.person_id AS id FROM campus_model_agents agent
    JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id
    WHERE agent.school_id=${schoolId}::uuid AND endpoint.user_id=${user.id}::uuid`.execute(db)).rows[0]!.id;
  const participant = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name) VALUES(${schoolId}::uuid,'No-account','Participant') RETURNING id`.execute(db)).rows[0]!.id;
  const tomorrow = addDays(institutionLocalDate('Asia/Kolkata'), 1);
  return { schoolId, user, person, participant, tomorrow };
}

describe.skipIf(!enabled)('unified planning real PostgreSQL and Digital Twin coordination', () => {
  it('publishes no-account overnight activity, replays commands, rejects person conflicts and preserves cancelled history', async () => {
    const { schoolId, user, person, participant, tomorrow } = await fixture();
    const payload = { idempotency_key: randomUUID(), title: 'Night gate coverage', purpose: 'duty', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, ends_on: null, recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: '22:00', ends_at: '06:00', end_day_offset: 1,
      person_ids: [participant], group_ids: [], attendance_mode: 'roll_call', recorder_person_id: person, reviewer_person_id: person };
    const draft = await service.create(request(user), schoolId, payload);
    expect(draft).toMatchObject({ state: 'draft', revision: 1, person_ids: [participant], class_section_id: null });
    expect(await service.create(request(user), schoolId, payload)).toEqual(draft);
    expect(await service.listOccurrences(user, schoolId, { from: tomorrow, until: tomorrow })).toMatchObject({ total: 0 });
    const publishInput = { idempotency_key: randomUUID(), expected_revision: draft.revision };
    const published = await service.publish(request(user), schoolId, draft.id, publishInput);
    expect(published).toMatchObject({ state: 'published', revision: 2 });
    expect(await service.publish(request(user), schoolId, draft.id, publishInput)).toEqual(published);
    const list = await service.listOccurrences(user, schoolId, { from: tomorrow, until: addDays(tomorrow, 1) });
    expect(list.total).toBe(2);
    const first = list.items[0]!;
    expect(first.participants).toEqual([expect.objectContaining({ person_id: participant })]);
    expect(first.starts_at).toBe(`${tomorrow}T16:30:00.000Z`);
    expect(first.ends_at).toBe(`${addDays(tomorrow, 1)}T00:30:00.000Z`);
    const occurrence = await service.getOccurrence(schoolId, first.id);
    expect(occurrence.recorder_person_id).toBe(person);
    expect(occurrence.reviewer_person_id).toBe(person);
    const coreProjection = (await sql<{ count: number; neutral: boolean; participants: number }>`SELECT count(*)::int AS count,
      bool_and(projected.class_entity_id IS NULL AND projected.period_number IS NULL AND projected.context_entity_id IS NULL) AS neutral,
      (SELECT count(*)::int FROM campus_model_occurrence_participants participation WHERE participation.school_id=${schoolId}::uuid) AS participants
      FROM campus_model_schedule_occurrences projected JOIN campus_model_entities plan ON plan.id=projected.schedule_entity_id
      WHERE plan.school_id=${schoolId}::uuid AND plan.domain='timetable' AND plan.domain_id=${draft.id}`.execute(db)).rows[0]!;
    expect(coreProjection).toMatchObject({ count: 31, neutral: true, participants: 31 });
    const publication = (await sql<{ at: Date }>`SELECT published_at AS at FROM schedule_versions WHERE id=${draft.id}::uuid`.execute(db)).rows[0]!.at;
    const projectionInput = { school_id: schoolId, actor_user_id: user.id,
      plan: { kind: 'schedule', domain: 'timetable', domain_id: draft.id, label: payload.title, lifecycle_state: 'active' as const, source_revision: 2, metadata: {} },
      source_revision: 2, event_type: 'timetable.activity_projection_verified', occurred_at: publication.toISOString(), correlation_id: randomUUID(), causation_event_id: null,
      horizon: { from: first.starts_at, until: first.ends_at }, occurrences: [{ occurrence_key: first.id,
        occurrence: { kind: 'schedule_occurrence', domain: 'timetable', domain_id: first.id, label: first.title, lifecycle_state: 'active' as const, source_revision: 2, metadata: {} },
        local_date: first.local_date, starts_at: first.starts_at, ends_at: first.ends_at, time_zone: first.timezone, context: null,
        participants: first.participants.map(participant => ({ person: { kind: 'person', domain: 'people', domain_id: participant.person_id,
          label: participant.label, lifecycle_state: 'active' as const, source_revision: participant.source_revision, metadata: {} }, role: participant.participation_role,
        required: true, source_ref: participant.source_ref, source_revision: participant.source_revision })), resources: [], state: 'expected' as const }] };
    const projectionReceipt = await db.transaction().execute(tx => core.recordPlanOccurrences(tx, projectionInput));
    expect(await db.transaction().execute(tx => core.recordPlanOccurrences(tx, projectionInput))).toMatchObject({ event_id: projectionReceipt.event_id, replayed: true });
    await expect(db.transaction().execute(tx => core.recordPlanOccurrences(tx, { ...projectionInput,
      occurrences: [{ ...projectionInput.occurrences[0]!, ends_at: new Date(Date.parse(first.ends_at) + 60000).toISOString() }] }))).rejects.toThrow();
    const conflicting = await service.create(request(user), schoolId, { ...payload, idempotency_key: randomUUID(), title: 'Overlapping training', purpose: 'training',
      starts_on: addDays(tomorrow, 1), ends_on: addDays(tomorrow, 1), recurrence: 'once', weekdays: [], starts_at: '02:00', ends_at: '03:00', end_day_offset: 0 });
    const refusedPublication = { idempotency_key: randomUUID(), expected_revision: 1 };
    await expect(service.publish(request(user), schoolId, conflicting.id, refusedPublication)).rejects.toThrow('conflicts');
    await expect(service.publish(request(user), schoolId, conflicting.id, refusedPublication)).rejects.toThrow('conflicts');
    const refused = (await sql<{ count: number; outcome: string }>`SELECT count(*)::int AS count,min(outcome.status) AS outcome
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      WHERE command.school_id=${schoolId}::uuid AND command.idempotency_key=${`timetable-activity:${user.id}:${refusedPublication.idempotency_key}`}`.execute(db)).rows[0]!;
    expect(refused).toEqual({ count: 1, outcome: 'conflicted' });
    expect((await service.getPlan(user, schoolId, conflicting.id)).state).toBe('draft');
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_activity_occurrences WHERE plan_version_id=${conflicting.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    await expect(service.update(request(user), schoolId, draft.id, { ...payload, idempotency_key: randomUUID(), expected_revision: 2 })).rejects.toThrow('read-only');
    const trace = (await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND command_type LIKE 'timetable.activity.%' AND state='accepted'`.execute(db)).rows[0]!.count;
    expect(trace).toBe(3);
    const cancel = await service.cancel(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 2, reason: 'Revised operational arrangement' });
    expect(cancel.state).toBe('cancelled');
    expect((await service.getOccurrence(schoolId, first.id)).state).toBe('cancelled');
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM students WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
  }, 60000);

  it('requires an explicit recorder/reviewer, current revisions and institution authority', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const payload = { idempotency_key: randomUUID(), title: 'Workshop', purpose: 'training', timezone: 'Asia/Kolkata', starts_on: tomorrow,
      recurrence: 'once', starts_at: '09:00', ends_at: '10:00', person_ids: [participant], attendance_mode: 'roll_call' };
    const draft = await service.create(request(user), schoolId, payload);
    await expect(service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 })).rejects.toThrow('recorder and reviewer');
    await expect(service.update(request(user), schoolId, draft.id, { ...payload, idempotency_key: randomUUID(), expected_revision: 8 })).rejects.toThrow('target changed');
    const other = await fixture();
    await expect(service.getPlan(other.user, schoolId, draft.id)).rejects.toThrow('identity');
    await expect(service.create(request(user), schoolId, { ...payload, idempotency_key: randomUUID(), person_ids: [other.participant] })).rejects.toThrow('outside');
    await expect(service.listPlans(user, schoolId, { from: tomorrow, until: addDays(tomorrow, 35) })).rejects.toThrow();
    const catalogue = await service.catalogue(user, schoolId);
    expect(catalogue.people).toEqual(expect.arrayContaining([expect.objectContaining({ id: participant })]));
    expect(catalogue.recorders.map(candidate => candidate.id)).not.toContain(participant);
  });

  it('prepares a dated replacement and publishes atomically without changing the earlier plan or occurrence', async () => {
    const { schoolId, user, person, participant, tomorrow } = await fixture();
    const payload = { idempotency_key: randomUUID(), title: 'Evening work', purpose: 'duty', timezone: 'Asia/Kolkata', starts_on: tomorrow,
      recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: '18:00', ends_at: '20:00', person_ids: [participant], attendance_mode: 'roll_call',
      recorder_person_id: person, reviewer_person_id: person };
    const draft = await service.create(request(user), schoolId, payload);
    const original = await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const replacement = await service.revise(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 2,
      starts_on: addDays(tomorrow, 1), reason: 'Move evening work one hour later' });
    expect(replacement).toMatchObject({ state: 'draft', replaces_version_id: original.id });
    expect((await service.getPlan(user, schoolId, original.id)).superseded_on).toBeNull();
    const edited = await service.update(request(user), schoolId, replacement.id, { ...payload, idempotency_key: randomUUID(), expected_revision: 1,
      starts_on: addDays(tomorrow, 1), starts_at: '19:00', ends_at: '21:00' });
    await service.publish(request(user), schoolId, edited.id, { idempotency_key: randomUUID(), expected_revision: 2 });
    const source = await service.getPlan(user, schoolId, original.id);
    expect(source).toMatchObject({ starts_at: '18:00', ends_at: '20:00', revision: 2, superseded_on: addDays(tomorrow, 1) });
    const occurrences = await service.listOccurrences(user, schoolId, { from: tomorrow, until: addDays(tomorrow, 1) });
    expect(occurrences.items.filter(occurrence => occurrence.local_date === tomorrow)).toEqual([expect.objectContaining({ plan_version_id: original.id, state: 'expected' })]);
    expect(occurrences.items.filter(occurrence => occurrence.local_date !== tomorrow && occurrence.state === 'expected'))
      .toEqual([expect.objectContaining({ plan_version_id: edited.id, starts_at: `${addDays(tomorrow, 1)}T13:30:00.000Z` })]);
  }, 60000);

  it('uses the same person conflict engine against the existing academic effective timetable', async () => {
    const { schoolId, user, person, tomorrow } = await fixture();
    const setup = new ProgressiveSetupService(applicationDb, core, core, core);
    await setup.setupAttendance(user, schoolId, { group_name: 'Shared cohort', participant_names: ['Learner'],
      responsible: { kind: 'current_user', self_teaches: true, display_name: 'Unified Owner' },
      session: { starts_at: '09:00', ends_at: '10:00', weekdays: [1, 2, 3, 4, 5, 6, 7] } }, request(user));
    const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Staff training', purpose: 'training', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'once', starts_at: '09:30', ends_at: '10:30', person_ids: [person], attendance_mode: 'none' });
    await expect(service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 })).rejects.toThrow('conflicts');
    const existing = await service.listOccurrences(user, schoolId, { from: tomorrow, until: tomorrow });
    expect(existing.items.some(occurrence => occurrence.source === 'academic' && occurrence.participants.some(participant => participant.person_id === person))).toBe(true);
  });

  it('shows only personal published work to a participant and discloses no campus people catalogue', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const suffix = randomUUID();
    const account = await db.insertInto('users').values({ username: `participant-${suffix}`, email: `participant-${suffix}@example.test`, password_hash: 'isolated-test-only-hash',
      first_name: 'Participant', last_name: 'Account', role: 'staff' }).returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
    await db.insertInto('school_memberships').values({ user_id: account.id, school_id: schoolId, role: 'staff', is_active: true }).execute();
    const profile = await db.insertInto('staff_profiles').values({ school_id: schoolId, user_id: account.id, person_id: participant, staff_code: `P-${suffix.slice(0, 8)}`,
         staff_kind: 'non_teaching', designation: 'Campus participant',
      employment_type: 'unspecified', joined_on: null, status: 'active', created_by: user.id, updated_by: user.id }).returning('id').executeTakeFirstOrThrow();
    await db.transaction().execute(tx => core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: participant, user_id: account.id, actor_user_id: user.id,
      effective_from: new Date().toISOString(), effective_until: null, source_domain: 'staff_operations', source_record_id: profile.id, source_revision: 1, metadata: {} }));
    const member: AuthUser = { ...account, active_school_id: schoolId };
    const otherPerson = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name) VALUES(${schoolId}::uuid,'Another attendee') RETURNING id`.execute(db)).rows[0]!.id;
    const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Mixed workshop', purpose: 'training', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'once', starts_at: '10:00', ends_at: '11:00', person_ids: [participant, otherPerson], attendance_mode: 'none' });
    await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    expect(await service.catalogue(member, schoolId)).toMatchObject({ can_manage: false, people: [], recorders: [], groups: [] });
    const own = await service.listOccurrences(member, schoolId, { from: tomorrow, until: tomorrow });
    expect(own).toMatchObject({ total: 1, can_manage: false, timezone: 'Asia/Kolkata' });
    expect(own.items[0]!.participants.map(person => person.person_id)).toEqual([participant]);
    const pending=await service.revise(request(user),schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,1),reason:'A private draft moves this workshop to the following day.'});
    expect((await service.getPlan(user,schoolId,draft.id)).pending_revision_id).toBe(pending.id);
    expect(await service.getPlan(member,schoolId,draft.id)).toMatchObject({person_ids:[participant],group_ids:[],can_edit:false,
      can_plan_change:false,pending_revision_id:null,replacement_windows:[],replacement_window_count:0});
    await expect(service.getPlan(member,schoolId,pending.id)).rejects.toThrow('outside your current timetable');
    await expect(service.create(request(member), schoolId, { idempotency_key: randomUUID(), title: 'Not allowed', purpose: 'other', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'once', starts_at: '12:00', ends_at: '13:00', person_ids: [participant], attendance_mode: 'none' })).rejects.toThrow('assignment');
  });

  it('reserves a canonical place without fabricating people and supports truthful off-site/online context', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const campus = (await sql<{ id: string }>`INSERT INTO institution_campuses(school_id,name,code,created_by,updated_by)
      VALUES(${schoolId}::uuid,'Test site','RESERVATION',${user.id}::uuid,${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
    const space = (await sql<{ id: string }>`INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,created_by,updated_by)
      VALUES(${schoolId}::uuid,${campus}::uuid,'Shared room','SHARED','other',${user.id}::uuid,${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
    const input = { idempotency_key: randomUUID(), title: 'Room preparation', purpose: 'other', timezone: 'Asia/Kolkata', starts_on: tomorrow,
      recurrence: 'once', starts_at: '08:00', ends_at: '09:00', person_ids: [], space_id: space, attendance_mode: 'none', location_kind: 'on_campus' };
    const draft = await service.create(request(user), schoolId, input);
    await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const overlap = await service.create(request(user), schoolId, { ...input, idempotency_key: randomUUID(), title: 'Another room use' });
    await expect(service.publish(request(user), schoolId, overlap.id, { idempotency_key: randomUUID(), expected_revision: 1 })).rejects.toThrow('Shared room');
    const online = await service.create(request(user), schoolId, { ...input, idempotency_key: randomUUID(), title: 'Remote training', person_ids: [participant],
      space_id: null, location_kind: 'online', location_url: 'https://example.invalid/meeting', starts_at: '10:00', ends_at: '11:00' });
    await service.publish(request(user), schoolId, online.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const all = await service.listOccurrences(user, schoolId, { from: tomorrow, until: tomorrow });
    expect(all.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Room preparation', participants: [], attendance_mode: 'none' }),
      expect.objectContaining({ title: 'Remote training', space_id: null, location_kind: 'online', location_url: 'https://example.invalid/meeting' }),
    ]));
    await expect(service.create(request(user), schoolId, { ...input, idempotency_key: randomUUID(), space_id: null, person_ids: [participant],
      location_kind: 'off_site', location_label: '' })).rejects.toThrow('off-site');
  });

  it('does not erase an ongoing overnight occurrence when a dated change starts the following day', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const input = { idempotency_key: randomUUID(), title: 'Night work', purpose: 'duty', timezone: 'Asia/Kolkata', starts_on: tomorrow,
      recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: '22:00', ends_at: '06:00', end_day_offset: 1, person_ids: [participant], attendance_mode: 'none' };
    const draft = await service.create(request(user), schoolId, input);
    await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const revision = await service.revise(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 2,
      starts_on: addDays(tomorrow, 1), reason: 'Change night work to daytime' });
    const bad = await service.update(request(user), schoolId, revision.id, { ...input, idempotency_key: randomUUID(), expected_revision: 1,
      starts_on: addDays(tomorrow, 1), starts_at: '02:00', ends_at: '03:00', end_day_offset: 0 });
    await expect(service.publish(request(user), schoolId, bad.id, { idempotency_key: randomUUID(), expected_revision: 2 })).rejects.toThrow('conflicts');
    const corrected = await service.update(request(user), schoolId, revision.id, { ...input, idempotency_key: randomUUID(), expected_revision: 2,
      starts_on: addDays(tomorrow, 1), starts_at: '09:00', ends_at: '17:00', end_day_offset: 0 });
    await service.publish(request(user), schoolId, corrected.id, { idempotency_key: randomUUID(), expected_revision: 3 });
    const occurrences = await service.listOccurrences(user, schoolId, { from: tomorrow, until: addDays(tomorrow, 1) });
    expect(occurrences.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ plan_version_id: draft.id, local_date: tomorrow, state: 'expected', ends_at: `${addDays(tomorrow, 1)}T00:30:00.000Z` }),
      expect.objectContaining({ plan_version_id: draft.id, local_date: addDays(tomorrow, 1), state: 'cancelled' }),
      expect.objectContaining({ plan_version_id: corrected.id, local_date: addDays(tomorrow, 1), state: 'expected' }),
    ]));
  }, 60000);

  it.each([-2,2])('moves a future one-off by%s days, cancels its original key and preserves the publication basis',async(offset)=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const originalDate=addDays(tomorrow,500),newDate=addDays(originalDate,offset);
    const input={idempotency_key:randomUUID(),title:'Movable one-off training',purpose:'training',timezone:'Asia/Kolkata',starts_on:originalDate,
      recurrence:'once',starts_at:'09:00',ends_at:'10:00',person_ids:[participant],attendance_mode:'none'};
    const original=await service.create(request(user),schoolId,input);
    await service.publish(request(user),schoolId,original.id,{idempotency_key:randomUUID(),expected_revision:1});
    const before=(await service.listOccurrences(user,schoolId,{from:originalDate,until:originalDate})).items[0]!;
    const basis=(await sql<{basis:string}>`SELECT projected.basis_event_id AS basis FROM campus_model_schedule_occurrences projected
      JOIN campus_model_entities occurrence ON occurrence.id=projected.period_entity_id
      WHERE projected.school_id=${schoolId}::uuid AND occurrence.domain='timetable' AND occurrence.domain_id=${before.id}
        AND projected.recorded_until IS NULL`.execute(db)).rows[0]!.basis;
    const copy=await service.revise(request(user),schoolId,original.id,{idempotency_key:randomUUID(),expected_revision:2,starts_on:newDate,
      reason:'Move the single activity to a more suitable date.'});
    expect(copy).toMatchObject({starts_on:newDate,ends_on:newDate,state:'draft'});
    await service.publish(request(user),schoolId,copy.id,{idempotency_key:randomUUID(),expected_revision:1});
    const old=await service.getOccurrence(schoolId,before.id);
    expect(old).toMatchObject({local_date:originalDate,state:'cancelled'});
    expect(await service.listOccurrences(user,schoolId,{from:originalDate,until:originalDate,state:'expected'}))
      .toMatchObject({items:[],total:0,total_pages:0});
    expect(await service.listOccurrences(user,schoolId,{from:originalDate,until:originalDate,state:'cancelled'}))
      .toMatchObject({items:[expect.objectContaining({id:before.id,state:'cancelled'})],total:1,total_pages:1});
    expect(await service.listOccurrences(user,schoolId,{from:newDate,until:newDate,state:'expected'}))
      .toMatchObject({items:[expect.objectContaining({plan_version_id:copy.id,state:'expected'})],total:1,total_pages:1});
    expect((await service.listOccurrences(user,schoolId,{from:newDate,until:newDate})).items).toEqual(expect.arrayContaining([
      expect.objectContaining({plan_version_id:copy.id,local_date:newDate,state:'expected'}),
    ]));
    const current=(await sql<{state:string;basis:string;change:string}>`SELECT projected.state,projected.basis_event_id AS basis,projected.change_event_id AS change
      FROM campus_model_schedule_occurrences projected JOIN campus_model_entities occurrence ON occurrence.id=projected.period_entity_id
      WHERE projected.school_id=${schoolId}::uuid AND occurrence.domain='timetable' AND occurrence.domain_id=${before.id}
        AND projected.recorded_until IS NULL`.execute(db)).rows[0]!;
    expect(current.state).toBe('cancelled');expect(current.basis).toBe(basis);expect(current.change).not.toBe(basis);
    expect(await service.ensureOccurrences(schoolId,addDays(originalDate,10),addDays(originalDate,20))).toEqual([]);
    expect((await service.listOccurrences(user,schoolId,{from:originalDate,until:originalDate})).items.filter(item=>item.state==='expected')).toEqual([]);
  },60000);

  it('rechecks a pending one-off move at publication and never erases an activity that has already started overnight',async()=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const input={idempotency_key:randomUUID(),title:'One-off overnight work',purpose:'duty',timezone:'Asia/Kolkata',starts_on:tomorrow,
      recurrence:'once',starts_at:'22:00',ends_at:'06:00',end_day_offset:1,person_ids:[participant],attendance_mode:'none'};
    const original=await service.create(request(user),schoolId,input);
    await service.publish(request(user),schoolId,original.id,{idempotency_key:randomUUID(),expected_revision:1});
    const copy=await service.revise(request(user),schoolId,original.id,{idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,1),reason:'Prepare a different day before the activity starts.'});
    const clock=new Date(`${tomorrow}T18:30:00Z`); // Local midnight, while the original22:00–06:00 is in progress.
    const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>clock,nowIso:()=>clock.toISOString()}});
    await expect(executionEnvironmentStorage.run(environment,()=>service.publish(request(user),schoolId,copy.id,
      {idempotency_key:randomUUID(),expected_revision:1}))).rejects.toThrow('already started');
    const originalOccurrence=(await service.listOccurrences(user,schoolId,{from:tomorrow,until:tomorrow})).items.find(item=>item.plan_version_id===original.id)!;
    expect(originalOccurrence.state).toBe('expected');
    expect((await service.getPlan(user,schoolId,copy.id)).state).toBe('draft');
  },60000);

  it('publishes disjoint temporary windows on a resumed recurring base without overlapping or erasing earlier lineage',async()=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const input={idempotency_key:randomUUID(),title:'Resumable recurring duty',purpose:'duty',timezone:'Asia/Kolkata',starts_on:tomorrow,
      recurrence:'weekly',weekdays:[1,2,3,4,5,6,7],starts_at:'11:00',ends_at:'12:00',person_ids:[participant],attendance_mode:'none'};
    const base=await service.create(request(user),schoolId,input);
    await service.publish(request(user),schoolId,base.id,{idempotency_key:randomUUID(),expected_revision:1});
    const original=(await service.listOccurrences(user,schoolId,{from:addDays(tomorrow,6),until:addDays(tomorrow,6)})).items[0]!;
    const basis=(await sql<{basis:string}>`SELECT occurrence.basis_event_id AS basis FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_entities entity ON entity.id=occurrence.period_entity_id WHERE occurrence.school_id=${schoolId}::uuid
        AND entity.domain='timetable' AND entity.domain_id=${original.id} AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!.basis;
    const change=async(from:number,until:number|null,title:string)=>{
      const copy=await service.revise(request(user),schoolId,base.id,{idempotency_key:randomUUID(),expected_revision:2,
        starts_on:addDays(tomorrow,from),reason:`Reviewed ${title} period.`});
      const saved=await service.update(request(user),schoolId,copy.id,{...input,idempotency_key:randomUUID(),expected_revision:1,
        title,starts_on:addDays(tomorrow,from),ends_on:until===null?null:addDays(tomorrow,until),starts_at:'12:00',ends_at:'13:00'});
      return service.publish(request(user),schoolId,saved.id,{idempotency_key:randomUUID(),expected_revision:2});
    };
    const first=await change(2,4,'First temporary duty');
    const firstLineage=(await sql<{id:string;previous_source_revision:number}>`SELECT id,previous_source_revision FROM schedule_plan_supersessions
      WHERE school_id=${schoolId}::uuid AND replacement_version_id=${first.id}::uuid`.execute(db)).rows[0]!;
    expect(await service.getPlan(user,schoolId,base.id)).toMatchObject({superseded_on:null,can_plan_change:true,replacement_window_count:1,
      replacement_windows:[{replacement_plan_id:first.id,from:addDays(tomorrow,2),until:addDays(tomorrow,5)}]});
    const permanent=await change(10,null,'Future continuing duty');
    expect(await service.getPlan(user,schoolId,base.id)).toMatchObject({superseded_on:addDays(tomorrow,10),can_plan_change:true,replacement_window_count:2});
    const second=await change(6,8,'Second temporary duty');
    // Preparation from an already covered date points to its actual reviewed
    // replacement; it must not create a parallel writer for the same window.
    await expect(service.revise(request(user),schoolId,base.id,{idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,3),reason:'Do not overlap the accepted first change.'})).rejects.toMatchObject({response:expect.objectContaining({replacement_plan_id:first.id})});
    const overlap=await service.revise(request(user),schoolId,base.id,{idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,5),reason:'A candidate change needs a bounded window.'});
    expect((await service.getPlan(user,schoolId,base.id)).pending_revision_id).toBe(overlap.id);
    const overlapping=await service.update(request(user),schoolId,overlap.id,{...input,idempotency_key:randomUUID(),expected_revision:1,
      starts_on:addDays(tomorrow,5),ends_on:addDays(tomorrow,6),starts_at:'13:00',ends_at:'14:00'});
    const refused={idempotency_key:randomUUID(),expected_revision:2};
    await expect(service.publish(request(user),schoolId,overlapping.id,refused)).rejects.toMatchObject({response:expect.objectContaining({replacement_plan_id:second.id})});
    await expect(service.publish(request(user),schoolId,overlapping.id,refused)).rejects.toThrow('reviewed change');
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_plan_supersessions WHERE previous_version_id=${base.id}::uuid`.execute(db)).rows[0]!.count).toBe(3);
    const corrected=await service.update(request(user),schoolId,overlap.id,{...input,idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,5),ends_on:addDays(tomorrow,5),starts_at:'13:00',ends_at:'14:00'});
    await service.publish(request(user),schoolId,corrected.id,{idempotency_key:randomUUID(),expected_revision:3});
    expect((await sql<{id:string;previous_source_revision:number}>`SELECT id,previous_source_revision FROM schedule_plan_supersessions
      WHERE school_id=${schoolId}::uuid AND replacement_version_id=${first.id}::uuid`.execute(db)).rows[0]).toEqual(firstLineage);
    await expect(sql`UPDATE schedule_plan_supersessions SET reason='Rewrite retained source' WHERE id=${firstLineage.id}::uuid`.execute(db)).rejects.toThrow('immutable');
    await expect(sql`INSERT INTO schedule_plan_supersessions(school_id,previous_version_id,replacement_version_id,previous_source_revision,
      replacement_source_revision,effective_from,effective_until,reason,actor_id)
      SELECT school_id,previous_version_id,replacement_version_id,previous_source_revision,replacement_source_revision,effective_from,
        effective_until,'Duplicate overlapping source window',actor_id FROM schedule_plan_supersessions WHERE id=${firstLineage.id}::uuid`.execute(db)).rejects.toThrow('cannot overlap');
    const days=await service.listOccurrences(user,schoolId,{from:tomorrow,until:addDays(tomorrow,12)});
    const expectedAt=(offset:number)=>days.items.filter(item=>item.local_date===addDays(tomorrow,offset)&&item.state==='expected').map(item=>item.plan_version_id);
    expect(expectedAt(0)).toEqual([base.id]);expect(expectedAt(3)).toEqual([first.id]);expect(expectedAt(5)).toEqual([corrected.id]);
    expect(expectedAt(7)).toEqual([second.id]);expect(expectedAt(9)).toEqual([base.id]);expect(expectedAt(11)).toEqual([permanent.id]);
    const lineage=(await sql<{state:string;basis:string}>`SELECT occurrence.state,occurrence.basis_event_id AS basis
      FROM campus_model_schedule_occurrences occurrence JOIN campus_model_entities entity ON entity.id=occurrence.period_entity_id
      WHERE occurrence.school_id=${schoolId}::uuid AND entity.domain='timetable' AND entity.domain_id=${original.id}
        AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!;
    expect(lineage).toEqual({state:'cancelled',basis});
    const clock=new Date(`${addDays(tomorrow,10)}T00:00:00+05:30`);
    const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>clock,nowIso:()=>clock.toISOString()}});
    expect(await executionEnvironmentStorage.run(environment,()=>service.getPlan(user,schoolId,base.id))).toMatchObject({can_plan_change:false});
    await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',schoolId).where('user_id','=',user.id).execute();
    await expect(service.revise(request(user),schoolId,base.id,{idempotency_key:randomUUID(),expected_revision:2,
      starts_on:addDays(tomorrow,1),reason:'Revoked manager must not prepare another change.'})).rejects.toThrow('assignment');
  },60000);

  it('extends an indefinite published plan beyond a year from frozen membership without impersonating its inactive publisher', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const group = (await sql<{ id: string }>`INSERT INTO participation_groups(school_id,name,created_by)
      VALUES(${schoolId}::uuid,'Mixed recurring group',${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
      VALUES(${schoolId}::uuid,${group}::uuid,${participant}::uuid,${tomorrow}::date,${user.id}::uuid)`.execute(db);
    const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Continuous training', purpose: 'training', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: '11:00', ends_at: '12:00', group_ids: [`group:${group}`], attendance_mode: 'none' });
    await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const publication = (await sql<{ basis_event_id: string }>`SELECT basis_event_id FROM schedule_plan_publication_evidence WHERE version_id=${draft.id}::uuid`.execute(db)).rows[0]!;
    const laterPerson = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name) VALUES(${schoolId}::uuid,'Later added member') RETURNING id`.execute(db)).rows[0]!.id;
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
      VALUES(${schoolId}::uuid,${group}::uuid,${laterPerson}::uuid,${tomorrow}::date,${user.id}::uuid)`.execute(db);
    await sql`UPDATE school_people SET first_name='Changed after publication',revision=revision+1 WHERE id=${participant}::uuid`.execute(db);
    await db.updateTable('users').set({ is_active: false }).where('id', '=', user.id).execute();
    const future = addDays(tomorrow, 500);
    const extension = vi.spyOn(core, 'extendPlanOccurrences');
    const extended = await service.ensureOccurrences(schoolId, future, future);
    const sourceExtension = extension.mock.calls[0]![1];
    extension.mockRestore();
    expect(extended).toHaveLength(1);
    expect(extended[0]!.participants).toEqual([expect.objectContaining({ person_id: participant, label: 'No-account Participant' })]);
    const event = (await sql<{ id: string; actor_agent_id: string | null; causation_event_id: string }>`SELECT id,actor_agent_id,causation_event_id
      FROM campus_model_events WHERE school_id=${schoolId}::uuid AND event_type='timetable.occurrences_materialized'
        AND source_record_id=${draft.id} ORDER BY recorded_at DESC LIMIT 1`.execute(db)).rows[0]!;
    expect(event.actor_agent_id).toBeNull();
    expect(event.causation_event_id).toBe(publication.basis_event_id);
    const expected = (await sql<{ basis_event_id: string }>`SELECT occurrence.basis_event_id FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_entities entity ON entity.id=occurrence.period_entity_id
      WHERE occurrence.school_id=${schoolId}::uuid AND entity.domain='timetable' AND entity.domain_id=${extended[0]!.id} AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!;
    expect(expected.basis_event_id).toBe(publication.basis_event_id);
    expect(await service.ensureOccurrences(schoolId, future, future)).toEqual(extended);
    await expect(db.transaction().execute(tx => core.extendPlanOccurrences(tx, { ...sourceExtension,
      occurrences: [{ ...sourceExtension.occurrences[0]!, ends_at: new Date(Date.parse(sourceExtension.occurrences[0]!.ends_at) + 60000).toISOString() }] })))
      .rejects.toThrow();
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_events WHERE school_id=${schoolId}::uuid
      AND event_type='timetable.occurrences_materialized' AND source_record_id=${draft.id}`.execute(db)).rows[0]!.count).toBe(1);
  }, 60000);

  it('routes the original academic editor through the gateway and the shared cross-purpose conflict engine', async () => {
    const { schoolId, user, person, tomorrow } = await fixture();
    const setup = new ProgressiveSetupService(applicationDb, core, core, core);
    const accepted = await setup.setupAttendance(user, schoolId, { group_name: 'Legacy flow', participant_names: ['Learner'],
      responsible: { kind: 'current_user', self_teaches: true, display_name: 'Unified Owner' },
      session: { starts_at: '09:00', ends_at: '10:00', weekdays: [1, 2, 3, 4, 5, 6, 7] } }, request(user));
    const events = new SchoolEventService(applicationDb, core);
    const coverage = createStaffCoverageReconciliationTestDouble();
    const academic = new SchedulePlanningService(applicationDb, events, new SchoolService(applicationDb, events, coverage), coverage, core, core, service);
    const duty = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Coordinator duty', purpose: 'duty', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'once', starts_at: '11:00', ends_at: '12:00', person_ids: [person], attendance_mode: 'none' });
    await service.publish(request(user), schoolId, duty.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const common = { school_id: schoolId, term_id: accepted.resources.term_id, class_section_id: accepted.resources.class_section_id,
      starts_on: tomorrow, ends_on: addDays(tomorrow, 6) };
    const draft = await academic.start(request(user), { ...common, idempotency_key: randomUUID() });
    const original = (await sql<{ id: string; weekday: number; period_number: number; starts_at: string; ends_at: string; subject_id: string | null; teacher_user_id: string | null; title: string; slot_type: 'class' | 'activity' | 'break'; room: string }>`
      SELECT id,weekday,period_number,starts_at::text,ends_at::text,subject_id,teacher_user_id,title,slot_type,room FROM schedule_periods WHERE version_id=${draft.id}::uuid`.execute(db)).rows;
    const extra = { id: randomUUID(), weekday: new Date(`${tomorrow}T12:00:00Z`).getUTCDay() || 7, period_number: 2, starts_at: '11:00', ends_at: '11:45',
      subject_id: null, teacher_user_id: user.id, title: 'Academic activity', slot_type: 'activity' as const, room: '' };
    await academic.save(request(user), draft.id, { school_id: schoolId, idempotency_key: randomUUID(), expected_revision: 1,
      starts_on: common.starts_on, ends_on: common.ends_on, periods: [...original, extra] });
    await expect(academic.publish(request(user), draft.id, { school_id: schoolId, idempotency_key: randomUUID(), expected_revision: 2 })).rejects.toThrow('conflicts');
    await academic.save(request(user), draft.id, { school_id: schoolId, idempotency_key: randomUUID(), expected_revision: 2,
      starts_on: common.starts_on, ends_on: common.ends_on, periods: [...original, { ...extra, starts_at: '12:00', ends_at: '12:45' }] });
    await academic.publish(request(user), draft.id, { school_id: schoolId, idempotency_key: randomUUID(), expected_revision: 3 });
    const gateway = (await sql<{ count: number; linked: boolean }>`SELECT count(*)::int AS count,bool_and(outcome.domain_event_id IS NOT NULL) AS linked
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      WHERE command.school_id=${schoolId}::uuid AND command.handler_key='schedule_planning.academic' AND command.state='accepted'`.execute(db)).rows[0]!;
    expect(gateway).toMatchObject({ count: 4, linked: true });
  }, 60000);

  it('uses finite stable pages for planning history without hiding the total', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    for (let index = 0; index < 26; index += 1) await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: `Draft ${index + 1}`,
      purpose: 'other', timezone: 'Asia/Kolkata', starts_on: tomorrow, recurrence: 'once', starts_at: '15:00', ends_at: '16:00', person_ids: [participant], attendance_mode: 'none' });
    const first = await service.listPlans(user, schoolId, { from: tomorrow, until: tomorrow, page: 1 });
    const second = await service.listPlans(user, schoolId, { from: tomorrow, until: tomorrow, page: 2 });
    expect(first).toMatchObject({ page: 1, page_size: 25, total: 26, total_pages: 2 });
    expect(second).toMatchObject({ page: 2, page_size: 25, total: 26, total_pages: 2 });
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(plan => plan.id)).size).toBe(26);
  });

  it('filters retained cancelled occurrences before calendar totals and stable page boundaries', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const until = addDays(tomorrow, 27);
    const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Daily planned work', purpose: 'duty',
      timezone: 'Asia/Kolkata', starts_on: tomorrow, ends_on: until, recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7],
      starts_at: '11:00', ends_at: '12:00', person_ids: [participant], attendance_mode: 'none' });
    await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const clock = new Date(`${addDays(tomorrow, 1)}T00:00:00+05:30`);
    const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => clock, nowIso: () => clock.toISOString() } });
    await executionEnvironmentStorage.run(environment, () => service.cancel(request(user), schoolId, draft.id,
      { idempotency_key: randomUUID(), expected_revision: 2, reason: 'Keep the first completed day; cancel the remaining future work.' }));
    const range = { from: tomorrow, until };
    const expected = await service.listOccurrences(user, schoolId, { ...range, state: 'expected' });
    expect(expected).toMatchObject({ page: 1, page_size: 25, total: 1, total_pages: 1 });
    expect(expected.items).toEqual([expect.objectContaining({ local_date: tomorrow, state: 'expected' })]);
    expect(await service.listOccurrences(user, schoolId, { ...range, state: 'expected', page: 2 }))
      .toMatchObject({ items: [], total: 1, total_pages: 1 });
    const cancelledFirst = await service.listOccurrences(user, schoolId, { ...range, state: 'cancelled' });
    const cancelledSecond = await service.listOccurrences(user, schoolId, { ...range, state: 'cancelled', page: 2 });
    expect(cancelledFirst).toMatchObject({ total: 27, total_pages: 2 });
    expect(cancelledFirst.items).toHaveLength(25);
    expect(cancelledSecond.items).toHaveLength(2);
    expect(new Set([...cancelledFirst.items, ...cancelledSecond.items].map(item => item.id)).size).toBe(27);
    expect(await service.listOccurrences(user, schoolId, range)).toMatchObject({ total: 28, total_pages: 2 });
  }, 60000);

  it('distinguishes next activities in different weeks with source dates, campus time and singular participant wording', async () => {
    const { schoolId, user, person, participant, tomorrow } = await fixture();
    const nextWeek = addDays(tomorrow, 7);
    for (const [date, people] of [[tomorrow, [participant]], [nextWeek, [participant, person]]] as const) {
      const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Overnight duty', purpose: 'duty',
        timezone: 'Asia/Kolkata', starts_on: date, recurrence: 'once', starts_at: '22:00', ends_at: '06:00', end_day_offset: 1,
        person_ids: people, attendance_mode: 'none' });
      await service.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    }
    const snapshot: WorkspaceRepositorySnapshot = { institution: { id: schoolId, name: 'Test campus', timezone: 'Asia/Kolkata' },
      membership_roles: ['admin'], realm_id: 'unused-by-presentation', environment_namespace_id: `live:${schoolId}`,
      acting_agent_id: null, owner_agent_ids: [], assignments: [], messages: [], relationships: [] };
    const attendance = { ensureRegister: vi.fn(), pendingActivityReviews: vi.fn().mockResolvedValue([]) };
    const projection = new ActivityWorkspaceProjection(applicationDb, service, attendance as unknown as ActivityAttendanceService, core);
    const at = new Date(`${tomorrow}T00:00:00+05:30`);
    const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => at, nowIso: () => at.toISOString() } });
    const result = await executionEnvironmentStorage.run(environment, () => projection.load(user, snapshot, at, tomorrow));
    const formatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    expect(result.now).toEqual([]);
    expect(result.next.map(item => item.time_label)).toEqual([tomorrow, nextWeek].map(date => formatter.format(new Date(`${date}T22:00:00+05:30`))));
    expect(new Set(result.next.map(item => item.time_label)).size).toBe(2);
    expect(result.next.map(item => item.detail)).toEqual(['Scheduled activity · 1 scheduled person', 'Scheduled activity · 2 scheduled people']);
    expect(result.next.map(item => item.href)).toEqual([tomorrow, nextWeek].map(date => `/areas/timetable/schedule?date=${date}`));
    expect(result.next.map(item => item.status_label)).toEqual(['Next', 'Next']);
    expect(attendance.ensureRegister).not.toHaveBeenCalled();
  }, 60000);

  it('checks a known conflict after the bounded occurrence horizon of an indefinite plan', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const future = addDays(tomorrow, 500);
    const scheduled = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Future assessment duty', purpose: 'duty', timezone: 'Asia/Kolkata',
      starts_on: future, recurrence: 'once', starts_at: '11:00', ends_at: '12:00', person_ids: [participant], attendance_mode: 'none' });
    await service.publish(request(user), schoolId, scheduled.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const indefinite = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Weekly work', purpose: 'duty', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: '11:30', ends_at: '12:30', person_ids: [participant], attendance_mode: 'none' });
    await expect(service.publish(request(user), schoolId, indefinite.id, { idempotency_key: randomUUID(), expected_revision: 1 })).rejects.toThrow('Future assessment duty');
    expect((await service.getPlan(user, schoolId, indefinite.id)).state).toBe('draft');
  });

  it('checks a full weekly cycle when a frozen group member joins beyond the persisted month',async()=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const laterPerson=(await sql<{id:string}>`INSERT INTO school_people(school_id,first_name) VALUES(${schoolId}::uuid,'Future group member') RETURNING id`.execute(db)).rows[0]!.id;
    const future=addDays(tomorrow,500),target=addDays(future,3),weekday=new Date(`${target}T12:00:00Z`).getUTCDay()||7;
    const occupied=await service.create(request(user),schoolId,{idempotency_key:randomUUID(),title:'Existing weekly commitment',purpose:'duty',timezone:'Asia/Kolkata',
      starts_on:tomorrow,recurrence:'weekly',weekdays:[weekday],starts_at:'11:00',ends_at:'12:00',person_ids:[laterPerson],attendance_mode:'none'});
    await service.publish(request(user),schoolId,occupied.id,{idempotency_key:randomUUID(),expected_revision:1});
    const group=(await sql<{id:string}>`INSERT INTO participation_groups(school_id,name,created_by) VALUES(${schoolId}::uuid,'Dated mixed group',${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
      VALUES(${schoolId}::uuid,${group}::uuid,${participant}::uuid,${tomorrow}::date,${user.id}::uuid),
        (${schoolId}::uuid,${group}::uuid,${laterPerson}::uuid,${future}::date,${user.id}::uuid)`.execute(db);
    const changing=await service.create(request(user),schoolId,{idempotency_key:randomUUID(),title:'Future roster conflict',purpose:'training',timezone:'Asia/Kolkata',
      starts_on:tomorrow,recurrence:'weekly',weekdays:[weekday],starts_at:'11:30',ends_at:'12:30',group_ids:[`group:${group}`],attendance_mode:'none'});
    await expect(service.publish(request(user),schoolId,changing.id,{idempotency_key:randomUUID(),expected_revision:1})).rejects.toThrow('conflicts');
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_plan_publication_evidence WHERE version_id=${changing.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
  },60000);

  it('cancels all retained future expectations including an independently extended occurrence500 days away',async()=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const draft=await service.create(request(user),schoolId,{idempotency_key:randomUUID(),title:'Long-running plan',purpose:'duty',timezone:'Asia/Kolkata',
      starts_on:tomorrow,recurrence:'weekly',weekdays:[1,2,3,4,5,6,7],starts_at:'11:00',ends_at:'12:00',person_ids:[participant],attendance_mode:'none'});
    await service.publish(request(user),schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
    const far=(await service.ensureOccurrences(schoolId,addDays(tomorrow,500),addDays(tomorrow,500)))[0]!;
    await service.cancel(request(user),schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:2,reason:'Cancel all future duties without deleting lineage.'});
    const projected=(await sql<{state:string;basis_event_id:string;change_event_id:string}>`SELECT occurrence.state,occurrence.basis_event_id,occurrence.change_event_id
      FROM campus_model_schedule_occurrences occurrence JOIN campus_model_entities entity ON entity.id=occurrence.period_entity_id
      WHERE occurrence.school_id=${schoolId}::uuid AND entity.domain='timetable' AND entity.domain_id=${far.id} AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!;
    expect(projected.state).toBe('cancelled');
    expect(projected.basis_event_id).not.toBe(projected.change_event_id);
    expect((await service.getOccurrence(schoolId,far.id)).state).toBe('cancelled');
    const retainedBefore=(await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_activity_occurrences WHERE plan_version_id=${draft.id}::uuid`.execute(db)).rows[0]!.count;
    expect(await service.ensureOccurrences(schoolId,addDays(tomorrow,501),addDays(tomorrow,507))).toEqual([]);
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_activity_occurrences WHERE plan_version_id=${draft.id}::uuid`.execute(db)).rows[0]!.count).toBe(retainedBefore);
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_entities entity ON entity.id=occurrence.schedule_entity_id WHERE occurrence.school_id=${schoolId}::uuid
      AND entity.domain='timetable' AND entity.domain_id=${draft.id} AND occurrence.state='expected' AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!.count).toBe(0);
  },60000);

  it('supersedes a retained far-future expectation without erasing its original publication basis',async()=>{
    const {schoolId,user,participant,tomorrow}=await fixture();
    const draft=await service.create(request(user),schoolId,{idempotency_key:randomUUID(),title:'Original continuous work',purpose:'duty',timezone:'Asia/Kolkata',
      starts_on:tomorrow,recurrence:'weekly',weekdays:[1,2,3,4,5,6,7],starts_at:'11:00',ends_at:'12:00',person_ids:[participant],attendance_mode:'none'});
    await service.publish(request(user),schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
    const far=(await service.ensureOccurrences(schoolId,addDays(tomorrow,500),addDays(tomorrow,500)))[0]!;
    const revision=await service.revise(request(user),schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:2,starts_on:addDays(tomorrow,1),reason:'Continue under a reviewed future plan version.'});
    await service.publish(request(user),schoolId,revision.id,{idempotency_key:randomUUID(),expected_revision:1});
    const projected=(await sql<{state:string;basis_event_id:string;change_event_id:string}>`SELECT occurrence.state,occurrence.basis_event_id,occurrence.change_event_id
      FROM campus_model_schedule_occurrences occurrence JOIN campus_model_entities entity ON entity.id=occurrence.period_entity_id
      WHERE occurrence.school_id=${schoolId}::uuid AND entity.domain='timetable' AND entity.domain_id=${far.id} AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!;
    expect(projected.state).toBe('cancelled');
    expect(projected.basis_event_id).not.toBe(projected.change_event_id);
    const next=await service.ensureOccurrences(schoolId,addDays(tomorrow,500),addDays(tomorrow,500));
    expect(next).toEqual(expect.arrayContaining([expect.objectContaining({plan_version_id:draft.id,state:'cancelled'}),expect.objectContaining({plan_version_id:revision.id,state:'expected'})]));
  },60000);

  it('rolls back an unexpected projection failure and recovers safely on the same publication key', async () => {
    const { schoolId, user, participant, tomorrow } = await fixture();
    const draft = await service.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'Recoverable workshop', purpose: 'training', timezone: 'Asia/Kolkata',
      starts_on: tomorrow, recurrence: 'once', starts_at: '12:00', ends_at: '13:00', person_ids: [participant], attendance_mode: 'none' });
    const publishInput = { idempotency_key: randomUUID(), expected_revision: 1 };
    const projection = vi.spyOn(core, 'recordPlanOccurrences').mockRejectedValueOnce(new Error('Projection temporarily unavailable'));
    await expect(service.publish(request(user), schoolId, draft.id, publishInput)).rejects.toThrow('Projection temporarily unavailable');
    projection.mockRestore();
    expect(await service.getPlan(user, schoolId, draft.id)).toMatchObject({ state: 'draft', revision: 1 });
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_plan_publication_evidence WHERE version_id=${draft.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_activity_occurrences WHERE plan_version_id=${draft.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    expect(await service.publish(request(user), schoolId, draft.id, publishInput)).toMatchObject({ state: 'published', revision: 2 });
  });
});
