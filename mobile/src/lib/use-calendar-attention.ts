import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import { acknowledgeCalendarAttention, type CalendarAttentionProof } from './calendar-attention';

export function useCalendarAttention(proof: CalendarAttentionProof | null, verifiedAt: number) {
  const { scopeKey, status, environment } = useSession(), router = useRouter(), cache = useQueryClient();
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === 'active'), [retry, setRetry] = useState(0), [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const current = useRef({ proof, scopeKey, focused, foreground }); current.current = { proof, scopeKey, focused, foreground };
  const attempted = useRef('');
  useFocusEffect(useCallback(() => { current.current.focused = true; setFocused(true); return () => { current.current.focused = false; setFocused(false); }; }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', value => { current.current.foreground = value === 'active'; setForeground(value === 'active'); }); return () => { current.current.foreground = false; subscription.remove(); }; }, []);
  useEffect(() => {
    if (!proof || !verifiedAt || status !== 'authenticated' || environment.unavailable || !focused || !foreground) return;
    const attempt = `${scopeKey}:${proof.key}`; if (attempted.current === attempt) return;
    attempted.current = attempt;
    let active = true, completed = false;
    const abort = new AbortController();
    // The owner transport consumes the signal; blur/background/source drift also
    // invalidates the callback (TanStack cancellation alone cannot undo a POST).
    void acknowledgeCalendarAttention(proof, {
      capture: captureApiContext,
      isCurrent: () => active && current.current.focused && current.current.foreground && current.current.scopeKey === scopeKey && current.current.proof?.key === proof.key,
      send: (path, body) => apiFetch(path, { method: 'POST', body, signal: abort.signal }),
      confirmed: async (_cleanHref, assertCurrent) => {
        assertCurrent();
        await Promise.all([cache.invalidateQueries({ queryKey: ['campus', scopeKey, 'notifications'] }), cache.invalidateQueries({ queryKey: ['campus', scopeKey, '/api/v1/workspace'] })]);
        assertCurrent(); setFailure(null); completed = true;
        // Remove only the acknowledged notification selector from this REAL
        // route entry. Its date, scope, view, search, filter and detail stay put.
        router.setParams({ attention_notification_id: undefined });
      },
    }).catch(() => {
      if (attempted.current === attempt) attempted.current = '';
      if (active && current.current.scopeKey === scopeKey && current.current.proof?.key === proof.key) setFailure({ key: proof.key, message: 'This exact Calendar update is visible, but its opened status was not confirmed.' });
    });
    return () => { active = false; abort.abort(); if (!completed && attempted.current === attempt) attempted.current = ''; };
  }, [proof?.key, verifiedAt, scopeKey, status, environment.unavailable, focused, foreground, retry, cache, router]);
  return { error: proof && failure?.key === proof.key ? failure.message : '', retry: () => { attempted.current = ''; setRetry(value => value + 1); } };
}
