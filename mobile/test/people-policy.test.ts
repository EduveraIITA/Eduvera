import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationStatus, isPeopleDate, mayInvitePerson, peopleContact, peopleDates, peopleMemberIds, peopleNameFields } from '../src/lib/people-policy';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const key = '00000000-0000-4000-8000-000000000001';
const ownerHref = '/areas/people/participants?person_id=person&edit=contact';
const endpoint = '/api/v1/schools/campus/people/participants/person/profile';
const context = { ownerHref, refreshPath: '/api/v1/schools/campus/people/participants/person', assertActive() {} };
function action(patch: Partial<NativePendingAction> = {}): NativePendingAction { return { version: 1, domain: 'people', scope, clientId: key, ownerHref, endpoint, refreshPath: context.refreshPath, method: 'PATCH', payload: { kind: 'json', body: JSON.stringify({ idempotency_key: key, expected_revision: 7, contact_email: 'campus@example.org' }) }, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-27T00:00:00Z', ...patch }; }
function memory(initial: string | null = null) { let raw = initial; const storage: NativePendingStorage = { read: async () => raw, write: async next => { raw = next; }, clear: async () => { raw = null; } }; return { storage, get raw() { return raw; } }; }

test('whole names are preserved without guessing family-name boundaries', () => {
  assert.deepEqual(peopleNameFields('  अजय कुमार  '), { first_name: 'अजय कुमार', last_name: '' });
  assert.throws(() => peopleNameFields(' ')); assert.throws(() => peopleNameFields('a'.repeat(151)));
});
test('dated membership validates calendar dates and inclusive ordering', () => {
  assert.equal(isPeopleDate('2028-02-29'), true); assert.equal(isPeopleDate('2027-02-29'), false);
  assert.equal(isPeopleDate('2026-02-30'), false); assert.equal(isPeopleDate('2026-2-03'), false);
  assert.deepEqual(peopleDates('2026-10-27', '2026-10-27'), { starts_on: '2026-10-27', ends_on: '2026-10-27' });
  assert.throws(() => peopleDates('2026-10-27', '2026-10-26'));
});
test('contact correction allows clearing and does not normalize account identity', () => {
  assert.deepEqual(peopleContact('  Staff@Example.org  ', '  +91 123  '), { contact_email: 'Staff@Example.org', contact_phone: '+91 123' });
  assert.deepEqual(peopleContact('', ''), { contact_email: '', contact_phone: '' });
  assert.throws(() => peopleContact('not-an-address', '')); assert.throws(() => peopleContact('', '1'.repeat(33)));
});
test('app invitation requires exact capability and remains Live-only', () => {
  const unlinked = { account_state: 'not_linked' as const, has_account: false, is_you: false };
  assert.equal(mayInvitePerson(unlinked, { can_invite: true }, 'live'), true);
  for (const account of [{ is_you: true }, { has_account: true }, { account_state: 'active' as const }, { account_state: 'inactive' as const }]) assert.equal(mayInvitePerson(account, { can_invite: true }, 'live'), false);
  assert.equal(mayInvitePerson(unlinked, { can_invite: true }, 'simulation'), false);
  assert.equal(mayInvitePerson(unlinked, {}, 'live'), false);
  assert.equal(mayInvitePerson({}, { can_invite: true }, 'live'), false);
});
test('group edits retain all distinct canonical IDs and reject ambiguous membership', () => {
  const other = '00000000-0000-4000-8000-000000000002';
  assert.deepEqual(peopleMemberIds([key, other]), [key, other]);
  assert.throws(() => peopleMemberIds([key, key])); assert.throws(() => peopleMemberIds([])); assert.throws(() => peopleMemberIds(['display-name']));
});
test('invitation delivery is separate from recipient acceptance', () => {
  const base = { accepted_at: null, revoked_at: null, expires_at: '2026-10-28T00:00:00Z' };
  assert.equal(invitationStatus(base, Date.parse('2026-10-27T00:00:00Z')), 'Pending');
  assert.equal(invitationStatus(base, Date.parse('2026-10-29T00:00:00Z')), 'Expired');
  assert.equal(invitationStatus({ ...base, accepted_at: '2026-10-27T00:00:00Z' }), 'Accepted');
  assert.equal(invitationStatus({ ...base, revoked_at: '2026-10-27T00:00:00Z' }), 'Revoked');
});
test('People journal accepts same-school PATCH and invitation endpoints only', () => {
  assert.equal(validateNativePendingAction(action(), scope, 'people'), true);
  assert.equal(validateNativePendingAction(action({ endpoint: '/api/v1/schools/other/people/participants/person/profile' }), scope, 'people'), false);
  assert.equal(validateNativePendingAction(action({ endpoint: '/api/v1/schools/campus/invitations/' }), scope, 'people'), true);
  assert.equal(validateNativePendingAction(action({ endpoint: '/api/v1/auth/native/login/' }), scope, 'people'), false);
  assert.equal(validateNativePendingAction(action({ scope: { ...scope, origin: 'https://other.example' } }), scope, 'people'), false);
  assert.equal(validateNativePendingAction(action({ scope: { ...scope, mode: 'simulation', namespaceId: 'world' } }), scope, 'people'), false);
});
test('family-link retained requests must explicitly bind the active school', () => {
  const family = action({ endpoint: '/api/v1/people/guardian-links', method: 'POST', payload: { kind: 'json', body: JSON.stringify({ school_id: scope.schoolId, idempotency_key: key, person: { id: 'person', expected_revision: 7 } }) } });
  assert.equal(validateNativePendingAction(family, scope, 'people'), true);
  assert.equal(validateNativePendingAction({ ...family, payload: { kind: 'json', body: JSON.stringify({ school_id: 'other', idempotency_key: key }) } }, scope, 'people'), false);
  assert.equal(validateNativePendingAction({ ...family, payload: { kind: 'json', body: JSON.stringify({ idempotency_key: key }) } }, scope, 'people'), false);
});
test('People recovery cannot read another school or an unrelated domain', () => {
  assert.equal(validateNativePendingAction(action({ refreshPath: '/api/v1/schools/other/people/participants/person' }), scope, 'people'), false);
  assert.equal(validateNativePendingAction(action({ refreshPath: '/api/v1/departure/manager/' }), scope, 'people'), false);
  assert.equal(validateNativePendingAction(action({ refreshPath: '/api/v1/schools/campus/invitations/invite/' }), scope, 'people'), true);
});
test('Simulation journal cannot stage or replay real account invitations', () => {
  const simulation: NativePendingScope = { ...scope, mode: 'simulation', namespaceId: 'selected-world' };
  const invite = action({ scope: simulation, endpoint: '/api/v1/schools/campus/invitations/' });
  assert.equal(validateNativePendingAction(invite, simulation, 'people'), false);
  assert.equal(validateNativePendingAction(action({ scope: simulation }), simulation, 'people'), true);
});
test('lost People correction response replays exact revision and bytes after relaunch', async () => {
  const store = memory(); const sent: NativePendingAction[] = [];
  const make = (lost: boolean) => new NativePendingActionJournal({ scope, domain: 'people', storage: store.storage, randomId: () => key, send: async current => { sent.push(current); if (lost) throw new Error('Lost response'); return {}; }, read: async () => ({ revision: 8 }) });
  const initial = make(true); await initial.hydrate(); await initial.run({ endpoint, method: 'PATCH', body: { expected_revision: 7, contact_email: 'original@example.org', reason: 'Correct contact' }, serverKey: 'idempotency_key' }, context);
  assert.ok(store.raw); const resumed = make(false); await resumed.hydrate();
  assert.equal(await resumed.run({ endpoint, body: { contact_email: 'different@example.org' } }, context), false);
  assert.equal(await resumed.recover(context), true); assert.equal(sent.length, 2); assert.deepEqual(sent[0]?.payload, sent[1]?.payload); assert.equal(sent[1]?.clientId, key); assert.equal(store.raw, null);
});
test('lost resend response is inspect-only and never sends another invitation', async () => {
  const store = memory(); let sends = 0, reads = 0;
  const make = () => new NativePendingActionJournal({ scope, domain: 'people', storage: store.storage, randomId: () => key, send: async () => { sends++; throw new Error('Lost email response'); }, read: async () => { reads++; return { delivery: 'email_accepted' }; } });
  const initial = make(); await initial.hydrate(); await initial.run({ endpoint: '/api/v1/schools/campus/invitations/invite/resend/', body: {}, serverKey: null, replayPolicy: 'inspect_only' }, context);
  const resumed = make(); await resumed.hydrate(); assert.equal(await resumed.recover(context), false); assert.equal(sends, 1); assert.equal(reads, 1); assert.ok(store.raw);
});
test('accepted People write with failed refresh recovers through reads only', async () => {
  const store = memory(); let sends = 0;
  const initial = new NativePendingActionJournal({ scope, domain: 'people', storage: store.storage, randomId: () => key, send: async () => { sends++; return {}; }, read: async () => { throw new Error('Refresh unavailable'); } });
  await initial.hydrate(); await initial.run({ endpoint, method: 'PATCH', body: { expected_revision: 7 }, serverKey: 'idempotency_key' }, context);
  assert.equal(JSON.parse(store.raw!).phase, 'accepted');
  const resumed = new NativePendingActionJournal({ scope, domain: 'people', storage: store.storage, randomId: () => key, send: async () => { sends++; }, read: async () => ({ revision: 8 }) });
  await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1); assert.equal(store.raw, null);
});
