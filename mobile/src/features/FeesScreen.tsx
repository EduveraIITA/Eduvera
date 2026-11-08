import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack, useCampusNavigation } from '../ui/BackNavigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { matchesNativeFeeConfirmation, nativeFeeFailureDisposition, validateNativeFeeAction, type NativeFeeAction, type NativeFeeConfirmation } from '../lib/fee-action-policy';
export { matchesNativeFeeConfirmation } from '../lib/fee-action-policy';
import { useApi } from '../lib/query';
import { Button, Empty, Field, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { useTheme } from '../ui/theme';
import { ControlButton, Disclosure, Facts } from '../ui/DomainControls';
import { Icon } from '../ui/Icon';
import { feesReviewJournal, hydrateFeesReviewJournal, updateFeesReviewJournal } from './FeesReviewJournal';
import { FeesCommandStatus, useFeesCommands } from './FeesCommand';
import { FeesChargeForm, FeesChargeCorrection, FeesPaymentCorrection, FeesPaymentSettings } from './FeesAuthoring';
import { FeesLegacyReviews, type FeesGuardianReview } from './FeesLegacyReviews';
import { FeesStudentInvoice, FeesManualReceipt, FeesReconciliation, type FeesGatewayReview } from './FeesLegacy';
import { FeeOnlineCheckout } from './FeeOnlineCheckout';
import { feeCheckoutEligible } from '../lib/fee-checkout-policy';
import { FeesArrangements } from './FeesArrangements';
import { feesDay } from './FeesCommandPolicy';
import { FeesElectiveReview } from './FeesElectiveReview';
import type { FeeBatchResult } from '../../../packages/contracts/src/wire/features/office/feeBatchApi';

type Props = { href: string; onNavigate: (href: string) => void };
export type Invoice = { id: string; reference: string; description: string; effective_description?: string; due_on: string; effective_due_on?: string; collection_due_on?: string | null; amount_paise: number; effective_amount_paise?: number; adjusted_amount_paise: number; paid_paise: number; balance_paise: number; refund_due_paise: number; charge_state?: string; can_correct?: boolean; correction_revision?: number; charge_batch?: { id: string; reference: string; description: string; person_count: number; summary?: { complete: boolean; outstanding: number; cancelled: number } }; first_name?: string; last_name?: string; person_id?: string | null; student_id?: string | null; beneficiary?: { name: string; person_id: string | null }; corrections?: Array<{ id: string; revision: number; reason: string; created_at: string; amount_paise: number; charge_state: string }> };
export type Payment = { id: string; invoice_id: string; amount_paise: number; method: string; reference: string; created_at: string; status?: string; can_reverse?: boolean; can_replace?: boolean; correction_reason?: string | null };
export type Ledger = { online_payments_enabled?:boolean;payment_mode?:string|null;currency: 'INR'; invoices: Invoice[]; payments: Payment[]; can_issue?: boolean; can_submit?: boolean; gateway_payments?: FeesGatewayReview[]; reviews?: FeesGuardianReview[]; today?: string; timezone?: string; payment_settings?: { payee_name: string; upi_id: string; instructions: string; revision: number }; totals?: { billed: number; received: number; outstanding: number; refunds: number }; pagination?: { next_cursor: string | null; next_payment_cursor: string | null } };
type Reviewer = { user_id: string; person_id: string; label: string; eligibility_hash: string };
type Review = { id: string; invoice_id: string; kind: 'payment' | 'charge'; amount_paise: number | null; method: string | null; reference: string | null; note: string; status: string; revision: number; can_decide: boolean; can_verify: boolean; can_withdraw: boolean; basis_changed: boolean; reviewer: { label: string }; response: string | null; payment_id: string | null; route_state: string; submitted_at: string };
type ReviewInvoice = { id: string; reference: string; description: string; label: string; person_id: string | null; student_id: string | null; context_kind: 'person' | 'student'; balance_paise: number; stream_revision: number; basis_hash: string; basis_revision: number; can_report: boolean; can_question: boolean; reviewers: Reviewer[]; reviews: Review[] };
type FeeAction = NativeFeeAction;
type Confirmation = NativeFeeConfirmation;
type FeeContext = ReturnType<typeof captureApiContext>;
const queryOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
function hrefWith(href: string, values: Record<string, string>) { const q = queryOf(href); for (const [key, value] of Object.entries(values)) { if (value) q.set(key, value); else q.delete(key); } return `${href.split('?')[0]}${q.size ? `?${q}` : ''}`; }
const money = (paise: number) => Number.isSafeInteger(paise) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100) : 'Amount unavailable';
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The action was not confirmed.';
export function nativeFeeAmount(value: string) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole, decimal = ''] = value.trim().split('.');
  const paise = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error('Enter a valid positive amount.');
  return paise;
}

