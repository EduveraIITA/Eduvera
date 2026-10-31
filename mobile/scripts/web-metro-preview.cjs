// Web-only development bridge. Never expose Metro's inspector, native peers or
// command sockets on the public review origin. API requests use the host owner.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream');
const WEB_ENTRY = '/node_modules/expo-router/entry.bundle';
const WEB_QUERY = 'platform=web&dev=true&hot=false&lazy=false&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable';
const DOCUMENT = /^\/(?:$|today(?:\/|$)|work(?:\/|$)|areas(?:\/|$)|more(?:\/|$)|company(?:\/|$)|onboarding(?:\/|$)|account\/security\/?$|login\/?$|signup\/?$|forgot-password\/?$|reset-password\/?$|visit-join\/?$|join(?:\/|$)|demo\/?$|workspace\/?$)/;
const ASSET = /\.(?:png|jpe?g|gif|webp|svg|ico|ttf|otf|woff2?|wasm|mp4|webmanifest)$/i;
function checkedMetro(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Use a literal loopback HTTP Metro origin.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a literal loopback HTTP Metro origin.');
  return url;
}
function uniqueQuery(url, allowed) {
  if (url.search.length > 4096) return false;
  const seen = new Set();
  for (const [key, value] of url.searchParams) { if (seen.has(key) || !allowed(key, value)) return false; seen.add(key); }
  return true;
}
function webBundle(raw, cleanPath) {
  let url; try { url = new URL(raw, 'http://preview.invalid'); } catch { return false; }
  const pathname = cleanPath(url.pathname);
  if (pathname !== WEB_ENTRY || url.hash) return false;
  const expected = new URLSearchParams(WEB_QUERY);
  return [...expected].every(([key, value]) => url.searchParams.get(key) === value) && uniqueQuery(url, (key, value) => expected.get(key) === value);
}
function devRoute(raw, cleanPath, publicRoot) {
  const url = new URL(raw, 'http://preview.invalid'), pathname = cleanPath(raw);
  if (!pathname) return null;
  if (webBundle(raw, cleanPath)) return 'bundle';
  if (/\.bundle$/.test(pathname) || /(?:\.map$|\.assets$)/i.test(pathname)) return null;
  if (DOCUMENT.test(pathname) && !path.posix.extname(pathname) && !pathname.split('/').some(part => part.startsWith('__')) && uniqueQuery(url, (key, value) => !/^(?:platform|expo-platform|exponent-platform|transform\.|resolver\.|bundleEntry|dev|hot|lazy|serializer\.)/i.test(key))) return 'document';
  if (pathname === '/assets/' && uniqueQuery(url, (key, value) => key === 'platform' && value === 'web' || key === 'hash' && /^[a-f0-9]{8,128}$/.test(value) || key === 'unstable_path')) {
    const asset = url.searchParams.get('unstable_path');
    if (asset && /^\.\/(?:assets|node_modules)\/[\w/@().+-]+$/.test(asset) && ASSET.test(asset) && !asset.split('/').some(part => part === '..')) {
      try { const clientRoot = path.dirname(publicRoot), real = fs.realpathSync(path.resolve(clientRoot, asset)), roots = ['assets', 'node_modules'].map(folder => fs.realpathSync(path.join(clientRoot, folder))); if (roots.some(root => real.startsWith(root + path.sep)) && fs.statSync(real).isFile()) return 'asset'; } catch {}
    }
  }
  if (pathname.startsWith('/assets/') && ASSET.test(pathname) && uniqueQuery(url, (key, value) => key === 'platform' && value === 'web' || key === 'hash' && /^[a-f0-9]{8,128}$/.test(value))) {
    try { const clientRoot = path.dirname(publicRoot), real = fs.realpathSync(path.resolve(clientRoot, pathname.slice('/assets/'.length))), roots = ['assets', 'node_modules'].map(folder => fs.realpathSync(path.join(clientRoot, folder))); if (roots.some(root => real.startsWith(root + path.sep)) && fs.statSync(real).isFile()) return 'asset'; } catch {}
  }
  // Only actual contained public assets (CanvasKit/fonts/favicon) may use the
  // remaining paths; never ask Metro to resolve arbitrary source or directories.
  if (ASSET.test(pathname) && !url.search) {
    try { const real = fs.realpathSync(path.resolve(publicRoot, '.' + pathname)); if (real.startsWith(publicRoot + path.sep) && fs.statSync(real).isFile()) return 'asset'; } catch {}
  }
  return null;
}
function createMetroDevelopmentProxy({ metroOrigin = 'http://[::1]:8084', publicRoot, cleanPath, safeHeaders, send, admitUpgrade, csp }) {
  const metro = checkedMetro(metroOrigin), root = fs.realpathSync(publicRoot);
  const WebSocket = require('ws'); // Installed Expo/Metro-owned RFC6455 implementation.
  const sockets = new Set(), wsServer = new WebSocket.Server({ noServer: true, clientTracking: false, maxPayload: 64 * 1024, perMessageDeflate: false });
  const bundle = raw => webBundle(raw, cleanPath);
  function handleHttp(req, res) {
    const kind = devRoute(req.url, cleanPath, root);
    if (!kind) return send(res, 404, 'Development resource not exposed.');
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Read-only web development.', { Allow: 'GET, HEAD' });
    // A native-manifest header must not change an admitted web request.
    for (const key of ['expo-platform', 'exponent-platform']) if (req.headers[key] !== undefined && req.headers[key] !== 'web') return send(res, 404, 'Native development is not exposed.');
    const headers = { host: metro.host, accept: kind === 'document' ? 'text/html' : '*/*', 'accept-encoding': 'identity', 'expo-platform': 'web', 'exponent-platform': 'web' };
    const request = http.request(new URL(kind === 'document' ? '/' : req.url, metro), { method: kind === 'document' ? 'GET' : req.method, headers }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); return send(res, 502, 'Development redirect refused.'); }
      const responseHeaders = safeHeaders(response.headers);
      for (const key of Object.keys(responseHeaders)) if (key === 'set-cookie' || key === 'location' || key === 'sourcemap' || key === 'x-sourcemap' || key === 'etag' || key.startsWith('access-control-')) delete responseHeaders[key];
      Object.assign(responseHeaders, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'cross-origin-opener-policy': 'same-origin-allow-popups' });
      if (kind === 'document') responseHeaders['content-security-policy'] = csp(req.socket.localPort);
      if (kind === 'document') {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { response.destroy(); request.destroy(); if (!res.headersSent) send(res, 502, 'Development document exceeds its bound.'); } else chunks.push(chunk); });
        response.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          // Expo's current single-output template has one external entry. Keep
          // its exact app-owned HTML and use one eager WEB graph for public HMR.
          const entries = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].filter(match => match[1].split('?')[0] === WEB_ENTRY);
          if (response.statusCode === 200 && entries.length !== 1) return send(res, 502, 'The installed web entry recipe changed; review before exposing it.');
          const body = entries.length === 1 ? html.replace(entries[0][1], WEB_ENTRY + '?' + WEB_QUERY) : html;
          delete responseHeaders['content-length']; responseHeaders['content-length'] = Buffer.byteLength(body);
          res.writeHead(response.statusCode ?? 502, responseHeaders); res.end(req.method === 'HEAD' ? undefined : body);
        });
        response.on('error', () => { if (!res.headersSent) send(res, 502, 'Development document interrupted.'); else res.destroy(); });
      } else { res.writeHead(response.statusCode ?? 502, responseHeaders); pipeline(response, res, () => {}); }
    });
    request.on('error', () => { if (!res.headersSent) send(res, 502, 'The web development server is unavailable.'); else res.destroy(); });
    req.on('aborted', () => request.destroy()); res.on('close', () => { if (!res.writableFinished) request.destroy(); }); request.end();
  }
  function upgrade(req, socket, head) {
    const origin = admitUpgrade(req);
    if (!origin || req.url !== '/hot' || req.headers['sec-websocket-protocol']) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    if (sockets.size >= 32) return socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    wsServer.handleUpgrade(req, socket, head, client => {
      const upstream = new WebSocket(new URL('/hot', metro).toString().replace(/^http:/, 'ws:'), { origin: metro.origin, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 10000 });
      sockets.add(client); sockets.add(upstream);
      let ready = false, registered = false, queue = [], queuedBytes = 0;
      const stop = (code = 1008, reason = 'Web development connection closed.') => { queue = []; client.close(code, reason); upstream.close(code, reason); };
      client.on('error', () => stop()); upstream.on('error', () => stop(1011, 'Web development unavailable.'));
      client.on('close', () => { sockets.delete(client); upstream.terminate(); }); upstream.on('close', () => { sockets.delete(upstream); client.close(1001, 'Web development disconnected.'); });
      upstream.on('open', () => { ready = true; for (const message of queue) upstream.send(message); queue = []; queuedBytes = 0; });
      upstream.on('message', (data, binary) => { if (binary || client.readyState !== WebSocket.OPEN || client.bufferedAmount > 16 * 1024 * 1024) return stop(); client.send(data, { binary: false }); });
      client.on('message', (data, binary) => {
        if (binary) return stop();
        let message; try { message = JSON.parse(data.toString()); } catch { return stop(); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return stop();
        // Browser logs may contain private user content. They are not HMR and
        // must never be forwarded to the shared native developer console.
        if (message.type === 'log' || message.type === 'log-opt-in') return;
        if (message.type === 'heartbeat' && Object.keys(message).every(key => key === 'type')) { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); return; }
        if (message.type !== 'register-entrypoints' || Object.keys(message).some(key => !['type', 'entryPoints'].includes(key)) || !Array.isArray(message.entryPoints) || !message.entryPoints.length || message.entryPoints.length > 32) return stop();
        const entries = [];
        for (const entry of message.entryPoints) {
          let url; try { if (typeof entry !== 'string' || entry.length > 8192) return stop(); url = new URL(entry); } catch { return stop(); }
          if (url.origin !== origin || url.username || url.password || url.hash || !bundle(url.pathname + url.search)) return stop();
          // Use only the fixed loopback graph owner, never a client URL host.
          entries.push(new URL(WEB_ENTRY + '?' + WEB_QUERY, metro).toString());
        }
        // Metro retains a revision id and schedules work on every registration.
        // This host admits one graph, so validate all packets but subscribe once.
        if (registered) return; registered = true;
        const output = JSON.stringify({ type: 'register-entrypoints', entryPoints: [...new Set(entries)] });
        if (ready && upstream.readyState === WebSocket.OPEN) upstream.send(output);
        else { queuedBytes += Buffer.byteLength(output); if (queue.length >= 16 || queuedBytes > 64 * 1024) return stop(); queue.push(output); }
      });
    });
  }
  let closed = false;
  function close() { if (closed) return; closed = true; for (const socket of sockets) socket.terminate(); sockets.clear(); wsServer.close(); }
  return { bundle, handleHttp, upgrade, close };
}
module.exports = { createMetroDevelopmentProxy, checkedMetro, webBundle, devRoute, WEB_ENTRY, WEB_QUERY };
