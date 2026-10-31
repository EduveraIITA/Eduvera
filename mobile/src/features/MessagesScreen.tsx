import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { Alert } from '../ui/Alert';
import { PaperclipIcon } from 'phosphor-react-native/src/icons/Paperclip';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { pickPrivateFile, readPrivateFile, removePrivateFile } from '../lib/private-file';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import type { ChatConversation as Conversation, ChatMessage as Message, ChatMessagePage as MessagePage, ChatPolicy } from '../../../packages/contracts/src/wire/features/chat/api';
import { nativeChatCanEdit, nativeChatCanReport, nativeChatMessageCommand, nativeChatMessageActionReadPath, nativeChatRetainedKind, nativeChatModerationCommand, nativeChatModerationReadPath, nativeChatReportMatches, nativeChatReportFingerprint, nativeChatReviewers, type NativeChatReport, type NativeChatReviewer, type NativeChatReportStatus, type NativeChatModerationAction } from '../lib/message-actions';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext, downloadCampusFile, getApiOrigin } from '../lib/api';
import { useNativePendingAction, type NativePendingFile, type NativePendingAction } from '../lib/native-pending-action';
import { CHAT_MESSAGE_MAX_CHARACTERS, chatGroupLabels, nativeChatAttachmentPath, nativeChatConversationMatches, nativeChatCreatedHref, nativeChatCreatedReadPath, nativeChatFileType, nativeChatGroupKinds, nativeChatRecipients, nativeDirectConversation, nativeGroupConversation, type ChatGroupType, type ChatRecipient } from '../lib/message-composer';
import { useApi } from '../lib/query';
import { conversationIdFromHref, conversationListHref } from '../lib/route-state';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, InfoDisclosure } from '../ui/DomainControls';
import { DomainText } from './ResourcesScreen';
import { BrandLoadingIcon } from '../ui/AssistantMark';
import { useTheme } from '../ui/theme';

type Props = { href: string; onNavigate: (href: string) => void };
type DirectoryPage = { results: Conversation[]; has_more: boolean; next_cursor: string | null };
const queryOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
function hrefWith(href: string, values: Record<string, string>) { const query = queryOf(href); for (const [key, value] of Object.entries(values)) { if (value) query.set(key, value); else query.delete(key); } return `${href.split('?')[0]}${query.size ? `?${query}` : ''}`; }
function withQuery(path: string, query: Record<string, string>) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => !!value)); return `${path}${params.size ? `?${params}` : ''}`; }
const errorText = (error: unknown) => error instanceof Error ? error.message : 'This action could not be confirmed.';
const fileDescription = (file: { name: string; size: number }) => `${file.name} · ${Math.max(1, Math.ceil(file.size / 1024))} KB`;
function deletePickedFile(file: NativePendingFile | null) { if (file) void removePrivateFile(file.uri).catch(() => {}); }

function useMessageWrite(href: string, refreshPath: string, refresh: (() => Promise<unknown>) | null, completion?: { resolveRefreshPath(value: unknown, action: NativePendingAction): string; accepted(value: unknown, action: NativePendingAction): void }) {
  const { user, schoolId, environment, scopeKey } = useSession(), queryClient = useQueryClient();
  return useNativePendingAction({captureOperation: useOperationContext(JSON.stringify([href, refreshPath])),  scope: { actorId: user!.id, schoolId: schoolId!, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'messages', ownerHref: href, refreshPath, resolveRefreshPath: completion?.resolveRefreshPath,
    accepted: async (latest, assertActive, action) => { assertActive(); completion?.accepted(latest, action); await queryClient.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && query.queryKey[2].startsWith('/api/v1/chat/'), refetchType: 'none' }); assertActive(); if (refresh) await refresh(); assertActive(); } });
}
function RetainedMessageAction({ write, onNavigate, onRecovered, onInspected }: { write: ReturnType<typeof useMessageWrite>; onNavigate: Props['onNavigate']; onRecovered?: () => void; onInspected?: () => void }) {
  const recover = async () => { try { const transport = captureApiContext(); const saved = await write.recover(); transport.assertCurrent(); if (saved) onRecovered?.(); else if (write.action?.replayPolicy === 'inspect_only') onInspected?.(); } catch { /* The owning journal retains recovery errors; stale UI must not navigate. */ } };
  return <>{!write.ready ? <Loading /> : null}{write.error ? <Notice tone={write.action?.phase === 'accepted' ? 'success' : 'warning'} message={write.error} /> : null}{write.resumeHref ? <Button title="Return to retained message action" kind="secondary" onPress={() => onNavigate(write.resumeHref!)} /> : write.action ? <><Notice tone="warning" message={write.action.phase === 'accepted' ? 'This action was saved. Recovery refreshes its saved record without sending it again.' : write.action.replayPolicy === 'inspect_only' ? 'The result is still unknown. Inspect the saved record and ask campus support to resolve it before repeating this action.' : 'Sending was not confirmed. Retry uses the original message, attachment bytes and identifier.'} /><Button title={write.action.phase === 'accepted' ? 'Refresh saved conversation' : write.action.replayPolicy === 'inspect_only' ? 'Inspect saved record' : 'Retry identical message'} busy={write.busy} onPress={() => void recover()} /></> : null}</>;
}
async function chooseChatFile() {
  const transport = captureApiContext();
  const selected = await pickPrivateFile(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if (!selected) { transport.assertCurrent(); return null; }
  try {
    transport.assertCurrent();
    const file = await readPrivateFile(selected.uri), size = file.size, type = nativeChatFileType(selected.name, size, selected.type);
    if (!type) throw new Error('Choose JPEG, PNG, WebP, PDF, DOC or DOCX up to 10 MiB. Your campus may set a lower limit.');
    const bytes = file.bytes; transport.assertCurrent();
    if (bytes.byteLength !== size) throw new Error('The selected attachment changed while it was being read. Choose it again.');
    const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), value => value.toString(16).padStart(2, '0')).join(''); transport.assertCurrent();
    return { uri: file.uri, name: selected.name, type, size, hash } satisfies NativePendingFile;
  } catch (cause) { await removePrivateFile(selected.uri).catch(() => {}); throw cause; }
}

