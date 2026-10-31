import { ApiError } from '../lib/api-client';
import { createSessionLifecycle, type SessionOperation } from './session-lifecycle';
import type { SessionState } from './session-types';
import { browserAuthMutation } from './web-auth-mutation';
import { canRetainSessionPresentation } from './session-presentation';
import { confirmedDemoSwitch, type DemoProfile, type DemoSwitchWire } from './demo-profile-policy';
import { initialWebSession, verifiedBrowserProfile, type BrowserProfileWire, type BrowserSessionWire } from './web-session-policy';
import { googleCredential, type GoogleLoginOptions } from './google-auth-policy';
import { requestVisitOnboarding as visitRequest } from './visit-onboarding-request';
import type { VisitPublicAction } from './visit-join-policy';

export interface BrowserSessionApi {
  getApiOrigin(): string;
  apiFetch<T>(path: string, init?: RequestInit): Promise<T>;
  blockApiRequests(): void;
  bindApiSession(value: null, namespace: null): void;
  bindCookieSession(namespace: string | null, unavailable?: boolean): void;
}
export interface BrowserSessionControllerOptions {
  api: BrowserSessionApi;
  onState(state: SessionState): void;
  clearQueries(): void;
  cancelQueries?(): void;
  isExplicitlyLoggedOut(): boolean;
  markExplicitlyLoggedOut(value: boolean): void;
  announceChange(): void;
}
type SignInWire = { user?: { id?: string }; mfa_required?: boolean; challenge_token?: string };

