import { campusRequestTimeoutMs, isExecutionRequest, isInternalHref, normalizeApiOrigin, safeDownloadFilename } from './api-policy';
import { assertGateIdentityImage, gateIdentityImagePath, GATE_IDENTITY_IMAGE_MAX_BYTES } from './gate-operator-policy';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) { super(message); this.name = 'ApiError'; }
}
/** Separate from verified API refusals so interrupted mutations stay uncertain.
 * Only an unreadable gateway failure has an HTTP status; interrupted I/O does not. */
export class ApiConnectionError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'ApiConnectionError'; }
}
export interface CampusResponse {
  readonly ok: boolean; readonly status: number; readonly redirected?: boolean; readonly url?: string;
  readonly headers: { get(name: string): string | null }; readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}
export interface CampusApiContext { readonly assertCurrent: () => void }
export type CampusFetch = (url: string, init: RequestInit) => Promise<CampusResponse>;
export interface TemporaryCampusFile { readonly uri: string; write(bytes: Uint8Array): Promise<void>; delete(): Promise<void> | void }
export interface CampusDownloadAdapter {
  isAvailable(): Promise<boolean>;
  createTemporaryFile(filename: string): Promise<TemporaryCampusFile> | TemporaryCampusFile;
  share(uri: string, options: { mimeType: string; dialogTitle: string }): Promise<void>;
}
export interface CampusApiOptions { origin: string; development?: boolean; fetcher?: CampusFetch; timeoutMs?: number; maxJsonBytes?: number; maxDownloadBytes?: number; cookieSession?: { readCsrfToken(): string | null } }
const contextChanged = () => new Error('The campus context changed while this request was pending. Refresh to continue.');
const isJson = (mime: string) => /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i.test(mime);
const mimeOf = (response: CampusResponse) => (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
const isHtml = (mime: string) => mime === 'text/html' || mime === 'application/xhtml+xml';
const looksLikeHtml = (text: string) => /^\s*<(?:!doctype\s+html\b|html\b|head\b|body\b|script\b)/i.test(text.replace(/^\uFEFF/, ''));
const serviceUnavailable = (status: number) => [502, 503, 504].includes(status) || status >= 520 && status <= 530;
const unavailableMessage = (readOnly: boolean) => readOnly
  ? 'The campus service is temporarily unavailable. Please try again shortly.'
  : 'The campus service is temporarily unavailable. An action may have completed; refresh before repeating it.';
const connectionMessage = (readOnly: boolean) => readOnly
  ? 'Could not connect to the campus service. Check your connection and try again.'
  : 'The connection was interrupted. An action may have completed; refresh before repeating it.';
function errorText(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object') return undefined;
  const body = value as Record<string, unknown>;
  for (const name of ['detail', 'message', 'error']) { const result = errorText(body[name], depth + 1); if (result) return result; }
  return undefined;
}

/** Injectable transport with no platform imports. Credentials remain private to this closure. */
export function createCampusApiClient(options: CampusApiOptions) {
  let origin = normalizeApiOrigin(options.origin, options.development), token: string | null = null, namespace: string | null = null;
  let epoch = 0, blocked = true, cookieAuthenticated = false;
  let onExpired = () => {}, onEnvironmentChanged = () => {};
  const fetcher: CampusFetch = options.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 30_000, maxJsonBytes = options.maxJsonBytes ?? 8 * 1024 * 1024, maxDownloadBytes = options.maxDownloadBytes ?? 25 * 1024 * 1024;
  const requests = new Map<AbortController, boolean>();
  const blockApiRequests = () => {
    blocked = true; epoch++;
    // Cookie-setting account requests are serialized by the web session owner.
    // Let their response settle before its queued logout; aborting a fetch does
    // not undo the server's Set-Cookie. Its obsolete JS result still fails below.
    requests.forEach((domain, controller) => { if (!options.cookieSession || domain) controller.abort(); });
  };
  const bindApiSession = (value: string | null, world: string | null, unavailable = false) => {
    if (options.cookieSession) {
      if (value !== null) throw new Error('Browser sessions cannot bind a native Bearer credential.');
      blockApiRequests(); cookieAuthenticated = false; namespace = null; return;
    }
    blockApiRequests(); token = value; namespace = world; blocked = unavailable;
  };
  const bindCookieSession = (world: string | null, unavailable = false) => {
    if (!options.cookieSession) throw new Error('Cookie sessions are unavailable on this transport.');
    blockApiRequests(); cookieAuthenticated = true; namespace = world; blocked = unavailable;
  };
  const setApiOrigin = (value: string) => {
    const next = normalizeApiOrigin(value, options.development);
    if (options.cookieSession && next !== origin) throw new Error('The browser uses this site’s secure session. Serve /api on the same origin.');
    if (next !== origin) { blockApiRequests(); token = null; namespace = null; origin = next; }
  };
  const setApiCallbacks = (expired: () => void, changed: () => void) => { onExpired = expired; onEnvironmentChanged = changed; };
  /** Capture before native/storage awaits; assert again before initiating campus I/O. */
  function captureApiContext(): CampusApiContext {
    const started = epoch;
    const assertCurrent = () => { if (started !== epoch || blocked) throw contextChanged(); };
    assertCurrent();
    return Object.freeze({ assertCurrent });
  }
  function pathScope(path: string) {
    if (!isInternalHref(path) || !path.startsWith('/api/') || path.includes('#')) throw new Error('This request is outside the campus API.');
    if (options.cookieSession && /^\/api\/v1\/auth\/native(?:\/|\?|$)/.test(path)) throw new Error('Native Bearer authentication is unavailable in the browser.');
    const domain = isExecutionRequest(path);
    if (domain && blocked) throw new Error('Confirm the active campus environment before continuing.');
    const started = epoch, server = origin;
    return { domain, server, assertCurrent: () => { if (started !== epoch || (domain && blocked)) throw contextChanged(); } };
  }
  function declaredLength(response: CampusResponse, maximum: number) {
    const header = response.headers.get('content-length');
    if (header !== null) { const length = Number(header); if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw new ApiError('The response is too large to open on this device.', response.status); }
  }
  async function readBytes(response: CampusResponse, maximum: number, assertCurrent: () => void): Promise<Uint8Array> {
    declaredLength(response, maximum);
    if (!response.body) throw new ApiError('The server did not return a readable file.', response.status);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0, complete = false;
    try {
      while (true) {
        const next = await reader.read(); assertCurrent();
        if (next.done) { complete = true; break; }
        length += next.value.byteLength;
        if (length > maximum) throw new ApiError('The response is too large to open on this device.', response.status);
        chunks.push(next.value);
      }
    } finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async function jsonBody(response: CampusResponse, assertCurrent: () => void, readOnly: boolean) {
    declaredLength(response, maxJsonBytes);
    const raw = response.body ? new TextDecoder().decode(await readBytes(response, maxJsonBytes, assertCurrent)) : await response.text();
    assertCurrent();
    if (new TextEncoder().encode(raw).byteLength > maxJsonBytes) throw new ApiError('The response is too large to open on this device.', response.status);
    const unreadable = (message: string) => serviceUnavailable(response.status)
      ? new ApiConnectionError(unavailableMessage(readOnly), response.status)
      : new ApiError(message, response.status);
    if ((raw && (!isJson(mimeOf(response)) || looksLikeHtml(raw))) || (serviceUnavailable(response.status) && (!isJson(mimeOf(response)) || !raw.trim()))) throw unreadable('The server returned an unexpected response. Please try again.');
    try { return raw ? JSON.parse(raw) as unknown : null; } catch { throw unreadable('The server response could not be read.'); }
  }
  async function request<T>(path: string, init: RequestInit, binary: boolean, binaryLimit = maxDownloadBytes): Promise<{ value: T; assertCurrent: () => void; mimeType: string }> {
    const scope = pathScope(path), controller = new AbortController(), readOnly = ['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
    let handledHttpError: ApiError | undefined, transportPending = false;
    const abort = () => controller.abort();
    if (init.signal?.aborted) controller.abort(); else init.signal?.addEventListener('abort', abort, { once: true });
    requests.set(controller, scope.domain); const timeout = setTimeout(() => controller.abort(), campusRequestTimeoutMs(path, init.method ?? 'GET', timeoutMs));
    try {
      const headers = new Headers(init.headers);
      headers.delete('Authorization'); headers.delete('Cookie'); headers.delete('X-ThatCampus-Execution-Environment');
      if (options.cookieSession) headers.delete('X-CSRFToken');
      headers.set('Accept', binary ? 'application/octet-stream, application/pdf, image/*, text/plain, text/csv' : 'application/json');
      // Public account ceremonies retain an existing bearer so that selected
      // Simulation cannot bypass the server's Live-account control boundary.
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (scope.domain && namespace) headers.set('X-ThatCampus-Execution-Environment', namespace);
      if (options.cookieSession && !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase())) {
        const csrf = options.cookieSession.readCsrfToken();
        if (csrf) headers.set('X-CSRFToken', csrf);
        else if (path.split('?')[0] !== '/api/v1/auth/logout/') throw new Error('The secure session token is unavailable. Refresh your session before continuing.');
      }
      if (init.body && !(typeof FormData !== 'undefined' && init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
      transportPending = true;
      const response = await fetcher(`${scope.server}${path}`, { ...init, headers, credentials: options.cookieSession ? 'same-origin' : 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
      transportPending = false;
      scope.assertCurrent();
      if (response.redirected || (response.url && new URL(response.url).origin !== scope.server)) throw new ApiError('The server redirected this request. Open the campus record again.', response.status);
      const mimeType = mimeOf(response);
      if (!response.ok || !binary) {
        transportPending = true;
        const body = await jsonBody(response, scope.assertCurrent, readOnly);
        transportPending = false;
        if (!response.ok) {
          handledHttpError = new ApiError(errorText(body) ?? `The request failed (${response.status}).`, response.status, body);
          const publicAuth = /^\/api\/v1\/auth\/(?:native\/)?(?:login|mfa\/login|register|google|public-demo-session)(?:\/|\?|$)/.test(path) || /^\/api\/v1\/auth\/(?:native\/)?password-reset\//.test(path)
            || /^\/api\/v1\/(?:auth\/native\/)?invitations\/(?:accept|recipient-proof)\/?(?:\?|$)/.test(path)
            || /^\/api\/v1\/auth\/(?:native\/)?visit-onboarding\/(?:preview|proof|account)\/?(?:\?|$)/.test(path);
          if (response.status === 401 && !publicAuth) onExpired();
          if (scope.domain && response.status === 409 && (body as { error?: { code?: string } } | null)?.error?.code === 'execution_environment_changed') { blockApiRequests(); onEnvironmentChanged(); }
          throw handledHttpError;
        }
        return { value: body as T, assertCurrent: scope.assertCurrent, mimeType };
      }
      if (response.headers.get('x-thatcampus-source-content-omitted')?.toLowerCase() === 'true') throw new ApiError('This Simulation contains file metadata only. The original file was not copied into this world.', response.status);
      if (!mimeType || isJson(mimeType) || isHtml(mimeType)) throw new ApiError('The server did not return the requested file. Please try again.', response.status);
      transportPending = true;
      const bytes = await readBytes(response, binaryLimit, scope.assertCurrent);
      transportPending = false;
      const prefix = new TextDecoder().decode(bytes.slice(0, 512));
      let disguisedJson = false;
      if (/^\s*[\[{]/.test(prefix)) { try { JSON.parse(new TextDecoder().decode(bytes)); disguisedJson = true; } catch { /* Binary data can start with a brace. */ } }
      if (!bytes.byteLength || looksLikeHtml(prefix) || disguisedJson) throw new ApiError('The server did not return the requested file. Please try again.', response.status);
      scope.assertCurrent(); return { value: bytes as T, assertCurrent: scope.assertCurrent, mimeType };
    } catch (error) {
      // Own expiry/environment callbacks intentionally change the epoch. Only
      // their already-verified HTTP refusal survives that transition.
      if (!handledHttpError || error !== handledHttpError) scope.assertCurrent();
      if (transportPending && !(error instanceof ApiError) && !(error instanceof ApiConnectionError) && !init.signal?.aborted) throw new ApiConnectionError(connectionMessage(readOnly));
      throw error;
    } finally { clearTimeout(timeout); controller.abort(); requests.delete(controller); init.signal?.removeEventListener('abort', abort); }
  }
  async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> { return (await request<T>(path, init, false)).value; }
  async function readCampusImage(path: string, signal?: AbortSignal) {
    if (!/^\/api\/v1\/schools\/[^/]+\/campus-scenes\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}\/$/i.test(path)) throw new Error('Choose a private image from the current campus layout.');
    const response = await request<Uint8Array>(path,{method:'GET',signal},true);
    response.assertCurrent();
    if (!['image/png','image/jpeg','image/webp'].includes(response.mimeType) || response.value.byteLength > 4*1024*1024) throw new Error('This campus image cannot be displayed.');
    return { bytes: response.value, mimeType: response.mimeType, assertCurrent: response.assertCurrent };
  }
  /** The Gate view supplies only the reference from its exact authorized detail.
   * Never pass a remote image URL directly to a native/browser image loader. */
  async function readGateIdentityImage(path: string, signal?: AbortSignal) {
    if (!path.startsWith('/api/v1/') || gateIdentityImagePath(path, origin) !== path) throw new Error('No authorized campus photo is available.');
    if (!token && !cookieAuthenticated) throw new Error('Sign in before opening an identity photo.');
    const response = await request<Uint8Array>(path, { method: 'GET', signal }, true, Math.min(maxDownloadBytes, GATE_IDENTITY_IMAGE_MAX_BYTES));
    response.assertCurrent();
    if (response.value.byteLength > GATE_IDENTITY_IMAGE_MAX_BYTES) throw new Error('This identity photo cannot be displayed.');
    assertGateIdentityImage(response.value, response.mimeType);
    return { bytes: response.value, mimeType: response.mimeType, assertCurrent: response.assertCurrent };
  }
  async function downloadCampusFile(path: string, filename: string, adapter: CampusDownloadAdapter): Promise<void> {
    const operation = pathScope(path);
    if (!token && !cookieAuthenticated) throw new Error('Sign in before downloading campus files.');
    if (!(await adapter.isAvailable())) throw new Error('File sharing is unavailable on this device.');
    operation.assertCurrent();
    const response = await request<Uint8Array>(path, { method: 'GET' }, true);
    operation.assertCurrent(); response.assertCurrent();
    let temporary: TemporaryCampusFile | undefined;
    try {
      temporary = await adapter.createTemporaryFile(safeDownloadFilename(filename));
      operation.assertCurrent(); response.assertCurrent(); await temporary.write(response.value);
      operation.assertCurrent(); response.assertCurrent();
      await adapter.share(temporary.uri, { mimeType: response.mimeType, dialogTitle: 'Share campus file' });
    } finally { if (temporary) { try { await temporary.delete(); } catch { throw new Error('The temporary file could not be cleared.'); } } }
  }
  function revokeCurrentNativeSession(): Promise<void> {
    if (options.cookieSession) return Promise.reject(new Error('Native Bearer sessions are unavailable in the browser.'));
    const current = token, server = origin;
    if (!current) return Promise.resolve();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    return fetcher(`${server}/api/v1/auth/native/logout/`, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${current}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })
      .then(response => { if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== server)) throw new Error('Remote sign-out could not be confirmed. The device is signed out.'); })
      .finally(() => clearTimeout(timeout));
  }
  return { getApiOrigin: () => origin, setApiOrigin, setApiCallbacks, blockApiRequests, bindApiSession, bindCookieSession, captureApiContext, apiFetch, readCampusImage, readGateIdentityImage, downloadCampusFile, revokeCurrentNativeSession };
}
