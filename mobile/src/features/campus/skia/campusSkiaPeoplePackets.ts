import type { ScenePeopleCompiled, ScenePeopleTrack } from '../../../../../packages/contracts/src/campus-scenes/scenePeopleTracks.types';
import type { ScenePeopleOccluder } from '../../../../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry';
import type { SceneViewMode } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';

export interface CampusSkiaCamera { x: number; y: number; scale: number }
interface MotionEdge { fromX: number; fromY: number; toX: number; toY: number; start: number; end: number; visible: boolean; fits: boolean }
interface MotionTrack {
  starts: number; ends: number; routeStarts: number; routeEnds: number; length: number;
  edges: readonly MotionEdge[]; x: number; y: number; heading: number; seed: number;
  self: boolean; retargeted: boolean;
}
interface MotionInterval { starts: number; ends: number; indices: readonly number[] }
interface MotionPulse { x: number; y: number; observed: number; accepted: boolean }
interface OcclusionBox { x: number; y: number; width: number; height: number; depth: number; index: number }
export interface CampusSkiaPeoplePacket {
  contextKey: string; tracks: readonly MotionTrack[]; intervals: readonly MotionInterval[];
  pulses: readonly MotionPulse[]; maximum: number; clippedMaximum: number;
  groundScale: number; unit: number; occluders: readonly OcclusionBox[];
  /** Sparse index: cells retain only numeric source indices, never native objects. */
  cells: Readonly<Record<string, readonly number[]>>; cellSize: number;
  globalOccluders: readonly number[];
}
/** x/y are projected world coordinates. Atlas cells and per-person clips are compiled separately. */
export interface CampusSkiaPersonSample {
  x: number; y: number; depth: number; height: number; direction: number; step: number;
  wardrobe: number; alpha: number; clips: number[]; clipKey: string;
}
export interface CampusSkiaPulseSample { x: number; y: number; accepted: boolean; progress: number }
export interface CampusSkiaPeopleFrame { people: CampusSkiaPersonSample[]; pulses: CampusSkiaPulseSample[] }

const seed = (key: string) => {
  let value = 2166136261;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
};
const floorMatches = (track: ScenePeopleTrack, floor: string | null) => track.route
  ? track.route.edges.some(edge => edge.floorId === floor) : track.idle?.floorId === floor;

/** No route finding or geometry evaluation reaches the frame loop. Selection is compiled
 * at source interval boundaries using the shared owner's route-over-idle/self precedence. */
