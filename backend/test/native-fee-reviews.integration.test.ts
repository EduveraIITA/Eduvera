import { guardianFeeReviewServices } from "./fee-review.test-support.js";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { NativeFeeReviewsModel } from "../src/operations/native-fee-reviews.model.js";
import { NativeFeeReviewsService } from "../src/operations/native-fee-reviews.service.js";
import { arrangementInvoice } from "../src/operations/finance-arrangements.store.js";
import { nativeFeeReviewWork } from "../src/workspace/workflow-work.projection.js";
import { financeArrangementServices } from "./finance-arrangements.test-support.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { createFeeAuthorityMandateFixture } from "./fee-authority.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/native_fee_review_unused_test";
const targetUrl = process.env.NATIVE_FEE_REVIEWS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
export function nativeFeeServices(database: DatabaseService) {
  const finance = financeArrangementServices(database), configuration = new CoordinationConfigurationService(finance.core);
  const model = new NativeFeeReviewsModel(finance.core, finance.core, configuration, finance.core, finance.core);
  return { ...finance, model, reviews: new NativeFeeReviewsService(database, finance.access, model),
    ledger: new FeeLedgerService(database, finance.core, finance.core, finance.core, finance.core) };
}
async function fixture() {
  // Ordinary People invitation acceptance provides neutral member identities;
  // no Learning offering or academic scaffolding is created by this helper.
  const people = await createLearningOfferingFixture(db), services = nativeFeeServices(db), suffix = randomUUID();
  const { schoolId, owner } = people;
  const payer = { actor: people.learner.actor, person: people.learner.person }, reviewer = { actor: people.instructor.actor, person: people.instructor.person },
    other = { actor: people.secondLearner.actor, person: people.secondLearner.person };
  // Explicit synthetic operational access, not a consequence of a job title,
  // invoice issue, mandate, membership invitation or payment report.
  await db.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", schoolId).where("user_id", "=", reviewer.actor.id).execute();
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation);
  const invoiceId = randomUUID();
  await run(() => services.ledger.issue(owner, schoolId, { command_id: randomUUID(), invoice_id: invoiceId, beneficiary: { person_id: payer.person.id, expected_revision: payer.person.revision },
    reference: `NATIVE-${suffix}`, description: "Short course fee", amount_paise: 3_000_000, due_on: day }));
  // Existing explicit fictional authority is test setup, not evidence that
  // founder signup grants institutional Finance power.
  const mandate = await run(() => createFeeAuthorityMandateFixture(db, services.core, schoolId, owner));
  await run(async () => {
    const candidate = (await services.authority.workspace(owner, schoolId)).candidates.find(row => row.mandate_id === mandate.mandateId)!;
    await services.authority.confirm(owner, schoolId, { command_id: randomUUID(), mandate_id: mandate.mandateId, expected: candidate.expected, attestation: true });
    await services.arrangements.enableSelfPayer(owner, schoolId, invoiceId, { command_id: randomUUID(), entitlement_id: randomUUID(), expected_revision: 0,
      valid_from: day, valid_until: day, attested_adult_self_payer: true });
  });
  const current = async (person = payer.actor) => (await services.reviews.workspace(person, schoolId, { invoice_id: invoiceId })).invoices[0]!;
  const input = async (person = payer.actor, overrides: Record<string, unknown> = {}) => {
    const source = await current(person), selected = source.reviewers.find(row => row.user_id === reviewer.actor.id)!;
    return { command_id: randomUUID(), review_id: randomUUID(), expected_revision: source.stream_revision, basis_hash: source.basis_hash, basis_revision: source.basis_revision,
      reviewer: { user_id: selected.user_id, person_id: selected.person_id, eligibility_hash: selected.eligibility_hash }, kind: "payment", amount_paise: 1_000_000,
      method: "bank_transfer", reference: `BANK-${randomUUID()}`, note: "PRIVATE PAYMENT NOTE", payment_made: true, ...overrides };
  };
  return { ...services, schoolId, owner, payer, reviewer, other, invoiceId, now, day, environment, run, current, input };
}
const paymentCount = (database: DatabaseService, invoiceId: string) => database.selectFrom("fee_payments").select(database.fn.countAll<number>().as("count"))
  .where("invoice_id", "=", invoiceId).executeTakeFirstOrThrow().then(row => Number(row.count));

