import { applicationNow } from "../simulation/applicationTime";
import { projectScenePoint, scenePointDepth, type SceneSize, type SceneViewport, type SceneViewMode } from "./sceneGeometry";
import type { SceneLighting } from "./sceneLighting";
import { sampleScenePeople } from "./scenePeopleTracks";
import type { ScenePeopleClock, ScenePeopleCompiled, ScenePeoplePose } from "./scenePeopleTracks.types";
import { sceneShadowOffset, type SceneSunlight } from "./sceneSunlight";
import { eraseScenePeopleOccluder, type ScenePeoplePreparedOccluder } from "./scenePeopleOcclusion";
import { createScenePeopleSpriteAtlas, drawScenePeopleSprite, type ScenePeopleSpriteAtlas, type ScenePeopleSpritePalette } from "./scenePeopleSprites";

export interface ScenePeopleRendererModel {
  data: ScenePeopleCompiled; clock: ScenePeopleClock; viewport: SceneViewport; size: SceneSize;
  mode: SceneViewMode; floorId: string | null; unit: number; lighting: SceneLighting; sunlight: SceneSunlight;
  occluders: readonly ScenePeoplePreparedOccluder[]; sourceSignature: string;
}
interface PaintEntry { pose: ScenePeoplePose; x: number; y: number; depth: number; distance: number }
interface Ease { from: number; to: number; started: number; valid: ReadonlySet<string>; pulseKeys: ReadonlySet<string> }
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const elapsed = (ease: Ease, time: number) => Math.max(0, Math.min(1, (time - ease.started) / 180));
const easedInstant = (ease: Ease, time: number) => { const progress = elapsed(ease, time); return ease.from + (ease.to - ease.from) * (progress * progress * (3 - 2 * progress)); };

