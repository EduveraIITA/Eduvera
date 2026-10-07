import { Award, BookOpenCheck, CheckCircle2, ChevronRight, FileCheck2, Printer, Plus, Search, ShieldCheck, Upload, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { assessmentAction, createAssessment, createAssessmentCycle, getAssessmentDetail, saveAssessmentResults, uploadAssessmentEvidence, type AdminAssessmentWorkspace, type AssessmentDetail, type AssessmentResult, type AssessmentWorkspace, type FamilyResults, type ResultOutcome } from "./api";
import { FamilyReportMarksheet } from "../academic-reports/AcademicReportWorkspacePage";
import { MarksheetDocumentHeader } from "../academic-reports/MarksheetDocumentHeader";
import type { FamilyReportCards } from "../academic-reports/api";
import "./assessments.css";
import "./family-results.css";

const nice=(value:string)=>value.replaceAll("_"," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());
const dateTime=(value:string|null)=>value?new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value)):"Date not set";
const dateOnly=(value:string|null)=>value?new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric"}).format(new Date(value)):"Date not set";
const field=(data:FormData,key:string)=>{const value=data.get(key);return typeof value==="string"?value.trim():"";};

export function AssessmentWorkspacePage({portal,schoolId,schoolName,data,refresh}:{portal:"principal"|"teacher";schoolId:string;schoolName?:string;data:AssessmentWorkspace;refresh:()=>Promise<void>}){
  const [searchParams]=useSearchParams();
  const [selected,setSelected]=useState<string|null>(()=>data.assessments.find((item)=>item.id===searchParams.get("assessment"))?.id??data.assessments[0]?.id??null); const [createMode,setCreateMode]=useState<"cycle"|"assessment"|null>(null);
  const detail=useQuery({queryKey:["assessment-detail",schoolId,selected],queryFn:()=>getAssessmentDetail(schoolId,selected!),enabled:Boolean(selected)});
  const counts=useMemo(()=>({marking:data.assessments.filter((item)=>item.status==="marking").length,review:data.assessments.filter((item)=>item.status==="submitted").length,published:data.assessments.filter((item)=>item.status==="published").length}),[data.assessments]);
  return <OperationsShell portal={portal} active="more" title={portal==="principal"?"Assessments":"My assessments"} schoolName={schoolName} backTo={`/${portal}/more`}>
    <div className="assessment-page">
      <section className="assessment-summary" aria-label="Assessment status"><div className="assessment-hero__metrics"><span><b>{counts.marking}</b> marking</span><span><b>{counts.review}</b> to review</span><span><b>{counts.published}</b> published</span></div></section>
      {data.mode==="admin"?<div className="assessment-actions"><button onClick={()=>setCreateMode("cycle")}><Plus size={17}/>New cycle</button><button className="is-primary" onClick={()=>setCreateMode("assessment")} disabled={!data.cycles.length}><Plus size={17}/>New assessment</button></div>:null}
      <div className="assessment-layout"><section className="assessment-panel assessment-list"><header><h2>Assessments</h2><span>{data.assessments.length}</span></header>{data.assessments.length?<div>{data.assessments.map((item)=><button type="button" key={item.id} className={selected===item.id?"is-selected":""} onClick={()=>setSelected(item.id)}><span className="assessment-subject-dot" style={{background:item.color}}/><span><strong>{item.title}</strong><small>{item.class_name} · {item.subject_name}</small><em>{dateTime(item.scheduled_at)}</em></span><i className={`assessment-status assessment-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17}/></button>)}</div>:<p className="assessment-empty">No assessments</p>}</section>
      <section className="assessment-panel assessment-detail">{detail.isPending&&selected?<p className="assessment-empty">Opening register…</p>:detail.error?<p className="assessment-error">{detail.error.message}</p>:detail.data?<AssessmentDetailPanel portal={portal} schoolId={schoolId} detail={detail.data} refresh={async()=>{await detail.refetch();await refresh();}}/>:<p className="assessment-empty">Choose an assessment to see its workflow.</p>}</section></div>
      {createMode&&data.mode==="admin"?<CreateDialog mode={createMode} schoolId={schoolId} data={data} onClose={()=>setCreateMode(null)} onSaved={async()=>{setCreateMode(null);await refresh();}}/>:null}
    </div>
  </OperationsShell>;
}

function AssessmentDetailPanel({portal,schoolId,detail,refresh}:{portal:"principal"|"teacher";schoolId:string;detail:AssessmentDetail;refresh:()=>Promise<void>}){
  const item=detail.assessment; const [error,setError]=useState(""); const [busy,setBusy]=useState("");
  async function act(action:string,note="Workflow reviewed and confirmed."){setBusy(action);setError("");try{await assessmentAction(schoolId,item.id,action,item.revision,note);await refresh();}catch(cause){setError((cause as Error).message);}finally{setBusy("");}}
  const examiner=detail.viewer_role==="examiner"; const moderator=detail.viewer_role==="moderator";
  return <><header className="assessment-detail__head"><span className="assessment-icon" style={{color:item.color}}><BookOpenCheck size={22}/></span><div><span>{item.cycle_name} · {item.class_name}</span><h2>{item.title}</h2><p>{item.subject_name} · {item.maximum_marks} marks · {nice(item.assessment_kind)}</p></div><i className={`assessment-status assessment-status--${item.status}`}>{nice(item.status)}</i></header>
    <div className="assessment-facts"><span><small>WHEN</small><strong>{dateTime(item.scheduled_at)}</strong></span><span><small>EXAMINER</small><strong>{item.examiner_name}</strong></span><span><small>MODERATOR</small><strong>{item.moderator_name}</strong></span><span><small>ROSTER</small><strong>{item.roster_count||detail.results.length} learners</strong></span></div>
    {item.moderation_note?<p className="assessment-note"><ShieldCheck size={17}/>{item.moderation_note}</p>:null}{error?<p className="assessment-error" role="alert">{error}</p>:null}
    <div className="assessment-workflow-actions">
      {portal==="principal"&&item.status==="draft"?<button disabled={Boolean(busy)} onClick={()=>void act("schedule")}>Schedule assessment</button>:null}
      {portal==="principal"&&item.status==="scheduled"?<button disabled={Boolean(busy)} onClick={()=>void act("open-marking")}>Open marking</button>:null}
      {portal==="principal"&&item.status==="moderated"?<button disabled={Boolean(busy)} onClick={()=>void act("publish","Approved results released to learners and guardians.")}>Publish results</button>:null}
      {(examiner||portal==="principal")&&item.status==="marking"&&detail.results.length?<button disabled={Boolean(busy)} onClick={()=>void act("submit","Register complete and ready for moderation.")}>Submit for moderation</button>:null}
      {(moderator||portal==="principal")&&item.status==="submitted"?<><button disabled={Boolean(busy)} onClick={()=>void act("approve","Register checked against the assessment record.")}>Approve register</button><button className="is-secondary" disabled={Boolean(busy)} onClick={()=>{const note=window.prompt("What must the examiner correct?");if(note)void act("return",note);}}>Return</button></>:null}
    </div>
    {detail.results.length?<ResultRegister schoolId={schoolId} detail={detail} editable={item.status==="marking"&&(portal==="principal"||Boolean(examiner))} refresh={refresh}/>:<div className="assessment-empty assessment-roster-empty"><FileCheck2 size={25}/><strong>Roster appears when marking opens</strong></div>}
    {detail.publications.length?<div className="assessment-publications"><h3>Publication history</h3>{detail.publications.map((publication)=><div key={publication.id}><Award size={17}/><span><strong>Release {publication.sequence}</strong><small>{dateTime(publication.published_at)} · {publication.reason}</small></span></div>)}</div>:null}
  </>;
}

function ResultRegister({schoolId,detail,editable,refresh}:{schoolId:string;detail:AssessmentDetail;editable:boolean;refresh:()=>Promise<void>}){
  const [drafts,setDrafts]=useState<Record<string,{outcome:Exclude<ResultOutcome,"unrecorded">;marks:string;grade:string;feedback:string}>>(()=>Object.fromEntries(detail.results.map((result)=>[result.id,{outcome:result.outcome==="unrecorded"?"scored":result.outcome,marks:result.marks??"",grade:result.grade,feedback:result.feedback}]))); const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const change=(id:string,patch:Partial<(typeof drafts)[string]>)=>setDrafts((current)=>({...current,[id]:{...current[id]!,...patch}}));
  async function save(result:AssessmentResult){const value=drafts[result.id]!;setBusy(result.id);setError("");try{await saveAssessmentResults(schoolId,detail.assessment.id,detail.assessment.revision,[{result_id:result.id,outcome:value.outcome,marks:value.outcome==="scored"?Number(value.marks):null,grade:value.grade,feedback:value.feedback,expected_revision:result.revision,reason:result.outcome==="unrecorded"?"Initial marks entry":"Reviewed result correction"}]);await refresh();}catch(cause){setError((cause as Error).message);}finally{setBusy("");}}
  return <div className="assessment-register"><header><div><span>RESULT REGISTER</span><h3>{detail.results.filter((r)=>r.outcome!=="unrecorded").length}/{detail.results.length} recorded</h3></div><span>{detail.assessment.evidence_requirement} evidence</span></header>{error?<p className="assessment-error">{error}</p>:null}<div>{detail.results.map((result)=>{const value=drafts[result.id]!;return <article key={result.id}><div className="assessment-learner"><b>{result.roll_number??"–"}</b><span><strong>{result.first_name} {result.last_name}</strong><small>{result.admission_number}</small></span><i className={`assessment-result-state assessment-result-state--${result.outcome}`}>{nice(result.outcome)}</i></div>{editable?<div className="assessment-mark-row"><select aria-label={`Outcome for ${result.first_name}`} value={value.outcome} onChange={(event)=>change(result.id,{outcome:event.target.value as typeof value.outcome})}><option value="scored">Scored</option><option value="absent">Absent</option><option value="exempt">Exempt</option><option value="withheld">Withheld</option><option value="not_evaluated">Not evaluated</option></select><input aria-label={`Marks for ${result.first_name}`} type="number" min="0" max={detail.assessment.maximum_marks} step="0.01" disabled={value.outcome!=="scored"} placeholder="Marks" value={value.marks} onChange={(event)=>change(result.id,{marks:event.target.value})}/><input aria-label={`Grade for ${result.first_name}`} placeholder="Grade" value={value.grade} onChange={(event)=>change(result.id,{grade:event.target.value})}/><input className="assessment-feedback" aria-label={`Feedback for ${result.first_name}`} placeholder="Feedback (optional)" value={value.feedback} onChange={(event)=>change(result.id,{feedback:event.target.value})}/><button disabled={busy===result.id} onClick={()=>void save(result)}>{busy===result.id?"Saving…":"Save"}</button><label className="assessment-upload"><Upload size={15}/><span>Add evidence</span><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={async(event)=>{const file=event.target.files?.[0];if(!file)return;setBusy(`file-${result.id}`);try{await uploadAssessmentEvidence(schoolId,detail.assessment.id,result.id,file,"Supporting assessment evidence");await refresh();}catch(cause){setError((cause as Error).message);}finally{setBusy("");}}}/></label></div>:<div className="assessment-read-result"><strong>{result.outcome==="scored"?`${result.marks} / ${detail.assessment.maximum_marks}`:nice(result.outcome)}</strong>{result.grade?<span>Grade {result.grade}</span>:null}{result.feedback?<p>{result.feedback}</p>:null}{result.evidence_count?<small>{result.evidence_count} evidence file{result.evidence_count===1?"":"s"}</small>:null}</div>}</article>})}</div></div>;
}

function CreateDialog({mode,schoolId,data,onClose,onSaved}:{mode:"cycle"|"assessment";schoolId:string;data:AdminAssessmentWorkspace;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""); const currentTerm=data.references.terms[0];
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);try{if(mode==="cycle")await createAssessmentCycle(schoolId,{term_id:field(form,"term_id"),name:field(form,"name"),code:field(form,"code"),starts_on:field(form,"starts_on"),ends_on:field(form,"ends_on"),result_label:field(form,"result_label")});else await createAssessment(schoolId,{cycle_id:field(form,"cycle_id"),class_section_id:field(form,"class_section_id"),subject_id:field(form,"subject_id"),title:field(form,"title"),assessment_kind:field(form,"assessment_kind"),maximum_marks:Number(field(form,"maximum_marks")),weight_percent:field(form,"weight_percent")?Number(field(form,"weight_percent")):null,scheduled_at:new Date(field(form,"scheduled_at")).toISOString(),duration_minutes:Number(field(form,"duration_minutes"))||null,venue:field(form,"venue"),instructions:field(form,"instructions"),evidence_requirement:field(form,"evidence_requirement"),examiner_user_id:field(form,"examiner_user_id"),moderator_user_id:field(form,"moderator_user_id")});await onSaved();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <div className="assessment-dialog-backdrop"><section className="assessment-dialog" role="dialog" aria-modal="true" aria-labelledby="assessment-dialog-title"><header><h2 id="assessment-dialog-title">{mode==="cycle"?"Create a cycle":"Plan an assessment"}</h2><button onClick={onClose} aria-label="Close"><XCircle/></button></header><form onSubmit={(event)=>void submit(event)}><div className="assessment-form-grid">{mode==="cycle"?<><label>Term<select name="term_id" defaultValue={currentTerm?.id} required>{data.references.terms.map((term)=><option value={term.id} key={term.id}>{term.name} · {term.academic_year}</option>)}</select></label><label>Cycle name<input name="name" required placeholder="Term 1 examinations"/></label><label>Short code<input name="code" required placeholder="T1-EXAM"/></label><label>Result label<input name="result_label" defaultValue="Result" required/></label><label>Starts<input name="starts_on" type="date" defaultValue={currentTerm?.starts_on} required/></label><label>Ends<input name="ends_on" type="date" defaultValue={currentTerm?.ends_on} required/></label></>:<><label>Cycle<select name="cycle_id" required>{data.cycles.map((cycle)=><option value={cycle.id} key={cycle.id}>{cycle.name}</option>)}</select></label><label>Class<select name="class_section_id" required>{data.references.classes.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Subject<select name="subject_id" required>{data.references.subjects.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Assessment type<select name="assessment_kind"><option value="exam">Exam</option><option value="class_test">Class test</option><option value="practical">Practical</option><option value="viva">Viva</option><option value="project">Project</option><option value="assignment">Assignment</option><option value="quiz">Quiz</option><option value="other">Other</option></select></label><label className="assessment-span">Title<input name="title" required placeholder="English mid-term paper"/></label><label>Maximum marks<input name="maximum_marks" type="number" min="1" step="0.01" defaultValue="100" required/></label><label>Weight % (optional)<input name="weight_percent" type="number" min="0.01" max="100" step="0.01"/></label><label>Date and time<input name="scheduled_at" type="datetime-local" required/></label><label>Duration (minutes)<input name="duration_minutes" type="number" min="1" max="1440" defaultValue="90"/></label><label>Venue<input name="venue" placeholder="Room or hall"/></label><label>Evidence<select name="evidence_requirement"><option value="optional">Optional</option><option value="none">Not collected</option><option value="required">Required per learner</option></select></label><label>Examiner<select name="examiner_user_id" required>{data.references.staff.map((person)=><option value={person.id} key={person.id}>{person.first_name} {person.last_name} · {person.designation||"Staff"}</option>)}</select></label><label>Moderator<select name="moderator_user_id" required>{data.references.staff.map((person)=><option value={person.id} key={person.id}>{person.first_name} {person.last_name} · {person.designation||"Staff"}</option>)}</select></label><label className="assessment-span">Instructions<textarea name="instructions" rows={3} placeholder="Operational notes for the offline assessment"/></label></>}</div>{error?<p className="assessment-error">{error}</p>:null}<footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button disabled={busy}>{busy?"Saving…":mode==="cycle"?"Create cycle":"Create assessment"}</button></footer></form></section></div>;
}

function AssessmentMarksheet({result,data,printing,onPrint}:{result:FamilyResults["results"][number];data:FamilyResults;printing:boolean;onPrint:()=>void}){
  const studentName=`${data.student.first_name} ${data.student.last_name}`;
  const scored=result.outcome==="scored"&&result.marks!==null&&Number(result.maximum_marks)>0;
  const percentage=scored?Math.min(100,Number(result.marks)/Number(result.maximum_marks)*100):null;
  const reference=result.publication_id.slice(0,8).toUpperCase();
  return <article className={`marksheet assessment-record-marksheet result-document${printing?" is-print-target":""}`} aria-labelledby={`assessment-marksheet-${result.id}`}>
    <MarksheetDocumentHeader kind="assessment"/>
    <div className="marksheet__title"><div className="marksheet__title-copy"><span>{result.term_name} · {result.academic_year}</span><h3 id={`assessment-marksheet-${result.id}`}>{result.title}</h3>{result.sequence>1?<em>Corrected release</em>:null}</div></div>
    <dl className="marksheet__identity"><div><dt>Student</dt><dd>{studentName}</dd></div><div><dt>Admission no.</dt><dd>{data.student.admission_number}</dd></div><div><dt>Class</dt><dd>{data.student.class_name??"Current class"}</dd></div></dl>
    <div className="marksheet__summary" aria-label="Assessment result"><span><small>MARKS</small><strong>{scored?result.marks:"—"}</strong><em>{scored?`of ${result.maximum_marks}`:nice(result.outcome)}</em></span><span><small>PERCENTAGE</small><strong>{percentage===null?"—":`${percentage.toFixed(2)}%`}</strong></span><span><small>RESULT</small><strong>{result.grade||nice(result.outcome)}</strong><em>{nice(result.assessment_kind)}</em></span></div>
    <div className="marksheet__subjects" role="table" aria-label={`${result.subject_name} marks`}><div className="marksheet__subject-head" role="row"><span role="columnheader">Subject</span><span role="columnheader">Score</span><span role="columnheader">Grade</span><span role="columnheader">Status</span></div><div className="marksheet__subject-row" role="row"><span role="cell"><i style={{background:result.color}}/><b>{result.subject_name}</b></span><strong role="cell">{scored?`${result.marks}/${result.maximum_marks}`:"—"}</strong><b role="cell">{result.grade||"—"}</b><em role="cell">{nice(result.outcome)}</em></div></div>
    {result.feedback?<section className="marksheet__remarks" aria-label="Teacher remarks"><h4>Remarks</h4><div><p><b>Teacher</b>{result.feedback}</p></div></section>:null}
    <footer className="marksheet__verification"><ShieldCheck size={19}/><span><strong>Published school record</strong><small>{dateOnly(result.published_at)} · Reference {reference}</small></span><CheckCircle2 size={19}/></footer>
    <button type="button" className="marksheet__print" onClick={onPrint}><Printer size={17}/>Print / save marksheet</button>
  </article>;
}

export function FamilyResultsPage({portal,data,reportCards,children,onSelect}:{portal:"parent"|"student";data:FamilyResults;reportCards?:FamilyReportCards;children:Array<{id:string;user:{display_name:string};current_enrollment:{grade:string;section:string};avatar_url:string}>;onSelect:(id:string)=>void}){
  const [query,setQuery]=useState("");
  const [year,setYear]=useState("");
  const [kind,setKind]=useState<"all"|"term"|"assessment">("all");
  const [printTarget,setPrintTarget]=useState<string|null>(null);
  const [activeSlide,setActiveSlide]=useState(0);
  const [activeSlideContext,setActiveSlideContext]=useState("");
  const galleryRef=useRef<HTMLDivElement>(null);
  const classLabel=data.student.class_name?.replace(/^Class\s+/i,"")??"Current class";
  const child={id:data.student.id,name:`${data.student.first_name} ${data.student.last_name}`,grade:classLabel,section:"",board:"",rollNumber:"",avatarUrl:children.find((item)=>item.id===data.student.id)?.avatar_url};
  const years=useMemo(()=>Array.from(new Set([...(reportCards?.reports.map((report)=>report.academic_year)??[]),...data.results.map((result)=>result.academic_year)])).filter(Boolean).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})),[data.results,reportCards]);
  const effectiveYear=year==="all"||years.includes(year)?year:years[0]??"all";
  const needle=query.trim().toLocaleLowerCase();
  const filteredResults=data.results.filter((result)=>(effectiveYear==="all"||result.academic_year===effectiveYear)&&(!needle||[result.title,result.subject_name,result.cycle_name,result.term_name,result.academic_year,nice(result.assessment_kind)].some((value)=>value.toLocaleLowerCase().includes(needle))));
  const filteredReports=reportCards?.reports.filter((report)=>(effectiveYear==="all"||report.academic_year===effectiveYear)&&(!needle||[report.scheme_name,report.term_name,report.academic_year,...report.subjects.map((subject)=>subject.subject_name)].some((value)=>value.toLocaleLowerCase().includes(needle))))??[];
  const representedByTermReport=(result:FamilyResults["results"][number])=>filteredReports.some((report)=>report.subjects.some((subject)=>subject.assessment_ids?.includes(result.id)));
  const shownAssessments=kind==="term"?[]:kind==="all"?filteredResults.filter((result)=>!representedByTermReport(result)):filteredResults;
  const shownReports=kind!=="assessment"?filteredReports:[];
  const slides=[...shownReports.map((report)=>({key:`report-${report.batch_id}`,type:"report" as const,report})),...shownAssessments.map((result)=>({key:`assessment-${result.id}`,type:"assessment" as const,result}))];
  const visibleCount=slides.length;
  const galleryContext=`${data.student.id}:${effectiveYear}:${kind}:${query}`;
  const currentSlide=activeSlideContext===galleryContext?Math.min(activeSlide,Math.max(slides.length-1,0)):0;
  useEffect(()=>{
    if(!printTarget)return;
    const finish=()=>setPrintTarget(null);
    window.addEventListener("afterprint",finish,{once:true});
    const frame=window.requestAnimationFrame(()=>window.print());
    const fallback=window.setTimeout(finish,60000);
    return()=>{window.cancelAnimationFrame(frame);window.clearTimeout(fallback);window.removeEventListener("afterprint",finish);};
  },[printTarget]);
  function selectSlide(index:number){
    const gallery=galleryRef.current;
    const target=gallery?.children.item(index) as HTMLElement|null;
    if(gallery&&target){
      const left=target.offsetLeft-gallery.offsetLeft;
      if(typeof gallery.scrollTo==="function")gallery.scrollTo({left,behavior:"smooth"});
      else gallery.scrollLeft=left;
    }
    setActiveSlide(index);
    setActiveSlideContext(galleryContext);
  }
  function updateActiveSlide(){
    const gallery=galleryRef.current;
    if(!gallery)return;
    const items=Array.from(gallery.children) as HTMLElement[];
    const closest=items.reduce((best,item,index)=>Math.abs(item.offsetLeft-gallery.offsetLeft-gallery.scrollLeft)<best.distance?{index,distance:Math.abs(item.offsetLeft-gallery.offsetLeft-gallery.scrollLeft)}:best,{index:0,distance:Number.POSITIVE_INFINITY});
    setActiveSlide(closest.index);
    setActiveSlideContext(galleryContext);
  }
  const content=<div className={`family-results-page${printTarget?" is-printing":""}`}>
    <section className="results-library" aria-labelledby="results-library-heading"><header><div><span>PUBLISHED RECORDS</span><h2 id="results-library-heading">Marksheets</h2></div><b>{visibleCount}</b></header><div className="results-library__filters"><label className="results-library__search"><Search size={18}/><span className="sr-only">Search marksheets</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search subject or assessment"/></label><label className="results-library__year"><span className="sr-only">Academic year</span><select value={effectiveYear} onChange={(event)=>setYear(event.target.value)}><option value="all">All years</option>{years.map((item)=><option key={item} value={item}>{item}</option>)}</select></label></div><div className="results-library__tabs" role="tablist" aria-label="Result type">{([['all','All'],['term','Term reports'],['assessment','Assessments']] as const).map(([value,label])=><button key={value} type="button" role="tab" aria-selected={kind===value} className={kind===value?"is-active":""} onClick={()=>setKind(value)}>{label}</button>)}</div></section>
    {slides.length?<section className="result-gallery" aria-label="Published marksheet gallery"><nav className="result-gallery__navigator" aria-label="Choose marksheet"><span>{currentSlide+1} of {slides.length}</span><div>{slides.map((slide,index)=><button key={slide.key} type="button" className={currentSlide===index?"is-active":""} aria-label={`Show marksheet ${index+1} of ${slides.length}`} aria-current={currentSlide===index?"true":undefined} onClick={()=>selectSlide(index)}/>)}</div></nav><div key={galleryContext} ref={galleryRef} className="result-gallery__track" onScroll={updateActiveSlide}>{slides.map((slide,index)=><div className={`result-gallery__slide${printTarget===slide.key?" is-print-target":""}`} role="group" aria-label={`Marksheet ${index+1} of ${slides.length}`} key={slide.key}>{slide.type==="report"&&reportCards?<FamilyReportMarksheet data={reportCards} report={slide.report} showPrintAction printing={printTarget===slide.key} onPrint={()=>setPrintTarget(slide.key)}/>:slide.type==="assessment"?<AssessmentMarksheet result={slide.result} data={data} printing={printTarget===slide.key} onPrint={()=>setPrintTarget(slide.key)}/>:null}</div>)}</div></section>:null}
    {!visibleCount?<section className="assessment-panel assessment-empty"><Award size={28}/><strong>{data.results.length||reportCards?.reports.length?"No matching marksheets":"No published results"}</strong></section>:null}
  </div>;
  if(portal==="parent")return <ParentShell active="more" pageLabel="Results" child={child} selectedChildId={data.student.id} childOptions={children.map((item)=>({id:item.id,name:item.user.display_name,grade:`Grade ${item.current_enrollment.grade}`,section:item.current_enrollment.section,avatarUrl:item.avatar_url}))} onSelectChild={onSelect} backTo="/parent/more">{content}</ParentShell>;
  return <StudentShell activeNav="launcher" pageTitle="Results" backTo="/student/apps">{content}</StudentShell>;
}
