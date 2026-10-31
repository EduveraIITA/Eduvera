import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createCampusApiClient, type CampusApiOptions, type CampusDownloadAdapter, type CampusFetch, type CampusResponse } from '../src/lib/api-client';

const origin = 'https://campus.example';
const signedCsrf = 's:session-csrf.signature';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(fetcher?: CampusFetch, limits: Pick<CampusApiOptions, 'maxJsonBytes' | 'maxDownloadBytes'> = {}) {
  let csrf: string | null = signedCsrf, csrfReads = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createCampusApiClient({ origin, ...limits, cookieSession: { readCsrfToken: () => { csrfReads++; return csrf; } }, fetcher: (url, init) => {
    calls.push({ url, init }); return fetcher ? fetcher(url, init) : Promise.resolve(json({ ok: true }));
  } });
  return { client, calls, setCsrf(value: string | null) { csrf = value; }, csrfReads: () => csrfReads };
}
function fileAdapter(overrides: Partial<CampusDownloadAdapter> = {}) {
  const events: string[] = [], filenames: string[] = [], written: Uint8Array[] = [];
  const adapter: CampusDownloadAdapter = { isAvailable: () => Promise.resolve(true), createTemporaryFile: filename => {
    events.push('create'); filenames.push(filename);
    return { uri: 'blob:https://campus.example/private-file', write: bytes => { events.push('write'); written.push(bytes); return Promise.resolve(); }, delete: () => { events.push('delete'); } };
  }, share: (_uri, options) => { events.push(`share:${options.mimeType}`); return Promise.resolve(); }, ...overrides };
  return { adapter, events, filenames, written };
}

test('browser bootstrap permits cookie session reads while all campus data stays blocked', async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.apiFetch('/api/v1/workspace'), /Confirm the active campus environment/);
  assert.throws(() => client.captureApiContext(), /context changed/);
  for (const path of ['/api/v1/auth/csrf/', '/api/v1/auth/session/', '/api/v1/auth/me/', '/api/v1/auth/execution-environment/']) await client.apiFetch(path);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(new Headers(call.init.headers).get('Authorization'), null);
    assert.equal(new Headers(call.init.headers).get('X-ThatCampus-Execution-Environment'), null);
  }
  client.bindCookieSession('live:campus');
  assert.deepEqual(await client.apiFetch('/api/v1/workspace'), { ok: true });
});

