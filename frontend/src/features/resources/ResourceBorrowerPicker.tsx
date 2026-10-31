import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getResourceOptions } from "./resourceApi";
import { ResourcePages } from "./ResourcePrimitives";

export interface ResourceBorrower { id: string; name: string; revision: number }

/** Borrowing uses the same canonical person, including people without app access. */
export function ResourceBorrowerPicker({ schoolId, actorId, initial, onClose, onSelected }: {
  schoolId: string;actorId:string;initial: ResourceBorrower | null; onClose: () => void; onSelected: (person: ResourceBorrower) => void;
}) {
  const environment=useExecutionEnvironment(),client=useQueryClient();
  const [selected,setSelected]=useState<{id:string;label:string}|null>(initial ? {id:initial.id,label:initial.name} : null);
  const [search,setSearch]=useState(""),[submitted,setSubmitted]=useState(""),[page,setPage]=useState(1);
  const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{const timer=setTimeout(()=>{setSubmitted(search.trim());setPage(1);},250);return()=>clearTimeout(timer);},[search]);
  const root=executionEnvironmentQueryKey(environment,["resources",schoolId,actorId]);
  const options=useQuery({queryKey:[...root,"people-options",submitted,page],queryFn:()=>getResourceOptions(schoolId,{search:submitted,page})});
  const active=useRef(true),pending=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const choose=async(id:string)=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");
    try {
      const fresh=await getResourceOptions(schoolId,{person_id:id}),person=fresh.people.find(item=>item.id===id);
      if(!fresh.can_manage || !person)throw new Error("This person is not available for the current Resources action. Refresh and choose again.");
      if(active.current)onSelected({id:person.id,name:person.label,revision:person.revision});
    } catch(cause){if(active.current)setError(cause instanceof Error ? cause.message : "This person could not be checked. Choose them again.");}
    finally{pending.current=false;if(active.current)setBusy(false);}
  };
  return <PlannerDialog title="Choose borrower" busy={busy} onClose={onClose}>
    <div className="resource-form">
      <div className="resource-label-row"><p className="resource-caption">One person responsible for this item.</p>{options.data?.can_add_people && !options.error ? <button type="button" className="is-secondary" disabled={busy} onClick={()=>setAdding(true)}><Plus size={18} aria-hidden="true" />Add people</button> : null}</div>
      <fieldset className="person-selector" disabled={busy}><legend>Borrower</legend>
        {selected ? <p className="person-selector__selected"><strong>{selected.label}</strong><button type="button" className="is-text" onClick={()=>setSelected(null)}>Change selection</button></p> : null}
        <label>Find a campus person<input type="search" maxLength={80} value={search} onChange={event=>setSearch(event.target.value)} autoComplete="off" /></label>
        {options.isPending ? <p role="status">Loading people…</p> : options.error || !options.data.can_manage ? <p role="alert">{options.error instanceof Error ? options.error.message : "Resources access is not available."} <button type="button" className="is-text" onClick={()=>void options.refetch()}>Try again</button></p> : <>
          <div className="participation-person-options">{options.data.people.map(person=><label key={person.id}><input type="radio" name="resource-borrower" checked={selected?.id===person.id} onChange={()=>{setSelected({id:person.id,label:person.label});setError("");setMessage("");}} /><span>{person.label}<small>Campus person</small></span></label>)}</div>
          {!options.data.people.length ? <p className="resource-caption">No matching people.</p> : null}
          {!options.data.can_add_people ? <p className="resource-caption">Your People manager can add someone new.</p> : null}
          <ResourcePages page={page} hasMore={page*options.data.pagination.page_size<options.data.pagination.people_total} onChange={setPage} label="Borrower result pages" />
        </>}
      </fieldset>
      {message ? <p role="status" className="resource-caption">{message}</p> : null}
      {error ? <p role="alert" className="resource-error">{error}</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" disabled={busy || !selected || Boolean(options.error) || !options.data?.can_manage} onClick={()=>{if(selected)void choose(selected.id);}}>{busy ? "Checking…" : "Use borrower"}</button></footer>
    </div>
    {adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={()=>setAdding(false)} onDone={people=>{
      if(!active.current || pending.current)return;setAdding(false);
      void client.invalidateQueries({queryKey:executionEnvironmentQueryKey(environment,["people.participants",schoolId])});
      void client.invalidateQueries({queryKey:root});
      if(people.length===1)void choose(people[0]!.id);
      else{setSelected(null);setMessage(`${people.length} people added. Choose the borrower from the list.`);}
    }} /> : null}
  </PlannerDialog>;
}
