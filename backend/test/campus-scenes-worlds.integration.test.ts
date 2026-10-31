import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import {
  bindSimulationResources,
  unbindSimulationResources,
} from "../src/common/simulation-resources.js";
import {
  initializeSimulationResources,
  SimulationResourceStore,
} from "../src/database/simulation-resources.store.js";
import { CampusSceneImportProvider } from "../src/campus-scene-import/scene-import.provider.js";
import { CampusSceneImportService } from "../src/campus-scene-import/scene-import.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import {
  createSimulationBranch,
  SimulationBranchDriver,
} from "../src/database/simulation-branch.driver.js";
import {
  SimulationSnapshotStore,
  type StoredSimulationSnapshot,
} from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import {
  campusSceneDocument,
  campusScenePng,
  campusSceneServices,
  createCampusSceneFixture,
} from "./campus-scenes.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { CampusViewRepository } from "../src/campus-view/campus-view.repository.js";
import { CampusViewService } from "../src/campus-view/campus-view.service.js";
import { createIndoorSceneFixture } from "./campus-scenes-indoor.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, value => value);
const source = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/campus_scene_worlds_unused_test";
const target = process.env.CAMPUS_SCENES_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: source, max: 3 }),
  }),
}) as DatabaseService;
afterAll(() => db.destroy());
const command = (revision: number) => ({
  idempotency_key: randomUUID(),
  expected_revision: revision,
});
function campusOperations(services: Pick<ReturnType<typeof campusSceneServices>, "db" | "events" | "core">) {
  return {
    planning: new ActivityPlanningService(services.db, services.events, services.core, services.core, services.core, new ResponsibilityProjectionService(services.core)),
    view: new CampusViewService(new CampusViewRepository(services.db), services.core, services.core),
  };
}
async function openWorld(
  store: SimulationSnapshotStore,
  snapshot: StoredSimulationSnapshot,
  schoolId: string,
) {
  const runId = randomUUID(),
    scenarioId = randomUUID(),
    namespace = `scenario:${scenarioId}:run:${runId}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, {
    run_id: runId,
    school_id: schoolId,
    scenario_id: scenarioId,
    namespace_id: namespace,
  });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot),
    compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({
    dialect: {
      createDriver: () => driver,
      createAdapter: () => compiler.createAdapter(),
      createQueryCompiler: () => compiler.createQueryCompiler(),
      createIntrospector: (connection) =>
        compiler.createIntrospector(connection),
    },
  }) as DatabaseService;
  const environment = simulationRequestEnvironment({
    institution_id: schoolId,
    scenario_id: scenarioId,
    run_id: runId,
    virtual_now: snapshot.captured_at,
    source_snapshot_ref: `sha256:${snapshot.content_hash}`,
    manifest_ref: "campus-scenes-actual-cow",
    checked_at: snapshot.captured_at,
  });
  const resources = new SimulationResourceStore(store.pool, environment),
    effects = new ExecutionEffectRouter();
  effects.bindSimulationSinks({
    environment,
    sinks: EXECUTION_EFFECT_KINDS.map((kind) => resources.sink(kind)),
  });
  bindSimulationResources({
    environment,
    artifacts: resources,
    effects,
    effectReplay: resources,
  });
  const services = campusSceneServices(database),
    provider = new CampusSceneImportProvider();
  return {
    ...services,
    importer: new CampusSceneImportService(database, services.scenes, provider),
    provider,
    resources,
    database,
    namespace,
    run: <T>(fn: () => Promise<T>) =>
      executionEnvironmentStorage.run(environment, fn),
  };
}

describe.skipIf(!enabled || !target)(
  "Campus scenes in actual selected COW worlds",
  () => {
    it("reads exact room pooled quantities without widening the individual picker and isolates a branch inventory change", async () => {
      const f = await createIndoorSceneFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
      const opened: DatabaseService[] = [], namespaces: string[] = [];
      const typeInput = { code: "ROOM-FURNITURE", name: "Room furniture", category: "furniture", tracking_mode: "pooled", unit_label: "seats" };
      let typeId = "", poolId = "", otherCampusId = "";
      try {
        await f.run(async () => {
          typeId = String((await f.topology.createResourceType(f.user, f.schoolId, typeInput, resourceLoanRequest(f.user))).id);
          poolId = String((await f.topology.createAsset(f.user, f.schoolId, { campus_id: f.campusId, space_id: f.roomId, resource_type_id: typeId, name: "Seminar seating", quantity: 24, notes: "" }, resourceLoanRequest(f.user))).id);
          const otherRoom = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, parent_space_id: f.firstId, kind: "office", name: "Faculty office", code: "OFFICE" }, resourceLoanRequest(f.user));
          await f.topology.createAsset(f.user, f.schoolId, { campus_id: f.campusId, space_id: otherRoom.id, resource_type_id: typeId, name: "Private office seating", quantity: 4, notes: "" }, resourceLoanRequest(f.user));
          otherCampusId = String((await f.topology.createCampus(f.user, f.schoolId, { name: "Field campus", code: "FIELD", campus_type: "branch" }, resourceLoanRequest(f.user))).id);
          const original = await f.scenes.resources(f.user, f.schoolId, f.campusId, {});
          expect(original.items.map(item => item.id)).toEqual([f.holdingId]);
          expect(original.items[0]).toMatchObject({ quantity: 1, tracking_mode: "individual", unit_label: expect.any(String) });
          expect((await f.scenes.resources(f.user, f.schoolId, f.campusId, { holding_id: poolId })).selected).toBeNull();
          const pooled = await f.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" });
          expect(pooled).toMatchObject({ total: 1, page: 1, page_size: 20, selected: null });
          expect(pooled.items).toEqual([expect.objectContaining({ id: poolId, space_id: f.roomId, quantity: 24, tracking_mode: "pooled", unit_label: "seats" })]);
          expect((await f.scenes.resources(f.user, f.schoolId, f.campusId, { tracking_mode: "all" })).total).toBe(3);
          expect((await f.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled", holding_id: poolId })).selected?.id).toBe(poolId);
          await expect(f.scenes.resources(f.borrower, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).rejects.toThrow("administrator");
          await expect(f.scenes.resources(f.user, f.schoolId, otherCampusId, { space_id: f.roomId, tracking_mode: "pooled" })).rejects.toThrow("active place");
          await expect(f.scenes.resources({ ...f.user, active_school_id: randomUUID() }, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).rejects.toThrow("current world");
        });
        const snapshot = await store.capture(f.schoolId, f.now); await initializeSimulationResources(store.pool);
        const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
        for (const entry of [world, sibling]) { opened.push(entry.database); namespaces.push(entry.namespace); }
        await world.run(async () => {
          expect((await world.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).items[0]?.quantity).toBe(24);
          const holding = await world.database.selectFrom("campus_resource_holdings").selectAll().where("school_id", "=", f.schoolId).where("id", "=", poolId).executeTakeFirstOrThrow();
          await world.topology.updateAsset(f.user, f.schoolId, poolId, { campus_id: f.campusId, space_id: f.roomId, resource_type_id: typeId, name: holding.name, quantity: 25, asset_tag: null, state: "available", notes: "", expected_revision: holding.revision }, resourceLoanRequest(f.user));
          const changed = await world.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" });
          expect(changed.items).toEqual([expect.objectContaining({ id: poolId, quantity: 25, unit_label: "seats" })]);
          await expect(world.scenes.resources(f.borrower, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).rejects.toThrow("administrator");
        });
        await sibling.run(async () => expect((await sibling.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).items[0]?.quantity).toBe(24));
        await f.run(async () => expect((await f.scenes.resources(f.user, f.schoolId, f.campusId, { space_id: f.roomId, tracking_mode: "pooled" })).items[0]?.quantity).toBe(24));
      } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
    }, 120_000);
    it("validates editable indoor assets natively and keeps furniture edits isolated from Live and a sibling", async () => {
      const f = await createIndoorSceneFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
      const opened: DatabaseService[] = [], namespaces: string[] = [];
      const keys = ["desk", "chair", "computer", "meeting_table", "cabinet", "server_rack", "printer", "fire_extinguisher", "first_aid", "toilet", "washbasin", "door", "window", "projector", "whiteboard"] as const;
      const furniture = keys.map((asset_key, index) => ({
        id: `furniture-${index}`, kind: "fixture" as const, label: asset_key, asset_key,
        space_id: f.roomId, floor_id: f.firstId, parent_element_id: "building", ...(index === 0 ? { holding_id: f.holdingId } : {}),
        geometry: { type: "point" as const, points: [{ x: 54 + index % 5 * 6, y: 54 + Math.floor(index / 5) * 6 }] },
        width: 2, depth: .75, height: .8, rotation_deg: index % 2 ? -90 : 90, review_state: "reviewed" as const,
      }));
      f.document.elements.push(...furniture);
      const native = async (database: DatabaseService, fields: Record<string, unknown> = {}) => {
        const document = { ...f.document, elements: f.document.elements.map(element => element.id === "furniture-0" ? { ...element, ...fields } : element) };
        return (await sql<{ valid: boolean }>`SELECT campus_scene_links_valid(${f.schoolId}::uuid,${f.campusId}::uuid,${JSON.stringify(document)}::jsonb) AS valid`.execute(database)).rows[0]!.valid;
      };
      try {
        await f.run(async () => {
          expect(await native(db)).toBe(true);
          for (const depth of [0, -1, 10000.01, null, "1", "Infinity", "NaN", true]) expect(await native(db, { depth })).toBe(false);
          for (const rotation_deg of [-360.01, 360.01, null, "90", "Infinity", "NaN", false]) expect(await native(db, { rotation_deg })).toBe(false);
          for (const rotation_deg of [-360, 0, 360]) expect(await native(db, { depth: 10000, rotation_deg })).toBe(true);
          expect(await native(db, { depth: .001, rotation_deg: -22.5 })).toBe(true);
          expect(await native(db, { asset_key: "unreviewed-script-asset" })).toBe(false);
          expect(await native(db, { floor_id: f.gateId })).toBe(false);
          const privilege = (await sql<{ security_definer: boolean; volatility: string; settings: string[] }>`SELECT prosecdef AS security_definer,provolatile AS volatility,proconfig AS settings FROM pg_proc WHERE oid='campus_scene_links_valid(uuid,uuid,jsonb)'::regprocedure`.execute(db)).rows[0]!;
          expect(privilege).toMatchObject({ security_definer: false, volatility: "s", settings: ["search_path=public"] });
          await expect(f.scenes.saveDraft(f.borrower, f.schoolId, f.campusId, { ...command(0), document: f.document })).rejects.toThrow("administrator");
          await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document: f.document });
          await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
        });
        const original = await f.run(() => f.scenes.published(f.borrower, f.schoolId, f.campusId));
        expect(original.scene!.document.elements.filter(element => element.id.startsWith("furniture-"))).toEqual(furniture);
        const snapshot = await store.capture(f.schoolId, f.now); await initializeSimulationResources(store.pool);
        const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
        for (const entry of [world, sibling]) { opened.push(entry.database); namespaces.push(entry.namespace); }
        await world.run(async () => {
          expect(await native(world.database)).toBe(true);
          expect(await native(world.database, { rotation_deg: 361 })).toBe(false);
          expect(await native(world.database, { depth: "0.75" })).toBe(false);
          expect((await world.scenes.published(f.borrower, f.schoolId, f.campusId)).scene!.document.elements).toEqual(original.scene!.document.elements);
          await world.scenes.reopen(f.user, f.schoolId, f.campusId, command(2));
          const document = (await world.scenes.workspace(f.user, f.schoolId, f.campusId)).scene!.draft!;
          Object.assign(document.elements.find(element => element.id === "furniture-0")!, { depth: 1.25, rotation_deg: 33 });
          const save = { ...command(3), document }; await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save);
          expect(await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save)).toMatchObject({ revision: 4, replayed: true });
          const publish = command(4); await world.scenes.publish(f.user, f.schoolId, f.campusId, publish);
          expect(await world.scenes.publish(f.user, f.schoolId, f.campusId, publish)).toMatchObject({ version: 5, replayed: true });
          expect((await world.scenes.published(f.borrower, f.schoolId, f.campusId)).scene!.document.elements.find(element => element.id === "furniture-0"))
            .toEqual({ ...furniture[0], depth: 1.25, rotation_deg: 33 });
        });
        await sibling.run(async () => {
          expect(await native(sibling.database)).toBe(true);
          expect((await sibling.scenes.published(f.borrower, f.schoolId, f.campusId)).scene!.document.elements).toEqual(original.scene!.document.elements);
          expect((await sibling.scenes.workspace(f.user, f.schoolId, f.campusId)).scene).toMatchObject({ revision: 2, draft: null });
        });
        await f.run(async () => expect(await f.scenes.published(f.borrower, f.schoolId, f.campusId)).toEqual(original));
      } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
    }, 120_000);
    it("captures indoor landings and closes a lift only in its selected world with immutable exact retries", async () => {
      const f = await createIndoorSceneFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
      const opened: DatabaseService[] = [], namespaces: string[] = [];
      try {
        await f.run(async () => {
          await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document: f.document });
          await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
        });
        const original = await f.run(() => f.scenes.published(f.borrower, f.schoolId, f.campusId));
        const snapshot = await store.capture(f.schoolId, f.now); await initializeSimulationResources(store.pool);
        const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
        for (const entry of [world, sibling]) { opened.push(entry.database); namespaces.push(entry.namespace); }
        await world.run(async () => {
          const initial = await world.scenes.published(f.borrower, f.schoolId, f.campusId);
          expect(initial.scene!.document.elements).toEqual(original.scene!.document.elements);
          await world.scenes.reopen(f.user, f.schoolId, f.campusId, command(2));
          const document = (await world.scenes.workspace(f.user, f.schoolId, f.campusId)).scene!.draft!;
          document.elements.find(element => element.id === "lift")!.navigation_connector!.status = "closed";
          const save = { ...command(3), document }; await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save);
          expect(await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save)).toMatchObject({ revision: 4, replayed: true });
          const publish = command(4); await world.scenes.publish(f.user, f.schoolId, f.campusId, publish);
          expect(await world.scenes.publish(f.user, f.schoolId, f.campusId, publish)).toMatchObject({ version: 5, replayed: true });
          const changed = await world.scenes.published(f.borrower, f.schoolId, f.campusId);
          expect(changed.scene!.document.elements.find(element => element.id === "lift")!.navigation_connector).toMatchObject({ status: "closed", from_floor_id: f.groundId, to_floor_id: f.firstId });
          expect(changed.scene!.document.elements.find(element => element.id === "stairs")!.navigation_connector!.status).toBe("open");
          const proof = (await sql<{ namespace: string; count: number }>`SELECT command.environment_namespace_id AS namespace,count(*)::int AS count FROM campus_scene_revisions receipt JOIN campus_model_commands command ON command.id=receipt.command_id WHERE receipt.scene_id=${f.campusId}::uuid AND receipt.revision>2 GROUP BY command.environment_namespace_id`.execute(world.database)).rows;
          expect(proof).toEqual([{ namespace: world.namespace, count: 3 }]);
        });
        await sibling.run(async () => expect((await sibling.scenes.published(f.borrower, f.schoolId, f.campusId)).scene!.document.elements).toEqual(original.scene!.document.elements));
        await f.run(async () => expect(await f.scenes.published(f.borrower, f.schoolId, f.campusId)).toEqual(original));
      } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
    }, 120_000);
    it("captures reviewed walking links and closes one branch without changing Live or its sibling", async () => {
      const f = await createCampusSceneFixture(db);
      const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
      const opened: DatabaseService[] = [], namespaces: string[] = [];
      try {
        await f.run(async () => {
          const gate = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "South gate", code: "SOUTH", kind: "gate" }, resourceLoanRequest(f.user));
          const building = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Learning building", code: "LEARN", kind: "building" }, resourceLoanRequest(f.user));
          const document = campusSceneDocument(String(building.id));
          document.elements[1]!.navigation = { walkable: true, accessible: true, status: "open", start_space_id: String(gate.id), end_space_id: String(building.id) };
          await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document });
          await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
        });
        const original = await f.run(() => f.scenes.published(f.borrower, f.schoolId, f.campusId));
        const snapshot = await store.capture(f.schoolId, f.now);
        await initializeSimulationResources(store.pool);
        const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
        for (const entry of [world, sibling]) { opened.push(entry.database); namespaces.push(entry.namespace); }
        await world.run(async () => {
          expect((await world.scenes.published(f.borrower, f.schoolId, f.campusId)).scene?.document.elements[1]!.navigation).toEqual(original.scene!.document.elements[1]!.navigation);
          await world.scenes.reopen(f.user, f.schoolId, f.campusId, command(2));
          const document = (await world.scenes.workspace(f.user, f.schoolId, f.campusId)).scene!.draft!;
          document.elements[1]!.navigation!.status = "closed";
          const save = { ...command(3), document };
          await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save);
          expect(await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save)).toMatchObject({ revision: 4, replayed: true });
          const publish = command(4);
          await world.scenes.publish(f.user, f.schoolId, f.campusId, publish);
          expect(await world.scenes.publish(f.user, f.schoolId, f.campusId, publish)).toMatchObject({ version: 5, replayed: true });
          expect((await world.scenes.published(f.borrower, f.schoolId, f.campusId)).scene?.document.elements[1]!.navigation).toMatchObject({ status: "closed", accessible: true });
          const evidence = (await sql<{ namespace: string; count: number }>`SELECT command.environment_namespace_id AS namespace,count(*)::int AS count FROM campus_scene_revisions receipt JOIN campus_model_commands command ON command.id=receipt.command_id WHERE receipt.scene_id=${f.campusId}::uuid AND receipt.revision>2 GROUP BY command.environment_namespace_id`.execute(world.database)).rows;
          expect(evidence).toEqual([{ namespace: world.namespace, count: 3 }]);
        });
        await sibling.run(async () => {
          expect((await sibling.scenes.published(f.borrower, f.schoolId, f.campusId)).scene?.document.elements[1]!.navigation).toEqual(original.scene!.document.elements[1]!.navigation);
          expect((await sibling.scenes.workspace(f.user, f.schoolId, f.campusId)).scene).toMatchObject({ revision: 2, draft: null });
        });
        await f.run(async () => {
          expect(await f.scenes.published(f.borrower, f.schoolId, f.campusId)).toEqual(original);
          expect((await f.scenes.workspace(f.user, f.schoolId, f.campusId)).scene).toMatchObject({ revision: 2, draft: null });
        });
      } finally {
        for (const namespace of namespaces) unbindSimulationResources(namespace);
        await Promise.all(opened.map(database => database.destroy()));
        await store.pool.end();
      }
    }, 120_000);
    it("preserves captured images and canonical links while publishing edits only in the selected branch", async () => {
      const f = await createCampusSceneFixture(db),
        store = new SimulationSnapshotStore(
          source,
          requireIsolatedTestDatabaseUrl(target),
          3,
        );
      const opened: DatabaseService[] = [],
        namespaces: string[] = [];
      const sourceImport = new CampusSceneImportService(
        db,
        f.scenes,
        new CampusSceneImportProvider(),
      );
      const geojson = {
        kind: "geojson",
        idempotency_key: randomUUID(),
        label: "Captured survey",
        attribution: "Institution survey",
        rights_confirmed: true,
        text: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { building: "yes", name: "Surveyed building" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [77, 12],
                    [77.001, 12],
                    [77.001, 12.001],
                    [77, 12.001],
                    [77, 12],
                  ],
                ],
              },
            },
          ],
        }),
      };
      let activityId = "", lampId = "";
      const activityDay = new Date(Date.parse(f.now) + 86_400_000).toISOString().slice(0, 10);
      const activityAt = `${activityDay}T12:30:00.000Z`;
      const expectedActivity = async (services: Pick<ReturnType<typeof campusSceneServices>, "db" | "events" | "core">) =>
        (await campusOperations(services).view.view(f.user, f.schoolId, { campus_id: f.campusId, at: activityAt })).spaces.find(space => space.id === placeId)?.expected_now;
      let imageId = "",
        placeId = "";
      try {
        await f.run(async () => {
          const place = await f.topology.createSpace(
            f.user,
            f.schoolId,
            {
              campus_id: f.campusId,
              name: "Fictional library",
              code: `LIB-${randomUUID().slice(0, 8)}`,
              kind: "building",
            },
            resourceLoanRequest(f.user),
          );
          placeId = String(place.id);
          const activity = await campusOperations(f).planning.create(resourceLoanRequest(f.user), f.schoolId, {
            idempotency_key: randomUUID(), title: "Captured reading circle", purpose: "other", timezone: "UTC",
            starts_on: activityDay, ends_on: activityDay, recurrence: "once", starts_at: "12:00", ends_at: "13:00",
            person_ids: [f.borrowerPersonId], space_id: placeId, attendance_mode: "none", location_kind: "on_campus",
          });
          activityId = activity.id;
          await campusOperations(f).planning.publish(resourceLoanRequest(f.user), f.schoolId, activityId, command(1));
          expect(await expectedActivity(f)).toEqual([expect.objectContaining({ title: "Captured reading circle", expected_count: 1 })]);
          await sourceImport.import(f.user, f.schoolId, f.campusId, geojson);
          imageId = (
            await f.scenes.uploadImage(f.user, f.schoolId, f.campusId, {
              idempotency_key: randomUUID(),
              rights_confirmed: true,
              data_url: campusScenePng,
            })
          ).image.id;
          const document = campusSceneDocument(placeId);
          lampId = (await f.resources.createItem(f.user, f.schoolId, { command_id: randomUUID(), campus_id: f.campusId, name: "Captured garden lamp", asset_tag: `LAMP-${randomUUID().slice(0, 8)}` }, resourceLoanRequest(f.user))).id;
          document.elements.push({ id: "garden-lamp", kind: "fixture", label: "Garden lamp", asset_key: "lamp", holding_id: lampId, space_id: null, floor_id: null, geometry: { type: "point", points: [{ x: 220, y: 180 }] }, review_state: "reviewed" });
          document.source = {
            ...document.source,
            kind: "aerial_image",
            image_asset_id: imageId,
          };
          await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
            ...command(0),
            document,
          });
          await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
        });
        const snapshot = await store.capture(f.schoolId, f.now);
        for (const table of [
          "campus_visual_scenes",
          "campus_scene_revisions",
          "campus_scene_images",
          "campus_scene_import_runs",
        ])
          expect(snapshot.counts).toHaveProperty(table);
        expect(snapshot.counts.campus_scene_revisions).toBe(2);
        expect(snapshot.counts.campus_scene_images).toBe(1);
        expect(snapshot.counts.campus_scene_import_runs).toBe(1);
        await initializeSimulationResources(store.pool);
        const world = await openWorld(store, snapshot, f.schoolId);
        opened.push(world.database);
        namespaces.push(world.namespace);
        const sibling = await openWorld(store, snapshot, f.schoolId);
        opened.push(sibling.database);
        namespaces.push(sibling.namespace);
        await world.run(async () => {
          expect(await world.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "garden-lamp", state: "available" }] });
          const lamp = await world.database.selectFrom("campus_resource_holdings").selectAll().where("id", "=", lampId).executeTakeFirstOrThrow();
          const { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes } = lamp;
          await world.topology.updateAsset(f.user, f.schoolId, lampId, { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes, expected_revision: lamp.revision, state: "unavailable" }, resourceLoanRequest(f.user));
          expect(await world.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "garden-lamp", state: "unavailable" }] });
          expect(await expectedActivity(world)).toEqual([expect.objectContaining({ title: "Captured reading circle", expected_count: 1 })]);
          const cancelActivity = { ...command(2), reason: "Rehearse moving this activity" };
          await campusOperations(world).planning.cancel(resourceLoanRequest(f.user), f.schoolId, activityId, cancelActivity);
          await campusOperations(world).planning.cancel(resourceLoanRequest(f.user), f.schoolId, activityId, cancelActivity);
          expect(await expectedActivity(world)).toEqual([]);
          const initial = await world.scenes.published(
            f.borrower,
            f.schoolId,
            f.campusId,
          );
          expect(initial.scene).toMatchObject({
            version: 2,
            document: { name: "Fictional campus" },
          });
          expect(initial.places).toMatchObject([
            { id: placeId, name: "Fictional library" },
          ]);
          expect(JSON.stringify(initial)).not.toMatch(
            /PRIVATE|private.example|image_asset_id/,
          );
          expect(
            (
              await world.scenes.readImage(
                f.user,
                f.schoolId,
                f.campusId,
                imageId,
              )
            ).bytes.equals(
              Buffer.from(campusScenePng.split(",")[1]!, "base64"),
            ),
          ).toBe(true);
          const capturedImport = await world.importer.import(
            f.user,
            f.schoolId,
            f.campusId,
            geojson,
          );
          expect(capturedImport.document.elements[0]?.label).toBe(
            "Surveyed building",
          );
          expect(capturedImport.document.source.label).toBe(
            "Captured campus source",
          );
          const reopen = command(2);
          expect(
            await world.scenes.reopen(f.user, f.schoolId, f.campusId, reopen),
          ).toMatchObject({ revision: 3 });
          expect(
            await world.scenes.reopen(f.user, f.schoolId, f.campusId, reopen),
          ).toMatchObject({ revision: 3, replayed: true });
          const workspace = await world.scenes.workspace(
              f.user,
              f.schoolId,
              f.campusId,
            ),
            document = workspace.scene!.draft!;
          expect(document.source.image_asset_id).toBe(imageId);
          expect(document.source).not.toHaveProperty("notes");
          expect(document.elements[0]?.space_id).toBe(placeId);
          document.name = "Rehearsed campus";
          document.elements[0]!.geometry.points[0]!.x += 5;
          const save = { ...command(3), document };
          expect(
            await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save),
          ).toMatchObject({ revision: 4 });
          expect(
            await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, save),
          ).toMatchObject({ revision: 4, replayed: true });
          await expect(
            world.scenes.saveDraft(f.borrower, f.schoolId, f.campusId, {
              ...command(4),
              document,
            }),
          ).rejects.toThrow(/administrator/);
          expect(
            await world.scenes.publish(
              f.user,
              f.schoolId,
              f.campusId,
              command(4),
            ),
          ).toMatchObject({ version: 5 });
          const branchImage = await world.scenes.uploadImage(
            f.user,
            f.schoolId,
            f.campusId,
            {
              idempotency_key: randomUUID(),
              rights_confirmed: true,
              data_url: campusScenePng,
            },
          );
          expect(branchImage.image.id).not.toBe(imageId);
          const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValue(
              new Error("No Simulation network call is permitted"),
            );
          try {
            const tracing = await world.importer.import(
              f.user,
              f.schoolId,
              f.campusId,
              {
                kind: "image",
                idempotency_key: randomUUID(),
                image_asset_id: branchImage.image.id,
                label: "Branch plan",
                source_kind: "site_plan",
              },
            );
            expect(tracing.document.elements).toEqual([]);
            expect(tracing.document.source.notes).toContain(
              "No external image analysis",
            );
            await expect(
              world.importer.lookup(f.user, f.schoolId, f.campusId, {
                query: "Uncaptured campus",
                idempotency_key: randomUUID(),
              }),
            ).rejects.toThrow(/no captured match/);
            expect(fetch).not.toHaveBeenCalled();
            expect(
              (await world.resources.list(1, 20)).counts.effects,
            ).toMatchObject({ external_compute_call: 1, connector_call: 1 });
          } finally {
            fetch.mockRestore();
          }
          const evidence = (
            await sql<{
              namespace: string;
              count: number;
            }>`SELECT command.environment_namespace_id AS namespace,count(*)::int AS count FROM campus_scene_revisions receipt JOIN campus_model_commands command ON command.id=receipt.command_id WHERE receipt.scene_id=${f.campusId}::uuid AND receipt.revision>2 GROUP BY command.environment_namespace_id`.execute(
              world.database,
            )
          ).rows;
          expect(evidence).toEqual([{ namespace: world.namespace, count: 3 }]);
          expect(
            (await world.scenes.published(f.borrower, f.schoolId, f.campusId))
              .scene?.document.name,
          ).toBe("Rehearsed campus");
          const refresh = await world.database
            .selectFrom("event_outbox")
            .selectAll()
            .where("school_id", "=", f.schoolId)
            .where("event_type", "=", "campus_scenes.updated")
            .execute();
          expect(
            refresh.some(
              (event) =>
                (event.payload as { action?: string }).action === "published" &&
                event.audience_user_ids.includes(f.borrower.id),
            ),
          ).toBe(true);
          expect(
            JSON.stringify(refresh.map((event) => event.payload)),
          ).not.toMatch(/image_asset_id|notes|PRIVATE|private.example/);
          const importInput = {
            ...geojson,
            idempotency_key: randomUUID(),
            label: "Branch surveyed campus",
          };
          const imported = await world.importer.import(
            f.user,
            f.schoolId,
            f.campusId,
            importInput,
          );
          expect(
            await world.importer.import(
              f.user,
              f.schoolId,
              f.campusId,
              importInput,
            ),
          ).toEqual(imported);
          expect(
            imported.document.elements.every(
              (element) => element.review_state === "needs_review",
            ),
          ).toBe(true);
          imported.document.elements.forEach((element) => {
            element.review_state = "reviewed";
          });
          await world.scenes.reopen(f.user, f.schoolId, f.campusId, command(5));
          await world.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
            ...command(6),
            document: imported.document,
          });
          await world.scenes.publish(
            f.user,
            f.schoolId,
            f.campusId,
            command(7),
          );
          expect(
            (await world.scenes.published(f.borrower, f.schoolId, f.campusId))
              .scene,
          ).toMatchObject({
            version: 8,
            document: { name: "Branch surveyed campus" },
          });
          expect(
            (
              await sql<{
                count: number;
              }>`SELECT count(*)::int AS count FROM campus_scene_import_runs WHERE school_id=${f.schoolId}::uuid`.execute(
                world.database,
              )
            ).rows[0]?.count,
          ).toBe(4);
        });
        await sibling.run(async () => {
          expect(await sibling.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "garden-lamp", state: "available" }] });
          expect(await expectedActivity(sibling)).toEqual([expect.objectContaining({ title: "Captured reading circle", expected_count: 1 })]);
          expect(
            (await sibling.scenes.workspace(f.user, f.schoolId, f.campusId))
              .scene,
          ).toMatchObject({ revision: 2, draft: null });
          expect(
            (await sibling.scenes.published(f.borrower, f.schoolId, f.campusId))
              .scene?.document.name,
          ).toBe("Fictional campus");
          expect(
            (
              await sql<{
                count: number;
              }>`SELECT count(*)::int AS count FROM campus_scene_import_runs WHERE school_id=${f.schoolId}::uuid`.execute(
                sibling.database,
              )
            ).rows[0]?.count,
          ).toBe(1);
          expect(
            await sibling.database
              .selectFrom("campus_scene_images")
              .select("id")
              .where("school_id", "=", f.schoolId)
              .execute(),
          ).toHaveLength(1);
        });
        await f.run(async () => {
          expect(await f.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "garden-lamp", state: "available" }] });
          expect(await expectedActivity(f)).toEqual([expect.objectContaining({ title: "Captured reading circle", expected_count: 1 })]);
          expect(
            (await f.scenes.workspace(f.user, f.schoolId, f.campusId)).scene,
          ).toMatchObject({ revision: 2, draft: null });
          expect(
            (await f.scenes.published(f.borrower, f.schoolId, f.campusId)).scene
              ?.document.name,
          ).toBe("Fictional campus");
          expect(
            (
              await sql<{
                count: number;
              }>`SELECT count(*)::int AS count FROM campus_scene_import_runs WHERE school_id=${f.schoolId}::uuid`.execute(
                db,
              )
            ).rows[0]?.count,
          ).toBe(1);
          expect(
            await db
              .selectFrom("campus_scene_images")
              .select("id")
              .where("school_id", "=", f.schoolId)
              .execute(),
          ).toHaveLength(1);
        });
      } finally {
        for (const namespace of namespaces)
          unbindSimulationResources(namespace);
        await Promise.all(opened.map((database) => database.destroy()));
        await store.pool.end();
      }
    }, 120_000);
  },
);
