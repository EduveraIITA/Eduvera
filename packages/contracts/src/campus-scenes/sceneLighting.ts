import type { AppearancePreference, ResolvedAppearance } from "../appearance";

export type SceneLighting = "day" | "night";

/** Preview lighting follows campus local hours, never the browser's time zone. */
export function resolveSceneLighting(preference: AppearancePreference, appearance: ResolvedAppearance, instant: Date | null, timeZone?: string) {
  let localHour: number | null = null;
  if (instant && Number.isFinite(instant.getTime()) && timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(instant);
      const hour = Number(parts.find(part => part.type === "hour")?.value);
      const minute = Number(parts.find(part => part.type === "minute")?.value);
      if (Number.isFinite(hour) && Number.isFinite(minute)) localHour = hour + minute / 60;
    }
    catch { /* Older previews may not yet supply a valid campus time zone. */ }
  }
  const localNight = localHour !== null && (localHour >= 18 || localHour < 6);
  const lighting: SceneLighting = preference === "light" ? "day" : preference === "dark" ? "night"
    : appearance === "dark" || localNight ? "night" : "day";
  return { lighting, localHour };
}
