import { createHash } from "node:crypto";
import { z } from "zod";

export const sceneAssetKeys = [
  "generic",
  "academic",
  "library",
  "administration",
  "laboratory",
  "auditorium",
  "residence",
  "sports",
  "dining",
  "parking",
  "gate",
  "boundary_wall",
  "tree_broadleaf",
  "tree_palm",
  "tree_conifer",
  "tree_columnar",
  "shrub",
  "flower_bed",
  "bench",
  "lamp",
  "water",
  "grass",
  "paving",
  "water_point",
  "equipment",
  "desk",
  "chair",
  "computer",
  "meeting_table",
  "cabinet",
  "server_rack",
  "printer",
  "fire_extinguisher",
  "first_aid",
  "toilet",
  "washbasin",
  "door",
  "window",
  "projector",
  "whiteboard",
] as const;
export const sceneMaterials = [
  "neutral",
  "brick",
  "concrete",
  "glass",
  "wood",
  "metal",
  "grass",
  "sand",
  "water",
  "asphalt",
  "paving",
] as const;
export const sceneRoofs = ["flat", "gable", "hip"] as const;
export const sceneKinds = [
  "building",
  "room",
  "road",
  "path",
  "tree",
  "fixture",
  "surface",
] as const;
export const sceneSourceKinds = [
  "manual",
  "aerial_image",
  "site_plan",
  "name_search",
  "open_map",
] as const;
export const MAX_SCENE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_SCENE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const uuid = z.string().uuid();
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const pointSchema = z
  .object({
    x: z.number().finite().min(0).max(100_000),
    y: z.number().finite().min(0).max(100_000),
  })
  .strict();
export const sceneElementSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
    kind: z.enum(sceneKinds),
    label: boundedText(160),
    // Proposal grouping within this document only; never a canonical identity
    // or a cross-import match. One source feature can contain several outlines.
    source_feature_id: boundedText(120).optional(),
    geometry: z
      .object({
        type: z.enum(["polygon", "polyline", "point"]),
        points: z.array(pointSchema).min(1).max(500),
      })
      .strict(),
    space_id: uuid.nullable().default(null),
    floor_id: uuid.nullable().default(null),
    holding_id: uuid.nullable().optional(),
    parent_element_id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)
      .nullable()
      .optional(),
    asset_key: z.enum(sceneAssetKeys).optional(),
    width: z.number().finite().positive().max(10_000).optional(),
    // Editable visual footprint/orientation; neither creates an operational fact.
    depth: z.number().finite().positive().max(10_000).optional(),
    rotation_deg: z.number().finite().min(-360).max(360).optional(),
    height: z.number().finite().positive().max(10_000).optional(),
    levels: z.number().int().min(1).max(100).optional(),
    material: z.enum(sceneMaterials).optional(),
    roof: z.enum(sceneRoofs).optional(),
    navigation: z.object({
      walkable: z.literal(true),
      accessible: z.boolean(),
      status: z.enum(["open", "closed"]),
      start_space_id: uuid.nullable(),
      end_space_id: uuid.nullable(),
    }).strict().optional(),
    navigation_connector: z.object({
      kind: z.enum(["entrance", "stairs", "lift"]),
      status: z.enum(["open", "closed"]),
      accessible: z.boolean(),
      from_floor_id: uuid.nullable(),
      to_floor_id: uuid,
    }).strict().optional(),
    review_state: z.enum(["needs_review", "reviewed"]),
  })
  .strict();
export const sceneSourceSchema = z
  .object({
    kind: z.enum(sceneSourceKinds),
    label: boundedText(200),
    reference_url: z
      .string()
      .url()
      .max(2048)
      .refine(
        (value) => new URL(value).protocol === "https:",
        "Use an HTTPS source reference.",
      )
      .optional(),
    attribution: boundedText(500).optional(),
    image_asset_id: uuid.optional(),
    provider: boundedText(100).optional(),
    generated_at: z.string().datetime({ offset: true }).optional(),
    notes: boundedText(1000).optional(),
  })
  .strict();

