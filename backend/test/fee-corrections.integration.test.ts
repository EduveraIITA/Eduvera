import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { FeeChargeBatchService } from "../src/operations/fee-charge-batch.service.js";
import { FeeCorrectionsService } from "../src/operations/fee-corrections.service.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { NativeFeeReviewsModel } from "../src/operations/native-fee-reviews.model.js";
import { NativeFeeReviewsService } from "../src/operations/native-fee-reviews.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { arrangementBasis, arrangementInvoice, arrangementRevision, financeHash } from "../src/operations/finance-arrangements.store.js";
import type { chargeCorrectionChange } from "../src/operations/fee-corrections.contracts.js";
import type { z } from "zod";
import { createFinanceArrangementsFixture, financeArrangementServices } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/fee_corrections_unused_test";
const targetUrl = process.env.FEE_CORRECTIONS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
type Change = z.infer<typeof chargeCorrectionChange>;
type Selection = { invoice_ids: string[]; batch_id?: string };
const serviceSet = (database: DatabaseService) => {
  const context = financeArrangementServices(database), model = new NativeFeeReviewsModel(context.core, context.core,
    new CoordinationConfigurationService(context.core), context.core, context.core);
  const ledger = new FeeLedgerService(database, context.core, context.core, context.core, context.core);
  return { ...context, ledger, reviews: new NativeFeeReviewsService(database, context.access, model),
    batches: new FeeChargeBatchService(database, context.core, context.core, context.core, context.core),
    corrections: new FeeCorrectionsService(database, context.core, context.core, context.core, context.core),
    operations: new OperationsService(database, {} as never, undefined, undefined, ledger) };
};
async function basis(database: DatabaseService, schoolId: string, invoiceId: string) {
  return database.transaction().execute(async tx => arrangementBasis(tx, await arrangementInvoice(tx, schoolId, invoiceId)));
}
async function facts(database: DatabaseService, schoolId: string) {
  return (await sql<{ invoices: number; payments: number; charges: number; items: number; receipts: number; claims: number; commands: number; events: number; audits: number }>`SELECT
    (SELECT count(*)::int FROM fee_invoices WHERE school_id=${schoolId}::uuid) AS invoices,
    (SELECT count(*)::int FROM fee_payments WHERE school_id=${schoolId}::uuid) AS payments,
    (SELECT count(*)::int FROM fee_invoice_corrections WHERE school_id=${schoolId}::uuid) AS charges,
    (SELECT count(*)::int FROM fee_invoice_correction_items WHERE school_id=${schoolId}::uuid) AS items,
    (SELECT count(*)::int FROM fee_payment_corrections WHERE school_id=${schoolId}::uuid) AS receipts,
    (SELECT count(*)::int FROM fee_payment_reference_claims WHERE school_id=${schoolId}::uuid) AS claims,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND handler_key IN('finance.charge_correction','finance.payment_correction')) AS commands,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS events,
    (SELECT count(*)::int FROM school_operations_audit WHERE school_id=${schoolId}::uuid) AS audits`.execute(database)).rows[0]!;
}
async function originals(database: DatabaseService, schoolId: string) {
  // Snapshot connections use UTC; Live fixtures may use Asia/Kolkata. Canonicalize
  // the same instant in SQL, retaining PostgreSQL microseconds (not JS milliseconds).
  return (await sql<{ invoices: unknown; payments: unknown; batches: unknown; batch_items: unknown }>`SELECT
    (SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('created_at',to_char(timezone('UTC',i.created_at),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY id) FROM fee_invoices i WHERE school_id=${schoolId}::uuid) AS invoices,
    (SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('created_at',to_char(timezone('UTC',p.created_at),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY id) FROM fee_payments p WHERE school_id=${schoolId}::uuid) AS payments,
    (SELECT jsonb_agg(to_jsonb(b)||jsonb_build_object('created_at',to_char(timezone('UTC',b.created_at),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY id) FROM fee_charge_batches b WHERE school_id=${schoolId}::uuid) AS batches,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY batch_id,ordinal) FROM fee_charge_batch_items i WHERE school_id=${schoolId}::uuid) AS batch_items`.execute(database)).rows[0]!;
}
async function rejection(operation: () => Promise<unknown>) {
  try { await operation(); } catch (error) {
    if (error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function")
      return { status: "getStatus" in error && typeof error.getStatus === "function" ? error.getStatus() : null, response: error.getResponse() };
    throw error;
  }
  throw new Error("Expected this exact correction to be rejected.");
}
async function fixture() {
  const f = await createFinanceArrangementsFixture(db), context = serviceSet(db), groupId = randomUUID();
  await sql`INSERT INTO participation_groups(id,school_id,name,created_by) VALUES(${groupId}::uuid,${f.schoolId}::uuid,'Original charged group',${f.owner.id}::uuid)`.execute(db);
  await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
    VALUES(${f.schoolId}::uuid,${groupId}::uuid,${f.learner.personId}::uuid,${f.day}::date,${f.owner.id}::uuid),
      (${f.schoolId}::uuid,${groupId}::uuid,${f.secondLearner.personId}::uuid,${f.day}::date,${f.owner.id}::uuid)`.execute(db);
  const selection = { person_ids: [f.learner.personId], groups: [{ kind: "participation" as const, id: groupId }] };
  const batchInput = await f.run(async () => ({ command_id: randomUUID(), batch_id: randomUUID(), selection,
    snapshot_hash: (await context.batches.preview(f.owner, f.schoolId, { selection })).snapshot_hash,
    reference: `CORRECT-${randomUUID()}`, description: "Robotics recording", amount_paise: 10_000, due_on: f.day }));
  const batch = await f.run(() => context.batches.issue(f.owner, f.schoolId, batchInput));
  const invoiceId = batch.invoices.find(item => item.person_id === f.learner.personId)!.invoice_id;
  const otherInvoiceId = batch.invoices.find(item => item.person_id === f.secondLearner.personId)!.invoice_id;
  const charge = async (change: Change, ids = [invoiceId], inBatch = false) => {
    const selection: Selection = { invoice_ids: ids, ...(inBatch ? { batch_id: batch.batch_id } : {}) };
    const preview = await context.corrections.preview(f.owner, f.schoolId, { selection, change });
    return { command_id: randomUUID(), correction_id: randomUUID(), selection, change, snapshot_hash: preview.snapshot_hash,
      reason: "Correct a fictional recording mistake", attested_recording_error: true as const };
  };
  const enablePayer = async () => {
    const revision = await db.transaction().execute(tx => arrangementRevision(tx, f.schoolId, invoiceId));
    const account = (await f.reads.workspace(f.owner, f.schoolId, undefined, invoiceId, undefined, f.learner.personId)).invoices[0]!;
    if (!account.self_payer) await f.arrangements.enableSelfPayer(f.owner, f.schoolId, invoiceId, { command_id: randomUUID(), entitlement_id: randomUUID(),
      expected_revision: revision, valid_from: f.day, valid_until: f.due(30), attested_adult_self_payer: true });
  };
  const payment = async (amount = 4000, reference = `CORRECTION-BANK-${randomUUID()}`) => {
    await enablePayer();
    const current = (await context.reviews.workspace(f.learner.actor, f.schoolId, { invoice_id: invoiceId })).invoices[0]!;
    const reviewer = current.reviewers.find(item => item.user_id === f.owner.id)!;
    const report = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: current.stream_revision,
      basis_hash: current.basis_hash, basis_revision: current.basis_revision, reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash },
      kind: "payment", amount_paise: amount, method: "bank_transfer", reference, note: "Synthetic independently verified funds", payment_made: true };
    const reported = await context.reviews.report(f.learner.actor, f.schoolId, invoiceId, report);
    const decision = { command_id: randomUUID(), expected_revision: reported.revision, outcome: "verified", response: "Synthetic statement independently checked", verified_funds: true };
    const verified = await context.reviews.decide(f.owner, f.schoolId, report.review_id, decision);
    if (!verified.payment_id) throw new Error("Expected one verified synthetic receipt.");
    return { paymentId: verified.payment_id, reference, report, decision, verified };
  };
  const paymentChange = async (paymentId: string, replacement?: { amount_paise: number; method: "bank_transfer"; reference: string }) => {
    const change = replacement ? { action: "replace" as const, replacement } : { action: "reverse" as const };
    const preview = await context.corrections.paymentPreview(f.owner, f.schoolId, paymentId, change);
    return { ...change, command_id: randomUUID(), correction_id: randomUUID(), snapshot_hash: preview.snapshot_hash,
      reason: "Correct a fictional receipt recording mistake", attested_recording_error: true as const, ...(replacement ? { verified_funds: true as const } : {}) };
  };
  return { ...f, ...context, legacyInvoiceId: f.invoiceId, groupId, batch, batchInput, invoiceId, otherInvoiceId, charge, enablePayer, payment, paymentChange };
}

describe.skipIf(!enabled)("append-only correction of posted non-event fees and receipts", () => {
  it("amends, cancels and explicitly restores current truth without rewriting original invoices or collection manifests", async () => {
    const f = await fixture();
    await f.run(async () => {
      const before = await originals(db, f.schoolId), untouched = await basis(db, f.schoolId, f.otherInvoiceId);
      const input = await f.charge({ kind: "amend", amount_paise: 12_000, description: "Corrected materials charge", due_on: f.due(7) });
      const accepted = await f.corrections.apply(f.owner, f.schoolId, input);
      expect(accepted).toMatchObject({ id: input.correction_id, correction_id: input.correction_id, invoice_ids: [f.invoiceId], revision: 1, replayed: false });
      expect(await f.corrections.apply(f.owner, f.schoolId, input)).toMatchObject({ ...accepted, replayed: true });
      expect(await f.corrections.confirmation(f.owner, f.schoolId, input.correction_id, input.command_id)).toMatchObject({ handler: "finance.charge_correction",
        source_id: input.correction_id, command_id: input.command_id, action: "apply", state: "accepted", result: { id: input.correction_id } });
      expect(await f.corrections.detail(f.owner, f.schoolId, input.correction_id)).toMatchObject({ invoice_ids: [f.invoiceId] });
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ basis_version: 3, balance_paise: 12_000 });
      expect(await basis(db, f.schoolId, f.otherInvoiceId)).toEqual(untouched);
      const entity = () => db.selectFrom("campus_model_entities").selectAll().where("school_id", "=", f.schoolId)
        .where("domain", "=", "finance").where("kind", "=", "fee_charge_correction").where("domain_id", "=", input.correction_id).executeTakeFirstOrThrow();
      const acceptedEntity = await entity(), beforeCollision = await facts(db, f.schoolId);
      expect(acceptedEntity.lifecycle_state).toBe("active");
      const freshProposal = await f.charge({ kind: "amend", amount_paise: 13_000 });
      for (const collision of [{ ...freshProposal, correction_id: input.correction_id }, { ...input, command_id: randomUUID() }]) {
        expect((await rejection(() => f.corrections.apply(f.owner, f.schoolId, collision))).status).toBe(400);
        expect(await facts(db, f.schoolId)).toEqual(beforeCollision);
        expect(await entity()).toEqual(acceptedEntity);
        expect(await f.corrections.confirmation(f.owner, f.schoolId, input.correction_id, collision.command_id)).toMatchObject({ state: "not_found" });
      }
      const cancel = await f.charge({ kind: "cancel" });
      const quote = await f.corrections.preview(f.owner, f.schoolId, { selection: cancel.selection, change: cancel.change });
      expect(quote.items[0]).toMatchObject({ before: { amount_paise: 12_000, description: "Corrected materials charge", due_on: f.due(7) }, after: { charge_state: "cancelled", balance_paise: 0 } });
      await f.corrections.apply(f.owner, f.schoolId, cancel);
      await f.corrections.apply(f.owner, f.schoolId, await f.charge({ kind: "amend", amount_paise: 8000 }));
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ balance_paise: 8000, basis_version: 3 });
      const advanced = await facts(db, f.schoolId);
      expect(await f.corrections.apply(f.owner, f.schoolId, input)).toMatchObject({ ...accepted, replayed: true });
      expect(await facts(db, f.schoolId)).toEqual(advanced);
      expect(await originals(db, f.schoolId)).toEqual(before);
      await expect(f.corrections.apply(f.owner, f.schoolId, { ...input, reason: "Different reason" })).rejects.toThrow(/different|used/i);
      await expect(sql`UPDATE fee_invoice_corrections SET reason='Rewrite history' WHERE id=${input.correction_id}::uuid`.execute(db)).rejects.toThrow();
      await expect(sql`DELETE FROM fee_invoice_correction_items WHERE correction_id=${input.correction_id}::uuid`.execute(db)).rejects.toThrow();
      const noOp = await f.charge({ kind: "amend", amount_paise: 8000 });
      await expect(f.corrections.apply(f.owner, f.schoolId, noOp)).rejects.toThrow();
    });
  });

  it("corrects fixed selected collection invoices atomically, never current roster expansion or unrelated collection members", async () => {
    const f = await fixture();
    await f.run(async () => {
      const ids = [f.invoiceId, f.otherInvoiceId], input = await f.charge({ kind: "amend", amount_paise: 7500 }, ids, true);
      const joinedLater = await db.insertInto("school_people").values({ school_id: f.schoolId, first_name: "Joined after these invoices were posted" }).returning("id").executeTakeFirstOrThrow();
      await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
        VALUES(${f.schoolId}::uuid,${f.groupId}::uuid,${joinedLater.id}::uuid,${f.day}::date,${f.owner.id}::uuid)`.execute(db);
      const accepted = await f.corrections.apply(f.owner, f.schoolId, input);
      expect(accepted.invoice_ids).toEqual([...ids].sort());
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ balance_paise: 7500 });
      expect(await basis(db, f.schoolId, f.otherInvoiceId)).toMatchObject({ balance_paise: 7500 });
      const subset = await f.charge({ kind: "cancel" }, [f.invoiceId], true);
      await f.corrections.apply(f.owner, f.schoolId, subset);
      expect(await basis(db, f.schoolId, f.otherInvoiceId)).toMatchObject({ balance_paise: 7500 });
      expect((await f.batches.detail(f.owner, f.schoolId, f.batch.batch_id)).invoices).toEqual(f.batch.invoices);
      expect(await db.selectFrom("fee_invoices").select("id").where("school_id", "=", f.schoolId).where("person_id", "=", joinedLater.id).execute()).toEqual([]);
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: [f.invoiceId, f.invoiceId] }, change: { kind: "cancel" } })).rejects.toThrow();
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: Array.from({ length: 501 }, () => randomUUID()) }, change: { kind: "cancel" } })).rejects.toThrow();
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: [f.invoiceId, f.otherInvoiceId], batch_id: randomUUID() }, change: { kind: "cancel" } })).rejects.toThrow();
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: [f.invoiceId, f.legacyInvoiceId], batch_id: f.batch.batch_id }, change: { kind: "cancel" } })).rejects.toThrow();
    });
  });

  it("rolls back all selected corrections, audits, events and outcome on journal or completion failure", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = await f.charge({ kind: "amend", amount_paise: 9000 }, [f.invoiceId, f.otherInvoiceId], true), before = await facts(db, f.schoolId);
      // The owning correction event is journaled once after all selected items;
      // failure there must undo every invoice projection and per-invoice refresh.
      const journal = vi.spyOn(f.core, "recordAcceptedEvent").mockRejectedValueOnce(new Error("Injected correction journal failure"));
      try { await expect(f.corrections.apply(f.owner, f.schoolId, input)).rejects.toThrow("Injected correction journal failure"); } finally { journal.mockRestore(); }
      expect(await facts(db, f.schoolId)).toEqual(before);
      expect(await f.corrections.confirmation(f.owner, f.schoolId, input.correction_id, input.command_id)).toMatchObject({ state: "not_found" });
      const completion = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected correction outcome failure"));
      try { await expect(f.corrections.apply(f.owner, f.schoolId, input)).rejects.toThrow("Injected correction outcome failure"); } finally { completion.mockRestore(); }
      expect(await facts(db, f.schoolId)).toEqual(before);
      expect((await f.corrections.apply(f.owner, f.schoolId, input)).invoice_ids).toHaveLength(2);
      const payment = await f.payment(), receipt = await f.paymentChange(payment.paymentId), receiptBefore = await facts(db, f.schoolId);
      const receiptCompletion = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected receipt outcome failure"));
      try { await expect(f.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, receipt)).rejects.toThrow("Injected receipt outcome failure"); } finally { receiptCompletion.mockRestore(); }
      expect(await facts(db, f.schoolId)).toEqual(receiptBefore);
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ paid_paise: 4000, balance_paise: 5000 });
    });
  });

  it("retains terminal stale rejection for the whole selection and cannot accept the old key when the exact original date returns", async () => {
    const f = await fixture();
    const input = await f.run(() => f.charge({ kind: "amend", amount_paise: 6000 }, [f.invoiceId, f.otherInvoiceId], true));
    const before = await facts(db, f.schoolId), later = new Date(Date.parse(f.now) + 86_400_000).toISOString();
    const failure = await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(later), nowIso: () => later } }),
      () => rejection(() => f.corrections.apply(f.owner, f.schoolId, input)));
    expect(failure).toMatchObject({ status: 400, response: { code: "finance.correction_basis_changed" } });
    expect(await facts(db, f.schoolId)).toEqual({ ...before, commands: before.commands + 1 });
    await f.run(async () => {
      expect((await f.corrections.preview(f.owner, f.schoolId, { selection: input.selection, change: input.change })).snapshot_hash).toBe(input.snapshot_hash);
      expect(await f.corrections.confirmation(f.owner, f.schoolId, input.correction_id, input.command_id)).toMatchObject({ state: "not_accepted" });
      await expect(f.corrections.apply(f.owner, f.schoolId, input)).rejects.toThrow(/not accepted|review|confirmation/i);
      await expect(f.corrections.confirmation(f.owner, f.schoolId, randomUUID(), input.command_id)).rejects.toThrow();
      const stale = await f.charge({ kind: "amend", amount_paise: 5000 }, [f.invoiceId, f.otherInvoiceId], true);
      await f.corrections.apply(f.owner, f.schoolId, await f.charge({ kind: "amend", amount_paise: 11_000 }));
      const afterSingle = await facts(db, f.schoolId);
      expect((await rejection(() => f.corrections.apply(f.owner, f.schoolId, stale))).status).toBe(400);
      expect(await facts(db, f.schoolId)).toEqual({ ...afterSingle, commands: afterSingle.commands + 1 });
      expect(await basis(db, f.schoolId, f.otherInvoiceId)).toMatchObject({ balance_paise: 10_000 });
    });
  });

  it("converges concurrent exact corrections and rejects competing writes without double reversal or duplicate references", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = await f.charge({ kind: "amend", amount_paise: 12_000 });
      const results = await Promise.all([f.corrections.apply(f.owner, f.schoolId, input), f.corrections.apply(f.owner, f.schoolId, input)]);
      expect(results.map(item => item.replayed).sort()).toEqual([false, true]); expect(results[0].invoice_ids).toEqual(results[1].invoice_ids);
      const paid = await f.payment(), correction = await f.paymentChange(paid.paymentId, { amount_paise: 3000, method: "bank_transfer", reference: paid.reference });
      const receipts = await Promise.all([f.corrections.correctPayment(f.owner, f.schoolId, paid.paymentId, correction), f.corrections.correctPayment(f.owner, f.schoolId, paid.paymentId, correction)]);
      expect(receipts.map(item => item.replayed).sort()).toEqual([false, true]); expect(receipts[0].replacement_payment_id).toBe(receipts[1].replacement_payment_id);
      const another = { ...correction, correction_id: randomUUID(), command_id: randomUUID() };
      await expect(f.corrections.correctPayment(f.owner, f.schoolId, paid.paymentId, another)).rejects.toThrow();
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ paid_paise: 3000, balance_paise: 9000 });
    });
  });

  it("replaces and reverses exact receipts with their actual reference while preserving original independent verification", async () => {
    const f = await fixture();
    await f.run(async () => {
      const payment = await f.payment(), original = await db.selectFrom("fee_payments").selectAll().where("id", "=", payment.paymentId).executeTakeFirstOrThrow();
      const replacement = await f.paymentChange(payment.paymentId, { amount_paise: 2500, method: "bank_transfer", reference: payment.reference });
      await expect(f.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, { ...replacement, verified_funds: false })).rejects.toThrow();
      const accepted = await f.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, replacement);
      expect(accepted).toMatchObject({ correction_id: replacement.correction_id, payment_id: payment.paymentId, invoice_id: f.invoiceId, action: "replace", revision: 1, replayed: false });
      expect(accepted.replacement_payment_id).toBeTruthy(); expect(accepted.replacement_payment_id).not.toBe(payment.paymentId);
      expect(await db.selectFrom("fee_payments").selectAll().where("id", "=", payment.paymentId).executeTakeFirstOrThrow()).toEqual(original);
      expect(await db.selectFrom("fee_payments").select(["amount_paise", "reference"]).where("id", "=", accepted.replacement_payment_id!).executeTakeFirstOrThrow()).toEqual({ amount_paise: 2500, reference: payment.reference });
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ basis_version: 3, paid_paise: 2500, balance_paise: 7500 });
      await expect(sql`INSERT INTO fee_payment_reference_claims(school_id,method,normalized_reference,payment_id)
        VALUES(${f.schoolId}::uuid,'cash','wrong receipt source',${payment.paymentId}::uuid)`.execute(db)).rejects.toThrow();
      expect(await f.corrections.paymentConfirmation(f.owner, f.schoolId, replacement.correction_id, replacement.command_id)).toMatchObject({ handler: "finance.payment_correction", source_id: replacement.correction_id,
        command_id: replacement.command_id, action: "apply", state: "accepted", result: { replacement_payment_id: accepted.replacement_payment_id } });
      expect(await f.reviews.decide(f.owner, f.schoolId, payment.report.review_id, payment.decision)).toMatchObject({ payment_id: payment.paymentId, replayed: true });
      const beforeReverse = await facts(db, f.schoolId), reverse = await f.paymentChange(accepted.replacement_payment_id!);
      await f.corrections.correctPayment(f.owner, f.schoolId, accepted.replacement_payment_id!, reverse);
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ paid_paise: 0, balance_paise: 10_000 });
      expect((await facts(db, f.schoolId)).payments).toBe(beforeReverse.payments);
      const reversed = await facts(db, f.schoolId);
      expect(await f.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, replacement)).toMatchObject({ ...accepted, replayed: true });
      expect(await facts(db, f.schoolId)).toEqual(reversed);
      await expect(sql`DELETE FROM fee_payment_corrections WHERE id=${replacement.correction_id}::uuid`.execute(db)).rejects.toThrow();
      await expect(sql`UPDATE fee_payments SET amount_paise=1 WHERE id=${payment.paymentId}::uuid`.execute(db)).rejects.toThrow();
      // Raw historical receipts total6500 here, but both are ineffective. A new
      // independently verified6000 must use effective truth, not the old raw sum.
      await f.payment(6000);
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ paid_paise: 6000, balance_paise: 4000 });
    });
  });

  it("shows excess credit without refund or transfer and invalidates prior reports and approved payment-plan allocation", async () => {
    const f = await fixture();
    await f.run(async () => {
      await f.enablePayer();
      const account = (await f.reads.workspace(f.learner.actor, f.schoolId, undefined, f.invoiceId, undefined, f.learner.personId)).invoices[0]!;
      const plan = { command_id: randomUUID(), request_id: randomUUID(), expected_revision: account.stream_revision, basis_hash: account.basis_hash, basis_revision: account.basis_revision,
        schedule: [{ amount_paise: 10_000, due_on: f.due(10) }], note: "Synthetic approved dates" };
      const requested = await f.arrangements.request(f.learner.actor, f.schoolId, f.invoiceId, plan);
      await f.arrangements.decide(f.owner, f.schoolId, plan.request_id, { command_id: randomUUID(), expected_revision: requested.revision, decision: "approved" });
      const paid = await f.payment(4000), current = (await f.reviews.workspace(f.learner.actor, f.schoolId, { invoice_id: f.invoiceId })).invoices[0]!;
      const review = current.reviewers.find(item => item.user_id === f.owner.id)!;
      const pending = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: current.stream_revision, basis_hash: current.basis_hash, basis_revision: current.basis_revision,
        reviewer: { user_id: review.user_id, person_id: review.person_id, eligibility_hash: review.eligibility_hash }, kind: "payment", amount_paise: 1000, method: "cash", reference: `STALE-${randomUUID()}`, note: "Synthetic late report", payment_made: true };
      const reported = await f.reviews.report(f.learner.actor, f.schoolId, f.invoiceId, pending);
      const before = await originals(db, f.schoolId), amend = await f.charge({ kind: "amend", amount_paise: 3000 });
      const quote = await f.corrections.preview(f.owner, f.schoolId, { selection: amend.selection, change: amend.change });
      expect(quote).toMatchObject({ credit_paise: 1000, items: [{ after: { paid_paise: 4000, balance_paise: 0, credit_paise: 1000 } }] });
      await f.corrections.apply(f.owner, f.schoolId, amend);
      expect(await originals(db, f.schoolId)).toEqual(before);
      expect((await f.reads.workspace(f.learner.actor, f.schoolId, undefined, f.invoiceId, undefined, f.learner.personId)).invoices[0]).toMatchObject({ agreement: { state: "needs_review" } });
      await expect(f.reviews.decide(f.owner, f.schoolId, reported.id, { command_id: randomUUID(), expected_revision: reported.revision, outcome: "verified", response: "Must not post against old basis", verified_funds: true })).rejects.toThrow();
      expect(await f.reviews.decide(f.owner, f.schoolId, paid.report.review_id, paid.decision)).toMatchObject({ replayed: true, payment_id: paid.paymentId });
      expect((await f.operations.fees(f.owner, f.schoolId)).invoices.find(item => item.id === f.invoiceId)).toMatchObject({ balance_paise: 0, refund_due_paise: 1000 });
      expect((await sql<{ refunds: number }>`SELECT count(*)::int AS refunds FROM fee_refunds WHERE invoice_id=${f.invoiceId}::uuid`.execute(db)).rows[0]!.refunds).toBe(0);
      await expect(f.paymentChange(paid.paymentId, { amount_paise: 4500, method: "bank_transfer", reference: `EXTRA-${randomUUID()}` })).rejects.toThrow();
      const referenceOnly = await f.paymentChange(paid.paymentId, { amount_paise: 4000, method: "bank_transfer", reference: `CORRECT-REFERENCE-${randomUUID()}` });
      await f.corrections.correctPayment(f.owner, f.schoolId, paid.paymentId, referenceOnly);
      expect(await basis(db, f.schoolId, f.invoiceId)).toMatchObject({ paid_paise: 4000, balance_paise: 0 });
      expect((await f.operations.fees(f.owner, f.schoolId)).invoices.find(item => item.id === f.invoiceId)).toMatchObject({ refund_due_paise: 1000 });
    });
  });

  it("rechecks tenant, current operational access and the original native submitter person before replacement", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      const input = await f.charge({ kind: "cancel" }), before = await facts(db, f.schoolId);
      await expect(f.corrections.preview(f.learner.actor, f.schoolId, { selection: input.selection, change: input.change })).rejects.toThrow();
      await expect(f.corrections.apply(f.otherTeacher, f.schoolId, input)).rejects.toThrow();
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: [foreign.invoiceId] }, change: { kind: "cancel" } })).rejects.toThrow();
      await expect(f.corrections.apply({ ...f.owner, active_school_id: foreign.schoolId }, foreign.schoolId, input)).rejects.toThrow();
      expect(await facts(db, f.schoolId)).toEqual(before);
      const payment = await f.payment(), replacement = await f.paymentChange(payment.paymentId, { amount_paise: 2500, method: "bank_transfer", reference: payment.reference });
      // Explicit new technical access must not allow the payer to verify their own
      // old native report, even after the original role has changed.
      await db.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.learner.actor.id).execute();
      expect((await f.corrections.preview(f.learner.actor, f.schoolId, { selection: input.selection, change: input.change })).items).toHaveLength(1);
      await expect(f.corrections.correctPayment(f.learner.actor, f.schoolId, payment.paymentId, replacement)).rejects.toThrow(/independently|claimed payment/i);
      // A new account for the same canonical human cannot bypass the person floor.
      await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: f.learner.endpoint.endpoint_id,
        actor_user_id: f.owner.id, expected_revision: 1, effective_at: f.now, disposition: "ended", reason: "Synthetic account replacement",
        source_domain: "people", source_record_id: f.learner.personId, source_revision: 2, idempotency_key: `correction-relink-close:${randomUUID()}` }));
      const alias = await db.insertInto("users").values({ username: `correction-alias-${randomUUID()}`, email: `correction-alias-${randomUUID()}@example.test`,
        password_hash: "isolated-test-only", first_name: "Same canonical human", last_name: "New account", role: "admin", email_verified_at: new Date(f.now) })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: alias.id, role: "admin" }).execute();
      // Explicit accepted-invitation fixture evidence satisfies the existing
      // canonical binding guard; this is not an account-transfer onboarding test.
      await sql`INSERT INTO school_invitations(school_id,email,role,person_id,source,token_hash,created_by,expires_at,accepted_at,accepted_by_user_id)
        VALUES(${f.schoolId}::uuid,${alias.email},'member',${f.learner.personId}::uuid,'school',${randomUUID()},${f.owner.id}::uuid,
          ${f.now}::timestamptz+interval '1 day',${f.now}::timestamptz,${alias.id}::uuid)`.execute(db);
      await db.updateTable("school_people").set({ account_user_id: alias.id }).where("school_id", "=", f.schoolId).where("id", "=", f.learner.personId).execute();
      await db.transaction().execute(tx => f.core.linkAccountEndpoint(tx, { school_id: f.schoolId, user_id: alias.id, person_id: f.learner.personId,
        actor_user_id: f.owner.id, effective_from: f.now, effective_until: null, source_domain: "people", source_record_id: f.learner.personId, source_revision: 2, metadata: { fixture: "correction_person_floor" } }));
      const aliasActor = { ...alias, active_school_id: f.schoolId };
      expect((await f.corrections.preview(aliasActor, f.schoolId, { selection: input.selection, change: input.change })).items).toHaveLength(1);
      await expect(f.corrections.paymentPreview(aliasActor, f.schoolId, payment.paymentId, { action: "replace", replacement: replacement.replacement })).rejects.toThrow(/independently|claimed payment/i);
      await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
        VALUES(${f.schoolId}::uuid,${f.otherTeacher.id}::uuid,'fees.manage','Synthetic resource-only Finance operator','manual','assigned_resources',${f.day}::date,${f.due(30)}::date,${f.due(10)}::date,${f.owner.id}::uuid)`.execute(db);
      await expect(f.corrections.preview(f.otherTeacher, f.schoolId, { selection: input.selection, change: input.change })).rejects.toThrow();
      await expect(f.corrections.paymentDetail(f.otherTeacher, f.schoolId, replacement.correction_id)).rejects.toThrow();
      expect((await facts(db, f.schoolId)).receipts).toBe(0);
      const beforeRevocation = await facts(db, f.schoolId);
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
      expect((await rejection(() => f.corrections.apply(f.owner, f.schoolId, input))).status).toBe(403);
      expect(await facts(db, f.schoolId)).toEqual(beforeRevocation);
    });
  });

  it("keeps untouched v1/v2 basis commitments and old issue receipts exact while supporting ordinary retained student corrections", async () => {
    const f = await fixture();
    await f.run(async () => {
      const legacy = await basis(db, f.schoolId, f.legacyInvoiceId);
      const legacyId = legacy.invoice_id, native = await basis(db, f.schoolId, f.otherInvoiceId);
      const expectedLegacy = { invoice_id: legacyId, student_id: f.learner.id, amount_paise: 3_000_000, credited_paise: 0, paid_paise: 0, refunded_paise: 0,
        balance_paise: 3_000_000, credits: [], payments: [], refunds: [] };
      expect(legacy).toEqual(expectedLegacy); expect(financeHash(legacy)).toBe(financeHash(expectedLegacy));
      expect(native).toMatchObject({ basis_version: 2 });
      const input = await f.charge({ kind: "amend", amount_paise: 2_000_000, description: "Corrected ordinary course charge" }, [legacyId]);
      await f.corrections.apply(f.owner, f.schoolId, input);
      expect(await basis(db, f.schoolId, legacyId)).toMatchObject({ basis_version: 3, balance_paise: 2_000_000 });
      expect(await basis(db, f.schoolId, f.otherInvoiceId)).toEqual(native);
      expect(await f.batches.issue(f.owner, f.schoolId, f.batchInput)).toMatchObject({ ...f.batch, replayed: true });
      expect((await f.operations.fees(f.guardian, f.schoolId, f.learner.id)).invoices.find(item => item.id === legacyId)).toMatchObject({ balance_paise: 2_000_000 });
    });
  });

  it("keeps event reconciliation and provider-linked receipts outside the manual correction path", async () => {
    const f = await fixture();
    await f.run(async () => {
      const event = (await sql<{ id: string }>`INSERT INTO campus_events(school_id,event_type,title,starts_at,ends_at,audience_mode,participation_requirement,created_by)
        VALUES(${f.schoolId}::uuid,'workshop','Synthetic source-owned workshop',${f.now}::timestamptz,${f.now}::timestamptz+interval '1 hour','students','mandatory',${f.owner.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      await sql`INSERT INTO campus_event_participants(school_id,event_id,student_id,participation_requirement,fee_invoice_id)
        VALUES(${f.schoolId}::uuid,${event.id}::uuid,${f.learner.id}::uuid,'mandatory',${f.legacyInvoiceId}::uuid)`.execute(db);
      const payment = await f.payment();
      await sql`INSERT INTO fee_gateway_orders(school_id,invoice_id,created_by,amount_paise,key_id,provider_order_id,provider_payment_id,payment_id,state)
        VALUES(${f.schoolId}::uuid,${f.invoiceId}::uuid,${f.owner.id}::uuid,4000,'rzp_test_synthetic',${`order_${randomUUID()}`},${`pay_${randomUUID()}`},${payment.paymentId}::uuid,'captured')`.execute(db);
      const before = await facts(db, f.schoolId);
      await expect(f.corrections.preview(f.owner, f.schoolId, { selection: { invoice_ids: [f.legacyInvoiceId] }, change: { kind: "cancel" } })).rejects.toThrow();
      await expect(f.corrections.paymentPreview(f.owner, f.schoolId, payment.paymentId, { action: "reverse" })).rejects.toThrow();
      expect(await facts(db, f.schoolId)).toEqual(before);
    });
  });

  it.runIf(Boolean(targetUrl))("corrects charges and a real receipt only in one COW branch with exact recovery and unchanged Live/sibling truth", async () => {
    const f = await fixture(), payment = await f.run(() => f.payment()), selected: Selection = { invoice_ids: [f.invoiceId, f.otherInvoiceId], batch_id: f.batch.batch_id };
    const change = { kind: "amend" as const, amount_paise: 20_000 }, liveQuote = await f.run(() => f.corrections.preview(f.owner, f.schoolId, { selection: selected, change }));
    const liveReceipt = await f.run(() => f.paymentChange(payment.paymentId, { amount_paise: 2000, method: "bank_transfer", reference: payment.reference }));
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, f.now), before = await facts(db, f.schoolId), original = await originals(db, f.schoolId);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "fee-corrections-test", checked_at: f.now });
        return { db: database, ...serviceSet(database), namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open(), commandId = randomUUID(), correctionId = randomUUID(), receiptCorrectionId = randomUUID();
      let replacementId = "", branchHash = "";
      await branch.run(async () => {
        expect((await rejection(() => branch.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, liveReceipt))).status).toBe(400);
        expect((await rejection(() => branch.corrections.apply(f.owner, f.schoolId, { command_id: randomUUID(), correction_id: randomUUID(), selection: selected, change,
          snapshot_hash: liveQuote.snapshot_hash, reason: "Reject cross-world quote", attested_recording_error: true }))).status).toBe(400);
        const quote = await branch.corrections.preview(f.owner, f.schoolId, { selection: selected, change }); branchHash = quote.snapshot_hash;
        const input = { command_id: commandId, correction_id: correctionId, selection: selected, change, snapshot_hash: quote.snapshot_hash, reason: "Branch-only recording correction", attested_recording_error: true };
        const applied = await branch.corrections.apply(f.owner, f.schoolId, input);
        expect(await branch.corrections.apply(f.owner, f.schoolId, input)).toMatchObject({ ...applied, replayed: true });
        expect(await branch.corrections.confirmation(f.owner, f.schoolId, correctionId, commandId)).toMatchObject({ state: "accepted", result: { invoice_ids: [...selected.invoice_ids].sort() } });
        const replacement = { amount_paise: 2000, method: "bank_transfer" as const, reference: payment.reference };
        const receiptQuote = await branch.corrections.paymentPreview(f.owner, f.schoolId, payment.paymentId, { action: "replace", replacement });
        const receiptInput = { command_id: randomUUID(), correction_id: receiptCorrectionId, action: "replace" as const, replacement,
          snapshot_hash: receiptQuote.snapshot_hash, reason: "Branch-only receipt correction", attested_recording_error: true, verified_funds: true };
        const receipt = await branch.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, receiptInput); replacementId = receipt.replacement_payment_id!;
        expect(await branch.corrections.correctPayment(f.owner, f.schoolId, payment.paymentId, receiptInput)).toMatchObject({ ...receipt, replayed: true });
        expect(await basis(branch.db, f.schoolId, f.invoiceId)).toMatchObject({ basis_version: 3, paid_paise: 2000, balance_paise: 18_000 });
        const commands = await branch.db.selectFrom("campus_model_commands").select("environment_namespace_id").where("school_id", "=", f.schoolId).where("handler_key", "in", ["finance.charge_correction", "finance.payment_correction"]).execute();
        expect(commands.length).toBeGreaterThanOrEqual(3); expect(commands.every(item => item.environment_namespace_id === branch.namespace)).toBe(true);
      });
      expect(await facts(db, f.schoolId)).toEqual(before); expect(await originals(db, f.schoolId)).toEqual(original);
      expect(await f.run(() => f.corrections.confirmation(f.owner, f.schoolId, correctionId, commandId))).toMatchObject({ state: "not_found" });
      expect(await db.selectFrom("fee_payments").select("id").where("id", "=", replacementId).execute()).toEqual([]);
      await sibling.run(async () => {
        expect(await facts(sibling.db, f.schoolId)).toEqual(before); expect(await originals(sibling.db, f.schoolId)).toEqual(original);
        expect(await sibling.corrections.confirmation(f.owner, f.schoolId, correctionId, commandId)).toMatchObject({ state: "not_found" });
        expect(await sibling.db.selectFrom("fee_payments").select("id").where("id", "=", replacementId).execute()).toEqual([]);
        expect((await rejection(() => sibling.corrections.apply(f.owner, f.schoolId, { command_id: randomUUID(), correction_id: randomUUID(), selection: selected, change,
          snapshot_hash: branchHash, reason: "Reject sibling quote", attested_recording_error: true }))).status).toBe(400);
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
