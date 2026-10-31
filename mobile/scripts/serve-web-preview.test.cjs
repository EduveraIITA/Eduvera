const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createServer, DEFAULT_EXPORT_ROOT } = require('./serve-web-preview.cjs');
const PUBLIC_ORIGIN = 'https://public-preview.example';

async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
function request(origin, target, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(origin);
    const req = http.request({ hostname: endpoint.hostname, port: endpoint.port, path: target, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), body: Buffer.concat(chunks).toString('utf8') }));
    }); req.on('error', reject); req.end(body);
  });
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thatcampus-web-preview-')), root = path.join(directory, 'export'), received = [];
  fs.mkdirSync(root); fs.mkdirSync(path.join(root, 'assets')); fs.mkdirSync(path.join(root, 'skia'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html>Current RN Web</html>');
  fs.writeFileSync(path.join(root, 'assets', 'entry-abcdef123456.js'), 'globalThis.currentPreview = true;');
  fs.writeFileSync(path.join(root, 'skia', 'canvaskit-abcdef123456.wasm'), Buffer.from([0,97,115,109,1,0,0,0]));
  fs.writeFileSync(path.join(root, 'assets', 'private.map'), 'source must not be published');
  fs.writeFileSync(path.join(directory, 'outside.txt'), 'Outside export');
  fs.symlinkSync(path.join(directory, 'outside.txt'), path.join(root, 'leak.txt'));
  fs.symlinkSync(directory, path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, '.env'), 'Not a public file');
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    if (req.url.startsWith('/api/failure')) return res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=99' }).end('{"detail":"refused"}');
    if (req.url.startsWith('/api/v1/auth/native/google/authorize/')) return res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'nonce-private-fixture'", 'Set-Cookie': 'native_bridge=opaque; Path=/api/v1/auth/native/google; HttpOnly; Secure; SameSite=Lax' }).end('<p>Owning Google bridge</p>');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['session=opaque; Path=/; HttpOnly; SameSite=Lax', 'csrftoken=signed; Path=/; SameSite=Lax'] }).end('{"ok":true}');
  });
  const upstreamOrigin = await listen(t, upstream), server = createServer({ exportRoot: root, upstreamOrigin, publicOrigin: PUBLIC_ORIGIN }), origin = await listen(t, server);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { origin, received, root, upstreamOrigin };
}

