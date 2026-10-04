import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, Circle, LoaderCircle, LockKeyhole, RefreshCw, Rocket, Settings2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { activateInstitution, getActivation, reviewActivation } from "./api";
import { QuickStartForm } from "./QuickStartForm";
import "./activation.css";

export default function InstitutionActivationPage(){
  const auth=useAuth();const queryClient=useQueryClient();const schools=auth.memberships.filter(item=>item.role==="admin");const [selected,setSelected]=useState("");const schoolId=selected||auth.user?.active_school_id||schools[0]?.school_id||"";const [busy,setBusy]=useState<"review"|"activate"|null>(null);const [error,setError]=useState("");
  const query=useQuery({queryKey:["institution-activation",schoolId],queryFn:()=>getActivation(schoolId),enabled:Boolean(schoolId)});const data=query.data;const blank=Boolean(data&&data.counts.terms===0&&data.counts.cohorts===0&&data.counts.subjects===0&&data.institution.status!=="active");
  async function review(){setBusy("review");setError("");try{await reviewActivation(schoolId);await queryClient.invalidateQueries({queryKey:["institution-activation",schoolId]});}catch(cause){setError((cause as Error).message);}finally{setBusy(null);}}
  async function activate(){if(!data)return;setBusy("activate");setError("");try{await activateInstitution(schoolId,data.institution.revision);await Promise.all([auth.refresh(),queryClient.invalidateQueries({queryKey:["institution-activation",schoolId]})]);}catch(cause){setError((cause as Error).message);}finally{setBusy(null);}}
  return <OperationsShell portal="principal" active="more" title="Institution setup" subtitle="First-day readiness" backTo="/principal/more" contentHasHeading><main className="activation-page">
    {schools.length>1?<label className="activation-context">Institution<select value={schoolId} onChange={event=>setSelected(event.target.value)}>{schools.map(school=><option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label>:null}
    {!schoolId?<p className="activation-alert">An active administrator membership is required.</p>:query.isPending?<ScreenLoading/>:query.isError?<LiveRouteError error={query.error} onRetry={query.refetch}/>:data?<>
      <section className={`activation-status activation-hero--${data.institution.status}`}><header><span>Setup progress</span><strong>{data.summary.percent}%</strong><b>{data.institution.status.replace("_"," ")}</b></header><div className="activation-progress"><div><span style={{width:`${data.summary.percent}%`}}/></div></div><small>{data.summary.completed} of {data.summary.required} required checks</small></section>
      {data.institution.status==="active"?<section className="activation-success"><CheckCircle2/><strong>Institution active</strong><Link to="/principal">Open dashboard <ArrowRight/></Link></section>:null}
      {blank?<QuickStartForm schoolId={schoolId} cohortLabel={data.institution.cohort_label} defaults={data.institution.default_subject_names} onDone={async()=>{await query.refetch();}}/>:null}
      <section className="activation-card activation-checklist"><header><h2>Readiness checklist</h2><b>{data.checks.filter(check=>check.required&&!check.complete).length} remaining</b></header><ol>{data.checks.map(check=><li key={check.key} className={check.complete?"is-complete":""}><span>{check.complete?<Check/>:<Circle/>}</span><div><strong>{check.label}{!check.required?<em>Optional</em>:null}</strong><small>{check.detail}</small></div>{!check.complete?<Link to={check.target_path} aria-label={`Open ${check.label}`}><Settings2/>Open</Link>:null}</li>)}</ol></section>
      {error?<p className="activation-alert" role="alert">{error}</p>:null}
      {data.institution.status!=="active"?<section className="activation-action"><strong>{data.summary.ready?"Ready to activate":"Setup incomplete"}</strong><div>{data.institution.status==="ready"?<button className="activation-primary" onClick={()=>void activate()} disabled={busy!==null}>{busy==="activate"?<LoaderCircle className="auth-spin"/>:<Rocket/>}Activate institution</button>:<button className="activation-primary" onClick={()=>void review()} disabled={busy!==null}>{busy==="review"?<LoaderCircle className="auth-spin"/>:<RefreshCw/>}Review readiness</button>}</div></section>:null}
      {data.history.length?<details className="activation-history"><summary>Activation history <b>{data.history.length}</b></summary><ul>{data.history.map(item=><li key={item.id}><span><LockKeyhole/></span><div><strong>{item.action.replaceAll("_"," ")}</strong><small>{new Date(item.created_at).toLocaleString("en-IN")} · {item.from_status??"new"} → {item.to_status}</small>{item.note?<p>{item.note}</p>:null}</div></li>)}</ul></details>:null}
    </>:null}
  </main></OperationsShell>;
}