export function FeesScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => { try { if (!manifest.data || !schoolId || !user) return null; const value = normalizeWorkspaceManifest(manifest.data); assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment }); return value; } catch { return null; } }, [manifest.data, schoolId, user?.id, environment]);
  if (!schoolId) return <Page title="Fees & receipts"><Empty title="Choose a campus" /></Page>;
  if (manifest.isPending) return <Page title="Fees & receipts"><Loading /></Page>;
  if (manifest.isError || !resolved) return <Page title="Fees & receipts"><Empty title="Fee access could not be confirmed" message={manifest.error?.message} onRetry={() => void manifest.refetch()} /></Page>;
  const surfaces = resolved.areas.find(area => area.key === 'fees')?.surfaces ?? [];
  const q = queryOf(props.href), path = props.href.split('?')[0];
  const recovery = path.match(/^\/work\/fee-reviews\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i);
  if (recovery) return <FeeReviewRecovery key={`${scopeKey}:${recovery[1]}`} {...props} schoolId={schoolId} reviewId={recovery[1]!} />;
  const scope = q.get('scope'), personId = q.get('person_id'), studentId = q.get('student_id');
  const selectedKey = path.endsWith('/ledger') ? 'ledger' : scope === 'person' && personId ? `account:person:${personId}` : (scope === 'self' || scope === 'dependent') && studentId ? `account:${scope}:${studentId}` : null;
  if (!selectedKey && path === '/areas/fees') return <Page title="Fees & receipts" subtitle="Choose the account or responsibility"><Section title="Available to you">{surfaces.length ? surfaces.map(surface => <Row key={surface.key} title={surface.label} detail={surface.description} icon="fees" onPress={() => props.onNavigate(surface.href)} />) : <Empty title="No fee accounts are currently available" />}</Section></Page>;
  if (!selectedKey || !surfaces.some(surface => surface.key === selectedKey)) return <Page title="Fees & receipts"><Empty title="This fee account is unavailable" message="The exact selected account is no longer in your current campus access." /><ScreenBack title="Back to fees" fallbackHref={'/areas/fees'} /></Page>;
  if (q.has('elective_review')) {
    const id = q.get('elective_review');
    if (selectedKey !== 'ledger' || q.getAll('elective_review').length !== 1 || !id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return <Page title="Elective Finance review"><Empty title="Open one assigned Finance review" /><ScreenBack fallbackHref="/areas/fees/ledger" /></Page>;
    return <FeesElectiveReview key={`${scopeKey}:elective:${id}`} {...props} schoolId={schoolId} id={id} />;
  }
  return <FeeAccount key={`${scopeKey}:${selectedKey}`} {...props} schoolId={schoolId} personId={personId} studentId={studentId} manager={selectedKey === 'ledger'} />;
}

