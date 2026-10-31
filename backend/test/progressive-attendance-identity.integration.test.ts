import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ensureOperationalStaffProfile } from "../src/staff-operations/operational-staff-profile.js";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import { institutionSnapshot } from "../src/analytics/institution-metrics.js";
import { operatingRules } from "../src/operating-rules/rules.js";
import { AttendanceModelService } from "../src/attendance-model/attendance-model.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { AcademicParticipationBridge } from "../src/attendance/academic-participation-bridge.service.js";
import { ResponsibilityAttendanceRepository } from "../src/attendance/responsibility-attendance.repository.js";
import { ResponsibilityAttendanceWorkspaceService } from "../src/attendance/responsibility-attendance-workspace.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ScopedExecutionClock, SystemWallClock } from "../src/database/execution-clock.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { AuthUser, AuthenticatedRequest } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
pgTypes.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
const setup = new ProgressiveSetupService(applicationDb, core, core, core);
const repository = new WorkspaceRepository(applicationDb, new ResponsibilityProjectionService(core));
const executionScope = new ExecutionDataPlaneScope();
const wallClock = new SystemWallClock();
const attendanceKernel = new ActivityAttendanceService(applicationDb,core,core,core,core,core);
const attendanceWorkspace = new ResponsibilityAttendanceWorkspaceService(
  repository, new ResponsibilityAttendanceRepository(applicationDb),
  new AttendanceModelService(applicationDb,new SchoolEventService(applicationDb,core),attendanceKernel,
    new AcademicParticipationBridge(applicationDb,attendanceKernel),core,core),
  new ScopedExecutionClock(executionScope, wallClock),
);
afterAll(async () => { await db.destroy(); });