test('cookie transport owns credentials and namespace headers while retaining command identity', async () => {
  const { client, calls } = fixture(); client.bindCookieSession('scenario:one:run:two');
  await client.apiFetch('/api/v1/attendance/registers/one/', { method: 'POST', body: '{}', credentials: 'omit', redirect: 'follow', cache: 'force-cache', headers: {
    Authorization: 'Bearer attacker', Cookie: 'session=attacker', 'X-ThatCampus-Execution-Environment': 'live:wrong', 'X-CSRFToken': 'unsigned-attacker', 'Idempotency-Key': 'original-command',
  } });
  const call = calls[0]!, headers = new Headers(call.init.headers);
  assert.equal(call.url, `${origin}/api/v1/attendance/registers/one/`);
  assert.equal(call.init.credentials, 'same-origin'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
  assert.equal(headers.get('Authorization'), null); assert.equal(headers.get('Cookie'), null);
  assert.equal(headers.get('X-ThatCampus-Execution-Environment'), 'scenario:one:run:two');
  assert.equal(headers.get('X-CSRFToken'), signedCsrf); assert.equal(headers.get('Idempotency-Key'), 'original-command');
  assert.equal(headers.get('Content-Type'), 'application/json');
});

test('browser auth and Simulation control-plane reads carry cookies without a domain namespace', async () => {
  const { client, calls } = fixture(); client.bindCookieSession('scenario:one:run:two');
  for (const path of ['/api/v1/auth/me/', '/api/v1/auth/execution-environment/', '/api/v1/schools/campus/simulation/runs/']) {
    await client.apiFetch(path, { headers: { 'X-ThatCampus-Execution-Environment': 'caller-world' } });
  }
  assert.ok(calls.every(call => call.init.credentials === 'same-origin' && new Headers(call.init.headers).get('X-ThatCampus-Execution-Environment') === null));
  await client.apiFetch('/api/v1/auth/active-school/', { method: 'POST', body: '{"school_id":"campus"}' });
  assert.equal(new Headers(calls.at(-1)!.init.headers).get('X-CSRFToken'), signedCsrf);
  assert.equal(new Headers(calls.at(-1)!.init.headers).get('X-ThatCampus-Execution-Environment'), null);
});

test('unsafe requests read the current signed CSRF cookie; safe methods never forward an override', async () => {
  const state = fixture(); state.client.bindCookieSession('live:campus');
  for (const method of ['GET', 'HEAD', 'OPTIONS']) await state.client.apiFetch('/api/v1/records/', { method, headers: { 'X-CSRFToken': 'caller-token' } });
  assert.equal(state.csrfReads(), 0);
  assert.ok(state.calls.every(call => new Headers(call.init.headers).get('X-CSRFToken') === null));
  for (const method of ['POST', 'put', 'PATCH', 'DELETE']) {
    const fresh = `s:${method}-secret.signature`; state.setCsrf(fresh);
    await state.client.apiFetch('/api/v1/records/', { method, body: '{}' });
    assert.equal(new Headers(state.calls.at(-1)!.init.headers).get('X-CSRFToken'), fresh);
  }
  assert.equal(state.csrfReads(), 4);
});

test('missing CSRF blocks unsafe I/O even with a caller token, except the exact browser logout endpoint', async () => {
  const state = fixture(); state.client.bindCookieSession('live:campus'); state.setCsrf(null);
  for (const path of ['/api/v1/auth/login/', '/api/v1/auth/active-school/', '/api/v1/records/', '/api/v1/auth/logout', '/api/v1/auth/logout/extra/']) {
    await assert.rejects(state.client.apiFetch(path, { method: 'POST', body: '{}', headers: { 'X-CSRFToken': 'caller-token' } }), /secure session token is unavailable/, path);
  }
  assert.equal(state.calls.length, 0);
  await state.client.apiFetch('/api/v1/auth/logout/', { method: 'POST', body: '{}' });
  assert.equal(state.calls.length, 1); assert.equal(new Headers(state.calls[0]!.init.headers).get('X-CSRFToken'), null);
});

test('browser origin is pinned and native bearer bindings and endpoints are rejected before transport', async () => {
  const { client, calls } = fixture(); client.bindCookieSession('live:campus'); const context = client.captureApiContext();
  assert.throws(() => client.bindApiSession('tc_native_secret', 'live:other'), /cannot bind a native Bearer/);
  assert.throws(() => client.setApiOrigin('https://outside.example'), /same origin/);
  client.setApiOrigin(`${origin}/`); context.assertCurrent(); assert.equal(client.getApiOrigin(), origin);
  for (const path of ['/api/v1/auth/native', '/api/v1/auth/native/session/', '/api/v1/auth/native/login/', '/api/v1/auth/native/logout/', '/api/v1/auth/native?next=login']) await assert.rejects(client.apiFetch(path), /Native Bearer authentication is unavailable/, path);
  await assert.rejects(client.revokeCurrentNativeSession(), /Native Bearer sessions are unavailable/);
  assert.equal(calls.length, 0);
});

test('a bad public browser sign-in or account ceremony never expires the current binding', async () => {
  let expired = 0;
  const { client } = fixture(() => Promise.resolve(json({ detail: 'Credentials refused.' }, 401))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => { expired++; }, () => {});
  for (const path of ['/api/v1/auth/login/', '/api/v1/auth/mfa/login/', '/api/v1/auth/register/', '/api/v1/auth/google/', '/api/v1/auth/password-reset/request/', '/api/v1/auth/password-reset/confirm/']) {
    await assert.rejects(client.apiFetch(path, { method: 'POST', body: '{}' }), cause => cause instanceof ApiError && cause.status === 401);
  }
  assert.equal(expired, 0); client.captureApiContext().assertCurrent();
});

test('a current protected 401 preserves its HTTP refusal and leaves the expired cookie binding blocked', async () => {
  let expired = 0;
  const { client, calls } = fixture(() => Promise.resolve(json({ detail: 'Session expired.' }, 401))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => { expired++; client.bindApiSession(null, null); }, () => {});
  await assert.rejects(client.apiFetch('/api/v1/auth/me/'), cause => cause instanceof ApiError && cause.status === 401 && cause.message === 'Session expired.');
  assert.equal(expired, 1);
  await assert.rejects(client.apiFetch('/api/v1/workspace'), /Confirm the active campus environment/);
  assert.throws(() => client.captureApiContext(), /context changed/); assert.equal(calls.length, 1);
});

for (const status of [200, 401]) test(`obsolete cookie auth ${status} cannot reveal old data or expire a newly confirmed account`, async () => {
  const late = deferred<CampusResponse>(); let expired = 0;
  const { client, calls } = fixture(() => late.promise); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => { expired++; }, () => {});
  const request = client.apiFetch('/api/v1/auth/me/');
  client.bindCookieSession('live:campus'); // Same namespace, different account/session generation.
  assert.equal(calls[0]!.init.signal?.aborted, false, 'cookie account responses must settle even when their JS result is obsolete');
  late.resolve(json({ private_account: 'previous learner', detail: 'private previous error' }, status));
  await assert.rejects(request, cause => cause instanceof Error && /context changed/.test(cause.message) && !/previous learner|private previous/.test(cause.message));
  assert.equal(expired, 0);
});

