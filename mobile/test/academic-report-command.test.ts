import assert from 'node:assert/strict';
import test from 'node:test';
import { AcademicReportJournal, reportCommandResultMatches, reportCommandScopeKey, validateReportCommand, type ReportCommand, type ReportCommandScope, type ReportCommandStorage } from '../src/lib/academic-report-command';

const scope: ReportCommandScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const schemeId = '00000000-0000-4000-8000-000000000001', batchId = '00000000-0000-4000-8000-000000000002', studentId = '00000000-0000-4000-8000-000000000003', key = '00000000-0000-4000-8000-000000000004';
const ownerHref = `/areas/reports/remarks?view=schemes&scheme=${schemeId}`;
const input = { ownerHref, endpoint: `/api/v1/schools/campus/academic-reports/schemes/${schemeId}/generate/`, body: { expected_revision: 7, correction_reason: 'Reviewed correction' } };
const result = { id: batchId, scheme_id: schemeId, revision: 1, sequence: 2, status: 'draft' };
function memory(initial: string | null = null) { let raw = initial; const writes: string[] = []; const storage: ReportCommandStorage = { read: async () => raw, write: async value => { raw = value; writes.push(value); }, clear: async () => { raw = null; } }; return { storage, writes, get raw() { return raw; } }; }
function create(storage: ReportCommandStorage, overrides: { send?: (command: ReportCommand) => Promise<unknown>; refresh?: (command: ReportCommand) => Promise<void>; capture?: () => { assertCurrent(): void } } = {}) { return new AcademicReportJournal({ scope, storage, randomId: () => key, capture: overrides.capture ?? (() => ({ assertCurrent() {} })), send: overrides.send ?? (async () => result), refresh: overrides.refresh ?? (async () => {}) }); }