describe.skipIf(!enabled)("native Finance reports, exact independent handoffs and ledger closure", () => {
  it("operates a person invoice without class, term or student; routes one private report and verifies one receipt", async () => {
    const f = await fixture();
    await f.run(async () => {
      for (const table of ["students", "class_sections", "academic_terms"] as const)
        expect(Number((await db.selectFrom(table).select(db.fn.countAll<number>().as("count")).where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).count)).toBe(0);
      const input = await f.input(), before = await paymentCount(db, f.invoiceId);
      await expect(f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId,
        { ...input, reviewer: { ...input.reviewer, eligibility_hash: "0".repeat(64) } })).rejects.toMatchObject({ status: 400 });
      expect((await f.reviews.workspace(f.payer.actor, f.schoolId, { invoice_id: f.invoiceId, command_id: input.command_id })).confirmation)
        .toMatchObject({ state: "not_found" });
      const report = await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input);
      expect(await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input)).toMatchObject({ id: input.review_id, replayed: true });
      await expect(f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, { ...input, note: "changed" })).rejects.toThrow("different fee work");
      expect(await paymentCount(db, f.invoiceId)).toBe(before);
      const payer = await f.reviews.work(f.payer.actor, f.schoolId), reviewer = await f.reviews.work(f.reviewer.actor, f.schoolId);
      expect(payer.waiting).toHaveLength(1); expect(reviewer.needs_me).toHaveLength(1); expect((await f.reviews.work(f.owner, f.schoolId)).needs_me).toEqual([]);
      const projected = nativeFeeReviewWork(reviewer.needs_me[0]!, "needs_me");
      expect(projected.core_trace?.message_ids).toHaveLength(1); expect(projected.due_at).toBeNull(); expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|BANK-|1000000/u);
      await expect(f.reviews.decide(f.owner, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Matched bank", verified_funds: true })).rejects.toThrow("named fee operator");
      await expect(f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Matched bank", verified_funds: false })).rejects.toThrow("independently checked");
      const decision = { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Independently matched the fictional statement", verified_funds: true };
      const accepted = await f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, decision);
      expect(accepted.payment_id).toBeTruthy(); expect(await f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, decision)).toMatchObject({ payment_id: accepted.payment_id, replayed: true });
      expect(await paymentCount(db, f.invoiceId)).toBe(1); expect((await f.current()).balance_paise).toBe(2_000_000);
      expect((await f.reviews.work(f.payer.actor, f.schoolId)).waiting).toEqual([]); expect((await f.reviews.work(f.reviewer.actor, f.schoolId)).needs_me).toEqual([]);
      const confirmation = (await f.reviews.workspace(f.reviewer.actor, f.schoolId, { invoice_id: f.invoiceId, command_id: decision.command_id })).confirmation;
      expect(confirmation).toMatchObject({ handler: "finance.payment_review", invoice_id: f.invoiceId, source_id: report.id, command_id: decision.command_id, action: "decide", state: "accepted", result: { id: report.id, payment_id: accepted.payment_id } });
      const events = (await db.selectFrom("event_outbox").select("payload").where("aggregate_id", "=", report.id).execute()).map(row => row.payload);
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE|BANK-|Independently|1000000/u);
    });
  });
  it("answers a private charge question without money, and fails closed for revoked invoice access or reviewer responsibility", async () => {
    const f = await fixture();
    await f.run(async () => {
      await expect(f.reviews.workspace(f.other.actor, f.schoolId, { invoice_id: f.invoiceId })).rejects.toThrow("relationship");
      const current = await f.current(), selected = current.reviewers.find(row => row.user_id === f.reviewer.actor.id)!;
      const question = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: 0, basis_hash: current.basis_hash, basis_revision: 0,
        reviewer: selected, kind: "charge", note: "PRIVATE: why does this charge include a lab amount?" };
      // Labels are presentation, not part of a recipient command.
      const input = { ...question, reviewer: { user_id: selected.user_id, person_id: selected.person_id, eligibility_hash: selected.eligibility_hash } };
      const reported = await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input);
      await f.reviews.decide(f.reviewer.actor, f.schoolId, reported.id, { command_id: randomUUID(), expected_revision: 1, outcome: "answered", response: "The quoted fee includes supervised laboratory use." });
      expect(await paymentCount(db, f.invoiceId)).toBe(0); expect((await f.current()).balance_paise).toBe(3_000_000);
      const next = await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, await f.input());
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.reviewer.actor.id).execute();
      expect((await f.reviews.work(f.payer.actor, f.schoolId)).waiting[0]).toMatchObject({ state: "needs_reassignment" });
      expect((await f.reviews.work(f.reviewer.actor, f.schoolId)).needs_me).toEqual([]);
      await expect(f.reviews.decide(f.reviewer.actor, f.schoolId, next.id, { command_id: randomUUID(), expected_revision: 3, outcome: "verified", response: "No longer authorized", verified_funds: true })).rejects.toThrow();
      const account = (await f.reads.workspace(f.owner, f.schoolId, undefined, f.invoiceId, undefined, f.payer.person.id)).invoices[0]!;
      await f.arrangements.revokeSelfPayer(f.owner, f.schoolId, f.invoiceId, { command_id: randomUUID(), expected_revision: account.stream_revision,
        entitlement_id: account.self_payer!.id, reason: "Synthetic access ended" });
      await expect(f.current()).rejects.toThrow("invoice access");
      expect((await f.reviews.work(f.payer.actor, f.schoolId)).waiting[0]).toMatchObject({ state: "access_ended", href: `/work/fee-reviews/${next.id}` });
      const recovery = await f.reviews.recovery(f.payer.actor, f.schoolId, next.id);
      expect(recovery).toMatchObject({ id: next.id, can_withdraw: true }); expect(JSON.stringify(recovery)).not.toMatch(/PRIVATE|BANK-|Short course|3000000/u);
      await f.reviews.withdraw(f.payer.actor, f.schoolId, next.id, { command_id: randomUUID(), expected_revision: 3 });
      expect(await paymentCount(db, f.invoiceId)).toBe(0);
    });
  });
  it("supports attributed assisted reporting but never self-verification, rejects stale money and rolls back failed Core outcomes", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = await f.input(f.owner);
      await expect(f.reviews.report(f.owner, f.schoolId, f.invoiceId, { ...input, reviewer: { ...input.reviewer, user_id: f.owner.id } })).rejects.toThrow();
      const failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected native outcome failure"));
      await expect(f.reviews.report(f.owner, f.schoolId, f.invoiceId, input)).rejects.toThrow("Injected native outcome failure"); failure.mockRestore();
      expect((await f.current(f.owner)).reviews).toEqual([]); expect(await paymentCount(db, f.invoiceId)).toBe(0);
      const report = await f.reviews.report(f.owner, f.schoolId, f.invoiceId, input);
      expect((await f.current(f.owner)).reviews[0]?.can_decide).toBe(false);
      await db.insertInto("fee_payments").values({ school_id: f.schoolId, invoice_id: f.invoiceId, amount_paise: 100, method: "cash", reference: `SYNTHETIC-${randomUUID()}`, idempotency_key: randomUUID(), recorded_by: f.owner.id }).execute();
      await expect(f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Old balance", verified_funds: true })).rejects.toThrow("changed");
      expect(await paymentCount(db, f.invoiceId)).toBe(1);
      await f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "rejected", response: "The ledger changed. Review the new balance before sending again." });
      expect(await paymentCount(db, f.invoiceId)).toBe(1);
    });
  });
  it("keeps exact unknown commands locked and confirms receipts only for their actor, invoice, review and action", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = await f.input();
      await db.transaction().execute(async tx => {
        const campus = await f.access.campus(tx, f.payer.actor, f.schoolId), invoice = await arrangementInvoice(tx, f.schoolId, f.invoiceId);
        await f.model.prepare(tx, f.payer.actor, campus.actor, invoice, input.review_id, "report", input, 0, { fixture: "persisted-unknown" });
      });
      const pending = (await f.reviews.workspace(f.payer.actor, f.schoolId, { invoice_id: f.invoiceId, command_id: input.command_id })).confirmation;
      expect(pending).toMatchObject({ handler: "finance.payment_review", source_id: input.review_id, action: "report", state: "pending" });
      await expect(f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input)).rejects.toThrow("awaiting confirmation");
      expect((await f.reviews.workspace(f.owner, f.schoolId, { invoice_id: f.invoiceId, command_id: input.command_id })).confirmation).toMatchObject({ state: "not_found" });
      expect((await f.current()).reviews).toEqual([]); expect(await paymentCount(db, f.invoiceId)).toBe(0);
    });
  });
  it("never grants permanent-obsolete recovery for an invented hash or future ledger revision, and protects native source facts", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = await f.input();
      const response = async (operation: () => Promise<unknown>) => {
        try { await operation(); throw new Error("Expected a rejected native fee action"); }
        catch (error) { if (typeof error === "object" && error && "getResponse" in error && typeof error.getResponse === "function") return error.getResponse(); throw error; }
      };
      for (const invalid of [{ ...input, basis_hash: "f".repeat(64) }, { ...input, basis_revision: 99 }]) {
        expect(await response(() => f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, invalid))).not.toHaveProperty("fields.native_fee_review_obsolete");
      }
      await db.insertInto("fee_payments").values({ school_id: f.schoolId, invoice_id: f.invoiceId, amount_paise: 100, method: "cash", reference: `SYNTHETIC-${randomUUID()}`, idempotency_key: randomUUID(), recorded_by: f.owner.id }).execute();
      expect(await response(() => f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input))).toMatchObject({ fields: {
        native_fee_review_obsolete: { receipt_state: "absent", reason: "ledger_basis_diverged", invoice_id: f.invoiceId, review_id: input.review_id, command_id: input.command_id } } });
      const fresh = await f.input(), report = await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, fresh);
      await expect(sql`INSERT INTO fee_native_review_requests SELECT (jsonb_populate_record(NULL::fee_native_review_requests,to_jsonb(source)
        ||jsonb_build_object('id',${randomUUID()}::uuid,'command_id',${randomUUID()}::uuid,'stream_revision',99,'amount_paise',NULL))).*
        FROM fee_native_review_requests source WHERE id=${report.id}::uuid`.execute(db)).rejects.toThrow();
      await expect(sql`INSERT INTO fee_native_review_requests SELECT (jsonb_populate_record(NULL::fee_native_review_requests,to_jsonb(source)
        ||jsonb_build_object('id',${randomUUID()}::uuid,'command_id',${randomUUID()}::uuid,'stream_revision',99,
          'submitted_by',${f.other.actor.id}::uuid,'submitter_person_id',${f.other.person.id}::uuid))).*
        FROM fee_native_review_requests source WHERE id=${report.id}::uuid`.execute(db)).rejects.toThrow("same person account");
      await expect(sql`UPDATE fee_native_review_requests SET note='rewrite' WHERE id=${report.id}::uuid`.execute(db)).rejects.toThrow();
    });
  });
  it("serializes competing exact reviewer decisions so only one terminal decision and at most one payment is accepted", async () => {
    const f = await fixture();
    await f.run(async () => {
      const report = await f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, await f.input());
      const decisions = await Promise.allSettled([
        f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Matched independently", verified_funds: true }),
        f.reviews.decide(f.reviewer.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "rejected", response: "Competing rejection" }),
      ]);
      expect(decisions.filter(value => value.status === "fulfilled")).toHaveLength(1); expect(decisions.filter(value => value.status === "rejected")).toHaveLength(1);
      expect((await sql`SELECT id FROM fee_native_review_decisions WHERE review_id=${report.id}::uuid`.execute(db)).rows).toHaveLength(1);
      expect(await paymentCount(db, f.invoiceId)).toBeLessThanOrEqual(1); expect((await f.reviews.work(f.payer.actor, f.schoolId)).waiting).toEqual([]);
    });
  });
  it("retains narrow original assisted-sender withdrawal after operational access ends, without exposing the private invoice", async () => {
    const f = await fixture();
    await f.run(async () => {
      const source = await f.current(f.reviewer.actor), reviewer = source.reviewers.find(row => row.user_id === f.owner.id)!;
      const report = await f.reviews.report(f.reviewer.actor, f.schoolId, f.invoiceId, { command_id: randomUUID(), review_id: randomUUID(), expected_revision: 0,
        basis_hash: source.basis_hash, basis_revision: 0, reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash },
        kind: "payment", amount_paise: 100, method: "cash", reference: `ASSISTED-${randomUUID()}`, note: "PRIVATE assisted report", payment_made: true });
      await db.updateTable("school_memberships").set({ role: "member" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.reviewer.actor.id).execute();
      await expect(f.current(f.reviewer.actor)).rejects.toThrow("relationship");
      expect((await f.reviews.work(f.reviewer.actor, f.schoolId)).waiting[0]).toMatchObject({ state: "access_ended", href: `/work/fee-reviews/${report.id}` });
      const recovery = await f.reviews.recovery(f.reviewer.actor, f.schoolId, report.id);
      expect(recovery.can_withdraw).toBe(true); expect(JSON.stringify(recovery)).not.toMatch(/PRIVATE|ASSISTED-|Short course|3000000/u);
      await expect(f.reviews.recovery(f.other.actor, f.schoolId, report.id)).rejects.toThrow("original sender");
      const command = { command_id: randomUUID(), expected_revision: recovery.stream_revision };
      await f.reviews.withdraw(f.reviewer.actor, f.schoolId, report.id, command);
      expect((await f.reviews.recovery(f.reviewer.actor, f.schoolId, report.id, command.command_id)).confirmation).toMatchObject({ source_id: report.id, action: "withdraw", state: "accepted" });
      expect((await f.reviews.work(f.owner, f.schoolId)).needs_me).toEqual([]); expect(await paymentCount(db, f.invoiceId)).toBe(0);
    });
  });
  it("does not turn a resource-limited fee exception into native invoice recording or reviewer eligibility", async () => {
    const f = await fixture();
    await f.run(async () => {
      await sql`WITH staff_fixture_input(school_id,person_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) AS (VALUES (${f.schoolId}::uuid,${f.other.person.id}::uuid,${f.other.actor.id}::uuid,${`SCOPE-${randomUUID().slice(0, 8)}`},'Scoped','Operator',${f.other.actor.email},'non_teaching','Scoped fee helper','full_time',${f.day}::date,'active',${f.owner.id}::uuid,${f.owner.id}::uuid)) INSERT INTO staff_profiles(school_id,person_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) SELECT input.school_id::uuid,input.person_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input`.execute(db);
      await db.updateTable("school_memberships").set({ role: "staff" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.other.actor.id).execute();
      await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
        VALUES(${f.schoolId}::uuid,${f.other.actor.id}::uuid,'fees.manage','Synthetic resource-only grant','manual','assigned_resources',${f.day}::date,${f.day}::date,${f.day}::date,${f.owner.id}::uuid)`.execute(db);
      const current = await f.current();
      expect(current.reviewers.some(row => row.user_id === f.other.actor.id)).toBe(false);
      await expect(f.reviews.workspace(f.other.actor, f.schoolId, { invoice_id: f.invoiceId })).rejects.toThrow("relationship");
      await expect(f.reviews.report(f.other.actor, f.schoolId, f.invoiceId, await f.input())).rejects.toThrow("relationship");
      expect(await paymentCount(db, f.invoiceId)).toBe(0);
    });
  });
  it("preserves legacy guardian command hashes while preventing duplicate mixed native and legacy pending reviews", async () => {
    const people = await createClassPracticeFixture(db), service = nativeFeeServices(db), run = <T>(operation: () => Promise<T>) =>
      executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: people.schoolId, clock: { now: () => new Date(), nowIso: () => new Date().toISOString() } }), operation);
    const operations = new OperationsService(db, createStaffCoverageReconciliationTestDouble()), legacy = guardianFeeReviewServices(db, operations).service;
    const invoiceId = (await db.insertInto("fee_invoices").values({ school_id: people.schoolId, student_id: people.learner.id, reference: `LEGACY-${randomUUID()}`, description: "Existing tuition", amount_paise: 10000, due_on: people.date, created_by: people.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
    await run(async () => {
      const account = (await service.reviews.workspace(people.guardian, people.schoolId, { invoice_id: invoiceId })).invoices[0]!, reviewer = account.reviewers[0]!;
      const native = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: 0, basis_hash: account.basis_hash, basis_revision: account.basis_revision,
        reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }, kind: "payment", amount_paise: 1000, method: "bank_transfer", reference: `MIXED-${randomUUID()}`, note: "", payment_made: true };
      await service.reviews.report(people.guardian, people.schoolId, invoiceId, native);
      await expect(legacy.decide(people.owner, people.schoolId, native.review_id,
        { outcome: "verified", response: "Cannot bypass the named recipient adapter", verified_funds: true })).rejects.toThrow("not found");
      const old = { kind: "payment", amount_paise: 1000, method: "bank_transfer", reference: `OLD-${randomUUID()}`, note: "", idempotency_key: randomUUID() };
      await expect(legacy.submit(people.guardian, people.schoolId, invoiceId, old)).rejects.toThrow("pending");
      const otherInvoice = (await db.insertInto("fee_invoices").values({ school_id: people.schoolId, student_id: people.learner.id,
        reference: `OTHER-${randomUUID()}`, description: "Another retained tuition charge", amount_paise: 10000, due_on: people.date, created_by: people.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
      await expect(legacy.submit(people.guardian, people.schoolId, otherInvoice, { ...old, reference: ` ${native.reference.toLowerCase()} ` })).rejects.toThrow("reference");
      await service.reviews.withdraw(people.guardian, people.schoolId, native.review_id, { command_id: randomUUID(), expected_revision: 1 });
      const accepted = await legacy.submit(people.guardian, people.schoolId, invoiceId, old);
      expect(await legacy.submit(people.guardian, people.schoolId, invoiceId, old)).toEqual(accepted);
      const current = (await service.reviews.workspace(people.guardian, people.schoolId, { invoice_id: invoiceId })).invoices[0]!;
      expect(current.can_report).toBe(false);
      await expect(service.reviews.report(people.guardian, people.schoolId, invoiceId, { ...native, review_id: randomUUID(), command_id: randomUUID(), expected_revision: current.stream_revision })).rejects.toThrow("review pending");
      await legacy.decide(people.owner, people.schoolId, accepted.id, { outcome: "verified", response: "Independently matched the synthetic payment", verified_funds: true });
      const fresh = (await service.reviews.workspace(people.guardian, people.schoolId, { invoice_id: invoiceId })).invoices[0]!;
      const namedQuestion = await service.reviews.report(people.guardian, people.schoolId, invoiceId,
        { command_id: randomUUID(), review_id: randomUUID(), expected_revision: fresh.stream_revision, basis_hash: fresh.basis_hash,
          basis_revision: fresh.basis_revision, reviewer: native.reviewer, kind: "charge", note: "Named independent source question" });
      await service.reviews.decide(people.owner, people.schoolId, namedQuestion.id,
        { command_id: randomUUID(), expected_revision: fresh.stream_revision + 1, outcome: "answered", response: "The named question is answered" });
      const decisions = (await sql<{ id: string; review_id: string }>`SELECT id,review_id FROM fee_native_review_decisions WHERE review_id=ANY(${[accepted.id, namedQuestion.id]}::uuid[])`.execute(db)).rows;
      for (const item of decisions) {
        const notice = await db.insertInto("notifications").values({ recipient_id: people.guardian.id, kind: "general", title: "Review complete", body: "Private source decision", metadata: {},
          attention_eligible: true, attention_school_id: people.schoolId, attention_student_id: people.learner.id, attention_portal: "parent", attention_module: "fees",
          attention_source_kind: "fee_review_decision", attention_source_id: item.id, attention_source_revision: 1, attention_topic_key: `fee-review:${item.review_id}` }).returning("id").executeTakeFirstOrThrow();
        expect((await sql<{ allowed: boolean }>`SELECT notification_attention_is_currently_authorized(${notice.id}::uuid,${people.guardian.id}::uuid) AS allowed`.execute(db)).rows[0]!.allowed)
          .toBe(item.review_id === accepted.id);
      }
    });
  });
  it.runIf(Boolean(targetUrl))("verifies a captured report and closes exact Work only in one COW world, leaving Live and sibling pending", async () => {
    const f = await fixture(), input = await f.run(() => f.input()), submitted = await f.run(() => f.reviews.report(f.payer.actor, f.schoolId, f.invoiceId, input));
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "native-fee-review-test", checked_at: f.now });
        return { db: database, ...nativeFeeServices(database), namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect((await branch.reviews.work(f.reviewer.actor, f.schoolId)).needs_me).toHaveLength(1);
        const decision = { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Synthetic branch-only bank check", verified_funds: true };
        const result = await branch.reviews.decide(f.reviewer.actor, f.schoolId, submitted.id, decision);
        expect(await branch.reviews.decide(f.reviewer.actor, f.schoolId, submitted.id, decision)).toMatchObject({ payment_id: result.payment_id, replayed: true });
        expect(await paymentCount(branch.db, f.invoiceId)).toBe(1);
        expect((await branch.reviews.work(f.payer.actor, f.schoolId)).waiting).toEqual([]); expect((await branch.reviews.work(f.reviewer.actor, f.schoolId)).needs_me).toEqual([]);
        expect((await branch.db.selectFrom("campus_model_commands").select("environment_namespace_id").where("correlation_id", "=", decision.command_id).execute()).every(row => row.environment_namespace_id === branch.namespace)).toBe(true);
      });
      await sibling.run(async () => { expect(await paymentCount(sibling.db, f.invoiceId)).toBe(0); expect((await sibling.reviews.work(f.payer.actor, f.schoolId)).waiting).toHaveLength(1); });
      expect(await paymentCount(db, f.invoiceId)).toBe(0); expect((await f.run(() => f.reviews.work(f.payer.actor, f.schoolId))).waiting).toHaveLength(1);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
  it.runIf(Boolean(targetUrl))("keeps the consolidated guardian review, accepted Core command and receipt isolated in one COW world", async () => {
    const f = await createClassPracticeFixture(db), services = guardianFeeReviewServices(db, new OperationsService(db, {} as never));
    const now = new Date().toISOString(), live = createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
    const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(live, operation);
    const invoiceId = (await db.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id,
      reference: randomUUID(), description: "Guardian storage convergence", amount_paise: 10_000, due_on: f.date, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
    const submitted = await run(() => services.service.submit(f.guardian, f.schoolId, invoiceId,
      { kind: "payment", amount_paise: 4000, method: "cash", reference: randomUUID(), note: "Private synthetic claim", idempotency_key: randomUUID() }));
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "guardian-fee-review-convergence", checked_at: now });
        return { db: database, namespace, ...guardianFeeReviewServices(database, new OperationsService(database, {} as never)),
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open(), decision = { outcome: "verified", response: "Branch-only independently confirmed synthetic funds", verified_funds: true };
      await branch.run(async () => {
        const result = await branch.service.decide(f.owner, f.schoolId, submitted.id, decision);
        expect((await branch.service.decide(f.owner, f.schoolId, submitted.id, decision)).payment_id).toBe(result.payment_id);
        expect(await paymentCount(branch.db, invoiceId)).toBe(1);
        const commands = await branch.db.selectFrom("campus_model_commands").select(["environment_namespace_id", "state"])
          .where("correlation_id", "=", submitted.id).where("handler_key", "=", "finance.payment_review").execute();
        expect(commands).toEqual([{ environment_namespace_id: branch.namespace, state: "accepted" }]);
        // Exercise both guardian completion triggers with fresh branch-local
        // request and decision, not only a decision on a captured Live report.
        const question = await branch.service.submit(f.guardian, f.schoolId, invoiceId,
          { kind: "charge", note: "Explain this synthetic branch charge", idempotency_key: randomUUID() });
        await branch.service.decide(f.owner, f.schoolId, question.id, { outcome: "answered", response: "Branch-only explanation; no money changed" });
        expect((await branch.service.workspace(f.guardian, f.schoolId, f.learner.id)).reviews)
          .toEqual(expect.arrayContaining([expect.objectContaining({ id: question.id, status: "answered" })]));
        expect(await paymentCount(branch.db, invoiceId)).toBe(1);
      });
      await sibling.run(async () => { expect(await paymentCount(sibling.db, invoiceId)).toBe(0);
        expect((await sibling.service.workspace(f.guardian, f.schoolId, f.learner.id)).reviews[0]).toMatchObject({ id: submitted.id, status: "pending" }); });
      expect(await paymentCount(db, invoiceId)).toBe(0);
      expect((await run(() => services.service.workspace(f.guardian, f.schoolId, f.learner.id))).reviews[0]).toMatchObject({ id: submitted.id, status: "pending" });
      expect((await run(() => services.service.workspace(f.guardian, f.schoolId, f.learner.id))).reviews).toHaveLength(1);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
