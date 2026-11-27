import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import { floorPlanReviewedRows } from '../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import { indoorContains, indoorResourcePin, indoorRoomCorners } from '../src/lib/campus-indoor-pins';

const buildingPlaceId = '10000000-0000-4000-8000-000000000001';
const floorId = '10000000-0000-4000-8000-000000000002';
const roomPlaceId = '10000000-0000-4000-8000-000000000003';
const holdingId = '10000000-0000-4000-8000-000000000004';
const campusId = '10000000-0000-4000-8000-000000000005';
const building: CampusSceneElement = {
  id: 'learning-building', kind: 'building', label: 'Learning building', review_state: 'reviewed',
  space_id: buildingPlaceId, floor_id: null,
  geometry: {
    type: 'polygon', points: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 84, y: 100 },
      { x: 84, y: 40 }, { x: 72, y: 40 }, { x: 72, y: 100 }, { x: 0, y: 100 },
    ],
  },
};
const room: CampusSceneElement = {
  id: 'reading-room', kind: 'room', label: 'Reading room', review_state: 'reviewed',
  space_id: roomPlaceId, floor_id: floorId, parent_element_id: building.id,
  geometry: { type: 'polygon', points: [
    { x: 6, y: 6 }, { x: 28, y: 6 }, { x: 28, y: 32 }, { x: 6, y: 32 },
  ] },
};
const previouslySavedFixture: CampusSceneElement = {
  id: 'reading-light', kind: 'fixture', label: 'Desk lamp', review_state: 'reviewed', asset_key: 'lamp',
  space_id: roomPlaceId, floor_id: floorId, parent_element_id: room.id, holding_id: holdingId,
  geometry: { type: 'point', points: [{ x: 12, y: 12 }] },
};
const document: CampusSceneDocument = {
  schema_version: 1, name: 'Indoor mapping', bounds: { width: 100, height: 100, unit: 'metres' },
  source: { kind: 'manual', label: 'Campus map' },
  elements: [building, room, previouslySavedFixture],
};

test('rejects a room across an off-centre notch even when all corners and the edge midpoint are inside', () => {
  const lower = { x: 10, y: 60 }, upper = { x: 94, y: 90 };
  const corners = [lower, { x: upper.x, y: lower.y }, upper, { x: lower.x, y: upper.y }];
  assert.ok([...corners, { x: 52, y: 60 }].every(point => indoorContains(point, building.geometry.points)));
  assert.throws(() => indoorRoomCorners(lower, upper, building), /room crosses an edge/);
  assert.deepEqual(indoorRoomCorners(lower, { x: 60, y: 90 }, building), [
    { x: 10, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 90 }, { x: 10, y: 90 },
  ]);
});

test('rejects a fixture outside its room and a pin submitted for another floor', () => {
  const outsideRoom = { x: 50, y: 12 };
  assert.equal(indoorContains(outsideRoom, building.geometry.points), true);
  assert.throws(() => indoorResourcePin(document, building, floorId, room, outsideRoom, 'Desk lamp', 'new-light'),
    /Pin this item inside the selected room/);
  assert.throws(() => indoorResourcePin(document, building, 'another-floor', room, { x: 16, y: 18 }, 'Desk lamp', 'new-light'),
    /Pin this item inside the selected room/);
});

test('a revised pin retains the supplied drawing identity and the selected room and floor', () => {
  const original = structuredClone(document);
  const point = { x: 16, y: 18 };
  const revisedPin = indoorResourcePin(document, building, floorId, room, point, 'Desk lamp', previouslySavedFixture.id);
  assert.deepEqual({
    id: revisedPin.id, floor_id: revisedPin.floor_id, parent_element_id: revisedPin.parent_element_id,
    asset_key: revisedPin.asset_key, geometry: revisedPin.geometry, review_state: revisedPin.review_state,
  }, {
    id: previouslySavedFixture.id, floor_id: floorId, parent_element_id: room.id,
    asset_key: 'lamp', geometry: { type: 'point', points: [point] }, review_state: 'needs_review',
  });
  assert.deepEqual(document, original);
});

test('new pins on a saved floor use its current canonical ID and exact revision in the review batch', () => {
  const result = floorPlanReviewedRows({
    buildingId: buildingPlaceId, buildingElementId: building.id, floorId,
    elementIds: ['new-room', 'new-light'], imageBounds: { x: 0, y: 0, width: 100, height: 100 },
  }, [{
    proposal_id: 'new_room', action: 'create', element_ids: ['new-room'],
    name: 'Annex', code: 'ANNEX', kind: 'classroom',
  }], [
    { id: buildingPlaceId, name: building.label, code: 'LEARN', kind: 'building', revision: 6, campus_id: campusId, parent_space_id: null },
    { id: floorId, name: 'Ground floor', code: 'LEARN_GF', kind: 'floor', revision: 4, campus_id: campusId, parent_space_id: buildingPlaceId },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0], {
    proposal_id: 'floor_plan_target', action: 'reuse', space_id: floorId,
    expected_space_revision: 4, element_ids: [], floor_element_ids: ['new-room', 'new-light'],
  });
  assert.equal(result.rows[1]?.action === 'create' && result.rows[1].parent_proposal_id, 'floor_plan_target');
});
