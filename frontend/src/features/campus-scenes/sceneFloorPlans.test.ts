import { describe, expect, it } from "vitest";
import { adjustFloorPlan, floorPlanDisplayBounds, floorPlanReviewedRows, mergeFloorPlanProposal, type SceneFloorPlanContext } from "./sceneFloorPlans";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";

const building: CampusSceneElement = { id: "mapped-building", kind: "building", label: "Engineering", geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 140 }, { x: 100, y: 140 }] }, space_id: "building", floor_id: null, review_state: "reviewed" };
const source: CampusSceneDocument = { schema_version: 1, name: "Campus", source: { kind: "aerial_image", label: "Original campus", image_asset_id: "original-private-image" }, bounds: { width: 1000, height: 800, unit: "metres" }, elements: [building] };
const room: CampusSceneElement = { id: "proposed-room", kind: "room", label: "Admissions office", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }] }, space_id: null, floor_id: null, review_state: "needs_review" };
const proposal: CampusSceneDocument = { schema_version: 1, name: "Floor", source: { kind: "site_plan", label: "Floor plan", image_asset_id: "new-private-image" }, bounds: { width: 1000, height: 500, unit: "relative" }, elements: [room, { id: "door", kind: "fixture", asset_key: "door", label: "Office door", geometry: { type: "point", points: [{ x: 500, y: 250 }] }, width: 25, space_id: null, floor_id: null, parent_element_id: room.id, review_state: "needs_review" }] };
const spaces: CampusSceneSpace[] = [{ id: "building", campus_id: "campus", name: "Engineering", code: "ENG", kind: "building", parent_space_id: null, revision: 7 }, { id: "floor", campus_id: "campus", name: "Ground floor", code: "ENG0", kind: "floor", parent_space_id: "building", revision: 4 }];
const context: SceneFloorPlanContext = { buildingId: "building", buildingElementId: "mapped-building", floorId: null, newFloor: { name: "Teaching floor", code: "" }, elementIds: ["new-room", "new-door"], imageBounds: { x: 100, y: 100, width: 80, height: 40 } };

describe("scoped floor plan proposals", () => {
  it("preserves the complete original scene/source and fits a new editable floor without fabricated canonical IDs", () => {
    let sequence = 0; const result = mergeFloorPlanProposal(source, proposal, building, null, () => `new-${++sequence}`);
    expect(result.document.source).toEqual(source.source); expect(result.document.bounds).toEqual(source.bounds);
    expect(result.document.elements[0]).toEqual(building); expect(source.elements).toHaveLength(1);
    expect(result.elementIds).toEqual(["new-1", "new-2"]);
    expect(result.document.elements[1]).toMatchObject({ id: "new-1", floor_id: null, space_id: null, parent_element_id: building.id, review_state: "needs_review" });
    expect(result.document.elements[2]).toMatchObject({ id: "new-2", parent_element_id: "new-1", width: 1.92 });
    expect(result.imageBounds).toEqual({ x: 101.6, y: 100.8, width: 76.8, height: 38.4 });
  });
  it("creates the floor before its room set through proposal references in the one native batch", () => {
    const result = floorPlanReviewedRows(context, [{ proposal_id: "room", action: "create", element_ids: ["new-room"], name: "Admissions office", code: "ADM101", kind: "office" }], spaces);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ proposal_id: "floor_plan_target", kind: "floor", action: "create", parent_space_id: "building", expected_parent_revision: 7, floor_element_ids: ["new-room", "new-door"], element_ids: [] });
    expect(result.rows[1]).toMatchObject({ parent_proposal_id: "floor_plan_target", element_ids: ["new-room"] });
    expect(result.rows[1]).not.toHaveProperty("floor_id");
  });
  it("uses the exact selected floor revision and preserves explicit room reuse", () => {
    const roomRow = { proposal_id: "room", action: "reuse" as const, element_ids: ["new-room"], space_id: "office", expected_space_revision: 8 };
    const result = floorPlanReviewedRows({ ...context, floorId: "floor" }, [roomRow], spaces);
    expect(result.rows).toEqual([{ proposal_id: "floor_plan_target", action: "reuse", space_id: "floor", expected_space_revision: 4, element_ids: [], floor_element_ids: context.elementIds }, roomRow]);
    expect(mergeFloorPlanProposal(source, proposal, building, "floor").document.elements.at(-1)?.floor_id).toBe("floor");
  });
  it("refuses unsupported/linked proposals and a missing current parent revision", () => {
    expect(() => mergeFloorPlanProposal(source, { ...proposal, elements: [{ ...room, holding_id: "invented-resource" }] }, building, null)).toThrow(/unsupported/);
    expect(() => mergeFloorPlanProposal(source, { ...proposal, elements: [{ ...room, kind: "building" }] }, building, null)).toThrow(/unsupported/);
    expect(floorPlanReviewedRows(context, [], [{ ...spaces[0]!, revision: undefined }]).errors).toContain("Refresh the building before creating its floor plan.");
    expect(floorPlanReviewedRows({ ...context, elementIds: [] }, [], spaces).errors).toContain("Draw at least one room or opening before reviewing this floor plan.");
  });
  it("rotates, scales and moves the proposed group and image together while preserving all original campus geometry", () => {
    let sequence = 0; const merged = mergeFloorPlanProposal(source, proposal, building, null, () => `new-${++sequence}`);
    const initialContext = { ...context, elementIds: merged.elementIds, imageBounds: merged.imageBounds };
    const rotated = adjustFloorPlan(merged.document, initialContext, { rotationDeg: 90 });
    const box = floorPlanDisplayBounds(rotated.context);
    expect(box.width).toBeCloseTo(merged.imageBounds.height); expect(box.height).toBeCloseTo(merged.imageBounds.width);
    expect(rotated.context.imageRotationDeg).toBe(90); expect(rotated.document.elements[2]?.rotation_deg).toBe(90);
    const first = merged.document.elements[1]!.geometry.points[0]!, turned = rotated.document.elements[1]!.geometry.points[0]!;
    const cx = merged.imageBounds.x + merged.imageBounds.width / 2, cy = merged.imageBounds.y + merged.imageBounds.height / 2;
    expect(turned.x).toBeCloseTo(cx - (first.y - cy)); expect(turned.y).toBeCloseTo(cy + (first.x - cx));
    const moved = adjustFloorPlan(rotated.document, rotated.context, { scale: .9, dx: 3, dy: 2 });
    expect(moved.document.elements[0]).toEqual(building); expect(moved.document.source).toEqual(source.source); expect(moved.document.bounds).toEqual(source.bounds);
    expect(moved.document.elements[1]?.id).toBe("new-1"); expect(moved.document.elements[2]?.parent_element_id).toBe("new-1");
    const undo = adjustFloorPlan(rotated.document, rotated.context, { rotationDeg: -90 });
    expect(undo.document.elements[1]!.geometry.points[0]!.x).toBeCloseTo(first.x); expect(undo.document.elements[1]!.geometry.points[0]!.y).toBeCloseTo(first.y);
    expect(() => adjustFloorPlan(merged.document, initialContext, { dx: -9999 })).toThrow(/within the campus drawing/);
  });
});
