import React, { useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { ClockCounterClockwiseIcon } from 'phosphor-react-native/src/icons/ClockCounterClockwise';
import { NotePencilIcon } from 'phosphor-react-native/src/icons/NotePencil';
import { SquareIcon } from 'phosphor-react-native/src/icons/Square';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { ArrowsOutSimpleIcon } from 'phosphor-react-native/src/icons/ArrowsOutSimple';
import { ArrowsInSimpleIcon } from 'phosphor-react-native/src/icons/ArrowsInSimple';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import type { AgentSource, ThreadSummary } from '../../../../packages/contracts/src/wire/features/assistant/agentApi';
import { AssistantMark, BrandLoadingIcon } from '../../ui/AssistantMark';
import { Empty, Loading } from '../../ui/components';
import { MotionModal, useReducedMotion } from '../../ui/Motion';
import { useTheme } from '../../ui/theme';
import { Glass } from '../../ui/Glass';
import { assistantCompactText, assistantComposerHeight, assistantExpandedScroll, assistantHistoryRestoreOffset, assistantInline, assistantScrollTarget, assistantShouldSendKey, assistantTextBlocks, prepareNativeAssistantText, type AssistantScrollState } from './conversation-presentation';
import type { AgentChartData } from '../../../../packages/contracts/src/wire/features/assistant/agentApi';
import { isInternalHref } from '../../lib/api-policy';

export function ConversationToolbar({ onHistory, onNew, historyDisabled, newDisabled, onCollapse, copyControl, availableWidth }: { onHistory: () => void; onNew: () => void; historyDisabled: boolean; newDisabled: boolean; onCollapse?: () => void; copyControl?: React.ReactNode; availableWidth?: number }) {
  const { colors } = useTheme(), { fontScale } = useWindowDimensions(), narrow = !!availableWidth && availableWidth < 360 * Math.max(1, fontScale);
  return <View style={[styles.toolbar, narrow && { flexDirection: 'column', alignItems: 'stretch', gap: 2 }]}><Text accessibilityRole="header" aria-level={1} style={[styles.toolbarTitle, { color: colors.muted }, narrow && { flex: 0, alignSelf: 'flex-start' }]}>Conversation</Text><View style={[styles.toolbarActions, narrow && { alignSelf: 'flex-end' }]}>
    <UtilityButton label="Conversation history" onPress={onHistory} disabled={historyDisabled}><ClockCounterClockwiseIcon size={21} color={colors.ink} /></UtilityButton>
    <UtilityButton label="New conversation" onPress={onNew} disabled={newDisabled}><NotePencilIcon size={21} color={colors.ink} /></UtilityButton>
    {copyControl}
    {onCollapse ? <UtilityButton label="Collapse Assistant" hint="Return to the compact Assistant bubble." onPress={onCollapse}><ArrowsInSimpleIcon size={20} color={colors.ink} /></UtilityButton> : null}
  </View></View>;
}

export function ResponseCopyControl({ onCopy, disabled, state }: { onCopy: () => void; disabled: boolean; state: 'idle' | 'copying' | 'copied' | 'failed' }) {
  const { colors } = useTheme(), busy = state === 'copying';
  return <Pressable accessibilityRole="button" accessibilityLabel={state === 'copied' ? 'Copied latest response' : state === 'failed' ? 'Copy failed. Try copying the latest response again.' : 'Copy latest response'} accessibilityHint="Copies the latest recorded AI response as plain text." accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onCopy} style={({ pressed }) => [styles.copyControl, { opacity: disabled ? .4 : pressed ? .6 : 1 }]}>{busy ? <BrandLoadingIcon size={19} /> : state === 'copied' ? <CheckIcon size={19} color={colors.positive} /> : <CopyIcon size={19} color={colors.muted} />}{state === 'copied' || state === 'failed' ? <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: state === 'failed' ? colors.danger : colors.positive, flexShrink: 1 }]}>{state === 'copied' ? 'Copied' : 'Try again'}</Text> : null}</Pressable>;
}

