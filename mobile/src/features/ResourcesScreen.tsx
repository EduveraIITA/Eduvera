import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { useEffect, useRef, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TemporalField } from '../ui/TemporalField';
import { useQueryClient } from '@tanstack/react-query';
import type { ResourceCondition, ResourceLoanDetail, ResourceOptions, ResourcesPage } from '../../../packages/contracts/src/wire/features/resources/resourceApi';
import type { InstitutionSetup } from '../../../packages/contracts/src/institution';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { apiFetch, captureApiContext, getApiOrigin } from '../lib/api';
import { useRecordedCommand } from '../lib/recorded-command';
import { useNativePendingAction } from '../lib/native-pending-action';
import { acceptedResourceItemBatch, confirmedResourceSetupChange, currentResourceReturns, resourceReceivableParts, resourceReturnBody } from '../lib/resources-policy';
import { useOperationClock } from '../lib/use-operation-clock';
import { useOperationContext } from '../lib/use-operation-context';
import { ResourceCatalogue, ResourceItemEditor } from './ResourceCatalog';
import { ResourceCustodyEditor } from './ResourceCustody';
import { NativePeopleCreate, NativePeopleBulkCreate } from './PeopleScreen';
import { resourceAcceptedRefresh } from '../lib/resource-operations';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';

