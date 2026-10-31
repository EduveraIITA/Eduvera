import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { join } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import * as files from "../src/common/environment-files.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import { config } from "../src/config.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/assessment_evidence_unused_test";
const targetUrl = process.env.ASSESSMENT_EVIDENCE_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());
afterEach(() => vi.restoreAllMocks());
const pdf = (text: string) => ({ filename: "answer-sheet.pdf", mimetype: "application/pdf", data: Buffer.from(`%PDF-1.4\n${text}\n%%EOF`) });
const day = (now: string, offset: number) => new Date(Date.parse(now) + offset * 86_400_000).toISOString().slice(0, 10);
const streamText = async (stream: AsyncIterable<unknown>) => {
  const chunks: Buffer[] = []; for await (const part of stream) chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
  return Buffer.concat(chunks).toString();
};

async function fixture() {
  const suffix = randomUUID(), scope = new ExecutionDataPlaneScope();
  const account = async (name: string, role: "admin" | "staff") => database.insertInto("users").values({ username: `evidence-${name}-${suffix}`,
    email: `evidence-${name}-${suffix}@example.test`, password_hash: "isolated-test-only", first_name: name, last_name: "Synthetic", role })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const ownerAccount = await account("Owner", "admin"), core = new CampusModelCoreService(database, scope);
  const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, ownerAccount, "UTC"));
  const owner: AuthUser = { ...ownerAccount, active_school_id: schoolId };
  const examinerAccount = await account("Examiner", "staff"), moderatorAccount = await account("Moderator", "staff");
  for (const actor of [examinerAccount, moderatorAccount]) {
    await database.insertInto("school_memberships").values({ school_id: schoolId, user_id: actor.id, role: "staff", is_active: true }).execute();
    await linkFixtureStaffIdentity(database, { school_id: schoolId, user_id: actor.id, owner_user_id: owner.id, teaching: true });
  }
  const examiner: AuthUser = { ...examinerAccount, active_school_id: schoolId }, moderator: AuthUser = { ...moderatorAccount, active_school_id: schoolId };
  const now = new Date().toISOString(), environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(work: () => Promise<T>) => scope.run(environment, () => executionEnvironmentStorage.run(environment, work));
  const term = await database.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "QA2026", name: "Evidence term", starts_on: day(now, -1), ends_on: day(now, 30), attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
  const section = await database.insertInto("class_sections").values({ school_id: schoolId, academic_year: "QA2026", grade: "BCA", section: "QA" }).returning("id").executeTakeFirstOrThrow();
  const subject = await database.insertInto("subjects").values({ school_id: schoolId, code: "QA-EVIDENCE", name: "Evidence privacy", short_name: "Evidence" }).returning("id").executeTakeFirstOrThrow();
  const person = await database.insertInto("school_people").values({ school_id: schoolId, first_name: "Sana", last_name: "Synthetic" }).returning("id").executeTakeFirstOrThrow();
  const student = await database.insertInto("students").values({ school_id: schoolId, person_id: person.id, admission_number: "EVIDENCE-QA-1" }).returning("id").executeTakeFirstOrThrow();
  await database.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: 1, enrolled_on: day(now, -1) }).execute();
  const services = (db: DatabaseService) => { const real = new CampusModelCoreService(db, scope); return new AssessmentsService(db, new SchoolEventService(db, real), undefined, real, real); };
  const service = services(database);
  const cycle = await run(() => service.createCycle(owner, schoolId, { term_id: term.id, name: "Evidence cycle", code: "EVIDENCE", starts_on: day(now, -1), ends_on: day(now, 30) }));
  const input = { cycle_id: cycle.id, class_section_id: section.id, subject_id: subject.id, title: "Private answer sheets", assessment_kind: "assignment", maximum_marks: 20,
    scheduled_at: `${day(now, 0)}T09:00:00.000Z`, evidence_requirement: "required", examiner_user_id: examiner.id, moderator_user_id: moderator.id };
  let state = await run(() => service.createAssessment(owner, schoolId, input));
  state = await run(() => service.action(owner, schoolId, state.id, "schedule", { expected_revision: state.revision })) as typeof state;
  state = await run(() => service.action(owner, schoolId, state.id, "open-marking", { expected_revision: state.revision })) as typeof state;
  const result = await database.selectFrom("assessment_results").selectAll().where("assessment_id", "=", state.id).executeTakeFirstOrThrow();
  state = await run(() => service.recordResults(examiner, schoolId, state.id, { expected_assessment_revision: state.revision,
    results: [{ result_id: result.id, outcome: "scored", marks: 14, expected_revision: result.revision, reason: "Verified synthetic initial marks" }] }));
  return { schoolId, owner, examiner, moderator, now, term, section, subject, student, cycle, input, state, result, run, services, service, scope };
}

