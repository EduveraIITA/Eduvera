import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TemporalField } from '../ui/TemporalField';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { NoticeAudience, NoticeContent, NoticeDetail, NoticeReferences, NoticeSummary } from '../../../packages/contracts/src/wire/features/notices/api';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { clearUpdateJournal, executeUpdateJournal, type UpdateJournalProgress } from '../lib/update-journal-operation';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, SegmentedControl } from '../ui/DomainControls';
import { DomainPages, DomainText } from './ResourcesScreen';
import { useTheme } from '../ui/theme';
import { UpdatesFollowUp, UpdatesCancellation } from './UpdatesFollowUp';
import { updateCommandAllowed, updateReceiptMatches, type UpdateCommand as ManageCommand, type UpdateCommandResult as ManageResult } from './UpdatesPolicy';

type Props = { href: string; onNavigate: (href: string) => void };
type UpdateContext = { key: string; scope: 'responsibility' | 'dependent'; studentId?: string; label: string; capabilities: readonly string[] };
type ListWire = { results: NoticeSummary[]; attention: { total: number }; student_id: string | null };
type PendingResponse = { noticeId: string; accepted?: boolean; body: { expected_revision: number; response_value?: string; student_id?: string; idempotency_key: string } };

// Native stacks retain previous screen instances. Share journal locks and
// committed state so returning to one cannot overwrite another's unknown action.
type SecureEntry<T> = { value: T | null; busy: boolean; loaded?: Promise<void>; listeners: Set<() => void> };
const secureEntries = new Map<string, SecureEntry<unknown>>();
function secureEntry<T>(key: string): SecureEntry<T> {
  let entry = secureEntries.get(key);
  if (!entry) { entry = { value: null, busy: false, listeners: new Set() }; secureEntries.set(key, entry); }
  return entry as SecureEntry<T>;
}
function changedEntry(entry: SecureEntry<unknown>) { for (const listener of entry.listeners) listener(); }
function encryptedJournal(key: string) {
  const storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (name, value) => SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
  return {
    read: async () => (await storage.read()) ?? SecureStore.getItemAsync(key),
    write: async (value: string) => { await storage.write(value); await SecureStore.deleteItemAsync(key); },
    clear: async () => { await storage.clear(); await SecureStore.deleteItemAsync(key); },
  };
}


function useVisibleRecord() {
  const [focused, setFocused] = useState(false), current = useRef(false);
  useFocusEffect(useCallback(() => { current.current = true; setFocused(true); return () => { current.current = false; setFocused(false); }; }, []));
  return { focused, current };
}

const paramsOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
const canCompose = (context: UpdateContext) => context.scope === 'responsibility' && context.capabilities.includes('messages.send');
const formatDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : value;
function listHref(context: UpdateContext, query = new URLSearchParams()) { const next = new URLSearchParams(query); next.delete('attention_notification_id'); next.delete('scope'); next.delete('student_id'); if (context.scope === 'dependent') { next.set('scope', 'dependent'); next.set('student_id', context.studentId!); } return `/areas/messages/updates${next.size ? `?${next}` : ''}`; }

export function UpdatesScreen(props: Props) {
  const { scopeKey } = useSession();
  return <ScopedUpdates key={scopeKey} {...props} />;
}
function ScopedUpdates(props: Props) {
  const { schoolId, user, environment } = useSession();
  const workspace = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => {
    if (!workspace.data || !schoolId || !user) return { options: [] as UpdateContext[], error: '' };
    try {
      const manifest = normalizeWorkspaceManifest(workspace.data);
      assertWorkspaceManifestContext(manifest, { actorUserId: user.id, institutionId: schoolId, environment });
      const options: UpdateContext[] = [];
      manifest.areas.find(area => area.key === 'messages')?.surfaces.forEach(surface => {
        if (surface.key === 'updates') options.push({ key: surface.key, scope: 'responsibility', label: surface.label || 'Campus updates', capabilities: surface.capabilities });
        const child = /^updates:dependent:(.+)$/.exec(surface.key);
        if (child?.[1]) options.push({ key: surface.key, scope: 'dependent', studentId: child[1], label: surface.label, capabilities: surface.capabilities });
      });
      return { options, error: '' };
    } catch (cause) { return { options: [] as UpdateContext[], error: cause instanceof Error ? cause.message : 'Your update scope could not be confirmed.' }; }
  }, [workspace.data, schoolId, user, environment]);
  const params = paramsOf(props.href);
  const requested = params.get('scope') === 'dependent' && params.get('student_id') ? `updates:dependent:${params.get('student_id')}` : (!params.has('scope') || params.get('scope') === 'responsibility') && !params.has('student_id') ? 'updates' : null;
  const context = resolved.options.find(option => option.key === requested) ?? (!params.has('scope') && !params.has('student_id') ? resolved.options[0] : undefined);
  if (!schoolId) return <Page title="Updates"><Empty title="Choose a campus" /></Page>;
  if (environment.unavailable) return <Page title="Updates"><Empty title="Simulation is unavailable" message="Recover this world or return to Live." /></Page>;
  if (workspace.isPending) return <Page title="Updates"><Loading /></Page>;
  if (workspace.isError || resolved.error) return <Page title="Updates"><Empty title="Update access could not load" message={resolved.error || workspace.error?.message} onRetry={() => void workspace.refetch()} /></Page>;
  if (!context) return <Page title="Updates"><Empty title="These updates are unavailable" message="Your current relationships and responsibilities determine which updates you can open." /></Page>;
  const segments = props.href.split('?')[0].split('/').filter(Boolean), updatesIndex = segments.indexOf('updates'), afterUpdates = updatesIndex >= 0 ? segments[updatesIndex + 1] : undefined;
  const noticeId = afterUpdates && !['new', 'edit'].includes(afterUpdates) ? afterUpdates : params.get('notice_id');
  if (afterUpdates === 'new' || segments.includes('edit')) return canCompose(context)
    ? <UpdateComposer key={`${context.key}:${noticeId ?? 'new'}`} {...props} context={context} schoolId={schoolId} id={afterUpdates === 'new' ? undefined : noticeId ?? undefined} />
    : <Page title="Updates"><Empty title="Drafting is unavailable" message="Your current update scope does not include publishing authority." /><ScreenBack title="Back to updates" fallbackHref={listHref(context)} /></Page>;
  return noticeId ? <UpdateDetail key={`${context.key}:${noticeId}`} {...props} context={context} id={noticeId} />
    : <UpdateList {...props} key={context.key} schoolId={schoolId} context={context} options={resolved.options} />;
}

