import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusScenePublished } from '../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import type { CampusMapAsset, CampusOperationalProjection } from '../../packages/contracts/src/campus-operation';
import type { CampusPersonalDestination, CampusPersonalResponse } from '../../packages/contracts/src/campus-personal';
import { initialCampusMapPresentation } from '../../packages/contracts/src/campus-scenes/sceneMapPresentation';
import { personalJourneySignature } from '../../packages/contracts/src/campus-scenes/personalJourney';
import { nativeCampusAssetContext, nativeCampusFullscreenReturnMatches, nativeCampusJourneyChanges, nativeCampusJourneyMatches, nativeCampusLayersMatch, nativeCampusMapContext, nativeCampusPresentationQuery, nativeCampusUrlView, nativeCampusWorldIdentity } from '../src/lib/native-campus';

const at = '2026-10-29T09:00:00Z';
const environment = { mode: 'live' as const };
const box = { type: 'polygon' as const, points: [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 20, y: 100 }] };
const building: CampusSceneElement = { id: 'building', kind: 'building', label: 'Learning building', space_id: 'building-place', floor_id: null, review_state: 'reviewed', geometry: box };
const roomA: CampusSceneElement = { ...building, id: 'room-a-drawing', kind: 'room', label: 'Same room label', space_id: 'room-a', floor_id: 'floor-a', parent_element_id: building.id };
const roomB: CampusSceneElement = { ...roomA, id: 'room-b-drawing', space_id: 'room-b', floor_id: 'floor-b' };
const draft: CampusSceneElement = { ...roomA, id: 'draft-room', space_id: 'draft-place', review_state: 'needs_review' };
const fixture: CampusSceneElement = { ...roomA, id: 'projector', kind: 'fixture', label: 'Projector', space_id: null, holding_id: 'holding', geometry: { type: 'point', points: [{ x: 30, y: 30 }] } };
const path = (id: string, floor: string | null, start: string, end: string): CampusSceneElement => ({ id, kind: 'path', label: id, space_id: null, floor_id: floor,
  review_state: 'reviewed', geometry: { type: 'polyline', points: [{ x: 20, y: 20 }, { x: 100, y: 20 }] }, navigation: { walkable: true, accessible: true, status: 'open', start_space_id: start, end_space_id: end } });
const scene: CampusSceneDocument = { schema_version: 1, name: 'Campus', bounds: { width: 200, height: 200, unit: 'metres' }, source: { kind: 'manual', label: 'Reviewed drawing' },
  elements: [building, roomA, roomB, draft, fixture, path('outdoor', null, 'gate', 'building-place'), path('floor-a-path', 'floor-a', 'room-a', 'hall-a'), path('floor-b-path', 'floor-b', 'room-b', 'hall-b')] };
const place = (id: string, parent_space_id: string | null, kind = 'classroom') => ({ id, name: id, code: id, parent_space_id, kind, revision: 1 });
const places = [place('building-place', null, 'building'), place('floor-a', 'building-place', 'floor'), place('floor-b', 'building-place', 'floor'), place('room-a', 'floor-a'), place('room-b', 'floor-b'), place('draft-place', 'floor-a'), place('unmapped', 'floor-a'), place('gate', null, 'gate'), place('hall-a', 'floor-a'), place('hall-b', 'floor-b')];
const publication: CampusScenePublished = { campus: { id: 'campus', name: 'Main', code: 'MAIN' }, scene: { id: 'publication', version: 2, published_at: at, document: scene }, can_edit: true, places };
const item = (id: string, space_id: string, revision = 1): CampusPersonalDestination => ({ id, kind: 'teaching_session', title: 'Same activity label', detail: 'Published teaching session', starts_at: at, ends_at: '2026-10-29T10:00:00Z', state: 'in_progress', space_id, place_label: 'Same room label', target_path: `/areas/timetable?period_id=${id}&occurrence_id=${id}-occurrence`, action_label: 'Open teaching session', dimension: 'expected', spatial_claim: 'expected_context_only', source: { domain: 'schedule', record_id: `${id}-source`, revision, label: 'Published schedule' } });
const activityA = item('activity-a', 'room-a'), activityB = item('activity-b', 'room-b');
const personal: CampusPersonalResponse = { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: at, local_date: '2026-10-29', timezone: 'Asia/Kolkata', environment: { kind: 'live', namespace_id: 'live:school' }, freshness: { status: 'current', as_of: at }, places, now: [activityA], next: [activityB], destinations: [activityA, activityB], limitations: [] };
const asset: CampusMapAsset = { element_id: fixture.id, holding_id: 'holding', name: 'Projector', asset_tag: 'PROJ-1', space_id: 'room-a', native_state: 'available', reportable: true, signal: { state: 'unknown', impact: null, open_reports: 0, updated_at: null }, repairs: [] };
const operations: CampusOperationalProjection = { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: at, environment: { kind: 'live', namespace_id: 'live:school' }, publication: { id: 'publication', version: 2 }, assets: [asset], activities: [], limitations: [] };
const input = () => ({ schoolId: 'school', actorId: 'actor', environment, data: publication, personal, operations });
const scoped = (changes: Record<string, string> = {}) => new URLSearchParams({ map_context: nativeCampusMapContext('campus', environment), ...changes });
const apply = (params: URLSearchParams, changes: Record<string, string | null | undefined>) => { const result = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) if (value == null) result.delete(key); else result.set(key, value); return result; };
const empty = { selectedId: null, spaceId: null, buildingId: null, floorId: null };

