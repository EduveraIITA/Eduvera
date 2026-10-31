import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reviewedPlaceElementKinds, reviewedPlaceSaveKey, reviewedScenePlacesSchema } from "../src/campus-scenes/reviewed-places.contracts.js";
import { campusSceneDocument } from "./campus-scenes.test-support.js";

const input = () => ({ expected_revision: 0, idempotency_key: randomUUID(), document: campusSceneDocument(),
  rows: [{ proposal_id: "library", element_ids: ["building-one"], action: "create", name: "Library", code: "LIBRARY", kind: "library" }] });
describe("reviewed campus-place batch contracts", () => {
  it("reviews one new floor and its rooms without provisional canonical identifiers or request-order ancestry", () => {
    const value = input();
    value.document.elements.push({ ...structuredClone(value.document.elements[0]!), id: "room-one", kind: "room" });
    const rows = [
      { proposal_id: "room", element_ids: ["room-one"], action: "create", name: "Seminar room", code: "S101", kind: "classroom", parent_proposal_id: "floor" },
      { proposal_id: "floor", element_ids: [], floor_element_ids: ["room-one"], action: "create", name: "Ground floor", code: "GROUND", kind: "floor", parent_space_id: randomUUID(), expected_parent_revision: 1 },
    ];
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows }).success).toBe(true);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [{ ...rows[0], parent_proposal_id: "missing" }, rows[1]] }).success).toBe(false);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [{ ...rows[0], parent_space_id: randomUUID(), expected_parent_revision: 1 }, rows[1]] }).success).toBe(false);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [rows[0], { ...rows[1], floor_element_ids: ["building-one"] }] }).success).toBe(false);
  });
  it("allows explicit existing-floor reuse and rejects duplicate or unscoped floor bindings", () => {
    const value = input(); value.document.elements.push({ ...structuredClone(value.document.elements[0]!), id: "room-one", kind: "room" });
    const floor = { proposal_id: "floor", element_ids: [], floor_element_ids: ["room-one"], action: "reuse", space_id: randomUUID(), expected_space_revision: 1 };
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [floor] }).success).toBe(true);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [floor, { ...floor, proposal_id: "second" }] }).success).toBe(false);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [{ ...floor, floor_element_ids: ["room-one", "room-one"] }] }).success).toBe(false);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [{ ...floor, floor_element_ids: undefined }] }).success).toBe(false);
  });
  it("takes one full local document without requiring a prior save or geometry review", () => {
    const value = input(); value.document.elements[0]!.review_state = "needs_review";
    expect(reviewedScenePlacesSchema.parse(value).document.elements[0]!.review_state).toBe("needs_review");
  });
  it("allows explicit reviewed outdoor use without claiming geometry review", () => {
    const value = input(); Object.assign(value.document.elements[0]!, { kind: "surface", asset_key: "sports", review_state: "needs_review" });
    Object.assign(value.rows[0]!, { kind: "sports_area" });
    expect(reviewedScenePlacesSchema.safeParse(value).success).toBe(true);
  });
  it("retains a deliberate multipart group and accepts only current explicit reuse references", () => {
    const value = input(), wing = { ...value.document.elements[0]!, id: "east-wing" };
    value.document.elements.push(wing); value.rows[0]!.element_ids.push(wing.id);
    expect(reviewedScenePlacesSchema.parse(value).rows[0]?.element_ids).toEqual(["building-one", "east-wing"]);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [{ proposal_id: "library", element_ids: ["building-one"], action: "reuse", space_id: randomUUID(), expected_space_revision: 4 }] }).success).toBe(true);
  });
  it.each([
    { rows: [] }, { extra: "arbitrary" }, { rows: [{ proposal_id: "x", element_ids: ["unknown"], action: "create", name: "Place", code: "P", kind: "building" }] },
    { rows: [{ proposal_id: "x", element_ids: ["path-one"], action: "create", name: "Place", code: "P", kind: "outdoor_area" }] },
    { rows: [{ proposal_id: "x", element_ids: ["building-one"], action: "create", name: "Place", code: "P", kind: "floor" }] },
    { rows: [{ proposal_id: "x", element_ids: ["building-one"], action: "create", name: "Place", code: "P", kind: "building", parent_space_id: randomUUID() }] },
    { rows: [{ proposal_id: "x", element_ids: ["building-one"], action: "create", name: "Place", code: "P", kind: "building", parent_proposal_id: "another" }] },
    { rows: [{ proposal_id: "x", element_ids: ["building-one"], action: "reuse", space_id: randomUUID() }] },
    { rows: [{ proposal_id: "x", element_ids: ["building-one"], action: "reuse", space_id: randomUUID(), expected_space_revision: 1, name: "Silently rename" }] },
  ])("rejects partial, unbounded or inferred inputs %#", change => {
    expect(reviewedScenePlacesSchema.safeParse({ ...input(), ...change }).success).toBe(false);
  });
  it("rejects duplicate keys, overlapping groups and duplicate normalized codes", () => {
    const value = input(), row = value.rows[0]!;
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [row, row] }).success).toBe(false);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [row, { ...row, proposal_id: "another", code: "OTHER" }] }).success).toBe(false);
    const wing = { ...value.document.elements[0]!, id: "second" }; value.document.elements.push(wing);
    expect(reviewedScenePlacesSchema.safeParse({ ...value, rows: [row, { ...row, proposal_id: "second", element_ids: [wing.id], code: "library" }] }).success).toBe(false);
  });
  it("excludes decorative trees, roads, paths and ordinary fixtures", () => {
    const element = campusSceneDocument().elements[0]!;
    for (const kind of ["tree", "road", "path", "fixture"] as const) expect(reviewedPlaceElementKinds({ ...element, kind })).toEqual([]);
    expect(reviewedPlaceElementKinds({ ...element, kind: "fixture", asset_key: "gate" })).toEqual(["gate"]);
  });
  it("derives stable distinct native child keys without using names or an array position", () => {
    const key = randomUUID();
    expect(reviewedPlaceSaveKey(key, "library")).toBe(reviewedPlaceSaveKey(key, "library"));
    expect(reviewedPlaceSaveKey(key, "library")).not.toBe(reviewedPlaceSaveKey(key, "hall"));
    expect(reviewedPlaceSaveKey(key, "library")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
