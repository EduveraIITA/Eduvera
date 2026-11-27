import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assistantCampusNameAnswer, assistantCampusNameMessages, assistantPublicWebSourceMessages, assistantPublicWebSourceSelected,
  assistantActionRecordMessages, assistantActionRecordSelected, assistantDecisionMessages,
  assistantDecisionSelected, assistantReportMessages, assistantReportSourceSelected,
} from '../src/lib/assistant-a2ui';
import { ASSISTANT_A2UI_CATALOG, campusA2uiAction, campusA2uiChildren, readCampusA2uiSurfaces, type CampusA2uiSurfaceState } from '../src/lib/campus-a2ui';

function dispatch(surface: CampusA2uiSurfaceState, id: string) {
  return campusA2uiAction(surface.id, surface.components.get(id)!, surface.model, undefined, surface.catalogId)!;
}

test('expanded and compact Assistant reports compose the same owned source and native chart', () => {
  const messages = assistantReportMessages('attendance-evidence', { chart: true, source: true });
  assert.equal(readCampusA2uiSurfaces(messages), undefined);
  const [full] = readCampusA2uiSurfaces(messages, ASSISTANT_A2UI_CATALOG)!;
  const [compact] = readCampusA2uiSurfaces(assistantReportMessages('attendance-evidence', { chart: true, source: false }), ASSISTANT_A2UI_CATALOG)!;
  assert.deepEqual(campusA2uiChildren(full.components.get('root')!), ['chart', 'source']);
  assert.deepEqual(campusA2uiChildren(compact.components.get('root')!), ['chart']);
  const source = dispatch(full, 'source');
  assert.deepEqual(source.action.context, { sourceId: 'attendance-evidence' });
  assert.equal(assistantReportSourceSelected(source, 'attendance-evidence'), true);
  assert.equal(assistantReportSourceSelected(source, 'another-source'), false);
  assert.equal(assistantReportSourceSelected({ ...source, action: { ...source.action, sourceComponentId: 'chart' } }, 'attendance-evidence'), false);
  assert.equal(campusA2uiAction(full.id, full.components.get('source')!, full.model), undefined);
});

test('Assistant review passes only the current unlocked action to the native decision owner', () => {
  const [surface] = readCampusA2uiSurfaces(assistantDecisionMessages('first-action', 'Confirm report', false), ASSISTANT_A2UI_CATALOG)!;
  const confirm = dispatch(surface, 'confirm');
  const dismiss = dispatch(surface, 'dismiss');
  assert.deepEqual(confirm.action.context, { actionId: 'first-action' });
  assert.equal(assistantDecisionSelected(confirm, 'first-action', false, false), 'confirm');
  assert.equal(assistantDecisionSelected(dismiss, 'first-action', false, true), 'reject');
  assert.equal(assistantDecisionSelected(confirm, 'first-action', false, true), undefined);
  assert.equal(assistantDecisionSelected(confirm, 'first-action', true, false), undefined);
  assert.equal(assistantDecisionSelected(confirm, 'another-action', false, false), undefined);
  assert.equal(assistantDecisionSelected({ ...confirm, action: { ...confirm.action, surfaceId: 'another-surface' } }, 'first-action', false, false), undefined);

  const [record] = readCampusA2uiSurfaces(assistantActionRecordMessages('first-action', 'Open affected screen'), ASSISTANT_A2UI_CATALOG)!;
  const open = dispatch(record, 'root');
  assert.equal(assistantActionRecordSelected(open, 'first-action'), true);
  assert.equal(assistantDecisionSelected(open, 'first-action', false, false), undefined);
  assert.equal(assistantActionRecordSelected(confirm, 'first-action'), false);
});

test('the campus name field returns a valid value only for its current owning request', () => {
  const detailId = 'active-call';
  const [surface] = readCampusA2uiSurfaces(assistantCampusNameMessages(detailId), ASSISTANT_A2UI_CATALOG)!;
  const action = dispatch(surface, 'accept');
  assert.equal(assistantCampusNameAnswer(action, detailId), undefined);
  const answer = { ...action, action: { ...action.action, context: { detailId, name: ' North Campus ' } } };
  assert.equal(assistantCampusNameAnswer(answer, detailId), 'North Campus');
  assert.equal(assistantCampusNameAnswer(answer, 'expired-call'), undefined);
});

test('web citation controls open only their exact verified public source', () => {
  const source = { id: '861291df-e176-47e8-8595-e48161a8e61f', title: 'Floor plans',
    url: 'https://www.lucknow.lulumall.in/floor-plans/', description: 'Ground, first and second floors.' };
  const [full] = readCampusA2uiSurfaces(assistantPublicWebSourceMessages(source), ASSISTANT_A2UI_CATALOG)!;
  assert.deepEqual(campusA2uiChildren(full.components.get('root')!), ['open', 'description']);
  const action = dispatch(full, 'open');
  assert.deepEqual(action.action.context, { sourceId: source.id });
  assert.equal(assistantPublicWebSourceSelected(action, source), source.url);
  assert.equal(assistantPublicWebSourceSelected(action, { ...source, url: 'https://example.com/?token=private' }), undefined);
  assert.equal(assistantPublicWebSourceSelected(action, { ...source, url: 'https://127.0.0.1/' }), undefined);
});
