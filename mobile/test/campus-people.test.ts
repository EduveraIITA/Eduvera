import assert from 'node:assert/strict';
import test from 'node:test';
import { scenePeopleOccluders } from '../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry';

import { campusPeopleClock, campusPeopleEpoch, campusPeopleProjection, compileCampusPeople, retainCampusPeople, sampleCampusPeople, type CampusPeopleScope } from '../src/lib/campus-people';
import type { CampusMotionClaim, CampusMotionProjection } from '../../packages/contracts/src/campus-motion';
import type { CampusSceneDocument } from '../../packages/contracts/src/campus-scenes/types';

const at = Date.parse('2026-10-27T10:00:00Z'), iso = (seconds: number) => new Date(at + seconds * 1000).toISOString();
const scene: CampusSceneDocument = { schema_version: 1, name: 'Campus', source: { kind: 'manual', label: 'Reviewed drawing' }, bounds: { width: 120, height: 100, unit: 'metres' }, elements: [
  ...['a', 'b', 'c'].map((id, index) => ({ id, kind: 'surface' as const, label: id, space_id: id, floor_id: null, review_state: 'reviewed' as const, geometry: { type: 'polygon' as const, points: [{ x: index * 40, y: 0 }, { x: index * 40 + 20, y: 0 }, { x: index * 40 + 20, y: 20 }, { x: index * 40, y: 20 }] } })),
  ...[0, 1].map(index => ({ id: `path-${index}`, kind: 'path' as const, label: 'Walk', space_id: null, floor_id: null, width: 3, review_state: 'reviewed' as const,
    geometry: { type: 'polyline' as const, points: [{ x: 10 + index * 40, y: 10 }, { x: 50 + index * 40, y: 10 }] }, navigation: { walkable: true as const, accessible: true, status: 'open' as const, start_space_id: ['a', 'b'][index], end_space_id: ['b', 'c'][index] } })),
] };
const places = ['a', 'b', 'c'].map(id => ({ id, name: id, code: id, kind: 'outdoor_area', parent_space_id: null }));
const claim = (id: string, space_id: string | null, starts: number, ends: number): CampusMotionClaim => ({ id, space_id, starts_at: iso(starts), ends_at: iso(ends), expected_count: 1, spatial_claim: 'expected_context_only', source: { domain: 'activities', record_id: id, revision: 1 } });
const motion = (claims = [claim('previous', 'a', -600, 0), claim('next', 'b', 120, 600)]): CampusMotionProjection => ({ schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: iso(0), environment: { kind: 'live', namespace_id: 'live:school' }, subjects: [{ subject_key: 'opaque', kind: 'self', claims }], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: ['Plans and point events only.'] });
const scope: CampusPeopleScope = { schoolId: 'school', campusId: 'campus', actorId: 'actor', scopeKey: 'actor-school-live', sourceScopeKey: 'actor-school-live', publicationKey: 'scene:2', environment: { mode: 'live' } };
const simulation = (seconds = 100): CampusPeopleScope => ({ ...scope, scopeKey: 'actor-school-simulation', sourceScopeKey: 'actor-school-simulation', environment: { mode: 'simulation', namespace_id: 'world', run_id: 'run', institution_id: 'school', virtual_clock: { now: iso(seconds), time_zone: 'UTC' } } });
const visible = { enabled: true, focused: true, active: true, reducedMotion: false };
const compile = (data: CampusMotionProjection, context = scope, document = scene) => compileCampusPeople({ ...context, scene: document, places, motion: data });


test('motion requires current actor-read identity, school, campus and exact selected world', () => {
  const raw = motion(); assert.equal(campusPeopleProjection(raw, scope), raw);
  for (const context of [{ ...scope, sourceScopeKey: 'other-actor' }, { ...scope, actorId: '' }, { ...scope, schoolId: 'other' }, { ...scope, campusId: 'other' }, { ...scope, publicationKey: '' }]) assert.equal(campusPeopleProjection(raw, context), null);
  const sim = simulation(); assert.equal(campusPeopleProjection(raw, sim), null);
  raw.environment = { kind: 'simulation', namespace_id: 'world' }; assert.equal(campusPeopleProjection(raw, sim), raw);
  assert.equal(campusPeopleProjection(raw, { ...sim, environment: { ...sim.environment, namespace_id: 'another-world' } }), null);
  assert.equal(campusPeopleProjection(raw, { ...sim, environment: { ...sim.environment, institution_id: 'another-school' } }), null);
  assert.equal(campusPeopleProjection(raw, { ...sim, environment: { ...sim.environment, unavailable: true } }), null);
});

