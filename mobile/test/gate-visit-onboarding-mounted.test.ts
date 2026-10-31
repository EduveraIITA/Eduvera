import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as policy from '../src/lib/gate-visit-onboarding';
const require = createRequire(import.meta.url), { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
const school = '10000000-0000-4000-8000-000000000001', visitId = '20000000-0000-4000-8000-000000000001', linkId = '30000000-0000-4000-8000-000000000001';
const visit = { id: visitId, revision: 4, party_size: 10, ends_at: '2099-10-30T12:00:00Z' }, href = `/areas/in-out/visits?visit=${visitId}`;
const noLink = { visit_id: visitId, visit_revision: 4, revision: 0, can_manage: true, can_issue: true, can_revoke: false, public_onboarding_supported: true, current: null };
const active = { ...noLink, revision: 1, can_revoke: true, current: { id: linkId, revision: 1, state: 'active' as const, ends_at: visit.ends_at, issued_at: '2026-10-30T10:00:00Z', registration_count: 3 } };
const secret = `https://public.example/visit-join#token=${'a'.repeat(43)}`;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function load(file: string, deps: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {}, filename = new URL(file, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { exports, URL, Date, JSON, setTimeout, clearTimeout, ...globals, require(name: string) { if (name in deps) return deps[name]; throw new Error(`Unexpected manager dependency ${name}`); } }, { filename: filename.pathname }); return exports;
}

async function harness(run: (h: any) => Promise<void>, options: { noLink?: boolean; simulation?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let focused = true, transportEpoch = 0, mounted = true, lateWrites = 0, readImpl: ((path: string, init?: RequestInit) => Promise<unknown>) | undefined, opts: any, guard: any, refreshed = 0;
  let now = Date.now(), timerId = 0; const timers = new Map<number, () => void>();
  class CurrentDate extends Date { static now() { return now; } }
  const featureReact = { ...React, useState(initial: any) { const [value,set] = React.useState(initial); return [value, (next: any) => { if (!mounted) lateWrites++; set(next); }]; } };
  const session = { status: 'authenticated', schoolId: school, scopeKey: 'actor-a:campus:live', user: { id: 'actor-a' }, environment: { mode: options.simulation ? 'simulation' : 'live', namespace_id: options.simulation ? 'world-a' : null, unavailable: false } };
  const listeners = new Set<(value: string) => void>(), AppState = { currentState: 'active', addEventListener: (_name: string, cb: (value: string) => void) => { listeners.add(cb); return { remove: () => listeners.delete(cb) }; } };
  const native = {
    AppState, StyleSheet: { create: (value: unknown) => value },
    View: ({children}: any) => React.createElement('div', null, children), ScrollView: ({children}: any) => React.createElement('div', null, children),
    Text: ({children, accessibilityRole}: any) => React.createElement('span', { role: accessibilityRole === 'header' ? 'heading' : undefined }, children),
    Pressable: ({children,onPress,disabled,accessibilityLabel}: any) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
  };
  let state: any = options.noLink ? noLink : active;
  if (options.simulation) state = { ...state, public_onboarding_supported: false };
  const calls: Array<{path:string;init?:RequestInit}> = [], commands: any[] = [], outbound: string[] = [], prompts: any[] = [];
  const writer: any = { locked: false, busy: false, ready: true, blocked: false, action: null, error: '', resumeHref: null, run: async (input: any) => { commands.push(input); return true; }, recover: async () => { outbound.push('recover'); } };
  const api = { getApiOrigin: () => 'https://campus.example', captureApiContext: () => { const epoch = transportEpoch; return { assertCurrent() { if (epoch !== transportEpoch) throw new Error('Transport changed'); } }; }, apiFetch: async (path: string, init?: RequestInit) => { calls.push({path,init}); if (readImpl) return readImpl(path,init); return init?.method === 'POST' ? { visit_id: visitId, visit_revision: state.visit_revision, link_id: state.current.id, revision: state.revision, ends_at: state.current.ends_at, join_url: secret } : state; } };
  const operation = load('../src/lib/use-operation-context.ts', { react: React, 'react-native': native, 'expo-router': { useIsFocused: () => focused }, '../auth/SessionProvider': { useSession: () => session }, './api': api });
  const button = ({title,onPress,disabled,busy}: any) => React.createElement('button', { onClick: onPress, disabled: disabled || busy }, title);
  const deps: Record<string, unknown> = {
    react: featureReact, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native, 'expo-router': { useIsFocused: () => focused }, 'react-native-safe-area-context': { SafeAreaProvider: native.View, SafeAreaView: native.View },
    '../auth/SessionProvider': { useSession: () => session }, '../lib/api': api, '../lib/gate-visit-onboarding': policy,
    '../lib/use-operation-context': operation, '../lib/native-pending-action': { useNativePendingAction: (value: any) => { opts = value; return writer; } },
    '../lib/visit-onboarding-share': { shareVisitOnboardingLink: async (_value: string, assertCurrent: () => void) => { assertCurrent(); outbound.push('share'); return 'unavailable'; }, emailVisitOnboardingLink: async (_value: string, assertCurrent: () => void) => { assertCurrent(); outbound.push('email'); }, copyVisitOnboardingLink: async (_value: string, assertCurrent: () => void) => { assertCurrent(); outbound.push('copy'); } },
    '../ui/Alert': { Alert: { alert: (title: string, message: string, actions: any[]) => prompts.push({title,message,actions}) } },
    '../ui/BackNavigation': { useScreenExitGuard: (value: any) => { guard = value; } }, '../ui/DomainControls': { ControlButton: button },
    '../ui/components': { Notice: ({message}: any) => React.createElement('p', null, message) }, '../ui/Motion': { MotionModal: ({visible,children}: any) => visible ? React.createElement('section', null, children) : null },
    '../ui/theme': { useTheme: () => ({ colors: { canvas:'#fff',ink:'#222',muted:'#666',row:'#eee',link:'#125' } }) }, './GateVisitDetails': { VisitPrimaryAction: (p: any) => button({ title: 'Invite visitors', ...p }) },
  };
  for (const name of ['Copy','EnvelopeSimple','Share']) deps[`phosphor-react-native/src/icons/${name}`] = { [name+'Icon']: () => null };
  const Component = load('../src/features/GateVisitOnboarding.tsx', deps, { Date: CurrentDate, setTimeout: (cb: () => void) => { timers.set(++timerId,cb); return timerId; }, clearTimeout: (id: number) => timers.delete(id) }).GateVisitOnboarding;
  const renderer = createRoot(dom.window.document.getElementById('root')), props: any = { href, schoolId: school, visit, state, refresh: async () => { refreshed++; }, disabled: false, onNavigate() {}, timezone:'Asia/Kolkata' };
  const render = async () => { await act(async () => renderer.render(React.createElement(Component,props))); };
  const h = {
    doc: dom.window.document, calls, commands, outbound, prompts, writer, session, render,
    guard: () => guard, options: () => opts, lateWrites: () => lateWrites, refreshed: () => refreshed,
    now: () => now, advance: async (milliseconds: number) => { now += milliseconds; await act(async () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(cb => cb()); }); },
    setRead: (value: typeof readImpl) => { readImpl = value; },
    state: async (value: any) => { state = value; props.state = value; await render(); },
    focus: async (value: boolean) => { focused = value; await render(); },
    scope: async () => { transportEpoch++; session.scopeKey += ':changed'; await render(); },
    foreground: async (value: string) => { AppState.currentState = value; await act(async () => listeners.forEach(cb => cb(value))); },
    button: (label: string) => [...dom.window.document.querySelectorAll('button')].find((value: any) => (value.getAttribute('aria-label') ?? value.textContent) === label) as HTMLButtonElement | undefined,
    click: async (label: string) => { const element = h.button(label); assert.ok(element, `Missing ${label}`); assert.equal(element.disabled, false, label); await act(async () => element.click()); },
    confirm: async (index: number, action: number) => { await act(async () => prompts[index].actions[action].onPress?.()); },
    unmount: async () => { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } },
  };
  try { await render(); await run(h); } finally { await h.unmount(); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('manager sheet separates planned people and actual registrations, and requires explicit reveal before sharing', async () => harness(async h => {
  assert.equal(h.doc.querySelector('section'), null); await h.click('Invite visitors');
  assert.match(h.doc.body.textContent, /10 people expected/); assert.match(h.doc.body.textContent, /3 registered with the current link/); assert.equal(h.button('Share visit registration link'), undefined);
  await h.click('Reveal current link'); assert.equal(h.calls.length, 2); assert.equal(h.calls[0].init, undefined); assert.equal(h.calls[1].init.method, 'POST'); assert.deepEqual(JSON.parse(h.calls[1].init.body), { expected_revision:1,expected_visit_revision:4 });
  assert.ok(!h.doc.body.textContent.includes(secret)); await h.click('Copy visit registration link'); assert.deepEqual(h.outbound,['copy']); assert.match(h.doc.body.textContent,/Link copied/);
  await h.click('Done'); await h.click('Invite visitors'); assert.equal(h.button('Copy visit registration link'),undefined); assert.equal(h.calls.length,2);
}));

test('a revealed credential clears on background and must be explicitly revealed after returning', async () => harness(async h => {
  await h.click('Invite visitors'); await h.click('Reveal current link'); assert.ok(h.button('Share visit registration link'));
  await h.foreground('background'); assert.equal(h.doc.querySelector('section'),null); await h.foreground('active'); assert.equal(h.button('Share visit registration link'),undefined); assert.ok(h.button('Reveal current link')); assert.equal(h.calls.length,2);
}));

test('link expiry clears the volatile copy and share controls without issuing or revealing another link', async () => harness(async h => {
  await h.state({...active,current:{...active.current,ends_at:new Date(h.now()+60_000).toISOString()}}); await h.click('Invite visitors'); await h.click('Reveal current link'); assert.ok(h.button('Share visit registration link'));
  await h.advance(60_001); assert.equal(h.button('Share visit registration link'),undefined); assert.match(h.doc.body.textContent,/link expiry has been reached/); assert.equal(h.calls.length,2); assert.deepEqual(h.outbound,[]);
}));

test('late reveal cannot revive after blur, source revision round-trip, world change or unmount', async () => {
  for (const ending of ['blur-return','stream-round-trip','world','unmount']) {
    const pending = deferred<unknown>(); await harness(async h => {
      h.setRead(async (_path: string, init?: RequestInit) => init?.method==='POST' ? pending.promise : active);
      await h.click('Invite visitors'); await h.click('Reveal current link'); assert.equal(h.guard().blocked,true);
      if (ending==='blur-return') { await h.focus(false); await h.focus(true); }
      else if (ending==='stream-round-trip') { await h.state({...active,revision:2,current:{...active.current,revision:2,id:'40000000-0000-4000-8000-000000000001'}}); await h.state(active); }
      else if (ending==='world') await h.scope(); else await h.unmount();
      await act(async () => pending.resolve({visit_id:visitId,visit_revision:4,link_id:linkId,revision:1,ends_at:visit.ends_at,join_url:secret}));
      assert.equal(h.button('Share visit registration link'),undefined); assert.equal(h.lateWrites(),0); assert.deepEqual(h.outbound,[]); assert.ok(!h.doc.body.textContent.includes('could not be revealed'));
    });
  }
});

test('manager authority loss and stream changes hide sharing synchronously; registration count changes alone retain the same link', async () => harness(async h => {
  await h.click('Invite visitors'); await h.click('Reveal current link');
  await h.state({...active,current:{...active.current,registration_count:4}}); assert.ok(h.button('Copy visit registration link'));
  await h.state({...active,can_manage:false,can_issue:false,can_revoke:false}); assert.equal(h.doc.querySelector('section'),null); assert.equal(h.button('Invite visitors'),undefined);
  await h.state(active); assert.equal(h.button('Copy visit registration link'),undefined);
}));

test('a revealed link is not reused when the selected world changes to an identically labelled visit', async () => harness(async h => {
  await h.click('Invite visitors'); await h.click('Reveal current link'); await h.scope(); assert.equal(h.button('Copy visit registration link'),undefined); assert.equal(h.outbound.length,0);
}));

test('explicit creation confirmation binds the current source and displayed visit expiry; decline performs no command', async () => harness(async h => {
  await h.click('Invite visitors'); await h.click('Create visitor link'); assert.match(h.prompts[0].message,/Asia\/Kolkata/); await h.confirm(0,0); assert.equal(h.commands.length,0);
  await h.click('Create visitor link'); await h.confirm(1,1); assert.equal(h.commands.length,1); assert.deepEqual(h.commands[0].body,{action:'issue',expected_revision:0,expected_visit_revision:4,ends_at:visit.ends_at}); assert.equal(h.commands[0].serverKey,'command_id');
}, {noLink:true}));

test('stale management confirmations cannot issue after a source round-trip or world transition, or release another operation', async () => {
  for (const ending of ['stream','world','unmount']) await harness(async h => {
    await h.click('Invite visitors'); await h.click('Create visitor link');
    if (ending==='stream') { await h.state({...noLink,visit_revision:5}); await h.state(noLink); } else if (ending==='world') await h.scope(); else await h.unmount();
    await h.confirm(0,1); assert.equal(h.commands.length,0); assert.equal(h.lateWrites(),0);
  },{noLink:true});
});

test('an older confirmation cannot release the busy lease held by a later confirmed review', async () => harness(async h => {
  await h.click('Invite visitors'); await h.click('Create visitor link'); await h.click('Create visitor link');
  const pending = deferred<unknown>(); h.setRead(async () => pending.promise); await h.confirm(1,1); assert.equal(h.guard().blocked,true);
  await h.confirm(0,1); assert.equal(h.guard().blocked,true); assert.equal(h.commands.length,0);
  await act(async () => pending.resolve(noLink)); assert.equal(h.commands.length,1); assert.equal(h.guard().blocked,false);
},{noLink:true}));

test('Simulation explains unsupported public effects without issuing, revealing or using a Live link', async () => harness(async h => {
  await h.click('Invite visitors'); assert.match(h.doc.body.textContent,/unavailable in Simulation/); assert.equal(h.button('Reveal current link'),undefined); assert.equal(h.button('Replace link'),undefined); assert.equal(h.calls.length,0); assert.equal(h.commands.length,0); assert.deepEqual(h.outbound,[]);
},{simulation:true}));

test('a Simulation session cannot activate public sharing from an incorrect supported metadata flag', async () => harness(async h => {
  await h.state(active); await h.click('Invite visitors'); assert.match(h.doc.body.textContent,/unavailable in Simulation/); assert.equal(h.button('Reveal current link'),undefined); assert.equal(h.calls.length,0);
},{simulation:true}));

test('only this exact retained source offers recovery; foreign Gate work cannot be replayed through this sheet', async () => harness(async h => {
  h.writer.action={source:{kind:'gate_visitor_creation',sourceId:school},ownerHref:'/areas/in-out/operate',phase:'unknown'};h.writer.locked=true;h.writer.resumeHref='/areas/in-out/operate';await h.render(); await h.click('Invite visitors');
  assert.ok(h.button('Open retained action'));assert.equal(h.button('Recover exact action'),undefined);
  h.writer.action={source:{kind:'gate_visit_onboarding',sourceId:visitId},ownerHref:href,phase:'accepted'};h.writer.resumeHref=null;await h.render();await h.click('Confirm saved action');assert.deepEqual(h.outbound,['recover']);
}));

test('an exact accepted command can finish its metadata refresh after the current link stream advances', async () => harness(async h => {
  const input = policy.gateVisitOnboardingInput(school,noLink,'issue',visit.ends_at), scope = {actorId:'actor-a',schoolId:school,mode:'live',namespaceId:null,origin:'https://campus.example'};
  const action = {version:1,domain:'gate',scope,clientId:linkId,ownerHref:href,endpoint:input.endpoint,refreshPath:`${input.endpoint}commands/${linkId}/`,method:'POST',payload:{kind:'json',body:JSON.stringify({...input.body,command_id:linkId})},source:input.source,phase:'accepted',replayPolicy:'same_request',createdAt:'2026-10-30T10:00:00Z'};
  const lease = h.options().captureOperation(); await h.state({...active,revision:2,current:{...active.current,revision:2,id:'40000000-0000-4000-8000-000000000001'}});
  await act(async () => h.options().accepted({state:'accepted',command_id:linkId,visit_id:visitId,source_id:linkId,revision:1,action:'issue'},lease,action)); assert.equal(h.refreshed(),1);
  await h.scope(); await assert.rejects(h.options().accepted({state:'accepted',command_id:linkId,visit_id:visitId,source_id:linkId,revision:1,action:'issue'},lease,action)); assert.equal(h.refreshed(),1);
}));
