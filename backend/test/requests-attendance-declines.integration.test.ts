import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { CoordinationService } from '../src/coordination/coordination.service.js';
import { FollowupModelBridgeService } from '../src/coordination/followup-model-bridge.service.js';
import { DayPlanService } from '../src/day-plans/day-plan.service.js';
import { attendanceDeclineWorkQuery } from '../src/requests/requests.service.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { academicParticipationTestServices } from './academic-participation.test-support.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/requests_attendance_unused_test';
const target = process.env.REQUESTS_ATTENDANCE_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const day = (date: string, offset: number) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), ip: '127.0.0.1',
  headers: { 'idempotency-key': randomUUID() } }) as unknown as AuthenticatedRequest;
type Decision = 'present' | 'absent' | 'late' | 'half_day' | 'excused';
type Learner = { id: string; person_id: string; name: string };

async function fixture(label: string, names: string[]) {
  const today = (await sql<{ date: string }>`SELECT (now() AT TIME ZONE 'UTC')::date::text AS date`.execute(db)).rows[0]!.date;
  const baseline = day(today, -55), current = day(today, -27), suffix = randomUUID();
  const school = await db.insertInto('schools').values({ name: label, code: `RAD-${suffix.slice(0, 18)}`, timezone: 'UTC' }).returning('id').executeTakeFirstOrThrow();
  const account = await db.insertInto('users').values({ username: `requests-attendance-${suffix}`, email: `requests-attendance-${suffix}@example.test`,
    password_hash: 'isolated-native-attendance-fixture', first_name: 'Attendance', last_name: 'Reviewer', role: 'admin', email_verified_at: new Date() })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const admin: AuthUser = { ...account, active_school_id: school.id };
  await db.insertInto('school_memberships').values({ school_id: school.id, user_id: admin.id, role: 'admin' }).execute();
  const shared = academicParticipationTestServices(db);
  await linkFixtureStaffIdentity(db, { school_id: school.id, user_id: admin.id, owner_user_id: admin.id,
    teaching: true, effective_from: `${baseline}T00:00:00Z` });
  const term = await db.insertInto('academic_terms').values({ school_id: school.id, academic_year: '2026-27', name: 'Native requests comparison',
    starts_on: baseline, ends_on: day(today, 45), attendance_threshold: '85', is_active: true }).returning('id').executeTakeFirstOrThrow();
  const section = await db.insertInto('class_sections').values({ school_id: school.id, academic_year: '2026-27', grade: '7', section: 'Requests' })
    .returning('id').executeTakeFirstOrThrow();
  await sql`INSERT INTO timetable_slots(class_section_id,term_id,teacher_user_id,weekday,period_number,starts_at,ends_at,title,slot_type)
    SELECT ${section.id}::uuid,${term.id}::uuid,${admin.id}::uuid,weekday,period_number,
      CASE WHEN period_number=1 THEN time '09:00' ELSE time '10:00' END,
      CASE WHEN period_number=1 THEN time '09:45' ELSE time '10:45' END,'Native comparison class','class'
    FROM generate_series(1,7) weekday CROSS JOIN generate_series(1,2) period_number`.execute(db);
  const learners: Learner[] = [];
  for (const [index, name] of names.entries()) {
    const person = await db.insertInto('school_people').values({ school_id: school.id, first_name: name, last_name: 'Fixture' }).returning('id').executeTakeFirstOrThrow();
    const student = await db.insertInto('students').values({ school_id: school.id, person_id: person.id, admission_number: `RAD-${index}` }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('enrollments').values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: index + 1, enrolled_on: baseline }).execute();
    learners.push({ id: student.id, person_id: person.id, name });
  }
  return { schoolId: school.id, classId: section.id, termId: term.id, admin, shared, today, baseline, current, learners,
    learner: (name: string) => {
      const found = learners.find(learner => learner.name === name);
      if (!found) throw new Error(`Missing native attendance learner ${name}.`);
      return found;
    } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function writeRecords(database: DatabaseService, f: Fixture, date: string, records: Array<{ student_id: string; status: Decision }>, reason?: string) {
  const shared = academicParticipationTestServices(database);
  const screen = await shared.school.teacherAttendanceScreen(f.admin, f.classId, date);
  return database.transaction().execute(tx => shared.school.saveTeacherAttendanceInTransaction(tx, f.admin, {
    class_section_id: f.classId, date, expected_revision: screen.register.revision, records,
    ...(reason ? { reason } : {}),
  }, request(f.admin), undefined, true));
}

async function seedRecordedWindows(f: Fixture) {
  for (let offset = 0; offset < 23; offset += 1) {
    const previous = f.learners.filter(learner => learner.name !== 'Unrecorded' && (learner.name !== 'Sparse' || offset < 4))
      .map(learner => ({ student_id: learner.id, status: 'present' as const }));
    await writeRecords(db, f, day(f.baseline, offset), previous);
    const current = f.learners.filter(learner => learner.name !== 'Unrecorded' && (learner.name !== 'Incomplete' || offset < 22)).map(learner => {
      const status: Decision = learner.name === 'Declining' ? offset < 20 ? 'present' : 'absent'
        : learner.name === 'Excused' ? offset < 18 ? 'excused' : 'absent'
          : learner.name === 'Four scored' ? offset < 19 ? 'excused' : 'absent'
            : learner.name === 'Steady' ? 'present' : 'absent';
      return { student_id: learner.id, status };
    });
    await writeRecords(db, f, day(f.current, offset), current);
  }
}

const read = (database: DatabaseService, f: Fixture) => attendanceDeclineWorkQuery(f.schoolId, 'UTC').execute(database).then(result => result.rows);
interface ExecutionPlan {
  'Node Type': string;
  'Function Name'?: string;
  'Actual Loops': number;
  Plans?: ExecutionPlan[];
}
function planNodes(plan: ExecutionPlan): ExecutionPlan[] { return [plan, ...(plan.Plans ?? []).flatMap(planNodes)]; }

describe.skipIf(!enabled)('Native Requests attendance decline projection', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture('Requests attendance decline native fixture', ['Declining', 'Excused', 'Sparse', 'Incomplete', 'Steady', 'Unrecorded', 'Four scored']);
    await seedRecordedWindows(f);
    console.info('REQUESTS_ATTENDANCE_NATIVE_FIXTURE', JSON.stringify({ school_id: f.schoolId, class_id: f.classId, term_id: f.termId,
      today: f.today, baseline: f.baseline, current_start: f.current, learners: f.learners }));
  }, 180_000);

  it('compares both complete 28-day windows using accepted native decisions', async () => {
    const rows = await read(db, f), decline = rows.find(row => row.id === f.learner('Declining').id);
    expect(decline).toMatchObject({ target_id: f.classId, detail: '100.0% → 87.0% · 28-day comparison', status_label: 'No open follow-up' });
    const localDate = (await sql<{ date: string }>`SELECT (now() AT TIME ZONE 'Pacific/Honolulu')::date::text AS date`.execute(db)).rows[0]!.date;
    const local = (await attendanceDeclineWorkQuery(f.schoolId, 'Pacific/Honolulu').execute(db)).rows;
    expect(local.length).toBeGreaterThan(0);
    expect(local.every(row => row.occurs_at === localDate)).toBe(true);
    const sources = (await sql<{ source_kind: string; count: number }>`SELECT context_source_kind AS source_kind,count(*)::int AS count
      FROM activity_attendance_registers WHERE school_id=${f.schoolId}::uuid GROUP BY context_source_kind`.execute(db)).rows;
    expect(sources).toEqual([{ source_kind: 'daily_class', count: 46 }]);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM attendance_records_legacy_source record
      JOIN students student ON student.id=record.student_id WHERE student.school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
  });

  it('counts excused marks as recorded while enforcing scored-day and 80% completeness floors', async () => {
    const rows = await read(db, f);
    expect(rows.map(row => row.id).sort()).toEqual([f.learner('Declining').id, f.learner('Excused').id].sort());
    expect(rows.find(row => row.id === f.learner('Excused').id)?.detail).toBe('100.0% → 0.0% · 28-day comparison');
    for (const name of ['Sparse', 'Incomplete', 'Steady', 'Unrecorded', 'Four scored'])
      expect(rows.some(row => row.id === f.learner(name).id), name).toBe(false);
  });

  it('retains one student-day when several instructional periods share the same date', async () => {
    const days = (await sql<{ periods: number; dates: number }>`SELECT count(*)::int AS periods,count(DISTINCT date)::int AS dates FROM (
      SELECT day::date AS date FROM generate_series(${f.baseline}::date,${f.today}::date,interval '1 day') day
      CROSS JOIN LATERAL planned_school_schedule_v2(${f.schoolId}::uuid,day::date) schedule
      WHERE schedule.class_section_id=${f.classId}::uuid AND schedule.term_id=${f.termId}::uuid
        AND schedule.slot_type IN ('class','activity') AND NOT schedule.cancelled) dates`.execute(db)).rows[0]!;
    expect(days).toEqual({ periods: 112, dates: 56 });
    const rows = await read(db, f);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(rows.find(row => row.id === f.learner('Declining').id)?.detail).toBe('100.0% → 87.0% · 28-day comparison');
  });

  it('preserves instructional dates across ordinary, holiday and cancelled day-plan projections', async () => {
    const schedule = await fixture('Requests instructional projection fixture', []);
    const cancelled = day(schedule.today, 1), holiday = day(schedule.today, 2), ordinary = day(schedule.today, 3);
    await db.insertInto('school_memberships').values({ school_id: schedule.schoolId, user_id: schedule.admin.id, role: 'staff' }).execute();
    await db.insertInto('school_calendar_days').values({ school_id: schedule.schoolId, date: holiday, is_instructional: false, label: 'Fictional review holiday' }).execute();
    const plans = new DayPlanService(db, schedule.shared.events, schedule.shared.school, createStaffCoverageReconciliationTestDouble(), schedule.shared.core);
    const draft = await plans.start(request(schedule.admin), { school_id: schedule.schoolId, class_section_id: schedule.classId, date: cancelled, idempotency_key: randomUUID() });
    const saved = await plans.save(request(schedule.admin), draft.id, { school_id: schedule.schoolId, expected_revision: draft.revision,
      idempotency_key: randomUUID(), notice: 'Fictional cancellation', reason: 'Both fictional sessions cancelled', periods: [1, 2].map(period => ({
        period_number: period, starts_at: period === 1 ? '09:00' : '10:00', ends_at: period === 1 ? '09:45' : '10:45',
        title: 'Cancelled fictional class', slot_type: 'class', teacher_user_id: schedule.admin.id, subject_id: null, room: '', materials: [], cancelled: true,
      })) });
    await plans.publish(request(schedule.admin), draft.id, { school_id: schedule.schoolId, expected_revision: saved.revision, idempotency_key: randomUUID() });
    const dates = [cancelled, holiday, ordinary];
    const planned = (await sql<{ date: string; class_section_id: string; term_id: string }>`SELECT DISTINCT date::text,class_section_id,term_id
      FROM unnest(${dates}::date[]) date CROSS JOIN LATERAL planned_school_schedule_v2(${schedule.schoolId}::uuid,date) slot
      WHERE slot.slot_type IN ('class','activity') AND NOT slot.cancelled ORDER BY 1,2,3`.execute(db)).rows;
    const effective = (await sql<{ date: string; class_section_id: string; term_id: string }>`SELECT DISTINCT date::text,class_section_id,term_id
      FROM unnest(${dates}::date[]) date CROSS JOIN LATERAL effective_school_schedule(${schedule.schoolId}::uuid,date) slot
      WHERE slot.slot_type IN ('class','activity') AND NOT slot.cancelled ORDER BY 1,2,3`.execute(db)).rows;
    expect(planned).toEqual(effective);
    expect(planned).toEqual([{ date: ordinary, class_section_id: schedule.classId, term_id: schedule.termId }]);
  }, 60_000);

  it('excludes an open native follow-up and restores the signal after its explicit resolution', async () => {
    const coordination = new CoordinationService(db, f.shared.events, new FollowupModelBridgeService(f.shared.core, f.shared.core, f.shared.core));
    const opened = await coordination.create(request(f.admin), { student_id: f.learner('Declining').id, attendance_date: day(f.current, 20),
      question: 'Please review the fictional recorded absence.', due_at: new Date(Date.now() + 86_400_000).toISOString(), idempotency_key: randomUUID() });
    expect((await read(db, f)).some(row => row.id === f.learner('Declining').id)).toBe(false);
    await coordination.respond(request(f.admin), opened.id, { context: 'staff', kind: 'resolved', expected_revision: opened.revision,
      outcome: 'query_withdrawn', body: 'Fictional review was explicitly withdrawn.', idempotency_key: randomUUID() });
    expect((await read(db, f)).some(row => row.id === f.learner('Declining').id)).toBe(true);
  }, 60_000);

  it('keeps another campus isolated and performs zero schedule calls when no student can qualify', async () => {
    const empty = await fixture('Requests no eligible attendance fixture', ['Unrecorded']);
    expect(await read(db, empty)).toEqual([]);
    expect((await read(db, f)).every(row => f.learners.some(learner => learner.id === row.id))).toBe(true);
    const explain = (await sql<{ 'QUERY PLAN': Array<{ Plan: ExecutionPlan }> }>`EXPLAIN (ANALYZE,FORMAT JSON)
      ${attendanceDeclineWorkQuery(empty.schoolId, 'UTC')}`.execute(db)).rows[0]!['QUERY PLAN'][0]!.Plan;
    const calls = planNodes(explain).filter(node => node['Function Name'] === 'planned_school_schedule_v2');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(node => node['Actual Loops'] === 0)).toBe(true);
  }, 60_000);

  it('does not borrow prior marks across a later enrollment cutoff or an expired current term', async () => {
    const boundaries = await fixture('Requests current cohort boundary fixture', ['Expired term', 'Recent enrollee']);
    await seedRecordedWindows(boundaries);
    expect((await read(db, boundaries)).map(row => row.id).sort()).toEqual(boundaries.learners.map(learner => learner.id).sort());
    await db.updateTable('enrollments').set({ enrolled_on: day(boundaries.today, -10) })
      .where('student_id', '=', boundaries.learner('Recent enrollee').id).where('class_section_id', '=', boundaries.classId).execute();
    expect((await read(db, boundaries)).map(row => row.id)).toEqual([boundaries.learner('Expired term').id]);
    // All recorded decisions end five days before today, so ending this term
    // yesterday preserves its accepted history while removing today's cohort.
    await db.updateTable('academic_terms').set({ ends_on: day(boundaries.today, -1) }).where('id', '=', boundaries.termId).execute();
    expect(await read(db, boundaries)).toEqual([]);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM attendance_records
      WHERE student_id=${boundaries.learner('Recent enrollee').id}::uuid AND date<${day(boundaries.today, -10)}::date`.execute(db)).rows[0]!.count).toBeGreaterThan(0);
  }, 90_000);

  it.runIf(Boolean(target))('corrects one entry only in the selected COW world and respects its virtual comparison date', async () => {
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 4), opened: DatabaseService[] = [];
    const instant = new Date().toISOString(), correctionDate = day(f.current, 20);
    try {
      const snapshot = await store.capture(f.schoolId, instant);
      const open = async () => {
        const scenario = randomUUID(), run = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { school_id: f.schoolId, scenario_id: scenario, run_id: run,
          namespace_id: `scenario:${scenario}:run:${run}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const runAt = <T>(at: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(simulationRequestEnvironment({
          institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`,
          manifest_ref: 'requests-attendance-decline-actual-cow', checked_at: instant,
        }), operation);
        return { database, run: <T>(operation: () => Promise<T>) => runAt(instant, operation), runAt };
      };
      const branch = await open(), sibling = await open(), initial = await read(db, f);
      expect(await branch.run(() => read(branch.database, f))).toEqual(initial);
      expect(await sibling.run(() => read(sibling.database, f))).toEqual(initial);
      await branch.run(() => writeRecords(branch.database, f, correctionDate, [{ student_id: f.learner('Declining').id, status: 'present' }], 'Review the single fictional absence'));
      const corrected = await branch.run(() => read(branch.database, f));
      expect(corrected.map(row => row.id)).toEqual([f.learner('Excused').id]);
      expect(corrected.some(row => row.id === f.learner('Incomplete').id)).toBe(false);
      expect(await read(db, f)).toEqual(initial);
      expect(await sibling.run(() => read(sibling.database, f))).toEqual(initial);
      const status = async (database: DatabaseService) => (await sql<{ status: string }>`SELECT status FROM attendance_records
        WHERE student_id=${f.learner('Declining').id}::uuid AND class_section_id=${f.classId}::uuid AND date=${correctionDate}::date`.execute(database)).rows[0]!.status;
      expect(await branch.run(() => status(branch.database))).toBe('present');
      expect(await status(db)).toBe('absent');
      expect(await sibling.run(() => status(sibling.database))).toBe('absent');
      const future = `${day(f.today, 28)}T12:00:00.000Z`;
      expect(await sibling.runAt(future, () => read(sibling.database, f))).toEqual([]);
      expect(await sibling.run(() => read(sibling.database, f))).toEqual(initial);
      console.info('REQUESTS_ATTENDANCE_COW_RECEIPT', JSON.stringify({ school_id: f.schoolId, snapshot_id: snapshot.id,
        correction_date: correctionDate, student_id: f.learner('Declining').id, initial_instant: instant, shifted_instant: future }));
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 180_000);

  it('extinguishes the decline after one accepted native absent-to-present correction', async () => {
    const instant = new Date().toISOString();
    await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => new Date(instant), nowIso: () => instant } }), () => writeRecords(db, f, day(f.current, 20),
      [{ student_id: f.learner('Declining').id, status: 'present' }], 'Correct the single fictional absence after review'));
    const rows = await read(db, f);
    expect(rows.some(row => row.id === f.learner('Declining').id)).toBe(false);
    expect(rows.map(row => row.id)).toEqual([f.learner('Excused').id]);
    expect((await sql<{ previous_status: string | null; new_status: string | null }>`SELECT revision.previous_status,revision.new_status
      FROM activity_attendance_entry_revisions revision JOIN activity_attendance_academic_roster roster
        ON roster.register_id=revision.register_id AND roster.person_id=revision.person_id
      JOIN activity_attendance_registers register ON register.id=revision.register_id
      WHERE revision.school_id=${f.schoolId}::uuid AND roster.student_id=${f.learner('Declining').id}::uuid
        AND (register.context_snapshot->'context'->>'date')::date=${day(f.current, 20)}::date
      ORDER BY revision.id DESC LIMIT 1`.execute(db)).rows[0]).toEqual({ previous_status: 'absent', new_status: 'present' });
  }, 60_000);
});
