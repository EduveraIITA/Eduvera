import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import worker, { proxyDigitalTwin } from './worker.mjs';
const env = { DT_ORIGIN_URL: 'https://thatcampus-dt-367469594690.asia-south1.run.app' };

test('Cloudflare execution context is not mistaken for the upstream fetch function', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async request => { calls++; assert.equal(new URL(request.url).hostname, new URL(env.DT_ORIGIN_URL).hostname); return new Response('origin ready'); };
  try {
    const result = await worker.fetch(new Request('https://app2.thatcampus.com/readyz'), env, { waitUntil() {} });
    assert.equal(result.status, 200); assert.equal(await result.text(), 'origin ready'); assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('only app2 routes to its isolated DT origin; existing hosts never proxy', async () => {
  for (const host of ['thatcampus.com', 'app.thatcampus.com', 'www.thatcampus.com', 'evil.example']) {
    const result = await proxyDigitalTwin(new Request(`https://${host}/api/v1/workspace`), env, () => { throw new Error('Must not proxy'); });
    assert.equal(result.status, 404);
  }
  for (const target of ['https://eduvera-stage-367469594690.asia-south1.run.app', 'http://localhost:8000', 'https://thatcampus-dt-367469594690.asia-south1.run.app@evil.example']) {
    const result = await proxyDigitalTwin(new Request('https://app2.thatcampus.com/readyz'), { DT_ORIGIN_URL: target }, () => { throw new Error('Must not proxy'); });
    assert.equal(result.status, 503);
  }
});

test('native bearer and browser cookie/Origin remain separate and forwarded without invention', async () => {
  for (const headers of [{ Authorization: 'Bearer opaque-native-session' }, { Cookie: 'thatcampus_dt_session=opaque', Origin: 'https://app2.thatcampus.com', 'X-CSRFToken': 'proof' }]) {
    const response = await proxyDigitalTwin(new Request('https://app2.thatcampus.com/api/v1/workspace?current=1', { headers }), env, async (request, options) => {
      assert.equal(request.url, `${env.DT_ORIGIN_URL}/api/v1/workspace?current=1`);
      for (const [key, value] of Object.entries(headers)) assert.equal(request.headers.get(key), value);
      assert.equal(request.headers.has('authorization'), 'Authorization' in headers);
      assert.equal(request.headers.has('cookie'), 'Cookie' in headers);
      assert.equal(request.redirect, 'manual');
      assert.equal(options.cf.cacheTtl, 0);
      return new Response('ok', { headers: { 'Set-Cookie': 'thatcampus_dt_session=new; Secure; HttpOnly', 'Cache-Control': 'private, no-store' } });
    });
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  }
});

test('body/HTTP errors stream once and trusted client IP replaces spoofed forwarding headers', async () => {
  let calls = 0;
  const result = await proxyDigitalTwin(new Request('https://app2.thatcampus.com/api/v1/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '2001:db8::1', 'X-Forwarded-For': 'spoofed' }, body: '{"value":1}' }), env, async request => {
    calls++; assert.equal(await request.text(), '{"value":1}');
    assert.equal(request.headers.get('X-Forwarded-For'), '2001:db8::1');
    return Response.json({ detail: 'Current access denied' }, { status: 403 });
  });
  assert.equal(calls, 1); assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { detail: 'Current access denied' });
});

test('an interrupted write is never replayed or reported as a confirmed failure', async () => {
  let calls = 0;
  const result = await proxyDigitalTwin(new Request('https://app2.thatcampus.com/api/v1/action', { method: 'POST', body: '{}' }), env, async () => { calls++; throw new Error('Private upstream diagnostic'); });
  assert.equal(calls, 1); assert.equal(result.status, 503);
  const payload = await result.text(); assert.match(payload, /may have completed/); assert.doesNotMatch(payload, /Private upstream/);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
});

test('deployment owns a separate Worker and only the new custom domain', () => {
  const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'thatcampus-dt-edge');
  assert.deepEqual(config.routes, [{ pattern: 'app2.thatcampus.com', custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.cache, { enabled: false });
});

test('origin responses including readiness failures and HTML never enter gateway caches', async () => {
  for (const [path, status] of [['/readyz',503],['/api/v1/workspace',200],['/',200]]) {
    const result = await proxyDigitalTwin(new Request('https://app2.thatcampus.com'+path), env, async () => new Response('body', {status, headers:{'Cache-Control':'public, max-age=14400'}}));
    assert.equal(result.status,status); assert.equal(await result.text(),'body');
    assert.equal(result.headers.get('Cache-Control'),'private, no-store');
    assert.equal(result.headers.get('Cloudflare-CDN-Cache-Control'),'no-store');
  }
});
