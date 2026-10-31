import type { CampusMotionClaim, CampusMotionProjection } from "../campus-motion";
import { sceneUnitScale } from "./sceneGeometry";
import { sceneEvidenceAnchor } from "./sceneEvidencePlacement";
import { sceneWalkingPlaceIds } from "./sceneWalking";
import { createScenePeopleRouteResolver, sampleScenePeopleRoute, scenePeopleIdleSlots } from "./scenePeopleMotion";
import type { ScenePeopleMotionScope } from "./scenePeopleMotion";
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint, CampusSceneSpace } from "./types";
import type { ScenePeopleCompiled, ScenePeoplePose, ScenePeoplePulsePose, ScenePeopleTrack } from "./scenePeopleTracks.types";
export type { ScenePeopleCompiled, ScenePeoplePose, ScenePeoplePulsePose, ScenePeopleClock } from "./scenePeopleTracks.types";

type Place = Pick<CampusSceneSpace, "id" | "parent_space_id" | "kind">;
const hash = (key: string) => { let n = 2166136261; for (const character of key) n = Math.imul(n ^ character.charCodeAt(0), 16777619); return (n >>> 0) / 4294967296; };
const signature = (claim: CampusMotionClaim) => JSON.stringify([claim.id, claim.space_id, claim.starts_at, claim.ends_at, claim.source]);
const representativeCount = (kind: string, count: number) => kind === "group" ? Math.min(8, Math.max(1, Math.ceil(Math.sqrt(count)))) : 1;
const active = (track: ScenePeopleTrack, now: number) => track.startsAt <= now && now < track.endsAt;
const walkingSpeed = (key: string) => 1.1 + hash(key) * .32;

/** The scene graph supplies all coordinates. Canonical ancestry may supply a known outdoor entrance. */
function placeResolver(scene: CampusSceneDocument, places: readonly Place[]) {
  const byId = new Map(places.map(place => [place.id, place]));
  const graphics = new Map<string, CampusSceneElement>();
  for (const element of scene.elements) if (element.space_id && element.review_state === "reviewed" && !graphics.has(element.space_id)) graphics.set(element.space_id, element);
  const endpoints = new Set(sceneWalkingPlaceIds(scene));
  const trail = (id: string | null) => { const ids: string[] = [], seen = new Set<string>(); let current = id;
    while (current && !seen.has(current)) { seen.add(current); ids.push(current); current = byId.get(current)?.parent_space_id ?? null; } return ids; };
  return { graphic: (id: string | null) => id ? graphics.get(id) : undefined,
    endpoint: (id: string | null) => trail(id).find(value => endpoints.has(value)) ?? null,
    eventGraphic: (id: string) => trail(id).map(value => graphics.get(value)).find(Boolean) };
}