function UpdateList({ href, onNavigate, schoolId, context, options }: Props & { schoolId: string; context: UpdateContext; options: UpdateContext[] }) {
  const params = paramsOf(href), filter = params.get('view') ?? 'all';
  const query = new URLSearchParams({ scope: context.scope, school_id: schoolId, ...(context.studentId ? { student_id: context.studentId } : {}) });
  const result = useApi<ListWire>(`/api/v1/notices?${query}`);
  const notices = (result.data?.results ?? []).filter(item => filter === 'attention' ? !!item.attention_reasons?.length : filter === 'all' || item.status === filter);
  const pages = Math.max(1, Math.ceil(notices.length / 10)), page = Math.min(pages, Math.max(1, Number.parseInt(params.get('updates_page') ?? '1', 10) || 1));
  const change = (values: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); onNavigate(listHref(context, next)); };
  return <Page title="Updates" subtitle={context.label} refreshing={result.isRefetching} onRefresh={() => void result.refetch()}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>{options.length > 1 ? <ChoiceMenu label="Updates for" value={context.key} options={options.map(option => ({ value: option.key, label: option.label }))} onChange={value => { const option = options.find(option => option.key === value); if (option) onNavigate(listHref(option)); }} /> : <DomainText>{result.isSuccess ? `${notices.length} in this view` : 'Campus updates'}</DomainText>}{canCompose(context) ? <ControlButton title="New update" kind="primary" onPress={() => onNavigate('/areas/messages/updates/new')} /> : null}</View>
    <ChoiceMenu label="Update status" value={filter} options={['all', 'attention', 'published', ...(canCompose(context) ? ['draft'] : []), 'cancelled'].map(value => ({ value, label: value === 'all' ? 'All updates' : value === 'attention' ? 'Needs attention' : value === 'published' ? 'Published' : value === 'draft' ? 'Drafts' : 'Cancelled' }))} onChange={value => change({ view: value === 'all' ? '' : value, updates_page: '' })} />
    {result.isPending ? <Loading /> : result.isError ? <Empty title="Updates could not load" message={result.error.message} onRetry={() => void result.refetch()} /> : !notices.length ? <Empty title="No updates in this view" message="Campus updates appear within your selected scope." /> : <Section title="Campus updates"><ListGroup><View style={{ paddingHorizontal: 16 }}>{notices.slice((page - 1) * 10, page * 10).map((item, index) => <Row key={item.id} variant="plain" separator={index > 0} icon="updates" title={item.title} detail={[item.body.slice(0, 180), item.student_name, item.due_at ? `Respond by ${formatDate(item.due_at)}` : null].filter(Boolean).join('\n')} status={item.status === 'cancelled' ? 'Cancelled' : item.responded_at ? 'Response recorded' : item.attention_reasons?.includes('response_required') ? 'Response needed' : item.status === 'draft' ? 'Draft' : !item.opened_at ? 'Unread' : undefined} onPress={() => { const list = listHref(context, params), [path, search] = list.split('?'); onNavigate(`${path}/${encodeURIComponent(item.id)}${search ? `?${search}` : ''}`); }} />)}</View></ListGroup></Section>}
    {pages > 1 ? <DomainPages page={page} hasMore={page < pages} onChange={value => change({ updates_page: String(value) })} /> : null}
  </Page>;
}

