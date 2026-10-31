import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { getClassPractice,getClassPracticeDetail,replyToPractice } from "./classPracticeApi";
import { ClassPracticeComposer } from "./ClassPracticeComposer";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import "./class-practice.css";

export function ClassPracticeView({schoolId,actorId,classId}:{schoolId:string;actorId:string;classId:string}){
  const environment=useExecutionEnvironment(),client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const page=Math.max(1,Number(params.get("page"))||1),id=params.get("practice"),studentId=params.get("learner")??undefined;
  const [composing,setComposing]=useState(false),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(true),command=useRef(crypto.randomUUID()),noteId=useRef(crypto.randomUUID()),inFlight=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const readOnly=environment.mode==="simulation"&&(environment.unavailable||environment.runStatus==="stopped"||environment.runStatus==="completed");
  const key=["class-practice",schoolId,actorId,classId] as const;
  const guard=useUnsavedChangesGuard(Boolean(note.trim())||busy,"Discard this unsent private reply? Replies already accepted remain in the conversation.");
  const list=useQuery({queryKey:executionEnvironmentQueryKey(environment,[...key,"list",page]),queryFn:()=>getClassPractice(classId,page)});
  const detail=useQuery({queryKey:executionEnvironmentQueryKey(environment,[...key,"detail",id,page,studentId]),queryFn:()=>getClassPracticeDetail(classId,id!,page,studentId),enabled:Boolean(id)});
  const select=(values:Record<string,string|undefined>)=>{if(inFlight.current||!guard())return;const next=new URLSearchParams(params);Object.entries(values).forEach(([name,value])=>value?next.set(name,value):next.delete(name));setNote("");setError("");command.current=crypto.randomUUID();noteId.current=crypto.randomUUID();setParams(next);};
  const refresh=()=>client.invalidateQueries({queryKey:executionEnvironmentQueryKey(environment,key)});
  const reply=async()=>{if(!id||!studentId||readOnly||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");try{await replyToPractice(id,{command_id:command.current,note_id:noteId.current,student_id:studentId,body:note.trim()});if(!active.current)return;setNote("");command.current=crypto.randomUUID();noteId.current=crypto.randomUUID();await refresh();}catch(cause){if(active.current)setError(cause instanceof Error?cause.message:"Reply was not confirmed. Your text is still here.");}finally{inFlight.current=false;if(active.current)setBusy(false);}};
  if(list.isPending)return <WorkspaceState state="loading"/>;
  if(list.error||!list.data)return <WorkspaceState state="error" error={list.error} onRetry={list.refetch}/>;
  const data=list.data;
  return <div className="class-practice"><header className="class-practice-heading"><div><h2>Class practice</h2><p className="class-practice-caption">Your published instructions</p></div>{!readOnly&&data.can_publish?<button type="button" onClick={()=>setComposing(true)}><Plus size={18} aria-hidden="true"/>Add practice</button>:null}</header>
    {readOnly?<p className="class-practice-caption">This simulation is read-only.</p>:null}
    {data.items.length?<div className="class-practice-list">{data.items.map(item=><button type="button" key={item.id} onClick={()=>select({practice:item.id,learner:undefined,page:undefined})}><ProductIcon name="learning" size={28}/><span><strong>{item.title}</strong><small>{item.date}{item.due_at?` · Due ${new Date(item.due_at).toLocaleDateString()}`:""}</small></span><ChevronRight size={18} aria-hidden="true"/></button>)}</div>:<p className="class-practice-caption">No practice published yet.</p>}
    <nav className="class-practice-pages" aria-label="Practice pages">{page>1?<button onClick={()=>select({page:String(page-1)})}>Previous</button>:null}{data.has_more?<button onClick={()=>select({page:String(page+1)})}>Next</button>:null}</nav>
    {composing?<ClassPracticeComposer data={data} onClose={()=>setComposing(false)} onAccepted={accepted=>{if(!active.current)return;setComposing(false);select({practice:accepted,page:undefined});void refresh();}}/>:null}
    {id?<PlannerDialog title={detail.data?.item.title??"Practice"} busy={busy} onClose={()=>select({practice:undefined,learner:undefined,page:undefined})}>
      <div className="class-practice-form">{detail.isPending?<p role="status">Loading practice…</p>:detail.error||!detail.data?<><p role="alert">{detail.error?.message??"Practice unavailable."}</p><button onClick={()=>void detail.refetch()}>Try again</button>{page>1?<button onClick={()=>select({page:undefined,learner:undefined})}>Return to first page</button>:null}</>:<>
        <p className="class-practice-body">{detail.data.item.body}</p><p className="class-practice-caption">{detail.data.item.due_at?`Due ${new Date(detail.data.item.due_at).toLocaleString()}`:"No due date"}</p>
        <section aria-label="Reported completion"><h3>{detail.data.progress.completed} of {detail.data.progress.total} done</h3><p className="class-practice-caption">Current class · learner or guardian reported, not verified submission</p>
          <div className="class-practice-list">{detail.data.progress.items.map(person=><button type="button" disabled={!detail.data.can_reply||busy} key={person.id} onClick={()=>select({learner:person.id})}><span><strong>{person.name}</strong><small>{person.completed_at?"Reported done":"To do"}</small></span>{detail.data.can_reply?<ChevronRight size={18} aria-hidden="true"/>:null}</button>)}</div>
          <nav className="class-practice-pages" aria-label="Learner pages">{page>1?<button disabled={busy} onClick={()=>select({page:String(page-1),learner:undefined})}>Previous</button>:null}{page*20<detail.data.progress.total?<button disabled={busy} onClick={()=>select({page:String(page+1),learner:undefined})}>Next</button>:null}</nav>
        </section>
        {studentId&&detail.data.thread?<section aria-label="Private learner thread"><h3>Private conversation</h3><p className="class-practice-caption">Visible to you, this learner and their current guardians.</p>{detail.data.thread.length===100?<p className="class-practice-caption">Latest 100 entries shown.</p>:null}{detail.data.thread.length?detail.data.thread.map(entry=><article key={entry.id}><strong>{entry.author_name}</strong><p className="class-practice-body">{entry.body}</p><small>{new Date(entry.created_at).toLocaleString()}</small></article>):<p>No private notes yet.</p>}
          {detail.data.thread.length&&!readOnly?<><label>Reply<textarea rows={3} maxLength={2000} disabled={busy} value={note} onChange={event=>{setNote(event.target.value);command.current=crypto.randomUUID();noteId.current=crypto.randomUUID();setError("");}}/></label><button disabled={busy||!note.trim()} onClick={()=>void reply()}>{busy?"Sending…":"Send reply"}</button></>:null}
        </section>:null}
      </>}{error?<p role="alert">{error}</p>:null}</div>
    </PlannerDialog>:null}
  </div>;
}
