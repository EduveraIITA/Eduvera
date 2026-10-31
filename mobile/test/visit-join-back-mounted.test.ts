import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act, createContext, useContext } from 'react';
import ts from 'typescript';
import * as policy from '../src/lib/back-policy';
import * as tabs from '../src/lib/campus-tabs';
import * as configuration from '../src/lib/tab-configuration';
import * as traversal from '../src/lib/back-browser-traversal';
import * as presentation from '../src/lib/back-presentation';
import * as assistantPolicy from '../src/lib/assistant-presentation-policy';
import * as overlay from '../src/lib/assistant-overlay';
import { canonicalNativeHref } from '../src/lib/navigation';

const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),{createRoot}=require('react-dom/client');
type BackExports=typeof import('../src/ui/BackNavigation');
test('the real shared cold security header returns to the exact public visit continuation',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),prior={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const target='/visit-join?continue=10000000-0000-4000-8000-000000000007',replaced:string[]=[],route=createContext({key:'security'}),assistantOwner=createContext(false);
 const tree:policy.CampusNavigationState={key:'root',type:'stack',index:0,routes:[{key:'campus',name:'(campus)',state:{key:'tabs',type:'tab',index:0,routes:[{key:'more-tab',name:'more',state:{key:'more-stack',type:'stack',index:0,routes:[{key:'security',name:'[...path]',params:{path:['account','security']}}]}}]}}]};
 const nav={dispatch(){throw Error('Cold public return must not invent a workspace history entry');},setOptions(){}},router={replace:(href:string)=>replaced.push(href),back(){throw Error('No prior route exists');},push(){throw Error('Back must not push');},setParams(){}};
 const dependencies:Record<string,unknown>={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{Platform:{OS:'ios'},Keyboard:{dismiss(){}},BackHandler:{addEventListener(){return{remove(){}};}}},'expo-router':{useIsFocused:()=>true,useNavigation:()=>nav,useRootNavigation:()=>nav,useRootNavigationState:()=>tree,useRoute:()=>useContext(route),useRouter:()=>router,useUnstableGlobalHref:()=>'/more/account/security',usePreventRemove:()=>()=>{}},'../auth/SessionProvider':{useSession:()=>({scopeKey:'verified-actor:global:live',ready:true,status:'authenticated',user:{id:'verified-actor'}})},'../lib/api':{captureApiContext:()=>({assertCurrent(){}})},'../lib/campus-tabs':tabs,'../lib/tab-configuration':configuration,'../lib/navigation':{canonicalNativeHref},'../lib/back-policy':policy,'../lib/assistant-presentation-policy':assistantPolicy,'../lib/assistant-overlay':overlay,'./assistant-presentation-context':{useAssistantPresentationState:()=>({mode:'hidden',active:false,expanded:false,open(){},close(){},setExpanded(){}})},'./assistant-overlay-context':{AssistantOverlayOwnerContext:assistantOwner},'./Alert':{Alert:{alert(){throw Error('No unsaved security draft exists');}}},'../lib/back-browser-traversal':traversal,'../lib/back-presentation':presentation};
 const exports={} as BackExports,compiled=ts.transpileModule(readFileSync(new URL('../src/ui/BackNavigation.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 runInNewContext(compiled,{exports,Map,Set,URL,JSON,setTimeout,clearTimeout,require(name:string){assert.ok(name in dependencies,name);return dependencies[name];}},{timeout:1000});
 let header!:ReturnType<BackExports['useHeaderBack']>;
 function Security(){exports.usePageNavigationTitle('Account security');header=exports.useHeaderBack();return React.createElement(exports.ScreenBack,{fallbackHref:target,title:'Visit'});}
 const root=createRoot(dom.window.document.getElementById('root'));
 try{await act(async()=>root.render(React.createElement(exports.BackNavigationProvider,null,React.createElement(Security))));assert.equal(header.visible,true);assert.equal(header.label,'Visit');await act(async()=>header.onPress());assert.deepEqual(replaced,[target]);}
 finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,prior);}
});
