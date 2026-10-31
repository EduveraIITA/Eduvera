import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { assertEventFinance, eventFinanceRead, type NativeEvent, type EventFinance } from '../lib/event-policy';
import { useApi } from '../lib/query';
import { Button, Notice } from '../ui/components';
import { exactEventAttention } from './EventAdminPolicy';
export function EventAttention({ event, href, schoolId, studentId }: { event: NativeEvent; href: string; schoolId: string; studentId: string | null }) {
  const query = new URLSearchParams(href.split('?')[1] ?? ''), id = query.get('attention_notification_id'), needsFinance = !!studentId && !!(query.get('withdrawal_id') || query.get('refund_id'));
  const finance = useApi<EventFinance>(needsFinance ? eventFinanceRead(schoolId, event.id, studentId) : null), client = useQueryClient(), { scopeKey } = useSession();
  const [focused, setFocused] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), attempted = useRef('');
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  let validated: EventFinance | undefined;
  if (!finance.isError && finance.data) try { assertEventFinance(finance.data, event.id, studentId); validated = finance.data; } catch { /* Leave attention unread when exact finance evidence is absent. */ }
  const exact = exactEventAttention(event, href, studentId, validated);
  useEffect(() => {
    if (!focused || !id || !exact || attempted.current === `${scopeKey}:${href}`) return;
    attempted.current = `${scopeKey}:${href}`; let active = true; const context = captureApiContext();
    void apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${encodeURIComponent(id)}/read/`, { method: 'POST', body: JSON.stringify({ opened_target: href }) }).then(async receipt => { context.assertCurrent(); if (receipt.id !== id || !Number.isFinite(Date.parse(receipt.read_at))) throw new Error('Opened evidence was not confirmed.'); if (!active) return; setError(''); await client.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: item => typeof item.queryKey[2] === 'string' && /notifications|attention/.test(item.queryKey[2]) }); }).catch(() => { if (active) setError('This exact event update is visible, but its opened status was not confirmed.'); });
    return () => { active = false; };
  }, [focused, id, exact, scopeKey, href, client, retry]);
  if (!id) return null;
  if (error) return <><Notice tone="warning" message={error} /><Button title="Retry event opened status" kind="secondary" onPress={() => { attempted.current = ''; setRetry(value => value + 1); }} /></>;
  return !exact && (!needsFinance || !finance.isPending) ? <Notice tone="warning" message="This event attention target no longer matches the current record. It was not marked as opened." /> : null;
}
