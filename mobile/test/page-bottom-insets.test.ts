import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
const require = createRequire(import.meta.url), header = React.createContext(true);
const flatten = (value: any): any => Array.isArray(value) ? Object.assign({},...value.map(flatten)) : value ?? {};
function load(file: string, dependencies: Record<string,unknown>) {
  const exports: Record<string,any> = {}, source = ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  runInNewContext(source,{exports,setTimeout,clearTimeout,require(name:string){assert.ok(name in dependencies,name);return dependencies[name];}});return exports;
}
function nodes(element: any): any[] { return !React.isValidElement<any>(element) ? [] : [element,...React.Children.toArray(element.props.children).flatMap(nodes)]; }
function primitives(assistant: number, measurements: unknown[] = [], reports?: number[]) {
  let state = 0;
  const metrics = React.createContext((value: number) => reports?.push(value));
  const dock = React.createContext({ bar: 90, assistant });
  return {
    react:{...React,useContext:(context:unknown)=>context===header?true:context===dock?{bar:90,assistant}:context===metrics?(value:number)=>reports?.push(value):false,useRef:(value:unknown)=>({current:value}),useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown)=>fn(),useState:(initial:unknown)=>[measurements[state++]??initial,()=>{}],useEffect:(effect:()=>void)=>{if(reports)effect();}},
    'react/jsx-runtime':require('react/jsx-runtime'),
    'react-native':{Platform:{OS:'ios'},View:'view',ScrollView:'scroll',KeyboardAvoidingView:'avoid',StyleSheet:{create:(value:unknown)=>value},Text:'text'},
    'react-native-screens/experimental':{SafeAreaView:'safe',ScrollViewMarker:'marker'},'expo-router':{useIsFocused:()=>true},'./campus-tabs-options':{NativeDockMetricsContext:metrics,NativeDockInsetsContext:dock},
    './native-tab-insets-context':{NativeTabInsetsContext:React.createContext(false)},
  };
}
function components(overlap: number, measurements: unknown[] = []) {
  return load('../src/ui/components.tsx',{
    ...primitives(overlap,measurements),'expo-router/react-navigation':{HeaderShownContext:header},'react-native-safe-area-context':{},
    './theme':{useTheme:()=>({colors:{canvas:'#fff',row:'#eee',border:'#bbb'}})},'./Icon':{},'./ExecutionBanner':{ExecutionBanner:'banner'},'./theme-tokens':{themeRadii:{}},'./AssistantMark':{},
    './native-screen-insets':{NativeScreenInsetsProvider:'insets',useNativeScreenInsets:()=>({bottom:0})},'../lib/campus-workspace-layout':{},'./BackNavigation':{usePageNavigationTitle(){}},
  });
}
test('ordinary pages keep a full scrolling viewport; UIKit adjusts the floating native tab clearance',()=>{
 const page=components(0).Page({title:'Profile',children:'Rows'}),scroll=nodes(page).find(node=>node.type==='scroll');
 assert.ok(scroll);assert.equal(flatten(scroll.props.style).paddingBottom,undefined);
 assert.equal(scroll.props.contentInsetAdjustmentBehavior,'automatic');
 assert.equal(flatten(scroll.props.contentContainerStyle).paddingBottom,40);
});
test('the shared native inset owner measures the interface overlap and removes it for fullscreen maps',()=>{
 function value(disabled=false){
  const provider=load('../src/ui/native-screen-insets.tsx',primitives(0,[{width:393,height:700},{width:393,height:590}])).NativeScreenInsetsProvider;
  return nodes(provider({children:'Map',disabled})).find(node=>node.props.value?.ready!==undefined).props.value;
 }
 assert.equal(value().bottom,110);assert.equal(value(true).bottom,0);
});
test('inset profile groups keep feature icons and disclosure arrows inside both painted card edges',()=>{
  const group=components(0).ListGroup({children:'Rows',inset:true});assert.equal(flatten(group.props.style).paddingHorizontal,16);
  assert.equal(flatten(components(0).ListGroup({children:'Existing padded rows'}).props.style).paddingHorizontal,0,'existing callers retain their own padding');
});

