import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { getResourceLoan, getResources, type ResourceFilter, type ResourceView } from "./resourceApi";
import { ResourceIssueDialog } from "./ResourceIssueDialog";
import { ResourceLoanView, resourceStateLabel } from "./ResourceLoanView";
import { ResourceEmpty, ResourcePages, ResourceReadError, resourceDate } from "./ResourcePrimitives";
import "./resources.css";

export function ResourcesWorkspaceRoute() {
  const environment=useExecutionEnvironment(),auth=useOptionalAuth(),manifest=useWorkspaceManifest();
  const shell=(body:React.ReactNode)=><OperationsShell active="areas" title="Resources" backTo="/areas">{body}</OperationsShell>;
  if(environment.mode==="simulation" && environment.unavailable)return shell(<WorkspaceState state="unavailable" />);
  if(manifest.isPending)return shell(<WorkspaceState state="loading" />);
  if(manifest.error)return shell(<WorkspaceState state="error" error={manifest.error} onRetry={manifest.refetch} />);
  if(!manifest.data || !manifestMatchesEnvironment(manifest.data,environment) || !manifest.data.areas.some(area=>area.key==="resources"))return shell(<WorkspaceState state="revoked" />);
  const actorId=auth?.user?.id ?? manifest.data.context.actor_user_id,schoolId=manifest.data.context.institution_id;
  if(!actorId || !schoolId)return shell(<WorkspaceState state="revoked" />);
  const key=JSON.stringify([schoolId,actorId,environment.mode,environment.mode==="simulation" ? environment.namespaceId : "live"]);
  return shell(<ResourcesWorkspace key={key} schoolId={schoolId} actorId={actorId} timezone={manifest.data.context.time_zone ?? "UTC"} />);
}

const accessLost=(error:unknown)=>error instanceof ApiError && [401,403,404,410].includes(error.status);
const filters:Array<{value:ResourceFilter;label:string}>=[{value:"outstanding",label:"Out"},{value:"overdue",label:"Overdue"},{value:"returned",label:"Returned"},{value:"questions",label:"Questions"},{value:"all",label:"All"}];

