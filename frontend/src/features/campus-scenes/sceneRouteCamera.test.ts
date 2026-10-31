import { describe, expect, it } from "vitest";
import { sceneWalkingRouteFocus } from "./sceneRouteCamera";
import { fitFocusedSceneViewport, resizeSceneViewport } from "./sceneViewportFocus";
import { clampSceneViewport, fitSceneViewport, sceneViewportInsets, projectScenePoint, sceneElementHeight, sceneRenderBounds, sceneRoofFaces } from "./sceneGeometry";
import type { SceneWalkingRoute } from "./sceneWalking";
import type { CampusSceneDocument } from "./types";

const scene: CampusSceneDocument = { schema_version: 1, name: "Large campus", bounds: { width: 1000, height: 800, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [
  { id: "learning", kind: "building", label: "Learning block", space_id: "building", floor_id: null, levels: 3, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 400, y: 300 }, { x: 480, y: 300 }, { x: 480, y: 360 }, { x: 400, y: 360 }] } },
] };
const route: Extract<SceneWalkingRoute, { status: "available" }> = { status: "available", fromSpaceId: "gate", toSpaceId: "building", length: 100, unit: "metres", points: [{ x: 420, y: 420 }, { x: 440, y: 360 }], segments: [{ elementId: "walk", floorId: null, points: [{ x: 420, y: 420 }, { x: 440, y: 360 }] }] };
const size = { width: 350, height: 440, topInset: 64 };

