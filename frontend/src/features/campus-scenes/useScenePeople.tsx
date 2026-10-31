import { useMemo, useState } from "react";
import type { CampusMotionProjection } from "../campus-view/campusMotion.types";
import { campusMotionMatches } from "../campus-view/campusMotion";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { applicationNow } from "../simulation/applicationTime";
import { compileScenePeopleTracks, reconcileScenePeopleTracks } from "./scenePeopleTracks";
import type { ScenePeopleRoutingState } from "./scenePeopleTracks";
import type { ScenePeopleClock, ScenePeopleCompiled } from "./scenePeopleTracks.types";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";

export function useScenePeople(scene: CampusSceneDocument | null, places: readonly Omit<CampusSceneSpace, "campus_id">[], schoolId: string, campusId: string, publicationKey: string, motion?: CampusMotionProjection, routing?: ScenePeopleRoutingState) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [enabled, setEnabled] = useState(true);
  const instant = environment.mode === "simulation" ? environment.unavailable ? null : Date.parse(environment.virtualClock.now) : applicationNow().getTime();
  const epoch = executionEnvironmentIdentity(environment);
  const matches = Boolean(schoolId && motion && campusMotionMatches(motion, schoolId, campusId, environment));
  const routingAvailable = routing?.routingAvailable, excludedConnectorIds = routing?.excludedConnectorIds;
  const candidate = useMemo(() => scene && motion && matches
    ? compileScenePeopleTracks(scene, places, motion, publicationKey, { routingAvailable, excludedConnectorIds }) : null, [scene, places, motion, matches, publicationKey, routingAvailable, excludedConnectorIds]);
  const [retained, setRetained] = useState<{ candidate: ScenePeopleCompiled | null; value: ScenePeopleCompiled | null; instant: number | null; epoch: string }>({ candidate, value: candidate, instant, epoch });
  let compiled = retained.value;
  const seek = epoch !== retained.epoch || instant === null || environment.mode === "simulation" && retained.instant !== null && instant < retained.instant;
  if (retained.candidate !== candidate || environment.mode === "simulation" && retained.instant !== instant || retained.epoch !== epoch) {
    compiled = seek ? candidate : retained.candidate !== candidate ? candidate && scene ? reconcileScenePeopleTracks(retained.value, candidate, scene, instant) : null : retained.value;
    setRetained({ candidate, value: compiled, instant, epoch });
  }
  const clock: ScenePeopleClock = { instant, live: environment.mode === "live", running: environment.mode === "live" || !environment.unavailable && environment.runStatus === "running", epoch };
  return { data: enabled ? compiled : null, compiled, clock, enabled, setEnabled };
}

export function CampusLifeControls({ enabled, onEnabled, data, state, personal = false }: { enabled: boolean; onEnabled: (value: boolean) => void; data: ScenePeopleCompiled | null; state?: "loading" | "available" | "unavailable"; personal?: boolean }) {
  return <section className="campus-map-life" aria-label="Campus life">
    <label><span>Campus life</span><input type="checkbox" role="switch" checked={enabled} onChange={event => onEnabled(event.target.checked)} disabled={!data} /></label>
    <p>{personal ? "Your figure illustrates your published plans and mapped journeys." : "Anonymous people illustrate authorized published plans and mapped journeys."} Scan rings show recorded events, not live positions.</p>
    {!data ? <p role="status">{state === "loading" ? "Loading planned activity…" : "Planned activity is unavailable. You can still explore the map."}</p>
      : !data.tracks.length && !data.points.length ? <p>No mapped plans or recent scan events in this snapshot.</p> : null}
    {data?.unmapped ? <p>Some planned places are not mapped yet.</p> : null}
    {data?.unavailableRoutes ? <p>Some journeys need connected, open walking paths.</p> : null}
    {data?.conflicting ? <p>Conflicting plans are excluded from movement.</p> : null}
    {data?.sourceLimited ? <p>This is a bounded illustration. Timetable retains the complete authorized plan.</p> : null}
  </section>;
}
