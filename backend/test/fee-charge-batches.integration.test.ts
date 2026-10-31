import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { FeeChargeBatchService } from "../src/operations/fee-charge-batch.service.js";
import { FeeCorrectionsService } from "../src/operations/fee-corrections.service.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { NativeFeeReviewsModel } from "../src/operations/native-fee-reviews.model.js";
import { NativeFeeReviewsService } from "../src/operations/native-fee-reviews.service.js";
import { effectiveSchoolAccess } from "../src/roles/authorization.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { createFinanceArrangementsFixture, financeArrangementServices } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/fee_charge_batch_unused_test";
const targetUrl = process.env.FEE_CHARGE_BATCHES_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
type GroupKind = "participation" | "class" | "learning" | "organization";
type Selection = { person_ids: string[]; groups: Array<{ kind: GroupKind; id: string }> };
const financeBatchId = (invoice: { charge_batch: { id: string } | null }) => invoice.charge_batch?.id ?? null;
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as AuthenticatedRequest;
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const services = (database: DatabaseService) => {
  const context = financeArrangementServices(database);
  return { ...context, batches: new FeeChargeBatchService(database, context.core, context.core, context.core, context.core) };
};
function nativeFeeServices(database: DatabaseService) {
  const context = financeArrangementServices(database), model = new NativeFeeReviewsModel(context.core, context.core, new CoordinationConfigurationService(context.core), context.core, context.core);
  return { ...context, reviews: new NativeFeeReviewsService(database, context.access, model) };
}
async function fixture() {
  const f = await createLearningOfferingFixture(db), context = services(db);
  const group = (people = [f.learner.id, f.secondLearner.id], name = "Robotics activity") => f.people.createGroup(request(f.owner), f.schoolId,
    { idempotency_key: randomUUID(), name, person_ids: people, starts_on: plus(f.today, -1), ends_on: null });
  const prepare = async (selection: Selection, overrides: Record<string, unknown> = {}) => {
    const preview = await context.batches.preview(f.owner, f.schoolId, { selection });
    return { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: preview.snapshot_hash, reference: `COLL-${randomUUID()}`,
      description: "Shared robotics materials", amount_paise: 12_500, due_on: f.today, ...overrides };
  };
  return { ...f, ...context, group, prepare };
}
async function facts(database: DatabaseService, schoolId: string) {
  return (await sql<{ invoices: number; payments: number; batches: number; items: number; commands: number; events: number; audits: number }>`SELECT
    (SELECT count(*)::int FROM fee_invoices WHERE school_id=${schoolId}::uuid) AS invoices,
    (SELECT count(*)::int FROM fee_payments WHERE school_id=${schoolId}::uuid) AS payments,
    (SELECT count(*)::int FROM fee_charge_batches WHERE school_id=${schoolId}::uuid) AS batches,
    (SELECT count(*)::int FROM fee_charge_batch_items WHERE school_id=${schoolId}::uuid) AS items,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND handler_key='finance.charge_batch') AS commands,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid AND event_type IN ('finance.charge.issued','finance.charge_batch.issued')) AS events,
    (SELECT count(*)::int FROM school_operations_audit WHERE school_id=${schoolId}::uuid) AS audits`.execute(database)).rows[0]!;
}
async function rejected(action: () => Promise<unknown>) {
  try { await action(); } catch (error) {
    if (error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function") {
      return { response: error.getResponse(), status: "getStatus" in error && typeof error.getStatus === "function" ? error.getStatus() : null };
    }
    throw error;
  }
  throw new Error("Expected the exact batch command to be rejected.");
}

