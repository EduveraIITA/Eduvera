import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { campusMapPresentationChanges, readCampusMapPresentation, type CampusMapPresentation } from "./sceneMapPresentation";
import { sceneWalkingPlaceIds } from "./sceneWalking";
import type { CampusScenePublished } from "./api";

export interface PlaceDirections { destination: string; origin: string; accessible: boolean }
export interface WayfindingState { directions: PlaceDirections | null; floor: string | null; change: (value: PlaceDirections | null) => void; showFloor: (id: string | null) => void }
export interface MapPresentation { restoring?: boolean; hasPanel?: boolean; value: CampusMapPresentation; change: (value: Partial<CampusMapPresentation>) => void }
export function useCampusMapNavigation(data: CampusScenePublished) {
  const [params, setParams] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const [pending, setPending] = useState<{ context: string; changes: Record<string, string | null>; push: boolean } | null>(null);
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const context = `${data.campus.id}:${executionEnvironmentIdentity(environment)}`;
  const [ownedExpansion, setOwnedExpansion] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<{ context: string; query: string } | null>(null);
  const rawExpanded = params.get("map_context") === context && params.get("map_full") === "1";
  if (rawExpanded && expandedSnapshot?.query !== params.toString()) setExpandedSnapshot({ context, query: params.toString() });
  if (expandedSnapshot && expandedSnapshot.context !== context) { setExpandedSnapshot(null); if (ownedExpansion) setOwnedExpansion(false); }
  const restoring = expandedSnapshot?.context === context && !rawExpanded;
  const restoreChanges = useMemo(() => {
    const changes: Record<string, string | null> = {};
    if (restoring && expandedSnapshot) {
      const previous = new URLSearchParams(expandedSnapshot.query);
      for (const key of new Set([...params.keys(), ...previous.keys()])) if (key.startsWith("map_") || ["campus_space", "campus_view", "campus_focus", "campus_layer", "campus_asset", "campus_asset_context", "journey", "directions", "walk_from", "walk_context", "step_free"].includes(key)) changes[key] = key === "map_full" ? null : previous.get(key);
    }
    return changes;
  }, [restoring, expandedSnapshot, params]);
  const restored = restoring && Object.entries(restoreChanges).every(([key, value]) => params.get(key) === value);
  if (restored) { setExpandedSnapshot(null); if (ownedExpansion) setOwnedExpansion(false); }
  const rawHistoryState: unknown = location.state;
  const historyState = useMemo(() => rawHistoryState && typeof rawHistoryState === "object" ? rawHistoryState as Record<string, unknown> : {}, [rawHistoryState]);
  const needsOwnerState = ownedExpansion && rawExpanded && historyState.campusMapExpanded !== context;
  if (pending && pending.context !== context) setPending(null);
  const applied = pending && pending.context === context && params.get("map_context") === context && Object.entries(pending.changes).every(([key, value]) => params.get(key) === value);
  if (applied) setPending(null);
  const effectiveParams = new URLSearchParams(params);
  Object.entries(restoreChanges).forEach(([key, value]) => value ? effectiveParams.set(key, value) : effectiveParams.delete(key));
  if (pending?.context === context) { effectiveParams.set("map_context", context); Object.entries(pending.changes).forEach(([key, value]) => value ? effectiveParams.set(key, value) : effectiveParams.delete(key)); }
  useEffect(() => {
    if ((!pending || pending.context !== context || applied) && (!restoring || restored) && !needsOwnerState) return;
    const next = new URLSearchParams(params); next.set("map_context", context);
    Object.entries({ ...restoreChanges, ...(pending?.context === context ? pending.changes : {}) }).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setParams(next, { replace: !pending?.push, state: pending?.push || needsOwnerState ? { ...historyState, campusMapExpanded: context } : historyState });
  }, [pending, params, context, setParams, historyState, applied, restoring, restored, restoreChanges, needsOwnerState]);
  const valid = effectiveParams.get("map_context") === context;
  const destination = valid ? data.places.find(place => place.id === effectiveParams.get("map_to")) : undefined;
  const origins = new Set(data.scene ? sceneWalkingPlaceIds(data.scene.document) : []);
  const origin = valid && origins.has(effectiveParams.get("map_from") ?? "") ? effectiveParams.get("map_from")! : "";
  const requestedFloor = valid ? effectiveParams.get("map_floor") : null;
  const floor = requestedFloor && data.places.some(place => place.id === requestedFloor && place.kind === "floor") ? requestedFloor : null;
  // Coalesce our presentation changes after native bridge URL updates in the same event.
  const update = (changes: Record<string, string | null>, push = false) => startTransition(() => setPending(previous => ({ context, changes: { ...previous?.changes, ...changes }, push: push || Boolean(previous?.push) })));
  const wayfinding: WayfindingState = { directions: destination ? { destination: destination.id, origin, accessible: effectiveParams.get("map_step_free") === "1" } : null, floor,
    change: value => update({ map_to: value?.destination ?? null, map_from: value?.origin ?? null, map_step_free: value?.accessible ? "1" : null, map_floor: value && value.destination === destination?.id && value.origin === origin ? effectiveParams.get("map_floor") : null, campus_asset: null }),
    showFloor: id => update({ map_floor: id }) };
  const presentation: MapPresentation = { restoring, hasPanel: valid && effectiveParams.has("map_panel"), value: readCampusMapPresentation(effectiveParams, context, data), change: changes => {
    if (changes.expanded === false && (ownedExpansion || historyState.campusMapExpanded === context)) { void navigate(-1); return; }
    if (changes.expanded === true) setOwnedExpansion(true);
    update(campusMapPresentationChanges(changes), changes.expanded === true && !presentation.value.expanded);
  } };
  return { context, wayfinding, presentation };
}