function UtilityButton({ label, hint, children, onPress, disabled, controlRef }: PropsWithChildren<{ label: string; hint?: string; onPress: () => void; disabled?: boolean; controlRef?: RefObject<ComponentRef<typeof Pressable> | null> }>) {
  return <Pressable ref={controlRef} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.utilityButton, { opacity: disabled ? .4 : pressed ? .6 : 1 }]}>{children}</Pressable>;
}

export function ConversationComposer({ value, onChange, locked, busy, running, stopDisabled, onSend, onStop, status, expanded = false }: { value: string; onChange: (value: string) => void; locked: boolean; busy: boolean; running: boolean; stopDisabled: boolean; onSend: () => void; onStop: () => void; status?: string; expanded?: boolean }) {
  const { colors } = useTheme(), [height, setHeight] = useState(36), input = useRef<ComponentRef<typeof TextInput>>(null);
  const resizeWeb = () => {
    if (Platform.OS !== 'web') return;
    // RN-web exposes the textarea host here. Reset its height before reading
    // scrollHeight so deleting text can shrink as well as grow the composer.
    const node = input.current as unknown as { style?: { height: string }; scrollHeight?: number } | null;
    if (!node?.style || typeof node.scrollHeight !== 'number') return;
    node.style.height = 'auto';
    const next = assistantComposerHeight(node.scrollHeight);
    node.style.height = `${next}px`; setHeight(next);
  };
  useEffect(() => { if (!value) setHeight(36); resizeWeb(); }, [value]);
  const canSend = !locked && !!value.trim();
  const send = () => { if (canSend) onSend(); };
  return <View style={{ gap: 8 }}>
    {status ? <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: colors.muted, paddingHorizontal: 4 }]}>{status}</Text> : null}
    <View style={[styles.composer, { borderColor: colors.border }]}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}><Glass style={[StyleSheet.absoluteFill, { borderRadius: 28 }, !expanded && { backgroundColor: colors.surface }]} /></View>
      <TextInput ref={input} accessibilityLabel="Ask Assistant" accessibilityHint={Platform.OS === 'web' ? 'Enter to send. Shift and Enter for a new line.' : 'Write your question, then use Send question.'} value={value} onChangeText={onChange} multiline maxLength={4000} editable={!locked} placeholder="Ask anything…" placeholderTextColor={colors.muted} underlineColorAndroid="transparent" textAlignVertical="top" onLayout={resizeWeb} onContentSizeChange={event => { if (Platform.OS !== 'web') setHeight(assistantComposerHeight(event.nativeEvent.contentSize.height)); }}
        {...(Platform.OS === 'web' ? { numberOfLines: 1, onKeyPress: (event: { nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean }; preventDefault?: () => void }) => { if (assistantShouldSendKey(event.nativeEvent, canSend)) { event.preventDefault?.(); send(); } } } : {})}
        style={[styles.input, { color: colors.ink, height }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={running ? 'Stop request' : 'Send question'} accessibilityState={{ disabled: running ? stopDisabled : !canSend, busy }} disabled={running ? stopDisabled : !canSend} onPress={running ? onStop : send} style={({ pressed }) => [styles.sendButton, { backgroundColor: running ? colors.row : colors.action, opacity: (running ? stopDisabled : !canSend) ? .45 : pressed ? .7 : 1 }]}>
        {busy ? <BrandLoadingIcon size={20} onFilledAction={!running} /> : running ? <SquareIcon size={17} weight="fill" color={colors.ink} /> : <ArrowUpIcon size={22} color={colors.onAction} weight="bold" />}
      </Pressable>
    </View>
  </View>;
}

export function ConversationHistory({ visible, onClose, onDismiss, threads, currentId, loading, canSelect, onSelect, children }: PropsWithChildren<{ visible: boolean; onClose: () => void; onDismiss: () => void; threads: readonly ThreadSummary[]; currentId: string; loading: boolean; canSelect: boolean; onSelect: (id: string) => void }>) {
  const { colors } = useTheme(), closeButton = useRef<ComponentRef<typeof Pressable>>(null);
  const focusClose = () => {
    if (Platform.OS === 'web') (closeButton.current as unknown as { focus?: () => void } | null)?.focus?.();
    else { const node = findNodeHandle(closeButton.current); if (typeof node === 'number') AccessibilityInfo.setAccessibilityFocus(node); }
  };
  // RN-web activates its own Escape/focus trap at onShow. Avoid making modal
  // accessibility depend on an optional browser CSS animationend event.
  return <MotionModal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} presentationStyle="pageSheet" accessibilityLabel="Conversations" accessibilityViewIsModal onShow={focusClose} onDismiss={onDismiss} onRequestClose={onClose}><SafeAreaProvider><SafeAreaView accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }}>
    <View style={styles.sheetHeader}><Text accessibilityRole="header" aria-level={1} style={[styles.sheetTitle, { color: colors.ink }]}>Conversations</Text><UtilityButton label="Close conversation history" controlRef={closeButton} onPress={onClose}><XIcon size={21} color={colors.ink} /></UtilityButton></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
      <Text style={[styles.caption, { color: colors.muted }]}>Latest 20 conversations. Each conversation returns up to 50 turns.</Text>
      {loading ? <Loading label="Loading conversations…" /> : !threads.length ? <Empty title="No earlier conversations" /> : <View>{threads.map(thread => <Pressable key={thread.id} accessibilityRole="button" accessibilityState={{ selected: thread.id === currentId, disabled: !canSelect }} disabled={!canSelect} onPress={() => onSelect(thread.id)} style={({ pressed }) => [styles.thread, { borderColor: colors.border, backgroundColor: thread.id === currentId ? colors.row : 'transparent', opacity: pressed ? .65 : 1 }]}><Text numberOfLines={2} style={[styles.threadTitle, { color: colors.ink }]}>{thread.title}</Text><Text style={[styles.caption, { color: colors.muted }]}>{thread.id === currentId ? 'Current conversation · ' : ''}{new Date(thread.updated_at).toLocaleString()}</Text></Pressable>)}</View>}
      {!canSelect && threads.length ? <Text style={[styles.caption, { color: colors.muted }]}>Finish the current request or review before switching conversations.</Text> : null}
      {children}
    </ScrollView>
  </SafeAreaView></SafeAreaProvider></MotionModal>;
}

