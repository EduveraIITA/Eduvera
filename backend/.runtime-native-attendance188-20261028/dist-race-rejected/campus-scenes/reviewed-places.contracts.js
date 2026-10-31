import { createHash } from "node:crypto";
import { z } from "zod";
import { sceneDocumentSchema } from "./campus-scenes.contracts.js";
const id = z.string().uuid();
const proposalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const spaceKind = z.enum(["hostel", "residential_room", "building", "wing", "classroom", "laboratory", "library", "office", "auditorium", "sports_area", "workshop", "staff_room", "gate", "outdoor_area", "other"]);
const common = { proposal_id: proposalId, element_ids: z.array(proposalId).min(1).max(2000) };
const create = z.object({ ...common, action: z.literal("create"), name: z.string().trim().min(2).max(160), kind: spaceKind,
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/),
    parent_space_id: id.nullable().optional(), expected_parent_revision: z.number().int().positive().optional(),
}).strict();
const reuse = z.object({ ...common, action: z.literal("reuse"), space_id: id, expected_space_revision: z.number().int().positive() }).strict();
export const reviewedScenePlacesSchema = z.object({
    idempotency_key: id, expected_revision: z.number().int().min(0), document: sceneDocumentSchema,
    rows: z.array(z.discriminatedUnion("action", [create, reuse])).min(1).max(500),
}).strict().superRefine((input, context) => {
    const rows = new Set(), elements = new Set(), codes = new Set();
    const byId = new Map(input.document.elements.map(element => [element.id, element]));
    for (const [index, row] of input.rows.entries()) {
        const issue = (field, message) => context.addIssue({ code: "custom", path: ["rows", index, field], message });
        if (rows.has(row.proposal_id))
            issue("proposal_id", "Choose each proposed place once.");
        rows.add(row.proposal_id);
        if (row.action === "create") {
            if (codes.has(row.code))
                issue("code", "Give each new campus place its own code.");
            codes.add(row.code);
            if (Boolean(row.parent_space_id) !== Boolean(row.expected_parent_revision))
                issue("parent_space_id", "Review the exact current parent place revision.");
        }
        for (const elementId of row.element_ids) {
            if (elements.has(elementId))
                issue("element_ids", "Each drawing belongs to one reviewed place group.");
            elements.add(elementId);
            const element = byId.get(elementId);
            if (!element || !reviewedPlaceElementKinds(element).length)
                issue("element_ids", "Choose a building, room, gate or outdoor area in this layout.");
            else if (row.action === "create" && !reviewedPlaceElementKinds(element).includes(row.kind))
                issue("kind", "Choose a place kind appropriate for every drawing in this group.");
        }
    }
    if (elements.size > 2000)
        context.addIssue({ code: "custom", path: ["rows"], message: "Review no more than 2,000 drawings at once." });
});
export const reviewedPlaceMappingSchema = z.object({ proposal_id: proposalId, element_ids: z.array(proposalId).min(1).max(2000),
    space_id: id, space_revision: z.number().int().positive(), action: z.enum(["created", "reused"]) }).strict();
export const reviewedPlaceMappingsSchema = z.array(reviewedPlaceMappingSchema).min(1).max(500);
/** Explicit decisions only. No label, proximity, height or part identifier proves place identity. */
export function reviewedPlaceElementKinds(element) {
    if (element.kind === "building")
        return ["building", "wing", "library", "laboratory", "office", "auditorium", "hostel", "workshop", "staff_room", "other"];
    if (element.kind === "room")
        return ["classroom", "laboratory", "library", "office", "staff_room", "workshop", "residential_room", "other"];
    if (element.kind === "fixture" && element.asset_key === "gate")
        return ["gate"];
    if (element.kind === "surface")
        return ["outdoor_area", "sports_area", "other"];
    return [];
}
export function reviewedPlaceSaveKey(batchKey, proposal) {
    const hash = createHash("sha256").update(`campus-scene-reviewed-place:${batchKey}:${proposal}`).digest("hex").slice(0, 32).split("");
    hash[12] = "5";
    hash[16] = ((parseInt(hash[16], 16) & 3) | 8).toString(16);
    const value = hash.join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
//# sourceMappingURL=reviewed-places.contracts.js.map