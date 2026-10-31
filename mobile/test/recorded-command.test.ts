import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordedCommandJournal, sharedRecordedCommandJournal, acceptedRecordedResult, isDefinitiveRecordedRefusal, isRecordedCommandObsolete, recordedConfirmationPath, recoverRecordedItem, validateRecordedCommand, type RecordedCommand } from '../src/lib/recorded-command';

const key = 'f6cf6fd1-b1cf-4777-895d-5a3f1853d989';
const source = '6e9d56e7-df38-4acb-b538-00bf1d005fef';
const root = '/api/v1/schools/cis/resources';
const command: RecordedCommand = {
  version: 1, scopeKey: 'actor:person-a|campus:cis|simulation:world-a', domain: 'resources', root,
  key, sourceId: source, method: 'POST', path: `${root}/loans/${source}/returns`,
  confirmationPath: recordedConfirmationPath('resources', root, source, key),
  body: JSON.stringify({ command_id: key, expected_revision: 8, observed_at: '2026-10-27T08:00:00Z', parts: [{ part_id: 'part-a', quantity: 1, condition: 'usable' }] }), phase: 'unknown',
};

test('retained custody action stays qualified to its exact account, campus and world', () => {
  assert.equal(validateRecordedCommand(command, command.scopeKey, 'resources', root), true);
  for (const scope of ['actor:person-b|campus:cis|simulation:world-a', 'actor:person-a|campus:other|simulation:world-a', 'actor:person-a|campus:cis|simulation:world-b', 'actor:person-a|campus:cis|live']) {
    assert.equal(validateRecordedCommand(command, scope, 'resources', root), false);
  }
  assert.equal(validateRecordedCommand(command, command.scopeKey, 'facilities', root), false);
});

test('retained requests reject foreign paths, changed command identity and malformed revision', () => {
  for (const change of [
    { path: 'https://outside.invalid/action' }, { path: `${root}/../fees/payments` }, { path: `${root}/loans\\other` },
    { confirmationPath: '/api/v1/schools/other/resources/confirmation' },
    { body: JSON.stringify({ command_id: 'different', expected_revision: 8 }) },
    { body: JSON.stringify({ command_id: key, expected_revision: -1 }) },
    { body: JSON.stringify({ command_id: key, expected_revision: 1.5 }) }, { body: '{' },
  ]) assert.equal(validateRecordedCommand({ ...command, ...change }, command.scopeKey, 'resources', root), false);
});

test('receipt must prove the exact source, accepted revision and dining kind', () => {
  assert.equal(acceptedRecordedResult(command, { id: source, revision: 9 }), true);
  assert.equal(acceptedRecordedResult(command, { id: 'other', revision: 9 }), false);
  assert.equal(acceptedRecordedResult(command, { id: source, revision: 0 }), false);
  assert.equal(acceptedRecordedResult({ ...command, kind: 'issue' }, { id: source, kind: 'session', revision: 9 }), false);
  assert.equal(acceptedRecordedResult({ ...command, kind: 'issue' }, { id: source, kind: 'issue', revision: 9 }), true);
});

test('uncertain responses retain the original action until owner confirmation', () => {
  for (const error of [new Error('Network interrupted'), { status: 409 }, { status: 500 }]) {
    assert.equal(isDefinitiveRecordedRefusal(error, false), false);
    assert.equal(isDefinitiveRecordedRefusal(error, true), false);
  }
  assert.equal(isDefinitiveRecordedRefusal({ status: 403 }, false), true);
  assert.equal(isDefinitiveRecordedRefusal({ status: 403 }, true), false);
  assert.equal(isDefinitiveRecordedRefusal({ status: 422 }, true), false);
  assert.equal(isDefinitiveRecordedRefusal({ status: 422 }, false), true);
  for (const status of [400, 401, 404, 408, 409, 429, 500]) assert.equal(isDefinitiveRecordedRefusal({ status }, true), false);
});

