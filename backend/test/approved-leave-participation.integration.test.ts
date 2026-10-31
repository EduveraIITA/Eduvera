import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { academicParticipationTestServices } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const targetUrl = process.env.SIMULATION_LEAVE_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/leave_unused_test", max: 3,
}) }) }) as DatabaseService;
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;

async function fixture() {
  const services = academicParticipationTestServices(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `leave-owner-${suffix}`, email: `leave-owner-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Leave", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(services.core).createForAccount(tx,account,"UTC"));
  const user: AuthUser = { ...account,active_school_id: schoolId };
  const day = new Date(Date.now()+86_400_000).toISOString().slice(0,10), next = new Date(Date.parse(`${day}T00:00:00Z`)+86_400_000).toISOString().slice(0,10);
  const now = new Date(`${day}T09:30:00Z`), environment = createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now),nowIso: () => now.toISOString() } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment,action);
  return run(async () => {
    const configured = await new ProgressiveSetupService(db,services.core,services.core,services.core).setupAttendance(user,schoolId,
      { group_name: "Leave fixture",participant_names: ["Present", "Late", "Half day", "Absent", "Unknown"],
        responsible: { kind: "current_user",self_teaches: true,display_name: "Leave Owner" },
        session: { starts_at: "09:00",ends_at: "10:00",weekdays: [1,2,3,4,5,6,7] } },request(user));
    const classId = configured.resources.class_section_id;
    const prepared = await db.transaction().execute(tx => services.bridge.prepareDailyInTransaction(tx,user,schoolId,classId,day,true));
    const people = (await sql<{ student_id: string; person_id: string; label: string }>`SELECT person.student_id,person.person_id,roster.label
      FROM activity_attendance_academic_roster person JOIN activity_attendance_roster roster
        ON roster.register_id=person.register_id AND roster.person_id=person.person_id
      WHERE person.school_id=${schoolId}::uuid AND person.register_id=${prepared.register_id}::uuid ORDER BY roster.label`.execute(db)).rows;
    const leave = async (studentId: string, endsOn = day) => db.insertInto("leave_requests").values({ student_id: studentId,
      term_id: prepared.context.term_id,requested_by: user.id,category: "family",starts_on: day,ends_on: endsOn,
      reason: "Synthetic authorized source for owning school decision",status: "authorized",submitted_at: now,
      guardian_authorized_by: user.id,guardian_authorized_at: now }).returning("id").executeTakeFirstOrThrow();
    return { ...services,user,schoolId,classId,day,next,now,run,people,registerId: prepared.register_id,termId: prepared.context.term_id,leave };
  });
}

describe.runIf(enabled)("school-approved leave uses one source-qualified participation writer", () => {
  it("atomically excuses absent/unknown and future dates without inventing observations or replacing presence", async () => {
    const f = await fixture();
    await f.run(async () => {
      const statuses = { Present: "present",Late: "late","Half day": "half_day",Absent: "absent" } as const;
      await f.kernel.marks(f.user,f.schoolId,f.registerId,{ expected_revision: 0,records: f.people.flatMap(person =>
        person.label in statuses ? [{ person_id: person.person_id,status: statuses[person.label as keyof typeof statuses] }] : []) },request(f.user));
      const original = (await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid
        AND status IN ('present','late','half_day') ORDER BY person_id`.execute(db)).rows;
      for (const person of f.people) {
        const source = await f.leave(person.student_id,f.next);
        expect(await f.school.performLeaveAction(f.user,source.id,"approve","Reviewed authorized source",request(f.user))).toMatchObject({ status: "school_approved" });
      }
      expect((await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid
        AND status IN ('present','late','half_day') ORDER BY person_id`.execute(db)).rows).toEqual(original);
      const exemptions = (await sql<{ date: string; status: string; capture_channel: string; observed_at: Date | null }>`
        SELECT occurrence.local_date::text AS date,entry.status,entry.capture_channel,entry.observed_at
        FROM activity_attendance_entries entry JOIN activity_attendance_registers register ON register.id=entry.register_id
        JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id
        WHERE entry.school_id=${f.schoolId}::uuid AND entry.capture_channel='approved_leave'`.execute(db)).rows;
      expect(exemptions).toHaveLength(7);
      expect(exemptions.filter(row => row.date===f.next)).toHaveLength(5);
      expect(exemptions.every(row => row.status==="excused" && row.observed_at===null)).toBe(true);
      const observations = (await sql<{ state: string; payload: { attendance_status: string } }>`SELECT state,payload FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation'`.execute(db)).rows;
      expect(observations).toHaveLength(4);
      expect(observations.filter(row => row.state==="superseded")).toHaveLength(1);
      expect(observations.some(row => row.payload.attendance_status==="excused")).toBe(false);
      const traces = (await sql<{ command_state: string; kind: string; scope: string }>`SELECT command.state AS command_state,
        event.payload->'decision_source'->>'kind' AS kind,event.payload->'decision_source'->>'evidence_scope' AS scope
        FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id
        WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='attendance.participation.approved_leave'`.execute(db)).rows;
      expect(traces).toHaveLength(7);
      expect(traces.every(row => row.command_state==="accepted" && row.kind==="school_approved_leave" && row.scope==="administrative_exemption_not_physical_attendance")).toBe(true);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM attendance_records_legacy_source
        WHERE class_section_id=${f.classId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      const counts = (await sql<{ classes_held: number }>`SELECT classes_held FROM subject_attendance
        WHERE student_id=ANY(${f.people.map(person => person.student_id)}::uuid[])`.execute(db)).rows;
      expect(counts.every(row => row.classes_held<=1)).toBe(true);
    });
  },30_000);

  it("rejects unapproved/wrong participant/stale source and rolls the school decision back for a locked register", async () => {
    const f = await fixture();
    await f.run(async () => {
      const person = f.people[0]!, source = await f.leave(person.student_id);
      const exempt = (studentId=person.student_id,revision=0) => db.transaction().execute(tx => f.kernel.applyApprovedLeaveInTransaction(tx,f.user,f.schoolId,f.registerId,
        { leave_id: source.id,student_id: studentId,expected_revision: revision },request(f.user)));
      await expect(exempt()).rejects.toThrow("current school-approved leave");
      await db.updateTable("leave_requests").set({ status: "school_approved",decided_by: f.user.id,decided_at: f.now }).where("id","=",source.id).execute();
      await expect(exempt(f.people[1]!.student_id)).rejects.toThrow("current school-approved leave");
      await expect(exempt(person.student_id,99)).rejects.toThrow("register changed");
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id","=",f.schoolId)
        .where("user_id","=",f.user.id).where("role","=","admin").execute();
      await expect(exempt()).rejects.toThrow("current school-approved leave");
      await db.updateTable("school_memberships").set({ is_active: true }).where("school_id","=",f.schoolId)
        .where("user_id","=",f.user.id).where("role","=","admin").execute();
      await sql`UPDATE schedule_activity_occurrences SET state='cancelled' WHERE id=(SELECT occurrence_id
        FROM activity_attendance_registers WHERE id=${f.registerId}::uuid)`.execute(db);
      await expect(exempt()).rejects.toThrow("activity was cancelled");
      await sql`UPDATE schedule_activity_occurrences SET state='expected' WHERE id=(SELECT occurrence_id
        FROM activity_attendance_registers WHERE id=${f.registerId}::uuid)`.execute(db);
      await db.updateTable("leave_requests").set({ status: "authorized",decided_by: null,decided_at: null }).where("id","=",source.id).execute();
      await f.kernel.submitRecords(f.user,f.schoolId,f.registerId,{ expected_revision: 0,
        records: f.people.map(row => ({ person_id: row.person_id,status: "present" })) },request(f.user));
      await f.kernel.transition(f.user,f.schoolId,f.registerId,"finalize",{ expected_revision: 1 },request(f.user));
      const before = (await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid ORDER BY person_id`.execute(db)).rows;
      await expect(f.school.performLeaveAction(f.user,source.id,"approve","Cannot change a final register",request(f.user))).rejects.toThrow("locked attendance register");
      expect(await db.selectFrom("leave_requests").select(["status","decided_by","decided_at"]).where("id","=",source.id).executeTakeFirstOrThrow())
        .toEqual({ status: "authorized",decided_by: null,decided_at: null });
      expect(await db.selectFrom("leave_audits").select("id").where("leave_request_id","=",source.id).where("action","=","approved").execute()).toHaveLength(0);
      expect((await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid ORDER BY person_id`.execute(db)).rows).toEqual(before);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_commands
        WHERE school_id=${f.schoolId}::uuid AND operation='approved_leave'`.execute(db)).rows[0]!.count).toBe(0);
    });
  },30_000);

  it("rolls back a post-write journal failure with the school decision and safely retries", async () => {
    const f = await fixture();
    await f.run(async () => {
      const source = await f.leave(f.people[0]!.student_id);
      const journal = vi.spyOn(f.core,"recordAcceptedEvent").mockRejectedValueOnce(new Error("Injected accepted-event journal failure"));
      try {
        await expect(f.school.performLeaveAction(f.user,source.id,"approve","Reviewed exact source",request(f.user)))
          .rejects.toThrow("Injected accepted-event journal failure");
      } finally { journal.mockRestore(); }
      expect(await db.selectFrom("leave_requests").select("status").where("id","=",source.id).executeTakeFirstOrThrow()).toEqual({ status: "authorized" });
      expect(await db.selectFrom("leave_audits").select("id").where("leave_request_id","=",source.id).where("action","=","approved").execute()).toHaveLength(0);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_entries WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
        AND command_type='attendance.participation.approved_leave'`.execute(db)).rows[0]!.count).toBe(0);
      await f.school.performLeaveAction(f.user,source.id,"approve","Reviewed exact source",request(f.user));
      expect((await sql<{ status: string; observed_at: Date | null }>`SELECT status,observed_at FROM activity_attendance_entries
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([{ status: "excused",observed_at: null }]);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation'`.execute(db)).rows[0]!.count).toBe(0);
    });
  },30_000);

  it.runIf(Boolean(targetUrl))("applies the same actual school decision in one captured world without changing Live or its sibling", async () => {
    const f = await fixture(), source = await f.run(() => f.leave(f.people[0]!.student_id));
    const store = new SimulationSnapshotStore(requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),requireIsolatedTestDatabaseUrl(targetUrl),4);
    const opened: Kysely<Database>[] = [];
    const projection = async (database: Kysely<Database>) => ({
      source: await database.selectFrom("leave_requests").select(["status","decided_by","decided_at"]).where("id","=",source.id).executeTakeFirstOrThrow(),
      entries: (await sql`SELECT * FROM activity_attendance_entries WHERE school_id=${f.schoolId}::uuid ORDER BY id`.execute(database)).rows,
      observations: (await sql`SELECT * FROM campus_model_observations WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation' ORDER BY id`.execute(database)).rows,
    });
    try {
      const captured = await store.capture(f.schoolId,f.now.toISOString()), original = await projection(db);
      const open = async () => {
        const scenarioId = randomUUID(),runId = randomUUID(),branch = await createSimulationBranch(store.pool,captured,
          { school_id: f.schoolId,scenario_id: scenarioId,run_id: runId,namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const compiler = new PostgresDialect({ pool: store.pool }),driver = new SimulationBranchDriver(store.pool,branch,captured);
        const connection = new Kysely<Database>({ dialect: { createDriver: () => driver,createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(),createIntrospector: value => compiler.createIntrospector(value) } });
        opened.push(connection);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId,scenario_id: scenarioId,run_id: runId,
          virtual_now: f.now.toISOString(),source_snapshot_ref: `sha256:${captured.content_hash}`,manifest_ref: "approved-leave-test",checked_at: f.now.toISOString() });
        return { ...academicParticipationTestServices(connection as DatabaseService),connection,
          run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment,action) };
      };
      const branch = await open(),sibling = await open();
      await branch.run(async () => {
        await branch.school.performLeaveAction(f.user,source.id,"approve","Captured-world source review",request(f.user));
        const changed = await projection(branch.connection);
        expect(changed.source).toMatchObject({ status: "school_approved",decided_by: f.user.id });
        expect(changed.entries).toMatchObject([{ status: "excused",capture_channel: "approved_leave",observed_at: null }]);
        expect(changed.observations).toEqual([]);
        expect((await sql<{ state: string }>`SELECT state FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
          AND command_type='attendance.participation.approved_leave'`.execute(branch.connection)).rows).toEqual([{ state: "accepted" }]);
      });
      expect(await projection(db)).toEqual(original);
      expect(await sibling.run(() => projection(sibling.connection))).toEqual(original);
    } finally {
      for (const connection of opened) await connection.destroy();
      await store.pool.end();
    }
  },60_000);
});
