import * as resultReview from '../src/lib/assessment-result-review';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import type { AcademicReportWorkspace, GradingSchemeDetail, ReportBatchDetail, ResultPolicySnapshot, OwnReportCards } from '../../packages/contracts/src/academic-reports';
import * as policy from '../src/lib/academic-report-policy';
import * as context from '../src/lib/academic-report-context';
import * as commands from '../src/lib/academic-report-command';
import * as presentation from '../../packages/contracts/src/result-presentation';
import * as attention from '../src/lib/report-attention';
import * as temporal from '../src/lib/browser-temporal';
import { createChunkedNativePendingStorage } from '../src/lib/native-pending-action';

const require=createRequire(import.meta.url),id=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const term=id(1),subject=id(2),courseA=id(3),courseB=id(4),schemeId=id(5),batchId=id(6),personId=id(7),rowId=id(8),assessmentA=id(9),assessmentB=id(10),campus=id(11);
const snapshot:ResultPolicySnapshot={policy_id:id(12),name:'Institute GPA',code:'GPA',version:1,semantic_fingerprint:'retained-policy',configuration:{schema_version:1,result_format:'gpa',grade_point_scale:10,decimal_places:2,aggregation:'credit_weighted',absence_treatment:'incomplete',exemption_treatment:'exclude',gpa_failure_treatment:'include',bands:[{code:'F',label:'Below pass',minimum_percentage:0,maximum_percentage:39.99,grade_points:0,passed:false},{code:'P',label:'Pass',minimum_percentage:40,maximum_percentage:100,grade_points:10,passed:true}]}};
const offering=(value:string,name:string,code:string,credits:number)=>({id:value,name,revision:1,learner_count:2,academic_context:{term_id:term,subject_id:subject,course_code:code,credits,programme_key:'MTECH',term_name:'Semester I',academic_year:'2026-27',starts_on:'2026-07-01',ends_on:'2026-12-31',subject_name:'Computing',color:'#447755',icon:'book'}});
const offerings=[offering(courseA,'Data systems','CS501',4),offering(courseB,'Research methods','CS502',2)];
const summary={id:schemeId,term_id:term,class_section_id:null,context_kind:'learning_offering' as const,offering_ids:[courseA,courseB],name:'Semester I progress',code:'SEM1',status:'draft' as const,absence_treatment:'incomplete' as const,review_mode:'independent' as const,revision:1,term_name:'Semester I',academic_year:'2026-27',class_name:'Data systems + Research methods',subject_count:0,report_count:0,grading_policy_id:snapshot.policy_id,result_policy:snapshot,programme_key:'MTECH',term_index:1};
const workspace:Extract<AcademicReportWorkspace,{mode:'admin'}>={mode:'admin',schemes:[summary],batches:[],policies:[{id:snapshot.policy_id,name:snapshot.name,code:snapshot.code,version:1,status:'active',revision:2,configuration:snapshot.configuration}],references:{offerings,terms:[{id:term,name:'Semester I',academic_year:'2026-27',starts_on:'2026-07-01',ends_on:'2026-12-31'}],classes:[{id:id(13),name:'Section A',academic_year:'2026-27'}],subjects:[{id:subject,name:'Computing',color:'#447755',icon:'book'}],assessments:[{id:assessmentA,title:'Data systems final',subject_id:subject,class_section_id:null,context_kind:'learning_offering',offering_id:courseA,term_id:term,maximum_marks:'100',publication_sequence:1},{id:assessmentB,title:'Research final',subject_id:subject,class_section_id:null,context_kind:'learning_offering',offering_id:courseB,term_id:term,maximum_marks:'100',publication_sequence:1}]}};
const detail:GradingSchemeDetail={scheme:summary,bands:[],subjects:[],components:[]};
const batch:ReportBatchDetail={batch:{id:batchId,scheme_id:schemeId,scheme_name:summary.name,class_name:summary.class_name,term_name:'Semester I',review_mode:'independent',sequence:1,status:'draft',revision:1,correction_reason:'',generated_at:'2026-11-01T10:00:00Z',published_at:null,learner_count:1,incomplete_count:0,result_policy:snapshot,programme_key:'MTECH',term_index:1,class_section_id:null,context_kind:'learning_offering',offering_ids:[courseA,courseB],academic_year:'2026-27',review_note:'',publication_note:''},students:[{id:rowId,student_id:null,learner_id:personId,person_id:personId,first_name:'Anaya',last_name:'Rao',admission_number:null,roll_number:null,outcome:'complete',overall_percentage:'80',overall_grade:'P',gpa:'10',class_teacher_comment:'',principal_comment:'',comment_revision:1}],subjects:[],components:[]};

