import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CampusBuildingExplorer, type CampusBuildingExplorerProps } from "./CampusBuildingExplorer";
import type { CampusSceneElement } from "./types";
import type { BuildingExplorerPlace } from "./sceneBuildingExplorer";

afterEach(cleanup);
const building: CampusSceneElement = { id: "building", kind: "building", label: "Learning building", space_id: "b", floor_id: null, levels: 2, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }] } };
const place = (id: string, name: string, parent: string | null, kind = "classroom"): BuildingExplorerPlace => ({ id, name, code: id, parent_space_id: parent, kind });
function props(overrides: Partial<CampusBuildingExplorerProps> = {}): CampusBuildingExplorerProps {
  return { building, scene: { schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Plan" }, elements: [building,
    { ...building, id: "room-element", kind: "room", space_id: "room", floor_id: "floor", parent_element_id: "building" },
    { ...building, id: "projector", kind: "fixture", space_id: null, holding_id: "h", floor_id: "floor", parent_element_id: "building" }] },
    places: [place("b", "Learning building", null, "building"), place("floor", "First floor", "b", "floor"), { ...place("room", "Seminar room", "floor"), capacity: 24 }, place("unmapped", "Research room", "floor"), place("second", "Second floor", "b", "floor")],
    assets: [{ element_id: "projector", holding_id: "h", name: "Ceiling projector", asset_tag: "PROJ-12", space_id: "room", native_state: "unknown", reportable: true, signal: { state: "unknown", impact: null, open_reports: 0, updated_at: null }, repairs: [] }],
    onSelectPlace: vi.fn(), onSelectResource: vi.fn(), onShowBuilding: vi.fn(), onDirections: vi.fn(), ...overrides };
}
function mount(value: CampusBuildingExplorerProps) {
  return render(<MemoryRouter initialEntries={["/more/virtual-campus?map_view_floor=floor"]}><CampusBuildingExplorer {...value} /></MemoryRouter>);
}

