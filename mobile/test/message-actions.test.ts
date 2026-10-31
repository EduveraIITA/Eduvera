import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeChatCanEdit, nativeChatCanReport, nativeChatMessageCommand, nativeChatMessageActionReadPath, nativeChatModerationCommand, nativeChatReportMatches, nativeChatReportFingerprint, nativeChatModerationReadPath, type NativeChatReport } from '../src/lib/message-actions';
const actor = '11111111-1111-4111-8111-111111111111', conversation = '22222222-2222-4222-8222-222222222222', messageId = '33333333-3333-4333-8333-333333333333', reporter = '44444444-4444-4444-8444-444444444444', sender = '55555555-5555-4555-8555-555555555555';
const message = { id: messageId, conversation_id: conversation, body: 'A message', is_mine: true, is_deleted: false, message_type: 'text', editable_until: '2026-10-27T10:02:00Z', created_at: '2026-10-27T10:00:00Z', is_reported_by_me: false }, now = Date.parse('2026-10-27T10:01:00Z');
const report = { id: messageId, message_id: messageId, conversation_id: conversation, status: 'open', sender_id: sender, reported_by: reporter, assigned_to: null, can_assign: true, updated_at: '2026-10-27T10:01:00Z', action_taken: 'none', resolution_note: '' } as NativeChatReport;
const reviewers = [{ id: actor, name: 'Current reviewer', role: 'admin' }, { id: reporter, name: 'Reporter', role: 'staff' }];
test('own-message edit window uses the supplied campus clock and excludes deleted, system, foreign and expired records', () => {
  assert.equal(nativeChatCanEdit(message, now), true);
  for (const patch of [{ is_mine: false }, { is_deleted: true }, { message_type: 'system' }, { body: '' }, { editable_until: 'invalid' }]) assert.equal(nativeChatCanEdit({ ...message, ...patch }, now), false);
  assert.equal(nativeChatCanEdit(message, Date.parse(message.editable_until)), false);
  assert.equal(nativeChatCanEdit(message, Date.parse(message.created_at) - 1), false);
  assert.throws(() => nativeChatMessageCommand('edit', message, actor, 'Changed', now));
  assert.deepEqual(nativeChatMessageCommand('edit', message, conversation, ' Changed ', now).body, { body: 'Changed' });
});
test('private message reporting refuses own or already-reported records and never adds an unsupported idempotency field', () => {
  const other = { ...message, is_mine: false };
  assert.equal(nativeChatCanReport(other), true); assert.equal(nativeChatCanReport(message), false); assert.equal(nativeChatCanReport({ ...other, is_reported_by_me: true }), false);
  const command = nativeChatMessageCommand('report', other, conversation, 'Safety concern', now);
  assert.equal(command.replayPolicy, 'inspect_only'); assert.deepEqual(command.body, { reason: 'Safety concern' }); assert.equal(command.method, 'POST');
});
test('known edit/report responses must identify the exact owner and retain its thread read', () => {
  const action = { endpoint: `/api/v1/chat/conversations/${conversation}/messages/${messageId}/`, refreshPath: `/api/v1/chat/conversations/${conversation}/messages/?cursor=opaque` };
  assert.equal(nativeChatMessageActionReadPath({ id: messageId, edited: true, updated_at: message.created_at }, action), action.refreshPath);
  assert.throws(() => nativeChatMessageActionReadPath({ id: actor, edited: true, updated_at: message.created_at }, action));
  assert.throws(() => nativeChatMessageActionReadPath({ id: messageId, edited: false }, action));
  assert.equal(nativeChatMessageActionReadPath({ id: reporter, status: 'open' }, { ...action, endpoint: `${action.endpoint}report/` }), action.refreshPath);
  assert.throws(() => nativeChatMessageActionReadPath({ id: reporter, status: 'resolved' }, { ...action, endpoint: `${action.endpoint}report/` }));
});
test('moderation requires exact report visibility, current assignment, an independent reviewer and explicit bounded restriction', () => {
  assert.equal(nativeChatReportMatches(report, messageId), true); assert.equal(nativeChatReportMatches(report, actor), false);
  assert.notEqual(nativeChatReportFingerprint(report), nativeChatReportFingerprint({ ...report, status: 'under_review' }));
  const command = nativeChatModerationCommand(report, actor, 'restrict', 'Reviewed with campus team', actor, 7, reviewers);
  assert.deepEqual(command.body, { note: 'Reviewed with campus team', assigned_to: actor, action: 'restrict', restriction_days: 7 }); assert.equal(command.replayPolicy, 'inspect_only'); assert.equal('expected_revision' in command.body, false);
  assert.throws(() => nativeChatModerationCommand(report, actor, 'restrict', 'Reviewed', actor, 31, reviewers));
  assert.throws(() => nativeChatModerationCommand({ ...report, status: 'resolved' }, actor, 'warning', 'Reviewed', actor, 7, reviewers));
  assert.throws(() => nativeChatModerationCommand({ ...report, can_assign: false, assigned_to: reporter }, actor, 'warning', 'Reviewed', actor, 7, reviewers));
  assert.throws(() => nativeChatModerationCommand(report, actor, 'warning', 'Reviewed', reporter, 7, reviewers));
});
test('conflicted administrators can only hand a report to an independent projected reviewer', () => {
  const conflict = { ...report, sender_id: actor }, independent = [{ id: sender, name: 'Independent reviewer', role: 'staff' }];
  assert.throws(() => nativeChatModerationCommand(conflict, actor, 'resolve', 'Reviewed', sender, 7, independent));
  const command = nativeChatModerationCommand(conflict, actor, 'assign', '', sender, 7, independent); assert.deepEqual(command.body, { note: '', assigned_to: sender, status: 'under_review', action: 'none' });
});

test('known moderation responses must match exact status, reviewer, note and retained owner read', () => {
  const action = { endpoint: `/api/v1/chat/reports/${messageId}/`, refreshPath: `/api/v1/chat/reports/${messageId}/`, payload: { kind: 'json', body: JSON.stringify({ assigned_to: actor, action: 'restrict', restriction_days: 7, note: 'Verified concern' }) } };
  const reply = { id: messageId, status: 'resolved', assigned_to: actor, action_taken: 'restrict', resolution_note: 'Verified concern', updated_at: '2026-10-27T10:05:00Z' };
  assert.equal(nativeChatModerationReadPath(reply, action), action.refreshPath);
  for (const patch of [{ id: reporter }, { status: 'under_review' }, { assigned_to: sender }, { action_taken: 'warning' }, { resolution_note: 'Different note' }]) assert.throws(() => nativeChatModerationReadPath({ ...reply, ...patch }, action));
  assert.throws(() => nativeChatModerationReadPath(reply, { ...action, refreshPath: `/api/v1/chat/reports/${actor}/` }));
});
