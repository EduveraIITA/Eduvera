import { useEventAdminCommand, EventAdminStatus } from './EventAdminCommand';
import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { captureApiContext } from '../lib/api';
import { assertEventFinance, eventFinanceFingerprint, eventFinanceRead, eventRefundInput, eventWithdrawalInput, type EventFinance, type EventFinanceItem, type NativeEvent } from '../lib/event-policy';
import { useApi } from '../lib/query';
import { useEventWriter } from '../lib/use-event-command';
import { Button, Empty, Field, Loading, Notice, Row, Section } from '../ui/components';
import { EventPending, EventSelect, EventToggle, eventLabel, eventMoney } from './EventFields';

export function EventFinancePanel({ event, schoolId, studentId, href, onNavigate }: { event: NativeEvent; schoolId: string; studentId: string | null; href: string; onNavigate(href: string): void }) {
  const query = useApi<EventFinance>(eventFinanceRead(schoolId, event.id, studentId)), [editing, setEditing] = useState<{ studentId: string; action: 'withdraw' | 'refunds' } | null>(null), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  let finance: EventFinance | null = null, proofError = '';
  if (query.data) try { assertEventFinance(query.data, event.id, studentId); finance = query.data; } catch (cause) { proofError = cause instanceof Error ? cause.message : 'The finance record could not be confirmed.'; }
  const items = finance?.items.filter(item => item.student_name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const selected = editing ? finance?.items.find(item => item.student_id === editing.studentId) : null;
  return <Section title={studentId ? 'Event fee and withdrawal' : 'Event finance'}>{query.isPending ? <Loading /> : query.isError || !finance ? <Empty title="Event finance unavailable" message={query.error?.message ?? proofError} onRetry={() => void query.refetch()} /> : <>
    <Notice message="Credits, money already received and manual refunds are separate ledger records. This app does not initiate an online refund." />
    {editing ? selected ? <EventFinanceAction key={`${selected.student_id}:${editing.action}`} event={event} current={selected} permission={editing.action === 'withdraw' ? !!studentId && selected.can_withdraw : !studentId && finance.permissions.can_record_refund} action={editing.action} schoolId={schoolId} href={href} onNavigate={onNavigate} onClose={() => setEditing(null)} /> : <Notice message="The selected participant is no longer available. Return to the current saved finance record." /> : <>
      {!studentId ? <Field label="Find event finance participant" value={search} onChangeText={value => { setSearch(value); setPage(1); }} /> : null}
      {items.slice((page - 1) * 10, page * 10).map(item => <Section key={item.student_id} title={item.student_name}>
        <Row title="Participation and fee" detail={`${eventLabel(item.participation_state)} · ${eventLabel(item.finance_state)}\nInvoice ${eventMoney(item.invoice_amount_paise)} · Credit ${eventMoney(item.credited_paise)}\nReceived ${eventMoney(item.paid_paise)} · Refunded ${eventMoney(item.refunded_paise)}\nCollectible ${eventMoney(item.collectible_balance_paise)} · Manual refund due ${eventMoney(item.refund_due_paise)}`} />
        {item.withdrawn_at ? <Row title="Place withdrawn" detail={new Date(item.withdrawn_at).toLocaleString()} /> : null}
        {item.refunds.map(refund => <Row key={refund.id} title={`Recorded manual refund ${eventMoney(refund.amount_paise)}`} detail={`${eventLabel(refund.method)} · ${refund.reference}\n${refund.reason}\n${new Date(refund.recorded_at).toLocaleString()}`} />)}
        {studentId && item.can_withdraw ? <Button title="Review paid-place withdrawal" kind="secondary" onPress={() => setEditing({ studentId: item.student_id, action: 'withdraw' })} /> : null}
        {!studentId && finance!.permissions.can_record_refund && item.refund_due_paise > 0 ? <Button title="Record a refund already issued" kind="secondary" onPress={() => setEditing({ studentId: item.student_id, action: 'refunds' })} /> : null}
      </Section>)}
      {!items.length ? <Empty title="No event finance records in this view" /> : null}{items.length > 10 || page > 1 ? <><Button title="Previous finance participants" kind="secondary" disabled={page <= 1} onPress={() => setPage(page - 1)} /><Button title="Next finance participants" kind="secondary" disabled={page * 10 >= items.length} onPress={() => setPage(page + 1)} /></> : null}
    </>}
  </>}</Section>;
}
function EventFinanceAction({ event, current, permission, action, schoolId, href, onNavigate, onClose }: { event: NativeEvent; current: EventFinanceItem; permission: boolean; action: 'withdraw' | 'refunds'; schoolId: string; href: string; onNavigate(href: string): void; onClose(): void }) {
  const originalWriter = useEventWriter(schoolId, href, eventFinanceRead(schoolId, event.id, current.student_id)), admin = useEventAdminCommand(schoolId, href), writer = { ...originalWriter, locked: originalWriter.locked || admin.locked, busy: originalWriter.busy || admin.busy }, [basis] = useState(() => eventFinanceFingerprint(event, current));
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('cash'), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [issued, setIssued] = useState(false), [review, setReview] = useState<Record<string, unknown> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const stale = basis !== eventFinanceFingerprint(event, current), blocked = writer.locked || busy || stale || !permission;
  function prepare() { setError(''); try { if (blocked) return; setReview(action === 'withdraw' ? eventWithdrawalInput(current, reason) : eventRefundInput(current, { amount, method, reference, reason, issued }, permission)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the current fee record.'); } }
  async function save() {
    if (!review || blocked) return; setBusy(true); setError('');
    try { const context = captureApiContext(); const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, basis); context.assertCurrent(); const success = await writer.run({ endpoint: `/api/v1/campus-events/${encodeURIComponent(event.id)}/participants/${encodeURIComponent(current.student_id)}/${action}`, body: review, serverKey: 'idempotency_key', source: { kind: 'event_finance_participant', sourceId: current.student_id, revision: event.revision, fingerprint } }); context.assertCurrent(); if (success) onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'This financial record could not be confirmed.'); } finally { setBusy(false); }
  }
  return <Section title={action === 'withdraw' ? `Withdraw ${current.student_name}’s paid place` : `Record ${current.student_name}’s manual refund`}>
    <EventPending writer={writer} onNavigate={onNavigate} afterRecovery={onClose} /><EventAdminStatus writer={admin} />{error ? <Notice tone="danger" message={error} /> : null}{stale || !permission ? <Notice tone="warning" message="The saved finance record or current permission changed. Cancel and review the current ledger before a new decision." /> : null}
    {review ? <><Row title="Review this decision" detail={action === 'withdraw' ? `Withdraw this exact learner’s optional paid place.\n${String(review.reason)}` : `${eventMoney(Number(review.amount_paise))} already issued by ${eventLabel(String(review.method))}\nReference ${String(review.reference)}\n${String(review.reason)}`} /><Notice tone="warning" message={action === 'withdraw' ? 'Withdrawal removes this learner’s optional place and credits its event invoice. Any money already paid still requires separate manual refund reconciliation.' : 'Confirm only money already returned outside this app. Saving records a manual refund against the event ledger; it does not transfer money.'} /><Button title={action === 'withdraw' ? 'Confirm paid-place withdrawal' : 'Confirm refund already issued'} disabled={blocked} busy={busy} onPress={() => { void save(); }} /><Button title="Edit this decision" kind="secondary" disabled={blocked} onPress={() => setReview(null)} /></> : <>
      <Row title="Current saved balance" detail={`Manual refund due ${eventMoney(current.refund_due_paise)} · Collectible ${eventMoney(current.collectible_balance_paise)}`} />
      {action === 'refunds' ? <><Field label="Refund amount (INR)" value={amount} keyboardType="decimal-pad" maxLength={12} editable={!blocked} onChangeText={setAmount} /><EventSelect label="Method already used" value={method} options={['cash', 'bank_transfer', 'cheque'].map(id => ({ id, label: eventLabel(id) }))} disabled={blocked} onChange={setMethod} /><Field label="Refund reference" value={reference} maxLength={120} editable={!blocked} onChangeText={setReference} /><EventToggle label="I verified that this refund was already issued outside the app" value={issued} disabled={blocked} onChange={setIssued} /></> : null}
      <Field label={action === 'withdraw' ? 'Withdrawal reason' : 'Refund reason'} value={reason} multiline maxLength={500} editable={!blocked} onChangeText={setReason} /><Button title="Review this decision" disabled={blocked || reason.trim().length < 3 || action === 'refunds' && !issued} onPress={prepare} />
    </>}
    <Button title="Cancel decision" kind="secondary" disabled={busy || writer.busy} onPress={onClose} />
  </Section>;
}
