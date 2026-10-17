import { describe, expect, it } from "vitest";
import { clampMapScale, constrainMapViewport, fitMapViewport, pinchMapViewport, preserveMapCenter, zoomMapAtPoint } from "./mapViewport";

const bounds = { x: 0, y: 0, width: 760, height: 920 };

describe("campus map viewport", () => {
  it("fits and centers the whole campus inside the available screen", () => {
    const view = fitMapViewport({ width: 390, height: 640 }, bounds, 24);
    expect(view.scale).toBeCloseTo(342 / 760);
    expect(view.x).toBeCloseTo(24);
    expect(view.y).toBeCloseTo((640 - 920 * view.scale) / 2);
  });

  it("keeps the world point under the pointer stable while zooming", () => {
    const initial = { x: 20, y: 30, scale: .5 };
    const point = { x: 180, y: 260 };
    const before = { x: (point.x - initial.x) / initial.scale, y: (point.y - initial.y) / initial.scale };
    const zoomed = zoomMapAtPoint(initial, point, 1.25);
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(before.x);
    expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo(before.y);
  });

  it("combines pinch scale and center movement without losing its anchor", () => {
    const pinched = pinchMapViewport(
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 100 },
      100,
      { x: 120, y: 130 },
      150,
      .5,
    );
    expect(pinched.scale).toBe(1.5);
    expect(pinched.x).toBe(-30);
    expect(pinched.y).toBe(-20);
  });

  it("keeps the plan recoverable and clamps zoom to its fit-relative range", () => {
    expect(clampMapScale(.01, .5)).toBeCloseTo(.39);
    expect(clampMapScale(20, .5)).toBe(2.4);
    const constrained = constrainMapViewport({ x: 1000, y: -2000, scale: 1 }, { width: 390, height: 640 }, bounds);
    expect(constrained.x).toBe(72);
    expect(constrained.y).toBe(640 - 920 - 72);
  });

  it("keeps a fully visible campus centered instead of panning across empty space", () => {
    const constrained = constrainMapViewport(
      { x: 1000, y: -2000, scale: .4 },
      { width: 800, height: 600 },
      bounds,
    );
    expect(constrained.x).toBeCloseTo((800 - 760 * .4) / 2);
    expect(constrained.y).toBeCloseTo((600 - 920 * .4) / 2);
  });

  it("preserves the same world center across a viewport resize", () => {
    const initial = { x: -80, y: -100, scale: 1.2 };
    const resized = preserveMapCenter(initial, { width: 390, height: 640 }, { width: 800, height: 600 });
    const oldCenter = { x: (195 - initial.x) / initial.scale, y: (320 - initial.y) / initial.scale };
    expect((400 - resized.x) / resized.scale).toBeCloseTo(oldCenter.x);
    expect((300 - resized.y) / resized.scale).toBeCloseTo(oldCenter.y);
  });
});
