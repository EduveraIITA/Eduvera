import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import type { ReportAttentionProof } from './report-attention';

export function useReportAttention(proof: ReportAttentionProof | null, verifiedAt: number, onNavigate: (href: string) => void) {
  const { scopeKey, status, environment } = useSession(), client = useQueryClient(), [foreground, setForeground] = useState(AppState.currentState === 'active'), [focused, setFocused] = useState(false);
  const current = useRef({ proof, scopeKey, focused, foreground, onNavigate }); current.current = { proof, scopeKey, focused, foreground, onNavigate };
  const attempted = useRef<{ key: string } | null>(null), lastVerified = useRef(verifiedAt), [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => { setFocused(true); current.current.focused = true; return () => { setFocused(false); current.current.focused = false; }; }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', value => { current.current.foreground = value === 'active'; setForeground(value === 'active'); }); return () => { current.current.foreground = false; subscription.remove(); }; }, []);
  useEffect(() => {
    if (!proof || status !== 'authenticated' || environment.unavailable || !focused || !foreground) return;
    const key = `${scopeKey}:${proof.key}`; if (attempted.current?.key === key) return; const attempt = { key }; attempted.current = attempt;
    let active = true; const abort = new AbortController();
    void (async () => {
      const context = captureApiContext(); const assertCurrent = () => { context.assertCurrent(); if (!active || !current.current.focused || !current.current.foreground || current.current.scopeKey !== scopeKey || current.current.proof?.key !== proof.key) throw new Error('This exact published result is no longer visible.'); };
      assertCurrent(); const receipt = await apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${proof.notificationId}/read/`, { method: 'POST', body: JSON.stringify({ opened_target: proof.openedTarget }), signal: abort.signal }); assertCurrent();
      if (receipt.id !== proof.notificationId || !Number.isFinite(Date.parse(receipt.read_at))) throw new Error('The result opening was not confirmed.');
      await Promise.all([client.invalidateQueries({ queryKey: ['campus', scopeKey, '/api/v1/workspace'] }), client.invalidateQueries({ queryKey: ['campus', scopeKey, 'notifications'] })]); assertCurrent(); current.current.onNavigate(proof.cleanHref);
    })().catch(() => { if (attempted.current === attempt) attempted.current = null; });
    return () => { active = false; if (attempted.current === attempt) attempted.current = null; abort.abort(); };
  }, [proof?.key, scopeKey, status, environment.unavailable, focused, foreground, client, retry]);
  // A source refresh can retry a failed acknowledgement. It must not cancel an
  // in-flight exact opening merely because another family feed completed.
  useEffect(() => { if (lastVerified.current === verifiedAt) return; lastVerified.current = verifiedAt; if (!attempted.current) setRetry(value => value + 1); }, [verifiedAt]);
}