function FeeAccount({ href, onNavigate, schoolId, personId, studentId, manager }: Props & { schoolId: string; personId: string | null; studentId: string | null; manager: boolean }) {
  const q = queryOf(href), invoiceId = q.get('invoice_id') ?? q.get('invoice'), receiptId = q.get('receipt');
  const [search, setSearch] = useState(q.get('ledger_search') ?? ''), financial = useFeesCommands(schoolId, href), { complete } = useCampusNavigation(href);
  const view = q.get('view') ?? 'charges', batchId = q.get('batch_id');
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
  const params = new URLSearchParams({ ...(personId ? { person_id: personId } : {}), ...(studentId ? { student_id: studentId } : {}), ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(receiptId ? { receipt_id: receiptId } : {}), ...(!invoiceId && !receiptId && q.get('ledger_cursor') ? { cursor: q.get('ledger_cursor')! } : {}), ...(!invoiceId && !receiptId && q.get('ledger_search') ? { search: q.get('ledger_search')! } : {}), ...(q.get('ledger_payment_cursor') ? { payment_cursor: q.get('ledger_payment_cursor')! } : {}) });
  if (batchId) params.set('batch_id', batchId);
  if (q.get('review')) params.set('review_id', q.get('review')!);
  if (q.get('ledger_review_cursor')) params.set('review_cursor', q.get('ledger_review_cursor')!);
  const ledger = useApi<Ledger>(`${root}/workspace/?${params}`), batch = useApi<FeeBatchResult>(batchId ? `${root}/charge-batches/${encodeURIComponent(batchId)}/` : null);
  const invoice = !ledger.isError ? ledger.data?.invoices.find(item => item.id === invoiceId) : undefined;
  const receipt = !ledger.isError ? ledger.data?.payments.find(item => item.id === receiptId) : undefined;
  const description = (item: Invoice) => item.effective_description ?? item.description;
  const target = (values: Record<string, string>) => onNavigate(hrefWith(href, values));
  const batchComplete = !!batchId && batch.data?.id === batchId && batch.data.batch_id === batchId && batch.data.person_count === ledger.data?.invoices.length && batch.data.invoices.length === batch.data.person_count && batch.data.invoices.every(item => ledger.data?.invoices.some(invoice => invoice.id === item.invoice_id && invoice.beneficiary?.person_id === item.person_id));
  return <Page title={receiptId ? 'Payment receipt' : invoiceId ? 'Invoice' : view === 'settings' ? 'Payment settings' : view === 'arrangements' ? 'Payment plans' : view === 'charge' ? 'Record charge' : manager ? 'Fee ledger' : 'Fees & receipts'} subtitle={invoice ? `${invoice.beneficiary?.name ?? `${invoice.first_name ?? ''} ${invoice.last_name ?? ''}`.trim()} · ${invoice.reference}` : undefined} refreshing={ledger.isRefetching} onRefresh={() => void ledger.refetch()}>
    <ScreenBack title={invoiceId || receiptId ? 'Back to account' : 'Back to fees'} disabled={financial.busy} fallbackHref={invoiceId || receiptId ? hrefWith(href, { invoice_id: '', invoice: '', receipt: '', ledger_payment_cursor: '' }) : '/areas/fees'} />
    <FeesCommandStatus writer={financial} /><FeeOnlineCheckout key={invoiceId??'recovery'} href={href} schoolId={schoolId} studentId={studentId} invoice={invoice} eligible={!!ledger.data&&!!invoice&&!manager&&feeCheckoutEligible({scope:q.get('scope'),studentId,invoiceStudentId:invoice.student_id,canSubmit:ledger.data.can_submit,enabled:ledger.data.online_payments_enabled,paymentMode:ledger.data.payment_mode,chargeState:invoice.charge_state,balance:invoice.balance_paise,pendingPayment:(ledger.data.reviews??[]).some(r=>r.invoice_id===invoice.id&&r.kind==='payment'&&r.status==='pending')})} canInspect={!!invoice&&q.get('scope')==='dependent'&&ledger.data?.can_submit===true&&studentId===invoice.student_id} externallyBlocked={financial.financialLocked} isExternallyBlocked={financial.financialBlocked} onNavigate={onNavigate} onSaved={()=>ledger.refetch({throwOnError:true})}/>
    {manager && !invoiceId && !receiptId ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[['charges', 'Charges'], ['arrangements', 'Payment plans'], ['reviews', 'Reports & questions'], ['review', 'Provider reconciliation'], ['settings', 'Payment settings']].map(([value, title]) => <ControlButton key={value} title={title!} disabled={financial.busy} onPress={() => target({ view: value!, batch_id: '', ledger_cursor: '', ledger_payment_cursor: '' })} />)}</View> : null}
    {ledger.isPending ? <Loading /> : ledger.isError || !ledger.data ? <Empty title="Fee account could not load" message={ledger.error?.message} onRetry={() => void ledger.refetch()} /> : manager && q.get('mode') === 'invoice' && feesDay(ledger.data.today) ? <FeesStudentInvoice schoolId={schoolId} today={ledger.data.today} writer={financial} onIssued={id => complete(hrefWith(href, { mode: '', invoice_id: id, invoice: '', receipt: '' }))} /> : manager && view === 'review' ? <><FeesReconciliation schoolId={schoolId} items={ledger.data.gateway_payments ?? []} orderId={q.get('order')} invoiceId={invoiceId} /><FeesLegacyReviews schoolId={schoolId} reviews={ledger.data.reviews ?? []} writer={financial} href={href} manager={manager} /><NativeReviews schoolId={schoolId} invoiceId={invoiceId} personId={personId} studentId={studentId} onLedgerReload={() => ledger.refetch({ throwOnError: true })} externallyBlocked={financial.locked} /></> : manager && view === 'charge' && ledger.data.can_issue && feesDay(ledger.data.today) ? <FeesChargeForm schoolId={schoolId} today={ledger.data.today} writer={financial} onIssued={saved => complete(hrefWith(href, { view: '', batch_id: saved.batch_id, invoice_id: '', invoice: '', receipt: '' }))} /> : manager && view === 'settings' ? ledger.data.can_issue && ledger.data.payment_settings ? <FeesPaymentSettings schoolId={schoolId} source={ledger.data.payment_settings} writer={financial} onSaved={() => complete(hrefWith(href, { view: '' }))} /> : <Empty title="Payment settings are unavailable to this responsibility" /> : view === 'arrangements' ? <FeesArrangements schoolId={schoolId} invoiceId={invoiceId} personId={personId} studentId={studentId} writer={financial} focusRequestId={q.get('request_id') ?? q.get('arrangement')} /> : view === 'reviews' ? <><FeesLegacyReviews schoolId={schoolId} reviews={ledger.data.reviews ?? []} writer={financial} href={href} manager={manager} /><NativeReviews schoolId={schoolId} invoiceId={invoiceId} personId={personId} studentId={studentId} onLedgerReload={() => ledger.refetch({ throwOnError: true })} externallyBlocked={financial.locked} /></> : receiptId ? receipt ? <><Notice message={receipt.status === 'reversed' ? 'This receipt was reversed.' : receipt.status === 'replaced' ? 'This receipt was replaced by a corrected record.' : 'Verified receipt'} tone={receipt.status && receipt.status !== 'active' ? 'warning' : 'success'} /><Row title={receipt.reference} detail={`${money(receipt.amount_paise)}\n${receipt.method.replaceAll('_', ' ')} · ${new Date(receipt.created_at).toLocaleString()}`} />{receipt.correction_reason ? <Row title="Correction reason" detail={receipt.correction_reason} /> : null}{manager ? <FeesPaymentCorrection key={receipt.id} schoolId={schoolId} payment={receipt} writer={financial} /> : null}</> : <Empty title="This receipt is unavailable" message="The exact receipt was not returned for this account." /> : invoiceId ? invoice ? <>
      <Section title={description(invoice)}><Row title="Outstanding" detail={money(invoice.balance_paise)} status={invoice.charge_state === 'cancelled' ? 'Charge cancelled' : invoice.balance_paise === 0 ? 'No balance' : `Due ${invoice.collection_due_on ?? invoice.effective_due_on ?? invoice.due_on}`} /><Facts items={[{ label: 'Original charge', value: money(invoice.amount_paise) }, ...(invoice.effective_amount_paise !== undefined && invoice.effective_amount_paise !== invoice.amount_paise ? [{ label: 'Current recorded charge', value: money(invoice.effective_amount_paise) }] : []), { label: 'After credits', value: money(invoice.adjusted_amount_paise) }, { label: 'Verified payments', value: money(invoice.paid_paise) }, { label: 'Refund due', value: money(invoice.refund_due_paise) }]} /></Section>
      {ledger.data.payment_settings?.instructions || ledger.data.payment_settings?.upi_id ? <Section title="Campus payment instructions">{ledger.data.payment_settings.payee_name ? <Row title="Payee" detail={ledger.data.payment_settings.payee_name} /> : null}{ledger.data.payment_settings.upi_id ? <Row title="Published UPI ID" detail={ledger.data.payment_settings.upi_id} /> : null}{ledger.data.payment_settings.instructions ? <Notice message={ledger.data.payment_settings.instructions} /> : null}<Notice message="A payment report is not a receipt. Your balance changes only when Finance verifies received funds." /></Section> : null}
      {manager ? <FeesManualReceipt schoolId={schoolId} invoice={invoice} writer={financial} /> : null}
      {manager ? <FeesChargeCorrection key={invoice.id} schoolId={schoolId} invoices={[invoice]} {...(batchId ? { batchId } : {})} writer={financial} /> : null}
      <Disclosure title="Payment plans and account access"><FeesArrangements schoolId={schoolId} invoiceId={invoice.id} personId={personId ?? invoice.beneficiary?.person_id ?? invoice.person_id} studentId={studentId ?? invoice.student_id} writer={financial} /></Disclosure>
      <FeesLegacyReviews schoolId={schoolId} reviews={(ledger.data.reviews ?? []).filter(item => item.invoice_id === invoice.id)} writer={financial} href={href} manager={manager} />
      <NativeReviews externallyBlocked={financial.locked} schoolId={schoolId} invoiceId={invoice.id} personId={personId ?? invoice.beneficiary?.person_id ?? invoice.person_id ?? null} studentId={studentId ?? invoice.student_id ?? null} onLedgerReload={() => ledger.refetch({ throwOnError: true })} />
      <Section title="Verified receipts">{ledger.data.payments.filter(payment => payment.invoice_id === invoice.id).length ? ledger.data.payments.filter(payment => payment.invoice_id === invoice.id).map(payment => <Row key={payment.id} title={`${payment.reference} · ${money(payment.amount_paise)}`} detail={`${payment.method.replaceAll('_', ' ')} · ${new Date(payment.created_at).toLocaleDateString()}`} status={payment.status && payment.status !== 'active' ? payment.status : 'Verified'} onPress={() => target({ receipt: payment.id })} />) : <Empty title="No verified receipts on this page" />}{ledger.data.pagination?.next_payment_cursor ? <Button title="Older receipts" kind="secondary" onPress={() => target({ ledger_payment_cursor: ledger.data!.pagination!.next_payment_cursor! })} /> : null}{q.has('ledger_payment_cursor') ? <Button title="Latest receipts" kind="secondary" onPress={() => target({ ledger_payment_cursor: '' })} /> : null}</Section>
      {invoice.corrections?.length ? <Disclosure title="Charge corrections">{invoice.corrections.map(correction => <Row key={correction.id} title={`Revision ${correction.revision} · ${money(correction.amount_paise)}`} detail={`${correction.reason}\n${new Date(correction.created_at).toLocaleString()}`} status={correction.charge_state} />)}</Disclosure> : null}
    </> : <Empty title="This invoice is unavailable" message="The exact invoice was not returned for this account." /> : <>
      {manager && ledger.data.can_issue && feesDay(ledger.data.today) && !batchId ? <ControlButton title="Record charge for people or groups" kind="primary" disabled={financial.locked} onPress={() => target({ view: 'charge' })} /> : null}
      {batchId ? batch.isPending ? <Loading /> : batch.isError || !batchComplete ? <Empty title="This charge collection is incomplete" message={batch.error?.message ?? 'Refresh the exact collection and its recorded charge manifest before relying on totals or correcting charges.'} onRetry={() => { void batch.refetch(); void ledger.refetch(); }} /> : <><Row title={batch.data!.description} detail={`${batch.data!.person_count} people · ${batch.data!.reference}\nOriginally ${money(batch.data!.amount_paise)} each`} /><FeesChargeCorrection key={batchId} schoolId={schoolId} invoices={ledger.data.invoices} batchId={batchId} writer={financial} /></> : null}
      {ledger.data.totals ? <Facts items={[{ label: "Outstanding", value: money(ledger.data.totals.outstanding) }, { label: "Verified receipts", value: money(ledger.data.totals.received) }, { label: "Refunds due", value: money(ledger.data.totals.refunds) }]} /> : null}
      <SearchField label="Find an invoice" placeholder="Find an invoice" value={search} onChangeText={value => setSearch(value.slice(0, 120))} onSubmit={() => target({ ledger_search: search.trim(), ledger_cursor: '' })} onClear={() => target({ ledger_search: '', ledger_cursor: '' })} outlined />
      <Section title="Invoices">{ledger.data.invoices.length ? ledger.data.invoices.map(item => <FeeAmountRow key={item.id} title={description(item)} detail={[item.beneficiary?.name, item.reference].filter(Boolean).join(' · ')} amount={money(item.balance_paise)} status={item.charge_state === 'cancelled' ? 'Cancelled' : item.balance_paise === 0 ? 'No balance' : `Due ${item.collection_due_on ?? item.effective_due_on ?? item.due_on}`} onPress={() => target({ invoice_id: item.id, invoice: '', ledger_payment_cursor: '' })} />) : <Empty title="No invoices in this view" />}</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{q.has('ledger_cursor') ? <Button title="Latest invoices" kind="secondary" onPress={() => target({ ledger_cursor: '' })} /> : null}{ledger.data.pagination?.next_cursor ? <Button title="More invoices" kind="secondary" onPress={() => target({ ledger_cursor: ledger.data!.pagination!.next_cursor! })} /> : null}</View>
      {manager ? <NativeReviews externallyBlocked={financial.locked} schoolId={schoolId} invoiceId={null} personId={personId} studentId={studentId} onLedgerReload={() => ledger.refetch({ throwOnError: true })} /> : null}
    </>}
  </Page>;
}

