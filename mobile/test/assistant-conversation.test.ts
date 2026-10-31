import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAssistantWriteReady, assistantChartDisplayPoints, assistantCompactPresentation, assistantCompactSelection, assistantCompactText, assistantComposerHeight, assistantExpandedScroll, assistantHistoryRestoreOffset, assistantInline, assistantLinkedThreadRequest, assistantPreferenceState, assistantRunAnswer, assistantScrollTarget, assistantShouldSendKey, assistantSourceLabel, assistantTextBlocks, prepareAssistantConversationChange, prepareNativeAssistantText, type AssistantConversationChangeSnapshot, type AssistantScrollState } from '../src/features/assistant/conversation-presentation';
import type { AgentAction, AgentChartData, AgentRun, AgentSource } from '../../packages/contracts/src/wire/features/assistant/agentApi';
import { assistantChartKind } from '../src/lib/assistant-policy';
import { dispatchAssistantCommand, type AssistantCommand } from '../src/lib/assistant-command';

const chart: AgentChartData = { kind: 'bar', title: 'Recorded participation', scope: 'Selected learner only', from: '2026-10-01', to: '2026-10-29', unit: 'records', points: [{ label: 'Present', value: 0, detail: 'Zero recorded present' }, { label: 'Absent', value: 2, detail: 'Two recorded absent' }, { label: 'Unknown', value: null, detail: 'No reading' }], total: 3, shown: 3, note: 'Saved source records, with missing readings kept unknown.' };
const textOf = (text: string) => assistantInline(text).map(part => part.text).join('');

test('native text keeps headings, lists, quoted context and code distinct without turning them into page titles', () => {
  assert.deepEqual(assistantTextBlocks('## Recorded result\n\nPlease **check** the source.\n\n- Recorded zero\n- Not recorded\n\n3. Review\n4. Confirm\n\n> A source qualification\n\n```text\n<record>0</record>\n```'), [
    { kind: 'heading', text: 'Recorded result' }, { kind: 'paragraph', text: 'Please **check** the source.' },
    { kind: 'list', items: [{ marker: '•', text: 'Recorded zero' }, { marker: '•', text: 'Not recorded' }] },
    { kind: 'list', items: [{ marker: '3.', text: 'Review' }, { marker: '4.', text: 'Confirm' }] },
    { kind: 'quote', text: 'A source qualification' }, { kind: 'code', text: '<record>0</record>' },
  ]);
});

test('model text is inert: links retain only their label, images disappear and raw HTML never becomes a native component', () => {
  const tokens = assistantInline('Read [this record](javascript:alert) or <https://example.invalid/record>. ![tracking](https://example.invalid/pixel) <b>Source</b><script>run()</script>');
  assert.equal(tokens.map(part => part.text).join(''), 'Read this record or https://example.invalid/record.  Sourcerun()');
  assert.ok(tokens.every(part => Object.keys(part).every(key => ['text', 'bold', 'italic', 'code'].includes(key))));
  assert.ok(!JSON.stringify(tokens).includes('javascript:'));
  assert.equal(textOf('`<script>inert</script>`'), '<script>inert</script>', 'An explicit code example remains selectable inert text');
});

test('comparison operators remain visible evidence rather than being mistaken for HTML', () => {
  assert.equal(textOf('Attendance < 75% needs review; marks > 90% are strong.'), 'Attendance < 75% needs review; marks > 90% are strong.');
  assert.equal(textOf('Math: 1 < 2 and 3 > 2.'), 'Math: 1 < 2 and 3 > 2.');
});

