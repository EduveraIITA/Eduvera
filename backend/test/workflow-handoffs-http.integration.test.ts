import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { createFeeAuthorityMandateFixture } from "./fee-authority.test-support.js";
import { IsolatedAppHttp, type IsolatedHttpSession } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";

const enabled = process.env.WORKFLOW_HANDOFFS_HTTP_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/handoffs_unused_test";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
interface WorkItem { direction?: "needs_me" | "waiting"; state?: string; source?: { kind: string; id: string; action: string }; core_trace?: { message_ids: string[] }; due_at: string | null }
interface WorkManifest { work: { items: WorkItem[] }; areas: Array<{ key: string; surfaces: Array<{ key: string; href: string }> }> }
const work = async (session: IsolatedHttpSession, kind: string, id: string) => (await session.json<WorkManifest>("/api/v1/workspace/"))
  .work.items.filter(item => item.source?.kind === kind && item.source.id.includes(id));
interface AssignmentWork { state: string; can_write: boolean; can_review: boolean; draft: { body: string; revision: number } | null;
  attempts: Array<{ id: string; body: string; review: { decision: string } | null }> }
interface FeeInvoice { id: string; stream_revision: number; basis_hash: string; basis_revision: number; can_request: boolean;
  balance_paise: number; agreement: { state: string; next_due_on: string | null } | null; requests: Array<{ id: string; status: string; note: string }> }
interface FeeWorkspace { review_route: { state: string }; invoices: FeeInvoice[]; confirmation?: { state: string } }

