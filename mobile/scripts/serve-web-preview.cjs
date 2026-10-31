const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { parseArgs } = require('node:util');

const TRUSTED_UPSTREAM_ORIGIN = 'http://127.0.0.1:5173';
const DEFAULT_EXPORT_ROOT = path.resolve(__dirname, '../../artifacts/native-web-ui-20261029/assistant-overlay-universal-export');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Explicit owning native account ceremonies. The Google browser proof stays on
// the ordinary Origin/cookie path; absent Origin is not a browser CSRF bypass.
const NATIVE_PUBLIC_POSTS = new Set([
  '/api/v1/auth/native/login/', '/api/v1/auth/native/mfa/login/', '/api/v1/auth/native/register/',
  '/api/v1/auth/native/public-demo-session/', '/api/v1/auth/native/password-reset/request/', '/api/v1/auth/native/password-reset/confirm/',
  '/api/v1/auth/native/google/start/', '/api/v1/auth/native/google/exchange/',
  '/api/v1/auth/native/invitations/accept/', '/api/v1/auth/native/invitations/recipient-proof/',
  '/api/v1/auth/native/visit-onboarding/preview', '/api/v1/auth/native/visit-onboarding/proof', '/api/v1/auth/native/visit-onboarding/account',
]);
const NATIVE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);
const HEALTH = new Set(['/healthz', '/readyz', '/release', '/releasez']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};
// Static mode permits same-origin app/WASM plus the existing explicit
// Google/payment integrations. Development adds exact-origin HMR and eval only.
// CanvasKit is non-threaded: COEP/SharedArrayBuffer isolation is not required.
const CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://checkout.razorpay.com https://cdn.razorpay.com https://checkout-static-next.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com", "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob: data:",
  "connect-src 'self' https://accounts.google.com https://api.razorpay.com https://api-dark.razorpay.com https://checkout.razorpay.com https://express.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com https://lumberjack-metrics.razorpay.com",
  "frame-src 'self' https://accounts.google.com https://api.razorpay.com https://checkout.razorpay.com", "form-action 'self' https://api.razorpay.com",
].join('; ');

