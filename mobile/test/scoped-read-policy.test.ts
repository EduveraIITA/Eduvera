import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetainScopedRead, runFromScopedRead } from '../src/lib/scoped-read-policy';

test('missing or no-longer-authorized scoped sources are never retained', () => {
  for (const data of [null, undefined]) {
    for (const error of [null, new Error('Offline'), { status: 503 }]) {
      assert.equal(canRetainScopedRead(data, error), false);
    }
  }
  const data = Object.freeze({ id: 'reviewed-source', revision: 4 });
  for (const status of [401, 403, 404, 410]) {
    const error = Object.freeze({ status, message: 'Source unavailable' });
    assert.equal(canRetainScopedRead(data, error), false);
    assert.deepEqual(data, { id: 'reviewed-source', revision: 4 });
    assert.deepEqual(error, { status, message: 'Source unavailable' });
  }
});

test('transient failures preserve cached values without inventing a new source', () => {
  const data = Object.freeze({ id: 'reviewed-source', revision: 4 });
  for (const error of [null, undefined, new Error('Network unavailable'), { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }]) {
    assert.equal(canRetainScopedRead(data, error), true);
  }
  for (const value of [false, 0, '']) assert.equal(canRetainScopedRead(value, null), true);
  assert.deepEqual(data, { id: 'reviewed-source', revision: 4 });
});

test('a deferred confirmation refuses a source that failed after the dialog opened', async () => {
  const calls: unknown[] = [], input = Object.freeze({ id: 'source', expected_revision: 4 });
  let state = { paused: false, run: async (value: typeof input) => { calls.push(value); return true; } };
  const confirm = () => runFromScopedRead(() => state, input, false);
  let release!: () => void;
  const answer = new Promise<void>(resolve => { release = resolve; });
  const deferredConfirmation = answer.then(confirm);
  state = { ...state, paused: true };
  release();
  assert.equal(await deferredConfirmation, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(input, { id: 'source', expected_revision: 4 });
});

test('a resumed source uses its latest writer and preserves the exact input', async () => {
  const calls: string[] = [], input = Object.freeze({ expected_revision: 7 });
  let state = { paused: true, run: async (_value: typeof input) => { calls.push('old'); return 'old'; } };
  const confirm = () => runFromScopedRead(() => state, input, 'refused');
  assert.equal(await confirm(), 'refused');
  state = { paused: false, run: async value => { assert.equal(value, input); calls.push('current'); return 'saved'; } };
  assert.equal(await confirm(), 'saved');
  assert.deepEqual(calls, ['current']);
});

test('an available source propagates its current writer failure', async () => {
  const failure = new Error('Exact command unavailable');
  await assert.rejects(runFromScopedRead(() => ({ paused: false, run: async () => { throw failure; } }), { id: 'source' }, false), failure);
});