/** Imperative presentation engine: no React commits, domain writes or routing in its frame loop. */
export function createScenePeopleRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches, hidden = document.hidden, model: ScenePeopleRendererModel | null = null;
  let frame: number | null = null, wake: ReturnType<typeof setTimeout> | null = null, disposed = false;
  let atlas: ScenePeopleSpriteAtlas | null = null, atlasKey = "", dpr = 1, ease: Ease | null = null;
  let paletteLighting: SceneLighting | null = null, paletteDpr = 0;
  let colors: ScenePeopleSpritePalette = { action: "#326a91", outline: "#f4f4ed", ink: "#283b40" };
  let lastOccluders: readonly ScenePeoplePreparedOccluder[] | null = null;
  const occluderGrid = new Map<string, number[]>(), largeOccluders: number[] = [], occluderCandidates: number[] = [], batch: PaintEntry[] = [], pool: PaintEntry[] = [];
  let gridSize = 48, seen = new Uint32Array(0), generation = 0;
  const cancel = () => { if (frame !== null) cancelAnimationFrame(frame); if (wake !== null) clearTimeout(wake); frame = null; wake = null; };
  const clear = () => { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); };
  const rebuildIndex = (next: ScenePeopleRendererModel) => {
    if (lastOccluders === next.occluders) return;
    lastOccluders = next.occluders; occluderGrid.clear(); largeOccluders.length = 0; seen = new Uint32Array(next.occluders.length); generation = 0; gridSize = Math.max(24, next.unit * 48);
    next.occluders.forEach((occluder, index) => {
      const left = Math.floor(occluder.bounds.x / gridSize), right = Math.floor((occluder.bounds.x + occluder.bounds.width) / gridSize), top = Math.floor(occluder.bounds.y / gridSize), bottom = Math.floor((occluder.bounds.y + occluder.bounds.height) / gridSize);
      if ((right - left + 1) * (bottom - top + 1) > 256) { largeOccluders.push(index); return; }
      for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
        const key = `${x}:${y}`, entries = occluderGrid.get(key);
        if (entries) entries.push(index); else occluderGrid.set(key, [index]);
      }
    });
  };
  const collectOccluders = (bounds: { x: number; y: number; width: number; height: number }) => {
    occluderCandidates.length = 0;
    if (!model) return;
    generation++; if (generation >= 0xfffffff0) { seen.fill(0); generation = 1; }
    const add = (index: number) => { if (seen[index] !== generation && overlaps(model!.occluders[index]!.bounds, bounds)) { seen[index] = generation; occluderCandidates.push(index); } };
    const left = Math.floor(bounds.x / gridSize), right = Math.floor((bounds.x + bounds.width) / gridSize), top = Math.floor(bounds.y / gridSize), bottom = Math.floor((bounds.y + bounds.height) / gridSize);
    if ((right - left + 1) * (bottom - top + 1) > 512) { for (let index = 0; index < model.occluders.length; index++) add(index); }
    else { for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) { const indices = occluderGrid.get(`${x}:${y}`); if (indices) for (const index of indices) add(index); } for (const index of largeOccluders) add(index); }
    occluderCandidates.sort((a, b) => a - b);
  };
  const palette = (): ScenePeopleSpritePalette => {
    const style = getComputedStyle(canvas);
    return { action: style.getPropertyValue("--thatcampus-action").trim() || "#326a91", outline: style.getPropertyValue("--thatcampus-surface").trim() || "#f4f4ed", ink: style.getPropertyValue("--thatcampus-ink").trim() || "#283b40" };
  };
  const prepare = () => {
    if (!model) return;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.ceil(model.size.width * dpr)), height = Math.max(1, Math.ceil(model.size.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (paletteLighting !== model.lighting || paletteDpr !== dpr) { colors = palette(); paletteLighting = model.lighting; paletteDpr = dpr; }
    const key = `${model.lighting}:${dpr}:${colors.action}:${colors.outline}:${colors.ink}`;
    if (key !== atlasKey) { if (atlas) { atlas.canvas.width = 0; atlas.canvas.height = 0; } atlas = createScenePeopleSpriteAtlas(colors, model.lighting, dpr); atlasKey = key; }
    rebuildIndex(model);
  };
  const draw = (time: number) => {
    if (disposed) return;
    frame = null;
    clear();
    if (hidden || !model || !atlas || model.clock.instant === null || model.size.width <= 0 || model.size.height <= 0) return;
    const { viewport, size, clock, unit, mode, floorId, sunlight } = model, scale = viewport.scale, confirmedInstant = clock.instant;
    if (!Number.isFinite(scale) || scale <= 0 || confirmedInstant === null) return;
    const instant = clock.live && clock.running ? applicationNow().getTime() : ease ? easedInstant(ease, time) : confirmedInstant;
    const budget = size.width < 680 ? 128 : 256;
    const sampled = sampleScenePeople(model.data, instant, { maxPeople: budget, floorId }), easing = ease;
    if (ease && elapsed(ease, time) >= 1) ease = null;
    const margin = 32 / scale, bounds = { x: -viewport.x / scale - margin, y: -viewport.y / scale - margin, width: size.width / scale + margin * 2, height: size.height / scale + margin * 2 };
    batch.length = 0;
    for (const pose of sampled.people) {
      if (pose.floorId !== floorId || pose.opacity <= 0 || !Number.isFinite(pose.point.x) || !Number.isFinite(pose.point.y) || easing && !easing.valid.has(pose.key)) continue;
      const point = projectScenePoint(pose.point, 0, mode);
      if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) continue;
      const index = batch.length, entry = pool[index] ?? (pool[index] = { pose, x: 0, y: 0, depth: 0, distance: 0 });
      entry.pose = pose; entry.x = point.x; entry.y = point.y; entry.depth = scenePointDepth(pose.point);
      entry.distance = Math.hypot(point.x * scale + viewport.x - size.width / 2, point.y * scale + viewport.y - size.height / 2); batch.push(entry);
    }
    if (batch.length > budget) { batch.sort((a, b) => Number(b.pose.tone === "self") - Number(a.pose.tone === "self") || a.distance - b.distance || a.pose.key.localeCompare(b.pose.key)); batch.length = budget; }
    batch.sort((a, b) => a.depth - b.depth || a.pose.key.localeCompare(b.pose.key));
    collectOccluders(bounds);
    context.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * viewport.x, dpr * viewport.y);
    let maskIndex = 0;
    const height = Math.max(5, Math.min(20, unit * scale * 2.5)) / scale, shadow = sceneShadowOffset(unit * 1.8, sunlight);
    const lod = unit * scale < 1.3;
    for (const entry of batch) {
      while (maskIndex < occluderCandidates.length && model.occluders[occluderCandidates[maskIndex]!]!.depth < entry.depth) eraseScenePeopleOccluder(context, model.occluders[occluderCandidates[maskIndex++]!]!);
      const { pose, x, y } = entry;
      context.globalAlpha = Math.max(0, Math.min(1, pose.opacity)); context.fillStyle = model.lighting === "night" ? "#080d13" : "#415747";
      context.save(); context.globalAlpha *= .2; context.beginPath(); context.ellipse(x + shadow.x * .4, y + shadow.y * .25, height * .23, height * .075, 0, 0, Math.PI * 2); context.fill(); context.restore();
      if (lod) {
        context.fillStyle = pose.tone === "self" ? colors.action : model.lighting === "night" ? "#bac4ba" : "#4d666c";
        context.beginPath(); context.ellipse(x, y - height * .35, height * .18, height * .35, 0, 0, Math.PI * 2); context.fill();
      } else drawScenePeopleSprite(context, atlas, pose.key, pose.tone, pose.heading, pose.phase, pose.moving && !reduced && clock.running, x, y, height);
    }
    while (maskIndex < occluderCandidates.length) eraseScenePeopleOccluder(context, model.occluders[occluderCandidates[maskIndex++]!]!);
    context.globalAlpha = 1;
    let visibleFreshPulse = false;
    for (const pulse of sampled.pulses) {
      if (pulse.floorId !== floorId || pulse.ageMs < 0 || pulse.ageMs >= 120_000 || easing && !easing.pulseKeys.has(pulse.key)) continue;
      const point = projectScenePoint(pulse.point, 0, mode);
      if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) continue;
      context.strokeStyle = pulse.dimension === "observed" ? "#59927d" : model.lighting === "night" ? "#c5c7bb" : "#596669"; context.lineWidth = 1.5 / scale;
      context.globalAlpha = .45; context.beginPath(); context.arc(point.x, point.y, 4.5 / scale, 0, Math.PI * 2); context.stroke();
      if (pulse.ageMs < 4000 && !reduced && clock.running) {
        visibleFreshPulse = true;
        const progress = pulse.ageMs / 4000; context.globalAlpha = (1 - progress) * .65;
        context.beginPath(); context.arc(point.x, point.y, (4 + progress * 10) / scale, 0, Math.PI * 2); context.stroke();
      }
    }
    context.globalAlpha = 1;
    if (!reduced && (ease || clock.live && clock.running && (batch.some(entry => entry.pose.moving) || visibleFreshPulse))) frame = requestAnimationFrame(draw);
    else if (clock.live && clock.running) {
      let next = sampled.people.some(pose => pose.moving) ? instant + 250 : Infinity;
      for (const track of model.data.tracks) for (const boundary of [track.startsAt, track.endsAt]) if (boundary > instant) next = Math.min(next, boundary);
      for (const point of model.data.points) for (const boundary of [point.observedAt, point.observedAt + 120_000]) if (boundary > instant) next = Math.min(next, boundary);
      if (Number.isFinite(next)) wake = setTimeout(() => { wake = null; draw(performance.now()); }, Math.max(16, Math.min(2_147_000_000, next - instant)));
    }
  };
  const repaint = () => { cancel(); draw(performance.now()); };
  const visibility = () => { hidden = document.hidden; if (hidden) { cancel(); ease = null; } else { ease = null; repaint(); } };
  const motion = () => { reduced = reducedQuery.matches; ease = null; repaint(); };
  document.addEventListener("visibilitychange", visibility); reducedQuery.addEventListener("change", motion);
  return {
    update(next: ScenePeopleRendererModel) {
      if (disposed) return;
      const previous = model, time = performance.now();
      const sameContext = previous?.data.contextKey === next.data.contextKey && previous.clock.epoch === next.clock.epoch;
      const clockChanged = previous?.clock.instant !== next.clock.instant;
      if (!sameContext) { pool.length = 0; batch.length = 0; }
      if (!sameContext || !next.clock.running || reduced || previous?.sourceSignature !== next.sourceSignature || clockChanged && (previous.clock.instant === null || next.clock.instant === null || next.clock.instant < previous.clock.instant)) ease = null;
      else if (clockChanged && !next.clock.live && previous.clock.running && next.clock.instant !== null && previous.clock.instant !== null) {
        const current = sampleScenePeople(next.data, next.clock.instant, { maxPeople: next.size.width < 680 ? 128 : 256, floorId: next.floorId });
        ease = { from: ease ? easedInstant(ease, time) : previous.clock.instant, to: next.clock.instant, started: time, valid: new Set(current.people.map(pose => pose.key)), pulseKeys: new Set(current.pulses.map(pulse => pulse.key)) };
      }
      model = next; prepare(); repaint();
    },
    dispose() { disposed = true; cancel(); document.removeEventListener("visibilitychange", visibility); reducedQuery.removeEventListener("change", motion); clear(); model = null; ease = null; lastOccluders = null; seen = new Uint32Array(0); batch.length = 0; pool.length = 0; largeOccluders.length = 0; occluderCandidates.length = 0; occluderGrid.clear(); if (atlas) { atlas.canvas.width = 0; atlas.canvas.height = 0; } atlas = null; },
  };
}
