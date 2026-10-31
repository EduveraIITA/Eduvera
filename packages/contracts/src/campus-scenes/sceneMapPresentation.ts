import { sceneFloorBuilding } from "./sceneInterior";
import type { CampusSceneElement } from "./types";
import type { CampusScenePublished } from "./contracts";

export type CampusMapPanel = "search" | "place" | "directions" | "day" | "layers" | "operations" | "information";
export interface CampusMapPresentation {
  panel: CampusMapPanel | null;
  expanded: boolean;
  mode: "2d" | "2.5d";
  selectedId: string | null;
  spaceId: string | null;
  search: string;
  page: number;
  buildingId: string | null;
  floorId: string | null;
}
export const initialCampusMapPresentation: CampusMapPresentation = { panel: null, expanded: false, mode: "2.5d", selectedId: null, spaceId: null, search: "", page: 1, buildingId: null, floorId: null };
const panels: CampusMapPanel[] = ["search", "place", "directions", "day", "layers", "operations", "information"];
/** Presentation is scoped to a campus and server-selected world; it never selects authority. */
export function readCampusMapPresentation(params: URLSearchParams, context: string, data: CampusScenePublished): CampusMapPresentation {
  if (params.get("map_context") !== context) return initialCampusMapPresentation;
  const panel = params.get("map_panel") as CampusMapPanel;
  const selectedId = params.get("map_place");
  const requestedFloor = params.get("map_view_floor");
  const building = requestedFloor && data.places.some(place => place.id === requestedFloor && place.kind === "floor") && data.scene ? sceneFloorBuilding(data.scene.document, data.places, requestedFloor) : null;
  const buildingId = building?.id === params.get("map_inside") ? building.id : null;
  return { buildingId, floorId: buildingId ? requestedFloor : null, panel: panels.includes(panel) ? panel : params.get("map_panel") === "closed" ? null : params.has("map_to") ? "directions" : null,
    expanded: params.get("map_full") === "1", mode: params.get("map_mode") === "2d" ? "2d" : "2.5d",
    selectedId: data.scene?.document.elements.some(item => item.id === selectedId) ? selectedId : null,
    spaceId: data.places.some(place => place.id === params.get('map_space')) ? params.get('map_space') : null,
    search: (params.get("map_search") ?? "").slice(0, 200), page: Math.max(1, Math.min(10000, Math.floor(Number(params.get("map_page"))) || 1)) };
}
export function campusMapPresentationChanges(value: Partial<CampusMapPresentation>): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  if ("panel" in value) result.map_panel = value.panel ?? "closed";
  if ("expanded" in value) result.map_full = value.expanded ? "1" : null;
  if ("mode" in value) result.map_mode = value.mode === "2d" ? "2d" : null;
  if ("selectedId" in value) result.map_place = value.selectedId ?? null;
  if ("spaceId" in value) result.map_space = value.spaceId ?? null;
  if ("search" in value) result.map_search = value.search || null;
  if ("page" in value) result.map_page = value.page && value.page > 1 ? String(value.page) : null;
  if ("buildingId" in value) result.map_inside = value.buildingId ?? null;
  if ("floorId" in value) result.map_view_floor = value.floorId ?? null;
  return result;
}

/** One canonical place may have several imported outline fragments. Names never merge identities. */
export function campusMapSearchPlaces(elements: CampusSceneElement[]): CampusSceneElement[] {
  const seen = new Set<string>();
  return elements.filter(item => {
    if (item.kind !== "building" && item.kind !== "room" && !item.space_id) return false;
    const identity = item.space_id ? `place:${item.space_id}` : `element:${item.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
