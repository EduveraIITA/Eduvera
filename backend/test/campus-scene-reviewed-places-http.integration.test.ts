import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { SceneDocument } from "../src/campus-scenes/campus-scenes.contracts.js";
import type { ReviewedPlaceMapping, ReviewedScenePlaces } from "../src/campus-scenes/reviewed-places.contracts.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { campusSceneDocument, createCampusSceneFixture } from "./campus-scenes.test-support.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true" && process.env.CAMPUS_PLACE_BATCH_HTTP_TEST_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/reviewed_place_http_unused_test";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
type Receipt = { revision: number; current_revision: number; document: SceneDocument; mappings: ReviewedPlaceMapping[]; replayed: boolean; published_version: number | null };
async function fixture() {
  const f = await createCampusSceneFixture(db), password = `Fictional-Reviewed-Places-${randomUUID()}!`;
  await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.user.id, f.borrower.id]).execute();
  const admin = app.session(), member = app.session(), anonymous = app.session();
  await admin.login(f.user.email, password, f.schoolId); await member.login(f.borrower.email, password, f.schoolId);
  const base = `/api/v1/schools/${f.schoolId}/campus-scenes/${f.campusId}`;
  const value: ReviewedScenePlaces = { idempotency_key: randomUUID(), expected_revision: 0, document: campusSceneDocument(),
    rows: [{ proposal_id: "library", element_ids: ["building-one"], action: "create", name: "Central library", kind: "library", code: "LIBRARY" }] };
  return { ...f, admin, member, anonymous, base, value };
}

