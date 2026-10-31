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
