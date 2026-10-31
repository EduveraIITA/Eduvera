import { GOOGLE_BASE64URL_32, GOOGLE_NATIVE_CALLBACK } from './google-auth-policy';
import type { AuthUser, Environment } from './session-types';

const failure = () => new Error('Google sign-in could not be confirmed. Start again.');
function checkedUrl(value: string): URL { try { return new URL(value); } catch { throw failure(); } }
export function checkedGoogleNativeExchange(value: unknown,now = Date.now()): { kind: 'mfa'; challenge: string } | { kind: 'session'; response: { user: AuthUser; execution_environment: Environment; access_token: string; expires_at: string; token_type: 'Bearer' } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const row = value as Record<string,unknown>;
  if (row.mfa_required === true) {
    if (typeof row.challenge_token !== 'string' || !GOOGLE_BASE64URL_32.test(row.challenge_token) || row.access_token !== undefined) throw failure();
    return { kind: 'mfa',challenge: row.challenge_token };
  }
  const user = row.user as AuthUser | undefined,environment = row.execution_environment as Environment | undefined;
  if (row.mfa_required !== undefined && row.mfa_required !== false || row.token_type !== 'Bearer' || typeof row.access_token !== 'string' || !/^tc_native_[A-Za-z0-9_-]{43}$/.test(row.access_token) || typeof row.expires_at !== 'string' || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now || !user || typeof user.id !== 'string' || !user.id || environment?.mode !== 'live' || row.public_demo === true) throw failure();
  return { kind: 'session',response: { ...row,user,execution_environment: environment,access_token: row.access_token,expires_at: row.expires_at,token_type: 'Bearer' } };
}
export function googleNativeConfiguration(value: unknown): { enabled: false } | { enabled: true; authorizationOrigin: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const row = value as Record<string,unknown>;
  if (row.enabled === false) return { enabled: false };
  if (row.enabled !== true || typeof row.authorization_origin !== 'string') throw failure();
  const url = checkedUrl(row.authorization_origin);
  if (url.protocol !== 'https:' || url.username || url.password || row.authorization_origin !== url.origin) throw failure();
  return { enabled: true,authorizationOrigin: url.origin };
}
export function googleNativeCallback(value: string, state: string): string {
  if (!GOOGLE_BASE64URL_32.test(state) || typeof value !== 'string' || value.length > 18000 || !value.startsWith(GOOGLE_NATIVE_CALLBACK+'?')) throw failure();
  const url = checkedUrl(value);
  if (url.origin !== 'null' || url.protocol !== 'thatcampus:' || url.host !== 'auth' || url.pathname !== '/google' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'code' && key !== 'state') || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 || url.searchParams.get('state') !== state) throw failure();
  const code = url.searchParams.get('code');
  if (!code || code.length < 43 || code.length > 16384 || !/^[A-Za-z0-9._-]+$/.test(code)) throw failure();
  return code;
}
/** Expo can provide relative or encoded paths. Recognize the reserved callback
 * namespace before parsing so malformed/cold returns cannot expose a grant in
 * normal router history or a not-found screen. Only the exact URI below may
 * suppress navigation; this recognition itself grants no authentication. */
function callbackLike(path: string): boolean {
  let head = path.trim().split(/[?#]/,1)[0] ?? '';
  for (let count=0;count<3;count++) { try { const decoded=decodeURIComponent(head); if(decoded===head) break; head=decoded; } catch { break; } }
  const relative = (head.split(/[?#]/,1)[0] ?? '').replace(/\\/g,'/').replace(/^thatcampus:\/*/i,'').replace(/^\/+/, '');
  return /^(?:(?:[^/@]+@)?auth(?::[^/]*)?\/+)?google(?:\/|$)/i.test(relative);
}
export function createGoogleNativeReturnRegistry() {
  let active: { state: string; assertCurrent(): void; expiresAt: number } | null = null;
  return {
    begin(state: string,assertCurrent: () => void,expiresAt: number) {
      if (!GOOGLE_BASE64URL_32.test(state) || !Number.isFinite(expiresAt)) throw failure();
      assertCurrent(); const record = { state,assertCurrent,expiresAt }; active = record;
      return () => { if (active === record) active = null; };
    },
    redirect(path: string,initial: boolean,now = Date.now()): string {
      if (!callbackLike(path)) return path;
      try {
        if (initial || !active || now >= active.expiresAt) throw failure();
        active.assertCurrent(); googleNativeCallback(path,active.state);
        // SDK58's falsy-path branch ignores only its ROUTER handling. The
        // independent Expo WebBrowser listener still receives the original URL.
        return '';
      } catch { return '/login?google_return=expired'; }
    },
  };
}
export const googleNativeReturns = createGoogleNativeReturnRegistry();

export interface GoogleNativeFlowOptions {
  request(path: string,body?: unknown): Promise<unknown>;
  entropy(): Promise<{ state: string; verifier: string; challenge: string }>;
  open(url: string,callback: string): Promise<{ type: string; url?: string }>;
  assertCurrent(): void;
  now?(): number;
  returns?: ReturnType<typeof createGoogleNativeReturnRegistry>;
}
/** Proof and verifier stay volatile. A lost/unknown exchange is never replayed
 * and cannot be inferred as success from a browser cookie or another session. */
export async function runGoogleNativeFlow(options: GoogleNativeFlowOptions): Promise<{ kind: 'cancelled' } | { kind: 'response'; response: unknown }> {
  const check = options.assertCurrent, now = options.now ?? Date.now;
  check(); const config = googleNativeConfiguration(await options.request('/api/v1/auth/native/google/config/')); check();
  if (!config.enabled) throw new Error('Google sign-in is not configured for this server.');
  const attempt = await options.entropy(); check();
  if (![attempt.state,attempt.verifier,attempt.challenge].every(value => GOOGLE_BASE64URL_32.test(value)) || attempt.state === attempt.verifier) throw failure();
  const started = await options.request('/api/v1/auth/native/google/start/',{ redirect_uri: GOOGLE_NATIVE_CALLBACK,state: attempt.state,code_challenge: attempt.challenge,code_challenge_method: 'S256' }); check();
  if (!started || typeof started !== 'object') throw failure();
  const wire = started as Record<string,unknown>;
  if (typeof wire.authorization_url !== 'string' || typeof wire.expires_at !== 'string') throw failure();
  const expiresAt = Date.parse(wire.expires_at), url = checkedUrl(wire.authorization_url), request = url.searchParams.get('request');
  if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt-now() > 10*60*1000+5000 || url.origin !== config.authorizationOrigin || url.pathname !== '/api/v1/auth/native/google/authorize/' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'request') || url.searchParams.getAll('request').length !== 1 || !request || request.length > 16384 || !/^[A-Za-z0-9._-]+$/.test(request)) throw failure();
  const release = (options.returns ?? googleNativeReturns).begin(attempt.state,check,expiresAt);
  try {
    check(); const returned = await options.open(url.href,GOOGLE_NATIVE_CALLBACK); check();
    if (returned.type === 'cancel' || returned.type === 'dismiss') return { kind: 'cancelled' };
    if (returned.type !== 'success' || typeof returned.url !== 'string') throw failure();
    const code = googleNativeCallback(returned.url,attempt.state); check();
    const response = await options.request('/api/v1/auth/native/google/exchange/',{ code,code_verifier: attempt.verifier,redirect_uri: GOOGLE_NATIVE_CALLBACK }); check();
    return { kind: 'response',response };
  } finally { release(); }
}
