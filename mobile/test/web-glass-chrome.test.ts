import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { themePalettes } from '../src/ui/theme-tokens';
import { campusTabs, campusTabForHref } from '../src/lib/campus-tabs';
import { assistantLayout, assistantVisibleHeight } from '../src/lib/assistant-layout';
import { iosDockGeometry } from '../src/lib/dock-geometry';
const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flatten = (value: unknown): Record<string,any> => Array.isArray(value) ? Object.assign({},...value.map(flatten)) : value && typeof value === 'object' ? value as Record<string,any> : {};
function load(file: string, dependencies: Record<string,unknown>, window: Window) {
  const source = ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,exports:Record<string,any>={};
  runInNewContext(source,{exports,window,require(name:string){if(name.endsWith('.png'))return '/wordmark.png';if(!(name in dependencies))throw new Error(`Unexpected web chrome dependency ${name}`);return dependencies[name];}},{filename:file,timeout:1000});return exports;
}
async function fixture(run:(h:any)=>Promise<void>,options:{standard?:boolean;webkit?:boolean;knownPreference?:boolean;legacy?:boolean;missingApi?:boolean}={}) {
  const dom = new JSDOM('<div id="root"></div>'),previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let reduced=false,forced=false,theme=themePalettes.live.light,dark=false;
  const listeners=new Map<string,Set<()=>void>>(),queries=new Map<string,any>();
  Object.defineProperty(dom.window,'CSS',{value:options.missingApi?undefined:{supports:(name:string)=>name==='backdrop-filter'?options.standard!==false:name==='-webkit-backdrop-filter'&&options.webkit===true},configurable:true});
  dom.window.matchMedia=(query:string)=>{if(!queries.has(query)){const set=new Set<()=>void>();listeners.set(query,set);queries.set(query,{get matches(){return query.includes('forced-colors')?forced:options.knownPreference===false?false:query.includes('no-preference')?!reduced:reduced;},media:query,...(options.legacy?{addListener:(callback:()=>void)=>set.add(callback),removeListener:(callback:()=>void)=>set.delete(callback)}:{addEventListener:(_event:string,callback:()=>void)=>set.add(callback),removeEventListener:(_event:string,callback:()=>void)=>set.delete(callback)})});}return queries.get(query);};
  const View = React.forwardRef<HTMLDivElement,any>(({style,children,accessibilityLabel,accessibilityRole,accessibilityElementsHidden,...props},ref)=>{const material=flatten(style);return React.createElement('div',{ref,style:material,'aria-label':accessibilityLabel,role:accessibilityRole,'aria-hidden':accessibilityElementsHidden||undefined,'data-glass':'backdropFilter'in material?'true':undefined,...(props.inert?{inert:true}:{})},children);});
  const react={react:React,'react/jsx-runtime':require('react/jsx-runtime')},styleSheet={flatten,create:(value:unknown)=>value,hairlineWidth:1},themeApi={useTheme:()=>({colors:theme,dark})};
  const glass=load('src/ui/Glass.web.tsx',{...react,'react-native':{View,StyleSheet:styleSheet},'./theme':themeApi},dom.window).Glass;
  const { createRoot }=require('react-dom/client'),renderer=createRoot(dom.window.document.getElementById('root'));let mounted=true;
  const h={dom,doc:dom.window.document,View,glass,react,styleSheet,themeApi,renderer,render:async(children:React.ReactNode)=>{await act(async()=>renderer.render(children));},
    preference:async(nextReduced:boolean,nextForced=false)=>{reduced=nextReduced;forced=nextForced;await act(async()=>listeners.forEach(set=>set.forEach(callback=>callback())));},
    theme:(next:typeof themePalettes.live.light,isDark:boolean)=>{theme=next;dark=isDark;},listenerCount:()=>[...listeners.values()].reduce((count,set)=>count+set.size,0),
    unmount:async()=>{if(mounted){mounted=false;await act(async()=>renderer.unmount());}},
  };
  try{await run(h);}finally{await h.unmount();Object.assign(globalThis,{...previous,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();}
}

test('web glass changes accessibility material without remounting or unfocusing its interactive child',async()=>fixture(async h=>{
  let pressed=0;const render=()=>h.render(React.createElement(h.glass,{accessibilityLabel:'Material'},React.createElement('input',{defaultValue:'Unsent draft'}),React.createElement('button',{onClick:()=>pressed++},'Continue')));
  await render();const surface=h.doc.querySelector('[aria-label="Material"]') as HTMLElement,input=h.doc.querySelector('input') as HTMLInputElement,button=h.doc.querySelector('button') as HTMLButtonElement;
  input.value='Retained draft';input.focus();assert.equal(surface.style.backdropFilter,'blur(16px)');assert.ok(surface.style.backgroundColor.includes('0.96'));
  await h.preference(true);assert.equal(surface.style.backdropFilter,'none');assert.ok(!surface.style.backgroundColor.includes('0.96'));assert.equal(h.doc.querySelector('input'),input);assert.equal(input.value,'Retained draft');assert.equal(h.doc.activeElement,input);
  await act(async()=>button.click());assert.equal(pressed,1);await h.preference(false,true);assert.equal(surface.style.backdropFilter,'none','forced colors also chooses an opaque surface');await h.preference(false);assert.equal(surface.style.backdropFilter,'blur(16px)');
  assert.equal(h.listenerCount(),3);await h.unmount();assert.equal(h.listenerCount(),0);
}));

test('unsupported CSS, unreadable preference APIs and unknown transparency preference keep an opaque usable fallback',async()=>{
  for(const options of [{standard:false},{missingApi:true},{knownPreference:false}])await fixture(async h=>{let clicks=0;await h.render(React.createElement(h.glass,null,React.createElement('button',{onClick:()=>clicks++},'Use control')));const surface=h.doc.querySelector('[data-glass]') as HTMLElement;assert.equal(surface.style.backdropFilter,'none');assert.ok(!surface.style.backgroundColor.includes('0.96'));await act(async()=>h.doc.querySelector('button').click());assert.equal(clicks,1);},options);
});

test('WebKit-only filtering and legacy media-query listeners honor live reduced-transparency changes and clean up',async()=>fixture(async h=>{
  await h.render(React.createElement(h.glass,null,'Material'));const surface=h.doc.querySelector('[data-glass]') as HTMLElement;
  assert.equal((surface.style as unknown as Record<string,string>).WebkitBackdropFilter,'blur(16px)');assert.equal(surface.style.backdropFilter,'none');await h.preference(true);assert.equal((surface.style as unknown as Record<string,string>).WebkitBackdropFilter,'none');assert.equal(h.listenerCount(),3);await h.unmount();assert.equal(h.listenerCount(),0);
},{standard:false,webkit:true,legacy:true}));

test('all theme materials retain readable ink/supporting text at both extreme backdrop colors',async()=>fixture(async h=>{
  const luminance=(values:number[])=>values.map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index]!,0);
  const rgb=(hex:string)=>[1,3,5].map(index=>Number.parseInt(hex.slice(index,index+2),16));
  for(const world of ['live','simulation'] as const)for(const mode of ['light','dark'] as const){const colors=themePalettes[world][mode];h.theme(colors,mode==='dark');await h.render(React.createElement(h.glass,null,'Material'));const background=(h.doc.querySelector('[data-glass]') as HTMLElement).style.backgroundColor.match(/[\d.]+/g)!.map(Number);assert.equal(background[3],.96);
    for(const extreme of [0,255])for(const foreground of [colors.ink,colors.muted]){const bg=luminance(background.slice(0,3).map((value:number)=>value*.96+extreme*.04)),fg=luminance(rgb(foreground)),contrast=(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);assert.ok(contrast>=4.5,`${world}/${mode} ${foreground}: ${contrast}`);}
  }
}));

