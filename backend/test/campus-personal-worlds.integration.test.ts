import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ScopedExecutionClock, SystemWallClock } from "../src/database/execution-clock.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { CampusPersonalService } from "../src/campus-view/campus-personal.service.js";
import { CampusViewRepository } from "../src/campus-view/campus-view.repository.js";
import { CampusViewService } from "../src/campus-view/campus-view.service.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import { DayPlanService } from "../src/day-plans/day-plan.service.js";
import { createTeachingSessionFixture, teachingRequest, teachingSessionServices } from "./teaching-sessions.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { classPracticeServices } from "./class-practice.test-support.js";
import { resourceLoanServices } from "./resource-loans.test-support.js";
import { facilitiesServices } from "./facilities.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { CampusScenesService } from "../src/campus-scenes/campus-scenes.service.js";
import { CampusScenesModel } from "../src/campus-scenes/campus-scenes.model.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/personal_unused_test";
const target = process.env.CAMPUS_PERSONAL_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 4 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());

function services(database: DatabaseService) {
  const teaching = teachingSessionServices(database), { core } = teaching;
  const workspace = new WorkspaceRepository(database, new ResponsibilityProjectionService(core));
  const personal = new CampusPersonalService(database, new CampusViewRepository(database), workspace, teaching.context,
    teaching.planning, facilitiesServices(database).facilities, new ScopedExecutionClock(new ExecutionDataPlaneScope(), new SystemWallClock()), core,
    new CampusScenesService(database, new CampusScenesModel(core, core, core), core));
  const school = classPracticeServices(database).school;
  const dayPlans = new DayPlanService(database, teaching.events, school, createStaffCoverageReconciliationTestDouble(), core);
  const view = new CampusViewService(new CampusViewRepository(database), core, core);
  return { ...teaching, personal, view, dayPlans, database };
}

