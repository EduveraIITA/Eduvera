import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusSceneWorkspace } from '../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import { applyCampusMapHints, campusMapAssistance } from '../src/lib/campus-map-assistance';
import { campusSceneActionAllowed, canStartCampusMapSetup } from '../src/lib/campus-scene-policy';
import type { NativePendingAction, NativePendingScope } from '../src/lib/native-pending-action';

const campusId = '77285488-ed78-4802-8ecb-c45b0d22a1e2';
const key = 'a6b640b4-20ad-4464-b466-5a7e41b92ec8';
const campus = { id: campusId, name: 'Main Campus', code: 'MAIN' };
const building: CampusSceneElement = {
  id: 'building-1', kind: 'building', label: 'Building 1', space_id: null, floor_id: null, review_state: 'reviewed',
  geometry: { type: 'polygon', points: [{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 10 }] },
};
const document: CampusSceneDocument = {
  schema_version: 1, name: campus.name, elements: [building], bounds: { width: 100, height: 90, unit: 'metres' },
  source: { kind: 'open_map', label: 'Selected map area' },
};

test('the boundary opens on a confirmed empty campus or saved blank manual draft', () => {
  const fresh: CampusSceneWorkspace = { campus, scene: null, spaces: [] };
  const blank: CampusSceneDocument = { ...document, elements: [], source: { kind: 'manual', label: 'Manually drawn campus' } };
  const scene = { id: campusId, revision: 1, draft: blank, published_version: null, published: null, updated_at: '' };
  const draft = (update: Partial<NonNullable<CampusSceneWorkspace['scene']>> = {}): CampusSceneWorkspace => ({ ...fresh, scene: { ...scene, ...update } });
  assert.equal(canStartCampusMapSetup(fresh, campusId, true), true);
  assert.equal(canStartCampusMapSetup(draft(), campusId, true), true);
  assert.equal(canStartCampusMapSetup(draft({ draft: { ...blank, elements: [building] } }), campusId, true), false);
  assert.equal(canStartCampusMapSetup(draft({ draft: { ...blank, source: { ...blank.source, image_asset_id: key } } }), campusId, true), false);
  assert.equal(canStartCampusMapSetup(draft({ draft: { ...document, elements: [] } }), campusId, true), false);
  assert.equal(canStartCampusMapSetup(draft({ published_version: 1 }), campusId, true), false);
  assert.equal(canStartCampusMapSetup(draft({ draft: null }), campusId, true), false);
  assert.equal(canStartCampusMapSetup(fresh, key, true), false);
  assert.equal(canStartCampusMapSetup(fresh, campusId, false), false);
  assert.equal(canStartCampusMapSetup(undefined, campusId, true), false);
});

test('A2UI hints only rename compatible unlinked draft features and never claim authority or geometry', () => {
  const existing = { ...building, id: 'already-linked', space_id: key };
  const other = { ...building, id: 'building-2' };
  const walk = { ...building, id: 'walk', kind: 'path' as const };
  const original = { ...document, elements: [building, existing, other, walk] };
  const { document: updated, kinds } = applyCampusMapHints(original, {
    [building.id]: { label: '  Science library  ', kind: ['library'], geometry: { points: [] }, space_id: key },
    [existing.id]: { label: 'New name', kind: 'building' },
    [other.id]: { label: '', kind: ['gate'] },
    [walk.id]: { label: 'Outdoor classroom', kind: 'classroom' },
    absent: { label: 'Made-up feature', kind: 'building' },
  });
  assert.deepEqual(updated.elements, [{ ...building, label: 'Science library', review_state: 'needs_review' }, existing, other, walk]);
  assert.deepEqual([...kinds], [[building.id, 'library']]);
  assert.equal(campusMapAssistance({ status: 'ai', messages: [] }), null);
  assert.equal(campusMapAssistance({ status: 'simulation', messages: [{}] })?.status, 'simulation');
});

test('the retained map import replays only its bounded polygon and exact campus scope', () => {
  const scope: NativePendingScope = { actorId: key, schoolId: key, mode: 'simulation', namespaceId: 'world', origin: 'https://example.test' };
  const endpoint = `/api/v1/schools/${key}/campus-scenes/${campusId}/`;
  const boundary = [{latitude:28.61,longitude:77.23},{latitude:28.61,longitude:77.24},{latitude:28.62,longitude:77.24}];
  const action = (value: unknown, extras = {}) => ({
    scope, clientId: key, domain: 'campus', endpoint: endpoint + 'imports/', refreshPath: endpoint + 'workspace/',
    source: { kind: 'campus_scene', sourceId: campusId, revision: 0 }, method: 'POST', replayPolicy: 'same_request',
    phase: 'unknown', payload: { kind:'json', body:JSON.stringify({ kind: 'map_area', label: 'Main Campus', boundary: value, idempotency_key: key, ...extras }) },
  } as NativePendingAction);
  assert.equal(campusSceneActionAllowed(action(boundary), scope), true);
  assert.equal(campusSceneActionAllowed(action(boundary), {...scope, schoolId:campusId}), false);
  assert.equal(campusSceneActionAllowed(action(boundary.slice(0, 2)), scope), false);
  assert.equal(campusSceneActionAllowed(action([...boundary, {latitude:90,longitude:77}]), scope), false);
  assert.equal(campusSceneActionAllowed(action(boundary,{url:'https://example.test/map'}), scope), false);
});