async function founder() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({
    username: `identity-${suffix}`, email: `identity-${suffix}@example.test`,
    password_hash: "isolated-test-only-hash", first_name: "", last_name: "", role: "admin",
  }).returning(["id", "email", "first_name", "last_name", "username", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute((transaction) => provisioner.createForAccount(transaction, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  return { user, schoolId };
}

function request(user: AuthUser): AuthenticatedRequest {
  return { authUser: user, requestId: randomUUID() } as AuthenticatedRequest;
}

function discoverRegisters(user: AuthUser) {
  const environment = createLiveExecutionEnvironment({ institution_id: user.active_school_id!, clock: wallClock });
  return executionScope.run(environment, () => attendanceWorkspace.workspace(user, environment, {
    mode: "live", institution_id: user.active_school_id!, namespace_id: environment.namespace_id,
  }, { surface: "registers", date: undefined, case_id: undefined }));
}

describe.skipIf(!enabled)("progressive Attendance canonical identity bridge", () => {
  it("gives a new founder one person-backed operational profile and exact canonical class work", async () => {
    const { user, schoolId } = await founder();
    const initialIdentity = await db.transaction().execute((transaction) => core.resolveAccountEndpoint(transaction, {
      school_id: schoolId, user_id: user.id, at: new Date().toISOString(),
    }));
    expect(initialIdentity.acting).toBe(true);
    const input = {
      group_name: "Identity class", participant_names: ["Learner One", "Learner Two"],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Identity Owner" },
      session: { starts_at: "09:00", ends_at: "09:30", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    };
    const accepted = await setup.setupAttendance(user, schoolId, input, request(user));
    const profile = await db.selectFrom("staff_profiles").selectAll()
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).executeTakeFirstOrThrow();
    expect(profile).toMatchObject({
      person_id: initialIdentity.person_id, status: "active", employment_type: "unspecified", joined_on: null,
    });
    const projected = await repository.load({ school_id: schoolId, user_id: user.id, at: new Date(), execution_environment: null });
    expect(projected.acting_agent_id).toBe(initialIdentity.agent_id);
    expect(projected.membership_roles).toEqual(["admin", "staff"]);
    expect(projected.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_key: "attendance.view", scope: expect.objectContaining({ kind: "class", id: accepted.resources.class_section_id }) }),
      expect.objectContaining({ action_key: "attendance.record", scope: expect.objectContaining({ kind: "class", id: accepted.resources.class_section_id }) }),
      expect.objectContaining({ action_key: "timetable.view" }),
    ]));
    const repeat = await setup.setupAttendance(user, schoolId, {
      ...input, group_name: undefined, existing_class_id: accepted.resources.class_section_id,
      participant_names: [], existing_student_ids: accepted.resources.student_ids,
    }, request(user));
    expect(repeat.created).toMatchObject({ assignment: false, group: false, participants: 0, sessions: 0 });
    const counts = (await sql<{ profiles: number; people: number }>`SELECT
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) profiles,
      (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) people`.execute(db)).rows[0];
    expect(counts).toEqual({ profiles: 1, people: 3 });
    const metrics = await institutionSnapshot(applicationDb, {
      school: schoolId, term: accepted.resources.term_id, today: accepted.destination.split("date=")[1]!,
      from: "2000-01-01", to: new Date().toISOString().slice(0, 10), classId: null,
    });
    expect(metrics.teaching_staff).toBe(1);
    await db.updateTable("staff_profiles").set({ status: "inactive" }).where("id", "=", profile.id).execute();
    const inactive = await repository.load({ school_id: schoolId, user_id: user.id, at: new Date(), execution_environment: null });
    expect(inactive.assignments).toEqual([]);
    await expect(setup.setupAttendance(user, schoolId, input, request(user))).rejects.toThrow("staff access is not active");
  });

  it("reuses the exact retained person through the current work-profile bridge, and replay does nothing", async () => {
    const { user, schoolId } = await founder();
    const group = await db.insertInto("class_sections").values({
      school_id: schoolId, academic_year: "2026-27", grade: "Repair", section: "", board: "", room_number: "", updated_by: user.id,
    }).returning("id").executeTakeFirstOrThrow();
    const type = await db.selectFrom("staff_responsibility_types").select("id")
      .where("school_id", "=", schoolId).where("code", "=", "class_teacher").executeTakeFirstOrThrow();
    const retainedAssignment=await db.insertInto("class_section_staff_assignments").values({
      school_id: schoolId, class_section_id: group.id, user_id: user.id, access_role_id: type.id,
      role: "class_teacher", subject_id: null, valid_from: "2026-01-01", valid_until: "2099-12-31", assigned_by: user.id,
    }).returning(['id','access_revision']).executeTakeFirstOrThrow();
    const before = await repository.load({ school_id: schoolId, user_id: user.id, at: new Date(), execution_environment: null });
    expect(before.assignments).toEqual([]);
    await db.insertInto("audit_events").values({
      actor_id: user.id, school_id: schoolId, action: "progressive.attendance.configured", target_type: "class_section",
      target_id: group.id, request_id: randomUUID(), ip_hash: null, metadata: { responsible_user_id: user.id },
    }).execute();
    const migration = await readFile(new URL("../migrations/153_attendance_responsible_person_identity.sql", import.meta.url), "utf8");
    // 153 is immutable historical upgrade evidence, not an active repair engine
    // to rerun after 216 removed its compatibility fields. Current provisioning
    // uses the explicit exact-account identity port and current profile writer.
    expect(migration).toContain("progressive.attendance.identity_repaired");
    expect(migration).toContain("profile.person_id=agent.person_id");
    const repair=()=>db.transaction().execute(tx=>ensureOperationalStaffProfile(tx,core,{school_id:schoolId,user_id:user.id,
      actor_user_id:user.id,at:new Date().toISOString(),staff_kind:'teaching',designation:'Attendance responsible person'}));
    const repaired=await repair();expect((await repair()).id).toBe(repaired.id);
    // The narrow identity bridge does not grant a membership. Progressive setup
    // owns this explicit access decision separately from the work record.
    expect((await repository.load({school_id:schoolId,user_id:user.id,at:new Date(),execution_environment:null})).assignments).toEqual([]);
    await db.insertInto('school_memberships').values({school_id:schoolId,user_id:user.id,role:'staff',is_active:true}).execute();
    await sql`SELECT reconcile_campus_responsibility_binding_source(${schoolId}::uuid,'class_assignment',${retainedAssignment.id}::uuid,${retainedAssignment.access_revision})`.execute(db);
    const after = await repository.load({ school_id: schoolId, user_id: user.id, at: new Date(), execution_environment: null });
    expect(after.acting_agent_id).toBe(before.acting_agent_id);
    expect(after.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_key: "attendance.view" }),
      expect.objectContaining({ action_key: "attendance.record" }),
    ]));
    expect((await sql<{ profiles: number; people: number; audits: number }>`SELECT
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) profiles,
      (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) people,
      (SELECT count(*)::int FROM audit_events WHERE school_id=${schoolId}::uuid AND action='progressive.attendance.identity_repaired') audits`.execute(db)).rows[0])
      .toEqual({ profiles: 1, people: 1, audits: 0 });
  });

  it("rediscovers the class register without a class/date deep link and preserves exact responsibility scope", async () => {
    const { user, schoolId } = await founder();
    const accepted = await setup.setupAttendance(user, schoolId, {
      group_name: "Visible class", participant_names: ["Learner Register"],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Register Owner" },
      session: { starts_at: "11:25", ends_at: "12:25", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    }, request(user));
    expect(await operatingRules(db, schoolId)).toMatchObject({ attendance_academic_mode: "daily_class", revision: 1 });
    const unrelated = (await sql<{ id: string }>`INSERT INTO class_sections(school_id,academic_year,grade,section,updated_by)
      SELECT school_id,academic_year,'Unassigned class','',${user.id}::uuid FROM class_sections
      WHERE id=${accepted.resources.class_section_id}::uuid RETURNING id`.execute(db)).rows[0]!;
    await sql`INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,
      slot_type,title,room,space_id,teacher_user_id,teacher_designation,updated_by)
      SELECT ${unrelated.id}::uuid,term_id,subject_id,weekday,period_number,starts_at,ends_at,
        slot_type,title,room,space_id,teacher_user_id,teacher_designation,updated_by
      FROM timetable_slots WHERE class_section_id=${accepted.resources.class_section_id}::uuid`.execute(db);
    const discovered = await discoverRegisters(user);
    expect(discovered.mode).toBe("daily_class");
    expect(discovered.registers).toEqual([expect.objectContaining({
      class_section_id: accepted.resources.class_section_id, student_count: 1, instructional: true, can_mark: true,
    })]);
    expect((await sql<{ source: string }>`SELECT metadata->>'source' source FROM audit_events
      WHERE school_id=${schoolId}::uuid AND action='operating_rules.attendance.initialized'`.execute(db)).rows)
      .toEqual([{ source: "explicit_progressive_class_register_setup" }]);

    // A world captured before the correction has accepted class-register evidence
    // but no rule row. The same resolver recovers its grain without mutating it.
    await sql`DELETE FROM institution_operating_rules WHERE school_id=${schoolId}::uuid`.execute(db);
    const retained = await discoverRegisters(user);
    expect(retained.mode).toBe("daily_class");
    expect(retained.registers.map((row) => row.class_section_id)).toEqual([accepted.resources.class_section_id]);
    expect((await sql<{ count: number }>`SELECT count(*)::int count FROM institution_operating_rules
      WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0]?.count).toBe(0);

    await sql`INSERT INTO institution_operating_rules(school_id,attendance_academic_mode,updated_by)
      VALUES(${schoolId}::uuid,'scheduled_session',${user.id}::uuid)`.execute(db);
    expect((await discoverRegisters(user)).mode).toBe("scheduled_session");
    expect((await discoverRegisters(user)).registers).toEqual([]);
  });

  it("does not replace an explicit subject-session or disabled policy, or infer a grain without accepted setup", async () => {
    const { user, schoolId } = await founder();
    expect((await operatingRules(db, schoolId)).attendance_academic_mode).toBe("scheduled_session");
    const input = { group_name: "Must not create", participant_names: ["No change"],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Operator" },
      session: { starts_at: "09:00", ends_at: "09:30" } };
    for (const mode of ["scheduled_session", "none"]) {
      await sql`INSERT INTO institution_operating_rules(school_id,attendance_academic_mode,updated_by)
        VALUES(${schoolId}::uuid,${mode},${user.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET attendance_academic_mode=EXCLUDED.attendance_academic_mode`.execute(db);
      await expect(setup.setupAttendance(user, schoolId, input, request(user))).rejects.toThrow(
        mode === "scheduled_session" ? "uses subject-session attendance" : "attendance is disabled");
      expect((await operatingRules(db, schoolId)).attendance_academic_mode).toBe(mode);
      expect((await db.selectFrom("class_sections").select("id").where("school_id", "=", schoolId).execute())).toEqual([]);
    }
  });
});