export function ConversationCanvas({ children, state, reviewRef, refreshing, onRefresh, historyOpen, historyDismissal, visible = true }: PropsWithChildren<{ state: AssistantScrollState; reviewRef: RefObject<ComponentRef<typeof View> | null>; refreshing: boolean; onRefresh: () => void; historyOpen: boolean; historyDismissal: number; visible?: boolean }>) {
  const { colors } = useTheme(), reduced = useReducedMotion();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null), content = useRef<ComponentRef<typeof View>>(null), previous = useRef<AssistantScrollState | null>(null), nearEnd = useRef(true), target = useRef<'review' | 'end' | null>(null), frame = useRef<number | undefined>(undefined), animateScroll = useRef(false);
  const offset = useRef(0), historyPosition = useRef<(AssistantScrollState & { offset: number }) | null>(null), historyState = useRef({ open: false, dismissal: historyDismissal }), restoring = useRef<number | null>(null);
  const visibleRef = useRef(visible), wasVisible = useRef(visible), collapsedPosition = useRef<(AssistantScrollState & { offset: number }) | null>(null);
  visibleRef.current = visible;
  const [pulled, setPulled] = useState(false);
  const applyScroll = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      if (!visibleRef.current) return;
      if (target.current === 'review' && reviewRef.current && content.current) {
        reviewRef.current.measureLayout(content.current, (_x, y) => { if (visibleRef.current && target.current === 'review') { scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: !reduced }); target.current = null; } }, () => {});
      } else if (restoring.current !== null) { scroll.current?.scrollTo({ y: restoring.current, animated: false }); restoring.current = null; }
      else if (target.current === 'end') { scroll.current?.scrollToEnd({ animated: animateScroll.current && !reduced }); target.current = null; }
    });
  };
  useEffect(() => { target.current = assistantScrollTarget(previous.current, state, nearEnd.current); animateScroll.current = previous.current !== null && previous.current.threadId === state.threadId; previous.current = state; if (target.current) { restoring.current = null; applyScroll(); } }, [state.threadId, state.latestId, state.status, state.reviewId]);
  useEffect(() => {
    if (!visible && wasVisible.current) collapsedPosition.current = { ...state, offset: offset.current };
    if (visible && !wasVisible.current) {
      const resume = assistantExpandedScroll(collapsedPosition.current, state);
      target.current = resume.target; restoring.current = resume.offset; animateScroll.current = false; applyScroll();
    }
    wasVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    const before = historyState.current;
    if (historyOpen && !before.open) historyPosition.current = { ...state, offset: offset.current };
    if (!historyOpen && (before.open || before.dismissal !== historyDismissal)) {
      const saved = assistantHistoryRestoreOffset(historyPosition.current, state);
      // A newly received action/recovery warning keeps priority over a restored
      // reading position. Closing history alone never selects another thread.
      if (saved !== null && target.current === null) { restoring.current = saved; applyScroll(); }
    }
    historyState.current = { open: historyOpen, dismissal: historyDismissal };
  }, [historyOpen, historyDismissal, state.threadId, state.latestId, state.status, state.reviewId]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => { if (!refreshing) setPulled(false); }, [refreshing]);
  useEffect(() => { const event = Keyboard.addListener('keyboardDidShow', () => { if (visibleRef.current && nearEnd.current && !state.reviewId) { target.current = 'end'; applyScroll(); } }); return () => event.remove(); }, [reduced, state.reviewId]);
  const Container = Platform.OS === 'ios' ? ScrollViewMarker : View;
  return <Container style={styles.canvas}><ScrollView ref={scroll} style={styles.canvas} contentContainerStyle={styles.transcript} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets={false} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" scrollEventThrottle={32} onScroll={event => { if (!visibleRef.current) return; const { contentSize, contentOffset, layoutMeasurement } = event.nativeEvent; offset.current = Math.max(0, contentOffset.y); nearEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }} onScrollBeginDrag={() => { target.current = null; restoring.current = null; }} onContentSizeChange={() => { if (!visibleRef.current) return; if (target.current || restoring.current !== null) applyScroll(); else if (!historyOpen && nearEnd.current && !state.reviewId) scroll.current?.scrollToEnd({ animated: false }); }} refreshControl={<RefreshControl refreshing={pulled && refreshing} onRefresh={() => { setPulled(true); onRefresh(); }} tintColor={colors.link} />}>
    <View ref={content} collapsable={false} style={styles.transcriptContent}>{children}</View>
  </ScrollView></Container>;
}

