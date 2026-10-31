import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusMotionClaim, CampusMotionProjection } from '../../packages/contracts/src/campus-motion';
import type { CampusSceneDocument } from '../../packages/contracts/src/campus-scenes/types';
import type { ScenePeopleCompiled } from '../../packages/contracts/src/campus-scenes/scenePeopleTracks.types';
import type { ScenePeopleOccluder } from '../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry';
import { compileCampusPeople, sampleCampusPeople, campusPeopleClock, campusPeopleEpoch, type CampusPeopleScope } from '../src/lib/campus-people';
import { campusSkiaPeopleAnimateAt, compileCampusSkiaPeoplePacket, sampleCampusSkiaPeoplePacket } from '../src/features/campus/skia/campusSkiaPeoplePackets';
import { campusPeopleAtlasSvg, PEOPLE_ATLAS, peopleAtlasCell } from '../src/features/campus/skia/campusSkiaPeopleSprites';

const at = Date.parse('2026-10-29T09:00:00Z');
const iso = (seconds: number) => new Date(at + seconds * 1000).toISOString();
const scope: CampusPeopleScope = { schoolId: 'school', campusId: 'campus', actorId: 'actor', scopeKey: 'actor:school:live', sourceScopeKey: 'actor:school:live', publicationKey: 'scene:4', environment: { mode: 'live' } };
const scene: CampusSceneDocument = { schema_version: 1, name: 'Any campus', source: { kind: 'manual', label: 'Reviewed drawing' }, bounds: { width: 120, height: 100, unit: 'metres' }, elements: [
  ...['a', 'b'].map((id, index) => ({ id, kind: 'surface' as const, label: id, space_id: id, floor_id: null, review_state: 'reviewed' as const,
    geometry: { type: 'polygon' as const, points: [{ x: index * 40, y: 0 }, { x: index * 40 + 20, y: 0 }, { x: index * 40 + 20, y: 20 }, { x: index * 40, y: 20 }] } })),
  { id: 'walk', kind: 'path', label: 'Walkway', space_id: null, floor_id: null, width: 3, review_state: 'reviewed',
    geometry: { type: 'polyline', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 10 }] },
    navigation: { walkable: true, accessible: true, status: 'open', start_space_id: 'a', end_space_id: 'b' } },
] };
const places = ['a', 'b'].map(id => ({ id, kind: 'outdoor_area', parent_space_id: null }));
const claim = (id: string, space: string, starts: number, ends: number): CampusMotionClaim => ({ id, space_id: space, starts_at: iso(starts), ends_at: iso(ends), expected_count: 1, spatial_claim: 'expected_context_only', source: { domain: 'activities', record_id: id, revision: 1 } });
const projection = (claims = [claim('previous', 'a', -600, 0), claim('next', 'b', 120, 600)]): CampusMotionProjection => ({ schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: iso(0), environment: { kind: 'live', namespace_id: 'live:school' }, subjects: [{ subject_key: 'opaque', kind: 'self', claims }], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: ['Plans and point events only.'] });
const compile = (motion = projection(), document = scene, context = scope) => compileCampusPeople({ ...context, scene: document, places, motion });
const visible = { enabled: true, focused: true, active: true, reducedMotion: false };
const camera = { x: 0, y: 0, scale: 5 }, viewport = { width: 600, height: 600 };
const packet = (compiled = compile(), extra: Partial<Parameters<typeof compileCampusSkiaPeoplePacket>[1]> = {}) => compileCampusSkiaPeoplePacket(compiled, { floorId: null, mode: '2d', unit: 1, ...extra });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .000001, `${a} should match ${b}`);
const mask = (key: string, depth: number, x = 0, y = -100, width = 120, height = 200): ScenePeopleOccluder => ({ key, depth, bounds: { x, y, width, height }, masks: [{ path: `M ${x} ${y} h ${width} v ${height} h ${-width} Z`, fill: true }] });

