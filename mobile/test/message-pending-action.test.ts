import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeChatCreatedReadPath, nativeChatCreatedHref } from '../src/lib/message-composer';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';
const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'simulation', namespaceId: 'world-a', origin: 'https://campus.example' };
const clientId = '11111111-1111-4111-8111-111111111111';
const ownerHref = '/areas/messages/conversations?conversation=thread&student_id=learner';
const endpoint = '/api/v1/chat/conversations/thread/messages/';
const context = { ownerHref, refreshPath: endpoint, assertActive() {} };
const file = { uri: 'file:///app/private/photo.png', name: 'photo.png', type: 'image/png', size: 10 * 1024 * 1024, hash: 'a'.repeat(64) };
function memory() { let raw: string | null = null; const storage: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } }; return { storage, get raw() { return raw; } }; }
function journal(storage: NativePendingStorage, send: (action: NativePendingAction) => Promise<unknown>) { return new NativePendingActionJournal({ scope, domain: 'messages', storage, randomId: () => clientId, send, read: async () => ({ results: [] }) }); }

test('Chat text replay after relaunch retains exact body, learner context and client_id', async () => {
  const store = memory(), sent: NativePendingAction[] = [];
  const first = journal(store.storage, async action => { sent.push(action); throw new Error('Lost response'); }); await first.hydrate();
  assert.equal(await first.run({ endpoint, body: { body: 'Original message' }, serverKey: 'client_id' }, context), false);
  const saved = JSON.parse(store.raw!) as NativePendingAction; assert.equal(saved.phase, 'unknown'); assert.equal(saved.ownerHref, ownerHref); assert.deepEqual(saved.payload, { kind: 'json', body: JSON.stringify({ body: 'Original message', client_id: clientId }) });
  const next = journal(store.storage, async action => { sent.push(action); return { id: 'saved' }; }); await next.hydrate(); assert.equal(await next.recover(context), true);
  assert.deepEqual(sent[1], JSON.parse(JSON.stringify(sent[0]))); assert.equal(store.raw, null);
});
test('Chat file journal uses client_id, immutable URI+hash and 10 MiB Chat-specific boundary', async () => {
  const store = memory(); const original = journal(store.storage, async () => { throw new Error('Response lost'); }); await original.hydrate(); await original.run({ endpoint, multipart: { fields: { body: 'An image' }, file } }, context);
  const action = JSON.parse(store.raw!) as NativePendingAction; assert.equal(validateNativePendingAction(action, scope, 'messages'), true); assert.deepEqual(action.payload, { kind: 'multipart', fields: { body: 'An image', client_id: clientId }, file });
  assert.equal(validateNativePendingAction(action, { ...scope, namespaceId: 'other-world' }, 'messages'), false);
  assert.equal(validateNativePendingAction(action, { ...scope, origin: 'https://other.example' }, 'messages'), false);
  assert.equal(validateNativePendingAction({ ...action, endpoint: '/api/v1/learning/assignments/other/' }, scope, 'messages'), false);
  assert.equal(validateNativePendingAction({ ...action, payload: { kind: 'multipart', fields: { body: '', command_id: clientId }, file } }, scope, 'messages'), false);
  assert.equal(validateNativePendingAction({ ...action, payload: { kind: 'multipart', fields: { body: '', client_id: clientId }, file: { ...file, size: file.size + 1 } } }, scope, 'messages'), false);
  assert.equal(validateNativePendingAction({ ...action, payload: { kind: 'json', body: JSON.stringify({ body: 'Changed key', client_id: 'other' }) } }, scope, 'messages'), false);
});
test('group creation with lost response remains inspect-only and never silently creates another group', async () => {
  const store = memory(); let sends = 0;
  const create = journal(store.storage, async () => { sends++; throw new Error('Lost response'); }); await create.hydrate();
  await create.run({ endpoint: '/api/v1/chat/groups/', body: { school_id: 'campus', title: 'Group', group_type: 'activity', member_ids: ['person'] }, replayPolicy: 'inspect_only' }, { ...context, refreshPath: '/api/v1/chat/conversations/?student_id=learner' });
  const next = journal(store.storage, async () => { sends++; return {}; }); await next.hydrate(); assert.equal(await next.recover(context), false); assert.equal(sends, 1); assert.equal(next.snapshot().action?.phase, 'unknown'); assert.ok(store.raw);
});