describe.skipIf(!enabled)("reviewed multi-person and current-group charge collections", () => {
  it("deduplicates canonical overlaps but never same-name people, and posts independent immutable invoices with one exact collection", async () => {
    const f = await fixture(), sameName = await f.passive(f.learner.person.first_name), group = await f.group();
    const selection: Selection = { person_ids: [f.learner.id, sameName.id], groups: [{ kind: "participation", id: group.id }] };
    const preview = await f.batches.preview(f.owner, f.schoolId, { selection });
    expect(preview.person_count).toBe(3); expect(preview.duplicate_count).toBeGreaterThan(0);
    expect(preview.people.map(row => row.person_id).sort()).toEqual([f.learner.id, f.secondLearner.id, sameName.id].sort());
    const before = await academicScaffoldingCounts(db, f.schoolId), input = await f.prepare(selection), result = await f.batches.issue(f.owner, f.schoolId, input);
    expect(result).toMatchObject({ id: input.batch_id, batch_id: input.batch_id, person_count: 3, total_amount_paise: 37_500, revision: 1, replayed: false });
    expect(new Set(result.invoices.map(row => row.invoice_id)).size).toBe(3);
    expect(result.invoices.map(row => row.reference)).toEqual([1, 2, 3].map(n => `${input.reference}/${String(n).padStart(3, "0")}`));
    expect((await db.selectFrom("fee_invoices").select(["id", "person_id", "student_id", "amount_paise"]).where("id", "in", result.invoices.map(row => row.invoice_id)).execute()))
      .toEqual(expect.arrayContaining(result.invoices.map(row => ({ id: row.invoice_id, person_id: row.person_id, student_id: null, amount_paise: 12_500 }))));
    expect((await facts(db, f.schoolId)).payments).toBe(0); expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual(before);
    const retained = await f.batches.detail(f.owner, f.schoolId, result.batch_id);
    expect(retained).toMatchObject({ batch_id: result.batch_id, person_count: 3, invoices: result.invoices });
    await expect(sql`UPDATE fee_invoices SET amount_paise=1 WHERE id=${result.invoices[0]!.invoice_id}::uuid`.execute(db)).rejects.toThrow();
    await expect(sql`UPDATE fee_charge_batches SET person_count=1 WHERE id=${result.batch_id}::uuid`.execute(db)).rejects.toThrow();
    await expect(sql`DELETE FROM fee_charge_batch_items WHERE batch_id=${result.batch_id}::uuid`.execute(db)).rejects.toThrow();
    const operations = new OperationsService(db, {} as never, undefined, undefined, new FeeLedgerService(db, f.core, f.core, f.core, f.core));
    expect((await operations.fees(f.owner, f.schoolId)).invoices.filter(invoice => result.invoices.some(row => row.invoice_id === invoice.id))).toHaveLength(3);
    await expect(f.batches.detail(f.learner.actor, f.schoolId, result.batch_id)).rejects.toThrow();
    expect((await new FeeLedgerService(db, f.core, f.core, f.core, f.core).accounts(f.learner.actor, f.schoolId)).items).toEqual([]);
  });

  it("retains accepted exact IDs after a roster change, but rejects changed payload and stale new review without effects", async () => {
    const f = await fixture(), group = await f.group([f.learner.id]), selection: Selection = { person_ids: [], groups: [{ kind: "participation", id: group.id }] };
    const input = await f.prepare(selection), accepted = await f.batches.issue(f.owner, f.schoolId, input);
    await f.people.replaceMembers(request(f.owner), f.schoolId, group.id, { idempotency_key: randomUUID(), expected_revision: 1, effective_on: f.today, person_ids: [f.secondLearner.id] });
    const before = await facts(db, f.schoolId);
    expect(await f.batches.issue(f.owner, f.schoolId, input)).toMatchObject({ ...accepted, replayed: true });
    expect(await facts(db, f.schoolId)).toEqual(before);
    await expect(f.batches.issue(f.owner, f.schoolId, { ...input, amount_paise: 99 })).rejects.toThrow(/different|used/i);
    const changed = { ...input, command_id: randomUUID(), batch_id: randomUUID(), reference: `STALE-${randomUUID()}` };
    const failure = await rejected(() => f.batches.issue(f.owner, f.schoolId, changed));
    expect(failure).toMatchObject({ status: 400, response: { code: "finance.charge_audience_changed" } });
    expect(failure.response).not.toHaveProperty("fields.charge_obsolete"); expect(await facts(db, f.schoolId)).toEqual({ ...before, commands: before.commands + 1 });
    expect(await f.batches.confirmation(f.owner, f.schoolId, changed.batch_id, changed.command_id)).toMatchObject({ state: "not_accepted" });
    expect(await f.batches.confirmation(f.owner, f.schoolId, input.batch_id, input.command_id)).toMatchObject({ state: "accepted", result: { invoices: accepted.invoices } });
    await expect(f.batches.confirmation(f.owner, f.schoolId, randomUUID(), input.command_id)).rejects.toThrow();
    await expect(f.batches.confirmation(f.secondLearner.actor, f.schoolId, input.batch_id, input.command_id)).rejects.toThrow();
  });

  it("identifies collections by exact manifest IDs, keeps similarly named charges distinct and reads current corrected and cancelled totals", async () => {
    const f = await fixture(), selection: Selection = { person_ids: [f.learner.id, f.secondLearner.id], groups: [] }, description = "Shared workshop charge";
    const firstInput = await f.prepare(selection, { description, amount_paise: 10_000 }), secondInput = await f.prepare(selection, { description, amount_paise: 11_000 });
    const first = await f.batches.issue(f.owner, f.schoolId, firstInput), second = await f.batches.issue(f.owner, f.schoolId, secondInput);
    const ledger = new FeeLedgerService(db, f.core, f.core, f.core, f.core), operations = new OperationsService(db, {} as never, undefined, undefined, ledger);
    const standaloneId = randomUUID();
    await ledger.issue(f.owner, f.schoolId, { command_id: randomUUID(), invoice_id: standaloneId, beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
      reference: `${firstInput.reference}/standalone`, description, amount_paise: 777, due_on: f.today });
    const initial = await operations.fees(f.owner, f.schoolId);
    for (const batch of [first, second]) {
      const items = initial.invoices.filter(invoice => batch.invoices.some(item => item.invoice_id === invoice.id));
      expect(items).toHaveLength(2);
      expect(items.every(invoice => financeBatchId(invoice) === batch.batch_id)).toBe(true);
      for (const invoice of items) expect(invoice).toMatchObject({ charge_batch: { id: batch.batch_id, reference: batch.reference, description, person_count: 2 } });
    }
    expect(initial.invoices.find(invoice => invoice.id === standaloneId)).toMatchObject({ charge_batch: null });
    const corrections = new FeeCorrectionsService(db, f.core, f.core, f.core, f.core), firstId = first.invoices[0]!.invoice_id, cancelledId = first.invoices[1]!.invoice_id;
    for (const [invoiceId, change] of [[firstId, { kind: "amend", amount_paise: 6000 }], [cancelledId, { kind: "cancel" }]] as const) {
      const selection = { invoice_ids: [invoiceId], batch_id: first.batch_id }, quote = await corrections.preview(f.owner, f.schoolId, { selection, change });
      await corrections.apply(f.owner, f.schoolId, { command_id: randomUUID(), correction_id: randomUUID(), selection, change,
        snapshot_hash: quote.snapshot_hash, reason: "Synthetic collection recording correction", attested_recording_error: true });
    }
    // Operationally independent synthetic verifier, not a consequence of the batch.
    await db.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.instructor.actor.id).execute();
    const native = nativeFeeServices(db), account = (await native.reviews.workspace(f.owner, f.schoolId, { invoice_id: firstId })).invoices[0]!;
    const reviewer = account.reviewers.find(item => item.user_id === f.instructor.actor.id)!;
    const report = await native.reviews.report(f.owner, f.schoolId, firstId, { command_id: randomUUID(), review_id: randomUUID(), expected_revision: account.stream_revision,
      basis_hash: account.basis_hash, basis_revision: account.basis_revision, reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash },
      kind: "payment", amount_paise: 2000, method: "cash", reference: `GROUPED-RECEIPT-${randomUUID()}`, note: "Synthetic counter report", payment_made: true });
    await native.reviews.decide(f.instructor.actor, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: report.revision, outcome: "verified", response: "Synthetic funds independently checked", verified_funds: true });
    const current = await operations.fees(f.owner, f.schoolId), members = current.invoices.filter(invoice => financeBatchId(invoice) === first.batch_id);
    expect(members).toHaveLength(2);
    expect(members.reduce((total, invoice) => total + invoice.amount_paise, 0)).toBe(20_000);
    expect(members.reduce((total, invoice) => total + invoice.adjusted_amount_paise, 0)).toBe(6000);
    expect(members.reduce((total, invoice) => total + invoice.balance_paise, 0)).toBe(4000);
    expect(members.reduce((total, invoice) => total + invoice.paid_paise, 0)).toBe(2000);
    expect(members.find(invoice => invoice.id === firstId)).toMatchObject({ effective_amount_paise: 6000 });
    expect(members.find(invoice => invoice.id === cancelledId)).toMatchObject({ amount_paise: 10_000, effective_amount_paise: 0, adjusted_amount_paise: 0, balance_paise: 0, charge_state: "cancelled" });
    expect(current.invoices.filter(invoice => financeBatchId(invoice) === second.batch_id).reduce((total, invoice) => total + invoice.amount_paise, 0)).toBe(22_000);
    expect(current.invoices.find(invoice => invoice.id === standaloneId)).toMatchObject({ amount_paise: 777, balance_paise: 777, charge_batch: null });
    const grouped = await operations.fees(f.owner, f.schoolId, undefined, undefined, undefined, { group_collections: "true" });
    expect(grouped.invoices).toHaveLength(3); expect(grouped.totals.invoices).toBe(5);
    expect(Number(grouped.totals.outstanding)).toBe(26_777);
    expect(grouped.invoices.find(invoice => financeBatchId(invoice) === first.batch_id)).toMatchObject({
      charge_batch: { id: first.batch_id, person_count: 2, summary: { complete: true, outstanding: 4000, cancelled: 1 } },
    });
    const exactBatch = await operations.fees(f.owner, f.schoolId, undefined, undefined, undefined, { batch_id: first.batch_id, limit: 1 });
    expect(exactBatch.invoices).toHaveLength(2); expect(exactBatch.pagination.next_cursor).toBeNull();
    expect(Number(exactBatch.totals.outstanding)).toBe(4000);
    const scoped = await operations.fees(f.owner, f.schoolId, undefined, f.learner.id);
    expect(scoped.invoices.every(invoice => financeBatchId(invoice) === null)).toBe(true);
    expect((await operations.fees(f.owner, f.schoolId, undefined, undefined, firstId)).invoices).toEqual([expect.objectContaining({ id: firstId, charge_batch: null })]);
  }, 60_000);

  it("rolls back every invoice, native event, manifest, audit and command when the journal or accepted outcome fails", async () => {
    const f = await fixture(), input = await f.prepare({ person_ids: [f.learner.id, f.secondLearner.id], groups: [] }), before = await facts(db, f.schoolId);
    const original = f.core.recordAcceptedEvent.bind(f.core); let calls = 0;
    const journalFailure = vi.spyOn(f.core, "recordAcceptedEvent").mockImplementation(async (...args) => {
      calls += 1; if (calls === 2) throw new Error("Injected second beneficiary journal failure"); return original(...args);
    });
    await expect(f.batches.issue(f.owner, f.schoolId, input)).rejects.toThrow("Injected second beneficiary journal failure"); journalFailure.mockRestore();
    expect(await facts(db, f.schoolId)).toEqual(before);
    expect(await f.batches.confirmation(f.owner, f.schoolId, input.batch_id, input.command_id)).toMatchObject({ state: "not_found" });
    const outcomeFailure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected collection outcome failure"));
    await expect(f.batches.issue(f.owner, f.schoolId, input)).rejects.toThrow("Injected collection outcome failure"); outcomeFailure.mockRestore();
    expect(await facts(db, f.schoolId)).toEqual(before);
    const accepted = await f.batches.issue(f.owner, f.schoolId, input); expect(accepted.invoices).toHaveLength(2);
    await expect(f.batches.issue(f.owner, f.schoolId, { ...input, command_id: randomUUID(), batch_id: randomUUID() })).rejects.toThrow(/reference|already/i);
    expect((await facts(db, f.schoolId)).invoices).toBe(before.invoices + 2);
  });

  it("serializes concurrent exact batches and conflicting references without partial duplicate invoices", async () => {
    const f = await fixture(), input = await f.prepare({ person_ids: [f.learner.id, f.secondLearner.id], groups: [] });
    const results = await Promise.all([f.batches.issue(f.owner, f.schoolId, input), f.batches.issue(f.owner, f.schoolId, input)]);
    expect(results[0].invoices).toEqual(results[1].invoices); expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
    const conflicting = { ...input, command_id: randomUUID(), batch_id: randomUUID() };
    const outcomes = await Promise.allSettled([f.batches.issue(f.owner, f.schoolId, input), f.batches.issue(f.owner, f.schoolId, conflicting)]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter(row => row.status === "rejected")).toHaveLength(1);
    expect((await facts(db, f.schoolId)).invoices).toBe(2);
  });

  it("selects direct current participation, class, learning and organization membership using the same campus date", async () => {
    const f = await fixture(), now = "2037-06-16T18:45:00Z", day = "2037-06-17", yesterday = plus(day, -1), tomorrow = plus(day, 1);
    await db.updateTable("schools").set({ timezone: "Asia/Kolkata" }).where("id", "=", f.schoolId).execute();
    const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(now), nowIso: () => now } }), operation);
    const active = f.learner.id, future = f.secondLearner.id, ended = (await f.passive("Ended direct member")).id, descendant = (await f.passive("Descendant only")).id;
    const participant = await run(() => f.people.createGroup(request(f.owner), f.schoolId, { idempotency_key: randomUUID(), name: "Dated participation", person_ids: [active], starts_on: yesterday, ends_on: day }));
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,ends_on,created_by)
      VALUES(${f.schoolId}::uuid,${participant.id}::uuid,${future}::uuid,${tomorrow}::date,NULL,${f.owner.id}::uuid),
        (${f.schoolId}::uuid,${participant.id}::uuid,${ended}::uuid,${plus(day, -2)}::date,${yesterday}::date,${f.owner.id}::uuid)`.execute(db);
    const child = await run(() => f.people.createGroup(request(f.owner), f.schoolId, { idempotency_key: randomUUID(), name: "Child only", person_ids: [descendant], starts_on: yesterday }));
    await sql`INSERT INTO participation_group_parents(school_id,group_id,parent_group_id,starts_on,created_by,recorded_at)
      VALUES(${f.schoolId}::uuid,${child.id}::uuid,${participant.id}::uuid,${yesterday}::date,${f.owner.id}::uuid,${now}::timestamptz)`.execute(db);
    const learningId = randomUUID(), created = await run(() => f.offerings.create(f.owner, { command_id: randomUUID(), offering_id: learningId, name: "Dated learning group",
      participants: [f.reference(f.learner.person), { id: ended, expected_revision: 1 }], instructor: f.reference(f.instructor.person), starts_on: day }));
    // The current setup UI deliberately does not create future registrations;
    // record a coherent future source fixture to test the adapter's dated read.
    await sql`INSERT INTO learning_offering_enrollments(id,school_id,offering_id,person_id,selected_person_revision,starts_on,revision,created_by,created_at)
      VALUES(${randomUUID()}::uuid,${f.schoolId}::uuid,${learningId}::uuid,${future}::uuid,${f.secondLearner.person.revision},${tomorrow}::date,1,${f.owner.id}::uuid,${now}::timestamptz)`.execute(db);
    const endedRegistration = created.enrollments.find(row => row.person_id === ended)!;
    await run(() => f.offerings.endEnrollment(f.owner, learningId, endedRegistration.id, { command_id: randomUUID(), expected_revision: 1, reason: "Ended before the reviewed operation" }));
    const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active)
      VALUES(${f.schoolId}::uuid,'2037','Dated term',${yesterday}::date,${tomorrow}::date,85,true) RETURNING id`.execute(db)).rows[0]!;
    const section = await db.insertInto("class_sections").values({ school_id: f.schoolId, academic_year: "2037", grade: "BCA", section: "A" }).returning("id").executeTakeFirstOrThrow();
    for (const [personId, start, exit, n] of [[active, yesterday, tomorrow, 1], [future, tomorrow, null, 2], [ended, yesterday, day, 3]] as const) {
      const student = await db.insertInto("students").values({ school_id: f.schoolId, person_id: personId, admission_number: `DATED-${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, enrolled_on: start,
        inactive_from: exit, is_active: exit === null, roll_number: n,
        ...(exit === null ? {} : { exit_kind: "term_completed", exit_reason: "Synthetic dated completion", ended_by: f.owner.id, ended_at: new Date(now) }) }).execute();
    }
    const staff = async (personId: string, joined: string, status: "active" | "inactive") => (await sql<{ id: string }>`WITH staff_fixture_input(school_id,person_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) AS (VALUES (${f.schoolId}::uuid,${personId}::uuid,${`G-${randomUUID()}`},'Fictional','Direct member',${`group-${randomUUID()}@example.test`},'non_teaching','Group member','contract',${joined}::date,${status},${f.owner.id}::uuid,${f.owner.id}::uuid)) INSERT INTO staff_profiles(school_id,person_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) SELECT input.school_id::uuid,input.person_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input RETURNING id`.execute(db)).rows[0]!.id;
    const currentStaff = await staff(active, yesterday, "active"), futureStaff = await staff(future, tomorrow, "active"), endedStaff = await staff(ended, yesterday, "inactive"), descendantStaff = await staff(descendant, yesterday, "active");
    const organization = randomUUID(), organizationChild = randomUUID();
    await sql`INSERT INTO organization_structures(school_id,revision) VALUES(${f.schoolId}::uuid,1)`.execute(db);
    await sql`INSERT INTO organization_nodes(school_id,id,parent_id,kind,name,tone,sort_order) VALUES(${f.schoolId}::uuid,${organization}::uuid,NULL,'team','Dated team','teal',0),
      (${f.schoolId}::uuid,${organizationChild}::uuid,${organization}::uuid,'team','Descendant team','teal',1)`.execute(db);
    await sql`INSERT INTO organization_node_members(school_id,node_id,staff_id) VALUES(${f.schoolId}::uuid,${organization}::uuid,${currentStaff}::uuid),
      (${f.schoolId}::uuid,${organization}::uuid,${futureStaff}::uuid),(${f.schoolId}::uuid,${organization}::uuid,${endedStaff}::uuid),(${f.schoolId}::uuid,${organizationChild}::uuid,${descendantStaff}::uuid)`.execute(db);
    for (const group of [{ kind: "participation" as const, id: participant.id }, { kind: "learning" as const, id: learningId }, { kind: "class" as const, id: section.id }, { kind: "organization" as const, id: organization }]) {
      const preview = await run(() => f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [], groups: [group] } }));
      expect(preview.today).toBe(day);
      // Organization membership is explicitly recorded and undated: employment is
      // not a second implicit membership policy. Descendants still never inherit.
      expect(preview.people.map(row => row.person_id).sort()).toEqual(group.kind === "organization" ? [active, future, ended].sort() : [active]);
    }
    await sql`UPDATE school_people SET retired_at=${now}::timestamptz,revision=2 WHERE id=${ended}::uuid`.execute(db);
    expect((await run(() => f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [], groups: [{ kind: "organization", id: organization }] } }))).people.map(row => row.person_id).sort()).toEqual([active, future].sort());
    const preview = await run(() => f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [], groups: [{ kind: "participation", id: participant.id }] } }));
    const before = await facts(db, f.schoolId), input = { command_id: randomUUID(), batch_id: randomUUID(), selection: { person_ids: [], groups: [{ kind: "participation", id: participant.id }] },
      snapshot_hash: preview.snapshot_hash, reference: `DATED-${randomUUID()}`, description: "Dated charge", amount_paise: 100, due_on: day };
    const nextNow = "2037-06-17T18:45:00Z";
    const failure = await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(nextNow), nowIso: () => nextNow } }),
      () => rejected(() => f.batches.issue(f.owner, f.schoolId, input)));
    expect(failure.status).toBe(400); expect(await facts(db, f.schoolId)).toEqual({ ...before, commands: before.commands + 1 });
    // Restore the exact original date and source hash: rejection is terminal for
    // this key, so a delayed retry cannot unexpectedly create financial records.
    expect((await run(() => f.batches.preview(f.owner, f.schoolId, { selection: input.selection }))).snapshot_hash).toBe(input.snapshot_hash);
    await run(async () => {
      await expect(f.batches.issue(f.owner, f.schoolId, input)).rejects.toThrow(/not accepted|review/i);
      expect(await f.batches.confirmation(f.owner, f.schoolId, input.batch_id, input.command_id)).toMatchObject({ state: "not_accepted" });
    });
    expect(await facts(db, f.schoolId)).toEqual({ ...before, commands: before.commands + 1 });
  }, 60_000);

  it("supports minimal Finance-only selection without SIS and denies organization, foreign-campus and resource-only access", async () => {
    const f = await createFinanceArrangementsFixture(db), foreign = await createLearningOfferingFixture(db), context = services(db), groupId = randomUUID(), organization = randomUUID();
    await sql`INSERT INTO participation_groups(id,school_id,name,created_by) VALUES(${groupId}::uuid,${f.schoolId}::uuid,'Finance activity group',${f.owner.id}::uuid)`.execute(db);
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by) VALUES(${f.schoolId}::uuid,${groupId}::uuid,${f.learner.personId}::uuid,${f.day}::date,${f.owner.id}::uuid)`.execute(db);
    await sql`INSERT INTO organization_structures(school_id,revision) VALUES(${f.schoolId}::uuid,1)`.execute(db);
    await sql`INSERT INTO organization_nodes(school_id,id,parent_id,kind,name,tone,sort_order) VALUES(${f.schoolId}::uuid,${organization}::uuid,NULL,'team','Private administrative team','teal',0)`.execute(db);
    const exception = (await sql<{ id: string }>`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
      VALUES(${f.schoolId}::uuid,${f.otherTeacher.id}::uuid,'fees.manage','Synthetic Finance-only operator','manual','institution',${f.day}::date,${f.due(30)}::date,${f.due(15)}::date,${f.owner.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
    await f.run(async () => {
      expect((await db.transaction().execute(tx => effectiveSchoolAccess(tx, f.otherTeacher.id, f.schoolId, "sis.manage"))).sources).toEqual([]);
      const people = await context.batches.catalogue(f.otherTeacher, f.schoolId, { kind: "people" });
      expect(people.can_add_people).toBe(false); expect(people.results.some(row => row.id === f.learner.personId)).toBe(true);
      expect(JSON.stringify(people)).not.toMatch(/contact_email|contact_phone|blood_group|emergency_contact|account_user_id|password/u);
      const groups = await context.batches.catalogue(f.otherTeacher, f.schoolId, { kind: "groups" });
      expect(groups.results.some(row => row.id === groupId)).toBe(true); expect(groups.results.some(row => "kind" in row && row.kind === "organization")).toBe(false);
      await expect(context.batches.preview(f.otherTeacher, f.schoolId, { selection: { person_ids: [], groups: [{ kind: "organization", id: organization }] } })).rejects.toThrow();
      const selection: Selection = { person_ids: [], groups: [{ kind: "participation", id: groupId }] };
      const audience = await context.batches.preview(f.otherTeacher, f.schoolId, { selection });
      const result = await context.batches.issue(f.otherTeacher, f.schoolId, { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: audience.snapshot_hash,
        reference: `FINANCE-${randomUUID()}`, description: "Staff-owned scoped charge", amount_paise: 100, due_on: f.day });
      expect(result.person_count).toBe(1);
      await expect(context.batches.preview(f.otherTeacher, f.schoolId, { selection: { person_ids: [foreign.learner.id], groups: [] } })).rejects.toThrow();
      await expect(context.batches.detail({ ...f.otherTeacher, active_school_id: foreign.schoolId }, foreign.schoolId, result.batch_id)).rejects.toThrow();
      await sql`UPDATE school_access_exceptions SET scope_kind='assigned_resources',revision=revision+1 WHERE id=${exception.id}::uuid`.execute(db);
      await expect(context.batches.catalogue(f.otherTeacher, f.schoolId, { kind: "people" })).rejects.toThrow();
      await expect(context.batches.issue(f.otherTeacher, f.schoolId, { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: audience.snapshot_hash,
        reference: `RESOURCE-${randomUUID()}`, description: "Denied unrelated charge", amount_paise: 100, due_on: f.day })).rejects.toThrow();
    });
  }, 60_000);

  it("enforces 500 unique people and 20 groups without truncating or silently chunking the selected audience", async () => {
    const f = await fixture();
    const people = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name)
      SELECT ${f.schoolId}::uuid,'Bounded recipient '||number::text,'' FROM generate_series(1,501) number RETURNING id`.execute(db)).rows.map(row => row.id);
    const selection: Selection = { person_ids: people.slice(0, 500), groups: [] }, preview = await f.batches.preview(f.owner, f.schoolId, { selection });
    expect(preview.person_count).toBe(500); expect(new Set(preview.people.map(row => row.person_id)).size).toBe(500);
    await expect(f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: people, groups: [] } })).rejects.toThrow();
    const oversized = await f.people.createGroup(request(f.owner), f.schoolId, { idempotency_key: randomUUID(), name: "501 explicit canonical members", person_ids: people.slice(0, 100), starts_on: f.today });
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
      SELECT ${f.schoolId}::uuid,${oversized.id}::uuid,id,${f.today}::date,${f.owner.id}::uuid FROM unnest(${people.slice(100)}::uuid[]) id`.execute(db);
    await expect(f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [], groups: [{ kind: "participation", id: oversized.id }] } })).rejects.toThrow();
    const groups = (await sql<{ id: string }>`INSERT INTO participation_groups(school_id,name,created_by)
      SELECT ${f.schoolId}::uuid,'Bounded group '||number::text,${f.owner.id}::uuid FROM generate_series(1,21) number RETURNING id`.execute(db)).rows.map(row => ({ kind: "participation" as const, id: row.id }));
    await expect(f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [f.learner.id], groups } })).rejects.toThrow();
    expect((await f.batches.preview(f.owner, f.schoolId, { selection: { person_ids: [f.learner.id], groups: groups.slice(0, 20) } })).person_count).toBe(1);
    const result = await f.batches.issue(f.owner, f.schoolId, { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: preview.snapshot_hash,
      reference: `BOUND-${randomUUID()}`, description: "Bounded 500-person charge", amount_paise: 1, due_on: f.today });
    expect(result.person_count).toBe(500); expect(result.invoices).toHaveLength(500); expect((await facts(db, f.schoolId)).invoices).toBe(500);
  }, 120_000);

  it("keeps individual batch invoices compatible with current native payment reports, independent verification and the legacy ledger", async () => {
    const f = await createFinanceArrangementsFixture(db), context = services(db), selection: Selection = { person_ids: [f.learner.personId, f.secondLearner.personId], groups: [] };
    await f.run(async () => {
      const snapshot = await context.batches.preview(f.owner, f.schoolId, { selection }), receipt = await context.batches.issue(f.owner, f.schoolId,
        { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: snapshot.snapshot_hash, reference: `FOLLOW-${randomUUID()}`, description: "Two separate obligations", amount_paise: 10000, due_on: f.day });
      const invoice = receipt.invoices.find(row => row.person_id === f.learner.personId)!;
      await f.arrangements.enableSelfPayer(f.owner, f.schoolId, invoice.invoice_id, { command_id: randomUUID(), entitlement_id: randomUUID(), expected_revision: 0, valid_from: f.day, valid_until: f.due(30), attested_adult_self_payer: true });
      const native = nativeFeeServices(db), account = (await native.reviews.workspace(f.learner.actor, f.schoolId, { invoice_id: invoice.invoice_id })).invoices[0]!, reviewer = account.reviewers.find(row => row.user_id === f.owner.id)!;
      const report = await native.reviews.report(f.learner.actor, f.schoolId, invoice.invoice_id, { command_id: randomUUID(), review_id: randomUUID(), expected_revision: 0,
        basis_hash: account.basis_hash, basis_revision: account.basis_revision, reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash },
        kind: "payment", amount_paise: 4000, method: "bank_transfer", reference: `BATCH-PAY-${randomUUID()}`, note: "Synthetic partial payment", payment_made: true });
      const verified = await native.reviews.decide(f.owner, f.schoolId, report.id, { command_id: randomUUID(), expected_revision: 1, outcome: "verified", response: "Fictional bank statement checked independently", verified_funds: true });
      expect(verified.payment_id).toBeTruthy(); expect((await native.reviews.workspace(f.learner.actor, f.schoolId, { invoice_id: invoice.invoice_id })).invoices[0]?.balance_paise).toBe(6000);
      expect((await native.reviews.workspace(f.owner, f.schoolId, { invoice_id: receipt.invoices.find(row => row.person_id === f.secondLearner.personId)!.invoice_id })).invoices[0]?.balance_paise).toBe(10000);
      const ledger = new OperationsService(db, {} as never, undefined, undefined, new FeeLedgerService(db, f.core, f.core, f.core, f.core));
      expect((await ledger.fees(f.guardian, f.schoolId, f.learner.id)).invoices.find(row => row.id === f.invoiceId)?.balance_paise).toBe(3_000_000);
      expect((await ledger.fees(f.guardian, f.schoolId, f.learner.id)).invoices.every(item => financeBatchId(item) === null)).toBe(true);
      const ownLedger = await ledger.fees(f.learner.actor, f.schoolId, undefined, f.learner.personId);
      expect(ownLedger.invoices).toEqual([expect.objectContaining({ id: invoice.invoice_id, charge_batch: null })]);
      await expect(context.batches.detail(f.learner.actor, f.schoolId, receipt.batch_id)).rejects.toThrow();
      expect((await ledger.fees(f.owner, f.schoolId)).payments.filter(row => typeof row === "object" && row !== null && "invoice_id" in row && row.invoice_id === invoice.invoice_id)).toHaveLength(1);
    });
  }, 60_000);

  it.runIf(Boolean(targetUrl))("issues one exact branch collection with run-local IDs, events and counters while Live and a sibling remain unchanged", async () => {
    const f = await fixture(), group = await f.group(), selection: Selection = { person_ids: [f.learner.id], groups: [{ kind: "participation", id: group.id }] }, now = new Date().toISOString();
    const liveAudience = await f.batches.preview(f.owner, f.schoolId, { selection });
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 3), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, now), before = await facts(db, f.schoolId);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "fee-charge-batches-test", checked_at: now });
        return { db: database, ...services(database), namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open(), commandId = randomUUID(), batchId = randomUUID();
      let invoiceIds: string[] = [], branchAudienceHash = "";
      await branch.run(async () => {
        const beforeRejected = await facts(branch.db, f.schoolId);
        const foreignReview = { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: liveAudience.snapshot_hash,
          reference: `WRONG-WORLD-${randomUUID()}`, description: "Rejected Live review", amount_paise: 1100, due_on: f.today };
        expect((await rejected(() => branch.batches.issue(f.owner, f.schoolId, foreignReview))).status).toBe(400);
        expect(await facts(branch.db, f.schoolId)).toEqual({ ...beforeRejected, commands: beforeRejected.commands + 1 });
        const audience = await branch.batches.preview(f.owner, f.schoolId, { selection }), input = { command_id: commandId, batch_id: batchId, selection,
          snapshot_hash: audience.snapshot_hash, reference: `COW-COLLECTION-${randomUUID()}`, description: "Branch-only fictional charge", amount_paise: 1100, due_on: f.today };
        branchAudienceHash = audience.snapshot_hash;
        const result = await branch.batches.issue(f.owner, f.schoolId, input); invoiceIds = result.invoices.map(row => row.invoice_id);
        expect(await branch.batches.issue(f.owner, f.schoolId, input)).toMatchObject({ ...result, replayed: true });
        expect(await branch.batches.confirmation(f.owner, f.schoolId, batchId, commandId)).toMatchObject({ state: "accepted", result: { invoices: result.invoices } });
        expect((await facts(branch.db, f.schoolId)).invoices).toBe(before.invoices + 2);
        expect((await branch.db.selectFrom("campus_model_commands").select("environment_namespace_id").where("correlation_id", "=", commandId).execute()).every(row => row.environment_namespace_id === branch.namespace)).toBe(true);
        expect((await branch.db.selectFrom("event_outbox").select("id").where("aggregate_id", "in", invoiceIds).execute()).length).toBeGreaterThanOrEqual(2);
        const operations = new OperationsService(branch.db, {} as never, undefined, undefined, new FeeLedgerService(branch.db, branch.core, branch.core, branch.core, branch.core));
        const grouped = (await operations.fees(f.owner, f.schoolId)).invoices.filter(invoice => financeBatchId(invoice) === batchId);
        expect(grouped).toHaveLength(2);
        for (const invoice of grouped) expect(invoice).toMatchObject({ charge_batch: { id: batchId, reference: input.reference, description: input.description, person_count: 2 } });
        const corrections = new FeeCorrectionsService(branch.db, branch.core, branch.core, branch.core, branch.core), correctionSelection = { invoice_ids: [invoiceIds[0]!], batch_id: batchId };
        const quote = await corrections.preview(f.owner, f.schoolId, { selection: correctionSelection, change: { kind: "cancel" } });
        await corrections.apply(f.owner, f.schoolId, { command_id: randomUUID(), correction_id: randomUUID(), selection: correctionSelection, change: { kind: "cancel" },
          snapshot_hash: quote.snapshot_hash, reason: "Branch-only collection correction", attested_recording_error: true });
        const currentGroup = (await operations.fees(f.owner, f.schoolId)).invoices.filter(invoice => financeBatchId(invoice) === batchId);
        expect(currentGroup).toHaveLength(2);
        expect(currentGroup.reduce((total, invoice) => total + invoice.amount_paise, 0)).toBe(2200);
        expect(currentGroup.reduce((total, invoice) => total + invoice.adjusted_amount_paise, 0)).toBe(1100);
        expect(currentGroup.reduce((total, invoice) => total + invoice.balance_paise, 0)).toBe(1100);
        expect(currentGroup.find(invoice => invoice.id === invoiceIds[0])).toMatchObject({ charge_state: "cancelled", balance_paise: 0 });
      });
      expect(await facts(db, f.schoolId)).toEqual(before);
      const liveOperations = new OperationsService(db, {} as never, undefined, undefined, new FeeLedgerService(db, f.core, f.core, f.core, f.core));
      expect((await liveOperations.fees(f.owner, f.schoolId)).invoices.some(invoice => financeBatchId(invoice) === batchId)).toBe(false);
      expect(await f.batches.confirmation(f.owner, f.schoolId, batchId, commandId)).toMatchObject({ state: "not_found" });
      await sibling.run(async () => {
        expect(await facts(sibling.db, f.schoolId)).toEqual(before); expect(await sibling.batches.confirmation(f.owner, f.schoolId, batchId, commandId)).toMatchObject({ state: "not_found" });
        expect(await sibling.db.selectFrom("fee_invoices").select("id").where("id", "in", invoiceIds).execute()).toEqual([]);
        const siblingOperations = new OperationsService(sibling.db, {} as never, undefined, undefined, new FeeLedgerService(sibling.db, sibling.core, sibling.core, sibling.core, sibling.core));
        expect((await siblingOperations.fees(f.owner, f.schoolId)).invoices.some(invoice => financeBatchId(invoice) === batchId)).toBe(false);
        for (const snapshot_hash of [liveAudience.snapshot_hash, branchAudienceHash]) {
          expect((await rejected(() => sibling.batches.issue(f.owner, f.schoolId, { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash,
            reference: `FOREIGN-WORLD-${randomUUID()}`, description: "Rejected cross-world review", amount_paise: 1100, due_on: f.today }))).status).toBe(400);
        }
        expect(await facts(sibling.db, f.schoolId)).toEqual({ ...before, commands: before.commands + 2 });
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