test('confirmation routes remain source bound for creation and existing records', () => {
  assert.equal(recordedConfirmationPath('facilities', '/api/v1/schools/cis/facilities', key, key), `/api/v1/schools/cis/facilities/repairs/${key}/confirmation?command_id=${key}`);
  assert.equal(recordedConfirmationPath('dining', '/api/v1/schools/cis/dining', source, key), `/api/v1/schools/cis/dining/confirmation?command_id=${key}&source_id=${source}`);
});

test('item batches use exact-request recovery and cannot borrow a loan confirmation', () => {
  const item: RecordedCommand = { ...command, kind: 'item', sourceId: key, path: `${root}/items`, confirmationPath: recordedConfirmationPath('resources', root, key, key, 'item'), body: JSON.stringify({ command_id: key, name: 'Camera', quantity: 2, campus_id: source, asset_tag: 'CAM' }) };
  assert.equal(item.confirmationPath, null);
  assert.equal(validateRecordedCommand(item, item.scopeKey, 'resources', root), true);
  assert.equal(validateRecordedCommand({ ...item, confirmationPath: command.confirmationPath }, item.scopeKey, 'resources', root), false);
  for (const change of [{ sourceId: source }, { path: `${root}/loans` }, { method: 'PUT' }, { body: JSON.stringify({ command_id: key, expected_revision: 0, name: 'Camera', campus_id: source }) }, { body: JSON.stringify({ command_id: key, name: 'Camera', quantity: 101, campus_id: source }) }]) assert.equal(validateRecordedCommand({ ...item, ...change }, item.scopeKey, 'resources', root), false);
  assert.equal(acceptedRecordedResult(item, { id: key, revision: 1 }), false);
  let calls = 0;
  assert.equal(acceptedRecordedResult(item, { id: key, revision: 1 }, () => { calls++; return false; }), false);
  assert.equal(acceptedRecordedResult(item, { id: key, revision: 1 }, () => { calls++; return true; }), true);
  assert.equal(calls, 2);
  assert.equal(acceptedRecordedResult(command, { id: source, revision: 9 }, () => { throw new Error('Other domains must use their existing owner proof'); }), true);
});

test('item recovery replays only the original unknown request and never replays accepted work', async () => {
  const item: RecordedCommand = { ...command, kind: 'item', sourceId: key, path: `${root}/items`, confirmationPath: null, body: JSON.stringify({ command_id: key, name: 'Camera', quantity: 10, campus_id: source, asset_tag: 'CAM' }) };
  let replays = 0, refreshes = 0;
  const operations = { replay: async (exact: RecordedCommand) => { assert.equal(exact, item); assert.equal(exact.body, item.body); replays++; }, refresh: async (exact: RecordedCommand) => { assert.equal(exact.body, item.body); refreshes++; } };
  await recoverRecordedItem(item, operations);
  assert.equal(replays, 1); assert.equal(refreshes, 0);
  await recoverRecordedItem({ ...item, phase: 'accepted' }, operations);
  assert.equal(replays, 1); assert.equal(refreshes, 1);
  await assert.rejects(recoverRecordedItem(command, operations));
  assert.equal(replays, 1); assert.equal(refreshes, 1);
});

 test('only exact owning-domain obsolete proof releases an inapplicable retained command', () => {
  const proof = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', reason: 'stream_advanced', loan_id: source, command_id: key, expected_revision: 8, current_revision: 9 };
  const error = { status: 409, details: { error: { code: 'resource_loan_obsolete', fields: { resource_loan_obsolete: proof } } } };
  assert.equal(isRecordedCommandObsolete(command, error), true);
  for (const change of [{ loan_id: 'another' }, { command_id: 'another' }, { expected_revision: 7 }, { current_revision: 8 }, { receipt_state: 'accepted' }]) {
    assert.equal(isRecordedCommandObsolete(command, { ...error, details: { error: { code: 'resource_loan_obsolete', fields: { resource_loan_obsolete: { ...proof, ...change } } } } }), false);
  }
});

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; }
function fixture(options: { initial?: RecordedCommand; send?: (value: RecordedCommand) => Promise<unknown>; createId?: () => Promise<string>; persist?: (value: RecordedCommand) => Promise<void>; remove?: () => Promise<void>; confirm?: () => Promise<{ state: string; result?: unknown }>; bind?: () => { assertCurrent(): void } } = {}) {
  let raw: string | null = options.initial ? JSON.stringify(options.initial) : null, creates = 0, removes = 0;
  const sent: RecordedCommand[] = [], confirmations: RecordedCommand[] = [];
  const journal = new RecordedCommandJournal({ scopeKey: command.scopeKey, domain: 'resources', root,
    read: async () => raw,
    persist: async value => { await options.persist?.(value); raw = JSON.stringify(value); },
    remove: async () => { removes++; raw = null; await options.remove?.(); },
    createId: async () => { creates++; return options.createId ? options.createId() : key; },
    captureContext: options.bind ?? (() => ({ assertCurrent() {} })),
    send: async value => { sent.push(value); return options.send ? options.send(value) : { id: value.sourceId, revision: 9 }; },
    confirm: async value => { confirmations.push(value); return options.confirm ? options.confirm() : { state: 'accepted', result: { id: value.sourceId, revision: 9 } }; },
  });
  return { journal, sent, confirmations, get raw() { return raw; }, get creates() { return creates; }, get removes() { return removes; } };
}
function owner(accepted: (value: RecordedCommand) => Promise<void> = async () => {}) { return { assertActive() {}, accepted, refreshObsolete: async () => {} }; }
const input = () => ({ sourceId: source, path: command.path, body: { expected_revision: 8, observed_at: '2026-10-27T08:00:00Z', parts: [] } });

