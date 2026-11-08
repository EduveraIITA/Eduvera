import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),{createRoot}=require('react-dom/client');
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={term_id:id(1),subject_id:id(2),course_code:'CS501',credits:4,programme_key:null,term_name:'Semester I',academic_year:'2026-27',starts_on:'2026-07-01',ends_on:'2026-12-31',subject_name:'Distributed systems',color:'#123456',icon:'learning'};
async function harness(run:(h:any)=>Promise<void>) {
  const dom=new JSDOM('<div id="root"></div>'),previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let scopeVersion=0;const reviewed:any[]=[];
  let props:any={href:`/areas/messages/assignments?scope=offering&offering_id=${id(3)}&course_setup=1`,onNavigate(){},data:{id:id(3),name:'Distributed systems',revision:3,can_manage:true,academic_context:null},references:{terms:[{id:id(1),name:'Semester I',academic_year:'2026-27',starts_on:context.starts_on,ends_on:context.ends_on}],subjects:[{id:id(2),name:'Distributed systems',code:'CS501'}]},loading:false,onRetry:async()=>props.data};
  const fields=new Map<string,any>(),sent:any[]=[],guards:any[]=[],writer:any={ready:true,locked:false,busy:false,action:null,error:'',obsolete:false,reviewed(){reviewed.push(true);writer.obsolete=false;writer.locked=false;},run:async(input:any)=>{sent.push(input);},recover:async()=>true};
  const wrap=({children}:any)=>React.createElement('section',null,children),button=({title,onPress,disabled}:any)=>React.createElement('button',{onClick:onPress,disabled},title);
  const deps:any={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'@tanstack/react-query':{useQueryClient:()=>({invalidateQueries:async()=>{},setQueryData(){}})},'../auth/SessionProvider':{useSession:()=>({scopeKey:`current-${scopeVersion}`})},'../lib/use-operation-context':{useOperationContext:()=>()=>{const captured=scopeVersion;return()=>assert.equal(scopeVersion,captured,'The account, campus, world or source changed.');}},'../lib/learning-academic-context':require('../src/lib/learning-academic-context'),'../lib/learning-offering-policy':require('../src/lib/learning-offering-policy'),'../lib/learning-write':{useLearningCommand:()=>writer},'../ui/BackNavigation':{ScreenBack:()=>null,useScreenExitGuard:(value:any)=>guards.push(value)},'../ui/components':{Button:button,Empty:({title}:any)=>React.createElement('p',null,title),Field:(value:any)=>{fields.set(value.label,value);return React.createElement('label',null,value.label,React.createElement('input',{value:value.value,disabled:value.editable===false,readOnly:true}));},Loading:()=>React.createElement('p',null,'Loading'),Notice:({message}:any)=>React.createElement('p',null,message),Page:wrap},'../ui/DomainControls':{ChoiceMenu:(value:any)=>{fields.set(value.label,value);return React.createElement('label',null,value.label,React.createElement('select',{value:value.value,disabled:value.disabled,onChange:(event:any)=>value.onChange(event.target.value)},React.createElement('option',{value:''},'Choose'),...value.options.map((item:any)=>React.createElement('option',{key:item.value,value:item.value},item.label))));},ControlButton:button,Facts:({items}:any)=>React.createElement('dl',null,items.map((item:any)=>React.createElement('div',{key:item.label},item.label,': ',item.value)))}};
  const exports:any={};runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/LearningCourseContext.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
  const root=createRoot(dom.window.document.getElementById('root')),render=()=>act(async()=>root.render(React.createElement(exports.LearningCourseContext,props)));
  const h={sent,writer,fields,reviewed,changeScope(){scopeVersion++;},text:()=>dom.window.document.body.textContent ?? '',guard:()=>guards.at(-1),props:()=>props,async update(patch:any){props={...props,...patch};await render();},async field(label:string,value:string){await act(async()=>{const field=fields.get(label);assert.ok(field,label);(field.onChangeText ?? field.onChange)(value);});},async click(title:string){const node=[...dom.window.document.querySelectorAll('button')].find((item:any)=>item.textContent===title) as HTMLButtonElement|undefined;assert.ok(node,title);await act(async()=>node.click());},disabled(title:string){return [...dom.window.document.querySelectorAll('button')].find((item:any)=>item.textContent===title)?.hasAttribute('disabled');}};
  try{await render();await run(h);}finally{await act(async()=>root.unmount());Object.assign(globalThis,{...previous,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();}
}
test('mounted course editor reuses term/subject, reviews normalized input and sends only after explicit confirmation',async()=>harness(async h=>{
  await h.field('Term',id(1));await h.field('Subject',id(2));assert.equal(h.fields.get('Course code').value,'CS501');await h.field('Credits','4.25');await h.field('Programme · optional',' mtech-cs ');assert.equal(h.guard().dirty,true);assert.equal(h.sent.length,0);
  await h.click('Review course details');assert.match(h.text(),/MTECH-CS/);assert.match(h.text(),/Semester I/);assert.equal(h.sent.length,0);await h.click('Save course details');assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].endpoint,`/api/v1/learning/offerings/${id(3)}/academic-context/`);assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].body)),{expected_revision:3,academic_context:{term_id:id(1),subject_id:id(2),course_code:'CS501',credits:4.25,programme_key:'MTECH-CS'}});assert.equal('class_section_id' in h.sent[0].body,false);
}));
test('mounted source refresh preserves unsent choices and pauses stale or failed current authority',async()=>harness(async h=>{
  await h.field('Course code','My unsent code');const original=h.props();await h.update({error:'Source unavailable'});assert.equal(h.fields.get('Course code').value,'My unsent code');assert.equal(h.disabled('Review course details'),true);
  await h.update({error:undefined,data:{...original.data,revision:4,academic_context:context}});assert.equal(h.fields.get('Course code').value,'My unsent code');assert.equal(h.disabled('Review course details'),true);assert.equal(h.sent.length,0);
  await h.click('Review current details');assert.equal(h.fields.get('Course code').value,'CS501');assert.equal(h.disabled('Review course details'),false);
}));
test('mounted retained course command cannot be replaced by changed current fields or another save',async()=>harness(async h=>{
  h.writer.action={ownerHref:h.props().href,payload:{kind:'json',body:JSON.stringify({expected_revision:2,academic_context:context})},phase:'unknown'};h.writer.locked=true;await h.update({data:{...h.props().data,revision:5,academic_context:{...context,course_code:'CS999'}}});
  assert.match(h.text(),/reviewed course details are retained/);assert.equal(h.disabled('Review course details'),undefined);assert.equal(h.sent.length,0);await h.click('Retry identical course setup');assert.equal(h.sent.length,0);
}));

