import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import { campusTabs } from '../src/lib/campus-tabs';
const require=createRequire(import.meta.url),NativeTabs=Object.assign(()=>null,{Trigger:Object.assign(()=>null,{Icon:()=>null,Label:()=>null,Badge:()=>null})});
const exports:Record<string,any>={},source=ts.transpileModule(readFileSync(new URL('../src/ui/CampusTabs.ios.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deps:Record<string,any>={'react/jsx-runtime':require('react/jsx-runtime'),'expo-router/native-tabs':{NativeTabs},'../lib/campus-tabs':{campusTabs},'./theme':{useTheme:()=>({dark:true,colors:{ink:'#fff',link:'#9bf',danger:'#faa'}})}};
runInNewContext(source,{exports,require:(name:string)=>{if(name.endsWith('.png'))return name;assert.ok(name in deps,name);return deps[name];}});
function tree(overrides:Record<string,unknown>={}){
 const actions:string[]=[],element=exports.CampusTabs({hidden:false,sidebar:false,blocked:false,assistant:true,workCount:7,activeRoot:'/areas',onTabPress:(root:string)=>actions.push(root),onAssistantPress:()=>actions.push('toggle'),...overrides});
 return{element,actions,triggers:React.Children.toArray(element.props.children) as React.ReactElement<any>[]};
}
test('iOS uses UIKit native tabs and a separate prominent Assistant action with original artwork',()=>{
 const {element,triggers,actions}=tree();assert.equal(element.type,NativeTabs);assert.equal(element.props.minimizeBehavior,'never');
 assert.equal(triggers.length,5);const assistant=triggers.find(item=>item.props.name==='(assistant)')!;
 assert.equal(assistant.props.prominent,true);assert.equal(assistant.props.disabled,true,'prevents native route selection while retaining action taps');
 const children=React.Children.toArray(assistant.props.children) as React.ReactElement<any>[];
 assert.equal(children.find(child=>child.type===NativeTabs.Trigger.Label)!.props.hidden,true);
 assert.ok(children.find(child=>child.type===NativeTabs.Trigger.Icon)!.props.src.includes('assistant-tab-dark'));
 assistant.props.listeners.tabPress({data:{isPrevented:true}});assert.deepEqual(actions,['toggle']);
});
test('native selection retains its system animation; only reselect and prevented presses use the app guard',()=>{
 const {triggers,actions}=tree(),work=triggers.find(item=>item.props.name==='work')!,areas=triggers.find(item=>item.props.name==='areas')!;
 work.props.listeners.tabPress({data:{isPrevented:false}});assert.deepEqual(actions,[],'UIKit/Expo owns normal destination selection');
 areas.props.listeners.tabPress({data:{isPrevented:false}});assert.deepEqual(actions,['/areas'],'reselect uses the guarded reset to base');
 assert.equal(areas.props.disablePopToTop,true,'UIKit must not discard a deep draft before the app confirms');
 work.props.listeners.tabPress({data:{isPrevented:true}});assert.deepEqual(actions,['/areas','/work']);
});
test('expanded phone chat hides the native dock and busy actions cannot toggle Assistant',()=>{
 assert.equal(tree({hidden:true}).element.props.hidden,true);
 const busy=tree({blocked:true}),assistant=busy.triggers.find(item=>item.props.name==='(assistant)')!;
 assistant.props.listeners.tabPress({data:{isPrevented:true}});assert.deepEqual(busy.actions,[]);
 assert.ok(busy.triggers.every(item=>item.props.disabled));
 const off=tree({assistant:false});assert.equal(off.triggers.find(item=>item.props.name==='(assistant)')!.props.hidden,true);
 assert.equal(off.triggers.filter(item=>item.props.name!=='(assistant)').length,4);
});
