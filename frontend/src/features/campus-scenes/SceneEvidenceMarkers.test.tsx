import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEvidenceMarkers } from "./SceneEvidenceMarkers";
import type { SceneEvidenceMarker } from "./sceneOperations.types";
import type { CampusSceneElement } from "./types";

afterEach(cleanup);
const element: CampusSceneElement = { id: "courtyard", kind: "surface", label: "Courtyard", space_id: "place", floor_id: null, review_state: "reviewed",
  geometry: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 60 }, { x: 20, y: 60 }] } };
const marker: SceneEvidenceMarker = { id: "activity", elementId: element.id, dimension: "expected", count: 2, label: "Scheduled activity", summary: "Two current source records", expectedCount: 60 };

describe("campus source evidence markers", () => {
  it("opens a source marker by touch or keyboard without starting a map gesture", () => {
    const select = vi.fn(), pan = vi.fn(), click = vi.fn();
    const { rerender } = render(<svg onPointerDown={pan} onPointerUp={pan} onClick={click}>
      <SceneEvidenceMarkers markers={[marker]} elements={[element]} mode="2.5d" unit={1} viewport={{ x: 0, y: 0, scale: 2 }} size={{ width: 800, height: 600 }} onSelectMarker={select}/>
    </svg>);
    const button = screen.getByRole("button", { name: "Scheduled activity. Two current source records" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.pointerDown(button); fireEvent.pointerUp(button); fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" }); fireEvent.keyDown(button, { key: " " });
    expect(select).toHaveBeenCalledTimes(3);
    expect(select).toHaveBeenLastCalledWith(marker.id);
    expect(pan).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
    rerender(<svg><SceneEvidenceMarkers markers={[marker]} elements={[element]} mode="2.5d" unit={1} viewport={{ x: 0, y: 0, scale: 2 }} size={{ width: 800, height: 600 }} selectedMarkerId={marker.id} onSelectMarker={select}/></svg>);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector(".scene-evidence-marker__count")).toHaveTextContent("2");
  });

  it("moves its anchor with the camera while keeping the source record pill and touch target a fixed screen size", () => {
    const original = structuredClone(element);
    const { container, rerender } = render(<svg><SceneEvidenceMarkers markers={[marker]} elements={[element]} mode="2d" unit={1} viewport={{ x: 0, y: 0, scale: 2 }} size={{ width: 800, height: 600 }}/></svg>);
    const background = container.querySelector(".scene-evidence-marker__background")!, leader = container.querySelector(".scene-evidence-marker__leader")!;
    const initial = leader.getAttribute("d"), width = background.getAttribute("width");
    rerender(<svg><SceneEvidenceMarkers markers={[marker]} elements={[element]} mode="2d" unit={1} viewport={{ x: 35, y: 40, scale: 3 }} size={{ width: 800, height: 600 }}/></svg>);
    expect(leader).not.toHaveAttribute("d", initial);
    expect(background).toHaveAttribute("width", width);
    expect(container.querySelector('rect[fill="transparent"]')).toHaveAttribute("height", "44");
    expect(element).toEqual(original);
  });

  it("retains pressure and fault evidence without turning record counts into a people count", () => {
    const evidence: SceneEvidenceMarker = { ...marker, count: 120, dimension: "observed", tone: "attention", plannedCapacityPressure: { expectedCount: 60, capacity: 40 } };
    const { container } = render(<svg><SceneEvidenceMarkers markers={[evidence]} elements={[element]} mode="2d" unit={1} viewport={{ x: 0, y: 0, scale: 2 }} size={{ width: 800, height: 600 }}/></svg>);
    expect(container.querySelector("[data-evidence-marker]")).toHaveAttribute("data-dimension", "observed");
    expect(container.querySelector("[data-evidence-marker]")).toHaveAttribute("data-tone", "attention");
    expect(container.querySelector(".scene-evidence-marker__count")).toHaveTextContent("99+");
    expect(container.querySelector(".scene-evidence-marker__pressure")).toHaveTextContent("!");
    expect(container.querySelector(".scene-evidence-marker__background")).toHaveAttribute("width", "70");
    expect(container.textContent).not.toMatch(/present now|tracked person|occupied|60 people/iu);
  });
});