test('retained native screens share one journal and an unknown action cannot be overwritten by a second mount', async () => {
  const first = fixture({ send: async () => { throw new Error('Lost response'); } }), scope = `${command.scopeKey}:shared-stack-test`;
  const a = sharedRecordedCommandJournal(scope, 'resources', root, () => first.journal);
  const b = sharedRecordedCommandJournal(scope, 'resources', root, () => { throw new Error('A second journal must not be created'); });
  const observedA: Array<string | null> = [], observedB: Array<string | null> = [];
  const offA = a.subscribe(state => observedA.push(state.pending?.phase ?? null)), offB = b.subscribe(state => observedB.push(state.pending?.phase ?? null));
  await Promise.all([a.hydrate(), b.hydrate()]); await b.run(input(), owner());
  const original = first.raw; assert.equal(a.snapshot().pending?.phase, 'unknown');
  await a.run({ ...input(), body: { expected_revision: 9, parts: [] } }, owner());
  assert.equal(first.creates, 1); assert.equal(first.sent.length, 1); assert.equal(first.raw, original);
  assert.deepEqual(observedA, observedB); offA(); offB();
});
test('shared serialization starts before asynchronous identity or storage work', async () => {
  const identity = deferred<string>(), f = fixture({ createId: () => identity.promise }); await f.journal.hydrate();
  const first = f.journal.run(input(), owner()); await f.journal.run(input(), owner());
  assert.equal(f.creates, 1); assert.equal(f.journal.snapshot().busy, true);
  identity.resolve(key); await first; assert.equal(f.sent.length, 1); assert.equal(f.raw, null);
});
test('closed submitting screen keeps unconfirmed work for another screen to check through its own callback only', async () => {
  const response = deferred<unknown>(), f = fixture({ send: () => response.promise }); await f.journal.hydrate();
  let active = true, firstCallbacks = 0, secondCallbacks = 0;
  const run = f.journal.run(input(), { ...owner(async () => { firstCallbacks++; }), assertActive() { if (!active) throw new Error('Original screen closed'); } });
  while (!f.sent.length) await Promise.resolve();
  active = false; response.resolve({ id: source, revision: 9 }); await run;
  assert.equal(f.journal.snapshot().pending?.phase, 'unknown'); assert.equal(firstCallbacks, 0); assert.ok(f.raw);
  await f.journal.check(owner(async value => { assert.equal(value.sourceId, source); secondCallbacks++; }));
  assert.equal(firstCallbacks, 0); assert.equal(secondCallbacks, 1); assert.equal(f.sent.length, 1); assert.equal(f.confirmations.length, 1); assert.equal(f.raw, null);
});
test('accepted refresh failure is shared and recovery invokes only the recovering screen callback', async () => {
  const f = fixture(); await f.journal.hydrate(); let firstCallbacks = 0, secondCallbacks = 0;
  await f.journal.run(input(), owner(async () => { firstCallbacks++; throw new Error('Refresh unavailable'); }));
  assert.equal(f.journal.snapshot().pending?.phase, 'accepted');
  await f.journal.check(owner(async () => { secondCallbacks++; }));
  assert.equal(firstCallbacks, 1); assert.equal(secondCallbacks, 1); assert.equal(f.sent.length, 1); assert.equal(f.confirmations.length, 0); assert.equal(f.raw, null);
});
test('initial secure persistence failure blocks every observer and dispatches nothing', async () => {
  const f = fixture({ persist: async () => { throw new Error('Keychain locked'); } }); await f.journal.hydrate();
  await f.journal.run(input(), owner()); await f.journal.run(input(), owner()); await f.journal.check(owner());
  assert.equal(f.journal.snapshot().storageBlocked, true); assert.equal(f.sent.length, 0); assert.equal(f.creates, 1); assert.equal(f.confirmations.length, 0);
});
test('transport or screen changes during command preparation cannot dispatch through a new binding', async () => {
  const identity = deferred<string>(); let binding = 1;
  const f = fixture({ createId: () => identity.promise, bind: () => { const original = binding; return { assertCurrent() { if (binding !== original) throw new Error('Transport changed'); } }; } });
  await f.journal.hydrate(); const run = f.journal.run(input(), owner()); binding++; identity.resolve(key); await run;
  assert.equal(f.sent.length, 0); assert.equal(f.raw, null); assert.equal(f.journal.snapshot().busy, false);
});
test('unknown item recovery keeps exact bytes and never releases intent after a later generic refusal', async () => {
  const item: RecordedCommand = { ...command, kind: 'item', sourceId: key, path: `${root}/items`, confirmationPath: null, body: JSON.stringify({ command_id: key, name: 'Camera', quantity: 2, campus_id: source, asset_tag: 'CAM' }) };
  const f = fixture({ initial: item, send: async () => { throw { status: 422 }; } }); await f.journal.hydrate(); const raw = f.raw;
  await f.journal.check({ ...owner(), acceptsItemResult: () => true });
  assert.equal(f.sent[0]?.body, item.body); assert.equal(f.sent[0]?.key, key); assert.equal(f.raw, raw); assert.equal(f.removes, 0);
});
test('item validation remains required and asynchronous proof is checked before accepted persistence', async () => {
  const proof = deferred<boolean>(); let binding = 1;
  const f = fixture({ bind: () => { const original = binding; return { assertCurrent() { if (binding !== original) throw new Error('Transport changed while checking proof'); } }; } });
  await f.journal.hydrate(); const item = { kind: 'item', path: `${root}/items`, body: { name: 'Camera', quantity: 2, campus_id: source, asset_tag: 'CAM' } };
  await f.journal.run(item, owner()); assert.equal(f.sent.length, 0);
  const run = f.journal.run(item, { ...owner(), acceptsItemResult: () => proof.promise });
  while (!f.sent.length) await Promise.resolve(); binding++; proof.resolve(true); await run;
  assert.equal(f.journal.snapshot().pending?.phase, 'unknown'); assert.ok(f.raw); assert.equal(f.removes, 0);
  await f.journal.check(owner()); assert.equal(f.sent.length, 1); assert.ok(f.raw);
});


