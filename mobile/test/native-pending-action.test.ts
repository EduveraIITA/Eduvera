import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createChunkedNativePendingStorage, NativePendingActionJournal, definitiveNativeRefusal, nativePendingScopeKey, nativePendingUploadMatches, validateNativePendingAction, type NativePendingAction, type NativePendingDomain, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
let sequence = 0;
const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const ownerHref = '/areas/messages/assignments?scope=person&person_id=learner&assignment=source';
const context = { ownerHref, refreshPath: '/api/v1/learning/assignments/source/people/learner/', assertActive() {} };
function memory(initial: string | null = null) { let raw = initial; const writes: string[] = []; const storage: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; writes.push(value); }, clear: async () => { raw = null; } }; return { storage, writes, get raw() { return raw; } }; }
const input = { endpoint: '/api/v1/learning/assignments/source/people/learner/submit/', body: { expected_revision: 7, attempt_id: 'fixed-attempt' }, serverKey: 'command_id' as const };
function journal(store: NativePendingStorage, overrides: { send?: (action: NativePendingAction, assertActive: () => void) => Promise<unknown>; read?: (action: NativePendingAction) => Promise<unknown>; domain?: NativePendingDomain; obsolete?: (error: unknown, action: NativePendingAction) => boolean; captureContext?: () => Readonly<{ assertCurrent(): void }> } = {}) { return new NativePendingActionJournal({ scope, domain: overrides.domain ?? 'learning', storage: store, randomId: id, send: overrides.send ?? (async () => ({ revision: 8 })), read: overrides.read ?? (async () => ({ current: true })), obsolete: overrides.obsolete, captureContext: overrides.captureContext }); }