test('compact chat layout passes touches through every transparent full-height wrapper',()=>{
 const frame=components(0).PageBody({children:'Blank transparent area',footer:React.createElement('button',null,'Send'),footerPadding:16,footerSeparator:false,maxWidth:440,passThrough:true});
 const wrappers=nodes(frame).filter(node=>node.type==='view'||node.type==='avoid');
 assert.equal(wrappers.length,4);
 for(const wrapper of wrappers)assert.equal(wrapper.props.pointerEvents,'box-none');
 const regular=components(0).PageBody({children:'Review',footerPadding:20,footerSeparator:true,maxWidth:920});
 assert.equal(regular.props.pointerEvents,'auto','ordinary form/pinned footer hit testing stays unchanged');
});


test('a visit invitation yields to typing without unmounting its owning action or changing pinned composers',()=>{
 const props={children:'Movement form',footer:React.createElement('button',null,'Invite visitors'),footerPadding:20,footerSeparator:false,maxWidth:700};
 for(const keyboardOpen of [false,true]){
  const hidden=components(0,[keyboardOpen]).PageBody({...props,footerKeyboardBehavior:'hide'});
  const footer=nodes(hidden).find(node=>node.props.style?.borderTopWidth===0);
  assert.equal(footer.props.style.display,keyboardOpen?'none':'flex');
  assert.ok(nodes(hidden).some(node=>node.type==='button'),'The invitation owner remains mounted');
  const composer=components(0,[keyboardOpen]).PageBody(props);
  assert.equal(nodes(composer).find(node=>node.props.style?.borderTopWidth===0).props.style.display,'flex');
 }
 const page=components(0).Page({title:'Visit',footerKeyboardBehavior:'hide'});
 assert.equal(nodes(page).find(node=>node.props.footerKeyboardBehavior).props.footerKeyboardBehavior,'hide');
});

test('compact clearance extends native content scrolling and leaves the physical tab report independent', () => {
  const page = components(168).Page({ title: 'Campus setup', children: 'Rows' });
  const scroll = nodes(page).find(node => node.type === 'scroll');
  assert.equal(flatten(scroll.props.contentContainerStyle).paddingBottom, 208);
  assert.equal(flatten(scroll.props.style).paddingBottom, undefined);
  assert.equal(scroll.props.contentInsetAdjustmentBehavior, 'automatic');

  const reports: number[] = [];
  const provider = load('../src/ui/native-screen-insets.tsx',
    primitives(168, [{ width: 393, height: 760 }, { width: 393, height: 668 }], reports)).NativeScreenInsetsProvider;
  const insets = nodes(provider({ children: 'Map' })).find(node => node.props.value?.ready).props.value;
  assert.equal(insets.bottom, 260, 'the map and pinned page actions clear both surfaces');
  assert.deepEqual(reports, [92], 'the shell only subtracts the physical nav tray for the mini');
});

test('native copilot scroll reveals a field above the tray and the open mini together', async () => {
  const frame = { x: 0, y: 100, width: 393, height: 700 };
  const input = { x: 16, y: 620, width: 360, height: 44 };
  const viewport = {}, contents = {};
  const inputNode = { measureLayout(ancestor: object, measured: (x: number, y: number) => void) {
    assert.equal(ancestor, contents);
    measured(16, 600);
  } };
  const dependency = primitives(168);
  const usePageReveal = load('../src/ui/use-page-reveal.ts', {
    ...dependency, './Motion': { useReducedMotion: () => true },
    '../lib/copilot-target': {
      measureCopilotTarget: async (node: object) => node === viewport ? frame : input,
      copilotWait: async () => undefined,
    },
  }).usePageReveal;
  const { scrollRef, reveal } = usePageReveal();
  const scrollRequests: unknown[] = [];
  scrollRef.current = {
    getNativeScrollRef: () => viewport, getInnerViewRef: () => contents,
    scrollTo: (options: unknown) => scrollRequests.push(options),
  };
  await reveal(inputNode, new AbortController().signal);
  assert.equal(scrollRequests.length, 1);
  const [{ y, animated }] = scrollRequests as { y: number; animated: boolean }[];
  assert.equal(y, 218);
  assert.equal(animated, false);
});