test('unscoped private and canonical links cannot mutate the shared default presentation', () => {
  const before = structuredClone(initialCampusMapPresentation);
  assert.equal(nativeCampusUrlView(new URLSearchParams('panel=kpis'), input()).presentation.panel, 'operations');
  assert.equal(nativeCampusUrlView(new URLSearchParams('place_id=room-b'), input()).selection.selectedId, roomB.id);
  assert.deepEqual(initialCampusMapPresentation, before);
  const fresh = nativeCampusUrlView(new URLSearchParams(), input());
  assert.equal(fresh.presentation.panel, null);
  assert.deepEqual(fresh.selection, empty);
  const otherWorld = nativeCampusUrlView(new URLSearchParams(), { ...input(), environment: { mode: 'simulation', namespace_id: 'other-world', run_id: 'run' } });
  assert.equal(otherWorld.presentation.panel, null);
});

test('current member journeys resolve exact reviewed IDs despite duplicate activity and room labels', () => {
  const view = nativeCampusUrlView(new URLSearchParams({ journey: activityB.id, campus_space: 'room-b', campus_focus: 'journey', walk_context: personalJourneySignature(activityB) }), input());
  assert.equal(view.journey?.id, activityB.id);
  assert.equal(view.journeyStale, false);
  assert.deepEqual(view.selection, { selectedId: roomB.id, spaceId: 'room-b', buildingId: building.id, floorId: 'floor-b' });
  assert.equal(view.presentation.panel, 'day');
  assert.equal(view.error, '');
  assert.equal(view.layer, 'none');
});

test('initial scoped interior restore survives a personal intent without rewriting the saved map', () => {
  const params = scoped({ map_place: roomA.id, map_space: 'room-a', map_inside: building.id, map_view_floor: 'floor-a', map_panel: 'search', map_search: 'room', map_page: '2', map_mode: '2d', map_full: '1', journey: activityB.id, campus_space: 'room-b', campus_focus: 'journey', walk_context: personalJourneySignature(activityB) });
  const view = nativeCampusUrlView(params, input());
  assert.deepEqual(view.selection, { selectedId: roomA.id, spaceId: 'room-a', buildingId: building.id, floorId: 'floor-a' });
  assert.equal(view.presentation.panel, 'search');
  assert.equal(view.presentation.search, 'room');
  assert.equal(view.presentation.page, 2);
  assert.equal(view.presentation.mode, '2d');
  assert.equal(view.presentation.expanded, true);
});

