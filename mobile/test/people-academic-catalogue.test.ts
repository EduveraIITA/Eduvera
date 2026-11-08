import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedAcademicCatalogue, academicCatalogueEndpoint, academicCatalogueFields, academicCatalogueInput, academicCatalogueRead, academicCatalogueRefreshPath, nativePeopleAcademicCatalogueAllowed, type AcademicCatalogue, type AcademicCatalogueRow } from '../src/lib/people-academic-catalogue';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const school = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', key = '10000000-0000-4000-8000-000000000003', actor = '10000000-0000-4000-8000-000000000004';
const scope: NativePendingScope = { schoolId: school, actorId: actor, mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const values = { academic_year: '2026-27', grade: '7', section: 'A', board: 'CBSE', room_number: '204' };
const cls = { ...values, id, school_id: school, revision: 3, enrollment_count: 12, timetable_count: 4, assignment_count: 2, updated_at: '2026-10-29T00:00:00Z', updated_by: actor } as AcademicCatalogueRow;
const overview = (row: AcademicCatalogueRow) => ({ school: { id: school }, terms: [], classes: [row], subjects: [] }) as unknown as AcademicCatalogue;
function action(edit = false): NativePendingAction { return { version: 1, domain: 'people', scope, clientId: key, ownerHref: `/more/setup/institution/academics?academic_catalog=classes&academic_edit=${edit ? id : 'new'}`, endpoint: academicCatalogueEndpoint(school, 'classes', edit ? id : undefined), refreshPath: academicCatalogueRead(school), method: edit ? 'PATCH' : 'POST', payload: { kind: 'json', body: JSON.stringify(edit ? { ...values, room_number: '205', expected_revision: 3, confirmed: true, change_reason: 'Reviewed room allocation' } : values) }, source: { kind: 'academic_catalog_classes', sourceId: edit ? id : school, revision: edit ? 3 : 0 }, replayPolicy: 'inspect_only', phase: 'prepared', createdAt: '2026-10-29T00:00:00Z' }; }

test('catalogue fields validate current linked impact and preserve academic identity', () => {
  assert.throws(() => academicCatalogueInput('classes', { ...values, room_number: '205' }, cls));
  assert.throws(() => academicCatalogueInput('classes', { ...values, room_number: '205', academic_year: '2027-28' }, cls, true, 'Reviewed linked records'));
  assert.throws(() => academicCatalogueInput('classes', values, cls, true, 'Reviewed linked records'));
  assert.deepEqual(academicCatalogueInput('classes', { ...values, room_number: '205' }, cls, true, '  Reviewed room allocation  '), { ...values, room_number: '205', expected_revision: 3, confirmed: true, change_reason: 'Reviewed room allocation' });
});
test('term validation rejects calendar overflow and retains inactive choice', () => {
  const term = { name: 'Term 1', academic_year: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', attendance_threshold: '85.25', is_active: false };
  assert.equal(academicCatalogueInput('terms', term).is_active, false);
  assert.equal(academicCatalogueInput('terms', term).attendance_threshold, 85.25);
  assert.throws(() => academicCatalogueInput('terms', { ...term, starts_on: '2026-02-30' }));
  assert.throws(() => academicCatalogueInput('terms', { ...term, attendance_threshold: '101' }));
});
test('subject fields normalize only owning color and code, preserving selected icon', () => {
  const input = academicCatalogueInput('subjects', { ...academicCatalogueFields('subjects'), code: ' math ', name: ' Mathematics ', short_name: 'Maths', color: '#abcdef', icon: 'calculator' });
  assert.equal(input.code, 'MATH'); assert.equal(input.color, '#ABCDEF'); assert.equal(input.icon, 'calculator');
  assert.throws(() => academicCatalogueInput('subjects', { ...input, icon: 'invented' }));
});
test('real shared catalogue gate rejects wrong school, source, methods and replay intent', () => {
  const record = action(); assert.equal(validateNativePendingAction(record, scope, 'people'), true);
  for (const changed of [ { ...record, method: 'PUT' as const }, { ...record, endpoint: academicCatalogueEndpoint(actor, 'classes') }, { ...record, replayPolicy: 'same_request' as const }, { ...record, source: { kind: 'academic_catalog_classes', sourceId: id, revision: 0 } }, { ...record, endpoint: academicCatalogueEndpoint(school, 'classes') + 'arbitrary/' }, { ...record, payload: { kind: 'json' as const, body: JSON.stringify({ ...values, command_id: key }) } }, { ...record, payload: { kind: 'json' as const, body: JSON.stringify({ ...values, school_id: school }) } }, { ...record, payload: { kind: 'json' as const, body: JSON.stringify({ ...values, arbitrary: true }) } } ]) assert.equal(validateNativePendingAction(changed, scope, 'people'), false);
  assert.equal(validateNativePendingAction(record, { ...scope, mode: 'simulation', namespaceId: id }, 'people'), false);
});
test('catalogue accepted markers bind exact kind, id and next revision', () => {
  const record = action(true), receipt = { ...cls, room_number: '205', revision: 4 }, refreshPath = academicCatalogueRefreshPath(receipt, record), accepted = { ...record, phase: 'accepted' as const, refreshPath };
  assert.equal(nativePeopleAcademicCatalogueAllowed(accepted, scope), true); assert.equal(validateNativePendingAction(accepted, scope, 'people'), true);
  for (const path of [academicCatalogueRead(school), refreshPath.replace('catalog_revision=4', 'catalog_revision=5'), refreshPath.replace(`catalog_id=${id}`, `catalog_id=${actor}`), refreshPath + '&catalog_revision=4', refreshPath.replace('catalog_kind=classes', 'catalog_kind=terms')]) assert.equal(validateNativePendingAction({ ...accepted, refreshPath: path }, scope, 'people'), false);
  assert.equal(validateNativePendingAction({ ...record, refreshPath }, scope, 'people'), false);
  assert.equal(acceptedAcademicCatalogue(overview(receipt), accepted).row.id, id);
});
test('direct catalogue receipt and follow-up reject another source, revision or reviewed value', () => {
  const record = action(), receipt = { ...cls, revision: 1 };
  for (const changed of [{ ...receipt, school_id: actor }, { ...receipt, revision: 2 }, { ...receipt, room_number: 'different' }, { ...receipt, id: 'not-an-id' }]) assert.throws(() => academicCatalogueRefreshPath(changed, record));
  const accepted = { ...record, phase: 'accepted' as const, refreshPath: academicCatalogueRefreshPath(receipt, record) };
  assert.throws(() => acceptedAcademicCatalogue(overview({ ...receipt, revision: 2 }), accepted));
  assert.throws(() => acceptedAcademicCatalogue({ ...overview(receipt), school: { id: actor } }, accepted));
});
test('accepted catalogue creation retains exact returned id and recovers by read only after restart', async () => {
  let raw: string | null = null, sends = 0, reads = 0; const receipt = { ...cls, revision: 1 }, input = action();
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const first = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key, send: async () => { sends++; return receipt; }, read: async () => { reads++; throw new Error('Follow-up read failed'); } });
  await first.hydrate(); assert.equal(await first.run({ endpoint: input.endpoint, body: values, source: input.source, serverKey: null, replayPolicy: 'inspect_only' }, { ownerHref: input.ownerHref, refreshPath: input.refreshPath, assertActive() {}, resolveRefreshPath: academicCatalogueRefreshPath }), false);
  assert.equal(JSON.parse(raw!).phase, 'accepted'); assert.ok(JSON.parse(raw!).refreshPath.includes(`catalog_id=${id}`));
  const resumed = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor, send: async () => { sends++; throw new Error('Must never resend'); }, read: async record => { reads++; assert.ok(record.refreshPath.includes(`catalog_id=${id}`)); return overview(receipt); } });
  await resumed.hydrate(); assert.equal(await resumed.recover({ ownerHref: input.ownerHref, assertActive() {}, accepted: (value, _assert, record) => { assert.equal(acceptedAcademicCatalogue(value, record).row.id, id); } }), true);
  assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(raw, null);
});
test('uncertain catalogue create stays inspect-only and cannot infer success from a matching row', async () => {
  let raw: string | null = null, sends = 0, reads = 0, callbacks = 0; const input = action(), storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const original = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key, send: async () => { sends++; throw new Error('Response lost'); }, read: async () => { reads++; return overview({ ...cls, revision: 1 }); } });
  await original.hydrate(); await original.run({ endpoint: input.endpoint, body: values, source: input.source, serverKey: null, replayPolicy: 'inspect_only' }, { ownerHref: input.ownerHref, refreshPath: input.refreshPath, assertActive() {} });
  const restarted = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor, send: async () => { sends++; }, read: async () => { reads++; return overview({ ...cls, revision: 1 }); } });
  await restarted.hydrate(); assert.equal(await restarted.recover({ ownerHref: input.ownerHref, assertActive() {}, accepted: () => { callbacks++; } }), false); assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(callbacks, 0); assert.equal(JSON.parse(raw!).phase, 'unknown');
});