/** Compile bounded, reusable illustration tracks once per source/layout change, never per frame. */
export interface ScenePeopleRoutingState { routingAvailable?: boolean; excludedConnectorIds?: readonly string[] }
export function compileScenePeopleTracks(scene: CampusSceneDocument, places: readonly Place[], projection: CampusMotionProjection, publicationKey: string, routing: ScenePeopleRoutingState = {}): ScenePeopleCompiled {
  const worldKey = `${projection.school_id}:${projection.campus_id}:${projection.environment.kind}:${projection.environment.namespace_id ?? "live"}`;
  const excludedConnectorIds = [...(routing.excludedConnectorIds ?? [])].sort();
  const networkKey = JSON.stringify([routing.routingAvailable !== false, excludedConnectorIds, scene.elements.filter(element => element.navigation || element.navigation_connector).map(element => [element.id, element.geometry, element.floor_id, element.navigation, element.navigation_connector])]);
  const scope: ScenePeopleMotionScope = { worldKey, publicationKey, networkKey };
  const resolve = placeResolver(scene, places), routes = createScenePeopleRouteResolver(scene, scope);
  const unit = sceneUnitScale(scene), tracks: ScenePeopleTrack[] = [];
  let unmapped = 0, unavailableRoutes = 0, conflicting = 0;
  for (const subject of projection.subjects) {
    const claims = subject.claims.filter(claim => claim.expected_count > 0 && claim.spatial_claim === "expected_context_only")
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
    const overlaps = new Set<string>();
    for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length && Date.parse(claims[j]!.starts_at) < Date.parse(claims[i]!.ends_at); j++) {
      if (claims[i]!.space_id !== claims[j]!.space_id) { overlaps.add(claims[i]!.id); overlaps.add(claims[j]!.id); }
    }
    conflicting += overlaps.size ? 1 : 0;
    const ordered = claims.filter(claim => !overlaps.has(claim.id));
    for (let index = 0; index < ordered.length; index++) {
      const claim = ordered[index]!, element = resolve.graphic(claim.space_id), target = resolve.endpoint(claim.space_id);
      const count = representativeCount(subject.kind, claim.expected_count), tone = subject.kind === "self" ? "self" as const : "expected" as const;
      if (!element) unmapped++;
      // Rooms stay on their recorded floor. Building rollups never put their occupants outside.
      const slots = element && ["room", "surface"].includes(element.kind) && element.geometry.type === "polygon"
        ? scenePeopleIdleSlots(element, count, unit, subject.subject_key, unit * .9) : [];
      for (let figure = 0; figure < slots.length; figure++) tracks.push({ key: `${subject.subject_key}:${figure}`, sourceKey: signature(claim), tone, targetSpaceId: target,
        startsAt: Date.parse(claim.starts_at), endsAt: Date.parse(claim.ends_at), idle: { point: slots[figure]!, floorId: element!.floor_id, element: element! } });
      const previous = claims[claims.indexOf(claim) - 1];
      if (!previous || overlaps.has(previous.id) || previous.space_id === claim.space_id || Date.parse(previous.ends_at) > Date.parse(claim.starts_at)) continue;
      // A shorter nested claim for the same place cannot end its context early.
      let previousEnd = Date.parse(previous.ends_at);
      for (let earlier = claims.indexOf(previous) - 1; earlier >= 0; earlier--) {
        const prior = claims[earlier]!;
        if (overlaps.has(prior.id) || prior.space_id !== previous.space_id) break;
        previousEnd = Math.max(previousEnd, Date.parse(prior.ends_at));
      }
      const from = resolve.endpoint(previous.space_id);
      if (!from || !target || from === target) { if (from !== target) unavailableRoutes++; continue; }
      if (routing.routingAvailable === false) { unavailableRoutes++; continue; }
      const result = routes.resolve(from, target, { excludedConnectorIds }), plan = result.status === "available" ? result.plan : null;
      if (!plan) { unavailableRoutes++; continue; }
      // This is visual walking pace, not an ETA or a new attendance/location rule.
      const duration = Math.max(12_000, plan.length / (unit * walkingSpeed(subject.subject_key)) * 1000);
      const starts = Math.max(previousEnd, Date.parse(claim.starts_at) - duration);
      for (let figure = 0; figure < count; figure++) {
        const stagger = hash(subject.subject_key) * Math.min(7000, duration * .1) + figure * Math.min(2400, duration * .035), fromAt = starts + stagger, until = fromAt + duration;
        if (until > Date.parse(claim.ends_at)) continue;
        tracks.push({ key: `${subject.subject_key}:${figure}`, sourceKey: signature(claim), tone, targetSpaceId: target,
          startsAt: fromAt, endsAt: until, bodyRadius: unit * .24, route: plan, routeStartsAt: fromAt, routeEndsAt: until });
      }
    }
  }
  const points = projection.points.flatMap(point => {
    const element = resolve.eventGraphic(point.space_id);
    if (!element) return [];
    const anchor = sceneEvidenceAnchor(element);
    return anchor ? [{ key: point.id, point: anchor, floorId: element.floor_id, observedAt: Date.parse(point.observed_at), dimension: point.dimension }] : [];
  });
  return { contextKey: `${worldKey}:${publicationKey}`, scope, asOf: Date.parse(projection.as_of), tracks, points, excludedConnectorIds, unmapped, unavailableRoutes, conflicting, sourceLimited: projection.limits.source_limited };
}

function routeDistance(track: ScenePeopleTrack, instant: number) {
  const start = track.routeStartsAt ?? track.startsAt, end = track.routeEndsAt ?? track.endsAt;
  return track.route ? track.route.length * Math.max(0, Math.min(1, (instant - start) / Math.max(1, end - start))) : 0;
}

