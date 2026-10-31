import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { AttendanceModelService } from "../src/attendance-model/attendance-model.service.js";
import { lockSchedule } from "../src/day-plans/schedule.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { IMPORT_COLUMNS } from "../src/people/import-csv.js";
import { PeopleImportService } from "../src/people/people-import.service.js";
import { PeopleService } from "../src/people/people.service.js";
import { academicParticipationTestServices, configureAcademicSubjectSessions } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
if (enabled) requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const db = new DatabaseService();
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;

async function fixture(mode: "daily_class" | "scheduled_session") {
  const shared = academicParticipationTestServices(db), key = randomUUID();
  const account = await db.insertInto("users").values({ username: `session-roster-${key}`, email: `session-roster-${key}@example.test`,
    password_hash: "isolated-test-only", first_name: "Session", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx, account, "UTC"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const configured = await new ProgressiveSetupService(db, shared.core, shared.core, shared.core).setupAttendance(user, schoolId,
    { group_name: "Session roster", participant_names: ["Retained learner"], responsible: { kind: "current_user", self_teaches: true, display_name: "Session Owner" },
      session: { starts_at: "00:01", ends_at: "23:59", weekdays: [1, 2, 3, 4, 5, 6, 7] } }, request(user));
  const day = (await sql<{ day: string }>`SELECT campus_permission_date(${schoolId}::uuid)::text AS day`.execute(db)).rows[0]!.day;
  const classId = configured.resources.class_section_id;
  const termId = configured.resources.term_id;
  let sessionId: string | null = null;
  let registerId: string;
  if (mode === "scheduled_session") {
    await configureAcademicSubjectSessions(db, shared.core, user, schoolId, classId, termId, "UTC");
    const workspace = await shared.sessions.workspace(user, day);
    sessionId = workspace.registers[0]!.session_id as string;
    const screen = await shared.sessions.screen(user, sessionId);
    await shared.sessions.save(user, sessionId, { expected_revision: 0, records: screen.roster.map(row => ({ student_id: row.id as string, status: "present" })) }, request(user));
    registerId = (await sql<{ register_id: string }>`SELECT register_id FROM activity_attendance_source_contexts
      WHERE school_id=${schoolId}::uuid AND source_kind='scheduled_session' AND context_snapshot->'context'->>'legacy_register_id'=${sessionId}`.execute(db)).rows[0]!.register_id;
  } else {
    const prepared = await shared.bridge.prepareDaily(user, schoolId, classId, day, true);
    registerId = prepared.register_id;
    const roster = (await sql<{ student_id: string }>`SELECT student_id FROM activity_attendance_academic_roster WHERE register_id=${registerId}::uuid`.execute(db)).rows;
    await db.transaction().execute(tx => shared.bridge.saveDailyRecordsInTransaction(tx, user, schoolId, classId, day,
      { expected_revision: 0, records: roster.map(row => ({ student_id: row.student_id, status: "present" })) }, request(user)));
  }
  const people = new PeopleService(db, shared.events, shared.core, shared.core, shared.core, shared.bridge);
  const imports = new PeopleImportService(db, shared.events, shared.core, shared.core, shared.core, shared.bridge);
  const input = (roll = 2) => ({ school_id: schoolId, first_name: "Added learner", last_name: "", admission_number: `SESSION-${randomUUID().slice(0, 8)}`,
    class_section_id: classId, term_id: termId, roll_number: roll, enrolled_on: day, guardian: null });
  const entries = async () => (await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${registerId}::uuid ORDER BY id`.execute(db)).rows;
  const observations = async () => (await sql`SELECT * FROM campus_model_observations WHERE school_id=${schoolId}::uuid AND source_type='attendance.participation' ORDER BY id`.execute(db)).rows;
  const stage = async (roll = 2) => {
    const values: Record<string, string> = { admission_number: `SESSION-${randomUUID().slice(0, 8)}`, first_name: "Imported learner", last_name: "", date_of_birth: "2014-04-12",
      class: "Session roster", roll_number: String(roll), enrolled_on: day, guardian_key: "reported-family", guardian_first_name: "Reported", guardian_last_name: "Guardian",
      guardian_phone: "9000012345", guardian_email: "", relationship: "guardian" };
    const staged = await imports.stage(request(user), { school_id: schoolId, term_id: termId, filename: "session-roster.csv",
      csv: [IMPORT_COLUMNS.join(","), IMPORT_COLUMNS.map(column => `"${values[column] ?? ""}"`).join(",")].join("\r\n"), idempotency_key: randomUUID() });
    return imports.detail(user, staged.id, schoolId);
  };
  return { ...shared, user, schoolId, day, classId, termId, sessionId, registerId, people, imports, input, entries, observations, stage };
}

describe.runIf(enabled)("reviewed roster changes preserve both academic modes", () => {
  for (const mode of ["daily_class", "scheduled_session"] as const) {
    it(`reopens ${mode}, retains old evidence, and makes the new learner recordable through its owning adapter`, async () => {
      const f = await fixture(mode), req = request(f.user), before = await f.entries(), observations = await f.observations();
      const review = await f.people.preview(req, f.input()), accepted = await f.people.commit(req, review.id);
      expect(await f.people.commit(req, review.id)).toEqual(accepted);
      const detail = await f.kernel.detail(f.user, f.schoolId, f.registerId);
      expect(detail.register).toMatchObject({ state: "draft", revision: 2 });
      expect(detail.counts).toMatchObject({ participants: 2, recorded: 1, unrecorded: 1, present: 1 });
      expect(await f.entries()).toEqual(before); expect(await f.observations()).toEqual(observations);
      if (f.sessionId) {
        const screen = await f.sessions.screen(f.user, f.sessionId);
        expect(screen.roster.find(row => row.id === accepted.student_id)).toMatchObject({ status: null });
        const saved = await f.sessions.save(f.user, f.sessionId, { expected_revision: screen.register.revision,
          records: screen.roster.map(row => ({ student_id: row.id as string, status: row.id === accepted.student_id ? "absent" : "present" })) }, request(f.user));
        expect(saved.register).toMatchObject({ state: "submitted", revision: 3 });
        expect(saved.roster.find(row => row.id === accepted.student_id)).toMatchObject({ status: "absent" });
      } else {
        const screen = await f.school.teacherAttendanceScreen(f.user, f.classId, f.day);
        expect(screen.roster.find(row => row.id === accepted.student_id)).toMatchObject({ status: null });
        await db.transaction().execute(tx => f.bridge.saveDailyRecordsInTransaction(tx, f.user, f.schoolId, f.classId, f.day,
          { expected_revision: detail.register.revision, records: screen.roster.map(row => ({ student_id: row.id, status: row.id === accepted.student_id ? "absent" : "present" })) }, request(f.user)));
      }
      expect((await f.kernel.detail(f.user, f.schoolId, f.registerId)).counts).toMatchObject({ participants: 2, recorded: 2, present: 1, absent: 1 });
      expect(await f.entries()).toEqual(expect.arrayContaining(before));
    }, 30_000);
  }

  it("preflights a submitted session import, reconciles it once, and refuses a later locked session without partial people", async () => {
    const f = await fixture("scheduled_session"), before = await f.entries(), observations = await f.observations();
    const staged = await f.stage();
    expect(staged.review!.summary).toMatchObject({ errors: 0, registers_reopened: 1 });
    const saved = await f.imports.commit(request(f.user), staged.id, { school_id: f.schoolId, expected_revision: staged.revision,
      validation_token: staged.review!.validation_token, verified: true });
    expect(saved).toMatchObject({ students: 1, registers_reopened: 1 });
    expect(await f.entries()).toEqual(before); expect(await f.observations()).toEqual(observations);
    const screen = await f.sessions.screen(f.user, f.sessionId!);
    await f.sessions.save(f.user, f.sessionId!, { expected_revision: screen.register.revision,
      records: screen.roster.map(row => ({ student_id: row.id as string, status: row.status ?? "absent" })) }, request(f.user));
    const intakeReq = request(f.user), input = f.input(3), review = await f.people.preview(intakeReq, input), pendingImport = await f.stage(4);
    await f.sessions.setLock(f.user, f.sessionId!, true, {}, request(f.user));
    const lockedEntries = await f.entries();
    await expect(f.people.commit(intakeReq, review.id)).rejects.toThrow("locked");
    const updated = await f.imports.detail(f.user, pendingImport.id, f.schoolId);
    expect(updated.review!.rows[0]!.errors.join(" ")).toContain("locked");
    await expect(f.imports.commit(request(f.user), pendingImport.id, { school_id: f.schoolId, expected_revision: pendingImport.revision,
      validation_token: pendingImport.review!.validation_token, verified: true })).rejects.toThrow("invalid row");
    expect(await db.selectFrom("students").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(2);
    expect(await f.entries()).toEqual(lockedEntries);
    expect((await f.kernel.detail(f.user, f.schoolId, f.registerId)).register.state).toBe("locked");
    expect((await sql`SELECT id FROM activity_attendance_commands WHERE school_id=${f.schoolId}::uuid AND operation='roster_change'`.execute(db)).rows).toHaveLength(1);
  }, 30_000);

  it("waits for the schedule before taking the QR session lock, then issues against the newly accepted revision", async () => {
    const f = await fixture("scheduled_session"), tag = `qr-lock-order-${randomUUID()}`;
    await sql`UPDATE institution_operating_rules SET attendance_academic_channels=ARRAY['staff_roll_call','student_qr'],
      attendance_self_check_in_mode='staff_review',revision=revision+1,updated_by=${f.user.id}::uuid WHERE school_id=${f.schoolId}::uuid`.execute(db);
    const tagged = new Proxy(db, { get(target, property) {
      if (property === "transaction") return () => ({ execute: (action: (tx: Transaction<Database>) => Promise<unknown>) => target.transaction().execute(async tx => {
        await sql`SELECT set_config('application_name',${tag},true),set_config('lock_timeout','3s',true),set_config('statement_timeout','5s',true)`.execute(tx);
        return action(tx);
      }) });
      const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const qrSessions = new AttendanceModelService(tagged, f.events, f.kernel, f.bridge, f.core, f.core);
    let acquired!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; });
    const screen = await f.sessions.screen(f.user, f.sessionId!);
    const save = db.transaction().execute(async tx => {
      await sql`SELECT set_config('lock_timeout','2s',true),set_config('statement_timeout','5s',true)`.execute(tx);
      await lockSchedule(tx, f.schoolId); acquired(); await proceed;
      return f.bridge.saveSessionRecordsInTransaction(tx, f.user, f.schoolId, f.sessionId!, { expected_revision: screen.register.revision,
        reason: "Explicit concurrent session correction", records: screen.roster.map(row => ({ student_id: row.id as string, status: "late" })) }, request(f.user));
    });
    await held;
    const issuance = qrSessions.issueQr(f.user, f.sessionId!, request(f.user));
    // Attach rejection handling immediately: an assertion must not strand either
    // transaction or turn an expected old-order lock timeout into an unhandled rejection.
    const completed = Promise.allSettled([save, issuance]);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await sql<{ waiting: boolean }>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND application_name=${tag} AND wait_event_type='Lock' AND wait_event='advisory') AS waiting`.execute(db)).rows[0]!.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    const result = await completed;
    expect(result.map(item => item.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await f.kernel.detail(f.user, f.schoolId, f.registerId)).register.revision).toBe(2);
    expect((await sql<{ expected_revision: number }>`SELECT expected_revision FROM campus_model_commands
      WHERE school_id=${f.schoolId}::uuid AND command_type='attendance.qr.issue'`.execute(db)).rows).toEqual([{ expected_revision: 2 }]);
    expect((await f.kernel.detail(f.user, f.schoolId, f.registerId)).counts).toMatchObject({ recorded: 1, late: 1 });
  }, 10_000);
});
