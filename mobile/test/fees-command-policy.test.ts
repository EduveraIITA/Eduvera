import test from 'node:test';
import assert from 'node:assert/strict';
import { feesAmount, feesAudienceMatches, feesChargeQuoteMatches, feesConfirmation, feesIntentValid, feesPath, feesReadPath, feesResultMatches, type FeesIntent } from '../src/features/FeesCommandPolicy';
const id = (end: number) => `10000000-0000-4000-8000-${String(end).padStart(12, '0')}`, school = id(1), person = id(2), source = id(3), invoice = id(4), command = id(5), payment = id(6), scope = 'origin:actor:campus:simulation-world', hash = 'a'.repeat(64);
const preview = { snapshot_hash: hash, today: '2026-10-29', person_count: 1, duplicate_count: 0, groups: [], people: [{ person_id: person, name: 'Selected person', revision: 2 }] };
const batch: FeesIntent = { version: 1, scope, schoolId: school, sourceId: source, kind: 'batch', body: { command_id: command, batch_id: source, selection: { person_ids: [person], groups: [] }, snapshot_hash: hash, reference: 'CAMPUS', description: 'Workshop', amount_paise: 10000, due_on: '2026-11-01' }, proof: preview };
const batchResult = { id: source, batch_id: source, reference: 'CAMPUS', description: 'Workshop', amount_paise: 10000, due_on: '2026-11-01', person_count: 1, total_amount_paise: 10000, revision: 1, replayed: false, invoices: [{ person_id: person, invoice_id: invoice, reference: 'CAMPUS/001', name: 'Selected person' }] };
test('batch confirmation binds actor scope, exact audience, per-person amount and ordered invoice manifest', () => {
  assert.equal(feesIntentValid(batch, scope, school), true);
  assert.equal(feesIntentValid(batch, 'different-world', school), false);
  assert.equal(feesResultMatches(batch, batchResult), true);
  for (const patch of [{ total_amount_paise: 9999 }, { amount_paise: 9000 }, { due_on: '2026-11-02' }, { invoices: [{ ...batchResult.invoices[0], person_id: id(8) }] }]) assert.equal(feesResultMatches(batch, { ...batchResult, ...patch }), false);
  assert.equal(feesAudienceMatches({ ...preview, people: [{ ...preview.people[0], person_id: id(8) }] }, batch.body.selection as never), false);
});
test('financial owner receipt rejects another source, handler, command and mismatched accepted result', () => {
  const receipt = { handler: 'finance.charge_batch', source_id: source, command_id: command, action: 'issue', state: 'accepted', result: batchResult };
  assert.equal(feesConfirmation(batch, receipt)?.state, 'accepted');
  for (const patch of [{ source_id: invoice }, { handler: 'finance.charge' }, { command_id: id(9) }, { action: 'apply' }, { result: { ...batchResult, person_count: 2 } }]) assert.equal(feesConfirmation(batch, { ...receipt, ...patch }), null);
  assert.equal(feesConfirmation(batch, { ...receipt, state: 'not_found', result: undefined })?.state, 'not_found');
  assert.equal(feesReadPath(batch), `/api/v1/schools/${school}/fees/charge-batches/${source}/confirmation/?command_id=${command}`);
});
test('correction quote preserves before/after amounts and exact selected original charges', () => {
  const before = { amount_paise: 10000, paid_paise: 2000, balance_paise: 8000, credit_paise: 0, due_on: '2026-11-01', description: 'Workshop', charge_state: 'active' as const }, after = { ...before, amount_paise: 8000, balance_paise: 6000 }, quote = { snapshot_hash: hash, today: preview.today, person_count: 1, items: [{ invoice_id: invoice, person_id: person, student_id: null, name: 'Selected person', reference: 'CAMPUS/001', revision: 0, before, after }], before_total_amount_paise: 10000, after_total_amount_paise: 8000, before_balance_paise: 8000, after_balance_paise: 6000, credit_paise: 0 };
  assert.equal(feesChargeQuoteMatches(quote, [invoice], { kind: 'amend', amount_paise: 8000 }), true);
  assert.equal(feesChargeQuoteMatches({ ...quote, after_total_amount_paise: 9000 }, [invoice], { kind: 'amend', amount_paise: 8000 }), false);
  assert.equal(feesChargeQuoteMatches(quote, [id(10)], { kind: 'amend', amount_paise: 8000 }), false);
  const intent: FeesIntent = { ...batch, kind: 'chargeCorrection', body: { command_id: command, correction_id: source, selection: { invoice_ids: [invoice] }, change: { kind: 'amend', amount_paise: 8000 }, snapshot_hash: hash, reason: 'Recorded amount error', attested_recording_error: true }, proof: quote };
  assert.equal(feesIntentValid(intent, scope, school), true);
  assert.equal(feesResultMatches(intent, { id: source, correction_id: source, revision: 1, replayed: false, invoice_ids: [invoice] }), true);
  assert.equal(feesResultMatches(intent, { id: source, correction_id: source, revision: 1, replayed: false, invoice_ids: [invoice, invoice] }), false);
});
test('manual receipt recovery retains the exact idempotent owner request and payment evidence', () => {
  const intent: FeesIntent = { ...batch, kind: 'manualPayment', sourceId: invoice, invoiceId: invoice, proof: undefined, body: { idempotency_key: command, method: 'bank_transfer', amount_paise: 4000, reference: 'Actual bank UTR' } }, result = { id: payment, invoice_id: invoice, method: 'bank_transfer', amount_paise: 4000, reference: 'Actual bank UTR' };
  assert.equal(feesIntentValid(intent, scope, school), true);
  assert.equal(feesPath(intent), `/api/v1/schools/${school}/fees/invoices/${invoice}/payments/`);
  assert.equal(feesResultMatches(intent, result), true);
  assert.equal(feesResultMatches(intent, { ...result, amount_paise: 4001 }), false);
  assert.equal(feesResultMatches(intent, { ...result, invoice_id: source }), false);
});
test('payment plan outcome binds exact invoice, request, decision and stream revision', () => {
  const intent: FeesIntent = { ...batch, kind: 'decision', invoiceId: invoice, personId: person, body: { command_id: command, expected_revision: 4, decision: 'approved', response: '' }, proof: undefined }, result = { id: payment, invoice_id: invoice, request_id: source, revision: 5, decision: 'approved', replayed: false };
  assert.equal(feesIntentValid(intent, scope, school), true);
  assert.equal(feesResultMatches(intent, result), true);
  assert.equal(feesResultMatches(intent, { ...result, request_id: id(9) }), false);
  assert.equal(feesResultMatches(intent, { ...result, revision: 6 }), false);
  assert.equal(feesResultMatches(intent, { ...result, decision: 'rejected' }), false);
  assert.equal(feesConfirmation(intent, { school_id: school, invoices: [{ id: invoice }], confirmation: { state: 'accepted', result } })?.state, 'accepted');
  assert.equal(feesConfirmation(intent, { school_id: school, invoices: [{ id: id(9) }], confirmation: { state: 'accepted', result } }), null);
});
test('authority adoption recovery requires an exact campus receipt and usable source snapshot', () => {
  const intent: FeesIntent = { ...batch, kind: 'authority', body: { command_id: command, mandate_id: source, expected: { mandate_revision: 2, office_revision: 3, appointment_revision: 1, rule_revision: 0, source_revisions: [{ id: invoice, revision: 1 }] }, attestation: true }, proof: undefined };
  assert.equal(feesIntentValid(intent, scope, school), true);
  assert.equal(feesConfirmation(intent, { school_id: school, confirmation: { state: 'accepted', adoption_id: person, rule_id: invoice, revision: 1 } })?.state, 'accepted');
  assert.equal(feesConfirmation(intent, { school_id: id(9), confirmation: { state: 'accepted', adoption_id: person, rule_id: invoice, revision: 1 } }), null);
  assert.equal(feesConfirmation(intent, { school_id: school, confirmation: { state: 'accepted', adoption_id: person } }), null);
});
test('amounts use exact minor units and reject unsafe or over-limit values', () => { assert.equal(feesAmount('12.05'), 1205); for (const value of ['1.001', '0', '-1', '1e3', '1000000.01']) assert.throws(() => feesAmount(value)); });
test('retained guardian queue decisions prove their outcome and verified payment receipt', () => {
  const intent: FeesIntent = { ...batch, kind: 'guardianDecision', invoiceId: invoice, proof: undefined, body: { outcome: 'verified', response: 'Matched independently to bank receipt', verified_funds: true } };
  assert.equal(feesIntentValid(intent, scope, school), true);
  assert.equal(feesResultMatches(intent, { outcome: 'verified', payment_id: payment }), true);
  assert.equal(feesResultMatches(intent, { outcome: 'rejected', payment_id: payment }), false);
  assert.equal(feesResultMatches(intent, { outcome: 'verified', payment_id: null }), false);
  assert.equal(feesIntentValid({ ...intent, body: { ...intent.body, verified_funds: false } }, scope, school), false);
});