function UpdateDetail({ href, onNavigate, context, id }: Props & { context: UpdateContext; id: string }) {
  const { colors } = useTheme();
  const { scopeKey, schoolId, environment, memberships } = useSession(), client = useQueryClient();
  const references = useApi<NoticeReferences>(canCompose(context) && schoolId ? `/api/v1/notices/references?scope=responsibility&school_id=${encodeURIComponent(schoolId)}` : null);
  const management = useNoticeCommand(href, context, id);
  const captureResponse = useOperationContext(JSON.stringify([href, context.key, context.studentId ?? '', id, 'response']));
  const query = new URLSearchParams({ scope: context.scope, ...(context.studentId ? { student_id: context.studentId } : {}) });
  const result = useApi<NoticeDetail>(`/api/v1/notices/${encodeURIComponent(id)}?${query}`);
  const [choice, setChoice] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pending, setPendingState] = useState<PendingResponse | null>(null), [journal, setJournal] = useState<string | null>(null);
  useEffect(() => { if (!journal) return; const entry = secureEntry<PendingResponse>(journal), sync = () => { setPendingState(entry.value); setBusy(entry.busy); }; entry.listeners.add(sync); sync(); return () => { entry.listeners.delete(sync); }; }, [journal]);
  const [openError, setOpenError] = useState(''), [openRetry, setOpenRetry] = useState(0);
  const attemptedOpen = useRef(''), visible = useVisibleRecord();
  const commandActive = useRef(false);
  useEffect(() => { let active = true; void (async () => { try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${getApiOrigin()}:${scopeKey}:${context.key}:${id}`);
    const key = `thatcampus.notice-response.${digest}`, entry = secureEntry<PendingResponse>(key);
    if (!entry.loaded) entry.loaded = (async () => { const raw = await encryptedJournal(key).read(); if (raw) { const stored = JSON.parse(raw) as PendingResponse; if (stored.noticeId !== id || !stored.body.idempotency_key || stored.body.student_id !== context.studentId || !Number.isInteger(stored.body.expected_revision) || stored.body.expected_revision < 1) throw new Error('The saved response could not be verified.'); entry.value = stored; } })();
    await entry.loaded;
    if (active) { setPendingState(entry.value); if (entry.value) setChoice(entry.value.body.response_value ?? ''); setJournal(key); }
  } catch { if (active) setError('Secure response recovery is unavailable. A response cannot be submitted until it is restored.'); } })(); return () => { active = false; }; }, [scopeKey, context.key, id]);
  const recipient = result.data?.recipient ?? result.data?.self_recipient;
  useEffect(() => {
    const data = result.data;
    if (!visible.focused || !visible.current.current || !data || !recipient || data.status === 'draft' || recipient.last_seen_notice_revision >= data.revision) return;
    const key = `${recipient.id}:${data.revision}`;
    if (attemptedOpen.current === key) return;
    let assertCurrent: () => void;
    try { assertCurrent = captureResponse(); } catch { return; }
    attemptedOpen.current = key;
    let active = true;
    void apiFetch(`/api/v1/notices/${encodeURIComponent(id)}/open`, { method: 'POST', body: JSON.stringify({ student_id: context.studentId }) }).then(async () => {
      assertCurrent(); if (!active) return;
      setOpenError(''); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); assertCurrent();
    }).catch(() => { try { assertCurrent(); if (active) setOpenError('The update is visible, but its opened status was not confirmed.'); } catch { attemptedOpen.current = ''; } });
    return () => { active = false; };
  }, [result.data, recipient, id, context.studentId, scopeKey, client, openRetry, visible.focused, visible.current, captureResponse]);
  async function sendResponse() {
    if (commandActive.current || !journal || !result.data || !recipient) return;
    const entry = secureEntry<PendingResponse>(journal);
    if (entry.busy) return;
    if (entry.value && !pending) { setPendingState(entry.value); setError('An earlier response is retained. Review and recover the original response before sending another.'); return; }
    entry.busy = true; changedEntry(entry); commandActive.current = true;
    setBusy(true); setError(''); setMessage('');
    const recovering = entry.value !== null;
    const command = entry.value ?? { noticeId: id, body: { expected_revision: recipient.revision,
      ...(result.data.response_mode === 'choice' ? { response_value: choice } : {}), ...(context.studentId ? { student_id: context.studentId } : {}), idempotency_key: Crypto.randomUUID() } };
    const progress: UpdateJournalProgress<boolean> = { accepted: command.accepted, cleared: false, dispatched: false };
    const retained = { ...encryptedJournal(journal), retain: (value: PendingResponse | null) => { entry.value = value; changedEntry(entry); } };
    let assertCurrent: (() => void) | undefined;
    try {
      assertCurrent = captureResponse();
      await executeUpdateJournal(command, { capture: () => assertCurrent!, journal: retained, progress,
        send: original => apiFetch(`/api/v1/notices/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify(original.body) }),
        receipt: value => { const response = value as { id: string; recipient_id: string; recipient_revision: number; response_value: string | null } | null;
        if (!response) throw new Error('The server returned an incomplete response result. Recover the original response before sending another.');
        if (response.id !== id || response.recipient_id !== recipient.id || !Number.isInteger(response.recipient_revision) || response.recipient_revision <= command.body.expected_revision || command.body.response_value !== undefined && response.response_value !== command.body.response_value) throw new Error('The server returned an incomplete response result. Recover the original response before sending another.');
        return true;
      } });
      assertCurrent(); setMessage('Your response was recorded.');
      try { assertCurrent(); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); assertCurrent(); } catch { assertCurrent(); setError('Your response was recorded. Refresh to load the latest response status.'); }
    } catch (cause) {
      // A refusal during recovery cannot disprove an earlier unknown result
      // (for example, authority may have been revoked since the first attempt).
      try {
        if (!assertCurrent) return; assertCurrent();
        if (!progress.accepted && !recovering && progress.dispatched && cause instanceof ApiError && [400, 401, 403, 404, 409, 410, 422].includes(cause.status)) await clearUpdateJournal(retained, assertCurrent, progress);
        assertCurrent();
      } catch { return; }
      setError(progress.accepted ? 'Your response was recorded. Finish local recovery before another action.' : cause instanceof Error ? cause.message : 'Your response could not be confirmed.');
    } finally { entry.busy = false; changedEntry(entry); commandActive.current = false; setBusy(false); }
  }
  const data = result.data, now = environment.mode === 'simulation' ? Date.parse(environment.virtual_clock?.now ?? '') : Date.now();
  const expired = !!data?.due_at && Date.parse(data.due_at) < now;
  return <Page title={data?.title ?? 'Update'} subtitle={context.label} refreshing={result.isRefetching} onRefresh={() => void result.refetch()}>
    <ScreenBack title="Back to updates" disabled={busy || management.busy} fallbackHref={listHref(context, paramsOf(href))} />
    {result.isPending ? <Loading /> : result.isError || !data ? <Empty title="Update is unavailable" message={result.error?.message} onRetry={() => void result.refetch()} /> : <>
      <DomainText>{data.status === 'cancelled' ? 'Cancelled update' : data.status === 'draft' ? 'Draft update' : data.priority === 'urgent' ? 'Urgent update' : 'Campus update'}{data.due_at ? ` · Response due ${formatDate(data.due_at)}` : ''}</DomainText><Text selectable style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>{data.body}</Text>
      {data.can_manage && canCompose(context) ? <>
        <Disclosure title="Saved audience and response"><Row title={data.audiences.map(audience => audience.kind === 'class_guardians' ? `${references.data?.classes.find(item => item.id === audience.class_section_id)?.name || 'Selected class'} guardians` : audienceNames[audience.kind]).join(' · ')} detail={data.response_mode === 'information' ? 'Information only' : data.response_mode === 'acknowledgement' ? 'Acknowledgement requested' : `Choices: ${data.response_options.join(' · ')}`} />{references.isError ? <Notice tone="warning" message="Current audience names could not load. Refresh before publishing." /> : null}</Disclosure>
        <NoticeCommandStatus command={management} onRecovered={() => void result.refetch()} />
        {data.status === 'draft' ? <Section title="Draft actions"><Notice message="Saving a draft does not notify recipients. Publishing delivers this exact saved version to its selected audience." /><ControlButton title="Edit draft" disabled={management.blocked} onPress={() => onNavigate(`/areas/messages/updates/${encodeURIComponent(id)}/edit`)} /><Button title="Publish update" busy={management.busy} disabled={management.blocked || references.isPending || references.isError} onPress={() => Alert.alert('Publish this update?', `${data.title}\nRecipients in the saved audience will receive this update.`, [{ text: 'Keep draft', style: 'cancel' }, { text: 'Publish', onPress: () => void management.run({ path: `/api/v1/notices/${encodeURIComponent(id)}/publish`, method: 'POST', kind: 'publish', body: { expected_revision: data.revision, idempotency_key: Crypto.randomUUID() } }).then(saved => { if (saved) void result.refetch(); }) }])} /></Section> : null}
      </> : null}
      {data.cancellation_reason ? <Notice message={data.cancellation_reason} /> : null}
      {openError ? <><Notice tone="warning" message={openError} /><Button title="Retry opened status" kind="secondary" onPress={() => { attemptedOpen.current = ''; setOpenRetry(value => value + 1); }} /></> : null}
      {error ? <Notice tone="danger" message={error} /> : null}{message ? <Notice tone="success" message={message} /> : null}
      {pending ? <><Notice tone="warning" message={pending.accepted ? 'Your response was recorded. Finish local recovery before another action.' : 'This response has an unconfirmed result. Retry the same response to recover its result before sending another.'} /><Button title={pending.accepted ? 'Finish local recovery' : 'Retry original response'} busy={busy} onPress={() => void sendResponse()} /></> : recipient?.responded_at ? <Row title="Your response" detail={data.response_mode === 'choice' ? recipient.response_value || 'Recorded' : 'Acknowledged'} status={`Recorded ${formatDate(recipient.responded_at)}`} />
        : data.status !== 'published' || data.response_mode === 'information' ? <Notice message="No response is needed." /> : expired ? <Notice message="The response period has ended." /> : recipient ? <Section title="Your response">
          {data.response_mode === 'choice' ? <ChoiceMenu label="Your response choice" value={choice} options={data.response_options.map(option => ({ value: option, label: option }))} disabled={busy} onChange={setChoice} /> : <Notice message="Confirm that you have read this update." />}
          <Button title={data.response_mode === 'choice' ? 'Submit response' : 'Acknowledge'} busy={busy} disabled={!journal || !Number.isFinite(now) || (data.response_mode === 'choice' && !choice)} onPress={() => void sendResponse()} />
        </Section> : <Notice message="You are viewing this update through your current responsibility. No personal response is assigned." />}
      {data.metrics ? <Section title="Delivery and responses"><Facts items={[{ label: 'Recipients', value: data.metrics.recipients }, { label: 'Opened', value: data.metrics.opened }, { label: 'Responses', value: data.metrics.responded }, { label: 'Delivery exceptions', value: data.metrics.delivery_exceptions }]} /></Section> : null}
      {data.can_manage && canCompose(context) ? <><UpdatesFollowUp notice={data} command={management} now={now} focusAttention={paramsOf(href).get('focus') === 'attention'} canAssist={memberships.some(item => item.school_id === schoolId && item.role === 'admin')} /><UpdatesCancellation notice={data} command={management} /></> : null}
    </>}
  </Page>;
}

