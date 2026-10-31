import { describe, expect, it } from "vitest";
import { DEFAULT_SCENE_SUNLIGHT, resolveSceneSunlight, sceneShadowOffset } from "./sceneSunlight";

const shadowLength = (hour: number) => {
  const shadow = sceneShadowOffset(10, resolveSceneSunlight("day", hour));
  return Math.hypot(shadow.x, shadow.y);
};

describe("illustrative campus sunlight", () => {
  it("casts morning and afternoon shadows in opposite directions with a shorter noon shadow", () => {
    const morning = sceneShadowOffset(10, resolveSceneSunlight("day", 8));
    const afternoon = sceneShadowOffset(10, resolveSceneSunlight("day", 16));
    expect(morning.x).toBeLessThan(0);
    expect(afternoon.x).toBeGreaterThan(0);
    expect(morning.x).toBeCloseTo(-afternoon.x);
    expect(morning.y).toBeCloseTo(afternoon.y);
    expect(shadowLength(12)).toBeLessThan(shadowLength(8));
    expect(shadowLength(12)).toBeLessThan(shadowLength(16));
  });

  it("changes continuously with fractional local hours instead of stepping at each hour", () => {
    const start = resolveSceneSunlight("day", 10), middle = resolveSceneSunlight("day", 10.5), end = resolveSceneSunlight("day", 11);
    expect(middle.direction.x).toBeGreaterThan(start.direction.x);
    expect(middle.direction.x).toBeLessThan(end.direction.x);
    expect(middle.altitude).toBeGreaterThan(start.altitude);
    expect(middle.altitude).toBeLessThan(end.altitude);
    expect(middle.strength).toBeGreaterThan(start.strength);
  });

  it("uses neutral daylight for missing/invalid time and a Light override outside daytime", () => {
    for (const hour of [null, NaN, Infinity, -1, 0, 5.99, 18, 23.5, 24]) {
      expect(resolveSceneSunlight("day", hour)).toEqual(DEFAULT_SCENE_SUNLIGHT);
    }
    expect(resolveSceneSunlight("day", 6).direction.x).toBeLessThan(0);
    expect(resolveSceneSunlight("day", 17.99).direction.x).toBeGreaterThan(0);
  });

  it("removes directional sunlight at night regardless of the reported clock", () => {
    for (const hour of [null, 0, 6, 12, 18, 23]) {
      const sunlight = resolveSceneSunlight("night", hour);
      expect(sunlight.strength).toBe(0);
      expect(sceneShadowOffset(20, sunlight)).toEqual({ x: 0, y: 0 });
    }
  });

  it("bounds dawn and low-altitude shadows and scales their reach with object height", () => {
    const dawn = resolveSceneSunlight("day", 6);
    const small = sceneShadowOffset(5, dawn), tall = sceneShadowOffset(10, dawn);
    expect(Math.hypot(small.x, small.y)).toBeLessThanOrEqual(20);
    expect(Math.hypot(tall.x, tall.y)).toBeLessThanOrEqual(40);
    expect(tall.x).toBeCloseTo(small.x * 2);
    const low = sceneShadowOffset(10, { ...dawn, altitude: 0, direction: { x: -5, y: 0 } });
    expect(Math.hypot(low.x, low.y)).toBe(40);
  });

  it("does not emit invalid SVG coordinates for unavailable object dimensions", () => {
    for (const height of [0, -1, NaN, Infinity]) expect(sceneShadowOffset(height, DEFAULT_SCENE_SUNLIGHT)).toEqual({ x: 0, y: 0 });
    expect(sceneShadowOffset(5, { ...DEFAULT_SCENE_SUNLIGHT, direction: { x: 0, y: 0 } })).toEqual({ x: 0, y: 0 });
  });
});
