import assert from 'node:assert/strict';
import test from 'node:test';
import * as floor from '../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import * as rooms from '../../packages/contracts/src/campus-scenes/sceneRoomTemplates';
import * as places from '../../packages/contracts/src/campus-scenes/scenePlaceProposals';


import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from '../../packages/contracts/src/campus-scenes/types';
import type { CampusSpace } from '../../packages/contracts/src/institution';

const building: CampusSceneElement = { id: 'building', kind: 'building', label: 'Main building', space_id: 'canonical-building', floor_id: null, review_state: 'reviewed', geometry: { type: 'polygon', points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 70 }, { x: 10, y: 70 }] } };
const room: CampusSceneElement = { id: 'room', kind: 'room', label: 'Learning room', floor_id: 'canonical-floor', space_id: null, geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }] }, review_state: 'needs_review' };
const scene = (...elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: 'Campus', source: { kind: 'manual', label: 'Reviewed layout' }, bounds: { width: 100, height: 100, unit: 'metres' }, elements });
const canonical: CampusSpace = { id: 'canonical-building', school_id: 'school', campus_id: 'campus', parent_space_id: null, name: 'Main building', code: 'MAIN', kind: 'building', status: 'active', revision: 7, capacity: null, is_accessible: false, is_bookable: false };


test('neutral floor merging preserves source geometry and explicit local parent identities', () => {
  const original = scene(building), proposal = { ...scene(room, { ...room, id: 'opening', kind: 'fixture' as const, asset_key: 'door' as const, geometry: { type: 'point' as const, points: [{ x: 5, y: 5 }] }, parent_element_id: room.id, width: 1 }), bounds: { width: 12, height: 10, unit: 'relative' as const } };
  let index = 0; const result = floor.mergeFloorPlanProposal(original, proposal, building, 'canonical-floor', () => `new-${++index}`);
  assert.equal(original.elements.length, 1); assert.deepEqual(result.document.elements[0], building); assert.deepEqual(result.document.source, original.source); assert.deepEqual(result.elementIds, ['new-1', 'new-2']);
  assert.equal(result.document.elements[1].parent_element_id, building.id); assert.equal(result.document.elements[2].parent_element_id, 'new-1'); assert.equal(result.document.elements[1].space_id, null); assert.equal(result.document.elements[1].floor_id, 'canonical-floor');
  const context: floor.SceneFloorPlanContext = { buildingId: canonical.id, buildingElementId: building.id, floorId: null, newFloor: { name: 'Teaching floor', code: '' }, elementIds: result.elementIds, imageBounds: result.imageBounds };
  const adjusted = floor.adjustFloorPlan(result.document, context, { rotationDeg: 90, scale: .8 });
  assert.deepEqual(adjusted.document.elements[0], building); assert.equal(adjusted.context.imageRotationDeg, 90); assert.equal(adjusted.document.elements[2].rotation_deg, 90);
  assert.throws(() => floor.adjustFloorPlan(result.document, context, { dx: -999 }), /within the campus drawing/);
});
test('neutral floor review retains canonical parent and floor revisions before atomic room creation', () => {
  const context: floor.SceneFloorPlanContext = { buildingId: canonical.id, buildingElementId: building.id, floorId: null, newFloor: { name: 'Teaching floor', code: 'MAIN_F1' }, elementIds: ['new-room'], imageBounds: { x: 10, y: 10, width: 12, height: 10 } };
  const spaces: CampusSceneSpace[] = [canonical, { id: 'canonical-floor', campus_id: 'campus', parent_space_id: canonical.id, kind: 'floor', name: 'First floor', code: 'F1', revision: 4 }];
  const created = floor.floorPlanReviewedRows(context, [{ proposal_id: 'room', action: 'create', name: 'New room', code: 'ROOM_1', kind: 'classroom', element_ids: ['new-room'] }], spaces);
  assert.deepEqual(created.errors, []); assert.equal(created.rows[0].action, 'create'); if (created.rows[0].action === 'create') assert.equal(created.rows[0].expected_parent_revision, 7);
  assert.equal(created.rows[1].action, 'create'); if (created.rows[1].action === 'create') assert.equal(created.rows[1].parent_proposal_id, 'floor_plan_target');
  const reused = floor.floorPlanReviewedRows({ ...context, floorId: 'canonical-floor' }, [], spaces); assert.equal(reused.rows[0].action, 'reuse'); if (reused.rows[0].action === 'reuse') assert.equal(reused.rows[0].expected_space_revision, 4);
});
test('all neutral furniture arrangements remain editable illustrations without invented canonical resources', () => {
  const original = scene(room);
  for (const template of rooms.ROOM_FURNISHING_TEMPLATES) {
    let index = 0; const result = rooms.furnishSceneRoom(original, room, template.key, () => `${template.key}-${++index}`);
    assert.ok(result.elements.length > 3); assert.equal(new Set(result.elements.map(element => element.id)).size, result.elements.length);
    for (const element of result.elements) { assert.equal(element.kind, 'fixture'); assert.equal(element.space_id, null); assert.equal(element.floor_id, room.floor_id); assert.equal(element.parent_element_id, room.id); assert.equal(element.holding_id, undefined); assert.equal(element.navigation, undefined); assert.equal(element.navigation_connector, undefined); assert.equal(element.review_state, 'needs_review'); }
  }
  assert.deepEqual(original.elements, [room]); assert.deepEqual(rooms.furnishSceneRoom(original, { ...room, floor_id: null }, 'office').elements, []);
});
test('neutral proposals group exact provenance, retain explicit reuse revisions and keep drawing review separate', () => {
  const original = scene({ ...building, id: 'part-a', space_id: null, source_feature_id: 'shared-source' }, { ...building, id: 'part-b', space_id: null, source_feature_id: 'shared-source' }, { ...building, id: 'separate', space_id: null });
  const proposed = places.createScenePlaceProposals(original, [canonical]); assert.deepEqual(proposed.map(item => item.elementIds), [['part-a', 'part-b'], ['separate']]);
  proposed[0] = { ...proposed[0], action: 'reuse', spaceId: canonical.id }; proposed[1] = { ...proposed[1], action: 'visual' };
  const reviewed = places.reviewedScenePlaceRows(original, proposed, [canonical]); assert.deepEqual(reviewed.errors, []); assert.deepEqual(reviewed.rows, [{ proposal_id: proposed[0].id, element_ids: ['part-a', 'part-b'], action: 'reuse', space_id: canonical.id, expected_space_revision: 7 }]); assert.equal('name' in reviewed.rows[0], false);
  const split = places.splitScenePlaceProposal(places.createScenePlaceProposals(original, []), 'place_1', []); split[0].name = 'Explicit reviewed label';
  const submitted = places.reviewedScenePlaceDocument(original, split, new Set(['part-a', 'part-b'])); assert.equal(submitted.elements[0].label, 'Explicit reviewed label'); assert.equal(submitted.elements[0].source_feature_id, undefined); assert.equal(original.elements[0].source_feature_id, 'shared-source'); assert.equal(original.elements[0].space_id, null);
});
