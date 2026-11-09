import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusScenePublished, SceneResourceOptions } from '../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import type { CampusMapActivity, CampusMapAsset, CampusOperationalProjection } from '../../packages/contracts/src/campus-operation';
import type { CampusPersonalDestination, CampusPersonalResponse } from '../../packages/contracts/src/campus-personal';
import type { RawCampusViewResponse } from '../../packages/contracts/src/campus-view-normalize';
import { campusAdministratorMarkers, campusMemberMarkers, campusPooledRoomResources } from '../src/lib/campus-member-presentation';
import { campusPublishedSnapshot } from '../src/lib/campus-published-operations';
import { nativeCampusLayersMatch, nativeCampusMemberLayers } from '../src/lib/native-campus';

const pooled = { id: 'pool', name: 'Shared chairs', asset_tag: null, space_id: 'room-a', state: 'available' as const, tracking_mode: 'pooled' as const, quantity: 24, unit_label: 'chairs' };
const resources = (): SceneResourceOptions => ({ page: 1, page_size: 20, total: 1, items: [{ ...pooled }], selected: null });
const geometry = { type: 'polygon' as const, points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }] };
const building: CampusSceneElement = { id: 'building-drawing', kind: 'building', label: 'Main building', space_id: 'building', floor_id: null, review_state: 'reviewed', geometry };
const roomA: CampusSceneElement = { ...building, id: 'room-a-drawing', kind: 'room', label: 'Same room label', space_id: 'room-a', floor_id: 'floor-a', parent_element_id: building.id };
const roomB: CampusSceneElement = { ...roomA, id: 'room-b-drawing', space_id: 'room-b', floor_id: 'floor-b' };
const draft: CampusSceneElement = { ...roomA, id: 'private-draft-drawing', space_id: 'draft-place', review_state: 'needs_review' };
const fixture: CampusSceneElement = { ...roomA, id: 'lamp', kind: 'fixture', label: 'Room lamp', asset_key: 'lamp', space_id: null, holding_id: 'lamp-holding', geometry: { type: 'point', points: [{ x: 20, y: 20 }] } };
const scene: CampusSceneDocument = { schema_version: 1, name: 'Campus', bounds: { width: 120, height: 120, unit: 'metres' }, source: { kind: 'manual', label: 'Reviewed campus' }, elements: [building, roomA, roomB, draft, fixture] };
const place = (id: string, parent_space_id: string | null, kind = 'classroom') => ({ id, name: id, code: id, parent_space_id, kind });
const places = [place('building', null, 'building'), place('floor-a', 'building', 'floor'), place('floor-b', 'building', 'floor'), place('room-a', 'floor-a'), place('room-b', 'floor-b'), place('draft-place', 'floor-a'), place('unmapped-room', 'floor-a')];
const publication: CampusScenePublished = { campus: { id: 'campus', name: 'Campus', code: 'MAIN' }, scene: { id: 'publication', version: 2, published_at: '2026-10-29T09:00:00Z', document: scene }, places, can_edit: false };
const activity = (id: string, space_id: string | null, changes: Partial<CampusMapActivity> = {}): CampusMapActivity => ({ id, layer: 'classes', title: 'Class of 36 learners', detail: 'Scheduled plan, not physical presence', space_id, holding_id: null, starts_at: '2026-10-29T09:00:00Z', ends_at: '2026-10-29T10:00:00Z', state: 'in_progress', target_path: `/areas/timetable?period_id=${id}`, action_label: 'Open teaching session', dimension: 'expected', source: { domain: 'schedule', record_id: id, revision: 1, label: 'Published schedule' }, ...changes });
const asset: CampusMapAsset = { element_id: fixture.id, holding_id: fixture.holding_id!, name: 'Room lamp', asset_tag: 'LAMP-1', space_id: 'room-a', native_state: 'available', reportable: true, signal: { state: 'reported_fault', impact: 'not_working', open_reports: 1, updated_at: '2026-10-29T09:00:00Z' }, repairs: [] };
const projection = (changes: Partial<CampusOperationalProjection> = {}): CampusOperationalProjection => ({ schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: '2026-10-29T09:00:00Z', environment: { kind: 'live', namespace_id: 'live:school' }, publication: { id: 'publication', version: 2 }, assets: [], activities: [], limitations: [], ...changes });