export interface DomainScreenProps { href: string; onNavigate: (href: string) => void }
export type RecordedWrite = ReturnType<typeof useRecordedCommand>;
export function CommandFeedback({ write }: { write: RecordedWrite }) {
  const item = write.pending?.kind === 'item' ? JSON.parse(write.pending.body) as { name: string; quantity?: number; asset_tag?: string } : null;
  return <>
    {write.error ? <Notice tone="warning" message={write.error} /> : null}
    {write.pending ? <Section title={write.pending.phase === 'accepted' ? 'Saved action' : 'Action awaiting confirmation'}>
      {item ? <Row title={item.name} detail={`${item.quantity ?? 1} separate ${(item.quantity ?? 1) === 1 ? 'copy' : 'copies'} · ${item.asset_tag ? `Tag ${item.asset_tag}` : 'Automatic tags'}\nOriginal campus and type choices retained.`} /> : null}
      <Notice message={write.pending.kind === 'item' ? write.pending.phase === 'accepted' ? 'The complete item batch was accepted. Recovery only refreshes its saved first copy.' : 'Your exact item batch is securely retained. Recovery resends only that unchanged idempotent request and verifies every copy.' : 'Your exact action is securely retained on this device. Check its result before recording another action.'} />
      <Button title={write.pending.phase === 'accepted' ? 'Refresh saved record' : write.pending.kind === 'item' ? 'Recover the exact item batch' : 'Check result'} busy={write.busy} onPress={() => { void write.check(); }} />
      {write.retryAllowed ? <Button title="Retry the same action" kind="secondary" busy={write.busy} onPress={() => { void write.retry(); }} /> : null}
    </Section> : null}
  </>;
}
export function DomainText({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{children}</Text>;
}
export function LabeledSwitch({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 }}><Text style={{ flex: 1, color: colors.ink, fontSize: 16, lineHeight: 23 }}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.action }} /></View>;
}
export function NativeTimeField({ label, value, onChange, disabled, minimumDate, maximumDate }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; minimumDate?: Date; maximumDate?: Date }) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  if (Platform.OS === 'web') return <TemporalField label={`${label} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} mode="datetime" value={date.toISOString()} disabled={disabled} minimumDate={minimumDate} maximumDate={maximumDate} onChange={onChange} />;
  return <View style={{ gap: 8, marginVertical: 8 }}>
    <DomainText>{label} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</DomainText>
    {Platform.OS === 'ios' ? <DateTimePicker accessibilityLabel={label} value={date} mode="datetime" display="compact" minimumDate={minimumDate} maximumDate={maximumDate} disabled={disabled} onChange={(_event, selected) => { if (selected) onChange(selected.toISOString()); }} /> : <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title={date.toLocaleDateString()} kind="secondary" disabled={disabled} onPress={() => setMode('date')} /><Button title={date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} kind="secondary" disabled={disabled} onPress={() => setMode('time')} /></View>
      {mode ? <DateTimePicker accessibilityLabel={label} value={date} mode={mode} display="default" minimumDate={minimumDate} maximumDate={maximumDate} onChange={(_event, selected) => { setMode(null); if (selected) onChange(selected.toISOString()); }} /> : null}
    </>}
  </View>;
}
export function DomainPages({ page, hasMore, onChange, disabled }: { page: number; hasMore: boolean; onChange: (page: number) => void; disabled?: boolean }) {
  return page > 1 || hasMore ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Button title="Previous" kind="secondary" disabled={disabled || page <= 1} onPress={() => onChange(page - 1)} /><DomainText>Page {page}</DomainText><Button title="Next" kind="secondary" disabled={disabled || !hasMore} onPress={() => onChange(page + 1)} /></View> : null;
}
export function domainDate(value: string, timezone?: string) {
  if (!Number.isFinite(Date.parse(value))) return value;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value));
}
export function domainParams(href: string) { return new URL(href, 'https://thatcampus.invalid').searchParams; }
export function domainHref(route: string, params: URLSearchParams, changes: Record<string, string | undefined>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
  return `${route}${next.size ? `?${next}` : ''}`;
}

export function ResourcesScreen(props: DomainScreenProps) {
  const { schoolId, scopeKey } = useSession();
  return schoolId ? <ResourcesWorkspace key={scopeKey} {...props} schoolId={schoolId} /> : <Page title="Resources"><Empty title="Choose a campus" /></Page>;
}
function ResourcesWorkspace({ href, onNavigate, schoolId }: DomainScreenProps & { schoolId: string }) {
  const session = useSession(), { scopeKey } = session, client = useQueryClient();
  const [catalogueSaved, setCatalogueSaved] = useState(0), [loanSaved, setLoanSaved] = useState(0), [createdItem, setCreatedItem] = useState<{ id: string; label: string; quantity: number } | null>(null), [catalogueReadError, setCatalogueReadError] = useState('');
  const [completedHref, setCompletedHref] = useState(''), [transferredLoan, setTransferredLoan] = useState('');
  const { complete } = useCampusNavigation(href);
  const params = domainParams(href), loanId = params.get('loan_id'), issuing = params.get('action') === 'issue', adding = params.get('action') === 'item', setup = params.get('view') === 'setup';
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/resources`;
  const setupRoot = `/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`;
  const change = (values: Record<string, string | undefined>) => onNavigate(domainHref('/areas/resources', params, values));
  const refreshResources = () => client.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && (query.queryKey[2].startsWith(root) || query.queryKey[2] === setupRoot), refetchType: 'none' });
  const catalogue = useNativePendingAction<InstitutionSetup>({captureOperation: useOperationContext(JSON.stringify([href, setupRoot])),  domain: 'resources', ownerHref: href, refreshPath: setupRoot,
    scope: { actorId: session.user!.id, schoolId, origin: getApiOrigin(), mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null },
    resolveRefreshPath: (value, action) => { const row = confirmedResourceSetupChange(value, schoolId, action.method === 'PATCH' ? action.source?.sourceId : undefined); if (action.method === 'PATCH' && row.revision! <= action.source!.revision) throw new Error('The catalogue did not advance the reviewed source revision.'); return setupRoot; },
    accepted: async (value, assertActive) => { assertActive(); if (value.school.id !== schoolId) throw new Error('The catalogue belongs to another campus.'); const options = await apiFetch<ResourceOptions>(`${root}/options`); assertActive(); await refreshResources(); assertActive(); client.setQueryData(['campus', scopeKey, setupRoot], value); client.setQueryData(['campus', scopeKey, `${root}/options`], options); setCatalogueSaved(current => current + 1); },
  });
  const write = useRecordedCommand({ captureOperation: useOperationContext(JSON.stringify([href, root])), scopeKey, domain: 'resources', root, acceptsItemResult: acceptedResourceItemBatch, onAccepted: async command => {
    const context = captureApiContext();
    if (command.kind === 'item') {
      const options = await apiFetch<ResourceOptions>(`${root}/options?${new URLSearchParams({ holding_id: command.sourceId })}`); context.assertCurrent();
      const first = options.holdings.find(item => item.id === command.sourceId); if (!first || !options.can_manage) throw new Error('The first accepted copy could not be refreshed. Keep this saved action and check again.');
      await refreshResources(); context.assertCurrent(); setCreatedItem({ id: first.id, label: `${first.name} · ${first.asset_tag ?? first.campus_name}`, quantity: Number(JSON.parse(command.body).quantity ?? 1) });
      if (!issuing) setCompletedHref(domainHref('/areas/resources', params, { action: undefined, loan_id: undefined, view: 'items', page: undefined, search: first.name, holding_id: first.id }));
    } else {
      const read = resourceAcceptedRefresh(command), path = `${root}/loans/${encodeURIComponent(command.sourceId)}`;
      if (read.transferred) {
        setTransferredLoan(command.sourceId); client.removeQueries({ queryKey: ['campus', scopeKey, path], exact: true });
        const current = await apiFetch<ResourcesPage>(read.path); context.assertCurrent();
        if (!Array.isArray(current.loans) || current.view !== 'loans') throw new Error('Responsibility was saved. The current loan queue could not be refreshed.');
        await refreshResources(); context.assertCurrent(); client.setQueryData(['campus', scopeKey, read.path], current); setLoanSaved(value => value + 1);
        setCompletedHref(domainHref('/areas/resources', params, { loan_id: undefined, action: undefined, view: 'loans', page: undefined })); return;
      }
      const current = await apiFetch<ResourceLoanDetail>(path); context.assertCurrent();
      if (current.id !== command.sourceId || !Number.isSafeInteger(current.revision) || current.revision < 1) throw new Error('The exact saved loan could not be refreshed.');
      await refreshResources(); context.assertCurrent(); client.setQueryData(['campus', scopeKey, path], current); setLoanSaved(value => value + 1); setCompletedHref(domainHref('/areas/resources', params, { loan_id: command.sourceId, action: undefined, view: undefined }));
    }
  } });
  useEffect(() => { if (completedHref && !write.busy && !write.pending && !catalogue.busy) { setCompletedHref(''); complete(completedHref); } }, [completedHref, write.busy, write.pending, catalogue.busy, complete]);
  useScreenExitGuard({ blocked: write.busy || catalogue.busy });
  async function recoverCatalogue() { if (catalogue.resumeHref) { onNavigate(catalogue.resumeHref); return; } try { setCatalogueReadError(''); const context = captureApiContext(); await catalogue.recover(); context.assertCurrent(); await client.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && (query.queryKey[2] === setupRoot || query.queryKey[2].startsWith(`${root}/options`)) }); context.assertCurrent(); } catch (cause) { setCatalogueReadError(cause instanceof Error ? cause.message : 'The current catalogue view could not be refreshed.'); } }
  const locked = write.locked || catalogue.locked, sharedWrite = { ...write, locked };
  const retainedCatalogue = catalogue.action?.payload.kind === 'json' ? JSON.parse(catalogue.action.payload.body) as { name?: string; code?: string; asset_tag?: string; expected_revision?: number } : null;
  const detail = useApi<ResourceLoanDetail>(loanId && loanId !== transferredLoan && !issuing && !adding && !setup ? `${root}/loans/${encodeURIComponent(loanId)}` : null);
  return <Page title={issuing ? 'Issue item' : adding ? 'Add an item' : setup ? 'Resource catalogue' : loanId ? detail.data?.title ?? 'Borrowing record' : 'Resources & borrowing'} subtitle={issuing ? 'Keep the item, borrower and return responsibility together.' : loanId ? 'Custody and the complete return record.' : 'Your items, loans and borrowing questions.'} refreshing={detail.isRefetching} onRefresh={loanId ? () => { void detail.refetch(); } : undefined}>
    <CommandFeedback write={write} />
    {catalogue.error ? <Notice tone="warning" message={catalogue.error} /> : null}{catalogueReadError ? <Notice tone="warning" message={catalogueReadError} /> : null}{catalogue.action ? <Section title="Retained catalogue action">{retainedCatalogue ? <Row title={retainedCatalogue.name ?? 'Catalogue record'} detail={`${catalogue.action.method === 'PATCH' ? 'Update' : 'Create'} · ${retainedCatalogue.code || retainedCatalogue.asset_tag || 'Exact selected item'}${retainedCatalogue.expected_revision ? ` · Reviewed revision ${retainedCatalogue.expected_revision}` : ''}`} /> : null}<Notice message="This catalogue endpoint has no exact command receipt. After a lost response, inspection keeps the original action and blocks another save." /><Button title={catalogue.resumeHref ? 'Return to original catalogue action' : catalogue.action.phase === 'accepted' ? 'Refresh saved catalogue' : 'Inspect current catalogue'} busy={catalogue.busy} disabled={catalogue.blocked} onPress={() => { void recoverCatalogue(); }} /></Section> : null}
    {issuing || adding || setup || loanId ? <ScreenBack title="Back to resources" disabled={locked} fallbackHref={domainHref('/areas/resources', params, { action: undefined, loan_id: undefined, question_id: undefined, view: undefined })} /> : null}
    {createdItem && !issuing && !adding ? <Section title="Copies added"><Row title={createdItem.label} detail={`${createdItem.quantity} separate ${createdItem.quantity === 1 ? 'copy' : 'copies'} accepted. The first copy can be selected for an issue.`} /><Button title="Issue the first copy" disabled={locked} onPress={() => change({ action: 'issue', holding_id: createdItem.id, loan_id: undefined, view: undefined })} /></Section> : null}
    {issuing ? <ResourceIssue href={href} root={root} setupRoot={setupRoot} write={sharedWrite} legacy={catalogue} saved={catalogueSaved} createdItem={createdItem} initialHoldingId={params.get('holding_id')} /> : adding ? <ResourceItemEditor root={root} setupRoot={setupRoot} write={sharedWrite} legacy={catalogue} saved={catalogueSaved} onCancel={() => change({ action: undefined })} /> : setup ? <ResourceCatalogue setupRoot={setupRoot} write={catalogue} locked={locked} saved={catalogueSaved} /> : loanId ? loanId === transferredLoan ? <Notice message="Responsibility was saved. Current access controls the loan and its private questions; use the retained receipt above if its refreshed queue is still unavailable." /> : detail.isPending ? <Loading /> : detail.error || !detail.data ? <Empty title="This borrowing record could not be loaded" message={detail.error?.message} onRetry={() => { void detail.refetch(); }} /> : <ResourceLoan key={detail.data.id} root={root} loan={detail.data} write={sharedWrite} saved={loanSaved} /> : <ResourceList root={root} params={params} change={change} write={sharedWrite} />}
  </Page>;
}
function ResourceList({ root, params, change, write }: { root: string; params: URLSearchParams; change: (values: Record<string, string | undefined>) => void; write: RecordedWrite }) {
  const view = ['items', 'mine'].includes(params.get('view') ?? '') ? params.get('view')! : 'loans';
  const state = ['outstanding', 'overdue', 'returned', 'questions'].includes(params.get('state') ?? '') ? params.get('state')! : 'all';
  const page = Math.max(1, Number(params.get('page')) || 1), search = params.get('search') ?? '';
  const [draft, setDraft] = useState(search);
  const list = useApi<ResourcesPage>(`${root}/workspace?${new URLSearchParams({ view, state, search, page: String(page) })}`);
  if (list.isPending) return <Loading />;
  if (list.error || !list.data) return <Empty title="Resources could not be loaded" message={list.error?.message} onRetry={() => { void list.refetch(); }} />;
  const data = list.data;
  return <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 160 }}><DomainText>{data.totals.outstanding} out{data.totals.overdue ? ` · ${data.totals.overdue} overdue` : ''}{data.totals.questions ? ` · ${data.totals.questions} questions` : ''}</DomainText></View>
      {data.can_issue ? <ControlButton title="Issue item" kind="primary" disabled={write.locked} onPress={() => change({ action: 'issue' })} /> : null}
    </View>
    {data.can_manage ? <SegmentedControl label="Resources views" value={data.view} options={[{ value: 'loans', label: 'Loans' }, { value: 'items', label: 'Items' }, { value: 'mine', label: 'My borrowing' }]} onChange={value => change({ view: value, page: undefined, state: undefined })} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 180 }}><SearchField label="Find an item or borrower" placeholder="Item, person or tag" value={draft} onChangeText={setDraft} onSubmit={() => change({ search: draft.trim(), page: undefined })} onClear={() => { setDraft(''); change({ search: undefined, page: undefined }); }} /></View>
      {data.view !== 'items' ? <ChoiceMenu label="Loan status" value={state} options={[{ value: 'all', label: 'All' }, { value: 'outstanding', label: 'Out' }, { value: 'overdue', label: 'Overdue' }, { value: 'returned', label: 'Returned' }, { value: 'questions', label: 'Questions' }]} onChange={value => change({ state: value, page: undefined })} /> : null}
    </View>
    {data.view === 'items' ? data.items.length ? <ListGroup><View style={{ paddingHorizontal: 16 }}>{data.items.map((item, index) => <Row key={item.id} variant="plain" separator={index > 0} title={item.name} detail={`${item.asset_tag ?? 'No asset tag'} · ${item.campus_name}`} status={item.available ? 'Available' : item.unavailable_reason ?? 'Unavailable'} icon="resources" onPress={item.active_loan_id ? () => change({ loan_id: item.active_loan_id! }) : undefined}>{data.can_issue && item.available && item.tracking_mode === 'individual' ? <ControlButton title="Issue item" disabled={write.locked} onPress={() => change({ action: 'issue', holding_id: item.id, loan_id: undefined, view: undefined })} /> : null}</Row>)}</View></ListGroup> : <Empty title="No items found" message="Try another name or asset tag." /> : data.loans.length ? <ListGroup><View style={{ paddingHorizontal: 16 }}>{data.loans.map((loan, index) => <Row key={loan.id} variant="plain" separator={index > 0} title={loan.title} detail={`${data.view === 'mine' ? loan.custodian.label : loan.borrower.label} · ${loan.asset_tag}\nDue ${domainDate(loan.due_at)}`} status={loan.state.replaceAll('_', ' ')} icon="loans" onPress={() => change({ loan_id: loan.id })} />)}</View></ListGroup> : <Empty title={search ? 'No matching loans' : 'No loans to show'} message="An issued item and its return record will appear here." />}
    <DomainPages page={data.pagination.page} hasMore={data.pagination.page * data.pagination.page_size < data.pagination.total} onChange={value => change({ page: String(value) })} />
    {data.can_issue || data.can_manage ? <Disclosure title="Resource actions"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{data.can_issue ? <ControlButton title="Add an item" kind="secondary" disabled={write.locked} onPress={() => change({ action: 'item', loan_id: undefined })} /> : null}{data.can_manage ? <ControlButton title="Catalogue setup" kind="secondary" disabled={write.locked} onPress={() => change({ view: 'setup', action: undefined, loan_id: undefined })} /> : null}</View></Disclosure> : null}
  </>;
}
function ResourceIssue({ href, root, setupRoot, write, legacy, saved, createdItem, initialHoldingId }: { href: string; root: string; setupRoot: string; write: RecordedWrite; legacy: ReturnType<typeof useNativePendingAction<InstitutionSetup>>; saved: number; createdItem: { id: string; label: string; quantity: number } | null; initialHoldingId: string | null }) {
  const clock = useOperationClock(`${root}/issue`), capture = useOperationContext(`${root}/issue`), now = clock.now;
  const [preparingIssue, setPreparingIssue] = useState(false), issueRef = useRef(false);
  const [search, setSearch] = useState(''), [submitted, setSubmitted] = useState(''), [page, setPage] = useState(1);
  const [holding, setHolding] = useState<{ id: string; label: string } | null>(initialHoldingId ? { id: initialHoldingId, label: 'Selected copy' } : null), [borrower, setBorrower] = useState<{ id: string; label: string } | null>(null), [adding, setAdding] = useState(false);
  const [due, setDue] = useState(''), [purpose, setPurpose] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [components, setComponents] = useState<Array<{ label: string; quantity: string }>>([]), [error, setError] = useState('');
  const [addingPerson, setAddingPerson] = useState(false), [importingPeople, setImportingPeople] = useState(false);
  useEffect(() => { if (Number.isFinite(Date.parse(now))) setDue(previous => previous || new Date(Date.parse(now) + 86400000).toISOString()); }, [now]);
  useScreenExitGuard({ blocked: write.busy || legacy.busy || preparingIssue, dirty: !adding && !addingPerson && !importingPeople && !write.pending && (!!borrower || !!purpose.trim() || components.length > 0 || confirmed || !!holding && holding.id !== initialHoldingId), onLeave: () => { setBorrower(null); setPurpose(''); setComponents([]); setConfirmed(false); setHolding(null); } });
  const query = new URLSearchParams({ search: submitted, page: String(page), ...(holding ? { holding_id: holding.id } : {}), ...(borrower ? { person_id: borrower.id } : {}) });
  const options = useApi<ResourceOptions>(`${root}/options?${query}`);
  const lastCreated = useRef(createdItem?.id); useEffect(() => { if (createdItem && createdItem.id !== lastCreated.current) { lastCreated.current = createdItem.id; setHolding(createdItem); setConfirmed(false); setAdding(false); } }, [createdItem]);
  if (options.isPending) return <Loading />;
  if (options.error || !options.data || !options.data.can_manage) return <Empty title="Issuing is unavailable" message={options.error?.message ?? 'Your current responsibility does not allow issuing items.'} onRetry={() => { void options.refetch(); }} />;
  const data = options.data;
  const selectedItem = data.holdings.find(value => value.id === holding?.id), selectedBorrower = data.people.find(value => value.id === borrower?.id);
  const issue = async () => {
    if (write.locked || issueRef.current) return;
    setError('');
    if (!holding || !borrower || !confirmed || purpose.trim().length < 5) return;
    if (!selectedItem?.available || selectedItem.tracking_mode !== 'individual' || !selectedBorrower) { setError('Review the current available copy and active campus borrower before issuing.'); return; }
    if (!Number.isFinite(Date.parse(due))) { setError('Choose a valid due time.'); return; }
    if (components.some(part => !part.label.trim() || !/^\d+$/.test(part.quantity) || Number(part.quantity) < 1 || Number(part.quantity) > 100)) { setError('Give each accessory a name and a whole quantity between 1 and 100.'); return; }
    issueRef.current = true; setPreparingIssue(true);
    try { const assertCurrent = capture(), at = await clock.read(); assertCurrent(); if (Date.parse(due) <= Date.parse(at)) throw new Error('Choose a due time after this issue.'); await write.run({ path: `${root}/loans`, body: { expected_revision: 0, holding_id: holding.id, borrower_person_id: borrower.id, due_at: due, custody_confirmed: true, custody_purpose: purpose.trim(), components: components.map(part => ({ label: part.label.trim(), quantity: Number(part.quantity) })) } }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The issue could not be prepared.'); } finally { issueRef.current = false; setPreparingIssue(false); }
  };
  if (adding) return <><ScreenBack title="Back to issue" priority={10} onPress={() => setAdding(false)} /><ResourceItemEditor root={root} setupRoot={setupRoot} write={write} legacy={legacy} saved={saved} onCancel={() => setAdding(false)} /></>;
  if (importingPeople) return <><ScreenBack title="Back to issue" priority={10} onPress={() => setImportingPeople(false)} /><NativePeopleBulkCreate href={href} onDone={people => { if (people.length === 1) setBorrower(people[0]!); setConfirmed(false); setImportingPeople(false); void options.refetch(); }} onClose={() => setImportingPeople(false)} /></>;
  if (addingPerson) return <><ScreenBack title="Back to issue" priority={10} onPress={() => setAddingPerson(false)} /><NativePeopleCreate href={href} onCreated={person => { setBorrower(person); setConfirmed(false); setAddingPerson(false); }} onClose={() => setAddingPerson(false)} /></>;
  return <>
    <Button title="Add an item without losing this issue" kind="secondary" disabled={write.locked} onPress={() => setAdding(true)} />
    <Field label="Find an item or campus person" value={search} editable={!write.locked} onChangeText={setSearch} onSubmitEditing={() => { setSubmitted(search.trim()); setPage(1); }} returnKeyType="search" />
    <Button title="Search choices" kind="secondary" disabled={write.locked} onPress={() => { setSubmitted(search.trim()); setPage(1); }} />
    <Section title="Item">
      {holding ? <Row title={selectedItem ? `${selectedItem.name} · ${selectedItem.asset_tag ?? selectedItem.campus_name}` : holding.label} status={selectedItem?.available ? 'Selected copy' : selectedItem?.unavailable_reason ?? 'Current copy unavailable'} /> : <DomainText>Choose one available, individually tracked copy.</DomainText>}
      {data.holdings.filter(item => item.available && item.tracking_mode === 'individual').map(item => <Button key={item.id} title={`${item.name} · ${item.asset_tag ?? item.campus_name}`} kind={holding?.id === item.id ? 'primary' : 'secondary'} disabled={write.locked} onPress={() => setHolding({ id: item.id, label: `${item.name} · ${item.asset_tag ?? item.campus_name}` })} />)}
    </Section>
    <Section title="Borrower">
      {borrower ? <Row title={borrower.label} status="Responsible for this item" /> : null}
      {data.can_add_people ? <><ControlButton title="Add or reuse a person" disabled={write.locked} onPress={() => setAddingPerson(true)} /><ControlButton title="Import people" disabled={write.locked} onPress={() => setImportingPeople(true)} /></> : null}
      {data.people.map(person => <Button key={person.id} title={person.label} kind={borrower?.id === person.id ? 'primary' : 'secondary'} disabled={write.locked} onPress={() => setBorrower(person)} />)}
      <DomainPages page={page} hasMore={page * data.pagination.page_size < Math.max(data.pagination.people_total, data.pagination.holdings_total)} disabled={write.locked} onChange={setPage} />
    </Section>
    <NativeTimeField label="Due back" value={due} onChange={setDue} disabled={write.locked || preparingIssue || !Number.isFinite(Date.parse(now))} minimumDate={Number.isFinite(Date.parse(now)) ? new Date(now) : undefined} />{clock.error ? <><Notice tone="warning" message={clock.error} /><ControlButton title="Refresh campus time" onPress={() => void clock.read().catch(cause => setError(String(cause)))} /></> : null}
    <Field label="Purpose" value={purpose} onChangeText={setPurpose} editable={!write.locked} placeholder="What is this item being used for?" maxLength={500} />
    <Section title="Accessories">
      {components.map((part, index) => <View key={index}><Field label={`Accessory ${index + 1}`} value={part.label} editable={!write.locked} onChangeText={label => setComponents(previous => previous.map((value, at) => at === index ? { ...value, label } : value))} /><Field label="Quantity" keyboardType="number-pad" value={part.quantity} editable={!write.locked} onChangeText={quantity => setComponents(previous => previous.map((value, at) => at === index ? { ...value, quantity } : value))} /><Button title="Remove accessory" kind="secondary" disabled={write.locked} onPress={() => setComponents(previous => previous.filter((_value, at) => at !== index))} /></View>)}
      <Button title="Add accessory" kind="secondary" disabled={write.locked || components.length >= 20} onPress={() => setComponents(previous => [...previous, { label: '', quantity: '1' }])} />
    </Section>
    <DomainText>Custodian · {data.actor.label}</DomainText>
    <LabeledSwitch label="I am issuing this item and taking responsibility for its return record." value={confirmed} onChange={setConfirmed} disabled={write.locked} />
    {error ? <Notice message={error} tone="danger" /> : null}
    <Button title="Issue item" busy={write.busy || preparingIssue} disabled={write.locked || preparingIssue || !due || !selectedItem?.available || !selectedBorrower || !confirmed || purpose.trim().length < 5} onPress={() => void issue()} />
  </>;
}
function ResourceLoan({ root, loan, write, saved }: { root: string; loan: ResourceLoanDetail; write: RecordedWrite; saved: number }) {
  const clock = useOperationClock(`${root}/loans/${loan.id}`);
  const [action, setAction] = useState<'return' | 'correct' | 'due' | 'question' | 'claim' | 'reply' | 'resolve' | 'custody' | null>(null), [questionId, setQuestionId] = useState(''), [supersedes, setSupersedes] = useState(''), [reviewedRevision, setReviewedRevision] = useState(loan.revision), [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState(''), [due, setDue] = useState(loan.due_at), [observed, setObserved] = useState('');
  const [parts, setParts] = useState<Record<string, { quantity: string; condition: ResourceCondition }>>({}), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [now, setNow] = useState('');
  const out = loan.parts.filter(part => part.outstanding_quantity > 0), source = `${root}/loans/${encodeURIComponent(loan.id)}`;
  const lastSaved = useRef(saved); useEffect(() => { if (lastSaved.current !== saved) { lastSaved.current = saved; setAction(null); setNote(''); setConfirmed(false); setReviewedRevision(loan.revision); } }, [saved, loan.revision]);
  const changed = Boolean(action && reviewedRevision !== loan.revision), locked = write.locked || reviewing, returns = currentResourceReturns(loan);
  useScreenExitGuard({ blocked: write.busy || reviewing, dirty: action !== 'custody' && !!action && (!!note.trim() || Object.keys(parts).length > 0 || confirmed || action === 'due' && due !== loan.due_at), onLeave: () => { setAction(null); setNote(''); setParts({}); setConfirmed(false); } });
  let receivable: ReturnType<typeof resourceReceivableParts> = [], missingReturn = '';
  try { receivable = resourceReceivableParts(loan, action === 'correct' ? supersedes : ''); } catch (cause) { missingReturn = cause instanceof Error ? cause.message : 'Choose the current return receipt.'; }
  const currentClock = clock.read;
  const choose = async (value: typeof action, id = '') => {
    setAction(value); setQuestionId(id); setSupersedes(''); setParts({}); setNote(''); setError(''); setConfirmed(false); setReviewedRevision(loan.revision);
    if (['return', 'correct', 'claim'].includes(value ?? '')) { setReviewing(true); try { const context = captureApiContext(), at = await currentClock(); context.assertCurrent(); setNow(at); setObserved(at); } catch (cause) { setNow(''); setObserved(''); setError(cause instanceof Error ? cause.message : 'The current campus time is unavailable.'); } finally { setReviewing(false); } }
  };
  function chooseReturn(id: string) { const receipt = returns.find(value => value.id === id); setSupersedes(id); setParts(Object.fromEntries(receipt?.parts.map(part => [part.part_id, { quantity: String(part.quantity), condition: part.condition }]) ?? [])); setObserved(receipt?.observed_at ?? now); setConfirmed(false); setError(''); }
  const submit = async () => {
    setError(''); if (!action || !confirmed) return;
    if (changed) { setError('Review the changed loan before recording your retained entries.'); return; }
    const body: Record<string, unknown> = { expected_revision: reviewedRevision };
    let suffix = '';
    if (action === 'return' || action === 'correct') {
      setReviewing(true);
      try { const context = captureApiContext(), at = await currentClock(); context.assertCurrent(); setNow(at); Object.assign(body, resourceReturnBody(loan, { correction: action === 'correct', supersedes: action === 'correct' ? supersedes : '', observedAt: observed, reason: note, received: parts }, at)); suffix = 'returns'; }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'The return could not be reviewed.'); setReviewing(false); return; }
    } else if (action === 'due') { if (note.trim().length < 3) return; suffix = 'due-date'; Object.assign(body, { due_at: due, reason: note.trim() }); }
    else if (action === 'question' || action === 'claim') { if (note.trim().length < 3) return; suffix = 'questions'; Object.assign(body, { kind: action === 'claim' ? 'returned_claim' : 'question', note: note.trim(), ...(action === 'claim' ? { claimed_return_at: observed } : {}) }); }
    else { if (note.trim().length < 3 || !questionId) return; suffix = `questions/${encodeURIComponent(questionId)}/${action === 'reply' ? 'replies' : 'resolve'}`; body.note = note.trim(); }
    try { await write.run({ sourceId: loan.id, path: `${source}/${suffix}`, body }); } finally { setReviewing(false); }
  };
  if (action === 'custody') return <ResourceCustodyEditor root={root} loan={loan} write={write} onClose={() => setAction(null)} />;
  return <>
    <Row title={loan.title} detail={loan.asset_tag} status={loan.state.replaceAll('_', ' ')} icon="loans" />
    <Facts items={[{ label: 'Borrower', value: loan.borrower.label }, { label: 'Custodian', value: loan.custodian.label }, { label: 'Issued', value: domainDate(loan.issued_at) }, { label: 'Due', value: domainDate(loan.due_at) }]} />
    <Section title={out.length ? 'Still out' : 'Return record'}>{loan.parts.map(part => <Row key={part.id} title={part.label} detail={`${part.quantity} issued`} status={part.outstanding_quantity ? `${part.outstanding_quantity} still out` : `Received · ${part.condition}`} />)}</Section>
    {!action ? <>
      {loan.can_record_return && out.length ? <Button title="Record return" disabled={locked} onPress={() => { void choose('return'); }} /> : null}
      {loan.can_record_return ? <Button title="Correct return record" kind="secondary" disabled={locked} onPress={() => { void choose('correct'); }} /> : null}
      {loan.can_change_due && out.length ? <Button title="Change due date" kind="secondary" disabled={locked} onPress={() => { void choose('due'); }} /> : null}
      {loan.can_change_custodian ? <ControlButton title={loan.custody_recovery ? 'Restore responsibility' : 'Change responsibility'} disabled={locked} onPress={() => { void choose('custody'); }} /> : null}
      {loan.can_question && !loan.questions.some(question => question.state === 'open') ? <><Button title="Question this record" kind="secondary" disabled={locked} onPress={() => { void choose('question'); }} />{out.length ? <Button title="I already returned this" kind="secondary" disabled={locked} onPress={() => { void choose('claim'); }} /> : null}</> : null}
    </> : <Section title={{ return: 'Record what you received', correct: 'Correct return record', due: 'Change due date', question: 'Question this record', claim: 'Report an earlier return', reply: 'Reply to question', resolve: 'Resolve question' }[action]}>
      {changed ? <><Notice tone="warning" message="This loan changed. Your entries were kept. Review the current outstanding quantities and history before continuing." /><Button title="Review current loan with these entries" kind="secondary" disabled={locked} onPress={() => { setReviewedRevision(loan.revision); setConfirmed(false); }} /></> : null}
      {action === 'return' || action === 'correct' ? <>
        {action === 'correct' ? <Section title="Return being corrected"><Button title="Add a missed return" kind={!supersedes ? 'primary' : 'secondary'} disabled={locked} onPress={() => chooseReturn('')} />{returns.map(receipt => <Button key={receipt.id} title={`${domainDate(receipt.recorded_at)} · ${receipt.actor_label}`} kind={supersedes === receipt.id ? 'primary' : 'secondary'} disabled={locked} onPress={() => chooseReturn(receipt.id)} />)}{loan.history_has_more ? <Notice message="Only the recent receipt window is available here. Older exact returns need the owning complete record." /> : null}</Section> : null}
        <Notice message={supersedes ? 'Keep only what was actually received in this exact return. Unticking every part reopens that return. The original receipt stays in history.' : 'Select only what you actually received. Anything missing stays out.'} />
        {missingReturn ? <Notice tone="warning" message={missingReturn} /> : null}
        {receivable.map(part => <View key={part.id}><LabeledSwitch label={`${part.label} · up to ${part.receivable_quantity} in this return`} value={Boolean(parts[part.id])} disabled={locked} onChange={selected => setParts(previous => { const next = { ...previous }; if (selected) next[part.id] = { quantity: String(part.receivable_quantity), condition: 'usable' }; else delete next[part.id]; return next; })} />
          {parts[part.id] ? <><Field label="Quantity received" value={parts[part.id]!.quantity} keyboardType="number-pad" editable={!locked} onChangeText={quantity => setParts(previous => ({ ...previous, [part.id]: { ...previous[part.id]!, quantity } }))} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['usable', 'damaged', 'held'] as const).map(condition => <Button key={condition} title={condition === 'held' ? 'Needs checking' : condition === 'usable' ? 'Usable' : 'Damaged'} kind={parts[part.id]?.condition === condition ? 'primary' : 'secondary'} disabled={locked} onPress={() => setParts(previous => ({ ...previous, [part.id]: { ...previous[part.id]!, condition } }))} />)}</View></> : null}
        </View>)}
        {reviewing ? <Loading /> : <NativeTimeField label="Received on" value={observed} onChange={setObserved} disabled={locked || !Number.isFinite(Date.parse(now))} minimumDate={new Date(loan.issued_at)} maximumDate={Number.isFinite(Date.parse(now)) ? new Date(Math.max(Date.parse(now), Date.parse(loan.issued_at))) : undefined} />}
      </> : action === 'due' ? <NativeTimeField label="New due date" value={due} onChange={setDue} disabled={locked} /> : action === 'claim' ? <><Notice message="A reported return is a question for the custodian. It does not confirm physical receipt." />{reviewing ? <Loading /> : <NativeTimeField label="When did you return it?" value={observed} onChange={setObserved} disabled={locked || !Number.isFinite(Date.parse(now))} minimumDate={new Date(loan.issued_at)} maximumDate={Number.isFinite(Date.parse(now)) ? new Date(Math.max(Date.parse(now), Date.parse(loan.issued_at))) : undefined} />}</> : null}
      <Field label={action === 'due' ? 'Reason' : action === 'return' ? 'Return note · optional' : action === 'correct' ? 'Correction reason' : 'Note'} value={note} onChangeText={setNote} editable={!locked} multiline maxLength={1000} />
      <LabeledSwitch label={action === 'return' || action === 'correct' ? 'I checked these actual items and quantities.' : 'I reviewed this action.'} value={confirmed} onChange={setConfirmed} disabled={locked} />
      {error ? <Notice message={error} tone="danger" /> : null}
      <Button title={action === 'return' ? 'Record received' : action === 'correct' ? 'Save correction' : 'Save'} busy={write.busy || reviewing} disabled={locked || changed || Boolean(missingReturn) || ['return', 'correct', 'claim'].includes(action) && (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(observed))) || !confirmed || action !== 'return' && note.trim().length < 3} onPress={() => { void submit(); }} />
      <Button title="Cancel" kind="secondary" disabled={locked} onPress={() => setAction(null)} />
    </Section>}
    {loan.questions.length ? <Section title="Private questions">{loan.questions.map(question => <View key={question.id} style={{ gap: 8 }}><Row title={question.kind === 'returned_claim' ? 'Reported return' : 'Record question'} detail={`${question.note}\n${question.reporter.label} · ${domainDate(question.created_at)}`} status={question.state} />{question.replies.slice().reverse().map(reply => <Row key={reply.id} title={reply.note} detail={`${reply.actor_label} · ${domainDate(reply.recorded_at)}`} status={reply.action} />)}{question.state === 'open' && !action ? <>{loan.can_reply ? <Button title="Reply" kind="secondary" disabled={write.locked} onPress={() => choose('reply', question.id)} /> : null}{loan.can_resolve ? <Button title="Resolve question" kind="secondary" disabled={write.locked} onPress={() => choose('resolve', question.id)} /> : null}</> : null}</View>)}</Section> : null}
    <Disclosure title="Loan history">{loan.history.map(receipt => <Row key={receipt.id} variant="plain" title={receipt.action.replaceAll('_', ' ')} detail={`${receipt.actor_label} · Recorded ${domainDate(receipt.recorded_at)}${receipt.observed_at ? `\nReceived ${domainDate(receipt.observed_at)}` : ''}${receipt.parts.length ? `\n${receipt.parts.map(part => `${loan.parts.find(value => value.id === part.part_id)?.label ?? 'Loan part'} · ${part.quantity} · ${part.condition === 'held' ? 'Needs checking' : part.condition}`).join('\n')}` : ''}${receipt.supersedes_receipt_id ? '\nCorrects an earlier return; original evidence retained.' : ''}${receipt.note || receipt.reason ? `\n${receipt.note || receipt.reason}` : ''}`} />)}{loan.history_has_more ? <DomainText>Earlier history is available through the complete campus record.</DomainText> : null}</Disclosure>
  </>;
}
