import { describe, expect, it } from "vitest";
import { sceneDrawingParts } from "./sceneDepth";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { furnishSceneRoom } from "./sceneRoomTemplates";

const building: CampusSceneElement = { id: "building", label: "Building", kind: "building", geometry: { type: "polygon", points: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}] }, height: 12, space_id: null, floor_id: null, review_state: "reviewed" };
const wall: CampusSceneElement = { ...building, id: "wall", label: "Boundary", kind: "path", asset_key: "boundary_wall", geometry: { type: "polyline", points: [{x:0,y:5},{x:300,y:5}] }, height: 2.2, width: .65 };
const tree = (x: number, y: number): CampusSceneElement => ({ ...building, id: "tree", label: "Tree", kind: "tree", geometry: { type: "point", points: [{x,y}] }, width: 6, height: 16 });

describe("campus depth display list", () => {
  it.each(["2d", "2.5d"] as const)("paints every coincident workstation computer after its desk in %s with adversarial random IDs", mode => {
    const room: CampusSceneElement = { ...building, id: "room", kind: "room", floor_id: "floor", space_id: "canonical-room", geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 240, y: 100 }, { x: 240, y: 180 }, { x: 100, y: 180 }] } };
    const document: CampusSceneDocument = { schema_version: 1, name: "Floor", source: { kind: "manual", label: "Manual" }, bounds: { width: 800, height: 650, unit: "relative" }, elements: [room] };
    const original = furnishSceneRoom(document, room, "laboratory").elements;
    expect(original.filter(element => element.asset_key === "computer")).toHaveLength(12);
    for (let seed = 1; seed <= 12; seed++) {
      const input = original.map((element, index) => ({ ...element, id: `${element.asset_key === "computer" ? "a" : element.asset_key === "desk" ? "z" : "m"}-${((index + seed) * 2654435761 >>> 0).toString(16)}` })).reverse();
      const before = structuredClone(input), parts = sceneDrawingParts(input, 3.2, mode);
      for (const computer of input.filter(element => element.asset_key === "computer")) {
        const point = computer.geometry.points[0]!, desk = input.find(element => element.asset_key === "desk" && element.geometry.points[0]!.x === point.x && element.geometry.points[0]!.y === point.y)!;
        expect(parts.findIndex(part => part.source.id === desk.id)).toBeLessThan(parts.findIndex(part => part.source.id === computer.id));
      }
      expect(sceneDrawingParts([...input].reverse(), 3.2, mode).map(part => part.key)).toEqual(parts.map(part => part.key));
      expect(input).toEqual(before);
    }
  });
  it("orders the same-anchor office computer above its desk without shifting either object", () => {
    const desk: CampusSceneElement = { ...tree(20, 40), kind: "fixture", id: "zz-desk", asset_key: "desk", floor_id: "floor", parent_element_id: "room", width: 1.5, depth: .8, height: undefined };
    const computer: CampusSceneElement = { ...desk, id: "aa-computer", asset_key: "computer", width: .6, depth: .35 };
    const unrelated = { ...desk, id: "middle-other-room", parent_element_id: "other-room" };
    const input = [computer, unrelated, desk], before = structuredClone(input);
    for (const mode of ["2d", "2.5d"] as const) {
      const parts = sceneDrawingParts(input, 1, mode);
      expect(parts.findIndex(part => part.source === desk)).toBeLessThan(parts.findIndex(part => part.source === computer));
      expect(parts.every(part => part.element === part.source)).toBe(true);
    }
    expect(input).toEqual(before);
  });
  it("places a tree beside the near side of a wide building in front even when its coordinate sum is smaller", () => {
    const parts = sceneDrawingParts([tree(104, 80), building], 1, "2.5d");
    expect(parts.map(part => part.source.id)).toEqual(["building", "tree"]);
  });
  it("keeps rear wall sections behind nearer trees and front walls ahead of them", () => {
    const parts = sceneDrawingParts([wall, tree(50, 16)], 1, "2.5d"), treeIndex = parts.findIndex(part => part.source.id === "tree");
    const crossingWall = parts.findIndex(part => part.source.id === "wall" && part.element.geometry.points[0]!.x <= 50 && part.element.geometry.points[1]!.x >= 50);
    expect(crossingWall).toBeLessThan(treeIndex);
    const front = { ...wall, geometry: { type: "polyline" as const, points: [{x:0,y:120},{x:300,y:120}] } };
    const foreground = sceneDrawingParts([front, tree(50, 110)], 1, "2.5d");
    const frontSection = foreground.findIndex(part => part.source.id === "wall" && part.element.geometry.points[0]!.x <= 50 && part.element.geometry.points[1]!.x >= 50);
    expect(frontSection).toBeGreaterThan(foreground.findIndex(part => part.source.id === "tree"));
  });
  it("retains one editable source and keyboard target while splitting visual sections without changing the source", () => {
    const original = structuredClone(wall), parts = sceneDrawingParts([wall], 1, "2.5d");
    expect(parts.length).toBeGreaterThan(5); expect(parts.filter(part => part.primary)).toHaveLength(1);
    expect(parts.every(part => part.source === wall && part.element.id === wall.id)).toBe(true);
    expect(wall).toEqual(original);
    expect(sceneDrawingParts([wall], 1, "2d")).toEqual([{key:"wall",source:wall,element:wall,primary:true}]);
  });
  it("bounds decorative fragment growth and returns a deterministic order", () => {
    const huge = { ...wall, geometry: {type:"polyline" as const,points:[{x:0,y:0},{x:100000,y:0}]} };
    const first = sceneDrawingParts([huge,tree(50,16)],1,"2.5d");
    expect(first.length).toBeLessThanOrEqual(241);
    expect(sceneDrawingParts([tree(50,16),huge],1,"2.5d").map(part=>part.key)).toEqual(first.map(part=>part.key));
  });
});
