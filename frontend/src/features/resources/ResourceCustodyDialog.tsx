import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useOptionalAuth } from "../auth/AuthContext";
import { changeResourceCustodian, getResourceCustodians, getResourceLoan, type ResourceLoanDetail } from "./resourceApi";
import { ResourcePages } from "./ResourcePrimitives";
import { ResourceWriteFeedback } from "./ResourceWriteFeedback";
import { useResourceCommand } from "./useResourceCommand";

/** Transfer handling responsibility only. Physical returns keep their own evidence. */
export function ResourceCustodyDialog({ schoolId, loan, refresh, onClose }: {
  schoolId:string;loan:ResourceLoanDetail;refresh:()=>Promise<unknown>;onClose:()=>void;
}) {
  const environment=useExecutionEnvironment(),actorId=useOptionalAuth()?.user?.id??"fixture-current-actor";
  const [current,setCurrent]=useState(loan),[selected,setSelected]=useState<{id:string;label:string}|null>(null);
  const [reason,setReason]=useState(""),[search,setSearch]=useState(""),[submitted,setSubmitted]=useState(""),[page,setPage]=useState(1);
  const [reviewing,setReviewing]=useState(false),[error,setError]=useState("");
  const write=useResourceCommand({schoolId,loanId:loan.id,refresh,onAccepted:onClose});
  useEffect(()=>{const timer=setTimeout(()=>{setSubmitted(search.trim());setPage(1);},250);return()=>clearTimeout(timer);},[search]);
  const options=useQuery({queryKey:executionEnvironmentQueryKey(environment,["resources",schoolId,actorId,loan.id,"custodians",current.revision,submitted,page]),queryFn:()=>getResourceCustodians(schoolId,loan.id,{search:submitted,page})});
  const locked=write.locked||reviewing,pending=write.busy||Boolean(write.recovery)||reviewing;
  const submit=(event:FormEvent)=>{
    event.preventDefault();if(!selected||reason.trim().length<3||locked||!current.can_change_custodian)return;
    const expected_revision=current.revision,custodian_person_id=selected.id,text=reason.trim();
    void write.execute(command_id=>changeResourceCustodian(schoolId,loan.id,{command_id,expected_revision,custodian_person_id,reason:text}),{loanId:loan.id,expectedRevision:expected_revision});
  };
  const review=async()=>{
    setReviewing(true);setError("");
    try{setCurrent(await getResourceLoan(schoolId,loan.id));write.clearObsolete();}
    catch(cause){setError(cause instanceof Error?cause.message:"The current loan could not be loaded.");}
    finally{setReviewing(false);}
  };
  return <PlannerDialog title="Change responsibility" subtitle={loan.title} busy={pending} onClose={onClose}>
    <form className="resource-form" onSubmit={submit}>
      <p className="resource-caption">Currently {current.custodian.label}. Returns stay separate.</p>
      {current.custody_recovery?<p className="resource-caption">Their access is unavailable. Choose who will take over.</p>:null}
      <fieldset disabled={locked} className="person-selector"><legend>New custodian</legend>
        <label>Find a custodian<input type="search" autoComplete="off" maxLength={80} value={search} onChange={event=>setSearch(event.target.value)} /></label>
        {selected?<p className="resource-caption">Selected: <strong>{selected.label}</strong></p>:null}
        {options.isPending?<p role="status">Loading custodians…</p>:options.error?<p role="alert">{options.error instanceof Error?options.error.message:"Custodians could not be loaded."} <button type="button" className="is-text" onClick={()=>void options.refetch()}>Try again</button></p>:<>
          <div className="participation-person-options">{options.data.people.map(person=><label key={person.id}><input type="radio" name="resource-custodian" checked={selected?.id===person.id} onChange={()=>setSelected(person)} /><span>{person.label}<small>Resources access</small></span></label>)}</div>
          {!options.data.people.length?<p className="resource-caption">No eligible custodians found.</p>:null}
          <ResourcePages page={page} hasMore={page*options.data.pagination.page_size<options.data.pagination.total} onChange={setPage} label="Custodian result pages" />
        </>}
        <label>Reason<textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={event=>setReason(event.target.value)} /></label>
      </fieldset>
      {!current.can_change_custodian?<p role="alert" className="resource-error">This responsibility can no longer be changed from your account.</p>:null}
      {error?<p role="alert" className="resource-error">{error}</p>:null}<ResourceWriteFeedback write={write} onReview={()=>void review()} />
      <footer><button type="button" className="is-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" disabled={locked||!current.can_change_custodian||!selected||reason.trim().length<3||Boolean(options.error)}>{write.busy?"Saving…":"Save responsibility"}</button></footer>
    </form>
  </PlannerDialog>;
}