test('a preparation context change retains the original action without poisoning recovery in its original scope', async () => {
  let binding = 1, drift = true;
  const f = fixture({ bind: () => { const original = binding; return { assertCurrent() { if (original !== binding) throw new Error('Binding changed'); } }; }, persist: async () => { if (drift) { binding++; drift = false; throw new Error('The preparation binding changed'); } } });
  await f.journal.hydrate(); await f.journal.run(input(), owner());
  assert.equal(f.sent.length, 0); assert.equal(f.journal.snapshot().pending?.phase, 'prepared'); assert.equal(f.journal.snapshot().storageBlocked, false);
  await f.journal.check(owner()); assert.equal(f.confirmations.length, 1); assert.equal(f.raw, null);
});

test('background, retained-tab blur or owning href/source change during secure preparation cannot send a command', async () => {
  for (const reason of ['background', 'retained tab blurred', 'owning href changed', 'selected source changed']) {
    const stored = deferred<void>(), started = deferred<void>(); let visible = true;
    const f = fixture({ persist: async () => { started.resolve(); await stored.promise; } }); await f.journal.hydrate();
    const run = f.journal.run(input(), { ...owner(), assertActive() { if (!visible) throw new Error(reason); } });
    await started.promise; visible = false; stored.resolve(); await run;
    assert.equal(f.sent.length, 0, reason); assert.equal(f.removes, 0); assert.equal(f.journal.snapshot().storageBlocked, false);
    assert.equal(f.journal.snapshot().pending?.key, key); assert.equal(f.journal.snapshot().pending?.phase, 'prepared'); assert.ok(f.raw?.includes(key));
    // A later visible recovery owns its own callback and only checks the same receipt.
    visible = true; await f.journal.check(owner()); assert.equal(f.sent.length, 0); assert.equal(f.confirmations.length, 1); assert.equal(f.raw, null);
  }
});

