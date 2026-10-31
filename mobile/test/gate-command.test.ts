import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { clearGateCommandRecord, describeGateCommand, nativeGateAcceptedResult, nativeGateConfirmationDisposition, nativeGateFailureDisposition, nativeGateObsolete, validateNativeGateCommand } from '../src/lib/gate-command';

const scopeKey = 'actor:gatekeeper|campus:a|simulation:world-a', schoolId = 'campus-a';
const root = `/api/v1/gate/schools/${schoolId}`;
const key = 'a72526eb-1428-45ec-86c2-7baf0bfdb024', visit = '7098597b-84b0-4665-a91e-17375936fe68';
const shareId = '07e0c620-48e5-4bb6-aaae-d2c4b09b1a33', shareRootId = 'fa0fb0c0-317d-414d-8d61-059d655b053e', questionId = '300739ff-2580-4d91-b69e-31b25e4883d3';
const command = describeGateCommand({ path: `${root}/visit-arrangements/${visit}/movements/`, body: JSON.stringify({ command_id: key, expected_revision: 7, direction: 'in', observed_count: 2 }), label: 'Observed arrival' }, scopeKey, schoolId, key)!;
const shared = describeGateCommand({ path: `${root}/visit-arrangements/${visit}/shared/questions/${questionId}/replies/`, body: JSON.stringify({ command_id: key, expected_revision: 3, note: 'Please use the north entrance.' }), label: 'Visit reply', sharing: { shareId, shareRootId, questionId } }, scopeKey, schoolId, key)!;

test('restored gate journal binds actor/campus/world and derives exact owning confirmation route', () => {
  assert.equal(validateNativeGateCommand(command, scopeKey, schoolId), true);
  assert.equal(command.confirmationPath, `${root}/visit-arrangements/${visit}/commands/${key}/`);
  assert.equal(shared.confirmationPath, `${root}/visit-arrangements/${visit}/shared/commands/${key}/`);
  assert.equal(validateNativeGateCommand(command, 'actor:other|campus:a|simulation:world-a', schoolId), false);
  assert.equal(validateNativeGateCommand(command, 'actor:gatekeeper|campus:a|live', schoolId), false);
  assert.equal(validateNativeGateCommand(command, scopeKey, 'campus-b'), false);
  for (const change of [{ sourceId: questionId }, { key: questionId }, { expectedRevision: 6 }, { kind: 'visitor' }, { confirmationPath: `${root}/visit-arrangements/${questionId}/commands/${key}/` }, { path: `https://outside.invalid${command.path}` }]) assert.equal(validateNativeGateCommand({ ...command, ...change }, scopeKey, schoolId), false);
});

test('any HTTP refusal during recovery retains a previously unknown Gate POST', () => {
  for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500]) assert.equal(nativeGateFailureDisposition(command, new ApiError('Recovery refused', status), true), 'unknown');
  assert.equal(nativeGateFailureDisposition(command, new Error('Network interrupted'), true), 'unknown');
  assert.equal(nativeGateFailureDisposition(command, new ApiError('First validation refusal', 422), false), 'refused');
  for (const status of [408, 409, 429, 500]) assert.equal(nativeGateFailureDisposition(command, new ApiError('Uncertain', status), false), 'unknown');
});

test('only exact owning absent obsolete proof allows source review after uncertainty', () => {
  const proof = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', reason: 'stream_advanced', visit_id: visit, command_id: key, expected_revision: 7, current_revision: 8 };
  const error = (change = {}) => new ApiError('Changed', 409, { error: { code: 'visit_changed', fields: { visit_changed: { ...proof, ...change } } } });
  assert.equal(nativeGateObsolete(command, error()), true);
  assert.equal(nativeGateFailureDisposition(command, error(), true), 'obsolete');
  for (const change of [{ visit_id: questionId }, { command_id: questionId }, { expected_revision: 6 }, { current_revision: 7 }, { current_revision: 8.5 }, { receipt_state: 'pending' }, { receipt_state: 'accepted' }, { reason: 'other' }]) {
    assert.equal(nativeGateObsolete(command, error(change)), false);
    assert.equal(nativeGateFailureDisposition(command, error(change), true), 'unknown');
  }
  assert.equal(nativeGateObsolete(shared, error()), false);
});

test('visit accepted receipts must identify the exact original visit and an advanced owner revision', () => {
  assert.equal(nativeGateAcceptedResult(command, { visit: { id: visit, revision: 8 } }, true), true);
  assert.equal(nativeGateAcceptedResult(command, { visit: { id: questionId, revision: 8 } }, true), false);
  assert.equal(nativeGateAcceptedResult(command, { visit: { id: visit, revision: 7 } }, true), false);
  assert.equal(nativeGateAcceptedResult(command, { state: 'accepted' }, true), false);
});

