import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { AcademicParticipationBridge } from "../src/attendance/academic-participation-bridge.service.js";
import { AcademicParticipationEffects } from "../src/attendance/academic-participation-effects.service.js";
import { AttendanceModelService } from "../src/attendance-model/attendance-model.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage, executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import type { ObservationIngressPort } from "../src/campus-model-core/observation-ingress.port.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import type { StaffCoverageReconciliationPort } from "../src/staff-operations/staff-coverage-reconciliation.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const events = new SchoolEventService(applicationDb, core);
const kernel = new ActivityAttendanceService(applicationDb, core, core, core, core, core);
const bridge = new AcademicParticipationBridge(applicationDb, kernel);
const sessions = new AttendanceModelService(applicationDb, events, kernel, bridge, core, core);
const school = new SchoolService(applicationDb, events, {} as StaffCoverageReconciliationPort, core,
  undefined, undefined, undefined, bridge);
new AcademicParticipationEffects(kernel, school, sessions, events);
const request = (user: AuthUser, key = randomUUID()) => ({ authUser: user, requestId: randomUUID(),
  headers: { "idempotency-key": key } }) as unknown as AuthenticatedRequest;
afterAll(async () => db.destroy());

async function fixture() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `continuity-flow-${suffix}`,
    email: `continuity-flow-${suffix}@example.test`, password_hash: "isolated-test-only", first_name: "Continuity",
    last_name: "Owner", role: "admin" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
    .executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute((tx) => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10), now = new Date(`${date}T04:00:00Z`);
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const configured = await run(() => new ProgressiveSetupService(applicationDb, core, core, core).setupAttendance(user, schoolId,
    { group_name: "Continuity", participant_names: ["Captured One", "Captured Two"],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Continuity Owner" },
      session: { starts_at: "09:00", ends_at: "10:00", weekdays: [1, 2, 3, 4, 5, 6, 7] } }, request(user)));
  const classId = configured.resources.class_section_id;
  const initial = await run(() => school.teacherAttendanceScreen(user, classId, date));
  const input = (source: "offline_device" | "paper" = "offline_device") => ({ class_section_id: classId, date,
    expected_revision: initial.register.revision, source, source_reference: source === "paper" ? "Signed register page 7" : "",
    ...(source === "offline_device" ? { device_id: "isolated-device-001" } : {}),
    observed_at: new Date(now.getTime() - 60000).toISOString(),
    roster_fingerprint: initial.continuity_snapshot.roster_fingerprint,
    roster_captured_at: initial.continuity_snapshot.captured_at,
    roster_expires_at: initial.continuity_snapshot.expires_at, snapshot_token: initial.continuity_snapshot.token,
    records: initial.roster.map((person, index) => ({ student_id: person.id, status: index === 0 ? "present" : "absent", remarks: "Checked source" })) });
  const accepted = async () => (await sql<{ register_id: string; commands: number; entries: number; archive: number }>`SELECT link.register_id,
    (SELECT count(*)::int FROM activity_attendance_commands command WHERE command.register_id=link.register_id) AS commands,
    (SELECT count(*)::int FROM activity_attendance_entries entry WHERE entry.register_id=link.register_id) AS entries,
    (SELECT count(*)::int FROM attendance_records_legacy_source record WHERE record.class_section_id=${classId}::uuid) AS archive
    FROM activity_attendance_source_contexts link WHERE link.school_id=${schoolId}::uuid AND link.source_kind='daily_class'
      AND link.source_id=${`${classId}:${initial.class.term_id}:${date}`}`.execute(db)).rows[0];
  return { user, schoolId, date, classId, initial, now, run, input, accepted };
}

