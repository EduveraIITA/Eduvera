import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLifecycle } from '../src/auth/session-lifecycle';

test('logout waits for an in-flight Keychain write and removes it before a new sign-in', async () => {
  const lifecycle = createSessionLifecycle(() => 'https://campus.example');
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let stored: string | null = null;
  const first = lifecycle.begin();
  const writing = lifecycle.serialize(async () => { first.assertCurrent(); await paused; stored = 'old'; first.assertCurrent(); });
  await Promise.resolve();
  lifecycle.begin();
  const deleting = lifecycle.serialize(async () => { stored = null; });
  release();
  await assert.rejects(writing, /context changed/);
  await deleting;
  assert.equal(stored, null);
  const latest = lifecycle.begin();
  await lifecycle.serialize(async () => { latest.assertCurrent(); stored = 'new'; });
  assert.equal(stored, 'new');
});

test('a superseded queued write never starts and does not poison later storage jobs', async () => {
  const lifecycle = createSessionLifecycle(() => 'https://campus.example');
  const old = lifecycle.begin(); let writes = 0;
  const first = lifecycle.serialize(async () => { old.assertCurrent(); writes++; });
  const current = lifecycle.begin();
  await assert.rejects(first, /context changed/);
  await lifecycle.serialize(async () => { current.assertCurrent(); writes++; });
  assert.equal(writes, 1);
});

test('server changes and a later sign-in invalidate delayed hydration', () => {
  let origin = 'https://one.example';
  const lifecycle = createSessionLifecycle(() => origin);
  const hydration = lifecycle.capture();
  origin = 'https://two.example';
  assert.equal(hydration.isCurrent(), false);
  assert.throws(hydration.assertCurrent, /context changed/);
  const pending = lifecycle.capture(); lifecycle.begin();
  assert.equal(pending.isCurrent(), false);
});
