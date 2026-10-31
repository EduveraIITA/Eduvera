import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act, createContext, useContext, useState } from 'react';
import ts from 'typescript';
import * as backPolicy from '../src/lib/back-policy';
import * as tabs from '../src/lib/campus-tabs';
import * as configuration from '../src/lib/tab-configuration';
import * as traversal from '../src/lib/back-browser-traversal';
import * as presentation from '../src/lib/back-presentation';
import * as assistantPolicy from '../src/lib/assistant-presentation-policy';
import * as overlay from '../src/lib/assistant-overlay';
import { canonicalNativeHref } from '../src/lib/navigation';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoot } = require('react-dom/client') as { createRoot(node: Element): { render(node: React.ReactNode): void; unmount(): void } };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };
type Exports = typeof import('../src/ui/BackNavigation');
type Button = { text: string; onPress?: () => void };
type Removal = { data: { action: { type: string } }; repeat(): void };
function fixture(): backPolicy.CampusNavigationState {
  const state = (key: string, type: string, index: number, routes: backPolicy.CampusNavigationRoute[]): backPolicy.CampusNavigationState => ({ key,type,index,routes,stale: false,routeKeySeq: 10,routeNames: [...new Set(routes.map(route => route.name))] });
  return state('root','stack',0,[{ key: 'campus',name: '(campus)',state: state('tabs','tab',0,[{ key: 'areas-tab',name: 'areas',state: state('areas-stack','stack',1,[{ key: 'areas-index',name: 'index' },{ key: 'visitor-form',name: '[...path]',params: { path: ['in-out','visits','new'] } }]) },{ key: 'more-tab',name: 'more',state: state('more-stack','stack',0,[{ key: 'more-index',name: 'index' }]) }]) }]);
}
type Harness = { back(): void; reset(): void; remove(): void; render(): Promise<void>; setBlocked(v: boolean): void; setPreserves(v: boolean): void; recheck(): void; text(): string; prompts: Button[][]; discarded(): number; disabled(): number; dispatches: { type: string; payload?: backPolicy.CampusNavigationState }[]; prevented(): boolean };
async function harness(run: (h: Harness) => Promise<void>, localCallback = true) {
  const dom = new JSDOM('<div id="root"></div>'), old = { window: globalThis.window,document: globalThis.document,IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis,{ window: dom.window,document: dom.window.document,IS_REACT_ACT_ENVIRONMENT: true });
  const tree = fixture(), routeContext = createContext({ key: 'visitor-form' }), assistantOwner = createContext(false), session = { scopeKey: 'actor:campus:live',ready: true,status: 'authenticated',user: { id: 'actor' } };
  let discarded = 0, disabled = 0, prevented = false, remove!: (event: Removal) => void;
  const prompts: Button[][] = [], dispatches: { type: string; payload?: backPolicy.CampusNavigationState }[] = [], navigation = { dispatch(action: { type: string; payload?: backPolicy.CampusNavigationState }) { dispatches.push(action); },setOptions() {} };
  const dependencies: Record<string,unknown> = {
    react: React,'react/jsx-runtime': require('react/jsx-runtime'),'react-native': { Platform: { OS: 'ios' },Keyboard: { dismiss() {} },BackHandler: { addEventListener() { return { remove() {} }; } } },
    'expo-router': { useIsFocused: () => true,useNavigation: () => navigation,useRootNavigation: () => navigation,useRootNavigationState: () => tree,useRoute: () => useContext(routeContext),useRouter: () => ({ push() {},replace() {},setParams() {},back() {} }),useUnstableGlobalHref: () => '/areas/in-out/visits/new',usePreventRemove: (v: boolean, handler: (event: Removal) => void) => { prevented = v; remove = handler; return () => { disabled++; }; } },
    '../auth/SessionProvider': { useSession: () => session },'../lib/api': { captureApiContext: () => ({ assertCurrent() {} }) },'../lib/campus-tabs': tabs,'../lib/tab-configuration': configuration,'../lib/navigation': { canonicalNativeHref },'../lib/back-policy': backPolicy,'../lib/assistant-presentation-policy': assistantPolicy,'../lib/assistant-overlay': overlay,
    './assistant-presentation-context': { useAssistantPresentationState: () => ({ mode: 'hidden',expanded: false,active: false,setExpanded() {},close() {},open() {} }) },'./assistant-overlay-context': { AssistantOverlayOwnerContext: assistantOwner },'./Alert': { Alert: { alert(_title: string,_message: string,buttons: Button[]) { prompts.push(buttons); } } },'../lib/back-browser-traversal': traversal,'../lib/back-presentation': presentation,
  };
  const file = path.join(root,'src/ui/BackNavigation.tsx'), compiled = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,esModuleInterop: true } }).outputText, exports = {} as Exports;
  runInNewContext(compiled,{ exports,Map,Set,URL,JSON,setTimeout,clearTimeout,require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  let back!: ReturnType<Exports['useHeaderBack']>, actions!: ReturnType<Exports['useCampusNavigation']>, changeBlocked!: (v: boolean) => void, changePreserves!: (v: boolean) => void;
  function Form() {
    const [draft,setDraft] = useState('Retained visitor draft'), [choosing,setChoosing] = useState(true), [blocked,setBlocked] = useState(false), [preserves,setPreserves] = useState(true); changeBlocked = setBlocked; changePreserves = setPreserves;
    exports.useScreenExitGuard({ dirty: !!draft,blocked,draftSignature: draft,onLeave() { discarded++; setDraft(''); } }); exports.usePageNavigationTitle('Arrange a visit'); back = exports.useHeaderBack(); actions = exports.useCampusNavigation();
    const Local = exports.ScreenBack as React.ComponentType<Record<string,unknown>>;
    return React.createElement(React.Fragment,null,React.createElement(exports.ScreenBack,{ fallbackHref: '/areas/in-out/visits',title: 'Visits' }),choosing ? React.createElement(Local,{ title: 'Close chooser',priority: 1,preservesDraft: preserves ? true : undefined,...(localCallback ? { onPress: () => setChoosing(false) } : {}) }) : null,React.createElement('div',null,draft),React.createElement('div',null,choosing ? 'Chooser open' : 'Chooser closed'));
  }
  const renderer = createRoot(dom.window.document.getElementById('root')!);
  const render = async () => { await act(async () => renderer.render(React.createElement(exports.BackNavigationProvider,null,React.createElement(routeContext.Provider,{ value: { key: 'visitor-form' } },React.createElement(Form))))); };
  try { await render(); await run({ back: () => back.onPress(),reset: () => actions.reselectTab('/areas'),remove: () => remove({ data: { action: { type: 'POP' } },repeat() { dispatches.push({ type: 'SDK_REPEAT' }); } }),render,setBlocked: value => changeBlocked(value),setPreserves: value => changePreserves(value),recheck: () => { session.ready = false; session.status = 'loading'; },text: () => dom.window.document.body.textContent ?? '',prompts,discarded: () => discarded,disabled: () => disabled,dispatches,prevented: () => prevented }); }
  finally { await act(async () => renderer.unmount()); Object.assign(globalThis,old); dom.window.close(); }
}

test('reviewed local Back closes only the chooser and keeps its dirty draft and SDK removal guard armed', async () => harness(async h => {
  assert.equal(h.prevented(),true); await act(async () => h.back()); assert.match(h.text(),/Chooser closed/); assert.match(h.text(),/Retained visitor draft/); assert.equal(h.prompts.length,0); assert.equal(h.discarded(),0); assert.equal(h.disabled(),0); assert.equal(h.prevented(),true); assert.equal(h.dispatches.length,0);
}));
test('tab reset still confirms the actual removed dirty parent while its preserving chooser is open', async () => harness(async h => {
  await act(async () => h.reset()); assert.equal(h.prompts.length,1); assert.equal(h.dispatches.length,0); assert.equal(h.discarded(),0); await act(async () => h.prompts[0]!.find(button => button.text === 'Keep editing')!.onPress!()); assert.match(h.text(),/Chooser open/); assert.match(h.text(),/Retained visitor draft/);
  await act(async () => h.reset()); await act(async () => h.prompts[1]!.find(button => button.text === 'Discard and return')!.onPress!()); assert.equal(h.discarded(),1); assert.equal(h.dispatches.at(-1)?.type,'RESET'); assert.equal(backPolicy.focusedCampusRoute(h.dispatches.at(-1)!.payload)?.name,'index'); assert.equal(backPolicy.campusHrefForRoute(h.dispatches.at(-1)!.payload!,backPolicy.focusedCampusRoute(h.dispatches.at(-1)!.payload)!.key),'/areas');
}));
test('SDK route removal and an unflagged local close retain ordinary dirty confirmation', async () => harness(async h => {
  await act(async () => h.remove()); assert.equal(h.prompts.length,1); assert.equal(h.discarded(),0); assert.equal(h.dispatches.length,0); await act(async () => h.prompts[0]!.find(button => button.text === 'Keep editing')!.onPress!()); await act(async () => h.setPreserves(false)); await act(async () => h.back()); assert.equal(h.prompts.length,2,'registration observes the changed flag'); assert.match(h.text(),/Chooser open/); assert.equal(h.discarded(),0);
}));
test('local preservation never bypasses busy, session verification or another discard prompt', async () => harness(async h => {
  await act(async () => h.setBlocked(true)); await act(async () => h.back()); await act(async () => h.reset()); assert.match(h.text(),/Chooser open/); assert.equal(h.prompts.length,0); await act(async () => h.setBlocked(false)); await act(async () => h.remove()); assert.equal(h.prompts.length,1); await act(async () => h.back()); assert.match(h.text(),/Chooser open/); assert.equal(h.discarded(),0); await act(async () => h.prompts[0]!.find(button => button.text === 'Keep editing')!.onPress!()); h.recheck(); await h.render(); await act(async () => h.back()); assert.match(h.text(),/Chooser open/); assert.equal(h.discarded(),0); assert.equal(h.disabled(),0);
}));
test('a preservation flag without a local callback cannot exempt route Back', async () => harness(async h => {
  await act(async () => h.back()); assert.equal(h.prompts.length,1); assert.equal(h.discarded(),0); assert.equal(h.dispatches.length,0);
},false));