test('actual HTTP proxy preserves same-origin cookie/CSRF, body, query, method, namespace and Set-Cookie array', async t => {
  const { origin, received } = await fixture(t);
  const result = await request(origin, '/api/v1/fixture?revision=7', { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, Referer: PUBLIC_ORIGIN + '/areas/events', 'Sec-Fetch-Site': 'same-origin', Cookie: 'session=opaque; csrftoken=signed', 'X-CSRFToken': 'signed', 'X-Campus-Namespace': 'simulation:owned', Forwarded: 'host=evil.invalid', 'X-Forwarded-For': '198.51.100.1', 'X-Forwarded-Host': 'evil.invalid', 'X-Forwarded-Proto': 'http', 'Content-Type': 'application/json' }, body: '{"expected_revision":7}' });
  assert.equal(result.status, 200); assert.deepEqual(result.headers['set-cookie'], ['session=opaque; Path=/; HttpOnly; SameSite=Lax', 'csrftoken=signed; Path=/; SameSite=Lax']);
  assert.equal(result.headers['cache-control'], 'private, no-store'); assert.equal(received.length, 1);
  const actual = received[0]; assert.equal(actual.path, '/api/v1/fixture?revision=7'); assert.equal(actual.method, 'POST'); assert.equal(actual.body, '{"expected_revision":7}');
  assert.equal(actual.headers.cookie, 'session=opaque; csrftoken=signed'); assert.equal(actual.headers['x-csrftoken'], 'signed'); assert.equal(actual.headers['x-campus-namespace'], 'simulation:owned');
  assert.equal(actual.headers.origin, 'http://127.0.0.1:5173'); assert.equal(actual.headers.forwarded, undefined);
  assert.equal(Object.keys(actual.headers).some(key => key.startsWith('x-forwarded-')), false);
});
test('unsafe API validates actual public/local Origin and Fetch-Site before private-hop normalization', async t => {
  const { origin, received } = await fixture(t);
  for (const headers of [
    {}, { Origin: 'https://foreign.invalid' }, { Origin: 'null' }, { Origin: PUBLIC_ORIGIN + '/' },
    { Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }, { Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'same-site' },
    { Origin: PUBLIC_ORIGIN, Referer: 'https://foreign.invalid/form' },
  ]) assert.equal((await request(origin, '/api/v1/auth/login/', { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await request(origin, '/api/v1/auth/session/', { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await request(origin, '/today', { headers: { Host: 'foreign.invalid' } })).status, 403);
  assert.equal(received.length, 0);
  for (const allowed of [origin, 'http://127.0.0.1:5173', 'http://localhost:5173', PUBLIC_ORIGIN]) assert.equal((await request(origin, '/api/v1/auth/login/', { method: 'POST', headers: { Origin: allowed }, body: '{}' })).status, 200);
});
test('cookie-free native account JSON reaches only explicit native ceremonies without a forged browser Origin or Set-Cookie', async t => {
  const { origin, received } = await fixture(t);
  for (const suffix of ['login/', 'mfa/login/', 'register/', 'public-demo-session/', 'password-reset/request/', 'password-reset/confirm/', 'google/start/', 'google/exchange/', 'invitations/accept/', 'invitations/recipient-proof/', 'visit-onboarding/preview', 'visit-onboarding/proof', 'visit-onboarding/account']) {
    const target = '/api/v1/auth/native/' + suffix;
    const response = await request(origin, target, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' }, body: '{"synthetic":"proof"}' });
    assert.equal(response.status, 200, target);
    assert.equal(response.headers['set-cookie'], undefined, 'native transport cannot establish ambient browser cookies');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    const actual = received.at(-1);
    assert.equal(actual.path, target); assert.equal(actual.body, '{"synthetic":"proof"}');
    assert.equal(actual.headers.origin, undefined); assert.equal(actual.headers.cookie, undefined); assert.equal(actual.headers['x-csrftoken'], undefined);
    assert.equal(actual.headers.authorization, undefined);
  }
});
test('explicit native bearer API writes, uploads and reads retain exact token/world/body without ambient browser credentials', async t => {
  const { origin, received } = await fixture(t), authorization = 'Bearer tc_native_' + 'A'.repeat(43);
  const namespace = 'simulation:owned-fixture';
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    const body = method === 'GET' ? '' : '{"expected_revision":7}';
    const response = await request(origin, '/api/v1/schools/fixture/facilities/repairs?revision=7', { method, headers: { Authorization: authorization, 'X-ThatCampus-Execution-Environment': namespace, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Forwarded: 'host=foreign.invalid', 'X-Forwarded-Host': 'foreign.invalid' }, body });
    assert.equal(response.status, 200, method); assert.equal(response.headers['set-cookie'], undefined);
    const actual = received.at(-1);
    assert.equal(actual.method, method); assert.equal(actual.headers.authorization, authorization); assert.equal(actual.headers['x-thatcampus-execution-environment'], namespace);
    assert.equal(actual.headers.origin, undefined); assert.equal(actual.headers.cookie, undefined); assert.equal(actual.headers['x-csrftoken'], undefined);
    assert.equal(actual.headers.forwarded, undefined); assert.equal(actual.headers['x-forwarded-host'], undefined);
    assert.equal(actual.body, body);
  }
  const upload = '--fixture-boundary\r\nContent-Disposition: form-data; name="note"\r\n\r\nSynthetic\r\n--fixture-boundary--\r\n';
  assert.equal((await request(origin, '/api/v1/schools/fixture/facilities/repairs/fixture/photos', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'multipart/form-data; boundary=fixture-boundary' }, body: upload })).status, 200);
  assert.equal(received.at(-1).body, upload);
  const refused = await request(origin, '/api/failure', { method: 'POST', headers: { Authorization: authorization }, body: '{}' });
  assert.equal(refused.status, 403); assert.equal(refused.body, '{"detail":"refused"}');
});
test('absent Origin never admits browser cookies, CSRF, Fetch Metadata, Referer or malformed native bearer proofs', async t => {
  const { origin, received } = await fixture(t), json = { Accept: 'application/json', 'Content-Type': 'application/json' }, authorization = 'Bearer tc_native_' + 'A'.repeat(43);
  for (const extra of [{ Cookie: 'session=opaque' }, { Cookie: '' }, { 'X-CSRFToken': 'signed' }, { Referer: PUBLIC_ORIGIN + '/login' }, { 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Mode': 'cors' }, { Origin: 'null' }, { Origin: 'https://foreign.invalid' }, { Host: 'foreign.invalid' }, { Authorization: 'Basic synthetic' }, { Authorization: 'Bearer synthetic' }, { Authorization: 'Bearer TC_NATIVE_' + 'A'.repeat(43) }]) {
    for (const credential of [{}, { Authorization: authorization }]) {
      assert.equal((await request(origin, '/api/v1/auth/native/login/', { method: 'POST', headers: { ...json, ...credential, ...extra }, body: '{}' })).status, 403, JSON.stringify(Object.keys(extra)));
    }
  }
  for (const headers of [{}, { ...json, 'Content-Type': 'text/plain' }, { ...json, 'Content-Type': 'application/x-www-form-urlencoded' }, { ...json, 'Content-Type': 'multipart/form-data; boundary=fixture' }]) assert.equal((await request(origin, '/api/v1/auth/native/login/', { method: 'POST', headers, body: '{}' })).status, 403);
  for (const target of ['/api/v1/auth/login/', '/api/v1/auth/native/google/proof/', '/api/v1/auth/native/unreviewed/', '/api/v1/schools/fixture/facilities/repairs']) assert.equal((await request(origin, target, { method: 'POST', headers: json, body: '{}' })).status, 403, target);
  assert.equal((await request(origin, '/api/v1/auth/native/login/', { method: 'PATCH', headers: json, body: '{}' })).status, 403);
  assert.equal((await request(origin, '/api/v1/auth/native/session/', { headers: { Authorization: authorization, Cookie: 'session=opaque' } })).status, 403);
  assert.equal(received.length, 0);
});
test('root/deep document URLs and real immutable JS/WASM are served while missing assets never become HTML', async t => {
  const { origin, received } = await fixture(t);
  for (const target of ['/', '/today', '/areas/assistant/conversation?thread=owned', '/areas/events/manage/new?date=2026-10-29', '/company/institutions/owned']) {
    const result = await request(origin, target); assert.equal(result.status, 200); assert.match(result.body, /Current RN Web/); assert.match(result.headers['content-type'], /text\/html/); assert.equal(result.headers['cache-control'], 'no-store');
    assert.match(result.headers['content-security-policy'], /'wasm-unsafe-eval'/); assert.doesNotMatch(result.headers['content-security-policy'], /'unsafe-eval'/); assert.equal(result.headers['cross-origin-opener-policy'], 'same-origin-allow-popups');
  }
  const documentHead = await request(origin, '/', { method: 'HEAD' }); assert.equal(documentHead.status, 200); assert.equal(documentHead.bytes.length, 0); assert.equal(Number(documentHead.headers['content-length']), Buffer.byteLength('<!doctype html><html>Current RN Web</html>'));
  const js = await request(origin, '/assets/entry-abcdef123456.js'); assert.match(js.headers['content-type'], /javascript/); assert.match(js.headers['cache-control'], /immutable/);
  const wasm = await request(origin, '/skia/canvaskit-abcdef123456.wasm'); assert.equal(wasm.headers['content-type'], 'application/wasm'); assert.equal(wasm.bytes.length, 8); await WebAssembly.instantiate(wasm.bytes);
  const head = await request(origin, '/skia/canvaskit-abcdef123456.wasm', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], '8');
  for (const target of ['/assets/missing.js', '/_expo/missing', '/skia/missing.wasm', '/favicon-missing.ico']) { const result = await request(origin, target); assert.equal(result.status, 404); assert.doesNotMatch(result.body, /Current RN Web/); }
  assert.equal(received.length, 0);
});
test('path traversal, outside symlinks, source maps, hidden files and dev tools are refused before proxy or fallback', async t => {
  const { origin, received } = await fixture(t);
  for (const target of ['/../outside.txt', '/%2e%2e/outside.txt', '/assets%2f..%2foutside.txt', '/assets\\outside.txt', '/%00', '/bad%zz', '//foreign.invalid/']) assert.equal((await request(origin, target)).status, 400, target);
  for (const target of ['/leak.txt', '/outside/outside.txt', '/outside/missing-child']) assert.equal((await request(origin, target)).status, 403, target);
  for (const target of ['/.env', '/assets/private.map', '/metrics', '/metrics/private', '/__campus-lab', '/__expo', '/src/owner.ts', '/node_modules/module', '/api/docs', '/api/schema', '/api/docs/swagger-ui.js', '/api/v1/development/campus-simulator', '/api/v1/%64evelopment/campus-simulator', '/readyz/extra', '/releasez/extra']) assert.equal((await request(origin, target)).status, 404, target);
  assert.equal(received.length, 0);
});
test('only exact read-only health/release and email bridges forward, preserving API refusals and owning auth HTML/CSP', async t => {
  const { origin, received } = await fixture(t);
  for (const target of ['/healthz', '/readyz', '/release', '/releasez', '/email-assets/thatcampus-wordmark-light-v3.png']) assert.equal((await request(origin, target)).status, 200, target);
  assert.deepEqual(received.map(row => row.path), ['/healthz', '/readyz', '/release', '/releasez', '/email-assets/thatcampus-wordmark-light-v3.png']);
  assert.equal((await request(origin, '/readyz', { method: 'POST', headers: { Origin: PUBLIC_ORIGIN } })).status, 405);
  const refused = await request(origin, '/api/failure'); assert.equal(refused.status, 403); assert.equal(refused.body, '{"detail":"refused"}'); assert.equal(refused.headers['cache-control'], 'private, no-store');
  const google = await request(origin, '/api/v1/auth/native/google/authorize/?request=synthetic'); assert.equal(google.body, '<p>Owning Google bridge</p>'); assert.equal(google.headers['content-security-policy'], "script-src 'nonce-private-fixture'"); assert.match(google.headers['set-cookie'][0], /Path=\/api\/v1\/auth\/native\/google; HttpOnly; Secure/);
});
test('export configuration cannot escape to a remote/credentialled API or an outside index symlink', async t => {
  const { root } = await fixture(t);
  for (const upstreamOrigin of ['https://127.0.0.1:8000', 'http://foreign.invalid', 'http://user:pass@127.0.0.1:8000', 'http://127.0.0.1:8000/path', 'http://127.0.0.1:8000/?secret=synthetic']) assert.throws(() => createServer({ exportRoot: root, upstreamOrigin, publicOrigin: PUBLIC_ORIGIN }));
  for (const publicOrigin of [undefined, 'http://public-preview.example', PUBLIC_ORIGIN + '/', PUBLIC_ORIGIN + '/path', 'https://user:pass@public-preview.example', 'https://*.public-preview.example', PUBLIC_ORIGIN + '?x=1']) assert.throws(() => createServer({ exportRoot: root, publicOrigin }));
  fs.unlinkSync(path.join(root, 'index.html')); fs.symlinkSync(path.join(root, '..', 'outside.txt'), path.join(root, 'index.html')); assert.throws(() => createServer({ exportRoot: root, publicOrigin: PUBLIC_ORIGIN }));
});
test('the actual frozen export root serves current HTML, every entry script and exact dependency-matched CanvasKit bytes', async t => {
  const server = createServer({ publicOrigin: PUBLIC_ORIGIN }), origin = await listen(t, server), html = await request(origin, '/areas/assistant/conversation');
  assert.equal(html.status, 200); assert.equal(html.body, fs.readFileSync(path.join(DEFAULT_EXPORT_ROOT, 'index.html'), 'utf8'));
  const scripts = [...html.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]); assert.ok(scripts.length >= 1);
  for (const script of scripts) { const result = await request(origin, script); assert.equal(result.status, 200); assert.match(result.headers['content-type'], /javascript/); assert.equal(result.bytes.length, fs.statSync(path.join(DEFAULT_EXPORT_ROOT, script)).size); }
  const manifestSource = fs.readFileSync(path.resolve(__dirname, '../src/features/campus/skia/campusSkiaWebAsset.generated.ts'), 'utf8'), assetPath = /"path":\s*"([^"]+)"/.exec(manifestSource)[1], expectedHash = /"sha256":\s*"([^"]+)"/.exec(manifestSource)[1];
  const wasm = await request(origin, assetPath); assert.equal(wasm.status, 200); assert.equal(wasm.headers['content-type'], 'application/wasm'); assert.equal(createHash('sha256').update(wasm.bytes).digest('hex'), expectedHash);
});
test('ordinary HTTP uploads and responses stream without buffering or adding an application response deadline', async t => {
  let firstRequest, firstResponse, finishResponse;
  const requestChunk = new Promise(resolve => { firstRequest = resolve; }), responseChunk = new Promise(resolve => { firstResponse = resolve; });
  const upstream = http.createServer((req, res) => {
    req.once('data', chunk => firstRequest(chunk.toString('utf8')));
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"streamed":'); finishResponse = () => res.end('true}'); });
  });
  const upstreamOrigin = await listen(t, upstream), server = createServer({ publicOrigin: PUBLIC_ORIGIN, upstreamOrigin }), origin = await listen(t, server), endpoint = new URL(origin);
  let client;
  const completed = new Promise((resolve, reject) => {
    client = http.request({ hostname: endpoint.hostname, port: endpoint.port, path: '/api/v1/stream-fixture', method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' } }, res => {
      const chunks = []; res.on('data', chunk => { chunks.push(chunk); firstResponse(chunk.toString('utf8')); }); res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }); client.on('error', reject);
  });
  client.write('{"part":');
  assert.equal(await requestChunk, '{"part":', 'upstream receives the first chunk before the browser upload ends');
  client.end('"two"}'); assert.equal(await responseChunk, '{"streamed":', 'browser receives the first upstream chunk before its response ends');
  finishResponse(); assert.equal(await completed, '{"streamed":true}');
});
test('WebSocket/HMR upgrade attempts receive no proxy or dev-tool access', async t => {
  const { origin, received } = await fixture(t), endpoint = new URL(origin);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: endpoint.hostname, port: endpoint.port, path: '/api/upgrade', headers: { Connection: 'Upgrade', Upgrade: 'websocket' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end();
  });
  assert.equal(status, 426); assert.equal(received.length, 0);
});