test('UI packet agrees with authoritative route sampling while producing sub-250ms walking positions', () => {
  const data = compile()!, compiled = packet(data), route = data.tracks.find(track => track.route)!;
  const now = (route.startsAt + route.endsAt) / 2;
  const seen: number[] = [];
  for (let frame = 0; frame < 15; frame++) {
    const instant = now + frame * 1000 / 60;
    const sample = sampleCampusSkiaPeoplePacket(compiled, instant, camera, viewport).people[0]!;
    const expected = sampleCampusPeople(data, campusPeopleClock(scope.environment, campusPeopleEpoch(scope), instant), { ...visible, floorId: null }).poses[0]!;
    close(sample.x, expected.point.x); close(sample.y, expected.point.y); close(sample.alpha, expected.opacity);
    seen.push(sample.x + sample.y);
  }
  assert.equal(new Set(seen).size, 15, 'every frame moves; no four-Hz position stepping');
  assert.deepEqual(compiled, JSON.parse(JSON.stringify(compiled)), 'the UI packet contains only serializable source numbers/arrays');
});

test('claim boundaries, route-over-idle overlap and backwards seek use source time, not frame accumulation', () => {
  const data = compile()!, compiled = packet(data), route = data.tracks.find(track => track.route)!;
  for (const instant of [route.startsAt - 1, route.startsAt, route.startsAt + 100, route.endsAt - 1, route.endsAt, at + 599999, at + 600000]) {
    const actual = sampleCampusSkiaPeoplePacket(compiled, instant, camera, viewport).people;
    const expected = sampleCampusPeople(data, campusPeopleClock(scope.environment, campusPeopleEpoch(scope), instant), { ...visible, floorId: null }).poses.filter(pose => pose.opacity > 0);
    assert.equal(actual.length, expected.length);
    if (expected[0]) { close(actual[0]!.x, expected[0].point.x); close(actual[0]!.y, expected[0].point.y); }
  }
  const before = sampleCampusSkiaPeoplePacket(compiled, route.startsAt + 1000, camera, viewport);
  sampleCampusSkiaPeoplePacket(compiled, route.endsAt + 99999, camera, viewport);
  assert.deepEqual(sampleCampusSkiaPeoplePacket(compiled, route.startsAt + 1000, camera, viewport), before);
});

test('same-world confirmed Simulation time never acquires wall-clock extrapolation', () => {
  const context: CampusPeopleScope = { ...scope, scopeKey: 'actor:school:sim', sourceScopeKey: 'actor:school:sim', environment: { mode: 'simulation', namespace_id: 'world', run_id: 'run', institution_id: 'school', virtual_clock: { now: iso(100), time_zone: 'UTC' } } };
  const raw = projection(); raw.environment = { kind: 'simulation', namespace_id: 'world' };
  const data = compile(raw, scene, context)!, compiled = packet(data);
  const first = campusPeopleClock(context.environment, campusPeopleEpoch(context), at + 9000000);
  const later = campusPeopleClock(context.environment, campusPeopleEpoch(context), at + 19000000);
  assert.equal(first.live, false); assert.equal(first.running, false); assert.equal(first.instant, later.instant);
  assert.deepEqual(sampleCampusSkiaPeoplePacket(compiled, first.instant, camera, viewport, false), sampleCampusSkiaPeoplePacket(compiled, later.instant, camera, viewport, false));
  assert.ok(sampleCampusSkiaPeoplePacket(compiled, first.instant, camera, viewport, false).people.every(person => person.step === 0));
  assert.equal(compile(raw, scene, { ...context, sourceScopeKey: 'a-different-actor' }), null);
});

test('world/actor/source loss, closed paths, unmapped and conflicting contexts remain empty rather than guessed', () => {
  const closed = structuredClone(scene); closed.elements[2]!.navigation!.status = 'closed';
  const conflict = projection([claim('one', 'a', 0, 200), claim('two', 'b', 10, 300)]);
  const missing = projection([claim('missing', 'unknown', 0, 600)]);
  for (const data of [compile(projection(), closed), compile(conflict), compile(missing), compile(projection(), scene, { ...scope, actorId: '' }), null]) {
    assert.deepEqual(sampleCampusSkiaPeoplePacket(packet(data), at + 100000, camera, viewport).people, []);
  }
});

