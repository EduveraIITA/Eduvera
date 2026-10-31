import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusResourceHolding, InstitutionSetup } from '../../packages/contracts/src/institution';
import type { ResourceLoanDetail } from '../../packages/contracts/src/wire/features/resources/resourceApi';
import { resourceLoanCustody } from '../../backend/src/resource-loans/resource-loans.contracts';
import { parseResourceCustodians, resourceAcceptedRefresh, resourceCustodyBody, resourceLocationBody } from '../src/lib/resource-operations';
import { RecordedCommandJournal, recordedConfirmationPath, type RecordedCommand } from '../src/lib/recorded-command';
const school = '11111111-1111-4111-8111-111111111111', campus = '22222222-2222-4222-8222-222222222222', annex = '33333333-3333-4333-8333-333333333333', loanId = '44444444-4444-4444-8444-444444444444', currentId = '55555555-5555-4555-8555-555555555555', next = '66666666-6666-4666-8666-666666666666', commandId = '77777777-7777-4777-8777-777777777777', typeId = '88888888-8888-4888-8888-888888888888', spaceId = '99999999-9999-4999-8999-999999999999';
const root = `/api/v1/schools/${school}/resources`, scopeKey = 'actor-a|campus-a|simulation-run-a';
const loan = { id: loanId, revision: 8, custodian: { id: currentId, label: 'Original custodian' }, can_change_custodian: true, custody_recovery: false } as ResourceLoanDetail;
const choices = { people: [{ id: next, label: 'Eligible successor' }], recovery: false, pagination: { page: 1, page_size: 10, total: 1 } };
test('custodian choices reject malformed identity, duplicate rows, wrong page and inferred orphan recovery', () => {
  assert.deepEqual(parseResourceCustodians(choices, 1), choices);
  for (const value of [{ ...choices, recovery: 'true' }, { ...choices, people: [...choices.people, ...choices.people] }, { ...choices, people: [{ id: 'foreign/path', label: 'Name' }] }, { ...choices, pagination: { ...choices.pagination, total: Infinity } }, { ...choices, pagination: { ...choices.pagination, page_size: 25 } }]) assert.throws(() => parseResourceCustodians(value, 1));
  assert.throws(() => parseResourceCustodians(choices, 2));
});
test('handover and orphan recovery keep current revision, exact eligible successor and human reason', () => {
  const options = parseResourceCustodians(choices, 1), input = { selectedId: next, reason: '  Library desk handover  ', revision: 8 };
  const body = resourceCustodyBody(loan, options, input); assert.equal(resourceLoanCustody.safeParse({ ...body, command_id: commandId }).success, true); assert.equal(body.reason, 'Library desk handover');
  for (const changed of [{ ...loan, can_change_custodian: false }, { ...loan, custody_recovery: true }, { ...loan, revision: 9 }]) assert.throws(() => resourceCustodyBody(changed, options, input));
  assert.throws(() => resourceCustodyBody(loan, options, { ...input, selectedId: currentId })); assert.throws(() => resourceCustodyBody(loan, options, { ...input, reason: 'x' }));
  assert.equal(resourceCustodyBody({ ...loan, custody_recovery: true }, { ...options, recovery: true }, input).custodian_person_id, next);
});
test('accepted responsibility recovery reads the queue rather than requiring former private detail', async () => {
  const command: RecordedCommand = { version: 1, scopeKey, domain: 'resources', root, key: commandId, sourceId: loanId, method: 'POST', path: `${root}/loans/${loanId}/responsibility`, confirmationPath: recordedConfirmationPath('resources', root, loanId, commandId), body: JSON.stringify({ command_id: commandId, expected_revision: 8, custodian_person_id: next, reason: 'Library desk handover' }), phase: 'unknown' };
  let raw: string | null = JSON.stringify(command), sends = 0, refreshes = 0;
  const journal = new RecordedCommandJournal({ scopeKey, domain: 'resources', root, read: async () => raw, persist: async value => { raw = JSON.stringify(value); }, remove: async () => { raw = null; }, createId: async () => commandId, captureContext: () => ({ assertCurrent() {} }), send: async () => { sends++; throw new Error('Do not replay an accepted handover.'); }, confirm: async () => ({ state: 'accepted', result: { id: loanId, revision: 9 } }) });
  await journal.hydrate(); const accepted = async (value: RecordedCommand) => { const read = resourceAcceptedRefresh(value); assert.equal(read.transferred, true); assert.equal(read.path, `${root}/workspace?view=loans&state=all&search=&page=1`); refreshes++; if (refreshes === 1) throw new Error('Queue unavailable after accepted handover'); };
  await journal.check({ assertActive() {}, accepted, refreshObsolete: async () => {} }); assert.equal(journal.snapshot().pending?.phase, 'accepted');
  await journal.check({ assertActive() {}, accepted, refreshObsolete: async () => {} }); assert.equal(sends, 0); assert.equal(refreshes, 2); assert.equal(raw, null);
  assert.equal(resourceAcceptedRefresh({ ...command, path: command.path + '/other' }).transferred, false);
});
const holding = { id: loanId, school_id: school, revision: 4, campus_id: campus, space_id: null, resource_type_id: typeId, tracking_mode: 'individual' } as CampusResourceHolding;
const catalogue = { school: { id: school }, holdings: [holding], campuses: [{ id: campus, school_id: school, name: 'Main', status: 'active' }, { id: annex, school_id: school, name: 'Annex', status: 'active' }], resource_types: [{ id: typeId, school_id: school, name: 'Camera', is_active: true, tracking_mode: 'individual' }], spaces: [{ id: spaceId, school_id: school, campus_id: annex, name: 'Media room', status: 'active' }] } as InstitutionSetup;
const values = { name: 'Camera', asset_tag: 'CAM-1', quantity: '1', state: 'available', notes: 'Moved after review', campusId: annex, spaceId, typeId };
test('item location/type edits validate current same-campus topology without manufacturing a location', () => {
  const body = resourceLocationBody(holding, values, catalogue); assert.equal(body.campus_id, annex); assert.equal(body.space_id, spaceId); assert.equal(body.resource_type_id, typeId); assert.equal(body.expected_revision, 4);
  assert.equal(resourceLocationBody(holding, { ...values, spaceId: '' }, catalogue).space_id, null);
  assert.throws(() => resourceLocationBody(holding, { ...values, campusId: campus }, catalogue));
  assert.throws(() => resourceLocationBody(holding, { ...values, typeId: next }, catalogue));
  assert.throws(() => resourceLocationBody({ ...holding, revision: 3 }, values, catalogue));
  assert.throws(() => resourceLocationBody(holding, values, { ...catalogue, school: { ...catalogue.school, id: annex } }));
});
test('topology selection preserves individual-copy and pooled-quantity distinctions', () => {
  assert.throws(() => resourceLocationBody(holding, { ...values, asset_tag: '' }, catalogue));
  const pooled = { ...catalogue, resource_types: [{ ...catalogue.resource_types[0]!, tracking_mode: 'pooled' as const }] };
  assert.throws(() => resourceLocationBody(holding, { ...values, quantity: '10' }, pooled));
  assert.equal(resourceLocationBody(holding, { ...values, quantity: '10', asset_tag: '' }, pooled).quantity, 10);
  assert.equal(resourceLocationBody(holding, { ...values, quantity: '10' }, catalogue).quantity, 1);
});