test('malformed, overlarge and nonillustrative motion evidence is rejected by the owning shared validator', () => {
  const changes: Array<(value: any) => void> = [value => value.schema_version = 2, value => value.subjects[0].claims[0].source = null,
    value => value.subjects[0].claims[0].spatial_claim = 'bounded_space_presence', value => value.subjects[0].claims[0].expected_count = 20,
    value => value.subjects[0].claims[0].ends_at = value.subjects[0].claims[0].starts_at, value => value.subjects.push(value.subjects[0]),
    value => value.points = Array(65).fill({}), value => value.subjects = Array(129).fill(value.subjects[0])];
  for (const change of changes) { const data = motion(); change(data); assert.equal(compile(data), null); }
});

test('same-source forward sampling uses shared tracks and a changed actor/publication epoch resets retention', () => {
  const candidate = compile(motion())!, clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 100000);
  const retained = retainCampusPeople(null, candidate, scene, clock), nextClock = { ...clock, instant: at + 101000 };
  const next = retainCampusPeople(retained, candidate, scene, nextClock); assert.equal(next.value, candidate);
  const first = sampleCampusPeople(candidate, clock, visible).poses[0], second = sampleCampusPeople(candidate, nextClock, visible).poses[0];
  assert.ok(first.moving); assert.equal(first.key, second.key); assert.ok(second.point.x > first.point.x);
  const changedEpoch = campusPeopleEpoch({ ...scope, actorId: 'next-actor', scopeKey: 'new-scope', sourceScopeKey: 'new-scope' });
  assert.notEqual(changedEpoch, clock.epoch);
  assert.equal(retainCampusPeople(retained, candidate, scene, { ...clock, epoch: changedEpoch! }).value, candidate);
  assert.notEqual(campusPeopleEpoch({ ...scope, publicationKey: 'scene:3' }), clock.epoch);
});

test('authorized source revision retargets only on the existing edge and backward Simulation seeks reset it', () => {
  const context = simulation(), raw = motion(); raw.environment = { kind: 'simulation', namespace_id: 'world' };
  const first = compile(raw, context)!, clock = campusPeopleClock(context.environment, campusPeopleEpoch(context), at + 999999);
  const prior = retainCampusPeople(null, first, scene, clock), revised = structuredClone(raw); revised.as_of = iso(100);
  revised.subjects[0].claims[1] = { ...claim('next', 'c', 120, 600), source: { domain: 'activities', record_id: 'next', revision: 2 } };
  const next = compile(revised, context)!, retained = retainCampusPeople(prior, next, scene, clock);
  assert.ok(retained.value!.tracks.some(track => track.retargeted));
  assert.deepEqual(sampleCampusPeople(retained.value, clock, visible).poses[0].point, sampleCampusPeople(first, clock, visible).poses[0].point);
  const backwards = campusPeopleClock(simulation(90).environment, clock.epoch, at + 2000000);
  const reset = retainCampusPeople(retained, next, scene, backwards); assert.equal(reset.value, next); assert.ok(!reset.value!.tracks.some(track => track.retargeted));
});

test('missing source authority clears compiled figures immediately and cannot fall back to a retained scene', () => {
  const candidate = compile(motion())!, clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 100000);
  const retained = retainCampusPeople(null, candidate, scene, clock);
  assert.equal(compileCampusPeople({ ...scope, scene, places, motion: motion(), sourceState: 'unavailable' }), null);
  assert.equal(compileCampusPeople({ ...scope, scene, places, motion: motion(), sourceState: 'loading' }), null);
  assert.equal(compileCampusPeople({ ...scope, scene: null, places, motion: motion() }), null);
  assert.equal(retainCampusPeople(retained, null, scene, clock).value, null);
  assert.deepEqual(sampleCampusPeople(null, clock, visible), { poses: [], pulses: [] });
});

test('scan events remain timestamped pulses, never people or continuous presence', () => {
  const raw = motion([]); raw.subjects = []; raw.points = [{ id: 'scan', space_id: 'a', observed_at: iso(0), dimension: 'accepted', spatial_claim: 'point_observation_only', source: { domain: 'gate', record_id: 'scan', revision: null } }];
  const compiled = compile(raw)!, clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 1000);
  assert.deepEqual(sampleCampusPeople(compiled, clock, visible).poses, []);
  assert.deepEqual(sampleCampusPeople(compiled, clock, visible).pulses.map(pulse => [pulse.key, pulse.dimension, pulse.ageMs]), [['scan', 'accepted', 1000]]);
  assert.deepEqual(sampleCampusPeople(compiled, { ...clock, instant: at + 120000 }, visible).pulses, []);
  assert.deepEqual(sampleCampusPeople(compiled, clock, { ...visible, floorId: 'another-floor' }).pulses, []);
});