/** Preserve an in-flight figure when an authorized plan changes, using only its exact existing edge. */
export function reconcileScenePeopleTracks(previous: ScenePeopleCompiled | null, next: ScenePeopleCompiled, scene: CampusSceneDocument, instant: number | null): ScenePeopleCompiled {
  if (!previous || previous.contextKey !== next.contextKey || previous.scope.networkKey !== next.scope.networkKey || instant === null || instant < previous.asOf) return next;
  const additions: ScenePeopleTrack[] = [];
  for (const old of previous.tracks) {
    if (!old.route || !active(old, instant)) continue;
    const replacement = next.tracks.find(track => track.key === old.key && track.endsAt > instant && (active(track, instant) || track.startsAt >= instant));
    if (!replacement?.targetSpaceId) continue;
    if (replacement.sourceKey === old.sourceKey) {
      if (old.retargeted) additions.push(old);
      continue;
    }
    const resolver = createScenePeopleRouteResolver(scene, next.scope);
    const result = resolver.retarget(old.route, routeDistance(old, instant), replacement.targetSpaceId, { excludedConnectorIds: next.excludedConnectorIds });
    if (result.status !== "available") continue;
    const speed = old.route.length / Math.max(1, (old.routeEndsAt ?? old.endsAt) - (old.routeStartsAt ?? old.startsAt)) * 1000;
    const duration = Math.max(12_000, result.plan.length / Math.max(.01, speed) * 1000);
    const end = Math.min(replacement.endsAt, instant + duration);
    if (end <= instant) continue;
    additions.push({ ...replacement, retargeted: true, startsAt: instant, endsAt: end, route: result.plan, routeStartsAt: instant, routeEndsAt: instant + duration, idle: undefined });
  }
  return additions.length ? { ...next, tracks: [...next.tracks, ...additions] } : next;
}

/** Stateless time sampling makes pause, forward steps and backwards seeks deterministic. */
export interface ScenePeopleSampleOptions { maxPeople?: number; floorId?: string | null }
export function sampleScenePeople(data: ScenePeopleCompiled, instant: number | null, options: ScenePeopleSampleOptions = {}): { people: ScenePeoplePose[]; pulses: ScenePeoplePulsePose[] } {
  if (instant === null || !Number.isFinite(instant)) return { people: [], pulses: [] };
  const limit = Math.max(0, Math.min(256, Math.floor(options.maxPeople ?? 256)));
  const eligible = new Map<string, ScenePeopleTrack>();
  for (const track of data.tracks) {
    if (!active(track, instant)) continue;
    if (options.floorId !== undefined && (track.route ? !track.route.edges.some(edge => edge.floorId === options.floorId) : track.idle?.floorId !== options.floorId)) continue;
    // Resolve overlapping idle/walk presentation first; expensive geometry is sampled only after the cap.
    if (track.route || !eligible.has(track.key)) eligible.set(track.key, track);
  }
  const chosen = [...eligible.values()].sort((a, b) => Number(b.tone === "self") - Number(a.tone === "self") || Number(Boolean(b.route)) - Number(Boolean(a.route)) || hash(a.key) - hash(b.key)).slice(0, limit);
  const people = new Map<string, ScenePeoplePose>();
  for (const track of chosen) {
    const phase = instant / 160 + hash(track.key) * Math.PI * 2;
    if (track.route) {
      const distance = routeDistance(track, instant), sample = sampleScenePeopleRoute(track.route, distance, { bodyRadius: track.bodyRadius });
      if (!sample || !sample.fitsCorridor || options.floorId !== undefined && sample.floorId !== options.floorId) continue;
      const before = sampleScenePeopleRoute(track.route, distance - .5), after = sampleScenePeopleRoute(track.route, distance + .5);
      const heading = before && after ? Math.atan2(after.point.y - before.point.y, after.point.x - before.point.x) : sample.heading;
      const opacity = Math.min(1, track.retargeted ? 1 : (instant - track.startsAt) / 500, (track.endsAt - instant) / 500);
      people.set(track.key, { key: track.key, point: sample.point, floorId: sample.floorId, heading, moving: true, phase, opacity, tone: track.tone });
    } else if (track.idle && !people.has(track.key)) {
      const point: CampusScenePoint = { ...track.idle.point };
      people.set(track.key, { key: track.key, point, floorId: track.idle.floorId, heading: hash(track.key) * Math.PI * 2, moving: false, phase, opacity: 1, tone: track.tone });
    }
  }
  const pulses = data.points.flatMap(point => { const ageMs = instant - point.observedAt; return ageMs >= 0 && ageMs < 120_000 ? [{ key: point.key, point: point.point, floorId: point.floorId, ageMs, dimension: point.dimension }] : []; });
  return { people: [...people.values()], pulses };
}