const WebSocket = require('ws');
const { WEB_ENTRY, WEB_QUERY } = require('./web-metro-preview.cjs');
const WEB_BUNDLE = WEB_ENTRY + '?' + WEB_QUERY;
async function developmentFixture(t, options = {}) {
  const basic = await fixture(t), metroRequests = [], registrations = [], messages = [], peers = new Set();
  const metro = http.createServer((req, res) => {
    metroRequests.push({ path: req.url, method: req.method, headers: req.headers });
    if (req.url.startsWith('/node_modules/')) return res.writeHead(200, { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'not-app-auth=refused' }).end('globalThis.liveRevision = 1;');
    if (req.url.startsWith('/assets/') || req.url.startsWith('/skia/')) return res.writeHead(200, { 'Content-Type': 'application/wasm' }).end(Buffer.from([0,97,115,109,1,0,0,0]));
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><div id="root"></div><script src="' + WEB_BUNDLE.replace('lazy=false', 'lazy=true') + '" defer></script></html>');
  });
  const upstreamWs = new WebSocket.Server({ server: metro, path: '/hot' });
  upstreamWs.on('connection', (ws, req) => { peers.add(ws); messages.push({ headers: req.headers }); ws.on('close', () => peers.delete(ws)); ws.on('message', data => { const message = JSON.parse(data.toString()); registrations.push(message); ws.send(JSON.stringify({ type: 'update', body: { revisionId: 'synthetic-web', added: [], modified: [], deleted: [] } })); }); });
  t.after(() => { for (const ws of peers) ws.terminate(); upstreamWs.close(); });
  const metroOrigin = await listen(t, metro), server = createServer({ mode: 'development', exportRoot: basic.root, publicOrigin: PUBLIC_ORIGIN, metroOrigin, upstreamOrigin: basic.upstreamOrigin, ...options }), origin = await listen(t, server);
  return { ...basic, origin, metroOrigin, metroRequests, registrations, messages, peers };
}
function connectWebSocket(origin, target = '/hot', options = {}) { return new WebSocket(origin.replace(/^http:/, 'ws:') + target, { origin: PUBLIC_ORIGIN, ...options }); }
async function opened(ws) { await once(ws, 'open'); return ws; }
function rejectedWebSocket(origin, target, options = {}) {
  return new Promise((resolve, reject) => { const ws = connectWebSocket(origin, target, options); ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); }); ws.on('open', () => { ws.terminate(); reject(new Error('Unsafe WebSocket unexpectedly opened')); }); ws.on('error', reject); });
}
test('development HTTP uses one eager web entry and retains document queries without public native/dev tools', async t => {
  const { origin, metroRequests } = await developmentFixture(t);
  for (const route of ['/', '/areas/events/manage/new?date=2026-10-30', '/account/security?token=synthetic', '/visit-join', '/visit-join?continue=11111111-1111-4111-8111-111111111111']) {
    const result = await request(origin, route); assert.equal(result.status, 200); assert.ok(result.body.includes(WEB_BUNDLE)); assert.equal(result.body.includes('lazy=true'), false); assert.match(result.headers['content-security-policy'], /'unsafe-eval'/); assert.match(result.headers['content-security-policy'], /wss:\/\/public-preview.example/); assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal(metroRequests.some(row => row.path.includes('token=')), false, 'app continuations/proofs stay in browser URL, not Metro document requests');
  const head = await request(origin, '/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.body, ''); assert.ok(Number(head.headers['content-length']) > 0);
  const bundle = await request(origin, WEB_BUNDLE, { headers: { Cookie: 'private=never-to-metro', Authorization: 'Bearer synthetic', 'X-CSRFToken': 'private', 'X-Campus-Namespace': 'private', Forwarded: 'host=foreign', 'X-Forwarded-Host': 'foreign' } });
  assert.equal(bundle.status, 200); assert.equal(bundle.headers['set-cookie'], undefined); assert.equal(bundle.headers['access-control-allow-origin'], undefined);
  const actual = metroRequests.at(-1).headers; assert.equal(actual.cookie, undefined); assert.equal(actual.authorization, undefined); assert.equal(actual.origin, undefined); assert.equal(actual['x-csrftoken'], undefined); assert.equal(actual['x-campus-namespace'], undefined); assert.equal(actual.forwarded, undefined); assert.equal(actual['x-forwarded-host'], undefined); assert.equal(actual['expo-platform'], 'web');
  const count = metroRequests.length;
  for (const target of ['/status', '/json', '/json/list', '/inspector/device', '/debugger-proxy', '/message', '/events', '/open-stack-frame', '/symbolicate', '/_expo/debugger', '/[metro-project]/.env', '/[metro-watchFolders]/0/package.json', '/src/features/CareScreen.bundle?' + WEB_QUERY, WEB_ENTRY + '?platform=ios&dev=true', WEB_BUNDLE + '&platform=android', WEB_BUNDLE + '&bundleEntry=private', WEB_BUNDLE + '&transform.environment=node', WEB_BUNDLE + '&resolver.platform=ios', WEB_BUNDLE.replace('lazy=false', 'lazy=true'), '/assets/?unstable_path=..%2Fbackend%2F.env']) assert.equal((await request(origin, target)).status, 404, target);
  assert.equal((await request(origin, '/', { headers: { 'Expo-Platform': 'ios' } })).status, 404);
  assert.equal(metroRequests.length, count);
  for (const target of ['/visit-join/private', '/visit-joining', '/visit-join.bundle?' + WEB_QUERY, '/visit-join?platform=ios']) assert.equal((await request(origin, target)).status, 404, target);
  assert.equal(metroRequests.length, count, 'The public join entry does not admit extra documents or Metro recipes');
});
test('development mode leaves API cookie/CSRF/namespace on the existing backend owner', async t => {
  const { origin, received, metroRequests } = await developmentFixture(t);
  const result = await request(origin, '/api/v1/fixture', { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'same-origin', Cookie: 'session=opaque', 'X-CSRFToken': 'signed', 'X-Campus-Namespace': 'simulation:owned' }, body: '{"exact":true}' });
  assert.equal(result.status, 200); assert.equal(received.length, 1); assert.equal(received[0].headers.cookie, 'session=opaque'); assert.equal(received[0].headers['x-csrftoken'], 'signed'); assert.equal(received[0].headers['x-campus-namespace'], 'simulation:owned'); assert.equal(received[0].headers.origin, 'http://127.0.0.1:5173'); assert.equal(metroRequests.length, 0);
  assert.equal((await request(origin, '/api/v1/fixture', { method: 'POST', headers: { Origin: 'https://foreign.invalid' } })).status, 403); assert.equal(received.length, 1);
});
test('real HMR WebSocket forwards only the exact eager web graph and never client credentials/logs', async t => {
  const { origin, registrations, messages } = await developmentFixture(t), ws = await opened(connectWebSocket(origin, '/hot', { headers: { Cookie: 'session=private', Authorization: 'Bearer private' } })); t.after(() => ws.terminate());
  const update = once(ws, 'message'); ws.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + WEB_BUNDLE, PUBLIC_ORIGIN + WEB_BUNDLE] }));
  const [data] = await update; assert.equal(JSON.parse(data.toString()).body.revisionId, 'synthetic-web'); assert.equal(registrations.length, 1); assert.equal(registrations[0].entryPoints.length, 1); assert.equal(new URL(registrations[0].entryPoints[0]).pathname + new URL(registrations[0].entryPoints[0]).search, WEB_BUNDLE); assert.notEqual(new URL(registrations[0].entryPoints[0]).origin, PUBLIC_ORIGIN); assert.equal(messages[0].headers.cookie, undefined); assert.equal(messages[0].headers.authorization, undefined);
  ws.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + WEB_BUNDLE] }));
  ws.send(JSON.stringify({ type: 'log', level: 'error', data: ['private not forwarded'] })); ws.send(JSON.stringify({ type: 'log-opt-in' })); const heartbeat = once(ws, 'message'); ws.send(JSON.stringify({ type: 'heartbeat' })); assert.equal(JSON.parse((await heartbeat)[0].toString()).type, 'heartbeat'); assert.equal(registrations.length, 1);
  const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + WEB_BUNDLE.replace('platform=web', 'platform=android')] })); assert.equal((await closed)[0], 1008); assert.equal(registrations.length, 1, 'repeat registration never bypasses recipe validation');
});
test('WebSocket controls, foreign origins, native graphs, changed recipes and binary frames are denied', async t => {
  const { origin, registrations } = await developmentFixture(t);
  for (const target of ['/message', '/events', '/inspector/debug', '/hot?platform=web', '/api/upgrade']) assert.equal(await rejectedWebSocket(origin, target), 403, target);
  for (const options of [{ origin: 'https://foreign.invalid' }, { origin: undefined }, { headers: { Host: 'foreign.invalid' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]) assert.equal(await rejectedWebSocket(origin, '/hot', options), 403);
  for (const message of [{ type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + WEB_BUNDLE.replace('platform=web', 'platform=ios')] }, { type: 'register-entrypoints', entryPoints: ['https://foreign.invalid' + WEB_BUNDLE] }, { type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + WEB_BUNDLE + '&bundleEntry=secret'] }, { type: 'register-entrypoints', entryPoints: [PUBLIC_ORIGIN + '/src/private.bundle?' + WEB_QUERY] }, { type: 'sendDevCommand', params: { name: 'reload' } }, { type: 'getpeers' }, 'invalid JSON', Buffer.from('binary')]) {
    const ws = await opened(connectWebSocket(origin)); const closed = once(ws, 'close'); ws.send(typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message)); const [code] = await closed; assert.equal(code, 1008);
  }
  assert.equal(registrations.length, 0);
});
test('development target configuration cannot select remote, credentialled, DNS or path-based upstreams', async t => {
  const { root } = await fixture(t);
  for (const metroOrigin of ['http://localhost:8084', 'https://[::1]:8084', 'http://foreign.invalid:8084', 'http://user:pass@[::1]:8084', 'http://[::1]:8084/private', 'http://[::1]:8084/?x=1']) assert.throws(() => createServer({ mode: 'development', exportRoot: root, publicOrigin: PUBLIC_ORIGIN, metroOrigin }));
});

