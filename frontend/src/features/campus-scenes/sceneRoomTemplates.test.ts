import { describe, expect, it } from "vitest";
import { furnishSceneRoom, ROOM_FURNISHING_TEMPLATES } from "./sceneRoomTemplates";
import type { CampusSceneDocument, CampusSceneElement } from "./types";

const room: CampusSceneElement = { id: "room", kind: "room", label: "Work room", geometry: { type: "polygon", points: [{ x: 10, y: 10 }, { x: 22, y: 10 }, { x: 22, y: 20 }, { x: 10, y: 20 }] }, floor_id: "floor", space_id: "canonical-room", review_state: "reviewed" };
const document: CampusSceneDocument = { schema_version: 1, name: "Campus", source: { kind: "manual", label: "Manual" }, bounds: { width: 100, height: 100, unit: "metres" }, elements: [room] };
describe("editable room arrangements", () => {
  it.each(ROOM_FURNISHING_TEMPLATES)("keeps $label as reviewable symbols with no invented resources or operational routes", ({ key }) => {
    let sequence = 0;
    const result = furnishSceneRoom(document, room, key, () => `furniture-${++sequence}`);
    expect(result.elements.length).toBeGreaterThan(3);
    expect(result.elements.length).toBeLessThanOrEqual(40);
    expect(new Set(result.elements.map(element => element.id)).size).toBe(result.elements.length);
    for (const element of result.elements) {
      expect(element).toMatchObject({ kind: "fixture", space_id: null, floor_id: "floor", parent_element_id: "room", review_state: "needs_review" });
      expect(element.holding_id).toBeUndefined(); expect(element.navigation).toBeUndefined(); expect(element.navigation_connector).toBeUndefined();
      const point = element.geometry.points[0]!;
      expect(point.x - element.width! / 2).toBeGreaterThanOrEqual(10); expect(point.x + element.width! / 2).toBeLessThanOrEqual(22);
      expect(point.y - element.depth! / 2).toBeGreaterThanOrEqual(10); expect(point.y + element.depth! / 2).toBeLessThanOrEqual(20);
    }
    expect(document.elements).toEqual([room]);
  });
  it("omits furniture outside a concave room instead of shifting its walls", () => {
    const concave = { ...room, geometry: { type: "polygon" as const, points: [{ x: 10, y: 10 }, { x: 22, y: 10 }, { x: 22, y: 13 }, { x: 13, y: 13 }, { x: 13, y: 20 }, { x: 10, y: 20 }] } };
    const result = furnishSceneRoom(document, concave, "meeting");
    expect(result.omitted).toBeGreaterThan(0);
    expect(result.elements.every(element => element.geometry.points[0]!.x < 13 || element.geometry.points[0]!.y < 13)).toBe(true);
  });
  it("requires a real floor binding and leaves undersized spaces untouched", () => {
    expect(furnishSceneRoom(document, { ...room, floor_id: null }, "office").elements).toEqual([]);
    expect(furnishSceneRoom(document, { ...room, kind: "building" }, "office").elements).toEqual([]);
    expect(furnishSceneRoom(document, { ...room, geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } }, "office").elements).toEqual([]);
  });
  it("fits an unmeasured laboratory across its usable room, independently of the campus extent", () => {
    const relativeRoom = { ...room, geometry: { type: "polygon" as const, points: [{ x: 100, y: 100 }, { x: 240, y: 100 }, { x: 240, y: 180 }, { x: 100, y: 180 }] } };
    const relativeDocument = { ...document, bounds: { width: 800, height: 650, unit: "relative" as const } };
    const arrangement = furnishSceneRoom(relativeDocument, relativeRoom, "laboratory", () => "illustration");
    expect(arrangement.elements).toHaveLength(37); expect(arrangement.omitted).toBe(0);
    const desks = arrangement.elements.filter(element => element.asset_key === "desk");
    const xs = desks.map(element => element.geometry.points[0]!.x), ys = desks.map(element => element.geometry.points[0]!.y);
    expect((Math.max(...xs) - Math.min(...xs)) / 140).toBeGreaterThanOrEqual(.59);
    expect((Math.max(...ys) - Math.min(...ys)) / 80).toBeGreaterThanOrEqual(.49);
    expect(desks[0]!.width! / 140).toBeGreaterThan(.12);
    const largerCampus = furnishSceneRoom({ ...relativeDocument, bounds: { ...relativeDocument.bounds, width: 8000, height: 6500 } }, relativeRoom, "laboratory", () => "illustration");
    expect(largerCampus).toEqual(arrangement);
    const largerRoom = { ...relativeRoom, geometry: { ...relativeRoom.geometry, points: relativeRoom.geometry.points.map(point => ({ x: 100 + (point.x - 100) * 2, y: 100 + (point.y - 100) * 2 })) } };
    const doubled = furnishSceneRoom(relativeDocument, largerRoom, "laboratory");
    expect(doubled.elements.filter(element => element.asset_key === "desk")[0]!.width).toBeCloseTo(desks[0]!.width! * 2);
  });
  it("keeps metre asset dimensions and spacing exact instead of shrinking them to a room percentage", () => {
    const metricRoom = { ...room, geometry: { type: "polygon" as const, points: [{ x: 10, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 15 }, { x: 10, y: 15 }] } };
    const meeting = furnishSceneRoom(document, metricRoom, "meeting");
    expect(meeting.elements.find(element => element.asset_key === "meeting_table")).toMatchObject({ width: 3.5, depth: 1.4 });
    const laboratory = furnishSceneRoom(document, room, "laboratory");
    const desks = laboratory.elements.filter(element => element.asset_key === "desk");
    expect(desks[0]).toMatchObject({ width: 1.35, depth: .7 });
    expect(desks[1]!.geometry.points[0]!.x - desks[0]!.geometry.points[0]!.x).toBeCloseTo(2);
    expect(desks[4]!.geometry.points[0]!.y - desks[0]!.geometry.points[0]!.y).toBeCloseTo(2.1);
  });
});