test('a cookie auth body is rechecked after reading, before its stale 401 callback can run', async () => {
  const reading = deferred<void>(); let stream!: ReadableStreamDefaultController<Uint8Array>, expired = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, pull() { reading.resolve(); } });
  const { client } = fixture(() => Promise.resolve(new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } }))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => { expired++; }, () => {});
  const request = client.apiFetch('/api/v1/auth/session/'); await reading.promise;
  client.bindCookieSession('scenario:new:run:one'); stream.enqueue(new TextEncoder().encode('{"detail":"old session expired"}')); stream.close();
  await assert.rejects(request, /context changed/); assert.equal(expired, 0);
});

test('current domain environment conflict blocks campus traffic and requests verification once', async () => {
  let changed = 0;
  const { client, calls } = fixture(() => Promise.resolve(json({ error: { code: 'execution_environment_changed', detail: 'Confirm the selected environment.' } }, 409))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => {}, () => { changed++; });
  await assert.rejects(client.apiFetch('/api/v1/workspace'), cause => cause instanceof ApiError && cause.status === 409);
  assert.equal(changed, 1); await assert.rejects(client.apiFetch('/api/v1/workspace'), /Confirm the active campus environment/); assert.equal(calls.length, 1);
});

test('an obsolete domain 409 cannot block or invoke callbacks for the newly confirmed world', async () => {
  const late = deferred<CampusResponse>(); let changed = 0, requests = 0;
  const { client, calls } = fixture(() => requests++ === 0 ? late.promise : Promise.resolve(json({ current: true }))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => {}, () => { changed++; });
  const request = client.apiFetch('/api/v1/workspace'); client.bindCookieSession('scenario:new:run:one');
  assert.equal(calls[0]!.init.signal?.aborted, true);
  late.resolve(json({ error: { code: 'execution_environment_changed' } }, 409)); await assert.rejects(request, /context changed/);
  assert.equal(changed, 0); assert.deepEqual(await client.apiFetch('/api/v1/workspace'), { current: true });
});

test('ordinary revision conflicts and auth or Simulation control-plane 409s do not trigger world recovery', async () => {
  let changed = 0;
  const { client } = fixture(url => Promise.resolve(json({ error: { code: url.endsWith('/records/') ? 'revision_conflict' : 'execution_environment_changed' } }, 409))); client.bindCookieSession('live:campus');
  client.setApiCallbacks(() => {}, () => { changed++; });
  for (const path of ['/api/v1/records/', '/api/v1/auth/me/', '/api/v1/schools/campus/simulation/runs/']) await assert.rejects(client.apiFetch(path), cause => cause instanceof ApiError && cause.status === 409);
  assert.equal(changed, 0); client.captureApiContext().assertCurrent();
});

test('unavailable and locally signed-out cookie states block data but keep account recovery available', async () => {
  const { client, calls } = fixture(); client.bindCookieSession('scenario:one:run:two', true);
  await assert.rejects(client.apiFetch('/api/v1/workspace'), /Confirm the active campus environment/);
  await client.apiFetch('/api/v1/auth/execution-environment/');
  await client.apiFetch('/api/v1/schools/campus/simulation/runs/');
  client.bindCookieSession('live:campus'); client.bindApiSession(null, null);
  await assert.rejects(client.apiFetch('/api/v1/workspace'), /Confirm the active campus environment/);
  await client.apiFetch('/api/v1/auth/session/');
  assert.equal(calls.length, 3); assert.throws(() => client.captureApiContext(), /context changed/);
});

test('blocking aborts domain requests while an outstanding cookie-setting response settles with an obsolete JS result', async () => {
  const loginResponse = deferred<CampusResponse>(), domainResponse = deferred<CampusResponse>();
  const { client, calls } = fixture(url => url.endsWith('/auth/login/') ? loginResponse.promise : domainResponse.promise); client.bindCookieSession('live:campus');
  const login = client.apiFetch('/api/v1/auth/login/', { method: 'POST', body: '{}' });
  const domain = client.apiFetch('/api/v1/workspace'); client.blockApiRequests();
  assert.equal(calls[0]!.init.signal?.aborted, false); assert.equal(calls[1]!.init.signal?.aborted, true);
  loginResponse.resolve(json({ user: { id: 'previous login operation' } })); domainResponse.resolve(json({ private: 'old campus' }));
  await assert.rejects(login, /context changed/); await assert.rejects(domain, /context changed/);
});

