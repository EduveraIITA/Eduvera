import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, bindApiSession, blockApiRequests, getApiOrigin, revokeCurrentNativeSession, setApiCallbacks, setApiOrigin } from '../lib/api';
import { scopeIdentity } from '../lib/api-policy';
import { createSessionLifecycle, type SessionOperation } from './session-lifecycle';
import { canRetainSessionPresentation } from './session-presentation';
import { confirmedNativeDemoSwitch, type DemoSwitchWire } from './demo-profile-policy';
import type { AuthUser, Membership, Environment, SessionState, SessionContext } from './session-types';
import { nativeGoogleSignIn } from './google-native-browser';
import type { GoogleLoginOptions } from './google-auth-policy';
import { checkedGoogleNativeExchange } from './google-native-flow';
import { requestVisitOnboarding as visitRequest } from './visit-onboarding-request';
import { storedNativeSession, type StoredNativeSession } from './native-session-restore';
import type { VisitPublicAction } from './visit-join-policy';
export type { AuthUser, Membership, Environment } from './session-types';

interface SessionWire { authenticated?: boolean; user: AuthUser; execution_environment: Environment; access_token?: string; expires_at?: string; mfa_required?: boolean; challenge_token?: string; public_demo?: boolean }
interface MeWire { user: AuthUser; memberships: Membership[]; execution_environment: Environment; company_operator?: boolean; institution_setup_required?: boolean; onboarding?: { status: string; resume?: { path: string } } }
const initial: SessionState = { status: 'loading', user: null, memberships: [], environment: { mode: 'live' }, error: null, setupRequired: false };
const Context = createContext<SessionContext | null>(null);
const STORAGE_KEY = 'thatcampus.native-session.v1';

function confirmedEnvironment(value: Environment | undefined): Environment {
  if (!value || !['live', 'simulation'].includes(value.mode)) throw new Error('The server did not confirm your campus environment.');
  if (value.mode === 'simulation' && (!value.namespace_id || !value.run_id || (!value.unavailable && !value.virtual_clock?.now))) throw new Error('The Simulation environment is incomplete. Return to Live to continue.');
  return value;
}