test('accepted cleanup forgets cleared intent before a late visibility guard and never replays it', async () => {
  let visible = true; const f = fixture({ remove: async () => { visible = false; } }); await f.journal.hydrate();
  await f.journal.run(input(), { ...owner(), assertActive() { if (!visible) throw new Error('Background during deletion'); } });
  assert.equal(f.sent.length, 1); assert.equal(f.raw, null); assert.equal(f.journal.snapshot().pending, null); assert.equal(f.journal.snapshot().retryAllowed, false);
  visible = true; await f.journal.check(owner()); assert.equal(f.sent.length, 1); assert.equal(f.confirmations.length, 0); assert.equal(f.removes, 1);
});

test('definite refusal, exact obsolete proof and not-accepted confirmation cleanup cannot resurrect removed intent on drift', async () => {
  for (const kind of ['refused', 'obsolete', 'not_accepted'] as const) {
    let visible = true;
    const absent = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', reason: 'stream_advanced', loan_id: source, command_id: key, expected_revision: 8, current_revision: 9 };
    const proof = { status: 409, details: { error: { code: 'resource_loan_obsolete', fields: { resource_loan_obsolete: absent } } } };
    const f = fixture({ ...(kind === 'not_accepted' ? { initial: command, confirm: async () => ({ state: 'not_accepted' }) } : { send: async () => { throw kind === 'refused' ? { status: 403 } : proof; } }), remove: async () => { visible = false; } });
    await f.journal.hydrate(); const context = { ...owner(), assertActive() { if (!visible) throw new Error('Source changed during removal'); } };
    if (kind === 'not_accepted') await f.journal.check(context); else await f.journal.run(input(), context);
    assert.equal(f.raw, null, kind); assert.equal(f.journal.snapshot().pending, null, kind); assert.equal(f.journal.snapshot().retryAllowed, false);
  }
});

test('a rejected preflight lease becomes a visible journal error without creating or replacing intent', async () => {
  const f = fixture({ initial: command }); await f.journal.hydrate(); const original = f.raw;
  f.journal.preparationFailed(new Error('Return to the original focused source'));
  assert.match(f.journal.snapshot().error, /original focused source/); assert.equal(f.raw, original); assert.equal(f.journal.snapshot().pending?.key, key); assert.equal(f.sent.length, 0);
});