export function MessagesScreen(props: Props) {
  const { schoolId, scopeKey } = useSession();
  if (!schoolId) return <Page title="Messages"><Empty title="Choose a campus" message="Conversations follow your active campus and authorized relationships." /></Page>;
  const threadId = conversationIdFromHref(props.href);
  return threadId ? <Thread key={`${scopeKey}:${threadId}:${queryOf(props.href).get('student_id') ?? ''}`} {...props} id={threadId} /> : <ConversationDirectory key={`${scopeKey}:${props.href}`} {...props} />;
}
function ConversationDirectory({ href, onNavigate }: Props) {
  const { complete } = useCampusNavigation(href);
  const { schoolId } = useSession(), query = queryOf(href), cursor = query.get('cursor') ?? '', studentId = query.get('student_id') ?? '';
  const compose = query.get('compose');
  const access = useApi<{ permissions: string[] }>(`/api/v1/schools/${encodeURIComponent(schoolId!)}/roles/effective/`);
  const canCreateGroups = !access.isError && access.data?.permissions.includes('groups.create') === true, canStartMessage = !access.isError && access.data?.permissions.includes('messages.send') === true;
  const [search, setSearch] = useState(query.get('q') ?? query.get('search') ?? '');
  const [contactSearch, setContactSearch] = useState(''), [selectedIds, setSelectedIds] = useState<string[]>([]), [title, setTitle] = useState(''), [groupType, setGroupType] = useState<ChatGroupType>('student_group'), [localError, setLocalError] = useState('');
  const path = withQuery('/api/v1/chat/conversations/', { pagination: 'cursor', q: query.get('q') ?? query.get('search') ?? '', cursor, student_id: studentId });
  const list = useApi<DirectoryPage>(path, { refetchInterval: 10_000 }), policy = useApi<ChatPolicy>('/api/v1/chat/policy/');
  const recipients = useApi<{ results: ChatRecipient[] }>(compose === 'direct' || compose === 'group' && canCreateGroups ? withQuery('/api/v1/chat/recipients/', { purpose: compose, student_id: studentId }) : null);
  const validList = list.data && list.data.results.every(conversation => nativeChatConversationMatches(conversation, schoolId!, studentId));
  const createdHref = useRef('');
  const write = useMessageWrite(href, path, null, { resolveRefreshPath: nativeChatCreatedReadPath, accepted: (latest, action) => { createdHref.current = nativeChatCreatedHref(href, latest, action); } }), policyReady = !policy.isError && policy.data?.school_id === schoolId;
  const openCreatedConversation = () => { if (createdHref.current) complete(createdHref.current); };
  const eligible = nativeChatRecipients(recipients.isError ? [] : recipients.data?.results ?? [], schoolId!, compose === 'group' ? groupType : undefined);
  const filtered = eligible.filter(recipient => `${recipient.name} ${recipient.detail}`.toLocaleLowerCase().includes(contactSearch.trim().toLocaleLowerCase()));
  const openConversation = async (recipientId: string) => {
    if (write.locked || !canStartMessage || recipients.isError || !recipients.data || !policyReady) return;
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setLocalError('');
    try { createdHref.current = ''; const body = nativeDirectConversation(schoolId!, recipientId, studentId, recipients.data.results); const saved = await write.run({ endpoint: '/api/v1/chat/conversations/', body, replayPolicy: 'inspect_only' }); transport.assertCurrent(); if (saved) openCreatedConversation(); } catch (cause) { try { transport.assertCurrent(); setLocalError(errorText(cause)); } catch {} }
  };
  const createGroup = async () => {
    if (write.locked || !canCreateGroups || recipients.isError || !recipients.data || !policyReady) return;
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setLocalError('');
    try { createdHref.current = ''; const body = nativeGroupConversation({ schoolId: schoolId!, title, groupType, memberIds: selectedIds, studentId, canManage: policy.data?.can_manage === true }, recipients.data.results); const saved = await write.run({ endpoint: '/api/v1/chat/groups/', body, replayPolicy: 'inspect_only' }); transport.assertCurrent(); if (saved) openCreatedConversation(); } catch (cause) { try { transport.assertCurrent(); setLocalError(errorText(cause)); } catch {} }
  };
  return <Page title={compose === 'direct' ? 'New message' : compose === 'group' ? 'Create group' : 'Messages'} subtitle={studentId ? 'Conversations for the selected learner' : 'Campus conversations'} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
    <RetainedMessageAction write={write} onNavigate={onNavigate} onRecovered={openCreatedConversation} onInspected={() => void list.refetch()} />
    {localError ? <Notice tone="danger" message={localError} /> : null}
    {compose ? <>
      <ScreenBack title="Back to conversations" fallbackHref={hrefWith(href, { compose: '' })} />
      {access.isPending ? <Loading /> : compose !== 'direct' && compose !== 'group' || compose === 'group' && !canCreateGroups || compose === 'direct' && !canStartMessage ? <Empty title="This conversation action is unavailable" message="Open a current action from your Messages workspace." /> : <>
        <InfoDisclosure title="Who you can contact"><DomainText>Only currently approved campus contacts are shown. The service rechecks communication rules and relationships when you create the conversation.</DomainText></InfoDisclosure>
        {policy.isPending ? <Loading /> : !policyReady ? <Empty title="Communication policy could not be confirmed" message={policy.error?.message} onRetry={() => void policy.refetch()} /> : null}
        {compose === 'group' ? <><Field label="Group name" value={title} onChangeText={setTitle} maxLength={180} editable={!write.locked} /><ChoiceMenu label="Group type" value={groupType} options={nativeChatGroupKinds(policy.data?.can_manage === true, studentId).map(kind => ({ value: kind, label: chatGroupLabels[kind] }))} disabled={write.locked} onChange={value => { setGroupType(value as ChatGroupType); setSelectedIds([]); }} />{groupType === 'parent_group' || groupType === 'announcement' ? <Notice message="Only moderators can post in this group." /> : null}</> : null}
        <SearchField label="Find an approved contact" value={contactSearch} onChangeText={value => setContactSearch(value.slice(0, 120))} placeholder="Name or contact detail" disabled={write.locked} />
        {recipients.isPending ? <Loading /> : recipients.isError ? <Empty title="Approved contacts could not load" message={recipients.error.message} onRetry={() => void recipients.refetch()} /> : <Section title={compose === 'group' ? `Choose members · ${selectedIds.length} selected` : 'Approved contacts'}>{filtered.length ? filtered.map(recipient => <Row key={recipient.id} title={recipient.name} detail={recipient.detail} status={compose === 'group' && selectedIds.includes(recipient.id) ? 'Selected' : undefined} onPress={!write.locked && policyReady ? () => { if (compose === 'direct') void openConversation(recipient.id); else setSelectedIds(ids => ids.includes(recipient.id) ? ids.filter(id => id !== recipient.id) : ids.length < 200 ? [...ids, recipient.id] : ids); } : undefined} />) : <Empty title="No matching approved contacts" message="Try another name. Campus staff manage communication access." />}</Section>}
        {compose === 'group' ? <Button title="Create group" busy={write.busy} disabled={write.locked || !policyReady || recipients.isError || title.trim().length < 3 || !selectedIds.length} onPress={() => void createGroup()} /> : null}
      </>}
    </> : <>
      {access.isError ? <Notice tone="warning" message="Conversation creation access could not be confirmed. Existing conversations remain available." /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="New message" kind="primary" disabled={write.locked || !canStartMessage} onPress={() => onNavigate(hrefWith(href, { compose: 'direct' }))} />{canCreateGroups ? <ControlButton title="Create group" disabled={write.locked} onPress={() => onNavigate(hrefWith(href, { compose: 'group' }))} /> : null}</View>
      {!access.isError && access.data?.permissions.includes('safeguarding.review') ? <ControlButton title="Review reported messages" onPress={() => onNavigate('/areas/care/concerns?section=message_reports')} /> : null}
      <SearchField label="Find a conversation" value={search} onChangeText={value => setSearch(value.slice(0, 120))} placeholder="Name or group" onSubmit={() => onNavigate(hrefWith(href, { q: search.trim(), cursor: '' }))} onClear={() => { setSearch(''); onNavigate(hrefWith(href, { q: '', search: '', cursor: '' })); }} />
      {list.isPending ? <Loading /> : list.isError || list.data && !validList ? <Empty title="Messages could not load" message={list.error?.message ?? 'The returned conversations did not match this campus and learner.'} onRetry={() => void list.refetch()} /> : !list.data?.results.length ? <Empty title={search ? 'No matching conversations' : 'No conversations yet'} message={search ? 'Try another name or clear the search.' : 'Start a message with an approved campus contact.'} /> : <Section title="Conversations"><ListGroup><View style={{ paddingHorizontal: 16 }}>{list.data.results.map((conversation, index) => <Row key={conversation.id} variant="plain" separator={index > 0} icon="messages" title={conversation.title} detail={`${conversation.last_message || 'No messages yet'}${conversation.student_name ? `\nAbout ${conversation.student_name}` : ''}`} status={conversation.unread_count > 0 ? `${conversation.unread_count} unread` : conversation.kind === 'announcement' ? 'Announcement' : undefined} onPress={() => onNavigate(hrefWith(href, { conversation: conversation.id, compose: '' }))} />)}</View></ListGroup></Section>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{cursor ? <Button title="Latest conversations" kind="secondary" onPress={() => onNavigate(hrefWith(href, { cursor: '' }))} /> : null}{validList && !list.isError && list.data?.has_more && list.data.next_cursor ? <Button title="More conversations" kind="secondary" onPress={() => onNavigate(hrefWith(href, { cursor: list.data!.next_cursor! }))} /> : null}</View>
    </>}
  </Page>;
}

function Thread({ href, onNavigate, id }: Props & { id: string }) {
  const { colors } = useTheme(), { schoolId, environment } = useSession(), query = queryOf(href), studentId = query.get('student_id') ?? '';
  const [cursorStack, setCursorStack] = useState<string[]>([]), cursor = cursorStack.at(-1) ?? '';
  const conversation = useApi<Conversation>(withQuery(`/api/v1/chat/conversations/${encodeURIComponent(id)}/`, { student_id: studentId }), { refetchInterval: 10_000 });
  const messagePath = withQuery(`/api/v1/chat/conversations/${encodeURIComponent(id)}/messages/`, { cursor });
  const messages = useApi<MessagePage>(messagePath, { refetchInterval: cursor ? 60_000 : 4_000 }), policy = useApi<ChatPolicy>('/api/v1/chat/policy/');
  const [actionKind, setActionKind] = useState<'edit' | 'report' | null>(null), [actionTarget, setActionTarget] = useState<Message | null>(null), [actionText, setActionText] = useState(''), [resultNotice, setResultNotice] = useState('');
  const access = useApi<{ permissions: string[] }>(`/api/v1/schools/${encodeURIComponent(schoolId!)}/roles/effective/`);
  const canSend = !access.isError && access.data?.permissions.includes('messages.send') === true;
  const [draft, setDraft] = useState(''), [file, setFile] = useState<NativePendingFile | null>(null), [picking, setPicking] = useState(false), [opening, setOpening] = useState('');
  const [error, setError] = useState(''), [readError, setReadError] = useState(''), [active, setActive] = useState(AppState.currentState === 'active');
  const lastRead = useRef(''), alive = useRef(true);
  useEffect(() => () => deletePickedFile(file), [file]);
  useEffect(() => { alive.current = true; const subscription = AppState.addEventListener('change', value => setActive(value === 'active')); return () => { alive.current = false; subscription.remove(); }; }, []);
  const invalidConversation = conversation.data && !nativeChatConversationMatches(conversation.data, schoolId!, studentId, id);
  const invalidMessages = messages.data?.results.some(message => message.conversation_id !== id);
  const denied = conversation.isError || messages.isError || !!invalidConversation || !!invalidMessages;
  const newest = messages.data?.results.at(-1)?.id ?? '', canRead = !denied && !!conversation.data && !!messages.data;
  const refresh = async () => { const [nextMessages, nextConversation] = await Promise.all([messages.refetch({ throwOnError: true }), conversation.refetch({ throwOnError: true })]); if (!nextMessages.data || !nextConversation.data || nextMessages.data.results.some(message => message.conversation_id !== id) || !nativeChatConversationMatches(nextConversation.data, schoolId!, studentId, id)) throw new Error('The saved conversation did not match this campus and learner.'); return nextMessages.data; };
  const write = useMessageWrite(href, messagePath, refresh, { resolveRefreshPath: (result, action) => ['edit', 'report'].includes(nativeChatRetainedKind(action)) ? nativeChatMessageActionReadPath(result, action) : action.refreshPath, accepted: () => {} });
  useScreenExitGuard({ dirty: !write.action && (!!draft.trim() || !!file || !!actionKind && (actionKind === 'edit' ? actionText !== actionTarget?.body : !!actionText.trim())), blocked: write.busy || picking, title: 'Leave unsent work?', message: 'Your unsent message or report will be lost. Submitted actions remain recoverable.' });
  const actionNow = () => new Date(environment.virtual_clock?.now ?? Date.now()).getTime();
  const finishMessageAction = (kind: string) => { setActionKind(null); setActionTarget(null); setActionText(''); setResultNotice(kind === 'edit' ? 'Your message was updated.' : 'Your report was received by the campus review service.'); };
  const submitMessageAction = async () => {
    if (!actionKind || !actionTarget || write.locked || denied || actionKind === 'edit' && (!canSend || !conversation.data?.can_post)) return;
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; }
    setError(''); setResultNotice('');
    try { const current = messages.data?.results.find(message => message.id === actionTarget.id); if (!current || current.body !== actionTarget.body || current.updated_at !== actionTarget.updated_at || current.is_deleted !== actionTarget.is_deleted) throw new Error('This message changed while the form was open. Close the form and review the current message before acting.'); const input = nativeChatMessageCommand(actionKind, current, id, actionText, actionNow()); const saved = await write.run(input); transport.assertCurrent(); if (saved && alive.current) finishMessageAction(actionKind); } catch (cause) { try { transport.assertCurrent(); if (alive.current) setError(errorText(cause)); } catch {} }
  };
  const clearComposer = () => { setDraft(''); deletePickedFile(file); setFile(null); setCursorStack([]); };
  const markRead = useCallback(async (visible?: { signal: AbortSignal; newest: string }) => {
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; }
    try { await apiFetch(`/api/v1/chat/conversations/${encodeURIComponent(id)}/read/`, { method: 'POST', ...(visible ? { signal: visible.signal } : {}) }); transport.assertCurrent(); if (alive.current && !visible?.signal.aborted) { if (visible) lastRead.current = visible.newest; setReadError(''); } }
    catch (cause) { try { transport.assertCurrent(); if (alive.current && !visible?.signal.aborted) setReadError(errorText(cause)); } catch {} }
  }, [id]);
  useFocusEffect(useCallback(() => {
    if (!active || !canRead || cursor || !newest || newest === lastRead.current) return;
    const controller = new AbortController(); void markRead({ signal: controller.signal, newest }); return () => controller.abort();
  }, [active, canRead, cursor, newest, markRead]));
  const policyReady = !policy.isError && policy.data?.school_id === schoolId;
  const send = async () => {
    if (write.locked || picking || !canSend || !conversation.data?.can_post || denied || file && (!policyReady || !policy.data?.attachments_enabled)) return;
    const body = draft.trim(); if ((!body && !file) || body.length > CHAT_MESSAGE_MAX_CHARACTERS) return;
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setError('');
    try { const saved = await write.run(file ? { endpoint: `/api/v1/chat/conversations/${encodeURIComponent(id)}/messages/`, multipart: { fields: { body }, file } } : { endpoint: `/api/v1/chat/conversations/${encodeURIComponent(id)}/messages/`, body: { body }, serverKey: 'client_id' }); transport.assertCurrent(); if (saved && alive.current) clearComposer(); } catch (cause) { try { transport.assertCurrent(); if (alive.current) setError(errorText(cause)); } catch {} }
  };
  const pick = async () => { if (write.locked || picking || !policyReady || !policy.data?.attachments_enabled) return; let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setPicking(true); setError(''); try { const selected = await chooseChatFile(); transport.assertCurrent(); if (alive.current && selected) { deletePickedFile(file); setFile(selected); } else if (selected) deletePickedFile(selected); } catch (cause) { try { transport.assertCurrent(); if (alive.current) setError(errorText(cause)); } catch {} } finally { try { transport.assertCurrent(); if (alive.current) setPicking(false); } catch {} } };
  const openAttachment = async (message: Message) => { if (opening || !message.attachment || denied) return; let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setError(''); setOpening(message.id); try { await downloadCampusFile(nativeChatAttachmentPath(id, message), message.attachment.original_name); transport.assertCurrent(); } catch (cause) { try { transport.assertCurrent(); if (alive.current) setError(errorText(cause)); } catch {} } finally { try { transport.assertCurrent(); if (alive.current) setOpening(''); } catch {} } };
  const composer = denied || conversation.isPending || messages.isPending ? null : conversation.data?.can_post && canSend ? !write.action && !actionKind ? <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 24, padding: 8, gap: 8 }}>
    {file ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text numberOfLines={2} style={{ flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 }}>{fileDescription(file)}</Text><ControlButton title="Remove attachment" disabled={write.locked || picking} onPress={() => { deletePickedFile(file); setFile(null); }} /></View> : null}
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      {policyReady && policy.data?.attachments_enabled ? <Pressable accessibilityRole="button" accessibilityLabel={file ? 'Choose another attachment' : 'Attach a file'} accessibilityState={{ disabled: write.locked || picking, busy: picking }} disabled={write.locked || picking} onPress={() => void pick()} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', opacity: write.locked || picking ? .45 : pressed ? .65 : 1 })}>{picking ? <BrandLoadingIcon size={20} /> : <PaperclipIcon size={22} color={colors.link} />}</Pressable> : null}
      <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} placeholder="Write a message" placeholderTextColor={colors.muted} multiline submitBehavior="newline" maxLength={CHAT_MESSAGE_MAX_CHARACTERS} editable={!write.locked && !picking} style={{ flex: 1, minWidth: 0, color: colors.ink, fontSize: 16, lineHeight: 23, minHeight: 44, maxHeight: 132, paddingHorizontal: 4, paddingVertical: 10, textAlignVertical: 'top' }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: write.locked || picking || !draft.trim() && !file || !!file && (!policyReady || !policy.data?.attachments_enabled), busy: write.busy }} disabled={write.locked || picking || !draft.trim() && !file || !!file && (!policyReady || !policy.data?.attachments_enabled)} onPress={() => void send()} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.action, justifyContent: 'center', alignItems: 'center', opacity: write.locked || picking || !draft.trim() && !file || !!file && (!policyReady || !policy.data?.attachments_enabled) ? .45 : pressed ? .65 : 1 })}>{write.busy ? <BrandLoadingIcon size={20} onFilledAction /> : <ArrowUpIcon size={22} color={colors.onAction} weight="bold" />}</Pressable>
    </View>
  </View> : null : <Notice message={conversation.data?.posting_restriction || (conversation.data?.posting_mode === 'moderators' ? 'Only moderators can post in this conversation.' : 'You currently have read access to this conversation.')} />;
  return <Page footer={composer} title={!invalidConversation ? conversation.data?.title ?? 'Conversation' : 'Conversation'} subtitle={!invalidConversation && conversation.data?.student_name ? `About ${conversation.data.student_name}` : !invalidConversation && conversation.data?.kind === 'group' ? `${conversation.data.member_count} members` : undefined} refreshing={messages.isRefetching || conversation.isRefetching} onRefresh={() => { void messages.refetch(); void conversation.refetch(); }}>
    <ScreenBack title="Back to messages" fallbackHref={conversationListHref(href)} />
    <RetainedMessageAction write={write} onNavigate={onNavigate} onRecovered={() => { const kind = nativeChatRetainedKind(write.action); if (kind === 'edit' || kind === 'report') finishMessageAction(kind); else clearComposer(); }} onInspected={() => { void messages.refetch(); void conversation.refetch(); }} />
    {error ? <Notice tone="danger" message={error} /> : null}{resultNotice ? <Notice tone="success" message={resultNotice} /> : null}
    {denied ? <Empty title="Conversation unavailable" message={conversation.error?.message ?? messages.error?.message ?? 'The returned conversation did not match this campus, learner or thread.'} onRetry={() => { void conversation.refetch(); void messages.refetch(); }} /> : conversation.isPending || messages.isPending ? <Loading /> : <>
      {conversation.data?.can_post && canSend ? <><InfoDisclosure title="Message options">{policyReady && policy.data?.attachments_enabled ? <DomainText>JPEG, PNG, WebP, PDF, DOC or DOCX · Up to 10 MiB. Campus rules may set a lower limit. Files stay private to authorized conversation participants.</DomainText> : policy.isError ? <Notice message="Attachment policy could not be confirmed. Text messages are still checked by the service." tone="warning" /> : policyReady ? <DomainText>Attachments are disabled by your campus communication policy.</DomainText> : null}{policyReady && policy.data?.enforce_communication_hours ? <DomainText>Campus communication hours: {policy.data.communication_start}–{policy.data.communication_end} ({policy.data.timezone}). The service checks the current window.</DomainText> : null}</InfoDisclosure></> : null}
      {readError ? <><Notice tone="warning" message={`Read status was not confirmed: ${readError}`} /><ControlButton title="Retry read status" onPress={() => void markRead()} /></> : null}
      {messages.data?.has_more && messages.data.next_cursor ? <ControlButton title="Earlier messages" onPress={() => setCursorStack(stack => [...stack, messages.data!.next_cursor!])} /> : null}
      {cursor ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ControlButton title="Newer messages" onPress={() => setCursorStack(stack => stack.slice(0, -1))} /><ControlButton title="Latest messages" onPress={() => setCursorStack([])} /></View> : null}
      <Section title={cursor ? 'Earlier messages' : 'Messages'}>{messages.data?.results.length ? messages.data.results.map(message => <View key={message.id} style={{ alignSelf: message.is_mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: message.is_mine ? colors.positiveSoft : colors.row, borderRadius: 20, padding: 12, gap: 6 }}><Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>{message.is_mine ? 'You' : message.sender_name}</Text><Text selectable style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{message.is_deleted ? 'This message was deleted.' : message.body || (message.attachment ? 'Attachment' : '')}</Text>{!message.is_deleted && message.attachment ? <><Text style={{ color: colors.muted, fontSize: 14 }}>{fileDescription({ name: message.attachment.original_name, size: message.attachment.size_bytes })}</Text><ControlButton title="Open attachment" busy={opening === message.id} disabled={!!opening} onPress={() => void openAttachment(message)} /></> : null}<Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(message.created_at).toLocaleString()}{message.updated_at !== message.created_at ? ' · Edited' : ''}</Text>{!write.locked ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{canSend && conversation.data?.can_post && nativeChatCanEdit(message, actionNow()) ? <ControlButton title="Edit message" onPress={() => { setActionKind('edit'); setActionTarget(message); setActionText(message.body); setError(''); setResultNotice(''); }} /> : null}{nativeChatCanReport(message) ? <ControlButton title="Report privately" onPress={() => { setActionKind('report'); setActionTarget(message); setActionText(''); setError(''); setResultNotice(''); }} /> : message.is_reported_by_me ? <Text style={{ color: colors.muted, fontSize: 14 }}>Reported · {message.report_status?.replaceAll('_', ' ') ?? 'Received'}</Text> : null}</View> : null}</View>) : <Empty title="No messages yet" message="Start the conversation when you are ready." />}</Section>
      {actionKind && actionTarget ? <Section title={actionKind === 'edit' ? 'Edit your message' : 'Report a message privately'}><Row title={actionTarget.sender_name} detail={actionTarget.body || 'Attachment'} />{actionKind === 'report' ? <Notice message="Your reason is shared privately with authorized campus reviewers. They review the source and decide what to do." /> : <Notice message="The campus checks the original edit deadline and current posting access when you save." />}<Field label={actionKind === 'edit' ? 'Updated message' : 'Why are you reporting this message?'} value={actionText} onChangeText={setActionText} multiline maxLength={actionKind === 'edit' ? 4000 : 500} editable={!write.locked} /><Button title={actionKind === 'edit' ? 'Save message' : 'Submit private report'} busy={write.busy} disabled={write.locked || actionText.trim().length < (actionKind === 'edit' ? 1 : 3)} onPress={() => void submitMessageAction()} /><Button title="Close form" kind="secondary" disabled={write.busy} onPress={() => { setActionKind(null); setActionTarget(null); setActionText(''); setError(''); }} /></Section> : null}

    </>}
  </Page>;
}

