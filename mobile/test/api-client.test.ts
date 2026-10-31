import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiConnectionError, ApiError, createCampusApiClient, type CampusDownloadAdapter, type CampusFetch, type CampusResponse } from '../src/lib/api-client';
import { attendanceOfflineFallbackAllowed } from '../src/lib/attendance-offline-policy';
import { browserAuthMutation } from '../src/auth/web-auth-mutation';

const origin = 'https://campus.example';
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(fetcher?: CampusFetch, extra: { maxDownloadBytes?: number; maxJsonBytes?: number; timeoutMs?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createCampusApiClient({ origin, ...extra, fetcher: (url, init) => { calls.push({ url, init }); return fetcher ? fetcher(url, init) : Promise.resolve(json({ ok: true })); } });
  client.bindApiSession('old-credential', 'live:campus');
  return { client, calls };
}
function downloadAdapter(overrides: Partial<CampusDownloadAdapter> = {}) {
  const events: string[] = [], written: Uint8Array[] = [], filenames: string[] = [];
  const adapter: CampusDownloadAdapter = { isAvailable: () => Promise.resolve(true), createTemporaryFile: name => {
    filenames.push(name); events.push('create'); return { uri: 'file:///private/cache/campus-file.pdf', write: bytes => { events.push('write'); written.push(bytes); return Promise.resolve(); }, delete: () => { events.push('delete'); } };
  }, share: (_uri, options) => { events.push(`share:${options.mimeType}`); return Promise.resolve(); }, ...overrides };
  return { adapter, events, written, filenames };
}

for (const status of [200, 401]) test(`late auth ${status} after account rebind cannot reveal old content or expire the new session`, async () => {
  const late = deferred<CampusResponse>(); let expired = 0;
  const { client } = fixture(() => late.promise);
  client.setApiCallbacks(() => { expired++; }, () => {});
  const request = client.apiFetch('/api/v1/auth/me/');
  client.bindApiSession('new-credential', 'live:new-campus');
  late.resolve(json({ private_account: 'old-account', detail: 'private old failure' }, status));
  await assert.rejects(request, error => error instanceof Error && /context changed/.test(error.message) && !/old-account|private old/.test(error.message));
  assert.equal(expired, 0);
});
test('a late auth body is checked again after reading, not just at response headers', async () => {
  const reading = deferred<void>(); let controller!: ReadableStreamDefaultController<Uint8Array>, expired = 0;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading.resolve(); } });
  const { client } = fixture(() => Promise.resolve(new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } })));
  client.setApiCallbacks(() => { expired++; }, () => {});
  const request = client.apiFetch('/api/v1/auth/native/session/'); await reading.promise;
  client.bindApiSession('new-credential', 'live:new-campus');
  controller.enqueue(new TextEncoder().encode('{"detail":"old account expired"}')); controller.close();
  await assert.rejects(request, /context changed/); assert.equal(expired, 0);
});
test('a late auth failure after origin change cannot affect the new origin', async () => {
  const late = deferred<CampusResponse>(); const { client, calls } = fixture(() => late.promise); let expired = 0;
  client.setApiCallbacks(() => { expired++; }, () => {});
  const request = client.apiFetch('/api/v1/auth/me/');
  client.setApiOrigin('https://other-campus.example'); client.bindApiSession('new-credential', 'live:other-campus'); late.resolve(json({ detail: 'Expired' }, 401));
  await assert.rejects(request, /context changed/); assert.equal(expired, 0); assert.equal(calls[0]!.url, `${origin}/api/v1/auth/me/`);
});
test('late aborts are reported as an obsolete context rather than a new account error', async () => {
  const late = deferred<CampusResponse>(); const { client } = fixture(() => late.promise);
  const request = client.apiFetch('/api/v1/auth/me/'); client.bindApiSession('new-credential', 'live:other'); late.reject(new DOMException('Old fetch aborted', 'AbortError'));
  await assert.rejects(request, /context changed/);
});
test('the client owns credential, world, cookie and transport policy headers', async () => {
  const { client, calls } = fixture(); client.bindApiSession('simulation-credential', 'scenario:a:run:one');
  await client.apiFetch('/api/v1/notices', { method: 'POST', body: '{}', credentials: 'include', redirect: 'follow', headers: { Authorization: 'Bearer stale', Cookie: 'browser-cookie', 'X-ThatCampus-Execution-Environment': 'live:wrong' } });
  const call = calls[0]!, headers = new Headers(call.init.headers);
  assert.equal(call.url, `${origin}/api/v1/notices`); assert.equal(headers.get('Authorization'), 'Bearer simulation-credential'); assert.equal(headers.get('Cookie'), null);
  assert.equal(headers.get('X-ThatCampus-Execution-Environment'), 'scenario:a:run:one'); assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
  assert.ok(!call.url.includes('credential'));
  await client.apiFetch('/api/v1/auth/me/', { headers: { 'X-ThatCampus-Execution-Environment': 'stale', Authorization: 'Bearer stale' } });
  assert.equal(new Headers(calls[1]!.init.headers).get('X-ThatCampus-Execution-Environment'), null);
  client.bindApiSession(null, null); await client.apiFetch('/api/v1/auth/native/login/', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer stale' } });
  assert.equal(new Headers(calls[2]!.init.headers).get('Authorization'), null);
});
test('public native auth ceremonies preserve existing bearer for server-side Simulation refusal', async () => {
  let expired = 0; const { client, calls } = fixture(() => Promise.resolve(json({ detail: 'Account changes require Live.' }, 403)));
  client.bindApiSession('simulation-credential', 'scenario:a:run:one'); client.setApiCallbacks(() => { expired++; }, () => {});
  for (const path of ['/api/v1/auth/native/register/', '/api/v1/auth/native/password-reset/request/']) {
    await assert.rejects(client.apiFetch(path, { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 403);
  }
  assert.ok(calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer simulation-credential')); assert.equal(expired, 0);
});
test('a current session 401 expires only that binding, while bad sign-in credentials do not', async () => {
  let expired = 0; const { client } = fixture(() => Promise.resolve(json({ detail: 'Authentication failed.' }, 401)));
  client.setApiCallbacks(() => { expired++; client.bindApiSession(null, null); }, () => {});
  await assert.rejects(client.apiFetch('/api/v1/auth/me/'), error => error instanceof ApiError && error.status === 401); assert.equal(expired, 1);
  await assert.rejects(client.apiFetch('/api/v1/auth/native/login/', { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 401); assert.equal(expired, 1);
});
test('invalid invitation credentials never expire the account already signed in', async () => {
  let expired = 0; const { client, calls } = fixture(() => Promise.resolve(json({ detail: 'Invitation credentials were not accepted.' }, 401)));
  client.setApiCallbacks(() => { expired++; }, () => {});
  for (const path of ['/api/v1/invitations/accept/','/api/v1/invitations/recipient-proof/','/api/v1/auth/native/invitations/accept/']) await assert.rejects(client.apiFetch(path,{method:'POST',body:'{}'}), error => error instanceof ApiError && error.status === 401);
  assert.equal(expired,0); assert.ok(calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer old-credential'));
  assert.ok(calls.every(call => new Headers(call.init.headers).get('X-ThatCampus-Execution-Environment') === null));
});
test('an unavailable or unconfirmed world blocks campus data before transport but leaves auth recovery available', async () => {
  const { client, calls } = fixture(); client.bindApiSession('credential', 'scenario:a:run:one', true);
  await assert.rejects(client.apiFetch('/api/v1/notices'), /Confirm the active campus/); assert.equal(calls.length, 0);
  await client.apiFetch('/api/v1/auth/native/session/'); assert.equal(calls.length, 1);
});
test('public visit onboarding failures preserve the session while authenticated joins still expire it', async () => {
  let expired = 0;
  const { client, calls } = fixture(() => Promise.resolve(json({ detail: 'Visit link was not accepted.' }, 401)));
  client.setApiCallbacks(() => { expired++; }, () => {});
  for (const prefix of ['/api/v1/auth/', '/api/v1/auth/native/']) {
    for (const action of ['preview', 'proof', 'account']) {
      await assert.rejects(client.apiFetch(`${prefix}visit-onboarding/${action}/`, { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 401);
    }
  }
  assert.equal(expired, 0);
  assert.ok(calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer old-credential'));
  for (const action of ['join', 'preview/private', 'accounting']) {
    await assert.rejects(client.apiFetch(`/api/v1/auth/visit-onboarding/${action}/`, { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 401);
  }
  assert.equal(expired, 3);
});
test('current domain environment conflict blocks data and requests recovery, preserving the HTTP refusal', async () => {
  let changed = 0; const { client, calls } = fixture(() => Promise.resolve(json({ error: { code: 'execution_environment_changed', detail: 'Confirm current environment.' } }, 409)));
  client.setApiCallbacks(() => {}, () => { changed++; });
  await assert.rejects(client.apiFetch('/api/v1/notices'), error => error instanceof ApiError && error.status === 409); assert.equal(changed, 1);
  await assert.rejects(client.apiFetch('/api/v1/notices'), /Confirm the active campus/); assert.equal(calls.length, 1);
});
test('an obsolete domain conflict cannot block a newly bound world', async () => {
  const late = deferred<CampusResponse>(); let changed = 0, index = 0;
  const { client } = fixture(() => index++ === 0 ? late.promise : Promise.resolve(json({ current: true })));
  client.setApiCallbacks(() => {}, () => { changed++; });
  const request = client.apiFetch('/api/v1/notices'); client.bindApiSession('new-credential', 'scenario:b:run:two');
  late.resolve(json({ error: { code: 'execution_environment_changed' } }, 409)); await assert.rejects(request, /context changed/);
  assert.equal(changed, 0); assert.deepEqual(await client.apiFetch('/api/v1/notices'), { current: true });
});
test('control-plane conflicts do not masquerade as domain context changes', async () => {
  let changed = 0; const { client } = fixture(() => Promise.resolve(json({ error: { code: 'execution_environment_changed' } }, 409)));
  client.setApiCallbacks(() => {}, () => { changed++; });
  await assert.rejects(client.apiFetch('/api/v1/auth/me/'), error => error instanceof ApiError && error.status === 409); assert.equal(changed, 0);
});
for (const [body, type] of [['<!doctype html><html>private proxy error</html>', 'text/html'], ['<!doctype html><html>private proxy error</html>', 'application/json'], ['not-json', 'application/json'], [new Uint8Array([137, 80, 78, 71]), 'image/png']] as const) test(`unexpected ${type} response fails without exposing proxy/binary content`, async () => {
  const { client } = fixture(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': type } })));
  await assert.rejects(client.apiFetch('/api/v1/notices'), error => error instanceof ApiError && !/private proxy/.test(error.message));
});
const unavailableStatuses = [502, 503, 504, ...Array.from({ length: 11 }, (_, index) => 520 + index)];
for (const status of unavailableStatuses) test(`unreadable gateway ${status} preserves status and distinguishes reads from unconfirmed writes`, async () => {
  for (const [body, type] of [['<html>private gateway diagnostics</html>', 'text/html'], ['<html>private gateway diagnostics</html>', 'application/json'], ['private broken JSON', 'application/json'], ['', 'text/plain'], ['', 'application/json']] as const) {
    for (const method of ['GET', 'post']) {
      let expired = 0, changed = 0;
      const { client, calls } = fixture(() => Promise.resolve(new Response(body, { status, headers: { 'Content-Type': type } })));
      client.setApiCallbacks(() => { expired++; }, () => { changed++; });
      await assert.rejects(client.apiFetch('/api/v1/workspace', { method, ...(method === 'post' ? { body: '{"command_id":"original"}' } : {}) }), cause => {
        assert.ok(cause instanceof ApiConnectionError); assert.equal(cause.status, status); assert.equal('details' in cause, false);
        assert.match(cause.message, /campus service is temporarily unavailable/); assert.doesNotMatch(cause.message, /private|HTML|JSON/);
        if (method === 'GET') assert.doesNotMatch(cause.message, /action|completed|repeating/);
        else assert.match(cause.message, /may have completed; refresh before repeating/);
        return true;
      });
      assert.equal(calls.length, 1, 'the transport never retries a read or mutation'); assert.equal(expired, 0); assert.equal(changed, 0);
      client.captureApiContext().assertCurrent();
    }
  }
});
test('verified JSON errors and unrelated HTTP statuses do not become retryable connection failures', async () => {
  for (const status of unavailableStatuses) {
    const details = { error: { code: 'owning_failure', message: 'The owning service declined this request.' } };
    const { client } = fixture(() => Promise.resolve(json(details, status)));
    await assert.rejects(client.apiFetch('/api/v1/workspace'), cause => {
      assert.ok(cause instanceof ApiError); assert.ok(!(cause instanceof ApiConnectionError));
      assert.equal(cause.status, status); assert.equal(cause.message, details.error.message); assert.deepEqual(cause.details, details); return true;
    });
  }
  for (const status of [401, 403, 404, 409, 500, 501, 505, 519, 531]) {
    let expired = 0, changed = 0;
    const { client } = fixture(() => Promise.resolve(new Response('<html>private gateway diagnostics</html>', { status, headers: { 'Content-Type': 'text/html' } })));
    client.setApiCallbacks(() => { expired++; }, () => { changed++; });
    await assert.rejects(client.apiFetch('/api/v1/workspace'), cause => cause instanceof ApiError && !(cause instanceof ApiConnectionError) && cause.status === status && !cause.message.includes('private'));
    assert.equal(expired, 0); assert.equal(changed, 0); client.captureApiContext().assertCurrent();
  }
});
test('HTML proxy 401 does not manufacture a session expiry', async () => {
  let expired = 0; const { client } = fixture(() => Promise.resolve(new Response('<html>proxy</html>', { status: 401, headers: { 'Content-Type': 'text/html' } })));
  client.setApiCallbacks(() => { expired++; }, () => {}); await assert.rejects(client.apiFetch('/api/v1/auth/me/'), ApiError); assert.equal(expired, 0);
});
test('JSON responses are bounded and empty 204 is accepted', async () => {
  const { client } = fixture(() => Promise.resolve(json({ content: 'x'.repeat(100) })), { maxJsonBytes: 20 }); await assert.rejects(client.apiFetch('/api/v1/notices'), /too large/);
  const empty = fixture(() => Promise.resolve(new Response(null, { status: 204 }))); assert.equal(await empty.client.apiFetch('/api/v1/auth/native/logout/', { method: 'POST' }), null);
});
test('redirects are disabled, and a transport that reports a followed redirect is refused', async () => {
  const followed = json({ private: true }); Object.defineProperty(followed, 'redirected', { value: true }); Object.defineProperty(followed, 'url', { value: 'https://outside.example/file' });
  const { client, calls } = fixture(() => Promise.resolve(followed)); await assert.rejects(client.apiFetch('/api/v1/notices'), /redirected/); assert.equal(calls[0]!.init.redirect, 'error');
});
test('requests cannot escape API paths through encoded dot segments or fragments', async () => {
  const { client, calls } = fixture();
  for (const path of ['/api/v1/auth/../agent/status', '/api/v1/%2e%2e/auth/me', '/api/v1/notices#private', '//outside.example/api/v1/notices', 'https://outside.example/api/v1/notices']) await assert.rejects(client.apiFetch(path), /outside the campus API/);
  assert.equal(calls.length, 0);
});
test('immediate local logout does not cancel remote revocation of the captured old credential', async () => {
  const late = deferred<CampusResponse>(); const { client, calls } = fixture(() => late.promise);
  const revocation = client.revokeCurrentNativeSession(); client.bindApiSession(null, null); client.setApiOrigin('https://other.example'); client.bindApiSession('new-credential', 'live:other');
  assert.equal(calls[0]!.url, `${origin}/api/v1/auth/native/logout/`); assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), 'Bearer old-credential'); assert.equal(calls[0]!.init.signal?.aborted, false);
  late.resolve(new Response(null, { status: 204 })); await revocation;
});

test('private binary download uses bound scope, shares only a local file, and deletes after the sheet closes', async () => {
  const closing = deferred<void>(), sharing = deferred<void>();
  const { client, calls } = fixture(() => Promise.resolve(new Response('%PDF-1.7 campus-file', { headers: { 'Content-Type': 'application/pdf' } })));
  const state = downloadAdapter({ share: (uri, options) => { assert.equal(uri, 'file:///private/cache/campus-file.pdf'); assert.equal(options.mimeType, 'application/pdf'); sharing.resolve(); return closing.promise; } });
  const download = client.downloadCampusFile('/api/v1/learning/files/one', '../../report.pdf', state.adapter); await sharing.promise;
  assert.deepEqual(state.events, ['create', 'write']); assert.equal(new TextDecoder().decode(state.written[0]), '%PDF-1.7 campus-file'); assert.deepEqual(state.filenames, ['report.pdf']);
  assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), 'Bearer old-credential'); assert.equal(new Headers(calls[0]!.init.headers).get('X-ThatCampus-Execution-Environment'), 'live:campus'); assert.equal(calls[0]!.init.redirect, 'error');
  closing.resolve(); await download; assert.deepEqual(state.events, ['create', 'write', 'delete']);
});
test('temporary downloads are deleted when native sharing fails', async () => {
  const { client } = fixture(() => Promise.resolve(new Response('%PDF-1.7 file', { headers: { 'Content-Type': 'application/pdf' } })));
  const state = downloadAdapter({ share: () => Promise.reject(new Error('Share sheet failed')) });
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /Share sheet failed/); assert.deepEqual(state.events, ['create', 'write', 'delete']);
});
test('account change during file writing prevents presentation and still deletes the temporary file', async () => {
  const { client } = fixture(() => Promise.resolve(new Response('%PDF-1.7 private old file', { headers: { 'Content-Type': 'application/pdf' } })));
  let shared = 0, deleted = 0;
  const state = downloadAdapter({ createTemporaryFile: () => ({ uri: 'file:///private/cache/one', write: () => { client.bindApiSession('new-credential', 'live:other'); return Promise.resolve(); }, delete: () => { deleted++; } }), share: () => { shared++; return Promise.resolve(); } });
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /context changed/); assert.equal(shared, 0); assert.equal(deleted, 1);
});
test('account change while checking share availability never starts a download in the new account', async () => {
  const { client, calls } = fixture(); const availability = deferred<boolean>();
  const state = downloadAdapter({ isAvailable: () => availability.promise });
  const download = client.downloadCampusFile('/api/v1/files/old', 'file.pdf', state.adapter); client.bindApiSession('new-credential', 'live:other'); availability.resolve(true);
  await assert.rejects(download, /context changed/); assert.equal(calls.length, 0); assert.deepEqual(state.events, []);
});
test('stale binary response cannot write or present the old account file', async () => {
  const late = deferred<CampusResponse>(), fetching = deferred<void>(); const { client } = fixture(() => { fetching.resolve(); return late.promise; }); const state = downloadAdapter();
  const download = client.downloadCampusFile('/api/v1/files/old', 'file.pdf', state.adapter); await fetching.promise; client.bindApiSession('new-credential', 'live:other'); late.resolve(new Response('%PDF-1.7 private old file', { headers: { 'Content-Type': 'application/pdf' } }));
  await assert.rejects(download, /context changed/); assert.deepEqual(state.events, []);
});
for (const [body, type] of [['<html>private proxy</html>', 'text/html'], ['{"private":"json"}', 'application/json'], ['<!doctype html><html>proxy</html>', 'application/pdf'], ['{"private":"json"}', 'application/octet-stream']] as const) test(`download rejects HTML/JSON (${type}) before private filesystem work`, async () => {
  const { client } = fixture(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': type } }))); const state = downloadAdapter();
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /requested file/); assert.deepEqual(state.events, []);
});
test('binary download limits declared and streamed size before writing a file', async () => {
  const declared = fixture(() => Promise.resolve(new Response('small', { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '999' } })), { maxDownloadBytes: 5 });
  const first = downloadAdapter(); await assert.rejects(declared.client.downloadCampusFile('/api/v1/files/one', 'file.pdf', first.adapter), /too large/); assert.deepEqual(first.events, []);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4, 5, 6])); }, cancel() { cancelled = true; } });
  const streamed = fixture(() => Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } })), { maxDownloadBytes: 5 }); const second = downloadAdapter();
  await assert.rejects(streamed.client.downloadCampusFile('/api/v1/files/one', 'file.bin', second.adapter), /too large/); assert.equal(cancelled, true); assert.deepEqual(second.events, []);
});
test('binary authentication failures use the same verified session expiry boundary', async () => {
  let expired = 0; const { client } = fixture(() => Promise.resolve(json({ detail: 'Session expired.' }, 401))); client.setApiCallbacks(() => { expired++; client.bindApiSession(null, null); }, () => {}); const state = downloadAdapter();
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), error => error instanceof ApiError && error.status === 401); assert.equal(expired, 1); assert.deepEqual(state.events, []);
});
test('downloading while signed out or while sharing is unavailable performs no request', async () => {
  const { client, calls } = fixture(), state = downloadAdapter({ isAvailable: () => Promise.resolve(false) });
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /sharing is unavailable/); assert.equal(calls.length, 0);
  client.bindApiSession(null, null); await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /Sign in/); assert.equal(calls.length, 0);
});
test('a partial filesystem write is cleaned up without opening the share sheet', async () => {
  const { client } = fixture(() => Promise.resolve(new Response('%PDF-1.7 file', { headers: { 'Content-Type': 'application/pdf' } })));
  let deleted = 0, shared = 0;
  const state = downloadAdapter({ createTemporaryFile: () => ({ uri: 'file:///private/cache/one', write: () => Promise.reject(new Error('Device storage is full')), delete: () => { deleted++; } }), share: () => { shared++; return Promise.resolve(); } });
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /storage is full/); assert.equal(deleted, 1); assert.equal(shared, 0);
});
test('context change during temporary-file creation cleans that file without writing or presenting it', async () => {
  const { client } = fixture(() => Promise.resolve(new Response('%PDF-1.7 file', { headers: { 'Content-Type': 'application/pdf' } })));
  let deleted = 0, writes = 0, shared = 0;
  const state = downloadAdapter({ createTemporaryFile: () => { client.bindApiSession('new-credential', 'live:other'); return { uri: 'file:///private/cache/one', write: () => { writes++; return Promise.resolve(); }, delete: () => { deleted++; } }; }, share: () => { shared++; return Promise.resolve(); } });
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /context changed/); assert.equal(deleted, 1); assert.equal(writes, 0); assert.equal(shared, 0);
});
test('binary responses without a bounded readable stream are refused instead of buffering unbounded bytes', async () => {
  let textRead = false;
  const { client } = fixture(() => Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/pdf' }), text: () => { textRead = true; return Promise.resolve('private bytes'); } })); const state = downloadAdapter();
  await assert.rejects(client.downloadCampusFile('/api/v1/files/one', 'file.pdf', state.adapter), /readable file/); assert.equal(textRead, false); assert.deepEqual(state.events, []);
});

test('Simulation metadata placeholders never export under the original evidence filename', async () => {
  const { client } = fixture(() => Promise.resolve(new Response('Simulation placeholder', { headers: { 'Content-Type': 'application/pdf', 'X-ThatCampus-Evidence-Mode': 'simulation', 'X-ThatCampus-Source-Content-Omitted': 'true' } })));
  const state = downloadAdapter();
  await assert.rejects(client.downloadCampusFile('/api/v1/files/original', 'original-evidence.pdf', state.adapter), /file metadata only/);
  assert.deepEqual(state.events, []);
});
test('transport timeout retains an honest unknown command outcome instead of reporting success', async () => {
  const { client } = fixture((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true })), { timeoutMs: 5 });
  await assert.rejects(client.apiFetch('/api/v1/notices', { method: 'POST', body: '{}' }), /may have completed/);
});
for (const method of [undefined, 'GET', 'head', 'OPTIONS']) test(`a ${method ?? 'default GET'} timeout offers read recovery without implying a completed action`, async () => {
  const { client, calls } = fixture((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Private timeout diagnostics', 'AbortError')), { once: true })), { timeoutMs: 5 });
  await assert.rejects(client.apiFetch('/api/v1/workspace', { method }), cause => {
    assert.ok(cause instanceof ApiConnectionError); assert.equal(cause.status, undefined); assert.match(cause.message, /connect.*campus service/);
    assert.doesNotMatch(cause.message, /action|completed|repeating|Private/); return true;
  });
  assert.equal(calls.length, 1);
});
for (const method of ['GET', 'HEAD', 'OPTIONS', 'post', 'PATCH', 'PUT', 'DELETE']) test(`${method} network rejection has safe method-specific copy without replaying or clearing the bound session`, async () => {
  let expired = 0, changed = 0, failing = true;
  const { client, calls } = fixture(() => failing ? Promise.reject(new TypeError('Private native network diagnostics')) : Promise.resolve(json({ current: true })));
  client.setApiCallbacks(() => { expired++; }, () => { changed++; });
  await assert.rejects(client.apiFetch('/api/v1/workspace', { method }), cause => {
    assert.ok(cause instanceof ApiConnectionError); assert.equal(cause.status, undefined); assert.doesNotMatch(cause.message, /Private/);
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) { assert.match(cause.message, /connect.*campus service/); assert.doesNotMatch(cause.message, /action|completed|repeating/); }
    else assert.match(cause.message, /may have completed; refresh before repeating/);
    return true;
  });
  assert.equal(calls.length, 1); assert.equal(expired, 0); assert.equal(changed, 0);
  failing = false; assert.deepEqual(await client.apiFetch('/api/v1/workspace'), { current: true });
  assert.equal(new Headers(calls[1]!.init.headers).get('Authorization'), 'Bearer old-credential');
});
for (const method of ['GET', 'POST']) test(`${method} response-body interruption is a connection failure with its outcome kept honest`, async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError('Private interrupted body')); } });
  const { client, calls } = fixture(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(client.apiFetch('/api/v1/workspace', { method }), cause => {
    assert.ok(cause instanceof ApiConnectionError); assert.doesNotMatch(cause.message, /Private/);
    if (method === 'GET') assert.doesNotMatch(cause.message, /action|completed/); else assert.match(cause.message, /may have completed/);
    return true;
  });
  assert.equal(calls.length, 1);
});
test('explicit caller cancellation is preserved rather than presented as a network outage', async () => {
  const cancelled = new DOMException('Caller cancelled', 'AbortError'), controller = new AbortController();
  const { client, calls } = fixture((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(cancelled), { once: true })));
  const pending = client.apiFetch('/api/v1/workspace', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, cause => cause === cancelled); assert.equal(calls.length, 1);
});
test('connection classification preserves existing uncertain-write and signed offline-roster recovery boundaries', () => {
  for (const cause of [new ApiConnectionError('Interrupted'), new ApiConnectionError('Gateway unavailable', 503)]) {
    assert.ok(!(cause instanceof ApiError), 'an interruption is not a verified owning API refusal');
    assert.equal(attendanceOfflineFallbackAllowed(cause), true, 'the existing signed-roster policy can offer offline capture');
  }
  for (const status of [400, 401, 403, 404, 409, 410]) {
    const cause = new ApiError('Owning refusal', status);
    assert.equal(attendanceOfflineFallbackAllowed(cause), false);
  }
});
test('a connection failure after an account mutation dispatch never invokes the browser CSRF resubmission branch', async () => {
  const { client, calls } = fixture(url => url.endsWith('/csrf/') ? Promise.resolve(json({ ready: true })) : Promise.reject(new TypeError('Private transport diagnostics')));
  await assert.rejects(browserAuthMutation(client, '/api/v1/auth/password-reset/confirm/', { token: 'original-proof', password: 'original-password' }), ApiConnectionError);
  assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.init.method ?? 'GET']), [
    ['/api/v1/auth/csrf/', 'GET'], ['/api/v1/auth/password-reset/confirm/', 'POST'],
  ]);
});
test('world changes outrank late network and body failures instead of showing feedback in a new world', async () => {
  const late = deferred<CampusResponse>(), first = fixture(() => late.promise), request = first.client.apiFetch('/api/v1/workspace');
  first.client.bindApiSession('new-credential', 'scenario:other'); late.reject(new TypeError('Private network failure'));
  await assert.rejects(request, cause => cause instanceof Error && !(cause instanceof ApiConnectionError) && /context changed/.test(cause.message));
  const reading = deferred<void>(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading.resolve(); } });
  const second = fixture(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
  const bodyRequest = second.client.apiFetch('/api/v1/workspace'); await reading.promise;
  second.client.bindApiSession('new-credential', 'scenario:other'); controller.error(new TypeError('Private body failure'));
  await assert.rejects(bodyRequest, cause => cause instanceof Error && !(cause instanceof ApiConnectionError) && /context changed/.test(cause.message));
});


