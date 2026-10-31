import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantChartKind, assistantChartValue, assistantLineSegments, parseAssistantChart, parseAssistantStatus, parseAssistantThread, parseAssistantThreads } from '../src/lib/assistant-policy';
const thread = '00000000-0000-4000-8000-000000000001', run = '00000000-0000-4000-8000-000000000002';
const chart = { kind: 'line' as const, title: 'Recorded attendance', scope: 'Authorized learner', from: '2026-10-01', to: '2026-10-29', unit: 'percent' as const, points: [{ label: 'Week one', value: 90, detail: '9 of 10', date: '2026-10-01', end: '2026-10-07' }, { label: 'Week two', value: null, detail: 'No records' }, { label: 'Week three', value: 0, detail: '0 of 10' }], total: 4, shown: 3, note: 'Daily record projection; partial authorized view.' };
const data = { id: thread, title: 'My day', runs: [{ id: run, question: 'How is attendance?', answer: 'Recorded result', status: 'completed', progress: 'Complete', provider: 'vertex', model: 'configured-model', created_at: '2026-10-29T06:00:00Z', action: null, evidence: [{ id: 'source', title: 'Attendance', href: '/areas/attendance', retrieved_at: '2026-10-29T06:00:00Z', capability: 'read_attendance', chart }] }] };
test('authorized thread detail requires the exact requested identity, complete rows and nonconflicting run IDs', () => {
  assert.equal(parseAssistantThread(data, thread), data);
  assert.throws(() => parseAssistantThread(data, run));
  for (const bad of [{ ...data, runs: [...data.runs, ...data.runs] }, { ...data, runs: [{ ...data.runs[0], evidence: null }] }, { ...data, runs: [{ ...data.runs[0], answer: 42 }] }, { ...data, runs: [{ ...data.runs[0], action: { id: run, status: 'pending' } }] }]) assert.throws(() => parseAssistantThread(bad, thread));
});
test('current expiring action review keeps its source fields and receipts, refusing malformed render/control metadata', () => {
  const action = { id: run, title: 'Reviewed change', status: 'pending', href: '/areas/attendance', expires_at: '2026-10-29T06:10:00Z', input: { basis_id: thread, body: { expected_revision: 7, reason: 'Verified correction' } }, labels: { [thread]: 'Selected learner' }, receipt: null, contract: { summary: 'Only the reviewed learner changes.', confirmation_label: 'Confirm correction' }, preview: { date: '2026-10-29', student: 'Learner', previous_status: 'absent', status: 'present', register_note: 'Other learners remain unchanged.' } };
  const current = { ...data, runs: [{ ...data.runs[0], action }] };
  assert.equal(parseAssistantThread(current, thread), current);
  for (const bad of [{ ...action, labels: undefined }, { ...action, expires_at: 'unknown' }, { ...action, contract: { summary: 42 } }, { ...action, preview: { ...action.preview, records: [{ student: null }] } }, { ...action, receipt: { message: {} } }]) assert.throws(() => parseAssistantThread({ ...data, runs: [{ ...data.runs[0], action: bad }] }, thread));
});
test('history parsing rejects duplicate/invalid identities rather than silently switching conversation', () => {
  const item = { id: thread, title: 'My day', updated_at: '2026-10-29T06:00:00Z' };
  assert.equal(parseAssistantThreads({ threads: [item] }).threads[0], item);
  for (const threads of [[item, item], [{ ...item, id: 'foreign' }], [{ ...item, updated_at: null }], Array.from({ length: 21 }, () => item)]) assert.throws(() => parseAssistantThreads({ threads }));
});
test('chart policy preserves null, zero, units and uncapped total, rejecting malformed numeric/count rows', () => {
  assert.equal(parseAssistantChart(chart), chart); assert.equal(assistantChartValue(null, 'percent'), 'Not recorded'); assert.equal(assistantChartValue(0, 'percent'), '0%'); assert.equal(assistantChartValue(42, 'records'), '42');
  for (const bad of [{ ...chart, shown: 4 }, { ...chart, total: 2 }, { ...chart, points: [{ label: 'Invalid', value: Number.NaN, detail: '' }], shown: 1 }, { ...chart, points: [{ label: 'Invalid', value: 101, detail: '' }], shown: 1 }, { ...chart, points: [{ label: 'Invalid', value: '42', detail: '' }], shown: 1 }]) assert.throws(() => parseAssistantChart(bad));
});
test('line geometry breaks at missing readings and retains a genuine recorded zero', () => {
  const segments = assistantLineSegments(chart); assert.equal(segments.length, 2); assert.deepEqual(segments.map(segment => segment.map(point => point.index)), [[0], [2]]); assert.equal(segments[1]![0]!.y, 108);
  assert.equal(assistantLineSegments({ ...chart, points: chart.points.map(point => ({ ...point, value: null })) }).length, 0);
});
test('donuts require a complete known partition; partial or missing parts remain honest value bars', () => {
  assert.equal(assistantChartKind({ ...chart, kind: 'donut' }), 'bar');
  assert.equal(assistantChartKind({ ...chart, kind: 'donut', total: 3 }), 'bar');
  assert.equal(assistantChartKind({ ...chart, kind: 'donut', total: 3, points: chart.points.map(point => ({ ...point, value: point.value ?? 5 })) }), 'donut');
  assert.throws(() => parseAssistantChart({ ...chart, unit: 'records', points: [{ label: 'A', value: 1.7e308, detail: '' }, { label: 'B', value: 1.7e308, detail: '' }], shown: 2 }));
});
test('unavailable configured cloud provider is still truthful status; string booleans and nonfinite tool counts fail closed', () => {
  const status = { provider: 'vertex', model: 'configured-model', ready: false, local: false, tools: 10, pro_features_enabled: true, confirmation_required: true };
  assert.equal(parseAssistantStatus(status), status);
  for (const bad of [{ ...status, ready: 'false' }, { ...status, tools: Infinity }, { ...status, pro_features_enabled: undefined }]) assert.throws(() => parseAssistantStatus(bad));
});