test('development assets resolve only actual contained client/public files, including Expo unstable_path', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-metro-assets-')), client = path.join(directory, 'client'), publicRoot = path.join(client, 'public');
  fs.mkdirSync(path.join(client, 'assets'), { recursive: true }); fs.mkdirSync(path.join(client, 'node_modules/lib'), { recursive: true }); fs.mkdirSync(path.join(publicRoot, 'skia'), { recursive: true });
  for (const p of [path.join(client, 'assets/photo.png'), path.join(client, 'node_modules/lib/icon.png'), path.join(publicRoot, 'skia/engine.wasm'), path.join(directory, 'private.png')]) fs.writeFileSync(p, 'synthetic');
  fs.symlinkSync(path.join(directory, 'private.png'), path.join(client, 'assets/leak.png')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { origin, metroRequests } = await developmentFixture(t, { publicRoot });
  for (const target of ['/assets/?unstable_path=.%2Fassets%2Fphoto.png', '/assets/?unstable_path=.%2Fnode_modules%2Flib%2Ficon.png', '/assets/assets/photo.png?platform=web', '/skia/engine.wasm']) assert.equal((await request(origin, target)).status, 200, target);
  const count = metroRequests.length;
  for (const target of ['/assets/?unstable_path=.%2Fassets%2Fleak.png', '/assets/?unstable_path=.%2Fassets%2Fmissing.png', '/assets/?unstable_path=..%2Fprivate.png', '/assets/?unstable_path=.%2Fnode_modules%2Flib%2Ficon.png&platform=ios', '/assets/?unstable_path=.%2Fnode_modules%2Flib%2Ficon.png&unstable_path=.%2Fassets%2Fphoto.png', '/assets/assets/missing.png', '/skia/missing.wasm']) assert.equal((await request(origin, target)).status, 404, target);
  assert.equal(metroRequests.length, count);
});
test('a changed Metro HTML recipe fails closed instead of exposing a different script or native manifest', async t => {
  const { root, upstreamOrigin } = await fixture(t), metro = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><script src="/unreviewed.bundle?platform=ios"></script></html>')), metroOrigin = await listen(t, metro), server = createServer({ mode: 'development', exportRoot: root, upstreamOrigin, publicOrigin: PUBLIC_ORIGIN, metroOrigin }), origin = await listen(t, server);
  const result = await request(origin, '/'); assert.equal(result.status, 502); assert.doesNotMatch(result.body, /unreviewed.bundle/);
});

test('development mode does not depend on an old frozen export directory', async t => {
  const { origin } = await developmentFixture(t, { exportRoot: '/not-a-required-static-export' });
  assert.equal((await request(origin, '/')).status, 200);
});

test('public HMR connections are bounded independently of native Metro clients', async t => {
  const { origin } = await developmentFixture(t), clients = []; t.after(() => clients.forEach(client => client.terminate()));
  for (let index = 0; index < 16; index++) clients.push(await opened(connectWebSocket(origin)));
  assert.equal(await rejectedWebSocket(origin, '/hot'), 429);
});
