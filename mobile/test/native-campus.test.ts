import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusSceneDirectory, CampusScenePublished } from '../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import type { CampusMapAsset } from '../../packages/contracts/src/campus-operation';
import { nativeCampusRoutePath, nativeCampusBuildingPage, nativeCampusSceneInstant, nativeCampusDisplay, nativeCampusPage, nativeCampusPlacePage, nativeCampusPlaceSelection, nativeCampusProjectionMatches, nativeCampusPublicationMatches, selectNativeCampus } from '../src/lib/native-campus';

const building: CampusSceneElement = { id: 'building-a', kind: 'building', label: 'Learning building', space_id: 'place-a', floor_id: null,
  review_state: 'reviewed', geometry: { type: 'polygon', points: [{ x: 50, y: 80 }, { x: 130, y: 80 }, { x: 130, y: 140 }, { x: 50, y: 140 }] } };
const otherBuilding: CampusSceneElement = { ...building, id: 'building-b', space_id: 'place-b' };
const room: CampusSceneElement = { ...building, id: 'room-a', kind: 'room', label: 'Room 101', space_id: 'room-place', floor_id: 'floor-a', parent_element_id: building.id,
  geometry: { type: 'polygon', points: [{ x: 60, y: 90 }, { x: 80, y: 90 }, { x: 80, y: 110 }] } };
const fixture: CampusSceneElement = { ...room, id: 'projector', kind: 'fixture', holding_id: 'holding', space_id: null };
const connector: CampusSceneElement = { ...fixture, id: 'stairs', holding_id: null, floor_id: 'floor-upper',
  navigation_connector: { kind: 'stairs', from_floor_id: 'floor-a', to_floor_id: 'floor-upper', status: 'open', accessible: false } };
const scene: CampusSceneDocument = { schema_version: 1, name: 'Campus', bounds: { width: 300, height: 300, unit: 'metres' }, source: { kind: 'manual', label: 'Published drawing' }, elements: [building, room, fixture, connector, otherBuilding] };
const place = (id: string, parent_space_id: string | null, kind = 'classroom') => ({ id, parent_space_id, kind, name: id, code: id });
const places = [place('place-a', null, 'building'), place('place-b', null, 'building'), place('floor-a', 'place-a', 'floor'),
  place('floor-upper', 'place-a', 'floor'), place('floor-b', 'place-b', 'floor'), place('room-place', 'floor-a'), place('unmapped', 'floor-a')];
const publication: CampusScenePublished = { campus: { id: 'campus', name: 'Main', code: 'MAIN' }, scene: { id: 'publication', version: 2, published_at: '2026-10-28T00:00:00Z', document: scene }, places, can_edit: false };
const directory: CampusSceneDirectory = { campuses: [{ id: 'east', name: 'East', code: 'E' }, { id: 'main', name: 'Main', code: 'M', is_primary: true }], can_edit: false };
const asset: CampusMapAsset = { element_id: fixture.id, holding_id: 'holding', name: 'Projector', asset_tag: 'PROJ-12', space_id: 'room-place', native_state: 'unknown',
  reportable: false, signal: { state: 'unknown', impact: null, open_reports: 0, updated_at: null }, repairs: [] };

test('campus defaults match web primary/first; explicit unavailable selection never falls back', () => {
  assert.equal(selectNativeCampus(directory)?.id, 'main');
  assert.equal(selectNativeCampus({ ...directory, campuses: directory.campuses.map(campus => ({ ...campus, is_primary: false })) })?.id, 'east');
  assert.equal(selectNativeCampus(directory, 'east')?.id, 'east');
  assert.equal(selectNativeCampus(directory, 'missing'), undefined);
  assert.equal(selectNativeCampus(directory, ''), undefined);
  assert.equal(selectNativeCampus(undefined), undefined);
  assert.equal(selectNativeCampus({ ...directory, campuses: [] }), undefined);
  assert.equal(selectNativeCampus({ ...directory, campuses: [directory.campuses[0]!, directory.campuses[0]!] }, 'east'), undefined);
});

test('publication validation distinguishes preparing, foreign campus and invalid geometry', () => {
  assert.equal(nativeCampusPublicationMatches(publication, 'campus'), true);
  assert.equal(nativeCampusPublicationMatches({ ...publication, scene: null }, 'campus'), true);
  assert.equal(nativeCampusPublicationMatches(publication, 'foreign'), false);
  assert.equal(nativeCampusPublicationMatches(undefined, 'campus'), false);
  for (const document of [
    { ...scene, bounds: { ...scene.bounds, width: NaN } }, { ...scene, bounds: { ...scene.bounds, height: 0 } },
    { ...scene, elements: [building, building] },
    { ...scene, elements: [{ ...building, geometry: { ...building.geometry, points: [{ x: Infinity, y: 1 }] } }] },
  ]) assert.equal(nativeCampusPublicationMatches({ ...publication, scene: { ...publication.scene!, document } }, 'campus'), false);
  assert.equal(nativeCampusPublicationMatches({ ...publication, scene: { ...publication.scene!, version: 0 } }, 'campus'), false);
});

