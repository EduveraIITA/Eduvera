import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AuthUser, RequestWithContext } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { CampusScenesModel } from "../src/campus-scenes/campus-scenes.model.js";
import { CampusScenesService } from "../src/campus-scenes/campus-scenes.service.js";
import { scenePayloadHash, type SceneDocument } from "../src/campus-scenes/campus-scenes.contracts.js";
import type { ReviewedScenePlaces } from "../src/campus-scenes/reviewed-places.contracts.js";
import { campusSceneDocument, campusSceneServices } from "./campus-scenes.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/campus_place_batch_unused_test";
const target = process.env.CAMPUS_PLACE_BATCH_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 5 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as RequestWithContext;
type Place = { id: string; revision: number; campus_id: string; parent_space_id: string | null; name: string; code: string; kind: string; status: "active" | "inactive"; is_bookable: boolean; is_accessible: boolean; capacity: number | null };
function batch(document: SceneDocument = campusSceneDocument()): ReviewedScenePlaces {
  return { idempotency_key: randomUUID(), expected_revision: 0, document,
    rows: [{ proposal_id: "library", element_ids: ["building-one"], action: "create", name: "Central library", code: "LIBRARY", kind: "library" }] };
}
async function fixture() {
  const native = campusSceneServices(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `place-batch-${suffix}`, email: `place-batch-${suffix}@example.test`,
    password_hash: "isolated-founder-only", first_name: "Anita", last_name: "Founder", role: "admin", email_verified_at: new Date() })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(native.core).createForAccount(tx, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const campus = await native.topology.createCampus(user, schoolId, { name: "Aaranya campus", code: "MAIN", campus_type: "main", is_primary: true, timezone: "Asia/Kolkata" }, request(user));
  const place = async (name = "Existing hall", code = "HALL", kind = "building", parent: string | null = null) =>
    await native.topology.createSpace(user, schoolId, { create_campus_if_missing: true, idempotency_key: randomUUID(), campus_id: campus.id,
      name, code, kind, parent_space_id: parent }, request(user)) as Place;
  const save = (value: ReviewedScenePlaces) => native.scenes.saveReviewedPlaces(user, schoolId, campus.id, value, request(user));
  return { ...native, user, schoolId, campus, place, save };
}
async function counts(database: Kysely<Database>, schoolId: string) {
  return (await sql<Record<string, number>>`SELECT
    (SELECT count(*)::int FROM campus_spaces WHERE school_id=${schoolId}::uuid) AS places,
    (SELECT count(*)::int FROM campus_visual_scenes WHERE school_id=${schoolId}::uuid) AS scenes,
    (SELECT count(*)::int FROM campus_scene_revisions WHERE school_id=${schoolId}::uuid) AS scene_revisions,
    (SELECT count(*)::int FROM institution_setup_audits WHERE school_id=${schoolId}::uuid) AS setup_audits,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS events,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid) AS commands,
    (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands command ON command.id=outcome.command_id
      WHERE command.school_id=${schoolId}::uuid) AS outcomes`.execute(database)).rows[0]!;
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe.skipIf(!enabled)("atomic reviewed canonical places and scene links", () => {
  it("creates a floor and rooms together, binds visual interiors, and retries without a second floor", async () => {
    const f = await fixture(), building = await f.place("Science centre", "SCIENCE"), document = campusSceneDocument(building.id);
    expect((await f.scenes.workspace(f.user, f.schoolId, f.campus.id)).spaces.find(space => space.id === building.id))
      .toMatchObject({ id: building.id, revision: building.revision });
    document.elements.push({ ...structuredClone(document.elements[0]!), id: "seminar", kind: "room", floor_id: null, space_id: null, parent_element_id: "building-one", review_state: "needs_review" },
      { id: "seminar-door", kind: "fixture", asset_key: "door", label: "Seminar door", floor_id: null, space_id: null,
        parent_element_id: "building-one", geometry: { type: "point", points: [{ x: 150, y: 150 }] }, review_state: "needs_review" });
    const value: ReviewedScenePlaces = { ...batch(document), rows: [
      { proposal_id: "seminar", action: "create", element_ids: ["seminar"], name: "Seminar room", code: "S101", kind: "classroom", parent_proposal_id: "ground" },
      { proposal_id: "ground", action: "create", element_ids: [], floor_element_ids: ["seminar", "seminar-door"], name: "Ground floor", code: "SCIENCE-G", kind: "floor",
        parent_space_id: building.id, expected_parent_revision: building.revision },
    ] };
    const saved = await f.save(value), room = saved.mappings[0]!, floor = saved.mappings[1]!;
    expect(saved.mappings.map(mapping => mapping.proposal_id)).toEqual(["seminar", "ground"]);
    expect(floor.element_ids).toEqual([]);
    expect(await db.selectFrom("campus_spaces").select(["kind", "parent_space_id"]).where("id", "=", floor.space_id).executeTakeFirstOrThrow())
      .toEqual({ kind: "floor", parent_space_id: building.id });
    expect(await db.selectFrom("campus_spaces").select("parent_space_id").where("id", "=", room.space_id).executeTakeFirstOrThrow())
      .toEqual({ parent_space_id: floor.space_id });
    expect(saved.document.elements.filter(element => ["seminar", "seminar-door"].includes(element.id)).map(element => element.floor_id))
      .toEqual([floor.space_id, floor.space_id]);
    expect(saved.document.elements.find(element => element.id === "seminar")?.review_state).toBe("needs_review");
    const after = await counts(db, f.schoolId);
    expect((await f.save(value)).mappings).toEqual(saved.mappings);
    expect(await counts(db, f.schoolId)).toEqual(after);
  });
  it("rolls back a new floor if its later room conflicts and refuses to reinterpret a building as an existing floor", async () => {
    const f = await fixture(), building = await f.place("Science centre", "SCIENCE"), document = campusSceneDocument(building.id);
    await f.place("Existing room", "TAKEN", "office", building.id);
    document.elements.push({ ...structuredClone(document.elements[0]!), id: "new-room", kind: "room", floor_id: null, space_id: null, parent_element_id: "building-one" });
    const value: ReviewedScenePlaces = { ...batch(document), rows: [
      { proposal_id: "ground", action: "create", element_ids: [], floor_element_ids: ["new-room"], name: "Ground floor", code: "SCIENCE-G", kind: "floor", parent_space_id: building.id, expected_parent_revision: building.revision },
      { proposal_id: "room", action: "create", element_ids: ["new-room"], name: "New room", code: "TAKEN", kind: "classroom", parent_proposal_id: "ground" },
    ] };
    const before = await counts(db, f.schoolId);
    await expect(f.save(value)).rejects.toThrow(/code already exists/);
    expect(await counts(db, f.schoolId)).toEqual(before);
    await expect(f.save({ ...value, rows: [{ proposal_id: "floor", action: "reuse", element_ids: [], floor_element_ids: ["new-room"], space_id: building.id, expected_space_revision: building.revision }] }))
      .rejects.toThrow(/canonical floor/);
    expect(await counts(db, f.schoolId)).toEqual(before);
  });
  it("creates useful places once, explicitly groups multipart drawings, reuses an exact place and retains source review states", async () => {
    const f = await fixture(), existing = await f.place("Research centre", "RESEARCH"), document = campusSceneDocument();
    document.elements[0]!.review_state = "needs_review";
    document.elements[0]!.source_feature_id = "osm:relation:central-library";
    document.elements.push({ ...structuredClone(document.elements[0]!), id: "library-wing" },
      { ...structuredClone(document.elements[0]!), id: "research" },
      { id: "main-gate", kind: "fixture", asset_key: "gate", label: "Main gate", space_id: null, floor_id: null,
        geometry: { type: "point", points: [{ x: 200, y: 200 }] }, review_state: "needs_review" },
      { ...structuredClone(document.elements[0]!), id: "sports", kind: "surface", asset_key: "sports", review_state: "needs_review" });
    const value = batch(document); value.rows[0]!.element_ids.push("library-wing");
    value.rows.push({ proposal_id: "research", action: "reuse", element_ids: ["research"], space_id: existing.id, expected_space_revision: existing.revision },
      { proposal_id: "gate", action: "create", element_ids: ["main-gate"], name: "Main entrance", kind: "gate", code: "GATE" },
      { proposal_id: "sports", action: "create", element_ids: ["sports"], name: "Sports ground", kind: "sports_area", code: "SPORTS" });
    const saved = await f.save(value), library = saved.mappings[0]!;
    expect(saved).toMatchObject({ revision: 1, current_revision: 1, published_version: null, replayed: false });
    expect(saved.document.elements.filter(element => library.element_ids.includes(element.id)).map(element => element.space_id)).toEqual([library.space_id, library.space_id]);
    expect(saved.document.elements.map(element => element.review_state)).toEqual(value.document.elements.map(element => element.review_state));
    expect(saved.document.elements.filter(element => element.id === "building-one" || element.id === "library-wing").map(element => element.source_feature_id))
      .toEqual(["osm:relation:central-library", "osm:relation:central-library"]);
    const command = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId)
      .where("idempotency_key", "=", `campus-scenes:${f.user.id}:${value.idempotency_key}`).executeTakeFirstOrThrow();
    const contentHash = (await sql<{ hash: string }>`SELECT encode(sha256(convert_to(${JSON.stringify(saved.document)}::jsonb::text,'UTF8')),'hex') AS hash`.execute(db)).rows[0]!.hash;
    expect(command.safe_context).toMatchObject({ content_hash: contentHash, reviewed_places_request_hash: scenePayloadHash({ school_id: f.schoolId, campus_id: f.campus.id, input: value }) });
    expect((await f.scenes.published(f.user, f.schoolId, f.campus.id)).scene).toBeNull();
    const created = await db.selectFrom("campus_spaces").select(["id", "is_bookable", "is_accessible", "capacity"]).where("id", "=", library.space_id).executeTakeFirstOrThrow();
    expect(created).toMatchObject({ is_bookable: false, is_accessible: false, capacity: null });
    expect(await db.selectFrom("campus_spaces").select(["name", "revision"]).where("id", "=", existing.id).executeTakeFirstOrThrow())
      .toEqual({ name: "Research centre", revision: existing.revision });
    expect((await counts(db, f.schoolId)).places).toBe(4);
  });

  it("returns the original exact accepted receipt after a later draft edit without overwriting current state", async () => {
    const f = await fixture(), value = batch(), saved = await f.save(value), before = await counts(db, f.schoolId);
    const repeated = await f.save(value);
    expect(repeated).toMatchObject({ replayed: true, revision: saved.revision, current_revision: saved.revision, mappings: saved.mappings });
    expect(await counts(db, f.schoolId)).toEqual(before);
    const laterDocument = { ...saved.document, name: "Later reviewed arrangement" };
    const later = await f.scenes.saveDraft(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: saved.revision, document: laterDocument });
    const replay = await f.save(value);
    expect(replay).toMatchObject({ replayed: true, revision: saved.revision, current_revision: later.revision, mappings: saved.mappings });
    expect((await f.scenes.workspace(f.user, f.schoolId, f.campus.id)).scene?.draft?.name).toBe(laterDocument.name);
    const after = await counts(db, f.schoolId);
    await expect(f.save({ ...value, rows: [{ ...value.rows[0]!, action: "create", name: "Changed request", kind: "library", code: "LIBRARY" }] })).rejects.toThrow(/different/);
    expect(await counts(db, f.schoolId)).toEqual(after);
  });

  it("rolls back earlier places, Core evidence, audit and outbox if a later native code conflicts", async () => {
    const f = await fixture(); await f.place("Existing library", "TAKEN");
    const value = batch(); value.document.elements.push({ ...structuredClone(value.document.elements[0]!), id: "second" });
    value.rows.push({ proposal_id: "second", element_ids: ["second"], action: "create", name: "Second building", code: "TAKEN", kind: "building" });
    const before = await counts(db, f.schoolId);
    await expect(f.save(value)).rejects.toThrow(/code already exists/);
    expect(await counts(db, f.schoolId)).toEqual(before);
    expect(await db.selectFrom("campus_spaces").select("id").where("school_id", "=", f.schoolId).where("code", "=", "LIBRARY").execute()).toEqual([]);
  });

  it("rolls back every place and its accepted Core/audit/outbox evidence if the final Scene Core completion fails", async () => {
    const f = await fixture(), model = new CampusScenesModel(f.core, f.core, f.core), scenes = new CampusScenesService(db, model, f.core, f.topology);
    const value = batch(); value.document.elements.push({ ...structuredClone(value.document.elements[0]!), id: "second-building" });
    value.rows.push({ proposal_id: "second", element_ids: ["second-building"], action: "create", name: "Computing centre", code: "COMPUTING", kind: "building" });
    const before = await counts(db, f.schoolId);
    const finish = vi.spyOn(model, "finish").mockImplementationOnce(async tx => {
      const inFlight = await counts(tx, f.schoolId);
      expect(inFlight.places).toBe(before.places! + 2);
      expect(inFlight.outcomes).toBe(before.outcomes! + 2);
      throw new Error("isolated-injected-scene-Core-completion-failure");
    });
    try {
      await expect(scenes.saveReviewedPlaces(f.user, f.schoolId, f.campus.id, value, request(f.user))).rejects.toThrow("isolated-injected-scene-Core-completion-failure");
      expect(finish).toHaveBeenCalledOnce();
      expect(await counts(db, f.schoolId)).toEqual(before);
      expect(await db.selectFrom("campus_spaces").select("id").where("school_id", "=", f.schoolId).where("code", "in", ["LIBRARY", "COMPUTING"]).execute()).toEqual([]);
    } finally { finish.mockRestore(); }
  });

  it("checks the exact scene revision before creating anything and leaves geometry review for normal publication", async () => {
    const f = await fixture(), value = batch(); value.document.elements[0]!.review_state = "needs_review";
    await f.scenes.saveDraft(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: 0, document: value.document });
    const before = await counts(db, f.schoolId);
    await expect(f.save(value)).rejects.toThrow(/scene changed/);
    expect(await counts(db, f.schoolId)).toEqual(before);
    const saved = await f.save({ ...value, expected_revision: 1 });
    await expect(f.scenes.publish(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: saved.revision })).rejects.toThrow(/Review every/);
  });

  it("accepts only exact current same-campus reuse and parent revisions without editing the reused record", async () => {
    const f = await fixture(), existing = await f.place(), foreign = await fixture(), other = await foreign.place();
    for (const candidate of [{ space_id: existing.id, expected_space_revision: existing.revision + 1 }, { space_id: other.id, expected_space_revision: other.revision }]) {
      const before = await counts(db, f.schoolId), value = batch();
      value.rows = [{ proposal_id: "reuse", element_ids: ["building-one"], action: "reuse", ...candidate }];
      await expect(f.save(value)).rejects.toThrow(/changed or is unavailable/);
      expect(await counts(db, f.schoolId)).toEqual(before);
    }
    const value = batch(); value.document.elements[0]!.kind = "room";
    value.rows = [{ proposal_id: "room", element_ids: ["building-one"], action: "create", name: "Seminar room", kind: "classroom", code: "S101",
      parent_space_id: existing.id, expected_parent_revision: existing.revision }];
    const saved = await f.save(value);
    expect(await db.selectFrom("campus_spaces").select("parent_space_id").where("id", "=", saved.mappings[0]!.space_id).executeTakeFirstOrThrow())
      .toEqual({ parent_space_id: existing.id });
    expect(await db.selectFrom("campus_spaces").select("id").where("school_id", "=", f.schoolId).where("kind", "=", "floor").execute()).toEqual([]);
  });

  it("rejects changed or inactive parent references, inactive reuse and conflicting existing scene links", async () => {
    const f = await fixture(), existing = await f.place(), alternate = await f.place("Another hall", "OTHER");
    const initial = await f.scenes.saveDraft(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: 0, document: campusSceneDocument(existing.id) });
    const before = await counts(db, f.schoolId), value = batch(initial.document); value.expected_revision = initial.revision;
    value.rows = [{ proposal_id: "replace", element_ids: ["building-one"], action: "reuse", space_id: alternate.id, expected_space_revision: alternate.revision }];
    await expect(f.save(value)).rejects.toThrow(/already connected/);
    const replacement = structuredClone(value); replacement.rows = [{ proposal_id: "replace", element_ids: ["building-one"], action: "create", name: "Replacement", kind: "building", code: "REPLACE" }];
    await expect(f.save(replacement)).rejects.toThrow(/already connected/);
    expect(await counts(db, f.schoolId)).toEqual(before);
    const newOutline = { ...structuredClone(value.document.elements[0]!), id: "new-room", kind: "room" as const };
    const parentTest = batch(initial.document); parentTest.expected_revision = initial.revision; parentTest.document.elements.push(newOutline);
    parentTest.rows = [{ proposal_id: "room", element_ids: [newOutline.id], action: "create", name: "New room", kind: "classroom", code: "R1",
      parent_space_id: alternate.id, expected_parent_revision: alternate.revision + 1 }];
    await expect(f.save(parentTest)).rejects.toThrow(/parent place changed/);
    const updated = await f.topology.updateSpace(f.user, f.schoolId, alternate.id, { campus_id: f.campus.id, name: alternate.name, code: alternate.code,
      kind: alternate.kind, expected_revision: alternate.revision, status: "inactive" }, request(f.user));
    parentTest.rows[0] = { ...parentTest.rows[0]!, action: "create", name: "New room", kind: "classroom", code: "R1", expected_parent_revision: updated.revision };
    await expect(f.save(parentTest)).rejects.toThrow(/parent place changed/);
  });

  it("rechecks the actor, exact institution, current identity and namespace before effects or historical replay", async () => {
    const f = await fixture(), value = batch(); await f.save(value);
    const foreign = await fixture(), before = await counts(db, f.schoolId);
    await expect(f.scenes.saveReviewedPlaces({ ...f.user, active_school_id: foreign.schoolId }, f.schoolId, f.campus.id, value, request(f.user))).rejects.toThrow(/current world/);
    const environment = simulationRequestEnvironment({ institution_id: foreign.schoolId, scenario_id: randomUUID(), run_id: randomUUID(), virtual_now: new Date().toISOString(),
      source_snapshot_ref: "sha256:isolated", manifest_ref: "reviewed-place-scope", checked_at: new Date().toISOString() });
    await expect(executionEnvironmentStorage.run(environment, () => f.save(value))).rejects.toThrow(/current world/);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
    await expect(f.save(value)).rejects.toThrow(/administrator/);
    expect(await counts(db, f.schoolId)).toEqual(before);
  });

  it("serializes simultaneous exact retries into one set of native effects", async () => {
    const f = await fixture(), value = batch();
    const results = await Promise.all([f.save(value), f.save(value)]);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].mappings).toEqual(results[1].mappings);
    expect((await counts(db, f.schoolId)).places).toBe(1);
  });

  it("allows one winner when different batch keys compete for the same scene revision without loser effects", async () => {
    const f = await fixture(), first = batch(), second = batch(), before = await counts(db, f.schoolId);
    const outcomes = await Promise.allSettled([f.save(first), f.save(second)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    expect(rejected?.status === "rejected" ? (rejected.reason as Error).message : "").toMatch(/scene changed/);
    const after = await counts(db, f.schoolId);
    expect(after.places).toBe(before.places! + 1); expect(after.scene_revisions).toBe(before.scene_revisions! + 1);
    expect(after.commands).toBe(before.commands! + 2); expect(after.outcomes).toBe(before.outcomes! + 2);
  });

  it("saves an explicitly replaced local layout while retaining old canonical places and the current publication", async () => {
    const f = await fixture(), existing = await f.place("Retained old library", "OLDLIB");
    const initial = await f.scenes.saveDraft(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: 0, document: campusSceneDocument(existing.id) });
    const published = await f.scenes.publish(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: initial.revision });
    const reopened = await f.scenes.reopen(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: published.revision });
    const replacement = batch(); replacement.expected_revision = reopened.revision;
    replacement.document.elements[0]!.id = "new-imported-outline";
    replacement.document.elements[0]!.review_state = "needs_review";
    replacement.rows[0]!.element_ids = ["new-imported-outline"];
    const saved = await f.save(replacement);
    expect(saved.document.elements[0]!.space_id).not.toBe(existing.id);
    expect(await db.selectFrom("campus_spaces").select(["id", "name", "revision"]).where("id", "=", existing.id).executeTakeFirstOrThrow())
      .toEqual({ id: existing.id, name: existing.name, revision: existing.revision });
    expect((await f.scenes.published(f.user, f.schoolId, f.campus.id)).scene?.version).toBe(published.revision);
    expect((await f.scenes.published(f.user, f.schoolId, f.campus.id)).scene?.document.elements[0]?.space_id).toBe(existing.id);
  });

  it("rechecks a historical replay after waiting for the scene lock when membership was revoked during the wait", async () => {
    const f = await fixture(), value = batch(); await f.save(value);
    const sceneLocked = deferred(), release = deferred(), schoolLocked = deferred();
    const held = db.transaction().execute(async tx => { await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`campus-scene:${f.schoolId}:${f.campus.id}`},0))`.execute(tx);
      sceneLocked.resolve(); await release.promise; });
    const original = f.topology.lockPlaceCreationContext.bind(f.topology);
    vi.spyOn(f.topology, "lockPlaceCreationContext").mockImplementation(async (...args) => { const result = await original(...args); schoolLocked.resolve(); return result; });
    try {
      await sceneLocked.promise;
      const replay = f.save(value);
      await schoolLocked.promise;
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
      release.resolve(); await held;
      await expect(replay).rejects.toThrow(/administrator/);
    } finally { release.resolve(); await held; vi.restoreAllMocks(); }
  }, 15_000);

  it("accepts the bounded 500-place, 2,000-outline reviewed set without dividing the transaction", async () => {
    const f = await fixture(), first = campusSceneDocument().elements[0]!, document = campusSceneDocument();
    document.elements = [];
    const value = batch(document); value.rows = [];
    for (let group = 0; group < 500; group++) {
      const ids = Array.from({ length: 4 }, (_, part) => `group-${group}-part-${part}`);
      document.elements.push(...ids.map(id => ({ ...structuredClone(first), id, source_feature_id: `source-group-${group}`, review_state: "needs_review" as const })));
      value.rows.push({ proposal_id: `group-${group}`, element_ids: ids, action: "create", name: `Building ${group + 1}`, code: `BLDG-${group + 1}`, kind: "building" });
    }
    const saved = await f.save(value);
    expect(saved.mappings).toHaveLength(500); expect(saved.document.elements).toHaveLength(2000);
    expect((await counts(db, f.schoolId)).places).toBe(500);
    expect(saved.published_version).toBeNull();
    expect(new Set(saved.mappings.map(mapping => mapping.space_id)).size).toBe(500);
  }, 120_000);

  it.each(["draft", "publish"] as const)("does not deadlock with an ordinary scene %s holding the scene lock", async action => {
    const f = await fixture(), model = new CampusScenesModel(f.core, f.core, f.core), normal = new CampusScenesService(db, model, f.core, f.topology);
    let revision = 0;
    if (action === "publish") revision = (await f.scenes.saveDraft(f.user, f.schoolId, f.campus.id,
      { idempotency_key: randomUUID(), expected_revision: 0, document: campusSceneDocument() })).revision;
    const sceneLocked = deferred(), release = deferred(), schoolLocked = deferred();
    const originalPrepare = model.prepare.bind(model), originalContext = f.topology.lockPlaceCreationContext.bind(f.topology);
    vi.spyOn(model, "prepare").mockImplementation(async (...args) => { sceneLocked.resolve(); await release.promise; return originalPrepare(...args); });
    vi.spyOn(f.topology, "lockPlaceCreationContext").mockImplementation(async (...args) => { const result = await originalContext(...args); schoolLocked.resolve(); return result; });
    const change = action === "publish" ? normal.publish(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: revision })
      : normal.saveDraft(f.user, f.schoolId, f.campus.id, { idempotency_key: randomUUID(), expected_revision: revision, document: campusSceneDocument() });
    try {
      await sceneLocked.promise;
      const value = batch(); value.expected_revision = revision;
      const competing = f.save(value);
      await schoolLocked.promise; release.resolve();
      await expect(change).resolves.toHaveProperty("revision", revision + 1);
      await expect(competing).rejects.toThrow(/scene changed/);
      expect((await counts(db, f.schoolId)).places).toBe(0);
    } finally { release.resolve(); vi.restoreAllMocks(); }
  }, 15_000);

  it.runIf(Boolean(target))("creates/reuses the complete reviewed set in one native COW world with unchanged Live and sibling", async () => {
    const f = await fixture(), existing = await f.place(), before = await counts(db, f.schoolId), now = new Date().toISOString();
    const store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const native = campusSceneServices(database), environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "reviewed-place-native-COW", checked_at: now });
        return { ...native, database, namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const branch = await open(), sibling = await open(), value = batch();
      value.document.elements[0]!.source_feature_id = "source:campus-library";
      value.document.elements.push({ ...structuredClone(value.document.elements[0]!), id: "existing" });
      value.rows.push({ proposal_id: "existing", element_ids: ["existing"], action: "reuse", space_id: existing.id, expected_space_revision: existing.revision });
      await branch.run(async () => {
        const saved = await branch.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campus.id, value, request(f.user));
        expect(await branch.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campus.id, value, request(f.user)))
          .toMatchObject({ replayed: true, mappings: saved.mappings, revision: saved.revision });
        expect(saved.document.elements[0]!.source_feature_id).toBe("source:campus-library");
        expect((await branch.scenes.workspace(f.user, f.schoolId, f.campus.id)).scene?.draft).toEqual(saved.document);
        const nativeHash = (await sql<{ hash: string }>`SELECT encode(sha256(convert_to(${JSON.stringify(saved.document)}::jsonb::text,'UTF8')),'hex') AS hash`.execute(branch.database)).rows[0]!.hash;
        const sourceCommand = await branch.database.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId)
          .where("idempotency_key", "=", `campus-scenes:${f.user.id}:${value.idempotency_key}`).executeTakeFirstOrThrow();
        expect(sourceCommand.safe_context).toMatchObject({ content_hash: nativeHash,
          reviewed_places_request_hash: scenePayloadHash({ school_id: f.schoolId, campus_id: f.campus.id, input: value }) });
        expect((await counts(branch.database, f.schoolId)).places).toBe(before.places! + 1);
        const commands = await branch.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("school_id", "=", f.schoolId).where("environment_namespace_id", "=", branch.namespace).execute();
        expect(commands.length).toBe(before.commands! + 2); expect(commands.every(command => command.state === "accepted")).toBe(true);
      });
      expect(await counts(db, f.schoolId)).toEqual(before);
      await sibling.run(async () => { expect(await counts(sibling.database, f.schoolId)).toEqual(before); });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