test('explicit personal selection clears stale interior, manual directions and asset intent', () => {
  const previous = scoped({ map_place: roomA.id, map_space: 'room-a', map_inside: building.id, map_view_floor: 'floor-a', map_floor: 'floor-a', map_to: 'room-a', map_from: 'gate', map_step_free: '1', campus_asset: fixture.id, campus_asset_context: nativeCampusAssetContext('school', 'actor', 'campus', environment, publication), panel: 'spaces', directions: '1', walk_from: 'gate', journey: activityA.id, walk_context: personalJourneySignature(activityA) });
  const next = apply(previous, nativeCampusJourneyChanges(activityB, false)), view = nativeCampusUrlView(next, input());
  assert.deepEqual(view.selection, { selectedId: roomB.id, spaceId: 'room-b', buildingId: building.id, floorId: 'floor-b' });
  assert.equal(view.presentation.panel, 'day');
  assert.equal(view.journey?.id, activityB.id);
  assert.equal(view.personalDirections, false);
  assert.equal(view.manualDirections, null);
  assert.equal(view.assetId, null);
  for (const key of ['map_place', 'map_space', 'map_inside', 'map_view_floor', 'map_floor', 'map_to', 'map_from', 'map_step_free', 'campus_asset', 'campus_asset_context', 'panel', 'walk_from']) assert.equal(next.has(key), false, key);
  assert.equal(previous.get('map_view_floor'), 'floor-a');
});

test('explicit activity directions open outside and require a newly chosen reviewed origin', () => {
  const previous = scoped({ map_place: roomA.id, map_space: 'room-a', map_inside: building.id, map_view_floor: 'floor-a', walk_from: 'gate', walk_context: personalJourneySignature(activityA) });
  const next = apply(previous, nativeCampusJourneyChanges(activityB, true)), view = nativeCampusUrlView(next, input());
  assert.equal(view.personalDirections, true);
  assert.equal(view.personalOrigin, '');
  assert.equal(view.journeyStale, false);
  assert.deepEqual(view.selection, { selectedId: roomB.id, spaceId: 'room-b', buildingId: null, floorId: null });
  assert.equal(next.get('walk_context'), personalJourneySignature(activityB));
});

test('moved or revised journeys withdraw saved location and origin while explicit explore remains usable', () => {
  const params = scoped({ journey: activityA.id, campus_space: 'room-a', campus_focus: 'journey', directions: '1', walk_from: 'gate', walk_context: personalJourneySignature(activityA) });
  const changed = item(activityA.id, 'room-b', 2), current = { ...personal, now: [changed], next: [activityB], destinations: [changed, activityB] };
  const view = nativeCampusUrlView(params, { ...input(), personal: current });
  assert.equal(view.journeyStale, true);
  assert.deepEqual(view.selection, empty);
  assert.equal(view.personalOrigin, '');
  assert.match(view.error, /changed/i);
  const exploring = nativeCampusUrlView(apply(params, { campus_focus: 'explore' }), { ...input(), personal: current });
  assert.equal(exploring.journeyStale, true);
  assert.equal(exploring.selection.spaceId, 'room-a');
  assert.equal(exploring.personalOrigin, '');
  assert.notEqual(view.signature, nativeCampusUrlView(params, input()).signature);
});

test('cancelled selected journey cannot reuse the former origin for a fallback activity', () => {
  const params = scoped({ journey: activityA.id, campus_space: 'room-a', directions: '1', walk_from: 'gate', walk_context: personalJourneySignature(activityA) });
  const view = nativeCampusUrlView(params, { ...input(), personal: { ...personal, now: [], next: [activityB], destinations: [activityB] } });
  assert.equal(view.journey?.id, activityB.id);
  assert.equal(view.journeyStale, true);
  assert.equal(view.personalOrigin, '');
  assert.deepEqual(view.selection, empty);
});

test('foreign or unavailable personal data cannot restore a saved actor journey', () => {
  const params = new URLSearchParams({ journey: activityA.id, campus_space: 'room-a', directions: '1', walk_from: 'gate' });
  for (const current of [
    { ...personal, school_id: 'foreign' }, { ...personal, campus_id: 'foreign' }, { ...personal, environment: { kind: 'simulation' as const, namespace_id: 'world' } },
  ]) {
    assert.equal(nativeCampusJourneyMatches(current, 'school', 'campus', environment), false);
    const view = nativeCampusUrlView(params, { ...input(), personal: current });
    assert.equal(view.journey, undefined);
    assert.equal(view.personalDirections, false);
    assert.deepEqual(view.selection, empty);
  }
  const simulation = { mode: 'simulation' as const, namespace_id: 'world', run_id: 'run' }, simulatedPersonal = { ...personal, environment: { kind: 'simulation' as const, namespace_id: 'world' } };
  assert.equal(nativeCampusJourneyMatches(simulatedPersonal, 'school', 'campus', simulation), true);
  assert.equal(nativeCampusJourneyMatches(simulatedPersonal, 'school', 'campus', { ...simulation, unavailable: true }), false);
});

