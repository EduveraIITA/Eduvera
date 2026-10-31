import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Both databases must be disposable loopback targets. These are real captured
// schemas and COW services, not query-cache or environment-colour substitutes.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true" && Boolean(process.env.GRADING_POLICY_SIMULATION_TEST_TARGET_URL);
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/grading_unused_test";
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.GRADING_POLICY_SIMULATION_TEST_TARGET_URL) : "postgresql://invalid.invalid/grading_world_unused_test";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());

const configuration = {
  schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2,
  aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include",
  bands: [
    { code: "A", label: "Excellent", minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true },
    { code: "B", label: "Very good", minimum_percentage: 70, maximum_percentage: 79.99, grade_points: 8, passed: true },
    { code: "C", label: "Pass", minimum_percentage: 50, maximum_percentage: 69.99, grade_points: 6, passed: true },
    { code: "F", label: "Fail", minimum_percentage: 0, maximum_percentage: 49.99, grade_points: 0, passed: false },
  ],
};

describe.runIf(enabled)("configured grading in Live and isolated COW worlds", () => {
  it("publishes a credit-weighted cumulative report in one captured world, preserves Live and a sibling, and recovers after refused writes", async () => {
    const suffix = randomUUID(), scope = new ExecutionDataPlaneScope();
    const core = new CampusModelCoreService(database, scope);
    const createAccount = async (firstName: string, role: "admin" | "student") => database.insertInto("users").values({
      username: `grading-${firstName}-${suffix}`, email: `grading-${firstName}-${suffix}@example.test`, password_hash: "isolated-test-only",
      first_name: firstName, last_name: "Fixture", role,
    }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const ownerAccount = await createAccount("Owner", "admin");
    const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, ownerAccount, "UTC"));
    const reviewerAccount = await createAccount("Reviewer", "admin"), learnerAccount = await createAccount("Learner", "student");
    const owner: AuthUser = { ...ownerAccount, active_school_id: schoolId };
    const reviewer: AuthUser = { ...reviewerAccount, active_school_id: schoolId };
    const learner: AuthUser = { ...learnerAccount, active_school_id: schoolId };
    for (const actor of [reviewerAccount, learnerAccount]) await database.insertInto("school_memberships").values({
      school_id: schoolId, user_id: actor.id, role: actor.role === "admin" ? "admin" : "student", is_active: true,
    }).execute();
    for (const actor of [ownerAccount, reviewerAccount]) await database.insertInto("school_memberships").values({
      school_id: schoolId, user_id: actor.id, role: "staff", is_active: true,
    }).execute();
    await linkFixtureStaffIdentity(database, { school_id: schoolId, user_id: reviewer.id, owner_user_id: owner.id });
    const person = await database.insertInto("school_people").values({ school_id: schoolId, first_name: "Learner", last_name: "Fixture" }).returning("id").executeTakeFirstOrThrow();
    const student = await database.insertInto("students").values({ school_id: schoolId, person_id: person.id, user_id: learner.id,
      admission_number: `GP-${suffix.slice(0, 8)}` }).returning("id").executeTakeFirstOrThrow();
    const now = "2032-09-01T12:00:00.000Z";
    const liveEnvironment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
    const runLive = <T>(work: () => Promise<T>) => scope.run(liveEnvironment, () => executionEnvironmentStorage.run(liveEnvironment, work));
    const services = (db: DatabaseService) => {
      const model = new CampusModelCoreService(db, scope), events = new SchoolEventService(db, model);
      return { reports: new AcademicReportsService(db, events, model, model), assessments: new AssessmentsService(db, events, undefined, model, model) };
    };
    const live = services(database);
    const originalPolicy = await runLive(async () => {
      const draft = await live.reports.createPolicy(owner, schoolId, { name: "Credit grading", code: "CREDIT-GRADING", configuration });
      return live.reports.activatePolicy(owner, schoolId, draft.id, { expected_revision: draft.revision, note: "Approved institution policy" });
    });
    const terms: Array<{ termId: string; classId: string; assessments: Array<{ id: string; subjectId: string }> }> = [];
    for (const termNumber of [1, 2]) {
      const term = await database.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "2032-33", name: `Semester ${termNumber}`,
        starts_on: termNumber === 1 ? "2032-04-01" : "2032-07-01", ends_on: termNumber === 1 ? "2032-06-30" : "2032-09-30", attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
      const section = await database.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2032-33", grade: "MTech", section: `G${termNumber}` }).returning("id").executeTakeFirstOrThrow();
      await database.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: 1,
        enrolled_on: termNumber === 1 ? "2032-04-01" : "2032-07-01" }).execute();
      const cycle = await runLive(() => live.assessments.createCycle(owner, schoolId, { term_id: term.id, name: `Semester ${termNumber} assessments`,
        code: `G${termNumber}`, starts_on: termNumber === 1 ? "2032-04-01" : "2032-07-01", ends_on: termNumber === 1 ? "2032-06-30" : "2032-09-30" }));
      const prepared: Array<{ id: string; subjectId: string }> = [];
      for (const [index, marks] of (termNumber === 1 ? [15, 12] : [18, 15]).entries()) {
        const subject = await database.insertInto("subjects").values({ school_id: schoolId, code: `G${termNumber}-${index}`, name: `Grading course ${termNumber}.${index + 1}`, short_name: `G${termNumber}${index}` }).returning("id").executeTakeFirstOrThrow();
        const assessment = await runLive(async () => {
          let state = await live.assessments.createAssessment(owner, schoolId, { cycle_id: cycle.id, class_section_id: section.id,
            subject_id: subject.id, title: `Course ${termNumber}.${index + 1} assignment`, assessment_kind: "assignment", maximum_marks: 20,
            scheduled_at: termNumber === 1 ? "2032-06-15T09:00:00.000Z" : "2032-08-15T09:00:00.000Z",
            grading_policy_id: originalPolicy.id, evidence_requirement: "none", examiner_user_id: owner.id, moderator_user_id: reviewer.id });
          state = await live.assessments.action(owner, schoolId, state.id, "schedule", { expected_revision: state.revision }) as typeof state;
          state = await live.assessments.action(owner, schoolId, state.id, "open-marking", { expected_revision: state.revision }) as typeof state;
          const row = await database.selectFrom("assessment_results").selectAll().where("assessment_id", "=", state.id).executeTakeFirstOrThrow();
          state = await live.assessments.recordResults(owner, schoolId, state.id, { expected_assessment_revision: state.revision,
            results: [{ result_id: row.id, outcome: "scored", marks, grade: "INVENTED", expected_revision: row.revision, reason: "Verified fixture assessment" }] });
          state = await live.assessments.action(owner, schoolId, state.id, "submit", { expected_revision: state.revision }) as typeof state;
          state = await live.assessments.action(reviewer, schoolId, state.id, "approve", { expected_revision: state.revision, note: "Independently verified" }) as typeof state;
          return live.assessments.action(owner, schoolId, state.id, "publish", { expected_revision: state.revision, note: "Approved result release" });
        });
        expect(typeof assessment.id).toBe("string");
        prepared.push({ id: String(assessment.id), subjectId: subject.id });
      }
      terms.push({ termId: term.id, classId: section.id, assessments: prepared });
    }
    const createScheme = async (reports: AcademicReportsService, policyId: string, termNumber: 1 | 2,
      options: { codeSuffix?: string; programmeKey?: string } = {}) => {
      const context = terms[termNumber - 1]!;
      let scheme = await reports.createScheme(owner, schoolId, { term_id: context.termId, class_section_id: context.classId,
        name: `M.Tech Semester ${termNumber}`, code: `MTECH-G${termNumber}${options.codeSuffix ?? ""}`, grading_policy_id: policyId,
        programme_key: options.programmeKey ?? "MTECH-GRADING-2032", term_index: termNumber,
        review_mode: "independent" });
      for (const [index, assessment] of context.assessments.entries()) scheme = await reports.saveSubjectPlan(owner, schoolId, scheme.id, {
        subject_id: assessment.subjectId, course_code: index === 0 ? "GP-101" : termNumber === 1 ? "GP-102" : "GP-103", credits: index === 0 ? 2 : 4,
        pass_percentage: 50, expected_revision: scheme.revision, components: [{ code: "CA", name: "Continuous assessment", weight_percentage: 100, assessment_ids: [assessment.id] }],
      });
      return reports.activateScheme(owner, schoolId, scheme.id, { expected_revision: scheme.revision, note: "Approved course weights and credits" });
    };
    const publish = async (reports: AcademicReportsService, scheme: { id: string; revision: number }, correctionReason = "") => {
      const request = { expected_revision: scheme.revision, correction_reason: correctionReason, idempotency_key: randomUUID() };
      let batch = await reports.generateReport(owner, schoolId, scheme.id, request);
      expect((await reports.generateReport(owner, schoolId, scheme.id, request)).id).toBe(batch.id);
      await expect(reports.batchAction(owner, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Attempted self review" })).rejects.toThrow(/independent reviewer/i);
      expect((await reports.reportDetail(owner, schoolId, batch.id)).batch).toMatchObject({ status: "draft", revision: batch.revision });
      batch = await reports.batchAction(reviewer, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Independent check complete" });
      const publication = { expected_revision: batch.revision, note: "Release to learner", idempotency_key: randomUUID() };
      const published = await reports.batchAction(owner, schoolId, batch.id, "publish", publication);
      expect((await reports.batchAction(owner, schoolId, batch.id, "publish", publication)).revision).toBe(published.revision);
      await expect(reports.batchAction(owner, schoolId, batch.id, "publish", { ...publication, note: "Changed retry" })).rejects.toThrow(/different|changed|another/i);
      return published;
    };
    const initial = await runLive(async () => {
      const scheme = await createScheme(live.reports, originalPolicy.id, 1), batch = await publish(live.reports, scheme);
      return { policy: originalPolicy, scheme, batch, family: await live.reports.familyReports(learner, schoolId, student.id) };
    });
    expect(initial.family.reports).toHaveLength(1);
    expect(Number(initial.family.reports[0]!.gpa)).toBe(6.67);
    expect(Number(initial.family.reports[0]!.credit_total)).toBe(6);
    expect(Number(initial.family.reports[0]!.credit_points)).toBe(40);
    const firstAssessmentId = terms[0]!.assessments[0]!.id;
    const firstPublication = await database.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", firstAssessmentId).executeTakeFirstOrThrow();
    const firstPublishedResult = await database.selectFrom("assessment_publication_results").selectAll().where("publication_id", "=", firstPublication.id).executeTakeFirstOrThrow();
    expect(firstPublishedResult.grade).toBe("B"); expect(Number(firstPublishedResult.grade_points)).toBe(8);
    expect(firstPublication.result_policy).toMatchObject({ policy_id: originalPolicy.id, version: originalPolicy.version });
    const store = new SimulationSnapshotStore(sourceUrl, targetUrl, 4), opened: DatabaseService[] = [];
    const open = async (snapshot: StoredSimulationSnapshot, savedAddress?: { run_id: string; school_id: string; scenario_id: string; namespace_id: string }) => {
      const runId = savedAddress?.run_id ?? randomUUID(), scenarioId = savedAddress?.scenario_id ?? randomUUID();
      const namespace = savedAddress?.namespace_id ?? `scenario:${scenarioId}:run:${runId}`;
      const address = { run_id: runId, school_id: schoolId, scenario_id: scenarioId, namespace_id: namespace };
      const branch = await createSimulationBranch(store.pool, snapshot, address);
      const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
      const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
        createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
      opened.push(db);
      const environment = simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
        source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "grading-policy-world-test", checked_at: now });
      return { db, ...services(db), address, namespace, run: <T>(work: () => Promise<T>) => scope.run(environment, () => executionEnvironmentStorage.run(environment, work)) };
    };
    let legacySchemeId: string | undefined;
    try {
      const snapshot = await store.capture(schoolId, now), branch = await open(snapshot), sibling = await open(snapshot);
      await branch.run(async () => {
        expect(new Date((await sql<{ instant: Date }>`SELECT now() AS instant`.execute(branch.db)).rows[0]!.instant).toISOString()).toBe(now);
        const capturedCommandIds = new Set((await branch.db.selectFrom("campus_model_commands").select("id").where("school_id", "=", schoolId).execute()).map(row => row.id));
        const beforePolicies = await branch.reports.listPolicies(owner, schoolId);
        await expect(branch.reports.createPolicy({ ...owner, active_school_id: randomUUID() }, schoolId,
          { name: "Wrong selected institution", code: "WRONG-WORLD", configuration })).rejects.toThrow(/choose this institution/i);
        await expect(branch.reports.createPolicy(owner, schoolId, { name: "Invalid range", code: "BROKEN", configuration: { ...configuration,
          bands: configuration.bands.map((band, index) => ({ ...band, grade_points: index === 0 ? 11 : band.grade_points })) } })).rejects.toThrow();
        expect(await branch.reports.listPolicies(owner, schoolId)).toEqual(beforePolicies);
        const policyRequest = { name: "Credit grading revised", code: "CREDIT-GRADING", configuration, idempotency_key: randomUUID() };
        const draft = await branch.reports.createPolicy(owner, schoolId, policyRequest);
        expect((await branch.reports.createPolicy(owner, schoolId, policyRequest)).id).toBe(draft.id);
        await expect(branch.reports.createPolicy(owner, schoolId, { ...policyRequest, name: "Changed retry" })).rejects.toThrow(/different|changed|another/i);
        expect(draft.version).toBe(initial.policy.version + 1);
        await expect(branch.reports.activatePolicy(owner, schoolId, draft.id, { expected_revision: draft.revision + 1, note: "Stale page" })).rejects.toThrow(/changed|revision/i);
        expect(await branch.db.selectFrom("academic_grading_policies").select(["status", "revision"]).where("id", "=", draft.id).executeTakeFirstOrThrow())
          .toEqual({ status: "draft", revision: draft.revision });
        const policy = await branch.reports.activatePolicy(owner, schoolId, draft.id, { expected_revision: draft.revision, note: "Approved second version" });
        expect(new Date(policy.activated_at!).toISOString()).toBe(now);
        const scheme = await createScheme(branch.reports, policy.id, 2), batch = await publish(branch.reports, scheme);
        const family = await branch.reports.familyReports(learner, schoolId, student.id);
        expect(family.reports).toHaveLength(2);
        const current = family.reports.find(row => row.batch_id === batch.id)!;
        expect(Number(current.gpa)).toBe(8.67);
        expect(Number(current.cgpa)).toBe(7.6);
        expect(Number(current.cumulative_credits)).toBe(10);
        expect(Number(current.cumulative_credit_points)).toBe(76);
        expect(current.cumulative_sources).toBeTruthy();
        const frozenCurrent = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", batch.id).executeTakeFirstOrThrow();
        expect(family.reports.find(row => row.batch_id === initial.batch.id)).toEqual(initial.family.reports[0]);
        const old = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", initial.batch.id).executeTakeFirstOrThrow();
        expect(Number(old.gpa)).toBe(6.67);
        const commands = (await branch.db.selectFrom("campus_model_commands").select(["id", "state", "environment_namespace_id", "source_domain"])
          .where("school_id", "=", schoolId).where("environment_namespace_id", "=", branch.namespace).execute()).filter(row => !capturedCommandIds.has(row.id));
        expect(commands.length).toBeGreaterThanOrEqual(9);
        expect(commands.some(row => row.state === "accepted")).toBe(true);
        expect(commands.every(row => row.environment_namespace_id === branch.namespace)).toBe(true);
        const reportOutcomes = (await sql<{ command_type: string; state: string; domain_event_id: string | null; event_school_id: string | null }>`
          SELECT command.command_type,command.state,outcome.domain_event_id,event.school_id AS event_school_id
          FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
          LEFT JOIN event_outbox event ON event.id=outcome.domain_event_id
          WHERE command.school_id=${schoolId}::uuid AND command.environment_namespace_id=${branch.namespace}
            AND command.safe_context->>'source_id'=ANY(${[scheme.id, batch.id]}::text[])
        `.execute(branch.db)).rows;
        for (const action of ["generate", "review", "publish"]) expect(reportOutcomes).toContainEqual(expect.objectContaining({
          command_type: `academic_reports.report.${action}`, state: "accepted", domain_event_id: expect.any(String), event_school_id: schoolId,
        }));
        expect(reportOutcomes).toContainEqual(expect.objectContaining({ command_type: "academic_reports.report.review", state: "rejected", domain_event_id: null }));
        const outbox = await branch.db.selectFrom("event_outbox").select(["aggregate_id", "payload"]).where("school_id", "=", schoolId)
          .where("aggregate_id", "=", batch.id).execute();
        expect(outbox.length).toBeGreaterThanOrEqual(3);
        expect(JSON.stringify(outbox)).not.toContain("40.0000");
        await expect(branch.reports.batchAction(owner, schoolId, batch.id, "cancel", { expected_revision: batch.revision, note: "Cannot erase a published report" })).rejects.toThrow(/published|cancel/i);
        let pending = await branch.reports.generateReport(owner, schoolId, scheme.id, { expected_revision: scheme.revision,
          correction_reason: "Recheck semester release", idempotency_key: randomUUID() });
        pending = await branch.reports.batchAction(reviewer, schoolId, pending.id, "review", { expected_revision: pending.revision, note: "Pending release independently checked" });
        // Correct the assessment through its ordinary result lifecycle. A new
        // institution policy never reinterprets this frozen assessment or its
        // earlier publication; a legitimate zero remains a scored result.
        const correctAssessment = async (assessmentId: string, marks: number) => {
          let assessment = await branch.db.selectFrom("assessments").selectAll().where("id", "=", assessmentId).executeTakeFirstOrThrow();
          const result = await branch.db.selectFrom("assessment_results").selectAll().where("assessment_id", "=", assessmentId).executeTakeFirstOrThrow();
          assessment = await branch.assessments.recordResults(owner, schoolId, assessmentId, { expected_assessment_revision: assessment.revision,
            results: [{ result_id: result.id, outcome: "scored", marks, grade: "A", expected_revision: result.revision, reason: "Verified marks after correction" }] });
          assessment = await branch.assessments.action(owner, schoolId, assessmentId, "submit", { expected_revision: assessment.revision }) as typeof assessment;
          assessment = await branch.assessments.action(reviewer, schoolId, assessmentId, "approve", { expected_revision: assessment.revision, note: "Correction independently verified" }) as typeof assessment;
          await branch.assessments.action(owner, schoolId, assessmentId, "publish", { expected_revision: assessment.revision, note: "Corrected result release" });
        };
        await correctAssessment(firstAssessmentId, 0);
        const latest = await branch.db.selectFrom("assessment_publications").selectAll().where("assessment_id", "=", firstAssessmentId).orderBy("sequence", "desc").executeTakeFirstOrThrow();
        const latestResult = await branch.db.selectFrom("assessment_publication_results").selectAll().where("publication_id", "=", latest.id).executeTakeFirstOrThrow();
        expect(latest.result_policy).toEqual(firstPublication.result_policy);
        expect(latestResult).toMatchObject({ outcome: "scored", grade: "F" });
        expect(Number(latestResult.marks)).toBe(0); expect(Number(latestResult.grade_points)).toBe(0);
        expect(await branch.db.selectFrom("assessment_publication_results").selectAll().where("publication_id", "=", firstPublication.id).executeTakeFirstOrThrow()).toEqual(firstPublishedResult);
        // This course is not retaken in term2, so its correction changes the
        // next cumulative result. A previously published CGPA stays frozen.
        await correctAssessment(terms[0]!.assessments[1]!.id, 18);
        await publish(branch.reports, initial.scheme, "Verified first-semester assessment corrections");
        const stalePublication = { expected_revision: pending.revision, note: "Attempt stale cumulative release", idempotency_key: randomUUID() };
        await expect(branch.reports.batchAction(owner, schoolId, pending.id, "publish", stalePublication)).rejects.toThrow(/prior term release changed/i);
        expect(await branch.db.selectFrom("grading_report_batches").select(["status", "revision"]).where("id", "=", pending.id).executeTakeFirstOrThrow())
          .toEqual({ status: "reviewed", revision: pending.revision });
        expect(await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", batch.id).executeTakeFirstOrThrow()).toEqual(frozenCurrent);
        const regenerated = await publish(branch.reports, scheme, "Include corrected first-semester release");
        expect(regenerated.source_fingerprint).not.toBe(pending.source_fingerprint);
        const corrected = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", regenerated.id).executeTakeFirstOrThrow();
        expect(Number(corrected.gpa)).toBe(8.67); expect(Number(corrected.cgpa)).toBe(9.2);
        expect(Number(corrected.cumulative_credit_points)).toBe(92);
        expect(await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", batch.id).executeTakeFirstOrThrow()).toEqual(frozenCurrent);
        // An available semester result is not evidence of cumulative coverage.
        // Neither a missing term nor competing prior term schemes may invent
        // a CGPA or silently pick an arbitrary prior programme record.
        const missingScheme = await createScheme(branch.reports, policy.id, 2, { codeSuffix: "-MISSING", programmeKey: "MTECH-UNSEEDED-2032" });
        const missingBatch = await publish(branch.reports, missingScheme);
        const missing = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", missingBatch.id).executeTakeFirstOrThrow();
        expect(Number(missing.gpa)).toBe(8.67); expect(missing.cgpa).toBeNull(); expect(missing.cgpa_unavailable_reason).toBe("missing_prior_terms");
        const competingPrior = await createScheme(branch.reports, originalPolicy.id, 1, { codeSuffix: "-ALTERNATE" });
        await publish(branch.reports, competingPrior);
        const ambiguousBatch = await branch.reports.generateReport(owner, schoolId, scheme.id, { expected_revision: scheme.revision,
          correction_reason: "Show competing prior-term publication evidence", idempotency_key: randomUUID() });
        const ambiguous = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", ambiguousBatch.id).executeTakeFirstOrThrow();
        expect(Number(ambiguous.gpa)).toBe(8.67); expect(ambiguous.cgpa).toBeNull(); expect(ambiguous.cgpa_unavailable_reason).toBe("ambiguous_prior_terms");
        expect(await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", regenerated.id).executeTakeFirstOrThrow()).toEqual(corrected);
        // Retained legacy bands keep their native calculation, but no longer
        // have a second unmediated writer. Exercise the same complete lifecycle
        // and retry/remark-finality evidence in this actual selected COW branch.
        const legacyRequest = { term_id: terms[1]!.termId, class_section_id: terms[1]!.classId,
          name: "Legacy percentage report", code: "LEGACY-NATIVE", idempotency_key: randomUUID(),
          bands: [{ code: "P", label: "Pass", minimum_percentage: 0, maximum_percentage: 100 }] };
        let legacy = await branch.reports.createScheme(owner, schoolId, legacyRequest);
        legacySchemeId = legacy.id;
        expect((await branch.reports.createScheme(owner, schoolId, legacyRequest)).id).toBe(legacy.id);
        await expect(branch.reports.createScheme(owner, schoolId, { ...legacyRequest, name: "Changed retry" })).rejects.toThrow(/different/i);
        const planRequest = { subject_id: terms[1]!.assessments[0]!.subjectId, expected_revision: legacy.revision,
          idempotency_key: randomUUID(), components: [{ code: "CA", name: "Published assessment", weight_percentage: 100,
            assessment_ids: [terms[1]!.assessments[0]!.id] }] };
        legacy = await branch.reports.saveSubjectPlan(owner, schoolId, legacy.id, planRequest);
        expect((await branch.reports.saveSubjectPlan(owner, schoolId, legacy.id, planRequest)).revision).toBe(legacy.revision);
        legacy = await branch.reports.activateScheme(owner, schoolId, legacy.id, { expected_revision: legacy.revision, note: "Retain original band semantics" });
        const generation = { expected_revision: legacy.revision, idempotency_key: randomUUID() };
        let legacyBatch = await branch.reports.generateReport(owner, schoolId, legacy.id, generation);
        expect((await branch.reports.generateReport(owner, schoolId, legacy.id, generation)).id).toBe(legacyBatch.id);
        const legacyStudent = await branch.db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", legacyBatch.id).executeTakeFirstOrThrow();
        expect(legacyBatch.result_policy).toBeNull(); expect(legacyStudent.overall_percentage).toBe("90.00"); expect(legacyStudent.overall_grade).toBe("P");
        const remarkRequest = { expected_revision: legacyStudent.comment_revision, expected_batch_revision: legacyBatch.revision,
          class_teacher_comment: "Branch-only remarks", principal_comment: "Reviewed locally", idempotency_key: randomUUID() };
        const saved = await branch.reports.updateComments(owner, schoolId, legacyBatch.id, student.id, remarkRequest);
        expect((await branch.reports.updateComments(owner, schoolId, legacyBatch.id, student.id, remarkRequest)).comment_revision).toBe(saved.comment_revision);
        await expect(branch.reports.batchAction(reviewer, schoolId, legacyBatch.id, "review", { expected_revision: legacyBatch.revision, note: "Stale remarks snapshot" })).rejects.toThrow(/changed/i);
        legacyBatch = await branch.reports.batchAction(reviewer, schoolId, legacyBatch.id, "review", { expected_revision: saved.batch_revision, note: "Current remarks checked" });
        await expect(branch.reports.updateComments(owner, schoolId, legacyBatch.id, student.id, { expected_revision: saved.comment_revision,
          class_teacher_comment: "Too late", principal_comment: "" })).rejects.toThrow(/before review/i);
        legacyBatch = await branch.reports.batchAction(owner, schoolId, legacyBatch.id, "publish", { expected_revision: legacyBatch.revision, note: "Publish legacy calculation" });
        const legacyCommands = (await branch.db.selectFrom("campus_model_commands").select(["command_type", "state", "environment_namespace_id"])
          .where("school_id", "=", schoolId).where("source_domain", "=", "academic_reports").execute()).filter(row => row.environment_namespace_id === branch.namespace);
        for (const action of ["scheme.create", "subject.save", "scheme.activate", "report.generate", "report.remarks", "report.review", "report.publish"]) {
          expect(legacyCommands).toContainEqual(expect.objectContaining({ command_type: `academic_reports.${action}`, state: "accepted" }));
        }
        expect((await branch.reports.familyReports(learner, schoolId, student.id)).reports.find(row => row.batch_id === legacyBatch.id))
          .toMatchObject({ overall_percentage: "90.00", overall_grade: "P", class_teacher_comment: "Branch-only remarks" });
      });
      await runLive(() => live.reports.createPolicy(owner, schoolId, { name: "Only after capture", code: "LIVE-LATE", configuration }));
      for (const world of [branch, sibling]) await world.run(async () => {
        const policies = await world.reports.listPolicies(owner, schoolId);
        expect(policies.policies.some(row => row.code === "LIVE-LATE")).toBe(false);
      });
      // A replacement domain connection reads the same retained branch and
      // command receipts; it does not recapture or borrow a later Live policy.
      const reconnected = await open(snapshot, branch.address);
      expect(await reconnected.run(() => reconnected.reports.familyReports(learner, schoolId, student.id)))
        .toEqual(await branch.run(() => branch.reports.familyReports(learner, schoolId, student.id)));
      await reconnected.run(async () => {
        const policiesBefore = await reconnected.reports.listPolicies(owner, schoolId);
        await reconnected.db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", schoolId)
          .where("user_id", "=", owner.id).where("role", "=", "admin").execute();
        await expect(reconnected.reports.createPolicy(owner, schoolId, { name: "Revoked authority", code: "REVOKED", configuration })).rejects.toThrow(/administrator|access/i);
        const policiesAfter = await reconnected.db.selectFrom("academic_grading_policies").selectAll().where("school_id", "=", schoolId).orderBy("code").orderBy("version", "desc").execute();
        expect(policiesAfter).toEqual(policiesBefore.policies);
      });
      expect(await runLive(() => live.reports.familyReports(learner, schoolId, student.id))).toEqual(initial.family);
      expect(await sibling.run(() => sibling.reports.familyReports(learner, schoolId, student.id))).toEqual(initial.family);
      for (const db of [database, sibling.db]) expect(await db.selectFrom("grading_schemes").select("id").where("id", "=", legacySchemeId!).execute()).toEqual([]);
      const livePolicyVersions = (await runLive(() => live.reports.listPolicies(owner, schoolId))).policies.filter(row => row.code === "CREDIT-GRADING");
      const siblingPolicyVersions = (await sibling.run(() => sibling.reports.listPolicies(owner, schoolId))).policies.filter(row => row.code === "CREDIT-GRADING");
      expect(livePolicyVersions).toHaveLength(1); expect(siblingPolicyVersions).toHaveLength(1);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM grading_report_batches WHERE school_id=${schoolId}::uuid`.execute(database)).rows[0]!.count).toBe(1);
    } finally { await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 120_000);
});