async function chrome(run:(h:any)=>Promise<void>,initial:{width?:number;unread?:number;detail?:boolean}={}) {await fixture(async h=>{
  let width=initial.width??393,unread=initial.unread??7,visible=initial.detail??true,disabled=false,backCount=0;const followed:any[]=[],navigated:string[]=[],tabSelections:string[]=[];
  const Pressable=({href,onPress,accessibilityLabel,accessibilityRole,accessibilityState,disabled,style,children,...props}:any)=>React.createElement(href?'a':'button',{href,role:accessibilityRole,'aria-label':accessibilityLabel,'aria-disabled':accessibilityState?.disabled||undefined,'aria-selected':accessibilityState?.selected,'aria-expanded':accessibilityState?.expanded,disabled,style:flatten(style),onClick:(event:any)=>{onPress?.(event);if(href)event.preventDefault();}},children);
  const Link=({href,onPress,children}:any)=>React.cloneElement(React.Children.only(children),{href,onPress:(event:any)=>{onPress?.(event);followed.push({href,prevented:event.defaultPrevented,modified:event.ctrlKey});}});
  const Pass=({children}:any)=>React.createElement(React.Fragment,null,children),Tabs=Object.assign(({children}:any)=>React.createElement('div',{'data-router':'true'},children),{Screen:()=>null});
  const dependencies={...h.react,'react-native':{View:h.View,Text:({children,style}:any)=>React.createElement('span',{style:flatten(style)},children),Pressable,Image:({accessibilityLabel}:any)=>React.createElement('img',{alt:accessibilityLabel}),Keyboard:{},Platform:{OS:'web'},StyleSheet:h.styleSheet,useWindowDimensions:()=>({width,height:844})},'expo-router':{Link,Redirect:()=>null,Tabs,usePathname:()=>'/areas/attendance/records'},
    '../auth/SessionProvider':{useSession:()=>({status:'authenticated',scopeKey:'actor:campus:live',user:{id:'actor'},schoolId:'campus',environment:{mode:'live'},memberships:[]})},'../lib/query':{useApi:(href:string)=>({data:href==='/api/v1/notifications/?limit=1'?{unread_count:unread}:href==='/api/v1/workspace'?{context:{institution_label:'Aaranya Campus'},work:{counts:{needs_me:4}}}:undefined})},'../lib/campus-tabs':{campusTabs,campusTabForHref},'../lib/assistant-access':{assistantEntryAvailable:()=>true,assistantPerspective:()=> 'principal'},'../../../packages/contracts/src/workspace-normalizer':{normalizeWorkspaceManifest:(value:unknown)=>value,assertWorkspaceManifestContext(){}},'./assistant-presentation-context':{useAssistantPresentationState:()=>({expanded:false,mode:'compact'})},'../lib/assistant-presentation-policy':{assistantPresentationPermitted:()=>true},'../lib/api':{ApiError:class extends Error{}},'../lib/assistant-layout':{assistantLayout,assistantVisibleHeight},'../lib/dock-geometry':{iosDockGeometry},'./OperatingPane':{OperatingPaneContext:{Provider:Pass}},'./theme':h.themeApi,'react-native-safe-area-context':{SafeAreaView:h.View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})},'./Glass':{Glass:h.glass},'./CampusTabs':{CampusTabs:Tabs},'./campus-tabs-options':{NativeDockMetricsContext:{Provider:Pass}},'./AssistantOverlayHost':{AssistantOverlayHost:()=>React.createElement('div',{'data-assistant-host':'true'})},'./AssistantPresentation':{useAssistantPresentation:()=>({active:false,open(){},close(){}})},'./native-tab-insets-context':{NativeTabInsetsContext:{Provider:Pass},FloatingDockInsetsContext:{Provider:Pass}},'./Icon':{Icon:()=>null},'./AssistantMark':{AssistantMark:()=>null},'./components':{},'./BackNavigation':{useCampusNavigation:()=>({onNavigate:(href:string)=>navigated.push(href),selectTab:(href:string)=>tabSelections.push(href),tabHref:(href:string)=>href,tabConfigurationBusy:false}),useHeaderBack:()=>({visible,label:'Back to Work',disabled,onPress:()=>{backCount++;}})}};
  const Shell=load('src/ui/CampusShell.tsx',dependencies,h.dom.window).CampusShell,render=()=>h.render(React.createElement(Shell));await render();
  await run({...h,render,followed,navigated,tabSelections,backCount:()=>backCount,configure:async(values:any)=>{width=values.width??width;unread=values.unread??unread;visible=values.detail??visible;disabled=values.disabled??disabled;await render();}});
});}

