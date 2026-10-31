import { guardianFeeReviewServices, linkGuardianFeeFixtureActor } from "./fee-review.test-support.js";
import { ensureFixtureGuardianProfile } from "./fixture-guardian-profile.test-support.js";
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sql } from "kysely";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import type { FeeReviewService } from "../src/operations/fee-review.service.js";
import { FeeCorrectionsService } from "../src/operations/fee-corrections.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const url = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
describe.skipIf(!isolated)("fee payment claims and review", () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  let db: DatabaseService; let service: FeeReviewService; let operations: OperationsService;
  let school: string; let student: string; let parent: AuthUser; let admin: AuthUser; let outsider: AuthUser; let learner: AuthUser;
  async function user(role: AuthUser["role"]): Promise<AuthUser> {
    const id = randomUUID(); const name = `fees-${id}`;
    await pool.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'unused','Fee','Tester',$4)", [id, name, `${name}@example.test`, role]);
    return { id, username: name, email: `${name}@example.test`, first_name: "Fee", last_name: "Tester", role, is_active: true };
  }
  async function invoice(amount = 10000) {
    return (await pool.query("INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by) VALUES($1,$2,$3,'Tuition', $4,current_date,$5) RETURNING id", [school, student, randomUUID(), amount, admin.id])).rows[0].id as string;
  }
  const claim = (reference: string = randomUUID()) => ({ kind: "payment", amount_paise: 4000, method: "bank_transfer", reference, note: "Transferred today", idempotency_key: randomUUID() });
  const approve = { outcome: "verified", response: "Matched against the school bank statement.", verified_funds: true };
  async function correctionFixture() {
    const f = await createClassPracticeFixture(db), now = new Date().toISOString();
    const environment = createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
    const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
    const ops = new OperationsService(db, createStaffCoverageReconciliationTestDouble());
    const reviews = guardianFeeReviewServices(db, ops).service, corrections = new FeeCorrectionsService(db, f.core, f.core, f.core, f.core);
    const createInvoice = async () => (await db.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id,
      reference: randomUUID(), description: "Ordinary course charge", amount_paise: 10_000, due_on: f.date, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
    const changeCharge = async (invoiceId: string, change: { kind: "amend"; amount_paise?: number; description?: string }) => {
      const selection = { invoice_ids: [invoiceId] }, preview = await corrections.preview(f.owner, f.schoolId, { selection, change });
      return corrections.apply(f.owner, f.schoolId, { command_id: randomUUID(), correction_id: randomUUID(), selection, change,
        snapshot_hash: preview.snapshot_hash, reason: "Correct the synthetic recorded charge", attested_recording_error: true });
    };
    const moneyFacts = async (invoiceId: string) => (await pool.query(`SELECT
      (SELECT count(*)::int FROM fee_payments WHERE school_id=$1 AND invoice_id=$2) AS payments,
      (SELECT count(*)::int FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.id=d.review_id AND r.school_id=d.school_id
        WHERE r.school_id=$1 AND r.invoice_id=$2) AS decisions,
      (SELECT count(*)::int FROM school_operations_audit WHERE school_id=$1) AS audits,
      (SELECT count(*)::int FROM event_outbox WHERE school_id=$1) AS events`, [f.schoolId, invoiceId])).rows[0];
    return { ...f, now, run, ops, reviews, corrections, createInvoice, changeCharge, moneyFacts };
  }
  beforeAll(async () => {
    db = new DatabaseService(); operations = new OperationsService(db, createStaffCoverageReconciliationTestDouble()); service = guardianFeeReviewServices(db, operations).service;
    admin = await user("admin"); parent = await user("parent"); outsider = await user("parent"); learner = await user("student");
    school = (await pool.query("INSERT INTO schools(name,code) VALUES('Review Test School',$1) RETURNING id", [randomUUID().slice(0, 25)])).rows[0].id;
    for (const [actor, role] of [[admin, "admin"], [parent, "guardian"], [outsider, "guardian"], [learner, "student"]] as const) await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)", [school, actor.id, role]);
    student = (await pool.query("INSERT INTO students(user_id,school_id,admission_number) VALUES($1,$2,$3) RETURNING id", [learner.id, school, randomUUID()])).rows[0].id;
    const p = (await pool.query("INSERT INTO parents(user_id) VALUES($1) RETURNING id", [parent.id])).rows[0].id;
    await ensureFixtureGuardianProfile(pool,{schoolId:school,guardianId:p,firstName:parent.first_name,lastName:parent.last_name});
    await pool.query("INSERT INTO guardian_relationships(school_id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'guardian')", [school, student, p]);
    for (const actor of [admin, parent, learner]) await linkGuardianFeeFixtureActor(db, guardianFeeReviewServices(db, operations).core, school, actor, admin.id);
  });
  afterAll(async () => { await db?.destroy(); await pool.end(); });
  it("restricts submissions to active linked guardians, and school-wide reads to finance staff", async () => {
    const id = await invoice();
    await expect(service.submit(outsider, school, id, claim())).rejects.toThrow(/guardian/);
    await expect(service.submit(learner, school, id, claim())).rejects.toThrow(/guardian/);
    await expect(service.workspace(parent, school)).rejects.toThrow(/institution-scoped Finance/);
    await expect(service.workspace(outsider, school, student)).rejects.toThrow(/institution-scoped Finance/);
    await expect(service.submit(parent, randomUUID(), id, claim())).rejects.toThrow(/not found/);
    expect((await service.workspace(learner, school, student)).can_submit).toBe(false);
    expect((await service.workspace(parent, school, student)).can_submit).toBe(true);
  });
  it("keeps submissions out of the ledger and replays only an identical idempotent request", async () => {
    const id = await invoice(); const input = claim(); const first = await service.submit(parent, school, id, input);
    expect(await service.submit(parent, school, id, input)).toEqual(first);
    await expect(service.submit(parent, school, id, { ...input, amount_paise: 3000 })).rejects.toThrow(/different/);
    await expect(service.submit(parent, school, id, claim())).rejects.toThrow(/pending/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
    const outbox = await pool.query("SELECT audience_user_ids,payload FROM event_outbox WHERE aggregate_id=$1", [first.id]);
    expect(outbox.rows[0].audience_user_ids).toContain(parent.id);
    expect(outbox.rows[0].audience_user_ids).not.toContain(outsider.id);
    expect(outbox.rows[0].payload).not.toHaveProperty("reference");
  });
  it("requires finance permission and verified funds, then atomically creates exactly one receipt", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    await expect(service.decide(parent, school, request.id, approve)).rejects.toThrow(/institution-scoped Finance/);
    await expect(service.decide(admin, school, request.id, { ...approve, verified_funds: false })).rejects.toThrow(/Confirm/);
    const result = await service.decide(admin, school, request.id, approve);
    expect(result.payment_id).toBeTruthy();
    expect((await service.decide(admin, school, request.id, approve)).payment_id).toBe(result.payment_id);
    await expect(service.decide(admin, school, request.id, { outcome: "rejected", response: "Another reviewer disagreed." })).rejects.toThrow(/already reviewed/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(1);
    const ledger = await service.workspace(parent, school, student);
    expect(ledger.invoices.find((item: unknown) => (item as { id: string }).id === id)).toMatchObject({ balance_paise: 6000 });
  });
  it("serializes competing reviewers and keeps one final decision", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    const results = await Promise.allSettled([
      service.decide(admin, school, request.id, approve),
      service.decide(admin, school, request.id, { outcome: "rejected", response: "Competing reviewer cannot match payment." }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_native_review_decisions WHERE review_id=$1", [request.id])).rows[0].count).toBe(1);
  });
  it("allows delegated finance review but prevents self-verification", async () => {
    const reviewer = await user("staff");
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'staff')", [school, reviewer.id]);
    await linkGuardianFeeFixtureActor(db, guardianFeeReviewServices(db, operations).core, school, reviewer, admin.id);
    const request = await service.submit(parent, school, await invoice(), claim());
    await expect(service.decide(reviewer, school, request.id, approve)).rejects.toThrow(/institution-scoped Finance/);
    await pool.query(`INSERT INTO school_access_exceptions(
      school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by
    ) VALUES($1,$2,'fees.manage','Temporary finance review coverage for integration test','manual','institution',current_date,current_date+30,current_date+15,$3)`, [school, reviewer.id, admin.id]);
    await service.decide(reviewer, school, request.id, approve);
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')", [school, parent.id]);
    const own = await service.submit(parent, school, await invoice(), claim());
    await expect(service.decide(parent, school, own.id, approve)).rejects.toThrow(/own submission/);
    await pool.query("DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin'", [school, parent.id]);
  });
  it("rejects case-insensitive duplicate references across invoices", async () => {
    const reference = `BANK-${randomUUID()}`;
    await service.submit(parent, school, await invoice(), claim(reference));
    await expect(service.submit(parent, school, await invoice(), claim(reference.toLowerCase()))).rejects.toThrow(/reference/);
  });
  it("rolls guardian state, audit, typed events and command evidence back together if Core completion fails", async () => {
    const f = await createClassPracticeFixture(db), context = guardianFeeReviewServices(db, operations, f.core);
    const invoiceId = (await db.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id,
      reference: randomUUID(), description: "Atomic guardian review", amount_paise: 10000, due_on: f.date, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
    const input = claim(), before = (await pool.query("SELECT count(*)::int AS count FROM event_outbox WHERE school_id=$1", [f.schoolId])).rows[0].count;
    const failure = vi.spyOn(context.model, "finish").mockRejectedValueOnce(new Error("Synthetic completion failure"));
    await expect(context.service.submit(f.guardian, f.schoolId, invoiceId, input)).rejects.toThrow("Synthetic completion");
    failure.mockRestore();
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_native_review_requests WHERE invoice_id=$1", [invoiceId])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM event_outbox WHERE school_id=$1", [f.schoolId])).rows[0].count).toBe(before);
    expect((await pool.query("SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=$1 AND correlation_id=$2", [f.schoolId, input.idempotency_key])).rows[0].count).toBe(0);
    const accepted = await context.service.submit(f.guardian, f.schoolId, invoiceId, input);
    expect((await pool.query("SELECT state,command_type FROM campus_model_commands WHERE school_id=$1 AND correlation_id=$2", [f.schoolId, input.idempotency_key])).rows[0])
      .toEqual({ state: "accepted", command_type: "finance.payment_review.report" });
    expect((await context.service.decide(f.owner, f.schoolId, accepted.id, approve)).payment_id).toBeTruthy();
  });
  it("refuses an accepted command from a different selected world at the database completion boundary", async () => {
    const f = await createClassPracticeFixture(db), context = guardianFeeReviewServices(db, operations, f.core);
    const invoiceId = (await db.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id,
      reference: randomUUID(), description: "Exact Finance world guard", amount_paise: 10000, due_on: f.date, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow()).id;
    const finish = context.model.finish.bind(context.model), key = randomUUID();
    const wrongWorld = vi.spyOn(context.model, "finish").mockImplementationOnce(async (tx, ...args) => {
      const result = await finish(tx, ...args);
      await sql`SELECT set_config('thatcampus.namespace_id',${`live:${randomUUID()}`},true)`.execute(tx);
      return result;
    });
    await expect(context.service.submit(f.guardian, f.schoolId, invoiceId, { ...claim(), idempotency_key: key })).rejects.toThrow("selected world");
    wrongWorld.mockRestore();
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_native_review_requests WHERE invoice_id=$1", [invoiceId])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=$1 AND correlation_id=$2", [f.schoolId, key])).rows[0].count).toBe(0);
  });
  it("blocks overpayments and stale approvals without writing a receipt or decision", async () => {
    await expect(service.submit(parent, school, await invoice(1000), claim())).rejects.toThrow(/exceeds/);
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    await operations.payment(admin, school, id, { amount_paise: 8000, method: "cash", reference: randomUUID(), idempotency_key: randomUUID() });
    await expect(service.decide(admin, school, request.id, approve)).rejects.toThrow(/balance changed/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_native_review_decisions WHERE review_id=$1", [request.id])).rows[0].count).toBe(0);
  });
  it("allows rejection then corrected resubmission without reducing the balance", async () => {
    const id = await invoice(); const input = claim(); const request = await service.submit(parent, school, id, input);
    await service.decide(admin, school, request.id, { outcome: "rejected", response: "Transaction not found in bank statement." });
    await service.submit(parent, school, id, { ...input, idempotency_key: randomUUID(), note: "Corrected details" });
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
  });
  it("invalidates pending legacy reports after charge or receipt corrections at the same frozen instant, while a fresh report works", async () => {
    const f = await correctionFixture();
    await f.run(async () => {
      for (const mode of ["amount", "description", "receipt"] as const) {
        const invoiceId = await f.createInvoice();
        const payment = mode === "receipt" ? await f.ops.payment(f.owner, f.schoolId, invoiceId,
          { amount_paise: 1000, method: "cash", reference: randomUUID(), idempotency_key: randomUUID() }) as { id: string } : null;
        const input = claim(), request = await f.reviews.submit(f.guardian, f.schoolId, invoiceId, input);
        const original = await db.selectFrom("fee_native_review_requests").selectAll().where("id", "=", request.id).executeTakeFirstOrThrow();
        expect(original.correction_watermark).toEqual({ invoice_revision: 0, payment_correction_count: 0 });
        let correctionId: string;
        if (payment) {
          const preview = await f.corrections.paymentPreview(f.owner, f.schoolId, payment.id, { action: "reverse" });
          correctionId = randomUUID();
          await f.corrections.correctPayment(f.owner, f.schoolId, payment.id, { action: "reverse", command_id: randomUUID(), correction_id: correctionId,
            snapshot_hash: preview.snapshot_hash, reason: "Correct the synthetic receipt recording", attested_recording_error: true });
        } else correctionId = (await f.changeCharge(invoiceId, mode === "amount" ? { kind: "amend", amount_paise: 12_000 }
          : { kind: "amend", description: "Corrected course charge description" })).correction_id;
        const correction = payment ? await db.selectFrom("fee_payment_corrections").select("created_at").where("id", "=", correctionId).executeTakeFirstOrThrow()
          : await db.selectFrom("fee_invoice_corrections").select("created_at").where("id", "=", correctionId).executeTakeFirstOrThrow();
        expect(original.created_at.toISOString()).toBe(f.now);
        expect(correction.created_at.toISOString()).toBe(f.now);
        const before = await f.moneyFacts(invoiceId);
        await expect(f.reviews.decide(f.owner, f.schoolId, request.id, approve)).rejects.toThrow(/fee records changed/i);
        expect(await f.moneyFacts(invoiceId)).toEqual(before);
        expect(await db.selectFrom("fee_native_review_requests").selectAll().where("id", "=", request.id).executeTakeFirstOrThrow()).toEqual(original);
        expect(await f.reviews.submit(f.guardian, f.schoolId, invoiceId, input)).toEqual(request);
        await f.reviews.decide(f.owner, f.schoolId, request.id, { outcome: "rejected", response: "The records changed; please submit a fresh report." });
        const fresh = await f.reviews.submit(f.guardian, f.schoolId, invoiceId, { ...input, idempotency_key: randomUUID() });
        const current = await db.selectFrom("fee_native_review_requests").selectAll().where("id", "=", fresh.id).executeTakeFirstOrThrow();
        expect(current.created_at.toISOString()).toBe(f.now);
        expect(current.correction_watermark).toEqual(payment ? { invoice_revision: 0, payment_correction_count: 1 } : { invoice_revision: 1, payment_correction_count: 0 });
        const accepted = await f.reviews.decide(f.owner, f.schoolId, fresh.id, approve);
        expect(accepted.payment_id).toBeTruthy();
        await f.changeCharge(invoiceId, { kind: "amend", description: "Later explicitly corrected course description" });
        const after = await f.moneyFacts(invoiceId);
        expect((await f.reviews.decide(f.owner, f.schoolId, fresh.id, approve)).payment_id).toBe(accepted.payment_id);
        expect(await f.moneyFacts(invoiceId)).toEqual(after);
      }
    });
  });
  it("retains historical no-watermark hashes and fails closed only once corrected; new watermark facts cannot be changed", async () => {
    const f = await correctionFixture();
    await f.run(async () => {
      const historical = async (invoiceId: string) => {
        const input = claim(), hash = createHash("sha256").update(JSON.stringify({ invoiceId, userId: f.guardian.id, ...input })).digest("hex");
        const report = await f.reviews.submit(f.guardian, f.schoolId, invoiceId, input);
        // Privileged fixture of the retained pre-watermark shape; the running
        // application cannot rewrite history. Actual215 import is tested separately.
        const row = await db.transaction().execute(async tx => {
          await sql`ALTER TABLE fee_native_review_requests DISABLE TRIGGER fee_native_review_immutable`.execute(tx);
          const result = (await sql<{ id: string; request_hash: string; correction_watermark: null }>`UPDATE fee_native_review_requests SET correction_watermark=NULL
            WHERE id=${report.id}::uuid RETURNING id,request_hash,correction_watermark`.execute(tx)).rows[0]!;
          await sql`ALTER TABLE fee_native_review_requests ENABLE TRIGGER fee_native_review_immutable`.execute(tx);
          return result;
        });
        expect(row.request_hash).toBe(hash);
        expect(row.correction_watermark).toBeNull();
        expect(await f.reviews.submit(f.guardian, f.schoolId, invoiceId, input)).toEqual({ id: row.id });
        return row;
      };
      const untouched = await historical(await f.createInvoice());
      expect((await f.reviews.decide(f.owner, f.schoolId, untouched.id, approve)).payment_id).toBeTruthy();
      const invoiceId = await f.createInvoice(), stale = await historical(invoiceId);
      await f.changeCharge(invoiceId, { kind: "amend", description: "Corrected historical ordinary charge" });
      const before = await f.moneyFacts(invoiceId);
      await expect(f.reviews.decide(f.owner, f.schoolId, stale.id, approve)).rejects.toThrow(/fee records changed/i);
      expect(await f.moneyFacts(invoiceId)).toEqual(before);
      expect((await pool.query("SELECT request_hash,correction_watermark FROM fee_native_review_requests WHERE id=$1", [stale.id])).rows[0])
        .toEqual({ request_hash: stale.request_hash, correction_watermark: null });
      await f.reviews.decide(f.owner, f.schoolId, stale.id, { outcome: "rejected", response: "Please send a fresh report for these corrected records." });
      const fresh = await f.reviews.submit(f.guardian, f.schoolId, invoiceId, claim());
      await expect(pool.query("UPDATE fee_native_review_requests SET correction_watermark='{}'::jsonb WHERE id=$1", [fresh.id])).rejects.toThrow(/cannot/i);
      await expect(pool.query(`INSERT INTO fee_native_review_requests(school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,idempotency_key,request_hash,correction_watermark)
        VALUES($1,$2,'payment',100,'cash',$3,'Synthetic invalid watermark',$4,$5,repeat('a',64),$6::jsonb)`,
      [f.schoolId, await f.createInvoice(), randomUUID(), f.guardian.id, randomUUID(), JSON.stringify({ invoice_revision: 0, payment_correction_count: 0.5 })])).rejects.toThrow();
      expect((await f.reviews.decide(f.owner, f.schoolId, fresh.id, approve)).payment_id).toBeTruthy();
    });
  });
  it("answers fee questions without claiming an adjustment or issuing a payment", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, { kind: "charge", note: "Please explain the transport charge", idempotency_key: randomUUID() });
    await expect(service.decide(admin, school, request.id, approve)).rejects.toThrow(/appropriate/);
    await service.decide(admin, school, request.id, { outcome: "answered", response: "Transport covers the first term only." });
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
    await expect(pool.query("DELETE FROM fee_native_review_requests WHERE id=$1", [request.id])).rejects.toThrow(/cannot/);
    await expect(pool.query("UPDATE fee_native_review_decisions SET response='changed' WHERE review_id=$1", [request.id])).rejects.toThrow(/cannot/);
  });
  it("protects payment instructions with administrator authorization and revision checks", async () => {
    const settings = { payee_name: "Review School", upi_id: "school@bank", instructions: "Use invoice reference in the transfer note.", expected_revision: 0 };
    await expect(service.settings(parent, school, settings)).rejects.toThrow(/permission/);
    await service.settings(admin, school, settings);
    await expect(service.settings(admin, school, settings)).rejects.toThrow(/changed/);
    expect((await service.workspace(parent, school, student)).payment_settings).toMatchObject({ upi_id: "school@bank", revision: 1 });
    const event = await pool.query("SELECT event_type,aggregate_type,payload FROM event_outbox WHERE school_id=$1 AND idempotency_key=$2", [school, `fee-settings:${school}:1`]);
    expect(event.rows[0]).toMatchObject({
      event_type: "administration.updated",
      aggregate_type: "fee_payment_settings",
      payload: { action: "fee_instructions_updated", revision: 1, refresh: ["fees", "parent.home", "principal.home"] },
    });
  });
  it("loads an exact open gateway review beyond the 100-row workspace cap with current school access", async () => {
    const invoiceId = await invoice();
    const targetOrderId = randomUUID();
    await pool.query(`
      INSERT INTO fee_gateway_orders(
        id,school_id,invoice_id,created_by,amount_paise,key_id,
        provider_order_id,provider_payment_id,state,created_at,checked_at
      )
      SELECT CASE WHEN n=101 THEN $4::uuid ELSE gen_random_uuid() END,
        $1::uuid,$2::uuid,$3::uuid,100,'rzp_test_exact_detail',
        'order_'||gen_random_uuid()::text,'payment_'||gen_random_uuid()::text,
        'review_required',now()-(n*interval '1 minute'),now()-(n*interval '1 minute')
      FROM generate_series(1,101) AS generated(n)
    `, [school, invoiceId, admin.id, targetOrderId]);

    const workspace = await service.workspace(admin, school);
    expect(workspace.gateway_payments).toHaveLength(100);
    expect((workspace.gateway_payments as Array<{ id: string }>).some((item) => item.id === targetOrderId)).toBe(false);
    await expect(service.gatewayPaymentReview(admin, school, targetOrderId)).resolves.toMatchObject({
      id: targetOrderId,
      invoice_id: invoiceId,
      state: "review_required",
    });

    const temporaryAdmin = await user("admin");
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')", [school, temporaryAdmin.id]);
    await expect(service.gatewayPaymentReview(temporaryAdmin, school, targetOrderId)).resolves.toMatchObject({ id: targetOrderId });
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [school, temporaryAdmin.id]);
    await expect(service.gatewayPaymentReview(temporaryAdmin, school, targetOrderId)).rejects.toThrow(/permission/);

    const otherSchoolAdmin = await user("admin");
    const otherSchool = (await pool.query("INSERT INTO schools(name,code) VALUES('Other Review School',$1) RETURNING id", [randomUUID().slice(0, 25)])).rows[0].id;
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')", [otherSchool, otherSchoolAdmin.id]);
    await expect(service.gatewayPaymentReview(otherSchoolAdmin, otherSchool, targetOrderId)).rejects.toThrow(/not found/);
  });
  it("revoked guardian links cannot read fee events or submit new claims", async () => {
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [school, parent.id]);
    const result = await pool.query("SELECT event_user_is_authorized($1,'fees.updated',$2::jsonb,$3) AS allowed", [school, JSON.stringify({ student_id: student }), parent.id]);
    expect(result.rows[0].allowed).toBe(false);
    await expect(service.submit(parent, school, await invoice(), claim())).rejects.toThrow(/guardian/);
  });
});
