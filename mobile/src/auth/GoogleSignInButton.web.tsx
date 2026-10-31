import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { apiFetch, getApiOrigin } from '../lib/api.web';
import { Button, Notice } from '../ui/components';
import { useTheme } from '../ui/theme';
import { googleWebConfiguration } from './google-auth-policy';

type GoogleIdentity = {
  initialize(options: { client_id: string; nonce: string; auto_select: false; callback(response: { credential?: unknown }): void }): void;
  renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; width: number }): void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };
let loading: Promise<void> | undefined;
function loadGoogle(): Promise<void> {
  if ((window as GoogleWindow).google?.accounts?.id) return Promise.resolve();
  if (!loading) loading = new Promise<void>((resolve,reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('Google sign-in is taking too long to load.')); },15000);
    script.onload = () => { window.clearTimeout(timer); if ((window as GoogleWindow).google?.accounts?.id) resolve(); else { script.remove(); reject(new Error('Google sign-in is unavailable right now.')); } };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error('Google sign-in is unavailable right now.')); };
    document.head.appendChild(script);
  }).catch(cause => { loading = undefined; throw cause; });
  return loading;
}
export function GoogleSignInButton({ disabled = false,onCredential }: { disabled?: boolean; onCredential(credential?: string): Promise<void> }) {
  const { dark } = useTheme(), focused = useIsFocused(), origin = getApiOrigin(), host = useRef<HTMLDivElement>(null), [attempt,setAttempt] = useState(0), [state,setState] = useState<'loading'|'disabled'|'ready'|'error'>('loading'), [busy,setBusy] = useState(false);
  const latest = useRef({ disabled,onCredential,focused }); latest.current = { disabled,onCredential,focused };
  useEffect(() => {
    if (!focused) return;
    let cancelled = false, consumed = false;
    const current = () => !cancelled && latest.current.focused && origin === getApiOrigin();
    setState('loading');
    void (async () => {
      try {
        const config = googleWebConfiguration(await apiFetch('/api/v1/auth/google/config/'));
        if (!current()) return;
        if (!config.enabled) { setState('disabled'); return; }
        await loadGoogle(); if (!current() || !host.current) return;
        const sdk = (window as GoogleWindow).google?.accounts?.id; if (!sdk) throw new Error('Google sign-in is unavailable.');
        sdk.initialize({ client_id: config.clientId,nonce: config.nonce,auto_select: false,callback(response) {
          if (!current() || consumed || latest.current.disabled) return;
          consumed = true; setBusy(true);
          void (async () => { try { await latest.current.onCredential(typeof response.credential === 'string' ? response.credential : undefined); } finally { if (current()) { setBusy(false); setAttempt(value => value+1); } } })().catch(() => { /* The owning login form presents the failure without exposing provider proof. */ });
        } });
        host.current.replaceChildren(); sdk.renderButton(host.current,{ type: 'standard',theme: dark ? 'filled_black' : 'outline',size: 'large',text: 'continue_with',shape: 'rectangular',width: Math.min(400,host.current.clientWidth || 300) }); setState('ready');
      } catch { if (current()) setState('error'); }
    })();
    return () => { cancelled = true; host.current?.replaceChildren(); };
  },[focused,dark,origin,attempt]);
  if (!focused || state === 'disabled') return null;
  return <div style={{ display: 'grid',gap: 8,minHeight: 44 }}>
    <div ref={host} aria-label="Continue with Google" inert={disabled || busy || state !== 'ready'} style={{ minHeight: state === 'error' ? 0 : 44,display: 'flex',justifyContent: 'center',opacity: disabled || busy ? .5 : 1 }} />
    {state === 'loading' || busy ? <span role="status" style={{ textAlign: 'center' }}>{busy ? 'Signing in with Google…' : 'Loading Google sign-in…'}</span> : null}
    {state === 'error' ? <><Notice message="Google sign-in could not be loaded." /><Button title="Retry Google sign-in" kind="secondary" disabled={disabled} onPress={() => setAttempt(value => value+1)} /></> : null}
  </div>;
}
