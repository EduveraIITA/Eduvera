import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { SceneDocument } from "../src/campus-scenes/campus-scenes.contracts.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { campusSceneDocument, campusScenePng, createCampusSceneFixture } from "./campus-scenes.test-support.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/campus_scenes_http_unused_test";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
const command = (expected_revision: number) => ({ expected_revision, idempotency_key: randomUUID() });
type Receipt = { revision: number; version?: number; replayed: boolean };
type Publication = { can_edit: boolean; scene: { version: number; document: SceneDocument } | null; places: Array<{ id: string; name: string }> };

describe.skipIf(!enabled)("Campus scenes through the ordinary authenticated app", () => {
  beforeAll(async () => { process.env.INVITATION_EMAIL_ENABLED = "false"; await app.start(source); }, 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); });

  it("keeps sources and drafts private while publishing a reviewed layout linked to the same canonical place", async () => {
    const f = await createCampusSceneFixture(db);
    const password = `Fictional-Campus-${randomUUID()}!`;
    await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.user.id, f.borrower.id]).execute();
    const building = await f.run(() => f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Library", code: "LIB", kind: "building" }, resourceLoanRequest(f.user)));
    const admin = app.session(), member = app.session(), anonymous = app.session();
    await admin.login(f.user.email, password, f.schoolId);
    await member.login(f.borrower.email, password, f.schoolId);
    const directory = `/api/v1/schools/${f.schoolId}/campus-scenes`;
    const base = `${directory}/${f.campusId}`;
    expect((await anonymous.request(directory)).status).toBe(401);
    expect(await member.json(directory)).toMatchObject({ can_edit: false, campuses: expect.arrayContaining([expect.objectContaining({ id: f.campusId })]) });
    expect(await member.json(`${base}/published`)).toMatchObject({ scene: null, places: [], can_edit: false });
    expect((await member.request(`${base}/workspace`)).status).toBe(403);
    expect((await member.request(`${base}/imports/capabilities`)).status).toBe(403);
    expect((await admin.request(`${directory}/not-a-campus/published`)).status).toBe(400);
    expect((await admin.request(`${directory}/${randomUUID()}/published`)).status).toBe(404);
    expect((await admin.request(`/api/v1/schools/${randomUUID()}/campus-scenes`)).status).toBe(403);

    const upload = { idempotency_key: randomUUID(), data_url: campusScenePng, rights_confirmed: true };
    expect((await member.request(`${base}/images`, "POST", upload)).status).toBe(403);
    expect((await admin.request(`${base}/images`, "POST", upload, false)).status).toBe(403);
    const uploaded = await admin.json<{ image: { id: string }; replayed: boolean }>(`${base}/images`, "POST", upload);
    expect(await admin.json(`${base}/images`, "POST", upload)).toMatchObject({ image: { id: uploaded.image.id }, replayed: true });
    const image = await admin.request(`${base}/images/${uploaded.image.id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toBe("private, no-store");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(campusScenePng.split(",")[1]!, "base64"));
    expect((await member.request(`${base}/images/${uploaded.image.id}`)).status).toBe(403);

    const document = campusSceneDocument(String(building.id));
    document.source = { ...document.source, image_asset_id: uploaded.image.id, provider: "PRIVATE image source" };
    const save = { ...command(0), document };
    expect((await member.request(`${base}/draft`, "PUT", save)).status).toBe(403);
    expect((await admin.request(`${base}/draft`, "PUT", save, false)).status).toBe(403);
    expect(await admin.json<Receipt>(`${base}/draft`, "PUT", save)).toMatchObject({ revision: 1, replayed: false });
    expect(await admin.json<Receipt>(`${base}/draft`, "PUT", save)).toMatchObject({ revision: 1, replayed: true });
    expect((await admin.request(`${base}/draft`, "PUT", { ...save, document: { ...document, name: "Different request" } })).status).toBe(409);
    expect((await admin.request(`${base}/draft`, "PUT", { ...command(0), document })).status).toBe(409);
    expect((await member.json<Publication>(`${base}/published`)).scene).toBeNull();
    const publish = command(1);
    expect((await member.request(`${base}/publish`, "POST", publish)).status).toBe(403);
    expect(await admin.json(`${base}/publish`, "POST", publish)).toMatchObject({ version: 2 });
    expect(await admin.json(`${base}/publish`, "POST", publish)).toMatchObject({ version: 2, replayed: true });
    const publicScene = await member.json<Publication>(`${base}/published`);
    expect(publicScene.scene?.document.elements[0]?.space_id).toBe(building.id);
    expect(publicScene.places).toContainEqual(expect.objectContaining({ id: building.id, name: "Library" }));
    expect(JSON.stringify(publicScene)).not.toMatch(/PRIVATE|private\.example|image_asset_id|provider|notes/);

    const reopen = command(2);
    expect(await admin.json(`${base}/reopen`, "POST", reopen)).toMatchObject({ revision: 3, published_version: 2 });
    expect(await admin.json(`${base}/reopen`, "POST", reopen)).toMatchObject({ revision: 3, replayed: true });
    expect(await admin.json(`${base}/draft`, "PUT", { ...command(3), document: { ...document, name: "Private next version" } })).toMatchObject({ revision: 4 });
    expect((await member.json<Publication>(`${base}/published`)).scene?.document.name).toBe("Fictional campus");
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.borrower.id).execute();
    expect((await member.request(`${base}/published`)).status).toBe(403);
  }, 90_000);

  it("admits a bounded local map proposal without bypassing review or source permissions", async () => {
    const f = await createCampusSceneFixture(db), password = `Fictional-Import-${randomUUID()}!`;
    await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.user.id, f.borrower.id]).execute();
    const admin = app.session(), member = app.session();
    await admin.login(f.user.email, password, f.schoolId);
    await member.login(f.borrower.email, password, f.schoolId);
    const base = `/api/v1/schools/${f.schoolId}/campus-scenes/${f.campusId}`;
    expect(await admin.json(`${base}/imports/capabilities`)).toMatchObject({ image_analysis: { available: false }, max_image_bytes: 4 * 1024 * 1024 });
    const geojson = { type: "FeatureCollection", features: [{ type: "Feature", properties: { building: "yes", name: "Survey building" }, geometry: { type: "Polygon", coordinates: [[[77, 12], [77.0002, 12], [77.0002, 12.0002], [77, 12.0002], [77, 12]]] } }] };
    const proposal = { kind: "geojson", idempotency_key: randomUUID(), text: JSON.stringify(geojson), label: "Fictional licensed survey", attribution: "Fictional survey author, permission granted", rights_confirmed: true };
    expect((await member.request(`${base}/imports`, "POST", proposal)).status).toBe(403);
    expect((await admin.request(`${base}/imports`, "POST", proposal, false)).status).toBe(403);
    expect((await admin.request(`${base}/imports`, "POST", { ...proposal, rights_confirmed: false })).status).toBe(400);
    expect((await admin.request(`${base}/imports`, "POST", { ...proposal, attribution: "" })).status).toBe(400);
    expect((await admin.request(`${base}/imports/lookup`, "POST", { query: "a", idempotency_key: randomUUID() })).status).toBe(400);
    const invalidMap = { ...proposal, idempotency_key: randomUUID(), text: "not JSON" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const failed = await admin.request(`${base}/imports`, "POST", invalidMap);
      expect(failed.status).toBe(400);
      // The ordinary global filter retains the terminal code and readable detail;
      // clients must recognize this canonical envelope as well as a raw exception.
      expect(await failed.json()).toMatchObject({ error: { status: 400, code: "campus_import_failed", detail: "Choose a valid GeoJSON FeatureCollection file." } });
    }
    const result = await admin.json<{ document: SceneDocument }>(`${base}/imports`, "POST", proposal);
    expect(await admin.json(`${base}/imports`, "POST", proposal)).toEqual(result);
    expect((await admin.request(`${base}/imports`, "POST", { ...proposal, label: "Changed source" })).status).toBe(409);
    expect(result.document.source.attribution).toBe(proposal.attribution);
    expect(result.document.elements).toHaveLength(1);
    expect(result.document.elements[0]).toMatchObject({ kind: "building", review_state: "needs_review", space_id: null });
    expect((await admin.json<{ scene: unknown }>(`${base}/workspace`)).scene).toBeNull();
    expect(await admin.json(`${base}/draft`, "PUT", { ...command(0), document: result.document })).toMatchObject({ revision: 1 });
    expect((await admin.request(`${base}/publish`, "POST", command(1))).status).toBe(400);
    expect((await member.json<Publication>(`${base}/published`)).scene).toBeNull();
    expect(await admin.json(`${base}/draft`, "PUT", { ...command(1), document: { ...result.document, elements: result.document.elements.map(element => ({ ...element, review_state: "reviewed" })) } })).toMatchObject({ revision: 2 });
    expect(await admin.json(`${base}/publish`, "POST", command(2))).toMatchObject({ version: 3 });
    expect((await member.json<Publication>(`${base}/published`)).scene?.document.source.attribution).toBe(proposal.attribution);
  }, 90_000);

  it("keeps inventory search administrative while exposing only published individual asset state to current members", async () => {
    const f = await createCampusSceneFixture(db), password = `Fictional-Fixtures-${randomUUID()}!`;
    await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.user.id, f.borrower.id]).execute();
    const otherCampus = await f.topology.createCampus(f.user, f.schoolId, {
      name: "Other fixture campus", code: "OTHER-FIXTURE", campus_type: "branch", timezone: "UTC",
    }, resourceLoanRequest(f.user));
    const replacement = await f.resources.createItem(f.user, f.schoolId, {
      command_id: randomUUID(), campus_id: f.campusId, name: "Replacement garden lamp", asset_tag: `LIGHT-${randomUUID().slice(0, 8)}`,
    }, resourceLoanRequest(f.user));
    const foreign = await f.resources.createItem(f.user, f.schoolId, {
      command_id: randomUUID(), campus_id: String(otherCampus.id), name: "Other campus lamp", asset_tag: `OTHER-${randomUUID().slice(0, 8)}`,
    }, resourceLoanRequest(f.user));
    const pooledType = await f.topology.createResourceType(f.user, f.schoolId, {
      code: "POOLED", name: "Pooled landscape materials", category: "other", tracking_mode: "pooled", unit_label: "units",
    }, resourceLoanRequest(f.user));
    const pooled = await f.topology.createAsset(f.user, f.schoolId, {
      campus_id: f.campusId, space_id: null, resource_type_id: pooledType.id, name: "Pooled supplies", quantity: 5, asset_tag: null, state: "available", notes: "",
    }, resourceLoanRequest(f.user));
    const admin = app.session(), member = app.session(), anonymous = app.session();
    await admin.login(f.user.email, password, f.schoolId);
    await member.login(f.borrower.email, password, f.schoolId);
    const directory = `/api/v1/schools/${f.schoolId}/campus-scenes`, base = `${directory}/${f.campusId}`;
    for (const route of ["resources", "resource-states"]) {
      expect((await anonymous.request(`${base}/${route}`)).status).toBe(401);
      expect((await member.request(`${base}/${route}`)).status).toBe(route==='resources'?403:200);
      expect((await admin.request(`${directory}/${randomUUID()}/${route}`)).status).toBe(404);
    }
    for (const query of ["page=0", "holding_id=invalid", "unknown=value"]) {
      expect((await admin.request(`${base}/resources?${query}`)).status).toBe(400);
    }
    const choices = await admin.json<{ items: Array<{ id: string }>; total: number }>(`${base}/resources`);
    expect(choices.total).toBe(2);
    expect(choices.items.map(item => item.id).sort()).toEqual([f.holdingId, replacement.id].sort());
    expect(await admin.json(`${base}/resources?search=NoMatchingResource&page=2&holding_id=${f.holdingId}`))
      .toMatchObject({ items: [], total: 0, page: 2, page_size: 20, selected: { id: f.holdingId } });
    expect(await admin.json(`${directory}/${otherCampus.id}/resources?holding_id=${f.holdingId}`))
      .toMatchObject({ total: 1, selected: null, items: [{ id: foreign.id }] });
    const document = campusSceneDocument();
    document.elements.push({
      id: "garden-lamp", label: "Garden lamp", kind: "fixture", asset_key: "lamp", holding_id: f.holdingId,
      space_id: null, floor_id: null, geometry: { type: "point", points: [{ x: 220, y: 180 }] }, review_state: "reviewed",
    });
    for (const holdingId of [randomUUID(), foreign.id, String(pooled.id)]) {
      const invalid = { ...document, elements: document.elements.map(element => element.kind === "fixture" ? { ...element, holding_id: holdingId } : element) };
      expect((await admin.request(`${base}/draft`, "PUT", { ...command(0), document: invalid })).status).toBe(400);
    }
    expect(await admin.json(`${base}/draft`, "PUT", { ...command(0), document })).toMatchObject({ revision: 1 });
    expect(await admin.json(`${base}/resource-states`)).toMatchObject({ items: [] });
    expect(await admin.json(`${base}/publish`, "POST", command(1))).toMatchObject({ version: 2 });
    expect(await admin.json(`${base}/resource-states`)).toMatchObject({ items: [{ element_id: "garden-lamp", holding_id: f.holdingId, state: "available" }] });
    const operations=`/api/v1/schools/${f.schoolId}/campus-view/operations?campus_id=${f.campusId}`;
    expect((await anonymous.request(operations)).status).toBe(401);
    expect((await member.request(`${operations}&person_id=${f.custodianPersonId}`)).status).toBe(400);
    expect((await member.request(`/api/v1/schools/${randomUUID()}/campus-view/operations?campus_id=${f.campusId}`)).status).toBe(403);
    const memberMap=await member.json<{assets:unknown[];activities:unknown[];publication:{version:number}|null}>(operations);
    expect(memberMap).toMatchObject({publication:{version:2},assets:[{holding_id:f.holdingId,reportable:true,native_state:'available',signal:{state:'unknown',open_reports:0},repairs:[]}]});
    expect(JSON.stringify(memberMap)).not.toMatch(/reporter_person_id|handler_person_id|problem|photos|PRIVATE/);
    expect((await member.json<Publication>(`${base}/published`)).scene?.document.elements.at(-1)?.holding_id).toBe(f.holdingId);

    const boundHolding = await db.selectFrom("campus_resource_holdings").select("resource_type_id").where("id", "=", f.holdingId).executeTakeFirstOrThrow();
    const boundType = await db.selectFrom("campus_resource_types").selectAll().where("id", "=", boundHolding.resource_type_id).executeTakeFirstOrThrow();
    const typeFields = { code: boundType.code, name: boundType.name, category: boundType.category, tracking_mode: boundType.tracking_mode, unit_label: boundType.unit_label };
    const inactiveType = await f.topology.updateResourceType(f.user, f.schoolId, boundType.id, {
      ...typeFields, is_active: false, expected_revision: boundType.revision,
    }, resourceLoanRequest(f.user));
    expect(await admin.json(`${base}/resource-states`)).toMatchObject({ items: [{ element_id: "garden-lamp", state: "unknown" }] });
    expect(await admin.json(`${base}/resources?holding_id=${f.holdingId}`)).toMatchObject({ total: 0, selected: null, items: [] });
    await admin.json(`${base}/reopen`, "POST", command(2));
    expect((await admin.request(`${base}/publish`, "POST", command(3))).status).toBe(400);
    await f.topology.updateResourceType(f.user, f.schoolId, boundType.id, {
      ...typeFields, is_active: true, expected_revision: inactiveType.revision,
    }, resourceLoanRequest(f.user));
    const nextDraft = { ...document, elements: document.elements.map(element => element.kind === "fixture" ? { ...element, id: "replacement-lamp", holding_id: replacement.id } : element) };
    await admin.json(`${base}/draft`, "PUT", { ...command(3), document: nextDraft });
    expect(await admin.json(`${base}/resource-states`)).toMatchObject({ items: [{ element_id: "garden-lamp", holding_id: f.holdingId }] });
    const current = await db.selectFrom("campus_resource_holdings").selectAll().where("id", "=", replacement.id).executeTakeFirstOrThrow();
    const { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes } = current;
    await f.topology.updateAsset(f.user, f.schoolId, replacement.id, {
      campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes, state: "retired", expected_revision: current.revision,
    }, resourceLoanRequest(f.user));
    expect(await admin.json(`${base}/resources?holding_id=${replacement.id}`)).toMatchObject({ total: 1, selected: null });
    expect((await admin.request(`${base}/publish`, "POST", command(4))).status).toBe(400);
    expect((await member.json<Publication>(`${base}/published`)).scene?.version).toBe(2);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
    for (const route of ["resources", "resource-states"]) expect((await admin.request(`${base}/${route}`)).status).toBe(403);
  }, 90_000);
});
