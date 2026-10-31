import { guardianFeeReviewServices } from "./fee-review.test-support.js";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { collectionDateProjection } from "../src/operations/finance-arrangements.store.js";
import { NativeFeeReviewsService } from "../src/operations/native-fee-reviews.service.js";
import { NativeFeeReviewsModel } from "../src/operations/native-fee-reviews.model.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createFinanceArrangementsFixture } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/ledger_pagination_unused_test";
types.setTypeParser(1082, value => value);
let queryCount = 0;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }),
  log(event) { if (event.level === "query") queryCount += 1; } }) as DatabaseService;
afterAll(() => db.destroy());

describe.skipIf(!enabled)("bounded ledger reads with complete balances", () => {
  it("pages without duplicating charges, retains server totals, and opens an invoice beyond page one exactly", async () => {
    const f = await createFinanceArrangementsFixture(db);
    const ledger = new FeeLedgerService(db, f.core, f.core, f.core, f.core);
    const operations = new OperationsService(db, {} as never, undefined, undefined, ledger);
    await sql`INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
      SELECT ${f.schoolId}::uuid,${f.learner.id}::uuid,${`PAGE-${randomUUID()}-`}||n::text,'Bounded ledger regression',100,
        ${f.day}::date,${f.owner.id}::uuid FROM generate_series(1,55) n`.execute(db);
    await f.run(async () => {
      const before = queryCount, started = performance.now();
      const first = await operations.fees(f.owner, f.schoolId, f.learner.id, undefined, undefined, { limit: 10 });
      const tenQueries = queryCount - before, tenMs = performance.now() - started;
      expect(first.invoices).toHaveLength(10); expect(first.pagination.next_cursor).toBeTruthy();
      expect(first.totals.invoices).toBe(56); expect(Number(first.totals.outstanding)).toBe(3_005_500);
      const second = await operations.fees(f.owner, f.schoolId, f.learner.id, undefined, undefined, { limit: 10, cursor: first.pagination.next_cursor! });
      expect(second.invoices).toHaveLength(10); expect(second.totals).toEqual(first.totals);
      expect(second.invoices.some(invoice => first.invoices.some(previous => previous.id === invoice.id))).toBe(false);
      const wideBefore = queryCount, wideStarted = performance.now();
      const wide = await operations.fees(f.owner, f.schoolId, f.learner.id, undefined, undefined, { limit: 40 });
      const fortyQueries = queryCount - wideBefore, fortyMs = performance.now() - wideStarted;
      expect(wide.invoices).toHaveLength(40); expect(fortyQueries).toBe(tenQueries);
      console.info(JSON.stringify({ check: "bounded_fee_ledger", fixture_invoices: 56, query_count_10: tenQueries, query_count_40: fortyQueries,
        duration_ms_10: Number(tenMs.toFixed(3)), duration_ms_40: Number(fortyMs.toFixed(3)), production_capacity_claim: false }));
      const exact = await operations.fees(f.owner, f.schoolId, f.learner.id, undefined, second.invoices[9]!.id);
      expect(exact.invoices.map(invoice => invoice.id)).toEqual([second.invoices[9]!.id]);
      expect(exact.pagination.exact).toBe(true); expect(exact.pagination.next_cursor).toBeNull();
      const oldProjection = await db.transaction().execute(tx => collectionDateProjection(tx, f.schoolId, exact.invoices[0]!.id));
      expect(exact.invoices[0]).toMatchObject(oldProjection);
      const family = await operations.fees(f.guardian, f.schoolId, f.learner.id, undefined, second.invoices[9]!.id);
      expect(family.invoices).toHaveLength(1); expect(family.can_issue).toBe(false);
      await expect(operations.fees(f.guardian, f.schoolId, f.secondLearner.id)).rejects.toThrow();
      const exception = await db.insertInto("school_access_exceptions").values({ school_id: f.schoolId, user_id: f.teacher.id,
        permission: "fees.manage", reason: "Synthetic resource-only Finance boundary", source_kind: "manual", scope_kind: "assigned_resources",
        valid_from: f.day, valid_until: f.due(30), review_due_on: f.due(7), created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
      const delivery = () => sql<{ staff: boolean; family: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'fees.updated',
        ${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id })}::jsonb,${f.teacher.id}::uuid) AS staff,
        event_user_is_authorized(${f.schoolId}::uuid,'fees.updated',${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id })}::jsonb,
          ${f.guardian.id}::uuid) AS family`.execute(db);
      expect((await delivery()).rows[0]).toEqual({ staff: false, family: true });
      await expect(operations.fees(f.teacher, f.schoolId, f.learner.id)).rejects.toThrow(/institution-scoped Finance/);
      await db.updateTable("school_access_exceptions").set({ scope_kind: "institution" }).where("id", "=", exception.id).execute();
      expect((await delivery()).rows[0]).toEqual({ staff: true, family: true });
      const supported = ["finance.charge.issued", "finance.charge_batch.issued", "finance.charge.corrected", "finance.payment.corrected",
        "finance.payment_review.reported", "finance.payment_review.decided", "finance.payment_review.withdrawn",
        "finance.instalment.requested", "finance.instalment.decided", "finance.instalment.withdrawn", "finance.self_payer.enabled", "finance.self_payer.revoked"];
      const known = (await sql<{ name: string; operator: boolean; family: boolean }>`SELECT name,event_user_is_authorized(${f.schoolId}::uuid,name,
        ${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id })}::jsonb,${f.owner.id}::uuid) AS operator,
        event_user_is_authorized(${f.schoolId}::uuid,name,${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id })}::jsonb,
          ${f.guardian.id}::uuid) AS family FROM unnest(${supported}::text[]) name`.execute(db)).rows;
      expect(known).toEqual(supported.map(name => ({ name, operator: !name.startsWith("finance.payment_review."), family: !name.startsWith("finance.payment_review.") })));
      const future = (await sql<{ denied: boolean }>`SELECT bool_and(NOT event_user_is_authorized(${f.schoolId}::uuid,'finance.unregistered.synthetic',
        ${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id })}::jsonb,actor)) AS denied
        FROM unnest(${[f.owner.id, f.teacher.id, f.guardian.id, f.learner.actor.id, f.secondLearner.actor.id]}::uuid[]) actor`.execute(db)).rows[0];
      expect(future?.denied).toBe(true);
      const native = new NativeFeeReviewsService(db, f.access, new NativeFeeReviewsModel(f.core, f.core,
        new CoordinationConfigurationService(f.core), f.core, f.core));
      const nativeAccount = (await native.workspace(f.guardian, f.schoolId, { invoice_id: f.invoiceId })).invoices[0]!;
      const reviewer = nativeAccount.reviewers.find(person => person.user_id === f.owner.id)!;
      const report = await native.report(f.guardian, f.schoolId, f.invoiceId, { command_id: randomUUID(), review_id: randomUUID(),
        expected_revision: nativeAccount.stream_revision, basis_hash: nativeAccount.basis_hash, basis_revision: nativeAccount.basis_revision,
        reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }, kind: "charge", note: "Synthetic exact-source fee question" });
      const sourceEnvelope = (reviewId: string) => ({ invoice_id: f.invoiceId, student_id: f.learner.id, native_review_id: reviewId });
      const nativeEvents = ["fees.updated", ...supported.filter(name => name.startsWith("finance.payment_review."))];
      const sourceChecks = (await sql<{ valid: boolean; forged: boolean }>`SELECT
        event_user_is_authorized(${f.schoolId}::uuid,name,${JSON.stringify(sourceEnvelope(report.id))}::jsonb,${f.guardian.id}::uuid) AS valid,
        event_user_is_authorized(${f.schoolId}::uuid,name,${JSON.stringify(sourceEnvelope(randomUUID()))}::jsonb,${f.guardian.id}::uuid) AS forged
        FROM unnest(${nativeEvents}::text[]) name`.execute(db)).rows;
      expect(sourceChecks).toEqual(nativeEvents.map(() => ({ valid: true, forged: false })));
      const teachingEnvelope = (await sql<{ denied: boolean }>`SELECT NOT event_user_is_authorized(${f.schoolId}::uuid,'fees.updated',
        ${JSON.stringify({ invoice_id: f.invoiceId, student_id: f.learner.id, source_domain: "teaching_sessions" })}::jsonb,
        ${f.owner.id}::uuid) AS denied`.execute(db)).rows[0];
      expect(teachingEnvelope?.denied).toBe(true);
      const reviews = guardianFeeReviewServices(db, operations).service;
      await native.decide(f.owner, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: nativeAccount.stream_revision + 1,
        outcome: "answered", response: "The original source question was explained." });
      for (let n = 0; n < 56; n += 1) {
        const question = await reviews.submit(f.guardian, f.schoolId, f.invoiceId,
          { kind: "charge", note: "Synthetic bounded review history", idempotency_key: randomUUID() });
        await reviews.decide(f.owner, f.schoolId, question.id, { outcome: "answered", response: "The synthetic question was explained." });
      }
      const reviewPage = await reviews.workspace(f.guardian, f.schoolId, f.learner.id, undefined, f.invoiceId, { limit: 10 });
      expect(reviewPage.reviews).toHaveLength(10); expect(reviewPage.pagination.next_review_cursor).toBeTruthy();
      const nextReviews = await reviews.workspace(f.guardian, f.schoolId, f.learner.id, undefined, f.invoiceId,
        { limit: 10, review_cursor: reviewPage.pagination.next_review_cursor! });
      expect(nextReviews.reviews).toHaveLength(10);
      expect(nextReviews.reviews.some(review => reviewPage.reviews.some(previous => previous.id === review.id))).toBe(false);
      const exactReview = await reviews.workspace(f.guardian, f.schoolId, f.learner.id, undefined, undefined,
        { review_id: nextReviews.reviews[9]!.id });
      expect(exactReview.reviews.map(review => review.id)).toEqual([nextReviews.reviews[9]!.id]);
    });
  }, 30_000);
});
