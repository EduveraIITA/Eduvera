import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import { acknowledgeAttendanceAttention, type AttendanceAttentionProof } from './attendance-attention';

export function useAttendanceAttention(proof: AttendanceAttentionProof | null, verifiedAt: number) {
  const { scopeKey, status, environment } = useSession(), router = useRouter(), client = useQueryClient();
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === 'active');
  const focusedNow = useRef(false), foregroundNow = useRef(AppState.currentState === 'active'), attempted = useRef('');
  const latest = useRef({ proof, scopeKey }); latest.current = { proof, scopeKey };
  useFocusEffect(useCallback(() => { focusedNow.current = true; setFocused(true); return () => { focusedNow.current = false; setFocused(false); }; }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { foregroundNow.current = state === 'active'; setForeground(state === 'active'); }); return () => { foregroundNow.current = false; subscription.remove(); }; }, []);
  useEffect(() => {
    if (!proof || status !== 'authenticated' || environment.unavailable || !focused || !foreground) return;
    const attempt = `${scopeKey}:${proof.key}`;
    if (attempted.current === attempt) return;
    attempted.current = attempt;
    let active = true, completed = false;
    const abort = new AbortController();
    void acknowledgeAttendanceAttention(proof, {
      capture: captureApiContext,
      isCurrent: () => active && focusedNow.current && foregroundNow.current && latest.current.scopeKey === scopeKey && latest.current.proof?.key === proof.key,
      send: (path, body) => apiFetch(path, { method: 'POST', body, signal: abort.signal }),
      confirmed: async (_cleanHref, assertCurrent) => {
        assertCurrent();
        await Promise.all([client.invalidateQueries({ queryKey: ['campus', scopeKey, 'notifications'] }), client.invalidateQueries({ queryKey: ['campus', scopeKey, '/api/v1/workspace'] })]);
        assertCurrent(); completed = true; router.setParams({ attention_notification_id: undefined });
      },
    }).catch(() => { if (attempted.current === attempt) attempted.current = ''; });
    return () => { active = false; abort.abort(); if (!completed && attempted.current === attempt) attempted.current = ''; };
  }, [proof?.key, verifiedAt, scopeKey, status, environment.unavailable, focused, foreground, client, router]);
}