/** Serializes cookie-changing ceremonies; it never reads or retains a session token. */
export function createBrowserSessionController(options: BrowserSessionControllerOptions) {
  const { api } = options, lifecycle = createSessionLifecycle(api.getApiOrigin);
  let state = initialWebSession, remoteSignOutUnconfirmed = false;
  const signOutWarning = 'This tab is signed out. Remote sign-out could not be confirmed; retry before using this account on a shared device.';
  const publish = (next: SessionState) => { state = next; options.onState(next); };
  const invalidate = (clear = true) => { options.cancelQueries?.(); api.blockApiRequests(); if (clear) options.clearQueries(); };
  const anonymous = () => { options.clearQueries(); api.bindApiSession(null, null); publish({ ...initialWebSession, status: 'anonymous', error: remoteSignOutUnconfirmed ? signOutWarning : null }); };
  const begin = (keepAnonymousForm = false) => {
    const operation = lifecycle.begin(); invalidate(!state.user);
    publish({ ...state, status: keepAnonymousForm && !state.user ? 'anonymous' : 'loading', error: null });
    return operation;
  };
  const fail = (cause: unknown, operation: SessionOperation) => {
    if (!operation.isCurrent()) return;
    api.blockApiRequests();
    if (cause instanceof ApiError && cause.status === 401) anonymous();
    else publish({ ...state, status: 'error', error: cause instanceof Error ? cause.message : 'Your session could not be confirmed.' });
  };

  async function load(operation: SessionOperation, expectedActor?: string, ignoreExplicitLogout = false, validateSelection?: (next: SessionState) => void) {
    operation.assertCurrent();
    if (!ignoreExplicitLogout && options.isExplicitlyLoggedOut()) { anonymous(); return; }
    const session = await api.apiFetch<BrowserSessionWire>('/api/v1/auth/session/'); operation.assertCurrent();
    if (session.authenticated === false && session.user === null) { if (expectedActor) throw new Error('The server did not confirm your sign-in. Please try again.'); anonymous(); return; }
    const profile = await api.apiFetch<BrowserProfileWire>('/api/v1/auth/me/'); operation.assertCurrent();
    const next = verifiedBrowserProfile(session, profile, expectedActor);
    validateSelection?.(next);
    options.markExplicitlyLoggedOut(false);
    remoteSignOutUnconfirmed = false;
    operation.assertCurrent();
    const world = next.environment;
    // Keep the same screen/draft mounted behind verification. Only install a
    // changed identity after its old query data has been removed synchronously.
    if (!canRetainSessionPresentation(state, next)) options.clearQueries();
    api.bindCookieSession(world.namespace_id ?? (world.institution_id ? `live:${world.institution_id}` : 'live:global'), world.unavailable === true);
    publish(next);
  }

  function refresh() {
    const operation = begin(state.status === 'anonymous');
    return lifecycle.serialize(async () => { try { await load(operation); } catch (cause) { fail(cause, operation); } });
  }
  function expire() { lifecycle.begin(); invalidate(); anonymous(); }
  function suspend() { lifecycle.begin(); invalidate(!state.user); publish({ ...state, status: state.status === 'anonymous' ? 'anonymous' : 'loading', error: null }); }

  function signIn(path: string, body: unknown, mfa = false, presentation?: GoogleLoginOptions): Promise<string | null> {
    presentation?.assertCurrent();
    if (state.user) return Promise.reject(new Error('Sign out of your current account before starting another sign-in.'));
    const underlying = begin(true);
    const operation: SessionOperation = { isCurrent: underlying.isCurrent,assertCurrent() { underlying.assertCurrent(); presentation?.assertCurrent(); } };
    return lifecycle.serialize(async () => {
      try {
        operation.assertCurrent();
        const response = await browserAuthMutation<SignInWire>(api, path, body, operation);
        operation.assertCurrent();
        if (response.mfa_required === true) {
          if (!mfa || typeof response.challenge_token !== 'string' || !response.challenge_token) throw new Error('The server did not issue a valid verification challenge.');
          anonymous(); return response.challenge_token;
        }
        if (!response.user?.id) throw new Error('The server did not confirm this account.');
        await load(operation, response.user.id, true);
        return null;
      } catch (cause) {
        if (operation.isCurrent()) anonymous();
        throw cause;
      } finally { options.announceChange(); }
    });
  }
  async function logout() {
    options.markExplicitlyLoggedOut(true);
    const operation = lifecycle.begin(); invalidate(); anonymous();
    // This queued revocation must finish before a later sign-in can set cookies.
    // The local explicit-logout marker survives an uncertain remote outcome.
    return lifecycle.serialize(async () => {
      try { await api.apiFetch('/api/v1/auth/logout/', { method: 'POST' }); remoteSignOutUnconfirmed = false; if (operation.isCurrent()) anonymous(); }
      catch { remoteSignOutUnconfirmed = true; if (operation.isCurrent()) anonymous(); }
      finally { options.announceChange(); }
    });
  }
  function select(path: string, body: unknown, validateSelection: (next: SessionState) => void) {
    if (state.status !== 'authenticated' || !state.user) return Promise.reject(new Error('Confirm your current account before changing campus context.'));
    const actorId = state.user.id, operation = begin();
    return lifecycle.serialize(async () => {
      let refusal: unknown;
      try { operation.assertCurrent(); await browserAuthMutation(api, path, body, operation); }
      catch (cause) { refusal = cause; }
      finally { options.announceChange(); }
      operation.assertCurrent();
      try { await load(operation, actorId, false, refusal ? undefined : validateSelection); }
      catch (cause) { fail(cause, operation); throw cause; }
      operation.assertCurrent();
      if (refusal) throw refusal;
    });
  }
  function switchDemoProfile(profile: Pick<DemoProfile, 'role' | 'username'>) {
    if (state.status !== 'authenticated' || !state.user) return Promise.reject(new Error('Confirm your current account before switching demo profiles.'));
    const current = state.user, publicDemo = state.publicDemo === true, operation = begin();
    return lifecycle.serialize(async () => {
      try {
        operation.assertCurrent();
        const response = await browserAuthMutation<DemoSwitchWire>(api, '/api/v1/auth/demo-profile-switch/', { role: profile.role }, operation);
        operation.assertCurrent();
        // The web same-profile ceremony retains its existing read-only property;
        // it does not include that flag in its response.
        const retained = response.user?.id === current.id && response.public_demo === undefined;
        const target = confirmedDemoSwitch({ ...response, public_demo: retained ? publicDemo : response.public_demo }, profile, current, publicDemo);
        await load(operation, target.id, false, next => {
          if (next.user?.username !== profile.username || (next.publicDemo === true) !== publicDemo || next.environment.mode !== 'live') throw new Error('The selected demo session could not be confirmed.');
        });
      } catch (cause) { fail(cause, operation); throw cause; }
      finally { options.announceChange(); }
    });
  }
  function requestVisitOnboarding(action: VisitPublicAction, body: unknown, assertCurrent: () => void, onDispatch?: () => void) {
    if (!['anonymous','authenticated'].includes(state.status)) return Promise.reject(new Error('Confirm your current account before continuing with this visit.'));
    const operation = lifecycle.capture();
    return lifecycle.serialize(() => visitRequest(api, 'web', action, body, operation, assertCurrent,onDispatch));
  }
  return { refresh, expire, suspend, requestVisitOnboarding, login: (identifier: string, password: string) => signIn('/api/v1/auth/login/', { identifier: identifier.trim(), password }, true),
    googleLogin: (credential?: string,presentation?: GoogleLoginOptions) => signIn('/api/v1/auth/google/',{ credential: googleCredential(credential) },true,presentation),
    completeMfa: async (challenge: string, code: string) => { await signIn('/api/v1/auth/mfa/login/', { challenge_token: challenge, code }); },
    register: async (email: string, password: string) => { await signIn('/api/v1/auth/register/', { email: email.trim(), password }); }, logout,
    enterPublicDemo: async (role: import('./session-types').PublicDemoRole) => { await signIn('/api/v1/auth/public-demo-session/', { role }); }, switchDemoProfile,
    selectSchool: (schoolId: string) => select('/api/v1/auth/active-school/', { school_id: schoolId }, next => {
      if (next.user?.active_school_id !== schoolId || next.environment.institution_id !== schoolId || next.environment.mode !== 'live') throw new Error('The server did not confirm the selected campus. Refresh before continuing.');
    }),
    selectEnvironment: (selection: { mode: 'live' } | { mode: 'simulation'; run_id: string }) => {
      const requested = { ...selection }, schoolId = state.user?.active_school_id ?? state.environment.institution_id ?? null;
      return select('/api/v1/auth/execution-environment/', requested, next => {
        if ((next.user?.active_school_id ?? null) !== schoolId || (next.environment.institution_id ?? null) !== schoolId || next.environment.mode !== requested.mode || requested.mode === 'simulation' && (next.environment.run_id !== requested.run_id || next.environment.unavailable)) throw new Error('The server did not confirm the selected campus environment. Refresh before continuing.');
      });
    },
  };
}