test('no dispatch occurs before secure preparation and unknown-phase commits', async () => {
  const store = memory(); const controller = journal(store.storage, { send: async action => { assert.equal(store.writes.length, 2); assert.equal(JSON.parse(store.writes[0]!).phase, 'prepared'); assert.equal(JSON.parse(store.raw!).phase, 'unknown'); assert.equal(action.clientId, JSON.parse(store.raw!).clientId); return {}; } });
  assert.equal(await controller.run(input, context), false);
  await controller.hydrate(); assert.equal(await controller.run(input, context), true); assert.equal(store.raw, null);
});
test('secure journal failure blocks mutation and new commands', async () => {
  let sends = 0;
  const controller = journal({ read: async () => null, write: async () => { throw new Error('Keychain unavailable'); }, clear: async () => {} }, { send: async () => { sends++; } });
  await controller.hydrate(); assert.equal(await controller.run(input, context), false); assert.equal(sends, 0); assert.equal(controller.snapshot().blocked, true); assert.equal(await controller.run(input, context), false);
});
test('relaunch hydrates exact body, attempt and client ID; replay never invents new intent', async () => {
  const store = memory(), dispatched: NativePendingAction[] = [];
  const first = journal(store.storage, { send: async action => { dispatched.push(action); throw new Error('Response lost'); } });
  await first.hydrate(); await first.run(input, context); const saved = JSON.parse(store.raw!) as NativePendingAction;
  const resumed = journal(store.storage, { send: async action => { dispatched.push(action); return {}; } }); await resumed.hydrate();
  assert.equal(await resumed.run({ ...input, body: { attempt_id: 'different' } }, context), false);
  assert.equal(await resumed.recover(context), true); assert.equal(dispatched.length, 2); assert.deepEqual(dispatched[1]?.payload, dispatched[0]?.payload); assert.equal(dispatched[1]?.clientId, saved.clientId); assert.equal(store.raw, null);
});
test('accepted command plus failed refresh resumes with reads only after relaunch', async () => {
  const store = memory(); let sends = 0, reads = 0;
  const first = journal(store.storage, { send: async () => { sends++; }, read: async () => { reads++; throw new Error('View unavailable'); } });
  await first.hydrate(); await first.run(input, context); assert.equal(JSON.parse(store.raw!).phase, 'accepted');
  const resumed = journal(store.storage, { send: async () => { sends++; }, read: async () => { reads++; return {}; } }); await resumed.hydrate(); await resumed.recover(context);
  assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(store.raw, null);
});
test('UI refresh failure after accepted source read also stays read-only', async () => {
  const store = memory(); let sends = 0;
  const controller = journal(store.storage, { send: async () => { sends++; } }); await controller.hydrate();
  await controller.run(input, { ...context, accepted: () => { throw new Error('UI refetch failed'); } }); assert.equal(JSON.parse(store.raw!).phase, 'accepted');
  await controller.recover(context); assert.equal(sends, 1); assert.equal(store.raw, null);
});
test('legacy departure unknown outcomes remain inspect-only across relaunch', async () => {
  const store = memory(); let sends = 0, reads = 0;
  const original = journal(store.storage, { domain: 'departure', send: async () => { sends++; throw new Error('Lost request response'); } });
  await original.hydrate(); await original.run({ endpoint: '/api/v1/departure/family/requests/', body: { student_id: 'learner', service_date: '2026-10-27', reason: 'Updated plan' }, replayPolicy: 'inspect_only' }, { ...context, refreshPath: '/api/v1/departure/family/?student_id=learner' });
  const resumed = journal(store.storage, { domain: 'departure', send: async () => { sends++; }, read: async () => { reads++; return { requests: [] }; } }); await resumed.hydrate();
  assert.equal(await resumed.recover(context), false); assert.equal(sends, 1); assert.equal(reads, 1); assert.ok(store.raw); assert.equal(resumed.snapshot().action?.phase, 'unknown');
});
test('only first definitive refusal or exact owning obsolete proof may release intent', async () => {
  assert.equal(definitiveNativeRefusal({ status: 400 }, false), true); assert.equal(definitiveNativeRefusal({ status: 400 }, true), false);
  for (const status of [408, 409, 429, 500]) assert.equal(definitiveNativeRefusal({ status }, false), false);
  const known = memory(); const refused = journal(known.storage, { send: async () => { throw { status: 422 }; } }); await refused.hydrate(); await refused.run(input, context); assert.equal(known.raw, null);
  const unknown = memory(); const first = journal(unknown.storage, { send: async () => { throw new Error('Lost response'); } }); await first.hydrate(); await first.run(input, context);
  const resumed = journal(unknown.storage, { send: async () => { throw { status: 400 }; } }); await resumed.hydrate(); await resumed.recover(context); assert.ok(unknown.raw);
  const proved = journal(unknown.storage, { send: async () => { throw { status: 409, exactProof: true }; }, obsolete: error => (error as { exactProof?: boolean }).exactProof === true }); await proved.hydrate(); await proved.recover(context); assert.equal(unknown.raw, null); assert.equal(proved.snapshot().obsolete, true);
});
test('only a first typed Simulation capacity refusal releases a rejected intent', () => {
  for (const resource of ['worlds','running_runs','storage','pinned_runs']) {
    const error = {status:429,details:{error:{status:429,code:'simulation_institution_capacity',resource,limit:3}}};
    assert.equal(definitiveNativeRefusal(error,false,{domain:'simulation'}),true);
    assert.equal(definitiveNativeRefusal(error,true,{domain:'simulation'}),false);
    assert.equal(definitiveNativeRefusal(error,false,{domain:'learning'}),false);
  }
  for (const details of [{error:{code:'rate_limited'}},{error:{status:429,code:'simulation_institution_capacity',resource:'other',limit:3}},{error:{status:429,code:'simulation_institution_capacity',resource:'worlds',limit:0}}]) assert.equal(definitiveNativeRefusal({status:429,details},false,{domain:'simulation'}),false);
});
test('actor, campus, world, server, endpoint and client-key drift fail closed on hydration', async () => {
  const store = memory(); const original = journal(store.storage, { send: async () => { throw new Error('Lost'); } }); await original.hydrate(); await original.run(input, context);
  const action = JSON.parse(store.raw!) as NativePendingAction;
  for (const changed of [{ ...scope, actorId: 'other' }, { ...scope, schoolId: 'other' }, { ...scope, mode: 'simulation' as const, namespaceId: 'run-a' }, { ...scope, origin: 'https://other.example' }]) { assert.notEqual(nativePendingScopeKey(changed), nativePendingScopeKey(scope)); assert.equal(validateNativePendingAction(action, changed, 'learning'), false); }
  assert.equal(validateNativePendingAction({ ...action, endpoint: '/api/v1/auth/logout/' }, scope, 'learning'), false);
  assert.equal(validateNativePendingAction({ ...action, payload: { kind: 'json', body: JSON.stringify({ command_id: id() }) } }, scope, 'learning'), false);
  const corrupt = journal(memory('{').storage); await corrupt.hydrate(); assert.equal(corrupt.snapshot().blocked, true); assert.equal(await corrupt.run(input, context), false);
});
test('a context change during secure writes prevents dispatch; another screen cannot recover it', async () => {
  const store = memory(); let active = true, sends = 0;
  const storage: NativePendingStorage = { ...store.storage, write: async value => { await store.storage.write(value); if (JSON.parse(value).phase === 'unknown') active = false; } };
  const controller = journal(storage, { send: async () => { sends++; } }); await controller.hydrate(); await controller.run(input, { ...context, assertActive: () => { if (!active) throw new Error('Scope changed'); } });
  assert.equal(sends, 0); assert.ok(store.raw); assert.equal(await controller.recover({ ...context, ownerHref: '/areas/other' }), false); assert.equal(sends, 0);
});
test('transport binding is captured before storage and retained across same-identity credential changes', async () => {
  const store = memory(); let binding = 1, captures = 0, sends = 0;
  const captureContext = () => { captures++; const captured = binding; return { assertCurrent() { if (binding !== captured) throw new Error('Transport binding changed'); } }; };
  const storage: NativePendingStorage = { ...store.storage, write: async value => { assert.equal(captures, 1); await store.storage.write(value); if (JSON.parse(value).phase === 'unknown') binding++; } };
  const controller = journal(storage, { captureContext, send: async () => { sends++; } }); await controller.hydrate();
  assert.equal(await controller.run(input, context), false); assert.equal(captures, 1); assert.equal(sends, 0); assert.equal(controller.snapshot().action?.phase, 'unknown'); assert.ok(store.raw);
  const resumed = journal(store.storage, { captureContext, send: async () => { sends++; } }); await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(captures, 2); assert.equal(sends, 1);
});
test('context drift after accepted read prevents callback and clearing without resubmitting', async () => {
  const store = memory(); let binding = 1, sends = 0, callbacks = 0;
  const controller = journal(store.storage, { captureContext: () => { const captured = binding; return { assertCurrent() { if (binding !== captured) throw new Error('Context changed during receipt read'); } }; }, send: async () => { sends++; }, read: async () => { binding++; return {}; } }); await controller.hydrate();
  assert.equal(await controller.run(input, { ...context, accepted: () => { callbacks++; } }), false); assert.equal(sends, 1); assert.equal(callbacks, 0); assert.equal(JSON.parse(store.raw!).phase, 'accepted');
  const resumed = journal(store.storage, { send: async () => { sends++; } }); await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1); assert.equal(store.raw, null);
});
test('backgrounding during final journal clear suppresses follow-up without resurrecting accepted intent', async () => {
  const store = memory(); let active = true, sends = 0, followups = 0;
  const controller = journal({ ...store.storage, clear: async () => { await store.storage.clear(); active = false; } }, { send: async () => { sends++; } });
  await controller.hydrate();
  const saved = await controller.run(input, { ...context, assertActive() { if (!active) throw new Error('Return to the original foreground screen'); } });
  if (saved) followups++;
  assert.equal(saved, false); assert.equal(sends, 1); assert.equal(followups, 0); assert.equal(store.raw, null); assert.equal(controller.snapshot().action, null);
  const resumed = journal(store.storage, { send: async () => { sends++; } }); await resumed.hydrate(); assert.equal(await resumed.recover(context), false); assert.equal(sends, 1);
});
test('multipart URI, hash, fields and stable file ID survive relaunch unchanged', async () => {
  const store = memory(), file = { uri: 'file:///private/app/documents/pending-file', name: 'response.pdf', type: 'application/pdf', size: 1024, hash: 'a'.repeat(64) }; let firstPayload: unknown;
  const first = journal(store.storage, { send: async action => { firstPayload = action.payload; throw new Error('Upload reply lost'); } }); await first.hydrate();
  await first.run({ endpoint: '/api/v1/learning/assignments/source/people/learner/files/', multipart: { fields: { expected_revision: 7, file_id: 'stable-file' }, file } }, context);
  const second = journal(store.storage, { send: async action => { assert.deepEqual(action.payload, firstPayload); return {}; } }); await second.hydrate(); await second.recover(context);
  assert.equal(nativePendingUploadMatches(file, 1024, 'a'.repeat(64)), true); assert.equal(nativePendingUploadMatches(file, 1025, 'a'.repeat(64)), false); assert.equal(nativePendingUploadMatches(file, 1024, 'b'.repeat(64)), false);
});
test('chunked Keychain commits preserve Unicode and the preceding action on partial failure', async () => {
  const items = new Map<string, string>(); let fail = false; const sizes: number[] = [];
  const storage = createChunkedNativePendingStorage({ get: async key => items.get(key) ?? null, set: async (key, value) => { if (fail && key.endsWith('.1')) throw new Error('Keychain write failed'); sizes.push(Buffer.byteLength(value)); items.set(key, value); }, remove: async key => { items.delete(key); }, randomId: id, digest: async value => createHash('sha256').update(value).digest('hex') }, 'test.pending');
  const original = 'Learner response 🙂 हिन्दी '.repeat(70); await storage.write(original); assert.equal(await storage.read(), original); assert.ok(sizes.every(size => size <= 1024));
  fail = true; await assert.rejects(storage.write('A new response 🙂'.repeat(100))); assert.equal(await storage.read(), original);
  const chunk = [...items.keys()].find(key => key.endsWith('.0'))!; items.set(chunk, 'corrupt'); await assert.rejects(storage.read(), /integrity/);
});