test('asset intent wins over saved private and personal selectors only for exact current actor and publication', () => {
  const context = nativeCampusAssetContext('school', 'actor', 'campus', environment, publication);
  const params = scoped({ map_place: roomB.id, map_space: 'room-b', map_inside: building.id, map_view_floor: 'floor-b', campus_space: 'room-b', journey: activityB.id, campus_focus: 'journey', panel: 'spaces', campus_asset: fixture.id, campus_asset_context: context });
  const view = nativeCampusUrlView(params, input());
  assert.equal(view.assetId, fixture.id);
  assert.deepEqual(view.selection, { selectedId: fixture.id, spaceId: 'room-a', buildingId: building.id, floorId: 'floor-a' });
  assert.equal(view.presentation.panel, 'place');
  assert.equal(nativeCampusUrlView(params, { ...input(), actorId: 'another-actor' }).assetId, null);
  assert.equal(nativeCampusUrlView(params, { ...input(), data: { ...publication, scene: { ...publication.scene!, version: 3 } } }).assetId, null);
  assert.equal(nativeCampusUrlView(params, { ...input(), data: { ...publication, scene: { ...publication.scene!, id: 'other-publication' } } }).assetId, null);
});

test('asset inspection rejects a stale holding, foreign projection or mismatched selected world', () => {
  const params = scoped({ campus_asset: fixture.id, campus_asset_context: nativeCampusAssetContext('school', 'actor', 'campus', environment, publication) });
  const wrongOperations: CampusOperationalProjection[] = [
    { ...operations, assets: [{ ...asset, holding_id: 'replacement-holding' }] }, { ...operations, school_id: 'foreign' }, { ...operations, campus_id: 'foreign' },
    { ...operations, publication: { id: 'publication', version: 1 } }, { ...operations, environment: { kind: 'simulation', namespace_id: 'world' } },
  ];
  for (const source of wrongOperations) assert.equal(nativeCampusUrlView(params, { ...input(), operations: source }).assetId, null);
  const simulation = { mode: 'simulation' as const, namespace_id: 'world', run_id: 'run' }, simulated = { ...operations, environment: { kind: 'simulation' as const, namespace_id: 'world' } };
  const selected = scoped({ campus_asset: fixture.id, campus_asset_context: nativeCampusAssetContext('school', 'actor', 'campus', simulation, publication) });
  assert.equal(nativeCampusLayersMatch(simulated, 'school', 'campus', simulation, publication), true);
  assert.equal(nativeCampusUrlView(selected, { ...input(), environment: simulation, operations: simulated }).assetId, fixture.id);
  assert.equal(nativeCampusUrlView(selected, { ...input(), environment: { ...simulation, namespace_id: 'other-world' }, operations: simulated }).assetId, null);
});

test('ambiguous or malformed shared condition withdraws both asset details and renderer input', () => {
  const params=scoped({campus_asset:fixture.id,campus_asset_context:nativeCampusAssetContext('school','actor','campus',environment,publication)});
  const mutations:Array<(value:CampusOperationalProjection)=>void>=[
    value=>value.assets.push({...value.assets[0]}),
    value=>value.assets.push({...value.assets[0],element_id:'another-graphic'}),
    value=>value.assets.push({...value.assets[0],holding_id:'another-holding'}),
    value=>value.assets[0].element_id='',
    value=>value.assets[0].holding_id=' ',
    value=>value.assets[0].native_state='working' as any,
    value=>value.assets[0].signal.state='repaired' as any,
    value=>value.assets[0].signal.impact='broken' as any,
    value=>value.assets[0].signal.open_reports=-1,
    value=>value.assets[0].signal.updated_at='invalid',
    value=>value.assets[0].reportable='yes' as any,
    value=>value.assets[0].repairs=[null as any],
    value=>value.assets[0].repairs=[{id:'repair',revision:0,state:'reported',target_path:'/areas/facilities',action_label:'Open repair'}],
    value=>value.assets[0].repairs=[{id:'repair',revision:1,state:'working' as any,target_path:'/areas/facilities',action_label:'Open repair'}],
    value=>value.assets[0].repairs=[{id:'repair',revision:1,state:'reported',target_path:'/areas/facilities',action_label:'Open repair'},{id:'repair',revision:2,state:'closed',target_path:'/areas/facilities',action_label:'Open repair'}],
  ];
  for(const mutate of mutations){
    const source=structuredClone(operations);mutate(source);
    assert.equal(nativeCampusLayersMatch(source,'school','campus',environment,publication),false);
    assert.doesNotThrow(()=>assert.equal(nativeCampusUrlView(params,{...input(),operations:source}).assetId,null));
  }
  assert.equal(nativeCampusLayersMatch(operations,'school','campus',environment,publication),true);
  const unknown=structuredClone(operations);unknown.assets[0].native_state='unknown';
  assert.equal(nativeCampusLayersMatch(unknown,'school','campus',environment,publication),true,'explicit unknown remains legitimate data');
});

