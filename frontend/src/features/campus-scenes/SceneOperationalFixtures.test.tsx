import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SceneAssetDrawing } from "./SceneAssetDrawing";
import type { CampusSceneElement } from "./types";

afterEach(cleanup);
const fixture: CampusSceneElement = { id: "fixture", label: "Campus asset", kind: "fixture", geometry: { type: "point", points: [{ x: 25, y: 30 }] }, space_id: null, floor_id: null, width: 2.4, height: 1.8, review_state: "reviewed" };

describe("editable operational scene fixtures", () => {
  it.each(["water_point", "equipment"] as const)("renders a distinct %s in plan and perspective for both themes without moving its authored point", asset => {
    const element = { ...fixture, asset_key: asset }, original = structuredClone(element);
    for (const mode of ["2d", "2.5d"] as const) for (const lighting of ["day", "night"] as const) {
      const { container, unmount } = render(<svg><SceneAssetDrawing element={element} mode={mode} lighting={lighting} unit={1} /></svg>);
      expect(container.querySelector(`[data-operational-fixture="${asset}"]`)).not.toBeNull();
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
      expect(container.querySelector("[data-illustrative-lamp-glow]")).toBeNull();
      expect(element).toEqual(original); unmount();
    }
  });
  it.each(["entrance", "stairs", "lift"] as const)("renders an explicit %s connector as a floor-plan symbol rather than a bench", kind => {
    const element: CampusSceneElement = { ...fixture, navigation_connector: { kind, status: "open", accessible: kind !== "stairs", from_floor_id: kind === "entrance" ? null : "floor-a", to_floor_id: "floor-b" } };
    const original = structuredClone(element);
    const { container } = render(<svg><SceneAssetDrawing element={element} mode="2d" unit={1} /></svg>);
    expect(container.querySelector(`[data-navigation-fixture="${kind}"]`)).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(element).toEqual(original);
  });
});