function identified(edit = false): NativePendingAction {
  const legacy = action(edit), body = JSON.parse((legacy.payload as { body: string }).body);
  return { ...legacy, replayPolicy: 'same_request', source: { ...legacy.source!, sourceId: id },
    payload: { kind: 'json', body: JSON.stringify({ ...body, catalog_id: id, command_id: key }) } };
}
const confirmation = (record: NativePendingAction, row: AcademicCatalogueRow) => ({ handler: 'academic.catalogue', school_id: school,
  kind: 'classes', source_id: id, command_id: key, state: 'accepted', expected_revision: record.source!.revision, result: row });

test('identified catalogue actions bind command, source, fields and exact confirmation path', () => {
  const record = identified(), row = { ...cls, revision: 1 }, accepted = { ...record, phase: 'accepted' as const, refreshPath: academicCatalogueRefreshPath(row, record) };
  assert.equal(validateNativePendingAction(record, scope, 'people'), true);
  assert.equal(validateNativePendingAction(accepted, scope, 'people'), true);
  assert.equal(acceptedAcademicCatalogue(confirmation(record, row), accepted).row.id, id);
  assert.equal(acceptedAcademicCatalogue(confirmation(record, row), accepted).data, null);
  for (const changed of [{ ...record, source: { ...record.source!, sourceId: school } }, { ...record, clientId: actor },
    { ...accepted, refreshPath: academicCatalogueRead(school) }, { ...accepted, refreshPath: accepted.refreshPath + '?extra=1' },
    { ...record, payload: { kind: 'json' as const, body: JSON.stringify({ ...values, catalog_id: id, command_id: key, arbitrary: true }) } }])
    assert.equal(validateNativePendingAction(changed, scope, 'people'), false);
  for (const changed of [{ ...confirmation(record, row), source_id: actor }, { ...confirmation(record, row), command_id: actor },
    { ...confirmation(record, row), state: 'pending' }, { ...confirmation(record, row), result: { ...row, revision: 2 } }])
    assert.throws(() => acceptedAcademicCatalogue(changed, accepted));
  assert.throws(() => acceptedAcademicCatalogue(overview(row), accepted));
});

