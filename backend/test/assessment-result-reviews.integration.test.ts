import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { ResultReviewsService } from "../src/assessments/result-reviews.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { createAcademicOfferingFixture, publishAcademicOfferingAssessment } from "./academic-offering-cycle.test-support.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { hashPassword } from "../src/auth/password.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const worldTarget = process.env.SIMULATION_CORRECTION_TEST_TARGET_URL;
const compiledRoot = process.env.ACADEMIC_OFFERING_HTTP_COMPILED_ROOT ?? process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT;
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/result_review_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: sourceUrl,
  max: 4,
}) }) }) as DatabaseService;
afterAll(() => db.destroy());
const core = new CampusModelCoreService(db);
const assessments = new AssessmentsService(db, new SchoolEventService(db, core), undefined, core, core);
const reviews = new ResultReviewsService(db, core, core, core);

const date = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
async function account(name: string, role: AuthUser["role"]) {
  const key = randomUUID();
  return db.insertInto("users").values({
    username: `review-${key}`, email: `review-${key}@example.test`, password_hash: "isolated-test-only",
    first_name: name, last_name: "Tester", role,
  }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
}

async function administrator(schoolId: string, owner: AuthUser, name = "Exam coordinator", role: "admin" | "staff" = "admin") {
  const actor = { ...await account(name, role), active_school_id: schoolId };
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: actor.id, role, is_active: true }).execute();
  await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: actor.id, owner_user_id: owner.id });
  return actor;
}

async function addClassStudent(schoolId: string, owner: AuthUser, learner: AuthUser, termId: string, personId?: string) {
  const person = personId ?? (await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Class learner", last_name: "Tester" })
    .returning("id").executeTakeFirstOrThrow()).id;
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: learner.id, role: "student", is_active: true }).execute();
  const student = await db.insertInto("students").values({ school_id: schoolId, person_id: person, user_id: learner.id, admission_number: "REV-2026" })
    .returning("id").executeTakeFirstOrThrow();
  if (!personId) await db.transaction().execute(tx => core.linkAccountEndpoint(tx, {
    school_id: schoolId, person_id: person, user_id: learner.id, actor_user_id: owner.id, effective_from: new Date().toISOString(),
    effective_until: null, source_domain: "people", source_record_id: student.id, source_revision: 1, metadata: {},
  }));
  const term = await db.selectFrom("academic_terms").select("academic_year").where("id", "=", termId).executeTakeFirstOrThrow();
  const section = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: term.academic_year, grade: "8", section: "Review" })
    .returning("id").executeTakeFirstOrThrow();
  const subject = await db.insertInto("subjects").values({ school_id: schoolId, code: "REVCLASS", name: "Science", short_name: "Science" })
    .returning("id").executeTakeFirstOrThrow();
  await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: termId, roll_number: 1, enrolled_on: date(-1) }).execute();
  return { studentId: student.id, personId: person, sectionId: section.id, subjectId: subject.id };
}

