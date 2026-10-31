import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { acceptedCampusMembership, campusMembershipActionAllowed, campusMembershipInput, campusMembershipSource, parseCampusMember, parsePeopleAccess, peopleAccessEndpoint, peopleAccessRead, peopleSetupDestinations, resolveCampusMembershipRefresh } from '../src/lib/people-access';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';
const school = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333', user = '44444444-4444-4444-8444-444444444444', key = '55555555-5555-4555-8555-555555555555';
const scope: NativePendingScope = { actorId: user, schoolId: school, mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const member = { id, user_id: user, first_name: 'Staff', last_name: 'One', email: 'staff@example.test', role: 'staff', is_active: true }, data = { school: { id: school, name: 'Campus' }, members: [member] };
function action(values: Partial<NativePendingAction> = {}): NativePendingAction { return { version: 1, domain: 'people', scope, clientId: key, ownerHref: '/more/setup/people/access', endpoint: peopleAccessEndpoint(school, id), refreshPath: peopleAccessRead(school), method: 'PATCH', payload: { kind: 'json', body: JSON.stringify({ is_active: false }) }, source: campusMembershipSource(member), phase: 'prepared', replayPolicy: 'inspect_only', createdAt: '2026-10-29T10:00:00Z', ...values }; }
test('membership reads reject another campus, duplicate identities and malformed scalar fields', () => {
  assert.equal(parsePeopleAccess(data, school).members[0]!.user_id, user); assert.equal('password' in parseCampusMember({ ...member, password: 'secret' }), false);
  for (const changed of [{ ...data, school: { id: other, name: 'Other' } }, { ...data, members: [member, member] }, { ...data, members: [{ ...member, is_active: 1 }] }, { ...data, members: [{ ...member, user_id: 'wrong' }] }]) assert.throws(() => parsePeopleAccess(changed, school));
});
test('current exact source and last administrator checks precede membership changes', () => {
  assert.deepEqual(campusMembershipInput(member, false, [member]), { is_active: false }); assert.throws(() => campusMembershipInput(member, false, [{ ...member, email: 'changed@example.test' }])); assert.throws(() => campusMembershipInput(member, true, [member]));
  const admin = { ...member, role: 'admin' }; assert.throws(() => campusMembershipInput(admin, false, [admin])); assert.deepEqual(campusMembershipInput(admin, false, [admin, { ...admin, id: other, user_id: key }]), { is_active: false });
  assert.throws(() => campusMembershipInput({ ...member, role: 'student' }, false, [{ ...member, role: 'student' }]));
});
test('membership journal permits only its exact source, active-state body and owner path', () => {
  assert.equal(campusMembershipActionAllowed(action(), scope), true);
  const simulation = { ...scope, mode: 'simulation' as const, namespaceId: other }; assert.equal(campusMembershipActionAllowed(action({ scope: simulation }), simulation), true);
  for (const changed of [action({ method: 'POST' }), action({ replayPolicy: 'same_request' }), action({ ownerHref: '/more/setup/people/access?school=' + other }), action({ endpoint: peopleAccessEndpoint(other, id) }), action({ refreshPath: peopleAccessRead(other) }), action({ payload: { kind: 'json', body: JSON.stringify({ is_active: false, role: 'admin' }) } }), action({ source: { ...action().source!, fingerprint: JSON.stringify({ ...member, password: 'secret' }) } })]) assert.equal(campusMembershipActionAllowed(changed, scope), false);
});
test('acknowledgement and accepted-source checks reject another member, role, account or state', () => {
  assert.equal(resolveCampusMembershipRefresh({ id, updated: true }, action()), peopleAccessRead(school));
  for (const receipt of [{ id: other, updated: true }, { id, updated: false }, {}]) assert.throws(() => resolveCampusMembershipRefresh(receipt, action()));
  const accepted = action({ phase: 'accepted' }); assert.equal(acceptedCampusMembership({ ...data, members: [{ ...member, is_active: false }] }, accepted).id, id);
  for (const changed of [{ ...member, is_active: true }, { ...member, is_active: false, role: 'admin' }, { ...member, is_active: false, user_id: other }]) assert.throws(() => acceptedCampusMembership({ ...data, members: [changed] }, accepted));
});
test('People setup rows come only from current contributed destinations', () => {
  const manifest = { areas: [{ key: 'people', surfaces: [{ key: 'records', label: 'Records', href: '/areas/people/records' }] }], more: { setup: [{ key: 'people', label: 'Account access', href: '/more/setup/people' }, { key: 'invitations', label: 'Invitations', href: '/more/setup/people/invitations' }] } } as unknown as WorkspaceManifest;
  assert.deepEqual(peopleSetupDestinations(manifest)?.map(row => row.href), ['/areas/people/records', '/more/setup/people/access', '/more/setup/people/invitations']);
  assert.equal(peopleSetupDestinations({ ...manifest, more: { ...manifest.more, setup: [] } }), null);
});
test('unknown membership mutation is never replayed or cleared by a matching active state', async () => {
  let raw: string | null = null, sends = 0, reads = 0; const storage: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } };
  const options = { scope, domain: 'people' as const, storage, randomId: () => key, send: async () => { sends++; throw new Error('Lost response'); }, read: async () => { reads++; return { ...data, members: [{ ...member, is_active: false }] }; } }, context = { ownerHref: action().ownerHref, refreshPath: action().refreshPath, assertActive() {}, resolveRefreshPath: resolveCampusMembershipRefresh, accepted: (value: unknown, _assert: () => void, retained: NativePendingAction) => { acceptedCampusMembership(value, retained); } };
  const first = new NativePendingActionJournal(options); await first.hydrate(); await first.run({ endpoint: action().endpoint, method: 'PATCH', body: { is_active: false }, serverKey: null, replayPolicy: 'inspect_only', source: action().source }, context);
  assert.ok(raw); const restarted = new NativePendingActionJournal(options); await restarted.hydrate(); assert.equal(await restarted.recover(context), false); assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(restarted.snapshot().action?.phase, 'unknown');
});