function checkedUpstream(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Preview API must be a fixed loopback HTTP origin.');
  return url;
}
function checkedPublicOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Configure the exact HTTPS public preview origin.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hostname.includes('*')) throw new Error('Configure the exact HTTPS public preview origin, without a path or wildcard.');
  return url.origin;
}
function requestPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  const pathname = raw.split('?')[0];
  if (/%(?:2f|5c)/i.test(pathname)) return null;
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(part => part === '.' || part === '..')) return null;
  return decoded;
}
function blockedPath(pathname) {
  return /(?:^|\/)\.[^/]*(?:\/|$)/.test(pathname) || /\.map$/i.test(pathname)
    || /^\/(?:metrics|__[^/]*|@[^/]*|src|node_modules|frontend|backend|mobile|packages)(?:\/|$)/i.test(pathname)
    || /^\/api\/(?:docs|schema)(?:[^a-z]|$)/i.test(pathname)
    || /^\/api\/v1\/development(?:\/|$)/i.test(pathname);
}
function incomingOrigin(req) {
  const value = req.headers.origin;
  if (value === undefined) return null;
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.origin === value && !url.username && !url.password ? value : false; } catch { return false; }
}
function allowedOrigins(port, publicOrigin) {
  return new Set([publicOrigin, TRUSTED_UPSTREAM_ORIGIN, 'http://localhost:5173', `http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
}
function validHost(req) {
  const port = req.socket.localPort;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(req.headers.host);
}
function nativeApiRequest(req, pathname) {
  if (!NATIVE_METHODS.has(req.method) || req.headers.cookie !== undefined || req.headers['x-csrftoken'] !== undefined || req.headers.referer !== undefined || Object.keys(req.headers).some(key => key.startsWith('sec-fetch-'))) return false;
  const authorization = req.headers.authorization;
  // Shape only: the owning API must authenticate, authorize and bind the token
  // to its selected world. A prefix never grants an action at this proxy.
  if (authorization !== undefined) {
    const match = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
    return !!match && /^tc_native_[A-Za-z0-9_-]{43}$/.test(match[1]);
  }
  return req.method === 'POST' && NATIVE_PUBLIC_POSTS.has(pathname) && typeof req.headers['content-type'] === 'string' && req.headers['content-type'].split(';', 1)[0].trim().toLowerCase() === 'application/json';
}
function safeHeaders(headers) {
  const output = { ...headers };
  const named = typeof output.connection === 'string' ? output.connection.split(',').map(value => value.trim().toLowerCase()) : [];
  for (const key of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...named]) delete output[key];
  return output;
}
function send(res, status, detail, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(detail);
}
function proxy(req, res, upstream, native = false) {
  const headers = safeHeaders(req.headers);
  for (const key of Object.keys(headers)) if (key === 'forwarded' || key.startsWith('x-forwarded-')) delete headers[key];
  headers.host = upstream.host;
  // Only a validated browser hop receives the trusted private browser Origin.
  // Native clients use explicitly presented bearer/account proofs, not cookies.
  if (native) { delete headers.origin; delete headers.cookie; delete headers['x-csrftoken']; }
  else headers.origin = TRUSTED_UPSTREAM_ORIGIN;
  const target = new URL(req.url, upstream);
  const request = http.request(target, { method: req.method, headers }, response => {
    const responseHeaders = safeHeaders(response.headers);
    if (native) delete responseHeaders['set-cookie'];
    if (req.url.startsWith('/api')) responseHeaders['cache-control'] = 'private, no-store';
    res.writeHead(response.statusCode ?? 502, responseHeaders);
    pipeline(response, res, () => {});
  });
  request.on('error', () => { if (!res.headersSent) send(res, 502, 'The campus API is unavailable.'); else res.destroy(); });
  req.on('aborted', () => request.destroy());
  res.on('close', () => { if (!res.writableFinished) request.destroy(); });
  req.pipe(request);
}
function contained(root, filename) { return filename === root || filename.startsWith(root + path.sep); }

/** Static export or web-only Metro development host. Factory targets are
 * loopback-only; the CLI keeps API8000 and binds only127.0.0.1. */
function createServer({ exportRoot = DEFAULT_EXPORT_ROOT, upstreamOrigin = 'http://127.0.0.1:8000', publicOrigin: configuredPublicOrigin, mode = 'static', metroOrigin = 'http://[::1]:8084', publicRoot = path.resolve(__dirname, '../public') } = {}) {
  if (!['static', 'development'].includes(mode)) throw new Error('Use static or development preview mode.');
  const upstream = checkedUpstream(upstreamOrigin), publicOrigin = checkedPublicOrigin(configuredPublicOrigin);
  const root = mode === 'static' ? fs.realpathSync(exportRoot) : null;
  let index = null;
  if (root) {
    if (!fs.statSync(root).isDirectory()) throw new Error('Preview export must be a directory.');
    index = fs.realpathSync(path.join(root, 'index.html'));
    if (!contained(root, index) || !fs.statSync(index).isFile()) throw new Error('Preview requires its contained exported index.html.');
  }
  const development = mode === 'development' ? require('./web-metro-preview.cjs').createMetroDevelopmentProxy({ metroOrigin, publicRoot, cleanPath: requestPath, safeHeaders, send,
    admitUpgrade: req => { const origin = incomingOrigin(req); return validHost(req) && typeof origin === 'string' && allowedOrigins(req.socket.localPort, publicOrigin).has(origin) && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin') ? origin : null; },
    csp: port => CSP.replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'").replace("connect-src 'self'", "connect-src 'self' " + [...allowedOrigins(port, publicOrigin)].map(origin => origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')).join(' ')),
  }) : null;
  const server = http.createServer(async (req, res) => {
    try {
      if (!validHost(req)) return send(res, 403, 'Unknown preview host.');
      const pathname = requestPath(req.url);
      if (pathname === null) return send(res, 400, 'Invalid preview path.');
      if (blockedPath(pathname) && !development?.bundle(req.url)) return send(res, 404, 'Not found.');
      const origin = incomingOrigin(req), origins = allowedOrigins(req.socket.localPort, publicOrigin);
      if (origin === false || origin !== null && !origins.has(origin)) return send(res, 403, 'This preview accepts its exact browser origin only.');
      const api = pathname === '/api' || pathname.startsWith('/api/'), email = pathname.startsWith('/email-assets/'), health = HEALTH.has(pathname);
      if (!api && !email && !health && /^\/(?:healthz|readyz|releasez?|email-assets)(?:\/|$)/.test(pathname)) return send(res, 404, 'Not found.');
      if (api || email || health) {
        if (!api && req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Read-only bridge.', { Allow: 'GET, HEAD' });
        const native = api && origin === null && nativeApiRequest(req, pathname);
        if (api && origin === null && req.headers.authorization !== undefined && !native) return send(res, 403, 'Use one explicit native credential without browser session headers.');
        if (api && !SAFE.has(req.method) && !native) {
          if (origin === null || req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, 'Use this preview origin for campus actions.');
          // A present Referer is supplementary evidence, never a substitute for
          // the actual Origin. It must not contradict the allowed initiating page.
          if (req.headers.referer !== undefined) {
            try { if (new URL(req.headers.referer).origin !== origin) return send(res, 403, 'The initiating preview page changed.'); }
            catch { return send(res, 403, 'Invalid initiating preview page.'); }
          }
        }
        return proxy(req, res, upstream, native);
      }
      if (development) return development.handleHttp(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Static preview.', { Allow: 'GET, HEAD' });
      let filename = pathname === '/' ? index : path.resolve(root, '.' + pathname), real;
      if (!contained(root, filename)) return send(res, 403, 'Not found.');
      try { real = await fsp.realpath(filename); }
      catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        if (pathname.startsWith('/_expo/') || pathname.startsWith('/assets/') || pathname.startsWith('/skia/') || path.posix.extname(pathname)) return send(res, 404, 'Asset not found.');
        // A missing child of an outside symlink is not a document route.
        let parent = path.dirname(filename);
        while (contained(root, parent)) {
          try { if (!contained(root, await fsp.realpath(parent))) return send(res, 403, 'Not found.'); break; }
          catch (failure) { if (!['ENOENT', 'ENOTDIR'].includes(failure.code)) throw failure; }
          const next = path.dirname(parent); if (next === parent) break; parent = next;
        }
        real = index;
      }
      if (!contained(root, real)) return send(res, 403, 'Not found.');
      const file = await fsp.open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let stat; try { stat = await file.stat(); } catch (error) { await file.close(); throw error; }
      if (!stat.isFile()) { await file.close(); return send(res, 404, 'Not found.'); }
      const contentType = MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
      const immutable = real !== index && /[a-f0-9]{12,}/i.test(path.basename(real));
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', ...(real === index ? { 'Content-Security-Policy': CSP } : {}) });
      if (req.method === 'HEAD') { await file.close(); res.end(); return; }
      pipeline(file.createReadStream(), res, () => { void file.close().catch(() => {}); });
    } catch { if (!res.headersSent) send(res, 500, 'The preview resource is unavailable.'); else res.destroy(); }
  });
  // Static mode has no upgrades. Development exposes only the filtered web
  // HMR graph; ordinary application HTTP polling/API behavior is unchanged.
  server.on('upgrade', (req, socket, head) => development ? development.upgrade(req, socket, head) : socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  if (development) { const close = server.close.bind(server); server.close = (...args) => { development.close(); return close(...args); }; }
  return server;
}

module.exports = { createServer, DEFAULT_EXPORT_ROOT };
if (require.main === module) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '5173' }, dir: { type: 'string', default: DEFAULT_EXPORT_ROOT }, 'public-origin': { type: 'string' }, mode: { type: 'string', default: 'static' }, 'metro-origin': { type: 'string', default: 'http://[::1]:8084' } }, allowPositionals: false });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid unprivileged preview port.');
  const publicOrigin = checkedPublicOrigin(values['public-origin']), server = createServer({ exportRoot: path.resolve(values.dir), publicOrigin, mode: values.mode, metroOrigin: values['metro-origin'] });
  server.on('error', error => { console.error(`Preview did not start: ${error.code ?? 'server_error'}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`${values.mode === 'development' ? 'Live development' : 'Frozen'} ThatCampus RN Web preview on http://127.0.0.1:${port}; public origin ${publicOrigin}; API unchanged.`));
}
