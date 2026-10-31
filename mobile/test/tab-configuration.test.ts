import assert from 'node:assert/strict';
import test from 'node:test';
import { createTabConfigurationCommand, createTabConfigurationPermit, prepareTabConfigurationChange, tabConfigurationGuards, tabConfigurationKeys, type TabConfigurationGuard, type TabConfigurationPermit, type TabConfigurationSnapshot } from '../src/lib/tab-configuration';
import type { CampusNavigationState } from '../src/lib/back-policy';

const scope = 'actor:campus:live';
const state: CampusNavigationState = { key: 'root',index: 0,routes: [{ key: 'campus',name: '(campus)',state: { key: 'tabs',index: 0,routes: [
  { key: 'more',name: 'more',state: { key: 'more-stack',index: 0,routes: [{ key: 'account',name: '[...path]' }] } },
  { key: 'areas',name: 'areas',state: { key: 'areas-stack',index: 0,routes: [{ key: 'events',name: '[...path]' }] } },
] } },{ key: 'public',name: '(public)' }] };
function fixture() {
  const cleared: string[] = [];
  const guard = (id: string, extra: Partial<TabConfigurationGuard> = {}): TabConfigurationGuard => ({ id,key: id === 'assistant' ? 'campus' : 'events',scope,dirty: true,draftSignature: 'question one',onLeave: () => { cleared.push(id); },...extra });
  const assistant = guard('assistant',{ assistant: true });
  const current: { value: TabConfigurationSnapshot | null } = { value: { scope,focusedKey: 'account',href: '/more/account',state,guards: [guard('events'),assistant] } };
  let epoch = 1, sent = 0, prompted = 0, retired = 0, permit: TabConfigurationPermit | undefined;
  let resolve!: (allow: boolean) => void;
  const confirmation = new Promise<boolean>(done => { resolve = done; });
  const assertActive = () => assert.equal(epoch,1);
  const start = (enabled = false) => prepareTabConfigurationChange({ read: () => current.value,enabled,assertActive,confirm: async guards => { assert.deepEqual(guards.map(item => item.id),['assistant']); prompted++; return confirmation; },dispatch: value => { permit = value; sent++; } });
  const command = () => createTabConfigurationCommand({ permit: permit ?? createTabConfigurationPermit(current.value!,false,assertActive),read: () => current.value,assertActive,onRetire() { retired++; } });
  return { current,assistant,guard,cleared,start,resolve,command,get permit() { return permit; },get sent() { return sent; },get prompted() { return prompted; },get retired() { return retired; },rebind() { epoch++; } };
}

test('only disabling affects same-scope tagged campus Assistant guards; workspace routes are stable', () => {
  const f = fixture(), snapshot = f.current.value!;
  const all = { ...snapshot,guards: [...snapshot.guards,f.guard('foreign',{ scope: 'other',assistant: true,key: 'campus' }),f.guard('public',{ key: 'public',assistant: true }),f.guard('unmounted',{ key: 'gone',assistant: true })] };
  assert.deepEqual(tabConfigurationKeys(state,false),[]);
  assert.deepEqual(tabConfigurationGuards(all,false).map(item => item.id),['assistant']);
  assert.deepEqual(tabConfigurationGuards(all,true),[]);
});

test('a remaining actual static Assistant owner protects its descendant guards only', () => {
  const legacy: CampusNavigationState = { ...state,routes: [{ ...state.routes[0]!,state: { key: 'tabs',index: 0,routes: [{ key: 'assistant-tab',name: '(assistant)',state: { key: 'assistant-stack',index: 0,routes: [{ key: 'conversation',name: 'areas/assistant/conversation' }] } }] } },{ key: 'foreign-assistant',name: '(assistant)' }] };
  assert.deepEqual(tabConfigurationKeys(legacy,false),['assistant-tab','conversation']);
  assert.deepEqual(tabConfigurationKeys(legacy,true),[]);
  assert.deepEqual(tabConfigurationGuards({ ...fixture().current.value!,state: legacy,guards: [{ id: 'old',key: 'conversation',scope,dirty: true },{ id: 'foreign',key: 'foreign-assistant',scope,dirty: true }] },false).map(item => item.id),['old']);
});

