import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope, type NativePendingSource } from '../src/lib/native-pending-action';

const school = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
const item = '20000000-0000-4000-8000-000000000001', event = '30000000-0000-4000-8000-000000000001';
const session = '40000000-0000-4000-8000-000000000001', child = '50000000-0000-4000-8000-000000000001';
const key = '60000000-0000-4000-8000-000000000001';
const scope: NativePendingScope = { actorId: 'actor', schoolId: school, origin: 'https://campus.example', mode: 'live', namespaceId: null };
const schoolRoot = `/api/v1/schools/${school}`, events = '/api/v1/campus-events';
function action(domain: NativePendingAction['domain'], endpoint: string, refreshPath: string, body: Record<string, unknown>, source?: NativePendingSource): NativePendingAction {
  return { version: 1, domain, scope, clientId: key, ownerHref: `/areas/${domain}`, endpoint, refreshPath, source, method: 'POST', payload: { kind: 'json', body: JSON.stringify(body) }, phase: 'prepared', replayPolicy: 'same_request', createdAt: '2026-10-27T12:00:00Z' };
}
const valid = (record: NativePendingAction) => validateNativePendingAction(record, scope, record.domain);

test('legacy resource setup retains only exact same-school unkeyed creation or revision-bound edits', () => {
  const root = schoolRoot + '/institution-setup';
  const create = { ...action('resources', root + '/resource-types/', root + '/', { name: 'Laptop', code: 'laptop' }, { kind: 'resource_type_creation', sourceId: school, revision: 0 }), replayPolicy: 'inspect_only' as const };
  assert.equal(valid(create), true);
  for (const changed of [
    { ...create, endpoint: root.replace(school, other) + '/resource-types/' },
    { ...create, refreshPath: root.replace(school, other) + '/' },
    { ...create, replayPolicy: 'same_request' as const },
    { ...create, payload: { kind: 'json' as const, body: JSON.stringify({ name: 'Laptop', command_id: key }) } },
    { ...create, source: { ...create.source!, revision: 1 } },
  ]) assert.equal(valid(changed), false);
  const edit = { ...create, method: 'PATCH' as const, endpoint: `${root}/assets/${item}/`, source: { kind: 'resource_item', sourceId: item, revision: 8 }, payload: { kind: 'json' as const, body: JSON.stringify({ name: 'Laptop', expected_revision: 8 }) } };
  assert.equal(valid(edit), true);
  assert.equal(valid({ ...edit, source: { ...edit.source, sourceId: other } }), false);
  assert.equal(valid({ ...edit, payload: { kind: 'json', body: '{"expected_revision":7}' } }), false);
});

test('lost legacy setup response remains inspect-only after relaunch and a matching current row is not a receipt', async () => {
  let raw: string | null = null, sends = 0, reads = 0;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const create = () => new NativePendingActionJournal({ scope, domain: 'resources', storage, randomId: () => key,
    send: async () => { sends++; throw new Error('Lost reply'); }, read: async () => { reads++; return { resource_types: [{ name: 'Laptop' }] }; } });
  const root = schoolRoot + '/institution-setup', context = { ownerHref: '/areas/resources?view=setup', refreshPath: root + '/', assertActive() {} };
  const first = create(); await first.hydrate();
  await first.run({ endpoint: root + '/resource-types/', body: { name: 'Laptop', code: 'laptop' }, serverKey: null, replayPolicy: 'inspect_only', source: { kind: 'resource_type_creation', sourceId: school, revision: 0 } }, context);
  const resumed = create(); await resumed.hydrate(); assert.equal(await resumed.recover(context), false);
  assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(resumed.snapshot().action?.phase, 'unknown'); assert.ok(raw);
});

test('facilities settings allow the real first revision zero and bind exact campus, source and keyed body', () => {
  const root = schoolRoot + '/facilities/settings';
  const record = action('facilities', root, root, { command_id: key, expected_revision: 0, handler_person_id: item }, { kind: 'facilities_settings', sourceId: school, revision: 0 });
  assert.equal(valid(record), true);
  assert.equal(valid({ ...record, source: { ...record.source!, sourceId: other } }), false);
  assert.equal(valid({ ...record, refreshPath: root + '?school_id=' + other }), false);
  assert.equal(valid({ ...record, replayPolicy: 'inspect_only' }), false);
  assert.equal(valid({ ...record, payload: { kind: 'json', body: JSON.stringify({ command_id: key, expected_revision: 1 }) } }), false);
});

test('repair photos bind JPEG/PNG bytes journal to exact repair, revision, command and bounded file', () => {
  const root = schoolRoot + '/facilities/repairs/' + item;
  const record: NativePendingAction = { ...action('facilities', root + '/photos', root, {}, { kind: 'facilities_photo', sourceId: item, revision: 3 }), payload: { kind: 'multipart', fields: { command_id: key, expected_revision: '3' }, file: { uri: 'file:///private/app/photo.png', name: 'photo.png', type: 'image/png', size: 80, hash: 'a'.repeat(64) } } };
  assert.equal(valid(record), true);
  const payload = record.payload as Extract<NativePendingAction['payload'], { kind: 'multipart' }>;
  assert.equal(valid({ ...record, refreshPath: root.replace(item, other) }), false);
  assert.equal(valid({ ...record, source: { ...record.source!, revision: 4 } }), false);
  assert.equal(valid({ ...record, payload: { ...payload, fields: { ...payload.fields, caption: 'not a supported server field' } } }), false);
  assert.equal(valid({ ...record, payload: { ...payload, file: { ...payload.file, size: 5 * 1024 * 1024 + 1 } } }), false);
  assert.equal(valid({ ...record, payload: { ...payload, file: { ...payload.file, type: 'image/webp' } } }), false);
});