test('lost identified response reuses one retained intent after relaunch without a new catalogue create', async () => {
  let raw: string | null = null, dispatches = 0, committed = 0, commandBody = '';
  const input = identified(), row = { ...cls, revision: 1 }, storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const first = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key,
    send: async record => { dispatches++; commandBody = (record.payload as { body: string }).body; committed++; throw new Error('Reply lost after commit'); }, read: async () => { throw new Error('Not accepted yet'); } });
  await first.hydrate();
  assert.equal(await first.run({ endpoint: input.endpoint, body: { ...values, catalog_id: id }, serverKey: 'command_id', source: input.source },
    { ownerHref: input.ownerHref, refreshPath: input.refreshPath, assertActive() {}, resolveRefreshPath: academicCatalogueRefreshPath }), false);
  const resumed = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor,
    send: async record => { dispatches++; assert.equal((record.payload as { body: string }).body, commandBody); return row; }, read: async () => confirmation(input, row) });
  await resumed.hydrate();
  assert.equal(await resumed.recover({ ownerHref: input.ownerHref, assertActive() {}, resolveRefreshPath: academicCatalogueRefreshPath,
    accepted: (value, _, record) => { assert.equal(acceptedAcademicCatalogue(value, record).row.revision, 1); } }), true);
  assert.equal(dispatches, 2); assert.equal(committed, 1); assert.equal(raw, null);
});