test('projections require exact school, campus and selected world with no Live fallback in Simulation', () => {
  const live = { school_id: 'school', campus_id: 'campus', environment: { kind: 'live', namespace_id: null } };
  assert.equal(nativeCampusProjectionMatches(live, 'school', 'campus', { mode: 'live' }), true);
  assert.equal(nativeCampusProjectionMatches({ ...live, environment: { kind: 'live', namespace_id: 'live:school' } }, 'school', 'campus', { mode: 'live' }), true);
  for (const value of [{ ...live, school_id: 'foreign' }, { ...live, campus_id: 'foreign' }, { ...live, environment: { kind: 'live', namespace_id: 'live:foreign' } }]) {
    assert.equal(nativeCampusProjectionMatches(value, 'school', 'campus', { mode: 'live' }), false);
  }
  const sim = { ...live, environment: { kind: 'simulation', namespace_id: 'world' } };
  assert.equal(nativeCampusProjectionMatches(sim, 'school', 'campus', { mode: 'simulation', namespace_id: 'world' }), true);
  for (const environment of [{ mode: 'simulation' as const }, { mode: 'simulation' as const, namespace_id: 'other' }, { mode: 'simulation' as const, namespace_id: 'world', unavailable: true },
    { mode: 'simulation' as const, namespace_id: 'world', institution_id: 'foreign' }]) assert.equal(nativeCampusProjectionMatches(sim, 'school', 'campus', environment), false);
  assert.equal(nativeCampusProjectionMatches(live, 'school', 'campus', { mode: 'simulation', namespace_id: 'world' }), false);
});

test('canonical place navigation resolves a mapped room and its authored floor without name inference', () => {
  assert.deepEqual(nativeCampusPlaceSelection(scene, places, 'room-place'), { selectedId: room.id, spaceId: 'room-place', buildingId: building.id, floorId: 'floor-a' });
  assert.deepEqual(nativeCampusPlaceSelection(scene, places, 'floor-a'), { selectedId: building.id, spaceId: 'floor-a', buildingId: building.id, floorId: 'floor-a' });
  assert.deepEqual(nativeCampusPlaceSelection(scene, places, 'unmapped'), { selectedId: building.id, spaceId: 'unmapped', buildingId: null, floorId: null });
  assert.equal(nativeCampusPlaceSelection(scene, places, 'not-a-place'), null);
  const draftRoom = { ...scene, elements: scene.elements.map(element => element.id === room.id ? { ...element, review_state: 'needs_review' as const } : element) };
  assert.equal(nativeCampusPlaceSelection(draftRoom, places, 'room-place')?.selectedId, building.id);
  assert.equal(nativeCampusPlaceSelection(draftRoom, places, 'room-place')?.floorId, null);
});

test('interior uses shared global-coordinate crop and connector landings without mutating publication', () => {
  const before = JSON.stringify(scene);
  const result = nativeCampusDisplay(scene, places, { buildingId: building.id, floorId: 'floor-a', selectedId: room.id });
  assert.equal(result.unavailable, false);
  assert.equal(result.building?.id, building.id);
  assert.equal(result.floorId, 'floor-a');
  assert.deepEqual(result.document?.elements.map(element => element.id), [room.id, fixture.id, connector.id]);
  assert.deepEqual(result.document?.elements.find(element => element.id === room.id)?.geometry.points, room.geometry.points);
  assert.equal(result.document?.elements.find(element => element.id === connector.id)?.floor_id, 'floor-a');
  assert.deepEqual(result.interior?.outline, building.geometry.points);
  assert.ok(result.interior!.viewBounds.x < 50);
  assert.equal(JSON.stringify(scene), before);
});

test('foreign, unmapped and cyclic floor ancestry never displays another building interior', () => {
  for (const selection of [{ buildingId: building.id, floorId: 'floor-b' }, { buildingId: 'unknown', floorId: 'floor-a' }, { floorId: 'unmapped' }, { floorId: 'not-a-place' }]) {
    const result = nativeCampusDisplay(scene, places, selection);
    assert.equal(result.unavailable, true);
    assert.equal(result.document, null);
    assert.equal(result.interior, null);
  }
  const cyclicPlaces = [...places, place('cycle-a', 'cycle-b', 'floor'), place('cycle-b', 'cycle-a')];
  assert.equal(nativeCampusDisplay(scene, cyclicPlaces, { floorId: 'cycle-a' }).unavailable, true);
  const exterior = nativeCampusDisplay(scene, places, { selectedId: room.id });
  assert.equal(exterior.building, null);
  assert.equal(exterior.contextBuilding?.id, building.id);
  assert.equal(exterior.floorId, null);
});