test('created conversation recovery opens its exact saved detail beyond the directory page without repeating creation', async () => {
  const schoolId = '22222222-2222-4222-8222-222222222222', returnedId = '33333333-3333-4333-8333-333333333333', studentId = '44444444-4444-4444-8444-444444444444';
  const creationScope = { ...scope, schoolId }, creationOwner = `/areas/messages/conversations?compose=direct&student_id=${studentId}`, store = memory();
  let sends = 0, reads = 0, opened = '';
  const make = (failRead: boolean) => new NativePendingActionJournal({ scope: creationScope, domain: 'messages', storage: store.storage, randomId: () => clientId,
    send: async () => { sends++; return { id: returnedId, created: false }; }, read: async action => { reads++; assert.equal(action.refreshPath, `/api/v1/chat/conversations/${returnedId}/?student_id=${studentId}`); if (failRead) throw new Error('Detail refresh disconnected'); return { id: returnedId, school_id: schoolId, context_student_id: studentId }; } });
  const completion = { ownerHref: creationOwner, refreshPath: '/api/v1/chat/conversations/?pagination=cursor', assertActive() {}, resolveRefreshPath: nativeChatCreatedReadPath,
    accepted(value: unknown, _assertActive: () => void, action: NativePendingAction) { opened = nativeChatCreatedHref(creationOwner, value, action); } };
  const first = make(true); await first.hydrate(); assert.equal(await first.run({ endpoint: '/api/v1/chat/conversations/', body: { school_id: schoolId, recipient_id: returnedId, student_id: studentId }, replayPolicy: 'inspect_only' }, completion), false);
  assert.equal(JSON.parse(store.raw!).phase, 'accepted'); assert.equal(JSON.parse(store.raw!).refreshPath, `/api/v1/chat/conversations/${returnedId}/?student_id=${studentId}`); assert.equal(opened, '');
  const recovered = make(false); await recovered.hydrate(); assert.equal(await recovered.recover(completion), true); assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(new URLSearchParams(opened.split('?')[1]).get('conversation'), returnedId); assert.equal(store.raw, null);
});

test('legacy message edits, private reports and moderation never repeat a lost-response write during recovery', async () => {
  const cases = [
    { endpoint: '/api/v1/chat/conversations/thread/messages/message/', method: 'PATCH' as const, body: { body: 'Corrected message' } },
    { endpoint: '/api/v1/chat/conversations/thread/messages/message/report/', method: 'POST' as const, body: { reason: 'Safety concern' } },
    { endpoint: '/api/v1/chat/reports/report/', method: 'PATCH' as const, body: { action: 'restrict', restriction_days: 7, note: 'Reviewed with campus team' } },
  ];
  for (const command of cases) {
    const store = memory(); let sends = 0, reads = 0;
    const make = () => new NativePendingActionJournal({ scope, domain: 'messages', storage: store.storage, randomId: () => clientId, send: async () => { sends++; throw new Error('Lost response'); }, read: async () => { reads++; return {}; } });
    const first = make(); await first.hydrate(); await first.run({ ...command, replayPolicy: 'inspect_only' }, context);
    const raw = JSON.parse(store.raw!); assert.equal(raw.method, command.method); assert.deepEqual(JSON.parse(raw.payload.body), command.body);
    const resumed = make(); await resumed.hydrate(); await resumed.recover(context); await resumed.recover(context);
    assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(resumed.snapshot().action?.phase, 'unknown'); assert.ok(store.raw);
  }
});
