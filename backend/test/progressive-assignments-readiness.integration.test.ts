import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { InstitutionOnboardingService } from "../src/institution-onboarding/institution-onboarding.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { assignmentContinuationPath, readAssignmentsReadiness } from "../src/learning/learning-assignment-readiness.js";
import { RolesService } from "../src/roles/roles.service.js";
import { createLearningOfferingFixture, learningOfferingServices } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Synthetic account fixture only. People, invitations, offering setup and all
// assignment commands use their ordinary owning services. No workers or providers.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/progressive_assignments_unused_test";
const target = process.env.LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as AuthenticatedRequest;

async function fixture() {
  const f = await createLearningOfferingFixture(db), audit = new AuditService(db), provisioner = new ProgressiveWorkspaceProvisioner(f.core);
  const onboarding = new InstitutionOnboardingService(db, audit, provisioner, f.core, f.core);
  const auth = new AuthService(db, audit, new RolesService(db), provisioner, undefined, undefined, undefined, f.core);
  const setup = new ProgressiveSetupService(db, f.core, f.core, f.core);
  const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString() }));
  if (!identity.acting) throw new Error("Expected fixture founder identity.");
  const ownerPerson = await f.people.detail(f.owner, f.schoolId, identity.person_id);
  const retained = () => db.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"])
    .where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
  return { ...f, auth, onboarding, setup, ownerPerson, retained };
}

