import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicFormLease, PublicFormContextChanged, publicFormRequest, type PublicFormState } from '../src/auth/public-form-operation';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const initial: PublicFormState = { identity: 'original form and anonymous session', mounted: true, focused: true, foreground: true };

test('leaving, backgrounding or changing the original form during CSRF preparation never dispatches an invitation write', async () => {
  for (const change of [{ focused: false }, { foreground: false }, { mounted: false }, { identity: 'different invitation' }, { identity: 'different account or world' }]) {
    const lease = createPublicFormLease(initial), csrf = deferred<void>(), started = deferred<void>(); let posts = 0, callbacks = 0;
    const request = publicFormRequest({ assertCurrent: lease.capture(), bootstrap: async () => { started.resolve(); await csrf.promise; }, submit: async () => { posts++; return 'receipt'; } }).then(() => { callbacks++; });
    await started.promise; lease.update({ ...initial, ...change }); csrf.resolve();
    await assert.rejects(request, PublicFormContextChanged);
    assert.equal(posts, 0); assert.equal(callbacks, 0);
  }
});

test('returning to an identical screen does not revive an invitation preparation invalidated by a blur', async () => {
  const lease = createPublicFormLease(initial), csrf = deferred<void>(); let posts = 0;
  const request = publicFormRequest({ assertCurrent: lease.capture(), bootstrap: () => csrf.promise, submit: async () => { posts++; } });
  lease.update({ ...initial, focused: false }); lease.update(initial); csrf.resolve();
  await assert.rejects(request, PublicFormContextChanged); assert.equal(posts, 0);
  await publicFormRequest({ assertCurrent: lease.capture(), submit: async () => { posts++; } });
  assert.equal(posts, 1);
});

test('an already stale or anonymous-unmounted form performs no security bootstrap or POST', async () => {
  for (const change of [{ focused: false }, { foreground: false }, { mounted: false }]) {
    const lease = createPublicFormLease({ ...initial, ...change });
    assert.throws(() => lease.capture(), PublicFormContextChanged);
  }
});

test('a departed form gets no accepted callback after a dispatched invitation response arrives', async () => {
  const lease = createPublicFormLease(initial), response = deferred<string>(); let posts = 0, callbacks = 0;
  const request = publicFormRequest({ assertCurrent: lease.capture(), submit: async () => { posts++; return response.promise; } }).then(() => { callbacks++; });
  lease.update({ ...initial, foreground: false }); response.resolve('accepted receipt');
  await assert.rejects(request, PublicFormContextChanged); assert.equal(posts, 1); assert.equal(callbacks, 0);
});

test('only an explicit fresh preparation submits once; failed bootstrap never becomes an unknown acceptance', async () => {
  const lease = createPublicFormLease(initial); let posts = 0, bootstraps = 0;
  await assert.rejects(publicFormRequest({ assertCurrent: lease.capture(), bootstrap: async () => { bootstraps++; throw new Error('CSRF unavailable'); }, submit: async () => { posts++; } }), /CSRF unavailable/);
  assert.equal(posts, 0);
  const value = await publicFormRequest({ assertCurrent: lease.capture(), bootstrap: async () => { bootstraps++; }, submit: async () => { posts++; return 'exact original receipt'; } });
  assert.equal(value, 'exact original receipt'); assert.equal(posts, 1); assert.equal(bootstraps, 2);
});
