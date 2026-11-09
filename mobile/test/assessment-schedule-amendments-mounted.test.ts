import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as policy from '../src/lib/assessment-schedule-amendments';
import * as temporal from '../src/lib/browser-temporal';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),{createRoot}=require('react-dom/client');
const source=readFileSync(new URL('../src/features/AssessmentScheduleAmendmentScreen.tsx',import.meta.url),'utf8');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const school=id(1),assessment=id(2),sitting=id(3),firstRoom=id(4),secondRoom=id(5),staff=id(6),now='2026-11-08T00:00:00Z';
const fixture={assessment:{id:assessment,revision:2,status:'scheduled',title:'Distributed systems final',duration_minutes:60},viewer_role:'admin',results:[],
 exam_operation:{sitting:{id:sitting,state:'ready',revision:2,starts_at:'2026-11-10T09:00:00.000Z',ends_at:'2026-11-10T10:00:00.000Z'},space:{id:firstRoom,name:'Systems hall'},
 candidates:[{student_id:id(8),attendance_status:'unrecorded'}],incidents:[],invigilators:[{user_id:staff,status:'accepted'}],schedule_history:[]}};
const workspace={mode:'admin',references:{staff:[{id:staff,first_name:'Ananya',last_name:'Sen'}],spaces:[{id:firstRoom,name:'Systems hall',capacity:60},{id:secondRoom,name:'Seminar hall',capacity:50}]}};
async function harness(run:(h:any)=>Promise<void>){
 const dom=new JSDOM('<div id="root"></div>'),previous={window:globalThis.window,document:globalThis.document};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let detail=structuredClone(fixture),epoch=0,obsolete=false,retained:any=null,blocked=false,dirty=false,reviewed=0;
 const fields=new Map<string,(value:string)=>void>(),requests:any[]=[],sent:any[]=[],recovered:any[]=[];
 const View=({children}:any)=>React.createElement('div',null,children),Button=({title,onPress,disabled}:any)=>React.createElement('button',{disabled,onClick:onPress},title);
 const input=({label,value,onChangeText,onChange,editable,disabled}:any)=>{fields.set(label,onChangeText??onChange);return React.createElement('input',{'aria-label':label,value,readOnly:true,disabled:disabled||editable===false});};
 const writer={busy:false,get locked(){return obsolete||!!retained;},get action(){return retained;},get obsolete(){return obsolete;},resumeHref:null,error:'',
  run:async(value:any)=>{sent.push(value);},recover:async()=>{recovered.push(true);},reviewed(){reviewed++;obsolete=false;}};
 const dependencies:any={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{View,Text:View,Switch:({value,onValueChange,accessibilityLabel,disabled}:any)=>React.createElement('input',{type:'checkbox',checked:value,onChange:()=>onValueChange(!value),'aria-label':accessibilityLabel,disabled})},
  '@tanstack/react-query':{useQueryClient:()=>({invalidateQueries:async()=>{}})},
  '../auth/SessionProvider':{useSession:()=>({schoolId:school,user:{id:id(9)},scopeKey:'live',environment:{mode:'live',namespace_id:null,virtual_clock:{now}}})},
  '../lib/api':{getApiOrigin:()=> 'https://app2.thatcampus.com',apiFetch:async(path:string,options:any)=>{const payload=JSON.parse(options.body);requests.push({path,payload});return {
   previous:{scheduled_at:fixture.exam_operation.sitting.starts_at,ends_at:fixture.exam_operation.sitting.ends_at,space_id:firstRoom,invigilator_user_ids:[staff]},
   proposed:{...payload,ends_at:new Date(Date.parse(payload.scheduled_at)+payload.duration_minutes*60000).toISOString(),space_name:'Seminar hall'},candidate_count:1,reissued_invigilator_user_ids:[staff],removed_invigilator_user_ids:[],
   blockers:blocked?[{code:'room',message:'This room has a conflicting class.'}]:[],can_publish:!blocked,preview_hash:'a'.repeat(64),reason:payload.reason,confirmation_message:'Changed duties need a fresh acceptance.'};}},
  '../lib/query':{useApi:(path:string)=>({data:path.endsWith('workspace/')?workspace:detail,isPending:false,error:null,refetch:async()=>({data:detail})})},
  '../lib/native-pending-action':{useNativePendingAction:()=>writer},
  '../lib/use-operation-context':{useOperationContext:()=>()=>{const captured=epoch;return()=>{if(captured!==epoch)throw new Error('Account or world changed.');};}},
  '../lib/assessment-schedule-amendments':policy,
  '../lib/browser-temporal':temporal,
  '../ui/BackNavigation':{ScreenBack:()=>null,useCampusNavigation:()=>({onNavigate(){},complete(){}}),useScreenExitGuard:(value:any)=>{dirty=value.dirty;}},
  '../ui/components':{Button,Page:({title,children}:any)=>React.createElement('main',null,title,children),Section:({title,children}:any)=>React.createElement('section',null,title,children),Field:input,
   Notice:({message}:any)=>React.createElement('p',null,message),Empty:({title}:any)=>React.createElement('p',null,title),Loading:()=>null,Row:({title,detail}:any)=>React.createElement('p',null,title,detail)},
  '../ui/DomainControls':{ControlButton:Button,Disclosure:View,Facts:({items}:any)=>React.createElement('dl',null,items.map((item:any)=>React.createElement('div',{key:item.label},item.label,': ',item.value))),ChoiceMenu:input},
  '../ui/TemporalField':{TemporalField:input},'../ui/theme':{useTheme:()=>({colors:{ink:'black'}})},
 };
 const exports:any={};runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
  {exports,URL,JSON,require(name:string){assert.ok(name in dependencies,name);return dependencies[name];}});
 const renderer=createRoot(dom.window.document.getElementById('root'));
 const render=()=>act(async()=>{renderer.render(React.createElement(exports.AssessmentScheduleAmendmentScreen,{href:`/areas/assessments/manage?assessment=${assessment}&edit=schedule-amendment`,schoolId:school,assessmentId:assessment}));});
 const button=(title:string)=>[...dom.window.document.querySelectorAll('button')].find((value:any)=>value.textContent===title) as HTMLButtonElement;
 const h={sent,requests,recovered,text:()=>dom.window.document.body.textContent??'',dirty:()=>dirty,reviewed:()=>reviewed,
  input:async(label:string,value:string)=>act(async()=>{assert.ok(fields.has(label),label);fields.get(label)!(value);}),
  click:async(title:string)=>act(async()=>{assert.ok(button(title),title);button(title).click();}),disabled:(title:string)=>button(title).disabled,
  block(){blocked=true;},async changeSource(){detail={...detail,assessment:{...detail.assessment,revision:3},exam_operation:{...detail.exam_operation,sitting:{...detail.exam_operation.sitting,revision:3}}};await render();},
  async refuse(){obsolete=true;await render();},async retain(){retained={phase:'unknown'};await render();},async rerender(){await render();},invalidate(){epoch++;},
 };
 try{await render();await run(h);}finally{await act(async()=>renderer.unmount());Object.assign(globalThis,{...previous,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();}
}
async function edit(h:any){await h.input('New date and time · UTC','2026-11-10T11:00:00.000Z');await h.input('Duration in minutes','90');await h.input('Room or hall',secondRoom);await h.input('Reason for changing the published schedule','Original hall closed for repairs.');}
test('mounted schedule editor requires an impact review before dispatching the exact revised time and room',async()=>harness(async h=>{
 assert.match(h.text(), /9:00.*UTC/i);await edit(h);assert.equal(h.dirty(),true);assert.equal(h.sent.length,0);await h.click('Review schedule impact');
 assert.match(h.text(),/Review the schedule revision.*Candidates retained: 1.*Duties needing confirmation: 1/s);assert.equal(h.sent.length,0);
 await h.click('Publish revised arrangements');assert.equal(h.sent.length,1);assert.equal(h.sent[0].body.scheduled_at,'2026-11-10T11:00:00.000Z');assert.equal(h.sent[0].body.space_id,secondRoom);assert.equal(h.sent[0].body.preview_hash,'a'.repeat(64));
}));
test('mounted review shows a conflict and cannot publish while the source denies readiness',async()=>harness(async h=>{
 await edit(h);h.block();await h.click('Review schedule impact');assert.match(h.text(),/This room has a conflicting class/);assert.equal(h.disabled('Publish revised arrangements'),true);
 await h.click('Publish revised arrangements');assert.equal(h.sent.length,0);
}));
test('mounted stale review requires an explicit saved-source read before a new review',async()=>harness(async h=>{
 await edit(h);await h.click('Review schedule impact');await h.changeSource();assert.equal(h.disabled('Publish revised arrangements'),true);
 await h.click('Review saved arrangements');await h.rerender();assert.equal(h.reviewed(),1);assert.equal(h.sent.length,0);assert.match(h.text(),/Review schedule impact/);
}));
test('mounted durable refusal offers review/refetch and never silently starts another command',async()=>harness(async h=>{
 await h.refuse();assert.equal(h.disabled('Review schedule impact'),true);await h.click('Review saved arrangements');await h.rerender();
 assert.equal(h.reviewed(),1);assert.equal(h.disabled('Review schedule impact'),false);assert.equal(h.sent.length,0);
 await h.retain();assert.equal(h.disabled('Review schedule impact'),true);await h.click('Recover original schedule command');assert.equal(h.recovered.length,1);assert.equal(h.sent.length,0);
}));
