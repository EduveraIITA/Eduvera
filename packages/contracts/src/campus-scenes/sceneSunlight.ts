import type { SceneLighting } from "./sceneLighting";

export interface SceneSunlight {
  /** Unit ground-plane direction in which shadows are cast. */
  readonly direction: { readonly x: number; readonly y: number };
  /** Illustrative elevation above the ground, in radians. */
  readonly altitude: number;
  /** Daylight intensity from zero to one; zero leaves only contact shadows. */
  readonly strength: number;
}

export const DEFAULT_SCENE_SUNLIGHT: SceneSunlight = Object.freeze({
  direction: Object.freeze({ x: 0, y: -1 }),
  altitude: Math.PI * .4,
  strength: 1,
});

/**
 * A deterministic, season-independent illustration in the scene's local axes.
 * Campus orientation and latitude are unknown, so this is not a solar model.
 * Profile Light at night, or an unavailable clock, uses neutral noon daylight.
 */
export function resolveSceneSunlight(lighting: SceneLighting, localHour: number | null): SceneSunlight {
  if (lighting === "night") return { ...DEFAULT_SCENE_SUNLIGHT, strength: 0 };
  if (localHour === null || !Number.isFinite(localHour) || localHour < 6 || localHour >= 18 || localHour === 12) return DEFAULT_SCENE_SUNLIGHT;
  const phase = (localHour - 6) / 12 * Math.PI;
  return {
    direction: { x: -Math.cos(phase), y: -Math.sin(phase) },
    altitude: (12 + 60 * Math.sin(phase)) * Math.PI / 180,
    strength: .55 + .45 * Math.sin(phase),
  };
}

/** Ground offset per object height; low sun is capped to keep the canvas bounded. */
export function sceneShadowOffset(height: number, sunlight: SceneSunlight): { x: number; y: number } {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(sunlight.strength) || sunlight.strength <= 0) return { x: 0, y: 0 };
  const directionLength = Math.hypot(sunlight.direction.x, sunlight.direction.y);
  if (!Number.isFinite(directionLength) || directionLength === 0) return { x: 0, y: 0 };
  const altitude = Number.isFinite(sunlight.altitude) ? Math.max(.01, Math.min(Math.PI / 2, sunlight.altitude)) : DEFAULT_SCENE_SUNLIGHT.altitude;
  const length = Math.min(height * 4, height / Math.tan(altitude));
  return { x: sunlight.direction.x / directionLength * length, y: sunlight.direction.y / directionLength * length };
}