type Input={value:string;disabled?:boolean;editable?:boolean;onChange?(value:string):void;onChangeText?(value:string):void;options?:Array<{value:string;label:string}>};
type Button={title:string;disabled?:boolean;busy?:boolean;onPress():unknown};
function load(file:string,dependencies:Record<string,unknown>,internal?:string){
  const source=readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:Record<string,unknown>={};runInNewContext(code+(internal?`\nexports.TestComponent=${internal};`:''),{exports,URL,URLSearchParams,Error,require(name:string){if(!(name in dependencies))throw new Error(`Unexpected report dependency ${name}`);return dependencies[name];}});return exports;
}
async function mounted(file:string,name:string,initial:Record<string,unknown>,dependencies:Record<string,unknown>,work:(h:{fill(label:string,value:string):Promise<void>;choose(label:string,value:string):Promise<void>;press(title:string):Promise<void>;button(title:string):Button|undefined;choice(label:string):Input|undefined;text():string;render(patch:Record<string,unknown>):Promise<void>;document:Document})=>Promise<void>,internal?:string,override?:React.ComponentType<Record<string,unknown>>){
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>');const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const inputs=new Map<string,Input>(),choices=new Map<string,Input>(),buttons=new Map<string,Button>();
  const Box=({children,title}:React.PropsWithChildren<{title?:string}>)=>React.createElement('div',null,title?React.createElement('h3',null,title):null,children);
  const Field=({label,...props}:Input&{label:string})=>{inputs.set(label,props);return React.createElement('input',{'data-field':label,'aria-label':label,value:props.value,readOnly:true,disabled:props.editable===false});};
  const Choice=({label,...props}:Input&{label:string})=>{choices.set(label,props);return React.createElement('select',{'data-choice':label,'aria-label':label,value:props.value,disabled:props.disabled,onChange(){ }},props.options?.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)));};
  const Control=(props:Button)=>{buttons.set(props.title,props);return React.createElement('button',{'data-button':props.title,disabled:props.disabled||props.busy,onClick:props.onPress},props.title);};
  const Row=({title,detail,onPress}: {title:string;detail?:string;onPress?():void})=>onPress?React.createElement(Control,{title,onPress}):React.createElement('p',null,title,' ',detail);
  const ui={Field,Notice:({message}:{message:string})=>React.createElement('p',null,message),Row,Section:Box,Page:Box,Empty:({title,message}:{title:string;message?:string})=>React.createElement('p',null,title,' ',message),Loading:()=>React.createElement('p',null,'Loading'),SearchField:Field};
  const controls={ChoiceMenu:Choice,SegmentedControl:Choice,ControlButton:Control,Disclosure:Box,InfoDisclosure:Box,Facts:({items}:{items:Array<{label:string;value:unknown}>})=>React.createElement('div',null,items.map((item,index)=>React.createElement('p',{key:index},`${item.label}: ${String(item.value)}`)))};
  const deps={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{View:Box,Text:Box,Switch:()=>null},'../../lib/academic-report-policy':policy,'../../lib/academic-report-context':context,'../../ui/components':ui,'../../ui/DomainControls':controls,'../ui/components':ui,'../ui/DomainControls':controls,'../lib/browser-temporal':temporal,...dependencies};
  const Component=override??load(file,deps,internal)[name] as React.ComponentType<Record<string,unknown>>,{createRoot}=require('react-dom/client'),root=createRoot(dom.window.document.getElementById('root'));let props=initial;
  const render=async(patch:Record<string,unknown>)=>{props={...props,...patch};await act(async()=>root.render(React.createElement(Component,props)));};
  const present=(attribute:string,label:string)=>[...dom.window.document.querySelectorAll(`[${attribute}]`)].some((node:any)=>node.getAttribute(attribute)===label);
  try{await render({});await work({document:dom.window.document,fill:async(label,value)=>{assert.ok(present('data-field',label),label);await act(async()=>inputs.get(label)!.onChangeText!(value));},choose:async(label,value)=>{assert.ok(present('data-choice',label),label);const input=choices.get(label)!;assert.equal(!!input.disabled,false,label);assert.ok(input.options?.some(option=>option.value===value),value);await act(async()=>input.onChange!(value));},press:async title=>{assert.ok(present('data-button',title),title);const button=buttons.get(title)!;assert.equal(!!(button.disabled||button.busy),false,title);await act(async()=>{await button.onPress();});},button:title=>present('data-button',title)?buttons.get(title):undefined,choice:label=>present('data-choice',label)?choices.get(label):undefined,text:()=>dom.window.document.body.textContent??'',render});}
  finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,previous);}
}
const writer=(run:(input:unknown)=>Promise<unknown>)=>({locked:false,busy:false,run});
const forms='src/features/reports/AcademicReportForms.tsx',href='/areas/reports/remarks?create=scheme',root=`/api/v1/schools/${campus}/academic-reports`;

