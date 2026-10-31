import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativePendingAction, NativePendingActionJournal, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const command = '00000000-0000-4000-8000-000000000001';
function action(endpoint: string, refreshPath: string, body: Record<string,unknown> = {}): NativePendingAction { return { version: 1, domain: 'learning', scope, clientId: command, ownerHref: '/areas/messages/assignments?scope=offering&offering_id=group', endpoint, refreshPath, method: 'POST', payload: { kind: 'json', body: JSON.stringify({ ...body, command_id: command }) }, source: { kind: 'offering', sourceId: 'group', revision: 2 }, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-29T00:00:00.000Z' }; }

for (const [endpoint, refresh] of [
  ['/api/v1/learning/offerings/', '/api/v1/learning/offerings/group/'],
  ['/api/v1/learning/offerings/group/enrollments/', '/api/v1/learning/offerings/group/'],
  ['/api/v1/learning/offerings/group/instructors/', '/api/v1/learning/offerings/group/'],
  ['/api/v1/learning/offerings/group/enrollments/person/end/', '/api/v1/learning/offerings/group/'],
  ['/api/v1/learning/practice/', '/api/v1/learning/practice/practice/?class_section_id=class&page=1'],
  ['/api/v1/learning/practice/practice/notes/', '/api/v1/learning/practice/practice/?class_section_id=class&student_id=learner&page=1'],
] as const) test(`${endpoint} retains an exact authorized learning command and owning read`, () => {
  const value = action(endpoint, refresh);
  assert.equal(validateNativePendingAction(value, scope, 'learning'), true);
  const simulation = { ...scope, mode: 'simulation' as const, namespaceId: 'run:one' };
  assert.equal(validateNativePendingAction({ ...value, scope: simulation }, simulation, 'learning'), true);
  assert.equal(validateNativePendingAction(value, simulation, 'learning'), false);
});

test('retained learning mutation cannot change domain, actor, school, server, world or command identity', () => {
  const value = action('/api/v1/learning/offerings/', '/api/v1/learning/offerings/group/');
  for (const endpoint of ['/api/v1/chat/messages/', '/api/v1/auth/native/logout/', '/api/v1/learning/offerings-else/', '/api/v1/learning/offerings/../auth/', '//outside.example/api/v1/learning/offerings/', 'https://outside.example/api/v1/learning/offerings/', '/api/v1/learning/offerings/#other']) assert.equal(validateNativePendingAction({ ...value, endpoint }, scope, 'learning'), false, endpoint);
  assert.equal(validateNativePendingAction({ ...value, domain: 'messages' }, scope, 'learning'), false);
  for (const other of [{ ...scope, actorId: 'other' }, { ...scope, schoolId: 'other' }, { ...scope, origin: 'https://other.example' }]) assert.equal(validateNativePendingAction(value, other, 'learning'), false);
  assert.equal(validateNativePendingAction({ ...value, payload: { kind: 'json', body: JSON.stringify({ command_id: 'different' }) } }, scope, 'learning'), false);
});

test('learning recovery reads cannot cross into another API domain or an external path', () => {
  const value = action('/api/v1/learning/practice/', '/api/v1/learning/practice/practice/?class_section_id=class');
  for (const refreshPath of ['/api/v1/chat/messages/', '/api/v1/auth/native/session/', '/api/v1/schools/campus/people/participants', '/api/v1/learning/practice-else/', '//outside.example/api/v1/learning/practice/', '/api/v1/learning/practice/../auth/']) assert.equal(validateNativePendingAction({ ...value, refreshPath }, scope, 'learning'), false, refreshPath);
});

test('group command response loss retains exact people/revisions and accepted recovery only reads', async () => {
  let raw: string | null = null, sends = 0, reads = 0;
  const store: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } };
  const input = { endpoint: '/api/v1/learning/offerings/', body: { offering_id: 'fixed-group', participants: [{ id: 'person', expected_revision: 4 }], instructor: { id: 'instructor', expected_revision: 7 }, starts_on: '2026-10-29', name: 'Robotics' }, serverKey: 'command_id' as const };
  const context = { ownerHref: '/areas/messages/assignments?create=group', refreshPath: '/api/v1/learning/offerings/fixed-group/', assertActive() {} };
  const sent: NativePendingAction[] = [];
  const first = new NativePendingActionJournal({ scope, domain: 'learning', storage: store, randomId: () => command, send: async value => { sends++; sent.push(value); throw new Error('Response lost'); }, read: async () => ({}) });
  await first.hydrate(); assert.equal(await first.run(input,context), false);
  const second = new NativePendingActionJournal({ scope, domain: 'learning', storage: store, randomId: () => { throw new Error('A replacement command must not be minted'); }, send: async value => { sends++; sent.push(value); return { id: 'fixed-group' }; }, read: async () => { reads++; throw new Error('Accepted source read unavailable'); } });
  await second.hydrate(); assert.equal(await second.recover(context), false);
  assert.deepEqual(sent[0]?.payload, sent[1]?.payload); assert.equal(sent[0]?.clientId, sent[1]?.clientId);
  assert.equal(JSON.parse(raw!).phase, 'accepted');
  const third = new NativePendingActionJournal({ scope, domain: 'learning', storage: store, randomId: () => command, send: async () => { throw new Error('Accepted recovery must not mutate'); }, read: async () => { reads++; return { id: 'fixed-group' }; } });
  await third.hydrate(); assert.equal(await third.recover(context), true); assert.equal(sends,2); assert.equal(reads,2); assert.equal(raw,null);
});