test('accepted identified edit uses receipt reads after relaunch even if current details have advanced', async () => {
  let raw: string | null = null, sends = 0, reads = 0;
  const input = identified(true), row = { ...cls, room_number: '205', revision: 4 }, storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const first = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key,
    send: async () => { sends++; return row; }, read: async () => { reads++; throw new Error('Receipt refresh unavailable'); } });
  await first.hydrate();
  await first.run({ endpoint: input.endpoint, method: 'PATCH', body: { ...values, room_number: '205', expected_revision: 3, confirmed: true, change_reason: 'Reviewed room allocation', catalog_id: id }, serverKey: 'command_id', source: input.source },
    { ownerHref: input.ownerHref, refreshPath: input.refreshPath, assertActive() {}, resolveRefreshPath: academicCatalogueRefreshPath });
  assert.equal(JSON.parse(raw!).phase, 'accepted');
  const second = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor,
    send: async () => { throw new Error('Accepted commands must not dispatch again'); }, read: async () => { reads++; return confirmation(input, row); } });
  await second.hydrate();
  assert.equal(await second.recover({ ownerHref: input.ownerHref, assertActive() {}, accepted: (value, _, record) => {
    assert.equal(acceptedAcademicCatalogue(value, record).row.revision, 4);
  } }), true);
  assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(raw, null);
});

test('only exact owning absent receipt and stale-revision proof can release an uncertain identified edit', async () => {
  const { academicCatalogueCommandObsolete } = await import('../src/lib/people-academic-catalogue');
  const record = identified(true), proof = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', handler: 'academic.catalogue',
    source_id: id, command_id: key, expected_revision: 3, current_revision: 4 };
  const error = (p: unknown) => ({ status: 409, details: { error: { fields: { catalogue_obsolete: p } } } });
  assert.equal(academicCatalogueCommandObsolete(error(proof), record), true);
  for (const changed of [{ ...proof, command_id: actor }, { ...proof, source_id: actor }, { ...proof, current_revision: 3 }, { ...proof, receipt_state: 'pending' }, { ...proof, expected_revision: 2 }])
    assert.equal(academicCatalogueCommandObsolete(error(changed), record), false);
  assert.equal(academicCatalogueCommandObsolete(error(proof), action(true)), false);
});

test('real journal retains uncertain edits for unrelated proofs and clears only the exact obsolete action', async () => {
  let raw: string | null = null, clears = 0;
  const record = identified(true), storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { clears++; raw = null; } };
  const first = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key,
    send: async () => { throw new Error('Response lost'); }, read: async () => ({}) });
  const options = { endpoint: record.endpoint, method: 'PATCH' as const, body: { ...values, room_number: '205', expected_revision: 3, confirmed: true, change_reason: 'Reviewed room allocation', catalog_id: id }, serverKey: 'command_id' as const, source: record.source };
  await first.hydrate(); await first.run(options, { ownerHref: record.ownerHref, refreshPath: record.refreshPath, assertActive() {} });
  const proof = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', handler: 'academic.catalogue', source_id: id, command_id: actor, expected_revision: 3, current_revision: 4 };
  let exact = false;
  const second = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor,
    send: async () => { throw { status: 409, details: { error: { fields: { catalogue_obsolete: { ...proof, command_id: exact ? key : actor } } } } }; }, read: async () => ({}) });
  await second.hydrate();
  assert.equal(await second.recover({ ownerHref: record.ownerHref, assertActive() {} }), false);
  assert.equal(clears, 0); assert.equal(JSON.parse(raw!).phase, 'unknown');
  exact = true;
  assert.equal(await second.recover({ ownerHref: record.ownerHref, assertActive() {} }), false);
  assert.equal(clears, 1); assert.equal(raw, null); assert.equal(second.snapshot().action, null);
});

function terminalRefusal(record = identified(), changes: Record<string, unknown> = {}) {
  const body = JSON.parse((record.payload as { body: string }).body);
  return { status: 409, details: { error: { status: 409, code: 'catalogue_command_refused', fields: { catalogue_refusal: {
    confirmation: 'terminal_refusal', receipt_state: 'completed', handler: 'academic.catalogue', terminal_state: 'conflicted',
    school_id: school, actor_user_id: actor, environment_namespace_id: `live:${school}`, kind: 'classes', source_id: id,
    command_id: key, expected_revision: record.source!.revision, payload_hash: 'a'.repeat(64), reason_code: 'academic_catalogue_duplicate',
    reviewed_request: { kind: 'classes', id, values: { ...values, ...(body.room_number ? { room_number: body.room_number } : {}) },
      expected_revision: record.source!.revision, confirmed: body.confirmed ?? false, change_reason: body.change_reason ?? '' }, ...changes,
  } } } } };
}

