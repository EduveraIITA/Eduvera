import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiDiaryItem } from '../../packages/contracts/src/wire/features/school/api';
import { learningDiaryCommand, learningDiaryRefreshPath } from '../src/lib/learning-diary-policy';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingInput, type NativePendingScope } from '../src/lib/native-pending-action';

const item = { id: 'diary', item_type: 'homework', completed: false, requires_acknowledgement: true, acknowledged: false } as ApiDiaryItem;
const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const command = '00000000-0000-4000-8000-000000000001';
function retained(input: NativePendingInput): NativePendingAction {
  const body = { ...input.body };
  if (input.serverKey === 'command') body.command = { ...(body.command as object ?? {}), command_id: command };
  return { version: 1, domain: 'learning', scope, clientId: command, ownerHref: '/areas/messages/diary?scope=self&student_id=learner&diary_item=diary', endpoint: input.endpoint, refreshPath: '/api/v1/diary/diary/?student_id=learner', method: input.method ?? 'POST', payload: { kind: 'json', body: JSON.stringify(body) }, source: input.source, phase: 'unknown', replayPolicy: input.replayPolicy ?? 'same_request', createdAt: '2026-10-29T00:00:00.000Z' };
}
test('homework completion and reopening bind the exact learner and requested state', () => {
  const complete = retained(learningDiaryCommand(item,'learner','complete','','note'));
  assert.equal(learningDiaryRefreshPath({ item_id: 'diary', student_id: 'learner', completed: true },complete),complete.refreshPath);
  for (const change of [{ item_id: 'other' },{ student_id: 'sibling' },{ completed: false }]) assert.throws(() => learningDiaryRefreshPath({ item_id: 'diary', student_id: 'learner', completed: true, ...change },complete));
  const reopen = retained(learningDiaryCommand({...item,completed:true},'learner','complete','','note'));
  assert.equal(reopen.method,'DELETE'); assert.equal(new URL(reopen.endpoint,scope.origin).searchParams.get('student_id'),'learner');
  assert.equal(learningDiaryRefreshPath({ item_id: 'diary', student_id: 'learner', completed: false },reopen),reopen.refreshPath);
  assert.throws(() => learningDiaryRefreshPath({ item_id: 'diary', student_id: 'learner', completed: true },reopen));
});
test('missing completion evidence cannot be coerced into a completion command', () => {
  for (const value of [{...item,completed:null},{...item,item_type:'note' as const}]) assert.throws(() => learningDiaryCommand(value,'learner','complete','','note'));
});
test('homework notes retain the original note ID and verify the owning receipt', () => {
  const input = learningDiaryCommand(item,'learner','note','  What should I bring?  ','original-note'), action = retained(input);
  assert.equal(input.replayPolicy,'same_request'); assert.equal(input.serverKey,'command');
  assert.equal(learningDiaryRefreshPath({id:'original-note',replayed:true},action),action.refreshPath);
  assert.throws(() => learningDiaryRefreshPath({id:'different-note'},action));
  assert.throws(() => learningDiaryRefreshPath({id:'original-note'},{...action,refreshPath:'/api/v1/diary/diary/?student_id=sibling'}));
});
test('non-homework notes use inspect-only because the legacy handler ignores command IDs', () => {
  const input = learningDiaryCommand({...item,item_type:'announcement'},'learner','note','Question','unused'), action = retained(input);
  assert.equal(input.replayPolicy,'inspect_only'); assert.equal(input.serverKey,null); assert.equal('command' in input.body!,false);
  assert.equal(learningDiaryRefreshPath({id:'server-note',body:'Question',created_at:'2026-10-29T00:00:00Z'},action),action.refreshPath);
  assert.throws(() => learningDiaryRefreshPath({id:'server-note',body:'Other',created_at:'2026-10-29T00:00:00Z'},action));
  assert.throws(() => learningDiaryRefreshPath({id:'server-note',body:'Question',created_at:'2026-10-29T00:00:00Z'},{...action,replayPolicy:'same_request'}));
});
test('an uncertain legacy note is only read after restart and is never sent twice', async () => {
  let raw: string | null = null, sends = 0, reads = 0;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const context = { ownerHref: '/areas/messages/diary?scope=self&student_id=learner&diary_item=diary', refreshPath: '/api/v1/diary/diary/?student_id=learner', assertActive() {}, resolveRefreshPath: learningDiaryRefreshPath };
  const first = new NativePendingActionJournal({ scope, domain: 'learning', storage, randomId: () => command, send: async () => { sends++; throw new Error('Response lost'); }, read: async () => { reads++; return item; } });
  await first.hydrate(); assert.equal(await first.run(learningDiaryCommand({...item,item_type:'note'},'learner','note','Question','unused'),context),false);
  const restarted = new NativePendingActionJournal({ scope, domain: 'learning', storage, randomId: () => { throw new Error('No replacement command'); }, send: async () => { throw new Error('Legacy note must not replay'); }, read: async () => { reads++; return item; } });
  await restarted.hydrate(); assert.equal(await restarted.recover(context),false); assert.equal(sends,1); assert.equal(reads,1); assert.equal(JSON.parse(raw!).phase,'unknown');
});
test('already acknowledged items and invalid private note lengths fail before preparation', () => {
  assert.throws(() => learningDiaryCommand({...item,acknowledged:true},'learner','acknowledge','','note'));
  assert.throws(() => learningDiaryCommand({...item,requires_acknowledgement:false},'learner','acknowledge','','note'));
  for (const body of ['x',' '.repeat(10),'a'.repeat(2001)]) assert.throws(() => learningDiaryCommand(item,'learner','note',body,'note'));
  const acknowledgement = retained(learningDiaryCommand(item,'learner','acknowledge','','note'));
  assert.equal(acknowledgement.replayPolicy,'inspect_only'); assert.equal(learningDiaryRefreshPath({id:'ack',acknowledged_at:'2026-10-29T00:00:00Z'},acknowledgement),acknowledgement.refreshPath);
});
