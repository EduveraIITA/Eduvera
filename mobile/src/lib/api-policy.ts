export function normalizeApiOrigin(value: string, development = false): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Enter the server address without a path, password or query.');
  }
  const octets = url.hostname.split('.').map(Number);
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || (ipv4 && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)));
  if (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) {
    throw new Error('Use an HTTPS server address. Local HTTP is available in development.');
  }
  return url.origin;
}

export function isInternalHref(href: string): boolean {
  const pathname = href.split(/[?#]/)[0]!;
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(href) || /%(?:2f|5c)/i.test(pathname)) return false;
  try { return !pathname.split('/').some(segment => { const decoded = decodeURIComponent(segment); return decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/.test(decoded); }); }
  catch { return false; }
}

export function isExecutionRequest(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/v1/auth/')
    && !/^\/api\/v1\/invitations\/(?:accept|recipient-proof)\/?(?:\?|$)/.test(path)
    && !/^\/api\/v1\/schools\/[^/]+\/simulation(?:\/|$)/.test(path);
}

const apiUuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const simulationCapturePath = new RegExp(`^/api/v1/schools/${apiUuid}/simulation/runs(?:/${apiUuid}/duplicate)?/?$`, 'i');
/** A cold isolated campus capture can outlast ordinary reads. Recovery uses
 * these same keyed endpoints, so its deadline must not depend on UI state. */
export function campusRequestTimeoutMs(path: string, method: string, ordinaryTimeoutMs: number): number {
  return method.toUpperCase() === 'POST' && simulationCapturePath.test(path.split('?')[0]!)
    ? Math.max(ordinaryTimeoutMs, 120_000) : ordinaryTimeoutMs;
}

export function scopeIdentity(actor: string, school: string | null, environment: { mode: string; namespace_id?: string | null }): string {
  return JSON.stringify([actor, school, environment.mode, environment.namespace_id ?? null]);
}

export function safeDownloadFilename(value: string): string {
  const basename = value.split(/[\\/]/).at(-1) ?? '';
  const cleaned = basename.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!cleaned) return 'campus-file';
  if (cleaned.length <= 120) return cleaned;
  const extension = /\.[a-z0-9]{1,12}$/i.exec(cleaned)?.[0] ?? '';
  return `${cleaned.slice(0, 120 - extension.length)}${extension}`;
}