test('actual journal releases a duplicate only with its durable exact terminal refusal and requires fresh review', async () => {
  let raw: string | null = null, sends = 0;
  const record = identified(), storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const options = { endpoint: record.endpoint, method: 'POST' as const, body: { ...values, catalog_id: id }, serverKey: 'command_id' as const, source: record.source };
  const journal = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key,
    send: async () => { sends++; throw terminalRefusal(record); }, read: async () => ({}) });
  await journal.hydrate(); await journal.run(options, { ownerHref: record.ownerHref, refreshPath: record.refreshPath, assertActive() {} });
  assert.equal(raw, null); assert.equal(journal.snapshot().action, null); assert.equal(journal.snapshot().obsolete, true);
  assert.equal(await journal.run(options, { ownerHref: record.ownerHref, refreshPath: record.refreshPath, assertActive() {} }), false);
  assert.equal(sends, 1); journal.reviewed(); assert.equal(journal.snapshot().obsolete, false);
});

test('terminal refusal classification rejects other actor/world/source/intent and every accepted or legacy action', async () => {
  const { academicCatalogueCommandObsolete } = await import('../src/lib/people-academic-catalogue');
  const record = identified(), proof = terminalRefusal(record).details.error.fields.catalogue_refusal;
  for (const change of [{ actor_user_id: school }, { school_id: actor }, { environment_namespace_id: `live:${actor}` },
    { source_id: actor }, { command_id: actor }, { kind: 'terms' }, { expected_revision: 1 }, { terminal_state: 'accepted' },
    { terminal_state: 'pending' }, { receipt_state: 'absent' }, { payload_hash: 'invalid' }, { reason_code: 'unknown' },
    { reviewed_request: { ...proof.reviewed_request, values: { ...values, room_number: 'Different intent' } } },
    { reviewed_request: { ...proof.reviewed_request, confirmed: true } }, { reviewed_request: { ...proof.reviewed_request, change_reason: 'Another review' } }])
    assert.equal(academicCatalogueCommandObsolete(terminalRefusal(record, change), record), false);
  assert.equal(academicCatalogueCommandObsolete(terminalRefusal(record), { ...record, phase: 'accepted' }), false);
  assert.equal(academicCatalogueCommandObsolete(terminalRefusal(record), action()), false);
  assert.equal(academicCatalogueCommandObsolete({ status: 503, details: terminalRefusal(record).details }, record), false);
  const world = { ...record, scope: { ...scope, mode: 'simulation' as const, namespaceId: `scenario:${school}:run:${id}` } };
  assert.equal(academicCatalogueCommandObsolete(terminalRefusal(record), world), false);
  assert.equal(academicCatalogueCommandObsolete(terminalRefusal(record, { environment_namespace_id: world.scope.namespaceId }), world), true);
});

test('unknown duplicate outcomes survive remount and generic errors until the exact durable refusal is recovered', async () => {
  const record = identified(); let raw: string | null = null, exact = false, sends = 0, binding = 0;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const options = { endpoint: record.endpoint, method: 'POST' as const, body: { ...values, catalog_id: id }, serverKey: 'command_id' as const, source: record.source };
  const first = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => key,
    send: async () => { sends++; throw { status: 409, details: { error: { code: 'conflict' } } }; }, read: async () => ({}) });
  await first.hydrate(); await first.run(options, { ownerHref: record.ownerHref, refreshPath: record.refreshPath, assertActive() {} });
  assert.equal(JSON.parse(raw!).phase, 'unknown');
  const second = new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => actor,
    captureContext: () => { const captured = binding; return { assertCurrent() { assert.equal(binding, captured, 'World changed'); } }; },
    send: async () => { sends++; if (exact) throw terminalRefusal(record); throw { status: 503 }; }, read: async () => ({}) });
  await second.hydrate(); await second.recover({ ownerHref: record.ownerHref, assertActive() {} });
  assert.equal(JSON.parse(raw!).phase, 'unknown');
  exact = true; await second.recover({ ownerHref: record.ownerHref, assertActive() { binding++; } });
  assert.ok(raw); // A stale mounted/world context cannot consume even a real proof.
  await second.recover({ ownerHref: record.ownerHref, assertActive() {} });
  assert.equal(raw, null); assert.equal(second.snapshot().obsolete, true); assert.equal(sends, 3);
});
