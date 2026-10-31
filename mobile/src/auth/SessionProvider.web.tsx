import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api.web';
import { scopeIdentity } from '../lib/api-policy';
import type { SessionContext, SessionState } from './session-types';
import { createBrowserSessionController } from './web-session-controller';
import { EXPLICIT_WEB_LOGOUT_KEY, WEB_SESSION_SIGNAL_KEY, initialWebSession, isBrowserSessionSignal, type BrowserSessionSignal } from './web-session-policy';
export type { AuthUser, Membership, Environment } from './session-types';

const Context = createContext<SessionContext | null>(null);
const uniqueId = () => typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random()}`;

export function SessionProvider({ children }: React.PropsWithChildren) {
  const client = useQueryClient(), [state, setState] = useState<SessionState>(initialWebSession);
  const sender = useRef(uniqueId()), channel = useRef<BroadcastChannel | null>(null), localLogout = useRef(false);
  const controller = useRef<ReturnType<typeof createBrowserSessionController> | null>(null);
  if (!controller.current) controller.current = createBrowserSessionController({ api, onState: setState, clearQueries: () => client.clear(), cancelQueries: () => { void client.cancelQueries(); },
    isExplicitlyLoggedOut() { try { return localLogout.current || window.localStorage.getItem(EXPLICIT_WEB_LOGOUT_KEY) === '1'; } catch { return localLogout.current; } },
    markExplicitlyLoggedOut(value) { localLogout.current = value; try { if (value) window.localStorage.setItem(EXPLICIT_WEB_LOGOUT_KEY, '1'); else window.localStorage.removeItem(EXPLICIT_WEB_LOGOUT_KEY); } catch { /* A preference signal never grants authentication. */ } },
    announceChange() {
      const signal: BrowserSessionSignal = { version: 1, kind: 'session-environment-changed', senderId: sender.current, nonce: uniqueId() };
      try { channel.current?.postMessage(signal); } catch { /* Storage below is an independent fallback. */ }
      try { window.localStorage.setItem(WEB_SESSION_SIGNAL_KEY, JSON.stringify(signal)); window.localStorage.removeItem(WEB_SESSION_SIGNAL_KEY); } catch { /* Foreground verification still uses the authenticated server. */ }
    },
  });
  const session = controller.current;

  useEffect(() => {
    const verify = () => { void session.refresh(); }, expire = () => session.expire(), suspend = () => session.suspend();
    const visible = () => { if (document.visibilityState === 'visible') verify(); };
    const seen = new Set<string>();
    const receive = (value: unknown) => {
      if (!isBrowserSessionSignal(value) || value.senderId === sender.current || seen.has(value.nonce)) return;
      seen.add(value.nonce); if (seen.size > 32) seen.delete(seen.values().next().value!);
      // Signals carry no trusted actor, campus or world; block before re-reading.
      verify();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === EXPLICIT_WEB_LOGOUT_KEY) { localLogout.current = event.newValue === '1'; verify(); return; }
      if (event.key === WEB_SESSION_SIGNAL_KEY && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed untrusted signals. */ } }
    };
    api.setApiCallbacks(expire, verify);
    window.addEventListener('thatcampus:verify-execution-environment', verify);
    window.addEventListener('omnischool:session-expired', expire);
    window.addEventListener('omnischool:access-updated', verify);
    window.addEventListener('pageshow', verify); window.addEventListener('online', verify); window.addEventListener('pagehide', suspend);
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', visible);
    if (typeof BroadcastChannel !== 'undefined') { channel.current = new BroadcastChannel(WEB_SESSION_SIGNAL_KEY); channel.current.addEventListener('message', event => receive(event.data)); }
    verify();
    return () => {
      session.suspend(); api.setApiCallbacks(() => {}, () => {});
      window.removeEventListener('thatcampus:verify-execution-environment', verify);
      window.removeEventListener('omnischool:session-expired', expire); window.removeEventListener('omnischool:access-updated', verify);
      window.removeEventListener('pageshow', verify); window.removeEventListener('online', verify); window.removeEventListener('pagehide', suspend);
      window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); channel.current?.close(); channel.current = null;
    };
  }, [session]);

  const schoolId = state.user?.active_school_id ?? state.environment.institution_id ?? null;
  return <Context.Provider value={{ ...state, ready: state.status !== 'loading', schoolId,
    scopeKey: JSON.stringify([api.getApiOrigin(), scopeIdentity(state.user?.id ?? 'anonymous', schoolId, state.environment)]),
    login: session.login, googleLogin: session.googleLogin, completeMfa: session.completeMfa, register: session.register, requestVisitOnboarding: session.requestVisitOnboarding, enterPublicDemo: session.enterPublicDemo, switchDemoProfile: session.switchDemoProfile, logout: session.logout, refresh: session.refresh,
    selectSchool: session.selectSchool, selectEnvironment: session.selectEnvironment }}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error('SessionProvider is required.'); return value; }