test('search deduplicates multipart outlines by exact canonical identity and retains distinct equal names', () => {
  const multipart = { ...building, id: 'annex' };
  const sameName = { ...otherBuilding, label: building.label };
  const draft = { ...building, id: 'private-draft', space_id: 'private-place', review_state: 'needs_review' as const };
  const value = { ...scene, elements: [building, multipart, sameName, room, draft] };
  assert.deepEqual(nativeCampusPlacePage(value, places, 'Learning building').rows.map(element => element.id), [building.id, otherBuilding.id]);
  assert.deepEqual(nativeCampusPlacePage(value, [{ ...places[0]!, code: 'ACADEMIC-7' }], 'academic-7').rows.map(element => element.id), [building.id]);
  assert.equal(nativeCampusPlacePage(value, places, 'private-draft').total, 0);
  assert.equal(nativeCampusPlacePage(value, places, 'missing').total, 0);
});

test('all lists are bounded to eight and clamp stale or nonfinite pages after filtering', () => {
  const rows = Array.from({ length: 19 }, (_, index) => index);
  assert.deepEqual(nativeCampusPage(rows, 1), { rows: rows.slice(0, 8), page: 1, pages: 3, total: 19, hasMore: true });
  assert.deepEqual(nativeCampusPage(rows, 99).rows, [16, 17, 18]);
  assert.equal(nativeCampusPage(rows, NaN).page, 1);
  assert.equal(nativeCampusPage(rows, -9).page, 1);
  assert.deepEqual(nativeCampusPage([], 99), { rows: [], page: 1, pages: 1, total: 0, hasMore: false });
});

test('building contents reuse canonical hierarchy, keep unmapped rooms and exact verified assets', () => {
  const value = nativeCampusBuildingPage({ building: { ...building, levels: 12 }, scene, places, assets: [asset] });
  assert.equal(value.model.floors, 2);
  assert.equal(value.model.places, 4);
  assert.equal(value.model.resources, 1);
  assert.equal(value.model.nodes.has('place:floor-b'), false);
  const unmapped = value.model.nodes.get('place:unmapped');
  assert.equal(unmapped?.kind === 'place' && unmapped.elementId, null);
  const floor = nativeCampusBuildingPage({ building, scene, places, parentId: 'place:floor-a' });
  assert.deepEqual(floor.rows.map(item => item.id), ['place:room-place', 'place:unmapped']);
  assert.equal(nativeCampusBuildingPage({ building, scene, places, parentId: 'unknown' }).total, 0);
  const resources = nativeCampusBuildingPage({ building, scene, places, assets: [asset], parentId: 'place:room-place' });
  assert.equal(resources.rows[0]?.kind, 'resource');
  assert.equal(resources.rows[0]?.kind === 'resource' && resources.rows[0].asset.native_state, 'unknown');
  assert.equal(nativeCampusBuildingPage({ building, scene, places, assets: [{ ...asset, holding_id: 'wrong' }] }).model.resources, 0);
});

test('building search retains ancestor paths rather than showing a detached matching resource', () => {
  const args = { building, scene, places, assets: [asset], search: 'PROJ-12' };
  assert.deepEqual(nativeCampusBuildingPage(args).rows.map(item => item.id), ['place:floor-a']);
  assert.deepEqual(nativeCampusBuildingPage({ ...args, parentId: 'place:floor-a' }).rows.map(item => item.id), ['place:room-place']);
  assert.deepEqual(nativeCampusBuildingPage({ ...args, parentId: 'place:room-place' }).rows.map(item => item.id), ['resource:projector']);
  assert.equal(nativeCampusBuildingPage({ ...args, search: 'not-present' }).total, 0);
});


test('scene lighting uses only the confirmed Simulation clock and never wall time', () => {
  const live = new Date('2026-10-28T18:00:00.000Z');
  assert.equal(nativeCampusSceneInstant({ mode: 'live' }, live), live);
  const run = { mode: 'simulation' as const, virtual_clock: { now: '2026-01-01T02:30:00.000Z' } };
  assert.equal(nativeCampusSceneInstant(run, live)?.toISOString(), run.virtual_clock.now);
  assert.equal(nativeCampusSceneInstant(run, new Date('2030-01-01T12:00:00Z'))?.toISOString(), run.virtual_clock.now);
  assert.equal(nativeCampusSceneInstant({ ...run, unavailable: true }, live), null);
  assert.equal(nativeCampusSceneInstant({ mode: 'simulation' }, live), null);
  assert.equal(nativeCampusSceneInstant({ ...run, virtual_clock: { now: 'invalid' } }, live), null);
});

test('both mounted campus owners retain their current navigator during presentation changes',()=>{assert.equal(nativeCampusRoutePath('/areas/campus-view?map_search=room'),'/areas/campus-view');assert.equal(nativeCampusRoutePath('/more/virtual-campus?campus_id=main'),'/more/virtual-campus');assert.equal(nativeCampusRoutePath('/areas/campus-viewer'),'/more/virtual-campus');});
