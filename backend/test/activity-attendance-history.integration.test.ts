import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ActivityPlanningService } from '../src/schedule-planning/activity-planning.service.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { ProgressiveSetupService } from '../src/institution-activation/progressive-setup.service.js';
import { AcademicParticipationBridge } from '../src/attendance/academic-participation-bridge.service.js';
import { AcademicParticipationEffects } from '../src/attendance/academic-participation-effects.service.js';
import { AttendanceModelService } from '../src/attendance-model/attendance-model.service.js';
import { SchoolService } from '../src/school/school.service.js';
import type { StaffCoverageReconciliationPort } from '../src/staff-operations/staff-coverage-reconciliation.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused_test';
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) });
const applicationDb = db as DatabaseService;
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { 'idempotency-key': randomUUID() } }) as unknown as AuthenticatedRequest;
afterAll(() => db.destroy());

function services(database: Kysely<Database>) {
  const connection = database as DatabaseService, scope = new ExecutionDataPlaneScope(), core = new CampusModelCoreService(connection, scope);
  return { core, attendance: new ActivityAttendanceService(connection, core, core, core, core, core),
    planning: new ActivityPlanningService(connection, new SchoolEventService(connection, core), core, core, core, new ResponsibilityProjectionService(core, scope)) };
}

async function fixture(automatic = false, personCount = 1) {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto('users').values({ username: `history-${suffix}`, email: `history-${suffix}@example.test`,
    password_hash: 'isolated-test-only', first_name: '', last_name: '', role: 'admin' })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, 'UTC'));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let now = new Date(`${day}T09:30:00.000Z`);
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  return run(async () => {
    const owner = await db.transaction().execute(tx => context.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: now.toISOString() }));
    if (!owner.acting) throw new Error('An explicit acting founder is required by the fixture.');
    const people = await db.insertInto('school_people').values(Array.from({ length: personCount }, (_, index) =>
      ({ school_id: schoolId, first_name: personCount === 1 ? 'Passive attendee' : `Attendee ${index + 1}`, last_name: '' }))).returning('id').execute();
    const person = people[0]!;
    if (automatic) await sql`INSERT INTO institution_operating_rules(school_id,updated_by,attendance_finalization_mode,attendance_auto_finalize_minutes,updated_at)
      VALUES(${schoolId}::uuid,${user.id}::uuid,'automatic',1,${now})`.execute(db);
    const plan = await context.planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title: 'History attribution', purpose: 'training',
      timezone: 'UTC', starts_on: day, recurrence: 'once', starts_at: '09:00', ends_at: '10:00', person_ids: people.map(person => person.id), attendance_mode: 'roll_call',
      recorder_person_id: owner.person_id, reviewer_person_id: owner.person_id });
    await context.planning.publish(request(user), schoolId, plan.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const occurrence = (await context.planning.ensureOccurrences(schoolId, day, day)).find(item => item.plan_version_id === plan.id)!;
    const registerId = await context.attendance.ensureRegister(schoolId, occurrence.id);
    await context.attendance.submitRecords(user, schoolId, registerId, { expected_revision: 0, records: people.map(person => ({ person_id: person.id, status: 'present' as const })) }, request(user));
    return { ...context, user, schoolId, personId: person.id, registerId, day, run, now: () => now.toISOString(), setNow: (value: string) => { now = new Date(value); } };
  });
}

