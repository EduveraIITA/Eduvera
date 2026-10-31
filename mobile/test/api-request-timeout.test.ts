import assert from 'node:assert/strict';
import test from 'node:test';
import { campusRequestTimeoutMs } from '../src/lib/api-policy';
import { createCampusApiClient } from '../src/lib/api-client';

const school = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';
const root = `/api/v1/schools/${school}/simulation/runs`;
const response = () => new Response(JSON.stringify({ id: run }), { headers: { 'Content-Type': 'application/json' } });

test('only keyed Simulation captures and duplicates receive the longer bounded deadline', () => {
  for (const path of [root, `${root}/`, `${root}/${run}/duplicate`, `${root}/${run}/duplicate/`]) {
    assert.equal(campusRequestTimeoutMs(path, 'POST', 30_000), 120_000);
    assert.equal(campusRequestTimeoutMs(path, 'GET', 30_000), 30_000);
    assert.equal(campusRequestTimeoutMs(path, 'PATCH', 30_000), 30_000);
  }
  for (const path of [`${root}/${run}/start`, `${root}/${run}/remove`, `${root}/${run}/behaviour`, '/api/v1/auth/native/login/', '/api/v1/attendance/registers', `${root}-other`, `${root}/${run}/duplicate/unexpected`]) {
    assert.equal(campusRequestTimeoutMs(path, 'POST', 30_000), 30_000);
  }
});

for (const path of [root, `${root}/${run}/duplicate`]) test(`cold capture can finish beyond the ordinary timeout: ${path}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined, finish!: (value: Response) => void;
  const client = createCampusApiClient({ origin: 'https://campus.example', fetcher: (_url, init) => {
    signal = init.signal!;
    return new Promise(resolve => { finish = resolve; });
  } });
  client.bindApiSession('credential', `live:${school}`);
  const pending = client.apiFetch(path, { method: 'POST', body: '{"idempotency_key":"same-original-request"}' });
  t.mock.timers.tick(35_001);
  assert.equal(signal?.aborted, false);
  finish(response());
  assert.deepEqual(await pending, { id: run });
});

test('extended capture still times out with an unknown outcome and never retries automatically', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const client = createCampusApiClient({ origin: 'https://campus.example', fetcher: (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }));
  } });
  client.bindApiSession('credential', `live:${school}`);
  const pending = assert.rejects(client.apiFetch(root, { method: 'POST', body: '{}' }), /may have completed/);
  t.mock.timers.tick(120_000);
  await pending;
  assert.equal(calls, 1);
});

test('changing the native account cancels an extended capture immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const client = createCampusApiClient({ origin: 'https://campus.example', fetcher: (_url, init) => {
    signal = init.signal!;
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  client.bindApiSession('credential', `live:${school}`);
  const pending = assert.rejects(client.apiFetch(root, { method: 'POST', body: '{}' }), /context changed/);
  t.mock.timers.tick(35_001);
  client.bindApiSession('other-credential', 'live:another-campus');
  assert.equal(signal?.aborted, true);
  await pending;
});

test('Google ceremony failures never expire the existing authenticated account', async () => {
  let expired = 0;
  const client = createCampusApiClient({ origin: 'https://campus.example', fetcher: () => Promise.resolve(new Response('{"detail":"Sign-in proof expired"}', { status: 401, headers: { 'Content-Type': 'application/json' } })) });
  client.bindApiSession('credential', `live:${school}`);
  client.setApiCallbacks(() => { expired++; }, () => {});
  for (const path of ['/api/v1/auth/google/', '/api/v1/auth/google/config/', '/api/v1/auth/native/google/config/', '/api/v1/auth/native/google/start/', '/api/v1/auth/native/google/exchange/']) {
    await assert.rejects(client.apiFetch(path), /Sign-in proof expired/);
  }
  assert.equal(expired, 0);
});
