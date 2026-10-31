import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { Button, Empty, Field, ListGroup, Notice, Row, Section } from '../ui/components';
import { ChoiceMenu, Disclosure } from '../ui/DomainControls';
import { EventToggle, eventMoney } from './EventFields';
import { DomainPages } from './ResourcesScreen';
import { feesUuid } from './FeesCommandPolicy';
import type { FeesWriter } from './FeesCommand';
export interface FeesGuardianReview { id: string; invoice_id: string; kind: 'payment' | 'charge'; amount_paise: number | null; method: string | null; reference: string | null; note: string; created_at: string; status: 'pending' | 'verified' | 'rejected' | 'answered'; decision_id?: string | null; response: string | null; payment_id: string | null; reviewed_at: string | null }
export function FeesLegacyReviews({ schoolId, reviews, writer, href, manager }: { schoolId: string; reviews: FeesGuardianReview[]; writer: FeesWriter; href: string; manager: boolean }) {
  const query = new URLSearchParams(href.split('?')[1] ?? ''), [page, setPage] = useState(1), focused = reviews.find(item => item.id === query.get('review')), rows = focused ? [focused] : reviews, current = Math.min(page, Math.max(1, Math.ceil(rows.length / 10))), exact = query.get('scope') === 'dependent' && !!focused && focused.status !== 'pending' && !!query.get('decision') && focused.decision_id === query.get('decision');
  useFeesReviewAttention(href, exact);
  if (!reviews.length && !query.get('review')) return null;
  return <Disclosure title="Guardian payment reports and review history" defaultOpen={!!focused || manager && reviews.some(item => item.status === 'pending')}>
    {query.get('attention_notification_id') && query.get('review') && query.get('decision') && !exact ? <Notice tone="warning" message="This fee-review attention target no longer matches the current decision. It was not marked as opened." /> : null}
    {query.get('review') && !focused ? <Empty title="This retained review is unavailable in the current fee account" /> : null}
    <ListGroup>{rows.slice((current - 1) * 10, current * 10).map(item => <Section key={item.id} title={item.kind === 'payment' ? `Payment report${item.amount_paise ? ` · ${eventMoney(item.amount_paise)}` : ''}` : 'Fee question'}><Row title={item.reference || item.kind === 'payment' ? item.reference || 'Payment reference not recorded' : 'Charge review'} detail={[item.method?.replaceAll('_', ' '), item.note, item.response ? `Campus response: ${item.response}` : '', new Date(item.created_at).toLocaleString()].filter(Boolean).join('\n')} status={item.status} />{manager && item.status === 'pending' ? <LegacyDecision source={item} writer={writer} /> : null}</Section>)}</ListGroup>{rows.length > 10 ? <DomainPages page={current} hasMore={current * 10 < rows.length} onChange={setPage} /> : null}
  </Disclosure>;
}
function LegacyDecision({ source, writer }: { source: FeesGuardianReview; writer: FeesWriter }) {
  const [basis] = useState(source), [outcome, setOutcome] = useState(source.kind === 'charge' ? 'answered' : 'rejected'), [response, setResponse] = useState(''), [verified, setVerified] = useState(false), stale = basis.status !== source.status || basis.decision_id !== source.decision_id;
  useScreenExitGuard({ dirty: !writer.pending && (!!response || verified), blocked: writer.busy, title: 'Leave fee review?', message: 'Your unsent response will be lost.' });
  return <Disclosure title="Review this report"><ChoiceMenu label="Review outcome" value={outcome} options={source.kind === 'charge' ? [{ value: 'answered', label: 'Answer charge question' }] : [{ value: 'rejected', label: 'Cannot verify or duplicate' }, { value: 'verified', label: 'Verify and issue receipt' }]} disabled={writer.locked || stale} onChange={value => { setOutcome(value); setVerified(false); }} /><Field label="Response after checking the ledger" value={response} multiline maxLength={1000} editable={!writer.locked && !stale} onChangeText={setResponse} />{outcome === 'verified' ? <EventToggle label="I independently verified these funds were received; any cheque has cleared" value={verified} disabled={writer.locked || stale} onChange={setVerified} /> : <Notice message={outcome === 'answered' ? 'The response does not change the charge, dates or balance. Event credits and refunds use event reconciliation.' : 'This decision records no payment.'} />}<Button title="Review fee response" disabled={writer.locked || stale || response.trim().length < 5 || outcome === 'verified' && !verified} onPress={() => Alert.alert(outcome === 'verified' ? 'Verify this payment and issue a receipt?' : 'Record this fee-review response?', `${basis.reference ?? 'Fee question'}\n${response.trim()}${outcome === 'verified' ? '\nOnly independently verified received funds will be recorded.' : '\nNo payment is recorded.'}`, [{ text: 'Keep reviewing', style: 'cancel' }, { text: 'Record response', onPress: () => { void writer.run({ kind: 'guardianDecision', sourceId: basis.id, invoiceId: basis.invoice_id, body: { outcome, response: response.trim(), verified_funds: outcome === 'verified' && verified } }).then(saved => { if (saved) { setResponse(''); setVerified(false); } }); } }])} /></Disclosure>;
}
function useFeesReviewAttention(href: string, exact: boolean) {
  const { scopeKey } = useSession(), client = useQueryClient(), attempted = useRef(''), [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const id = new URLSearchParams(href.split('?')[1] ?? '').get('attention_notification_id'); if (!focused || !exact || !feesUuid(id) || attempted.current === href) return; let active = true; const context = captureApiContext(); attempted.current = href; void apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${encodeURIComponent(id)}/read/`, { method: 'POST', body: JSON.stringify({ opened_target: href }) }).then(async receipt => { context.assertCurrent(); if (receipt.id !== id || !Number.isFinite(Date.parse(receipt.read_at))) throw new Error('Exact opened receipt unavailable'); if (active) await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); }).catch(() => { attempted.current = ''; }); return () => { active = false; }; }, [href, exact, focused, scopeKey, client]);
}
