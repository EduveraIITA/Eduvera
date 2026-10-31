const http = require('node:http');

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Local Metro preview only. Deployment must route /api through its own origin. */
function createWebApiProxy({ target = 'http://127.0.0.1:8000', trustedOrigin = 'http://127.0.0.1:5173' } = {}) {
  const upstream = new URL(target);
  if (upstream.protocol !== 'http:' || !loopback.has(upstream.hostname) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('The RN Web preview proxy requires a local backend origin.');
  return (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    let incoming;
    try { incoming = new URL(`http://${req.headers.host}`); } catch { res.writeHead(400).end(); return; }
    if (!loopback.has(incoming.hostname) || (req.headers.origin && req.headers.origin !== incoming.origin)) { res.writeHead(403).end('This local preview only accepts same-origin requests.'); return; }
    // As in the maintained Vite preview, normalize this private proxy hop to
    // the API's trusted development origin. Browser CSRF token checks remain.
    const headers = { ...req.headers, host: upstream.host, origin: trustedOrigin };
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-') || key === 'forwarded') delete headers[key];
    const proxy = http.request(new URL(req.url, upstream), { method: req.method, headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"detail":"The local campus API is unavailable."}'); });
    req.on('aborted', () => proxy.destroy());
    res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
    req.pipe(proxy);
  };
}

module.exports = { createWebApiProxy };