describe.skipIf(!enabled)("personal campus actual owner sources and selected COW worlds", () => {
  it("keeps current enrollment and exact session authority, moves/cancels only a branch, and leaves Live/sibling unchanged", async () => {
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const f = await createTeachingSessionFixture(db, { date }); await f.allowCampus();
    const topology = resourceLoanServices(db).topology;
    const campus = await topology.createCampus(f.owner, f.schoolId, { name: "Learning campus", code: "LEARN", campus_type: "main", is_primary: true, timezone: "UTC" }, teachingRequest(f.owner));
    const first = await topology.createSpace(f.owner, f.schoolId, { campus_id: campus.id, name: "Seminar 101", code: "S101", kind: "classroom", capacity: 36 }, teachingRequest(f.owner));
    const second = await topology.createSpace(f.owner, f.schoolId, { campus_id: campus.id, name: "Seminar 102", code: "S102", kind: "classroom", capacity: 36 }, teachingRequest(f.owner));
    const now = `${date}T07:30:00.000Z`;
    const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => new Date(now), nowIso: () => now } }), operation);
    const live = services(db);
    await run(() => db.transaction().execute(async tx => {
      const slot = await tx.selectFrom("timetable_slots").selectAll().where("id", "=", f.slotId).executeTakeFirstOrThrow();
      const section = await tx.selectFrom("class_sections").selectAll().where("id", "=", f.classId).executeTakeFirstOrThrow();
      const term = await tx.selectFrom("academic_terms").selectAll().where("id", "=", f.termId).executeTakeFirstOrThrow();
      await tx.updateTable("timetable_slots").set({ space_id: String(first.id), room: "Seminar 101", revision: slot.revision + 1 }).where("id", "=", f.slotId).execute();
      await live.core.recordLegacyTimetableSlotChange(tx, { school_id: f.schoolId, actor_user_id: f.owner.id, action: "updated",
        source_record_id: slot.id, source_revision: slot.revision + 1, previous_source_revision: slot.revision, term_id: term.id,
        starts_on: String(term.starts_on), ends_on: String(term.ends_on), timezone: "UTC", occurred_at: now,
        class_section: { kind: "class", domain: "academic_structure", domain_id: section.id, label: "M.Tech Computing · Semester I",
          lifecycle_state: "active", source_revision: section.revision, metadata: {} },
        slot: { weekday: slot.weekday, period_number: 1, starts_at: "08:00", ends_at: "09:00", title: slot.title, slot_type: "class",
          teacher_user_id: f.teacher.id, subject: null,
          space: { kind: "space", domain: "campus_topology", domain_id: String(first.id), label: "Seminar 101", lifecycle_state: "active", source_revision: 1, metadata: {} },
          room_snapshot: "Seminar 101" }, correlation_id: randomUUID() });
    }));
    await run(async () => {
      const repairs = facilitiesServices(db).facilities;
      const owner = await db.transaction().execute(tx => live.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: now }));
      if (!owner.acting) throw new Error("Expected current fixture owner identity.");
      await repairs.saveSettings(f.owner, f.schoolId, { command_id: randomUUID(), expected_revision: 0, handler_person_id: owner.person_id, verifier_mode: "reporter" });
      const repair = await repairs.report(f.learner.actor, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
        problem: "Path light needs inspection", space_id: first.id, location_note: "By the seminar entrance" });
      expect((await live.personal.mine(f.owner, f.schoolId, { campus_id: campus.id })).destinations).toEqual([
        expect.objectContaining({ kind: "repair", space_id: first.id, source: expect.objectContaining({ record_id: repair.id }), spatial_claim: "assigned_work_only" }),
      ]);
    });
    const read = (service: CampusPersonalService) => service.mine(f.learner.actor, f.schoolId, { campus_id: campus.id });
    const initial = await run(() => read(live.personal));
    expect(initial.next[0]).toMatchObject({ kind: "teaching_session", space_id: first.id, state: "upcoming", dimension: "expected" });
    const session = initial.next[0]!;
    expect(initial.motion).toMatchObject({ school_id: f.schoolId, campus_id: campus.id, as_of: now,
      environment: { kind: "live", namespace_id: `live:${f.schoolId}` }, subjects: [{ kind: "self", claims: [{
        space_id: first.id, starts_at: `${date}T08:00:00.000Z`, ends_at: `${date}T09:00:00.000Z`, expected_count: 1,
      }] }] });
    const liveMotionKey = initial.motion.subjects[0]!.subject_key;
    const adminRead = (service: CampusViewService) => service.view(f.owner, f.schoolId, { campus_id: String(campus.id) });
    const initialAdmin = await run(() => adminRead(live.view));
    expect(initialAdmin.motion.subjects.some(subject => subject.kind === "group")).toBe(true);
    expect(initialAdmin.motion.subjects.flatMap(subject => subject.claims).every(claim => claim.space_id === first.id)).toBe(true);
    expect(session.target_path).toContain("session_id=");
    expect(JSON.stringify(initial)).not.toMatch(/roster|admission_number|student_id|password/);
    await run(async () => {
      expect((await live.personal.mine(f.teacher, f.schoolId, { campus_id: campus.id })).next[0]?.target_path).toBe(session.target_path);
      expect((await live.personal.mine(f.otherTeacher, f.schoolId, { campus_id: campus.id })).destinations).toEqual([]);
      expect((await live.personal.mine(f.guardian, f.schoolId, { campus_id: campus.id })).destinations).toEqual([]);
      await expect(live.personal.mine(f.learner.actor, f.schoolId, { person_id: f.secondLearner.personId })).rejects.toThrow("does not accept");
    });
    if (!target) return;
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now); await initializeSimulationResources(store.pool);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database); namespaces.push(namespace);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "personal-campus-actual-cow-test", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources });
        return { ...services(database), namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        const before = await read(world.personal);
        expect(before.environment).toEqual({ kind: "simulation", namespace_id: world.namespace });
        expect(before.motion.as_of).toBe(now);
        expect(before.motion.subjects[0]?.subject_key).not.toBe(liveMotionKey);
        const worldKey = before.motion.subjects[0]!.subject_key;
        const draft = await world.dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, class_section_id: f.classId, date, idempotency_key: randomUUID() });
        const change = async (revision: number, cancelled: boolean) => {
          const saved = await world.dayPlans.save(teachingRequest(f.owner), draft.id, { school_id: f.schoolId, idempotency_key: randomUUID(),
            expected_revision: revision, notice: "Updated teaching destination", reason: "Room maintenance", periods: [{ period_number: 1,
              subject_id: null, starts_at: "08:00", ends_at: "09:00", title: "Fictional programming class", slot_type: "class", room: "Seminar 102",
              space_id: second.id, teacher_user_id: f.teacher.id, cancelled, materials: [] }] });
          return world.dayPlans.publish(teachingRequest(f.owner), draft.id, { school_id: f.schoolId, idempotency_key: randomUUID(), expected_revision: saved.revision });
        };
        await change(draft.revision, false);
        const after = await read(world.personal);
        expect(after.next[0]).toMatchObject({ id: session.id, space_id: second.id, target_path: session.target_path });
        expect(after.motion.subjects[0]).toMatchObject({ subject_key: worldKey, claims: [{ space_id: second.id,
          starts_at: `${date}T08:00:00.000Z`, ends_at: `${date}T09:00:00.000Z`, spatial_claim: "expected_context_only" }] });
        expect((await adminRead(world.view)).motion.subjects.flatMap(subject => subject.claims)
          .every(claim => claim.space_id === second.id)).toBe(true);
        const reopened = await world.dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, class_section_id: f.classId, date, idempotency_key: randomUUID() });
        expect((await world.dayPlans.detail(f.owner, draft.id, f.schoolId)).periods[0]?.space_id).toBe(second.id);
        const labelOnly = { school_id: f.schoolId, idempotency_key: randomUUID(), expected_revision: reopened.revision,
          notice: "Room awaiting mapping", reason: "Label-only client edit", periods: [{ period_number: 1,
            subject_id: null, starts_at: "08:00", ends_at: "09:00", title: "Fictional programming class", slot_type: "class", room: "Unmapped room",
            teacher_user_id: f.teacher.id, cancelled: false, materials: [] }] };
        await expect(world.dayPlans.save(teachingRequest(f.owner), draft.id, { ...labelOnly, idempotency_key: randomUUID(),
          periods: [{ ...labelOnly.periods[0], space_id: randomUUID() }] })).rejects.toThrow("current campus place");
        const unlinked = await world.dayPlans.save(teachingRequest(f.owner), draft.id, labelOnly);
        expect((await world.dayPlans.detail(f.owner, draft.id, f.schoolId)).periods[0]?.space_id).toBeNull();
        await world.dayPlans.publish(teachingRequest(f.owner), draft.id, { school_id: f.schoolId, idempotency_key: randomUUID(), expected_revision: unlinked.revision });
        expect((await read(world.personal)).next[0]).toMatchObject({ id: session.id, space_id: null, place_label: "Unmapped room" });
        expect((await read(world.personal)).motion.subjects[0]?.claims[0]?.space_id).toBeNull();
        expect((await adminRead(world.view)).motion.subjects).toEqual([]);
        const cancelDraft = await world.dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, class_section_id: f.classId, date, idempotency_key: randomUUID() });
        await change(cancelDraft.revision, true);
        const cancelled = await read(world.personal);
        expect(cancelled.destinations.some(item => item.id === session.id)).toBe(false);
        expect(cancelled.motion.subjects).toEqual([]);
        expect((await adminRead(world.view)).motion.subjects).toEqual([]);
        // Explicit fixture revocation tests fresh account checks in the selected store.
        await world.database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.learner.actor.id).execute();
        await expect(read(world.personal)).rejects.toThrow(/access|active/);
      });
      expect((await run(() => read(live.personal))).next[0]).toMatchObject({ id: session.id, space_id: first.id });
      expect((await run(() => read(live.personal))).motion.subjects[0]?.subject_key).toBe(liveMotionKey);
      expect((await sibling.run(() => read(sibling.personal))).next[0]).toMatchObject({ id: session.id, space_id: first.id });
      expect((await sibling.run(() => read(sibling.personal))).motion.subjects[0]?.subject_key).not.toBe(liveMotionKey);
      expect((await run(() => adminRead(live.view))).motion).toEqual(initialAdmin.motion);
      expect((await sibling.run(() => adminRead(sibling.view))).motion.subjects.flatMap(subject => subject.claims)
        .every(claim => claim.space_id === first.id)).toBe(true);
      expect((await sql`SELECT id FROM day_plans WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    } finally {
      namespaces.forEach(unbindSimulationResources); await Promise.all(opened.map(database => database.destroy())); await store.pool.end();
    }
  }, 120_000);
});
