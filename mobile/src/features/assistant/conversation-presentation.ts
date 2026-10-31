import type { AgentChartData, AgentRun, AgentSource } from '../../../../packages/contracts/src/wire/features/assistant/agentApi';

export type AssistantInline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type AssistantTextBlock = {
  kind: 'paragraph' | 'heading' | 'quote' | 'code' | 'list';
  text?: string;
  items?: { marker: string; text: string }[];
};

const bullet = /^\s*[-*•]\s+(.+)$/;
const punctuationOnly = /^[\s,;:.!?*#_-]+$/;
const plain = (value: string) => value.replace(/[*_`#]/g, '').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim();
const markdownSafe = (value: string) => value.replace(/[\\`*_{}\[\]()#+.!|\-]/g, '\\$&');
const valueLabel = (chart: AgentChartData, value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value) + (chart.unit === 'percent' ? '%' : '');

function verifiedChartSummary(chart: AgentChartData) {
  const values = chart.points.filter((point): point is typeof point & { value: number } => point.value !== null);
  const partial = chart.shown < chart.total, missing = values.length < chart.points.length;
  if (!values.length) return partial ? 'No recorded data is available in this shown view.' : 'No recorded data is available for this period.';
  if (chart.kind === 'line') return `${partial ? 'Latest shown recorded value' : 'Latest recorded value'}: **${valueLabel(chart, values.at(-1)!.value)}**.`;
  const ordered = [...values].sort((a, b) => b.value - a.value), highest = ordered[0]!, lowest = ordered.at(-1)!;
  if (chart.kind === 'donut') return `${partial ? 'Largest shown group' : missing ? 'Largest recorded group' : 'Largest group'}: ${markdownSafe(highest.label)}, **${valueLabel(chart, highest.value)}**.`;
  if (values.length === 1) return `${markdownSafe(highest.label)} is **${valueLabel(chart, highest.value)}**.`;
  if (highest.value === lowest.value) return `All ${partial ? 'shown recorded' : 'recorded'} values are **${valueLabel(chart, highest.value)}**.`;
  return `${partial ? 'Among the shown recorded values, ' : missing ? 'Among the recorded values, ' : ''}${markdownSafe(highest.label)} is highest at **${valueLabel(chart, highest.value)}**. ${markdownSafe(lowest.label)} is lowest at **${valueLabel(chart, lowest.value)}**.`;
}

function duplicatesVerifiedChart(block: string, chart: AgentChartData) {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(line => bullet.test(line))) return false;
  return lines.every(line => {
    const item = plain(line.replace(bullet, '$1')), colon = item.indexOf(':');
    if (colon < 1) return false;
    const matches = chart.points.filter(point => plain(point.label).toLocaleLowerCase() === item.slice(0, colon).trim().toLocaleLowerCase());
    if (matches.length !== 1) return false;
    const reading = item.slice(colon + 1).trim().replace(/[.]$/, ''), value = matches[0]!.value;
    // Remove only exact verified duplicates. A conflicting answer remains visible.
    if (value === null) return /^(?:not recorded|n\/?a)$/i.test(reading);
    return /^-?\d+(?:\.\d+)?%?$/.test(reading) && Number(reading.replace(/%$/, '')) === value && (chart.unit === 'percent' || !reading.endsWith('%'));
  });
}

/** Same active web narration treatment, with exact-value checking before deduplication. */
export function prepareNativeAssistantText(text: string, chart?: AgentChartData) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(block => block.trim()).filter(block => block && !punctuationOnly.test(block));
  const concise = blocks.flatMap(block => {
    if (chart && duplicatesVerifiedChart(block, chart)) return [];
    if (block.split('\n').some(line => bullet.test(line))) return [block];
    const sentences = block.split(/(?<=[.!?])\s+/).filter(sentence => !chart || !/(?:chart|graph) (?:has been|was|is) (?:generated|created|provided|shown)|(?:please )?(?:review|see|check) the (?:chart|graph)|(?:figures|data|attendance).*(?:summari[sz]ed|shown) below|figures.*(?:estimated|projected).*(?:attendance|lessons|records)|for (?:a )?visual comparison/.test(plain(sentence).toLowerCase()));
    const cleaned = sentences.join(' ').trim();
    return cleaned && !punctuationOnly.test(cleaned) ? [cleaned] : [];
  }).join('\n\n').trim();
  return chart && !concise ? verifiedChartSummary(chart) : concise;
}

/** Bounded native text tokens: no executable HTML, images, or model-authored links. */
export function assistantInline(text: string, depth = 0): AssistantInline[] {
  if (depth > 3) return [{ text }];
  const tokens: AssistantInline[] = [];
  const pattern = /\\([\\`*_{}\[\]()#+.!|\-])|!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)|<((?:https?:\/\/|mailto:)[^>]+)>|<\/?[A-Za-z][^>]*>|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) tokens.push({ text: text.slice(start, match.index) });
    if (match[1]) tokens.push({ text: match[1] });
    else if (match[2]) tokens.push(...assistantInline(match[2], depth + 1));
    else if (match[3]) tokens.push({ text: match[3] });
    else if (match[4]) tokens.push({ text: match[4], code: true });
    else if (match[5] || match[6]) tokens.push(...assistantInline(match[5] ?? match[6], depth + 1).map(token => ({ ...token, bold: true })));
    else if (match[7] || match[8]) tokens.push(...assistantInline(match[7] ?? match[8], depth + 1).map(token => ({ ...token, italic: true })));
    start = match.index! + match[0].length;
  }
  if (start < text.length) tokens.push({ text: text.slice(start) });
  return tokens;
}

export function assistantTextBlocks(text: string): AssistantTextBlock[] {
  const blocks: AssistantTextBlock[] = [], lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [], list: { marker: string; text: string }[] = [], code: string[] | null = null;
  const flush = () => {
    if (paragraph.length) { blocks.push({ kind: 'paragraph', text: paragraph.join('\n') }); paragraph = []; }
    if (list.length) { blocks.push({ kind: 'list', items: list }); list = []; }
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { flush(); if (code) { blocks.push({ kind: 'code', text: code.join('\n') }); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/), quote = line.match(/^\s*>\s?(.*)$/), item = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.+)$/);
    if (heading || quote) { flush(); blocks.push({ kind: heading ? 'heading' : 'quote', text: heading?.[1] ?? quote![1] }); }
    else if (item) { if (paragraph.length) flush(); list.push({ marker: item[2] ? `${item[2]}.` : '•', text: item[3] }); }
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush();
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}

export function assistantRunAnswer(run: Pick<AgentRun, 'status' | 'progress' | 'answer'>) {
  if (run.status === 'running') return `${run.progress || 'Checking your request'}…`;
  if (run.answer.trim()) return run.answer;
  return run.status === 'cancelled' ? 'Request stopped.' : run.status === 'failed' ? 'The request stopped before an answer was recorded.' : run.status === 'confirmation' ? 'Review the proposed change below.' : 'No answer was recorded.';
}

export function assistantSourceLabel(title: string) { return /attendance/i.test(title) ? 'View attendance' : /(?:result|score)/i.test(title) ? 'View results' : 'View details'; }

/** Cached data comes only from useApi's exact current account/campus/world key. */
export function assistantPreferenceState(input: { enabled: unknown; pending: boolean; failed: boolean; statusCode?: number }): 'ready' | 'paused' | 'denied' | 'off' | 'loading' | 'error' {
  if (input.failed && (input.statusCode === 401 || input.statusCode === 403)) return 'denied';
  if (input.enabled === false) return 'off';
  if (input.enabled === true) return input.failed ? 'paused' : 'ready';
  return input.pending ? 'loading' : 'error';
}

export const assistantComposerHeight = (height: number) => Number.isFinite(height) ? Math.max(36, Math.min(96, height)) : 36;

/** Recheck immediately before each server write after asynchronous preparation. */
export function assertAssistantWriteReady(paused: boolean) {
  if (paused) throw new Error('Account preference verification is paused. Retry the access check before sending a request or decision.');
}

/** Keyboard Return on a phone inserts a line; a web keyboard can explicitly submit. */
export function assistantShouldSendKey(event: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean }, enabled: boolean) {
  return enabled && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !event.repeat;
}

export type AssistantScrollState = { threadId: string; latestId: string; status: string; reviewId: string };
export function assistantScrollTarget(previous: AssistantScrollState | null, next: AssistantScrollState, nearEnd: boolean): 'review' | 'end' | null {
  const changedThread = previous?.threadId !== next.threadId, newTurn = previous?.latestId !== next.latestId;
  if (next.reviewId && (changedThread || previous?.reviewId !== next.reviewId)) return 'review';
  if (changedThread || newTurn || nearEnd && previous?.status !== next.status) return 'end';
  return null;
}

export interface AssistantConversationChangeSnapshot { source: string; question: string; blocked: boolean }
/** Only a fresh explicit canonical activation selects a linked thread. The
 * host keeps this revision unchanged for Close/reopen and source Back, so those
 * presentation changes never replace a person's current selection or draft. */
export function assistantLinkedThreadRequest(observedRevision: number, requestRevision: number, requested: string | null, currentThread: string) {
  return Number.isSafeInteger(requestRevision) && requestRevision > observedRevision && requested && requested !== currentThread ? { id: requested, revision: requestRevision } : null;
}
/** A local New/history selection can lose a draft without removing its route.
 * Approve only this unchanged question/source, then recheck current busy/recovery
 * state after the asynchronous platform confirmation. No command is replayed. */
export async function prepareAssistantConversationChange(input: {
  read(): AssistantConversationChangeSnapshot | null;
  assertCurrent(): void;
  confirmDiscard(): Promise<boolean>;
  commit(): void;
}): Promise<boolean> {
  try {
    input.assertCurrent();
    const before = input.read();
    if (!before || before.blocked) return false;
    if (before.question.trim() && !await input.confirmDiscard()) return false;
    input.assertCurrent();
    const after = input.read();
    if (!after || after.blocked || after.source !== before.source || after.question !== before.question) return false;
    input.commit(); return true;
  } catch { return false; }
}

export function assistantHistoryRestoreOffset(saved: (AssistantScrollState & { offset: number }) | null, current: AssistantScrollState): number | null {
  return saved && Number.isFinite(saved.offset) && saved.offset >= 0 && saved.threadId === current.threadId && saved.latestId === current.latestId && saved.status === current.status && saved.reviewId === current.reviewId ? saved.offset : null;
}

/** A hidden transcript cannot consume a review/scroll target against zero-size
 * layout. Expanding prioritizes current recovery/review, then an unchanged
 * reading position; a different turn or thread is shown from its current end. */
export function assistantExpandedScroll(saved: (AssistantScrollState & { offset: number }) | null, current: AssistantScrollState) {
  if (current.reviewId) return { target: 'review' as const, offset: null };
  const offset = assistantHistoryRestoreOffset(saved, current);
  return { target: offset === null ? 'end' as const : null, offset };
}

/** A preview is only a presentation of this authorized thread's current turn.
 * Pending/executing reviews stay discoverable even if another retained turn is
 * last. It never borrows an older chart for a new answer or approves an action. */
export function assistantCompactSelection(runs: readonly AgentRun[]) {
  const latest = runs.at(-1) ?? null;
  const reviewRun = runs.find(run => run.action?.status === 'pending') ?? runs.find(run => run.action?.status === 'executing') ?? null;
  const chartSource = latest?.status === 'completed' ? latest.evidence.filter(source => source.chart).at(-1) ?? null : null;
  const source: AgentSource | null = chartSource ?? latest?.evidence.at(-1) ?? null;
  return { latest, reviewRun, chartSource, source };
}

/** Verification/recovery has priority over a retained successful reply. This
 * presentation decision never changes the conversation, draft or command. */
export function assistantCompactPresentation(runs: readonly AgentRun[], context: { attention: boolean; loading: boolean }) {
  const selected = assistantCompactSelection(runs), action = selected.reviewRun?.action ?? selected.latest?.action ?? null;
  const needsReview = !!selected.reviewRun || !!action && ['uncertain', 'failed', 'expired', 'stale'].includes(action.status);
  const mode = context.attention ? 'attention' : context.loading ? 'loading' : needsReview ? 'review' : selected.latest ? 'answer' : 'welcome';
  return { mode, latest: selected.latest, action, chartSource: mode === 'answer' ? selected.chartSource : null, source: mode === 'answer' ? selected.source : null };
}

export function assistantCompactText(text: string, chart?: AgentChartData) {
  const first = assistantTextBlocks(prepareNativeAssistantText(text, chart))[0];
  if (!first) return '';
  return first.kind === 'list' ? first.items!.map(item => `${item.marker} ${item.text}`).join('\n') : first.text ?? '';
}

/** Apply the preview cap after full-source chart classification. Incomplete
 * donut partitions therefore become honest bounded bars rather than a whole. */
export function assistantChartDisplayPoints(chart: AgentChartData, kind: AgentChartData['kind'], compact: boolean) {
  return compact && kind === 'bar' ? chart.points.slice(0, 4) : chart.points;
}
