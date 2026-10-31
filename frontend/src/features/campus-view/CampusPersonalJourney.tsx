import { startTransition, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { CampusScenePublished } from "../campus-scenes/api";
import { findSceneWalkingRoute, sceneWalkingPlaceIds } from "../campus-scenes/sceneWalking";
import { getCampusPersonalJourney, personalJourneyMatches } from "./personalJourney.api";
import { campusMotionMatches } from "./campusMotion";
import { personalJourneyDestinations, personalJourneyPlaceTrail, personalJourneySignature, personalOutdoorScene, personalWalkingDestination } from "./personalJourney";
import type { CampusPersonalBridge } from "./personalJourney.types";
import { CampusPersonalJourneyCard } from "./CampusPersonalJourneyCard";
import { CampusPersonalDirections } from "./CampusPersonalDirections";
import { CampusPersonalPlaceActivities } from "./CampusPersonalPlaceActivities";
import "./campus-personal-journey.css";

const emptyBridge: CampusPersonalBridge = { selection: null, onSelectPlace: () => undefined, walkingRoute: null, controls: null, placeDetails: () => null };

export function CampusPersonalJourney({ schoolId, campusId, publication, children, blockedConnectorIds = [], routingAvailable = true }: {
  schoolId: string; campusId: string; publication: CampusScenePublished | null; blockedConnectorIds?: readonly string[]; routingAvailable?: boolean; children: (bridge: CampusPersonalBridge) => ReactNode;
}) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const actorId = auth.user?.id;
  const authorized = Boolean(actorId && auth.user?.active_school_id === schoolId && auth.memberships.some(item => item.school_id === schoolId));
  if (!authorized) return children(emptyBridge);
  if (environment.mode === "simulation" && environment.unavailable) return children({ ...emptyBridge, controls: <p className="campus-personal-message" role="alert">Your campus activities are unavailable until this Simulation is recovered.</p> });
  return <ActiveCampusPersonalJourney key={`${executionEnvironmentIdentity(environment)}:${schoolId}:${actorId}:${campusId}`} schoolId={schoolId} campusId={campusId} actorId={actorId!} publication={publication} blockedConnectorIds={blockedConnectorIds} routingAvailable={routingAvailable}>{children}</ActiveCampusPersonalJourney>;
}

