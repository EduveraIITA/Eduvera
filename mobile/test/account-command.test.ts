import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountCommandGate, type AccountRequest } from '../src/lib/account-command';
const request: AccountRequest = { path: '/api/v1/auth/pro-features/', method: 'POST', body: '{"enabled":false}' };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
test('account action captures the exact request before awaits and rejects overlapping sends', async () => {
  const gate = new AccountCommandGate(); let resolve!: (value: unknown) => void, sends = 0;
  const source = { ...request }, options = { assertCurrent() {}, send: async (original: Readonly<AccountRequest>) => { sends++; assert.equal(original.body, request.body); return new Promise(done => { resolve = done; }); }, confirm: (value: unknown) => value, refresh: async () => ({ current: true }) };
  const pending = gate.run(source, options); source.body = '{"enabled":true}'; await tick();
  assert.equal(await gate.run(request, options), false); resolve({ enabled: false }); assert.equal(await pending, true); assert.equal(sends, 1); assert.equal(gate.snapshot().pending, null);
});
test('lost keyless responses never replay; only an explicit choice follows a successful current-state review', async () => {
  const gate = new AccountCommandGate(); let sends = 0, reads = 0;
  await gate.run(request, { assertCurrent() {}, send: async () => { sends++; throw new Error('reply lost'); }, confirm: value => value, refresh: async () => { throw new Error('must not read as success'); } });
  gate.review(); assert.ok(gate.snapshot().pending);
  await gate.inspect({ assertCurrent() {}, refresh: async () => { reads++; return { enabled: true }; } });
  assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(gate.snapshot().pending?.inspected, true); assert.equal(gate.snapshot().pending?.request.body, request.body);
  gate.review(); assert.equal(gate.snapshot().pending, null); assert.match(gate.snapshot().message, /next choice/);
});
test('acknowledged actions with failed refresh recover by read only and do not retain returned secrets', async () => {
  const gate = new AccountCommandGate(); let sends = 0, accepted = 0;
  await gate.run(request, { assertCurrent() {}, send: async () => { sends++; return { private_link: 'never retained' }; }, confirm: value => value, accepted: () => { accepted++; }, refresh: async () => { throw new Error('refresh failed'); } });
  assert.equal(gate.snapshot().pending?.phase, 'acknowledged'); assert.equal(JSON.stringify(gate.snapshot()).includes('never retained'), false);
  await gate.inspect({ assertCurrent() {}, refresh: async () => ({ enabled: false }) }); assert.equal(gate.snapshot().pending, null); assert.equal(sends, 1); assert.equal(accepted, 1);
});
test('definite first refusals release the gate while uncertain/conflicting responses stay retained', async () => {
  for (const status of [400, 403, 404, 408, 409, 429, 500]) {
    const gate = new AccountCommandGate(); await gate.run(request, { assertCurrent() {}, send: async () => { throw Object.assign(new Error('refused'), { status }); }, confirm: value => value, refresh: async () => null });
    assert.equal(!!gate.snapshot().pending, [408, 409, 429, 500].includes(status));
  }
});
test('account/campus/world context loss blocks sends and cannot accept or release old outcomes', async () => {
  const before = new AccountCommandGate(); let sends = 0;
  await before.run(request, { assertCurrent() { throw new Error('context changed'); }, send: async () => { sends++; }, confirm: value => value, refresh: async () => null }); assert.equal(sends, 0);
  const gate = new AccountCommandGate(); let current = true, accepted = false;
  const assertCurrent = () => { if (!current) throw new Error('context changed'); };
  await gate.run(request, { assertCurrent, send: async () => { current = false; return {}; }, confirm: value => value, accepted: () => { accepted = true; }, refresh: async () => null });
  assert.equal(accepted, false); assert.equal(gate.snapshot().pending?.phase, 'unknown');
  await gate.inspect({ assertCurrent, refresh: async () => null }); gate.review(); assert.ok(gate.snapshot().pending);
});
test('a failed later inspection revokes the earlier permission to choose from reviewed state', async () => {
  const gate = new AccountCommandGate();
  await gate.run(request, { assertCurrent() {}, send: async () => { throw new Error('reply lost'); }, confirm: value => value, refresh: async () => null });
  await gate.inspect({ assertCurrent() {}, refresh: async () => ({ enabled: true }) }); assert.equal(gate.snapshot().pending?.inspected, true);
  await gate.inspect({ assertCurrent() {}, refresh: async () => { throw new Error('unavailable'); } }); gate.review(); assert.ok(gate.snapshot().pending); assert.equal(gate.snapshot().pending?.inspected, false);
});
