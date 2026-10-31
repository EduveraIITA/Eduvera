import { describe, expect, it } from "vitest";
import { scenePlaceFocus } from "./scenePlaceCamera";
import { projectScenePoint, sceneElementHeight, sceneUnitScale } from "./sceneGeometry";
import type { CampusSceneDocument } from "./types";
import { campusMapSearchPlaces, readCampusMapPresentation } from "./sceneMapPresentation";
import type { CampusScenePublished } from "./api";
const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", bounds: { width: 500, height: 500, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [
  { id: "west", kind: "building", label: "Library", space_id: "library", floor_id: null, review_state: "reviewed", roof: "gable", levels: 3, geometry: { type: "polygon", points: [{ x: 20, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 20, y: 60 }] } },
  { id: "east", kind: "building", label: "Library", space_id: "library", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 80, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 60 }, { x: 80, y: 60 }] } },
] };
describe("canonical place camera context", () => {
  it("frames all outline fragments and projected building height without altering geometry", () => {
    const original = JSON.stringify(scene), focus = scenePlaceFocus(scene, "west", "2.5d", null)!;
    const top = projectScenePoint(scene.elements[0]!.geometry.points[0]!, sceneElementHeight(scene.elements[0]!, sceneUnitScale(scene)), "2.5d");
    expect(focus.bounds.x).toBeLessThan(top.x); expect(focus.bounds.y).toBeLessThan(top.y);
    const east = projectScenePoint({ x: 100, y: 60 }, 0, "2.5d");
    expect(focus.bounds.x + focus.bounds.width).toBeGreaterThan(east.x);
    expect(scenePlaceFocus(structuredClone(scene), "east", "2.5d", null)?.key).toBe(focus.key);
    expect(scenePlaceFocus(scene, "west", "2d", "unrelated-floor")).toBeNull();
    expect(JSON.stringify(scene)).toBe(original);
  });
  it("deduplicates native identity rather than equal names and rejects non-floor interior URLs", () => {
    const elements = [...scene.elements, { ...scene.elements[0]!, id: "other", space_id: "other-library" }];
    expect(campusMapSearchPlaces(elements).map(element => element.id)).toEqual(["west", "other"]);
    const data: CampusScenePublished = { campus: { id: "campus", name: "Campus", code: "C" }, can_edit: false, places: [{ id: "library", name: "Library", code: "L", kind: "building", parent_space_id: null }, { id: "room", name: "Room", code: "R", kind: "classroom", parent_space_id: "library" }], scene: { id: "scene", version: 1, published_at: "2026-10-27T00:00:00Z", document: scene } };
    const view = readCampusMapPresentation(new URLSearchParams("map_context=campus%3Alive&map_inside=west&map_view_floor=room&map_page=1.5"), "campus:live", data);
    expect(view.buildingId).toBeNull(); expect(view.floorId).toBeNull(); expect(view.page).toBe(1);
  });
});