describe.skipIf(!enabled)("captured academic attendance through the real shared acceptance workflow", () => {
  it("accepts an offline snapshot once, retains its observation time and immutable neutral receipt", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = f.input(), req = request(f.user);
      const result = await school.saveAttendanceContinuityBatch(f.user, input, req);
      expect(result.status).toBe("accepted");
      expect(result.batch).toMatchObject({ accepted_submission_id: null, status: "accepted" });
      expect(result.batch.accepted_participation_command_id).toBeTruthy();
      expect(await f.accepted()).toMatchObject({ commands: 1, entries: 2, archive: 0 });
      const detail = await kernel.detail(f.user, f.schoolId, result.batch.participation_register_id!);
      expect(detail.register).toMatchObject({ state: "submitted", revision: 1 });
      expect(detail.counts).toMatchObject({ present: 1, absent: 1, unrecorded: 0 });
      const entries = (await sql<{ capture_channel: string; observed_at: Date }>`SELECT capture_channel,observed_at
        FROM activity_attendance_entries WHERE register_id=${result.batch.participation_register_id}::uuid`.execute(db)).rows;
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.capture_channel === "offline_paper" && entry.observed_at.toISOString() === input.observed_at)).toBe(true);
      const observations = (await sql<{ state: string; observed_at: Date; evidence_refs: string[] }>`SELECT state,observed_at,evidence_refs
        FROM campus_model_observations WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation'`.execute(db)).rows;
      expect(observations).toHaveLength(2);
      expect(observations.every((row) => row.state === "accepted" && row.observed_at.toISOString() === input.observed_at
        && row.evidence_refs.includes(`attendance_capture_batch:${result.batch.id}`))).toBe(true);
      const commandBefore = (await sql<{ result_body: unknown }>`SELECT result_body FROM activity_attendance_commands
        WHERE id=${result.batch.accepted_participation_command_id}::uuid`.execute(db)).rows[0]!.result_body;
      const replay = await school.saveAttendanceContinuityBatch(f.user, input, req);
      expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(result)));
      await expect(school.saveAttendanceContinuityBatch(f.user, { ...input, records: input.records.map((row) => ({ ...row, status: "late" })) }, req))
        .rejects.toThrow("different attendance capture");
      expect(await f.accepted()).toMatchObject({ commands: 1, entries: 2, archive: 0 });
      expect((await sql<{ result_body: unknown }>`SELECT result_body FROM activity_attendance_commands
        WHERE id=${result.batch.accepted_participation_command_id}::uuid`.execute(db)).rows[0]!.result_body).toEqual(commandBefore);
    });
  }, 60000);

  it("quarantines paper observations until explicit review then commits review, evidence and decisions together", async () => {
    const f = await fixture();
    await f.run(async () => {
      const captured = await school.saveAttendanceContinuityBatch(f.user, f.input("paper"), request(f.user));
      expect(captured.status).toBe("quarantined");
      expect(captured.review).toMatchObject({ state: "open", reason_code: "source_requires_review" });
      expect(await f.accepted()).toBeUndefined();
      expect((await sql<{ state: string }>`SELECT state FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.capture'`.execute(db)).rows.map((row) => row.state)).toEqual(["quarantined", "quarantined"]);
      const req = request(f.user), originalKey = req.headers["idempotency-key"];
      const result = await school.decideAttendanceReconciliation(f.user, captured.review!.id,
        { decision: "accept", reason: "Verified the signed paper register", expected_revision: 0 }, req);
      expect(req.headers["idempotency-key"]).toBe(originalKey);
      expect(result).toHaveProperty("applied_register");
      expect(await f.accepted()).toMatchObject({ commands: 1, entries: 2, archive: 0 });
      const accepted = await db.selectFrom("attendance_capture_batches").selectAll().where("id", "=", captured.batch.id).executeTakeFirstOrThrow();
      expect(accepted).toMatchObject({ status: "accepted", resolved_by: f.user.id, accepted_submission_id: null,
        resolution_note: "Verified the signed paper register" });
      expect(accepted.accepted_participation_command_id).toBeTruthy();
      expect(await db.selectFrom("attendance_reconciliation_cases").select("state").where("id", "=", captured.review!.id).executeTakeFirstOrThrow())
        .toEqual({ state: "accepted" });
      expect((await sql<{ state: string }>`SELECT state FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.capture'`.execute(db)).rows.map((row) => row.state)).toEqual(["accepted", "accepted"]);
    });
  }, 60000);

  it("does not reuse an inactive administrator membership when a current staff membership remains", async () => {
    const f = await fixture();
    await f.run(async () => {
      const roles = await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.user.id).where("is_active", "=", true).execute();
      expect(roles.map((row) => row.role)).toEqual(expect.arrayContaining(["admin", "staff"]));
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.user.id).where("role", "=", "admin").execute();
      await expect(school.saveAttendanceContinuityBatch(f.user, f.input("paper"), request(f.user)))
        .rejects.toThrow("active school administrator");
      expect(await db.selectFrom("attendance_capture_batches").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
      expect(await f.accepted()).toBeUndefined();
    });
  }, 60000);

  it("rolls back accepted decisions and receipts if the final capture transition fails, then safely retries", async () => {
    const f = await fixture();
    await f.run(async () => {
      const failingIngress: ObservationIngressPort = {
        recordObservations: (tx, observations) => core.recordObservations(tx, observations),
        transitionObservations: (tx, input) => {
          if (input.source_type === "attendance.capture" && input.state === "accepted") throw new Error("Isolated final transition failure");
          return core.transitionObservations(tx, input);
        },
      };
      const interrupted = new SchoolService(applicationDb, events, {} as StaffCoverageReconciliationPort, failingIngress,
        undefined, undefined, undefined, bridge);
      const input = f.input(), req = request(f.user);
      await expect(interrupted.saveAttendanceContinuityBatch(f.user, input, req)).rejects.toThrow("Isolated final transition failure");
      const batch = await db.selectFrom("attendance_capture_batches").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
      expect(batch).toMatchObject({ status: "pending", accepted_participation_command_id: null, accepted_submission_id: null });
      expect(await f.accepted()).toBeUndefined();
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_commands
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation'`.execute(db)).rows[0]!.count).toBe(0);
      const retried = await school.saveAttendanceContinuityBatch(f.user, input, req);
      expect(retried.status).toBe("accepted");
      expect(retried.batch.id).toBe(batch.id);
      expect(await f.accepted()).toMatchObject({ commands: 1, entries: 2, archive: 0 });
    });
  }, 60000);

  it("labels only human-confirmed matched presence as camera-assisted and binds the photo to the same command", async () => {
    const f = await fixture();
    await f.run(async () => {
      const photoId = randomUUID(), observedAt = new Date(executionNow().getTime() - 120000);
      // A retained analyzed-provider artifact is a fixture, not a claim that a
      // live camera/provider was exercised. The real human acceptance path is.
      await sql`INSERT INTO photo_attendance_sessions(id,school_id,class_section_id,term_id,date,period,provider_session_id,captured_by,
        capture_authorization_reference,roster_count,model_id,analysis_summary,observed_at,expires_at)
        VALUES(${photoId}::uuid,${f.schoolId}::uuid,${f.classId}::uuid,${f.initial.class.term_id}::uuid,${f.date}::date,'Daily',${`fixture-${photoId}`},
          ${f.user.id}::uuid,'Isolated analyzed artifact',2,'fixture-only',${JSON.stringify({ matched_student_ids: f.initial.roster.map((person) => person.id) })}::jsonb,
          ${observedAt},${new Date(executionNow().getTime() + 3600000)})`.execute(db);
      const req = request(f.user), input = { class_section_id: f.classId, date: f.date, expected_revision: 0,
        photo_session_id: photoId, records: f.input().records };
      await school.saveTeacherAttendance(f.user, input, req);
      const accepted = await f.accepted();
      expect(accepted).toMatchObject({ commands: 1, entries: 2, archive: 0 });
      const entries = (await sql<{ status: string; capture_channel: string; observed_at: Date }>`SELECT status,capture_channel,observed_at
        FROM activity_attendance_entries WHERE register_id=${accepted!.register_id}::uuid ORDER BY status`.execute(db)).rows;
      expect(entries.find((entry) => entry.status === "present")).toEqual({ status: "present", capture_channel: "camera_assisted", observed_at: observedAt });
      expect(entries.find((entry) => entry.status === "absent")!.capture_channel).toBe("human_roll_call");
      const photo = await db.selectFrom("photo_attendance_sessions").select(["state", "participation_register_id", "applied_participation_command_id",
        "applied_submission_id", "applied_session_submission_id"]).where("id", "=", photoId).executeTakeFirstOrThrow();
      expect(photo).toMatchObject({ state: "applied", participation_register_id: accepted!.register_id,
        applied_submission_id: null, applied_session_submission_id: null });
      expect(photo.applied_participation_command_id).toBeTruthy();
      await expect(school.saveTeacherAttendance(f.user, { ...input, expected_revision: 1, reason: "Repeated the photo acceptance" }, request(f.user)))
        .rejects.toThrow("already been applied");
      expect(await f.accepted()).toMatchObject({ commands: 1, entries: 2, archive: 0 });
    });
  }, 60000);
});
