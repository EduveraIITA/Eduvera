import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as layout from '../src/lib/campus-workspace-layout';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
type Props = Record<string, any>;
const flatten = (value: any): Props => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
const Box = ({ children }: Props) => React.createElement('div', null, children);
const Text = ({ children }: Props) => React.createElement('span', null, children);
const View = React.forwardRef<HTMLDivElement, Props>(function View({ children, style }, ref) {
  const flat = flatten(style);
  return React.createElement('div', { ref, 'data-panel-height': flat.borderTopWidth !== undefined && typeof flat.height === 'number' ? flat.height : undefined, 'data-panel-bottom': flat.borderTopWidth !== undefined ? flat.paddingBottom : undefined }, children);
});
const Pressable = ({ children, accessibilityLabel, disabled, onPress }: Props) => React.createElement('button', { 'aria-label': accessibilityLabel, disabled, onClick: onPress }, children);

function workspace(isFocused: () => boolean,bottomOverlap=0) {
  const Insets = React.createContext(bottomOverlap);
  const ScrollView = ({ children,style,contentContainerStyle }: Props) => React.createElement('div',{ 'data-panel-scroll-flex': flatten(style).flex, 'data-scroll-content-bottom': flatten(contentContainerStyle).paddingBottom },children);
  const dependencies: Props = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View, Text, Pressable, ScrollView, Platform: { OS: 'ios' }, Keyboard: { metrics: () => null, addListener: () => ({ remove() {} }), dismiss() {} }, Dimensions: { get: () => ({ height: 844 }) }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } },
    'expo-router': { useIsFocused: isFocused }, 'expo-router/react-navigation': { HeaderShownContext: React.createContext(true) },
    '../../ui/Motion': { MotionModal: ({ visible, children }: Props) => visible ? React.createElement('div', { 'data-campus-modal': 'open' }, children) : null },
    'react-native-safe-area-context': { SafeAreaProvider: Box, SafeAreaView: Box },
    '../../ui/components': { NativePageSafeArea: Box }, '../../ui/ExecutionBanner': { ExecutionBanner: () => null },
    '../../ui/theme': { useTheme: () => ({ colors: { canvas: '#111', surface: '#222', ink: '#fff' } }) },
    '../../ui/native-screen-insets': { NativeScreenInsetsProvider: ({ children,disabled }: Props) => React.createElement(Insets.Provider,{ value: disabled?0:bottomOverlap },children), useNativeScreenInsets: () => ({ bottom: React.useContext(Insets) }) },
    '../../lib/campus-workspace-layout': layout, '../../ui/BackNavigation': { usePageNavigationTitle() {} },
  };
  const exports: Props = {}, source = ts.transpileModule(readFileSync(new URL('../src/features/campus/CampusWorkspace.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, requestAnimationFrame: (callback: () => void) => callback(), require(name: string) {
    if (name.startsWith('phosphor-react-native/src/icons/')) return { [name.split('/').at(-1)! + 'Icon']: () => null };
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return exports.CampusWorkspace;
}

async function mounted(run: (container: HTMLElement, renderer: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as Props).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById('root')!, renderer = createRoot(container);
  try { await run(container, renderer); }
  finally { await act(async () => renderer.unmount()); Object.assign(globalThis, previous); dom.window.close(); }
}

const props = () => ({ expanded: true, panel: 'place', title: 'Ground floor', panelContent: React.createElement('p', null, 'Exact room and resource links'), floorControls: React.createElement('p', null, 'Campus · Ground floor'), selectionKey: 'building:ground', onPanel() {}, onZoomIn() {}, onZoomOut() {}, onFit() {}, canZoomIn: true, canZoomOut: false });

test('a retained fullscreen campus yields to its source route on blur and restores on Back without rewriting fullscreen state', async () => {
  let focused = true, mapMounts = 0, mapUnmounts = 0;
  const Screen = workspace(() => focused), expansions: boolean[] = [];
  function Map() { React.useEffect(() => { mapMounts++; return () => { mapUnmounts++; }; }, []); return React.createElement('p', null, 'Published floor'); }
  await mounted(async (container, renderer) => {
    const render = () => act(async () => renderer.render(React.createElement(Screen, { ...props(), onExpandedChange: (value: boolean) => expansions.push(value), map: () => React.createElement(Map) })));
    await render(); assert.ok(container.querySelector('[data-campus-modal="open"]')); assert.match(container.textContent!, /Published floor/);
    focused = false; await render();
    assert.equal(container.querySelector('[data-campus-modal]'), null, 'the report/source screen must not remain covered by the retained campus Modal');
    assert.equal(mapUnmounts, 1);
    focused = true; await render();
    assert.ok(container.querySelector('[data-campus-modal="open"]')); assert.equal(mapMounts, 2);
    assert.deepEqual(expansions, [], 'route focus changes preserve the retained URL/fullscreen choice for Back');
  });
});

test('selecting a new interior destination returns expanded details to their map-first resting height', async () => {
  const Screen = workspace(() => true);
  await mounted(async (container, renderer) => {
    let selectionKey = 'building:ground';
    const render = () => act(async () => renderer.render(React.createElement(Screen, { ...props(), selectionKey, map: () => React.createElement('p', null, 'Floor plan') })));
    const panelHeight = () => Number(container.querySelector('[data-panel-height]')?.getAttribute('data-panel-height'));
    await render(); assert.ok(Math.abs(panelHeight() - 168) < 1e-6);
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand map details"]')!; assert.ok(expand);
    await act(async () => expand.click()); assert.equal(panelHeight(), 240);
    await render(); assert.equal(panelHeight(), 240, 'ordinary rerenders preserve the chosen detail height');
    selectionKey = 'building:ground:registry'; await render();
    assert.ok(Math.abs(panelHeight() - 168) < 1e-6, 'the newly selected floor/room gets readable map space immediately');
    assert.ok(container.querySelector('[aria-label="Expand map details"]'));
  });
});

test('native dock exclusion belongs to the details frame, while fullscreen and a closed panel retain their own inset owner', async () => {
  const dock=110,Screen=workspace(()=>true,dock),mapInsets:number[]=[];
  await mounted(async(container,renderer)=>{
    const render=(fullscreen:boolean,panel:string|null='place')=>act(async()=>renderer.render(React.createElement(Screen,{...props(),expanded:fullscreen,panel,map:(bottom:number)=>{mapInsets.push(bottom);return React.createElement('p',null,'Floor drawing');}})));
    await render(false);
    const panel=container.querySelector('[data-panel-height]')!;
    assert.equal(Number(panel.getAttribute('data-panel-height')),layout.campusPanelHeight(600,false,false,true,dock));
    assert.equal(Number(panel.getAttribute('data-panel-bottom')),dock);
    const scroll=container.querySelector('[data-panel-scroll-flex]')!;
    assert.equal(scroll.getAttribute('data-panel-scroll-flex'),'1');
    assert.equal(scroll.getAttribute('data-scroll-content-bottom'),'24','content does not reserve the same dock a second time');
    assert.equal(mapInsets.at(-1),0,'the details frame separates the map from the dock');
    await render(true);
    assert.ok(container.querySelector('[data-campus-modal="open"]'));
    assert.equal(container.querySelector('[data-panel-bottom]')?.getAttribute('data-panel-bottom'),'0','fullscreen SafeAreaView already owns the system bottom');
    await render(false,null);
    assert.equal(container.querySelector('[data-panel-height]'),null);
    assert.equal(mapInsets.at(-1),dock,'a closed panel keeps the canvas edge-to-edge and offsets map controls instead');
  });
});
