const CANONICAL_HOST = 'thatcampus.com';
const WWW_HOST = `www.${CANONICAL_HOST}`;
const APP_HOST = `app.${CANONICAL_HOST}`;

const STATIC_ASSET_PATHS = new Set([
  '/favicon.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-edura.png',
  '/edura-leaf-favicon.png',
  '/manifest.webmanifest',
]);

function isStaticAssetRequest(url, method) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || STATIC_ASSET_PATHS.has(url.pathname);
}

function canonicalRedirect(url) {
  const canonical = new URL(url);
  canonical.hostname = CANONICAL_HOST;
  canonical.port = '';
  canonical.protocol = 'https:';
  return Response.redirect(canonical, 308);
}

function originUrl(requestUrl, configuredOrigin) {
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.run.app') || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('ORIGIN_URL must be a root Cloud Run HTTPS URL');
  }
  const target = new URL(requestUrl);
  target.protocol = origin.protocol;
  target.hostname = origin.hostname;
  target.port = origin.port;
  return target;
}

function rewriteOriginLocation(response, configuredOrigin, publicHost = CANONICAL_HOST) {
  const location = response.headers.get('location');
  if (!location) return response;

  let resolved;
  try {
    resolved = new URL(location, configuredOrigin);
  } catch {
    return response;
  }
  if (resolved.origin !== new URL(configuredOrigin).origin) return response;

  resolved.protocol = 'https:';
  resolved.hostname = publicHost;
  resolved.port = '';
  const headers = new Headers(response.headers);
  headers.set('location', resolved.toString());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.hostname === WWW_HOST) return canonicalRedirect(incoming);

    const configuredOrigin = incoming.hostname === CANONICAL_HOST
      ? env.SITE_ORIGIN_URL
      : incoming.hostname === APP_HOST
        ? env.APP_ORIGIN_URL
        : null;
    if (!configuredOrigin) return new Response('Unknown host', { status: 421 });

    let target;
    try {
      target = originUrl(incoming, configuredOrigin);
    } catch {
      return new Response('Edge configuration error', { status: 503 });
    }

    const upstreamRequest = new Request(target, request);
    upstreamRequest.headers.set('x-forwarded-host', incoming.hostname);
    upstreamRequest.headers.set('x-forwarded-proto', 'https');
    // Browser module requests carry the branded Origin even though the Worker
    // fetches a Cloud Run origin. Static files need no CORS authorization. API
    // requests retain Origin so application authorization remains authoritative.
    if (incoming.hostname === APP_HOST && isStaticAssetRequest(incoming, request.method)) {
      upstreamRequest.headers.delete('origin');
    }
    const upstream = await fetch(upstreamRequest, { redirect: 'manual' });
    return rewriteOriginLocation(upstream, configuredOrigin, incoming.hostname);
  },
};

export { canonicalRedirect, isStaticAssetRequest, originUrl, rewriteOriginLocation };
