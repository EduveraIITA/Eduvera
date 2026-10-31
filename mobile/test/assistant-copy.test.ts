import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentChartData, AgentRun, AgentSource } from '../../packages/contracts/src/wire/features/assistant/agentApi';
import { assistantCopySnapshot, copyAssistantResponse, type AssistantCopySnapshot } from '../src/features/assistant/assistant-copy';

const run = (fields: Partial<AgentRun> = {}): AgentRun => ({
  id: 'synthetic-latest', question: 'PRIVATE QUESTION', answer: 'The recorded answer.', status: 'completed', progress: 'INTERNAL PROGRESS',
  provider: 'PRIVATE PROVIDER', model: 'PRIVATE MODEL', created_at: '2026-10-29T12:00:00Z', evidence: [], action: null, ...fields,
});
const chart: AgentChartData = {
  kind: 'bar', title: 'PRIVATE CHART TITLE', scope: 'PRIVATE CHART SCOPE', from: '2026-10-01', to: '2026-10-29', unit: 'records',
  points: [{ label: 'Present', value: 0, detail: 'PRIVATE POINT BASIS' }, { label: 'Absent', value: 2, detail: 'PRIVATE POINT BASIS' }, { label: 'Unknown', value: null, detail: 'PRIVATE POINT BASIS' }],
  shown: 3, total: 3, note: 'PRIVATE CHART METHOD',
};
const source = (id: string, data?: AgentChartData): AgentSource => ({ id, title: 'PRIVATE SOURCE TITLE', href: '/areas/attendance?private=id', retrieved_at: '2026-10-29T12:00:00Z', capability: 'PRIVATE CAPABILITY', ...(data ? { chart: data } : {}) });

test('copy selects only the latest authorized real response, never an older answer or a running placeholder', () => {
  const older = run({ id: 'older', answer: 'Older answer' });
  assert.equal(assistantCopySnapshot([older]), null, 'An omitted authority flag fails closed');
  assert.equal(assistantCopySnapshot([older], false), null);
  assert.equal(assistantCopySnapshot([], true), null);
  for (const latest of [run({ answer: '' }), run({ answer: '  ' }), run({ answer: 'A partial answer', status: 'running' }), run({ answer: '![only image](https://example.invalid/image)' })]) {
    assert.equal(assistantCopySnapshot([older, latest], true), null);
  }
  const latest = run({ answer: '**Current** recorded response.' });
  assert.deepEqual(assistantCopySnapshot([older, latest], true), { runId: latest.id, text: 'Current recorded response.' });
});

test('failed, cancelled and confirmation replies copy an actual recorded answer as displayed, never invented status text', () => {
  for (const status of ['failed', 'cancelled', 'confirmation', 'completed'] as const) {
    assert.deepEqual(assistantCopySnapshot([run({ status, answer: 'Recorded **0%**; missing is not recorded.' })], true), { runId: 'synthetic-latest', text: 'Recorded 0%; missing is not recorded.' });
    assert.equal(assistantCopySnapshot([run({ status, answer: '' })], true), null);
  }
});

test('copy is readable full displayed text with semantic blocks, inert links, comparisons and literal code', () => {
  const answer = '## Recorded result\n\n**Zero** is recorded; *unknown* is different. Attendance < 75% needs review; marks > 90% are strong.\n\n1. First [record](javascript:private)\n2. Second `0%`\n\n> Source qualification\n\n```\nconst value = "<b>inert</b>";\n```\n\nLast paragraph.';
  assert.equal(assistantCopySnapshot([run({ answer })], true)?.text, 'Recorded result\n\nZero is recorded; unknown is different. Attendance < 75% needs review; marks > 90% are strong.\n\n1. First record\n2. Second 0%\n\nSource qualification\n\nconst value = "<b>inert</b>";\n\nLast paragraph.');
  assert.equal(assistantCopySnapshot([run({ answer: 'Read [this](https://example.invalid/path). <img src="private"> <strong>Saved</strong>.' })], true)?.text, 'Read this.  Saved.');
});

test('copy excludes question, evidence metadata, previews, prompts and action inputs and never mutates its source', () => {
  const latest = run({ answer: 'Only the **displayed answer**.', evidence: [source('private-source')], action: { id: 'private-action', title: 'PRIVATE ACTION TITLE', status: 'pending', input: { basis_id: 'PRIVATE BASIS', body: { prompt: 'PRIVATE PROMPT', status: 'PRIVATE ACTION INPUT' } }, labels: { private: 'PRIVATE LABEL' }, href: '/private-action', expires_at: '2026-10-29T12:10:00Z', receipt: null, preview: { date: 'PRIVATE DATE', student: 'PRIVATE STUDENT', register_note: 'PRIVATE REGISTER NOTE' } } });
  const before = JSON.stringify(latest), snapshot = assistantCopySnapshot([latest], true)!;
  assert.equal(snapshot.text, 'Only the displayed answer.');
  assert.doesNotMatch(snapshot.text, /PRIVATE|private/);
  assert.equal(JSON.stringify(latest), before);
  assert.ok(Object.isFrozen(snapshot));
});

