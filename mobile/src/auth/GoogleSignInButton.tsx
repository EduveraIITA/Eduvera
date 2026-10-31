import { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { apiFetch, getApiOrigin } from '../lib/api';
import { Button, Notice } from '../ui/components';
import { googleNativeConfiguration } from './google-native-flow';

export function GoogleSignInButton({ disabled = false,onCredential }: { disabled?: boolean; onCredential(credential?: string): Promise<void> }) {
  const focused = useIsFocused(), origin = getApiOrigin(), [state,setState] = useState<'loading'|'disabled'|'ready'|'error'>('loading'), [retry,setRetry] = useState(0);
  useEffect(() => {
    if (!focused) return;
    let active = true; setState('loading');
    void apiFetch('/api/v1/auth/native/google/config/').then(value => { const config = googleNativeConfiguration(value); if (active && getApiOrigin() === origin) setState(config.enabled ? 'ready' : 'disabled'); }).catch(() => { if (active && getApiOrigin() === origin) setState('error'); });
    return () => { active = false; };
  },[focused,origin,retry]);
  if (!focused || state === 'disabled') return null;
  if (state === 'error') return <><Notice message="Google sign-in availability could not be confirmed." /><Button title="Retry Google sign-in" kind="secondary" disabled={disabled} onPress={() => setRetry(value => value+1)} /></>;
  return <Button title={state === 'loading' ? 'Checking Google sign-in…' : 'Continue with Google'} kind="secondary" disabled={disabled || state !== 'ready'} onPress={() => { void onCredential().catch(() => {}); }} />;
}
