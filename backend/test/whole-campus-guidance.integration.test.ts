import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { InstitutionOnboardingService } from "../src/institution-onboarding/institution-onboarding.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { RolesService } from "../src/roles/roles.service.js";
import { campusSceneDocument, campusSceneServices } from "./campus-scenes.test-support.js";
import { createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/whole_campus_unused_test";
const target = process.env.WHOLE_CAMPUS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as AuthenticatedRequest;

function services(database: DatabaseService) {
  const native = campusSceneServices(database), audit = new AuditService(database), provisioner = new ProgressiveWorkspaceProvisioner(native.core);
  return { ...native, onboarding: new InstitutionOnboardingService(database, audit, provisioner, native.core, native.core),
    auth: new AuthService(database, audit, new RolesService(database), provisioner, undefined, undefined, undefined, native.core) };
}
async function fixture() {
  const native = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `whole-campus-${suffix}`, email: `whole-campus-${suffix}@example.test`,
    password_hash: "isolated-founder-account", first_name: "Anita", last_name: "Founder", role: "admin", email_verified_at: new Date() })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const signedIn: AuthUser = { ...account, active_school_id: null };
  const opened = await native.onboarding.provision(signedIn, randomUUID(), { guidance: "whole_campus", timezone: "Asia/Kolkata" }, request(signedIn));
  const schoolId = opened.active_school_id, owner = { ...signedIn, active_school_id: schoolId };
  const retained = () => db.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", schoolId).executeTakeFirstOrThrow();
  return { ...native, owner, schoolId, opened, retained };
}
async function domainCounts(schoolId: string) {
  return (await sql<Record<string, number>>`SELECT
    (SELECT count(*)::int FROM campus_spaces WHERE school_id=${schoolId}::uuid) AS places,
    (SELECT count(*)::int FROM campus_resource_holdings WHERE school_id=${schoolId}::uuid) AS holdings,
    (SELECT count(*)::int FROM campus_visual_scenes WHERE school_id=${schoolId}::uuid) AS scenes,
    (SELECT count(*)::int FROM class_sections WHERE school_id=${schoolId}::uuid) AS classes,
    (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) AS staff,
    (SELECT count(*)::int FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid) AS duties,
    (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) AS people,
    (SELECT count(*)::int FROM school_memberships WHERE school_id=${schoolId}::uuid) AS memberships`.execute(db)).rows[0]!;
}