export function ConversationTurn({ question, latest, children }: PropsWithChildren<{ question: string; latest: boolean }>) {
  const { colors } = useTheme();
  return <View style={styles.turn}><View style={[styles.question, { backgroundColor: colors.row }]}><Text selectable style={[styles.body, { color: colors.ink }]}>{question}</Text></View>
    {latest ? <View style={styles.latestMark}><AssistantMark size={26} /></View> : null}
    <View style={[latest ? styles.latestAnswer : styles.earlierAnswer, latest && { borderColor: colors.sky, backgroundColor: colors.surfaceSoft }]}>{children}</View>
  </View>;
}

export function ConversationEmpty() {
  const { colors } = useTheme();
  return <View style={styles.empty}><AssistantMark size={48} /><Text accessibilityRole="header" aria-level={2} style={[styles.emptyTitle, { color: colors.ink }]}>What would you like to know?</Text><Text style={[styles.caption, { color: colors.muted }]}>Ask about your campus or prepare a change for review.</Text></View>;
}

/** Compact dock is a preview above visible navigation, never another editor. */
export function ConversationBubble({ children, onExpand, onClose, source, hasChart = false, visible = true, minimizedLabel, copyControl, availableHeight }: PropsWithChildren<{ onExpand: () => void; onClose?: () => void; source?: React.ReactNode; hasChart?: boolean; visible?: boolean; minimizedLabel?: string; copyControl?: React.ReactNode; availableHeight?: number }>) {
  const { colors } = useTheme(), { height } = useWindowDimensions();
  const frameHeight = availableHeight && availableHeight > 0 ? availableHeight : height;
  const [keyboardVisible, setKeyboardVisible] = useState(() => Platform.OS !== 'web' && !!Keyboard.metrics());
  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = window.visualViewport;
      const update = () => setKeyboardVisible(!!viewport && viewport.scale === 1 && window.innerHeight > viewport.height + viewport.offsetTop);
      update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
      return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
    }
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  // Page owns actual IME avoidance. While that frame is reduced, collapse only
  // this optional preview: its same mounted editor and Expand/Close stay usable.
  // No fixed keyboard height or duplicated bottom inset is reserved here.
  return <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border, display: visible ? 'flex' : 'none' }]} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
    <View style={styles.bubbleHeader}><AssistantMark size={24} />{keyboardVisible && minimizedLabel ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.caption, { color: colors.muted, flex: 1 }]}>{minimizedLabel}</Text> : <View style={{ flex: 1 }} />}{copyControl}<UtilityButton label="Expand Assistant" hint="Read the complete conversation." onPress={onExpand}><ArrowsOutSimpleIcon size={18} color={colors.muted} /></UtilityButton>{onClose ? <UtilityButton label="Close Assistant" onPress={onClose}><XIcon size={20} color={colors.muted} /></UtilityButton> : null}</View>
    <ScrollView style={{ minHeight: 0, flexShrink: 1, maxHeight: Math.min(hasChart ? 410 : 244, frameHeight * (hasChart ? .46 : .3)), display: keyboardVisible ? 'none' : 'flex' }} accessibilityElementsHidden={keyboardVisible} importantForAccessibility={keyboardVisible ? 'no-hide-descendants' : 'auto'} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>{children}</ScrollView>
    {source ? <View style={{ paddingTop: 4, display: keyboardVisible ? 'none' : 'flex' }} accessibilityElementsHidden={keyboardVisible} importantForAccessibility={keyboardVisible ? 'no-hide-descendants' : 'auto'}>{source}</View> : null}
  </View>;
}