test('grading command is committed as prepared and unknown before any network write', async () => {
  const store = memory(); let sends = 0;
  const journal = create(store.storage, { send: async command => { sends++; assert.equal(store.writes.length, 2); assert.equal(JSON.parse(store.writes[0]!).phase, 'prepared'); assert.equal(JSON.parse(store.raw!).phase, 'unknown'); assert.equal(JSON.parse(command.body).idempotency_key, key); return result; } });
  assert.equal(await journal.run(input), false); await journal.hydrate(); assert.equal(await journal.run(input), true); assert.equal(sends, 1); assert.equal(store.raw, null);
});
test('failed encrypted preparation blocks new work without dispatching', async () => {
  let sends = 0;
  const journal = create({ read: async () => null, write: async () => { throw new Error('Storage unavailable'); }, clear: async () => {} }, { send: async () => { sends++; return result; } });
  await journal.hydrate(); assert.equal(await journal.run(input), false); assert.equal(journal.snapshot().blocked, true); assert.equal(sends, 0);
});
test('lost generation response survives relaunch with exactly the original key, source revision and correction', async () => {
  const store = memory(); const requests: ReportCommand[] = [];
  const first = create(store.storage, { send: async command => { requests.push(command); throw new Error('Response lost'); } }); await first.hydrate(); await first.run(input);
  const resumed = create(store.storage, { send: async command => { requests.push(command); return result; } }); await resumed.hydrate();
  assert.equal(await resumed.run({ ...input, body: { expected_revision: 8, correction_reason: 'Different intent' } }), false);
  assert.equal(await resumed.recover('/areas/reports/remarks'), false); assert.equal(requests.length, 1);
  assert.equal(await resumed.recover(ownerHref), true); assert.equal(requests[0]?.body, requests[1]?.body); assert.equal(requests[0]?.key, requests[1]?.key); assert.equal(store.raw, null);
});
test('known accepted generation refresh failure recovers only by reads after relaunch', async () => {
  const store = memory(); let sends = 0, refreshes = 0;
  const first = create(store.storage, { send: async () => { sends++; return result; }, refresh: async () => { refreshes++; throw new Error('Refresh offline'); } }); await first.hydrate(); await first.run(input);
  assert.equal(JSON.parse(store.raw!).phase, 'accepted'); assert.deepEqual(JSON.parse(store.raw!).result, result);
  const resumed = create(store.storage, { send: async () => { sends++; return result; }, refresh: async command => { refreshes++; assert.deepEqual(command.result, result); } }); await resumed.hydrate(); assert.equal(await resumed.recover(ownerHref), true); assert.equal(sends, 1); assert.equal(refreshes, 2);
});
test('scope and transport changes during encrypted staging prevent dispatch', async () => {
  const store = memory(); let epoch = 1, sends = 0;
  const storage = { ...store.storage, write: async (value: string) => { await store.storage.write(value); if (JSON.parse(value).phase === 'unknown') epoch++; } };
  const journal = create(storage, { capture: () => { const captured = epoch; return { assertCurrent() { if (captured !== epoch) throw new Error('World changed'); } }; }, send: async () => { sends++; return result; } });
  await journal.hydrate(); assert.equal(await journal.run(input), false); assert.equal(sends, 0); assert.equal(journal.snapshot().pending?.phase, 'unknown'); assert.ok(store.raw);
});
test('late scope changes cannot clear an accepted receipt or substitute a newer release', async () => {
  const store = memory(); let current = true;
  const journal = create(store.storage, { capture: () => ({ assertCurrent() { if (!current) throw new Error('Account changed'); } }), refresh: async () => { current = false; } });
  await journal.hydrate(); assert.equal(await journal.run(input), false); assert.equal(JSON.parse(store.raw!).phase, 'accepted');
});
test('focused source lease blocks a report dispatch after backgrounding during secure storage', async () => {
  const store = memory(); let focused = true, sends = 0;
  const journal = create({ ...store.storage, write: async value => { await store.storage.write(value); focused = false; } }, { send: async () => { sends++; return result; } });
  await journal.hydrate(); assert.equal(await journal.run(input, { assertCurrent() { if (!focused) throw new Error('Original report no longer visible'); } }), false);
  assert.equal(sends, 0); assert.ok(store.raw); assert.equal(journal.snapshot().pending?.ownerHref, ownerHref);
});
test('report cleanup cannot report success after context loss or resurrect its accepted command', async () => {
  const store = memory(); let focused = true, followups = 0;
  const journal = create({ ...store.storage, clear: async () => { await store.storage.clear(); focused = false; } }); await journal.hydrate();
  const saved = await journal.run(input, { assertCurrent() { if (!focused) throw new Error('Original report no longer visible'); } }); if (saved) followups++;
  assert.equal(saved, false); assert.equal(followups, 0); assert.equal(store.raw, null); assert.equal(journal.snapshot().pending, null);
});
test('each report operation retains its own accepted callback rather than a newly rendered editor callback', async () => {
  const store = memory(); let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); let original = 0, replacement = 0;
  const operation = { assertCurrent() {}, accepted: async () => { original++; } };
  const journal = create(store.storage, { send: async () => { await waiting; return result; } }); await journal.hydrate();
  const pending = journal.run(input, operation); operation.accepted = async () => { replacement++; }; release();
  assert.equal(await pending, true); assert.equal(original, 1); assert.equal(replacement, 0);
});
test('only a fresh definite refusal releases intent; 409 and all errors after uncertainty remain retained', async () => {
  for (const [status, retained] of [[422, false], [403, false], [408, true], [409, true], [429, true], [500, true]] as const) {
    const store = memory(); const journal = create(store.storage, { send: async () => { throw { status }; } }); await journal.hydrate(); await journal.run(input); assert.equal(!!store.raw, retained, String(status));
  }
  const store = memory(); const first = create(store.storage, { send: async () => { throw new Error('Network lost'); } }); await first.hydrate(); await first.run(input);
  const resumed = create(store.storage, { send: async () => { throw { status: 403 }; } }); await resumed.hydrate(); await resumed.recover(ownerHref); assert.ok(store.raw);
});
test('a different returned scheme, release or stale comment revision is never accepted', async () => {
  const store = memory(); const journal = create(store.storage, { send: async () => ({ ...result, scheme_id: studentId }) }); await journal.hydrate(); assert.equal(await journal.run(input), false); assert.equal(journal.snapshot().pending?.phase, 'unknown');
  const command = JSON.parse(store.raw!) as ReportCommand;
  const comments: ReportCommand = { ...command, endpoint: `/api/v1/schools/campus/academic-reports/batches/${batchId}/students/${studentId}/comments/`, method: 'PUT', body: JSON.stringify({ idempotency_key: key, expected_revision: 3, expected_batch_revision: 7, class_teacher_comment: ' Reviewed ', principal_comment: '' }) };
  const receipt = { id: schemeId, student_id: studentId, comment_revision: 4, batch_revision: 8, class_teacher_comment: 'Reviewed', principal_comment: '' };
  assert.equal(reportCommandResultMatches(comments, receipt), true); assert.equal(reportCommandResultMatches(comments, { ...receipt, student_id: batchId }), false); assert.equal(reportCommandResultMatches(comments, { ...receipt, comment_revision: 3 }), false); assert.equal(reportCommandResultMatches(comments, { ...receipt, batch_revision: 7 }), false); assert.equal(reportCommandResultMatches(comments, { ...receipt, batch_revision: 9 }), false); assert.equal(reportCommandResultMatches(comments, { ...receipt, class_teacher_comment: 'Other remark' }), false); assert.equal(reportCommandResultMatches(comments, { ...receipt, school_id: 'foreign' }), false);
});
test('policy creation accepts only the reviewed draft calculation and retains a mismatched receipt', async () => {
  const configuration = { schema_version: 1, result_format: 'percentage', grade_point_scale: null, decimal_places: 2, aggregation: 'equal', absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'include', bands: [{ code: 'P', label: 'Pass', minimum_percentage: 0, maximum_percentage: 100, grade_points: null, passed: true }] };
  const policyInput = { ownerHref: '/areas/reports/remarks?view=policies&create=policy', endpoint: '/api/v1/schools/campus/academic-reports/policies/', body: { name: 'Policy', code: 'POLICY', configuration } };
  const receipt = { id: schemeId, name: 'Policy', code: 'POLICY', revision: 1, version: 2, status: 'draft', configuration };
  const command: ReportCommand = { version: 1, scope, key, method: 'POST', ...policyInput, body: JSON.stringify({ ...policyInput.body, idempotency_key: key }), phase: 'unknown' };
  assert.equal(reportCommandResultMatches(command, receipt), true);
  assert.equal(reportCommandResultMatches(command, { ...receipt, configuration: Object.fromEntries(Object.entries(configuration).reverse()) }), true);
  for (const patch of [{ status: 'active' }, { version: 0 }, { configuration: { ...configuration, absence_treatment: 'zero' } }, { configuration: { ...configuration, bands: [{ ...configuration.bands[0]!, passed: false }] } }]) assert.equal(reportCommandResultMatches(command, { ...receipt, ...patch }), false);
  const store = memory(); const journal = create(store.storage, { send: async () => ({ ...receipt, configuration: { ...configuration, decimal_places: 0 } }) }); await journal.hydrate();
  assert.equal(await journal.run(policyInput), false); assert.equal(journal.snapshot().pending?.phase, 'unknown'); assert.ok(store.raw);
});
test('scheme creation checks draft status, reviewed approval and exact programme/term fields', () => {
  const body = { name: 'Scheme', code: 'SCHEME', term_id: batchId, class_section_id: studentId, grading_policy_id: schemeId, review_mode: 'independent', absence_treatment: 'incomplete', programme_key: ' COURSE ', term_index: 2, idempotency_key: key };
  const command: ReportCommand = { version: 1, scope, key, ownerHref: '/areas/reports/remarks?view=schemes&create=scheme', endpoint: '/api/v1/schools/campus/academic-reports/schemes/', method: 'POST', body: JSON.stringify(body), phase: 'unknown' };
  const receipt = { ...body, id: schemeId, revision: 1, status: 'draft', programme_key: 'COURSE' };
  assert.equal(reportCommandResultMatches(command, receipt), true);
  for (const patch of [{ status: 'active' }, { status: 'archived' }, { review_mode: 'owner_review' }, { absence_treatment: 'zero' }, { programme_key: 'OTHER' }, { term_index: 3 }, { term_id: schemeId }, { class_section_id: schemeId }, { grading_policy_id: batchId }]) assert.equal(reportCommandResultMatches(command, { ...receipt, ...patch }), false, JSON.stringify(patch));
  const unnumbered = { ...command, body: JSON.stringify({ ...body, programme_key: null, term_index: null }) };
  assert.equal(reportCommandResultMatches(unnumbered, { ...receipt, programme_key: null, term_index: null }), true);
  assert.equal(reportCommandResultMatches(unnumbered, receipt), false);
});
test('hydration rejects actor, campus, world, origin, endpoint, owner and key drift', async () => {
  const store = memory(); const journal = create(store.storage, { send: async () => { throw new Error('Lost'); } }); await journal.hydrate(); await journal.run(input); const command = JSON.parse(store.raw!) as ReportCommand;
  for (const changed of [{ ...scope, actorId: 'other' }, { ...scope, schoolId: 'other' }, { ...scope, mode: 'simulation' as const, namespaceId: 'run-a' }, { ...scope, origin: 'https://other.example' }]) { assert.notEqual(reportCommandScopeKey(scope), reportCommandScopeKey(changed)); assert.equal(validateReportCommand(command, changed), false); }
  for (const changed of [{ ...command, endpoint: '/api/v1/auth/logout/' }, { ...command, endpoint: input.endpoint.replace('campus', 'other') }, { ...command, ownerHref: 'https://other.example/areas/reports/remarks' }, { ...command, body: JSON.stringify({ idempotency_key: schemeId }) }, { ...command, phase: 'accepted', result: { ...result, scheme_id: studentId } }]) assert.equal(validateReportCommand(changed, scope), false);
  const corrupt = create(memory('{bad').storage); await corrupt.hydrate(); assert.equal(corrupt.snapshot().blocked, true);
});
