import { draftIssues } from "./sceneEditing";
import { findSceneWalkingRoute, sceneWalkingPlaceIds } from "./sceneWalking";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";

export interface SceneSetupIssue {
  id: string;
  code: "review" | "place_link" | "route_origin" | "route_endpoint" | "disconnected_route" | "step_free" | "floor_connection" | "asset_link";
  title: string;
  detail: string;
  elementId?: string;
}
export interface SceneOnboardingReadiness {
  blockers: SceneSetupIssue[];
  advisories: SceneSetupIssue[];
  counts: { features: number; reviewed: number; linkedPlaces: number; visualOnly: number; declaredEndpoints: number; linkedFixtures: number; operationalFixtures: number; routeChecks: number; uncheckedRoutes: number };
  limitations: string[];
}
const ROUTE_CHECK_LIMIT = 160;
const operationalAssets = new Set(["lamp", "water_point", "equipment", "gate"]);

/** Advisory drawing checks against the current native workspace’s active places. Save/publication remains the authority. */
export function sceneOnboardingReadiness(document: CampusSceneDocument, spaces: readonly CampusSceneSpace[]): SceneOnboardingReadiness {
  const blockers = draftIssues(document).map((detail, index): SceneSetupIssue => ({ id: `review-${index}`, code: "review", title: "Before publishing", detail }));
  const advisories: SceneSetupIssue[] = [];
  const bySpace = new Map(spaces.map(space => [space.id, space]));
  const byElement = new Map(document.elements.map(element => [element.id, element]));
  const endpoints = sceneWalkingPlaceIds(document);
  const endpointSet = new Set(endpoints);
  const gateElements = document.elements.filter(element => element.asset_key === "gate" && element.space_id && bySpace.has(element.space_id) && endpointSet.has(element.space_id));
  const origins = [...new Set(gateElements.flatMap(element => element.space_id ? [element.space_id] : []))];
  const issueKeys = new Set<string>();
  const add = (issue: SceneSetupIssue, key = issue.id) => { if (!issueKeys.has(key)) { issueKeys.add(key); advisories.push(issue); } };
  for (const element of document.elements) {
    if (element.space_id && !bySpace.has(element.space_id)) add({ id: `place-${element.id}`, code: "place_link", title: element.label, detail: "This linked place is not available on the current campus. Choose a current place or keep it as a visual feature.", elementId: element.id }, `place-${element.space_id}`);
    if (element.kind === "room" && element.space_id && bySpace.has(element.space_id)) {
      const visited = new Set<string>(); let current = bySpace.get(element.space_id); let expectedFloor: string | null = null;
      while (current && !visited.has(current.id)) { if (current.kind === "floor") { expectedFloor = current.id; break; } visited.add(current.id); current = current.parent_space_id ? bySpace.get(current.parent_space_id) : undefined; }
      if (expectedFloor !== element.floor_id) add({ id: `room-floor-${element.id}`, code: "floor_connection", title: element.label, detail: "The drawing floor and the linked room’s canonical floor differ. Check its floor before adding indoor directions.", elementId: element.id });
    }
    const connector = element.navigation_connector;
    if (!connector) continue;
    const parent = element.parent_element_id ? byElement.get(element.parent_element_id) : undefined;
    const building = parent?.kind === "building" && parent.space_id ? parent.space_id : null;
    const belongs = (floorId: string) => {
      const visited = new Set<string>(); let place = bySpace.get(floorId);
      if (place?.kind !== "floor") return false;
      while (place && !visited.has(place.id)) { if (place.id === building) return true; visited.add(place.id); place = place.parent_space_id ? bySpace.get(place.parent_space_id) : undefined; }
      return false;
    };
    if (!building || !belongs(connector.to_floor_id) || (connector.kind === "entrance" ? connector.from_floor_id !== null : !connector.from_floor_id || connector.from_floor_id === connector.to_floor_id || !belongs(connector.from_floor_id)) || element.floor_id !== connector.from_floor_id || (connector.kind === "stairs" && connector.accessible)) add({ id: `connector-${element.id}`, code: "floor_connection", title: element.label, detail: "Check the linked building, distinct canonical floors and connection type. A stair cannot provide step-free access.", elementId: element.id });
  }
  for (const endpoint of endpoints) if (!bySpace.has(endpoint)) {
    const path = document.elements.find(element => element.navigation?.start_space_id === endpoint || element.navigation?.end_space_id === endpoint);
    add({ id: `endpoint-place-${endpoint}`, code: "place_link", title: path?.label ?? "Walking endpoint", detail: "A declared walking endpoint is not available on the current campus. Choose a current campus place in this path’s walking settings.", elementId: path?.id }, `place-${endpoint}`);
  }
  if (!endpoints.length && document.elements.some(element => element.space_id && bySpace.has(element.space_id))) add({ id: "optional-directions", code: "route_endpoint", title: "Add directions when useful", detail: "Choose the journeys your campus needs, then declare their reviewed gate and destination endpoints. Buildings and rooms do not all need walking routes." });
  if (endpoints.length && !origins.length) add({ id: "route-origin", code: "route_origin", title: "Choose a starting gate", detail: "Link a gate to its campus place to check journeys from an entrance. Existing paths can stay while you add it." });
  const destinations = endpoints.filter(id => bySpace.has(id) && !origins.includes(id));
  let routeChecks = 0;
  for (const origin of origins) for (const destination of destinations) {
    if (routeChecks >= ROUTE_CHECK_LIMIT) continue;
    routeChecks++;
    const destinationElement = document.elements.find(element => element.space_id === destination);
    const originLabel = bySpace.get(origin)?.name ?? "Gate", destinationLabel = bySpace.get(destination)?.name ?? "Place";
    const route = findSceneWalkingRoute(document, { fromSpaceId: origin, toSpaceId: destination });
    if (route.status !== "available") add({ id: `route-${origin}-${destination}`, code: "disconnected_route", title: `${originLabel} → ${destinationLabel}`, detail: "No open reviewed route connects these declared endpoints. Check identical junction coordinates and explicit floor connections.", elementId: destinationElement?.id });
    else if (findSceneWalkingRoute(document, { fromSpaceId: origin, toSpaceId: destination, accessibleOnly: true }).status !== "available") add({ id: `step-free-${origin}-${destination}`, code: "step_free", title: `${originLabel} → ${destinationLabel}`, detail: "An ordinary route exists; no reviewed step-free route is declared. Add one if this journey should support it.", elementId: destinationElement?.id });
  }
  const fixtures = document.elements.filter(element => element.kind === "fixture" && (operationalAssets.has(element.asset_key ?? "") || element.navigation_connector?.kind === "lift"));
  const unlinked = fixtures.filter(element => !element.holding_id);
  if (unlinked.length) add({ id: "asset-links", code: "asset_link", title: `${unlinked.length} optional asset ${unlinked.length === 1 ? "link" : "links"}`, detail: "Link only fixtures you want to use for repair status or equipment condition. Decorative lights and other illustrations can stay unlinked.", elementId: unlinked[0]?.id });
  return { blockers, advisories, counts: { features: document.elements.length, reviewed: document.elements.filter(element => element.review_state === "reviewed").length, linkedPlaces: new Set(document.elements.flatMap(element => element.space_id && bySpace.has(element.space_id) ? [element.space_id] : [])).size, visualOnly: document.elements.filter(element => !element.space_id && !element.holding_id).length, declaredEndpoints: endpoints.length, linkedFixtures: fixtures.length - unlinked.length, operationalFixtures: fixtures.length, routeChecks, uncheckedRoutes: Math.max(0, origins.length * destinations.length - routeChecks) }, limitations: ["These checks describe the current drawing, not a complete campus audit or physical access certification.", "Only declared reviewed endpoints and explicit connections are checked. Asset condition is not checked here.", ...(origins.length * destinations.length > ROUTE_CHECK_LIMIT ? [`Only the first ${ROUTE_CHECK_LIMIT} entrance journeys were checked. Review the remaining journeys in the campus view.`] : [])] };
}
