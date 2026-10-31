import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthenticatedRequest } from "../src/common/request.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { arrangementBasis, arrangementInvoice, financeHash } from "../src/operations/finance-arrangements.store.js";
import { operationalFeeAccess } from "../src/operations/operational-fee-access.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { createFinanceArrangementsFixture, financeArrangementServices } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/person_fees_unused_test";
const targetUrl = process.env.PERSON_FEES_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
function ledger(database: DatabaseService, core: ReturnType<typeof financeArrangementServices>["core"]) { return new FeeLedgerService(database, core, core, core, core); }
async function errorResponse(action: () => Promise<unknown>) {
  try { await action(); } catch (error) { if (error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function") return error.getResponse(); throw error; }
  throw new Error("Expected an unsuccessful command.");
}
describe.skipIf(!enabled)("canonical-person fee beneficiaries", () => {
  it("issues a real immutable charge without academic scaffolding, retaining exact command acceptance after a person change", async () => {
    const f = await createLearningOfferingFixture(db), service = ledger(db, f.core);
    const input = { command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
      reference: `NATIVE-${randomUUID()}`, description: "Robotics activity", amount_paise: 3_000_000, due_on: f.today };
    const receipt = await service.issue(f.owner, f.schoolId, input);
    expect(receipt).toEqual({ id: input.invoice_id, invoice_id: input.invoice_id, revision: 1, replayed: false });
    expect(await service.issue(f.owner, f.schoolId, input)).toMatchObject({ ...receipt, replayed: true });
    expect(await service.confirmation(f.owner, f.schoolId, input.invoice_id, input.command_id)).toMatchObject({ handler: "finance.charge", source_id: input.invoice_id, command_id: input.command_id,
      action: "issue", state: "accepted", result: receipt });
    await expect(service.confirmation(f.owner, f.schoolId, randomUUID(), input.command_id)).rejects.toThrow(/does not belong/);
    await expect(service.issue(f.owner, f.schoolId, { ...input, amount_paise: 4_000_000 })).rejects.toThrow(/different/);
    await expect(service.issue(f.learner.actor, f.schoolId, { ...input, command_id: randomUUID(), invoice_id: randomUUID() })).rejects.toThrow();
    await expect(service.confirmation(f.learner.actor, f.schoolId, input.invoice_id, input.command_id)).rejects.toThrow();
    expect(await db.selectFrom("fee_invoices").select(["id", "student_id", "person_id", "selected_person_revision", "amount_paise"]).where("id", "=", input.invoice_id).executeTakeFirstOrThrow())
      .toEqual({ id: input.invoice_id, student_id: null, person_id: f.learner.id, selected_person_revision: f.learner.person.revision, amount_paise: 3_000_000 });
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
    const operations = new OperationsService(db, {} as never, undefined, undefined, service);
    expect((await operations.fees(f.owner, f.schoolId)).invoices).toContainEqual(expect.objectContaining({ id: input.invoice_id,
      beneficiary: { kind: "person", person_id: f.learner.id, student_id: null, name: "Sana Offering Learner" }, balance_paise: 3_000_000 }));
    await expect(operations.fees(f.learner.actor, f.schoolId, undefined, f.learner.id)).rejects.toThrow(/explicit access/);
    expect((await service.accounts(f.learner.actor, f.schoolId)).items).toEqual([]);
    await expect(operations.payment(f.owner, f.schoolId, input.invoice_id, { amount_paise: 1_000_000, method: "cash", reference: randomUUID(), idempotency_key: randomUUID() }))
      .rejects.toThrow(/independent verification/);
    await f.people.correctName({ authUser: f.owner, requestId: randomUUID() } as AuthenticatedRequest, f.schoolId, f.learner.id,
      { first_name: "Sana Corrected Name", expected_revision: f.learner.person.revision, reason: "Synthetic correction for retained receipt test", idempotency_key: randomUUID() });
    expect(await service.issue(f.owner, f.schoolId, input)).toMatchObject({ id: input.invoice_id, replayed: true });
    const next = { ...input, command_id: randomUUID(), invoice_id: randomUUID(), reference: `NATIVE-${randomUUID()}` };
    expect(await errorResponse(() => service.issue(f.owner, f.schoolId, next))).toMatchObject({ code: "finance.charge_person_obsolete", fields: { charge_obsolete: {
      confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "finance.charge", command_id: next.command_id, invoice_id: next.invoice_id,
      person_id: f.learner.id, expected_person_revision: input.beneficiary.expected_revision } } });
    expect(await service.confirmation(f.owner, f.schoolId, next.invoice_id, next.command_id)).toMatchObject({ state: "not_found" });
    expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM fee_payments WHERE invoice_id=${input.invoice_id}::uuid`.execute(db)).rows[0]!.total).toBe(0);
    const safe = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify(safe)).not.toContain("Robotics activity"); expect(JSON.stringify(safe)).not.toContain(input.reference);
  }, 60_000);

  it("extends existing Finance authority/entitlement without changing legacy ledger bases and immediately revokes native private access", async () => {
    const f = await createFinanceArrangementsFixture(db), service = ledger(db, f.core);
    const person = await db.selectFrom("school_people").select(["id", "revision"]).where("id", "=", f.learner.personId).executeTakeFirstOrThrow();
    const input = { command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: person.id, expected_revision: person.revision },
      reference: `PERSON-${randomUUID()}`, description: "Optional workshop", amount_paise: 15_000, due_on: f.day };
    await f.run(() => service.issue(f.owner, f.schoolId, input));
    const oldBasis = await db.transaction().execute(async tx => arrangementBasis(tx, await arrangementInvoice(tx, f.schoolId, f.invoiceId)));
    expect(oldBasis).toEqual({ invoice_id: f.invoiceId, student_id: f.learner.id, amount_paise: 3_000_000, credited_paise: 0, paid_paise: 0, refunded_paise: 0,
      balance_paise: 3_000_000, credits: [], payments: [], refunds: [] });
    const newBasis = await db.transaction().execute(async tx => arrangementBasis(tx, await arrangementInvoice(tx, f.schoolId, input.invoice_id)));
    expect(newBasis).toMatchObject({ context_kind: "person", basis_version: 2, person_id: person.id, balance_paise: 15_000 }); expect(newBasis).not.toHaveProperty("student_id");
    expect(financeHash(oldBasis)).toBe(financeHash({ invoice_id: f.invoiceId, student_id: f.learner.id, amount_paise: 3_000_000, credited_paise: 0, paid_paise: 0, refunded_paise: 0,
      balance_paise: 3_000_000, credits: [], payments: [], refunds: [] }));
    const entitlement = { command_id: randomUUID(), entitlement_id: randomUUID(), expected_revision: 0, valid_from: f.day, valid_until: f.due(30), attested_adult_self_payer: true };
    await f.run(() => f.arrangements.enableSelfPayer(f.owner, f.schoolId, input.invoice_id, entitlement));
    const own = () => f.reads.workspace(f.learner.actor, f.schoolId, undefined, input.invoice_id, undefined, person.id);
    const account = await f.run(own);
    expect(account.invoices[0]).toMatchObject({ id: input.invoice_id, person_id: person.id, student_id: null, can_request: true, can_enable_self_payer: false });
    expect(await f.run(() => f.reads.discovery(f.learner.actor, f.schoolId))).toMatchObject({ can_record_charge: false, accounts: [{ person_id: person.id }] });
    const nativeRequest = { command_id: randomUUID(), request_id: randomUUID(), expected_revision: 1, basis_hash: account.invoices[0]!.basis_hash,
      basis_revision: account.invoices[0]!.basis_revision, schedule: [{ amount_paise: 15_000, due_on: f.due(2) }] };
    await f.run(() => f.arrangements.request(f.learner.actor, f.schoolId, input.invoice_id, nativeRequest));
    await f.run(() => f.arrangements.decide(f.owner, f.schoolId, nativeRequest.request_id, { command_id: randomUUID(), expected_revision: 2, decision: "approved" }));
    expect((await f.run(own)).invoices[0]).toMatchObject({ balance_paise: 15_000, agreement: { state: "active" } });
    await f.run(() => f.arrangements.revokeSelfPayer(f.owner, f.schoolId, input.invoice_id, { command_id: randomUUID(), expected_revision: 3,
      entitlement_id: entitlement.entitlement_id, reason: "Synthetic explicit revocation" }));
    await expect(f.run(own)).rejects.toThrow(/explicit access/);
    expect((await f.run(() => service.accounts(f.learner.actor, f.schoolId))).items.filter(row => row.kind === "person")).toEqual([]);
    expect((await f.run(() => f.reads.discovery(f.learner.actor, f.schoolId))).accounts).toEqual([]);
    const event = { invoice_id: input.invoice_id, person_id: person.id };
    expect((await sql<{ allowed: boolean }>`SELECT fee_invoice_event_is_authorized(${f.schoolId}::uuid,${JSON.stringify(event)}::jsonb,${f.learner.actor.id}::uuid) AS allowed`.execute(db)).rows[0]!.allowed).toBe(false);
    const operations = new OperationsService(db, {} as never, undefined, undefined, service);
    await expect(f.run(() => operations.fees(f.learner.actor, f.schoolId, undefined, person.id, input.invoice_id))).rejects.toThrow(/explicit access/);
  }, 60_000);

  it("enforces native person/invoice consistency without relaxing same-campus legacy constraints", async () => {
    const f = await createLearningOfferingFixture(db), service = ledger(db, f.core);
    const input = { command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
      reference: `CONSTRAINT-${randomUUID()}`, description: "Activity charge", amount_paise: 100, due_on: f.today };
    await service.issue(f.owner, f.schoolId, input);
    await expect(sql`INSERT INTO fee_invoices(school_id,person_id,reference,description,amount_paise,due_on,created_by)
      VALUES(${f.schoolId}::uuid,${f.learner.id}::uuid,${randomUUID()},'Missing selected revision',100,${f.today}::date,${f.owner.id}::uuid)`.execute(db)).rejects.toThrow();
    await expect(sql`INSERT INTO fee_invoice_self_payer_entitlements(id,school_id,invoice_id,invoice_person_id,user_id,person_id,valid_from,valid_until,adult_self_payer_attested,
      approved_by,authority_receipt,stream_revision,command_id,created_at) VALUES(${randomUUID()}::uuid,${f.schoolId}::uuid,${input.invoice_id}::uuid,${f.secondLearner.id}::uuid,
      ${f.secondLearner.actor.id}::uuid,${f.secondLearner.id}::uuid,${f.today}::date,${f.today}::date,true,${f.owner.id}::uuid,'{}'::jsonb,1,${randomUUID()}::uuid,now())`.execute(db)).rejects.toThrow();
    await expect(sql`UPDATE fee_invoices SET amount_paise=200 WHERE id=${input.invoice_id}::uuid`.execute(db)).rejects.toThrow(/cannot/);
    const payload = { invoice_id: input.invoice_id, person_id: f.learner.id };
    const allowed = () => sql<{ allowed: boolean }>`SELECT fee_invoice_event_is_authorized(${f.schoolId}::uuid,${JSON.stringify(payload)}::jsonb,${f.owner.id}::uuid) AS allowed`.execute(db).then(result => result.rows[0]!.allowed);
    expect(await allowed()).toBe(true);
    const endpoint = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString() }));
    if (!endpoint.acting) throw new Error("Synthetic founder endpoint required.");
    await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: endpoint.endpoint_id, actor_user_id: f.owner.id,
      expected_revision: 1, effective_at: new Date().toISOString(), disposition: "ended", reason: "Synthetic Finance event revocation",
      source_domain: "people", source_record_id: endpoint.person_id, source_revision: 2, idempotency_key: `person-fee-admin-end:${randomUUID()}` }));
    expect(await allowed()).toBe(false);
    await expect(service.issue(f.owner, f.schoolId, input)).rejects.toThrow(/person\/account link/);
    await expect(new OperationsService(db, {} as never, undefined, undefined, service).fees(f.owner, f.schoolId)).rejects.toThrow(/person\/account link/);
  }, 60_000);

  it("does not broaden resource-only Finance exceptions into institution-wide native charges, private reads or events", async () => {
    const f = await createFinanceArrangementsFixture(db), service = ledger(db, f.core);
    const person = await db.selectFrom("school_people").select(["id", "revision"]).where("id", "=", f.learner.personId).executeTakeFirstOrThrow();
    const input = { command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: person.id, expected_revision: person.revision },
      reference: `SCOPED-${randomUUID()}`, description: "Private activity charge", amount_paise: 500, due_on: f.day };
    await f.run(() => service.issue(f.owner, f.schoolId, input));
    const exception = (await sql<{ id: string }>`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
      VALUES(${f.schoolId}::uuid,${f.otherTeacher.id}::uuid,'fees.manage','Synthetic restricted resource coverage','manual','assigned_resources',${f.day}::date,${f.due(30)}::date,${f.due(15)}::date,${f.owner.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
    const own = new OperationsService(db, {} as never, undefined, undefined, service);
    const allowed = () => sql<{ allowed: boolean }>`SELECT fee_invoice_event_is_authorized(${f.schoolId}::uuid,${JSON.stringify({ invoice_id: input.invoice_id, person_id: person.id })}::jsonb,
      ${f.otherTeacher.id}::uuid) AS allowed`.execute(db).then(result => result.rows[0]!.allowed);
    await expect(f.run(() => db.transaction().execute(tx => operationalFeeAccess(tx, f.otherTeacher.id, f.schoolId)))).rejects.toThrow(/institution-scoped/);
    await expect(f.run(() => service.issue(f.otherTeacher, f.schoolId, { ...input, command_id: randomUUID(), invoice_id: randomUUID(), reference: randomUUID() }))).rejects.toThrow(/institution-scoped/);
    await expect(f.run(() => own.fees(f.otherTeacher, f.schoolId))).rejects.toThrow(/institution-scoped/);
    await expect(f.run(() => own.fees(f.otherTeacher, f.schoolId, undefined, person.id))).rejects.toThrow();
    expect(await allowed()).toBe(false);
    await sql`UPDATE school_access_exceptions SET scope_kind='institution',revision=revision+1 WHERE id=${exception.id}::uuid`.execute(db);
    const access = await f.run(() => db.transaction().execute(tx => operationalFeeAccess(tx, f.otherTeacher.id, f.schoolId, true)));
    expect(access.sources).toContainEqual(expect.objectContaining({ source_id: exception.id, source_type: "exception", context_kind: "institution", scope_id: f.schoolId, revision: 2 }));
    expect((await f.run(() => own.fees(f.otherTeacher, f.schoolId))).invoices.some(invoice => invoice.id === input.invoice_id)).toBe(true);
    expect(await allowed()).toBe(true);
    await sql`UPDATE school_access_exceptions SET status='revoked',revision=revision+1,revoked_by=${f.owner.id}::uuid,
      revoked_at=${f.now}::timestamptz,revocation_reason='Synthetic explicit Finance scope revocation' WHERE id=${exception.id}::uuid`.execute(db);
    expect(await allowed()).toBe(false);
    expect((await f.run(() => f.reads.discovery(f.otherTeacher, f.schoolId))).can_record_charge).toBe(false);
  }, 60_000);

  it.runIf(Boolean(targetUrl))("issues and replays a person charge only inside one isolated COW world", async () => {
    const f = await createLearningOfferingFixture(db), live = ledger(db, f.core), now = new Date().toISOString();
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId,
          scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService; opened.push(database);
        const services = financeArrangementServices(database), service = ledger(database, services.core);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "person-fees-test", checked_at: now });
        return { db: database, service, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      const input = { command_id: randomUUID(), invoice_id: randomUUID(), beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
        reference: `COW-${randomUUID()}`, description: "Branch-only fictional workshop", amount_paise: 350_000, due_on: f.today };
      await branch.run(async () => {
        const receipt = await branch.service.issue(f.owner, f.schoolId, input);
        expect(await branch.service.issue(f.owner, f.schoolId, input)).toMatchObject({ ...receipt, replayed: true });
        expect(await branch.service.confirmation(f.owner, f.schoolId, input.invoice_id, input.command_id)).toMatchObject({ state: "accepted" });
        expect(await branch.db.selectFrom("fee_invoices").select(["person_id", "student_id"]).where("id", "=", input.invoice_id).executeTakeFirstOrThrow())
          .toEqual({ person_id: f.learner.id, student_id: null });
        expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM fee_payments WHERE invoice_id=${input.invoice_id}::uuid`.execute(branch.db)).rows[0]!.total).toBe(0);
      });
      expect(await db.selectFrom("fee_invoices").select("id").where("id", "=", input.invoice_id).executeTakeFirst()).toBeUndefined();
      expect(await live.confirmation(f.owner, f.schoolId, input.invoice_id, input.command_id)).toMatchObject({ state: "not_found" });
      await sibling.run(async () => {
        expect(await sibling.db.selectFrom("fee_invoices").select("id").where("id", "=", input.invoice_id).executeTakeFirst()).toBeUndefined();
        expect(await sibling.service.confirmation(f.owner, f.schoolId, input.invoice_id, input.command_id)).toMatchObject({ state: "not_found" });
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
