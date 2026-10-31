import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { matchesNativeFeeConfirmation, nativeFeeFailureDisposition, nativeFeeReviewObsolete, validateNativeFeeAction, type NativeFeeAction } from '../src/lib/fee-action-policy';

const key = '77baef64-0b48-4790-82c2-7c8f47621f1f';
const invoiceId = 'cdad9877-df86-46d0-80aa-3e8c91980204';
const reviewId = 'a54f0a7c-2148-4ffc-8309-6d6b58645f20';
const schoolId = 'campus-a', root = `/api/v1/schools/${schoolId}/fees`;
const command: NativeFeeAction = {
  version: 1, scopeKey: 'actor:alice|campus:a|simulation:world-a', schoolId, key, invoiceId, reviewId, action: 'report',
  path: `${root}/invoices/${invoiceId}/payment-reviews/`,
  confirmationPath: `${root}/payment-reviews/workspace/?invoice_id=${invoiceId}&command_id=${key}&student_id=child-a`,
  body: JSON.stringify({ command_id: key, review_id: reviewId, expected_revision: 7, kind: 'payment', amount_paise: 25000 }), phase: 'unknown',
};
const absentProof = { handler: 'finance.payment_review', confirmation: 'permanently_inapplicable', receipt_state: 'absent', reason: 'stream_advanced', invoice_id: invoiceId, review_id: reviewId, command_id: key, expected_revision: 7, current_revision: 8 };
const obsoleteError = (proof: Record<string, unknown> = absentProof) => new ApiError('Changed', 409, { error: { code: 'native_fee_review_obsolete', fields: { native_fee_review_obsolete: proof } } });

test('a definite first validation refusal releases the unsent outcome, but never erases earlier uncertainty', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(nativeFeeFailureDisposition(new ApiError('Refused', status), command, false), 'refused');
    assert.equal(nativeFeeFailureDisposition(new ApiError('Refused after retry', status), command, true), 'unknown');
  }
  for (const cause of [new Error('Network interrupted'), new ApiError('Conflict without proof', 409), new ApiError('Server failed', 500), new ApiError('Malformed success', 200)]) {
    assert.equal(nativeFeeFailureDisposition(cause, command, false), 'unknown');
    assert.equal(nativeFeeFailureDisposition(cause, command, true), 'unknown');
  }
});

test('only exact absent-receipt proof can release an obsolete financial command after an uncertain POST', () => {
  assert.equal(nativeFeeReviewObsolete(obsoleteError(), command), true);
  assert.equal(nativeFeeFailureDisposition(obsoleteError(), command, true), 'obsolete');
  for (const change of [{ handler: 'other' }, { invoice_id: 'other' }, { review_id: 'other' }, { command_id: 'other' }, { expected_revision: 6 }, { current_revision: 7 }, { receipt_state: 'pending' }, { receipt_state: 'accepted' }, { confirmation: 'not_found' }, { reason: 'unknown' }]) {
    const cause = obsoleteError({ ...absentProof, ...change });
    assert.equal(nativeFeeReviewObsolete(cause, command), false);
    assert.equal(nativeFeeFailureDisposition(cause, command, true), 'unknown');
  }
  assert.equal(nativeFeeReviewObsolete(obsoleteError({ ...absentProof, reason: 'ledger_basis_diverged', current_revision: 7 }), command), true);
  assert.equal(nativeFeeReviewObsolete(obsoleteError({ ...absentProof, reason: 'already_decided', current_revision: 7 }), command), true);
  assert.equal(nativeFeeReviewObsolete(obsoleteError({ ...absentProof, current_revision: 7.5 }), command), false);
});

test('proved acceptance survives refresh and secure-storage errors', () => {
  for (const cause of [new Error('Secure storage unavailable'), new ApiError('Refresh denied', 403), obsoleteError()]) {
    assert.equal(nativeFeeFailureDisposition(cause, command, false, true), 'accepted');
    assert.equal(nativeFeeFailureDisposition(cause, { ...command, phase: 'accepted' }, true), 'accepted');
  }
});