test('inline emphasis, escaped punctuation and backticks preserve the original words', () => {
  assert.deepEqual(assistantInline('A **bold** and *soft* `0%` result.'), [{ text: 'A ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'soft', italic: true }, { text: ' ' }, { text: '0%', code: true }, { text: ' result.' }]);
  assert.equal(textOf('Group \\[A\\] has \\*literal\\* symbols.'), 'Group [A] has *literal* symbols.');
  assert.equal(textOf('Unknown ~~syntax~~ stays readable.'), 'Unknown ~~syntax~~ stays readable.');
});

test('unfinished code fences and an ordinary URL retain readable content without executable navigation', () => {
  assert.deepEqual(assistantTextBlocks('Before\n\n```\nconst value = 0;'), [{ kind: 'paragraph', text: 'Before' }, { kind: 'code', text: 'const value = 0;' }]);
  assert.deepEqual(assistantInline('https://example.invalid/data'), [{ text: 'https://example.invalid/data' }]);
});

test('narration cleanup needs a verified chart; source qualifications and substantive prose remain', () => {
  const text = 'The chart was generated. Recorded evidence is partial.\n\n- Confirm with the campus record\n- Missing records are unknown';
  assert.equal(prepareNativeAssistantText(text), text);
  assert.equal(prepareNativeAssistantText(text, chart), 'Recorded evidence is partial.\n\n- Confirm with the campus record\n- Missing records are unknown');
  assert.equal(prepareNativeAssistantText('***\n\nRecorded zero is meaningful.\n\n---'), 'Recorded zero is meaningful.');
});

test('only exact chart duplicate readings are condensed, preserving zero, unknown and contradictory evidence', () => {
  const duplicates = '- Present: 0\n- Absent: 2\n- Unknown: Not recorded';
  assert.equal(prepareNativeAssistantText(`Recorded evidence is partial.\n\n${duplicates}`, chart), 'Recorded evidence is partial.');
  for (const different of ['- Present: 9\n- Absent: 2', '- Present: Not recorded\n- Absent: 2', '- Present: 0\n- Unknown: 0', '- Present: 0%\n- Absent: 2%', '- Present: 0\n- Other: 2']) {
    assert.equal(prepareNativeAssistantText(different, chart), different);
  }
  const duplicateLabel = { ...chart, points: [...chart.points, chart.points[0]!], total: 4, shown: 4 };
  assert.equal(prepareNativeAssistantText(duplicates, duplicateLabel), duplicates, 'Ambiguous labels cannot prove a duplicate');
});

test('a fully condensed reply summarizes verified chart values only and never turns missingness into zero', () => {
  assert.equal(prepareNativeAssistantText('- Present: 0\n- Absent: 2\n- Unknown: n/a', chart), 'Among the recorded values, Absent is highest at **2**. Present is lowest at **0**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...chart, kind: 'line', unit: 'percent' }), 'Latest recorded value: **2%**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...chart, points: chart.points.map(point => ({ ...point, value: null })) }), 'No recorded data is available for this period.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...chart, points: [{ label: 'A [source]*', value: 0, detail: '' }], total: 1, shown: 1 }), 'A \\[source\\]\\* is **0**.');
});

test('partial or unknown chart fallback summaries cannot claim an omitted group is smaller', () => {
  const partial = { ...chart, points: chart.points.slice(0, 2), total: 3, shown: 2 };
  assert.equal(prepareNativeAssistantText('Please see the chart.', partial), 'Among the shown recorded values, Absent is highest at **2**. Present is lowest at **0**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...partial, kind: 'donut' }), 'Largest shown group: Absent, **2**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...chart, kind: 'donut' }), 'Largest recorded group: Absent, **2**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...partial, kind: 'line' }), 'Latest shown recorded value: **2**.');
  assert.equal(prepareNativeAssistantText('Please see the chart.', { ...partial, points: partial.points.map(point => ({ ...point, value: null })) }), 'No recorded data is available in this shown view.');
});

test('running and terminal replies have truthful empty-answer presentation and preserve a recorded answer verbatim', () => {
  assert.equal(assistantRunAnswer({ status: 'running', progress: 'Checking your sources', answer: 'Stale answer' }), 'Checking your sources…');
  assert.equal(assistantRunAnswer({ status: 'running', progress: '', answer: '' }), 'Checking your request…');
  assert.equal(assistantRunAnswer({ status: 'cancelled', progress: '', answer: '' }), 'Request stopped.');
  assert.equal(assistantRunAnswer({ status: 'failed', progress: '', answer: '' }), 'The request stopped before an answer was recorded.');
  assert.equal(assistantRunAnswer({ status: 'confirmation', progress: '', answer: '' }), 'Review the proposed change below.');
  assert.equal(assistantRunAnswer({ status: 'completed', progress: '', answer: '  Exact recorded answer.\n' }), '  Exact recorded answer.\n');
});

test('web Enter sends once only when enabled; newline, IME and held keys cannot dispatch', () => {
  assert.equal(assistantShouldSendKey({ key: 'Enter' }, true), true);
  for (const event of [{ key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: 'a' }]) assert.equal(assistantShouldSendKey(event, true), false);
  assert.equal(assistantShouldSendKey({ key: 'Enter' }, false), false);
});

test('composer height can return to its one-line size, with a bounded scrollable multiline height', () => {
  assert.deepEqual([0, 20, 36, 72, 96, 400, NaN].map(assistantComposerHeight), [36, 36, 36, 72, 96, 96, 36]);
});

test('same-scope cached Pro keeps the conversation mounted during a transient verification failure and pauses writes', () => {
  assert.equal(assistantPreferenceState({ enabled: true, pending: false, failed: false }), 'ready');
  for (const statusCode of [undefined, 408, 429, 500, 503]) assert.equal(assistantPreferenceState({ enabled: true, pending: false, failed: true, statusCode }), 'paused');
  assert.equal(assistantPreferenceState({ enabled: true, pending: false, failed: false }), 'ready', 'A successful retry resumes the same component');
});

test('uncached scope, explicit opt-out and denied account authority cannot retain a conversation as authorized', () => {
  assert.equal(assistantPreferenceState({ enabled: undefined, pending: true, failed: false }), 'loading', 'A new useApi scope has no cached authorization');
  assert.equal(assistantPreferenceState({ enabled: undefined, pending: false, failed: true, statusCode: 503 }), 'error');
  assert.equal(assistantPreferenceState({ enabled: false, pending: false, failed: false }), 'off');
  for (const statusCode of [401, 403]) assert.equal(assistantPreferenceState({ enabled: true, pending: false, failed: true, statusCode }), 'denied');
  assert.equal(assistantPreferenceState({ enabled: 'true', pending: false, failed: false }), 'error');
});

test('preference verification lost during secure preparation prevents later thread/message/decision writes and keeps exact intent', async () => {
  const threadId = '00000000-0000-4000-8000-000000000001', clientId = '00000000-0000-4000-8000-000000000002', actionId = '00000000-0000-4000-8000-000000000003';
  const commands: AssistantCommand[] = [
    { kind: 'send', threadId: '', question: 'Original question', clientId },
    { kind: 'send', threadId, question: 'Original question', clientId },
    { kind: 'decision', threadId, actionId, decision: 'confirm' },
  ];
  for (const command of commands) {
    let paused = false, creates = 0, sends = 0, clears = 0, retained: AssistantCommand | null = null;
    await assert.rejects(dispatchAssistantCommand({ command, assertCurrent() {},
      async retain() { await Promise.resolve(); paused = true; }, retained(value) { retained = value; },
      async createThread() { assertAssistantWriteReady(paused); creates++; return { id: threadId }; },
      async dispatch() { assertAssistantWriteReady(paused); sends++; return {}; }, async clear() { clears++; },
    }), /verification is paused/);
    assert.deepEqual({ creates, sends, clears }, { creates: 0, sends: 0, clears: 0 });
    assert.deepEqual(retained, command.kind === 'send' && !command.threadId ? { ...command, phase: 'creating' } : command);
  }
});

test('an already accepted server receipt still reconciles and clears locally after verification becomes paused', async () => {
  const command: AssistantCommand = { kind: 'send', threadId: '00000000-0000-4000-8000-000000000001', clientId: '00000000-0000-4000-8000-000000000002', question: 'Original question' };
  let paused = false, sends = 0, clears = 0;
  const completed = await dispatchAssistantCommand({ command, assertCurrent() {}, async retain() {}, retained() {},
    async createThread() { throw new Error('Existing conversation must not be recreated'); },
    async dispatch() { assertAssistantWriteReady(paused); sends++; paused = true; return { run_id: '00000000-0000-4000-8000-000000000003' }; }, async clear() { clears++; },
  });
  assert.equal(completed.phase, 'accepted'); assert.equal(sends, 1); assert.equal(clears, 1);
  await dispatchAssistantCommand({ command: completed, assertCurrent() {}, async retain() {}, retained() {}, async createThread() { throw new Error('No new conversation'); }, async dispatch() { throw new Error('No repeated send'); }, async clear() { clears++; } });
  assert.equal(clears, 2);
});

const state: AssistantScrollState = { threadId: 'owned-thread', latestId: 'run-1', status: 'completed', reviewId: '' };
test('cold/history entry and an accepted new turn reveal the current transcript', () => {
  assert.equal(assistantScrollTarget(null, state, false), 'end');
  assert.equal(assistantScrollTarget(state, { ...state, threadId: 'explicitly-chosen-owned-thread' }, false), 'end');
  assert.equal(assistantScrollTarget(state, { ...state, latestId: 'run-2' }, false), 'end');
});

test('a newly pending action reveals its review; ordinary polling does not pull someone away from older evidence', () => {
  const reviewing = { ...state, status: 'confirmation', reviewId: 'exact-action' };
  assert.equal(assistantScrollTarget(state, reviewing, false), 'review');
  assert.equal(assistantScrollTarget(null, reviewing, false), 'review');
  assert.equal(assistantScrollTarget(reviewing, { ...reviewing }, true), null);
  assert.equal(assistantScrollTarget(state, { ...state, status: 'running' }, false), null);
  assert.equal(assistantScrollTarget(state, { ...state, status: 'running' }, true), 'end');
  assert.equal(assistantScrollTarget(state, { ...state }, true), null);
});

test('source link wording follows the actual supplied chart and never derives a new target', () => {
  assert.equal(assistantSourceLabel('Attendance over time'), 'View attendance');
  assert.equal(assistantSourceLabel('Published results'), 'View results');
  assert.equal(assistantSourceLabel('Scores by assessment'), 'View results');
  assert.equal(assistantSourceLabel('Recorded campus data'), 'View details');
});

test('New/history selection keeps even a one-character unsent question when discard is cancelled', async () => {
  let commits = 0, confirms = 0;
  const current = { source: 'exact-campus-and-owned-thread', question: 'Q', blocked: false };
  assert.equal(await prepareAssistantConversationChange({ read: () => current, assertCurrent() {}, async confirmDiscard() { confirms++; return false; }, commit() { commits++; } }), false);
  assert.equal(current.question, 'Q'); assert.equal(commits, 0); assert.equal(confirms, 1);
});

test('explicit discard authorizes only the unchanged local question; an empty draft needs no confirmation', async () => {
  for (const question of ['Q', 'Original unsent question', '   ', '']) {
    let commits = 0, confirms = 0;
    const current = { source: 'exact-campus-and-owned-thread', question, blocked: false };
    assert.equal(await prepareAssistantConversationChange({ read: () => current, assertCurrent() {}, async confirmDiscard() { confirms++; return true; }, commit() { commits++; } }), true);
    assert.equal(commits, 1); assert.equal(confirms, question.trim() ? 1 : 0);
  }
});

test('in-flight or retained recovery blocks a local conversation replacement before prompting or clearing anything', async () => {
  let commits = 0, confirms = 0;
  assert.equal(await prepareAssistantConversationChange({ read: () => ({ source: 'owned-thread', question: 'Exact retained question', blocked: true }), assertCurrent() {}, async confirmDiscard() { confirms++; return true; }, commit() { commits++; } }), false);
  assert.equal(commits, 0); assert.equal(confirms, 0);
});

test('late discard cannot clear a changed question, changed thread/scope, newly busy request or revoked target', async () => {
  const original = { source: 'campus-world-thread', question: 'Q', blocked: false };
  const changes: (AssistantConversationChangeSnapshot | null)[] = [{ ...original, question: 'A changed question' }, { ...original, source: 'another-thread' }, { ...original, source: 'another-campus-or-world' }, { ...original, blocked: true }, null];
  for (const changed of changes) {
    let current: AssistantConversationChangeSnapshot | null = original, commits = 0;
    assert.equal(await prepareAssistantConversationChange({ read: () => current, assertCurrent() {}, async confirmDiscard() { current = changed; return true; }, commit() { commits++; } }), false);
    assert.equal(commits, 0);
  }
});

test('source/focus/transport lease is rechecked after confirmation; stale dialogs perform no local transition', async () => {
  let active = true, commits = 0;
  assert.equal(await prepareAssistantConversationChange({ read: () => ({ source: 'owned-thread', question: 'Q', blocked: false }), assertCurrent() { if (!active) throw new Error('Original view lost focus'); }, async confirmDiscard() { active = false; return true; }, commit() { commits++; } }), false);
  assert.equal(commits, 0);
});

test('closing history restores only the same unchanged transcript reading position, preserving zero correctly', () => {
  assert.equal(assistantHistoryRestoreOffset({ ...state, offset: 317 }, state), 317);
  assert.equal(assistantHistoryRestoreOffset({ ...state, offset: 0 }, state), 0);
  assert.equal(assistantHistoryRestoreOffset(null, state), null);
  assert.equal(assistantHistoryRestoreOffset({ ...state, offset: NaN }, state), null);
  for (const next of [{ ...state, threadId: 'selected-another-thread' }, { ...state, latestId: 'new-turn' }, { ...state, status: 'confirmation' }, { ...state, reviewId: 'new-action-or-recovery-warning' }]) assert.equal(assistantHistoryRestoreOffset({ ...state, offset: 317 }, next), null);
});

const sourceFor = (id: string, chart?: AgentChartData): AgentSource => ({ id, title: id, href: `/areas/attendance/records?student_id=exact-learner&month=2026-10&source=${id}`, retrieved_at: '2026-10-29T12:00:00Z', capability: 'attendance.read', ...(chart ? { chart } : {}) });
const runFor = (id: string, fields: Partial<AgentRun> = {}): AgentRun => ({ id, question: 'Synthetic source question', answer: 'A recorded source answer.', status: 'completed', progress: '', provider: 'test', model: 'test', evidence: [], action: null, created_at: '2026-10-29T12:00:00Z', ...fields });
const actionFor = (status: AgentAction['status']): AgentAction => ({ id: 'exact-action', title: 'Review the selected record', status, input: { basis_id: 'exact-basis', body: { status: 'present' } }, labels: {}, href: '/areas/attendance/records?student_id=exact-learner&date=2026-10-29', expires_at: '2026-10-29T13:00:00Z', receipt: null });

test('compact preview selects only the current reply’s last chart and preserves exact authoritative source identity', () => {
  const older = runFor('old', { evidence: [sourceFor('old-chart', chart)] }), currentSource = sourceFor('current-last', { ...chart, title: 'Exact current chart' });
  const current = runFor('current', { evidence: [sourceFor('current-first', chart), currentSource, sourceFor('later-prose')] });
  const selected = assistantCompactSelection([older, current]);
  assert.equal(selected.latest, current); assert.equal(selected.chartSource, currentSource); assert.equal(selected.source, currentSource);
  assert.equal(selected.source?.href, '/areas/attendance/records?student_id=exact-learner&month=2026-10&source=current-last');
  for (const status of ['running', 'failed', 'cancelled', 'confirmation'] as const) assert.equal(assistantCompactSelection([older, { ...current, status }]).chartSource, null);
  assert.equal(assistantCompactSelection([older, runFor('new-answer')]).chartSource, null, 'An older chart must never decorate a newer answer');
  assert.deepEqual(assistantCompactSelection([]), { latest: null, reviewRun: null, chartSource: null, source: null });
});

test('compact access/recovery/load warnings cannot expose retained success charts or imply that a decision is confirmed', () => {
  const successful = runFor('success', { evidence: [sourceFor('verified', chart)] });
  for (const context of [{ attention: true, loading: false }, { attention: false, loading: true }, { attention: true, loading: true }]) {
    const preview = assistantCompactPresentation([successful], context);
    assert.equal(preview.chartSource, null); assert.equal(preview.source, null);
    assert.equal(preview.latest, successful, 'Presentation preserves the exact retained transcript');
    assert.equal(preview.mode, context.attention ? 'attention' : 'loading');
  }
  for (const status of ['pending', 'executing', 'uncertain', 'failed', 'expired', 'stale'] as const) {
    const action = actionFor(status), preview = assistantCompactPresentation([runFor('review', { action, evidence: [sourceFor('not-a-confirmation', chart)] })], { attention: false, loading: false });
    assert.equal(preview.mode, 'review'); assert.equal(preview.action, action); assert.equal(preview.chartSource, null); assert.equal(preview.source, null);
    assert.equal(preview.action?.href, action.href, 'A review source is the exact action target, not a derived learner route');
  }
});

test('an older pending or executing action remains discoverable before the latest ordinary reply', () => {
  const ordinary = runFor('newest', { evidence: [sourceFor('current-chart', chart)] });
  for (const status of ['pending', 'executing'] as const) {
    const review = runFor('earlier-review', { action: actionFor(status) }), preview = assistantCompactPresentation([review, ordinary], { attention: false, loading: false });
    assert.equal(preview.mode, 'review'); assert.equal(preview.action, review.action); assert.equal(preview.latest, ordinary); assert.equal(preview.chartSource, null);
  }
});

test('compact four-bar cap follows effective chart kind without altering source totals, zero, missingness or full data', () => {
  const many: AgentChartData = { ...chart, kind: 'donut', points: [...chart.points, { label: 'D', value: 3, detail: '' }, { label: 'E', value: 4, detail: '' }, { label: 'F', value: 5, detail: '' }], total: 9, shown: 6 };
  const before = JSON.stringify(many), kind = assistantChartKind(many);
  assert.equal(kind, 'bar', 'An incomplete whole is rendered as bars before capping');
  const compact = assistantChartDisplayPoints(many, kind, true);
  assert.equal(compact.length, 4); assert.deepEqual(compact.map(point => point.value), [0, 2, null, 3]);
  assert.equal(assistantChartDisplayPoints(many, kind, false), many.points);
  assert.equal(JSON.stringify(many), before); assert.equal(many.total, 9); assert.equal(many.shown, 6);
  const line = { ...many, kind: 'line' as const };
  assert.equal(assistantChartDisplayPoints(line, 'line', true), line.points, 'A time series keeps its recorded gaps and period');
});

test('compact prose stays inert and uses the full verified source when preparing a first-block summary', () => {
  assert.equal(textOf(assistantCompactText('First **source** paragraph [open](javascript:run).\n\nSecond paragraph.')), 'First source paragraph open.');
  assert.equal(assistantCompactText('- Present: 0\n- Absent: 2\n- Unknown: Not recorded', chart), 'Among the recorded values, Absent is highest at **2**. Present is lowest at **0**.');
  assert.equal(assistantCompactText('## Source qualification\n\n- Next detail'), 'Source qualification');
});

test('expansion restages hidden review/recovery before restoring an unchanged transcript position', () => {
  assert.deepEqual(assistantExpandedScroll({ ...state, offset: 317 }, state), { target: null, offset: 317 });
  assert.deepEqual(assistantExpandedScroll({ ...state, offset: 0 }, state), { target: null, offset: 0 });
  assert.deepEqual(assistantExpandedScroll(null, state), { target: 'end', offset: null });
  for (const reviewId of ['pending-exact-action', 'recovery:send:unconfirmed', 'access-check']) {
    assert.deepEqual(assistantExpandedScroll({ ...state, reviewId, offset: 317 }, { ...state, reviewId }), { target: 'review', offset: null });
  }
  for (const current of [{ ...state, threadId: 'another-owned-thread' }, { ...state, latestId: 'new-reply' }, { ...state, status: 'running' }]) assert.deepEqual(assistantExpandedScroll({ ...state, offset: 317 }, current), { target: 'end', offset: null });
});

test('Close/reopen, expansion and source return never replay a previously selected linked thread', () => {
  assert.equal(assistantLinkedThreadRequest(7, 7, 'previously-linked-thread', 'person-selected-another-thread'), null);
  assert.equal(assistantLinkedThreadRequest(7, 6, 'stale-linked-thread', 'current-thread'), null);
  for (const revision of [NaN, Infinity, 7.5]) assert.equal(assistantLinkedThreadRequest(7, revision, 'linked-thread', 'current-thread'), null);
});

test('a new explicit activation can request the same canonical linked thread again after another history selection', () => {
  assert.deepEqual(assistantLinkedThreadRequest(7, 8, 'previously-linked-thread', 'person-selected-another-thread'), { id: 'previously-linked-thread', revision: 8 });
  assert.equal(assistantLinkedThreadRequest(7, 8, 'current-thread', 'current-thread'), null, 'Opening the same current thread loses no question');
  assert.equal(assistantLinkedThreadRequest(7, 8, null, 'current-thread'), null, 'A plain full-page activation does not invent a New command');
});

test('a linked thread intent still cannot replace a draft without unchanged owned-source approval', async () => {
  const requested = assistantLinkedThreadRequest(7, 8, 'exact-linked-thread', 'current-thread')!;
  let current = { source: 'exact-active-host-current-thread', question: 'Q', blocked: false }, chosen = 'current-thread', writes = 0;
  const trySelect = (discard: boolean) => prepareAssistantConversationChange({ read: () => current, assertCurrent() {}, async confirmDiscard() { return discard; }, commit() { chosen = requested.id; } });
  assert.equal(await trySelect(false), false); assert.equal(chosen, 'current-thread'); assert.equal(current.question, 'Q');
  assert.equal(await prepareAssistantConversationChange({ read: () => current, assertCurrent() {}, async confirmDiscard() { current = { ...current, blocked: true }; return true; }, commit() { writes++; chosen = requested.id; } }), false);
  assert.equal(writes, 0); assert.equal(chosen, 'current-thread');
  current = { ...current, blocked: false }; assert.equal(await trySelect(true), true); assert.equal(chosen, 'exact-linked-thread');
});
