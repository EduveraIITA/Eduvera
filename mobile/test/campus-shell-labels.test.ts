import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import { campusTabs } from '../src/lib/campus-tabs';
import { assistantLayout,assistantVisibleHeight } from '../src/lib/assistant-layout';
import { iosDockGeometry } from '../src/lib/dock-geometry';
import { assistantPresentationPermitted } from '../src/lib/assistant-presentation-policy';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

/** Execute the current shell against inert platform adapters and inspect its
 * actual Text/Pressable contracts. Native glyph fitting remains device QA. */
function shell(width: number,height: number,expanded = false,isPad = width > 700,options: { assistantEnabled?: boolean; assistantEligible?: boolean; assistantErrorStatus?: number; assistantActive?: boolean } = {}) {
  const View = () => null, Text = () => null, Pressable = () => null, Tabs = Object.assign(() => null,{ Screen: () => null }), Overlay = () => null;
  const AssistantMark = Symbol('AssistantMark'), actions = { open: 0,close: 0 }, states: unknown[] = [];
  class ApiError extends Error { constructor(readonly status: number) { super('Unavailable'); } }
  const active = options.assistantActive ?? expanded;
  const flatten = (value: unknown): Record<string,unknown> => Array.isArray(value) ? Object.assign({},...value.map(flatten)) : value && typeof value === 'object' ? value as Record<string,unknown> : {};
  const dependencies: Record<string,unknown> = {
    'react': { useMemo: (read: () => unknown) => read(),useState: (value: unknown) => { const index = states.push(value)-1; return [value,(next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },useRef: (value: unknown) => ({ current: value }),useEffect() {} },'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View,Text,Pressable,Image: Symbol('Image'),Platform: { OS: 'ios',isPad },StyleSheet: { create: (value: unknown) => value,flatten,hairlineWidth: .5 },useWindowDimensions: () => ({ width,height }) },
    'expo-router': { Link: Symbol('Link'),Redirect: Symbol('Redirect'),Tabs,usePathname: () => '/today' },
    '../auth/SessionProvider': { useSession: () => ({ status: 'authenticated',ready: true,scopeKey: 'actor:campus:live',user: { id: 'actor' },memberships: [{ school_id: 'campus',school_name: 'Campus' }],schoolId: 'campus',environment: { mode: 'live' } }) },
    '../lib/query': { useApi: (route: string) => ({ data: route === '/api/v1/auth/pro-features/' ? { enabled: options.assistantEnabled ?? true,preview: true } : undefined,error: route === '/api/v1/auth/pro-features/' && options.assistantErrorStatus ? new ApiError(options.assistantErrorStatus) : undefined }) },
    '../lib/campus-tabs': { campusTabs,campusTabForHref: () => campusTabs[0] },
    '../lib/assistant-layout': { assistantLayout,assistantVisibleHeight },'../lib/dock-geometry': { iosDockGeometry },'./OperatingPane': { OperatingPaneContext: { Provider: Symbol('OperatingPane') } },
    '../lib/assistant-access': { assistantPerspective: () => 'principal',assistantEntryAvailable: () => options.assistantEligible ?? true },
    '../../../packages/contracts/src/workspace-normalizer': {},
    './assistant-presentation-context': { useAssistantPresentationState: () => ({ expanded,mode: assistantLayout({ width,height,expanded,isPad }).mode }) },
    '../lib/assistant-presentation-policy': { assistantPresentationPermitted },'../lib/api': { ApiError },
    './theme': { useTheme: () => ({ colors: {},dark: false }) },'react-native-safe-area-context': { SafeAreaView: View,useSafeAreaInsets: () => ({ top: 59,bottom: 34,left: 0,right: 0 }) },
    './Glass': { Glass: View },'./CampusTabs': { CampusTabs: Tabs },'./campus-tabs-options': { NativeDockMetricsContext: { Provider: Symbol('DockMetricsProvider') } },'./AssistantOverlayHost': { AssistantOverlayHost: Overlay },
    './AssistantPresentation': { useAssistantPresentation: () => ({ active,open() { actions.open++; },close() { actions.close++; } }) },
    './native-tab-insets-context': { NativeTabInsetsContext: { Provider: Symbol('InsetProvider') }, FloatingDockInsetsContext: { Provider: Symbol('FloatingInsetProvider') } },
    './Icon': { Icon: Symbol('Icon') },'./AssistantMark': { AssistantMark },
    './components': { Button: Symbol('Button'),Empty: Symbol('Empty'),Loading: Symbol('Loading'),Page: Symbol('Page') },
    './BackNavigation': { useCampusNavigation: () => ({ onNavigate() {},selectTab() {},tabHref: (href: string) => href,tabConfigurationBusy: false }),useHeaderBack: () => ({ visible: false,label: 'Back' }) },
  };
  const file = path.join(root,'src/ui/CampusShell.tsx'), code = ts.transpileModule(readFileSync(file,'utf8'),{ compilerOptions: { jsx: ts.JsxEmit.ReactJSX,module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { CampusShell?: () => React.ReactNode } = {};
  runInNewContext(code,{ exports,require(name: string) { if (name.endsWith('.png')) return 1; if (!(name in dependencies)) throw new Error(`Unexpected shell dependency ${name}`); return dependencies[name]; } },{ filename: file,timeout: 1000 });
  const result = exports.CampusShell!(), elements: React.ReactElement<Record<string,unknown>>[] = [];
  function walk(value: React.ReactNode) { if (Array.isArray(value)) { value.forEach(walk); return; } if (!React.isValidElement<Record<string,unknown>>(value)) return; elements.push(value); walk(value.props.children as React.ReactNode); } walk(result);
  return { elements,Text,Pressable,Tabs,Overlay,AssistantMark,flatten,actions,states };
}

test('iPhone and portrait iPad use one native tab host without a second custom dock',()=>{
  for(const [width,height,isPad] of [[393,852,false],[744,1133,true]] as const){
    const view=shell(width,height,false,isPad),tabs=view.elements.filter(item=>item.type===view.Tabs);
    assert.equal(tabs.length,1);assert.equal(tabs[0]!.key,'actor:campus:live');
    assert.equal(tabs[0]!.props.hidden,false);assert.equal(tabs[0]!.props.sidebar,false);
    assert.equal(view.elements.some(item=>item.type===view.Pressable&&item.props.accessibilityRole==='tab'),false);
    assert.equal(view.elements.filter(item=>item.type===view.Overlay).length,1);
  }
});
test('landscape sidebar labels retain their ordinary multiline Dynamic Type behavior', () => {
  const { elements,Text } = shell(1194,834), label = elements.find(element => element.type === Text && element.props.children === 'Assistant');
  assert.ok(label); assert.equal(label.props.numberOfLines,undefined); assert.equal(label.props.adjustsFontSizeToFit,false); assert.notEqual(label.props.allowFontScaling,false);
});

test('the separate Assistant action toggles the same overlay, never app navigation',()=>{
 for(const active of [false,true]){
   const view=shell(393,852,false,false,{assistantActive:active});
   const tabs=view.elements.find(item=>item.type===view.Tabs)!;
   (tabs.props.onAssistantPress as ()=>void)();
   assert.deepEqual(view.actions,{open:active?0:1,close:active?1:0});
 }
});
test('compact Assistant keeps the app touchable and accessible; phone fullscreen hides native tabs',()=>{
 const compact=shell(393,852,false,false,{assistantActive:true});
 assert.equal(compact.elements.some(item=>item.props.pointerEvents==='none'),false);
 assert.equal(compact.elements.some(item=>item.props.accessibilityElementsHidden===true),false);
 const expanded=shell(393,852,true,false),tabs=expanded.elements.find(item=>item.type===expanded.Tabs)!;
 assert.equal(tabs.props.hidden,true);
 assert.ok(expanded.elements.some(item=>item.props.pointerEvents==='none'));
});
test('definitive Pro unavailability removes the Assistant action from native configuration',()=>{
 for(const options of [{assistantEnabled:false},{assistantEligible:false},{assistantErrorStatus:403}]){
  const view=shell(393,852,false,false,options),tabs=view.elements.find(item=>item.type===view.Tabs)!;
  assert.equal(tabs.props.assistant,false);assert.equal(tabs.key,'actor:campus:live');
 }
});
test('iPad split retains one router and two usable panes across portrait and landscape',()=>{
 for(const [width,height] of [[744,1133],[1366,1024],[600,900]]){
  const view=shell(width!,height!,true,true),tabs=view.elements.filter(item=>item.type===view.Tabs),hosts=view.elements.filter(item=>item.type===view.Overlay);
  assert.equal(tabs.length,1);assert.equal(tabs[0]!.props.hidden,false);assert.equal(hosts.length,1);
  assert.equal(view.elements.some(item=>item.props.pointerEvents==='none'),false);
  assert.equal((hosts[0]!.props.layout as ReturnType<typeof assistantLayout>).mode,'split');
  if(width!<height!)assert.equal(tabs[0]!.props.sidebar,false);
 }
});
