import {useState} from "react";
import {useInfiniteQuery,useQuery,useQueryClient} from "@tanstack/react-query";
import {Link,useSearchParams} from "react-router-dom";
import {CheckCircle2,Download,FileSpreadsheet,Plus} from "lucide-react";
import {useAuth} from "../auth/AuthContext";
import {OperationsShell} from "../../pages/operations/OperationsShell";
import {enrollmentOptions} from "./api";
import {getImport,getImports,importReportUrl,type ImportDetail} from "./import-api";
import {ImportUpload} from "./ImportUpload";
import {ImportReview} from "./ImportReview";
import "./people.css";
import "./people-import.css";
const displayDate=(value:string)=>new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
export default function PeopleImportPage(){
  const auth=useAuth();const schools=auth.memberships.filter(m=>m.role==='admin');const [params,setParams]=useSearchParams();
  const schoolId=params.get('school')||schools[0]?.school_id;const id=params.get('import');
  const open=(importId?:string)=>{setParams({...(schoolId?{school:schoolId}:{}),...(importId?{import:importId}:{})});};
  return <OperationsShell portal="principal" active="home" title="Import students" subtitle="School onboarding" schoolName={schools.find(s=>s.school_id===schoolId)?.school_name} backTo="/principal/students" contentHasHeading><div className="operations-stack">
    {id?<header className="people-heading people-heading--actions"><button className="people-secondary" onClick={()=>open()}>Import history</button></header>:null}
    {schools.length>1?<label className="people-school">School<select value={schoolId} onChange={e=>setParams({school:e.target.value})}>{schools.map(s=><option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}</select></label>:null}
    {schoolId?(id?<ImportWorkspace key={id} schoolId={schoolId} id={id} onNew={()=>open()}/>:<ImportStart key={schoolId} schoolId={schoolId} onOpen={open}/>):<p role="alert">An active school administrator membership is required.</p>}
  </div></OperationsShell>;
}
function ImportStart({schoolId,onOpen}:{schoolId:string;onOpen:(id:string)=>void}){
  const [uploading,setUploading]=useState(false);const options=useQuery({queryKey:["school","people","options",schoolId],queryFn:()=>enrollmentOptions(schoolId)});
  const history=useInfiniteQuery({queryKey:["school","people","imports",schoolId],queryFn:({pageParam})=>getImports(schoolId,pageParam),initialPageParam:undefined as string|undefined,getNextPageParam:p=>p.next_cursor??undefined});
  return <>
    {options.isError?<p role="alert" className="people-error">School setup could not load. <button onClick={()=>void options.refetch()}>Try again</button></p>:null}
    {options.isPending?<div className="people-panel import-skeleton" role="status" aria-label="Loading school setup"><span/><span/><span/></div>:null}
    {options.data?.results.length?(uploading?<ImportUpload schoolId={schoolId} options={options.data.results} onUploaded={onOpen}/>:<section className="people-panel import-start"><FileSpreadsheet size={28}/><div><h2>Enroll a class or a whole school</h2><p className="people-muted">Import a CSV, resolve issues, then confirm one complete batch.</p></div><button className="people-primary" onClick={()=>setUploading(true)}><Plus size={17}/>New import</button></section>):options.data?<p className="people-warning">Set up an active term and classes before importing students.</p>:null}
    <section className="people-panel"><h2>Import history</h2><p className="people-muted">Resume a draft or open the receipt for a completed enrollment.</p>
      {history.isPending?<p role="status">Loading imports…</p>:null}{history.isError?<p role="alert" className="people-error">History could not load. <button onClick={()=>void history.refetch()}>Try again</button></p>:null}
      {history.data&&!history.data.pages[0]?.results.length?<p className="people-muted">No imports yet. Your first uploaded batch will appear here.</p>:null}
      <ul className="import-history">{history.data?.pages.flatMap(p=>p.results).map(job=><li key={job.id}><div><strong>{job.filename}</strong><span>{job.term_name} · {job.row_count} rows · {displayDate(job.created_at)}</span><small>Uploaded by {job.created_by_name}</small></div><span className={`import-status import-status--${job.state==='committed'?'ready':job.state==='draft'?'warning':'skipped'}`}>{job.state==='committed'?`${job.summary?.students??0} enrolled`:job.state}</span><button className="people-secondary" onClick={()=>onOpen(job.id)}>{job.state==='draft'?'Resume review':'View details'}</button></li>)}</ul>
      {history.hasNextPage?<button className="people-secondary" disabled={history.isFetchingNextPage} onClick={()=>void history.fetchNextPage()}>{history.isFetchingNextPage?'Loading…':'More imports'}</button>:null}
    </section>
  </>;
}
function ImportWorkspace({schoolId,id,onNew}:{schoolId:string;id:string;onNew:()=>void}){
  const client=useQueryClient();const query=useQuery({queryKey:["school","people","import",schoolId,id],queryFn:()=>getImport(schoolId,id),retry:false});
  async function reload(){const result=await query.refetch();if(result.error)throw result.error;}
  async function committed(){await Promise.all([["school","people"],["teacher-home"],["teacher-attendance"],["principal-home"],["principal-register"],["school","parent"]].map(queryKey=>client.invalidateQueries({queryKey})));await reload();}
  if(query.isPending)return <section className="people-panel import-skeleton" role="status" aria-label="Checking import rows"><span/><span/><span/></section>;
  if(query.isError)return <section className="people-panel"><p role="alert" className="people-error">{query.error.message}</p><button className="people-secondary" onClick={()=>void query.refetch()}>Try again</button></section>;
  const job=query.data;
  return <><ol className="import-steps" aria-label="Import progress"><li>1. Upload</li><li aria-current={job.state==='draft'?'step':undefined}>2. Review</li><li aria-current={job.state==='committed'?'step':undefined}>3. Enroll</li></ol>
    {job.state==='draft'&&job.review?<ImportReview schoolId={schoolId} job={job} reload={reload} onCommitted={committed}/>:<ImportResult schoolId={schoolId} job={job} onNew={onNew}/>}
  </>;
}
function ImportResult({schoolId,job,onNew}:{schoolId:string;job:ImportDetail;onNew:()=>void}){
  const receipt=job.receipt;
  return <section className="people-panel import-result"><CheckCircle2 size={28}/><h2>{receipt?'Enrollment complete':job.state==='expired'?'Draft expired':'Draft discarded'}</h2>
    {receipt?<><p>{receipt.students} students are enrolled with complete guardian links. No attendance marks or login permissions were added.</p><dl className="import-metrics"><div><dt>Students</dt><dd>{receipt.students}</dd></div><div><dt>New guardians</dt><dd>{receipt.guardians_created}</dd></div><div><dt>Existing guardians</dt><dd>{receipt.guardians_reused}</dd></div><div><dt>Skipped</dt><dd>{receipt.skipped}</dd></div></dl>{receipt.registers_reopened?<p className="people-warning">{receipt.registers_reopened} submitted registers returned to draft for the revised roster.</p>:null}<div className="import-actions"><Link className="people-primary" to="/principal/students">Open student directory</Link><a className="people-secondary" href={importReportUrl(schoolId,job.id)} download><Download size={17}/>Enrollment receipt</a></div></>:<p>Uploaded personal details have been cleared. No students were enrolled from this draft.</p>}
    <button className="people-secondary" onClick={onNew}>Back to imports</button>
  </section>;
}