function ActiveCampusPersonalJourney({ schoolId, campusId, actorId, publication, children, blockedConnectorIds, routingAvailable }: {
  schoolId: string; campusId: string; actorId: string; publication: CampusScenePublished | null; blockedConnectorIds: readonly string[]; routingAvailable: boolean; children: (bridge: CampusPersonalBridge) => ReactNode;
}) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [params, setParams] = useSearchParams(), [selectionToken, setSelectionToken] = useState(0);
  const clock = environment.mode === "simulation" && !environment.unavailable ? environment.virtualClock.now : "current";
  const query = useQuery({
    queryKey: executionEnvironmentQueryKey(environment, ["campus-view", "mine", schoolId, actorId, campusId, clock]),
    queryFn: async ({ signal }) => {
      const result = await getCampusPersonalJourney(schoolId, campusId, signal);
      if (!personalJourneyMatches(result, schoolId, campusId, environment)) throw new Error("Your campus context changed. Refresh to load its current activities.");
      return result;
    },
    staleTime: 15_000, refetchInterval: environment.mode === "live" ? 30_000 : false, retry: false,
  });
  const data = !query.error && personalJourneyMatches(query.data, schoolId, campusId, environment) ? query.data : undefined;
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setParams(next, { replace: true });
  };
  // Router URL changes are transitions. Their accompanying token must not render
  // urgently against the prior URL's presentation intent and replace the panel.
  const advanceSelection = () => startTransition(() => setSelectionToken(value => value + 1));
  const selectPlace = (id: string | null, view: "place" | "outside" = "place") => {
    update({ campus_space: id, campus_view: view, campus_focus: "explore", campus_asset: null }); advanceSelection();
  };
  if (!data) return children({ ...emptyBridge, motionState: query.isPending ? "loading" : "unavailable", controls: query.isPending
    ? <section className="campus-personal-message" role="status" aria-busy="true">Loading your campus day…</section>
    : <section className="campus-personal-message" role="alert"><p>Your campus activities could not be loaded. You can still explore the published layout.</p><button type="button" className="campus-scene-button" onClick={() => void query.refetch()}>Try again</button></section> });
  const items = personalJourneyDestinations(data), requestedItem = params.get("journey");
  const selected = items.find(item => item.id === requestedItem) ?? items[0];
  const scene = publication?.scene?.document ?? null;
  const outdoorScene = personalOutdoorScene(scene);
  const destination = personalWalkingDestination(scene, data.places, selected?.space_id ?? null);
  const routeScene = destination?.id === selected?.space_id ? scene : outdoorScene;
  const endpointIds = new Set(routeScene ? sceneWalkingPlaceIds(routeScene) : []);
  const origins = data.places.filter(place => endpointIds.has(place.id)).sort((left, right) => Number(right.kind === "gate") - Number(left.kind === "gate") || left.name.localeCompare(right.name));
  const directionsOpen = params.get("directions") === "1" && Boolean(selected);
  const signature = selected ? personalJourneySignature(selected) : null;
  const placeMapped = Boolean(selected?.space_id && scene?.elements.some(item => item.space_id === selected.space_id));
  const stale = Boolean(params.get("walk_context") && (params.get("walk_context") !== signature || requestedItem !== selected?.id));
  const originId = !stale && origins.some(place => place.id === params.get("walk_from")) ? params.get("walk_from")! : "";
  const accessibleOnly = params.get("step_free") === "1";
  const walkingRoute = routingAvailable && directionsOpen && !stale && routeScene && destination && originId
    ? findSceneWalkingRoute(routeScene, { fromSpaceId: originId, toSpaceId: destination.id, accessibleOnly, excludedConnectorIds: blockedConnectorIds }) : null;
  const requestedPlace = params.get("campus_space"), validPlace = data.places.find(place => place.id === requestedPlace);
  const intent = params.get("campus_focus") === "journey" ? "journey" as const : params.get("campus_focus") === "explore" ? "explore" as const : undefined;
  const selection = stale && intent !== "explore" ? { spaceId: null, view: "outside" as const, token: selectionToken, intent }
    : validPlace ? { spaceId: validPlace.id, view: params.get("campus_view") === "outside" ? "outside" as const : "place" as const, token: selectionToken, intent } : null;
  const choose = (id: string) => {
    const item = items.find(value => value.id === id); if (!item) return;
    update({ journey: id, campus_space: item.space_id, campus_view: "place", campus_focus: "journey", campus_asset: null, directions: null, walk_from: null, walk_context: personalJourneySignature(item) });
    advanceSelection();
  };
  const locate = () => {
    if (!selected) return;
    update({ journey: selected.id, campus_space: selected.space_id, campus_view: "place", campus_focus: "journey", campus_asset: null, walk_context: signature });
    advanceSelection();
  };
  const controls = <CampusPersonalJourneyCard data={data} items={items} selected={selected} onChoose={choose} onLocate={locate} directionsOpen={directionsOpen}
    placeMapped={placeMapped} onRefresh={() => void query.refetch()} refreshing={query.isFetching} onDirections={() => {
      update({ journey: selected?.id ?? null, directions: directionsOpen ? null : "1", walk_from: null, walk_context: signature, campus_space: selected?.space_id ?? null, campus_view: "outside", campus_focus: "journey", campus_asset: null });
      advanceSelection();
    }}>
    {directionsOpen && selected ? <CampusPersonalDirections item={selected} origins={origins} originId={originId} accessibleOnly={accessibleOnly} onAccessible={value => update({ step_free: value ? "1" : null })}
      onOrigin={id => {
        update({ journey: selected.id, walk_from: id, walk_context: signature, campus_space: selected.space_id, campus_view: "outside", campus_focus: "journey", campus_asset: null });
        advanceSelection();
      }} route={walkingRoute} destination={destination} trail={personalJourneyPlaceTrail(data.places, selected.space_id)} onShowRoom={locate} stale={stale} placeMapped={placeMapped} /> : null}
  </CampusPersonalJourneyCard>;
  return children({ selection, onSelectPlace: id => selectPlace(id), walkingRoute, controls,
    motion: campusMotionMatches(data.motion, schoolId, campusId, environment) ? data.motion : undefined,
    motionState: campusMotionMatches(data.motion, schoolId, campusId, environment) ? "available" : "unavailable", placeDetails: spaceId => {
    const place = data.places.find(item => item.id === spaceId);
    if (!place) return null;
    const activities = items.filter(item => personalJourneyPlaceTrail(data.places, item.space_id).some(parent => parent.id === spaceId));
    return <CampusPersonalPlaceActivities activities={activities} spaceId={spaceId} capacity={place.capacity} timezone={data.timezone} localDate={data.local_date} />;
  } });
}
