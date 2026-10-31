import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React,{act} from 'react';
import ts from 'typescript';
import * as presentation from '../src/lib/visit-place-presentation';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),{createRoot}=require('react-dom/client');
const place={id:'room-a',label:'Meeting room',kind:'office'},source=readFileSync(new URL('../src/features/gate/GatePlacePicker.tsx',import.meta.url),'utf8');
async function harness(run:(h:any)=>Promise<void>,candidate=place){
 const dom=new JSDOM('<div id="root"></div>'),previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let epoch=0,disabled=false,response:()=>void,settle=false;const selected:any[]=[],reads:string[]=[],guards:any[]=[];
 const pending=new Promise<any>(resolve=>{response=()=>resolve({places:candidate.kind==='campus'?[]:[candidate],campuses:candidate.kind==='campus'?[candidate]:[]});});
 const View=({children}:any)=>React.createElement('div',null,children),Button=({title,onPress,disabled}:any)=>React.createElement('button',{onClick:onPress,disabled},title);
 const components={Section:View,ListGroup:View,Loading:()=>null,Empty:({title}:any)=>React.createElement('p',null,title),Notice:({message}:any)=>React.createElement('p',null,message),Row:({title,onPress}:any)=>React.createElement(Button,{title,onPress}),SearchField:()=>null};
 const dependencies:any={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{View,Text:View},
  '../../auth/SessionProvider':{useSession:()=>({schoolId:'school-a'})},'../../lib/api':{apiFetch:(path:string)=>{reads.push(path);return pending;}},
  '../../lib/use-operation-context':{useOperationContext:()=>()=>{const captured=epoch;return()=>{if(epoch!==captured)throw new Error('The selected account or world changed.');};}},
  '../../lib/visit-place-presentation':presentation,'../../ui/BackNavigation':{ScreenBack:()=>null,useScreenExitGuard:(guard:any)=>guards.push(guard)},
  '../../ui/DomainControls':{ControlButton:Button,ChoiceMenu:()=>null},'../../ui/components':components,'../../ui/theme':{useTheme:()=>({colors:{}})},'../ResourcesScreen':{DomainPages:()=>null},
  './CampusPlacePortal':{CampusPlacePortal:({onChoose}:any)=>React.createElement(Button,{title:'Choose visual room',onPress:()=>onChoose(candidate)})},
  './useVisitPlaces':{useVisitPlaces:()=>({data:[place]}),useVisitCampuses:()=>({data:undefined}),useVisitSchedule:()=>({data:undefined})},
 };
 const exports:any={};runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URLSearchParams,require(name:string){assert.ok(name in dependencies,name);return dependencies[name];}});
 const renderer=createRoot(dom.window.document.getElementById('root')),render=()=>act(async()=>renderer.render(React.createElement(exports.GatePlacePicker,{root:'/api/v1/gate/schools/school-a/visit-arrangements',disabled,onClose(){},onSelected:(value:any)=>selected.push(value)})));
 const h={selected,reads,guards,async click(title:string){const button=[...dom.window.document.querySelectorAll('button')].find((row:any)=>row.textContent===title) as HTMLButtonElement;assert.ok(button,title);await act(async()=>button.click());},async settle(){settle=true;await act(async()=>response());},async invalidate(){epoch++;await render();},async lock(){disabled=true;await render();}};
 try{await render();await run(h);}finally{if(!settle)await act(async()=>response());await act(async()=>renderer.unmount());Object.assign(globalThis,{...previous,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();}
}
test('visual selection rechecks the exact current Gate choice and returns it only to the unsaved form',async()=>harness(async h=>{
 await h.click('Choose on campus');await h.click('Choose visual room');assert.equal(h.selected.length,0);assert.ok(h.guards.at(-1).blocked);
 await h.settle();assert.deepEqual(h.selected,[place]);assert.equal(h.reads.length,1);assert.match(h.reads[0],/options\/\?place_id=room-a$/);
}));
for(const change of ['invalidate','lock'])test(`a late visual choice cannot update the form after ${change}`,async()=>harness(async h=>{
 await h.click('Choose on campus');await h.click('Choose visual room');await h[change]();await h.settle();assert.equal(h.selected.length,0);
}));

test('whole-campus visual selection preflights a campus ID instead of disguising it as a place',async()=>{
 const campus={id:'campus-a',label:'Main campus',kind:'campus'};
 await harness(async h=>{await h.click('Choose on campus');await h.click('Choose visual room');await h.settle();assert.deepEqual(h.selected,[campus]);assert.match(h.reads[0],/options\/\?campus_id=campus-a$/);},campus);
});
