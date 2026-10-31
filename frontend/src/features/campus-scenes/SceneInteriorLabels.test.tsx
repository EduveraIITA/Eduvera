import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { layoutSceneInteriorLabels, SceneInteriorLabels } from "./SceneInteriorLabels";
import type { CampusSceneElement, CampusScenePoint } from "./types";

afterEach(cleanup);
function room(id: string, x = 20, y = 20, width = 160, height = 80, label = "Seminar room"): CampusSceneElement {
  return { id, kind: "room", label, space_id: `${id}-place`, floor_id: "floor", parent_element_id: "building", review_state: "reviewed", geometry: { type: "polygon", points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] } };
}
const size = { width: 600, height: 400 }, viewport = { x: 0, y: 0, scale: 1 };
const layout = (elements: CampusSceneElement[], selectedId?: string) => layoutSceneInteriorLabels({ elements, viewport, size, unit: 1, selectedId });

describe("bounded interior room names", () => {
  it("uses screen coordinates independent of zoom and skips selected, tiny, offscreen and non-room labels", () => {
    const element = room("room"), original = structuredClone(element);
    const first = layout([element])[0]!;
    const moved = layoutSceneInteriorLabels({ elements: [element], viewport: { x: 30, y: 10, scale: 2 }, size, unit: 1 })[0]!;
    expect(moved.x).toBeCloseTo(first.x * 2 + 30);
    expect(moved.y).toBeCloseTo(first.y * 2 + 10);
    expect(moved.width).toBe(first.width);
    expect(layout([element], element.id)).toEqual([]);
    expect(layout([room("tiny", 20, 20, 60, 24), room("outside", 900), { ...room("building"), kind: "building" }])).toEqual([]);
    expect(element).toEqual(original);
  });
  it("wraps at most two lines, truncates long names and avoids camera control insets", () => {
    const elements = [room("long", 20, 80, 120, 80, "Centre for Advanced Distributed Computing and Network Research")];
    const label = layoutSceneInteriorLabels({ elements, viewport, size: { ...size, topInset: 90, bottomInset: 30 }, unit: 1 })[0]!;
    expect(label.lines).toHaveLength(2);
    expect(label.lines.join(" ")).toMatch(/…$/);
    expect(label.y - label.height / 2).toBeGreaterThanOrEqual(94);
    expect(label.y + label.height / 2).toBeLessThanOrEqual(366);
    expect(layoutSceneInteriorLabels({ elements, viewport: { ...viewport, scale: Number.NaN }, size, unit: 1 })).toEqual([]);
  });
  it("keeps names inside concave room geometry and suppresses crowded duplicates", () => {
    const points: CampusScenePoint[] = [{ x: 20, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 170 }, { x: 220, y: 170 }, { x: 220, y: 220 }, { x: 20, y: 220 }];
    const concave = { ...room("concave", 0, 0, 100, 100, "Library"), geometry: { type: "polygon" as const, points } };
    const labels = layout([concave]);
    if (labels.length) {
      const label = labels[0]!;
      expect(label.x < 70 || label.y < 70 || label.y > 170).toBe(true);
    }
    const duplicate = { ...room("fragment"), space_id: "same-place" };
    expect(layout([{ ...room("first"), space_id: "same-place" }, duplicate, { ...room("second"), label: "Another room" }])).toHaveLength(1);
  });
  it("caps a large floor at 80 non-interactive decorative labels and leaves full object names authoritative", () => {
    const elements = Array.from({ length: 200 }, (_, index) => room(String(index), (index % 20) * 200 + 10, Math.floor(index / 20) * 120 + 10));
    const props = { elements, viewport, size: { width: 4200, height: 1400 }, unit: 1 };
    expect(layoutSceneInteriorLabels(props)).toHaveLength(80);
    const { container } = render(<svg><SceneInteriorLabels {...props} /></svg>);
    expect(container.querySelectorAll("[data-interior-label]")).toHaveLength(80);
    expect(container.querySelector(".scene-interior-labels")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".scene-interior-labels")).toHaveAttribute("pointer-events", "none");
    expect(container.querySelector("[role=button], [tabindex]")).toBeNull();
  });
});