test('lean campus layers compose independently validated personal schedules without hiding assets on personal failure', () => {
  const from = activity('private-class', 'room-a');
  const destination: CampusPersonalDestination = { id: from.id, kind: 'teaching_session', title: from.title, detail: from.detail,
    space_id: from.space_id, place_label: 'Room A', starts_at: from.starts_at, ends_at: from.ends_at, state: 'in_progress',
    target_path: from.target_path, action_label: from.action_label, dimension: 'expected', spatial_claim: 'expected_context_only', source: from.source };
  const ownEvent = { ...destination, id: 'assigned-event', kind: 'activity' as const, space_id: null };
  const excluded = { ...destination, id: 'duplicate-repair', kind: 'repair' as const };
  const event = activity('campus-event', 'room-b', { layer: 'events' });
  const lean = projection({ personal_activities: 'separate', bounds: { activities_per_layer: 20 }, assets: [asset], activities: [event] });
  const asOf = lean.as_of;
  const personal: CampusPersonalResponse = { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: asOf,
    local_date: '2026-10-29', timezone: 'UTC', environment: lean.environment, freshness: { status: 'current', as_of: asOf },
    now: [destination], next: [], places: [], destinations: [destination, ownEvent, excluded], limitations: [] };
  const combine = (layers = lean, own: CampusPersonalResponse | undefined = personal) => nativeCampusMemberLayers(layers, own, 'school', 'campus', { mode: 'live' }, publication);
  const complete = combine();
  assert.deepEqual(complete.data?.activities.map(row => [row.id, row.layer]), [
    ['private-class', 'classes'], ['assigned-event', 'events'], ['campus-event', 'events'],
  ]);
  assert.deepEqual(complete.data?.activities[0], from);
  assert.equal(complete.data?.assets, lean.assets);
  assert.equal(complete.personalUnavailable, false);
  assert.ok(complete.data?.limitations.some(message => message.includes('no reviewed map location')));
  assert.deepEqual(nativeCampusMemberLayers(lean, undefined, 'school', 'campus', { mode: 'live' }, publication), { data: lean, personalUnavailable: true });
  for (const wrong of [{ ...personal, campus_id: 'other' }, { ...personal, school_id: 'other' },
    { ...personal, environment: { kind: 'simulation' as const, namespace_id: 'other' } }]) {
    assert.deepEqual(combine(lean, wrong), { data: lean, personalUnavailable: true });
  }
  assert.equal(combine({ ...lean, publication: { id: 'publication', version: 1 } }).data, undefined);
  const original = projection({ activities: [from, event] });
  assert.equal(combine(original).data, original);
  assert.deepEqual(lean.activities, [event]);
});
const privateSnapshot = () => {
  const raw: RawCampusViewResponse = { schema_version: 1, school: { id: 'school', name: 'School', timezone: 'Asia/Kolkata' }, campuses: [{ id: 'campus', name: 'Campus', code: 'MAIN', is_primary: true }], selected_campus_id: 'campus', generated_at: '2026-10-29T09:00:00Z', as_of: '2026-10-29T09:00:00Z', plan: null, operations: null,
    motion: { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: '2026-10-29T09:00:00Z', environment: { kind: 'live', namespace_id: 'live:school' }, subjects: [], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: [] },
    spaces: places.map(place => ({ ...place, campus_id: 'campus', capacity: null, floor_id: place.parent_space_id === 'floor-a' ? 'floor-a' : place.parent_space_id === 'floor-b' ? 'floor-b' : null, floor_label: null, state_dimension: 'unknown', expected_now: [], assertions: { expected: [], observed: [], accepted: [] } })), activity: [], day_activity: [], signals: [] };
  const room = raw.spaces.find(space => space.id === 'room-a')!;
  room.state_dimension = 'expected';
  room.assertions.expected.push({ assertion_id: 'lesson', dimension: 'expected', context: { title: 'Published lesson', expected_count: 12 }, valid_from: '2026-10-29T08:00:00Z', valid_until: '2026-10-29T10:00:00Z', observed_at: null, source: { domain: 'timetable', label: 'Published schedule', record_id: 'period' }, freshness: { status: 'current_at_as_of', expires_at: null }, spatial_claim: 'expected_context_only' });
  room.assertions.observed.push({ assertion_id: 'scan', dimension: 'observed', context: { title: 'Recorded point observation' }, valid_from: null, valid_until: null, observed_at: '2026-10-29T08:45:00Z', source: { domain: 'gate', label: 'Gate observation', record_id: 'scan' }, freshness: { status: 'point_in_time', expires_at: null }, spatial_claim: 'point_observation_only' });
  const result = campusPublishedSnapshot(raw, { schoolId: 'school', campusId: 'campus', environment: { mode: 'live' } });
  assert.ok(result, 'the fixture must pass the actual private snapshot source gate');
  return result;
};

