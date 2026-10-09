import type { CollectorTrip, Rider, RouteStop } from "./api";

export interface RiderStop { stop: RouteStop; riders: Rider[]; action: "Boarding" | "Pickup" | "Drop-off" | "School arrival" }
export function coordinates(point: { latitude: unknown; longitude: unknown }) {
  if (point.latitude == null || point.longitude == null || point.latitude === "" || point.longitude === "") return null;
  const latitude = Number(point.latitude), longitude = Number(point.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const value = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
export function riderStops(trip: CollectorTrip): RiderStop[] {
  const stops = [...(trip.stops ?? [])].filter(s => s.direction === trip.direction).sort((a, b) => a.sequence - b.sequence);
  // Older routes without complete stop metadata still have a manual roster.
  for (const rider of trip.roster) if (!stops.some(s => s.id === rider.stop_id)) stops.push({ id: rider.stop_id, direction: trip.direction, sequence: rider.stop_sequence, name: rider.stop_name, planned_time: rider.planned_time, latitude: null, longitude: null });
  stops.sort((a, b) => a.sequence - b.sequence);
  const pending = trip.roster.filter(r => !["dropped", "not_riding"].includes(r.state));
  const virtualSchool: RouteStop = { id: "school-arrival", direction: trip.direction, sequence: (stops.at(-1)?.sequence ?? 0) + 1, name: "School", latitude: null, longitude: null, planned_time: null };
  const first = stops[0];
  if (trip.direction === "from_institution" && trip.state !== "in_progress") return pending.length ? [{ stop: first && !trip.roster.some(r => r.stop_id === first.id) ? first : virtualSchool, riders: pending, action: "Boarding" }] : [];
  const inbound = trip.direction === "to_institution";
  // The final inbound route stop is the school, not a student's home pickup.
  const last = (trip.stops ?? []).filter(s => s.direction === trip.direction).sort((a, b) => b.sequence - a.sequence)[0];
  const school = inbound ? last && !trip.roster.some(r => r.stop_id === last.id) ? last : virtualSchool : undefined;
  if (school && !stops.some(s => s.id === school.id)) stops.push(school);
  return stops.map(stop => ({ stop, riders: pending.filter(r => inbound && r.boarded_at ? stop.id === school?.id : r.stop_id === stop.id), action: inbound ? stop.id === school?.id ? "School arrival" as const : "Pickup" as const : "Drop-off" as const })).filter(group => group.riders.length);
}
export function stopFocus(trip: CollectorTrip, groups: RiderStop[], now = Date.now()) {
  const next = groups[0] ?? null;
  const location = trip.latest_location;
  const point = location && coordinates(location);
  const age = location ? now - new Date(location.observed_at).getTime() : Infinity;
  const accuracy = Number(location?.accuracy_metres);
  if (trip.state !== "in_progress" || !point || !trip.location_fresh || !Number.isFinite(age) || age < -5_000 || age > 90_000 || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 75) {
    return { group: next, distance: null, nearby: false, message: trip.state === "in_progress" ? "Choose a stop while waiting for an accurate location." : "Location focus starts after departure." };
  }
  const distances = groups.flatMap(group => { const target = coordinates(group.stop); return target ? [{ group, distance: distanceMetres(point, target) }] : []; }).sort((a, b) => a.distance - b.distance);
  const nearest = distances[0];
  if (nearest && nearest.distance <= 75) {
    const ambiguous = distances[1] && distances[1].distance - nearest.distance < Math.max(20, accuracy);
    if (ambiguous) return { group: next, distance: null, nearby: false, message: "Stops are close together. Choose the stop you are at." };
    return { ...nearest, nearby: true, message: "Nearby stop · Confirm each learner yourself." };
  }
  return { group: next, distance: distances.find(item => item.group.stop.id === next?.stop.id)?.distance ?? null, nearby: false, message: "Next stop · Distance is straight-line, not a road ETA." };
}
