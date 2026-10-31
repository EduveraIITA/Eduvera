const PUBLIC_ORIGIN = 'https://app2.thatcampus.com';

/** Separate DT edge: never routes or deploys the ERP or marketing hosts. */
export async function proxyDigitalTwin(request, env, send = fetch) {
  const incoming = new URL(request.url);
  if (incoming.origin !== PUBLIC_ORIGIN) return new Response('Not found', { status: 404 });
  let origin;
  try { origin = new URL(env.DT_ORIGIN_URL); } catch { return unavailable(request.method); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !/^thatcampus-dt-[a-z0-9-]+\.(?:asia-south1\.)?run\.app$/.test(origin.hostname)) return unavailable(request.method);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-forwarded-for');
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');
  const client = request.headers.get('cf-connecting-ip');
  if (client) headers.set('x-forwarded-for', client);
  try {
    const response = await send(new Request(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', ...(request.body ? { duplex: 'half' } : {}),
    }), { cf: { cacheEverything: false, cacheTtl: 0 } });
    const result = new Response(response.body, response);
    // This gateway also serves authenticated APIs and readiness failures.
    // Never allow a Worker/CDN/browser heuristic cache to retain either.
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('CDN-Cache-Control', 'no-store');
    result.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    return result;
  } catch { return unavailable(request.method); }
}

function unavailable(method) {
  return Response.json({ detail: ['GET', 'HEAD'].includes(method)
    ? 'The campus service is temporarily unavailable. Please try again.'
    : 'The connection was interrupted. The action may have completed; refresh before repeating it.' },
  { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
}

export default { fetch(request, env) { return proxyDigitalTwin(request, env); } };