/** Message moderation stays within the canonical protected-care route. */
export function MessageReportsScreen(props: Props) {
  const { user, schoolId, scopeKey, environment } = useSession(), q = queryOf(props.href);
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  let allowed = false;
  try { if (manifest.data && user && schoolId) { const value = assertWorkspaceManifestContext(normalizeWorkspaceManifest(manifest.data), { actorUserId: user.id, institutionId: schoolId, environment }); const surface = value.areas.find(area => area.key === 'care')?.surfaces.find(surface => surface.key === 'concerns'); allowed = surface?.capabilities.some(capability => capability === 'safeguarding.review' || capability === 'safeguarding.manage') === true; } } catch { /* Unverified private scope remains closed. */ }
  if (manifest.isPending) return <Page title="Message reports"><Loading /></Page>;
  if (!schoolId || manifest.isError || !allowed) return <Page title="Message reports"><Empty title="Private review access could not be confirmed" message={manifest.error?.message} onRetry={() => void manifest.refetch()} /></Page>;
  const reportId = q.get('report');
  if (props.href.split('?')[0] !== '/areas/care/concerns' || q.get('section') !== 'message_reports' || q.getAll('section').length !== 1 || q.getAll('report').length > 1 || q.has('report') && (!reportId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reportId))) return <Page title="Message reports"><Empty title="This report link is incomplete" message="Open a current report from your private review workspace or notification." /><Button title="Open message reports" kind="secondary" onPress={() => props.onNavigate('/areas/care/concerns?section=message_reports')} /></Page>;
  return reportId ? <MessageReportDetail key={`${scopeKey}:${reportId}`} {...props} reportId={reportId} /> : <MessageReportQueue key={`${scopeKey}:${props.href}`} {...props} />;
}
function MessageReportQueue({ href, onNavigate }: Props) {
  const q = queryOf(href), status = q.get('report_status') ?? '', page = Math.max(1, Number.parseInt(q.get('page') ?? '1', 10) || 1);
  const validStatus = ['', 'open', 'under_review', 'resolved', 'dismissed'].includes(status);
  const path = withQuery('/api/v1/chat/reports/', { status: validStatus ? status : '' });
  const query = useApi<{ results: NativeChatReport[]; summary: Record<NativeChatReportStatus, number> }>(validStatus ? path : null);
  const [search, setSearch] = useState(''), [filters, setFilters] = useState(false);
  const write = useMessageWrite(href, path, async () => { await query.refetch({ throwOnError: true }); });
  const valid = !query.isError && query.data?.results.every(report => nativeChatReportMatches(report, report.id));
  const reports = valid ? query.data!.results.filter(report => `${report.sender_name} ${report.reporter_name} ${report.conversation_title} ${report.reason}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  const pages = Math.max(1, Math.ceil(reports.length / 12)), currentPage = Math.min(page, pages);
  const knownTotal = query.data ? status ? query.data.summary[status as NativeChatReportStatus] : Object.values(query.data.summary).reduce((sum, count) => sum + count, 0) : 0;
  return <Page title="Message reports" subtitle="Private campus review" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <RetainedMessageAction write={write} onNavigate={onNavigate} onInspected={() => void query.refetch()} />
    <Notice message="Only reports available to your current review responsibility are shown. Reporting a concern does not establish what happened." />
    <ControlButton title={filters ? 'Close filters' : 'Filter reports'} onPress={() => setFilters(!filters)} />
    {filters ? <><ChoiceMenu label="Report status" value={status} options={['', 'open', 'under_review', 'resolved', 'dismissed'].map(value => ({ value, label: value ? value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()) : 'All reports' }))} onChange={value => onNavigate(hrefWith(href, { report_status: value, page: '' }))} /><SearchField label="Find within loaded reports" value={search} onChangeText={value => setSearch(value.slice(0, 120))} placeholder="Person, conversation or reason" /></> : null}
    {!validStatus ? <Empty title="This report filter is invalid" /> : query.isPending ? <Loading /> : !valid ? <Empty title="Reports could not load" message={query.error?.message} onRetry={() => void query.refetch()} /> : <><Section title={`${knownTotal} ${status ? status.replaceAll('_', ' ') : ''} reports`}>{reports.length ? reports.slice((currentPage - 1) * 12, currentPage * 12).map(report => <Row key={report.id} title={report.conversation_title || 'Reported conversation'} detail={`${report.sender_name} · reported by ${report.reporter_name}\n${report.reason}\n${new Date(report.created_at).toLocaleString()}`} status={report.status.replaceAll('_', ' ')} onPress={() => onNavigate(hrefWith(href, { report: report.id }))} />) : <Empty title="No matching reports" />}</Section>{knownTotal > query.data!.results.length ? <Notice tone="warning" message={`Showing the latest ${query.data!.results.length} of ${knownTotal} reports. An older report can still be opened from its exact notification or saved link.`} /> : null}{pages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Previous reports" kind="secondary" disabled={currentPage <= 1} onPress={() => onNavigate(hrefWith(href, { page: String(currentPage - 1) }))} /><Button title="More reports" kind="secondary" disabled={currentPage >= pages} onPress={() => onNavigate(hrefWith(href, { page: String(currentPage + 1) }))} /></View> : null}</>}
  </Page>;
}
function MessageReportDetail({ href, onNavigate, reportId }: Props & { reportId: string }) {
  const { user } = useSession(), path = `/api/v1/chat/reports/${encodeURIComponent(reportId)}/`, query = useApi<NativeChatReport>(path);
  const [baseline, setBaseline] = useState<NativeChatReport | null>(null), [note, setNote] = useState(''), [assignee, setAssignee] = useState(''), [days, setDays] = useState('7'), [notice, setNotice] = useState(''), [error, setError] = useState(''), [reviewerChoices, setReviewerChoices] = useState(false), [moreActions, setMoreActions] = useState(false);
  const current = !query.isError && nativeChatReportMatches(query.data, reportId) ? query.data : null;
  const currentReportRef = useRef(current); currentReportRef.current = current;
  const reviewers = useApi<{ results: NativeChatReviewer[] }>(current?.can_assign ? '/api/v1/chat/reports/reviewers/' : null);
  const write = useMessageWrite(href, path, null, { resolveRefreshPath: nativeChatModerationReadPath, accepted: (latest) => { if (!nativeChatReportMatches(latest, reportId)) throw new Error('The refreshed report did not match this exact private review.'); setBaseline(latest); setAssignee(latest.assigned_to ?? ''); setNote(''); setDays('7'); setNotice('The review service saved this action. Current saved details are shown.'); } });
  const dirty = !!note || !!baseline && assignee !== (baseline.assigned_to ?? '') || days !== '7';
  useScreenExitGuard({ dirty: dirty && !write.action, blocked: write.busy, title: 'Leave this review?', message: 'Your unsaved review note and choices will be lost.' });
  useEffect(() => { if (current && (!baseline || !dirty && !write.locked && Date.parse(current.updated_at) >= Date.parse(baseline.updated_at))) { setBaseline(current); setAssignee(current.assigned_to ?? ''); } }, [current, dirty, write.locked, baseline]);
  const changed = !!current && !!baseline && nativeChatReportFingerprint(current) !== nativeChatReportFingerprint(baseline) && Date.parse(current.updated_at) >= Date.parse(baseline.updated_at);
  const closed = baseline?.status === 'resolved' || baseline?.status === 'dismissed', conflict = !!baseline && (baseline.sender_id === user!.id || baseline.reported_by === user!.id);
  const locked = write.locked || query.isError || !current || changed || !!closed || !!baseline?.can_assign && (reviewers.isPending || reviewers.isError || !reviewers.data);
  const eligible = baseline ? nativeChatReviewers(reviewers.isError ? [] : reviewers.data?.results ?? [], baseline) : [];
  const act = async (action: NativeChatModerationAction) => {
    if (!baseline || locked || baseline.can_assign && (reviewers.isPending || reviewers.isError)) return;
    let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; } setError(''); setNotice('');
    try { const fresh = currentReportRef.current; if (!fresh || Date.parse(fresh.updated_at) >= Date.parse(baseline.updated_at) && nativeChatReportFingerprint(fresh) !== nativeChatReportFingerprint(baseline)) throw new Error('This report changed. Review the current saved version before acting.'); const input = nativeChatModerationCommand(baseline, user!.id, action, note, assignee, Number(days), eligible); const saved = await write.run(input); transport.assertCurrent(); if (saved) void query.refetch(); } catch (cause) { try { transport.assertCurrent(); setError(errorText(cause)); } catch {} }
  };
  const confirm = (action: NativeChatModerationAction, title: string, message: string) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: title, onPress: () => void act(action) }]);
  return <Page title="Message report" subtitle="Private campus review" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack title="Back to message reports" fallbackHref={hrefWith(href, { report: '', attention_notification_id: '' })} />
    <RetainedMessageAction write={write} onNavigate={onNavigate} onRecovered={() => void query.refetch()} onInspected={() => void query.refetch()} />
    {error || write.error ? <Notice tone="danger" message={error || write.error} /> : null}{notice ? <Notice tone="success" message={notice} /> : null}
    {query.isPending ? <Loading /> : !current || !baseline ? <Empty title="This report is unavailable" message={query.error?.message ?? 'It may no longer be assigned to your current review responsibility.'} onRetry={() => void query.refetch()} /> : <>
      <Row title={baseline.conversation_title || 'Reported conversation'} detail={`${baseline.sender_name} · reported by ${baseline.reporter_name}\nReported ${new Date(baseline.created_at).toLocaleString()}`} status={baseline.status.replaceAll('_', ' ')} />
      <Section title="Reported message"><Row title={baseline.sender_name} detail={baseline.message_body || 'Attachment or empty message'} /><Row title="Reason for the report" detail={baseline.reason} /></Section>
      <Section title="Preceding conversation context">{baseline.context_messages.map(message => <Row key={message.id} title={message.sender_name} detail={`${message.body || 'Attachment'}\n${new Date(message.created_at).toLocaleString()}`} status={message.is_flagged ? 'Reported message' : undefined} />)}</Section>
      {closed ? <Section title="Saved review outcome"><Row title={baseline.action_taken.replaceAll('_', ' ')} detail={`${baseline.resolution_note || 'No review note was recorded.'}${baseline.assignee_name ? `\nReviewer: ${baseline.assignee_name}` : ''}${baseline.resolved_at ? `\n${new Date(baseline.resolved_at).toLocaleString()}` : ''}`} /></Section> : <>
        {changed ? <><Notice tone="warning" message="This report changed while you were reviewing it. Your note is still here. Review the current saved version before making a decision." /><Button title="Review current saved report" kind="secondary" disabled={write.locked} onPress={() => { setBaseline(current); setAssignee(current.assigned_to ?? ''); setError(''); }} /></> : null}
        {conflict ? <Notice tone="warning" message="You are named in this report. Assign an independent reviewer before taking any decision." /> : null}
        <Section title="Reviewer">{baseline.can_assign ? <><Row title={eligible.find(reviewer => reviewer.id === (assignee || user!.id))?.name ?? baseline.assignee_name ?? 'Choose an independent reviewer'} /><Button title={reviewerChoices ? 'Close reviewer choices' : 'Choose reviewer'} kind="secondary" disabled={locked} onPress={() => setReviewerChoices(!reviewerChoices)} />{reviewers.isError ? <Empty title="Eligible reviewers could not load" message={reviewers.error.message} onRetry={() => void reviewers.refetch()} /> : reviewers.isPending ? <Loading /> : reviewerChoices ? eligible.map(reviewer => <Row key={reviewer.id} title={reviewer.name} status={reviewer.id === (assignee || user!.id) ? 'Selected reviewer' : undefined} onPress={locked ? undefined : () => { setAssignee(reviewer.id); setReviewerChoices(false); }} />) : null}<Button title="Assign and start review" kind="secondary" disabled={locked || reviewers.isError || reviewers.isPending} onPress={() => void act('assign')} /></> : <Row title={baseline.assignee_name || 'Assigned to you'} />}</Section>
        <Field label="Review note" value={note} onChangeText={setNote} multiline maxLength={1000} editable={!locked} placeholder="Record the reviewed facts and reason for your decision" />
        {!conflict ? <><Notice message="The service checks your current review authority. These actions use the saved report; an uncertain result is retained for inspection before any repeat." />{baseline.status === 'open' && !baseline.can_assign ? <Button title="Start review" kind="secondary" disabled={locked} onPress={() => void act('start')} /> : null}<Button title="Resolve with no further action" disabled={locked || note.trim().length < 3} onPress={() => void act('resolve')} /><Button title={moreActions ? 'Close other review actions' : 'Other review actions'} kind="secondary" onPress={() => setMoreActions(!moreActions)} />{moreActions ? <><Button title="Dismiss report" kind="secondary" disabled={locked || note.trim().length < 3} onPress={() => void act('dismiss')} /><Button title="Issue formal warning" kind="secondary" disabled={locked || note.trim().length < 3} onPress={() => confirm('warning', 'Issue formal warning', 'The sender will be notified of this recorded campus warning.')} /><Button title="Escalate report" kind="secondary" disabled={locked || note.trim().length < 3} onPress={() => confirm('escalate', 'Escalate report', 'This records an escalation for campus leadership review.')} /><Field label="Messaging restriction · days" value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={2} editable={!locked} /><Button title="Apply messaging restriction" kind="danger" disabled={locked || note.trim().length < 3 || !Number.isSafeInteger(Number(days)) || Number(days) < 1 || Number(days) > 30} onPress={() => confirm('restrict', 'Apply messaging restriction', `Restrict this sender's campus messaging for ${days} days and notify them of the recorded decision.`)} /></> : null}</> : null}
      </>}
    </>}
  </Page>;
}
