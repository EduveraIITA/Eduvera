import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantDefinitiveRefusal, bindAssistantConversation, clearAssistantCommand, dispatchAssistantCommand, restoreAssistantCommand, validAssistantCommand, type AssistantCommand } from '../src/lib/assistant-command';
const thread = '00000000-0000-4000-8000-000000000001', client = '00000000-0000-4000-8000-000000000002', action = '00000000-0000-4000-8000-000000000003', run = '00000000-0000-4000-8000-000000000004';
const original: AssistantCommand = { kind: 'send', threadId: '', question: 'Check my day', clientId: client };
function scenario(changeAt?: 'storage' | 'creation' | 'dispatch' | 'clear') {
  let active = true, pending: AssistantCommand | null = null; const retained: AssistantCommand[] = [], sent: AssistantCommand[] = [];
  let creates = 0, clears = 0;
  const input = {
    command: original,
    assertCurrent() { if (!active) throw new Error('Context changed'); },
    async retain(command: AssistantCommand) { retained.push({ ...command }); if (changeAt === 'storage') active = false; },
    retained(command: AssistantCommand | null) { pending = command; },
    async createThread() { creates++; if (changeAt === 'creation') active = false; return { id: thread }; },
    async dispatch(command: AssistantCommand) { sent.push({ ...command }); if (changeAt === 'dispatch') active = false; return command.kind === 'send' ? { run_id: run } : { status: 'rejected' }; },
    async clear() { clears++; if (changeAt === 'clear') active = false; },
  };
  return { input, retained, sent, pending: () => pending, counts: () => ({ creates, clears }), resume: () => { active = true; } };
}
test('account, world or source change during storage prevents thread/message requests and keeps exact intent', async () => {
  const s = scenario('storage'); await assert.rejects(dispatchAssistantCommand(s.input), /Context changed/);
  assert.deepEqual(s.counts(), { creates: 0, clears: 0 }); assert.equal(s.sent.length, 0); assert.deepEqual(s.pending(), original);
});
test('source change during keyless thread creation blocks the message and never automatically repeats creation', async () => {
  const s = scenario('creation'); await assert.rejects(dispatchAssistantCommand(s.input), /Context changed/);
  assert.deepEqual(s.counts(), { creates: 1, clears: 0 }); assert.equal(s.sent.length, 0);
  assert.deepEqual(s.pending(), { ...original, phase: 'creating' }); s.resume();
  await assert.rejects(dispatchAssistantCommand({ ...s.input, command: s.pending()! }), /creation is unconfirmed/);
  assert.equal(s.counts().creates, 1);
});
test('context loss after dispatch keeps the original bound thread/client key without clearing', async () => {
  const s = scenario('dispatch'); await assert.rejects(dispatchAssistantCommand(s.input), /Context changed/);
  assert.equal(s.counts().clears, 0); assert.deepEqual(s.pending(), { ...original, threadId: thread, phase: undefined }); assert.deepEqual(s.sent, [s.pending()]);
});
test('successful message stores accepted metadata before clear, and completed cleanup forgets it despite a late blur', async () => {
  const s = scenario(); const completed = await dispatchAssistantCommand(s.input);
  assert.deepEqual(completed, { ...original, threadId: thread, phase: 'accepted' }); assert.deepEqual(s.retained.at(-1), completed);
  assert.deepEqual(s.counts(), { creates: 1, clears: 1 }); assert.equal(s.pending(), null);
  const blurred = scenario('clear'); await assert.rejects(dispatchAssistantCommand(blurred.input), /Context changed/);
  assert.equal(blurred.pending(), null); assert.deepEqual(blurred.counts(), { creates: 1, clears: 1 });
});
test('decision recovery uses the exact thread/action/decision and never creates a thread', async () => {
  const s = scenario(); const decision: AssistantCommand = { kind: 'decision', threadId: thread, actionId: action, decision: 'reject' };
  await dispatchAssistantCommand({ ...s.input, command: decision }); assert.deepEqual(s.sent, [decision]); assert.deepEqual(s.counts(), { creates: 0, clears: 1 });
});
test('malformed send/decision receipts cannot clear retained intent', async () => {
  for (const [command, response] of [[{ ...original, threadId: thread }, { id: run }], [{ kind: 'decision', threadId: thread, actionId: action, decision: 'confirm' }, { status: 'pending' }]] as const) {
    const s = scenario(); await assert.rejects(dispatchAssistantCommand({ ...s.input, command, dispatch: async () => response }), /did not confirm/);
    assert.equal(s.counts().clears, 0); assert.equal(s.pending()?.threadId, thread);
  }
});
test('failed accepted persistence retains accepted state; recovery performs only local cleanup', async () => {
  const s = scenario();
  await assert.rejects(dispatchAssistantCommand({ ...s.input, retain: async command => { if (command.phase === 'accepted') throw new Error('Storage interrupted'); } }), /Storage interrupted/);
  assert.equal(s.pending()?.phase, 'accepted'); assert.equal(s.sent.length, 1);
  await dispatchAssistantCommand({ ...s.input, command: s.pending()! }); assert.equal(s.sent.length, 1); assert.equal(s.counts().clears, 1);
});
test('unknown creation binds only an explicitly chosen current owned conversation with unchanged question and key', () => {
  const pending: AssistantCommand = { ...original, phase: 'creating' };
  assert.deepEqual(bindAssistantConversation(pending, thread, [{ id: thread }]), { ...original, threadId: thread, phase: undefined });
  assert.throws(() => bindAssistantConversation(pending, run, [{ id: thread }]));
  assert.throws(() => bindAssistantConversation({ ...original, threadId: thread }, run, [{ id: run }]));
  assert.throws(() => bindAssistantConversation({ kind: 'decision', threadId: thread, actionId: action, decision: 'confirm' }, thread, [{ id: thread }]));
});
test('legacy empty-thread preparation is restored conservatively and malformed scope identifiers fail closed', () => {
  assert.deepEqual(restoreAssistantCommand(original), { ...original, phase: 'creating' });
  for (const value of [{ ...original, clientId: 'invalid' }, { ...original, threadId: 'https://elsewhere' }, { ...original, question: ' ' }, { ...original, question: 'a'.repeat(4001) }, { kind: 'decision', threadId: '', actionId: action, decision: 'confirm' }, { kind: 'decision', threadId: thread, actionId: action, decision: 'other' }]) assert.equal(validAssistantCommand(value), false);
});
test('409 and any refusal during recovery cannot disprove an earlier accepted request', () => {
  const progress = { dispatched: true, accepted: false, cleared: false };
  for (const status of [408, 409, 429, 500]) assert.equal(assistantDefinitiveRefusal(status, progress, false), false);
  for (const status of [400, 401, 403, 404, 410, 422]) { assert.equal(assistantDefinitiveRefusal(status, progress, true), false); assert.equal(assistantDefinitiveRefusal(status, { ...progress, accepted: true }, false), false); }
  assert.equal(assistantDefinitiveRefusal(422, progress, false), true);
});
test('failed cleanup keeps exact intent; stale preflight performs no deletion', async () => {
  const s = scenario(), pending = { ...original, threadId: thread, phase: 'accepted' } as AssistantCommand; s.input.retained(pending);
  await assert.rejects(clearAssistantCommand({ ...s.input, clear: async () => { throw new Error('Delete unavailable'); } }), /Delete unavailable/); assert.deepEqual(s.pending(), pending);
  await assert.rejects(clearAssistantCommand({ ...s.input, assertCurrent() { throw new Error('Stale form'); } }), /Stale form/); assert.equal(s.counts().clears, 0);
});
