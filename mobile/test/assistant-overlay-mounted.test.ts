import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act, createContext, useContext, useEffect, useState } from 'react';
import ts from 'typescript';
import { assistantLayout } from '../src/lib/assistant-layout';
import type { AssistantLayout } from '../src/lib/assistant-layout';
const require = createRequire(import.meta.url);
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): { render(children: React.ReactNode): void; unmount(): void } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Mobile-owned DOM test runtime; no runtime dependency enters the app bundle.
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis; } };

test('the actual global host retains one body, draft and journal across full/compact/hidden/reopen', async () => {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{ window: dom.window,document: dom.window.document,IS_REACT_ACT_ENVIRONMENT: true });
  const base = { mode: 'compact' as 'compact' | 'fullscreen' | 'split',mounted: true,active: true,expanded: false,entryToken: 'actual-key:1',href: '/areas/assistant/conversation',setFrame() {} }, presentation = createContext(base);
  const owner = createContext(false), activity = createContext<boolean | undefined>(undefined);
  let mounts = 0, unmounts = 0, setQuestion!: (value: string) => void;
  function Body() { const [question,set] = useState(''); setQuestion = set; useEffect(() => { mounts++; return () => { unmounts++; }; },[]); return React.createElement('input',{ value: question,onChange() {},'data-owner': 'one-conversation' }); }
  const View = ({ children,style,...props }: { children?: React.ReactNode; style?: React.CSSProperties; [key: string]: unknown }) => React.createElement('div',{ style: { ...(Array.isArray(style) ? Object.assign({},...style) : style),flexDirection: undefined },'data-modal': props.accessibilityViewIsModal },children);
  const dependencies: Record<string,unknown> = {
    'react': React,'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View,Platform: { OS: 'web' },BackHandler: { addEventListener() { return { remove() {} }; } } },
    'react-native-safe-area-context': { SafeAreaView: View },
    '../features/AssistantScreen': { AssistantScreen: Body },
    './AssistantPresentation': { useAssistantPresentation: () => ({ collapse() {},close() {},canClose: true,onNavigate() {} }) },
    './assistant-presentation-context': { useAssistantPresentationState: () => useContext(presentation) },
    './assistant-overlay-context': { AssistantOverlayOwnerContext: owner,AssistantOverlayActivityContext: activity },
    './BackNavigation': { useCampusNavigation: () => ({ onAssistantNavigate() {} }) },
    './theme': { useTheme: () => ({ colors: { canvas: '#fff' } }) },'./ExecutionBanner': { ExecutionBanner: () => React.createElement('span',null,'Current world') },
  };
  const file = path.join(root,'src/ui/AssistantOverlayHost.tsx'), compiled = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,esModuleInterop: true } }).outputText;
  const exports: { AssistantOverlayHost?: React.ComponentType<{ layout?: AssistantLayout }> } = {};
  runInNewContext(compiled,{ exports,require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected host dependency ${name}`); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  const Host = exports.AssistantOverlayHost!; assert.ok(Host);
  const renderer = createRoot(dom.window.document.getElementById('root')!);
  const render = async (next: typeof base, layout?: AssistantLayout) => { await act(async () => renderer.render(React.createElement(presentation.Provider,{ value: next },React.createElement(Host,{ layout })))); };
  try {
    await render(base); await act(async () => setQuestion('Unsent question')); const input = dom.window.document.querySelector('input'); assert.ok(input);
    for (const next of [{ ...base,expanded: true,mode: 'fullscreen' as const },{ ...base,expanded: true,mode: 'split' as const },base,{ ...base,active: false },{ ...base,entryToken: 'actual-key:3' }]) {
      await render(next); assert.equal(dom.window.document.querySelector('input'),input); assert.equal(input.value,'Unsent question'); assert.equal(mounts,1); assert.equal(unmounts,0);
    }
    for (const dimensions of [{ width: 744,height: 1133 },{ width: 1366,height: 1024 },{ width: 600,height: 900 }]) {
      const layout = assistantLayout({ ...dimensions,isPad: true,expanded: true });
      await render({ ...base,expanded: true,mode: 'split' },layout);
      assert.equal(dom.window.document.querySelector('input'),input); assert.equal(input.value,'Unsent question');
      assert.equal(dom.window.document.querySelector('[data-modal]')?.getAttribute('data-modal'),'false','both operating app and chat remain available to VoiceOver');
      assert.equal(mounts,1); assert.equal(unmounts,0);
    }
    await render({ ...base,mounted: false,active: false }); assert.equal(unmounts,1,'only the owning scope teardown removes the global body');
  } finally { await act(async () => renderer.unmount()); Object.assign(globalThis,{ window: oldWindow,document: oldDocument,IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
});

test('current production source has exactly one Assistant body import and canonical routes activate the host', () => {
  const source = readFileSync(path.join(root,'app/(campus)/(assistant)/areas/assistant/conversation.tsx'),'utf8');
  const ast = ts.createSourceFile('conversation.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const imports: string[] = [];
  function visit(node: ts.Node) { if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text); ts.forEachChild(node,visit); } visit(ast);
  assert.equal(imports.some(value => value.endsWith('/AssistantScreen')),false);
  assert.ok(imports.some(value => value.endsWith('/AssistantRouteActivation')));
});

test('a saved body source-link callback cannot navigate after Close or after returning to the same workspace', async () => {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{ window: dom.window,document: dom.window.document,IS_REACT_ACT_ENVIRONMENT: true });
  let current = { active: true,entryToken: 'entry:1',expanded: false,href: '/areas/assistant/conversation',canonical: false,frame: { width: 400,height: 700 },requestRevision: 0 };
  const context = createContext(current); let dispatched = 0, latest!: (href: string) => void;
  const capture = (expected: string) => { const assert = () => { if (!current.active || current.entryToken !== expected) throw new Error('Stale overlay'); }; assert(); return assert; };
  const dependencies: Record<string,unknown> = {
    'react': React,'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { useRoute: () => ({ key: 'actual-campus-ancestor' }) },
    '../auth/SessionProvider': { useSession: () => ({ scopeKey: 'actor:campus:live' }) },
    '../lib/use-operation-context': { useOperationContext: () => () => () => {} },
    './BackNavigation': { useCampusNavigation: () => ({ onAssistantNavigate() { dispatched++; },assistantIntent: (commit: () => void) => commit() }) },
    './assistant-presentation-context': { AssistantPresentationProvider: React.Fragment,useAssistantPresentationState: () => ({ ...useContext(context),captureOperation: capture,setExpanded() {},open() {},close() {} }) },
  };
  const file = path.join(root,'src/ui/AssistantPresentation.tsx'), compiled = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,esModuleInterop: true } }).outputText;
  const exports: { useAssistantPresentation?: () => { onNavigate: (href: string) => void } } = {};
  runInNewContext(compiled,{ exports,URL,require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected hook dependency ${name}`); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  function Probe() { latest = exports.useAssistantPresentation!().onNavigate; return null; }
  const renderer = createRoot(dom.window.document.getElementById('root')!);
  const render = async () => { await act(async () => renderer.render(React.createElement(context.Provider,{ value: current },React.createElement(Probe)))); };
  try {
    await render(); const saved = latest; saved('/areas/reports'); assert.equal(dispatched,1);
    current = { ...current,active: false,entryToken: '' }; await render(); saved('/areas/reports'); assert.equal(dispatched,1);
    current = { ...current,active: true,entryToken: 'entry:3' }; await render(); saved('/areas/reports'); assert.equal(dispatched,1,'a new entry never revives the old source callback');
    latest('/areas/reports'); assert.equal(dispatched,2,'the freshly rendered owning link remains usable');
  } finally { await act(async () => renderer.unmount()); Object.assign(globalThis,{ window: oldWindow,document: oldDocument,IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
});
