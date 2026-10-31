import assert from 'node:assert/strict';
import test from 'node:test';
import { updateCommandAllowed, updateObservedAt, updateReceiptMatches, updateRecipientNeedsFollowUp, updateRecipientScore, type UpdateCommand } from '../src/features/UpdatesPolicy';
import type { NoticeRecipient } from '../../packages/contracts/src/wire/features/notices/api';
const notice = '11111111-1111-4111-8111-111111111111', recipient = '22222222-2222-4222-8222-222222222222', key = '33333333-3333-4333-8333-333333333333', attempt = '44444444-4444-4444-8444-444444444444';
const command = (kind: UpdateCommand['kind'], body: Record<string, unknown> = {}): UpdateCommand => ({ kind, method: 'POST', path: `/api/v1/notices/${notice}/${kind === 'delivery' ? 'deliveries' : kind === 'assisted' ? 'assisted-responses' : kind}`, body: { idempotency_key: key, expected_revision: 7, ...body } });
test('cancellation binds the notice, revision and terminal cancellation receipt', () => {
  const action = command('cancel');
  assert.equal(updateCommandAllowed(action, notice, 'campus'), true);
  assert.equal(updateCommandAllowed(action, recipient, 'campus'), false);
  assert.equal(updateReceiptMatches(action, { id: notice, revision: 8, status: 'cancelled' }), true);
  assert.equal(updateReceiptMatches(action, { id: notice, revision: 7, status: 'cancelled' }), false);
  assert.equal(updateReceiptMatches(action, { id: notice, revision: 8, status: 'published' }), false);
});
test('delivery requires the exact recipient, attempt receipt and recorded status', () => {
  const action = command('delivery', { recipient_id: recipient, status: 'delivered' });
  assert.equal(updateCommandAllowed(action, notice, 'campus'), true);
  assert.equal(updateReceiptMatches(action, { id: notice, recipient_id: recipient, delivery_attempt_id: attempt, status: 'delivered' }), true);
  for (const bad of [{ recipient_id: notice }, { delivery_attempt_id: undefined }, { status: 'queued' }, { id: recipient }]) assert.equal(updateReceiptMatches(action, { id: notice, recipient_id: recipient, delivery_attempt_id: attempt, status: 'delivered', ...bad }), false);
});
test('assisted responses require an advancing exact recipient revision and exact choice', () => {
  const action = command('assisted', { recipient_id: recipient, response_value: 'Attend' });
  assert.equal(updateCommandAllowed(action, notice, 'campus'), true);
  const receipt = { id: notice, recipient_id: recipient, recipient_revision: 8, response_value: 'Attend' };
  assert.equal(updateReceiptMatches(action, receipt), true);
  assert.equal(updateReceiptMatches(action, { ...receipt, recipient_revision: 7 }), false);
  assert.equal(updateReceiptMatches(action, { ...receipt, response_value: 'Decline' }), false);
  assert.equal(updateReceiptMatches(action, { ...receipt, recipient_id: notice }), false);
  assert.equal(updateReceiptMatches(command('assisted', { recipient_id: recipient }), { ...receipt, response_value: 'acknowledged' }), true);
});
test('retained authoring rejects another campus, endpoint or missing command key', () => {
  const create: UpdateCommand = { kind: 'create', method: 'POST', path: '/api/v1/notices', body: { school_id: notice, idempotency_key: key } };
  assert.equal(updateCommandAllowed(create, undefined, notice), true);
  assert.equal(updateCommandAllowed(create, undefined, recipient), false);
  assert.equal(updateCommandAllowed({ ...create, path: '/api/v1/notices/other' }, undefined, notice), false);
  assert.equal(updateCommandAllowed({ ...create, body: { school_id: notice } }, undefined, notice), false);
});
test('contact evidence uses the selected campus clock and cannot predate publication', () => {
  const source = { published_at: '2026-10-29T08:00:00Z' }, now = Date.parse('2026-10-29T09:00:00Z');
  assert.equal(updateObservedAt('2026-10-29T08:30:00Z', source, now), '2026-10-29T08:30:00.000Z');
  for (const value of ['2026-10-29T07:59:59Z', '2026-10-29T09:00:01Z', 'invalid']) assert.throws(() => updateObservedAt(value, source, now));
  assert.throws(() => updateObservedAt('2026-10-29T08:30:00Z', source, NaN));
});
test('follow-up retains failed deliveries even after a response, and prioritizes overdue responses', () => {
  const responseNotice = { response_mode: 'acknowledgement' as const, due_at: '2026-10-29T08:00:00Z' }, now = Date.parse('2026-10-29T09:00:00Z');
  const person = { responded_at: null, opened_at: null, deliveries: [] } as unknown as NoticeRecipient;
  assert.equal(updateRecipientNeedsFollowUp(responseNotice, person), true);
  assert.equal(updateRecipientScore(responseNotice, person, now), 1);
  assert.equal(updateRecipientNeedsFollowUp({ response_mode: 'information' }, person), false);
  const failed = { ...person, responded_at: '2026-10-29T08:00:00Z', deliveries: [{ status: 'failed' }] } as NoticeRecipient;
  assert.equal(updateRecipientNeedsFollowUp(responseNotice, failed), true);
  assert.equal(updateRecipientScore(responseNotice, failed, now), 0);
});