test('course report reads retain exact audience and canonical person identity without a student projection',()=>{
  assert.equal(policy.reportWorkspaceMatches(workspace),true);assert.equal(policy.reportSchemeMatches(detail,schemeId,workspace),true);
  const source={...workspace,batches:[batch.batch]};assert.equal(policy.reportBatchMatches(batch,batchId,source),true);
  assert.equal(context.reportLearnerCommentEndpoint(root,batch.batch,batch.students[0]!),`${root}/batches/${batchId}/learners/${personId}/comments/`);
  const missing={...batch.students[0]!};delete missing.learner_id;
  assert.equal(policy.reportBatchMatches({...batch,students:[missing]},batchId,source),false);
  assert.equal(policy.reportSchemeMatches({...detail,scheme:{...summary,offering_ids:[courseA]}},schemeId,workspace),false);
  const input={offeringId:courseA,subjectId:subject,credits:4,courseCode:'CS501',components:[{code:'FINAL',name:'Final',weight_percentage:100,assessment_ids:[assessmentA]}]};
  assert.equal(policy.subjectPlanError(input,detail,workspace),null);assert.ok(policy.subjectPlanError({...input,credits:2},detail,workspace));assert.ok(policy.subjectPlanError({...input,components:[{...input.components[0]!,assessment_ids:[assessmentB]}]},detail,workspace));
});
test('mounted scheme creation reviews multiple explicit courses and blocks a source change after review',async()=>{
  const sent:any[]=[];await mounted(forms,'ReportSchemeForm',{root,href,writer:writer(async input=>{sent.push(input);}),data:workspace,onDirtyChange(){}},{},async h=>{
    await h.choose('Report audience','learning_offering');await h.choose('Term',term);await h.choose('Add course offering',courseA);await h.choose('Add course offering',courseB);
    await h.fill('Scheme name','Semester I progress');await h.fill('Scheme code','SEM1');await h.choose('Grading policy',snapshot.policy_id);await h.fill('Programme key','MTECH');await h.fill('Term number','1');await h.press('Review scheme');
    assert.match(h.text(),/2 course offerings/);assert.match(h.text(),/CS501/);assert.match(h.text(),/CS502/);
    await h.render({data:{...workspace,references:{...workspace.references,offerings:[{...offerings[0]!,revision:2},offerings[1]!]}}});assert.equal(h.button('Create draft scheme')?.disabled,true);assert.equal(sent.length,0);
    await h.press('Edit details');await h.press('Review scheme');await h.press('Create draft scheme');
    assert.deepEqual(Array.from(sent[0].body.offering_ids),[courseA,courseB]);assert.equal(sent[0].body.class_section_id,null);assert.equal(sent[0].body.context_kind,'learning_offering');assert.equal(sent[0].body.review_mode,'independent');
  });
});
test('mounted course plan derives immutable course metadata and never offers another course publication',async()=>{
  const sent:any[]=[];await mounted(forms,'ReportSubjectForm',{root,href,writer:writer(async input=>{sent.push(input);}),data:workspace,detail,onDirtyChange(){}},{},async h=>{
    await h.choose('Course offering',courseA);assert.match(h.text(),/Credits: 4/);assert.equal(h.choice('Subject'),undefined);
    assert.deepEqual(Array.from(h.choice('Add published assessment to component 1')!.options!,item=>item.value),['',assessmentA]);
    await h.choose('Add published assessment to component 1',assessmentA);await h.choose('Course offering',courseB);assert.doesNotMatch(h.text(),/Remove assessment Data systems final/);
    await h.choose('Add published assessment to component 1',assessmentB);await h.press('Review subject plan');await h.press('Save subject plan');
    assert.equal(sent[0].body.offering_id,courseB);assert.equal(sent[0].body.subject_id,subject);assert.equal(sent[0].body.course_code,'CS502');assert.equal(sent[0].body.credits,2);assert.deepEqual(Array.from(sent[0].body.components[0].assessment_ids),[assessmentB]);
  });
});
test('generic report command receipts bind selected offerings and canonical learner remarks, retaining unknown outcomes',async()=>{
  const scope={actorId:'actor',schoolId:campus,mode:'live' as const,namespaceId:null,origin:'https://campus.example'},key=id(30),body={name:'Semester I progress',code:'SEM1',context_kind:'learning_offering',class_section_id:null,term_id:term,offering_ids:[courseA,courseB],grading_policy_id:snapshot.policy_id,review_mode:'independent',absence_treatment:'incomplete',programme_key:'MTECH',term_index:1,idempotency_key:key};
  const command:commands.ReportCommand={version:1,scope,key,ownerHref:href,endpoint:`${root}/schemes/`,method:'POST',body:JSON.stringify(body),phase:'unknown'};
  const receipt={...body,id:schemeId,revision:1,status:'draft'};assert.equal(commands.reportCommandResultMatches(command,receipt),true);assert.equal(commands.reportCommandResultMatches(command,{...receipt,offering_ids:[courseA]}),false);assert.equal(commands.reportCommandResultMatches(command,{...receipt,class_section_id:id(13)}),false);
  let saved:string|null=null,sends=0;const journal=new commands.AcademicReportJournal({scope,storage:{read:async()=>saved,write:async value=>{saved=value;},clear:async()=>{saved=null;}},randomId:()=>key,capture:()=>({assertCurrent(){}}),send:async()=>{sends++;throw new Error('Unknown response');},refresh:async()=>{}});await journal.hydrate();
  const endpoint=context.reportLearnerCommentEndpoint(root,batch.batch,batch.students[0]!)!;await journal.run({ownerHref:href,endpoint,method:'PUT',body:{expected_revision:1,expected_batch_revision:1,class_teacher_comment:'Reviewed course progress',principal_comment:''}});
  assert.equal(sends,1);assert.equal(journal.snapshot().pending?.endpoint,endpoint);assert.equal(journal.snapshot().pending?.phase,'unknown');assert.match(saved!,/Reviewed course progress/);
  const retained=journal.snapshot().pending!,comment={id:rowId,student_id:null,learner_id:personId,comment_revision:2,batch_revision:2,class_teacher_comment:'Reviewed course progress',principal_comment:''};assert.equal(commands.reportCommandResultMatches(retained,comment),true);assert.equal(commands.reportCommandResultMatches(retained,{...comment,learner_id:id(31)}),false);
  const resumed=new commands.AcademicReportJournal({scope,storage:{read:async()=>saved,write:async value=>{saved=value;},clear:async()=>{saved=null;}},randomId:()=>id(99),capture:()=>({assertCurrent(){}}),send:async command=>{assert.equal(command.key,retained.key);assert.equal(command.body,retained.body);return comment;},refresh:async()=>{
    const source={...workspace,batches:[batch.batch]};assert.equal(policy.reportWorkspaceMatches(source),true);assert.equal(policy.reportBatchMatches({...batch,batch:{...batch.batch,revision:2},students:[{...batch.students[0]!,class_teacher_comment:comment.class_teacher_comment,comment_revision:2}]},batchId,source),true);
  }});await resumed.hydrate();assert.equal(await resumed.recover(href),true);assert.equal(saved,null);
  const plan:commands.ReportCommand={...command,endpoint:`${root}/schemes/${schemeId}/subjects/`,method:'PUT',body:JSON.stringify({idempotency_key:key,expected_revision:1,offering_id:courseA,subject_id:subject,course_code:'CS501',credits:4})};
  const planReceipt={id:schemeId,revision:2,status:'draft',offering_id:courseA,subject_id:subject,course_code:'CS501',credits:'4.0000'};assert.equal(commands.reportCommandResultMatches(plan,planReceipt),true);assert.equal(commands.reportCommandResultMatches(plan,{...planReceipt,offering_id:courseB}),false);assert.equal(commands.reportCommandResultMatches(plan,{...planReceipt,credits:'2'}),false);
});

