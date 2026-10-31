import { useEffect, useState } from "react";
import { useAppearance } from "../appearance";
import { applicationNow } from "../simulation/applicationTime";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { resolveSceneLighting } from "./sceneLighting";
import { resolveSceneSunlight } from "./sceneSunlight";

export function useSceneLighting(timeZone?: string) {
  const appearance = useAppearance();
  const environment = useOptionalExecutionEnvironment();
  const [liveTime, setLiveTime] = useState<Date | null>(() => environment?.mode === "simulation" ? null : applicationNow());
  const simulation = environment?.mode === "simulation";
  useEffect(() => {
    if (simulation) return;
    const update = () => setLiveTime(applicationNow());
    const interval = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", update); };
  }, [simulation]);
  // A Simulation advances only through its server-confirmed clock. It never
  // interpolates against wall time, including while paused or unavailable.
  const instant = environment?.mode === "simulation"
    ? environment.unavailable ? null : new Date(environment.virtualClock.now)
    : liveTime ?? applicationNow();
  const campusTimeZone = timeZone ?? (environment?.mode === "simulation" && !environment.unavailable ? environment.virtualClock.timeZone : undefined);
  const lighting = resolveSceneLighting(appearance.preference, appearance.resolved, instant, campusTimeZone);
  return { ...lighting, sunlight: resolveSceneSunlight(lighting.lighting, lighting.localHour) };
}