test('single-chart preparation matches the full reply without copying chart metadata or changing zero and null', () => {
  const latest = run({ answer: '- Present: 0\n- Absent: 2\n- Unknown: Not recorded', evidence: [source('chart', chart)] });
  const snapshot = assistantCopySnapshot([latest], true)!;
  assert.equal(snapshot.text, 'Among the recorded values, Absent is highest at 2. Present is lowest at 0.');
  assert.doesNotMatch(snapshot.text, /PRIVATE|Not recorded is 0/);
  const partial = { ...chart, total: 4 };
  assert.equal(assistantCopySnapshot([run({ answer: 'Please see the chart.', evidence: [source('partial', partial)] })], true)?.text, 'Among the shown recorded values, Absent is highest at 2. Present is lowest at 0.');
  const missing = { ...chart, points: chart.points.map(point => ({ ...point, value: null })) };
  assert.equal(assistantCopySnapshot([run({ answer: 'Please see the chart.', evidence: [source('missing', missing)] })], true)?.text, 'No recorded data is available for this period.');
  assert.equal(assistantCopySnapshot([run({ answer: 'Please see the chart.', evidence: [source('one', chart), source('two', chart)] })], true)?.text, 'Please see the chart.', 'Multiple charts do not choose a summary the full reply does not show');
});

test('writer invocation and its exact snapshot checks occur synchronously within the initiating gesture', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!, calls: string[] = [];
  const result = copyAssistantResponse({ snapshot, assertCurrent() { calls.push('lease'); }, readCurrent() { calls.push('snapshot'); return snapshot; }, write(text) { calls.push(`write:${text}`); return true; } });
  assert.deepEqual(calls, ['lease', 'snapshot', 'lease', 'write:The recorded answer.'], 'No asynchronous preparation may precede Clipboard invocation');
  assert.equal(await result, 'copied');
  assert.deepEqual(calls.slice(4), ['lease', 'snapshot', 'lease']);
});

test('stale latest identity/text or lost current authorization prevents any clipboard write', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!;
  const changed: (AssistantCopySnapshot | null)[] = [null, { ...snapshot, runId: 'new-latest' }, { ...snapshot, text: 'A changed answer.' }];
  for (const current of changed) {
    let writes = 0;
    assert.equal(await copyAssistantResponse({ snapshot, readCurrent: () => current, assertCurrent() {}, write() { writes++; return true; } }), 'stale');
    assert.equal(writes, 0);
  }
});

test('hidden, changed scope/source or unmounted lease cannot write even when text remains identical', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!;
  for (const reason of ['hidden', 'changed account/campus/world', 'changed source', 'unmounted']) {
    let writes = 0;
    assert.equal(await copyAssistantResponse({ snapshot, readCurrent: () => snapshot, assertCurrent() { throw new Error(reason); }, write() { writes++; return true; } }), 'stale');
    assert.equal(writes, 0);
  }
});

test('clipboard refusal, false and exceptions never report Copied or retry', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!;
  for (const outcome of ['false', 'throw', 'reject', 'nonboolean']) {
    let writes = 0;
    assert.equal(await copyAssistantResponse({ snapshot, readCurrent: () => snapshot, assertCurrent() {}, write() { writes++; if (outcome === 'throw') throw new Error('Denied'); if (outcome === 'reject') return Promise.reject(new Error('Denied')); return outcome === 'nonboolean' ? 'true' as unknown as boolean : false; } }), 'failed');
    assert.equal(writes, 1);
  }
});

test('late copied results cannot acknowledge a different latest answer, revoked authority, hidden host or changed scope', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!;
  for (const change of ['run', 'text', 'authorization', 'hidden', 'scope']) {
    let settle!: (result: boolean) => void, current: AssistantCopySnapshot | null = snapshot, active = true, writes = 0;
    const result = copyAssistantResponse({ snapshot, readCurrent: () => current, assertCurrent() { if (!active) throw new Error('Lease changed'); }, write() { writes++; return new Promise<boolean>(resolve => { settle = resolve; }); } });
    assert.equal(writes, 1);
    if (change === 'run') current = { ...snapshot, runId: 'new-run' };
    else if (change === 'text') current = { ...snapshot, text: 'New displayed text.' };
    else if (change === 'authorization') current = null;
    else active = false;
    settle(true);
    assert.equal(await result, 'stale');
    assert.equal(writes, 1);
  }
});

test('a deferred successful writer acknowledges only its unchanged response and current lease', async () => {
  const snapshot = assistantCopySnapshot([run()], true)!;
  let settle!: (result: boolean) => void;
  const result = copyAssistantResponse({ snapshot, readCurrent: () => snapshot, assertCurrent() {}, write: () => new Promise<boolean>(resolve => { settle = resolve; }) });
  settle(true);
  assert.equal(await result, 'copied');
});
