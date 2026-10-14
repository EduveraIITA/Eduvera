import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker, { originUrl, rewriteOriginLocation } from '../src/index.mjs';

const appOrigin = 'https://eduvera-stage-367469594690.asia-south1.run.app';
const siteOrigin = 'https://thatcampus-web-367469594690.asia-south1.run.app';
const env = { APP_ORIGIN_URL: appOrigin, SITE_ORIGIN_URL: siteOrigin };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('maps the public path and query to the fixed Cloud Run origin', () => {
  assert.equal(originUrl('https://thatcampus.com/privacy', siteOrigin).toString(), `${siteOrigin}/privacy`);
  for (const unsafe of ['http://service.run.app', 'https://example.com', `${appOrigin}/nested`, `${appOrigin}?x=1`]) {
    assert.throws(() => originUrl('https://thatcampus.com/', unsafe));
  }
});

test('redirects www to the canonical host without losing path or query', async () => {
  const response = await worker.fetch(new Request('https://www.thatcampus.com/features?view=all'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://thatcampus.com/features?view=all');
});

test('rejects unknown hosts instead of becoming an open proxy', async () => {
  const response = await worker.fetch(new Request('https://preview.example/'), env);
  assert.equal(response.status, 421);
});

test('forwards application traffic through the branded app host', async () => {
  let forwarded;
  globalThis.fetch = async request => {
    forwarded = request;
    return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const response = await worker.fetch(new Request('https://app.thatcampus.com/api/action', {
    method: 'POST', body: '{"status":"present"}', headers: {
      'content-type': 'application/json',
      origin: 'https://app.thatcampus.com',
    },
  }), env);
  assert.equal(response.status, 201);
  assert.equal(forwarded.url, `${appOrigin}/api/action`);
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'app.thatcampus.com');
  assert.equal(forwarded.headers.get('x-forwarded-proto'), 'https');
  assert.equal(forwarded.headers.get('origin'), 'https://app.thatcampus.com');
  assert.equal(await forwarded.text(), '{"status":"present"}');
});

test('removes Origin only from application static asset requests', async () => {
  let forwarded;
  globalThis.fetch = async request => {
    forwarded = request;
    return new Response('console.log("loaded")', { status: 200 });
  };
  const response = await worker.fetch(new Request('https://app.thatcampus.com/assets/app.js', {
    headers: { origin: 'https://app.thatcampus.com' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, `${appOrigin}/assets/app.js`);
  assert.equal(forwarded.headers.get('origin'), null);
});

test('rewrites only Cloud Run redirects back to the matching public host', () => {
  const internal = rewriteOriginLocation(new Response(null, { status: 302, headers: { location: `${appOrigin}/login` } }), appOrigin, 'app.thatcampus.com');
  assert.equal(internal.headers.get('location'), 'https://app.thatcampus.com/login');
  const external = rewriteOriginLocation(new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/' } }), appOrigin, 'app.thatcampus.com');
  assert.equal(external.headers.get('location'), 'https://accounts.google.com/');
});

test('keeps the public website on its separate marketing origin', async () => {
  let forwarded;
  globalThis.fetch = async request => {
    forwarded = request;
    return new Response('<h1>ThatCampus</h1>', { status: 200 });
  };
  const response = await worker.fetch(new Request('https://thatcampus.com/'), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, `${siteOrigin}/`);
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'thatcampus.com');
});