test('pooled room quantities retain verified units and do not become individual fixture counts', () => {
  const value = resources(), before = structuredClone(value), result = campusPooledRoomResources(value, 'room-a', 1);
  assert.equal(result, value);
  assert.equal(result?.items[0].quantity, 24);
  assert.equal(result?.items[0].unit_label, 'chairs');
  assert.equal(result?.items[0].tracking_mode, 'pooled');
  assert.deepEqual(value, before);
  const unavailable = { ...value, items: [{ ...pooled, state: 'unavailable' as const }] };
  assert.equal(campusPooledRoomResources(unavailable, 'room-a', 1), unavailable);
  assert.deepEqual(campusPooledRoomResources({ page: 2, page_size: 20, total: 0, items: [], selected: null }, 'room-a', 2)?.items, []);
});

test('pooled catalogue refuses wrong room, request page, tracking mode and duplicate canonical IDs', () => {
  assert.equal(campusPooledRoomResources(resources(), 'room-b', 1), null);
  assert.equal(campusPooledRoomResources(resources(), 'room-a', 2), null);
  for (const tracking_mode of ['individual', undefined, null, 'unknown']) assert.equal(campusPooledRoomResources({ ...resources(), items: [{ ...pooled, tracking_mode }] }, 'room-a', 1), null);
  assert.equal(campusPooledRoomResources({ ...resources(), total: 2, items: [pooled, { ...pooled, name: 'Same ID, other label' }] }, 'room-a', 1), null);
  const rows = Array.from({ length: 21 }, (_, index) => ({ ...pooled, id: `pool-${index}` }));
  assert.equal(campusPooledRoomResources({ ...resources(), total: 30, items: rows }, 'room-a', 1), null);
});

test('pooled quantities require positive safe integer units and readable unit labels', () => {
  for (const quantity of [undefined, null, 0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '24']) {
    assert.equal(campusPooledRoomResources({ ...resources(), items: [{ ...pooled, quantity }] }, 'room-a', 1), null, String(quantity));
  }
  for (const unit_label of [undefined, null, '', '   ', 24]) assert.equal(campusPooledRoomResources({ ...resources(), items: [{ ...pooled, unit_label }] }, 'room-a', 1), null);
});

test('pooled catalogue rejects malformed rows and pagination metadata without coercion', () => {
  for (const value of [undefined, null, [], 'catalogue', {}, { ...resources(), items: null }, { ...resources(), items: [null] }, { ...resources(), items: [{ ...pooled, id: '' }] }, { ...resources(), items: [{ ...pooled, id: 1 }] }, { ...resources(), items: [{ ...pooled, name: ' ' }] }, { ...resources(), items: [{ ...pooled, state: 'retired' }] }, { ...resources(), page_size: 10 }, { ...resources(), page: '1' }, { ...resources(), total: 0 }, { ...resources(), total: 1.5 }, { ...resources(), total: -1 }]) {
    assert.equal(campusPooledRoomResources(value, 'room-a', 1), null);
  }
  for (const page of [0, -1, .5, NaN, Infinity]) assert.equal(campusPooledRoomResources(resources(), 'room-a', page), null);
  assert.equal(campusPooledRoomResources(resources(), '', 1), null);
});

test('member records aggregate only through actual canonical building ancestry outside', () => {
  const data = projection({ activities: [activity('first', 'room-a'), activity('second', 'room-b')] }), before = structuredClone(data);
  const result = campusMemberMarkers(scene, places, 'campus', 'classes', data, null);
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].elementId, building.id);
  assert.equal(result.markers[0].dimension, 'expected');
  assert.equal(result.markers[0].count, 2);
  assert.equal(result.markers[0].expectedCount, undefined);
  assert.match(result.markers[0].summary, /2 expected records/);
  assert.doesNotMatch(result.markers[0].summary, /36|occupants|occupancy/);
  assert.equal(result.groups[0].aggregated, true);
  assert.deepEqual(result.groups[0].spaceIds, ['room-a', 'room-b']);
  assert.deepEqual(data, before);
});

