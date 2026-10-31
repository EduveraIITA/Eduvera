import React, { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { isInternalHref } from '../lib/api-policy';
import { Button, Empty, Loading, Notice, Page, Row, Section } from '../ui/components';

type Props = { href: string; onNavigate: (href: string) => void };
type Notification = { id: string; kind: string; title: string; body: string; link: string; metadata?: Record<string, unknown>;
  attention_eligible: boolean; read_at: string | null; created_at: string };
type NotificationPage = { results: Notification[]; unread_count: number; next_cursor: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function when(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }

export function NotificationsScreen(props: Props) {
  const { scopeKey } = useSession();
  return <NotificationList key={scopeKey} {...props} />;
}
function NotificationList({ onNavigate }: Props) {
  const { scopeKey, status, environment } = useSession();
  const client = useQueryClient();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['campus', scopeKey, 'notifications'], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => apiFetch<NotificationPage>(`/api/v1/notifications/?${new URLSearchParams({ limit: '50', ...(pageParam ? { cursor: pageParam } : {}) })}`, { signal }),
    getNextPageParam: page => page.next_cursor ?? undefined,
    enabled: status === 'authenticated' && !environment.unavailable, retry: false, staleTime: 15_000,
  });
  async function open(item: Notification) {
    if (busy || !isInternalHref(item.link)) return;
    setBusy(item.id); setError('');
    const destination = new URL(item.link, 'https://thatcampus.invalid');
    const studentId = item.metadata?.student_id;
    if (typeof studentId === 'string' && uuid.test(studentId) && !destination.searchParams.has('student_id')) destination.searchParams.set('student_id', studentId);
    try {
      if (item.attention_eligible) {
        // The owning screen must verify and open the exact source before
        // acknowledging typed attention. Starting navigation cannot clear it.
        destination.searchParams.set('attention_notification_id', item.id);
      } else if (!item.read_at) {
        await apiFetch(`/api/v1/notifications/${encodeURIComponent(item.id)}/read/`, { method: 'POST', body: '{}' });
        await client.invalidateQueries({ queryKey: ['campus', scopeKey, 'notifications'] });
      }
      onNavigate(`${destination.pathname}${destination.search}${destination.hash}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The update could not be opened. Try again.'); }
    finally { setBusy(''); }
  }
  const items = query.data?.pages.flatMap(page => page.results) ?? [];
  const unread = query.data?.pages[0]?.unread_count;
  return <Page title="Notifications" subtitle={unread === undefined ? 'Updates from your campus' : unread ? `${unread} unread` : 'You’re all caught up'} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    {error ? <Notice tone="danger" message={error} /> : null}
    {environment.unavailable ? <Empty title="Simulation is unavailable" message="Recover the selected world or return to Live before opening notifications." />
      : query.isPending ? <Loading /> : query.isError ? <Empty title="Notifications could not load" message={query.error.message} onRetry={() => void query.refetch()} />
        : !items.length ? <Empty title="No campus updates yet" message="New information and work alerts will appear here." />
          : <Section title="Campus updates">{items.map(item => <Row key={item.id} title={item.title} detail={[item.body, when(item.created_at)].filter(Boolean).join('\n')}
            status={busy === item.id ? 'Opening…' : item.read_at ? undefined : 'Unread'} icon={item.kind === 'attendance' ? 'attendance' : item.kind === 'leave' ? 'calendar' : 'notifications'}
            onPress={isInternalHref(item.link) ? () => void open(item) : undefined} />)}</Section>}
    {query.hasNextPage ? <Button title={query.isFetchNextPageError ? 'Retry earlier updates' : 'Earlier updates'} kind="secondary" busy={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /> : null}
    {query.isFetchNextPageError ? <Notice tone="danger" message="Earlier updates could not load. Your current list is still available." /> : null}
  </Page>;
}