test('scope loss before secure preparation removes only the new private upload copy', async () => {
  const store = memory(), original = { uri: 'file:///cache/picker.pdf', name: 'response.pdf', type: 'application/pdf', size: 12, hash: 'a'.repeat(64) }, deleted: string[] = [];
  let active = true, sends = 0;
  const controller = new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: id,
    stageFile: async file => { active = false; return { ...file, uri: 'file:///documents/pending/new-copy' }; },
    discardStagedFile: async file => { deleted.push(file.uri); }, send: async () => { sends++; }, read: async () => ({}) });
  await controller.hydrate();
  await controller.run({ endpoint: '/api/v1/learning/assignments/source/people/learner/files/', multipart: { fields: { expected_revision: 7, file_id: 'stable-file' }, file: original } }, { ...context, assertActive() { if (!active) throw new Error('Account changed'); } });
  assert.deepEqual(deleted, ['file:///documents/pending/new-copy']); assert.equal(sends, 0); assert.equal(store.writes.length, 0); assert.equal(store.raw, null); assert.equal(controller.snapshot().action, null);
});

test('invalid upload preparation sends nothing and never deletes the original picker file', async () => {
  const store = memory(), original = { uri: 'file:///cache/picker.pdf', name: 'response.pdf', type: 'application/pdf', size: 12, hash: 'a'.repeat(64) }, deleted: string[] = [];
  let copies = 0, sends = 0;
  const create = (sameUri = false) => new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: id,
    stageFile: async file => { copies++; return { ...file, hash: 'invalid', uri: sameUri ? file.uri : 'file:///documents/pending/new-copy' }; },
    discardStagedFile: async file => { deleted.push(file.uri); }, send: async () => { sends++; }, read: async () => ({}) });
  const input = { endpoint: '/api/v1/learning/assignments/source/people/learner/files/', multipart: { fields: { expected_revision: 7, file_id: 'stable-file' }, file: original } };
  const first = create(); await first.hydrate(); await first.run({ ...input, multipart: { ...input.multipart, file: { ...original, size: 6 * 1024 * 1024 } } }, context); assert.equal(copies, 0);
  await first.run(input, context); assert.deepEqual(deleted, ['file:///documents/pending/new-copy']);
  const same = create(true); await same.hydrate(); await same.run(input, context); assert.deepEqual(deleted, ['file:///documents/pending/new-copy']);
  assert.equal(sends, 0); assert.equal(store.raw, null);
});