test('closed routing, unmapped places and conflicting plans never acquire guessed journeys', () => {
  const closed = structuredClone(scene); closed.elements[3].navigation!.status = 'closed';
  const unavailable = compile(motion(), scope, closed)!; assert.equal(unavailable.unavailableRoutes, 1);
  const clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 100000);
  assert.deepEqual(sampleCampusPeople(unavailable, clock, visible).poses, []);
  const noRoutes = compileCampusPeople({ ...scope, scene, places, motion: motion(), routingAvailable: false })!;
  assert.equal(noRoutes.unavailableRoutes, 1); assert.ok(noRoutes.tracks.every(track => !track.route));
  const unmapped = compile(motion([claim('unknown', 'unknown-place', 0, 600)]))!; assert.equal(unmapped.unmapped, 1); assert.deepEqual(unmapped.tracks, []);
  const conflict = compile(motion([claim('one', 'b', 0, 200), claim('two', 'c', 50, 300)]))!; assert.equal(conflict.conflicting, 1); assert.deepEqual(conflict.tracks, []);
});

test('paused Simulation sampling ignores wall time and never starts a Live animation timer', () => {
  const context = simulation(), raw = motion(); raw.environment = { kind: 'simulation', namespace_id: 'world' };
  const compiled = compile(raw, context)!, epoch = campusPeopleEpoch(context);
  const firstClock = campusPeopleClock(context.environment, epoch, at + 10000000), laterWall = campusPeopleClock(context.environment, epoch, at + 90000000);
  assert.deepEqual(firstClock, laterWall); assert.equal(firstClock.running, false); assert.equal(firstClock.live, false);
  assert.deepEqual(sampleCampusPeople(compiled, firstClock, visible), sampleCampusPeople(compiled, laterWall, visible));
  assert.equal(firstClock.running, false);
  const forward = campusPeopleClock(simulation(101).environment, epoch, at + 90000000); assert.equal(forward.instant, at + 101000);
});

test('focus, AppState, enable and reduced-motion gates stop timers and retained pixels', () => {
  const compiled = compile(motion())!, clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 100000);
  assert.equal(clock.running, true);
  for (const options of [{ ...visible, focused: false }, { ...visible, active: false }, { ...visible, enabled: false }]) {
    assert.deepEqual(sampleCampusPeople(compiled, clock, options), { poses: [], pulses: [] });
  }
  const reduced = { ...visible, reducedMotion: true };
  const pose = sampleCampusPeople(compiled, clock, reduced).poses[0]; assert.ok(pose); assert.equal(pose.moving, false); assert.equal(pose.phase, 0);
  assert.equal(campusPeopleClock(scope.environment, clock.epoch, clock.instant, true, true).running, false);
});

test('representative native sampling is capped and exact-floor bound rather than an attendance count', () => {
  const document = structuredClone(scene); document.elements[1] = { ...document.elements[1], kind: 'room', floor_id: 'floor-one' };
  const raw = motion([{ ...claim('class', 'b', 0, 600), expected_count: 400 }]); raw.subjects[0].kind = 'group';
  const compiled = compile(raw, scope, document)!, clock = campusPeopleClock(scope.environment, campusPeopleEpoch(scope), at + 100000);
  assert.equal(sampleCampusPeople(compiled, clock, { ...visible, floorId: 'floor-one' }).poses.length, 8);
  assert.equal(sampleCampusPeople(compiled, clock, { ...visible, floorId: 'floor-one', maxPeople: 3 }).poses.length, 3);
  assert.deepEqual(sampleCampusPeople(compiled, clock, { ...visible, floorId: null }).poses, []);
  assert.equal(sampleCampusPeople(compiled, clock, { ...visible, floorId: 'floor-one', maxPeople: NaN }).poses.length, 8);
});

test('neutral occlusion geometry works without browser Path2D adapters and preserves source drawing', () => {
  const document = structuredClone(scene); document.elements[1] = { ...document.elements[1], kind: 'building', height: 8 };
  const original = structuredClone(document), masks = scenePeopleOccluders(document, null, '2.5d', 1);
  assert.ok(masks.length); assert.ok(masks.every(mask => Number.isFinite(mask.depth) && mask.masks.every(fragment => typeof fragment.path === 'string')));
  assert.deepEqual(scenePeopleOccluders(document, null, '2d', 1), []); assert.deepEqual(document, original);
});