async function publishClass(schoolId: string, owner: AuthUser, moderator: AuthUser, termId: string, context: { sectionId: string; subjectId: string }) {
  const cycle = await assessments.createCycle(owner, schoolId, { term_id: termId, code: "CLASS-REV", name: "Class results", starts_on: date(0), ends_on: date(5) });
  let state = await assessments.createAssessment(owner, schoolId, { cycle_id: cycle.id, class_section_id: context.sectionId, subject_id: context.subjectId,
    title: "Science investigation", assessment_kind: "assignment", maximum_marks: 100, scheduled_at: `${date(1)}T12:00:00.000Z`,
    evidence_requirement: "none", examiner_user_id: owner.id, moderator_user_id: moderator.id });
  await assessments.action(owner, schoolId, state.id, "schedule", { expected_revision: state.revision });
  const current = () => db.selectFrom("assessments").selectAll().where("id", "=", state.id).executeTakeFirstOrThrow();
  state = await current();
  await assessments.action(owner, schoolId, state.id, "open-marking", { expected_revision: state.revision });
  state = await current();
  const result = await db.selectFrom("assessment_results").selectAll().where("assessment_id", "=", state.id).executeTakeFirstOrThrow();
  await assessments.recordResults(owner, schoolId, state.id, { expected_assessment_revision: state.revision,
    results: [{ result_id: result.id, outcome: "scored", marks: 68, expected_revision: result.revision, reason: "Reviewed class work." }] });
  await assessments.action(owner, schoolId, state.id, "submit", { expected_revision: (await current()).revision });
  await assessments.action(moderator, schoolId, state.id, "approve", { expected_revision: (await current()).revision, note: "Class results checked." });
  await assessments.action(owner, schoolId, state.id, "publish", { expected_revision: (await current()).revision, note: "Publish class result." });
  return { result, publication: await db.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", state.id).executeTakeFirstOrThrow() };
}

function input(target: { person_id?: string; student_id?: string }, reviewer: AuthUser) {
  return { ...target, reviewer_user_id: reviewer.id, note: "Please check the missing section against the submitted work.", idempotency_key: randomUUID() };
}

describe.runIf(enabled)("published assessment review through actual domain owners", () => {
  it("routes a school learner’s own exact release, rejects classmates and protects the reviewer decision", async () => {
    const seed = await account("Examiner", "admin");
    const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, seed, "UTC"));
    const owner = { ...seed, active_school_id: schoolId };
    const moderator = await administrator(schoolId, owner, "Moderator", "staff"), unrelated = await administrator(schoolId, owner, "Unassigned teacher", "staff");
    const learner = { ...await account("Learner", "student"), active_school_id: schoolId };
    const term = await db.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "2026–27", name: "Term I",
      starts_on: date(-2), ends_on: date(20), attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
    const cls = await addClassStudent(schoolId, owner, learner, term.id);
    const { publication } = await publishClass(schoolId, owner, moderator, term.id, cls);
    const target = { student_id: cls.studentId }, args = [learner, schoolId, publication.assessment_id, publication.id] as const;
    expect(await reviews.learner(...args, target)).toMatchObject({ student_id: cls.studentId, reviewer: { user_id: moderator.id }, reviews: [] });
    await expect(reviews.learner(...args, { student_id: randomUUID() })).rejects.toThrow("own campus account");
    await expect(reviews.learner(...args, { person_id: cls.personId, ...target })).rejects.toThrow("one valid");
    await expect(reviews.learner(unrelated, schoolId, publication.assessment_id, publication.id, target)).rejects.toThrow("own campus account");
    await expect(reviews.learner({ ...learner, active_school_id: randomUUID() }, schoolId, publication.assessment_id, publication.id, target)).rejects.toThrow("Choose this campus");
    const request = input(target, moderator);
    const [submitted, retry] = await Promise.all([reviews.submit(...args, request), reviews.submit(...args, request)]);
    expect(retry).toEqual(submitted);
    expect(submitted.review).toMatchObject({ assessment_id: publication.assessment_id, publication_id: publication.id, state: "submitted", revision: 1 });
    await expect(reviews.submit(...args, { ...request, note: "Different request." })).rejects.toThrow("different work");
    await expect(reviews.submit(...args, { ...request, idempotency_key: randomUUID() })).rejects.toThrow("already requested");
    await expect(reviews.staffDetail(unrelated, schoolId, submitted.review.id)).rejects.toThrow("unavailable");
    expect((await reviews.staffQueue(moderator, schoolId, undefined)).items).toEqual([expect.objectContaining({ id: submitted.review.id, state: "submitted" })]);
    const decision = { action: "resolve", note: "I checked the recording and all awarded marks are included.", expected_revision: 1, idempotency_key: randomUUID() };
    await expect(reviews.decide(owner, schoolId, submitted.review.id, decision)).rejects.toThrow("named reviewer");
    await expect(reviews.decide(moderator, schoolId, submitted.review.id, { ...decision, expected_revision: 4 })).rejects.toThrow("request changed");
    const completed = await reviews.decide(moderator, schoolId, submitted.review.id, decision);
    expect(await reviews.receipt(moderator, schoolId, decision.idempotency_key)).toEqual(completed);
    expect((await reviews.learner(...args, target)).reviews[0]).toMatchObject({ state: "resolved", response_note: decision.note });
    expect((await reviews.staffQueue(moderator, schoolId, undefined)).items).toEqual([]);
    await expect(reviews.receipt(unrelated, schoolId, decision.idempotency_key)).rejects.toThrow("unavailable");
    const audit = await db.selectFrom("assessment_result_review_actions").select(["action", "revision"]).where("review_id", "=", submitted.review.id).orderBy("revision").execute();
    expect(audit).toEqual([{ action: "submit", revision: 1 }, { action: "resolve", revision: 2 }]);
    const events = await db.selectFrom("event_outbox").select(["payload", "audience_user_ids"]).where("aggregate_id", "=", submitted.review.id).execute();
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.audience_user_ids).toEqual([]);
      expect(event.payload).not.toHaveProperty("note");
    }
  });

  it("keeps a course review tied to its learner until an actual revised result is published in a mixed campus", async () => {
    const f = await createAcademicOfferingFixture(db);
    await f.run(async () => {
      const published = await publishAcademicOfferingAssessment(db, f, f.source.id);
      const source = await db.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", published.id).executeTakeFirstOrThrow();
      const secondModerator = await administrator(f.schoolId, f.owner, "Class moderator");
      const cls = await addClassStudent(f.schoolId, f.owner, f.learner.actor, f.termId, f.learner.id);
      const classPublished = await publishClass(f.schoolId, f.owner, secondModerator, f.termId, cls);
      const courseArgs = [f.learner.actor, f.schoolId, published.id, source.id] as const;
      const review = await reviews.submit(...courseArgs, input({ person_id: f.learner.id }, f.owner));
      const classReview = await reviews.submit(f.learner.actor, f.schoolId, classPublished.publication.assessment_id, classPublished.publication.id,
        input({ student_id: cls.studentId }, secondModerator));
      expect(classReview.review).toMatchObject({ publication_id: classPublished.publication.id, reviewer: { user_id: secondModerator.id } });
      expect((await reviews.learner(...courseArgs, { person_id: f.learner.id })).reviews.map(item => item.id)).toEqual([review.review.id]);
      await expect(reviews.learner(f.secondLearner.actor, f.schoolId, published.id, source.id, { person_id: f.learner.id })).rejects.toThrow("own campus account");
      await expect(reviews.staffDetail(f.instructor.actor, f.schoolId, review.review.id)).rejects.toThrow("unavailable");
      const response = await reviews.decide(f.owner, f.schoolId, review.review.id, { action: "refer_correction", note: "Please correct the transcribed value.",
        expected_revision: 1, idempotency_key: randomUUID() });
      expect(response.review).toMatchObject({ state: "correction_requested", correction: null });
      const readAssessment = () => db.selectFrom("assessments").selectAll().where("id", "=", published.id).executeTakeFirstOrThrow();
      const recordAndPublish = async (personId: string, marks: number) => {
        const row = await db.selectFrom("assessment_results").selectAll().where("assessment_id", "=", published.id).where("person_id", "=", personId).executeTakeFirstOrThrow();
        await f.assessments.recordResults(f.instructor.actor, f.schoolId, published.id, { expected_assessment_revision: (await readAssessment()).revision,
          results: [{ result_id: row.id, expected_revision: row.revision, outcome: "scored", marks, reason: "Corrected against recorded assessment evidence." }] });
        expect((await reviews.learner(...courseArgs, { person_id: f.learner.id })).reviews[0]?.correction).toBeNull();
        await f.assessments.action(f.instructor.actor, f.schoolId, published.id, "submit", { expected_revision: (await readAssessment()).revision, idempotency_key: randomUUID() });
        await f.assessments.action(f.owner, f.schoolId, published.id, "approve", { expected_revision: (await readAssessment()).revision, note: "Independently checked.", idempotency_key: randomUUID() });
        return f.assessments.action(f.owner, f.schoolId, published.id, "publish", { expected_revision: (await readAssessment()).revision, note: "Publish the reviewed correction.", idempotency_key: randomUUID() });
      };
      await recordAndPublish(f.secondLearner.id, 81);
      expect((await reviews.learner(...courseArgs, { person_id: f.learner.id })).reviews[0]).toMatchObject({ state: "correction_requested", correction: null });
      await recordAndPublish(f.learner.id, 88);
      expect((await reviews.learner(...courseArgs, { person_id: f.learner.id })).reviews[0]).toMatchObject({ state: "corrected", correction: { sequence: 3 } });
      await expect(reviews.submit(...courseArgs, input({ person_id: f.learner.id }, f.owner))).rejects.toThrow("newer result");
      const original = await db.selectFrom("assessment_publication_results").select("marks").where("publication_id", "=", source.id).where("person_id", "=", f.learner.id).executeTakeFirstOrThrow();
      expect(original.marks).toBe("80.00");
      const latest = await f.assessments.ownResults(f.learner.actor, f.schoolId, f.learner.id);
      expect(latest.results).toContainEqual(expect.objectContaining({ id: published.id, sequence: 3, marks: "88.00" }));
    });
  }, 120_000);

  it("keeps a pure college’s coursework queue private and transfers an unavailable reviewer to an eligible named coordinator", async () => {
    const f = await createAcademicOfferingFixture(db);
    await f.run(async () => {
      const published = await publishAcademicOfferingAssessment(db, f, f.source.id);
      const publication = await db.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", published.id).executeTakeFirstOrThrow();
      const successor = await administrator(f.schoolId, f.owner, "Replacement coordinator");
      const request = await reviews.submit(f.learner.actor, f.schoolId, published.id, publication.id, input({ person_id: f.learner.id }, f.owner));
      const reassign = { action: "reassign", reviewer_user_id: successor.id, expected_revision: 1, idempotency_key: randomUUID() };
      await expect(reviews.decide(successor, f.schoolId, request.review.id, reassign)).rejects.toThrow("unavailable reviewer");
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
      const eligible = await reviews.staffDetail(successor, f.schoolId, request.review.id);
      expect(eligible.replacement_reviewers).toEqual([expect.objectContaining({ user_id: successor.id })]);
      expect((await reviews.decide(successor, f.schoolId, request.review.id, reassign)).review).toMatchObject({
        state: "submitted", revision: 2, reviewer: { user_id: successor.id },
      });
      await expect(reviews.staffDetail(f.owner, f.schoolId, request.review.id)).rejects.toThrow("current campus account");
      expect((await reviews.learner(f.learner.actor, f.schoolId, published.id, publication.id, { person_id: f.learner.id })).reviews[0])
        .toMatchObject({ reviewer: { user_id: successor.id }, state: "submitted" });
      const sourceRows = await sql<{ count: number }>`SELECT count(*)::int FROM students WHERE school_id=${f.schoolId}::uuid`.execute(db);
      expect(sourceRows.rows[0]?.count).toBe(0);
    });
  }, 120_000);

  it.runIf(Boolean(worldTarget))("keeps review decisions, receipts and private notes in the selected Simulation world", async () => {
    const f = await createAcademicOfferingFixture(db);
    const setup = await f.run(async () => {
      const published = await publishAcademicOfferingAssessment(db, f, f.source.id);
      const publication = await db.selectFrom("assessment_publications").selectAll()
        .where("assessment_id", "=", published.id).executeTakeFirstOrThrow();
      const request = await reviews.submit(f.learner.actor, f.schoolId, published.id, publication.id, input({ person_id: f.learner.id }, f.owner));
      return { publication, request };
    });
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(worldTarget), 3);
    const scope = new ExecutionDataPlaneScope(), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, {
          run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}`,
        });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const branchDb = new Kysely<Database>({ dialect: {
          createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: instance => compiler.createIntrospector(instance),
        } }) as DatabaseService;
        opened.push(branchDb);
        const branchCore = new CampusModelCoreService(branchDb, scope);
        const service = new ResultReviewsService(branchDb, branchCore, branchCore, branchCore);
        const selected = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: f.now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "result-review-world-test", checked_at: f.now });
        return { service, run: <T>(work: () => Promise<T>) => scope.run(selected, () => executionEnvironmentStorage.run(selected, work)) };
      };
      const branch = await open(), sibling = await open();
      const note = "The branch reviewer verified the original mark.", key = randomUUID();
      const id = setup.request.review.id;
      await branch.run(async () => {
        const response = await branch.service.decide(f.owner, f.schoolId, id,
          { action: "resolve", note, expected_revision: 1, idempotency_key: key });
        expect(response.review).toMatchObject({ state: "resolved", response_note: note });
        expect(await branch.service.receipt(f.owner, f.schoolId, key)).toEqual(response);
      });
      const verifyOther = async (service: ResultReviewsService) => {
        expect((await service.staffDetail(f.owner, f.schoolId, id)).review).toMatchObject({ state: "submitted", response_note: null });
        await expect(service.receipt(f.owner, f.schoolId, key)).rejects.toThrow("unavailable");
      };
      await sibling.run(() => verifyOther(sibling.service));
      await f.run(() => verifyOther(reviews));
    } finally {
      await Promise.all(opened.map(instance => instance.destroy()));
      await store.pool.end();
    }
  }, 120_000);

  it.runIf(Boolean(compiledRoot))("opens, submits and decides a private result review through ordinary compiled HTTP", async () => {
    const password = `Result-review-${randomUUID()}!`;
    const f = await createAcademicOfferingFixture(db, { passwordHash: await hashPassword(password) });
    const publication = await f.run(async () => {
      const assessment = await publishAcademicOfferingAssessment(db, f, f.source.id);
      return db.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", assessment.id).executeTakeFirstOrThrow();
    });
    const app = new IsolatedAppHttp();
    try {
      await app.start(sourceUrl, { compiledRoot: compiledRoot!, publicUrl: "https://result-review-http.example.test" });
      const learner = app.session(), owner = app.session(), peer = app.session();
      await learner.login(f.learner.actor.email, password, f.schoolId);
      await owner.login(f.owner.email, password, f.schoolId);
      await peer.login(f.secondLearner.actor.email, password, f.schoolId);
      const root = `/api/v1/schools/${f.schoolId}/assessments/result-reviews`, path = `${root}/mine/${publication.assessment_id}/${publication.id}/`;
      const selector = { person_id: f.learner.id }, request = input(selector, f.owner);
      expect(await learner.json(`${path}?person_id=${f.learner.id}`)).toMatchObject({ reviewer: { user_id: f.owner.id } });
      expect((await peer.request(path, "POST", request)).status).toBe(403);
      const created = await learner.json<{ review: { id: string } }>(path, "POST", request);
      expect(created).toMatchObject({ review: { state: "submitted", publication_id: publication.id } });
      expect(await learner.json(`${root}/receipts/${request.idempotency_key}/`)).toEqual(created);
      expect((await peer.request(`${root}/${created.review.id}/`)).status).toBe(404);
      const detail = await owner.json(`${root}/${created.review.id}/`);
      expect(detail).toMatchObject({ can_decide: true, review: { request_note: request.note } });
      const response = await owner.json(`${root}/${created.review.id}/`, "POST", { action: "resolve",
        expected_revision: 1, note: "The recorded result matches the approved mark.", idempotency_key: randomUUID() });
      expect(response).toMatchObject({ review: { state: "resolved" } });
      expect(await learner.json(`${path}?person_id=${f.learner.id}`)).toMatchObject({ reviews: [{ state: "resolved" }] });
    } finally { await app.stop(); }
  }, 120_000);
});