test('cookie downloads need confirmed authentication, retain world headers, and clean temporary bytes', async () => {
  const { client, calls } = fixture(() => Promise.resolve(new Response('%PDF-1.7 private record', { headers: { 'Content-Type': 'application/pdf' } })));
  const files = fileAdapter();
  await assert.rejects(client.downloadCampusFile('/api/v1/auth/private-file/', 'record.pdf', files.adapter), /Sign in/);
  assert.equal(calls.length, 0);
  client.bindCookieSession('scenario:one:run:two');
  await client.downloadCampusFile('/api/v1/files/one/', '../../record.pdf', files.adapter);
  assert.deepEqual(files.events, ['create', 'write', 'share:application/pdf', 'delete']); assert.deepEqual(files.filenames, ['record.pdf']);
  assert.equal(new TextDecoder().decode(files.written[0]), '%PDF-1.7 private record');
  assert.equal(calls[0]!.init.credentials, 'same-origin'); assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), null); assert.equal(new Headers(calls[0]!.init.headers).get('X-ThatCampus-Execution-Environment'), 'scenario:one:run:two');
  client.bindApiSession(null, null);
  await assert.rejects(client.downloadCampusFile('/api/v1/auth/private-file/', 'record.pdf', files.adapter), /Sign in/);
  assert.equal(calls.length, 1, 'local logout clears the authenticated download capability even for auth paths');
});

test('cookie binding changes during download availability or byte writing prevent presentation', async () => {
  const availability = deferred<boolean>(); const first = fixture(); first.client.bindCookieSession('live:campus');
  const waiting = fileAdapter({ isAvailable: () => availability.promise });
  const request = first.client.downloadCampusFile('/api/v1/files/one/', 'record.pdf', waiting.adapter);
  first.client.bindCookieSession('scenario:new:run:one'); availability.resolve(true);
  await assert.rejects(request, /context changed/); assert.equal(first.calls.length, 0); assert.deepEqual(waiting.events, []);
  const second = fixture(() => Promise.resolve(new Response('%PDF-1.7 old file', { headers: { 'Content-Type': 'application/pdf' } }))); second.client.bindCookieSession('live:campus');
  let deleted = 0, shared = 0;
  const writing = fileAdapter({ createTemporaryFile: () => ({ uri: 'blob:https://campus.example/old-file', write: async () => { second.client.bindCookieSession('live:campus'); }, delete: () => { deleted++; } }), share: async () => { shared++; } });
  await assert.rejects(second.client.downloadCampusFile('/api/v1/files/one/', 'record.pdf', writing.adapter), /context changed/);
  assert.equal(shared, 0); assert.equal(deleted, 1);
});

test('cookie downloads preserve byte limits and refuse omitted Simulation source content before temporary storage', async () => {
  for (const response of [new Response('%PDF-1.7 too large', { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '999' } }), new Response('%PDF-1.7 streamed too large', { headers: { 'Content-Type': 'application/pdf' } }), new Response('placeholder', { headers: { 'Content-Type': 'application/pdf', 'X-ThatCampus-Source-Content-Omitted': 'true' } })]) {
    const { client } = fixture(() => Promise.resolve(response), { maxDownloadBytes: 8 }); client.bindCookieSession('scenario:one:run:two'); const files = fileAdapter();
    await assert.rejects(client.downloadCampusFile('/api/v1/files/one/', 'original.pdf', files.adapter), /too large|file metadata only/);
    assert.deepEqual(files.events, []);
  }
});

test('cookie transport bounds JSON and refuses proxy HTML, redirects and non-API destinations', async () => {
  let expired = 0;
  const large = fixture(() => Promise.resolve(json({ private: 'x'.repeat(100) })), { maxJsonBytes: 16 }); large.client.bindCookieSession('live:campus');
  await assert.rejects(large.client.apiFetch('/api/v1/workspace'), /too large/);
  const html = fixture(() => Promise.resolve(new Response('<html>private proxy page</html>', { status: 401, headers: { 'Content-Type': 'text/html' } }))); html.client.bindCookieSession('live:campus'); html.client.setApiCallbacks(() => { expired++; }, () => {});
  await assert.rejects(html.client.apiFetch('/api/v1/auth/me/'), cause => cause instanceof ApiError && !cause.message.includes('private proxy')); assert.equal(expired, 0);
  const redirected = json({ private: true }); Object.defineProperty(redirected, 'redirected', { value: true });
  const redirect = fixture(() => Promise.resolve(redirected)); redirect.client.bindCookieSession('live:campus'); await assert.rejects(redirect.client.apiFetch('/api/v1/workspace'), /redirected/);
  const paths = fixture(); paths.client.bindCookieSession('live:campus');
  for (const path of ['https://outside.example/api/v1/records/', '//outside.example/api/v1/records/', '/api/v1/%2e%2e/auth/me/', '/api/v1/records/#private']) await assert.rejects(paths.client.apiFetch(path), /outside the campus API/);
  assert.equal(paths.calls.length, 0);
});
