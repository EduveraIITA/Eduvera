import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act, createContext, useContext } from 'react';
import ts from 'typescript';
import * as backPolicy from '../src/lib/back-policy';
import * as tabs from '../src/lib/campus-tabs';
import * as configuration from '../src/lib/tab-configuration';
import * as browserTraversal from '../src/lib/back-browser-traversal';
import * as browserPresentation from '../src/lib/back-presentation';
import * as presentationPolicy from '../src/lib/assistant-presentation-policy';
import * as overlay from '../src/lib/assistant-overlay';
import { canonicalNativeHref } from '../src/lib/navigation';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): { render(children: React.ReactNode): void; unmount(): void } };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis; } };
type Exports = typeof import('../src/ui/BackNavigation');
function fixture(tabIndex: number,detail: boolean): backPolicy.CampusNavigationState {
  const state = (key: string,type: string,index: number,routes: backPolicy.CampusNavigationRoute[]): backPolicy.CampusNavigationState => ({ key,type,index,routes,stale: false,routeKeySeq: 10,routeNames: [...new Set(routes.map(route => route.name))] });
  return state('root','stack',0,[{ key: 'campus',name: '(campus)',state: state('tabs','tab',tabIndex,[
    { key: 'areas-tab',name: 'areas',state: state('areas-stack','stack',detail ? 1 : 0,[{ key: 'areas-index',name: 'index' },...(detail ? [{ key: 'events-owner',name: '[...path]',params: { path: ['events','manage'],search: 'retained-filter' } }] : [])]) },
    { key: 'more-tab',name: 'more',state: state('more-stack','stack',tabIndex === 1 ? 1 : 0,[{ key: 'more-index',name: 'index' },...(tabIndex === 1 ? [{ key: 'account-owner',name: '[...path]',params: { path: ['account'] } }] : [])]) },
  ]) }]);
}

test('actual shared Back and Assistant source links preserve operating chronology while the split guard stays retained', async () => {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{ window: dom.window,document: dom.window.document,IS_REACT_ACT_ENVIRONMENT: true });
  let tree = fixture(0,false), focused = backPolicy.focusedCampusRoute(tree)!;
  let collapsed = 0, closed = 0, backs = 0, prompts = 0, discarded = 0;
  const pushed: string[] = [], dispatched: { type: string; payload?: backPolicy.CampusNavigationState }[] = [];
  const scopeKey = 'actor:campus:live', routeContext = createContext({ key: focused.key }), owner = createContext(false);
  const session = { scopeKey,ready: true,status: 'authenticated',user: { id: 'actor' } };
  const navigation = { dispatch(action: { type: string; payload?: backPolicy.CampusNavigationState }) { dispatched.push(action); },setOptions() {} };
  const router = { push(href: string) { pushed.push(href); },replace(href: string) { pushed.push('replace:' + href); },setParams() {},back() { backs++; } };
  const dependencies: Record<string,unknown> = {
    'react': React,'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Platform: { OS: 'ios' },Keyboard: { dismiss() {} },BackHandler: { addEventListener() { return { remove() {} }; } } },
    'expo-router': { useIsFocused: () => true,useNavigation: () => navigation,usePreventRemove: () => () => {},useRootNavigation: () => navigation,useRootNavigationState: () => tree,useRoute: () => useContext(routeContext),useRouter: () => router,useUnstableGlobalHref: () => backPolicy.campusHrefForRoute(tree,focused.key) },
    '../auth/SessionProvider': { useSession: () => session },'../lib/api': { captureApiContext: () => ({ assertCurrent() {} }) },
    '../lib/campus-tabs': tabs,'../lib/tab-configuration': configuration,'../lib/navigation': { canonicalNativeHref },'../lib/back-policy': backPolicy,'../lib/assistant-presentation-policy': presentationPolicy,'../lib/assistant-overlay': overlay,
    './assistant-presentation-context': { useAssistantPresentationState: () => ({ mode: 'split',expanded: true,active: true,entryToken: 'opening:1',setExpanded() { collapsed++; },close() { closed++; },open() {} }) },
    './assistant-overlay-context': { AssistantOverlayOwnerContext: owner },'./Alert': { Alert: { alert() { prompts++; } } },'../lib/back-browser-traversal': browserTraversal,'../lib/back-presentation': browserPresentation,
  };
  const file = path.join(root,'src/ui/BackNavigation.tsx'), compiled = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,esModuleInterop: true } }).outputText;
  const exports = {} as Exports;
  runInNewContext(compiled,{ exports,Map,Set,URL,JSON,setTimeout,clearTimeout,require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected navigation dependency ${name}`); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  let actions!: ReturnType<Exports['useCampusNavigation']>, back!: ReturnType<Exports['useHeaderBack']>;
  function Probe() { actions = exports.useCampusNavigation(); back = exports.useHeaderBack(); exports.usePageNavigationTitle(focused.key === 'events-owner' ? 'Manage events' : focused.key === 'account-owner' ? 'Account' : 'Areas'); return null; }
  function AssistantGuard() { exports.useScreenExitGuard({ dirty: true,draftSignature: 'retained-unsent-question',onLeave() { discarded++; } }); return null; }
  const renderer = createRoot(dom.window.document.getElementById('root')!);
  const render = async () => { focused = backPolicy.focusedCampusRoute(tree)!; await act(async () => renderer.render(React.createElement(exports.BackNavigationProvider,null,React.createElement(routeContext.Provider,{ value: { key: focused.key } },React.createElement(Probe)),React.createElement(routeContext.Provider,{ value: { key: 'campus' } },React.createElement(owner.Provider,{ value: true },React.createElement(AssistantGuard)))))); };
  try {
    await render(); tree = fixture(0,true); await render();
    assert.equal(back.label,'Areas'); assert.equal(collapsed,0); assert.equal(prompts,0); assert.equal(discarded,0);
    await act(async () => actions.onAssistantNavigate('/areas/events/manage?search=retained-filter'));
    assert.equal(closed,0); assert.equal(pushed.length,0,'same app source does not close the side pane or add history');
    await act(async () => actions.onAssistantNavigate('/more/account'));
    assert.deepEqual(pushed,['/more/account']); assert.equal(prompts,0); assert.equal(discarded,0,'retained Assistant draft never participates in ordinary operating navigation');
    tree = fixture(1,true); await render(); assert.equal(back.label,'Manage events','source link retains real app destination instead of inventing Assistant Back');
    await act(async () => back.onPress());
    assert.equal(collapsed,0); assert.equal(dispatched.at(-1)?.type,'RESET');
    assert.equal(backPolicy.focusedCampusRoute(dispatched.at(-1)!.payload)?.key,'events-owner');
    assert.equal(discarded,0);
  } finally { await act(async () => renderer.unmount()); Object.assign(globalThis,{ window: oldWindow,document: oldDocument,IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
});
