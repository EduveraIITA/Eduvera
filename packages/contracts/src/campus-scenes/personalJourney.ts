import type { CampusSceneDocument, CampusSceneSpace } from "./types";
import { sceneWalkingPlaceIds } from "./sceneWalking";
import type { CampusPersonalDestination, CampusPersonalResponse } from "../campus-personal";

/** Fallback view for destinations without an authored indoor endpoint. */
export function personalOutdoorScene(scene: CampusSceneDocument | null) {
  return scene ? { ...scene, elements: scene.elements.filter(item => item.kind !== "path" || item.floor_id === null) } : null;
}

export function personalJourneyDestinations(data: CampusPersonalResponse) {
  return [...new Map([...data.now, ...data.next, ...data.destinations].map(item => [item.id, item])).values()];
}
export function personalJourneySignature(item: CampusPersonalDestination) {
  return JSON.stringify([item.id, item.source.record_id, item.source.revision, item.space_id, item.starts_at, item.ends_at, item.target_path]);
}
export function personalJourneyPlaceTrail(places: Array<Omit<CampusSceneSpace, "campus_id">>, id: string | null) {
  const trail: typeof places = [], seen = new Set<string>();
  let place = places.find(item => item.id === id);
  while (place && !seen.has(place.id)) {
    seen.add(place.id); trail.unshift(place);
    place = places.find(item => item.id === place?.parent_space_id);
  }
  return trail;
}
/** An outdoor walk may end at an explicitly linked ancestor entrance, never the nearest graphic. */
export function personalWalkingDestination(scene: CampusSceneDocument | null, places: Array<Omit<CampusSceneSpace, "campus_id">>, id: string | null) {
  if (!scene || !id) return null;
  if (sceneWalkingPlaceIds(scene).includes(id)) return places.find(place => place.id === id) ?? null;
  const endpoints = new Set(sceneWalkingPlaceIds(personalOutdoorScene(scene)!));
  return personalJourneyPlaceTrail(places, id).reverse().find(place => endpoints.has(place.id)) ?? null;
}
export function personalJourneyTime(item: CampusPersonalDestination, timezone: string, localDate: string) {
  if (!item.starts_at) return "Assigned to you";
  const start = new Date(item.starts_at), end = item.ends_at ? new Date(item.ends_at) : null;
  if (Number.isNaN(start.getTime())) return "Time not provided";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const day = date === localDate ? "" : `${new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(start)} · `;
  return `${day}${time.format(start)}${end && !Number.isNaN(end.getTime()) ? `–${time.format(end)}` : ""}`;
}