export function compileCampusSkiaPeoplePacket(data: ScenePeopleCompiled | null, options: {
  floorId: string | null; mode: SceneViewMode; unit: number; maxPeople?: number;
  occluders?: readonly ScenePeopleOccluder[]; wide?: boolean;
}): CampusSkiaPeoplePacket {
  const maximum = Number.isFinite(options.maxPeople) ? Math.max(0, Math.min(256, Math.floor(options.maxPeople!))) : options.wide ? 256 : 128;
  const source = data?.tracks.filter(track => floorMatches(track, options.floorId) && Number.isFinite(track.startsAt) && Number.isFinite(track.endsAt) && track.endsAt > track.startsAt) ?? [];
  const tracks: MotionTrack[] = source.map(track => ({
    starts: track.startsAt, ends: track.endsAt, routeStarts: track.routeStartsAt ?? track.startsAt,
    routeEnds: track.routeEndsAt ?? track.endsAt, length: track.route?.length ?? 0,
    edges: track.route?.edges.map(edge => ({ fromX: edge.from.x, fromY: edge.from.y, toX: edge.to.x, toY: edge.to.y,
      start: edge.startDistance, end: edge.endDistance, visible: edge.floorId === options.floorId,
      fits: !!edge.corridor && Math.max(0, track.bodyRadius ?? 0) <= edge.corridor.width / 2 })) ?? [],
    x: track.idle?.point.x ?? 0, y: track.idle?.point.y ?? 0, heading: seed(track.key) * Math.PI * 2,
    seed: seed(track.key), self: track.tone === 'self', retargeted: !!track.retargeted,
  }));
  const groups: number[][] = [], groupIds = new Map<string, number>(), groupFor: number[] = [];
  const events = new Map<number, { starts: number[]; ends: number[] }>();
  for (let index = 0; index < source.length; index++) {
    const track = source[index]!;
    let group = groupIds.get(track.key);
    if (group === undefined) { group = groups.length; groupIds.set(track.key, group); groups.push([]); }
    groups[group]!.push(index); groupFor.push(group);
    if (!events.has(track.startsAt)) events.set(track.startsAt, { starts: [], ends: [] });
    if (!events.has(track.endsAt)) events.set(track.endsAt, { starts: [], ends: [] });
    events.get(track.startsAt)!.starts.push(index); events.get(track.endsAt)!.ends.push(index);
  }
  const boundaries = [...events.keys()].sort((a, b) => a - b), active = new Array<boolean>(source.length).fill(false);
  const winners = new Array<number>(groups.length).fill(-1), ranked: number[] = [];
  const rank = (a: number, b: number) => Number(tracks[b]!.self) - Number(tracks[a]!.self)
    || Number(!!tracks[b]!.edges.length) - Number(!!tracks[a]!.edges.length) || tracks[a]!.seed - tracks[b]!.seed || groupFor[a]! - groupFor[b]!;
  const intervals: MotionInterval[] = [];
  for (let boundary = 0; boundary + 1 < boundaries.length; boundary++) {
    const starts = boundaries[boundary]!, ends = boundaries[boundary + 1]!, event = events.get(starts)!, changed = new Set<number>();
    for (const index of event.ends) { active[index] = false; changed.add(groupFor[index]!); }
    for (const index of event.starts) { active[index] = true; changed.add(groupFor[index]!); }
    // Sweep only changed subjects instead of rescanning every claim at every boundary.
    for (const group of changed) {
      let winner = -1;
      for (const index of groups[group]!) if (active[index] && (source[index]!.route || winner < 0)) winner = index;
      const prior = winners[group]!;
      if (prior === winner) continue;
      if (prior >= 0) ranked.splice(ranked.indexOf(prior), 1);
      winners[group] = winner;
      if (winner >= 0) {
        let low = 0, high = ranked.length;
        while (low < high) { const middle = Math.floor((low + high) / 2); if (rank(ranked[middle]!, winner) <= 0) low = middle + 1; else high = middle; }
        ranked.splice(low, 0, winner);
      }
    }
    const indices = ranked.slice(0, maximum);
    if (!indices.length) continue;
    const previous = intervals.at(-1);
    if (previous?.ends === starts && previous.indices.length === indices.length && previous.indices.every((value, index) => value === indices[index])) previous.ends = ends;
    else intervals.push({ starts, ends, indices });
  }
  const groundScale = options.mode === '2d' ? 1 : Math.sin(52 * Math.PI / 180);
  const unit = Number.isFinite(options.unit) && options.unit > 0 ? options.unit : 1;
  const cellSize = Math.max(.01, unit * 24), cells: Record<string, number[]> = {}, globalOccluders: number[] = [];
  const occluders = (options.occluders ?? []).map((occluder, index) => ({ ...occluder.bounds, depth: occluder.depth, index }));
  for (const box of occluders) {
    const minX = Math.floor(box.x / cellSize), maxX = Math.floor((box.x + box.width) / cellSize);
    const minY = Math.floor(box.y / cellSize), maxY = Math.floor((box.y + box.height) / cellSize);
    // A malformed enormous footprint cannot allocate an unbounded index.
    if (![minX, maxX, minY, maxY, box.depth].every(Number.isFinite)) continue;
    if ((maxX - minX + 1) * (maxY - minY + 1) > 4096) { globalOccluders.push(box.index); continue; }
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) (cells[`${x}:${y}`] ??= []).push(box.index);
  }
  return { contextKey: data?.contextKey ?? '', tracks, intervals,
    pulses: data?.points.filter(point => point.floorId === options.floorId && Number.isFinite(point.observedAt)).slice(0, 64)
      .map(point => ({ x: point.point.x, y: point.point.y, observed: point.observedAt, accepted: point.dimension === 'accepted' })) ?? [],
    maximum, clippedMaximum: options.wide ? 64 : 32, groundScale,
    unit, occluders, cells, cellSize, globalOccluders };
}

function edgeAt(edges: readonly MotionEdge[], distance: number) {
  'worklet';
  let low = 0, high = edges.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (edges[middle]!.end <= distance) low = middle + 1; else high = middle; }
  return edges[low]!;
}
function routePoint(track: MotionTrack, distance: number) {
  'worklet';
  const travelled = Math.max(0, Math.min(track.length, distance)), edge = edgeAt(track.edges, travelled);
  const progress = Math.max(0, Math.min(1, (travelled - edge.start) / Math.max(.000001, edge.end - edge.start)));
  return { x: edge.fromX + (edge.toX - edge.fromX) * progress, y: edge.fromY + (edge.toY - edge.fromY) * progress, edge };
}

/** Idle-only scenes update time-bound visibility once a second without redrawing
 * the GPU at display frequency. Walking and the first four seconds of a ring use
 * the actual display cadence. This does not advance Simulation's clock. */
export function campusSkiaPeopleAnimateAt(packet: CampusSkiaPeoplePacket, instant: number): boolean {
  'worklet';
  let low = 0, high = packet.intervals.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (packet.intervals[middle]!.ends <= instant) low = middle + 1; else high = middle; }
  const interval = packet.intervals[low];
  if (interval && interval.starts <= instant && interval.ends > instant) for (const index of interval.indices) if (packet.tracks[index]!.edges.length) return true;
  for (const pulse of packet.pulses) if (instant >= pulse.observed && instant < pulse.observed + 4000) return true;
  return false;
}

