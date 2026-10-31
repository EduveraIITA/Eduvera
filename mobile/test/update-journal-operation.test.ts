import assert from 'node:assert/strict';
import test from 'node:test';
import { clearUpdateJournal, executeUpdateJournal, type UpdateJournalProgress } from '../src/lib/update-journal-operation';

type Command = { body: { idempotency_key: string; expected_revision: number }; accepted?: { id: string; revision: number } };
const original: Command = { body: { idempotency_key: 'original-key', expected_revision: 2 } }, receipt = { id: 'notice', revision: 3 };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  let active = true, retained: Command | null = null, raw: string | null = null, sends = 0, clears = 0;
  const assertCurrent = () => { if (!active) throw new Error('Original href/source/account/world/foreground changed'); };
  const progress: UpdateJournalProgress<NonNullable<Command['accepted']>> = { accepted: undefined, cleared: false, dispatched: false };
  const journal = { write: async (value: string) => { raw = value; }, clear: async () => { raw = null; clears++; }, retain: (value: Command | null) => { retained = value; } };
  const options = { capture: () => { assertCurrent(); return assertCurrent; }, journal, progress, send: async (command: Command) => { assert.deepEqual(command.body, original.body); sends++; return receipt; }, receipt: (value: unknown) => { assert.deepEqual(value, receipt); return receipt; } };
  return { options, assertCurrent, progress, journal, leave: () => { active = false; }, return: () => { active = true; }, state: () => ({ retained, raw, sends, clears }) };
}

test('background or source change during encrypted preparation retains the original intent and never dispatches', async () => {
  const s = setup(), waiting = deferred(), started = deferred(), write = s.journal.write;
  s.journal.write = async value => { await write(value); started.resolve(); await waiting.promise; };
  const run = executeUpdateJournal(original, s.options); await started.promise; s.leave(); waiting.resolve();
  await assert.rejects(run, /foreground changed/);
  assert.equal(s.state().sends, 0); assert.equal(s.state().clears, 0); assert.deepEqual(s.state().retained, original); assert.equal(s.state().raw, JSON.stringify(original));
});

test('a stale callback is rejected before any storage or network operation', async () => {
  const s = setup(); s.leave(); await assert.rejects(executeUpdateJournal(original, s.options), /foreground changed/);
  assert.deepEqual(s.state(), { retained: null, raw: null, sends: 0, clears: 0 });
});

test('drift during receipt persistence keeps accepted intent; recovery clears it without sending the command again', async () => {
  const s = setup(), waiting = deferred(), started = deferred(), write = s.journal.write; let writes = 0;
  s.journal.write = async value => { await write(value); if (++writes === 2) { started.resolve(); await waiting.promise; } };
  const run = executeUpdateJournal(original, s.options); await started.promise; s.leave(); waiting.resolve();
  await assert.rejects(run, /foreground changed/); assert.equal(s.state().sends, 1); assert.deepEqual(s.state().retained?.accepted, receipt); assert.equal(s.state().clears, 0);
  s.return(); const recovered = s.state().retained!; const progress = { accepted: recovered.accepted, cleared: false, dispatched: false };
  const accepted = await executeUpdateJournal(recovered, { ...s.options, progress });
  assert.deepEqual(accepted, receipt); assert.equal(s.state().sends, 1); assert.equal(s.state().retained, null); assert.equal(s.state().raw, null);
});

test('drift during durable accepted cleanup cannot resurrect a journal already cleared on disk', async () => {
  const s = setup(), waiting = deferred(), started = deferred(), clear = s.journal.clear;
  s.journal.clear = async () => { await clear(); started.resolve(); await waiting.promise; };
  const run = executeUpdateJournal(original, s.options); await started.promise; s.leave(); waiting.resolve();
  await assert.rejects(run, /foreground changed/); assert.equal(s.progress.cleared, true); assert.equal(s.state().retained, null); assert.equal(s.state().raw, null); assert.equal(s.state().sends, 1);
});

test('a lost response keeps exact bytes/key, and an explicit retry sends only that original request', async () => {
  const s = setup(); let calls = 0;
  const send = async (command: Command) => { assert.deepEqual(command, original); if (++calls === 1) throw new Error('Response lost'); return receipt; };
  await assert.rejects(executeUpdateJournal(original, { ...s.options, send }), /Response lost/);
  assert.equal(s.progress.accepted, undefined); assert.equal(s.state().clears, 0); assert.deepEqual(s.state().retained, original);
  await executeUpdateJournal(s.state().retained!, { ...s.options, send }); assert.equal(calls, 2); assert.equal(s.state().retained, null);
});

test('malformed receipts never release retained intent', async () => {
  const s = setup(); await assert.rejects(executeUpdateJournal(original, { ...s.options, receipt: () => { throw new Error('Wrong source/revision'); } }), /Wrong source/);
  assert.deepEqual(s.state().retained, original); assert.equal(s.state().clears, 0);
});

test('definite-refusal cleanup uses the same visible source before I/O and forgets cleared state even if visibility changes during it', async () => {
  const s = setup(); s.journal.retain(original); await s.journal.write(JSON.stringify(original)); s.leave();
  await assert.rejects(clearUpdateJournal(s.journal, s.assertCurrent, s.progress), /foreground changed/); assert.equal(s.state().clears, 0);
  s.return(); const clear = s.journal.clear; s.journal.clear = async () => { await clear(); s.leave(); };
  await assert.rejects(clearUpdateJournal(s.journal, s.assertCurrent, s.progress), /foreground changed/); assert.equal(s.state().retained, null); assert.equal(s.state().raw, null); assert.equal(s.progress.cleared, true);
});
