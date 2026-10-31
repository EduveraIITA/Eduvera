import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as backPolicy from '../src/lib/back-policy';
import * as overlay from '../src/lib/assistant-overlay';
import * as policy from '../src/lib/assistant-presentation-policy';
import { assistantLayout } from '../src/lib/assistant-layout';
import { canonicalNativeHref } from '../src/lib/navigation';
import { ASSISTANT_TAB_HREF } from '../src/lib/campus-tabs';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): { render(children: React.ReactNode): void; unmount(): void } };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis; } };
type Presentation = ReturnType<typeof import('../src/ui/assistant-presentation-context').useAssistantPresentationState>;
class ApiError extends Error { constructor(public status: number) { super('Private access could not be confirmed'); } }
function tree(index = 0): backPolicy.CampusNavigationState {
  return { key: 'root',index: 0,type: 'stack',routes: [{ key: 'campus',name: '(campus)',state: { key: 'tabs',type: 'tab',index,routes: [
    { key: 'work-tab',name: 'work',state: { key: 'work-stack',type: 'stack',index: 0,routes: [{ key: 'work-owner',name: 'index' }] } },
    { key: 'areas-tab',name: 'areas',state: { key: 'areas-stack',type: 'stack',index: 0,routes: [{ key: 'areas-owner',name: '[...path]',params: { path: ['events','manage'],date: '2026-10-29' } }] } },
  ] } }] };
}
async function harness(run: (state: { get(): Presentation; render(): Promise<void>; navigate(index: number): Promise<void>; preference(value: { enabled: boolean; preview: boolean } | undefined,error?: ApiError): Promise<void>; session(status: string,scope?: string): Promise<void>; rotate(width: number,height: number): Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{ window: dom.window,document: dom.window.document,IS_REACT_ACT_ENVIRONMENT: true });
  let actualTree = tree(), size = { width: 744,height: 1133 }, actualSession = { scopeKey: 'actor:campus:live',status: 'authenticated',ready: true,user: { id: 'actor' },memberships: [],schoolId: 'campus',environment: { mode: 'live' } }, preference: { data: unknown; error: Error | undefined } = { data: { enabled: true,preview: true },error: undefined }, transportEpoch = 1;
  const dependencies: Record<string,unknown> = {
    'react': React,'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { AppState: { currentState: 'active' },Platform: { OS: 'ios',isPad: true },useWindowDimensions: () => size },
    'expo-router': { useRootNavigationState: () => actualTree },
    '../auth/SessionProvider': { useSession: () => actualSession },
    '../lib/assistant-access': { assistantPerspective: () => 'principal',assistantEntryAvailable: () => true },
    '../lib/query': { useApi: () => preference },
    '../lib/api': { ApiError,captureApiContext: () => { const expected = transportEpoch; return { assertCurrent() { if (expected !== transportEpoch) throw new Error('Changed transport'); } }; } },
    '../lib/navigation': { canonicalNativeHref },'../lib/back-policy': backPolicy,'../lib/assistant-presentation-policy': policy,'../lib/assistant-overlay': overlay,'../lib/assistant-layout': { assistantLayout },'../lib/campus-tabs': { ASSISTANT_TAB_HREF },
  };
  const file = path.join(root,'src/ui/assistant-presentation-context.tsx'), compiled = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,esModuleInterop: true } }).outputText;
  const exports: { AssistantPresentationProvider?: React.ComponentType<React.PropsWithChildren>; useAssistantPresentationState?: () => Presentation } = {};
  runInNewContext(compiled,{ exports,Map,Set,JSON,require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected presentation dependency ${name}`); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  let current!: Presentation;
  function Probe() { current = exports.useAssistantPresentationState!(); return null; }
  const renderer = createRoot(dom.window.document.getElementById('root')!);
  const render = async () => { await act(async () => renderer.render(React.createElement(exports.AssistantPresentationProvider!,null,React.createElement(Probe)))); };
  try {
    await render();
    await run({ get: () => current,render,navigate: async index => { actualTree = tree(index); await render(); },preference: async (data,error) => { preference = { data,error }; await render(); },session: async (status,scope) => { if (scope && scope !== actualSession.scopeKey) transportEpoch++; actualSession = { ...actualSession,status,ready: status === 'authenticated',scopeKey: scope ?? actualSession.scopeKey }; await render(); },rotate: async (width,height) => { size = { width,height }; await render(); } });
  } finally { await act(async () => renderer.unmount()); Object.assign(globalThis,{ window: oldWindow,document: oldDocument,IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('actual tablet presentation retains chat across app navigation, while app movement permanently expires prepared callbacks', async () => harness(async h => {
  await act(async () => h.get().open('campus','actor:campus:live'));
  await act(async () => h.get().setExpanded('campus','actor:campus:live',true,h.get().entryToken));
  assert.equal(h.get().mode,'split'); const beforeNavigation = h.get().captureOperation();
  await h.navigate(1); assert.equal(h.get().active,true); assert.equal(h.get().expanded,true); assert.throws(beforeNavigation);
  const afterNavigation = h.get().captureOperation(), token = h.get().entryToken;
  await act(async () => h.get().setExpanded('campus','actor:campus:live',false,token));
  assert.equal(h.get().active,true); assert.equal(h.get().mode,'compact'); assert.equal(h.get().entryToken,token); afterNavigation();
  await act(async () => h.get().setExpanded('campus','actor:campus:live',true,token));
  await h.rotate(1366,1024); assert.equal(h.get().splitAxis,'horizontal'); assert.equal(h.get().entryToken,token); afterNavigation();
  await h.rotate(600,900); assert.equal(h.get().splitAxis,'vertical'); afterNavigation();
  await h.navigate(0); assert.throws(afterNavigation); assert.throws(beforeNavigation,'real Back never revives an old epoch'); assert.equal(h.get().active,true);
}));

test('a canonical pane collapsed over a new real operating source offers lossless Close', async () => harness(async h => {
  await act(async () => h.get().open('campus','actor:campus:live',ASSISTANT_TAB_HREF + '?thread=exact'));
  assert.equal(h.get().canonical,true); await h.navigate(1);
  await act(async () => h.get().setExpanded('campus','actor:campus:live',false,h.get().entryToken));
  assert.equal(h.get().canonical,false); assert.equal(h.get().active,true);
  await act(async () => h.get().close('campus','actor:campus:live',h.get().entryToken));
  assert.equal(h.get().active,false); assert.equal(h.get().mounted,true,'Close does not discard the retained conversation owner');
}));

test('same-scope transient verification preserves split and fresh lease eligibility resumes after retry', async () => harness(async h => {
  await act(async () => h.get().open('campus','actor:campus:live',ASSISTANT_TAB_HREF));
  const token = h.get().entryToken, lease = h.get().captureOperation();
  await h.session('error'); assert.equal(h.get().expanded,true); assert.equal(h.get().active,true); assert.throws(lease);
  await h.session('authenticated'); assert.equal(h.get().expanded,true); assert.equal(h.get().entryToken,token); h.get().captureOperation()();
  await h.preference({ enabled: true,preview: true },new ApiError(503)); assert.equal(h.get().expanded,true);
}));

test('validated Pro-off or definitive access loss removes the pane and cannot resurrect it on a later preference refresh', async () => {
  for (const failure of ['off','denied','scope']) await harness(async h => {
    await act(async () => h.get().open('campus','actor:campus:live',ASSISTANT_TAB_HREF));
    const lease = h.get().captureOperation();
    if (failure === 'off') await h.preference({ enabled: false,preview: true });
    else if (failure === 'denied') await h.preference({ enabled: true,preview: true },new ApiError(403));
    else await h.session('authenticated','actor:campus:simulation:new-world');
    assert.equal(h.get().active,false); assert.equal(h.get().expanded,false); assert.notEqual(h.get().mode,'split'); assert.throws(lease);
    await h.preference({ enabled: true,preview: true }); assert.equal(h.get().active,false,'an old split cannot silently return');
  });
});
