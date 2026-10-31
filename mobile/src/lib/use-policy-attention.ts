import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import type { PolicyAttentionProof } from './policy-attention';

export function usePolicyAttention(proof: PolicyAttentionProof | null, verifiedAt: number) {
  const { scopeKey, status, environment } = useSession(), router = useRouter(), client = useQueryClient();
  const focused = useIsFocused(), current = useRef({ proof, focused, scopeKey }); current.current = { proof, focused, scopeKey };
  const attempted = useRef('');
  useEffect(() => {
    if (!proof || status !== 'authenticated' || environment.unavailable || !focused || AppState.currentState !== 'active') return;
    const attempt = `${scopeKey}:${proof.key}`; if (attempted.current === attempt) return;
    attempted.current = attempt;
    let active = true; const abort = new AbortController(), context = captureApiContext();
    const assertCurrent = () => { context.assertCurrent(); if (!active || !current.current.focused || current.current.scopeKey !== scopeKey || current.current.proof?.key !== proof.key || AppState.currentState !== 'active') throw new Error('The exact policy version is no longer visible.'); };
    void (async () => {
      assertCurrent();
      const receipt = await apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${proof.notificationId}/read/`, { method: 'POST', body: JSON.stringify({ opened_target: proof.openedTarget }), signal: abort.signal });
      assertCurrent();
      if (receipt.id !== proof.notificationId || !Number.isFinite(Date.parse(receipt.read_at))) throw new Error('Policy attention was not confirmed.');
      await Promise.all([client.invalidateQueries({ queryKey: ['campus', scopeKey, 'notifications'] }), client.invalidateQueries({ queryKey: ['campus', scopeKey, '/api/v1/workspace'] })]); assertCurrent();
      router.setParams({ attention_notification_id: undefined });
    })().catch(() => { if (attempted.current === attempt) attempted.current = ''; });
    return () => { active = false; abort.abort(); };
  }, [proof?.key, verifiedAt, scopeKey, status, environment.unavailable, focused, client, router]);
}
