import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { captureApiContext } from './api';

/** A UI preflight/confirmation keeps the same focused source and transport.
 * The owning command journal still owns preparation, receipts and replay. */
export function useOperationContext(source: string) {
  const { scopeKey } = useSession(), focused = useIsFocused(), mounted = useRef(false);
  const current = useRef({ source, scopeKey, focused }); current.current = { source, scopeKey, focused };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(() => {
    const active = () => { if (!mounted.current || !current.current.focused || current.current.source !== source || current.current.scopeKey !== scopeKey || AppState.currentState !== 'active') throw new Error('Return to the original account, campus, world and record before continuing.'); };
    active(); const transport = captureApiContext();
    return () => { active(); transport.assertCurrent(); };
  }, [source, scopeKey]);
}
