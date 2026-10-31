import { describe, expect, it } from "vitest";
import type { CampusMapAsset } from "../campus-view/campusOperational.types";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { buildingExplorerAncestors, buildingExplorerMatches, buildingExplorerResourceStatus, sceneBuildingExplorer, type BuildingExplorerPlace } from "./sceneBuildingExplorer";

const building: CampusSceneElement = { id: "building", kind: "building", label: "Learning building", space_id: "b", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }] } };
const place = (id: string, parent: string | null, kind = "classroom"): BuildingExplorerPlace => ({ id, name: id, code: id, parent_space_id: parent, kind });
const room = { ...building, id: "mapped-room", kind: "room" as const, space_id: "room", floor_id: "floor", parent_element_id: building.id };
const fixture: CampusSceneElement = { ...building, id: "projector", kind: "fixture", space_id: null, holding_id: "h", floor_id: "floor", parent_element_id: building.id };
const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Plan" }, elements: [building, room, fixture] };
const asset: CampusMapAsset = { element_id: "projector", holding_id: "h", name: "Projector", asset_tag: "PROJ-12", space_id: "room", native_state: "available", reportable: true, signal: { state: "unknown", impact: null, open_reports: 0, updated_at: null }, repairs: [] };

describe("building explorer identity and coverage", () => {
  it("keeps canonical unmapped places without inventing floors, and excludes another building", () => {
    const original = JSON.stringify(scene);
    const model = sceneBuildingExplorer({ building: { ...building, levels: 8 }, scene,
      places: [place("b", null, "building"), place("floor", "b", "floor"), place("room", "floor"), place("unmapped", "floor"), place("other", "another-building"), place("same-name", null)], assets: [asset] });
    expect(model).toMatchObject({ floors: 1, places: 3, resources: 1 });
    expect(model.nodes.get("place:unmapped")).toMatchObject({ elementId: null });
    expect(model.nodes.get("place:room")).toMatchObject({ elementId: "mapped-room" });
    expect(model.nodes.has("place:other")).toBe(false);
    expect(model.nodes.get("resource:projector")?.parentId).toBe("place:room");
    expect(JSON.stringify(scene)).toBe(original);
  });
  it("requires exact published holding bindings and canonical containment for resources", () => {
    const model = sceneBuildingExplorer({ building, scene, places: [place("floor", "b", "floor"), place("room", "floor")],
      assets: [{ ...asset, holding_id: "different-holding" }, { ...asset, element_id: "not-published" }, { ...asset, space_id: "another-room" }] });
    expect(model.resources).toBe(0);
    expect([...model.nodes.values()].every(node => node.kind === "place")).toBe(true);
  });
  it("handles corrupt ancestry without loops, merges no identities by name and retains exact match ancestors", () => {
    const model = sceneBuildingExplorer({ building, scene, places: [place("floor", "b", "floor"), place("room", "floor"), place("loop-a", "loop-b"), place("loop-b", "loop-a")], assets: [asset] });
    expect([...buildingExplorerAncestors(model, "resource:projector")]).toEqual(["place:room", "place:floor"]);
    expect([...buildingExplorerMatches(model, "proj-12")!]).toEqual(["resource:projector", "place:room", "place:floor"]);
    expect(buildingExplorerMatches(model, "missing")?.size).toBe(0);
    expect(buildingExplorerMatches(model, " ")).toBeNull();
    expect(model.nodes.has("place:loop-a")).toBe(false);
  });
  it("never turns unknown, unverified repair work or retired inventory into available state", () => {
    expect(buildingExplorerResourceStatus({ ...asset, native_state: "unknown" })).toBe("Availability unknown");
    expect(buildingExplorerResourceStatus({ ...asset, signal: { ...asset.signal, state: "reported_fault", impact: "not_working" } })).toBe("Reported not working");
    expect(buildingExplorerResourceStatus({ ...asset, native_state: "retired" })).toBe("Retired");
    expect(buildingExplorerResourceStatus({ ...asset, signal: { ...asset.signal, state: "awaiting_verification", impact: "not_working" } })).toBe("Reported not working · awaiting check");
  });
  it("sorts known floor codes naturally without exposing them as labels or fabricating levels", () => {
    const model = sceneBuildingExplorer({ building, scene, places: [
      { ...place("first", "b", "floor"), name: "First floor", code: "1" },
      { ...place("tenth", "b", "floor"), name: "Tenth floor", code: "10" },
      { ...place("ground", "b", "floor"), name: "Ground floor", code: "0" },
    ] });
    expect(model.children.map(node => node.kind === "place" && node.place.name)).toEqual(["Ground floor", "First floor", "Tenth floor"]);
  });
});