test('Assistant confirmation precedes POST; acknowledgement and successful completion clear only that draft once', async () => {
  const f = fixture(), pending = f.start();
  assert.equal(f.prompted,1); assert.equal(f.sent,0); assert.deepEqual(f.cleared,[]);
  f.resolve(true); assert.equal(await pending,true); assert.equal(f.sent,1);
  const command = f.command(); assert.equal(command.frozen,true);
  command.acknowledge(); assert.deepEqual(f.cleared,[]); assert.equal(command.frozen,true);
  command.finish(true); assert.deepEqual(f.cleared,['assistant']); assert.equal(command.frozen,false); assert.equal(f.retired,1);
  command.acknowledge(); command.finish(true); command.retire();
  assert.deepEqual(f.cleared,['assistant']); assert.equal(f.retired,1);
  assert.throws(() => createTabConfigurationCommand({ permit: f.permit!,read: () => f.current.value,assertActive() {},onRetire() {} }));
});

test('enabling affects no guard; unrelated dirty or busy Events never blocks either toggle or clears', async () => {
  for (const enabled of [true,false]) {
    const f = fixture(); f.current.value = { ...f.current.value!,guards: [f.guard('events',{ blocked: true })] };
    assert.equal(await f.start(enabled),true); assert.equal(f.prompted,0); assert.equal(f.sent,1);
    const command = f.command(); command.acknowledge(); command.finish(true);
    assert.deepEqual(f.cleared,[]);
  }
  const f = fixture(); f.current.value = { ...f.current.value!,guards: [f.guard('assistant',{ assistant: true,key: 'campus',blocked: true })] };
  assert.equal(await f.start(true),true); assert.equal(f.prompted,0);
  const command = f.command(); command.acknowledge(); command.finish(true); assert.deepEqual(f.cleared,[]);
});

test('busy Assistant refuses Pro off before confirmation or dispatch', async () => {
  const f = fixture(); f.current.value = { ...f.current.value!,guards: [f.guard('assistant',{ assistant: true,key: 'campus',blocked: true })] };
  assert.equal(await f.start(),false); assert.equal(f.prompted,0); assert.equal(f.sent,0); assert.deepEqual(f.cleared,[]);
});

test('cancel or changed scope/focus/href/tree/API/Assistant signature never dispatches', async () => {
  for (const kind of ['cancel','scope','focus','href','tree','api','new','removed','dirty-to-dirty','busy','gone']) {
    const f = fixture(), pending = f.start();
    const snapshot = f.current.value!;
    if (kind === 'scope') f.current.value = { ...snapshot,scope: 'actor:campus:simulation:run' };
    if (kind === 'focus') f.current.value = { ...snapshot,focusedKey: 'other' };
    if (kind === 'href') f.current.value = { ...snapshot,href: '/more/account?view=other' };
    if (kind === 'tree') f.current.value = { ...snapshot,state: { ...state } };
    if (kind === 'api') f.rebind();
    if (kind === 'new') f.current.value = { ...snapshot,guards: [...snapshot.guards,f.guard('new',{ assistant: true,key: 'campus' })] };
    if (kind === 'removed') f.current.value = { ...snapshot,guards: snapshot.guards.filter(item => item.id !== 'assistant') };
    if (kind === 'dirty-to-dirty') f.assistant.draftSignature = 'question two';
    if (kind === 'busy') f.assistant.blocked = true;
    if (kind === 'gone') f.current.value = null;
    f.resolve(kind !== 'cancel');
    assert.equal(await pending,false,kind); assert.equal(f.sent,0,kind); assert.deepEqual(f.cleared,[],kind);
  }
});

