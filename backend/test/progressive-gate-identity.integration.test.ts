import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import type { AuthUser, AuthenticatedRequest } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
pgTypes.setTypeParser(1082, value => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
const setup = new ProgressiveSetupService(applicationDb, core, core, core);
const repository = new WorkspaceRepository(applicationDb, new ResponsibilityProjectionService(core));
afterAll(async () => { await db.destroy(); });

async function founder() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `gate-${suffix}`, email: `gate-${suffix}@example.test`,
    password_hash: "isolated-test-only-hash", first_name: "Gate", last_name: "Founder", role: "admin",
  }).returning(["id", "email", "first_name", "last_name", "username", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(transaction => provisioner.createForAccount(transaction, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  return { user, schoolId };
}
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
const load = (user: AuthUser, schoolId: string) => repository.load({ school_id: schoolId, user_id: user.id,
  at: new Date(), execution_environment: null });

describe.skipIf(!enabled)("progressive Gate explicit operational responsibility", () => {
  it("turns explicit administrator confirmation into one person-backed audited gate assignment and reuses it", async () => {
    const { user, schoolId } = await founder();
    const initial = await load(user, schoolId);
    expect(initial.assignments.filter(item => item.action_key === "gate.manage")).toEqual([]);
    await expect(setup.setupGate(user, schoolId, { gate_name: "Reception", operator: { kind: "current_user", confirm: false } }, request(user)))
      .rejects.toThrow();
    expect(await db.selectFrom("staff_profiles").select("id").where("school_id", "=", schoolId).execute()).toEqual([]);
    const identity = await db.transaction().execute(transaction => core.resolveAccountEndpoint(transaction,
      { school_id: schoolId, user_id: user.id, at: new Date().toISOString() }));
    if (!identity.acting) throw new Error("Founder must retain its original person and agent.");
    const accepted = await setup.setupGate(user, schoolId,
      { gate_name: "Reception", operator: { kind: "current_user", confirm: true } }, request(user));
    expect(accepted).toMatchObject({ destination: "/areas/in-out/operate", created: { operator_authority: true } });
    const profile = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId)
      .where("user_id", "=", user.id).executeTakeFirstOrThrow();
    expect(profile).toMatchObject({ person_id: identity.person_id, staff_kind: "non_teaching",
      employment_type: "unspecified", joined_on: null, status: "active" });
    const projected = await load(user, schoolId);
    expect(projected.acting_agent_id).toBe(initial.acting_agent_id);
    expect(projected.membership_roles).toEqual(["admin", "staff"]);
    expect(projected.assignments).toEqual(expect.arrayContaining([expect.objectContaining({
      action_key: "gate.manage", scope: expect.objectContaining({ kind: "institution", id: schoolId }),
    })]));
    expect(await db.selectFrom("staff_responsibility_audits").select(["action", "assignment_id"])
      .where("school_id", "=", schoolId).execute()).toEqual([{ action: "activated", assignment_id: accepted.resources.operator_assignment_id }]);
    const repeated = await setup.setupGate(user, schoolId,
      { existing_gate_id: accepted.resources.gate_space_id, operator: { kind: "current_user", confirm: true } }, request(user));
    expect(repeated).toMatchObject({ resources: { operator_assignment_id: accepted.resources.operator_assignment_id },
      created: { gate: false, operator_authority: false }, reused: { gate: true, operator_authority: true } });
    expect((await sql<{ profiles: number; people: number; assignments: number }>`SELECT
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) profiles,
      (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) people,
      (SELECT count(*)::int FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid) assignments`.execute(db)).rows[0])
      .toEqual({ profiles: 1, people: 1, assignments: 1 });
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked", revoked_by: user.id,
      revoked_at: new Date() }).where("id", "=", accepted.resources.operator_assignment_id).execute();
    expect((await load(user, schoolId)).assignments.filter(item => item.action_key === "gate.manage")).toEqual([]);
  });

  it("keeps existing teaching identity and class work, and rejects cross-institution operators", async () => {
    const { user, schoolId } = await founder();
    await setup.setupAttendance(user, schoolId, { group_name: "Gate class", participant_names: ["Learner One"],
      responsible: { kind: "current_user", self_teaches: true },
      session: { starts_at: "09:00", ends_at: "09:30", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    }, request(user));
    const before = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId).executeTakeFirstOrThrow();
    const outside = await founder();
    await expect(setup.setupGate(user, schoolId,
      { gate_name: "Wrong operator", operator: { kind: "staff", user_id: outside.user.id } }, request(user)))
      .rejects.toThrow("active administrator or staff operator from this institution");
    await setup.setupGate(user, schoolId, { gate_name: "Class reception", operator: { kind: "current_user", confirm: true } }, request(user));
    const profiles = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId).execute();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: before.id, person_id: before.person_id,
      staff_kind: "teaching", employment_type: "unspecified", joined_on: null });
    expect((await load(user, schoolId)).assignments.map(item => item.action_key))
      .toEqual(expect.arrayContaining(["attendance.view", "attendance.record", "timetable.view", "gate.manage"]));
    expect((await load(outside.user, outside.schoolId)).assignments).toEqual([]);
  });
});