describe("building explorer interaction", () => {
  it("separates keyboard disclosure from map selection and keeps an externally selected resource's path open", async () => {
    const user = userEvent.setup(), value = props({ selectedResourceElementId: "projector" });
    mount(value);
    expect(screen.getByRole("button", { name: "Collapse First floor" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Show Ceiling projector, PROJ-12 on map" })).toHaveAttribute("aria-current", "location");
    screen.getByRole("button", { name: "Collapse First floor" }).focus(); await user.keyboard("{Enter}");
    expect(value.onSelectPlace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Show Ceiling projector, PROJ-12 on map" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand First floor" }));
    await user.click(screen.getByRole("button", { name: "Show Research room on map" }));
    expect(value.onSelectPlace).toHaveBeenCalledWith("unmapped");
    await user.click(screen.getByRole("button", { name: "Show Ceiling projector, PROJ-12 on map" }));
    expect(value.onSelectResource).toHaveBeenCalledWith("projector");
    expect(screen.getByText("Mapped places", { exact: true })).toBeVisible();
    expect(screen.getByText("PROJ-12 · Availability unknown")).toBeVisible();
  });
  it("shows actual selected-place capacity, keeps unknown floor plans honest and gates actions", async () => {
    const value = props({ selectedPlaceId: "room", coverage: "campus", activityContext: <p>Your authorized seminar schedule</p> });
    mount(value);
    expect(screen.getByRole("region", { name: "Selected place context" })).toHaveTextContent("Capacity 24");
    expect(screen.getByRole("button", { name: "Show Second floor on map" })).toHaveTextContent("Not mapped");
    expect(screen.queryByRole("link", { name: "Report problem" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Directions to this place" }));
    expect(value.onDirections).toHaveBeenCalledWith("room");
    await userEvent.click(screen.getByText("Activity at this place"));
    expect(screen.getByText("Your authorized seminar schedule")).toBeVisible();
  });
  it("passes a single prefilled report handoff and scoped map return state to the native Facilities page", async () => {
    function Destination() { const location = useLocation(); return <output aria-label="Report return">{JSON.stringify(location.state)}</output>; }
    const href = "/areas/facilities?report=1&space_id=room&holding_id=h";
    render(<MemoryRouter initialEntries={["/more/virtual-campus?map_view_floor=floor&map_place=room-element"]}><Routes>
      <Route path="/more/virtual-campus" element={<CampusBuildingExplorer {...props({ selectedPlaceId: "room", reportHref: href })} />} />
      <Route path="/areas/facilities" element={<Destination />} />
    </Routes></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Report problem" }); expect(link).toHaveAttribute("href", href);
    const actions = link.closest(".campus-building-explorer__actions")!;
    expect(getComputedStyle(actions).position).toBe("sticky");
    expect(getComputedStyle(actions).top).toBe("0px");
    expect(getComputedStyle(actions).flexWrap).toBe("wrap");
    expect(getComputedStyle(link).minHeight).toBe("44px");
    await userEvent.click(link);
    expect(screen.getByLabelText("Report return")).toHaveTextContent('"portalReturnTo":"/more/virtual-campus?map_view_floor=floor&map_place=room-element"');
  });
  it("bounds large branches, finds resources across descendant paths and preserves explicit unavailable states", async () => {
    const user = userEvent.setup(), value = props({ placesState: "unavailable", assetsState: "unavailable" });
    value.places = [...value.places, ...Array.from({ length: 28 }, (_, index) => place(`lab-${index}`, `Laboratory ${index + 1}`, "floor", "laboratory"))];
    mount(value);
    const region = screen.getByRole("region", { name: "Building places and resources" });
    expect(within(region).getAllByRole("button", { name: /^Show / }).length).toBeLessThanOrEqual(14);
    expect(screen.getByText(/full building directory is unavailable/)).toBeVisible();
    expect(screen.getByText("Resource details are unavailable.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next places" }));
    expect(screen.getByText("2 of 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Find in building" }));
    await user.type(screen.getByRole("searchbox", { name: "Find a place or resource" }), "PROJ-12");
    expect(screen.getByRole("button", { name: "Show Ceiling projector, PROJ-12 on map" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show Laboratory 1 on map" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Find a place or resource" }));
    await user.type(screen.getByRole("searchbox", { name: "Find a place or resource" }), "nothing matches");
    expect(screen.getByText("No matching place or resource in this building.")).toBeVisible();
  });
  it("works in standalone previews and opens a newly selected child path after a collapsed branch", async () => {
    const user = userEvent.setup(), value = props({ reportHref: "/areas/facilities?report=1&space_id=b" });
    const view = render(<CampusBuildingExplorer {...value} />);
    expect(screen.getByRole("link", { name: "Report problem" })).toHaveAttribute("href", "/areas/facilities?report=1&space_id=b");
    await user.click(screen.getByRole("button", { name: "Collapse First floor" }));
    view.rerender(<CampusBuildingExplorer {...value} selectedResourceElementId="projector" />);
    expect(screen.getByRole("button", { name: "Show Ceiling projector, PROJ-12 on map" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse First floor" })).toHaveAttribute("aria-expanded", "true");
  });
  it("distinguishes identically named units by actual asset tags while retaining full source names and identities", async () => {
    const user = userEvent.setup(), value = props({ selectedPlaceId: "room" });
    value.scene = { ...value.scene, elements: [...value.scene.elements,
      { ...value.scene.elements[2]!, id: "computer-2", holding_id: "computer-holding-2" }] };
    value.assets = [{ ...value.assets![0]!, name: "Seminar room · computer", asset_tag: "PC-001" },
      { ...value.assets![0]!, element_id: "computer-2", holding_id: "computer-holding-2", name: "Seminar room · computer", asset_tag: "PC-002" }];
    const view = mount(value);
    const first = screen.getByRole("button", { name: "Show Computer, PC-001 on map" });
    const second = screen.getByRole("button", { name: "Show Computer, PC-002 on map" });
    expect(first).toHaveTextContent("PC-001 · Availability unknown");
    expect(second).toHaveTextContent("PC-002 · Availability unknown");
    expect(first).toHaveAttribute("title", "Seminar room · computer");
    expect(within(first).getByText("Computer", { exact: true })).toBeVisible();
    await user.click(first); expect(value.onSelectResource).toHaveBeenLastCalledWith("projector");
    await user.click(second); expect(value.onSelectResource).toHaveBeenLastCalledWith("computer-2");
    view.rerender(<MemoryRouter><CampusBuildingExplorer {...value} selectedResourceElementId="computer-2" /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "Selected place context" })).toHaveTextContent("Seminar room · computer");
    expect(screen.getByRole("button", { name: "Show Computer, PC-002 on map" })).toHaveAttribute("aria-current", "location");
  });
  it("preserves an untagged name and never strips a similar name belonging to a different canonical place", () => {
    const value = props({ selectedResourceElementId: "projector" });
    value.assets = [{ ...value.assets![0]!, name: "Seminar room annex · computer", asset_tag: null }];
    mount(value);
    const resource = screen.getByRole("button", { name: "Show Seminar room annex · computer on map" });
    expect(resource).toHaveTextContent("Seminar room annex · computer");
    expect(resource).toHaveTextContent("Availability unknown");
    expect(resource).toHaveAttribute("title", "Seminar room annex · computer");
  });
});