test('unrelated retained draft changes during confirmation and POST do not invalidate Assistant approval', async () => {
  const f = fixture(), pending = f.start(), snapshot = f.current.value!;
  f.current.value = { ...snapshot,guards: [f.assistant,f.guard('events',{ blocked: true,draftSignature: 'changed during prompt' })] };
  f.resolve(true); assert.equal(await pending,true);
  const command = f.command(); command.acknowledge();
  f.current.value = { ...f.current.value!,guards: [f.assistant] };
  command.finish(true); assert.deepEqual(f.cleared,['assistant']); assert.equal(f.retired,1);
});

test('refusal, unknown outcome, failed refresh and late acknowledgement never clear or retain approval', () => {
  for (const kind of ['refused','unknown','refresh-failed','unacknowledged','retired']) {
    const f = fixture(), command = f.command();
    if (kind !== 'unacknowledged') command.acknowledge();
    if (kind === 'retired') command.retire();
    command.finish(kind === 'unacknowledged' || kind === 'retired');
    command.acknowledge(); command.finish(true);
    assert.deepEqual(f.cleared,[],kind); assert.equal(command.frozen,false,kind); assert.equal(f.retired,1,kind);
  }
});

test('accepted completion rechecks exact context and dirty-to-dirty signature before clearing', () => {
  for (const kind of ['scope','focus','href','tree','api','draft','new','busy','gone']) {
    const f = fixture(), command = f.command(); command.acknowledge(); const snapshot = f.current.value!;
    if (kind === 'scope') f.current.value = { ...snapshot,scope: 'other' };
    if (kind === 'focus') f.current.value = { ...snapshot,focusedKey: 'other' };
    if (kind === 'href') f.current.value = { ...snapshot,href: '/more/account?new=1' };
    if (kind === 'tree') f.current.value = { ...snapshot,state: { ...state } };
    if (kind === 'api') f.rebind();
    if (kind === 'draft') f.assistant.draftSignature = 'new text after acknowledgement';
    if (kind === 'new') f.current.value = { ...snapshot,guards: [...snapshot.guards,f.guard('new',{ assistant: true,key: 'campus' })] };
    if (kind === 'busy') f.assistant.blocked = true;
    if (kind === 'gone') f.current.value = null;
    command.finish(true); assert.deepEqual(f.cleared,[],kind); assert.equal(command.frozen,false,kind); assert.equal(f.retired,1,kind);
  }
});

test('accepted Pro revocation may remove its Assistant guard before finish without touching Events', () => {
  const f = fixture(), command = f.command(); command.acknowledge();
  f.current.value = { ...f.current.value!,guards: f.current.value!.guards.filter(item => item.id !== 'assistant') };
  command.finish(true); assert.deepEqual(f.cleared,[]); assert.equal(f.retired,1);
});

test('API changes at acknowledgement retire the attempt and a throwing cleanup cannot be replayed', () => {
  const stale = fixture(), staleCommand = stale.command(); stale.rebind(); staleCommand.acknowledge(); staleCommand.finish(true);
  assert.equal(staleCommand.frozen,false); assert.deepEqual(stale.cleared,[]); assert.equal(stale.retired,1);
  const failed = fixture(); let attempts = 0;
  failed.assistant.onLeave = () => { attempts++; throw new Error('local cleanup failed'); };
  const command = failed.command(); command.acknowledge(); command.finish(true); command.finish(true);
  assert.equal(attempts,1); assert.equal(command.frozen,false); assert.equal(failed.retired,1);
});

test('native tab catalogue changes protect every retained campus editor before either Pro toggle',()=>{
  const f=fixture(),snapshot={...f.current.value!,resetsCampusHost:true};
  for(const enabled of [true,false])assert.deepEqual(tabConfigurationGuards(snapshot,enabled).map(guard=>guard.id),['events','assistant']);
  const busy={...snapshot,guards:[f.guard('events',{blocked:true})]};
  assert.throws(()=>createTabConfigurationPermit(busy,true,()=>{}),'a native catalogue remount cannot lose an in-flight action');
});