describe.runIf(enabled)('attendance history distinguishes recorded human, software and unknown attribution', () => {
  it('pages whole command batches before their evidence and never groups two same-time requests or unproven imports together', async () => {
    const f = await fixture(false, 25);
    await f.run(async () => {
      const original = await sql`SELECT * FROM activity_attendance_entry_revisions WHERE register_id=${f.registerId}::uuid ORDER BY id`.execute(db);
      const initial = await f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities', page_size: 1 });
      expect(initial).toMatchObject({ total: 1, total_pages: 1, activities: [{ action: 'submit', people_count: 25, decision_count: 25, status_counts: { present: 25 } }] });
      const token = 'activities' in initial ? initial.activities[0]!.id : '';
      const first = await f.attendance.history(f.user, f.schoolId, f.registerId, { batch: token, page_size: 20 });
      const last = await f.attendance.history(f.user, f.schoolId, f.registerId, { batch: token, page_size: 20, page: 2 });
      expect(first).toMatchObject({ total: 26, total_pages: 2 }); expect(first.history).toHaveLength(20); expect(last.history).toHaveLength(6);
      expect(new Set([...first.history, ...last.history].filter(row => row.person_id).map(row => row.person_id)).size).toBe(25);
      expect((await sql`SELECT * FROM activity_attendance_entry_revisions WHERE register_id=${f.registerId}::uuid ORDER BY id`.execute(db)).rows).toEqual(original.rows);
      // Both commands use PostgreSQL's identical transaction timestamp, but
      // different retained request and command identities. No clock grouping.
      await db.transaction().execute(async tx => {
        await f.attendance.marksInTransaction(tx, f.user, f.schoolId, f.registerId, { expected_revision: 1, reason: 'Arrival confirmed', records: [{ person_id: f.personId, status: 'late' }] }, request(f.user));
        await f.attendance.marksInTransaction(tx, f.user, f.schoolId, f.registerId, { expected_revision: 2, reason: 'Authorized early departure', records: [{ person_id: f.personId, status: 'excused' }] }, request(f.user));
      });
      const all = await f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' });
      expect(all).toMatchObject({ total: 3 });
      if (!('activities' in all)) throw new Error('An activity page is required.');
      expect(all.activities.slice(0, 2).map(item => [item.previous_status, item.status, item.reason])).toEqual([
        ['late', 'excused', 'Authorized early departure'], ['present', 'late', 'Arrival confirmed'],
      ]);
      expect(all.activities[0]!.recorded_at).toBe(all.activities[1]!.recorded_at);
      expect(all.activities[0]!.id).not.toBe(all.activities[1]!.id);
      const pageTwo = await f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities', page_size: 1, page: 2 });
      expect(pageTwo).toMatchObject({ total: 3, total_pages: 3, activities: [{ reason: 'Arrival confirmed', people_count: 1, correction_count: 1 }] });
      const entry = (await sql<{ id: string }>`SELECT id FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid AND person_id=${f.personId}::uuid`.execute(db)).rows[0]!;
      const importRequest = randomUUID();
      for (const reason of ['Retained first source', 'Retained separate source']) await sql`INSERT INTO activity_attendance_entry_revisions(school_id,register_id,
        entry_id,person_id,previous_status,new_status,new_remarks,capture_channel,observed_at,reason,changed_by,request_id,register_revision,legacy_source_ref)
        VALUES(${f.schoolId}::uuid,${f.registerId}::uuid,${entry.id}::uuid,${f.personId}::uuid,NULL,'present','',
          'legacy_import',NULL,${reason},${f.user.id}::uuid,${importRequest}::uuid,1,${`history-batch-fixture:${randomUUID()}`})`.execute(db);
      expect(await f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' })).toMatchObject({ total: 5 });
      await expect(f.attendance.history({ ...f.user, active_school_id: randomUUID() }, f.schoolId, f.registerId, { batch: 'malformed' })).rejects.toThrow('Choose this institution');
    });
  }, 60000);
  it('uses a blank-name human account’s username for decisions, submissions, corrections and finalization without rewriting history', async () => {
    const f = await fixture();
    await f.run(async () => {
      const before = await sql`SELECT * FROM activity_attendance_entry_revisions WHERE register_id=${f.registerId}::uuid ORDER BY id`.execute(db);
      const initial = await f.attendance.history(f.user, f.schoolId, f.registerId, { page_size: 20 });
      expect(initial.history).toHaveLength(2);
      expect(new Set(initial.history.map(item => item.actor_name))).toEqual(new Set([f.user.username]));
      expect((await sql`SELECT * FROM activity_attendance_entry_revisions WHERE register_id=${f.registerId}::uuid ORDER BY id`.execute(db)).rows).toEqual(before.rows);
      await f.attendance.marks(f.user, f.schoolId, f.registerId, { expected_revision: 1, reason: 'Confirmed a later arrival',
        records: [{ person_id: f.personId, status: 'late' }] }, request(f.user));
      await f.attendance.transition(f.user, f.schoolId, f.registerId, 'finalize', { expected_revision: 2 }, request(f.user));
      const history = await f.attendance.history(f.user, f.schoolId, f.registerId, { page_size: 20 });
      expect(history.history.map(item => item.action)).toEqual(expect.arrayContaining(['decision', 'submit', 'marks', 'finalize']));
      expect(history.history.every(item => item.actor_name === f.user.username)).toBe(true);
      await db.updateTable('users').set({ first_name: 'Recorded', last_name: 'Human' }).where('id', '=', f.user.id).execute();
      expect((await f.attendance.history(f.user, f.schoolId, f.registerId, {})).history.every(item => item.actor_name === 'Recorded Human')).toBe(true);
    });
  });

  it('labels a real approved automatic finalization as software while keeping the human decisions human', async () => {
    const f = await fixture(true);
    await f.run(async () => {
      f.setNow(`${f.day}T09:32:00.000Z`);
      expect(await f.attendance.finalizeDue(f.schoolId)).toBe(1);
      const history = await f.attendance.history(f.user, f.schoolId, f.registerId, {});
      expect(history.history.find(item => item.action === 'automatic_finalize')?.actor_name).toBe('Configured automatic decision');
      expect(history.history.filter(item => item.action !== 'automatic_finalize').every(item => item.actor_name === f.user.username)).toBe(true);
      await sql`UPDATE campus_model_agents SET status='suspended' WHERE school_id=${f.schoolId}::uuid AND agent_kind='software'`.execute(db);
      expect((await f.attendance.history(f.user, f.schoolId, f.registerId, {})).history
        .find(item => item.action === 'automatic_finalize')?.actor_name).toBe('Configured automatic decision');
    });
  }, 60000);

  it('does not invent automation for unknown legacy actors or malformed, wrong-tenant and non-software source references', async () => {
    const f = await fixture(), other = await fixture(true);
    await other.run(async () => { other.setNow(`${other.day}T09:32:00.000Z`); await other.attendance.finalizeDue(other.schoolId); });
    const foreignActor = (await sql<{ id: string }>`SELECT id FROM campus_model_agents WHERE school_id=${other.schoolId}::uuid AND agent_kind='software'`.execute(db)).rows[0]!.id;
    await f.run(async () => {
      const entry = (await sql<{ id: string }>`SELECT id FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid`.execute(db)).rows[0]!.id;
      await sql`INSERT INTO activity_attendance_entry_revisions(school_id,register_id,entry_id,person_id,previous_status,new_status,new_remarks,
          capture_channel,observed_at,reason,changed_by,request_id,register_revision,legacy_source_ref)
        VALUES(${f.schoolId}::uuid,${f.registerId}::uuid,${entry}::uuid,${f.personId}::uuid,NULL,'present','',
          'human_roll_call',${f.now()}::timestamptz,'Imported actor was not retained',NULL,${randomUUID()}::uuid,1,${`history-fixture:${randomUUID()}`})`.execute(db);
      const humanAgent = (await sql<{ id: string }>`SELECT id FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid AND agent_kind='human'`.execute(db)).rows[0]!.id;
      const unproven = (await sql<{ id: string }>`INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status)
        VALUES(${f.schoolId}::uuid,'software',${`unproven:${randomUUID()}`},'No accepted command','active') RETURNING id`.execute(db)).rows[0]!.id;
      for (const source of [[], {}, [{ actor_agent_id: 'not-a-uuid' }], [{ actor_agent_id: foreignActor }], [{ actor_agent_id: humanAgent }], [{ actor_agent_id: unproven }]]) {
        await sql`INSERT INTO activity_attendance_audits(school_id,register_id,action,actor_id,reason,register_revision,request_id,source_refs)
          VALUES(${f.schoolId}::uuid,${f.registerId}::uuid,'legacy_unknown',NULL,'Historical attribution unavailable',1,
            ${randomUUID()}::uuid,${JSON.stringify(source)}::jsonb)`.execute(db);
      }
      const history = await f.attendance.history(f.user, f.schoolId, f.registerId, { page_size: 20 });
      const unknown = history.history.filter(item => item.reason === 'Imported actor was not retained' || item.action === 'legacy_unknown');
      expect(unknown).toHaveLength(7);
      expect(unknown.every(item => item.actor_name === 'Unknown recorded actor')).toBe(true);
    });
  }, 60000);

  it('distinguishes an actual human QR report from its configured software entry decision', async () => {
    const f = await fixture();
    await f.run(async () => {
      f.setNow(`${f.day}T11:35:00.000Z`);
      const setup = await new ProgressiveSetupService(applicationDb, f.core, f.core, f.core).setupAttendance(f.user, f.schoolId, {
        group_name: 'History QR', participant_names: ['QR Attendee'], responsible: { kind: 'current_user', self_teaches: true, display_name: 'History Teacher' },
        session: { starts_at: '11:00', ends_at: '12:00', weekdays: [1, 2, 3, 4, 5, 6, 7] },
      }, request(f.user));
      await sql`UPDATE institution_operating_rules SET attendance_academic_mode='scheduled_session',
        attendance_academic_channels=ARRAY['staff_roll_call','student_qr'],attendance_self_check_in_mode='automatic',
        revision=revision+1,updated_by=${f.user.id}::uuid,updated_at=${f.now()}::timestamptz WHERE school_id=${f.schoolId}::uuid`.execute(db);
      const subject = await db.insertInto('subjects').values({ school_id: f.schoolId, code: 'HIST', name: 'History lesson', short_name: 'History' }).returning('id').executeTakeFirstOrThrow();
      await db.transaction().execute(async tx => {
        const slot = (await sql<{ id: string; revision: number; weekday: number; period_number: number; term_id: string; class_section_id: string }>`
          UPDATE timetable_slots SET slot_type='class',subject_id=${subject.id}::uuid,title='History lesson',revision=revision+1
          WHERE class_section_id=${setup.resources.class_section_id}::uuid AND weekday=EXTRACT(ISODOW FROM ${f.day}::date)::int
          RETURNING id,revision,weekday,period_number,term_id,class_section_id`.execute(tx)).rows[0]!;
        const term = await tx.selectFrom('academic_terms').select(['starts_on', 'ends_on']).where('id', '=', slot.term_id).executeTakeFirstOrThrow();
        await f.core.recordLegacyTimetableSlotChange(tx, { school_id: f.schoolId, actor_user_id: f.user.id, action: 'updated', source_record_id: slot.id,
          source_revision: slot.revision, previous_source_revision: slot.revision - 1, term_id: slot.term_id, starts_on: String(term.starts_on), ends_on: String(term.ends_on),
          timezone: 'UTC', occurred_at: f.now(), class_section: { kind: 'class', domain: 'academic_structure', domain_id: slot.class_section_id,
            label: 'History QR cohort', lifecycle_state: 'active', source_revision: 1, metadata: {} },
          slot: { weekday: slot.weekday, period_number: slot.period_number, starts_at: '11:00', ends_at: '12:00', title: 'History lesson', slot_type: 'class',
            teacher_user_id: f.user.id, subject: { kind: 'subject', domain: 'academic_structure', domain_id: subject.id, label: 'History lesson', lifecycle_state: 'active', source_revision: 1, metadata: {} }, space: null, room_snapshot: '' }, correlation_id: randomUUID() });
      });
      const account = await db.insertInto('users').values({ username: `history-qr-${randomUUID()}`, email: `history-qr-${randomUUID()}@example.test`,
        password_hash: 'isolated-test-only', first_name: 'QR', last_name: 'Attendee', role: 'student' })
        .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
      const learner = await db.selectFrom('students').select(['id', 'person_id']).where('id', '=', setup.resources.student_ids[0]!).executeTakeFirstOrThrow();
      await db.updateTable('students').set({ user_id: account.id }).where('id', '=', learner.id).execute();
      await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: account.id, role: 'student' }).execute();
      await db.transaction().execute(tx => f.core.linkAccountEndpoint(tx, { school_id: f.schoolId, person_id: learner.person_id, user_id: account.id,
        actor_user_id: f.user.id, effective_from: new Date(Date.parse(f.now()) - 1000).toISOString(), effective_until: null,
        source_domain: 'people', source_record_id: learner.id, source_revision: 1, metadata: { fixture: true } }));
      const events = new SchoolEventService(applicationDb, f.core), academic = new AcademicParticipationBridge(applicationDb, f.attendance);
      const sessions = new AttendanceModelService(applicationDb, events, f.attendance, academic, f.core, f.core);
      const school = new SchoolService(applicationDb, events, {} as StaffCoverageReconciliationPort, f.core, undefined, undefined, undefined, academic);
      new AcademicParticipationEffects(f.attendance, school, sessions, events);
      const sessionId = (await sessions.workspace(f.user, f.day)).registers[0]!.session_id as string;
      const qr = await sessions.issueQr(f.user, sessionId, request(f.user));
      const participant: AuthUser = { ...account, active_school_id: f.schoolId };
      expect((await sessions.selfCheckIn(participant, qr.token, request(participant))).status).toBe('recorded');
      const register = (await sql<{ register_id: string }>`SELECT register_id FROM activity_attendance_source_contexts
        WHERE school_id=${f.schoolId}::uuid AND source_id=${sessionId} AND state='active'`.execute(db)).rows[0]!;
      const history = await f.attendance.history(f.user, f.schoolId, register.register_id, {});
      expect(history.history.find(item => item.action === 'self_report')?.actor_name).toBe('QR Attendee');
      expect(history.history.find(item => item.action === 'decision')?.actor_name).toBe('Configured automatic decision');
      expect(history.history.find(item => item.action === 'automatic_evidence')?.actor_name).toBe('Configured automatic decision');
    });
  }, 60000);

  it.runIf(Boolean(targetUrl))('uses the same history projection for inherited and corrected human records in a COW world without changing Live or a sibling', async () => {
    const f = await fixture(true), store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: Kysely<Database>[] = [];
    try {
      await f.run(async () => { f.setNow(`${f.day}T09:32:00.000Z`); await f.attendance.finalizeDue(f.schoolId); });
      const captured = await store.capture(f.schoolId, f.now());
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId,
          namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now(),
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: 'attendance-history-test', checked_at: f.now() });
        return { ...services(database), run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      const original = await f.run(() => f.attendance.history(f.user, f.schoolId, f.registerId, {}));
      const activityOriginal = await f.run(() => f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' }));
      const withoutTokens = (value: typeof activityOriginal) => 'activities' in value
        ? value.activities.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))) : [];
      await branch.run(async () => {
        expect(await branch.attendance.history(f.user, f.schoolId, f.registerId, {})).toEqual(original);
        const inherited = await branch.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' });
        expect(withoutTokens(inherited)).toEqual(withoutTokens(activityOriginal));
        if (!('activities' in activityOriginal) || !('activities' in inherited)) throw new Error('Activity pages required.');
        await expect(branch.attendance.history(f.user, f.schoolId, f.registerId, { batch: activityOriginal.activities[0]!.id })).rejects.toThrow('another context');
        expect((await branch.attendance.history(f.user, f.schoolId, f.registerId, { batch: inherited.activities[0]!.id })).total).toBeGreaterThan(0);
        await expect(db.transaction().execute(tx => branch.core.listRecordedSoftwareActors(tx, { school_id: f.schoolId, agent_ids: [] })))
          .rejects.toThrow('selected execution data plane');
        await branch.attendance.transition(f.user, f.schoolId, f.registerId, 'reopen', { expected_revision: 2, reason: 'Review inside this Simulation only' }, request(f.user));
        await branch.attendance.marks(f.user, f.schoolId, f.registerId, { expected_revision: 3, reason: 'Run-local correction only',
          records: [{ person_id: f.personId, status: 'late' }] }, request(f.user));
        const history = await branch.attendance.history(f.user, f.schoolId, f.registerId, {});
        expect(history.history.some(item => item.reason === 'Run-local correction only')).toBe(true);
        expect(history.history.filter(item => item.action !== 'automatic_finalize').every(item => item.actor_name === f.user.username)).toBe(true);
        expect(history.history.find(item => item.action === 'automatic_finalize')?.actor_name).toBe('Configured automatic decision');
        const activities = await branch.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' });
        expect(activities.total).toBe(activityOriginal.total + 2);
        expect('activities' in activities && activities.activities.some(item => item.reason === 'Run-local correction only' && item.correction_count === 1)).toBe(true);
      });
      expect(await f.run(() => f.attendance.history(f.user, f.schoolId, f.registerId, {}))).toEqual(original);
      expect(await sibling.run(() => sibling.attendance.history(f.user, f.schoolId, f.registerId, {}))).toEqual(original);
      expect(withoutTokens(await f.run(() => f.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' })))).toEqual(withoutTokens(activityOriginal));
      expect(withoutTokens(await sibling.run(() => sibling.attendance.history(f.user, f.schoolId, f.registerId, { view: 'activities' })))).toEqual(withoutTokens(activityOriginal));
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120000);
});
