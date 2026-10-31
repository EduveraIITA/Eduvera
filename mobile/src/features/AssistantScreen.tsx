import { useScreenExitGuard } from '../ui/BackNavigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from '../lib/device-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentAction, AgentChartData, AgentRun, AgentThread } from '../../../packages/contracts/src/wire/features/assistant/agentApi';
import type { AssistantPortal } from '../../../packages/contracts/src/wire/features/assistant/context';
import { useSession } from '../auth/SessionProvider';
import { assistantPerspective } from '../lib/assistant-access';
import { ApiError, apiFetch, getApiOrigin } from '../lib/api';
import { isInternalHref } from '../lib/api-policy';
import { Button, Empty, Loading, Notice, PageBody, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { AssistantMark } from '../ui/AssistantMark';
import { useAssistantOperationContext, useAssistantPresentation } from '../ui/AssistantPresentation';
import { assistantDefinitiveRefusal, bindAssistantConversation, clearAssistantCommand, dispatchAssistantCommand, restoreAssistantCommand, type AssistantCommand } from '../lib/assistant-command';
import { assistantChartKind, assistantChartValue, assistantLineSegments, parseAssistantStatus, parseAssistantThread, parseAssistantThreads } from '../lib/assistant-policy';
import { ControlButton, Disclosure, Facts, InfoDisclosure } from '../ui/DomainControls';
import { Alert } from '../ui/Alert';
import { AssistantAnswer, CompactAnswer, ConversationBubble, ConversationCanvas, ConversationComposer, ConversationEmpty, ConversationHistory, ConversationSource, ConversationToolbar, ConversationTurn, ResponseCopyControl } from './assistant/AssistantConversationUI';
import { assertAssistantWriteReady, assistantChartDisplayPoints, assistantCompactPresentation, assistantLinkedThreadRequest, assistantPreferenceState, assistantRunAnswer, assistantSourceLabel, prepareAssistantConversationChange } from './assistant/conversation-presentation';
import { assistantCopySnapshot, copyAssistantResponse } from './assistant/assistant-copy';

type Props = { href: string; onNavigate: (href: string) => void };
type Pending = AssistantCommand;
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
type JournalEntry = { pending: Pending | null; busy: boolean; loading?: Promise<void>; listeners: Set<() => void> };
const journals = new Map<string, JournalEntry>();
function journalFor(key: string) { let value = journals.get(key); if (!value) { value = { pending: null, busy: false, listeners: new Set() }; journals.set(key, value); } return value; }
const notify = (entry: JournalEntry) => entry.listeners.forEach(listener => listener());

export function AssistantScreen(props: Props) {
  const { scopeKey, user, memberships, schoolId, environment } = useSession();
  const portal = assistantPerspective(user, memberships, schoolId);
  useAssistantPresentation({ available: environment.mode === 'simulation' || !portal ? false : undefined });
  if (environment.mode === 'simulation') return <AssistantFrame><PresentationExit /><AssistantMark /><Notice message="Provider-backed conversations, memory and messaging account links stay in Live. This isolated world does not call a Live AI provider or execute its proposed changes." /><Button title="Open Simulation" kind="secondary" onPress={() => props.onNavigate('/more/simulation')} /><ControlButton title="Account preferences" onPress={() => props.onNavigate('/more/account')} /></AssistantFrame>;
  if (!portal) return <AssistantFrame><PresentationExit /><AssistantMark /><Empty title="AI assistance is unavailable in this workspace" message="Your current campus relationship determines which assistance is available." /></AssistantFrame>;
  return <AssistantAccess key={`${scopeKey}:${portal}:${new URLSearchParams(props.href.split('?')[1] ?? '').get('student_id') ?? ''}`} {...props} portal={portal} />;
}
/** The campus host owns the real background, chrome, scope and safe area. This
 * feature frame supplies no route title, history boundary or duplicate banner. */
function AssistantFrame({ children, footer, canvas = false, maxWidth = 720, footerPadding = 16, footerSeparator = false }: React.PropsWithChildren<{ footer?: React.ReactNode; canvas?: boolean; maxWidth?: number; footerPadding?: number; footerSeparator?: boolean }>) {
  const { expanded, expand, close, canClose, frame } = useAssistantPresentation(), { colors } = useTheme();
  // The host frame can be a tablet side pane. A window-sized limit must not
  // escape that pane or introduce a second layout/owner for its editor.
  const availableWidth = frame.width > 0 ? Math.max(0, frame.width - footerPadding * 2) : maxWidth;
  const contentMaxWidth = Math.min(expanded ? maxWidth : 440, availableWidth);
  const preview = !canvas && !expanded ? <ConversationBubble onExpand={expand} onClose={canClose ? close : undefined} availableHeight={frame.height}>{children}</ConversationBubble> : null;
  return <View pointerEvents="box-none" style={{ flex: 1, minHeight: 0, backgroundColor: expanded ? colors.canvas : 'transparent' }}><PageBody passThrough={!expanded} footer={canvas ? footer : preview} footerPadding={footerPadding} footerSeparator={footerSeparator} maxWidth={contentMaxWidth} footerBackgroundColor={expanded ? colors.canvas : 'transparent'}>
    {canvas ? <View pointerEvents={expanded ? 'auto' : 'box-none'} style={{ flex: 1, minHeight: 0 }}>{children}</View> : expanded ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1 }}>{children}</ScrollView> : <View pointerEvents="none" style={{ flex: 1 }} />}
  </PageBody></View>;
}
function PresentationExit() {
  const presentation = useAssistantPresentation();
  return presentation.expanded ? <ControlButton title="Collapse Assistant" onPress={presentation.collapse} /> : null;
}
function AssistantAccess(props: Props & { portal: AssistantPortal }) {
  const { scopeKey, status } = useSession(), presentation = useAssistantPresentation();
  const preference = useQuery({ queryKey: ['campus', scopeKey, '/api/v1/auth/pro-features/'], queryFn: ({ signal }) => apiFetch<{ enabled: boolean }>('/api/v1/auth/pro-features/', { signal }), enabled: presentation.active && status === 'authenticated', staleTime: 15_000, retry: false, refetchInterval: presentation.active ? 60_000 : false });
  const state = assistantPreferenceState({ enabled: preference.data?.enabled, pending: preference.isPending, failed: preference.isError, statusCode: preference.error instanceof ApiError ? preference.error.status : undefined });
  useAssistantPresentation({ available: state === 'off' || state === 'denied' || preference.error instanceof ApiError && [403, 404, 410].includes(preference.error.status) ? false : undefined });
  // The query key includes scopeKey. Retain this exact mounted conversation only
  // for a transient verification error with cached Pro=true in the same scope.
  if (state === 'ready' || state === 'paused') return <Conversation {...props} accessPaused={state === 'paused'} preferenceError={preference.error?.message} preferenceRefreshing={preference.isRefetching} onPreferenceRetry={() => void preference.refetch()} />;
  if (state === 'loading') return <AssistantFrame><PresentationExit /><Loading /></AssistantFrame>;
  if (state === 'denied' || state === 'error') return <AssistantFrame><PresentationExit /><Empty title={state === 'denied' ? 'AI access could not be confirmed' : 'AI preference could not load'} message={preference.error?.message ?? 'The current account preference could not be verified.'} onRetry={() => void preference.refetch()} /></AssistantFrame>;
  return <AssistantFrame><PresentationExit /><AssistantMark /><Empty title="AI assistance is turned off" message="Enable Pro features in your account settings to continue. Remembered preferences can still be inspected or forgotten there." /><Button title="Account settings" kind="secondary" onPress={() => props.onNavigate('/more/account')} /></AssistantFrame>;
}