test('floor-bound idle and route edges never leak between an interior and the outdoor campus', () => {
  const data = compile()!, route = data.tracks.find(track => track.route)!;
  const floorData: ScenePeopleCompiled = { ...data, tracks: [{ ...route, route: { ...route.route!, edges: route.route!.edges.map((edge, index) => ({ ...edge, floorId: index < 2 ? 'upper-floor' : null })) } }] };
  const start = route.startsAt + 1000;
  assert.equal(sampleCampusSkiaPeoplePacket(packet(floorData), start, camera, viewport).people.length, 0);
  assert.equal(sampleCampusSkiaPeoplePacket(packet(floorData, { floorId: 'upper-floor' }), start, camera, viewport).people.length, 1);
  const end = route.endsAt - 1000;
  assert.equal(sampleCampusSkiaPeoplePacket(packet(floorData), end, camera, viewport).people.length, 1);
  assert.equal(sampleCampusSkiaPeoplePacket(packet(floorData, { floorId: 'upper-floor' }), end, camera, viewport).people.length, 0);
});

test('viewport culling precedes exact nearer-silhouette clipping and huge geometry cannot evade the index', () => {
  const data = compile()!, route = data.tracks.find(track => track.route)!, instant = (route.startsAt + route.endsAt) / 2;
  const normal = packet(data, { occluders: [mask('near', 100), mask('far', -100), mask('elsewhere', 100, 1000, 1000)] });
  assert.deepEqual(sampleCampusSkiaPeoplePacket(normal, instant, camera, viewport).people[0]!.clips, [0]);
  assert.equal(sampleCampusSkiaPeoplePacket(normal, instant, { x: -10000, y: -10000, scale: 5 }, viewport).people.length, 0);
  const huge = packet(data, { occluders: [mask('large', 20000, -100000, -100000, 200000, 200000)] });
  assert.equal(Object.keys(huge.cells).length, 0); assert.deepEqual(huge.globalOccluders, [0]);
  assert.deepEqual(sampleCampusSkiaPeoplePacket(huge, instant, camera, viewport).people[0]!.clips, [0]);
});

test('phone/wide total and exact-clip budgets are bounded without drawing excess figures through walls', () => {
  const data = compile(projection([claim('current', 'a', 0, 600)]))!, idle = data.tracks[0]!;
  const many: ScenePeopleCompiled = { ...data, tracks: Array.from({ length: 400 }, (_, index) => ({ ...idle, key: `person-${index}`, tone: index === 399 ? 'self' : 'expected' })) };
  const phone = packet(many), wide = packet(many, { wide: true });
  assert.equal(sampleCampusSkiaPeoplePacket(phone, at + 100000, camera, viewport).people.length, 128);
  assert.equal(sampleCampusSkiaPeoplePacket(wide, at + 100000, camera, viewport).people.length, 256);
  assert.ok(sampleCampusSkiaPeoplePacket(phone, at + 100000, camera, viewport).people.some(person => person.wardrobe === 0));
  const occluders = [mask('wall', 100)];
  assert.equal(sampleCampusSkiaPeoplePacket(packet(many, { occluders }), at + 100000, camera, viewport).people.length, 32);
  assert.equal(sampleCampusSkiaPeoplePacket(packet(many, { occluders, wide: true }), at + 100000, camera, viewport).people.length, 64);
  assert.deepEqual(sampleCampusSkiaPeoplePacket(packet(many, { maxPeople: 0 }), at + 100000, camera, viewport).people, []);
});

