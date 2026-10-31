import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CampusScenePublishedView } from "./CampusScenePublishedView";
import { CampusMapWorkspace } from "./CampusMapWorkspace";
import type { CampusScenePublished } from "./api";
import type { CampusSceneOperationsBridge } from "./sceneOperations.types";
import { readCampusMapPresentation, type CampusMapPanel } from "./sceneMapPresentation";
import type { CampusOperationalBridge } from "../campus-view/campusOperational.types";

const fixture = (): CampusScenePublished => ({ campus: { id: "campus", name: "Kadamba campus", code: "KC" }, can_edit: false,
  places: [{ id: "library-place", name: "River Library", code: "LIB", kind: "building", parent_space_id: null }, { id: "arts-place", name: "Arts House", code: "ART", kind: "building", parent_space_id: null }],
  scene: { id: "scene", version: 1, published_at: "2026-10-27T08:00:00Z", document: { schema_version: 1, name: "Kadamba", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed campus plan", attribution: "Campus team" }, elements: ["River Library", "Arts House"].map((label, index) => ({ id: `building-${index}`, kind: "building", label, space_id: index ? "arts-place" : "library-place", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 10 + index * 40, y: 10 }, { x: 40 + index * 40, y: 10 }, { x: 40 + index * 40, y: 40 }, { x: 10 + index * 40, y: 40 }] } })) } } });
afterEach(() => { cleanup(); document.body.style.overflow = ""; });
function Location() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Current map URL">{location.search}</output><button type="button" onClick={() => void navigate(-1)}>Browser Back</button></>; }
function UrlPersonalBridge({ data = fixture() }: { data?: CampusScenePublished }) {
  const [params, setParams] = useSearchParams(), [token, setToken] = useState(0);
  const spaceId = params.get("campus_space"), intent = params.get("campus_focus") === "journey" ? "journey" as const : "explore" as const;
  return <CampusScenePublishedView data={data} personal={{
    selection: spaceId ? { spaceId, intent, token, view: params.get("campus_view") === "outside" ? "outside" : "place" } : null,
    controls: <p>My planned day</p>, walkingRoute: null, placeDetails: () => null,
    onSelectPlace: id => { const next = new URLSearchParams(params); if (id) next.set("campus_space", id); else next.delete("campus_space"); next.set("campus_focus", "explore"); next.set("campus_view", "place"); setParams(next, { replace: true }); setToken(value => value + 1); },
  }} />;
}
const chooseLibrary = () => fireEvent.keyDown(screen.getByRole("button", { name: "River Library, building" }), { key: "Enter" });
function ToolsWorkspace({ hasPersonal, hasOperations }: { hasPersonal: boolean; hasOperations: boolean }) {
  const [panel, setPanel] = useState<CampusMapPanel | null>(null);
  const titles: Partial<Record<CampusMapPanel, string>> = { day: "My campus day", layers: "Layers and view", operations: "Campus activity", information: "About this map" };
  return <CampusMapWorkspace map={<div aria-label="Map drawing" />} panel={panel} title={panel ? titles[panel] ?? panel : "Campus map"} panelContent={<p>{panel} content</p>} onPanel={setPanel} expanded={false} onExpanded={() => undefined} dialogOpen={false} hasPersonal={hasPersonal} hasOperations={hasOperations} />;
}

describe("persistent campus map workspace", () => {
  it.each([{ hasPersonal: false, hasOperations: false }, { hasPersonal: true, hasOperations: false }, { hasPersonal: true, hasOperations: true }])("keeps occasional tools off the map and respects personal=$hasPersonal / operations=$hasOperations", ({ hasPersonal, hasOperations }) => {
    render(<ToolsWorkspace hasPersonal={hasPersonal} hasOperations={hasOperations} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "My day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Campus activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "About this map" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    const tools = within(screen.getByRole("navigation", { name: "Campus map tools" }));
    expect(Boolean(tools.queryByRole("button", { name: "My day" }))).toBe(hasPersonal);
    expect(Boolean(tools.queryByRole("button", { name: "Campus activity" }))).toBe(hasOperations);
    expect(tools.getByRole("button", { name: "About this map" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Map tools" })).toHaveTextContent("layers content");
  });
  it("returns focus to the persistent tools launcher after a contextual tool closes", async () => {
    render(<ToolsWorkspace hasPersonal hasOperations />);
    const launcher = screen.getByRole("button", { name: "Map tools" });
    for (const name of ["My day", "Campus activity", "About this map"]) {
      await userEvent.click(launcher);
      await userEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByRole("navigation", { name: "Campus map tools" })).not.toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      expect(launcher).toHaveFocus();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    }
    await userEvent.click(launcher);
    await userEvent.click(screen.getByRole("button", { name: "About this map" }));
    await userEvent.click(screen.getByRole("button", { name: "Close map panel" }));
    expect(launcher).toHaveFocus();
  });
  it("keeps the same map and manual camera when panels and full screen change", () => {
    const onExpandedChange = vi.fn();
    const { container } = render(<CampusScenePublishedView data={fixture()} onExpandedChange={onExpandedChange} expandedContext={<p>Simulation time and recovery</p>} />);
    const canvas = container.querySelector(".campus-scene-canvas"), svg = container.querySelector(".campus-scene-svg");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const transform = container.querySelector(".campus-scene-svg > g")?.getAttribute("transform");
    for (const name of ["Find a place", "Map tools", "About this map", "Full screen map"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByText("Simulation time and recovery")).toBeVisible();
    expect(container.querySelector(".campus-scene-canvas")).toBe(canvas);
    expect(container.querySelector(".campus-scene-svg")).toBe(svg);
    expect(container.querySelector(".campus-scene-svg > g")?.getAttribute("transform")).toBe(transform);
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Simulation time and recovery")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen map" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(container.querySelector(".campus-scene-canvas")).toBe(canvas);
  });
  it("shows one active task, keeps search on return and returns directions to place details", () => {
    render(<CampusScenePublishedView data={fixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a place" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Place name" }), { target: { value: "River" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Find a campus place" })).getByRole("button", { name: /River Library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    expect(screen.getByRole("region", { name: "Place directions" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "River Library explorer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close place directions" }));
    expect(screen.getByRole("region", { name: "River Library explorer" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find a place" }));
    expect(screen.getByRole("searchbox", { name: "Place name" })).toHaveValue("River");
  });
  it("closes search with Escape and restores its launcher focus", async () => {
    render(<CampusScenePublishedView data={fixture()} />);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    expect(document.activeElement).toHaveClass("campus-map-workspace__panel-content");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Find a campus place" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find a place" })).toHaveFocus();
  });
  it("suspends map interaction for native dialogs and gives them Escape priority", () => {
    const operations: CampusSceneOperationsBridge = { markersFor: () => [], selectedSpaceId: null, selectedMarkerId: null, unavailableFixtureIds: [], onSelectPlace: vi.fn(), onInspectPlace: vi.fn(), onSelectMarker: vi.fn(), controls: <p>Authorized source actions</p>, dialogOpen: false };
    const { container, rerender } = render(<CampusScenePublishedView data={fixture()} operations={operations} />);
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Campus activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Full screen map" }));
    rerender(<CampusScenePublishedView data={fixture()} operations={{ ...operations, dialogOpen: true }} />);
    expect(container.querySelector(".campus-map-workspace__body")).toHaveAttribute("inert");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".campus-map-workspace")).toHaveClass("campus-map-workspace--expanded");
    const nativeTrigger = document.createElement("button"); document.body.append(nativeTrigger); nativeTrigger.focus();
    rerender(<CampusScenePublishedView data={fixture()} operations={operations} />);
    expect(nativeTrigger).toHaveFocus(); nativeTrigger.remove();
    expect(screen.getByText("Authorized source actions")).toBeVisible();
  });
  it("clears a manual destination when a different building is selected", () => {
    render(<CampusScenePublishedView data={fixture()} />);
    chooseLibrary(); fireEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Arts House, building" }), { key: "Enter" });
    expect(screen.getByRole("region", { name: "Arts House explorer" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Place directions" })).not.toBeInTheDocument();
  });
  it("preserves unrelated URL params and native bridge selections in the same event", async () => {
    function NativeBridge() {
      const [params, setParams] = useSearchParams();
      return <CampusScenePublishedView data={fixture()} personal={{ selection: null, walkingRoute: null, controls: null, placeDetails: () => null, onSelectPlace: id => { const next = new URLSearchParams(params); next.set("campus_space", id ?? ""); setParams(next, { replace: true }); } }} />;
    }
    render(<MemoryRouter initialEntries={["/?keep=retained&journey=my-day"]}><NativeBridge /><Location /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Find a campus place" })).getByRole("button", { name: /River Library/ }));
    const url = screen.getByLabelText("Current map URL").textContent;
    expect(url).toContain("keep=retained"); expect(url).toContain("journey=my-day"); expect(url).toContain("campus_space=library-place"); expect(url).toContain("map_place=building-0"); expect(url).toContain("map_panel=place");
  });
  it("uses Back to exit full screen while retaining the chosen perspective and map DOM", async () => {
    const { container } = render(<MemoryRouter initialEntries={["/?keep=retained"]}><CampusScenePublishedView data={fixture()} /><Location /></MemoryRouter>);
    const map = container.querySelector(".campus-scene-canvas");
    await userEvent.click(screen.getByRole("button", { name: "Full screen map" }));
    await userEvent.click(screen.getByRole("button", { name: "Map tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Flat plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Browser Back" }));
    expect(screen.getByRole("button", { name: "Full screen map" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Flat plan" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("keep=retained");
    expect(container.querySelector(".campus-scene-canvas")).toBe(map);
  });
  it("restores search, selection and perspective from a scoped URL after remount", async () => {
    const scoped = "/?map_context=campus%3Alive%3Aglobal&map_panel=search&map_search=River&map_mode=2d&map_place=building-0&keep=1";
    const first = render(<MemoryRouter initialEntries={[scoped]}><CampusScenePublishedView data={fixture()} /></MemoryRouter>);
    expect(screen.getByRole("searchbox", { name: "Place name" })).toHaveValue("River");
    expect(first.container.querySelector(".campus-scene-canvas")).toHaveAttribute("data-mode", "2d");
    first.unmount();
    const second = render(<MemoryRouter initialEntries={[scoped]}><CampusScenePublishedView data={fixture()} /></MemoryRouter>);
    expect(screen.getByRole("searchbox", { name: "Place name" })).toHaveValue("River");
    expect(second.container.querySelector(".campus-scene-canvas")).toHaveAttribute("data-mode", "2d");
    await userEvent.click(within(screen.getByRole("region", { name: "Find a campus place" })).getByRole("button", { name: /River Library/ }));
    expect(screen.getByRole("region", { name: "River Library explorer" })).toBeVisible();
  });
  it("keeps a closed panel closed when retained directions still exist in the URL", async () => {
    render(<MemoryRouter><CampusScenePublishedView data={fixture()} /><Location /></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    await userEvent.click(screen.getByRole("button", { name: "Close place directions" }));
    await userEvent.click(screen.getByRole("button", { name: "Close place details" }));
    expect(screen.queryByRole("region", { name: "Place directions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "River Library explorer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("map_panel=closed");
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("map_to=library-place");
  });
  it("removes the previous destination URL when a different building is selected", async () => {
    render(<MemoryRouter><CampusScenePublishedView data={fixture()} /><Location /></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("map_to=library-place");
    fireEvent.keyDown(screen.getByRole("button", { name: "Arts House, building" }), { key: "Enter" });
    await screen.findByRole("region", { name: "Arts House explorer" });
    expect(screen.getByLabelText("Current map URL")).not.toHaveTextContent("map_to=");
  });
  it("shows a canonical place once even when several outlines share it", async () => {
    const data = fixture(), original = data.scene!.document.elements[0]!;
    data.scene!.document.elements.push({ ...original, id: "library-wing" });
    data.scene!.document.elements.push({ ...original, id: "another-library", space_id: "other-library" });
    render(<CampusScenePublishedView data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    const list = within(screen.getByRole("region", { name: "Find a campus place" }));
    expect(list.getAllByRole("button", { name: /River Library/ })).toHaveLength(2);
  });
  it("focuses a selected place, preserves manual camera through panels and refits the campus on demand", () => {
    const { container, rerender } = render(<CampusScenePublishedView data={fixture()} />);
    const camera = () => container.querySelector(".campus-scene-svg > g")?.getAttribute("transform");
    const initial = camera(); chooseLibrary();
    expect(camera()).not.toBe(initial);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" })); const manual = camera();
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Full screen map" }));
    rerender(<CampusScenePublishedView data={fixture()} />);
    expect(camera()).toBe(manual);
    fireEvent.click(screen.getByRole("button", { name: "Fit campus" }));
    expect(camera()).toBe(initial);
  });
  it("keeps native URL-derived selection coherent and consumes exactly one expanded history entry", async () => {
    render(<MemoryRouter initialEntries={["/before", "/?keep=1"]} initialIndex={1}><UrlPersonalBridge /><Location /></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Full screen map" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Arts House, building" }), { key: "Enter" });
    await screen.findByRole("region", { name: "Arts House explorer" });
    await userEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByRole("region", { name: "Arts House explorer" })).toBeVisible();
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("campus_space=arts-place");
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("map_place=building-1");
    await userEvent.click(screen.getByRole("button", { name: "Browser Back" }));
    expect(screen.getByLabelText("Current map URL").textContent).toBe("");
  });
  it("keeps canonical floor and native place context coherent and restores the floor on refresh", async () => {
    const data = fixture();
    data.places.push({ id: "floor", kind: "floor", name: "First floor", code: "F1", parent_space_id: "library-place" });
    data.scene!.document.elements.push({ ...data.scene!.document.elements[0]!, id: "room", kind: "room", label: "Reading room", space_id: null, floor_id: "floor", parent_element_id: "building-0" });
    const first = render(<MemoryRouter><UrlPersonalBridge data={data} /><Location /></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByRole("button", { name: "Reading room, room" })).toBeVisible();
    const url = screen.getByLabelText("Current map URL").textContent;
    expect(url).toContain("campus_space=floor"); expect(url).toContain("map_space=floor"); expect(url).toContain("map_view_floor=floor");
    first.unmount();
    render(<MemoryRouter initialEntries={[`/${url}`]}><UrlPersonalBridge data={data} /></MemoryRouter>);
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByRole("button", { name: "Reading room, room" })).toBeVisible();
  });
  it("restores the parent search panel's scroll after place details", async () => {
    const { container } = render(<CampusScenePublishedView data={fixture()} />);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    const panel = container.querySelector(".campus-map-workspace__panel-content")!;
    fireEvent.scroll(panel, { target: { scrollTop: 240 } });
    await userEvent.click(within(screen.getByRole("region", { name: "Find a campus place" })).getByRole("button", { name: /River Library/ }));
    expect(panel.scrollTop).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Find a place" }));
    expect(panel.scrollTop).toBe(240);
  });
  it("retains the building hierarchy and panel scroll while selecting a room and restores its canonical selection", async () => {
    const data = fixture();
    data.places.push({ id: "floor", kind: "floor", name: "First floor", code: "F1", parent_space_id: "library-place" },
      { id: "reading-place", kind: "library", name: "Reading room", code: "R1", parent_space_id: "floor", capacity: 24 });
    data.scene!.document.elements.push({ ...data.scene!.document.elements[0]!, id: "room", kind: "room", label: "Reading room", space_id: "reading-place", floor_id: "floor", parent_element_id: "building-0" });
    const view = render(<MemoryRouter><CampusScenePublishedView data={data} /><Location /></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    const explorer = screen.getByRole("region", { name: "River Library explorer" });
    const panel = view.container.querySelector(".campus-map-workspace__panel-content")!;
    fireEvent.scroll(panel, { target: { scrollTop: 180 } });
    await userEvent.click(screen.getByRole("button", { name: "Show Reading room on map" }));
    expect(screen.getByRole("region", { name: "River Library explorer" })).toBe(explorer);
    expect(panel.scrollTop).toBe(180);
    expect(screen.getByRole("button", { name: "Show Reading room on map" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    const url = screen.getByLabelText("Current map URL").textContent;
    expect(url).toContain("map_space=reading-place"); expect(url).toContain("map_place=room");
    view.unmount();
    render(<MemoryRouter initialEntries={[`/${url}`]}><CampusScenePublishedView data={data} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Show Reading room on map" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("region", { name: "Selected place context" })).toHaveTextContent("Capacity 24");
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
  });
  it("opens a bound room-resource report once and restores the selected resource and floor after native Back", async () => {
    const data = fixture();
    data.places.push({ id: "floor", kind: "floor", name: "First floor", code: "F1", parent_space_id: "library-place" },
      { id: "reading-place", kind: "library", name: "Reading room", code: "R1", parent_space_id: "floor" });
    const shape = data.scene!.document.elements[0]!;
    data.scene!.document.elements.push({ ...shape, id: "room", kind: "room", label: "Reading room", space_id: "reading-place", floor_id: "floor", parent_element_id: "building-0" },
      { ...shape, id: "projector", kind: "fixture", label: "Reading room projector", space_id: null, holding_id: "projector-holding", floor_id: "floor", parent_element_id: "building-0", asset_key: "equipment", geometry: { type: "point", points: [{ x: 20, y: 20 }] } });
    const layers: CampusOperationalBridge = { mapControls: null, controls: null, routeWarnings: null, markersFor: () => [], selectedMarkerId: null, onSelectMarker: vi.fn(), selectedAssetElementId: null, onSelectAsset: vi.fn(), faultLampIds: [], blockedConnectorIds: [], layoutChanged: false, elementDetails: () => null,
      assetsState: "available", assets: [{ element_id: "projector", holding_id: "projector-holding", name: "Reading room projector", asset_tag: "PR-1", space_id: "reading-place", native_state: "available", reportable: true, signal: { state: "unknown", impact: null, open_reports: 0, updated_at: null }, repairs: [] }] };
    function ReportPage() { const navigate = useNavigate(), location = useLocation(); return <><output aria-label="Report destination">{location.search}</output><output aria-label="Report map return">{JSON.stringify(location.state)}</output><button type="button" onClick={() => void navigate(-1)}>Return to campus map</button></>; }
    render(<MemoryRouter initialEntries={["/more/virtual-campus?keep=retained"]}><Routes>
      <Route path="/more/virtual-campus" element={<><CampusScenePublishedView schoolId="school" data={data} campusLayers={layers} /><Location /></>} />
      <Route path="/areas/facilities" element={<ReportPage />} />
    </Routes></MemoryRouter>);
    chooseLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Reading room on map" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Reading room projector, PR-1 on map" }));
    expect(layers.onSelectAsset).toHaveBeenLastCalledWith("projector");
    expect(screen.getByRole("link", { name: "Report problem", exact: true })).toHaveAttribute("href", "/areas/facilities?report=1&space_id=reading-place&holding_id=projector-holding");
    await userEvent.click(screen.getByRole("link", { name: "Report problem", exact: true }));
    expect(screen.getByLabelText("Report destination")).toHaveTextContent("holding_id=projector-holding");
    expect(screen.getByLabelText("Report map return")).toHaveTextContent("map_space=reading-place");
    expect(screen.getByLabelText("Report map return")).toHaveTextContent("map_view_floor=floor");
    await userEvent.click(screen.getByRole("button", { name: "Return to campus map" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByRole("button", { name: "Show Reading room projector, PR-1 on map" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("map_place=projector");
    expect(screen.getByLabelText("Current map URL")).toHaveTextContent("keep=retained");
  });
  it("explains and disables recorded activity until the current native place snapshot is available", () => {
    const inspect = vi.fn();
    const operations: CampusSceneOperationsBridge = { markersFor: () => [], selectedSpaceId: null, selectedMarkerId: null, unavailableFixtureIds: [], onSelectPlace: vi.fn(), onInspectPlace: inspect, onSelectMarker: vi.fn(), controls: null, inspectionState: () => "loading" };
    const { rerender } = render(<CampusScenePublishedView data={fixture()} operations={operations} />);
    chooseLibrary();
    fireEvent.click(screen.getByText("Activity at this place"));
    expect(screen.getByRole("button", { name: "View recorded activity" })).toBeDisabled();
    expect(screen.getByText("Loading recorded activity…")).toBeVisible();
    rerender(<CampusScenePublishedView data={fixture()} operations={{ ...operations, inspectionState: () => "available" }} />);
    fireEvent.click(screen.getByRole("button", { name: "View recorded activity" }));
    expect(inspect).toHaveBeenCalledWith("library-place");
    rerender(<CampusScenePublishedView data={fixture()} operations={{ ...operations, inspectionState: () => "unavailable" }} />);
    expect(screen.getByRole("button", { name: "View recorded activity" })).toBeDisabled();
    expect(screen.getByText(/Recorded activity for this place is unavailable/)).toBeVisible();
  });
  it("ignores all presentation and destination params belonging to a different campus/world", () => {
    const view = readCampusMapPresentation(new URLSearchParams("map_context=other%3Alive&map_full=1&map_mode=2d&map_panel=directions&map_place=building-0&map_to=library-place"), "campus:live", fixture());
    expect(view).toEqual({ panel: null, expanded: false, mode: "2.5d", selectedId: null, spaceId: null, search: "", page: 1, buildingId: null, floorId: null });
  });
});