function FeeAmountRow({ title, detail, amount, status, onPress }: { title: string; detail: string; amount: string; status: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={[title, detail, amount + ' outstanding', status].join(', ')} onPress={onPress} style={({ pressed }) => ({ backgroundColor: colors.row, borderRadius: 20, padding: 16, minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? .65 : 1 })}>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '600' }}>{title}</Text><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{detail}</Text></View>
    <View style={{ maxWidth: '44%', alignItems: 'flex-end', gap: 4 }}><Text style={{ color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{amount}</Text><Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'right' }}>{status}</Text></View><Icon name="chevron" muted size={16} />
  </Pressable>;
}

function useFeeAction(schoolId: string, sourceIdentity: string, onAccepted: () => Promise<unknown>, onReview: () => Promise<unknown>) {
  const { scopeKey } = useSession(), captureOperation = useOperationContext(JSON.stringify([schoolId, sourceIdentity]));
  const operationContext = () => { const assertOperation = captureOperation(), transport = captureApiContext(); return { ...transport, assertCurrent() { assertOperation(); transport.assertCurrent(); } }; };
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
  const [ready, setReady] = useState(false), [pending, setPending] = useState<FeeAction | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [storageBlocked, setStorageBlocked] = useState(false), [retryAllowed, setRetryAllowed] = useState(false), [obsolete, setObsolete] = useState(false);
  const shared = feesReviewJournal(scopeKey), financial = useFeesCommands(schoolId, sourceIdentity), active = useRef(true);
  const retained = { get current() { return shared.pending; }, set current(value: FeeAction | null) { updateFeesReviewJournal(scopeKey, { pending: value }); } }, running = { get current() { return shared.busy; }, set current(value: boolean) { updateFeesReviewJournal(scopeKey, { busy: value }); } };
  const reload = useRef(onAccepted), reviewCurrent = useRef(onReview); reload.current = onAccepted; reviewCurrent.current = onReview;
  const key = async () => `thatcampus.fee-action.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
  const persist = async (command: FeeAction, context: FeeContext) => { const storedKey = await key(); context.assertCurrent(); await SecureStore.setItemAsync(storedKey, JSON.stringify(command), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); context.assertCurrent(); };
  useEffect(() => {
    active.current = true; const sync = () => { setPending(shared.pending); setBusy(shared.busy); setReady(shared.ready); setStorageBlocked(shared.blocked); if (shared.error) setError(shared.error); }; shared.listeners.add(sync); sync(); void hydrateFeesReviewJournal(scopeKey, schoolId);
    return () => { active.current = false; shared.listeners.delete(sync); };
  }, [scopeKey, schoolId]);
  const clear = async (context: FeeContext) => {
    // Never unlock a retained financial action until its secure copy is removed.
    const storedKey = await key(); context.assertCurrent(); await SecureStore.deleteItemAsync(storedKey); retained.current = null; context.assertCurrent();
    if (active.current) { setPending(null); setRetryAllowed(false); }
  };
  const finish = async (command: FeeAction, context: FeeContext, onAccepted: () => Promise<unknown>) => {
    const accepted: FeeAction = { ...command, phase: 'accepted' };
    // Proved acceptance survives a failed persistence write or view refresh.
    retained.current = accepted; if (active.current) setPending(accepted);
    await persist(accepted, context); context.assertCurrent(); if (!active.current) return;
    await onAccepted(); context.assertCurrent(); await clear(context);
    if (active.current) { setError(''); setObsolete(false); }
  };
  const invoke = async (command: FeeAction, previouslyUncertain: boolean, context: FeeContext, onAccepted: () => Promise<unknown>) => {
    // Retain before the await so an old-context storage completion never unlocks a prior unknown action.
    retained.current = command;
    if (active.current) setPending(command);
    await persist(command, context); context.assertCurrent();
    let accepted = false;
    try {
      context.assertCurrent(); const result = await apiFetch<{ id: string; invoice_id: string; revision: number }>(command.path, { method: 'POST', body: command.body }); context.assertCurrent();
      if (!result || result.id !== command.reviewId || result.invoice_id !== command.invoiceId || !Number.isSafeInteger(result.revision) || result.revision < 1) throw new Error('The response did not confirm this exact fee request. Check its result.');
      accepted = true; await finish(command, context, onAccepted);
    } catch (cause) {
      const disposition = nativeFeeFailureDisposition(cause, command, previouslyUncertain, accepted || retained.current?.phase === 'accepted');
      if (disposition === 'obsolete' || disposition === 'refused') {
        await clear(context);
        if (active.current) setObsolete(disposition === 'obsolete');
        throw new Error(disposition === 'obsolete' ? 'This fee record changed. Your entries are kept; review the current fee record before sending again.' : errorText(cause));
      }
      if (disposition === 'accepted') {
        const saved: FeeAction = { ...command, phase: 'accepted' }; retained.current = saved;
        if (active.current) setPending(saved);
        throw new Error('Saved. The updated fee record could not be loaded. Refresh the saved result before continuing.');
      }
      throw new Error(`${errorText(cause)} Your exact action stays locked until its result is checked.`);
    }
  };
  const perform = async (operation: () => Promise<void>) => {
    if (running.current || !active.current) return;
    running.current = true; setBusy(true); setError('');
    try { await operation(); } catch (cause) { if (active.current) setError(errorText(cause)); }
    finally { running.current = false; if (active.current) setBusy(false); }
  };
  return { pending, busy, error, retryAllowed, obsolete, locked: !ready || storageBlocked || busy || !!pending || obsolete || financial.locked,
    run: async (input: { invoice: Pick<ReviewInvoice, 'id'> & Partial<Pick<ReviewInvoice, 'context_kind' | 'person_id' | 'student_id'>>; reviewId: string; action: FeeAction['action']; path: string; body: Record<string, unknown>; recovery?: boolean }) => {
      if (!ready || storageBlocked || retained.current || running.current || obsolete || financial.locked) return;
      await perform(async () => {
        const context = operationContext(), onAccepted = reload.current;
        const id = Crypto.randomUUID();
        const params = new URLSearchParams({ invoice_id: input.invoice.id, command_id: id, ...(input.invoice.context_kind === 'person' && input.invoice.person_id ? { person_id: input.invoice.person_id } : input.invoice.student_id ? { student_id: input.invoice.student_id } : {}) });
        const command: FeeAction = { version: 1, scopeKey, schoolId, key: id, invoiceId: input.invoice.id, reviewId: input.reviewId, action: input.action, path: input.path,
          confirmationPath: input.recovery ? `${root}/payment-reviews/${encodeURIComponent(input.reviewId)}/recovery/?command_id=${id}` : `${root}/payment-reviews/workspace/?${params}`, body: JSON.stringify({ ...input.body, command_id: id }), phase: 'unknown' };
        if (!validateNativeFeeAction(command, scopeKey, schoolId)) throw new Error('This fee action could not be safely retained.');
        context.assertCurrent(); await invoke(command, false, context, onAccepted);
      });
    },
    check: () => perform(async () => {
      const context = operationContext(), onAccepted = reload.current;
      const command = retained.current; if (!command) return;
      setRetryAllowed(false);
      if (command.phase === 'accepted') { await finish(command, context, onAccepted); return; }
      context.assertCurrent(); const response = await apiFetch<{ confirmation?: Confirmation }>(command.confirmationPath); context.assertCurrent();
      if (!matchesNativeFeeConfirmation(response.confirmation, command)) throw new Error('The confirmation does not match the retained fee action. Keep this action and check again.');
      const state = response.confirmation!.state;
      if (state === 'accepted') await finish(command, context, onAccepted);
      else if (state === 'not_found') { setRetryAllowed(true); setError('No result was found. You may retry this same action; its details remain locked.'); }
      else if (state === 'not_accepted') { await clear(context); setObsolete(true); setError('This action was not accepted. Your entries are kept; review the current fee record before sending again.'); }
      else setError('This action is still being checked. Check again shortly.');
    }),
    retry: () => retryAllowed ? perform(async () => { const context = operationContext(), onAccepted = reload.current, command = retained.current; if (command) { setRetryAllowed(false); await invoke(command, true, context, onAccepted); } }) : Promise.resolve(),
    review: () => !obsolete || retained.current ? Promise.resolve() : perform(async () => { const context = operationContext(), onReview = reviewCurrent.current; await onReview(); context.assertCurrent(); if (active.current) { setObsolete(false); setError(''); } }),
  };
}

/** Owning request recovery deliberately returns no old private invoice details. */
function FeeReviewRecovery({ schoolId, reviewId, href, onNavigate }: Props & { schoolId: string; reviewId: string }) {
  type Recovery = { id: string; invoice_id: string; stream_revision: number; status: string; reviewer: { user_id: string; label: string }; can_withdraw: boolean; confirmation?: Confirmation };
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
  const query = useApi<Recovery>(`${root}/payment-reviews/${encodeURIComponent(reviewId)}/recovery/`);
  const valid = (value: Recovery | undefined) => value?.id === reviewId && typeof value.invoice_id === 'string' && Number.isSafeInteger(value.stream_revision) && value.stream_revision >= 0;
  const source = !query.isError && valid(query.data) ? query.data : undefined;
  const command = useFeeAction(schoolId, href, async () => { await query.refetch({ throwOnError: true }); }, async () => {
    const refreshed = await query.refetch({ throwOnError: true });
    if (!valid(refreshed.data)) throw new Error('The response did not match this exact retained fee request.');
  });
  const withdraw = () => {
    if (!source?.can_withdraw || command.locked) return;
    Alert.alert('Withdraw this fee request?', `Close your request to ${source.reviewer.label}?\nCharges, balances, verified receipts and previous decisions stay as recorded.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Withdraw request', style: 'destructive', onPress: () => void command.run({ invoice: { id: source.invoice_id }, reviewId, action: 'withdraw', path: `${root}/payment-reviews/${encodeURIComponent(reviewId)}/withdraw/`, recovery: true, body: { expected_revision: source.stream_revision } }) }]);
  };
  return <Page title="Fee request" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack title="Back to Work" fallbackHref={'/work'} />
    <Notice message="Your fee account access changed. You can still close your own pending request here; private account details are not shown." />
    {command.error ? <Notice message={command.error} tone="warning" /> : null}
    {command.pending ? <><Notice message={command.pending.phase === 'accepted' ? 'This withdrawal was saved. Refresh its status to finish.' : 'The exact fee action is securely retained. Check its owning result before starting another action.'} tone="warning" /><Button title={command.pending.phase === 'accepted' ? 'Refresh saved result' : 'Check fee action result'} kind="secondary" busy={command.busy} onPress={() => void command.check()} />{command.retryAllowed ? <Button title="Retry same fee action" busy={command.busy} onPress={() => void command.retry()} /> : null}</> : null}
    {command.obsolete ? <Button title="Review current request status" kind="secondary" busy={command.busy} onPress={() => void command.review()} /> : null}
    {query.isPending ? <Loading /> : query.isError || !source ? <Empty title="This retained request could not load" message={query.error?.message ?? 'The response did not identify this exact request.'} onRetry={() => void query.refetch()} /> : <Section title={source.status === 'pending' ? 'Pending review' : source.status === 'withdrawn' ? 'Request withdrawn' : 'Review completed'}>
      <Row title={source.status === 'pending' ? `Waiting for ${source.reviewer.label}` : 'This request is no longer pending.'} status={source.status} />
      {source.can_withdraw ? <Button title="Withdraw request" kind="danger" disabled={command.locked} busy={command.busy} onPress={withdraw} /> : null}
    </Section>}
  </Page>;
}