test('floor markers require both reviewed floor geometry and matching canonical floor ancestry', () => {
  const data = projection({ activities: [activity('a', 'room-a'), activity('b', 'room-b')] });
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', data, 'floor-a').markers.map(marker => marker.elementId), [roomA.id]);
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', data, 'floor-b').markers.map(marker => marker.elementId), [roomB.id]);
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', data, 'unknown-floor').markers, []);
  const mismatched = { ...scene, elements: scene.elements.map(element => element.id === roomA.id ? { ...element, floor_id: 'floor-b' } : element) };
  assert.deepEqual(campusMemberMarkers(mismatched, places, 'campus', 'classes', projection({ activities: [activity('a', 'room-a')] }), 'floor-b').markers, []);
});

test('unmapped, missing and cyclic canonical places do not invent room geometry or proximity links', () => {
  const source = projection({ activities: [activity('unmapped', 'unmapped-room'), activity('unknown', 'private-place-not-in-catalogue'), activity('unlocated', null)] });
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', source, 'floor-a'), { markers: [], groups: [] });
  const outside = campusMemberMarkers(scene, places, 'campus', 'classes', source, null);
  assert.equal(outside.markers.length, 1);
  assert.equal(outside.markers[0].elementId, building.id);
  assert.equal(outside.markers[0].count, 1);
  assert.deepEqual(outside.groups[0].records.map(record => record.id), ['campus-layer-record:unmapped']);
  const cyclic = [...places, place('cycle-a', 'cycle-b'), place('cycle-b', 'cycle-a')];
  assert.deepEqual(campusMemberMarkers(scene, cyclic, 'campus', 'classes', projection({ activities: [activity('cycle', 'cycle-a')] }), null), { markers: [], groups: [] });
  assert.deepEqual(campusMemberMarkers({ ...scene, elements: [] }, places, 'campus', 'classes', projection({ activities: [activity('known-room-without-drawing', 'room-a')] }), null), { markers: [], groups: [] });
});

test('draft geometry stays private while a known unmapped child may aggregate to its reviewed building', () => {
  const source = projection({ activities: [activity('draft-only', 'draft-place')] });
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', source, 'floor-a'), { markers: [], groups: [] });
  const outside = campusMemberMarkers(scene, places, 'campus', 'classes', source, null);
  assert.equal(outside.markers[0]?.elementId, building.id);
  assert.ok(outside.markers.every(marker => marker.elementId !== draft.id));
  assert.ok(outside.groups.every(group => group.elementId !== draft.id));
});

test('counts use distinct source records and keep expected plans separate from accepted work', () => {
  const data = projection({ activities: [activity('same-id', 'room-a'), activity('same-id', 'room-a'), activity('other-id', 'room-a'), activity('accepted-work', 'room-a', { dimension: 'accepted', state: 'assigned' }), activity('event', 'room-a', { layer: 'events' })] });
  const result = campusMemberMarkers(scene, places, 'campus', 'classes', data, 'floor-a');
  assert.deepEqual(result.markers.map(marker => [marker.dimension, marker.count]).sort(), [['accepted', 1], ['expected', 2]]);
  assert.ok(result.markers.every(marker => marker.expectedCount === undefined && marker.plannedCapacityPressure === undefined));
  assert.equal(campusMemberMarkers(scene, places, 'campus', 'events', data, 'floor-a').markers[0]?.count, 1);
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'none', data, 'floor-a'), { markers: [], groups: [] });
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'classes', undefined, 'floor-a'), { markers: [], groups: [] });
});