export function ResourcesWorkspace({schoolId,actorId,timezone}: {schoolId:string;actorId:string;timezone:string}) {
  const environment=useExecutionEnvironment(),client=useQueryClient(),[params,setParams]=useSearchParams();
  const requested=params.get("view"),view:ResourceView=requested==="items" || requested==="mine" ? requested : "loans";
  const filter=params.get("state"),state:ResourceFilter=filters.some(item=>item.value===filter) ? filter as ResourceFilter : "outstanding";
  const search=params.get("search") ?? "",rawPage=Number(params.get("page")),page=Number.isFinite(rawPage) ? Math.max(1,Math.floor(rawPage) || 1) : 1,id=params.get("loan_id");
  const [issuing,setIssuing]=useState(false),[initialItem,setInitialItem]=useState("");
  const root=executionEnvironmentQueryKey(environment,["resources",schoolId,actorId]);
  const list=useQuery({queryKey:[...root,"list",view,state,search,page],queryFn:()=>getResources(schoolId,{view,state:view==="items" ? "all" : state,search,page}),enabled:!id});
  const detail=useQuery({queryKey:[...root,"loan",id],queryFn:()=>getResourceLoan(schoolId,id!),enabled:Boolean(id)});
  const change=(values:Record<string,string|undefined>)=>{
    const next=new URLSearchParams(params);for(const [key,value] of Object.entries(values))if(value)next.set(key,value);else next.delete(key);setParams(next);
  };
  const href=(loanId:string)=>{const next=new URLSearchParams(params);next.set("loan_id",loanId);next.delete("question_id");return `/areas/resources?${next}`;};
  const refresh=async()=>{
    await client.invalidateQueries({queryKey:root,refetchType:"none"});
    await (id ? detail.refetch({throwOnError:true}) : list.refetch({throwOnError:true}));
    await client.invalidateQueries({queryKey:["responsibility-workspace"]});
  };
  const readOnly=environment.mode==="simulation" && (environment.unavailable || environment.runStatus==="stopped" || environment.runStatus==="completed");
  if(id)return <div className="resources-workspace"><button className="is-text resource-back" onClick={()=>change({loan_id:undefined,question_id:undefined})}><ChevronLeft size={18} aria-hidden="true" />Back to resources</button>{detail.isPending ? <WorkspaceState state="loading" /> : !detail.data || accessLost(detail.error) ? <ResourceReadError error={detail.error} onRetry={()=>void detail.refetch()} /> : <>{detail.error ? <p role="alert" className="resource-caption">The current record could not refresh. <button className="is-text" onClick={()=>void detail.refetch()}>Try again</button></p> : null}<ResourceLoanView key={id} schoolId={schoolId} loan={detail.data} timezone={timezone} readOnly={readOnly || Boolean(detail.error)} questionId={params.get("question_id")} refresh={refresh} /></>}</div>;
  if(list.isPending)return <WorkspaceState state="loading" />;
  if(!list.data || accessLost(list.error))return <div className="resources-workspace"><ResourceReadError error={list.error} onRetry={()=>void list.refetch()} /></div>;
  const data=list.data,currentView=data.view,issue=()=>{setInitialItem("");setIssuing(true);};
  return <div className="resources-workspace">
    <header className="resource-heading"><div><h2>{currentView==="mine" ? "My borrowing" : currentView==="items" ? "Item catalogue" : "Borrowing"}</h2><p className="resource-caption">{data.totals.outstanding} out{data.totals.overdue ? ` · ${data.totals.overdue} overdue` : ""}{data.totals.questions ? ` · ${data.totals.questions} to review` : ""}</p></div>{data.can_issue && !readOnly ? <button disabled={Boolean(list.error)} onClick={issue}><Plus size={18} aria-hidden="true" />Issue item</button> : null}</header>
    {data.can_manage ? <nav className="resource-tabs" aria-label="Resources views">{([{id:"loans",label:"Loans"},{id:"items",label:"Items"},{id:"mine",label:"My borrowing"}] as const).map(item=><button key={item.id} className="is-secondary" aria-pressed={currentView===item.id} onClick={()=>change({view:item.id,state:undefined,page:undefined})}>{item.label}</button>)}</nav> : null}
    <div className="resource-filter"><ResourceSearch key={search} initial={search} onSearch={value=>change({search:value || undefined,page:undefined})} />{currentView!=="items" ? <label><span className="resource-visually-hidden">Loan status</span><select value={state} onChange={event=>change({state:event.target.value,page:undefined})}>{filters.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}</div>
    {list.error ? <p role="alert" className="resource-caption">The list could not refresh. <button className="is-text" onClick={()=>void list.refetch()}>Refresh list</button></p> : null}
    {currentView==="items" ? data.items.length ? <ul className="resource-list" aria-label="Items">{data.items.map(item=><li key={item.id}><div className="resource-entry"><ProductIcon name="resources" size={28} /><span><strong>{item.name}</strong><small>{item.asset_tag || "No asset tag"} · {item.campus_name}</small><small>{item.tracking_mode!=="individual" ? "Pooled stock · individual loans not supported" : item.unavailable_reason}</small></span><span className="resource-entry-end">{item.available && item.tracking_mode==="individual" ? <>{data.can_issue && !readOnly ? <button className="is-text" disabled={Boolean(list.error)} onClick={()=>{setInitialItem(item.id);setIssuing(true);}}>Issue</button> : <strong>Available</strong>}</> : item.active_loan_id ? <Link to={href(item.active_loan_id)}>View loan</Link> : <strong>Unavailable</strong>}</span></div></li>)}</ul> : <ResourceEmpty title={search ? "No items found" : "Your first item starts here"} action={!search && data.can_issue && !readOnly ? <button onClick={issue}>Issue an item</button> : undefined}>{search ? "Try another name or asset tag." : "Add one tagged copy as you issue it. No inventory setup required."}</ResourceEmpty>
      : data.loans.length ? <ul className="resource-list" aria-label={currentView==="mine" ? "My borrowing" : "Loans"}>{data.loans.map(loan=><li key={loan.id}><Link to={href(loan.id)} className="resource-entry"><ProductIcon name="resources" size={28} /><span><strong>{loan.title}</strong><small>{currentView==="mine" ? loan.custodian.label : loan.borrower.label} · {loan.asset_tag}</small><small>Due {resourceDate(loan.due_at,timezone)}{loan.question_count ? ` · ${loan.question_count} question${loan.question_count===1 ? "" : "s"}` : ""}</small></span><span className={`resource-entry-end${loan.state==="overdue" ? " resource-overdue" : ""}`}><strong>{resourceStateLabel(loan.state)}</strong><ChevronRight size={16} aria-hidden="true" /></span></Link></li>)}</ul> : <ResourceEmpty title={search ? "No matching loans" : state==="outstanding" ? "Nothing out right now" : state==="overdue" ? "Nothing overdue" : state==="questions" ? "No open questions" : "No loans to show"} action={!search && data.can_issue && !readOnly ? <button onClick={issue}>Issue an item</button> : undefined}>{currentView==="mine" ? "Items issued to you will appear here." : "A loan keeps the item, borrower and return history together."}</ResourceEmpty>}
    <ResourcePages page={data.pagination.page} hasMore={data.pagination.page*data.pagination.page_size<data.pagination.total} onChange={next=>change({page:String(next)})} />
    {issuing ? <ResourceIssueDialog schoolId={schoolId} actorId={actorId} timezone={timezone} initialItemId={initialItem} refresh={refresh} onClose={()=>setIssuing(false)} onSaved={loanId=>{setIssuing(false);change({loan_id:loanId,question_id:undefined});}} /> : null}
  </div>;
}

function ResourceSearch({initial,onSearch}:{initial:string;onSearch:(value:string)=>void}) {
  const [value,setValue]=useState(initial);
  return <form className="resource-search" role="search" onSubmit={(event:FormEvent)=>{event.preventDefault();onSearch(value.trim());}}><label className="resource-visually-hidden" htmlFor="resource-search">Find an item or borrower</label><input id="resource-search" type="search" maxLength={80} value={value} onChange={event=>setValue(event.target.value)} placeholder="Item, person or tag" /><button type="submit" className="is-secondary" aria-label="Search resources"><Search size={18} aria-hidden="true" /></button></form>;
}

export default ResourcesWorkspaceRoute;