test('private canonical inspection is independent of the member personal activities feed', () => {
  const currentPersonal = { ...personal, places: places.filter(place => place.id !== 'room-b'), next: [], destinations: [activityA] };
  const view = nativeCampusUrlView(new URLSearchParams({ panel: 'spaces', campus_space: 'room-b' }), { ...input(), personal: currentPersonal });
  assert.equal(view.privatePanel, 'spaces');
  assert.equal(view.presentation.panel, 'operations');
  assert.equal(view.selection.spaceId, 'room-b');
  assert.equal(view.error, '');
});

test('generic directions take precedence over retained personal directions and validate reviewed origins', () => {
  const params = scoped({ map_panel: 'directions', map_to: 'room-b', map_from: 'gate', map_step_free: '1', map_floor: 'floor-b', journey: activityA.id, directions: '1', walk_from: 'gate', walk_context: personalJourneySignature(activityA) });
  const view = nativeCampusUrlView(params, input());
  assert.deepEqual(view.manualDirections, { origin: 'gate', destination: 'room-b', accessible: true, floorId: 'floor-b' });
  assert.equal(view.personalDirections, false);
  assert.equal(view.selection.floorId, 'floor-b');
  assert.equal(nativeCampusUrlView(apply(params, { map_from: 'not-a-reviewed-endpoint' }), input()).manualDirections?.origin, '');
  const unavailable = nativeCampusUrlView(apply(params, { map_to: 'not-a-place' }), input());
  assert.equal(unavailable.manualDirections, null);
  assert.equal(unavailable.personalDirections, false);
  assert.equal(nativeCampusUrlView(apply(params, { map_context: 'other-campus:live:global' }), input()).manualDirections, null);
});

test('duplicate selectors fail without arming a personal or manual route', () => {
  const params = scoped({ map_panel: 'directions', map_to: 'room-b', map_from: 'gate', directions: '1', journey: activityA.id, campus_space: 'room-a' });
  for (const key of ['campus_id', 'panel', 'campus_space', 'journey', 'map_to', 'map_context', 'edit']) {
    const duplicate = new URLSearchParams(params); duplicate.append(key, 'first'); duplicate.append(key, 'second');
    const view = nativeCampusUrlView(duplicate, input());
    assert.match(view.error, /conflicting/i, key);
    assert.deepEqual(view.selection, empty, key);
    assert.equal(view.presentation.panel, null, key);
    assert.equal(view.manualDirections, null, key);
    assert.equal(view.personalDirections, false, key);
  }
});

test('scoped URL presentation never selects draft-only geometry or invents unavailable canonical places', () => {
  const direct = nativeCampusUrlView(scoped({ map_place: draft.id, map_space: 'draft-place', map_inside: building.id, map_view_floor: 'floor-a' }), input());
  assert.equal(direct.selection.selectedId, null);
  const alias = nativeCampusUrlView(new URLSearchParams({ place_id: 'draft-place' }), input());
  assert.notEqual(alias.selection.selectedId, draft.id);
  assert.equal(alias.selection.selectedId, building.id);
  assert.equal(alias.selection.floorId, null);
  const absent = nativeCampusUrlView(new URLSearchParams({ place_id: 'no-canonical-place' }), input());
  assert.deepEqual(absent.selection, empty);
  assert.match(absent.error, /unavailable/i);
});