describe("walking route camera context", () => {
  it("frames the ground route and the exact destination facade using the active projection", () => {
    for (const mode of ["2d", "2.5d"] as const) for (const roof of ["flat", "gable", "hip"] as const) {
      const document = { ...scene, elements: [{ ...scene.elements[0]!, roof }] };
      const focus = sceneWalkingRouteFocus(document, route, mode)!;
      const campus = sceneRenderBounds(document, mode), viewport = fitFocusedSceneViewport(size, focus.bounds, campus);
      expect(viewport.scale).toBeGreaterThan(fitSceneViewport(size, campus).scale * 3);
      const points = [...route.points.map(point => projectScenePoint(point, 0, mode)), ...scene.elements[0]!.geometry.points.map(point => projectScenePoint(point, sceneElementHeight(scene.elements[0]!), mode))];
      if (mode === "2.5d") points.push(...sceneRoofFaces(document.elements[0]!.geometry.points, sceneElementHeight(document.elements[0]!), roof).flat());
      for (const point of points) {
        const x = point.x * viewport.scale + viewport.x, y = point.y * viewport.scale + viewport.y;
        expect(x).toBeGreaterThan(10); expect(x).toBeLessThan(size.width - 10);
        expect(y).toBeGreaterThan(size.topInset + 10); expect(y).toBeLessThan(size.height - 10);
      }
    }
  });
  it("does not change saved geometry, infer a nearby destination or focus indoor/unavailable routes", () => {
    const original = structuredClone(scene);
    const direct = sceneWalkingRouteFocus(scene, route, "2.5d")!;
    const withoutIdentity = sceneWalkingRouteFocus(scene, { ...route, toSpaceId: "unmapped" }, "2.5d")!;
    expect(withoutIdentity.bounds.width).toBeLessThan(direct.bounds.width);
    expect(scene).toEqual(original);
    expect(sceneWalkingRouteFocus(scene, { ...route, segments: [{ ...route.segments[0]!, floorId: "upper" }] }, "2d")).toBeNull();
    expect(sceneWalkingRouteFocus(scene, { status: "unavailable", fromSpaceId: "gate", toSpaceId: "building", reason: "no_path" }, "2d")).toBeNull();
  });
  it("keeps the camera key stable across equivalent refreshes and changes it for a new path, endpoint or building shape", () => {
    const focus = sceneWalkingRouteFocus(scene, route, "2.5d")!;
    expect(sceneWalkingRouteFocus(structuredClone(scene), structuredClone(route), "2.5d")!.key).toBe(focus.key);
    const moved = structuredClone(route); moved.segments[0]!.points[0]!.x += 1;
    expect(sceneWalkingRouteFocus(scene, moved, "2.5d")!.key).not.toBe(focus.key);
    expect(sceneWalkingRouteFocus(scene, { ...route, fromSpaceId: "west-gate" }, "2.5d")!.key).not.toBe(focus.key);
    const changedBuilding = structuredClone(scene); changedBuilding.elements[0]!.geometry.points[0]!.x -= 3;
    expect(sceneWalkingRouteFocus(changedBuilding, route, "2.5d")!.key).not.toBe(focus.key);
  });
  it("frames only the selected floor's authored route and exact room in the original drawing scale", () => {
    const room = { ...scene.elements[0]!, id: "room", kind: "room" as const, floor_id: "first", parent_element_id: "learning", space_id: "room-place", geometry: { type: "polygon" as const, points: [{ x: 420, y: 310 }, { x: 430, y: 310 }, { x: 430, y: 320 }, { x: 420, y: 320 }] } };
    const indoor = { ...route, toSpaceId: "room-place", segments: [...route.segments, { elementId: "corridor", floorId: "first", points: [{ x: 440, y: 330 }, { x: 425, y: 320 }] }] };
    const focus = sceneWalkingRouteFocus({ ...scene, elements: [...scene.elements, room] }, indoor, "2d", "first")!;
    expect(focus.bounds.y).toBeLessThanOrEqual(310);
    expect(focus.bounds.y + focus.bounds.height).toBeLessThan(400);
    expect(focus.bounds.x + focus.bounds.width).toBeGreaterThan(440);
    expect(sceneWalkingRouteFocus(scene, indoor, "2d", "unmapped")).toBeNull();
  });
  it("uses the same bounded camera mechanics in relative and metre layouts without inventing a distance", () => {
    for (const unit of ["relative", "metres"] as const) {
      const document = { ...scene, bounds: { ...scene.bounds, unit } };
      const focus = sceneWalkingRouteFocus(document, { ...route, unit }, "2.5d")!;
      const campus = sceneRenderBounds(document, "2.5d"), whole = fitSceneViewport(size, campus), viewport = fitFocusedSceneViewport(size, focus.bounds, campus);
      expect(viewport.scale).toBeGreaterThan(whole.scale);
      expect(viewport.scale).toBeLessThanOrEqual(whole.scale * 8);
      expect(focus).not.toHaveProperty("metres"); expect(focus).not.toHaveProperty("eta");
    }
  });
  it("centres an extremely short route at the supported maximum zoom instead of shifting it offscreen", () => {
    const campus = { x: 0, y: 0, width: 1000, height: 1000 }, focus = { x: 499, y: 499, width: 2, height: 2 };
    const viewport = fitFocusedSceneViewport(size, focus, campus), whole = fitSceneViewport(size, campus);
    expect(viewport.scale).toBeCloseTo(whole.scale * 8);
    expect(viewport.x + 500 * viewport.scale).toBeCloseTo(size.width / 2);
    expect(viewport.y + 500 * viewport.scale).toBeCloseTo(size.topInset + (size.height - size.topInset) / 2);
  });
  it("retains a manually chosen world centre on resize while applying the new supported scale bounds", () => {
    const campus = { x: 0, y: 0, width: 1000, height: 1000 }, before = { width: 800, height: 600, topInset: 64 }, after = { width: 320, height: 440, topInset: 64 };
    const viewport = { x: before.width / 2 - 500 * 2, y: 64 + (before.height - 64) / 2 - 500 * 2, scale: 2 };
    const resized = resizeSceneViewport(viewport, before, after, campus);
    expect((after.width / 2 - resized.x) / resized.scale).toBeCloseTo(500);
    expect((64 + (after.height - 64) / 2 - resized.y) / resized.scale).toBeCloseTo(500);
  });
  it("fits both route endpoints above bottom controls in each projection and keeps editor defaults unchanged", () => {
    const reserved = { width: 390, height: 440, topInset: 72, bottomInset: 132 };
    for (const mode of ["2d", "2.5d"] as const) {
      const focus = sceneWalkingRouteFocus(scene, route, mode)!;
      const camera = fitFocusedSceneViewport(reserved, focus.bounds, sceneRenderBounds(scene, mode));
      for (const point of route.points) {
        const projected = projectScenePoint(point, 0, mode), y = projected.y * camera.scale + camera.y;
        expect(y - 7).toBeGreaterThan(reserved.topInset);
        expect(y + 7).toBeLessThan(reserved.height - reserved.bottomInset);
      }
    }
    const campus = sceneRenderBounds(scene, "2d");
    expect(fitSceneViewport(size, campus)).toEqual(fitSceneViewport({ ...size, bottomInset: 0 }, campus));
    const clamped = clampSceneViewport({ x: 0, y: 10000, scale: .001 }, reserved, campus);
    const { top, height } = sceneViewportInsets(reserved);
    expect(clamped.y + campus.y * clamped.scale).toBeGreaterThanOrEqual(top - 24);
    expect(clamped.y + (campus.y + campus.height) * clamped.scale).toBeLessThanOrEqual(top + height + 24);
  });

});