test('point observations are distinct bounded rings; never people, future scans or continuous presence', () => {
  const data = compile(projection([]))!;
  const events: ScenePeopleCompiled = { ...data, points: [{ key: 'observed', point: { x: 10, y: 10 }, floorId: null, observedAt: at, dimension: 'observed' },
    { key: 'accepted', point: { x: 15, y: 10 }, floorId: null, observedAt: at, dimension: 'accepted' }] };
  const compiled = packet(events);
  assert.equal(sampleCampusSkiaPeoplePacket(compiled, at - 1, camera, viewport).pulses.length, 0);
  const result = sampleCampusSkiaPeoplePacket(compiled, at + 1000, camera, viewport);
  assert.equal(result.people.length, 0); assert.deepEqual(result.pulses.map(pulse => pulse.accepted), [false, true]);
  assert.equal(sampleCampusSkiaPeoplePacket(compiled, at + 120000, camera, viewport).pulses.length, 0);
  assert.equal(sampleCampusSkiaPeoplePacket(packet(events, { floorId: 'a-floor' }), at + 1000, camera, viewport).pulses.length, 0);
  assert.equal(campusSkiaPeopleAnimateAt(compiled, at + 1000), true);
  assert.equal(campusSkiaPeopleAnimateAt(compiled, at + 4000), false);
});

test('idle-only and empty scenes do not request display-rate GPU redraws', () => {
  const idle = packet(compile(projection([claim('current', 'a', 0, 600)])));
  assert.equal(campusSkiaPeopleAnimateAt(idle, at + 100000), false);
  assert.equal(campusSkiaPeopleAnimateAt(packet(null), at + 100000), false);
  const data = compile()!, route = data.tracks.find(track => track.route)!;
  assert.equal(campusSkiaPeopleAnimateAt(packet(data), (route.startsAt + route.endsAt) / 2), true);
  assert.equal(campusSkiaPeopleAnimateAt(packet(data), route.startsAt - 1), false);
});

test('unavailable time or invalid camera cannot leak non-finite sprites to the native draw list', () => {
  const compiled = packet();
  for (const instant of [null, NaN, Infinity]) assert.deepEqual(sampleCampusSkiaPeoplePacket(compiled, instant, camera, viewport), { people: [], pulses: [] });
  for (const invalid of [{ ...camera, x: NaN }, { ...camera, y: Infinity }, { ...camera, scale: 0 }])
    assert.deepEqual(sampleCampusSkiaPeoplePacket(compiled, at + 100000, invalid, viewport), { people: [], pulses: [] });
});

test('the compact reusable atlas covers eight directions/eight strides, theme color and distinct evidence symbols', () => {
  const original = campusPeopleAtlasSvg(false, '#c18a00'), repeat = campusPeopleAtlasSvg(false, '#c18a00');
  assert.equal(original, repeat); assert.ok(original.includes('#c18a00'));
  assert.notEqual(original, campusPeopleAtlasSvg(true, '#c18a00'));
  assert.equal((original.match(/<g transform="translate\(/g) ?? []).length, 868);
  const coordinates = new Set<string>();
  for (let wardrobe = 0; wardrobe < 6; wardrobe++) for (let direction = 0; direction < 8; direction++) for (let step = 0; step < 9; step++) {
    const cell = peopleAtlasCell(wardrobe, direction, step);
    assert.ok(cell.x >= 0 && cell.x + PEOPLE_ATLAS.cellWidth <= PEOPLE_ATLAS.width);
    assert.ok(cell.y >= 0 && cell.y + PEOPLE_ATLAS.cellHeight <= PEOPLE_ATLAS.height);
    coordinates.add(`${cell.x}:${cell.y}`);
  }
  assert.equal(coordinates.size, 432); assert.notDeepEqual(peopleAtlasCell(6, 0, 0), peopleAtlasCell(6, 1, 0));
  assert.ok(PEOPLE_ATLAS.width * PEOPLE_ATLAS.height * 4 < 3 * 1024 * 1024, 'one atlas remains below three MiB of uncompressed pixels');
});
