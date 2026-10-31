import { createHash } from "node:crypto";
import { z } from "zod";
import { sceneDocumentSchema, type SceneElement } from "./campus-scenes.contracts.js";

const id = z.string().uuid();
const proposalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const spaceKind = z.enum(["hostel", "residential_room", "building", "wing", "floor", "classroom", "laboratory", "library", "office", "auditorium", "sports_area", "workshop", "staff_room", "gate", "outdoor_area", "other"]);
const common = { proposal_id: proposalId, element_ids: z.array(proposalId).max(2000),
  floor_element_ids: z.array(proposalId).min(1).max(2000).optional() };
const create = z.object({ ...common, action: z.literal("create"), name: z.string().trim().min(2).max(160), kind: spaceKind,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/),
  parent_space_id: id.nullable().optional(), expected_parent_revision: z.number().int().positive().optional(),
  parent_proposal_id: proposalId.optional(),
}).strict();
const reuse = z.object({ ...common, action: z.literal("reuse"), space_id: id, expected_space_revision: z.number().int().positive() }).strict();

export const reviewedScenePlacesSchema = z.object({
  idempotency_key: id, expected_revision: z.number().int().min(0), document: sceneDocumentSchema,
  rows: z.array(z.discriminatedUnion("action", [create, reuse])).min(1).max(500),
}).strict().superRefine((input, context) => {
  const rows = new Set<string>(), elements = new Set<string>(), floorElements = new Set<string>(), codes = new Set<string>();
  const byId = new Map(input.document.elements.map(element => [element.id, element]));
  const proposals = new Map(input.rows.map(row => [row.proposal_id, row]));
  for (const [index, row] of input.rows.entries()) {
    const issue = (field: string, message: string) => context.addIssue({ code: "custom", path: ["rows", index, field], message });
    if (rows.has(row.proposal_id)) issue("proposal_id", "Choose each proposed place once.");
    rows.add(row.proposal_id);
    const floorRow = Boolean(row.floor_element_ids);
    if (floorRow && row.element_ids.length) issue("element_ids", "A floor groups its interior drawings; it has no separate building outline.");
    if (!floorRow && !row.element_ids.length) issue("element_ids", "Choose at least one drawing for this place.");
    if (row.action === "create") {
      if (codes.has(row.code)) issue("code", "Give each new campus place its own code.");
      codes.add(row.code);
      if (Boolean(row.parent_space_id) !== Boolean(row.expected_parent_revision)) issue("parent_space_id", "Review the exact current parent place revision.");
      if ((row.kind === "floor") !== floorRow) issue("floor_element_ids", "A new floor must explicitly group its interior drawings.");
      if (floorRow && (!row.parent_space_id || row.parent_proposal_id)) issue("parent_space_id", "Choose the exact existing building for this floor.");
      if (row.parent_proposal_id) {
        const parent = proposals.get(row.parent_proposal_id);
        if (row.parent_space_id || row.expected_parent_revision) issue("parent_proposal_id", "Choose either an existing parent or a reviewed floor.");
        if (row.parent_proposal_id === row.proposal_id || !parent?.floor_element_ids)
          issue("parent_proposal_id", "Choose a floor included in this review.");
        if (row.element_ids.some(elementId => byId.get(elementId)?.kind !== "room" || !parent?.floor_element_ids?.includes(elementId)))
          issue("parent_proposal_id", "Every room must be included in its reviewed floor.");
      }
    }
    for (const elementId of row.floor_element_ids ?? []) {
      if (floorElements.has(elementId)) issue("floor_element_ids", "Each interior drawing belongs to one reviewed floor.");
      floorElements.add(elementId);
      const element = byId.get(elementId);
      if (!element || !["room", "path", "fixture"].includes(element.kind) || (element.kind === "fixture" && element.asset_key === "gate"))
        issue("floor_element_ids", "Choose only rooms, corridors and indoor fixtures for this floor.");
    }
    for (const elementId of row.element_ids) {
      if (elements.has(elementId)) issue("element_ids", "Each drawing belongs to one reviewed place group.");
      elements.add(elementId);
      const element = byId.get(elementId);
      if (!element || !reviewedPlaceElementKinds(element).length) issue("element_ids", "Choose a building, room, gate or outdoor area in this layout.");
      else if (row.action === "create" && !reviewedPlaceElementKinds(element).includes(row.kind)) issue("kind", "Choose a place kind appropriate for every drawing in this group.");
    }
  }
  if (new Set([...elements, ...floorElements]).size > 2000) context.addIssue({ code: "custom", path: ["rows"], message: "Review no more than 2,000 drawings at once." });
});
export type ReviewedScenePlaces = z.infer<typeof reviewedScenePlacesSchema>;
export const reviewedPlaceMappingSchema = z.object({ proposal_id: proposalId, element_ids: z.array(proposalId).max(2000),
  space_id: id, space_revision: z.number().int().positive(), action: z.enum(["created", "reused"]) }).strict();
export const reviewedPlaceMappingsSchema = z.array(reviewedPlaceMappingSchema).min(1).max(500);
export type ReviewedPlaceMapping = z.infer<typeof reviewedPlaceMappingSchema>;

/** Explicit decisions only. No label, proximity, height or part identifier proves place identity. */
export function reviewedPlaceElementKinds(element: SceneElement): readonly string[] {
  if (element.kind === "building") return ["building", "wing", "library", "laboratory", "office", "auditorium", "hostel", "workshop", "staff_room", "other"];
  if (element.kind === "room") return ["classroom", "laboratory", "library", "office", "staff_room", "workshop", "residential_room", "other"];
  if (element.kind === "fixture" && element.asset_key === "gate") return ["gate"];
  if (element.kind === "surface") return ["outdoor_area", "sports_area", "other"];
  return [];
}

export function reviewedPlaceSaveKey(batchKey: string, proposal: string) {
  const hash = createHash("sha256").update(`campus-scene-reviewed-place:${batchKey}:${proposal}`).digest("hex").slice(0, 32).split("");
  hash[12] = "5"; hash[16] = ((parseInt(hash[16]!, 16) & 3) | 8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
