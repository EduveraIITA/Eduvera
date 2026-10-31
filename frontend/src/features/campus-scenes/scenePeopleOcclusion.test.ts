import { describe, expect, it } from "vitest";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { scenePeopleOccluders } from "./scenePeopleOcclusion";
import { scenePlantSilhouette } from "./scenePlantSilhouettes";

const tree = (asset_key: CampusSceneElement["asset_key"]): CampusSceneElement => ({ id: "plant", kind: "tree", label: "Plant", asset_key, geometry: { type: "point", points: [{ x: 35, y: 60 }] }, floor_id: null, space_id: null, review_state: "reviewed" });
const document = (elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements });

describe("people occlusion geometry", () => {
  it.each(["tree_broadleaf", "tree_columnar", "shrub", "tree_palm", "tree_conifer"] as const)("uses the exact shared %s silhouette without changing its editable geometry", asset => {
    const element = tree(asset), before = JSON.stringify(element), shared = scenePlantSilhouette(element, "2.5d", 1)!;
    const masks = scenePeopleOccluders(document([element]), null, "2.5d", 1);
    expect(masks).toHaveLength(1);
    expect(masks[0]!.depth).toBe(60);
    if (asset === "tree_palm") expect(masks[0]!.masks.filter(mask => mask.fill).map(mask => mask.path)).toEqual(shared.palmFronds);
    else if (asset === "tree_conifer") expect(masks[0]!.masks.filter(mask => mask.fill).map(mask => mask.path)).toEqual(shared.coniferTiers);
    else expect(masks[0]!.masks.find(mask => mask.fill)).toEqual({ path: shared.organicPath, fill: true, transform: { x: shared.cx, y: shared.cy, scaleX: shared.scaleX, scaleY: shared.scaleY } });
    expect(JSON.stringify(element)).toBe(before);
  });
  it("masks projected roof and front walls while leaving unrelated roads and floor plans unmasked", () => {
    const building: CampusSceneElement = { id: "building", kind: "building", label: "Building", roof: "hip", levels: 2, geometry: { type: "polygon", points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }, { x: 10, y: 50 }] }, floor_id: null, space_id: "place", review_state: "reviewed" };
    const road: CampusSceneElement = { ...building, id: "road", kind: "road", geometry: { type: "polyline", points: [{ x: 0, y: 70 }, { x: 100, y: 70 }] } };
    const masks = scenePeopleOccluders(document([building, road]), null, "2.5d", 1);
    expect(masks).toHaveLength(1); expect(masks[0]!.key).toBe("building");
    expect(masks[0]!.masks.length).toBeGreaterThan(4);
    expect(masks[0]!.bounds.y).toBeLessThan(20); expect(masks[0]!.depth).toBe(50);
    expect(scenePeopleOccluders(document([building, road]), null, "2d", 1)).toEqual([]);
  });
  it("retains reviewed gate openings instead of filling a boundary bounding box", () => {
    const wall: CampusSceneElement = { id: "wall", kind: "path", asset_key: "boundary_wall", label: "Wall", geometry: { type: "polyline", points: [{ x: 0, y: 80 }, { x: 40, y: 80 }] }, floor_id: null, space_id: null, review_state: "reviewed" };
    const other = { ...wall, id: "other", geometry: { ...wall.geometry, points: [{ x: 60, y: 80 }, { x: 100, y: 80 }] } };
    const masks = scenePeopleOccluders(document([wall, other]), null, "2.5d", 1);
    expect(masks.length).toBeGreaterThan(1);
    expect(masks.every(mask => mask.bounds.x + mask.bounds.width < 45 || mask.bounds.x > 55)).toBe(true);
  });
});
