const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createWebApiProxy } = require('./web-api-proxy.cjs');

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
function request(origin, path, headers = {}, method = 'GET', body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { headers, method }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }); req.on('error', reject); req.end(body);
  });
}
async function fixture(t) {
  const received = [];
  const backend = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url, method: req.method, headers: req.headers, body });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'fixture_session=opaque; HttpOnly; SameSite=Lax' }).end('{"ok":true}');
  });
  const target = await listen(backend), proxy = createWebApiProxy({ target });
  const server = http.createServer((req, res) => proxy(req, res, () => res.writeHead(404).end('Metro')));
  const origin = await listen(server);
  t.after(() => { server.closeAllConnections(); server.close(); backend.closeAllConnections(); backend.close(); });
  return { origin, received };
}

test('same-origin local preview keeps CSRF/session/body and strips spoofed proxy authority', async t => {
  const { origin, received } = await fixture(t);
  const result = await request(origin, '/api/v1/fixture?date=2026-10-29', { Origin: origin, Cookie: 'fixture_session=opaque', 'X-CSRFToken': 'fixture-token', 'X-Forwarded-Host': 'untrusted.example', Forwarded: 'host=untrusted.example', 'Content-Type': 'application/json' }, 'POST', '{"revision":7}');
  assert.equal(result.status, 200); assert.equal(result.body, '{"ok":true}');
  assert.match(result.headers['set-cookie'][0], /HttpOnly/);
  assert.equal(received.length, 1); assert.equal(received[0].method, 'POST'); assert.equal(received[0].body, '{"revision":7}'); assert.equal(received[0].path, '/api/v1/fixture?date=2026-10-29');
  assert.equal(received[0].headers.origin, 'http://127.0.0.1:5173'); assert.equal(received[0].headers.cookie, 'fixture_session=opaque'); assert.equal(received[0].headers['x-csrftoken'], 'fixture-token');
  assert.equal(received[0].headers['x-forwarded-host'], undefined); assert.equal(received[0].headers.forwarded, undefined);
});
test('cross-origin, foreign Host and non-API requests never reach the backend', async t => {
  const { origin, received } = await fixture(t);
  assert.equal((await request(origin, '/api/v1/auth/session/', { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request(origin, '/api/v1/auth/session/', { Host: 'untrusted.example' })).status, 403);
  assert.equal((await request(origin, '/today')).status, 404);
  assert.equal(received.length, 0);
});
test('preview configuration cannot forward credentials to a remote or credentialled backend', () => {
  for (const target of ['https://campus.example', 'http://user:pass@127.0.0.1:8000', 'http://127.0.0.1:8000/other', 'http://127.0.0.1:8000/?x=1']) assert.throws(() => createWebApiProxy({ target }));
});