test('the current-source gate excludes other schools, campuses, publications and worlds before markers', () => {
  const current = projection({ activities: [activity('a', 'room-a')] });
  const render = (data: CampusOperationalProjection, environment: { mode: 'live' | 'simulation'; namespace_id?: string; unavailable?: boolean } = { mode: 'live' }) => campusMemberMarkers(scene, places, 'campus', 'classes', nativeCampusLayersMatch(data, 'school', 'campus', environment, publication) ? data : undefined, 'floor-a');
  assert.equal(render(current).markers.length, 1);
  for (const source of [projection({ ...current, school_id: 'foreign' }), projection({ ...current, campus_id: 'foreign' }), projection({ ...current, publication: { id: 'other-publication', version: 2 } }), projection({ ...current, publication: { id: 'publication', version: 1 } }), projection({ ...current, environment: { kind: 'simulation', namespace_id: 'world' } })]) assert.deepEqual(render(source), { markers: [], groups: [] });
  const simulated = projection({ ...current, environment: { kind: 'simulation', namespace_id: 'world' } });
  assert.equal(render(simulated, { mode: 'simulation', namespace_id: 'world' }).markers.length, 1);
  assert.deepEqual(render(simulated, { mode: 'simulation', namespace_id: 'other-world' }), { markers: [], groups: [] });
  assert.deepEqual(render(simulated, { mode: 'simulation', namespace_id: 'world', unavailable: true }), { markers: [], groups: [] });
  const unknownProtocol = { ...current, activities: [{ ...activity('pending-private-protocol', 'room-a'), dimension: 'unknown' }] } as unknown as CampusOperationalProjection;
  const privateLayer = { ...current, activities: [{ ...activity('private-domain-record', 'room-a'), layer: 'private_cases' }] } as unknown as CampusOperationalProjection;
  assert.deepEqual(render(unknownProtocol), { markers: [], groups: [] });
  assert.deepEqual(render(privateLayer), { markers: [], groups: [] });
});

test('fault markers require an exact reviewed fixture holding and the maintenance layer/current floor', () => {
  const data = projection({ assets: [asset] }), result = campusMemberMarkers(scene, places, 'campus', 'maintenance', data, 'floor-a');
  assert.equal(result.markers.length, 1);
  assert.deepEqual(result.groups, []);
  assert.equal(result.markers[0].id, `campus-layer:asset:${fixture.id}`);
  assert.equal(result.markers[0].elementId, fixture.id);
  assert.equal(result.markers[0].count, 1);
  assert.equal(result.markers[0].dimension, 'accepted');
  assert.equal(result.markers[0].tone, 'fault');
  assert.match(result.markers[0].summary, /not a physical measurement/);
  for (const layer of ['classes', 'events', 'none'] as const) assert.deepEqual(campusMemberMarkers(scene, places, 'campus', layer, data, 'floor-a').markers, []);
  for (const floor of ['floor-b', null]) assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'maintenance', data, floor).markers, []);
  assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'maintenance', projection({ assets: [{ ...asset, holding_id: 'replacement-holding' }] }), 'floor-a').markers, []);
  assert.deepEqual(campusMemberMarkers({ ...scene, elements: scene.elements.map(element => element.id === fixture.id ? { ...element, review_state: 'needs_review' } : element) }, places, 'campus', 'maintenance', data, 'floor-a').markers, []);
});

test('degraded service has an attention marker while unknown and resolved signals do not invent faults', () => {
  const degraded = projection({ assets: [{ ...asset, signal: { ...asset.signal, impact: 'degraded', state: 'awaiting_verification' } }] });
  const result = campusMemberMarkers(scene, places, 'campus', 'maintenance', degraded, 'floor-a');
  assert.equal(result.markers[0].tone, 'attention');
  assert.match(result.markers[0].label, /awaiting check/i);
  for (const state of ['unknown', 'verified_resolution'] as const) assert.deepEqual(campusMemberMarkers(scene, places, 'campus', 'maintenance', projection({ assets: [{ ...asset, native_state: 'unavailable', signal: { ...asset.signal, state } }] }), 'floor-a').markers, []);
  const combined = campusMemberMarkers(scene, places, 'campus', 'maintenance', projection({ assets: [asset], activities: [activity('repair-record', 'room-a', { layer: 'maintenance', dimension: 'accepted', state: 'in_progress' })] }), 'floor-a');
  assert.equal(combined.markers.length, 2);
  assert.equal(combined.groups.length, 1);
  assert.ok(combined.markers.every(marker => marker.count === 1 && marker.expectedCount === undefined));
});

test('private unknown state stays an explicit unknown record instead of an empty or accepted room', () => {
  const snapshot = privateSnapshot(), room = snapshot.spaces.find(space => space.id === 'room-a')!;
  room.assertions.expected = [];
  room.state_dimension = 'unknown';
  const result = campusAdministratorMarkers(scene, snapshot, 'campus', 'unknown', 'floor-a');
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].elementId, roomA.id);
  assert.equal(result.markers[0].dimension, 'unknown');
  assert.equal(result.markers[0].count, 1);
  assert.match(result.markers[0].summary, /unknown record/);
  assert.equal(result.groups[0].records[0].temporal, 'unknown');
  assert.match(result.groups[0].records[0].detail ?? '', /Missing evidence is not evidence of absence/);
  assert.equal(campusAdministratorMarkers(scene, snapshot, 'campus', 'accepted', 'floor-a').markers.length, 0);
  assert.deepEqual(campusAdministratorMarkers(scene, undefined, 'campus', 'unknown', 'floor-a'), { markers: [], groups: [], unlocated: [] });
});