export function CompactAnswer({ text, chart, onExpand }: { text: string; chart?: AgentChartData; onExpand: () => void }) {
  const { colors } = useTheme();
  const value = assistantCompactText(text, chart);
  return <Pressable accessibilityRole="button" accessibilityLabel="Open full conversation" accessibilityHint="Read the complete answer and its source details." onPress={onExpand} style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center', opacity: pressed ? .7 : 1 }]}><Text numberOfLines={chart ? 2 : 3} style={[styles.body, { color: colors.ink }]}>{assistantInline(value).map((part, index) => <Text key={index} style={[part.bold && { fontWeight: '700' }, part.italic && { fontStyle: 'italic' }]}>{part.text}</Text>)}</Text></Pressable>;
}

export function ConversationSource({ source, title = source.title, onNavigate }: { source: AgentSource; title?: string; onNavigate: (href: string) => void }) {
  const { colors } = useTheme(), enabled = isInternalHref(source.href);
  const contents = <><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={[styles.caption, { color: enabled ? colors.link : colors.ink, fontWeight: '600', flexShrink: 1 }]}>{title}</Text>{enabled ? <ArrowRightIcon size={16} color={colors.link} /> : null}</View><Text style={[styles.caption, { color: colors.muted }]}>Checked {new Date(source.retrieved_at).toLocaleString()}</Text></>;
  return enabled ? <Pressable accessibilityRole="button" onPress={() => onNavigate(source.href)} style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center', gap: 4, opacity: pressed ? .65 : 1 }]}>{contents}</Pressable> : <View style={{ gap: 4 }}>{contents}</View>;
}

