import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { arrangementInvoice, financeHash } from "../src/operations/finance-arrangements.store.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { createFinanceArrangementsFixture, financeArrangementServices } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/finance_unused_test";
const targetUrl = process.env.FINANCE_ARRANGEMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const money = (database: DatabaseService, invoiceId: string) => sql<{ invoices: number; payments: number; credits: number; refunds: number }>`SELECT
  (SELECT count(*)::int FROM fee_invoices WHERE id=${invoiceId}::uuid) AS invoices,
  (SELECT count(*)::int FROM fee_payments WHERE invoice_id=${invoiceId}::uuid) AS payments,
  (SELECT count(*)::int FROM fee_invoice_credits WHERE invoice_id=${invoiceId}::uuid) AS credits,
  (SELECT count(*)::int FROM fee_refunds WHERE invoice_id=${invoiceId}::uuid) AS refunds`.execute(database).then(result => result.rows[0]);

describe.skipIf(!enabled)("private Finance instalment agreements through current Core and native ledger", () => {
  it("routes one guardian proposal, records one exact decision/replay and never creates charges, payments or receipts", async () => {
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      const before = await money(db, f.invoiceId), input = await f.input();
      const submitted = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input);
      expect(await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input)).toMatchObject({ id: submitted.id, replayed: true });
      await expect(f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, { ...input, note: "Different private explanation" })).rejects.toThrow("different fee work");
      const own = await f.reads.work(f.guardian, f.schoolId), review = await f.reads.work(f.owner, f.schoolId);
      expect(own.waiting).toHaveLength(1); expect(own.needs_me).toHaveLength(0);
      expect(review.needs_me).toHaveLength(1); expect(review.needs_me[0]).toMatchObject({ id: submitted.id, due_at: null, reviewer: { user_id: f.owner.id }, message_id: expect.any(String) });
      expect(JSON.stringify({ own, review })).not.toContain("Private");
      expect((await f.reads.work(f.otherTeacher, f.schoolId)).needs_me).toHaveLength(0);
      await expect(f.reads.workspace(f.otherTeacher, f.schoolId, f.learner.id, f.invoiceId)).rejects.toThrow("relationship");
      const current = await f.account(), decision = { command_id: randomUUID(), expected_revision: current.stream_revision, decision: "approved", response: "Agreed dates recorded." };
      const accepted = await f.arrangements.decide(f.owner, f.schoolId, String(submitted.id), decision);
      expect(await f.arrangements.decide(f.owner, f.schoolId, String(submitted.id), decision)).toMatchObject({ id: accepted.id, replayed: true });
      expect((await f.account()).agreement).toMatchObject({ state: "active", next_due_on: f.due(1), rows: [{ remaining_paise: 1_000_000 }, { remaining_paise: 2_000_000 }] });
      expect(await money(db, f.invoiceId)).toEqual(before);
      expect((await f.reads.work(f.guardian, f.schoolId)).waiting).toEqual([]);
      expect((await f.reads.work(f.owner, f.schoolId)).needs_me).toEqual([]);
      const payloads = (await db.selectFrom("event_outbox").select("payload").where("aggregate_id", "=", String(submitted.id)).execute()).map(row => row.payload);
      expect(JSON.stringify(payloads)).not.toContain("Private");
      expect((await db.selectFrom("fee_invoices").select("due_on").where("id", "=", f.invoiceId).executeTakeFirstOrThrow()).due_on).toBe(f.day);
    });
  });
  it("enables only explicitly attested dated invoice self-service and preserves withdrawal after revocation", async () => {
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      await expect(f.arrangements.request(f.learner.actor, f.schoolId, f.invoiceId, await f.input())).rejects.toThrow("explicitly enabled");
      const grant = { command_id: randomUUID(), expected_revision: 0, entitlement_id: randomUUID(), valid_from: f.day, valid_until: f.due(60), attested_adult_self_payer: true };
      await expect(f.arrangements.enableSelfPayer(f.otherTeacher, f.schoolId, f.invoiceId, grant)).rejects.toThrow("Finance access");
      await expect(f.arrangements.enableSelfPayer(f.owner, f.schoolId, f.invoiceId, { ...grant, attested_adult_self_payer: false })).rejects.toThrow();
      await f.arrangements.enableSelfPayer(f.owner, f.schoolId, f.invoiceId, grant);
      expect(await f.arrangements.enableSelfPayer(f.owner, f.schoolId, f.invoiceId, grant)).toMatchObject({ id: grant.entitlement_id, replayed: true });
      expect((await f.account(f.learner.actor)).can_request).toBe(true);
      await expect(f.arrangements.enableSelfPayer(f.owner, f.schoolId, f.invoiceId, { ...grant, command_id: randomUUID(), entitlement_id: randomUUID(),
        expected_revision: 1, valid_from: f.due(61), valid_until: f.due(90) })).rejects.toThrow("active or scheduled");
      const submitted = await f.arrangements.request(f.learner.actor, f.schoolId, f.invoiceId, await f.input());
      const current = await f.account(f.owner);
      await f.arrangements.revokeSelfPayer(f.owner, f.schoolId, f.invoiceId, { command_id: randomUUID(), expected_revision: current.stream_revision,
        entitlement_id: grant.entitlement_id, reason: "Self-service access ended" });
      expect((await f.account(f.learner.actor)).can_request).toBe(false);
      const withdraw = { command_id: randomUUID(), expected_revision: (await f.account(f.learner.actor)).stream_revision };
      await f.arrangements.withdraw(f.learner.actor, f.schoolId, String(submitted.id), withdraw);
      expect(await f.arrangements.withdraw(f.learner.actor, f.schoolId, String(submitted.id), withdraw)).toMatchObject({ replayed: true });
      expect((await f.account(f.learner.actor)).requests[0]).toMatchObject({ status: "withdrawn" });
      await expect(f.arrangements.request(f.learner.actor, f.schoolId, f.invoiceId, await f.input())).rejects.toThrow("explicitly enabled");
      expect(await money(db, f.invoiceId)).toMatchObject({ payments: 0, invoices: 1 });
    });
  });
  it("rejects stale ledger proposals and approvals, while allowing an explained decline and a fresh balance", async () => {
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      const stale = await f.input(), operations = new OperationsService(db, createStaffCoverageReconciliationTestDouble());
      await operations.payment(f.owner, f.schoolId, f.invoiceId, { amount_paise: 100_000, method: "cash", reference: `QA-${randomUUID()}`, idempotency_key: randomUUID() });
      await expect(f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, stale)).rejects.toThrow("balance changed");
      const input = await f.input({ schedule: [{ amount_paise: 900_000, due_on: f.due(1) }, { amount_paise: 2_000_000, due_on: f.due(30) }] });
      const submitted = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input);
      await operations.payment(f.owner, f.schoolId, f.invoiceId, { amount_paise: 100_000, method: "cash", reference: `QA-${randomUUID()}`, idempotency_key: randomUUID() });
      const current = await f.account(f.owner);
      expect(current.requests[0]).toMatchObject({ can_approve: false, can_decide: true, basis_changed: true });
      await expect(f.arrangements.decide(f.owner, f.schoolId, String(submitted.id), { command_id: randomUUID(), expected_revision: current.stream_revision, decision: "approved" })).rejects.toThrow("ledger changed");
      await f.arrangements.decide(f.owner, f.schoolId, String(submitted.id), { command_id: randomUUID(), expected_revision: current.stream_revision, decision: "rejected", response: "The balance changed. Propose the remaining amount." });
      expect((await f.account()).balance_paise).toBe(2_800_000);
      const replacement = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, await f.input({ schedule: [{ amount_paise: 2_800_000, due_on: f.due(14) }] }));
      expect(replacement.id).not.toBe(submitted.id);
    });
  });
  it("fails closed for missing authority, amount limits, changed route, stale source and ended current identities", async () => {
    const missing = await createFinanceArrangementsFixture(db, { adopt: false });
    await missing.run(async () => {
      expect((await missing.reads.workspace(missing.owner, missing.schoolId)).review_route.state).toBe("unavailable");
      await expect(missing.arrangements.request(missing.guardian, missing.schoolId, missing.invoiceId, await missing.input())).rejects.toThrow();
      expect((await sql`SELECT id FROM fee_instalment_requests WHERE school_id=${missing.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    });
    const limited = await createFinanceArrangementsFixture(db, { maxAmountInr: 5000 });
    await limited.run(async () => { await expect(limited.arrangements.request(limited.guardian, limited.schoolId, limited.invoiceId, await limited.input())).rejects.toThrow("exceeds"); });
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      const submitted = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, await f.input());
      await db.updateTable("institution_authority_mandates").set({ status: "revoked" }).where("id", "=", f.mandateId).execute();
      expect((await f.reads.work(f.guardian, f.schoolId)).waiting[0]).toMatchObject({ state: "needs_reassignment", reviewer: { user_id: f.owner.id } });
      expect((await f.reads.work(f.owner, f.schoolId)).needs_me).toEqual([]);
      await expect(f.arrangements.decide(f.owner, f.schoolId, String(submitted.id), { command_id: randomUUID(), expected_revision: 1, decision: "approved" })).rejects.toThrow();
      await expect(f.arrangements.withdraw(f.guardian, f.schoolId, String(submitted.id), { command_id: randomUUID(), expected_revision: 0 })).rejects.toThrow("changed");
      await f.arrangements.withdraw(f.guardian, f.schoolId, String(submitted.id), { command_id: randomUUID(), expected_revision: 1 });
      const endpoint = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.guardian.id, at: f.now }));
      if (!endpoint.acting) throw new Error("Fixture guardian identity required.");
      await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: endpoint.endpoint_id, actor_user_id: f.owner.id,
        expected_revision: 1, effective_at: f.now, disposition: "ended", reason: "Synthetic identity ended", source_domain: "people", source_record_id: endpoint.person_id,
        source_revision: 1, idempotency_key: `finance-ended:${randomUUID()}` }));
      await expect(f.reads.workspace(f.guardian, f.schoolId, f.learner.id, f.invoiceId)).rejects.toThrow("person/account link");
      expect(await f.reads.work(f.guardian, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      await expect(f.reads.workspace({ ...f.owner, active_school_id: randomUUID() }, f.schoolId)).rejects.toThrow("campus");
    });
  });
  it("rolls back native request, neutral outbox and coordination together when the Core outcome fails", async () => {
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      const input = await f.input(), failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected fee outcome failure"));
      await expect(f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input)).rejects.toThrow("Injected fee outcome failure"); failure.mockRestore();
      expect((await f.account()).requests).toEqual([]);
      expect((await db.selectFrom("event_outbox").select("id").where("aggregate_id", "=", input.request_id).execute())).toEqual([]);
      expect((await f.reads.work(f.owner, f.schoolId)).needs_me).toEqual([]);
      expect((await money(db, f.invoiceId))?.payments).toBe(0);
      await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input);
      expect((await f.account()).requests).toHaveLength(1);
    });
  });
  it("confirms the exact actor/source receipt before stale basis checks and never unlocks an existing pending command", async () => {
    const f = await createFinanceArrangementsFixture(db);
    await f.run(async () => {
      const input = await f.input(), accepted = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input);
      await new OperationsService(db, createStaffCoverageReconciliationTestDouble()).payment(f.owner, f.schoolId, f.invoiceId,
        { amount_paise: 100_000, method: "cash", reference: `RECOVERY-${randomUUID()}`, idempotency_key: randomUUID() });
      const confirmed = await f.reads.workspace(f.guardian, f.schoolId, f.learner.id, f.invoiceId, input.command_id);
      expect(confirmed.confirmation).toMatchObject({ state: "accepted", result: { id: accepted.id } });
      expect(await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input)).toMatchObject({ id: accepted.id, replayed: true });
      expect((await f.reads.workspace(f.owner, f.schoolId, f.learner.id, f.invoiceId, input.command_id)).confirmation).toEqual({ state: "not_found" });
      const other = await db.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id, reference: `OTHER-${randomUUID()}`,
        description: "Separate fictional obligation", amount_paise: 1000, due_on: f.day, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
      await expect(f.reads.workspace(f.guardian, f.schoolId, f.learner.id, other.id, input.command_id)).rejects.toThrow("does not belong");
    });
    const pending = await createFinanceArrangementsFixture(db);
    await pending.run(async () => {
      const input = await pending.input();
      // Deliberately persist an incomplete Core command via its normal port.
      // Native service writes otherwise complete or roll back in one transaction.
      await db.transaction().execute(async tx => {
        const campus = await pending.access.campus(tx, pending.guardian, pending.schoolId);
        await pending.commands.prepare(tx, pending.guardian, campus.actor, await arrangementInvoice(tx, pending.schoolId, pending.invoiceId),
          "request", input, 0, { relationship: "guardian", person_id: campus.actor.person_id, entitlement_id: null });
      });
      expect((await pending.reads.workspace(pending.guardian, pending.schoolId, pending.learner.id, pending.invoiceId, input.command_id)).confirmation).toEqual({ state: "pending" });
      await expect(pending.arrangements.request(pending.guardian, pending.schoolId, pending.invoiceId, input)).rejects.toThrow("awaiting confirmation");
      await new OperationsService(db, createStaffCoverageReconciliationTestDouble()).payment(pending.owner, pending.schoolId, pending.invoiceId,
        { amount_paise: 100, method: "cash", reference: `PENDING-${randomUUID()}`, idempotency_key: randomUUID() });
      await expect(pending.arrangements.request(pending.guardian, pending.schoolId, pending.invoiceId, input)).rejects.toThrow("awaiting confirmation");
      expect((await pending.account()).requests).toEqual([]);
    });
  });
  it("projects current agreed dates and only overdue instalments for self and guardian reads, then flags credit/refund divergence", async () => {
    const f = await createFinanceArrangementsFixture(db, { invoiceDueDays: -14 });
    await f.run(async () => {
      const operations = new OperationsService(db, createStaffCoverageReconciliationTestDouble());
      expect((await operations.fees(f.learner.actor, f.schoolId, f.learner.id)).invoices[0]).toMatchObject({ original_due_on: f.due(-14),
        collection_due_on: f.due(-14), collection_overdue_paise: 3_000_000, payment_plan_state: "none" });
      expect((await f.reads.dueWork(f.learner.actor, f.schoolId, f.learner.id, "self"))[0]).toMatchObject({ priority: "urgent" });
      const submitted = await f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, await f.input());
      await f.arrangements.decide(f.owner, f.schoolId, submitted.id, { command_id: randomUUID(), expected_revision: 1, decision: "approved" });
      const ledger = await operations.fees(f.guardian, f.schoolId, f.learner.id);
      expect(ledger.invoices[0]).toMatchObject({ due_on: f.due(-14), original_due_on: f.due(-14), collection_due_on: f.due(1),
        collection_due_amount_paise: 1_000_000, collection_overdue_paise: 0, payment_plan_state: "active" });
      expect(JSON.stringify(ledger)).not.toMatch(/Private|authority_receipt|coordination_receipt|decision_response|ledger_basis|submitter_person/u);
      const selfDue = (await f.reads.dueWork(f.learner.actor, f.schoolId, f.learner.id, "self"))[0]!;
      expect(selfDue).toMatchObject({ priority: "normal", status_label: `Agreed date ${f.due(1)}` });
      expect(selfDue.due_at).toBe(`${f.due(1)}T23:59:59.999Z`);
      const laterNow = new Date(Date.parse(f.now) + 2 * 86_400_000).toISOString();
      await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(laterNow), nowIso: () => laterNow } }), async () => {
        expect((await operations.fees(f.owner, f.schoolId)).invoices[0]).toMatchObject({ collection_overdue_paise: 1_000_000 });
      });
      await operations.payment(f.owner, f.schoolId, f.invoiceId, { amount_paise: 1_000_000, method: "cash", reference: `DATES-${randomUUID()}`, idempotency_key: randomUUID() });
      expect((await operations.fees(f.learner.actor, f.schoolId, f.learner.id)).invoices[0]).toMatchObject({ collection_due_on: f.due(30), collection_overdue_paise: 0 });
      // Native fictional cancellation/credit/refund facts exercise the existing
      // ledger invariants, not a claim that F1 implements the refund workflow.
      const event = (await sql<{ id: string }>`INSERT INTO campus_events(school_id,event_type,status,title,venue,starts_at,ends_at,audience_mode,
        participation_requirement,payment_required,payment_amount_paise,payment_due_on,created_by,published_by,published_at)
        VALUES(${f.schoolId}::uuid,'workshop','published','Synthetic credit/refund projection','Lab',${f.due(20)}::date,
          ${f.due(21)}::date,'students','mandatory',true,3000000,${f.day}::date,${f.owner.id}::uuid,${f.owner.id}::uuid,${f.now}::timestamptz) RETURNING id`.execute(db)).rows[0]!;
      await sql`INSERT INTO campus_event_participants(school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id)
        VALUES(${f.schoolId}::uuid,${event.id}::uuid,${f.learner.id}::uuid,'mandatory','pending',${f.invoiceId}::uuid)`.execute(db);
      await sql`UPDATE campus_events SET status='cancelled',cancelled_by=${f.owner.id}::uuid,cancelled_at=${f.now}::timestamptz,
        cancellation_internal_reason='Synthetic ledger projection check',cancellation_reason='Synthetic cancellation' WHERE id=${event.id}::uuid`.execute(db);
      const credit = await db.selectFrom("fee_invoice_credits").select("id").where("invoice_id", "=", f.invoiceId).executeTakeFirstOrThrow();
      expect((await operations.fees(f.guardian, f.schoolId, f.learner.id)).invoices[0]).toMatchObject({ payment_plan_state: "needs_review", collection_due_on: null,
        collection_overdue_paise: null, balance_paise: 0, refund_due_paise: 1_000_000 });
      await db.insertInto("fee_refunds").values({ school_id: f.schoolId, invoice_id: f.invoiceId, credit_id: credit.id, event_id: event.id, student_id: f.learner.id,
        amount_paise: 1_000_000, method: "cash", reference: `REFUND-${randomUUID()}`, reason: "Synthetic confirmed refund", idempotency_key: randomUUID(),
        request_hash: financeHash({ invoice: f.invoiceId, synthetic: true }), recorded_by: f.owner.id }).execute();
      expect((await operations.fees(f.guardian, f.schoolId, f.learner.id)).invoices[0]).toMatchObject({ payment_plan_state: "needs_review", collection_due_on: null,
        collection_overdue_paise: null, balance_paise: 0, refunded_paise: 1_000_000, collection_state: "refunded" });
      expect((await f.account()).agreement?.state).toBe("needs_review");
      expect(await f.reads.dueWork(f.guardian, f.schoolId, f.learner.id, "dependent")).toEqual([]);
    });
  });
  it.runIf(Boolean(targetUrl))("approves, allocates actual money and safely withdraws verified expired work in one COW world only", async () => {
    const f = await createFinanceArrangementsFixture(db), submitted = await f.run(async () => f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, await f.input()));
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId,
          scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService; opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "finance-arrangements-test", checked_at: f.now });
        return { db: database, ...financeArrangementServices(database), environment, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        const current = (await branch.reads.workspace(f.owner, f.schoolId, f.learner.id, f.invoiceId)).invoices[0]!;
        const decision = { command_id: randomUUID(), expected_revision: current.stream_revision, decision: "approved" };
        await branch.arrangements.decide(f.owner, f.schoolId, String(submitted.id), decision);
        await branch.arrangements.decide(f.owner, f.schoolId, String(submitted.id), decision);
        await new OperationsService(branch.db, createStaffCoverageReconciliationTestDouble()).payment(f.owner, f.schoolId, f.invoiceId,
          { amount_paise: 1_000_000, method: "cash", reference: `SCENARIO-${randomUUID()}`, idempotency_key: randomUUID() });
        const paid = (await branch.reads.workspace(f.guardian, f.schoolId, f.learner.id, f.invoiceId)).invoices[0]!;
        expect(paid).toMatchObject({ balance_paise: 2_000_000, agreement: { state: "active", next_due_on: f.due(30), rows: [{ remaining_paise: 0 }, { remaining_paise: 2_000_000 }] } });
        const next = await branch.arrangements.request(f.guardian, f.schoolId, f.invoiceId, { command_id: randomUUID(), request_id: randomUUID(), expected_revision: paid.stream_revision,
          basis_hash: paid.basis_hash, basis_revision: paid.basis_revision, schedule: [{ amount_paise: 2_000_000, due_on: f.due(45) }] });
        const work = (await branch.reads.work(f.owner, f.schoolId)).needs_me[0]!;
        // Explicitly model a protocol expiry through its public port. This does
        // not claim that an unconfigured timer or real human response occurred.
        await branch.db.transaction().execute(tx => branch.core.recordMessageOutcome(tx, { school_id: f.schoolId, message_id: work.message_id!, state: "expired", actor: null,
          source_outbox_event_id: null, code: "synthetic_review_expiry", explanation: "Synthetic terminal protocol evidence for withdrawal recovery.", response: null,
          occurred_at: f.now, idempotency_key: `finance-test-expiry:${randomUUID()}` }));
        expect((await branch.reads.work(f.owner, f.schoolId)).needs_me).toEqual([]);
        expect((await branch.reads.work(f.guardian, f.schoolId)).waiting[0]).toMatchObject({ state: "review_window_ended" });
        expect((await branch.reads.workspace(f.owner, f.schoolId, f.learner.id, f.invoiceId)).invoices[0]!.requests[0]).toMatchObject({ can_decide: false, can_approve: false });
        const input = { command_id: randomUUID(), expected_revision: (await branch.reads.workspace(f.guardian, f.schoolId, f.learner.id, f.invoiceId)).invoices[0]!.stream_revision };
        const result = await branch.arrangements.withdraw(f.guardian, f.schoolId, String(next.id), input);
        expect(result).toMatchObject({ retained_message_state: "expired", already_terminal: true });
        expect(await branch.arrangements.withdraw(f.guardian, f.schoolId, String(next.id), input)).toMatchObject({ replayed: true });
        expect((await branch.reads.work(f.guardian, f.schoolId)).waiting).toEqual([]);
        expect((await money(branch.db, f.invoiceId))?.payments).toBe(1);
      });
      expect((await f.run(() => f.account())).balance_paise).toBe(3_000_000);
      expect((await f.run(() => f.account())).requests[0]).toMatchObject({ status: "pending" });
      await sibling.run(async () => {
        const account = (await sibling.reads.workspace(f.guardian, f.schoolId, f.learner.id, f.invoiceId)).invoices[0]!;
        expect(account).toMatchObject({ balance_paise: 3_000_000, agreement: null, requests: [{ status: "pending" }] });
        expect((await money(sibling.db, f.invoiceId))?.payments).toBe(0);
      });
      expect((await money(db, f.invoiceId))?.payments).toBe(0);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
