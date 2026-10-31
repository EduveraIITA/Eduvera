import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
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
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { feesInvoiceDestination, readFeesReadiness } from "../src/operations/fees-first-readiness.js";
import { RolesService } from "../src/roles/roles.service.js";
import { academicScaffoldingCounts, createLearningOfferingFixture, learningOfferingServices } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/progressive_fees_unused_test";
const target = process.env.FINANCE_SIMULATION_TEST_TARGET_URL;
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
  const ledger = new FeeLedgerService(db, f.core, f.core, f.core, f.core);
  const input = () => ({ command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
    reference: `SYNTHETIC-${randomUUID()}`, description: "Synthetic workshop charge", amount_paise: 3_000_000, due_on: f.today });
  const retained = () => db.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"])
    .where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
  return { ...f, onboarding, auth, setup, ledger, input, retained };
}
describe.skipIf(!enabled)("Fees first operation is source and actor qualified", () => {
  it("records the first charge without academic scaffolding and retains exact issuer continuation, not payment", async () => {
    const f = await fixture();
    await f.onboarding.setGoals(f.owner, { goals: ["fees"] }, request(f.owner));
    const before = await academicScaffoldingCounts(db, f.schoolId);
    expect(before).toMatchObject({ students: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, schedules: 0 });
    expect(await readFeesReadiness(db, f.core, f.owner, f.schoolId)).toMatchObject({ operation: { state: "ready_to_record", action: "record_charge", scope: null } });
    const data = f.input(), initial = await f.retained();
    await expect(f.ledger.issue(f.owner, f.schoolId, { ...data, beneficiary: { ...data.beneficiary, expected_revision: data.beneficiary.expected_revision + 1 } })).rejects.toThrow();
    expect(await f.retained()).toEqual(initial);
    const accepted = await f.ledger.issue(f.owner, f.schoolId, data), path = feesInvoiceDestination({ id: data.invoice_id, person_id: f.learner.id });
    expect(accepted).toMatchObject({ id: data.invoice_id, revision: 1 });
    expect(await f.retained()).toMatchObject({ resume_goal_key: "fees", resume_step: "operating", resume_path: path });
    expect((await f.auth.me(f.owner)).onboarding.resume).toMatchObject({ step: "operating", path });
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual(before);
    expect(await db.selectFrom("fee_payments").select("id").where("invoice_id", "=", data.invoice_id).execute()).toEqual([]);
    const retained = await f.retained();
    expect(await f.ledger.issue(f.owner, f.schoolId, data)).toMatchObject({ replayed: true, id: data.invoice_id });
    expect(await f.retained()).toEqual(retained);
    await f.onboarding.setResume(f.owner, { step: "first_use", goal: "fees", path: "/more/setup/capabilities?task=fees" }, request(f.owner));
    expect(await f.retained()).toMatchObject({ resume_step: "operating", resume_path: path });
    const current = await f.setup.workspace(f.owner, f.schoolId);
    expect(current.working_now.find(item => item.capability === "fees")).toMatchObject({ counts: {}, fees_operation: {
      state: "charge_recorded", action: "view", scope: { kind: "invoice", id: data.invoice_id, person_id: f.learner.id }, source_revision: 1 } });
    await db.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.instructor.actor.id).execute();
    expect((await f.onboarding.workspace(f.instructor.actor)).resume).toMatchObject({ step: "first_use", path: "/areas/fees/ledger" });
    await expect(f.onboarding.setResume(f.instructor.actor, { step: "operating", goal: "fees", path }, request(f.instructor.actor))).rejects.toThrow(/Another administrator/);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
    expect(await readFeesReadiness(db, f.core, f.owner, f.schoolId)).toMatchObject({ operation: { state: "unavailable", scope: null } });
  }, 60_000);

  it("does not replace another selected primary outcome or mark a generic page as operating", async () => {
    const f = await fixture();
    await f.onboarding.setGoals(f.owner, { goals: ["gate", "fees"], primary: "gate" }, request(f.owner));
    const before = await f.retained();
    await f.ledger.issue(f.owner, f.schoolId, f.input());
    expect(await f.retained()).toEqual(before);
    await expect(f.onboarding.setResume(f.owner, { step: "operating", goal: "fees", path: "/areas/fees/ledger" }, request(f.owner))).rejects.toThrow(/recorded charge/);
  }, 60_000);

  it.runIf(Boolean(target))("issues a meaningful branch-only charge through the same service without changing Live, sibling or account continuation", async () => {
    const f = await fixture();
    await f.onboarding.setGoals(f.owner, { goals: ["fees"] }, request(f.owner));
    const before = await f.retained(), now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const native = learningOfferingServices(database), ledger = new FeeLedgerService(database, native.core, native.core, native.core, native.core);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "fees-first-readiness-test", checked_at: now });
        return { database, ledger, core: native.core, namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open(), data = f.input();
      await branch.run(async () => {
        expect(await branch.ledger.issue(f.owner, f.schoolId, data)).toMatchObject({ id: data.invoice_id, revision: 1 });
        expect(await branch.ledger.issue(f.owner, f.schoolId, data)).toMatchObject({ replayed: true });
        expect(await branch.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("correlation_id", "=", data.command_id).where("handler_key", "=", "finance.charge").execute())
          .toEqual([{ state: "accepted", environment_namespace_id: branch.namespace }]);
        expect(await branch.database.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"])
          .where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(before);
        expect(await readFeesReadiness(branch.database, branch.core, f.owner, f.schoolId)).toMatchObject({ operation: { state: "ready_to_record", environment_namespace_id: branch.namespace } });
      });
      expect(await db.selectFrom("fee_invoices").select("id").where("id", "=", data.invoice_id).execute()).toEqual([]);
      await sibling.run(async () => expect(await sibling.database.selectFrom("fee_invoices").select("id").where("id", "=", data.invoice_id).execute()).toEqual([]));
      expect(await f.retained()).toEqual(before);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