test('event creation accepts exact root but requires original creation source and resolved accepted detail', () => {
  const record = action('events', events, `${events}/catalog?school_id=${school}`, { school_id: school, title: 'Campus day', idempotency_key: key }, { kind: 'event_creation', sourceId: school, revision: 0, fingerprint: 'b'.repeat(64) });
  assert.equal(valid(record), true);
  assert.equal(valid({ ...record, source: undefined }), false);
  assert.equal(valid({ ...record, source: { ...record.source!, fingerprint: undefined } }), false);
  assert.equal(valid({ ...record, phase: 'accepted' }), false);
  assert.equal(valid({ ...record, phase: 'accepted', refreshPath: `${events}/${event}?school_id=${school}` }), true);
  assert.equal(valid({ ...record, refreshPath: `/api/v1/chat/conversations?school_id=${school}` }), false);
  assert.equal(valid({ ...record, phase: 'accepted', refreshPath: `/api/v1/secret-events/${event}?school_id=${school}` }), false);
});

test('event recovery reads cannot switch campus, event, child, domain or duplicate query scope', () => {
  const record = action('events', `${events}/${event}/rsvp`, `${events}/${event}?school_id=${school}&student_id=${child}`, { school_id: school, student_id: child, expected_revision: 2, idempotency_key: key });
  assert.equal(valid(record), true);
  for (const path of [ `${events}/${other}?school_id=${school}&student_id=${child}`, `${events}/${event}?school_id=${other}&student_id=${child}`, `${events}/${event}?school_id=${school}&student_id=${other}`, `${events}/${event}?school_id=${school}&school_id=${school}`, '/api/v1/auth/profile/', `${events}/${event}/finance?school_id=${school}` ]) assert.equal(valid({ ...record, refreshPath: path }), false);
  const publishedFromFamily = { ...record, ownerHref: `/areas/events/calendar/${event}?scope=dependent&student_id=${child}`, endpoint: `${events}/${event}/publish`, payload: { kind: 'json' as const, body: JSON.stringify({ school_id: school, expected_revision: 2, idempotency_key: key }) } };
  assert.equal(valid(publishedFromFamily), true);
  assert.equal(valid({ ...publishedFromFamily, refreshPath: `${events}/${event}?school_id=${school}` }), false);
  assert.equal(valid({ ...publishedFromFamily, ownerHref: publishedFromFamily.ownerHref + `&student_id=${child}` }), false);
  const differentBodyChild = { ...record, ownerHref: publishedFromFamily.ownerHref, endpoint: `${events}/${event}/consent`, refreshPath: `${events}/${event}?school_id=${school}&student_id=${other}`, payload: { kind: 'json' as const, body: JSON.stringify({ school_id: school, student_id: other, expected_revision: 2, idempotency_key: key }) } };
  assert.equal(valid(differentBodyChild), false);
  assert.equal(valid({ ...record, refreshPath: `${events}/${event}?school_id=${school}` }), false);
});

test('event arrangement saves and register recovery retain exact source and session', () => {
  const body = { school_id: school, expected_revision: 4, idempotency_key: key };
  const save = action('events', `${events}/${event}/save`, `${events}/${event}?school_id=${school}`, body, { kind: 'event', sourceId: event, revision: 4 });
  assert.equal(valid(save), true); assert.equal(valid({ ...save, source: undefined }), false);
  assert.equal(valid({ ...save, source: { ...save.source!, revision: 3 } }), false);
  const register = { ...save, endpoint: `${events}/${event}/sessions/${session}/attendance`, refreshPath: `${events}/${event}/sessions/${session}/roster?school_id=${school}`, source: { kind: 'event_session', sourceId: session, revision: 4 } };
  assert.equal(valid(register), true);
  assert.equal(valid({ ...register, refreshPath: register.refreshPath.replace(session, other) }), false);
});

test('event financial actions bind exact participant snapshot and never invent an expected revision contract', () => {
  const record = action('events', `${events}/${event}/participants/${child}/refunds`, `${events}/${event}/finance?school_id=${school}&student_id=${child}`, { school_id: school, idempotency_key: key, amount_paise: 2000, method: 'cash', reason: 'Recorded refund' }, { kind: 'event_finance_participant', sourceId: child, revision: 5, fingerprint: 'c'.repeat(64) });
  assert.equal(valid(record), true);
  assert.equal(valid({ ...record, source: { ...record.source!, sourceId: other } }), false);
  assert.equal(valid({ ...record, refreshPath: `${events}/${event}/finance?school_id=${school}` }), false);
  const body = JSON.parse((record.payload as { body: string }).body);
  assert.equal(valid({ ...record, payload: { kind: 'json', body: JSON.stringify({ ...body, expected_revision: 5 }) } }), false);
});