function useNoticeCommand(href: string, context: UpdateContext, id?: string) {
  const { scopeKey, schoolId } = useSession(), client = useQueryClient(), active = useRef(false), mounted = useRef(true);
  const captureOperation = useOperationContext(JSON.stringify([href, context.key, context.studentId ?? '', id ?? 'new', 'manage']));
  const [pending, setPendingState] = useState<ManageCommand | null>(null), [journal, setJournal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { if (!journal) return; const entry = secureEntry<ManageCommand>(journal), sync = () => { setPendingState(entry.value); setBusy(entry.busy); }; entry.listeners.add(sync); sync(); return () => { entry.listeners.delete(sync); }; }, [journal]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { let current = true; void (async () => { try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${getApiOrigin()}:${scopeKey}:${context.key}:${id ?? 'new'}`);
    const key = `thatcampus.notice-manage.${digest}`, entry = secureEntry<ManageCommand>(key);
    if (!entry.loaded) entry.loaded = (async () => { const raw = await encryptedJournal(key).read();
    if (raw) {
      const saved = JSON.parse(raw) as ManageCommand;
      if (!updateCommandAllowed(saved, id, schoolId) || saved.accepted && !updateReceiptMatches(saved, saved.accepted)) throw new Error('Saved update action is invalid');
      entry.value = saved;
    }
    })();
    await entry.loaded; if (!current) return; setPendingState(entry.value);
    setJournal(key);
  } catch { if (current) setError('Secure draft recovery is unavailable. Restore it before saving or publishing.'); } })(); return () => { current = false; }; }, [scopeKey, schoolId, context.key, id]);
  async function run(requested: ManageCommand): Promise<ManageResult | undefined> {
    if (!journal || active.current || !mounted.current) return;
    if (!updateCommandAllowed(requested, id, schoolId)) { setError('This update action does not match the current saved record. Nothing was sent.'); return; }
    const entry = secureEntry<ManageCommand>(journal);
    if (entry.busy) return;
    if (entry.value && JSON.stringify([entry.value.path, entry.value.body]) !== JSON.stringify([requested.path, requested.body])) { setPendingState(entry.value); setError('An earlier update action is retained. Recover the original action before making another change.'); return; }
    entry.busy = true; changedEntry(entry);
    active.current = true; setBusy(true); setError(''); setMessage('');
    const recovering = entry.value !== null, command = entry.value ?? requested;
    const progress: UpdateJournalProgress<ManageResult> = { accepted: command.accepted, cleared: false, dispatched: false };
    const retained = { ...encryptedJournal(journal), retain: (value: ManageCommand | null) => { entry.value = value; changedEntry(entry); } };
    let assertCurrent: (() => void) | undefined;
    try {
      assertCurrent = captureOperation();
      const accepted = await executeUpdateJournal(command, { capture: () => assertCurrent!, journal: retained, progress,
        send: original => apiFetch(original.path, { method: original.method, body: JSON.stringify(original.body) }),
        receipt: value => { const result = value as ManageResult;
        if (!updateReceiptMatches(command, result)) throw new Error('The server returned an incomplete update result. Retry the original action to recover it.');
        return result;
      } });
      assertCurrent();
      setMessage(command.kind === 'delivery' ? 'Delivery recorded.' : command.kind === 'assisted' ? 'Assisted response recorded.' : accepted.status === 'cancelled' ? 'Update cancelled. Existing responses and delivery evidence are retained.' : accepted.status === 'published' ? `Published${accepted.recipient_count !== undefined ? ` to ${accepted.recipient_count} recipients` : ''}.` : 'Draft saved.');
      try { assertCurrent(); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); assertCurrent(); } catch { assertCurrent(); setError('The update was recorded. Refresh to load the current version.'); }
      assertCurrent(); return accepted;
    } catch (cause) {
      try {
        if (!assertCurrent) return; assertCurrent();
        if (!progress.accepted && !recovering && progress.dispatched && cause instanceof ApiError && [400, 401, 403, 404, 409, 410, 422].includes(cause.status)) await clearUpdateJournal(retained, assertCurrent, progress);
        assertCurrent();
      } catch { return; }
      setError(progress.accepted ? 'The server recorded this update. Finish secure local cleanup before making another change.' : cause instanceof Error ? cause.message : 'The update result could not be confirmed.');
      return undefined;
    } finally { entry.busy = false; changedEntry(entry); active.current = false; setBusy(false); }
  }
  return { pending, journal, busy, error, message, run, blocked: busy || !!pending || !journal };
}
function NoticeCommandStatus({ command, onRecovered }: { command: ReturnType<typeof useNoticeCommand>; onRecovered?: (result: ManageResult) => void }) {
  return <>{command.error ? <Notice tone="danger" message={command.error} /> : null}{command.message ? <Notice tone="success" message={command.message} /> : null}{command.pending ? <><Notice tone="warning" message={command.pending.accepted ? 'This update was recorded. Finish local recovery before making another change.' : 'This action has an unconfirmed result. Its exact content, expected revision and action key are retained securely. Editing is paused until the original action is resolved.'} /><Button title={command.pending.accepted ? 'Finish local recovery' : 'Retry original action'} busy={command.busy} onPress={() => void command.run(command.pending!).then(result => { if (result) onRecovered?.(result); })} /></> : null}</>;
}
const audienceNames: Record<NoticeAudience['kind'], string> = { school_staff: 'All staff', school_guardians: 'All guardians', class_guardians: 'Guardians in a class' };
const audienceKey = (audience: NoticeAudience) => `${audience.kind}:${audience.class_section_id ?? ''}`;
function detailHref(context: UpdateContext, id: string, href: string) {
  const [path, query] = listHref(context, paramsOf(href)).split('?');
  return `${path}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}
function UpdateComposer({ href, onNavigate, context, schoolId, id }: Props & { context: UpdateContext; schoolId: string; id?: string }) {
  const references = useApi<NoticeReferences>(`/api/v1/notices/references?scope=responsibility&school_id=${encodeURIComponent(schoolId)}`);
  const existing = useApi<NoticeDetail>(id ? `/api/v1/notices/${encodeURIComponent(id)}?scope=responsibility` : null);
  if (references.isPending || id && existing.isPending) return <Page title={id ? 'Edit update' : 'New update'}><Loading /></Page>;
  if (references.isError || id && existing.isError) return <Page title="Update draft"><Empty title="Draft context could not load" message={references.error?.message || existing.error?.message} onRetry={() => { void references.refetch(); if (id) void existing.refetch(); }} /></Page>;
  if (!references.data || references.data.school_id !== schoolId || !references.data.audience_kinds?.length) return <Page title="Update draft"><Empty title="Audience choices are unavailable" message="The campus must return your current authorized audience choices before a draft can be saved." /></Page>;
  if (id && (!existing.data || !existing.data.can_manage || existing.data.status !== 'draft')) return <Page title="Update draft"><Empty title="This draft cannot be edited" message="It may have been published, cancelled or moved outside your current authority." /><Button title="Open update" kind="secondary" onPress={() => onNavigate(detailHref(context, id, href))} /></Page>;
  return <UpdateComposerForm key={id ?? 'new'} {...{ href, onNavigate, context, schoolId, id }} references={references.data} initial={existing.data} />;
}
function UpdateComposerForm({ href, onNavigate, context, schoolId, id, references, initial }: Props & { context: UpdateContext; schoolId: string; id?: string; references: NoticeReferences; initial?: NoticeDetail }) {
  const command = useNoticeCommand(href, context, id);
  const { complete } = useCampusNavigation(href);
  const [draft, setDraft] = useState<NoticeContent>(() => ({ title: initial?.title ?? '', body: initial?.body ?? '', response_mode: initial?.response_mode ?? 'information', priority: initial?.priority ?? 'normal', response_options: initial?.response_options ?? [], due_at: initial?.due_at ?? null, audiences: initial?.audiences ?? [] }));
  const [revision, setRevision] = useState(initial?.revision), [optionsText, setOptionsText] = useState(initial?.response_options.join('\n') ?? '');
  const [error, setError] = useState(''), [classSearch, setClassSearch] = useState(''), [classPage, setClassPage] = useState(1);
  const [initialDraft] = useState(() => JSON.stringify({ draft, optionsText }));
  useScreenExitGuard({ dirty: !command.pending && JSON.stringify({ draft, optionsText }) !== initialDraft, blocked: command.busy, title: 'Leave this update draft?', message: 'Your unsaved message and audience choices will be lost.' });
  const restored = useRef(false);
  useEffect(() => {
    if (!command.pending || restored.current || command.pending.kind === 'publish') return;
    restored.current = true;
    const body = command.pending.body as unknown as NoticeContent;
    if (typeof body.title === 'string' && typeof body.body === 'string' && Array.isArray(body.audiences) && Array.isArray(body.response_options)) { setDraft(body); setOptionsText(body.response_options.join('\n')); }
  }, [command.pending]);
  const update = (values: Partial<NoticeContent>) => { if (!command.blocked) setDraft(current => ({ ...current, ...values })); };
  const changed = !!id && !!initial && initial.revision !== revision;
  const availableKinds = references.audience_kinds ?? [];
  const classes = references.classes.filter(item => item.name.toLowerCase().includes(classSearch.toLowerCase()));
  const pages = Math.max(1, Math.ceil(classes.length / 15)), currentPage = Math.min(classPage, pages);
  const contains = (audience: NoticeAudience) => draft.audiences.some(item => audienceKey(item) === audienceKey(audience));
  function toggle(audience: NoticeAudience) { if (command.blocked) return; update({ audiences: contains(audience) ? draft.audiences.filter(item => audienceKey(item) !== audienceKey(audience)) : draft.audiences.length < 10 ? [...draft.audiences, audience] : draft.audiences }); }
  function save() {
    if (command.blocked || changed) return;
    setError('');
    const choices = draft.response_mode === 'choice' ? optionsText.split('\n').map(value => value.trim()).filter(Boolean) : [];
    const validAudience = draft.audiences.length > 0 && draft.audiences.length <= 10 && draft.audiences.every(item => availableKinds.includes(item.kind) && (item.kind !== 'class_guardians' || references.classes.some(group => group.id === item.class_section_id)));
    if (draft.title.trim().length < 3 || draft.body.trim().length < 3) { setError('Add a title and message of at least 3 characters.'); return; }
    if (!validAudience) { setError('Select at least one current authorized audience. Remove any audience that is no longer available.'); return; }
    if (draft.response_mode === 'choice' && (choices.length < 2 || choices.length > 6 || choices.some(value => value.length > 120) || new Set(choices.map(value => value.toLowerCase())).size !== choices.length)) { setError('Add 2 to 6 distinct choices, one per line, up to 120 characters each.'); return; }
    if (draft.response_mode !== 'information' && (!draft.due_at || !Number.isFinite(Date.parse(draft.due_at)))) { setError('Choose the response deadline.'); return; }
    const content: NoticeContent = { title: draft.title.trim(), body: draft.body.trim(), response_mode: draft.response_mode, priority: draft.priority, response_options: choices, due_at: draft.response_mode === 'information' ? null : draft.due_at, audiences: draft.audiences };
    void command.run({ path: id ? `/api/v1/notices/${encodeURIComponent(id)}` : '/api/v1/notices', method: id ? 'PATCH' : 'POST', kind: id ? 'save' : 'create', body: { ...content, ...(id ? { expected_revision: revision } : { school_id: schoolId }), idempotency_key: Crypto.randomUUID() } }).then(saved => { if (saved) complete(detailHref(context, saved.id, href)); });
  }
  return <Page title={id ? 'Edit update' : 'New update'} subtitle="Save a draft, then review the saved version before publishing">
    <ScreenBack title={id ? 'Back to update' : 'Back to updates'} disabled={command.busy} fallbackHref={id ? detailHref(context, id, href) : listHref(context, paramsOf(href))} />
    <NoticeCommandStatus command={command} onRecovered={saved => complete(detailHref(context, saved.id, href))} />
    {changed && initial ? <><Notice tone="warning" message="This saved draft changed while you were editing. Load its latest version before saving again." /><Button title="Load latest saved draft" kind="secondary" disabled={command.blocked} onPress={() => Alert.alert('Load latest saved draft?', 'This replaces the unsaved text in this form with the current saved version.', [{ text: 'Keep my text', style: 'cancel' }, { text: 'Load saved version', onPress: () => { setDraft({ title: initial.title, body: initial.body, response_mode: initial.response_mode, response_options: initial.response_options, due_at: initial.due_at, priority: initial.priority, audiences: initial.audiences }); setOptionsText(initial.response_options.join('\n')); setRevision(initial.revision); } }])} /></> : null}
    {error ? <Notice tone="danger" message={error} /> : null}
    <Section title="Message"><Field label="Title" value={draft.title} onChangeText={title => update({ title })} editable={!command.blocked} maxLength={180} autoCapitalize="sentences" /><Field label="Message" value={draft.body} onChangeText={body => update({ body })} editable={!command.blocked} multiline maxLength={4000} autoCapitalize="sentences" /></Section>
    <Section title="Response"><ChoiceMenu label="Response kind" value={draft.response_mode} options={[{ value: 'information', label: 'Information only' }, { value: 'acknowledgement', label: 'Acknowledge' }, { value: 'choice', label: 'Choose an option' }]} disabled={command.blocked} onChange={value => update({ response_mode: value as NoticeContent['response_mode'] })} />
      {draft.response_mode === 'choice' ? <Field label="Choices · one per line" value={optionsText} onChangeText={setOptionsText} editable={!command.blocked} multiline maxLength={730} placeholder={'Yes\nNo'} /> : null}
      {draft.response_mode !== 'information' ? <DeadlineField value={draft.due_at ?? ''} disabled={command.blocked} onChange={due_at => update({ due_at })} /> : null}
    </Section>
    <Section title="Priority"><SegmentedControl label="Update priority" value={draft.priority} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} disabled={command.blocked} onChange={value => update({ priority: value as NoticeContent['priority'] })} /></Section>
    <Section title={`Audience · ${draft.audiences.length} selected`}>
      <Notice message="Only the audiences returned for your current responsibility are available. Up to 10 may be included." />
      {draft.audiences.map(audience => <Button key={audienceKey(audience)} title={`Remove · ${audience.kind === 'class_guardians' ? references.classes.find(item => item.id === audience.class_section_id)?.name || 'Class no longer available' : audienceNames[audience.kind]}`} kind="secondary" disabled={command.blocked} onPress={() => toggle(audience)} />)}
      {availableKinds.filter(kind => kind !== 'class_guardians').map(kind => <Button key={kind} title={`${contains({ kind }) ? 'Selected · ' : 'Include · '}${audienceNames[kind]}`} kind={contains({ kind }) ? 'primary' : 'secondary'} disabled={command.blocked || !contains({ kind }) && draft.audiences.length >= 10} onPress={() => toggle({ kind })} />)}
      {availableKinds.includes('class_guardians') ? <><SearchField label="Find a class" value={classSearch} onChangeText={value => { setClassSearch(value); setClassPage(1); }} disabled={command.blocked} placeholder="Class name" />{classes.slice((currentPage - 1) * 15, currentPage * 15).map(item => { const audience: NoticeAudience = { kind: 'class_guardians', class_section_id: item.id }, selected = contains(audience); return <Button key={item.id} title={`${selected ? 'Selected · ' : ''}${item.name} guardians`} kind={selected ? 'primary' : 'secondary'} disabled={command.blocked || !selected && draft.audiences.length >= 10} onPress={() => toggle(audience)} />; })}{!classes.length ? <Empty title="No matching classes" /> : null}{pages > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Previous classes" kind="secondary" disabled={currentPage <= 1} onPress={() => setClassPage(currentPage - 1)} /><Button title={`Classes page ${currentPage} of ${pages}`} disabled kind="secondary" onPress={() => {}} /><Button title="Next classes" kind="secondary" disabled={currentPage >= pages} onPress={() => setClassPage(currentPage + 1)} /></View> : null}</> : null}
    </Section>
    <Notice message="Saving keeps this as a draft. No campus message is sent until you explicitly publish the saved update." /><Button title="Save draft" busy={command.busy} disabled={command.blocked || changed} onPress={save} />
  </Page>;
}
function DeadlineField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null), { dark, colors } = useTheme();
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (Platform.OS === 'web') return <View style={{ gap: 8 }}><DomainText>Choose a response deadline in {zone}.</DomainText><TemporalField label="Response deadline" mode="datetime" value={value} disabled={disabled} onChange={onChange} /></View>;
  return <View style={{ gap: 8 }}><Notice message={value ? `Response deadline: ${formatDate(value)} · ${zone}` : `Choose a response deadline in ${zone}.`} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Choose deadline date" kind="secondary" disabled={disabled} onPress={() => setOpen('date')} /><Button title="Choose deadline time" kind="secondary" disabled={disabled} onPress={() => setOpen('time')} /></View>{open ? <DateTimePicker mode={open} display={Platform.OS === 'ios' ? 'spinner' : 'default'} value={date} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.action} accessibilityLabel={`Response deadline ${open}`} onChange={(_event, selected) => { setOpen(null); if (selected) onChange(selected.toISOString()); }} /> : null}</View>;
}