test('a captured preparation context exposes only a frozen assertion, never credentials or namespace', async () => {
  const { client, calls } = fixture();
  const context = client.captureApiContext();
  assert.deepEqual(Object.keys(context), ['assertCurrent']); assert.equal(Object.isFrozen(context), true); assert.equal(JSON.stringify(context), '{}');
  await Promise.resolve(); context.assertCurrent();
  await client.apiFetch('/api/v1/notices', { method: 'POST', body: '{"idempotency_key":"original"}' });
  assert.equal(calls.length, 1); assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), 'Bearer old-credential');
});
for (const change of ['account', 'world', 'rebind', 'block', 'origin'] as const) test(`pre-request preparation after ${change} change cannot dispatch an old command in a new context`, async () => {
  const { client, calls } = fixture(), persisted = deferred<void>(); let expired = 0, changed = 0;
  client.setApiCallbacks(() => { expired++; }, () => { changed++; });
  const context = client.captureApiContext();
  const prepare = (async () => { await persisted.promise; context.assertCurrent(); await client.apiFetch('/api/v1/notices', { method: 'POST', body: '{"idempotency_key":"original"}' }); })();
  if (change === 'account') client.bindApiSession('new-credential', 'live:other');
  if (change === 'world') client.bindApiSession('old-credential', 'scenario:a:run:one');
  if (change === 'rebind') client.bindApiSession('old-credential', 'live:campus');
  if (change === 'block') client.blockApiRequests();
  if (change === 'origin') { client.setApiOrigin('https://other.example'); client.bindApiSession('new-credential', 'live:other'); }
  persisted.resolve(); await assert.rejects(prepare, /context changed/);
  assert.equal(calls.length, 0); assert.equal(expired, 0); assert.equal(changed, 0);
});
test('capturing campus preparation fails closed while the selected environment is unavailable', () => {
  const { client, calls } = fixture(); client.bindApiSession('credential', 'scenario:a:run:one', true);
  assert.throws(() => client.captureApiContext(), /context changed/); assert.equal(calls.length, 0);
});
