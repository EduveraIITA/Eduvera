import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { resourceLoanReturn, resourceLoanItem } from '../../backend/src/resource-loans/resource-loans.contracts';
import { lendingCopyIds } from '../../backend/src/institution-setup/lending-item.contracts';
import { acceptedResourceItemBatch, confirmedResourceSetupChange, currentResourceReturns, resourceHoldingBody, resourceItemBody, resourceItemCopyIds, resourceReceivableParts, resourceReturnBody, resourceTypeBody } from '../src/lib/resources-policy';
import type { ResourceLoanDetail } from '../../packages/contracts/src/wire/features/resources/resourceApi';
import type { CampusResourceHolding, CampusResourceType } from '../../packages/contracts/src/institution';
import type { RecordedCommand } from '../src/lib/recorded-command';
const id = '00000000-0000-4000-8000-000000000001', partId = '00000000-0000-4000-8000-000000000002', campusId = '00000000-0000-4000-8000-000000000003', receiptId = '00000000-0000-4000-8000-000000000004', laterId = '00000000-0000-4000-8000-000000000005';
const loan = { id, revision: 3, can_record_return: true, issued_at: '2026-10-27T08:00:00Z', parts: [{ id: partId, label: 'Kit', quantity: 3, returned_quantity: 2, outstanding_quantity: 1, condition: 'usable' }], history: [{ id: receiptId, action: 'return_recorded', observed_at: '2026-10-27T09:00:00Z', supersedes_receipt_id: null, parts: [{ part_id: partId, quantity: 2, condition: 'usable' }] }] } as ResourceLoanDetail;
const now = '2026-10-27T10:00:00Z';
test('exact replacement can undo a prior return while a missed return must receive something', () => {
  assert.equal(resourceReceivableParts(loan, receiptId)[0]!.receivable_quantity, 3);
  const empty = resourceReturnBody(loan, { correction: true, supersedes: receiptId, observedAt: '2026-10-27T09:00:00Z', reason: 'Recorded against the wrong receipt', received: {} }, now);
  assert.equal(empty.expected_revision, 3); assert.deepEqual(empty.parts, []);
  assert.equal(resourceLoanReturn.safeParse({ ...empty, command_id: id }).success, true);
  assert.throws(() => resourceReturnBody(loan, { correction: true, supersedes: '', observedAt: now, reason: 'Missed return', received: {} }, now));
});
test('receipt replacement never targets superseded, foreign, or non-return history', () => {
  const next = { ...loan, history: [{ ...loan.history[0]!, id: laterId, action: 'return_corrected', supersedes_receipt_id: receiptId }, ...loan.history] };
  assert.deepEqual(currentResourceReturns(next).map(row => row.id), [laterId]);
  assert.throws(() => resourceReceivableParts(next, receiptId));
  assert.throws(() => resourceReceivableParts(loan, laterId));
  assert.throws(() => resourceReceivableParts({ ...loan, history: [{ ...loan.history[0]!, action: 'due_changed' }] }, receiptId));
});
test('return quantities, capability and selected clock stay bound to the exact loan', () => {
  const input = { correction: false, supersedes: '', observedAt: now, reason: '', received: { [partId]: { quantity: '1', condition: 'held' as const } } };
  const body = resourceReturnBody(loan, input, now);
  assert.equal(resourceLoanReturn.safeParse({ ...body, command_id: id }).success, true);
  for (const quantity of ['0', '-1', '1.5', '1e0', '2', '']) assert.throws(() => resourceReturnBody(loan, { ...input, received: { [partId]: { quantity, condition: 'usable' } } }, now));
  assert.throws(() => resourceReturnBody(loan, { ...input, received: { [laterId]: { quantity: '1', condition: 'usable' } } }, now));
  assert.throws(() => resourceReturnBody({ ...loan, can_record_return: false }, input, now));
  for (const observedAt of ['invalid', '2026-10-27T07:59:00Z', '2026-10-27T10:01:00Z']) assert.throws(() => resourceReturnBody(loan, { ...input, observedAt }, now));
});
test('batch creation matches the ordinary strict API without inventing a source revision', () => {
  const body = resourceItemBody('  Camera  ', '10', 'CAM', campusId);
  assert.equal(resourceLoanItem.safeParse({ ...body, command_id: id }).success, true);
  assert.equal('expected_revision' in body, false);
  for (const quantity of ['0', '101', '-1', '1.2', '1e1', '']) assert.throws(() => resourceItemBody('Camera', quantity, '', campusId));
  assert.throws(() => resourceItemBody('Camera', '2', 'a'.repeat(77), campusId));
  assert.equal(resourceItemBody('Camera', '1', 'a'.repeat(80), campusId).asset_tag?.length, 80);
  assert.throws(() => resourceItemBody('Camera', '1', '', 'foreign'));
});
const digest = async (input: string) => createHash('sha256').update(input).digest('hex');
test('native copy identities match the topology owner for all supported batch sizes', async () => {
  for (const quantity of [1, 2, 10, 100]) assert.deepEqual(await resourceItemCopyIds(id, quantity, digest), lendingCopyIds(id, quantity));
  assert.notDeepEqual(await resourceItemCopyIds(id, 2, digest), await resourceItemCopyIds(laterId, 2, digest));
  for (const quantity of [0, 101, 1.5, NaN]) await assert.rejects(resourceItemCopyIds(id, quantity, digest));
  await assert.rejects(resourceItemCopyIds(id, 2, async () => 'invalid'));
});
test('a batch response must prove every deterministic independent copy for this exact command', async () => {
  const root = `/api/v1/schools/${campusId}/resources`, body = resourceItemBody('Camera', '2', 'CAM', campusId);
  const command = { domain: 'resources', kind: 'item', root, path: `${root}/items`, key: id, sourceId: id, body: JSON.stringify({ ...body, command_id: id }) } as RecordedCommand;
  const secondId = lendingCopyIds(id, 2)[1]!;
  const copy = (copyId: string, tag: string) => ({ id: copyId, campus_id: campusId, campus_name: 'Main campus', name: 'Camera', tracking_mode: 'individual', revision: 1, asset_tag: tag, state: 'available', available: true, unavailable_reason: null, active_loan_id: null });
  const response = { id, quantity: 2, created_items: [copy(id, 'CAM-001'), copy(secondId, 'CAM-002')] };
  assert.equal(await acceptedResourceItemBatch(command, response, digest), true);
  for (const result of [{ id, revision: 1 }, { ...response, quantity: 1 }, { ...response, created_items: response.created_items.slice(0, 1) }, { ...response, created_items: [response.created_items[0], response.created_items[0]] }, { ...response, created_items: [response.created_items[1], response.created_items[0]] }, { ...response, created_items: [copy(id, 'CAM-001'), copy(laterId, 'CAM-002')] }, { ...response, created_items: [copy(id, 'CAM-001'), { ...copy(secondId, 'CAM-002'), campus_id: 'foreign' }] }, { ...response, created_items: [copy(id, 'CAM-001'), { ...copy(secondId, 'CAM-002'), tracking_mode: 'unknown' }] }, { ...response, created_items: [copy(id, 'CAM-001'), { ...copy(secondId, 'CAM-002'), revision: 0 }] }]) assert.equal(await acceptedResourceItemBatch(command, result, digest), false);
  const advanced = { ...response, created_items: [
    { ...copy(id, 'RETAGGED'), name: 'Renamed accepted camera', campus_id: receiptId, campus_name: 'Annex', revision: 4, state: 'retired', available: false, unavailable_reason: 'Resource is retired.' },
    { ...copy(secondId, 'CAM-002'), tracking_mode: 'pooled', asset_tag: null, revision: 5, available: false, unavailable_reason: 'Pooled quantities are not exact copies; lending is unavailable in this version.' },
  ] };
  assert.equal(await acceptedResourceItemBatch(command, advanced, digest), true, 'a lost reply can recover after legitimate inventory edits');
  assert.equal(await acceptedResourceItemBatch({ ...command, sourceId: laterId }, response, digest), false);
  assert.equal(await acceptedResourceItemBatch(command, response, async () => { throw new Error('Native digest unavailable'); }), false);
});
test('topology edits keep exact source revision and immutable selected location/type references', () => {
  const current = { id, revision: 7, campus_id: campusId, space_id: null, resource_type_id: laterId, tracking_mode: 'individual' } as CampusResourceHolding;
  const body = resourceHoldingBody(current, { name: 'Camera copy', asset_tag: 'CAM-001', quantity: '1', state: 'unavailable', notes: 'Needs checking' });
  assert.equal(body.expected_revision, 7); assert.equal(body.campus_id, campusId); assert.equal(body.resource_type_id, laterId); assert.equal(body.space_id, null);
  const type = resourceTypeBody({ code: ' cameras ', name: 'Cameras', category: 'other', tracking_mode: 'individual', unit_label: 'copies', is_active: true }, { id, revision: 8 } as CampusResourceType);
  assert.equal(type.expected_revision, 8); assert.equal(type.code, 'CAMERAS');
  assert.throws(() => resourceTypeBody({ ...type, code: 'bad code' }));
  assert.throws(() => confirmedResourceSetupChange({ id, school_id: campusId, revision: 2 }, receiptId, id));
  assert.throws(() => confirmedResourceSetupChange({ id, school_id: campusId, revision: 2 }, campusId, laterId));
  assert.equal(confirmedResourceSetupChange({ id, school_id: campusId, revision: 2 }, campusId, id).id, id);
});