test('mounted web header groups both utility links and destination Back while retaining badge, link and disabled semantics',async()=>chrome(async h=>{
  const notifications=h.doc.querySelector('[aria-label="Notifications, 7 unread"]') as HTMLElement,account=h.doc.querySelector('[aria-label="Open account"]') as HTMLElement,back=h.doc.querySelector('[aria-label="Back to Work"]') as HTMLButtonElement;
  assert.ok(notifications&&account&&back);assert.equal(notifications.closest('[data-glass]'),account.closest('[data-glass]'));assert.notEqual(back.closest('[data-glass]'),account.closest('[data-glass]'));assert.equal(back.textContent,'Work');assert.equal(notifications.textContent,'7');assert.equal(notifications.getAttribute('href'),'/more/notifications');assert.equal(account.getAttribute('href'),'/more/account');
  for(const target of [notifications,account,back]){assert.ok(Number.parseFloat(target.style.minHeight)>=44);assert.ok(Number.parseFloat(target.style.minWidth)>=44);}
  await act(async()=>back.click());assert.equal(h.backCount(),1);await act(async()=>account.click());assert.deepEqual(h.navigated,['/more/account']);
  await act(async()=>notifications.dispatchEvent(new h.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true})));assert.deepEqual(h.navigated,['/more/account']);assert.equal(h.followed.at(-1).prevented,false,'modified browser clicks keep their normal link behavior');
  const router=h.doc.querySelector('[data-router]');await h.configure({unread:120,disabled:true});assert.equal(h.doc.querySelector('[aria-label="Notifications, 120 unread"]').textContent,'99+');const disabledBack=h.doc.querySelector('[aria-label="Back to Work"]') as HTMLButtonElement;assert.equal(disabledBack.disabled,true);await act(async()=>disabledBack.click());assert.equal(h.backCount(),1);assert.equal(h.doc.querySelector('[data-router]'),router);assert.equal(h.doc.querySelectorAll('[data-assistant-host]').length,1);
}));

test('responsive root chrome has one brand, keeps the desktop sidebar, and clears absent/invalid unread counts',async()=>chrome(async h=>{
  await h.configure({detail:false,unread:0});assert.equal(h.doc.querySelectorAll('[aria-label="Aaranya Campus"]').length,1);assert.equal(h.doc.querySelector('[aria-label="Back to Work"]'),null);assert.equal(h.doc.querySelector('[aria-label="Notifications"]').textContent,'');
  await h.configure({width:1280,unread:-3});assert.equal(h.doc.querySelectorAll('[aria-label="Aaranya Campus"]').length,1);assert.ok(h.doc.body.textContent.includes('Your workspace'));assert.equal(h.doc.querySelectorAll('[aria-label="Workspace"]').length,1);assert.equal(h.doc.querySelector('[aria-label="Notifications"]').textContent,'');assert.equal(h.doc.querySelectorAll('[data-router]').length,1);
}));
