import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findSceneWalkingRoute } from "./sceneWalking";
import { sceneBuildingFloorIds, sceneInteriorView } from "./sceneInterior";
import { CampusScenePublishedView } from "./CampusScenePublishedView";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import type { CampusScenePublished } from "./api";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: (props: { floorId?: string; walkingRoute?: { status: string }; scene: CampusSceneDocument; viewBounds?: unknown }) => <div aria-label="Indoor map"><output aria-label="Route state">{props.walkingRoute?.status ?? "none"}</output><output aria-label="Map floor">{props.floorId ?? "outdoors"}</output><output aria-label="Drawn scene">{JSON.stringify(props.scene)}</output><output aria-label="Camera bounds">{JSON.stringify(props.viewBounds)}</output></div> }));
afterEach(cleanup);
const point = (x: number, y: number) => ({ x, y });
const building: CampusSceneElement = { id: "building", kind: "building", label: "Learning block", space_id: "building-place", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [point(20, 20), point(80, 20), point(80, 80), point(20, 80)] } };
const walk = (id: string, points: { x: number; y: number }[], floor: string | null, start: string | null, end: string | null): CampusSceneElement => ({ id, kind: "path", label: id, space_id: null, floor_id: floor, parent_element_id: floor ? building.id : null, review_state: "reviewed", geometry: { type: "polyline", points }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end } });
const connector = (kind: "entrance" | "stairs" | "lift", p: { x: number; y: number }, from: string | null): CampusSceneElement => ({ id: kind, kind: "fixture", label: `East ${kind}`, asset_key: "equipment", parent_element_id: building.id, floor_id: from, space_id: null, review_state: "reviewed", geometry: { type: "point", points: [p] }, navigation_connector: { kind, from_floor_id: from, to_floor_id: from ? "first" : "ground", accessible: kind !== "stairs", status: "open" } });
function document(): CampusSceneDocument { return { schema_version: 1, name: "Learning campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed fictional floor plan" }, elements: [building,
  { ...building, id: "room", kind: "room", label: "Room 201", space_id: "room-place", parent_element_id: building.id, floor_id: "first", geometry: { type: "polygon", points: [point(25, 20), point(35, 20), point(35, 30), point(25, 30)] } },
  walk("outdoor", [point(10, 90), point(50, 80)], null, "gate", "building-place"), walk("ground-corridor", [point(50, 80), point(40, 50), point(60, 50)], "ground", null, null), walk("first-corridor", [point(60, 50), point(40, 50), point(30, 30)], "first", null, "room-place"), connector("entrance", point(50, 80), null), connector("stairs", point(40, 50), "ground"), connector("lift", point(60, 50), "ground"),
] }; }
const places: CampusScenePublished["places"] = [{ id: "gate", name: "Main gate", code: "G", kind: "gate", parent_space_id: null }, { id: "building-place", name: "Learning block", code: "L", kind: "building", parent_space_id: null }, { id: "ground", name: "Ground floor", code: "0", kind: "floor", parent_space_id: "building-place" }, { id: "first", name: "First floor", code: "1", kind: "floor", parent_space_id: "building-place" }, { id: "room-place", name: "Room 201", code: "201", kind: "classroom", parent_space_id: "first" }];
describe("explicit entrance and cross-floor campus journey", () => {
  it("routes entrance→corridor→stairs→exact room with reversible steps and no invented vertical distance", () => {
    const scene = document(), result = findSceneWalkingRoute(scene, { fromSpaceId: "gate", toSpaceId: "room-place" });
    expect(result).toMatchObject({ status: "available", transitionCount: 2 });
    if (result.status !== "available") throw new Error("Route missing");
    expect(result.legs?.map(leg => leg.kind)).toEqual(["walk", "entrance", "walk", "stairs", "walk"]);
    expect(result.segments.map(segment => segment.floorId)).toEqual([null, "ground", "first"]);
    expect(result.length).toBeCloseTo(Math.hypot(40, 10) + Math.hypot(10, 30) + Math.hypot(10, 20));
    expect(findSceneWalkingRoute(scene, { fromSpaceId: "room-place", toSpaceId: "gate" })).toMatchObject({ status: "available", legs: [expect.anything(), expect.objectContaining({ kind: "stairs", fromFloorId: "first", toFloorId: "ground" }), expect.anything(), expect.objectContaining({ kind: "entrance", fromFloorId: "ground", toFloorId: null }), expect.anything()] });
  });
  it("uses a reviewed lift for step-free requests and excludes known faults, closed and unreviewed connectors", () => {
    const scene = document(), request = { fromSpaceId: "gate", toSpaceId: "room-place", accessibleOnly: true };
    const stepFree = findSceneWalkingRoute(scene, request);
    expect(stepFree.status).toBe("available");
    if (stepFree.status === "available") expect(stepFree.legs?.some(leg => leg.kind === "lift")).toBe(true);
    expect(findSceneWalkingRoute(scene, { ...request, excludedConnectorIds: ["lift"] })).toMatchObject({ status: "unavailable", reason: "no_path" });
    scene.elements.find(element => element.id === "lift")!.navigation_connector!.status = "closed";
    expect(findSceneWalkingRoute(scene, request)).toMatchObject({ status: "unavailable" });
    scene.elements.find(element => element.id === "entrance")!.review_state = "needs_review";
    expect(findSceneWalkingRoute(scene, { ...request, accessibleOnly: false })).toMatchObject({ status: "unavailable" });
  });
  it("never snaps nearby landings and retains original global coordinates and drawing scale inside", () => {
    const scene = document(), original = structuredClone(scene), floor = sceneInteriorView(scene, building, "first");
    expect(floor.document.bounds).toEqual(scene.bounds);
    expect(floor.document.elements.find(item => item.id === "first-corridor")!.geometry.points[0]).toEqual(point(60, 50));
    expect(floor.document.elements.some(item => item.id === "lift")).toBe(true); expect(floor.document.elements.some(item => item.id === "outdoor")).toBe(false);
    expect(sceneBuildingFloorIds(scene, building)).toEqual(["first", "ground"]); expect(scene).toEqual(original);
    scene.elements.find(item => item.id === "stairs")!.geometry.points[0]!.x += .01;
    scene.elements.find(item => item.id === "lift")!.navigation_connector!.status = "closed";
    expect(findSceneWalkingRoute(scene, { fromSpaceId: "gate", toSpaceId: "room-place" })).toMatchObject({ status: "unavailable" });
  });
  it("offers selected-room directions without an assignment and opens the exact floor plan", async () => {
    render(<CampusScenePublishedView data={{ campus: { id: "campus", name: "Campus", code: "C", timezone: "UTC" }, can_edit: false, places, scene: { id: "scene", version: 1, published_at: "2026-10-26T00:00:00Z", document: document() } }} />);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Place name" }), "Room 201");
    await userEvent.click(screen.getByText("Room 201", { exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Starting place" }), "gate");
    expect(screen.getByLabelText("Route state")).toHaveTextContent("available"); expect(screen.getByLabelText("Map floor")).toHaveTextContent("outdoors");
    await userEvent.click(screen.getByText("Route steps · 2 connections", { exact: true }));
    await userEvent.click(screen.getAllByRole("button", { name: "Show First floor" })[0]!);
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByLabelText("Map floor")).toHaveTextContent("first"); expect(screen.getByLabelText("Drawn scene")).toHaveTextContent('"x":60,"y":50');
    await userEvent.click(screen.getByRole("checkbox", { name: "Step-free route only" }));
    expect(screen.getByText("Take the lift · East lift")).toBeVisible();
  });
  it("restores generic room directions, origin, step-free preference and selected floor after a source action and Back", async () => {
    function Session() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(-1)}>Return to map</button>; }
    const data: CampusScenePublished = { campus: { id: "campus", name: "Campus", code: "C", timezone: "UTC" }, can_edit: false, places, scene: { id: "scene", version: 1, published_at: "2026-10-26T00:00:00Z", document: document() } };
    const personal = { selection: null, onSelectPlace: vi.fn(), walkingRoute: null, controls: null, placeDetails: () => <Link to="/session">Open source session</Link> };
    render(<MemoryRouter><Routes><Route path="/" element={<CampusScenePublishedView data={data} personal={personal} />} /><Route path="/session" element={<Session />} /></Routes></MemoryRouter>);
    const chooseRoom = async () => { await userEvent.click(screen.getByRole("button", { name: "Find a place" })); const list = within(screen.getByRole("region", { name: "Find a campus place" })); const search = list.getByRole("searchbox", { name: "Place name" }); await userEvent.clear(search); await userEvent.type(search, "Room 201"); await userEvent.click(list.getByText("Room 201", { exact: true })); };
    await chooseRoom(); await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Starting place" }), "gate");
    await userEvent.click(screen.getByRole("checkbox", { name: "Step-free route only" }));
    await userEvent.click(screen.getByText("Route steps · 2 connections", { exact: true }));
    await userEvent.click(screen.getAllByRole("button", { name: "Show First floor" })[0]!);
    await chooseRoom(); await userEvent.click(screen.getByText("Activity at this place")); await userEvent.click(screen.getByRole("link", { name: "Open source session" }));
    await userEvent.click(screen.getByRole("button", { name: "Return to map" }));
    await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    expect(screen.getByRole("combobox", { name: "Starting place" })).toHaveValue("gate");
    expect(screen.getByRole("checkbox", { name: "Step-free route only" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByLabelText("Route state")).toHaveTextContent("available");
  });
});