describe.runIf(enabled)("assignment and private payment-plan handoffs through ordinary authenticated HTTP", () => {
  beforeAll(() => app.start(sourceUrl), 30_000);
  afterAll(async () => { await app.stop(); await database.destroy(); }, 10_000);

  it("reviews a group and overlapping people, then atomically records separate charges through ordinary HTTP", async () => {
    process.env.INVITATION_EMAIL_ENABLED = "false";
    const f = await createLearningOfferingFixture(database), password = `Synthetic-Batch-${randomUUID()}!`;
    await database.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.owner.id, f.learner.actor.id]).execute();
    const operator = app.session(), learner = app.session();
    await operator.login(f.owner.email, password, f.schoolId); await learner.login(f.learner.actor.email, password, f.schoolId);
    await operator.json("/api/v1/onboarding/goals/", "PUT", { goals: ["fees"] });
    const base = `/api/v1/schools/${f.schoolId}/fees/`;
    const group = await operator.json<{ id: string }>(`/api/v1/schools/${f.schoolId}/people/participation-groups`, "POST", {
      name: "Synthetic workshop attendees", person_ids: [f.learner.id, f.secondLearner.id], starts_on: f.today, ends_on: null, idempotency_key: randomUUID(),
    });
    const selection = { person_ids: [f.learner.id], groups: [{ kind: "participation", id: group.id }] };
    expect((await learner.request(`${base}charge-audience/?kind=people`)).status).toBe(403);
    const catalogue = await operator.json<{ results: Array<{ id: string }> }>(`${base}charge-audience/?kind=groups`);
    expect(catalogue.results).toContainEqual(expect.objectContaining({ id: group.id }));
    const preview = await operator.json<{ snapshot_hash: string; person_count: number; duplicate_count: number; people: Array<{ person_id: string }> }>(`${base}charge-audience/preview/`, "POST", { selection });
    expect(preview.person_count).toBe(2); expect(preview.duplicate_count).toBe(1);
    expect(preview.people.map(person => person.person_id).sort()).toEqual([f.learner.id, f.secondLearner.id].sort());
    const input = { command_id: randomUUID(), batch_id: randomUUID(), selection, snapshot_hash: preview.snapshot_hash,
      reference: `SYNTHETIC-BATCH-${randomUUID()}`, description: "Fictional workshop collection", amount_paise: 25_000, due_on: f.today };
    expect((await operator.request(`${base}charge-batches/`, "POST", input, false)).status).toBe(403);
    expect((await learner.request(`${base}charge-batches/`, "POST", input)).status).toBe(403);
    type Batch = { id: string; batch_id: string; person_count: number; total_amount_paise: number; invoices: Array<{ person_id: string; invoice_id: string; reference: string }>; replayed: boolean };
    const result = await operator.json<Batch>(`${base}charge-batches/`, "POST", input);
    expect(result).toMatchObject({ id: input.batch_id, batch_id: input.batch_id, person_count: 2, total_amount_paise: 50_000, replayed: false });
    expect(new Set(result.invoices.map(invoice => invoice.person_id)).size).toBe(2);
    expect(result.invoices.map(invoice => invoice.reference).sort()).toEqual([`${input.reference}/001`, `${input.reference}/002`]);
    expect(await operator.json(`${base}charge-batches/`, "POST", input)).toMatchObject({ id: input.batch_id, replayed: true, invoices: result.invoices });
    expect(await operator.json(`${base}charge-batches/${input.batch_id}/confirmation/?command_id=${input.command_id}`))
      .toMatchObject({ handler: "finance.charge_batch", source_id: input.batch_id, command_id: input.command_id, action: "issue", state: "accepted" });
    const destination = `/areas/fees/ledger?batch_id=${input.batch_id}`;
    expect(await operator.json("/api/v1/onboarding/workspace/")).toMatchObject({ resume: { step: "operating", path: destination } });
    expect(await operator.json("/api/v1/auth/me/")).toMatchObject({ onboarding: { resume: { step: "operating", path: destination } } });
    await operator.json("/api/v1/onboarding/resume/", "PATCH", { step: "first_use", goal: "fees", path: "/more/setup/capabilities?task=fees" });
    expect(await operator.json("/api/v1/onboarding/workspace/")).toMatchObject({ resume: { step: "operating", path: destination } });
    expect((await learner.request(`${base}charge-batches/${input.batch_id}/`)).status).toBe(403);
    type GroupedLedger = { invoices: Array<{ id: string; person_id: string; balance_paise: number; charge_batch: { id: string; reference: string; description: string; person_count: number } | null }>; payments: unknown[] };
    const account = await operator.json<GroupedLedger>(`${base}workspace/`);
    expect(account.invoices).toHaveLength(2); expect(account.payments).toEqual([]);
    expect(account.invoices).toEqual(expect.arrayContaining(result.invoices.map(invoice => expect.objectContaining({ id: invoice.invoice_id, person_id: invoice.person_id, balance_paise: 25_000 }))));
    expect(account.invoices.every(invoice => invoice.charge_batch?.id === input.batch_id)).toBe(true);
    expect(account.invoices[0]!.charge_batch).toEqual({ id: input.batch_id, reference: input.reference, description: input.description, person_count: 2 });
    const scopedPerson = await operator.json<GroupedLedger>(`${base}workspace/?person_id=${f.learner.id}`);
    expect(scopedPerson.invoices).toHaveLength(1);
    expect(scopedPerson.invoices[0]!.charge_batch).toBeNull();
    const scopedInvoice = await operator.json<GroupedLedger>(`${base}workspace/?invoice_id=${result.invoices[0]!.invoice_id}`);
    expect(scopedInvoice.invoices).toHaveLength(1);
    expect(scopedInvoice.invoices[0]!.charge_batch).toBeNull();
    const correction = { selection: { batch_id: result.batch_id, invoice_ids: [result.invoices[0]!.invoice_id] },
      change: { kind: "amend", amount_paise: 20_000, description: "Corrected fictional workshop charge" } };
    expect((await learner.request(`${base}corrections/preview/`, "POST", correction)).status).toBe(403);
    const quote = await operator.json<{ snapshot_hash: string; person_count: number; before_total_amount_paise: number; after_total_amount_paise: number }>(`${base}corrections/preview/`, "POST", correction);
    expect(quote).toMatchObject({ person_count: 1, before_total_amount_paise: 25_000, after_total_amount_paise: 20_000 });
    const corrected = { ...correction, correction_id: randomUUID(), command_id: randomUUID(), snapshot_hash: quote.snapshot_hash,
      reason: "Synthetic amount was entered incorrectly", attested_recording_error: true };
    expect((await operator.request(`${base}corrections/`, "POST", corrected, false)).status).toBe(403);
    expect(await operator.json(`${base}corrections/`, "POST", corrected)).toMatchObject({ correction_id: corrected.correction_id, invoice_ids: correction.selection.invoice_ids });
    expect(await operator.json(`${base}corrections/`, "POST", corrected)).toMatchObject({ correction_id: corrected.correction_id, replayed: true });
    const updated = await operator.json<{ invoices: Array<{ id: string; amount_paise: number; balance_paise: number; effective_amount_paise: number }> }>(`${base}workspace/`);
    expect(updated.invoices.find(invoice => invoice.id === result.invoices[0]!.invoice_id)).toMatchObject({ amount_paise: 25_000, effective_amount_paise: 20_000, balance_paise: 20_000 });
    expect(updated.invoices.find(invoice => invoice.id === result.invoices[1]!.invoice_id)).toMatchObject({ amount_paise: 25_000, balance_paise: 25_000 });
    // The exact original issue receipt remains original, not a mutable collection quote.
    expect(await operator.json(`${base}charge-batches/${input.batch_id}/confirmation/?command_id=${input.command_id}`))
      .toMatchObject({ state: "accepted", result: { amount_paise: 25_000, total_amount_paise: 50_000 } });
    expect(await academicScaffoldingCounts(database, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
  }, 90_000);

  it("starts Fees with a canonical person and closes a named independent payment verification through the normal app", async () => {
    process.env.INVITATION_EMAIL_ENABLED = "false";
    const f = await createLearningOfferingFixture(database), password = `Synthetic-Fees-${randomUUID()}!`;
    // Explicit synthetic second operator; this is technical access, not a mandate.
    await database.updateTable("school_memberships").set({ role: "admin" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.instructor.actor.id).execute();
    await database.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.owner.id, f.instructor.actor.id, f.learner.actor.id]).execute();
    const issuer = app.session(), verifier = app.session(), beneficiary = app.session();
    for (const [session, actor] of [[issuer, f.owner], [verifier, f.instructor.actor], [beneficiary, f.learner.actor]] as const) await session.login(actor.email, password, f.schoolId);
    await issuer.json("/api/v1/onboarding/goals/", "PUT", { goals: ["fees"] });
    const base = `/api/v1/schools/${f.schoolId}/fees/`, invoiceId = randomUUID();
    const charge = { command_id: randomUUID(), invoice_id: invoiceId, beneficiary: { person_id: f.learner.id, expected_revision: f.learner.person.revision },
      reference: `SYNTHETIC-${randomUUID()}`, description: "Fictional robotics workshop", amount_paise: 3_000_000, due_on: f.today };
    expect((await issuer.request(`${base}invoices/`, "POST", charge, false)).status).toBe(403);
    expect((await beneficiary.request(`${base}invoices/`, "POST", charge)).status).toBe(403);
    await issuer.json(`${base}invoices/`, "POST", charge);
    expect(await issuer.json(`${base}invoices/`, "POST", charge)).toMatchObject({ id: invoiceId, replayed: true });
    expect(await issuer.json(`${base}invoices/${invoiceId}/confirmation/?command_id=${charge.command_id}`)).toMatchObject({ state: "accepted", source_id: invoiceId });
    const manifest = await issuer.json<WorkManifest>("/api/v1/workspace/");
    expect(manifest.areas.find(area => area.key === "fees")?.surfaces).toContainEqual(expect.objectContaining({ key: "ledger" }));
    const exact = `${base}workspace/?person_id=${f.learner.id}&invoice_id=${invoiceId}`;
    expect((await beneficiary.request(exact)).status).toBe(403); // Account link is not disclosure permission.
    type NativeInvoice = { id: string; stream_revision: number; basis_hash: string; basis_revision: number; balance_paise: number;
      reviewers: Array<{ user_id: string; person_id: string; eligibility_hash: string }> };
    const reviewWorkspace = `${base}payment-reviews/workspace/?person_id=${f.learner.id}&invoice_id=${invoiceId}`;
    const current = (await issuer.json<{ invoices: NativeInvoice[] }>(reviewWorkspace)).invoices[0]!;
    const candidate = current.reviewers.find(item => item.user_id === f.instructor.actor.id)!;
    expect(candidate).toBeDefined();
    const report = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: current.stream_revision, basis_hash: current.basis_hash,
      basis_revision: current.basis_revision, kind: "payment", amount_paise: 1_000_000, method: "bank_transfer", reference: `SYNTHETIC-UTR-${randomUUID()}`,
      note: "Private fictional bank enquiry.", payment_made: true,
      reviewer: { user_id: candidate.user_id, person_id: candidate.person_id, eligibility_hash: candidate.eligibility_hash } };
    const requested = await issuer.json<{ revision: number }>(`${base}invoices/${invoiceId}/payment-reviews/`, "POST", report);
    expect(await database.selectFrom("fee_payments").select("id").where("invoice_id", "=", invoiceId).execute()).toEqual([]);
    const incoming = await work(verifier, "fee_payment_review", report.review_id), outgoing = await work(issuer, "fee_payment_review", report.review_id);
    expect(incoming).toMatchObject([{ direction: "needs_me", source: { action: "decide" }, due_at: null }]);
    expect(outgoing).toMatchObject([{ direction: "waiting", source: { action: "await_decision" }, due_at: null }]);
    expect(incoming[0]?.core_trace?.message_ids).toEqual(outgoing[0]?.core_trace?.message_ids);
    expect(JSON.stringify([incoming, outgoing])).not.toContain(report.reference);
    expect(JSON.stringify([incoming, outgoing])).not.toContain(report.note);
    const decision = { command_id: randomUUID(), expected_revision: requested.revision, outcome: "verified", response: "Synthetic funds independently checked.", verified_funds: true };
    expect((await issuer.request(`${base}payment-reviews/${report.review_id}/decision/`, "POST", decision)).status).toBe(403);
    const result = await verifier.json<{ payment_id: string }>(`${base}payment-reviews/${report.review_id}/decision/`, "POST", decision);
    expect(await verifier.json(`${base}payment-reviews/${report.review_id}/decision/`, "POST", decision)).toMatchObject({ replayed: true, payment_id: result.payment_id });
    expect(await work(verifier, "fee_payment_review", report.review_id)).toEqual([]);
    expect(await work(issuer, "fee_payment_review", report.review_id)).toEqual([]);
    const ledger = await issuer.json<{ invoices: Array<{ id: string; balance_paise: number; paid_paise: number }>; payments: Array<{ id: string; invoice_id: string }> }>(exact);
    expect(ledger.invoices).toEqual([expect.objectContaining({ id: invoiceId, balance_paise: 2_000_000, paid_paise: 1_000_000 })]);
    expect(ledger.payments).toEqual([expect.objectContaining({ id: result.payment_id, invoice_id: invoiceId })]);
    const receiptCorrection = { action: "replace", replacement: { amount_paise: 900_000, method: "bank_transfer", reference: report.reference } };
    const receiptQuote = await verifier.json<{ snapshot_hash: string; before: { balance_paise: number }; after: { balance_paise: number } }>(`${base}payments/${result.payment_id}/correction-preview/`, "POST", receiptCorrection);
    expect(receiptQuote).toMatchObject({ before: { balance_paise: 2_000_000 }, after: { balance_paise: 2_100_000 } });
    const replacement = { ...receiptCorrection, correction_id: randomUUID(), command_id: randomUUID(), snapshot_hash: receiptQuote.snapshot_hash,
      reason: "Synthetic receipt amount was entered incorrectly", attested_recording_error: true, verified_funds: true };
    expect((await issuer.request(`${base}payments/${result.payment_id}/corrections/`, "POST", replacement)).status).toBe(403);
    expect((await verifier.request(`${base}payments/${result.payment_id}/corrections/`, "POST", replacement, false)).status).toBe(403);
    const replacementResult = await verifier.json<{ replacement_payment_id: string }>(`${base}payments/${result.payment_id}/corrections/`, "POST", replacement);
    expect(replacementResult.replacement_payment_id).not.toBe(result.payment_id);
    expect(await verifier.json(`${base}payments/${result.payment_id}/corrections/`, "POST", replacement)).toMatchObject({ replayed: true, replacement_payment_id: replacementResult.replacement_payment_id });
    const correctedLedger = await issuer.json<{ invoices: Array<{ id: string; balance_paise: number; paid_paise: number }>; payments: Array<{ id: string; reference: string; receipt_state: string }> }>(exact);
    expect(correctedLedger.invoices).toEqual([expect.objectContaining({ id: invoiceId, balance_paise: 2_100_000, paid_paise: 900_000 })]);
    expect(correctedLedger.payments.find(payment => payment.id === result.payment_id)).toMatchObject({ reference: report.reference, receipt_state: "replaced" });
    expect(correctedLedger.payments.find(payment => payment.id === replacementResult.replacement_payment_id)).toMatchObject({ reference: report.reference, receipt_state: "active" });
    expect(await academicScaffoldingCounts(database, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
  }, 90_000);

  it("starts a fresh canonical-person offering through ordinary protected HTTP and completes its private Assignment handoff", async () => {
    // Account/password fixture setup is synthetic. The offering appointment and
    // every user work transition below use the real cookie/CSRF guarded API.
    process.env.INVITATION_EMAIL_ENABLED = "false";
    const f = await createLearningOfferingFixture(database), password = `Offering-${randomUUID()}!`;
    await database.updateTable("users").set({ password_hash: await hashPassword(password) })
      .where("id", "in", [f.owner.id, f.instructor.actor.id, f.learner.actor.id, f.secondLearner.actor.id]).execute();
    const owner = app.session(), instructor = app.session(), learner = app.session(), other = app.session();
    for (const [session, actor] of [[owner, f.owner], [instructor, f.instructor.actor], [learner, f.learner.actor], [other, f.secondLearner.actor]] as const)
      await session.login(actor.email, password, f.schoolId);
    await owner.json("/api/v1/onboarding/goals/", "PUT", { goals: ["assignments"] });
    const offerings = "/api/v1/learning/offerings/", assignments = "/api/v1/learning/assignments/";
    expect((await app.session().request(offerings)).status).toBe(401);
    expect(await owner.json(offerings)).toMatchObject({ can_create: true, items: [] });
    expect(await instructor.json(offerings)).toMatchObject({ can_create: false, items: [] });
    const offeringId = randomUUID(), setup = { command_id: randomUUID(), offering_id: offeringId, name: "Fictional Saturday programming",
      participants: [f.reference(f.learner.person), f.reference(f.secondLearner.person)], instructor: f.reference(f.instructor.person), starts_on: f.today };
    expect((await owner.request(offerings, "POST", setup, false)).status).toBe(403);
    expect((await learner.request(offerings, "POST", setup)).status).toBe(403);
    const created = await owner.json<{ id: string; revision: number }>(offerings, "POST", setup);
    expect(created).toMatchObject({ id: offeringId, revision: 1 });
    expect(await owner.json(offerings, "POST", setup)).toMatchObject({ id: offeringId, replayed: true });
    expect(await owner.json(`/api/v1/learning/offerings/${offeringId}/confirmation/?command_id=${setup.command_id}&action=create`))
      .toMatchObject({ state: "accepted" });
    const ownerManifest = await owner.json<WorkManifest>("/api/v1/workspace/");
    expect(ownerManifest.areas.find(area => area.key === "messages")?.surfaces).toContainEqual(expect.objectContaining({ key: "assignments:setup" }));
    expect((await instructor.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "messages")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: `assignments:offering:${offeringId}`, href: `/areas/messages/assignments?scope=offering&offering_id=${offeringId}` }));
    expect((await learner.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "messages")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: `assignments:person:${f.learner.id}`, href: `/areas/messages/assignments?scope=person&person_id=${f.learner.id}` }));
    const source = f.input(offeringId, { submission_mode: "text" }), id = source.assignment_id;
    expect((await owner.request(assignments, "POST", source)).status).toBe(403); // Setup is not teaching authority.
    const saved = await instructor.json<{ revision: number }>(assignments, "POST", source);
    const detailPath = `${assignments}${id}/`, preview = await instructor.json<{ publication_preview: { audience_hash: string } }>(detailPath);
    await instructor.json(`${detailPath}publish/`, "POST", { command_id: randomUUID(), expected_revision: saved.revision, audience_hash: preview.publication_preview.audience_hash });
    const retained = await owner.json<{ resume: { step: string; goal: string; path: string } }>("/api/v1/onboarding/workspace/");
    expect(retained.resume).toMatchObject({ step: "first_use", goal: "assignments", path: "/areas/messages/assignments" });
    expect((await owner.request(detailPath)).status).toBe(403); // Manager-only offering details never open private assignment work.
    expect((await other.request(`${assignments}?person_id=${f.learner.id}`)).status).toBe(403);
    const workPath = `${detailPath}people/${f.learner.id}/`;
    await learner.json(workPath, "PUT", { command_id: randomUUID(), expected_revision: 0, body: "My private offering draft." });
    expect(await instructor.json<AssignmentWork>(workPath)).toMatchObject({ draft: null, attempts: [] });
    const submission = { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() };
    await learner.json(`${workPath}submit/`, "POST", submission);
    expect(await learner.json(`${workPath}submit/`, "POST", submission)).toMatchObject({ replayed: true, attempt_id: submission.attempt_id });
    const needsReview = await work(instructor, "individual_assignment_work", `${id}:${f.learner.id}`), waiting = await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`);
    expect(needsReview).toMatchObject([{ direction: "needs_me", source: { action: "review" }, core_trace: { message_ids: [expect.any(String)] } }]);
    expect(waiting).toMatchObject([{ direction: "waiting", source: { action: "await_review" } }]);
    expect(JSON.stringify([needsReview, waiting])).not.toContain("My private offering draft.");
    await instructor.json(`${workPath}review/`, "POST", { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submission.attempt_id,
      decision: "reviewed", feedback: "The explanation is complete." });
    expect(await work(instructor, "individual_assignment_work", `${id}:${f.learner.id}`)).toEqual([]);
    expect(await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`)).toEqual([]);
    expect(await learner.json<AssignmentWork>(workPath)).toMatchObject({ state: "reviewed", can_write: false });
    expect(await academicScaffoldingCounts(database, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
  }, 90_000);

  it("publishes, submits, requests changes and closes exact learner/reviewer Work without duplicate actions", async () => {
    // Only synthetic identities and explicit role setup are direct fixtures.
    // All user work uses AppModule cookie, CSRF, execution and domain guards.
    const password = `Assignment-${randomUUID()}!`, f = await createClassPracticeFixture(database, { passwordHash: await hashPassword(password) });
    await database.updateTable("staff_responsibility_types").set({ capability_permissions: ["learning.assignments.manage"] }).where("id", "=", f.roleId).execute();
    const teacher = app.session(), learner = app.session(), guardian = app.session(), owner = app.session();
    for (const [session, actor] of [[teacher, f.teacher], [learner, f.learner.actor], [guardian, f.guardian], [owner, f.owner]] as const) await session.login(actor.email, password, f.schoolId);
    const list = `/api/v1/learning/assignments/?class_section_id=${f.classId}`;
    expect((await app.session().request(list)).status).toBe(401);
    expect((await teacher.json<{ can_create: boolean }>(list)).can_create).toBe(true);
    expect((await owner.request(list)).status).toBe(403);
    expect((await teacher.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "messages")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: `assignments:class:${f.classId}` }));
    expect((await learner.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "messages")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: `assignments:self:${f.learner.id}` }));
    const id = randomUUID(), input = { command_id: randomUUID(), expected_revision: 0, assignment_id: id,
      class_section_id: f.classId, term_id: f.termId, subject_id: null, reviewer_id: f.teacher.id, title: "Trace a programming loop",
      instructions: "Submit the program and explain its stopping condition.", due_at: null, cutoff_at: null, submission_mode: "text",
      max_attempts: null, policy_version: 1, resubmission_mode: "on_request" };
    expect((await teacher.request("/api/v1/learning/assignments/", "POST", input, false)).status).toBe(403);
    const saved = await teacher.json<{ revision: number }>("/api/v1/learning/assignments/", "POST", input);
    expect(await teacher.json("/api/v1/learning/assignments/", "POST", input)).toMatchObject({ id, revision: saved.revision, replayed: true });
    const detailPath = `/api/v1/learning/assignments/${id}/`, preview = await teacher.json<{ publication_preview: { audience_hash: string } }>(detailPath);
    await teacher.json(`${detailPath}publish/`, "POST", { command_id: randomUUID(), expected_revision: saved.revision, audience_hash: preview.publication_preview.audience_hash });
    const workPath = `${detailPath}work/${f.learner.id}/`;
    expect((await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`))).toMatchObject([{ direction: "needs_me", source: { action: "submit" } }]);
    const draft = await learner.json<{ revision: number }>(workPath, "PUT", { command_id: randomUUID(), expected_revision: 0, body: "Draft: the counter moves toward zero." });
    expect(await guardian.json<AssignmentWork>(workPath)).toMatchObject({ draft: null, attempts: [] });
    expect((await owner.request(workPath)).status).toBe(403);
    const submission = { command_id: randomUUID(), expected_revision: draft.revision, attempt_id: randomUUID() };
    await learner.json(`${workPath}submit/`, "POST", submission);
    expect(await learner.json(`${workPath}submit/`, "POST", submission)).toMatchObject({ replayed: true, attempt_id: submission.attempt_id });
    const reviewWork = await work(teacher, "individual_assignment_work", `${id}:${f.learner.id}`), waiting = await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`);
    expect(reviewWork).toMatchObject([{ direction: "needs_me", source: { action: "review" }, due_at: null,
      core_trace: { message_ids: [expect.any(String)] } }]);
    expect(waiting).toMatchObject([{ direction: "waiting", source: { action: "await_review" }, due_at: null }]);
    expect(reviewWork[0]!.core_trace?.message_ids).toEqual(waiting[0]!.core_trace?.message_ids);
    const change = { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submission.attempt_id,
      decision: "request_changes", feedback: "Explain what happens when the counter begins at zero." };
    expect((await guardian.request(`${workPath}review/`, "POST", change)).status).toBe(403);
    await teacher.json(`${workPath}review/`, "POST", change);
    expect(await work(teacher, "individual_assignment_work", `${id}:${f.learner.id}`)).toEqual([]);
    expect(await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`)).toMatchObject([{ direction: "needs_me", source: { action: "revise" } }]);
    const current = await learner.json<AssignmentWork>(workPath);
    expect(current.draft!.revision).toBeGreaterThan(draft.revision);
    const delayed = { command_id: randomUUID(), expected_revision: draft.revision, body: "Delayed old draft must not replace accepted work." };
    const obsoleteDraft = await learner.request(workPath, "PUT", delayed);
    expect(obsoleteDraft.status).toBe(409);
    expect(await obsoleteDraft.json()).toMatchObject({ error: { code: "assignment_revision_obsolete", fields: { assignment_obsolete: {
      code: "assignment_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments",
      source_id: id, command_id: delayed.command_id, expected_revision: delayed.expected_revision, current_revision: current.draft!.revision,
    } } } });
    expect(await learner.json(`${workPath}submit/`, "POST", submission)).toMatchObject({ replayed: true, attempt_id: submission.attempt_id });
    expect((await learner.json<AssignmentWork>(workPath)).draft!.body).toBe(current.draft!.body);
    const next = await learner.json<{ revision: number }>(workPath, "PUT", { command_id: randomUUID(), expected_revision: current.draft!.revision,
      body: "Revised: at zero the condition is false and the loop does not run." });
    const second = { command_id: randomUUID(), expected_revision: next.revision, attempt_id: randomUUID() };
    await learner.json(`${workPath}submit/`, "POST", second);
    await teacher.json(`${workPath}review/`, "POST", { command_id: randomUUID(), expected_revision: 2, review_id: randomUUID(),
      attempt_id: second.attempt_id, decision: "reviewed", feedback: "The revised explanation is complete." });
    expect(await work(teacher, "individual_assignment_work", `${id}:${f.learner.id}`)).toEqual([]);
    expect(await work(learner, "individual_assignment_work", `${id}:${f.learner.id}`)).toEqual([]);
    const reopened = await guardian.json<AssignmentWork>(workPath);
    expect(reopened).toMatchObject({ state: "reviewed", can_write: false, draft: null });
    expect(reopened.attempts.map(attempt => attempt.id)).toEqual([second.attempt_id, submission.attempt_id]);
    expect(reopened.attempts[1]!.body).toBe("Draft: the counter moves toward zero.");
  }, 90_000);

  it("confirms existing Finance authority in place, sends one private proposal and closes both Work streams on approval", async () => {
    const password = `Finance-${randomUUID()}!`, f = await createClassPracticeFixture(database, { passwordHash: await hashPassword(password) });
    const mandate = await createFeeAuthorityMandateFixture(database, f.core, f.schoolId, f.owner);
    const invoice = await database.insertInto("fee_invoices").values({ school_id: f.schoolId, student_id: f.learner.id, reference: `HTTP-${randomUUID()}`,
      description: "Fictional semester fee", amount_paise: 3_000_000, due_on: f.date, created_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    const owner = app.session(), guardian = app.session(), learner = app.session(), otherTeacher = app.session();
    for (const [session, actor] of [[owner, f.owner], [guardian, f.guardian], [learner, f.learner.actor], [otherTeacher, f.otherTeacher]] as const) await session.login(actor.email, password, f.schoolId);
    const authorityPath = `/api/v1/schools/${f.schoolId}/governance/fee-authority/`;
    const missing = await owner.json<{ route: { state: string }; candidates: Array<{ mandate_id: string; expected: unknown }> }>(authorityPath);
    expect(missing.route.state).toBe("missing");
    expect((await owner.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "fees")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: "ledger", href: "/areas/fees/ledger" }));
    expect((await otherTeacher.request(authorityPath)).status).toBe(403);
    const candidate = missing.candidates.find(row => row.mandate_id === mandate.mandateId)!;
    const confirmation = { command_id: randomUUID(), mandate_id: candidate.mandate_id, expected: candidate.expected, attestation: true };
    expect((await owner.request(`${authorityPath}confirm/`, "POST", confirmation, false)).status).toBe(403);
    await owner.json(`${authorityPath}confirm/`, "POST", confirmation);
    expect(await owner.json(`${authorityPath}?command_id=${confirmation.command_id}`)).toMatchObject({ route: { state: "ready" }, confirmation: { state: "accepted" } });
    expect((await owner.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "fees")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: "ledger", href: "/areas/fees/ledger" }));
    const feesPath = `/api/v1/schools/${f.schoolId}/fees/`, accountPath = `${feesPath}arrangements/workspace/?student_id=${f.learner.id}&invoice_id=${invoice.id}`;
    const account = (await guardian.json<FeeWorkspace>(accountPath)).invoices[0]!;
    expect(account).toMatchObject({ can_request: true, balance_paise: 3_000_000 });
    expect((await learner.json<FeeWorkspace>(accountPath)).invoices[0]).toMatchObject({ can_request: false, balance_paise: 3_000_000 });
    expect((await learner.json<WorkManifest>("/api/v1/workspace/")).areas.find(area => area.key === "fees")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: `account:self:${f.learner.id}` }));
    const due = (days: number) => new Date(Date.parse(`${f.date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const input = { command_id: randomUUID(), request_id: randomUUID(), expected_revision: account.stream_revision,
      basis_hash: account.basis_hash, basis_revision: account.basis_revision,
      schedule: [{ amount_paise: 1_000_000, due_on: due(1) }, { amount_paise: 2_000_000, due_on: due(30) }], note: "Private fictional family circumstances." };
    const requestPath = `${feesPath}invoices/${invoice.id}/arrangements/request/`;
    expect((await guardian.request(requestPath, "POST", input, false)).status).toBe(403);
    const requested = await guardian.json<{ revision: number }>(requestPath, "POST", input);
    expect(await guardian.json(requestPath, "POST", input)).toMatchObject({ id: input.request_id, replayed: true });
    expect(await guardian.json(`${accountPath}&command_id=${input.command_id}`)).toMatchObject({ confirmation: { state: "accepted" } });
    expect(await owner.json(`${accountPath}&command_id=${input.command_id}`)).toMatchObject({ confirmation: { state: "not_found" } });
    const reviewWork = await work(owner, "fee_instalment_request", input.request_id), waiting = await work(guardian, "fee_instalment_request", input.request_id);
    expect(reviewWork).toMatchObject([{ direction: "needs_me", state: "action_required", due_at: null,
      core_trace: { message_ids: [expect.any(String)] } }]);
    expect(waiting).toMatchObject([{ direction: "waiting", state: "waiting_for_review", due_at: null }]);
    expect(reviewWork[0]!.core_trace?.message_ids).toEqual(waiting[0]!.core_trace?.message_ids);
    expect(JSON.stringify([reviewWork, waiting])).not.toContain(input.note);
    expect((await otherTeacher.request(accountPath)).status).toBe(403);
    const decisionPath = `${feesPath}arrangements/${input.request_id}/decision/`, decision = { command_id: randomUUID(), expected_revision: requested.revision,
      decision: "approved", response: "Agreed dates confirmed." };
    expect((await guardian.request(decisionPath, "POST", decision)).status).toBe(403);
    const decided = await owner.json<{ revision: number }>(decisionPath, "POST", decision);
    expect(await owner.json(decisionPath, "POST", decision)).toMatchObject({ replayed: true });
    expect(await work(owner, "fee_instalment_request", input.request_id)).toEqual([]);
    expect(await work(guardian, "fee_instalment_request", input.request_id)).toEqual([]);
    expect((await guardian.json<FeeWorkspace>(accountPath)).invoices[0]).toMatchObject({ balance_paise: 3_000_000,
      agreement: { state: "active", next_due_on: due(1) }, requests: [{ id: input.request_id, status: "approved", note: input.note }] });
    // A later stream does not turn this exact accepted command into a new write.
    expect(await guardian.json(requestPath, "POST", input)).toMatchObject({ id: input.request_id, replayed: true });
    const stale = { ...input, command_id: randomUUID(), request_id: randomUUID() }, obsolete = await guardian.request(requestPath, "POST", stale);
    expect(obsolete.status).toBe(409);
    expect(await obsolete.json()).toMatchObject({ error: { code: "fee_arrangement_obsolete", fields: { fee_arrangement_obsolete: {
      confirmation: "permanently_inapplicable", invoice_id: invoice.id, command_id: stale.command_id,
      expected_revision: stale.expected_revision, current_revision: decided.revision, reason: "stream_advanced",
    } } } });
    expect((await sql<{ id: string }>`SELECT id FROM fee_instalment_requests WHERE school_id=${f.schoolId}::uuid AND id=${stale.request_id}::uuid`.execute(database)).rows).toEqual([]);
    expect(await database.selectFrom("fee_payments").select("id").where("invoice_id", "=", invoice.id).execute()).toEqual([]);
  }, 90_000);
});