export function SessionProvider({ children }: React.PropsWithChildren) {
  const client = useQueryClient();
  const [state, setState] = useState<SessionState>(initial);
  const presentation = useRef(state); presentation.current = state;
  const credential = useRef<StoredNativeSession | null>(null);
  const configuredOrigin = useRef(getApiOrigin()).current;
  const revision = useRef(0);
  const lifecycle = useRef(createSessionLifecycle(getApiOrigin)).current;
  const invalidate = useCallback((clear = true) => { blockApiRequests(); void client.cancelQueries(); if (clear) client.clear(); revision.current++; }, [client]);
  const forget = useCallback(async () => {
    lifecycle.begin();
    invalidate(); credential.current = null; bindApiSession(null, null);
    setState({ ...initial, status: 'anonymous' });
    await lifecycle.serialize(() => SecureStore.deleteItemAsync(STORAGE_KEY));
  }, [invalidate, lifecycle]);

  const restore = useCallback(async (operation: SessionOperation = lifecycle.capture(), expectedActor?: string, strict = false, expectedPublicDemo?: boolean) => {
    if (!operation.isCurrent()) return;
    const stored = credential.current;
    if (!stored) { setState({ ...initial, status: 'anonymous' }); return; }
    if (stored.origin !== getApiOrigin() || (!__DEV__ && stored.origin !== configuredOrigin)) { await forget(); return; }
    const previous = presentation.current;
    invalidate(!previous.user);
    const started = revision.current;
    setState(previous => ({ ...previous, status: 'loading', error: null }));
    bindApiSession(stored.token, null);
    try {
      const session = await apiFetch<SessionWire>('/api/v1/auth/native/session/');
      if (!operation.isCurrent() || started !== revision.current) return;
      const environment = confirmedEnvironment(session.execution_environment);
      const me = await apiFetch<MeWire>('/api/v1/auth/me/');
      if (!operation.isCurrent() || started !== revision.current) return;
      if (!me.user?.id || me.user.id !== session.user.id || expectedActor && me.user.id !== expectedActor) throw new Error('Your account context changed. Please sign in again.');
      const world = confirmedEnvironment(me.execution_environment ?? environment);
      if (expectedPublicDemo !== undefined && ((session.public_demo === true) !== expectedPublicDemo || world.mode !== 'live')) throw new Error('The server did not confirm the selected account in Live with its original demo restrictions.');
      bindApiSession(stored.token, world.namespace_id ?? null, world.unavailable === true);
      const next: SessionState = { status: 'authenticated', user: me.user, memberships: me.memberships ?? [], environment: world, error: null,
        setupRequired: me.institution_setup_required === true || me.onboarding?.status === 'workspace_required', companyOperator: me.company_operator === true, publicDemo: session.public_demo === true, onboarding: me.onboarding };
      if (!canRetainSessionPresentation(previous, next)) client.clear();
      setState(next);
    } catch (error) {
      if (!operation.isCurrent() || started !== revision.current) return;
      blockApiRequests();
      setState(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : 'Your session could not be restored.' }));
      if (strict) throw error;
    }
  }, [invalidate, lifecycle, client, forget, configuredOrigin]);

  useEffect(() => {
    setApiCallbacks(() => { void forget(); }, () => { void restore(); });
    let mounted = true;
    const operation = lifecycle.capture();
    void lifecycle.serialize(() => SecureStore.getItemAsync(STORAGE_KEY)).then(async raw => {
      if (!mounted || !operation.isCurrent()) return;
      if (raw) {
        const parsed = storedNativeSession(raw, configuredOrigin, __DEV__, Date.now());
        if (!parsed) { await forget(); return; }
        if (__DEV__) setApiOrigin(parsed.origin);
        credential.current = parsed;
      }
      if (mounted) await restore(lifecycle.capture());
    }).catch(error => { if (mounted && operation.isCurrent()) setState({ ...initial, status: 'error', error: String(error) }); });
    return () => { mounted = false; setApiCallbacks(() => {}, () => {}); };
  }, [forget, restore, lifecycle, configuredOrigin]);

  const accept = useCallback(async (response: SessionWire, operation: SessionOperation) => {
    operation.assertCurrent();
    if (!response.access_token || !response.expires_at || !response.user?.id) throw new Error('The server did not issue a complete native session.');
    confirmedEnvironment(response.execution_environment);
    const stored = { token: response.access_token, origin: getApiOrigin(), expiresAt: response.expires_at };
    await lifecycle.serialize(async () => {
      operation.assertCurrent();
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(stored), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      operation.assertCurrent();
    });
    operation.assertCurrent();
    credential.current = stored;
    await restore(operation, response.user.id, true, response.public_demo === true);
  }, [restore, lifecycle]);
  const beginSignIn = useCallback(async () => {
    if (credential.current) throw new Error('Sign out of your current account before starting another sign-in.');
    const operation = lifecycle.begin();
    invalidate(); credential.current = null; bindApiSession(null, null);
    await lifecycle.serialize(() => SecureStore.deleteItemAsync(STORAGE_KEY));
    operation.assertCurrent();
    return operation;
  }, [invalidate, lifecycle]);
  const login = useCallback(async (identifier: string, password: string) => {
    const operation = await beginSignIn();
    const response = await apiFetch<SessionWire>('/api/v1/auth/native/login/', { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), password }) });
    operation.assertCurrent();
    if (response.mfa_required && response.challenge_token) return response.challenge_token;
    await accept(response, operation); return null;
  }, [accept, beginSignIn]);
  const googleLogin = useCallback(async (credential?: string,options?: GoogleLoginOptions) => {
    if (credential !== undefined) throw new Error('Start Google sign-in from this device.');
    options?.assertCurrent();
    const operation = await beginSignIn();
    const assertCurrent = () => { operation.assertCurrent(); options?.assertCurrent(); };
    assertCurrent(); const result = await nativeGoogleSignIn(assertCurrent); assertCurrent();
    if (result.kind === 'cancelled') return null;
    const confirmed = checkedGoogleNativeExchange(result.response);
    if (confirmed.kind === 'mfa') return confirmed.challenge;
    // Once the exact grant is confirmed, ordinary session commit owns the
    // Keychain/restore boundary. Its lifecycle survives the expected loading
    // presentation while still rejecting another sign-in, logout or origin.
    await accept(confirmed.response,operation); return null;
  }, [accept,beginSignIn]);
  const completeMfa = useCallback(async (challenge: string, code: string) => {
    const operation = await beginSignIn();
    await accept(await apiFetch<SessionWire>('/api/v1/auth/native/mfa/login/', { method: 'POST', body: JSON.stringify({ challenge_token: challenge, code }) }), operation);
  }, [accept, beginSignIn]);
  const register = useCallback(async (email: string, password: string) => {
    const operation = await beginSignIn();
    await accept(await apiFetch<SessionWire>('/api/v1/auth/native/register/', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }), operation);
  }, [accept, beginSignIn]);
  const logout = useCallback(async () => {
    const revocation = revokeCurrentNativeSession();
    await forget();
    await revocation;
  }, [forget]);
  const enterPublicDemo = useCallback(async (role: import('./session-types').PublicDemoRole) => {
    const operation = await beginSignIn();
    const response = await apiFetch<SessionWire>('/api/v1/auth/native/public-demo-session/', { method: 'POST', body: JSON.stringify({ role }) });
    operation.assertCurrent();
    if (response.public_demo !== true) throw new Error('The server did not confirm a read-only sample session.');
    await accept(response, operation);
  }, [accept, beginSignIn]);
  const switchDemoProfile = useCallback(async (profile: { role: import('./session-types').PublicDemoRole; username: string }) => {
    const current = presentation.current, stored = credential.current;
    if (current.status !== 'authenticated' || !current.user || !stored) throw new Error('Confirm your current account before switching demo profiles.');
    const operation = lifecycle.begin();
    invalidate(); setState(previous => ({ ...previous, status: 'loading', error: null }));
    try {
      const response = await apiFetch<DemoSwitchWire>('/api/v1/auth/native/demo-profile-switch/', { method: 'POST', body: JSON.stringify({ role: profile.role }) });
      operation.assertCurrent();
      confirmedNativeDemoSwitch(response, profile, current.user, current.publicDemo === true, stored.expiresAt);
      if (response.session_retained === true) await restore(operation, current.user.id, true, current.publicDemo === true);
      else await accept(response as SessionWire, operation);
    } catch (cause) {
      // A lost rotation response may have revoked the old token. Never repeat
      // the switch or claim to have restored the previous account automatically.
      if (operation.isCurrent()) { blockApiRequests(); setState(previous => ({ ...previous, status: 'error', error: 'The profile switch could not be confirmed. Verify your session before switching again.' })); }
      throw cause;
    }
  }, [accept, invalidate, lifecycle, restore]);
  const selectSchool = useCallback(async (schoolId: string) => {
    const operation = lifecycle.begin();
    invalidate(); setState(previous => ({ ...previous, status: 'loading' }));
    try { await apiFetch('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: schoolId }) }); }
    finally { if (operation.isCurrent()) await restore(operation); }
  }, [invalidate, restore, lifecycle]);
  const selectEnvironment = useCallback(async (selection: { mode: 'live' } | { mode: 'simulation'; run_id: string }) => {
    const operation = lifecycle.begin();
    invalidate(); setState(previous => ({ ...previous, status: 'loading' }));
    try { await apiFetch('/api/v1/auth/execution-environment/', { method: 'POST', body: JSON.stringify(selection) }); }
    finally { if (operation.isCurrent()) await restore(operation); }
  }, [invalidate, restore, lifecycle]);
  const requestVisitOnboarding = useCallback((action: VisitPublicAction, body: unknown, assertCurrent: () => void, onDispatch?: () => void) => {
    if (!['anonymous','authenticated'].includes(presentation.current.status)) return Promise.reject(new Error('Confirm your current account before continuing with this visit.'));
    return visitRequest({ apiFetch }, 'native', action, body, lifecycle.capture(), assertCurrent,onDispatch);
  }, [lifecycle]);
  const schoolId = state.user?.active_school_id ?? state.environment.institution_id ?? null;
  return <Context.Provider value={{ ...state, ready: state.status !== 'loading', schoolId,
    scopeKey: JSON.stringify([getApiOrigin(), scopeIdentity(state.user?.id ?? 'anonymous', schoolId, state.environment)]),
    login, googleLogin, completeMfa, register, requestVisitOnboarding, enterPublicDemo, switchDemoProfile, logout, refresh: () => restore(), selectSchool, selectEnvironment }}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error('SessionProvider is required.'); return value; }