/** Pure, worklet-safe numeric sampling. No Date, promises, React state, routing or
 * imported geometry calls. Caller passes only Live time or a confirmed Simulation instant. */
export function sampleCampusSkiaPeoplePacket(packet: CampusSkiaPeoplePacket, instant: number | null, camera: CampusSkiaCamera,
  viewport: { width: number; height: number }, animate = true): CampusSkiaPeopleFrame {
  'worklet';
  const people: CampusSkiaPersonSample[] = [], pulses: CampusSkiaPulseSample[] = [];
  if (instant === null || !Number.isFinite(instant) || !Number.isFinite(camera.scale) || camera.scale <= 0
    || !Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) return { people, pulses };
  let low = 0, high = packet.intervals.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (packet.intervals[middle]!.ends <= instant) low = middle + 1; else high = middle; }
  const interval = packet.intervals[low];
  const height = Math.max(5, Math.min(24, packet.unit * camera.scale * 2.7)), worldHeight = height / camera.scale;
  let clipped = 0;
  if (interval && interval.starts <= instant && interval.ends > instant) for (const index of interval.indices) {
    const track = packet.tracks[index]!;
    let x = track.x, y = track.y, heading = track.heading, opacity = 1;
    if (track.edges.length) {
      const distance = track.length * Math.max(0, Math.min(1, (instant - track.routeStarts) / Math.max(1, track.routeEnds - track.routeStarts)));
      const point = routePoint(track, distance);
      if (!point.edge.visible || !point.edge.fits) continue;
      x = point.x; y = point.y;
      const before = routePoint(track, distance - .5), after = routePoint(track, distance + .5);
      heading = Math.atan2((after.y - before.y) * packet.groundScale, after.x - before.x);
      opacity = Math.max(0, Math.min(1, track.retargeted ? 1 : (instant - track.starts) / 500, (track.ends - instant) / 500));
    }
    const projectedY = y * packet.groundScale, screenX = x * camera.scale + camera.x, screenY = projectedY * camera.scale + camera.y;
    // Reject offscreen figures before walking geometry and native clip work.
    if (opacity <= 0 || screenX + height * .5 < 0 || screenX - height * .5 > viewport.width || screenY < 0 || screenY - height > viewport.height) continue;
    const boxX = x - worldHeight * .45, boxY = projectedY - worldHeight, boxW = worldHeight * .9, boxH = worldHeight * 1.1;
    const clips: number[] = [], seen: Record<number, boolean> = {};
    const minX = Math.floor(boxX / packet.cellSize), maxX = Math.floor((boxX + boxW) / packet.cellSize);
    const minY = Math.floor(boxY / packet.cellSize), maxY = Math.floor((boxY + boxH) / packet.cellSize);
    // At very distant zoom a sprite may span many source cells. All bounds remain
    // authoritative; the bounded global scan is cheaper than enumerating those cells.
    const candidates: readonly number[] = (maxX - minX + 1) * (maxY - minY + 1) > 64 ? packet.occluders.map(item => item.index) : [];
    const consider = (candidate: number) => {
      'worklet';
      if (seen[candidate]) return; seen[candidate] = true;
      const box = packet.occluders[candidate]!;
      if (box.depth >= y && box.x < boxX + boxW && box.x + box.width > boxX && box.y < boxY + boxH && box.y + box.height > boxY) clips.push(candidate);
    };
    if (candidates.length) for (const candidate of candidates) consider(candidate);
    else for (let cellX = minX; cellX <= maxX; cellX++) for (let cellY = minY; cellY <= maxY; cellY++) {
      const cell = packet.cells[`${cellX}:${cellY}`]; if (cell) for (const candidate of cell) consider(candidate);
    }
    for (const candidate of packet.globalOccluders) consider(candidate);
    clips.sort((a, b) => a - b);
    // The crowd is representative, never an attendance count. Preserve exact clipping
    // for a bounded visible crowd; omit overflow instead of drawing through a wall.
    if (clips.length && ++clipped > packet.clippedMaximum) continue;
    people.push({ x, y: projectedY, depth: y, height,
      direction: (Math.round(heading / (Math.PI / 4)) + 8) % 8,
      step: animate && track.edges.length ? 1 + Math.floor((instant / 120 + track.seed * 8) % 8) : 0,
      wardrobe: track.self ? 0 : 1 + Math.floor(track.seed * 5), alpha: opacity, clips, clipKey: clips.join(',') });
  }
  people.sort((a, b) => a.depth - b.depth);
  for (const pulse of packet.pulses) {
    const age = instant - pulse.observed;
    if (age < 0 || age >= 120000) continue;
    const x = pulse.x * camera.scale + camera.x, y = pulse.y * packet.groundScale * camera.scale + camera.y;
    if (x >= -20 && x <= viewport.width + 20 && y >= -20 && y <= viewport.height + 20) pulses.push({ x, y, accepted: pulse.accepted, progress: animate ? Math.min(1, age / 4000) : 1 });
  }
  return { people, pulses };
}