test('context identities distinguish selected worlds and qualify every asset publication and actor', () => {
  const simulation = { mode: 'simulation' as const, namespace_id: 'world', run_id: 'run' };
  assert.notEqual(nativeCampusMapContext('campus', environment), nativeCampusMapContext('other-campus', environment));
  assert.notEqual(nativeCampusMapContext('campus', environment), nativeCampusMapContext('campus', simulation));
  assert.notEqual(nativeCampusWorldIdentity(simulation), nativeCampusWorldIdentity({ ...simulation, run_id: 'other-run' }));
  assert.notEqual(nativeCampusWorldIdentity(simulation), nativeCampusWorldIdentity({ ...simulation, unavailable: true }));
  const context = nativeCampusAssetContext('school', 'actor', 'campus', environment, publication);
  assert.notEqual(context, nativeCampusAssetContext('other-school', 'actor', 'campus', environment, publication));
  assert.notEqual(context, nativeCampusAssetContext('school', 'other-actor', 'campus', environment, publication));
  assert.notEqual(context, nativeCampusAssetContext('school', 'actor', 'campus', simulation, publication));
});

test('fullscreen presentation capture excludes expansion and cannot replace active campus or unrelated owner parameters', () => {
  const params = scoped({ campus_id: 'campus', map_full: '1', map_place: roomA.id, map_space: 'room-a', map_search: 'Learning room', map_page: '3', map_panel: 'search', panel: 'spaces', edit: '1', attention_notification_id: 'notification', return_to: '/work' });
  const before = params.toString(), query = new URLSearchParams(nativeCampusPresentationQuery(params));
  assert.equal(query.get('map_place'), roomA.id);
  assert.equal(query.get('map_search'), 'Learning room');
  assert.equal(query.get('map_page'), '3');
  assert.equal(query.get('panel'), 'spaces');
  assert.equal(query.get('map_context'), nativeCampusMapContext('campus', environment));
  for (const key of ['campus_id', 'map_full', 'edit', 'attention_notification_id', 'return_to']) assert.equal(query.has(key), false, key);
  assert.equal(params.toString(), before);
  assert.equal(params.get('campus_id'), 'campus');
});

test('fullscreen restoration requires the actual originating entry and original collapsed presentation', () => {
  const original = scoped({ campus_id: 'campus', map_place: roomA.id, map_space: 'room-a', map_inside: building.id, map_view_floor: 'floor-a', map_panel: 'place' });
  const record = { sourceKey: 'real-origin-entry', sourceQuery: nativeCampusPresentationQuery(original) };
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'real-origin-entry', original), true);
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'new-entry', original), false);
  assert.equal(nativeCampusFullscreenReturnMatches({ ...record, sourceKey: null }, 'real-origin-entry', original), false);
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'real-origin-entry', apply(original, { map_place: roomB.id, map_space: 'room-b', map_view_floor: 'floor-b' })), false);
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'real-origin-entry', apply(original, { campus_space: 'room-b', campus_focus: 'explore' })), false);
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'real-origin-entry', apply(original, { map_context: 'other-campus:live:global' })), false);
});

test('expansion alone does not change collapsed presentation and unrelated caller context stays outside the restore query', () => {
  const original = scoped({ campus_id: 'campus', map_panel: 'search', map_search: 'room', map_page: '2' });
  const record = { sourceKey: 'origin', sourceQuery: nativeCampusPresentationQuery(original) };
  assert.equal(nativeCampusFullscreenReturnMatches(record, 'origin', apply(original, { map_full: '1' })), true);
  assert.equal(nativeCampusPresentationQuery(apply(original, { map_full: '1' })), record.sourceQuery);
  const incoming = apply(original, { campus_id: 'current-campus', owner_context: 'retained-by-caller' });
  const saved = new URLSearchParams(record.sourceQuery);
  for (const [key, value] of saved) incoming.set(key, value);
  assert.equal(incoming.get('campus_id'), 'current-campus');
  assert.equal(incoming.get('owner_context'), 'retained-by-caller');
});