function NativeReviews({ schoolId, invoiceId, personId, studentId, onLedgerReload, externallyBlocked = false }: { externallyBlocked?: boolean; schoolId: string; invoiceId: string | null; personId: string | null; studentId: string | null; onLedgerReload: () => Promise<unknown> }) {
  const { colors } = useTheme(), root = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
  const q = new URLSearchParams({ ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(personId ? { person_id: personId } : {}), ...(studentId && !personId ? { student_id: studentId } : {}) });
  const query = useApi<{ invoices: ReviewInvoice[] }>(`${root}/payment-reviews/workspace/?${q}`);
  const [selection, setSelection] = useState<{ invoice: ReviewInvoice; mode: 'payment' | 'charge' | 'decide' | 'withdraw'; review?: Review } | null>(null);
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('bank_transfer'), [reference, setReference] = useState(''), [note, setNote] = useState(''), [reviewerId, setReviewerId] = useState(''), [confirmed, setConfirmed] = useState(false), [outcome, setOutcome] = useState('rejected'), [validation, setValidation] = useState('');
  const [requestId, setRequestId] = useState(Crypto.randomUUID());
  const [reviewPage, setReviewPage] = useState(1);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const command = useFeeAction(schoolId, JSON.stringify([invoiceId, personId, studentId]), async () => { const context = captureApiContext(); await onLedgerReload(); context.assertCurrent(); await query.refetch({ throwOnError: true }); context.assertCurrent(); setSelection(null); setNote(''); setConfirmed(false); setRequestId(Crypto.randomUUID()); }, async () => {
    const context = captureApiContext(); await onLedgerReload(); context.assertCurrent();
    const current = await query.refetch({ throwOnError: true }); context.assertCurrent(); const previous = selectionRef.current;
    if (!previous) return;
    const invoice = current.data?.invoices.find(item => item.id === previous.invoice.id);
    const review = previous.review ? invoice?.reviews.find(item => item.id === previous.review!.id) : undefined;
    const permitted = invoice && (previous.mode === 'payment' ? invoice.can_report : previous.mode === 'charge' ? invoice.can_question : previous.mode === 'withdraw' ? review?.can_withdraw : review?.can_decide);
    setConfirmed(false);
    if (!invoice || !permitted) {
      setSelection(null); setValidation('This action is no longer available. The current fee record has been loaded; choose an available action.'); return;
    }
    // Rebase authority and ledger revisions while keeping the person's unsent entries.
    setSelection({ ...previous, invoice, ...(review ? { review } : {}) });
  });
  const locked = command.locked || externallyBlocked;
  const start = (value: NonNullable<typeof selection>) => { setSelection(value); setAmount(''); setMethod('bank_transfer'); setReference(''); setNote(''); setReviewerId(''); setConfirmed(false); setOutcome(value.review?.kind === 'charge' ? 'answered' : 'rejected'); setValidation(''); };
  const submit = async () => {
    if (!selection || locked || query.isError) return;
    const { invoice, mode, review } = selection;
    try {
      setValidation('');
      if (mode === 'payment' || mode === 'charge') {
        const reviewer = invoice.reviewers.find(person => person.user_id === reviewerId);
        if (!reviewer) throw new Error('Choose the Finance reviewer for this request.');
        const paise = mode === 'payment' ? nativeFeeAmount(amount) : null;
        if (mode === 'payment' && (!confirmed || reference.trim().length < 3 || paise! > invoice.balance_paise)) throw new Error('Confirm your completed payment, enter its reference and keep the amount within the current balance.');
        if (mode === 'charge' && note.trim().length < 3) throw new Error('Describe what needs checking.');
        Alert.alert('Send this fee request?', mode === 'payment' ? `${money(paise!)} · ${method.replaceAll('_', ' ')}\nReference: ${reference.trim()}\nReviewer: ${reviewer.label}\nThe balance changes only after Finance verifies received funds.` : `For ${reviewer.label} to review:\n${note.trim()}\nA question does not change the charge or due date.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send for review', onPress: () => void command.run({ invoice, reviewId: requestId, action: 'report', path: `${root}/invoices/${encodeURIComponent(invoice.id)}/payment-reviews/`, body: { review_id: requestId, expected_revision: invoice.stream_revision, basis_hash: invoice.basis_hash, basis_revision: invoice.basis_revision, reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }, kind: mode === 'payment' ? 'payment' : 'charge', note: note.trim(), ...(mode === 'payment' ? { amount_paise: paise, method, reference: reference.trim(), payment_made: true } : {}) } }) }]);
      } else if (review) {
        if (mode === 'decide' && (note.trim().length < 3 || outcome === 'verified' && (!review.can_verify || !confirmed))) throw new Error('Add your response and independently verify received funds before confirming a receipt.');
        await command.run({ invoice, reviewId: review.id, action: mode, path: `${root}/payment-reviews/${encodeURIComponent(review.id)}/${mode === 'withdraw' ? 'withdraw' : 'decision'}/`, body: { expected_revision: invoice.stream_revision, ...(mode === 'decide' ? { outcome, response: note.trim(), verified_funds: outcome === 'verified' && confirmed } : {}) } });
      }
    } catch (cause) { setValidation(errorText(cause)); }
  };
  const entries = query.data?.invoices.flatMap(invoice => invoice.reviews.map(review => ({ invoice, review }))) ?? [];
  const reviewPages = Math.max(1, Math.ceil(entries.length / 20)), currentReviewPage = Math.min(reviewPage, reviewPages);
  return <Section title="Payment reports & fee questions">
    {command.error ? <Notice message={command.error} tone="warning" /> : null}{validation ? <Notice message={validation} tone="danger" /> : null}
    {command.obsolete ? <Button title="Review current fee record" kind="secondary" busy={command.busy} onPress={() => void command.review()} /> : null}
    {command.pending ? <><Notice message="This fee action is not confirmed. Its exact details are securely retained. Check the owning result before starting another action." tone="warning" /><Button title="Check fee action result" kind="secondary" busy={command.busy} onPress={() => void command.check()} />{command.retryAllowed ? <Button title="Retry same fee action" busy={command.busy} onPress={() => void command.retry()} /> : null}</> : null}
    {query.isPending ? <Loading /> : query.isError ? <Empty title="Fee requests could not load" message={query.error.message} onRetry={() => void query.refetch()} /> : <>
      {invoiceId ? query.data?.invoices.map(invoice => <View key={invoice.id} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{invoice.can_report ? <Button title="Report completed payment" disabled={locked} onPress={() => start({ invoice, mode: 'payment' })} /> : null}{invoice.can_question ? <Button title="Question this charge" kind="secondary" disabled={locked} onPress={() => start({ invoice, mode: 'charge' })} /> : null}</View>) : null}
      {selection ? <Section title={selection.mode === 'payment' ? 'Report completed payment' : selection.mode === 'charge' ? 'Question this charge' : selection.mode === 'withdraw' ? 'Withdraw request' : 'Review request'}><Row title={selection.invoice.label} detail={`${selection.invoice.reference} · ${selection.invoice.description}`} />{selection.review ? <Row title={selection.review.kind === 'payment' ? `${money(selection.review.amount_paise ?? 0)} reported` : 'Fee question'} detail={`${selection.review.reference ?? ''}${selection.review.note ? `\n${selection.review.note}` : ''}`} /> : null}{selection.mode === 'payment' ? <><Field label="Amount paid (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!locked} /><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{['bank_transfer', 'cash', 'cheque'].map(value => <Button key={value} title={value.replaceAll('_', ' ')} kind={method === value ? 'primary' : 'secondary'} disabled={locked} onPress={() => setMethod(value)} />)}</View><Field label="UTR, bank, counter or cheque reference" value={reference} onChangeText={setReference} maxLength={120} editable={!locked} /><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch value={confirmed} onValueChange={setConfirmed} disabled={locked} accessibilityLabel="I have already made this payment" /><Text style={{ color: colors.ink, fontSize: 16, flex: 1 }}>I have already made this payment.</Text></View></> : null}{selection.mode === 'payment' || selection.mode === 'charge' ? <><Field label={selection.mode === 'charge' ? 'What needs checking?' : 'Note (optional)'} value={note} onChangeText={setNote} multiline maxLength={1000} editable={!locked} /><Section title="Who should review?">{selection.invoice.reviewers.length ? selection.invoice.reviewers.map(reviewer => <Button key={reviewer.user_id} title={reviewer.label} kind={reviewerId === reviewer.user_id ? 'primary' : 'secondary'} disabled={locked} onPress={() => setReviewerId(reviewer.user_id)} />) : <Empty title="No independent Finance reviewer is available" message="Ask your campus administrator to assign one." />}</Section></> : selection.mode === 'decide' ? <>{selection.review?.basis_changed ? <Notice tone="warning" message="The ledger changed after this request. Verification is unavailable; review the current account." /> : null}{selection.review?.kind === 'payment' ? <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Reject report" kind={outcome === 'rejected' ? 'primary' : 'secondary'} disabled={locked} onPress={() => { setOutcome('rejected'); setConfirmed(false); }} />{selection.review.can_verify ? <Button title="Funds verified" kind={outcome === 'verified' ? 'primary' : 'secondary'} disabled={locked} onPress={() => setOutcome('verified')} /> : null}</View> : null}<Field label={outcome === 'rejected' ? 'Reason' : 'Response'} value={note} onChangeText={setNote} multiline maxLength={1000} editable={!locked} />{outcome === 'verified' ? <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Switch value={confirmed} onValueChange={setConfirmed} disabled={locked} accessibilityLabel="I independently verified received funds" /><Text style={{ color: colors.ink, fontSize: 16, flex: 1 }}>I independently verified that these funds were received. Any cheque has cleared.</Text></View> : <Notice message={outcome === 'answered' ? 'Your response does not change the charge or record payment.' : 'No payment will be recorded.'} />}</> : <Notice message="Withdrawal closes this request. Charges, balances and verified receipts remain as recorded." />}<View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button title={selection.mode === 'withdraw' ? 'Withdraw request' : selection.mode === 'decide' ? outcome === 'verified' ? 'Confirm receipt' : 'Send response' : 'Review & send'} busy={command.busy} disabled={locked} onPress={() => void submit()} /><Button title="Close form" kind="secondary" disabled={command.busy || Boolean(command.pending)} onPress={() => setSelection(null)} /></View></Section> : null}
      {entries.length ? entries.slice((currentReviewPage - 1) * 20, currentReviewPage * 20).map(({ invoice, review }) => <Row key={review.id} title={review.kind === 'payment' ? `Payment report${review.amount_paise ? ` · ${money(review.amount_paise)}` : ''}` : 'Fee question'} detail={`${invoice.label} · ${invoice.reference}\n${review.reference ?? ''}${review.note ? `\n${review.note}` : ''}${review.response ? `\nCampus response: ${review.response}` : ''}`} status={review.status === 'pending' ? review.can_decide ? 'Your review needed' : `Waiting for ${review.reviewer.label}` : review.status}><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{review.can_decide ? <Button title="Review request" disabled={locked} onPress={() => start({ invoice, mode: 'decide', review })} /> : null}{review.can_withdraw ? <Button title="Withdraw" kind="secondary" disabled={locked} onPress={() => start({ invoice, mode: 'withdraw', review })} /> : null}</View></Row>) : <Empty title="No payment reports or fee questions" />}
      {reviewPages > 1 ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button title="Previous requests" kind="secondary" disabled={currentReviewPage <= 1} onPress={() => setReviewPage(currentReviewPage - 1)} /><Button title={`Page ${currentReviewPage} of ${reviewPages}`} kind="secondary" disabled onPress={() => {}} /><Button title="Next requests" kind="secondary" disabled={currentReviewPage >= reviewPages} onPress={() => setReviewPage(currentReviewPage + 1)} /></View> : null}
    </>}
  </Section>;
}