function screenDependencies(extra:Record<string,unknown>={}) {
  const Empty=()=>null;
  return {'../ui/icon-semantics':{},'../lib/use-operation-context':{},'../ui/BackNavigation':{ScreenBack:Empty,useScreenExitGuard(){},useCampusNavigation:()=>({})},'../ui/Alert':{Alert:{alert(){}}},'../../../packages/contracts/src/workspace-normalizer':{},'../../../packages/contracts/src/result-presentation':presentation,'../auth/SessionProvider':{},'../lib/api':{},'../lib/native-pending-action':{},'../lib/query':{},'../lib/academic-report-policy':policy,'../lib/academic-report-context':context,'../lib/academic-report-command':commands,'../lib/report-attention':attention,'../lib/use-report-attention':{useReportAttention(){}},'../ui/theme':{},'./reports/PrintMarksheetControls':{},'./reports/AcademicReportForms':{PolicyDetails:Empty},'./reports/useAcademicReportCommand':{},'./ResourcesScreen':{DomainPages:Empty},'./AssessmentsScreen':{},'./AssessmentScheduleAmendmentScreen':{},'../lib/assessment-schedule-amendments':{},'../lib/assessment-authoring':{},'./AssessmentAuthoringScreen':{},'./AssessmentExamDayScreen':{},'./AssessmentEvidenceScreen':{},'../lib/assessment-operations':{},'./assessments/AssessmentViews':{AssessmentPages:Empty},...extra};
}
test('mounted release remarks save the canonical learner endpoint and retain entered text while a writer is blocked',async()=>{
  const sent:any[]=[],save=writer(async input=>{sent.push(input);});
  await mounted('src/features/ReportsScreen.tsx','TestComponent',{detail:batch,root,href,writer:save,disabled:false,canCoordinate:true,receipt:null,onDirtyChange(){}},screenDependencies(),async h=>{
    await h.fill('Course remark','Reviewed course progress');await h.fill('Institution remark','Continue research');await h.press('Save remarks');
    assert.equal(sent.length,1);assert.equal(sent[0].endpoint,`${root}/batches/${batchId}/learners/${personId}/comments/`);assert.equal(sent[0].body.expected_revision,1);assert.equal(sent[0].body.expected_batch_revision,1);
    await h.render({writer:{...save,locked:true}});assert.equal(h.button('Save remarks')?.disabled,true);assert.equal((h.document.querySelector('[data-field="Course remark"]') as HTMLInputElement).value,'Reviewed course progress');
    assert.match(h.text(),/Admission: Not recorded/);assert.ok(!sent[0].endpoint.includes('/students/'));
  },'ReportBatch');
});
test('mounted multi-course scheme cannot activate while a selected course has no grading plan',async()=>{
  const plan=(value:number,offeringId:string,code:string)=>({id:id(value),subject_id:subject,offering_id:offeringId,subject_name:'Computing',color:'#447755',icon:'book',pass_percentage:null,display_order:value,credits:'4',course_code:code});
  const first=plan(40,courseA,'CS501'),second=plan(41,courseB,'CS502');
  await mounted('src/features/ReportsScreen.tsx','TestComponent',{detail:{...detail,subjects:[first]},reportCount:0,root,href,writer:writer(async()=>{}),disabled:false,onAddSubject(){},onDirtyChange(){}},screenDependencies(),async h=>{
    assert.match(h.text(),/1 of 2 selected courses/);assert.equal(h.button('Activate grading scheme')?.disabled,true);
    await h.render({detail:{...detail,subjects:[first,second]}});assert.match(h.text(),/2 of 2 selected courses/);assert.equal(h.button('Activate grading scheme')?.disabled,false);assert.match(h.text(),/CS501/);assert.match(h.text(),/CS502/);
  },'ReportScheme');
});
test('mounted canonical own cards use both mine readers, open the exact report and print with a person target',async()=>{
  const learner={learner_id:personId,person_id:personId,student_id:null,first_name:'Anaya',last_name:'Rao',admission_number:null};
  const report:OwnReportCards['reports'][number]={report_student_id:rowId,batch_id:batchId,sequence:1,published_at:'2026-11-02T10:00:00Z',correction_reason:'',scheme_id:schemeId,scheme_name:summary.name,term_name:'Semester I',academic_year:'2026-27',class_name:null,outcome:'complete',overall_percentage:'80',overall_grade:'P',gpa:'10.0000',cgpa:'10.0000',result_policy:snapshot,class_teacher_comment:'Reviewed course progress',principal_comment:'',subjects:[{id:id(20),subject_name:'Computing',color:'#447755',icon:'book',outcome:'complete',percentage:'80',grade:'P',passed:true,grade_points:'10.0000',credits:'4.0000',course_code:'CS501',assessment_ids:[assessmentA]}]};
  const ownReports:OwnReportCards={learner,reports:[report]},ownResults={learner,results:[]},paths:string[]=[],navigated:string[]=[];
  let reportResponse=ownReports;
  const initialHref=`/areas/reports/progress?scope=mine&person_id=${personId}`;
  const deps=screenDependencies({'../auth/SessionProvider':{useSession:()=>({user:{id:personId}})},'../lib/assessment-result-review':resultReview,'./assessments/ResultReviews':{LearnerResultReview:()=>{throw new Error('A term report must not open an assessment review');},StaffResultReviews:()=>null},'../lib/query':{useApi:(path:string|null)=>{if(path)paths.push(path);return {data:path?.includes('/academic-reports/')?reportResponse:ownResults,isPending:false,isError:false,isRefetching:false,dataUpdatedAt:1,refetch:async()=>{}};}},'./reports/PrintMarksheetControls':{PrintMarksheetControls:(props:{personId?:string;studentId?:string})=>React.createElement('p',{'data-print-person':props.personId},props.personId&&!props.studentId?'Person-bound print':props.studentId&&!props.personId?'Student-bound print':'Wrong print target')},'./assessments/AssessmentViews':{AssessmentPages:()=>null,PublishedResultSummary:({value}:{value:string})=>React.createElement('p',null,`Published result ${value}`),PublishedResultRow:({title,onPress}:{title:string;onPress():void})=>React.createElement('button',{'data-button':title,onClick:onPress},title)}});
  // PublishedResultRow uses the same ControlButton testing map through an adapter.
  const Row=deps['./assessments/AssessmentViews'] as Record<string,unknown>;
  Row.PublishedResultRow=({title,onPress}:{title:string;onPress():void})=>React.createElement('button',{onClick:()=>{onPress();}},title);
  await mounted('src/features/AssessmentsScreen.tsx','NativeFamilyResults',{href:initialHref,onNavigate:(next:string)=>navigated.push(next),schoolId:campus,personId,label:'My progress',owningArea:'reports'},deps,async h=>{
    assert.ok(paths.some(path=>path.endsWith(`/academic-reports/mine/?person_id=${personId}`)));assert.ok(paths.some(path=>path.endsWith(`/assessments/mine/?person_id=${personId}`)));assert.ok(paths.every(path=>!path.includes('/family/')));
    const button=[...h.document.querySelectorAll('button')].find(item=>item.textContent===summary.name)!;assert.ok(button);await act(async()=>button.click());
    assert.match(navigated[0]!,new RegExp(`report_batch_id=${batchId}`));await h.render({href:navigated[0]});assert.match(h.text(),/Person-bound print/);assert.equal(h.document.querySelector('[data-print-person]')?.getAttribute('data-print-person'),personId);
    assert.match(h.text(),/CGPA: 10\.00(?:Subjects|$|\s)/);assert.match(h.text(),/10\.00 grade points · 4 credits/);assert.doesNotMatch(h.text(),/10\.0000|4\.0000/);
    const original=JSON.stringify(report);reportResponse={...ownReports,reports:[{...report,gpa:'0.0000',cgpa:'0.0000',subjects:[{...report.subjects[0]!,grade_points:'0.0000',credits:'4.2500'}]}]};await h.render({});assert.match(h.text(),/Published result 0\.00/);assert.match(h.text(),/CGPA: 0\.00/);assert.match(h.text(),/0\.00 grade points · 4\.25 credits/);
    reportResponse={...ownReports,reports:[{...report,result_policy:{...snapshot,configuration:{...snapshot.configuration,bands:snapshot.configuration.bands.map(band=>({...band,grade_points:band.passed?9.995:0}))}},subjects:[{...report.subjects[0]!,grade_points:'9.9950'}]}]};await h.render({});assert.match(h.text(),/Published result 10\.00/);assert.match(h.text(),/10\.00 grade points/);assert.doesNotMatch(h.text(),/9\.99 grade points/);
    reportResponse={...ownReports,reports:[{...report,gpa:null,cgpa:null,subjects:[{...report.subjects[0]!,grade_points:null,credits:null}]}]};await h.render({});assert.doesNotMatch(h.text(),/CGPA:|0\.00 grade points|0 credits/);assert.equal(JSON.stringify(report),original);
    reportResponse={...ownReports,learner:{...learner,person_id:id(99)}};await h.render({});assert.match(h.text(),/This published result is unavailable/);assert.doesNotMatch(h.text(),/Person-bound print/);
  });
  // Existing typed-student readers keep their real family envelope. Nullable
  // public course context never needs a substitute class or student identity.
  const studentId=id(32),student={id:studentId,first_name:'Anaya',last_name:'Rao',admission_number:'M26-CS-014',class_name:'Section A'},legacyPaths:string[]=[];
  const legacyDeps={...deps,'../lib/query':{useApi:(path:string)=>{legacyPaths.push(path);return {data:path.includes('/academic-reports/')?{student,reports:[report]}:{student,results:[]},isPending:false,isError:false,isRefetching:false,dataUpdatedAt:1,refetch:async()=>{}};}}};
  await mounted('src/features/AssessmentsScreen.tsx','NativeFamilyResults',{href:`/areas/reports/progress?scope=self&student_id=${studentId}&report_batch_id=${batchId}`,onNavigate(){},schoolId:campus,studentId,label:'My progress',owningArea:'reports'},legacyDeps,async h=>{
    assert.ok(legacyPaths.every(path=>path.includes(`/family/?student_id=${studentId}`)));assert.match(h.text(),/Student-bound print/);assert.match(h.text(),/Published result 10/);assert.doesNotMatch(h.text(),/This published result is unavailable/);
  });
});
test('actual report writer opts into canonical workspace readback before clearing an accepted course command',async()=>{
  const values=new Map<string,string>(),reads:string[]=[];let accepted=0;
  const body={name:summary.name,code:summary.code,context_kind:'learning_offering',class_section_id:null,offering_ids:[courseA,courseB],term_id:term,grading_policy_id:snapshot.policy_id,review_mode:'independent',absence_treatment:'incomplete',programme_key:'MTECH',term_index:1};
  const hook=load('src/features/reports/useAcademicReportCommand.ts',{
    react:React,'../../auth/SessionProvider':{useSession:()=>({user:{id:'actor'},schoolId:campus,environment:{mode:'live'}})},
    '../../lib/api':{getApiOrigin:()=> 'https://campus.example',captureApiContext:()=>({assertCurrent(){}}),apiFetch:async(path:string,init?:{method?:string})=>{
      if(init?.method==='POST')return {...body,id:schemeId,status:'draft',revision:1};reads.push(path);
      if(path===context.academicReportWorkspacePath(root))return workspace;
      if(path===`${root}/workspace/`)return {...workspace,schemes:[],references:{...workspace.references,offerings:undefined}};
      if(path===`${root}/schemes/${schemeId}/`)return detail;throw new Error('Unexpected report readback');
    }},'../../lib/academic-report-command':commands,'../../lib/native-pending-action':{createChunkedNativePendingStorage},'../../lib/use-operation-context':{useOperationContext:()=>()=>()=>{}},'../../lib/academic-report-policy':policy,'../../lib/academic-report-context':context,
    '../../lib/device-storage':{WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async(name:string)=>values.get(name)??null,setItemAsync:async(name:string,value:string,options:{keychainAccessible:number})=>{assert.equal(options.keychainAccessible,1);values.set(name,value);},deleteItemAsync:async(name:string)=>{values.delete(name);}},
    'expo-crypto':{randomUUID,CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_algorithm:string,value:string)=>createHash('sha256').update(value).digest('hex')},
  }).useAcademicReportCommand as (href:string,onAccepted:()=>Promise<void>)=>{locked:boolean;pending:unknown;run(input:unknown):Promise<boolean>};
  function Harness(){const writer=hook(href,async()=>{accepted++;});return React.createElement('div',null,React.createElement('p',null,writer.locked?'Locked':'Ready'),React.createElement('button',{disabled:writer.locked,onClick:()=>{void writer.run({ownerHref:href,endpoint:`${root}/schemes/`,body});}},'Save course report'));}
  await mounted('','',{}, {},async h=>{
    for(let attempt=0;attempt<20&&!h.text().includes('Ready');attempt++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
    assert.match(h.text(),/Ready/);await act(async()=>{h.document.querySelector('button')!.click();await new Promise(resolve=>setTimeout(resolve,10));});
    assert.equal(accepted,1);assert.equal(values.size,0);assert.deepEqual(reads,[context.academicReportWorkspacePath(root),`${root}/schemes/${schemeId}/`]);assert.match(h.text(),/Ready/);
  },undefined,Harness);
});