test('retained owner receipts require exact invoice, command, review and action', () => {
  const receipt = { handler: 'finance.payment_review', invoice_id: invoiceId, command_id: key, source_id: reviewId, action: 'report', state: 'accepted', result: { id: reviewId, invoice_id: invoiceId } };
  assert.equal(matchesNativeFeeConfirmation(receipt, command), true);
  assert.equal(matchesNativeFeeConfirmation({ ...receipt, state: 'pending', result: undefined }, command), true);
  assert.equal(matchesNativeFeeConfirmation({ ...receipt, state: 'not_accepted', result: undefined }, command), true);
  for (const change of [{ handler: 'finance.other' }, { invoice_id: 'other' }, { command_id: 'other' }, { source_id: 'other' }, { action: 'decide' }, { result: { id: reviewId, invoice_id: 'other' } }, { state: 'unknown' }]) {
    assert.equal(matchesNativeFeeConfirmation({ ...receipt, ...change }, command), false);
  }
  // No retained receipt exists for not_found; source/action are intentionally null.
  assert.equal(matchesNativeFeeConfirmation({ ...receipt, state: 'not_found', source_id: null, action: null, result: undefined }, command), true);
  assert.equal(matchesNativeFeeConfirmation({ ...receipt, state: 'not_found', command_id: 'other' }, command), false);
});

test('securely restored fee commands remain bound to exact actor, campus, world, source and owning paths', () => {
  assert.equal(validateNativeFeeAction(command, command.scopeKey, schoolId), true);
  for (const scope of ['actor:bob|campus:a|simulation:world-a', 'actor:alice|campus:b|simulation:world-a', 'actor:alice|campus:a|simulation:world-b', 'actor:alice|campus:a|live']) assert.equal(validateNativeFeeAction(command, scope, schoolId), false);
  assert.equal(validateNativeFeeAction(command, command.scopeKey, 'campus-b'), false);
  for (const change of [
    { path: `${root}/payment-reviews/${reviewId}/decision/` }, { path: `https://outside.invalid${command.path}` },
    { confirmationPath: `${command.confirmationPath}&command_id=other` }, { confirmationPath: `${command.confirmationPath}&person_id=another` },
    { confirmationPath: `${command.confirmationPath}&other=value` },
    { body: JSON.stringify({ command_id: key, review_id: 'other', expected_revision: 7 }) },
    { body: JSON.stringify({ command_id: 'other', review_id: reviewId, expected_revision: 7 }) },
    { body: JSON.stringify({ command_id: key, review_id: reviewId, expected_revision: -1 }) }, { body: '{' },
  ]) assert.equal(validateNativeFeeAction({ ...command, ...change }, command.scopeKey, schoolId), false);
  assert.equal(validateNativeFeeAction({ ...command, action: 'withdraw', path: `${root}/payment-reviews/${reviewId}/withdraw/`, body: JSON.stringify({ command_id: key, expected_revision: 7 }) }, command.scopeKey, schoolId), true);
});

test('access-recovery withdrawal uses only its exact private recovery confirmation without reopening an invoice', () => {
  const recovery: NativeFeeAction = { ...command, action: 'withdraw', path: `${root}/payment-reviews/${reviewId}/withdraw/`, confirmationPath: `${root}/payment-reviews/${reviewId}/recovery/?command_id=${key}`, body: JSON.stringify({ command_id: key, expected_revision: 7 }) };
  assert.equal(validateNativeFeeAction(recovery, command.scopeKey, schoolId), true);
  for (const change of [{ action: 'decide' }, { confirmationPath: `${root}/payment-reviews/${invoiceId}/recovery/?command_id=${key}` }, { confirmationPath: `${recovery.confirmationPath}&invoice_id=${invoiceId}` }, { confirmationPath: `${recovery.confirmationPath}&student_id=child-a` }]) {
    assert.equal(validateNativeFeeAction({ ...recovery, ...change }, command.scopeKey, schoolId), false);
  }
});