export type ScenePoint = z.infer<typeof pointSchema>;
export type SceneElement = z.infer<typeof sceneElementSchema>;
function orientation(a: ScenePoint, b: ScenePoint, c: ScenePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function onSegment(a: ScenePoint, b: ScenePoint, p: ScenePoint) {
  return (
    Math.abs(orientation(a, b, p)) < 1e-8 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
function intersects(
  a: ScenePoint,
  b: ScenePoint,
  c: ScenePoint,
  d: ScenePoint,
) {
  const abC = orientation(a, b, c),
    abD = orientation(a, b, d),
    cdA = orientation(c, d, a),
    cdB = orientation(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
export function polygonIsSimple(points: ScenePoint[]) {
  if (points.length < 3) return false;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!,
      b = points[(index + 1) % points.length]!;
    if (a.x === b.x && a.y === b.y) return false;
    twiceArea += a.x * b.y - b.x * a.y;
    for (let other = index + 1; other < points.length; other++) {
      if (other === index + 1 || (index === 0 && other === points.length - 1))
        continue;
      if (
        intersects(a, b, points[other]!, points[(other + 1) % points.length]!)
      )
        return false;
    }
  }
  return Math.abs(twiceArea) > 1e-6;
}
export const sceneDocumentSchema = z
  .object({
    schema_version: z.literal(1),
    name: boundedText(160),
    bounds: z
      .object({
        width: z.number().finite().min(1).max(100_000),
        height: z.number().finite().min(1).max(100_000),
        unit: z.enum(["relative", "metres"]),
      })
      .strict(),
    source: sceneSourceSchema,
    elements: z.array(sceneElementSchema).max(2000),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>(), holdingIds = new Set<string>(),
      byId = new Map(document.elements.map((element) => [element.id, element]));
    const totalPoints = document.elements.reduce(
      (sum, element) => sum + element.geometry.points.length,
      0,
    );
    if (totalPoints > 20_000)
      context.addIssue({
        code: "custom",
        path: ["elements"],
        message: "Use no more than 20,000 map points.",
      });
    if (Buffer.byteLength(JSON.stringify(document)) > MAX_SCENE_DOCUMENT_BYTES)
      context.addIssue({
        code: "custom",
        message: "This scene exceeds the 2 MiB document limit.",
      });
    for (const [index, element] of document.elements.entries()) {
      const path = ["elements", index],
        issue = (field: string, message: string) =>
          context.addIssue({ code: "custom", path: [...path, field], message });
      if (ids.has(element.id))
        issue("id", "Every scene element needs a unique ID.");
      ids.add(element.id);
      if (element.holding_id) {
        if (element.kind !== "fixture") issue("holding_id", "Only a fixture can link to an individual resource.");
        if (holdingIds.has(element.holding_id)) issue("holding_id", "Link an individual resource to only one fixture in this scene.");
        holdingIds.add(element.holding_id);
      }
      const type = ["building", "room", "surface"].includes(element.kind)
        ? "polygon"
        : ["road", "path"].includes(element.kind)
          ? "polyline"
          : "point";
      if (element.geometry.type !== type)
        issue("geometry", `A ${element.kind} needs ${type} geometry.`);
      const points = element.geometry.points;
      const connector = element.navigation_connector;
      if (connector) {
        if (element.kind !== "fixture") issue("navigation_connector", "Only a point fixture can connect floors.");
        if (element.floor_id !== connector.from_floor_id) issue("floor_id", "A connector's displayed floor must match its starting floor.");
        if (connector.from_floor_id === connector.to_floor_id) issue("navigation_connector", "Connect two different floor contexts.");
        if ((connector.kind === "entrance") !== (connector.from_floor_id === null)) issue("navigation_connector", "Entrances connect outdoors to a floor; stairs and lifts connect two floors.");
        if (connector.kind === "stairs" && connector.accessible) issue("navigation_connector", "Stairs cannot be declared step-free.");
        const building = element.parent_element_id ? byId.get(element.parent_element_id) : undefined;
        if (building?.kind !== "building" || !building.space_id) issue("parent_element_id", "Choose a building linked to its canonical campus place for this connector.");
      }
      if (element.navigation && (element.kind !== "path" || element.asset_key === "boundary_wall"))
        issue("navigation", "Only a walking path can join the walking network; roads and boundaries cannot.");
      if (element.navigation && points.some((point, position) => position > 0 && point.x === points[position - 1]!.x && point.y === points[position - 1]!.y))
        issue("navigation", "Walking paths need distinct consecutive points.");
      if (
        (type === "point" && points.length !== 1) ||
        (type === "polyline" && points.length < 2) ||
        (type === "polygon" && points.length < 3)
      )
        issue("geometry", "This geometry has the wrong number of points.");
      if (
        points.some(
          (point) =>
            point.x > document.bounds.width || point.y > document.bounds.height,
        )
      )
        issue("geometry", "Keep every point inside the campus bounds.");
      if (
        type === "polygon" &&
        totalPoints <= 20_000 &&
        !polygonIsSimple(points)
      )
        issue(
          "geometry",
          "Use a non-crossing polygon with an area; omit the repeated closing point.",
        );
      if (
        type === "polyline" &&
        points.every(
          (point) => point.x === points[0]!.x && point.y === points[0]!.y,
        )
      )
        issue("geometry", "A path must connect different points.");
      if (element.parent_element_id) {
        const seen = new Set([element.id]);
        let parent: SceneElement | undefined = element;
        while (parent?.parent_element_id) {
          if (seen.has(parent.parent_element_id)) {
            issue("parent_element_id", "Scene parents cannot form a cycle.");
            break;
          }
          seen.add(parent.parent_element_id);
          parent = byId.get(parent.parent_element_id);
          if (!parent) {
            issue("parent_element_id", "Choose a parent in this scene.");
            break;
          }
        }
      }
    }
  });
export type SceneDocument = z.infer<typeof sceneDocumentSchema>;
export const sceneResourceQuerySchema = z.object({
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  holding_id: uuid.optional(),
  space_id: uuid.optional(),
  tracking_mode: z.enum(["individual", "pooled", "all"]).default("individual"),
}).strict();
export const sceneCommandSchema = z
  .object({ expected_revision: z.number().int().min(0), idempotency_key: uuid })
  .strict();
export const saveSceneDraftSchema = sceneCommandSchema
  .extend({ document: sceneDocumentSchema })
  .strict();
export const uploadSceneImageSchema = z
  .object({
    idempotency_key: uuid,
    rights_confirmed: z.literal(true),
    data_url: z.string().max(Math.ceil((MAX_SCENE_IMAGE_BYTES * 4) / 3) + 100),
    width: z.number().int().positive().max(30_000).optional(),
    height: z.number().int().positive().max(30_000).optional(),
  })
  .strict();
export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export type SaveSceneDraft = z.infer<typeof saveSceneDraftSchema>;
export type SceneAction =
  "draft_saved" | "published" | "reopened" | "image_uploaded";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
export function scenePayloadHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function publicSceneDocument(document: SceneDocument): SceneDocument {
  const labels: Record<SceneDocument["source"]["kind"], string> = {
    manual: "Administrator-created campus map",
    aerial_image: "Campus aerial image",
    site_plan: "Campus site plan",
    name_search: "Campus location reference",
    open_map: "Open map data",
  };
  return {
    ...document,
    source: {
      kind: document.source.kind,
      label: labels[document.source.kind],
      ...(document.source.attribution
        ? { attribution: document.source.attribution }
        : {}),
    },
  };
}
export function assertPublishableScene(document: SceneDocument) {
  return (
    document.elements.length > 0 &&
    document.elements.every((element) => element.review_state === "reviewed")
  );
}