describe.runIf(enabled)("assessment evidence exact authority and verified acceptance", () => {
  it("does not combine examiner A with invigilator-only B authority, even for a known evidence locator", async () => {
    const f = await fixture();
    const own = await f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, { reason: "Synthetic answer sheet" }, pdf("EXAMINER A PRIVATE")));
    const other = await f.run(() => f.service.createAssessment(f.owner, f.schoolId, { ...f.input, title: "Assessment B", examiner_user_id: f.owner.id }));
    // Native authority fixture only: a physical sitting/invigilator grant is
    // deliberately distinct from B's result responsibility. No physical event
    // or examination lifecycle completion is asserted by this privacy test.
    const campus = await database.insertInto("institution_campuses").values({ school_id: f.schoolId, name: "Synthetic campus", code: "QA", campus_type: "main", is_primary: true, created_by: f.owner.id, updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    const space = await database.insertInto("campus_spaces").values({ school_id: f.schoolId, campus_id: campus.id, name: "Exam room", code: "EXAM", kind: "classroom", capacity: 10, created_by: f.owner.id, updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    const sitting = await database.insertInto("assessment_sittings").values({ school_id: f.schoolId, assessment_id: other.id, campus_id: campus.id, space_id: space.id,
      starts_at: new Date(f.now), ends_at: new Date(Date.parse(f.now) + 3_600_000), policy_revision: 1, policy_snapshot: {}, created_by: f.owner.id, updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    await database.insertInto("assessment_sitting_invigilators").values({ school_id: f.schoolId, assessment_id: other.id, sitting_id: sitting.id, user_id: f.examiner.id,
      status: "accepted", assigned_by: f.owner.id, responded_at: new Date(f.now) }).execute();
    const privateResult = await database.insertInto("assessment_results").values({ school_id: f.schoolId, assessment_id: other.id, student_id: f.student.id }).returning("id").executeTakeFirstOrThrow();
    const privateFile = await database.insertInto("assessment_evidence").values({ school_id: f.schoolId, assessment_id: other.id, result_id: privateResult.id, student_id: f.student.id,
      storage_key: randomUUID(), original_name: "B-private.pdf", content_type: "application/pdf", size_bytes: 20, sha256: null, uploaded_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    expect(await f.run(() => f.service.detail(f.examiner, f.schoolId, other.id))).toMatchObject({ viewer_role: "invigilator", results: [], publications: [] });
    const reader = vi.spyOn(files, "readEnvironmentStoredFile");
    await expect(f.run(() => f.service.evidence(f.examiner, f.schoolId, other.id, privateFile.id))).rejects.toThrow(/private results or evidence/);
    expect(reader).not.toHaveBeenCalled();
    expect(await streamText((await f.run(() => f.service.evidence(f.examiner, f.schoolId, f.state.id, String(own.id)))).stream)).toContain("EXAMINER A PRIVATE");
    expect(await streamText((await f.run(() => f.service.evidence(f.moderator, f.schoolId, f.state.id, String(own.id)))).stream)).toContain("EXAMINER A PRIVATE");
    await expect(f.run(() => f.service.evidence({ ...f.examiner, active_school_id: randomUUID() }, f.schoolId, f.state.id, String(own.id)))).rejects.toThrow(/Choose this institution/);
    await database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.examiner.id).execute();
    await expect(f.run(() => f.service.evidence(f.examiner, f.schoolId, f.state.id, String(own.id)))).rejects.toThrow(/private results or evidence/);
  });

  it("compensates failed finalization and failed native acceptance; only exact verified uploads create rows, events and command outcomes", async () => {
    const f = await fixture(), upload = pdf("VERIFIED NATIVE ANSWER"), reason = { reason: "Synthetic answer sheet" };
    const baseline = await database.selectFrom("assessments").select("revision").where("id", "=", f.state.id).executeTakeFirstOrThrow();
    const failedRename = vi.spyOn(files, "rename").mockRejectedValueOnce(new Error("Injected evidence finalization failure"));
    await expect(f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload))).rejects.toThrow(/finalization failure/); failedRename.mockRestore();
    expect(await database.selectFrom("assessment_evidence").select("id").where("assessment_id", "=", f.state.id).execute()).toEqual([]);
    expect(await database.selectFrom("assessment_audits").select("id").where("assessment_id", "=", f.state.id).where("action", "=", "assessment.evidence.added").execute()).toEqual([]);
    await expect(f.run(() => f.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: baseline.revision, idempotency_key: randomUUID() }))).rejects.toThrow(/available evidence/);
    const originalRead = files.readEnvironmentStoredFile;
    const readback = vi.spyOn(files, "readEnvironmentStoredFile").mockImplementationOnce(originalRead)
      .mockResolvedValueOnce({ stream: Readable.from([Buffer.alloc(upload.data.length, 120)]), content_type: "application/pdf", original_name: upload.filename,
        size_bytes: upload.data.length, evidence_mode: "simulation", source_content_omitted: false });
    await expect(f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload))).rejects.toThrow(/integrity/); readback.mockRestore();
    expect(await database.selectFrom("assessment_evidence").select("id").where("assessment_id", "=", f.state.id).execute()).toEqual([]);
    const failedEvent = vi.spyOn(SchoolEventService.prototype, "enqueueUserEvent").mockRejectedValueOnce(new Error("Injected native evidence event failure"));
    await expect(f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload))).rejects.toThrow(/event failure/); failedEvent.mockRestore();
    expect(await database.selectFrom("assessment_evidence").select("id").where("assessment_id", "=", f.state.id).execute()).toEqual([]);
    const accepted = await f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload));
    expect(accepted).toMatchObject({ result_id: f.result.id, sha256: createHash("sha256").update(upload.data).digest("hex"), assessment_revision: baseline.revision + 1 });
    expect(await f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload))).toMatchObject({ id: accepted.id, assessment_revision: accepted.assessment_revision });
    expect(await database.selectFrom("assessment_evidence").select("id").where("assessment_id", "=", f.state.id).execute()).toHaveLength(1);
    const outcomes = await sql<{ state: string; domain_event_id: string | null }>`SELECT command.state,outcome.domain_event_id FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='assessment.results.evidence.add'`.execute(database);
    expect(outcomes.rows).toEqual([{ state: "accepted", domain_event_id: expect.any(String) }]);
    const wrong = vi.spyOn(files, "readEnvironmentStoredFile").mockResolvedValueOnce({ stream: Readable.from([Buffer.alloc(upload.data.length, 120)]), content_type: "application/pdf", original_name: upload.filename,
      size_bytes: upload.data.length, evidence_mode: "simulation", source_content_omitted: false });
    await expect(f.run(() => f.service.evidence(f.examiner, f.schoolId, f.state.id, String(accepted.id)))).rejects.toThrow(/integrity/); wrong.mockRestore();
    const missing = vi.spyOn(files, "readEnvironmentStoredFile").mockRejectedValueOnce(new Error("ENOENT"));
    await expect(f.run(() => f.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: Number(accepted.assessment_revision), idempotency_key: randomUUID() }))).rejects.toThrow(/available evidence/); missing.mockRestore();
    expect((await database.selectFrom("assessments").select("status").where("id", "=", f.state.id).executeTakeFirstOrThrow()).status).toBe("marking");
    await f.run(() => f.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: Number(accepted.assessment_revision), idempotency_key: randomUUID() }));
    await expect(f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, pdf("CHANGED AFTER SUBMIT")))).rejects.toThrow(/only be added while marking/);
  });

  it("verifies available legacy bytes automatically at Submit without inventing hashes or asking for a re-upload", async () => {
    const f = await fixture(), upload = pdf("LEGACY REAL BYTES"), storageKey = `${randomUUID()}.pdf`;
    const directory = join(config().uploadDir, "assessments", f.schoolId, f.state.id);
    await files.mkdir(directory, { recursive: true, mode: 0o750 }); await files.writeFile(join(directory, storageKey), upload.data, { flag: "wx", mode: 0o640 });
    const legacy = await database.insertInto("assessment_evidence").values({ school_id: f.schoolId, assessment_id: f.state.id, result_id: f.result.id, student_id: f.student.id,
      storage_key: storageKey, original_name: upload.filename, content_type: upload.mimetype, size_bytes: upload.data.length, sha256: null, uploaded_by: f.examiner.id }).returning("id").executeTakeFirstOrThrow();
    const detail = await f.run(() => f.service.detail(f.examiner, f.schoolId, f.state.id));
    expect(detail.results[0]).toMatchObject({ evidence_count: 0, evidence: [{ id: legacy.id, integrity: "legacy_unverified" }] });
    await f.run(() => f.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: f.state.revision }));
    expect(await database.selectFrom("assessment_evidence").select("sha256").where("id", "=", legacy.id).executeTakeFirstOrThrow())
      .toEqual({ sha256: createHash("sha256").update(upload.data).digest("hex") });
    expect(await database.selectFrom("assessment_audits").select("id").where("assessment_id", "=", f.state.id).where("action", "=", "assessment.evidence.verified").execute()).toHaveLength(1);
  });

  it("retains accepted bytes after a lost successful-commit response and replays the exact accepted outcome", async () => {
    const f = await fixture(), upload = pdf("COMMITTED BUT RESPONSE LOST"), reason = { reason: "Synthetic uncertain response verification" };
    const builder = database.transaction(), execute = builder.execute.bind(builder);
    vi.spyOn(builder, "execute").mockImplementationOnce(async operation => {
      await execute(operation);
      throw new Error("Injected response loss after successful commit");
    });
    const transaction = vi.spyOn(database, "transaction").mockReturnValueOnce(builder);
    await expect(f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload))).rejects.toThrow(/response loss/);
    transaction.mockRestore();
    const rows = await database.selectFrom("assessment_evidence").selectAll().where("assessment_id", "=", f.state.id).execute();
    expect(rows).toHaveLength(1);
    expect(await streamText((await f.run(() => f.service.evidence(f.examiner, f.schoolId, f.state.id, rows[0]!.id))).stream)).toContain("COMMITTED BUT RESPONSE LOST");
    const replay = await f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, upload));
    expect(replay).toMatchObject({ id: rows[0]!.id, assessment_revision: f.state.revision + 1 });
    expect(await database.selectFrom("assessment_evidence").select("id").where("assessment_id", "=", f.state.id).execute()).toHaveLength(1);
    expect(await database.selectFrom("assessment_audits").select("id").where("assessment_id", "=", f.state.id).where("action", "=", "assessment.evidence.added").execute()).toHaveLength(1);
  });

  it.runIf(Boolean(targetUrl))("finalizes and submits only run-local bytes in a real COW world; source originals and its sibling remain unchanged", async () => {
    const f = await fixture(), liveUpload = pdf("LIVE ORIGINAL MUST NOT BE FETCHED"), reason = { reason: "Synthetic answer sheet" };
    const liveFile = await f.run(() => f.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, liveUpload));
    const before = await database.selectFrom("assessments").select(["revision", "status"]).where("id", "=", f.state.id).executeTakeFirstOrThrow();
    const beforeFiles = await database.selectFrom("assessment_evidence").selectAll().where("assessment_id", "=", f.state.id).execute();
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now); await initializeSimulationResources(store.pool);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: value => compiler.createIntrospector(value) } }) as DatabaseService;
        opened.push(db);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "assessment-evidence-integrity", checked_at: f.now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources }); namespaces.push(namespace);
        return { db, service: f.services(db), resources, namespace, run: <T>(work: () => Promise<T>) => f.scope.run(environment, () => executionEnvironmentStorage.run(environment, work)) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        const omitted = await world.service.evidence(f.examiner, f.schoolId, f.state.id, String(liveFile.id));
        expect(omitted.source_content_omitted).toBe(true); expect(await streamText(omitted.stream)).not.toContain("LIVE ORIGINAL MUST NOT BE FETCHED");
        await expect(world.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: before.revision, idempotency_key: randomUUID() })).rejects.toThrow(/available evidence/);
        const failed = vi.spyOn(files, "rename").mockRejectedValueOnce(new Error("Injected COW finalization failure"));
        await expect(world.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, pdf("BRANCH ONLY ANSWER"))).rejects.toThrow(/COW finalization/); failed.mockRestore();
        expect(await world.db.selectFrom("assessment_evidence").selectAll().where("assessment_id", "=", f.state.id).execute()).toEqual(beforeFiles);
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(0);
        // Identical uploaded bytes from a captured Live record are a NEW
        // run-local acceptance, never replayed from the copied source receipt.
        const sameOriginal = await world.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, liveUpload);
        expect(sameOriginal.id).not.toBe(liveFile.id);
        expect((await world.service.evidence(f.examiner, f.schoolId, f.state.id, String(sameOriginal.id))).source_content_omitted).toBe(false);
        const accepted = await world.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, pdf("BRANCH ONLY ANSWER"));
        expect(await streamText((await world.service.evidence(f.examiner, f.schoolId, f.state.id, String(accepted.id))).stream)).toContain("BRANCH ONLY ANSWER");
        await world.service.action(f.examiner, f.schoolId, f.state.id, "submit", { expected_revision: Number(accepted.assessment_revision), idempotency_key: randomUUID() });
        expect((await world.db.selectFrom("assessments").select("status").where("id", "=", f.state.id).executeTakeFirstOrThrow()).status).toBe("submitted");
        await world.db.updateTable("school_memberships").set({ is_active:false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.examiner.id).execute();
        await expect(world.service.evidence(f.examiner, f.schoolId, f.state.id, String(accepted.id))).rejects.toThrow(/private results or evidence/);
        await expect(world.service.addEvidence(f.examiner, f.schoolId, f.state.id, f.result.id, reason, pdf("BRANCH ONLY ANSWER"))).rejects.toThrow();
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(2);
      });
      expect(await database.selectFrom("assessments").select(["revision", "status"]).where("id", "=", f.state.id).executeTakeFirstOrThrow()).toEqual(before);
      expect(await database.selectFrom("assessment_evidence").selectAll().where("assessment_id", "=", f.state.id).execute()).toEqual(beforeFiles);
      expect((await database.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId).where("user_id", "=", f.examiner.id).executeTakeFirstOrThrow()).is_active).toBe(true);
      await sibling.run(async () => {
        expect(await sibling.db.selectFrom("assessments").select(["revision", "status"]).where("id", "=", f.state.id).executeTakeFirstOrThrow()).toEqual(before);
        expect(await sibling.db.selectFrom("assessment_evidence").selectAll().where("assessment_id", "=", f.state.id).execute()).toEqual(beforeFiles);
        expect((await sibling.db.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId).where("user_id", "=", f.examiner.id).executeTakeFirstOrThrow()).is_active).toBe(true);
        expect((await sibling.resources.list(1, 10)).counts.artifacts).toBe(0);
      });
      expect(await streamText((await f.run(() => f.service.evidence(f.examiner, f.schoolId, f.state.id, String(liveFile.id)))).stream)).toContain("LIVE ORIGINAL MUST NOT BE FETCHED");
    } finally { namespaces.forEach(unbindSimulationResources); await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 120_000);
});