export function AssistantAnswer({ text, chart }: { text: string; chart?: AgentChartData }) {
  const { colors } = useTheme(), blocks = assistantTextBlocks(prepareNativeAssistantText(text, chart));
  const inline = (value: string) => assistantInline(value).map((part, index) => <Text key={index} style={[part.bold && { fontWeight: '700' }, part.italic && { fontStyle: 'italic' }, part.code && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, backgroundColor: colors.row }]}>{part.text}</Text>);
  return <View style={styles.answerText}>{blocks.map((block, index) => block.kind === 'list' ? <View key={index} style={{ gap: 6 }}>{block.items!.map((item, itemIndex) => <View key={itemIndex} style={styles.listItem}><Text style={[styles.body, styles.listMarker, { color: colors.ink }]}>{item.marker}</Text><Text selectable style={[styles.body, { color: colors.ink, flex: 1 }]}>{inline(item.text)}</Text></View>)}</View> : <Text key={index} selectable accessibilityRole={block.kind === 'heading' ? 'header' : undefined} aria-level={block.kind === 'heading' ? 3 : undefined} style={[styles.body, { color: colors.ink }, block.kind === 'heading' && styles.answerHeading, block.kind === 'quote' && { color: colors.muted, borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 12 }, block.kind === 'code' && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, backgroundColor: colors.row, padding: 8 }]}>{block.kind === 'code' ? block.text : inline(block.text ?? '')}</Text>)}</View>;
}

const styles = StyleSheet.create({
  toolbar: { width: '100%', maxWidth: 720, alignSelf: 'center', minHeight: 44, paddingLeft: 20, paddingRight: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, toolbarTitle: { flex: 1, fontSize: 14, lineHeight: 21 }, toolbarActions: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', justifyContent: 'flex-end', gap: 2 }, utilityButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  caption: { fontSize: 14, lineHeight: 21 }, body: { fontSize: 16, lineHeight: 25 },
  composer: { minHeight: 56, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 18, paddingRight: 5, paddingVertical: 5, flexDirection: 'row', alignItems: 'flex-end', gap: 8, overflow: 'hidden' }, input: { flex: 1, minWidth: 0, minHeight: 36, maxHeight: 96, fontSize: 16, lineHeight: 24, paddingVertical: 6, paddingHorizontal: 0, alignSelf: 'center' }, sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1, minHeight: 0 }, transcript: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 12 }, transcriptContent: { width: '100%', maxWidth: 680, alignSelf: 'center', flexGrow: 1, gap: 28 }, turn: { gap: 16 }, question: { maxWidth: '88%', alignSelf: 'flex-end', borderRadius: 28, paddingVertical: 12, paddingHorizontal: 16 }, latestMark: { paddingLeft: 16, minHeight: 30, justifyContent: 'center', marginBottom: -8 }, latestAnswer: { borderRadius: 28, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 16 }, earlierAnswer: { paddingHorizontal: 4, gap: 16 },
  empty: { flexGrow: 1, justifyContent: 'center', alignItems: 'flex-start', gap: 12, paddingVertical: 28, paddingHorizontal: 4 }, emptyTitle: { fontSize: 20, lineHeight: 27, fontWeight: '600' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 12, paddingVertical: 8 }, sheetTitle: { flex: 1, fontSize: 20, lineHeight: 27, fontWeight: '600' }, sheetContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, gap: 16 }, thread: { minHeight: 72, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 4 }, threadTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  answerText: { gap: 12 }, answerHeading: { fontSize: 16, lineHeight: 25, fontWeight: '700' }, listItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, listMarker: { minWidth: 14 },
  bubble: { minHeight: 0, flexShrink: 1, borderRadius: 28, borderWidth: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 4 }, bubbleHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  copyControl: { minHeight: 44, minWidth: 44, maxWidth: '100%', flexShrink: 1, paddingHorizontal: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