test('private expected assignments are current only within their source window; point observations stay historical', () => {
  const snapshot = privateSnapshot(), before = structuredClone(snapshot);
  const expected = campusAdministratorMarkers(scene, snapshot, 'campus', 'expected', 'floor-a');
  assert.equal(expected.markers[0].dimension, 'expected');
  assert.equal(expected.markers[0].count, 1);
  assert.equal(expected.markers[0].expectedCount, 12);
  assert.equal(expected.groups[0].records[0].temporal, 'current');
  const observed = campusAdministratorMarkers(scene, snapshot, 'campus', 'observed', 'floor-a');
  assert.equal(observed.markers[0].dimension, 'observed');
  assert.equal(observed.markers[0].count, 1);
  assert.equal(observed.markers[0].expectedCount, undefined);
  assert.match(observed.markers[0].summary, /historical/);
  assert.equal(observed.groups[0].records[0].temporal, 'historical');
  assert.match(observed.groups[0].records[0].detail ?? '', /not current location/);
  assert.deepEqual(snapshot, before);
  snapshot.as_of = '2026-10-29T10:00:00Z';
  assert.deepEqual(campusAdministratorMarkers(scene, snapshot, 'campus', 'expected', 'floor-a').markers, []);
  assert.equal(campusAdministratorMarkers(scene, snapshot, 'campus', 'observed', 'floor-a').markers[0].count, 1);
});

test('private evidence uses reviewed canonical geometry and excludes foreign-campus records', () => {
  const snapshot = privateSnapshot(), row = snapshot.spaces.find(space => space.id === 'room-a')!;
  snapshot.spaces.push({ ...structuredClone(row), id: 'foreign-room', campus_id: 'foreign-campus' });
  const foreignDrawing = { ...roomA, id: 'foreign-drawing', space_id: 'foreign-room' }, draftDrawing = { ...roomA, review_state: 'needs_review' as const };
  const drawing = { ...scene, elements: [...scene.elements.filter(element => element.id !== roomA.id), draftDrawing, foreignDrawing] };
  const result = campusAdministratorMarkers(drawing, snapshot, 'campus', 'expected', 'floor-a');
  assert.deepEqual(result.markers, []);
  assert.deepEqual(result.groups, []);
  assert.ok(result.unlocated.some(record => record.spaceId === 'room-a'));
  assert.ok(result.unlocated.every(record => record.spaceId !== 'foreign-room'));
  const outside = campusAdministratorMarkers(drawing, snapshot, 'campus', 'expected', null);
  assert.equal(outside.markers[0].elementId, building.id);
  assert.equal(outside.markers[0].count, 1);
  assert.ok(outside.markers.every(marker => marker.elementId !== draftDrawing.id && marker.elementId !== foreignDrawing.id));
});

test('unlocated private signals and pending protocol records remain inspectable without invented markers', () => {
  const snapshot = privateSnapshot();
  snapshot.signals.push({ id: 'cross-check', severity: 'review', title: 'Source cross-check', detail: 'Needs operator review', occurred_at: snapshot.as_of, target_path: '/areas/attendance/coordination' });
  snapshot.activity.push({ id: 'pending-command', occurred_at: snapshot.as_of, title: 'Command awaiting decision', detail: 'Protocol state only', state_dimension: 'unknown', source_label: 'Coordination', target_path: '/work' });
  const result = campusAdministratorMarkers(scene, snapshot, 'campus', 'unknown', 'floor-a');
  const ids = result.unlocated.map(record => record.id);
  assert.ok(ids.includes('signal:cross-check'));
  assert.ok(ids.includes('activity:pending-command'));
  assert.ok(result.groups.every(group => group.records.every(record => !['signal:cross-check', 'activity:pending-command'].includes(record.id))));
  assert.ok(result.markers.every(marker => marker.dimension === 'unknown'));
  const disabled = campusAdministratorMarkers(scene, snapshot, 'campus', 'none', 'floor-a');
  assert.deepEqual(disabled, { markers: [], groups: [], unlocated: [] });
});
