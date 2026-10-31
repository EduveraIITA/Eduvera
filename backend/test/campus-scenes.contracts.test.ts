import { describe, expect, it } from "vitest";
import {
  assertPublishableScene,
  polygonIsSimple,
  publicSceneDocument,
  saveSceneDraftSchema,
  sceneDocumentSchema,
  scenePayloadHash,
  sceneResourceQuerySchema,
  uploadSceneImageSchema,
  type SceneDocument,
} from "../src/campus-scenes/campus-scenes.contracts.js";
import { decodeSceneImage } from "../src/campus-scenes/campus-scenes.images.js";
import { privacySafeCampusSceneRows } from "../src/campus-scenes/campus-scenes.snapshot.js";

const imageId = "53b1f22b-e5cc-4af1-855e-b254f9a27e3b";
function scene(): SceneDocument {
  return {
    schema_version: 1,
    name: "North campus",
    bounds: { width: 1000, height: 800, unit: "relative" },
    source: { kind: "manual", label: "Site map" },
    elements: [
      {
        id: "library",
        kind: "building",
        label: "Library",
        geometry: {
          type: "polygon",
          points: [
            { x: 10, y: 20 },
            { x: 70, y: 20 },
            { x: 70, y: 80 },
            { x: 40, y: 80 },
            { x: 40, y: 50 },
            { x: 10, y: 50 },
          ],
        },
        space_id: null,
        floor_id: null,
        levels: 3,
        asset_key: "library",
        roof: "flat",
        review_state: "reviewed",
      },
      {
        id: "walk",
        kind: "path",
        label: "Main path",
        geometry: {
          type: "polyline",
          points: [
            { x: 80, y: 20 },
            { x: 90, y: 80 },
          ],
        },
        space_id: null,
        floor_id: null,
        width: 4,
        review_state: "reviewed",
      },
      {
        id: "tree",
        kind: "tree",
        label: "Tree",
        geometry: { type: "point", points: [{ x: 70, y: 10 }] },
        space_id: null,
        floor_id: null,
        asset_key: "tree_broadleaf",
        review_state: "reviewed",
      },
    ],
  };
}
describe("campus scene geometry contract", () => {
  it("retains editable indoor assets, depth and rotation through save, publication, export and selected-world capture", () => {
    const document = scene();
    const indoorAssets = ["desk", "chair", "computer", "meeting_table", "cabinet", "server_rack", "printer", "fire_extinguisher", "first_aid", "toilet", "washbasin", "door", "window", "projector", "whiteboard"] as const;
    document.elements.push(...indoorAssets.map((asset_key, index) => ({
      id: `indoor-${index}`, kind: "fixture" as const, label: asset_key, asset_key,
      geometry: { type: "point" as const, points: [{ x: 100 + index * 10, y: 100 }] },
      width: 2, depth: .75, height: 1.1, rotation_deg: index % 2 ? -90 : 90,
      space_id: null, floor_id: null, review_state: "reviewed" as const,
    })));
    const expected = document.elements.slice(3);
    const saved = saveSceneDraftSchema.parse({ document, expected_revision: 2, idempotency_key: imageId });
    const published = publicSceneDocument(saved.document);
    expect(published.elements.slice(3)).toEqual(expected);
    expect(assertPublishableScene(published)).toBe(true);
    expect(sceneDocumentSchema.parse(JSON.parse(JSON.stringify(published))).elements.slice(3)).toEqual(expected);
    const captured = privacySafeCampusSceneRows("campus_scene_revisions", [{ document: saved.document }]) as { document: SceneDocument }[];
    expect(captured[0]!.document.elements.slice(3)).toEqual(expected);
    expect(expected.every(item => item.space_id === null && !item.holding_id && !item.navigation_connector)).toBe(true);
    expect(scenePayloadHash(published)).not.toBe(scenePayloadHash({ ...published, elements: published.elements.map(item => item.id === "indoor-0" ? { ...item, rotation_deg: 0 } : item) }));
    const legacy = sceneDocumentSchema.parse(scene()).elements[0]!;
    expect(legacy).not.toHaveProperty("depth");
    expect(legacy).not.toHaveProperty("rotation_deg");
  });
  it("rejects nonfinite and out-of-range indoor dimensions without accepting coerced values", () => {
    const document = scene();
    const fixture = { id: "desk", kind: "fixture", label: "Desk", asset_key: "desk", geometry: { type: "point", points: [{ x: 100, y: 100 }] }, space_id: null, floor_id: null, review_state: "reviewed" };
    const parse = (fields: Record<string, unknown>) => sceneDocumentSchema.safeParse({ ...document, elements: [fixture].map(item => ({ ...item, ...fields })) });
    for (const depth of [0, -.1, 10_000.01, Infinity, -Infinity, NaN, null, "1"]) expect(parse({ depth }).success).toBe(false);
    for (const rotation_deg of [-360.01, 360.01, Infinity, -Infinity, NaN, null, "90"]) expect(parse({ rotation_deg }).success).toBe(false);
    for (const rotation_deg of [-360, 0, 360]) expect(parse({ depth: 10_000, rotation_deg }).success).toBe(true);
    expect(parse({ depth: .001, rotation_deg: -22.5 }).success).toBe(true);
  });
  it("retains bounded document-local source grouping without creating a place link", () => {
    const document = scene();
    document.elements[0]!.source_feature_id = "geojson-feature-1";
    const parsed = sceneDocumentSchema.parse(document);
    expect(parsed.elements[0]).toMatchObject({ source_feature_id: "geojson-feature-1", space_id: null });
    document.elements[0]!.source_feature_id = "x".repeat(121);
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });
  it("keeps explicit indoor connector metadata through member publication and selected-world capture", () => {
    const document = scene(); document.elements[0]!.space_id = imageId;
    document.elements.push({ id: "lift", kind: "fixture", asset_key: "equipment", label: "East lift", space_id: null, floor_id: imageId, parent_element_id: "library", geometry: { type: "point", points: [{ x: 80, y: 80 }] }, review_state: "reviewed", navigation_connector: { kind: "lift", accessible: true, status: "open", from_floor_id: imageId, to_floor_id: "303db4a3-b866-4f70-8a2f-1cacd26a0001" } });
    const parsed = sceneDocumentSchema.parse(document);
    expect(publicSceneDocument(parsed).elements.at(-1)!.navigation_connector).toEqual(document.elements.at(-1)!.navigation_connector);
    const captured = privacySafeCampusSceneRows("campus_scene_revisions", [{ document: parsed }]) as { document: SceneDocument }[];
    expect(captured[0]!.document.elements.at(-1)!.navigation_connector).toEqual(document.elements.at(-1)!.navigation_connector);
    const lift = document.elements.at(-1)!;
    expect(sceneDocumentSchema.safeParse({ ...document, elements: [...document.elements.slice(0, -1), { ...lift, navigation_connector: { ...lift.navigation_connector!, kind: "stairs", accessible: true } }] }).success).toBe(false);
    expect(sceneDocumentSchema.safeParse({ ...document, elements: [...document.elements.slice(0, -1), { ...lift, navigation_connector: { ...lift.navigation_connector!, to_floor_id: imageId } }] }).success).toBe(false);
  });
  it("round-trips explicit reviewed walking metadata through publication and privacy-safe capture", () => {
    const document = scene();
    document.elements[1]!.navigation = { walkable: true, accessible: true, status: "closed", start_space_id: imageId, end_space_id: null };
    const parsed = sceneDocumentSchema.parse(document);
    expect(publicSceneDocument(parsed).elements[1]!.navigation).toEqual(document.elements[1]!.navigation);
    const captured = privacySafeCampusSceneRows("campus_scene_revisions", [{ document: parsed }]) as { document: SceneDocument }[];
    expect(captured[0]!.document.elements[1]!.navigation).toEqual(document.elements[1]!.navigation);
    expect(sceneDocumentSchema.parse(scene()).elements[1]).not.toHaveProperty("navigation");
  });
  it("rejects route metadata on roads, boundaries and invalid canonical identifiers", () => {
    const document = scene();
    document.elements[1]!.navigation = { walkable: true, accessible: false, status: "open", start_space_id: imageId, end_space_id: null };
    for (const change of [{ kind: "road" }, { asset_key: "boundary_wall" }, { navigation: { ...document.elements[1]!.navigation, start_space_id: "guess-library" } }, { navigation: { ...document.elements[1]!.navigation, accessibility_certified: true } }, { navigation: { ...document.elements[1]!.navigation, status: "unknown" } }]) {
      expect(sceneDocumentSchema.safeParse({ ...document, elements: [{ ...document.elements[1], ...change }] }).success).toBe(false);
    }
  });
  it("binds an exact resource to one fixture while preserving unbound editable assets", () => {
    const value = scene();
    const fixture: SceneDocument["elements"][number] = {
      id: "garden-lamp", label: "Garden lamp", kind: "fixture", asset_key: "lamp",
      geometry: { type: "point", points: [{ x: 90, y: 90 }] },
      space_id: null, floor_id: null, holding_id: imageId, review_state: "reviewed",
    };
    value.elements.push(fixture);
    const parsed = sceneDocumentSchema.parse(value);
    expect(publicSceneDocument(parsed).elements.at(-1)).toEqual(fixture);
    expect(assertPublishableScene(parsed)).toBe(true);
    value.elements.push({ ...fixture, id: "duplicate-lamp" });
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
    value.elements.pop();
    value.elements[0]!.holding_id = "63b1f22b-e5cc-4af1-855e-b254f9a27e3b";
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
    value.elements[0]!.holding_id = null;
    value.elements[value.elements.length - 1]!.holding_id = null;
    expect(sceneDocumentSchema.safeParse(value).success).toBe(true);
    value.elements[value.elements.length - 1]!.holding_id = "not-a-resource-id";
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
  });

  it("bounds resource lookup and rejects unrecognized query inputs", () => {
    expect(sceneResourceQuerySchema.parse({})).toEqual({ search: "", page: 1, tracking_mode: "individual" });
    expect(sceneResourceQuerySchema.parse({ search: "  Garden lamp  ", page: "2", holding_id: imageId }))
      .toEqual({ search: "Garden lamp", page: 2, holding_id: imageId, tracking_mode: "individual" });
    expect(sceneResourceQuerySchema.parse({ space_id: imageId, tracking_mode: "pooled" })).toEqual({ search: "", page: 1, space_id: imageId, tracking_mode: "pooled" });
    expect(sceneResourceQuerySchema.parse({ tracking_mode: "all" }).tracking_mode).toBe("all");
    for (const value of [{ page: "0" }, { page: "1.5" }, { page: "100001" }, { search: "x".repeat(81) },
      { holding_id: "not-a-resource-id" }, { space_id: "guessed-room" }, { tracking_mode: "private" }, { school_id: imageId }, { search: ["lamp", "tree"] }]) {
      expect(sceneResourceQuerySchema.safeParse(value).success).toBe(false);
    }
  });

  it("preserves editable planting varieties through parsing and publication", () => {
    const value = scene();
    value.elements = ["tree_conifer", "tree_columnar", "shrub"].map((asset, index) => ({
      ...value.elements[2]!, id: `plant-${index}`, asset_key: asset as SceneDocument["elements"][number]["asset_key"],
      width: 4 + index, height: 2 + index,
    }));
    value.elements.push({
      ...scene().elements[0]!, id: "flowers", kind: "surface", asset_key: "flower_bed",
    });
    const parsed = sceneDocumentSchema.parse(value);
    expect(publicSceneDocument(parsed).elements).toEqual(value.elements);
    expect(assertPublishableScene(parsed)).toBe(true);
  });

  it("retains boundary wall thickness and height while requiring path geometry", () => {
    const value = scene();
    value.elements[1] = {
      ...value.elements[1]!, asset_key: "boundary_wall", width: 2, height: 12,
    };
    expect(sceneDocumentSchema.parse(value).elements[1]).toMatchObject({
      kind: "path", asset_key: "boundary_wall", width: 2, height: 12,
    });
    value.elements[1].geometry.type = "polygon";
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
    value.elements[1].geometry.type = "polyline";
    value.elements[1].height = 0;
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
    value.elements[1].height = 12;
    value.elements[1].width = -1;
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
  });

  it("accepts one shared reviewed shape contract for irregular footprints, paths and fixtures", () => {
    const value = sceneDocumentSchema.parse(scene());
    expect(value.elements[0]!.geometry.points).toHaveLength(6);
    expect(assertPublishableScene(value)).toBe(true);
    const imported = scene();
    imported.source = {
      kind: "aerial_image",
      label: "Approved source",
      image_asset_id: imageId,
      provider: "vision",
      generated_at: "2026-10-25T08:00:00Z",
    };
    imported.elements[0]!.review_state = "needs_review";
    expect(sceneDocumentSchema.parse(imported).elements).toHaveLength(3);
    expect(assertPublishableScene(imported)).toBe(false);
  });
  it("rejects crossing and zero-area footprints while preserving a concave footprint", () => {
    expect(polygonIsSimple(scene().elements[0]!.geometry.points)).toBe(true);
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBe(false);
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBe(false);
    const value = scene();
    value.elements[0]!.geometry.points.push(
      value.elements[0]!.geometry.points[0]!,
    );
    expect(sceneDocumentSchema.safeParse(value).success).toBe(false);
  });
  it("rejects out-of-campus geometry, duplicate IDs and the wrong primitive", () => {
    const outside = scene();
    outside.elements[0]!.geometry.points[0]!.x = 1001;
    expect(sceneDocumentSchema.safeParse(outside).success).toBe(false);
    const duplicate = scene();
    duplicate.elements[1]!.id = "library";
    expect(sceneDocumentSchema.safeParse(duplicate).success).toBe(false);
    const wrong = scene();
    wrong.elements[1]!.geometry.type = "polygon";
    expect(sceneDocumentSchema.safeParse(wrong).success).toBe(false);
  });
  it("rejects missing/cyclic visual parents and source executable or unknown fields", () => {
    const missing = scene();
    missing.elements[0]!.parent_element_id = "missing";
    expect(sceneDocumentSchema.safeParse(missing).success).toBe(false);
    const cycle = scene();
    cycle.elements[0]!.parent_element_id = "walk";
    cycle.elements[1]!.parent_element_id = "library";
    expect(sceneDocumentSchema.safeParse(cycle).success).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({ ...scene(), script: "alert(1)" }).success,
    ).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({
        ...scene(),
        source: { ...scene().source, reference_url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({
        ...scene(),
        elements: [
          {
            ...scene().elements[0],
            asset_key: "https://untrusted.example/asset.js",
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("bounds vertex count and rejects empty publication", () => {
    const value = scene();
    value.elements = [];
    expect(sceneDocumentSchema.safeParse(value).success).toBe(true);
    expect(assertPublishableScene(value)).toBe(false);
    const oversized = scene();
    oversized.elements = Array.from({ length: 2001 }, (_, index) => ({
      ...scene().elements[2]!,
      id: `tree-${index}`,
    }));
    expect(sceneDocumentSchema.safeParse(oversized).success).toBe(false);
  });
  it("exposes only curated source provenance to connected members", () => {
    const value = scene();
    value.source = {
      kind: "open_map",
      label: "Private upload filename and details",
      reference_url: "https://private.example/campus",
      provider: "internal-provider",
      notes: "private notes",
      image_asset_id: imageId,
      attribution: "© OpenStreetMap contributors",
    };
    const result = publicSceneDocument(value);
    expect(result.source).toEqual({
      kind: "open_map",
      label: "Open map data",
      attribution: "© OpenStreetMap contributors",
    });
    expect(value.source.image_asset_id).toBe(imageId);
    expect(result.elements).toEqual(value.elements);
  });
  it("requires an explicit revision/idempotency key and rights assertion", () => {
    expect(
      saveSceneDraftSchema.safeParse({
        document: scene(),
        expected_revision: 0,
        idempotency_key: imageId,
      }).success,
    ).toBe(true);
    expect(
      saveSceneDraftSchema.safeParse({
        document: scene(),
        idempotency_key: imageId,
      }).success,
    ).toBe(false);
    expect(
      uploadSceneImageSchema.safeParse({
        idempotency_key: imageId,
        rights_confirmed: false,
        data_url: "data:image/png;base64,AAAA",
      }).success,
    ).toBe(false);
    expect(scenePayloadHash({ b: 2, a: { y: 1, x: 2 } })).toBe(
      scenePayloadHash({ a: { x: 2, y: 1 }, b: 2 }),
    );
  });
  it("captures geometry and stable IDs while removing private acquisition metadata", () => {
    const document = scene();
    document.source = {
      kind: "site_plan",
      label: "private.jpg",
      image_asset_id: imageId,
      provider: "private-provider",
      notes: "Private notes",
      reference_url: "https://private.example/source",
      attribution: "Licensed plan",
    };
    const record = {
      document,
      command_id: imageId,
      content_hash: "original-proof",
    };
    const captured = privacySafeCampusSceneRows("campus_scene_revisions", [
      record,
    ]) as Array<typeof record>;
    expect(captured[0]!.document.source).toEqual({
      kind: "site_plan",
      label: "Captured campus source",
      image_asset_id: imageId,
      attribution: "Licensed plan",
    });
    expect(captured[0]!.document.elements).toEqual(document.elements);
    expect(captured[0]!.content_hash).toBe("original-proof");
    const bytes = [{ bytes: "\\x001122", rights_confirmed: true, id: imageId }];
    expect(privacySafeCampusSceneRows("campus_scene_images", bytes)).toBe(
      bytes,
    );
    const imported = privacySafeCampusSceneRows("campus_scene_import_runs", [
      {
        result: { document, warnings: ["Review building count"] },
        error_message: null,
      },
    ]);
    expect(JSON.stringify(imported)).not.toMatch(
      /private.jpg|private-provider|private.example|Private notes/,
    );
  });
});

describe("private campus source images", () => {
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rWQAAAAASUVORK5CYII=";
  it("reads dimensions and digest from bounded raster bytes", () => {
    const image = decodeSceneImage(tinyPng);
    expect(image).toMatchObject({
      mime_type: "image/png",
      width: 1,
      height: 1,
      byte_size: 68,
    });
    expect(image.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects SVG, disguised data, invalid base64 and extreme dimensions", () => {
    expect(() =>
      decodeSceneImage("data:image/svg+xml;base64,PHN2Zy8+"),
    ).toThrow(/PNG, JPEG or WebP/);
    expect(() =>
      decodeSceneImage("data:image/png;base64,PGh0bWw+PC9odG1sPg=="),
    ).toThrow(/signature or dimensions/);
    expect(() => decodeSceneImage("data:image/png;base64,AAA")).toThrow(
      /valid source image/,
    );
    const bytes = Buffer.from(tinyPng.split(",")[1]!, "base64");
    bytes.writeUInt32BE(30_001, 16);
    expect(() =>
      decodeSceneImage(`data:image/png;base64,${bytes.toString("base64")}`),
    ).toThrow(/dimensions/);
  });
});