describe.skipIf(!enabled)("actor-qualified Assignments progressive first use", () => {
  it.runIf(Boolean(target))("captures Activation sources, changes accepted setup only in one COW world and leaves Live progress and its sibling unchanged", async () => {
    const f = await fixture();
    const gate = await f.setup.setup(f.owner, f.schoolId, "gate", { gate_name: "Captured reception", operator: { kind: "current_user", confirm: true } }, request(f.owner));
    await f.onboarding.setGoals(f.owner, { goals: ["assignments", "gate"], primary: "assignments" }, request(f.owner));
    const ownerPerson = await f.people.detail(f.owner, f.schoolId, f.ownerPerson.id);
    const offering = await f.create({ instructor: f.reference(ownerPerson) }), input = f.input(offering.id, { reviewer_id: f.owner.id });
    await f.assignments.save(f.owner, input);
    const before = await f.retained(), now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2);
    const opened: Kysely<Database>[] = [];
    let branchGateId = "";
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const native = learningOfferingServices(database), setup = new ProgressiveSetupService(database, native.core, native.core, native.core);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "assignments-activation-readiness-test", checked_at: now });
        return { ...native, database, setup, namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        const captured = await branch.setup.workspace(f.owner, f.schoolId);
        expect(captured.options.gates).toContainEqual(expect.objectContaining({ label: "Captured reception" }));
        const saved = await branch.assignments.save(f.owner, { ...input, command_id: randomUUID(), expected_revision: 1, title: "Scenario-only instruction draft" });
        const command = request(f.owner);
        const added = await branch.setup.setup(f.owner, f.schoolId, "gate", { gate_name: "Scenario-only side entry", operator: { kind: "current_user", confirm: true } }, command);
        expect(added).toMatchObject({ capability: "gate", status: "working" });
        branchGateId = (added as { resources: { gate_space_id: string } }).resources.gate_space_id;
        const selected = await branch.setup.workspace(f.owner, f.schoolId);
        expect(selected.options.gates.map(item => item.label)).toEqual(["Captured reception", "Scenario-only side entry"]);
        expect(selected.useful_next.find(item => item.capability === "assignments")).toMatchObject({ assignments_operation: {
          actor_user_id: f.owner.id, state: "draft", source_revision: saved.revision, recovery: "source_changed", environment_namespace_id: branch.namespace } });
        expect(await branch.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("correlation_id", "=", command.requestId)
          .where("handler_key", "=", "institution_activation.gate_configure").execute()).toEqual([{ state: "accepted", environment_namespace_id: branch.namespace }]);
        const events = await branch.database.selectFrom("event_outbox").select(["aggregate_id", "payload"]).where("school_id", "=", f.schoolId).where("event_type", "=", "administration.updated").where("aggregate_id", "=", branchGateId).execute();
        expect(events).toEqual([expect.objectContaining({ payload: expect.objectContaining({ action: "progressive.gate.configured" }), aggregate_id: branchGateId })]);
        expect(await branch.database.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"]).where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(before);
      });
      const unchanged = async (database: DatabaseService, setup: ProgressiveSetupService) => {
        const current = await setup.workspace(f.owner, f.schoolId);
        expect(current.options.gates).toEqual([expect.objectContaining({ id: (gate as { resources: { gate_space_id: string } }).resources.gate_space_id, label: "Captured reception" })]);
        expect(await database.selectFrom("learning_assignments").select(["title", "revision"]).where("id", "=", input.assignment_id).executeTakeFirstOrThrow())
          .toEqual({ title: input.title, revision: 1 });
        expect(await database.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"]).where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(before);
        expect(await database.selectFrom("campus_spaces").select("id").where("id", "=", branchGateId).execute()).toEqual([]);
        expect(await database.selectFrom("event_outbox").select("id").where("school_id", "=", f.schoolId).where("aggregate_id", "=", branchGateId).execute()).toEqual([]);
      };
      await unchanged(db, f.setup); await sibling.run(() => unchanged(sibling.database, sibling.setup));
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);

  it("starts from setup-only authority, retains the accepted own draft and advances only on publication", async () => {
    const f = await fixture();
    await f.onboarding.setGoals(f.owner, { goals: ["assignments"] }, request(f.owner));
    expect(await readAssignmentsReadiness(db, f.core, f.owner, f.schoolId)).toMatchObject({ can_setup: true, contexts: [],
      operation: { state: "ready_to_create", scope: null, source_revision: null } });
    const initial = await f.retained();
    await expect(f.assignments.save(f.owner, f.input(randomUUID(), { reviewer_id: f.owner.id }))).rejects.toThrow();
    expect(await f.retained()).toEqual(initial);
    const offering = await f.create({ instructor: f.reference(f.ownerPerson) });
    expect(await f.retained()).toEqual(initial); // Appointing a teacher is not a published assignment.
    const input = f.input(offering.id, { reviewer_id: f.owner.id });
    const saved = await f.assignments.save(f.owner, input);
    const source = await db.selectFrom("learning_assignments").selectAll().where("id", "=", input.assignment_id).executeTakeFirstOrThrow();
    const path = assignmentContinuationPath(source);
    expect(await f.retained()).toMatchObject({ resume_goal_key: "assignments", resume_step: "first_use", resume_path: path });
    expect((await f.auth.me(f.owner)).onboarding.resume).toMatchObject({ step: "first_use", path,
      continuation: { kind: "learning_assignment", actor_user_id: f.owner.id, school_id: f.schoolId, source_id: input.assignment_id, source_revision: saved.revision } });
    const after = await f.retained();
    expect(await f.assignments.save(f.owner, input)).toMatchObject({ replayed: true });
    expect(await f.retained()).toEqual(after);
    await f.onboarding.setResume(f.owner, { step: "first_use", goal: "assignments", path: "/more/setup/capabilities?task=assignments" }, request(f.owner));
    expect(await f.retained()).toMatchObject({ resume_step: "first_use", resume_path: path });
    await expect(f.onboarding.setResume(f.owner, { step: "operating", goal: "assignments", path }, request(f.owner))).rejects.toThrow(/Publish/);
    const revised = await f.assignments.save(f.owner, { ...input, command_id: randomUUID(), expected_revision: saved.revision, title: "Reviewed loop assignment" });
    await f.onboarding.setResume(f.owner, { step: "first_use", goal: "assignments", path }, request(f.owner));
    expect((await f.auth.me(f.owner)).onboarding.resume).toMatchObject({ step: "first_use", path, recovery: "source_changed",
      continuation: { source_revision: revised.revision } });
    const workspace = await f.setup.workspace(f.owner, f.schoolId), cards = [...workspace.working_now, ...workspace.useful_next, ...workspace.available_anytime];
    expect(cards.map(card => card.capability).sort()).toEqual(["accommodation", "assignments", "attendance", "dining", "examinations", "facilities", "fees", "gate", "messages", "performance", "resources", "staff", "timetable"]);
    expect(cards.find(card => card.capability === "assignments")).toMatchObject({ status: "needs_setup", counts: {}, assignments_operation: { state: "draft", source_revision: revised.revision } });
    const detail = await f.assignments.detail(f.owner, input.assignment_id);
    if (detail.context !== "offering" || !detail.publication_preview) throw new Error("Expected publication preview.");
    const published = await f.assignments.publish(f.owner, input.assignment_id, { command_id: randomUUID(), expected_revision: revised.revision, audience_hash: detail.publication_preview.audience_hash });
    expect(await f.retained()).toMatchObject({ resume_goal_key: "assignments", resume_step: "operating", resume_path: assignmentContinuationPath({ ...source, revision: published.revision }) });
    expect((await f.auth.me(f.owner)).onboarding.resume).not.toHaveProperty("continuation");
    const current = await f.setup.workspace(f.owner, f.schoolId);
    expect(current.working_now.find(card => card.capability === "assignments")).toMatchObject({ assignments_operation: { state: "published", action: "view" } });
  }, 60_000);

  it("keeps other owners and primary goals intact and rechecks an ended appointment on every resume read", async () => {
    const f = await fixture();
    await f.onboarding.setGoals(f.owner, { goals: ["gate", "assignments"], primary: "gate" }, request(f.owner));
    const offering = await f.create({ instructor: f.reference(f.ownerPerson) }), input = f.input(offering.id, { reviewer_id: f.owner.id });
    const before = await f.retained();
    await f.assignments.save(f.owner, input);
    expect(await f.retained()).toEqual(before);
    await f.onboarding.setGoals(f.owner, { goals: ["assignments"] }, request(f.owner));
    const next = f.input(offering.id, { reviewer_id: f.owner.id });
    await f.assignments.save(f.owner, next);
    const source = await db.selectFrom("learning_assignments").selectAll().where("id", "=", next.assignment_id).executeTakeFirstOrThrow();
    const path = assignmentContinuationPath(source);
    await db.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.instructor.actor.id).execute();
    expect((await f.onboarding.workspace(f.instructor.actor)).resume).toMatchObject({ step: "first_use", path: "/areas/messages/assignments" });
    await expect(f.onboarding.setResume(f.instructor.actor, { step: "first_use", goal: "assignments", path: "/areas/messages/assignments" }, request(f.instructor.actor))).rejects.toThrow(/Another administrator/);
    const appointment = await db.selectFrom("learning_offering_teaching_assignments").select(["id", "revision"]).where("offering_id", "=", offering.id).executeTakeFirstOrThrow();
    await f.offerings.endInstructor(f.owner, offering.id, appointment.id, { command_id: randomUUID(), expected_revision: appointment.revision, reason: "Teaching responsibility handed over." });
    expect((await f.auth.me(f.owner)).onboarding.resume).toMatchObject({ step: "first_use", path: "/areas/messages/assignments" });
    expect((await f.auth.me(f.owner)).onboarding.resume).not.toHaveProperty("continuation");
    await expect(f.onboarding.setResume(f.owner, { step: "first_use", goal: "assignments", path }, request(f.owner))).rejects.toThrow(/accessible assignment/);
    expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM progressive_onboarding_audits WHERE workspace_id=(SELECT id FROM progressive_onboarding_workspaces WHERE school_id=${f.schoolId}::uuid)
      AND metadata->>'source'='accepted_assignment_publication'`.execute(db)).rows[0]!.total).toBe(0);
  }, 60_000);
});
