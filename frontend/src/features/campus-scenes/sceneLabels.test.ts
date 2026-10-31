import { describe, expect, it } from "vitest";
import { createCampusDemoScene } from "./sceneDemo";
import { layoutSceneLabels } from "./sceneLabels";
import { fitSceneViewport, sceneRenderBounds } from "./sceneGeometry";
import type { CampusSceneElement } from "./types";

describe("floating campus names", () => {
  it("leaves the unselected campus unobstructed and labels only the selected entity", () => {
    const scene = createCampusDemoScene(), size = { width: 414, height: 540 };
    const viewport = fitSceneViewport(size, sceneRenderBounds(scene, "2.5d"));
    expect(layoutSceneLabels(scene.elements, "2.5d", 1, viewport, size)).toEqual([]);
    const selected = scene.elements.find(element => element.kind === "building")!;
    const labels = layoutSceneLabels(scene.elements, "2.5d", 1, viewport, size, selected.id);
    expect(labels).toHaveLength(1); expect(labels[0]!.name).toBe(selected.label);
    expect(labels[0]!.x).toBeGreaterThanOrEqual(8); expect(labels[0]!.x + labels[0]!.width).toBeLessThanOrEqual(size.width - 8);
  });
  it("preserves the selected full name, respects control insets and keeps text size independent of zoom", () => {
    const scene = createCampusDemoScene(), element = { ...scene.elements.find(item => item.kind === "building")!, label: "Faculty of Applied Science and Community Learning Centre" };
    const size = { width: 414, height: 600, topInset: 76 }, viewport = fitSceneViewport(size, sceneRenderBounds(scene, "2.5d"));
    const first = layoutSceneLabels([element], "2.5d", 1, viewport, size, element.id)[0]!;
    expect(first.lines.join(" ")).toBe(element.label); expect(first.y).toBeGreaterThanOrEqual(84);
    const second = layoutSceneLabels([element], "2.5d", 1, { ...viewport, scale: viewport.scale * 1.05 }, size, element.id)[0]!;
    expect(second.width).toBe(first.width); expect(second.height).toBe(first.height);
  });
  it("names rooms only when selected, including small mapped rooms", () => {
    const room: CampusSceneElement = { id: "room", label: "Reading room", kind: "room", geometry: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 70 }, { x: 20, y: 70 }] }, space_id: null, floor_id: "floor", review_state: "reviewed" };
    const size = { width: 414, height: 600 }, viewport = { x: 0, y: 0, scale: 1 };
    expect(layoutSceneLabels([room], "2d", 1, viewport, size)).toHaveLength(0);
    expect(layoutSceneLabels([room], "2d", 1, { ...viewport, scale: .1 }, size)).toHaveLength(0);
    expect(layoutSceneLabels([room], "2d", 1, { ...viewport, scale: .1 }, size, "room")).toHaveLength(1);
  });
});
