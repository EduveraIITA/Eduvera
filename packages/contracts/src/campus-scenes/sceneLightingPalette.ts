import type { SceneLighting } from "./sceneLighting";

/** Illustration lighting, never a report of campus lights, occupancy or weather. */
export function sceneLitColor(color: string, lighting: SceneLighting): string {
  if (lighting === "day") return color;
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  const luminance = channels[0]! * .25 + channels[1]! * .6 + channels[2]! * .15;
  return `#${channels.map((channel, index) => Math.round(channel * .21 + luminance * .1 + [8, 14, 21][index]!).toString(16).padStart(2, "0")).join("")}`;
}

export const SCENE_GROUND = { day: "#aec48d", night: "#11191e" } as const;