describe.skipIf(!enabled)("native whole-campus starting guidance", () => {
  it("starts from a private workspace with no compulsory domain records and resumes after reload", async () => {
    const f = await fixture();
    expect(f.opened).toMatchObject({ status: "ready", guidance: "whole_campus", goals: { selected: [], primary: null },
      guidance_resume: { kind: "whole_campus", path: "/more/setup/whole-campus", actor_user_id: f.owner.id, school_id: f.schoolId, requires_recheck: true },
      workspace: { display_name: "Your campus", profile_named: false, verification_status: "not_verified" } });
    expect(await domainCounts(f.schoolId)).toEqual({ places: 0, holdings: 0, scenes: 0, classes: 0, staff: 0, duties: 0, people: 1, memberships: 1 });
    const before = await f.retained();
    const repeated = await f.onboarding.provision(f.owner, randomUUID(), { guidance: "whole_campus" }, request(f.owner));
    expect(repeated.workspace?.id).toBe(f.schoolId);
    expect(await f.retained()).toEqual(before);
    expect((await f.auth.me(f.owner)).onboarding).toMatchObject({ status: "ready", selected_goal_count: 0, guidance: "whole_campus",
      guidance_resume: { path: "/more/setup/whole-campus", actor_user_id: f.owner.id, school_id: f.schoolId } });
    expect((await db.selectFrom("progressive_onboarding_audits").select("id").where("workspace_id", "=", before.id).where("action", "=", "guidance_selected").execute())).toHaveLength(1);
  });

  it("preserves intent on omitted fields, retains explicit choices and leaves only on explicit null", async () => {
    const f = await fixture();
    const selected = await f.onboarding.setGoals(f.owner, { goals: ["fees", "messages"], primary: "messages" }, request(f.owner));
    expect(selected).toMatchObject({ guidance: "whole_campus", goals: { selected: ["messages", "fees"] } });
    await f.onboarding.provision(f.owner, randomUUID(), {}, request(f.owner));
    expect((await f.onboarding.workspace(f.owner)).guidance).toBe("whole_campus");
    const exited = await f.onboarding.provision(f.owner, randomUUID(), { guidance: null }, request(f.owner));
    expect(exited).toMatchObject({ guidance: null, guidance_resume: null, goals: { selected: ["messages", "fees"] } });
    expect((await f.auth.me(f.owner)).onboarding.guidance_resume).toBeNull();
    const resumed = await f.onboarding.setGoals(f.owner, { goals: ["whole_campus"] }, request(f.owner));
    expect(resumed).toMatchObject({ guidance: "whole_campus", goals: { selected: ["gate", "timetable", "facilities"] } });
    expect(await domainCounts(f.schoolId)).toEqual({ places: 0, holdings: 0, scenes: 0, classes: 0, staff: 0, duties: 0, people: 1, memberships: 1 });
  });

  it("enabling or opening guidance preserves an accepted exact assignment source", async () => {
    process.env.INVITATION_EMAIL_ENABLED = "false";
    const f = await createLearningOfferingFixture(db), native = services(db);
    await native.onboarding.setGoals(f.owner, { goals: ["assignments"] }, request(f.owner));
    const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString() }));
    if (!identity.acting) throw Error("Expected founder identity");
    const person = await f.people.detail(f.owner, f.schoolId, identity.person_id);
    const offering = await f.create({ instructor: f.reference(person) });
    await f.assignments.save(f.owner, f.input(offering.id, { reviewer_id: f.owner.id }));
    const before = await db.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
    expect(before.resume_path).toContain("assignment=");
    await native.onboarding.provision(f.owner, randomUUID(), { guidance: "whole_campus" }, request(f.owner));
    await native.onboarding.setResume(f.owner, { step: "first_use", path: "/more/setup/whole-campus" }, request(f.owner));
    await native.onboarding.setGoals(f.owner, { goals: ["assignments"], guidance: "whole_campus" }, request(f.owner));
    const after = await db.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
    expect(after).toMatchObject({ resume_step: before.resume_step, resume_goal_key: before.resume_goal_key, resume_path: before.resume_path, guidance: "whole_campus" });
    expect((await native.auth.me(f.owner)).onboarding.resume).toHaveProperty("continuation.kind", "learning_assignment");
  }, 60_000);

  it("does not return another administered campus or grant setup to staff, a different owner or a revoked membership", async () => {
    const f = await fixture(), other = await fixture();
    const staff = await db.insertInto("users").values({ username: `whole-staff-${randomUUID()}`, email: `whole-staff-${randomUUID()}@example.test`,
      password_hash: "isolated-staff", first_name: "Meera", last_name: "Staff", role: "staff" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: staff.id, role: "staff" }).execute();
    const staffActor = { ...staff, active_school_id: f.schoolId };
    const before = await f.retained();
    expect((await f.auth.me(staffActor)).onboarding.guidance_resume).toBeNull();
    await expect(f.onboarding.provision(staffActor, randomUUID(), { guidance: "whole_campus" }, request(staffActor))).rejects.toThrow(/administrator/);
    await expect(f.onboarding.setGoals(staffActor, { goals: ["gate"], guidance: "whole_campus" }, request(staffActor))).rejects.toThrow();
    const foreignSelected = { ...f.owner, active_school_id: other.schoolId };
    expect((await f.onboarding.workspace(foreignSelected)).workspace).toBeNull();
    expect((await f.auth.me(foreignSelected)).onboarding.guidance_resume).toBeNull();
    await expect(f.onboarding.provision(foreignSelected, randomUUID(), { guidance: "whole_campus" }, request(foreignSelected))).rejects.toThrow(/administrator/);
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: other.owner.id, role: "admin" }).execute();
    expect((await f.auth.me({ ...other.owner, active_school_id: f.schoolId })).onboarding.guidance_resume).toBeNull();
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
    expect((await f.auth.me(f.owner)).onboarding.guidance_resume).toBeNull();
    await expect(f.onboarding.provision(f.owner, randomUUID(), { guidance: "whole_campus" }, request(f.owner))).rejects.toThrow();
    const clearedSelection = { ...f.owner, active_school_id: null };
    await expect(f.onboarding.provision(clearedSelection, randomUUID(), { guidance: "whole_campus" }, request(clearedSelection))).rejects.toThrow(/No new campus/);
    expect(await f.retained()).toEqual(before);
  });

  it("fails closed for Simulation, public demo and delegated preference writers before altering anything", async () => {
    const f = await fixture(), before = await f.retained();
    const simulated = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: randomUUID(), run_id: randomUUID(), virtual_now: new Date().toISOString(),
      source_snapshot_ref: "sha256:test", manifest_ref: "whole-campus-preference-safety", checked_at: new Date().toISOString() });
    await executionEnvironmentStorage.run(simulated, async () => {
      await expect(f.onboarding.provision(f.owner, randomUUID(), { guidance: null }, request(f.owner))).rejects.toThrow(/Live/);
      await expect(f.onboarding.setGoals(f.owner, { goals: ["gate"], guidance: null }, request(f.owner))).rejects.toThrow(/Live/);
      await expect(f.onboarding.setResume(f.owner, { step: "first_use", path: "/more/setup/whole-campus" }, request(f.owner))).rejects.toThrow(/Live/);
      await expect(f.onboarding.setProfile(f.owner, { display_name: "Forbidden rename" }, request(f.owner))).rejects.toThrow(/Live/);
      expect((await f.auth.me(f.owner)).onboarding.guidance_resume).toBeNull();
    });
    for (const flag of ["publicDemo", "internalAgentDelegation", "hostedCampusSimulator"] as const) {
      await expect(f.onboarding.provision(f.owner, randomUUID(), { guidance: null }, { ...request(f.owner), [flag]: true })).rejects.toThrow(/own signed-in/);
    }
    expect((await f.auth.me(f.owner, { allowGuidanceResume: false })).onboarding.guidance_resume).toBeNull();
    expect(await f.retained()).toEqual(before);
  });

  it.runIf(Boolean(target))("captures the preference privately and creates canonical place, linked draft and publication only in one native COW world", async () => {
    const f = await fixture(), before = await f.retained(), now = new Date().toISOString();
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const native = services(database), environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "whole-campus-native-COW", checked_at: now });
        return { ...native, database, namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open();
      let placeId = "", campusId = "";
      await branch.run(async () => {
        expect(await branch.database.selectFrom("progressive_onboarding_workspaces").select("guidance").where("school_id", "=", f.schoolId).executeTakeFirstOrThrow())
          .toEqual({ guidance: "whole_campus" });
        await expect(branch.onboarding.provision(f.owner, randomUUID(), { guidance: null }, request(f.owner))).rejects.toThrow(/Live/);
        const command = { name: "Learning pavilion", code: "PAVILION", kind: "building", create_campus_if_missing: true, idempotency_key: randomUUID() };
        const created = await branch.topology.createSpace(f.owner, f.schoolId, command, request(f.owner));
        expect(await branch.topology.createSpace(f.owner, f.schoolId, command, request(f.owner))).toEqual(created);
        placeId = String(created.id); campusId = String(created.campus_id);
        const input = { idempotency_key: randomUUID(), expected_revision: 0, document: campusSceneDocument(placeId) };
        const saved = await branch.scenes.saveDraft(f.owner, f.schoolId, campusId, input);
        expect(await branch.scenes.saveDraft(f.owner, f.schoolId, campusId, input)).toMatchObject({ revision: saved.revision });
        const publication = { idempotency_key: randomUUID(), expected_revision: saved.revision };
        const published = await branch.scenes.publish(f.owner, f.schoolId, campusId, publication);
        expect(await branch.scenes.publish(f.owner, f.schoolId, campusId, publication)).toMatchObject({ revision: published.revision });
        expect((await branch.scenes.workspace(f.owner, f.schoolId, campusId)).scene?.published?.document.elements[0]?.space_id).toBe(placeId);
        expect(await branch.database.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(before);
        const accepted = await branch.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("school_id", "=", f.schoolId)
          .where("handler_key", "=", "campus_topology.space.create").execute();
        expect(accepted).toEqual([{ state: "accepted", environment_namespace_id: branch.namespace }]);
      });
      const unchanged = async (database: DatabaseService) => {
        expect(await database.selectFrom("campus_spaces").select("id").where("id", "=", placeId).execute()).toEqual([]);
        expect(await database.selectFrom("campus_visual_scenes").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
        expect(await database.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(before);
      };
      await unchanged(db); await sibling.run(() => unchanged(sibling.database));
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
