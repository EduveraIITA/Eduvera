import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampusScenePublishedView } from "./CampusScenePublishedView";
import type { CampusScenePublished } from "./api";
import type { CampusSceneOperationsBridge } from "./sceneOperations.types";

afterEach(cleanup);
function publication(): CampusScenePublished {
  return {
      campus: { id: "main", name: "Main campus", code: "MAIN" }, can_edit: false,
      places: [{ id: "building-place", name: "Learning building", code: "LB", kind: "building", parent_space_id: null }, { id: "floor", name: "First floor", code: "F1", kind: "floor", parent_space_id: "building-place" }, { id: "room-place", name: "Reading room", code: "R1", kind: "library", parent_space_id: "floor" }],
      scene: { id: "scene", version: 1, published_at: "2026-10-25T12:00:00Z", document: {
        schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Campus plan" },
        elements: [
          { id: "building", kind: "building", label: "Learning building", geometry: { type: "polygon", points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 10, y: 40 }] }, space_id: "building-place", floor_id: null, review_state: "reviewed", levels: 2 },
          { id: "room", kind: "room", label: "Reading room", parent_element_id: "building", geometry: { type: "polygon", points: [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }] }, space_id: "room-place", floor_id: "floor", review_state: "reviewed" },
        ],
      } },
    };
}

describe("published floor experience", () => {
  it("keeps raw canonical codes and duplicate place labels out of public place details", () => {
    const data = publication();
    data.places.push({ id: "building-place", name: "Learning building", code: "IIITA-DEMO-RAW-PLACE", kind: "building", parent_space_id: null });
    render(<CampusScenePublishedView data={data} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 2 floors" }), { key: "Enter" });
    const detail = screen.getByRole("region", { name: "Learning building explorer" });
    expect(detail).not.toHaveTextContent("IIITA-DEMO-RAW-PLACE");
    expect(screen.getAllByRole("heading", { name: "Learning building", exact: true })).toHaveLength(1);
    expect(detail).toHaveTextContent("Mapped places");
    expect(detail.querySelectorAll(".campus-building-explorer__actions")).toHaveLength(1);
  });
  it.each(["2.5d", "2d"] as const)("retains the chosen %s outdoor mode after exploring a floor and returning to Campus", mode => {
    const { container } = render(<CampusScenePublishedView data={publication()} />);
    if (mode === "2d") { fireEvent.click(screen.getByRole("button", { name: "Map tools" })); fireEvent.click(screen.getByRole("button", { name: "Flat plan" })); }
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 2 floors" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    expect(container.querySelector(".campus-scene-canvas")).toHaveAttribute("data-mode", "2d");
    fireEvent.click(screen.getByRole("button", { name: "Campus" }));
    expect(container.querySelector(".campus-scene-canvas")).toHaveAttribute("data-mode", mode);
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    expect(screen.getByRole("button", { name: mode === "2d" ? "Flat plan" : "2.5D" })).toHaveAttribute("aria-pressed", "true");
  });
  it("opens a marker's authorized evidence and never changes the authored campus geometry", () => {
    const data = publication(), original = JSON.stringify(data.scene?.document);
    const bridge: CampusSceneOperationsBridge = {
      markersFor: vi.fn(() => [{ id: "expected:building", elementId: "building", dimension: "expected", count: 1, label: "Expected · Learning building", summary: "One recorded scheduled assignment" }]),
      selectedSpaceId: null, selectedMarkerId: null, unavailableFixtureIds: [], onSelectPlace: vi.fn(), onInspectPlace: vi.fn(), onSelectMarker: vi.fn(), controls: <p>Authorized activity layers</p>,
      mapControls: <select aria-label="Activity layer" defaultValue="none"><option value="none">Layout only</option><option value="expected">Expected activity</option></select>,
    };
    const { rerender, container } = render(<CampusScenePublishedView data={data} operations={bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Campus activity" }));
    const operationalControls = screen.getByText("Authorized activity layers");
    expect(operationalControls).toBeVisible();
    expect(container.querySelector(".campus-scene-map-frame")).toContainElement(container.querySelector(".campus-scene-canvas"));
    fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
    expect(screen.getByRole("combobox", { name: "Activity layer" })).toBeVisible();
    expect(screen.queryByText("Authorized activity layers")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: /Expected · Learning building/ }), { key: "Enter" });
    expect(bridge.onSelectMarker).toHaveBeenCalledWith("expected:building");
    rerender(<CampusScenePublishedView data={data} operations={{ ...bridge, selectedSpaceId: "building-place" }} />);
    expect(screen.getByRole("region", { name: "Learning building explorer" })).toBeVisible();
    expect(Number(container.querySelector(".campus-scene-label-background")?.getAttribute("y"))).toBeGreaterThanOrEqual(72);
    rerender(<CampusScenePublishedView data={data} operations={{ ...bridge, selectedSpaceId: "unmapped-place" }} />);
    expect(screen.queryByRole("region", { name: "Learning building explorer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learning building, building, 2 floors" })).toBeVisible();
    expect(JSON.stringify(data.scene?.document)).toBe(original);
  });
  it("retains the building outline and actual room cutaway while the hierarchy stays available", () => {
    const data = publication();
    const { container } = render(<CampusScenePublishedView data={data} />);
    expect(screen.queryByRole("combobox", { name: "Activity layer" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 2 floors" }), { key: "Enter" });
    expect(screen.getByText("2 floors · 2 mapped places")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show Reading room on map" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(container.querySelector("[data-interior-outline]")).toHaveAttribute("points", "10,10 50,10 50,40 10,40");
    expect(container.querySelectorAll("[data-scene-element]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reading room, room" })).toBeVisible();
    expect(container.querySelector("[data-room-floor=room] [data-room-wall]")).toHaveAttribute("points", "15,15 25,15 25,25 15,25");
    expect(container.querySelector("[data-room-floor=room] pattern")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Learning building explorer" })).toBeVisible();
  });
});