test('mounted course fresh-review refuses failed, foreign and changed-scope reads without unlocking or replacing unsent input',async()=>harness(async h=>{
  await h.field('Course code','Unsent course code');await h.field('Credits','3.5');
  h.writer.obsolete=true;h.writer.locked=true;await h.update({});
  const original=h.props().data;
  for(const mode of ['failed','foreign','scope']as const){
    await h.update({onRetry:async()=>{if(mode==='failed')throw new Error('Current source unavailable');if(mode==='scope')h.changeScope();return {...original,id:mode==='foreign'?id(99):original.id,revision:4,academic_context:context};}});
    await h.click('Review current details');
    assert.equal(h.reviewed.length,0,mode);assert.equal(h.fields.get('Course code').value,'Unsent course code',mode);assert.equal(h.fields.get('Credits').value,'3.5',mode);assert.equal(h.disabled('Review course details'),true,mode);assert.equal(h.sent.length,0,mode);
  }
  const fresh={...original,revision:4,academic_context:context};await h.update({data:fresh,onRetry:async()=>fresh});await h.click('Review current details');
  assert.equal(h.reviewed.length,1);assert.equal(h.fields.get('Course code').value,'CS501');assert.equal(h.disabled('Review course details'),false);assert.equal(h.sent.length,0);
}));
