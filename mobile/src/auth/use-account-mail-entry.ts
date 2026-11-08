import { useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { getApiOrigin } from '../lib/api';
import { accountMailLinkInput, accountMailLinks, type AccountMailPurpose } from './account-mail-link';

/** Capture before redirecting to login; scrub either modern fragments or older
 * query proofs. Reloading a scrubbed nonce fails safely and asks for the email. */
export function useAccountMailEntry(purpose: AccountMailPurpose, params: Record<string, unknown>) {
  const origin = getApiOrigin(), routeParams = useLocalSearchParams();
  const navigation = useNavigation<{ replaceParams(params: typeof routeParams): void }>();
  const browser = typeof window !== 'undefined' && window.location && window.history ? window : null;
  const path = purpose === 'password_reset' ? '/reset-password' : '/account/security';
  const browserPath = browser?.location.pathname;
  const ownsBrowserPath = browserPath === path || purpose === 'email_verification' && browserPath === '/more/account/security';
  const browserRoute = ownsBrowserPath ? browser : null;
  // replaceState scrubs before the router necessarily updates its props. Read
  // proof controls from the actual alias URL so a stale href cannot restore it.
  const values = (key: string) => {
    if (!browserRoute) return browser ? undefined : params[key];
    const entries = new URL(browserRoute.location.href).searchParams.getAll(key);
    return entries.length > 1 ? entries : entries[0];
  };
  const tokenParam = values('token'), continuation = values('continue'), fragment = browserRoute?.location.hash ?? '';
  const signature = JSON.stringify([browserPath, tokenParam, continuation, fragment]);
  const [entry, setEntry] = useState<{ ready: boolean; token?: string; continuation?: string; invalid?: boolean }>(() => ({ ready: tokenParam === undefined && continuation === undefined && !fragment }));
  useEffect(() => {
    if (browser && !browserRoute) return;
    const fail = () => setEntry({ ready: true, invalid: true });
    if (continuation !== undefined && tokenParam === undefined && !fragment) {
      const token = accountMailLinks.read(continuation, purpose, origin);
      if (!token) { fail(); return; }
      setEntry({ ready: true, token, continuation: String(continuation) }); return;
    }
    const input = browserRoute && (fragment || tokenParam !== undefined) ? accountMailLinkInput(browserRoute.location.href, origin) ?? null
      : tokenParam === undefined ? undefined : typeof tokenParam === 'string'
        ? accountMailLinkInput(`${path}?token=${encodeURIComponent(tokenParam)}`, origin) : null;
    if (input === undefined) { setEntry(prior => prior.invalid ? prior : { ready: true }); return; }
    // Remove the proof even when input is malformed; no caller-derived return URL.
    let historyState: unknown = browser?.history.state;
    if (browser) {
      // Routers may also retain their original URL/params in history.state.
      // Preserve ordinary router state, but never copy a captured proof back.
      const proofs = [tokenParam, ...new URLSearchParams(fragment.slice(1)).getAll('token')].flat();
      try {
        const serialized = JSON.stringify(historyState);
        if (proofs.some(value => typeof value === 'string' && value.length > 0 && [value, encodeURIComponent(value)]
          .some(proof => serialized?.includes(JSON.stringify(proof).slice(1, -1))))) historyState = null;
      } catch { historyState = null; }
      browser.history.replaceState(historyState, '', browser.location.pathname);
    }
    // Expo keeps its own route snapshot and can rewrite the initial URL after
    // replaceState. Clear the proof from this screen's route params as well.
    const clearNavigationProof = (id?: string) => {
      if (!browserRoute) return;
      const clean = { ...routeParams };
      delete clean['#'];
      delete clean.token;
      delete clean.continue;
      if (id) clean.continue = id;
      navigation.replaceParams(clean);
    };
    if (!input || input.purpose !== purpose || continuation !== undefined) { clearNavigationProof(); fail(); return; }
    try {
      const retained = accountMailLinks.retain(input.token, purpose, origin, Crypto.randomUUID);
      if (browser) browser.history.replaceState(historyState, '', `${browser.location.pathname}?continue=${retained.id}`);
      clearNavigationProof(retained.id);
      setEntry({ ready: true, token: input.token, continuation: retained.id });
    } catch { clearNavigationProof(); fail(); }
  }, [signature, purpose, origin, navigation]);
  return entry;
}