describe.skipIf(!enabled)("reviewed place batch through the compiled ordinary application", () => {
  beforeAll(async () => { process.env.INVITATION_EMAIL_ENABLED = "false"; await app.start(source); }, 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); });

  it("takes an imported multipart layout into canonical places and a connected private draft in one action", async () => {
    const f = await fixture();
    const ring = (x: number) => [[x, 12], [x + 0.0001, 12], [x + 0.0001, 12.0001], [x, 12.0001], [x, 12]];
    const geojson = { type: "FeatureCollection", features: [
      { type: "Feature", id: "library", properties: { building: "yes", name: "Library wings" }, geometry: { type: "MultiPolygon", coordinates: [[ring(77)], [ring(77.0002)]] } },
      { type: "Feature", id: "green", properties: { landuse: "grass", name: "Central ground" }, geometry: { type: "Polygon", coordinates: [ring(77.0004)] } },
    ] };
    const imported = await f.admin.json<{ document: SceneDocument }>(`${f.base}/imports`, "POST", { kind: "geojson", idempotency_key: randomUUID(),
      text: JSON.stringify(geojson), label: "Licensed campus survey", attribution: "Fictional campus author, permission granted", rights_confirmed: true });
    const buildings = imported.document.elements.filter(element => element.kind === "building"), ground = imported.document.elements.find(element => element.kind === "surface")!;
    expect(buildings).toHaveLength(2); expect(buildings[0]!.source_feature_id).toBeTruthy();
    expect(buildings[0]!.source_feature_id).toBe(buildings[1]!.source_feature_id);
    expect((await f.admin.json<{ scene: unknown }>(`${f.base}/workspace`)).scene).toBeNull();
    const value: ReviewedScenePlaces = { idempotency_key: randomUUID(), expected_revision: 0, document: imported.document, rows: [
      { proposal_id: "library", element_ids: buildings.map(element => element.id), action: "create", name: "Central library", kind: "library", code: "LIBRARY" },
      { proposal_id: "sports", element_ids: [ground.id], action: "create", name: "Sports ground", kind: "sports_area", code: "SPORTS" },
    ] };
    const saved = await f.admin.json<Receipt>(`${f.base}/reviewed-places`, "POST", value);
    expect(saved).toMatchObject({ revision: 1, current_revision: 1, replayed: false, published_version: null });
    expect(saved.mappings).toHaveLength(2);
    expect(saved.document.elements.every(element => element.review_state === "needs_review")).toBe(true);
    expect(saved.document.elements.filter(element => element.kind === "building").map(element => element.space_id))
      .toEqual([saved.mappings[0]!.space_id, saved.mappings[0]!.space_id]);
    expect(await f.admin.json<Receipt>(`${f.base}/reviewed-places`, "POST", value)).toMatchObject({ replayed: true, revision: saved.revision, mappings: saved.mappings });
    expect((await f.member.json<{ scene: unknown }>(`${f.base}/published`)).scene).toBeNull();
    expect((await f.admin.request(`${f.base}/publish`, "POST", { expected_revision: saved.revision, idempotency_key: randomUUID() })).status).toBe(400);
  }, 60_000);

  it("enforces ordinary member, anonymous, CSRF, current-campus and strict payload boundaries", async () => {
    const f = await fixture();
    expect((await f.member.request(`${f.base}/reviewed-places`, "POST", f.value)).status).toBe(403);
    expect((await f.anonymous.request(`${f.base}/reviewed-places`, "POST", f.value)).status).toBe(401);
    expect((await f.admin.request(`${f.base}/reviewed-places`, "POST", f.value, false)).status).toBe(403);
    expect((await f.admin.request(`${f.base}/reviewed-places`, "POST", { ...f.value, grant_role: "principal" })).status).toBe(400);
    expect((await f.admin.request(`/api/v1/schools/${randomUUID()}/campus-scenes/${f.campusId}/reviewed-places`, "POST", f.value)).status).toBe(403);
    expect((await f.admin.request(`/api/v1/schools/${f.schoolId}/campus-scenes/${randomUUID()}/reviewed-places`, "POST", f.value)).status).toBe(404);
    expect((await f.admin.json<{ scene: unknown }>(`${f.base}/workspace`)).scene).toBeNull();
  });

  it("returns an editable code-conflict error and preserves historical retry without overwriting a later draft", async () => {
    const f = await fixture();
    await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Existing library", code: "LIBRARY", kind: "library" }, resourceLoanRequest(f.user));
    const rejected = await f.admin.request(`${f.base}/reviewed-places`, "POST", f.value);
    expect(rejected.status).toBe(409); expect(await rejected.json()).toMatchObject({ error: { code: "campus_place_code_conflict" } });
    expect((await f.admin.json<{ scene: unknown }>(`${f.base}/workspace`)).scene).toBeNull();
    const value = { ...f.value, idempotency_key: randomUUID(), rows: [{ ...f.value.rows[0]!, action: "create" as const, name: "East library", code: "LIBRARY-E", kind: "library" as const }] };
    const saved = await f.admin.json<Receipt>(`${f.base}/reviewed-places`, "POST", value);
    const later = await f.admin.json<Receipt>(`${f.base}/draft`, "PUT", { idempotency_key: randomUUID(), expected_revision: saved.revision,
      document: { ...saved.document, name: "Later draft" } });
    const replay = await f.admin.json<Receipt>(`${f.base}/reviewed-places`, "POST", value);
    expect(replay).toMatchObject({ revision: saved.revision, current_revision: later.revision, replayed: true, mappings: saved.mappings });
    expect((await f.admin.json<{ scene: { draft: SceneDocument } }>(`${f.base}/workspace`)).scene.draft.name).toBe("Later draft");
    expect((await f.admin.request(`${f.base}/reviewed-places`, "POST", { ...value, document: { ...value.document, name: "Changed body" } })).status).toBe(409);
  });

  it("denies a previously accepted batch replay after the administrator membership is downgraded", async () => {
    const f = await fixture();
    await f.admin.json<Receipt>(`${f.base}/reviewed-places`, "POST", f.value);
    await db.updateTable("school_memberships").set({ role: "staff" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
    expect((await f.admin.request(`${f.base}/reviewed-places`, "POST", f.value)).status).toBe(403);
  });
});