function Conversation({ href, onNavigate, portal, accessPaused, preferenceError, preferenceRefreshing, onPreferenceRetry }: Props & { portal: AssistantPortal; accessPaused: boolean; preferenceError?: string; preferenceRefreshing: boolean; onPreferenceRetry: () => void }) {
  const { scopeKey, status: sessionStatus } = useSession(), client = useQueryClient(), { colors } = useTheme(), presentation = useAssistantPresentation();
  const accessPausedRef = useRef(accessPaused); accessPausedRef.current = accessPaused;
  const params = new URLSearchParams(href.split('?')[1] ?? ''), studentId = portal === 'parent' ? params.get('student_id') ?? undefined : undefined;
  const scope = new URLSearchParams({ portal, ...(studentId ? { student_id: studentId } : {}) });
  const root = '/api/v1/agent';
  const status = useQuery({ queryKey: ['campus', scopeKey, `${root}/status?${scope}`], queryFn: async ({ signal }) => parseAssistantStatus(await apiFetch(`${root}/status?${scope}`, { signal })), enabled: presentation.active && sessionStatus === 'authenticated', retry: false });
  useAssistantPresentation({ available: status.data?.pro_features_enabled === false || status.error instanceof ApiError && [403, 404, 410].includes(status.error.status) ? false : undefined });
  // Provider availability gates new inference, not authorized retained history.
  const threads = useQuery({ queryKey: ['campus', scopeKey, `${root}/threads?${scope}`], queryFn: async ({ signal }) => parseAssistantThreads(await apiFetch(`${root}/threads?${scope}`, { signal })), enabled: presentation.active && sessionStatus === 'authenticated' && status.data?.pro_features_enabled === true, retry: false });
  const [selected, setSelected] = useState<string | null>(null), [question, setQuestion] = useState(''), [history, setHistory] = useState(false), [historyDismissal, setHistoryDismissal] = useState(0);
  const captureOperation = useAssistantOperationContext(JSON.stringify([href, portal, studentId, selected]));
  const [busy, setBusy] = useState(false), running = useRef(false);
  const [error, setError] = useState(''), [pending, setPending] = useState<Pending | null>(null), [journal, setJournal] = useState<string | null>(null);
  const incomingRequested = params.get('thread'), [requested, setRequested] = useState(incomingRequested);
  const [linkedRequest, setLinkedRequest] = useState<{ id: string; revision: number } | null>(null), observedRequest = useRef(presentation.requestRevision), attemptedRequest = useRef<number | null>(null);
  const knownThreads = threads.data?.threads ?? [];
  const linked = requested && knownThreads.some(thread => thread.id === requested) ? requested : '';
  const missingLinked = !!requested && !linked && threads.isSuccess;
  const threadId = pending ? pending.threadId : selected !== null ? selected : requested ? linked : knownThreads[0]?.id || '';
  const detail = useQuery({ queryKey: ['campus', scopeKey, 'assistant-thread', portal, studentId, threadId],
    queryFn: async ({ signal }) => parseAssistantThread(await apiFetch(`${root}/threads/${encodeURIComponent(threadId)}`, { signal }), threadId),
    enabled: presentation.active && sessionStatus === 'authenticated' && !!threadId && status.data?.pro_features_enabled === true,
    retry: false, staleTime: 5_000,
    refetchInterval: query => !presentation.active ? false : query.state.data?.runs.some(run => run.status === 'running' || run.action?.status === 'executing') ? 1500 : query.state.data?.runs.some(run => run.action?.status === 'pending') ? 10_000 : false,
  });
  useEffect(() => { let active = true; void (async () => { try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${getApiOrigin()}:${scopeKey}:${portal}:${studentId ?? 'self'}`);
    const key = `thatcampus.assistant-command.${digest}`, entry = journalFor(key);
    entry.loading ??= (async () => { const raw = await SecureStore.getItemAsync(key);
      if (raw) { const value: unknown = JSON.parse(raw);
        // Older empty-thread records cannot prove creation was never attempted.
        entry.pending = restoreAssistantCommand(value);
      }
    })();
    await entry.loading;
    if (!active) return;
    setPending(entry.pending); if (entry.pending?.kind === 'send') setQuestion(entry.pending.question);
    setJournal(key);
  } catch { if (active) setError('Secure assistant recovery is unavailable. Restore it before sending a new request.'); } })(); return () => { active = false; }; }, [scopeKey, portal, studentId]);
  useEffect(() => { if (!journal) return; const entry = journalFor(journal), sync = () => { setPending(entry.pending); setBusy(entry.busy); }; entry.listeners.add(sync); sync(); return () => { entry.listeners.delete(sync); }; }, [journal]);
  const runs = detail.data?.runs ?? [], activeRun = runs.find(run => run.status === 'running');
  const copySnapshot = assistantCopySnapshot(runs, presentation.active && sessionStatus === 'authenticated' && status.isSuccess && status.data.pro_features_enabled && detail.isSuccess && !(missingLinked && selected === null));
  const copyCurrent = useRef(copySnapshot), copyBusy = useRef(false), copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null), copyOwner = useRef(''), copyMounted = useRef(true);
  const copyIdentity = JSON.stringify([scopeKey, portal, studentId, threadId, presentation.entryToken, copySnapshot]);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle'); copyCurrent.current = copySnapshot;
  useEffect(() => { setCopyState('idle'); if (copyTimer.current) clearTimeout(copyTimer.current); return () => { if (copyTimer.current) clearTimeout(copyTimer.current); }; }, [copySnapshot?.runId, copySnapshot?.text, presentation.active, scopeKey, threadId]);
  useEffect(() => { copyMounted.current = true; return () => { copyMounted.current = false; }; }, []);
  async function copyResponse() {
    const snapshot = copyCurrent.current; if (!snapshot || copyBusy.current) return;
    let assertCurrent: () => void; try { assertCurrent = captureOperation(); } catch { return; }
    copyBusy.current = true; copyOwner.current = copyIdentity; setCopyState('copying');
    try {
      const result = await copyAssistantResponse({ snapshot, readCurrent: () => copyCurrent.current, assertCurrent,
        write: text => Clipboard.setStringAsync(text, { inputFormat: Clipboard.StringFormat.PLAIN_TEXT, android: { isSensitive: true } }),
      });
      if (!copyMounted.current) return;
      if (result === 'stale') { if (copyOwner.current === copyIdentity) setCopyState('idle'); return; }
      setCopyState(result === 'copied' ? 'copied' : 'failed');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { setCopyState('idle'); copyTimer.current = null; }, 2200);
    } finally { copyBusy.current = false; }
  }
  const focusedPreview = assistantCompactPresentation(runs, { attention: false, loading: false });
  const warningRef = useRef<React.ComponentRef<typeof View>>(null), reviewRef = useRef<React.ComponentRef<typeof View>>(null), reviewId = focusedPreview.mode === 'review' ? focusedPreview.action?.id ?? '' : '';
  const awaiting = runs.some(run => run.action?.status === 'pending' || run.action?.status === 'executing');
  const locked = !presentation.active || accessPaused || busy || !!pending || !journal || !!activeRun || awaiting || status.data?.ready !== true || status.data?.pro_features_enabled !== true || threads.isPending || threads.isError || !!threadId && (detail.isPending || detail.isError) || missingLinked && selected === null;
  const conversationChange = useRef({ source: '', question: '', newBlocked: true, historyBlocked: true, knownIds: [] as string[] }), conversationPrompt = useRef(false);
  conversationChange.current = { source: JSON.stringify([scopeKey, href, portal, studentId, threadId]), question, newBlocked: locked, historyBlocked: busy || !!pending || !!activeRun || awaiting, knownIds: knownThreads.map(thread => thread.id) };
  useScreenExitGuard({ blocked: busy, dirty: !!question.trim() && !pending, draftSignature: JSON.stringify([href, portal, studentId, threadId, question, pending?.kind === 'send' ? pending.clientId : pending?.kind === 'decision' ? pending.actionId : null]), title: 'Leave this assistant question?', message: 'The unsent question will be lost. Saved conversations stay available.', onLeave: () => setQuestion('') });
  const refresh = async () => { await Promise.all([status.refetch({ throwOnError: true }), threads.refetch({ throwOnError: true }), ...(threadId ? [detail.refetch({ throwOnError: true })] : [])]); };
  async function perform(command: Pending) {
    if (!presentation.active || !journal || running.current || accessPaused && command.phase !== 'accepted' || !status.data?.pro_features_enabled || command.kind === 'send' && command.phase !== 'accepted' && !status.data.ready) return;
    const entry = journalFor(journal); if (entry.busy) return;
    if (entry.pending && JSON.stringify(entry.pending) !== JSON.stringify(command)) { setError('Recover the exact earlier assistant request before another action.'); return; }
    entry.busy = true; notify(entry); running.current = true; setError('');
    const recovering = entry.pending !== null, progress = { dispatched: false, accepted: command.phase === 'accepted', cleared: false };
    const retained = (value: Pending | null) => { entry.pending = value; notify(entry); };
    let assertCurrent: (() => void) | undefined;
    try {
      assertCurrent = captureOperation();
      const completed = await dispatchAssistantCommand({ command, assertCurrent, progress,
        retain: value => SecureStore.setItemAsync(journal, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        retained,
        createThread: () => { assertAssistantWriteReady(accessPausedRef.current); return apiFetch<{ id: string }>(`${root}/threads`, { method: 'POST', body: JSON.stringify({ portal, ...(studentId ? { student_id: studentId } : {}) }) }); },
        dispatch: value => { assertAssistantWriteReady(accessPausedRef.current); return value.kind === 'send'
          ? apiFetch(`${root}/threads/${encodeURIComponent(value.threadId)}/messages`, { method: 'POST', body: JSON.stringify({ question: value.question, client_id: value.clientId }) })
          : apiFetch(`${root}/threads/${encodeURIComponent(value.threadId)}/actions/${encodeURIComponent(value.actionId)}`, { method: 'POST', body: JSON.stringify({ decision: value.decision }) }); },
        clear: () => SecureStore.deleteItemAsync(journal),
      });
      assertCurrent(); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); assertCurrent();
      setSelected(completed.threadId); if (completed.kind === 'send') setQuestion('');
    } catch (cause) {
      try { assertCurrent?.(); if (!assertCurrent) return; } catch { return; }
      if (cause instanceof ApiError && assistantDefinitiveRefusal(cause.status, progress, recovering)) { try { await clearAssistantCommand({ assertCurrent, clear: () => SecureStore.deleteItemAsync(journal), retained, progress }); } catch { return; } }
      setError(progress.accepted ? 'The assistant request was accepted. Refresh its saved conversation; it will not be sent again.' : cause instanceof Error ? cause.message : 'The assistant request could not be confirmed.');
    } finally { entry.busy = false; notify(entry); running.current = false; }
  }
  async function changeConversation(target: string | null) {
    if (conversationPrompt.current) return;
    if (target !== null && target === threadId) { setHistory(false); setLinkedRequest(current => current?.id === target ? null : current); return; }
    let assertCurrent: () => void; try { assertCurrent = captureOperation(); } catch { return; }
    conversationPrompt.current = true;
    try {
      await prepareAssistantConversationChange({ assertCurrent,
        read: () => {
          const current = conversationChange.current, entry = journal ? journalFor(journal) : null;
          if (target !== null && !current.knownIds.includes(target)) return null;
          return { source: current.source, question: current.question, blocked: running.current || !!entry?.busy || !!entry?.pending || (target === null ? current.newBlocked : current.historyBlocked) };
        },
        confirmDiscard: () => new Promise<boolean>(resolve => {
          let answered = false; const finish = (discard: boolean) => { if (!answered) { answered = true; resolve(discard); } };
          Alert.alert(target === null ? 'Start a new conversation?' : 'Open another conversation?', 'Your unsent question will be discarded. Saved conversations stay available.', [
            { text: 'Keep editing', style: 'cancel', onPress: () => finish(false) },
            { text: target === null ? 'Discard and start new' : 'Discard and open', style: 'destructive', onPress: () => finish(true) },
          ], { cancelable: true, onDismiss: () => finish(false) });
        }),
        commit: () => { setSelected(target ?? ''); if (target !== null) setRequested(target); setQuestion(''); setHistory(false); setLinkedRequest(current => current?.id === target ? null : current); },
      });
    } finally { conversationPrompt.current = false; }
  }
  function createConversation() { void changeConversation(null); }
  function selectConversation(id: string) {
    if (busy || running.current) return;
    // An ambiguous creation is an explicit binding of the exact retained
    // question/key, not a new conversation or a discard of that preparation.
    if (pending?.kind === 'send' && pending.phase === 'creating') { void resolveUnsent(id); return; }
    if (!pending && !activeRun && !awaiting) void changeConversation(id);
  }
  async function resolveUnsent(threadId?: string) {
    if (!presentation.active || !journal || busy || pending?.kind !== 'send' || pending.phase !== 'creating') return;
    const entry = journalFor(journal); if (entry.busy || entry.pending !== pending) return;
    let assertCurrent: () => void; try { assertCurrent = captureOperation(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Return to the original conversation.'); return; } entry.busy = true; notify(entry);
    try {
      if (threadId) { const current = await threads.refetch({ throwOnError: true }); assertCurrent(); const bound = bindAssistantConversation(pending, threadId, current.data?.threads ?? []); await SecureStore.setItemAsync(journal, JSON.stringify(bound), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); entry.pending = bound; notify(entry); assertCurrent(); setSelected(threadId); }
      else { await clearAssistantCommand({ assertCurrent, clear: () => SecureStore.deleteItemAsync(journal), retained: value => { entry.pending = value; notify(entry); } }); setQuestion(''); setSelected(''); }
    } catch (cause) { try { assertCurrent(); setError(cause instanceof Error ? cause.message : 'The unsent question was retained.'); } catch { /* Retain the exact preparation. */ } }
    finally { entry.busy = false; notify(entry); }
  }
  async function cancelRun() {
    if (!presentation.active || !activeRun || !threadId || busy || pending || accessPaused) return;
    setBusy(true); setError('');
    try { const assertCurrent = captureOperation(); const value = await apiFetch<{ cancelled: boolean }>(`${root}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(activeRun.id)}/cancel`, { method: 'POST', body: '{}' }); assertCurrent(); if (typeof value?.cancelled !== 'boolean') throw new Error('Cancellation was not confirmed. Refresh the original request.'); await detail.refetch(); assertCurrent(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation was not confirmed. Refresh before trying again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!Number.isSafeInteger(presentation.requestRevision) || observedRequest.current >= presentation.requestRevision) return;
    const next = assistantLinkedThreadRequest(observedRequest.current, presentation.requestRevision, incomingRequested, threadId);
    observedRequest.current = presentation.requestRevision;
    // Only an explicit canonical activation is a new thread request. Closing,
    // reopening, expansion and returning from a source leave this selection.
    setLinkedRequest(next);
  }, [presentation.requestRevision, incomingRequested, threadId]);
  useEffect(() => {
    if (!linkedRequest || !presentation.active || !threads.isSuccess || attemptedRequest.current === linkedRequest.revision || !knownThreads.some(thread => thread.id === linkedRequest.id)) return;
    attemptedRequest.current = linkedRequest.revision;
    void changeConversation(linkedRequest.id);
  }, [linkedRequest, presentation.active, threads.isSuccess, knownThreads]);
  if (status.isPending) return <AssistantFrame><PresentationExit /><Loading /></AssistantFrame>;
  if (status.isError || !status.data) return <AssistantFrame><PresentationExit /><AssistantMark /><Empty title={status.error instanceof ApiError && status.error.status === 403 ? 'AI access could not be confirmed' : 'AI assistance is unavailable'} message={status.error instanceof ApiError && status.error.status === 403 ? `${status.error.message} Staff need “Use AI assistance” and each underlying campus permission.` : status.error?.message} onRetry={() => void status.refetch()} /><ControlButton title="Account settings" onPress={() => onNavigate('/more/account')} /></AssistantFrame>;
  if (!status.data.pro_features_enabled) return <AssistantFrame><PresentationExit /><AssistantMark /><Empty title="AI assistance is turned off" /><ControlButton title="Account settings" onPress={() => onNavigate('/more/account')} /></AssistantFrame>;
  const attention = accessPaused ? 'access-check' : pending ? `recovery:${pending.kind}:${pending.phase ?? 'unconfirmed'}` : error ? `error:${error}` : linkedRequest ? 'linked-conversation' : !status.data.ready ? 'provider-unavailable' : missingLinked && selected === null ? 'missing-conversation' : threads.isError ? 'history-error' : detail.isError ? 'conversation-error' : '';
  const copyControl = <ResponseCopyControl onCopy={() => void copyResponse()} disabled={!copySnapshot} state={copyOwner.current === copyIdentity ? copyState : 'idle'} />;
  const composer = <View style={{ gap: 8, minHeight: 0, flexShrink: 1, width: '100%', maxWidth: presentation.expanded ? 720 : 440, alignSelf: 'center' }}><CompactConversation visible={!presentation.expanded} runs={runs} onExpand={presentation.expand} onClose={presentation.canClose ? presentation.close : undefined} onNavigate={onNavigate} copyControl={copyControl}
    attention={attention} pending={pending} error={error} preferenceError={preferenceError} detailError={detail.error?.message} historyError={threads.error?.message} loading={!!threadId && detail.isPending || threads.isPending} availableHeight={presentation.frame.height} />
    <ConversationComposer value={question} onChange={setQuestion} locked={locked} busy={busy} running={!!activeRun} stopDisabled={busy || !!pending || accessPaused} expanded={presentation.expanded}
    status={accessPaused ? 'Access check paused. Your question is retained.' : pending ? 'Recover the earlier request before another question.' : activeRun ? `${activeRun.progress || 'Checking your request'}…` : awaiting ? 'Review the pending change before another question.' : !status.data.ready ? 'AI provider unavailable. Saved conversations remain available.' : undefined}
    onStop={() => void cancelRun()} onSend={() => void perform({ kind: 'send', threadId, question: question.trim(), clientId: Crypto.randomUUID() })} /></View>;
  return <AssistantFrame canvas maxWidth={720} footer={composer} footerPadding={16} footerSeparator={false}>
    <View style={{ flex: presentation.expanded ? 1 : 0, minHeight: 0, display: presentation.expanded ? 'flex' : 'none' }} accessibilityElementsHidden={!presentation.expanded} importantForAccessibility={presentation.expanded ? 'auto' : 'no-hide-descendants'}>
    <ConversationToolbar onHistory={() => setHistory(true)} onNew={createConversation} historyDisabled={busy} newDisabled={locked} onCollapse={presentation.collapse} copyControl={copyControl} availableWidth={presentation.frame.width} />
    <ConversationCanvas visible={presentation.active && presentation.expanded} historyOpen={history} historyDismissal={historyDismissal} state={{ threadId, latestId: runs.at(-1)?.id ?? '', status: runs.at(-1)?.status ?? '', reviewId: attention || reviewId }} reviewRef={attention ? warningRef : reviewRef} refreshing={detail.isRefetching || threads.isRefetching} onRefresh={() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'The current conversation could not refresh.')); }}>
      {attention ? <View ref={warningRef} collapsable={false} style={{ gap: 8 }}>
      {accessPaused ? <View style={{ gap: 4 }}><Notice tone="warning" message={`Account preference could not be rechecked. Your conversation and unsent question are retained; new requests and decisions are paused.${preferenceError ? ` ${preferenceError}` : ''}`} /><ControlButton title="Retry access check" busy={preferenceRefreshing} onPress={onPreferenceRetry} /></View> : null}
      {!status.data.ready ? <Notice tone="warning" message="The configured AI provider or allowance is unavailable. Saved authorized conversations and existing action review remain available; new questions wait for the provider. Use campus tools directly meanwhile." /> : null}
      {missingLinked && selected === null && !pending ? <Notice tone="warning" message="The requested conversation is not in your current owned history. Choose an available conversation explicitly; another one has not been substituted." /> : null}
      {threads.isError ? <Empty title="Conversations could not load" message={threads.error.message} onRetry={() => void threads.refetch()} /> : null}
      {detail.isError ? <Empty title="Conversation could not load" message={detail.error.message} onRetry={() => void detail.refetch()} /> : null}
      {linkedRequest ? <View style={{ gap: 4 }}><Notice tone="warning" message={knownThreads.some(thread => thread.id === linkedRequest.id) ? 'A link requested another conversation. Your current conversation is retained until that selection is accepted.' : 'The linked conversation is not in the current owned history. Another conversation has not been substituted for it.'} /><ControlButton title="Open requested conversation" disabled={busy || !!pending || !!activeRun || awaiting || !knownThreads.some(thread => thread.id === linkedRequest.id)} onPress={() => void changeConversation(linkedRequest.id)} /><ControlButton title="Refresh conversations" busy={threads.isRefetching} onPress={() => void threads.refetch()} /></View> : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      {pending ? <View style={{ gap: 8 }}><Notice tone="warning" message={pending.phase === 'accepted' ? 'This request was accepted. Finish secure local cleanup, then refresh its saved conversation. It will not be submitted again.' : pending.phase === 'creating' ? 'New conversation creation is unconfirmed. The question has not been sent. Refresh Conversations and explicitly choose where it belongs, or discard this unsent question.' : pending.kind === 'send' ? 'This request has an unconfirmed result. Retry only the same question and message key.' : 'This decision has an unconfirmed result. Retry the original decision to recover its recorded state.'} />{pending.phase === 'creating' ? <><ControlButton title="Refresh conversations" busy={busy || threads.isRefetching} onPress={() => { setHistory(true); void threads.refetch(); }} /><ControlButton title="Discard unsent question" kind="danger" disabled={busy} onPress={() => Alert.alert('Discard this unsent question?', 'No message was sent. An empty conversation may have been created. This removes only the local question preparation.', [{ text: 'Keep question', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => void resolveUnsent() }])} /></> : <ControlButton title={pending.phase === 'accepted' ? 'Finish local recovery' : 'Retry original request'} busy={busy} disabled={pending.phase !== 'accepted' && (accessPaused || pending.kind === 'send' && !status.data.ready)} onPress={() => void perform(pending)} />}</View> : null}
      </View> : null}
      {detail.isError ? null : threadId && detail.isPending ? <Loading label="Loading conversation…" /> : runs.length ? runs.map((run, index) => <Run key={run.id} run={run} latest={index === runs.length - 1} reviewRef={run.action?.id === reviewId ? reviewRef : undefined} locked={busy || !!pending || accessPaused} onNavigate={onNavigate} onDecision={(actionId, decision) => void perform({ kind: 'decision', threadId, actionId, decision })} />) : <ConversationEmpty />}
    </ConversationCanvas></View>
    <View pointerEvents="none" style={{ flex: presentation.expanded ? 0 : 1 }} />
    <ConversationHistory visible={presentation.active && history} onClose={() => setHistory(false)} onDismiss={() => setHistoryDismissal(value => value + 1)} threads={knownThreads} currentId={threadId} loading={threads.isPending} canSelect={!busy && (pending?.kind === 'send' && pending.phase === 'creating' || !pending && !activeRun && !awaiting)} onSelect={selectConversation}>
      <InfoDisclosure title="Assistant settings"><Facts items={[{ label: 'Provider', value: status.data.provider }, { label: 'Model', value: status.data.model || 'Not configured' }, { label: 'Connection', value: status.data.ready ? 'Configuration available' : 'Currently unavailable' }]} /><Text style={[styles.caption, { color: colors.muted }]}>Provider credentials and deployment limits are managed by the server. Availability is not proof of a successful answer.</Text><ControlButton title="Pro features & remembered preferences" onPress={() => { setHistory(false); onNavigate('/more/account'); }} /><ControlButton title="Connected apps" onPress={() => { setHistory(false); onNavigate('/more/connections'); }} /></InfoDisclosure>
    </ConversationHistory>
  </AssistantFrame>;
}

function CompactConversation({ visible, runs, onExpand, onClose, onNavigate, attention, pending, error, preferenceError, detailError, historyError, loading, copyControl, availableHeight }: {
  visible: boolean; runs: readonly AgentRun[]; onExpand: () => void; onClose?: () => void; onNavigate: (href: string) => void;
  attention: string; pending: Pending | null; error: string; preferenceError?: string; detailError?: string; historyError?: string; loading: boolean; copyControl?: React.ReactNode; availableHeight?: number;
}) {
  const { colors } = useTheme();
  // A compact preview must not pair failed verification/recovery with an older
  // successful chart. The full mounted transcript owns recovery and approval.
  const problem = attention === 'access-check' ? { title: 'Access check paused', message: `Your conversation and unsent question are retained. New requests and decisions are paused.${preferenceError ? ` ${preferenceError}` : ''}` }
    : pending ? { title: pending.phase === 'accepted' ? 'Request accepted' : 'Recovery needed', message: pending.phase === 'accepted' ? 'Finish secure local cleanup in the full conversation. This request will not be submitted again.' : pending.phase === 'creating' ? 'Conversation creation is unconfirmed. The question has not been sent. Open the full conversation to choose its owned history or discard the local preparation.' : pending.kind === 'send' ? 'The result is unconfirmed. Open the full conversation to recover only the original question and message key.' : 'The decision is unconfirmed. Open the full conversation to recover the original decision.' }
      : error ? { title: 'Request needs attention', message: error }
        : attention === 'conversation-error' ? { title: 'Conversation could not load', message: detailError || 'The current owned conversation could not be verified. Open it to retry.' }
          : attention === 'history-error' ? { title: 'Conversations could not load', message: historyError || 'The current owned history could not be verified. Open it to retry.' }
            : attention === 'missing-conversation' ? { title: 'Conversation unavailable', message: 'The requested conversation is not in your current owned history. Open the full conversation to choose one explicitly.' }
              : attention === 'linked-conversation' ? { title: 'Conversation link needs attention', message: 'Open the full conversation to review the requested selection. Your current conversation and unsent question are retained until the selection is accepted.' }
                : attention === 'provider-unavailable' ? { title: 'AI provider unavailable', message: 'Saved authorized conversations and existing review remain available. New questions wait for the configured provider or allowance.' } : null;
  const { mode, latest, action, chartSource, source } = assistantCompactPresentation(runs, { attention: !!problem, loading });
  const showAction = mode === 'review', chart = chartSource?.chart;
  const target = action?.receipt?.href ?? action?.href;
  const compactSource = !problem && !loading ? showAction || action?.status === 'succeeded'
    ? target && isInternalHref(target) ? <ControlButton title={action?.status === 'succeeded' ? 'Verify in campus record' : 'Open affected screen'} onPress={() => onNavigate(target)} /> : undefined
    : source ? <ConversationSource source={source} title={source.chart ? assistantSourceLabel(source.chart.title) : source.title} onNavigate={onNavigate} /> : undefined : undefined;
  return <ConversationBubble visible={visible} onExpand={onExpand} onClose={onClose} hasChart={!!chart} source={compactSource} copyControl={copyControl} availableHeight={availableHeight} minimizedLabel={problem?.title ?? (showAction ? action?.status === 'pending' ? 'Review needed' : 'Check the result' : undefined)}>
    {!visible ? null : problem ? <View style={{ gap: 8 }}><Text accessibilityRole="header" aria-level={2} style={[styles.chartTitle, { color: colors.ink }]}>{problem.title}</Text><Notice tone="warning" message={problem.message} /><ControlButton title="Open full conversation" onPress={onExpand} /></View>
      : loading ? <Loading label="Loading conversation…" />
        : showAction && action ? <View style={{ gap: 8 }}><Text accessibilityRole="header" aria-level={2} style={[styles.chartTitle, { color: colors.ink }]}>{action.status === 'pending' ? 'Review needed' : action.status === 'executing' ? 'Verifying result' : 'Check the affected record'}</Text><Text style={[styles.body, { color: colors.ink }]}>{action.title}</Text>{action.preview ? <Text style={[styles.caption, { color: colors.muted }]}>{[action.preview.student, action.preview.class_name, action.preview.date].filter(Boolean).join(' · ')}</Text> : null}{action.contract?.summary ? <Text style={[styles.caption, { color: colors.muted }]}>{action.contract.summary}</Text> : null}<Notice tone="warning" message={action.status === 'pending' ? Date.parse(action.expires_at) <= Date.now() ? 'This preview has expired. Ask for a fresh preview before changing the record.' : `Nothing has changed. Review the complete proposal before confirmation. Expires ${new Date(action.expires_at).toLocaleTimeString()}.` : action.receipt?.message || (action.status === 'executing' ? 'The server is verifying the result. No additional change has been confirmed here.' : 'The result needs verification. Check the affected record before another attempt.')} /><ControlButton title={action.status === 'pending' ? 'Expand to review' : 'Open full conversation'} onPress={onExpand} /></View>
          : latest ? <><CompactAnswer text={assistantRunAnswer(latest)} chart={chart} onExpand={onExpand} />{latest.status === 'failed' ? <Notice tone="warning" message="The request stopped. No action was automatically retried." /> : null}{chart ? <AssistantChart chart={chart} compact /> : null}</>
            : <CompactAnswer text="What would you like to know? Ask about your campus or prepare a change for review." onExpand={onExpand} />}
  </ConversationBubble>;
}

function Run({ run, latest, reviewRef, locked, onNavigate, onDecision }: { run: AgentRun; latest: boolean; reviewRef?: React.RefObject<React.ComponentRef<typeof View> | null>; locked: boolean; onNavigate: (href: string) => void; onDecision: (actionId: string, decision: 'confirm' | 'reject') => void }) {
  const chartSources = run.evidence.filter(source => source.chart), otherSources = run.evidence.filter(source => !source.chart);
  return <ConversationTurn question={run.question} latest={latest}>
    <AssistantAnswer text={assistantRunAnswer(run)} chart={run.status !== 'running' && chartSources.length === 1 ? chartSources[0]!.chart : undefined} />
    {chartSources.map(source => <View key={source.id} style={{ gap: 12 }}><AssistantChart chart={source.chart!} /><ConversationSource source={source} title={assistantSourceLabel(source.chart!.title)} onNavigate={onNavigate} /></View>)}
    {run.status === 'failed' ? <Notice tone="warning" message="The request stopped. No action was automatically retried." /> : null}
    {run.action ? <View ref={reviewRef} collapsable={false}><ActionReview action={run.action} locked={locked} onNavigate={onNavigate} onDecision={onDecision} /></View> : null}
    {otherSources.length ? <InfoDisclosure title={otherSources.length === 1 ? 'Source checked' : `${otherSources.length} sources checked`}>{otherSources.map(source => <ConversationSource key={source.id} source={source} onNavigate={onNavigate} />)}</InfoDisclosure> : null}
  </ConversationTurn>;
}

function AssistantChart({ chart, compact = false }: { chart: AgentChartData; compact?: boolean }) {
  const { colors } = useTheme(), segments = assistantLineSegments(chart), palette = [colors.action, colors.positive, colors.warning, colors.danger, colors.muted];
  const kind = assistantChartKind(chart);
  const points = assistantChartDisplayPoints(chart, kind, compact);
  const maximum = chart.unit === 'percent' ? 100 : Math.max(1, ...chart.points.map(point => point.value ?? 0)), total = chart.points.reduce((sum, point) => sum + (point.value ?? 0), 0), circumference = Math.PI * 84;
  let offset = 0;
  const accessible = `${chart.title}. ${chart.scope}. ${chart.from} to ${chart.to}. ${points.map(point => `${point.label}: ${assistantChartValue(point.value, chart.unit)}`).join('; ')}.`;
  return <View style={{ gap: 12, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 }}>
    <Text accessibilityRole="header" aria-level={3} style={[styles.chartTitle, { color: colors.ink }]}>{chart.title}</Text><Text style={[styles.caption, { color: colors.muted }]}>{chart.scope}{'\n'}{chart.from} – {chart.to}</Text>
    {kind === 'line' ? <View accessible accessibilityLabel={accessible}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width="100%" height={compact ? 96 : 140} viewBox="0 0 300 130" preserveAspectRatio="none"><Polyline points="12,108 288,108" stroke={colors.border} fill="none" />{segments.filter(segment => segment.length > 1).map((segment, index) => <Polyline key={index} points={segment.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colors.action} strokeWidth={2.5} />)}{segments.flat().map(point => <Circle key={point.index} cx={point.x} cy={point.y} r={3} fill={colors.action} />)}</Svg><Text style={[styles.caption, { color: colors.muted }]}>Gaps mean no recorded reading.</Text></View>
      : kind === 'donut' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}><View accessible accessibilityLabel={accessible}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={128} height={128} viewBox="0 0 110 110"><Circle cx={55} cy={55} r={42} fill="none" stroke={colors.border} strokeWidth={12} />{total > 0 ? chart.points.map((point, index) => { const length = (point.value ?? 0) / total * circumference, start = offset; offset += length; return length ? <Circle key={index} cx={55} cy={55} r={42} fill="none" stroke={palette[index % palette.length]} strokeWidth={12} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 55 55)" /> : null; }) : null}</Svg></View><View style={{ flex: 1, minWidth: 130, gap: 8 }}>{chart.points.map((point, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette[index % palette.length] }} /><Text style={[styles.caption, { color: colors.ink, flex: 1 }]}>{point.label}</Text><Text style={[styles.caption, { color: colors.ink }]}>{assistantChartValue(point.value, chart.unit)}</Text></View>)}</View></View>
        : <View style={{ gap: compact ? 8 : 12 }}>{points.map((point, index) => <View key={index} accessible accessibilityLabel={`${point.label}: ${assistantChartValue(point.value, chart.unit)}. ${point.detail}`} style={{ gap: 6 }}><View style={{ flexDirection: 'row', gap: 12, justifyContent: 'space-between' }}><Text style={[styles.caption, { color: colors.ink, flex: 1 }]}>{point.label}</Text><Text style={[styles.caption, { color: colors.ink, fontWeight: '600' }]}>{assistantChartValue(point.value, chart.unit)}</Text></View><View style={{ height: 7, borderRadius: 4, backgroundColor: colors.row }}>{point.value !== null ? <View style={{ height: 7, borderRadius: 4, width: `${point.value / maximum * 100}%`, backgroundColor: colors.action }} /> : null}</View></View>)}</View>}
    {points.length < chart.points.length ? <Text style={[styles.caption, { color: colors.muted }]}>Showing {points.length} of {chart.shown} available readings. Open the full conversation for data and method.</Text> : null}
    {chart.shown < chart.total ? <Text style={[styles.caption, { color: colors.muted }]}>Showing {chart.shown} of {chart.total}; this is a partial view.</Text> : null}
    {chart.kind === 'donut' && kind !== 'donut' ? <Text style={[styles.caption, { color: colors.muted }]}>This partition is incomplete; values are shown without implying a complete whole.</Text> : null}
    {compact ? <Text style={[styles.caption, { color: colors.muted }]}>{chart.note}</Text> : <Disclosure title="Data and method"><Text selectable style={[styles.caption, { color: colors.muted }]}>{chart.note}</Text>{chart.points.map((point, index) => <Row key={index} title={point.label} status={assistantChartValue(point.value, chart.unit)} detail={point.detail} />)}</Disclosure>}
  </View>;
}
function ActionReview({ action, locked, onNavigate, onDecision }: { action: AgentAction; locked: boolean; onNavigate: (href: string) => void; onDecision: (actionId: string, decision: 'confirm' | 'reject') => void }) {
  const { colors } = useTheme();
  const pending = action.status === 'pending', expired = Date.parse(action.expires_at) <= Date.now(), preview = action.preview;
  const target = action.receipt?.href ?? action.href;
  const summary = useMemo(() => Object.entries(action.input.body ?? {}).filter(([key]) => !['expected_revision', 'basis_id'].includes(key)).map(([key, value]) => ({ label: label(key), value: formatActionValue(value, action.labels) })), [action.input.body, action.labels]);
  return <View style={[styles.review, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={{ gap: 4 }}><Text style={[styles.caption, { color: colors.muted }]}>{pending ? 'Review required' : action.status === 'succeeded' ? 'Recorded change' : label(action.status)}</Text><Text accessibilityRole="header" aria-level={3} style={[styles.chartTitle, { color: colors.ink }]}>{action.title}</Text>{action.contract?.summary ? <Text style={[styles.caption, { color: colors.muted }]}>{action.contract.summary}</Text> : null}</View>
    {pending ? <>{preview ? <>
      <Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{[preview.student, preview.class_name].filter(Boolean).join(' · ') || 'Attendance register'}</Text>
      <Facts items={[{ label: 'Date', value: preview.date }, ...(preview.reason ? [{ label: 'Reason', value: preview.reason }] : []), ...(preview.remarks !== undefined ? [{ label: 'Remarks', value: preview.remarks || 'None' }] : [])]} />
      {preview.previous_status !== undefined || preview.status !== undefined ? <View accessibilityLabel={`Proposed attendance change: ${label(preview.previous_status ?? 'not_marked')} to ${label(preview.status ?? 'not_marked')}`} style={[styles.change, { backgroundColor: colors.row }]}><View style={{ flex: 1, minWidth: 90, gap: 4 }}><Text style={[styles.caption, { color: colors.muted }]}>Current</Text><Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{label(preview.previous_status ?? 'not_marked')}</Text></View><Text style={[styles.body, { color: colors.muted }]}>→</Text><View style={{ flex: 1, minWidth: 90, gap: 4 }}><Text style={[styles.caption, { color: colors.muted }]}>After confirmation</Text><Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{label(preview.status ?? 'not_marked')}</Text></View></View> : null}
      {preview.records ? <View style={{ gap: 8 }}><Text style={[styles.caption, { color: colors.muted }]}>{preview.records.length} {preview.records.length === 1 ? 'student' : 'students'}</Text>{preview.records.map((record, index) => <View key={`${record.student}:${index}`} style={[styles.reviewRecord, { borderColor: colors.border }]}><View style={{ flex: 1, gap: 4 }}><Text style={[styles.body, { color: colors.ink }]}>{record.student}</Text>{record.remarks ? <Text style={[styles.caption, { color: colors.muted }]}>{record.remarks}</Text> : null}</View><Text style={[styles.caption, { color: colors.ink, fontWeight: '600', flexShrink: 1 }]}>{label(record.status ?? 'not_marked')}</Text></View>)}</View> : null}
      <Text style={[styles.caption, { color: colors.muted }]}>{preview.register_note}</Text>
    </> : <Facts items={summary} />}
      <Notice tone={expired ? 'warning' : 'info'} message={expired ? 'This preview has expired. Ask for a fresh preview before changing the record.' : `Nothing has changed. This proposed change has not been confirmed. Expires ${new Date(action.expires_at).toLocaleTimeString()}.`} />
      <View style={styles.actions}><ControlButton title="Dismiss" disabled={locked} onPress={() => onDecision(action.id, 'reject')} /><ControlButton title={action.contract?.confirmation_label ?? 'Confirm change'} kind="primary" disabled={locked || expired} onPress={() => onDecision(action.id, 'confirm')} /></View>
    </> : action.receipt?.message ? <Notice tone={action.status === 'succeeded' ? 'success' : action.status === 'uncertain' ? 'warning' : 'info'} message={action.receipt.message} /> : <Notice message={action.status === 'executing' ? 'The server is verifying the result.' : action.status === 'uncertain' ? 'The result is uncertain. Verify the affected record before another attempt.' : 'Review the current record before requesting another change.'} />}
    {isInternalHref(target) ? <ControlButton title={action.status === 'succeeded' ? 'Verify in campus record' : 'Open affected screen'} onPress={() => onNavigate(target)} /> : null}
    {action.receipt?.request_id ? <InfoDisclosure title="Action receipt"><Text selectable style={[styles.caption, { color: colors.ink }]}>{action.receipt.request_id}</Text>{action.receipt.completed_at ? <Text style={[styles.caption, { color: colors.muted }]}>{new Date(action.receipt.completed_at).toLocaleString()}</Text> : null}</InfoDisclosure> : null}
  </View>;
}

function formatActionValue(value: unknown, labels: Record<string, string>): string {
  if (value === null || value === undefined) return 'Not set';
  if (Array.isArray(value)) return value.map(item => formatActionValue(item, labels)).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${label(key)}: ${formatActionValue(item, labels)}`).join('\n');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return labels[String(value)] ?? String(value);
}

const styles = StyleSheet.create({
  chartTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, caption: { fontSize: 14, lineHeight: 21 }, body: { fontSize: 16, lineHeight: 25 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  review: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 16, gap: 12 }, change: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 }, reviewRecord: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