test('uncertain secure commit preserves its referenced upload and blocks replacement', async () => {
  const store = memory(), deleted: string[] = [];
  let sends = 0;
  const controller = new NativePendingActionJournal({ scope, domain: 'learning', storage: { ...store.storage, write: async value => { await store.storage.write(value); throw new Error('Commit acknowledgement lost'); } }, randomId: id,
    stageFile: async file => ({ ...file, uri: 'file:///documents/pending/committed-copy' }), discardStagedFile: async file => { deleted.push(file.uri); }, send: async () => { sends++; }, read: async () => ({}) });
  const upload = { endpoint: '/api/v1/learning/assignments/source/people/learner/files/', multipart: { fields: { expected_revision: 7, file_id: 'stable-file' }, file: { uri: 'file:///cache/picker.pdf', name: 'response.pdf', type: 'application/pdf', size: 12, hash: 'a'.repeat(64) } } };
  await controller.hydrate(); await controller.run(upload, context);
  assert.equal(controller.snapshot().blocked, true); assert.equal(sends, 0); assert.deepEqual(deleted, []);
  assert.equal(JSON.parse(store.raw!).payload.file.uri, 'file:///documents/pending/committed-copy');
  const resumed = journal(store.storage, { send: async () => { sends++; } }); await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1);
});