test('query failures, pending, naked refusals and foreign accepted receipts retain the journal; not_found allows only identical retry', () => {
  for (const value of [new ApiError('Lost access during confirmation', 403), new ApiError('Unprocessable confirmation', 422), { state: 'pending' }, { state: 'not_accepted' }, { state: 'accepted' }, { state: 'accepted', result: { visit: { id: questionId, revision: 8 } } }]) {
    assert.equal(nativeGateConfirmationDisposition(command, value), 'retain');
  }
  assert.equal(nativeGateConfirmationDisposition(command, { state: 'not_found' }), 'retry-identical');
  assert.equal(nativeGateConfirmationDisposition(command, { state: 'accepted', result: { visit: { id: visit, revision: 8 } } }), 'accepted');
});

test('sharing receipt proves exact visit, share/root, question, action and accepted revision', () => {
  const receipt = { visit_id: visit, share_id: shareId, share_root_id: shareRootId, question_id: questionId, action: 'replied', revision: 4 };
  assert.equal(nativeGateAcceptedResult(shared, receipt, true), true);
  for (const change of [{ visit_id: questionId }, { share_id: key }, { share_root_id: key }, { question_id: key }, { action: 'asked' }, { revision: 3 }, { revision: 5 }]) assert.equal(nativeGateAcceptedResult(shared, { ...receipt, ...change }, true), false);
  const direct = { visit: { id: visit }, share: { id: shareId, root_id: shareRootId }, question: { id: questionId, revision: 4 } };
  assert.equal(nativeGateAcceptedResult(shared, direct), true);
  assert.equal(nativeGateAcceptedResult(shared, { ...direct, question: { id: key, revision: 4 } }), false);
});

test('legacy visitor operations require exact returned visitor/state/revision and cannot invent a receipt endpoint', () => {
  const visitor = describeGateCommand({ path: `${root}/visitors/${visit}/in/`, body: JSON.stringify({ expected_revision: 5 }), label: 'Observed visitor entry' }, scopeKey, schoolId, key)!;
  assert.equal(visitor.confirmationPath, null);
  assert.equal(nativeGateAcceptedResult(visitor, { saved: true, visitor: { id: visit, state: 'inside', revision: 6 } }), true);
  assert.equal(nativeGateAcceptedResult(visitor, { saved: true, visitor: { id: questionId, state: 'inside', revision: 6 } }), false);
  assert.equal(nativeGateAcceptedResult(visitor, { saved: true, visitor: { id: visit, state: 'approved', revision: 6 } }), false);
  assert.equal(nativeGateAcceptedResult(visitor, { state: 'accepted' }, true), false);
  assert.equal(nativeGateFailureDisposition(visitor, new ApiError('Current visitor changed', 409), true), 'unknown');
});

test('keyed learner/staff movements retain exact identity verification and accepted outcome across refresh failure', () => {
  const movement = describeGateCommand({ path: `${root}/movements/`, body: JSON.stringify({ student_id: visit, command_id: key, direction: 'out', identity_verified: true, qr: 'private-pass' }), label: 'Observed learner exit' }, scopeKey, schoolId, key)!;
  assert.equal(movement.key, key); assert.equal(movement.sourceId, visit); assert.equal(movement.confirmationPath, null);
  assert.equal(nativeGateAcceptedResult(movement, { id: questionId, saved: true }), true);
  assert.equal(nativeGateAcceptedResult(movement, { saved: true }), false);
  assert.equal(nativeGateFailureDisposition(movement, new ApiError('Refresh denied', 403), false, true), 'accepted');
  assert.equal(describeGateCommand({ path: `${root}/movements/`, body: JSON.stringify({ student_id: visit, command_id: key, direction: 'out', identity_verified: false }), label: 'Exit' }, scopeKey, schoolId, key), null);
});

test('context loss during durable Gate cleanup cannot resurrect the completed accepted action', async () => {
  let active = true, pending: typeof command | null = { ...command, phase: 'accepted' }, stored: typeof command | null = pending, retryAllowed = true;
  let finishDelete!: () => void;
  const deletion = new Promise<void>(resolve => { finishDelete = resolve; });
  const result = clearGateCommandRecord({
    assertCurrent() { if (!active) throw new Error('Original screen lost focus'); },
    async remove() { await deletion; stored = null; },
    forget() { pending = null; retryAllowed = false; },
  });
  active = false; finishDelete();
  await assert.rejects(result, /lost focus/);
  assert.equal(stored, null); assert.equal(pending, null); assert.equal(retryAllowed, false);
});

test('Gate cleanup retains the exact action if deletion fails and performs no I/O from an already stale screen', async () => {
  let pending: typeof command | null = command, deletes = 0;
  const forget = () => { pending = null; };
  await assert.rejects(clearGateCommandRecord({ assertCurrent() {}, async remove() { deletes++; throw new Error('Storage unavailable'); }, forget }), /Storage unavailable/);
  assert.equal(pending, command); assert.equal(deletes, 1);
  await assert.rejects(clearGateCommandRecord({ assertCurrent() { throw new Error('Stale source'); }, async remove() { deletes++; }, forget }), /Stale source/);
  assert.equal(pending, command); assert.equal(deletes, 1);
});