test('mounted batch preview uses frozen precision for GPA and points with compact credits, preserving zero and missing results',async()=>{
  const subjectRow={id:id(44),report_student_id:rowId,subject_name:'Computing',color:'#447755',icon:'book',outcome:'complete' as const,percentage:'80.0000',grade:'P',passed:true,grade_points:'10.0000',credits:'4.2500',course_code:'CS501'};
  const selected:ReportBatchDetail={...batch,students:[{...batch.students[0]!,gpa:'10.0000',cgpa:'9.8765'}],subjects:[subjectRow]};const original=JSON.stringify(selected);
  await mounted('src/features/ReportsScreen.tsx','TestComponent',{detail:selected,root,href,writer:writer(async()=>{}),disabled:false,canCoordinate:false,receipt:null,onDirtyChange(){}},screenDependencies(),async h=>{
    assert.match(h.text(),/CGPA: 9\.88/);assert.match(h.text(),/Result: 10\.00 grade points/);assert.match(h.text(),/Credits: 4\.25/);assert.doesNotMatch(h.text(),/10\.0000|4\.2500|9\.8765/);
    await h.render({detail:{...selected,students:[{...selected.students[0]!,gpa:'0.0000',cgpa:'0.0000'}],subjects:[{...subjectRow,grade_points:'0.0000'}]}});assert.match(h.text(),/CGPA: 0\.00/);assert.match(h.text(),/Result: 0\.00 grade points/);
    await h.render({detail:{...selected,students:[{...selected.students[0]!,gpa:null,cgpa:null}],subjects:[{...subjectRow,grade_points:null,credits:null}]}});assert.doesNotMatch(h.text(),/CGPA:|0\.00 grade points|Credits: 0/);assert.match(h.text(),/Unknown grade points/);assert.equal(JSON.stringify(selected),original);
  },'ReportBatch');
});
