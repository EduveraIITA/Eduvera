import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search, UserRound } from "lucide-react";
import { ApiError } from "../../lib/api";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { applicationNow } from "../simulation/applicationTime";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { ResourceBorrowerPicker, type ResourceBorrower } from "./ResourceBorrowerPicker";
import { ResourceItemDialog } from "./ResourceItemDialog";
import { getResourceOptions, issueResource, type ResourceItem } from "./resourceApi";
import { ResourcePages, ResourceReadError } from "./ResourcePrimitives";
import { resourceInputInstant, resourceInputTime, resourceInputZone } from "./resourceTime";
import { ResourceWriteFeedback } from "./ResourceWriteFeedback";
import { useResourceCommand } from "./useResourceCommand";

export function ResourceIssueDialog({schoolId,actorId,timezone,initialItemId="",continuation,refresh,onClose,onSaved}: {
  schoolId:string;actorId:string;timezone:string;initialItemId?:string;
  continuation?:{label:string;borrower:ResourceBorrower;dueAt:string;purpose:string};
  refresh:()=>Promise<unknown>;onClose:()=>void;onSaved:(id:string)=>void;
}) {
  const environment=useExecutionEnvironment();
  const [holding,setHolding]=useState(initialItemId),[borrower,setBorrower]=useState<ResourceBorrower|null>(continuation?.borrower??null),[due,setDue]=useState(continuation ? resourceInputTime(continuation.dueAt) : "");
  const [search,setSearch]=useState(""),[draftSearch,setDraftSearch]=useState(""),[page,setPage]=useState(1);
  const options=useQuery({queryKey:executionEnvironmentQueryKey(environment,["resources",schoolId,actorId,"options",search,page,holding]),queryFn:()=>getResourceOptions(schoolId,{search,page,holding_id:holding || undefined}),placeholderData:keepPreviousData});
  const [purpose,setPurpose]=useState(continuation?.purpose??""),[confirmed,setConfirmed]=useState(false),[components,setComponents]=useState<Array<{key:string;label:string;quantity:number}>>([]);
  const [peopleOpen,setPeopleOpen]=useState(false),[itemOpen,setItemOpen]=useState(false),[error,setError]=useState("");
  const [createdItem,setCreatedItem]=useState<ResourceItem|null>(null);
  const [createdQuantity,setCreatedQuantity]=useState(0);
  const write=useResourceCommand({schoolId,refresh,onAccepted:onSaved});
  const submit=(event:FormEvent)=>{
    event.preventDefault();setError("");
    if(!borrower || !holding || !confirmed || options.error)return;
    let dueAt:string;try{dueAt=resourceInputInstant(due);}catch{setError("Choose when the item is due back.");return;}
    if(Date.parse(dueAt)<=applicationNow().getTime()){setError("Choose a due time after this issue.");return;}
    const body={expected_revision:0,holding_id:holding,borrower_person_id:borrower.id,due_at:dueAt,custody_confirmed:true as const,custody_purpose:purpose.trim(),components:components.map(({label,quantity})=>({label:label.trim(),quantity}))};
    void write.execute(command_id=>issueResource(schoolId,{...body,command_id}));
  };
  const holdings=options.data?.holdings ?? [];
  const available=[...holdings,...(createdItem && !holdings.some(item=>item.id===createdItem.id) ? [createdItem] : [])].filter(item=>item.available && item.tracking_mode==="individual");
  const selected=available.find(item=>item.id===holding);
  return <PlannerDialog title="Issue item" busy={write.locked} onClose={onClose}>
    {options.isPending ? <div className="resource-form"><WorkspaceState state="loading" /></div> : !options.data || !options.data.can_manage || (options.error instanceof ApiError && [401,403,404,410].includes(options.error.status)) ? <div className="resource-form">{options.error ? <ResourceReadError error={options.error} onRetry={()=>void options.refetch()} /> : <WorkspaceState state="revoked" />}</div> : <form className="resource-form" onSubmit={submit}>
      {continuation ? <p className="resource-caption" role="status">{continuation.label} · Issue is recorded first, then linked to the stay. This does not record a move.</p> : null}
      <fieldset disabled={write.locked || Boolean(options.error)}>
        <div className="resource-label-row"><h3>Item</h3><button type="button" className="is-text" onClick={()=>setItemOpen(true)}><Plus size={18} aria-hidden="true" />Add item</button></div>
        {options.data.pagination.holdings_total>25 || search ? <div className="resource-item-search"><label>Find item<input type="search" maxLength={80} value={draftSearch} onChange={event=>setDraftSearch(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setSearch(draftSearch.trim());setPage(1);}}} placeholder="Name or asset tag" /></label><button type="button" className="is-secondary" aria-label="Find items" onClick={()=>{setSearch(draftSearch.trim());setPage(1);}}><Search size={18} aria-hidden="true" /></button></div> : null}
        {available.length ? <label><span className="resource-visually-hidden">Available copy</span><select required value={holding} onChange={event=>setHolding(event.target.value)}><option value="">Choose item</option>{available.map(item=><option key={item.id} value={item.id}>{item.name} · {item.asset_tag} · {item.campus_name}</option>)}</select></label> : <p className="resource-caption">No available tagged copies in these results.</p>}
        <ResourcePages page={page} hasMore={page*options.data.pagination.page_size<options.data.pagination.holdings_total} disabled={options.isFetching} label="Item choice pages" onChange={setPage} />
        {selected ? <p className="resource-caption">{selected.campus_name} · {selected.asset_tag}</p> : null}
        {createdQuantity>1 ? <p className="resource-caption" role="status">{createdQuantity} copies added · {selected ? "1 selected to issue" : "choose 1 copy to issue"}.</p> : null}
        <div className="resource-label-row"><h3>Borrower</h3>{borrower && !continuation ? <button type="button" className="is-text" onClick={()=>setPeopleOpen(true)}>Change</button> : null}</div>
        {borrower ? <div className="resource-person-choice"><UserRound size={24} aria-hidden="true" /><span><strong>{borrower.name}</strong><small>Campus person</small></span></div> : <button type="button" className="is-secondary" onClick={()=>setPeopleOpen(true)}><UserRound size={18} aria-hidden="true" />{options.data.can_add_people ? "Choose or add a person" : "Choose a person"}</button>}
        <label>Due back<TemporalInput type="datetime-local" required value={due} onChange={event=>setDue(event.target.value)} /></label>
        <p className="resource-caption">Time shown in {resourceInputZone()}.</p>
        <details><summary>Accessories <span className="resource-caption">Optional</span></summary><section><p className="resource-caption">The main item is included. Add any accessories to check back in.</p>{components.map((part,index)=><div className="resource-kit-part" key={part.key}><label>Accessory {index+1}<input required maxLength={160} value={part.label} onChange={event=>setComponents(previous=>previous.map(item=>item.key===part.key ? {...item,label:event.target.value} : item))} placeholder="Charger, lens…" /></label><label>Quantity<input required type="number" min={1} max={100} step={1} value={part.quantity} onChange={event=>setComponents(previous=>previous.map(item=>item.key===part.key ? {...item,quantity:Number(event.target.value)} : item))} /></label><button type="button" className="is-text" aria-label={`Remove accessory ${index+1}`} onClick={()=>setComponents(previous=>previous.filter(item=>item.key!==part.key))}>Remove</button></div>)}<button type="button" className="is-secondary" disabled={components.length>=20} onClick={()=>setComponents(previous=>[...previous,{key:crypto.randomUUID(),label:"",quantity:1}])}><Plus size={16} aria-hidden="true" />Add accessory</button></section></details>
        <label>Purpose<input required minLength={5} maxLength={500} value={purpose} onChange={event=>setPurpose(event.target.value)} placeholder="What is this item being used for?" /></label>
        <div className="resource-review"><p className="resource-caption">Custodian · {options.data.actor.label}</p><label className="resource-check"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} /><span>I am issuing this item and taking responsibility for its return record.</span></label></div>
      </fieldset>
      {options.error ? <div role="alert"><p className="resource-error">Item choices could not refresh.</p><button type="button" className="is-secondary" onClick={()=>void options.refetch()}>Refresh choices</button></div> : null}
      {error ? <p role="alert" className="resource-error">{error}</p> : null}<ResourceWriteFeedback write={write} />
      <footer><button type="button" className="is-secondary" disabled={write.locked} onClick={onClose}>Cancel</button><button type="submit" disabled={write.locked || Boolean(options.error) || !selected || !borrower || !due || !confirmed || purpose.trim().length<5}>{write.busy ? "Issuing…" : "Issue item"}</button></footer>
    </form>}
    {peopleOpen ? <ResourceBorrowerPicker schoolId={schoolId} actorId={actorId} initial={borrower} onClose={()=>setPeopleOpen(false)} onSelected={person=>{setBorrower(person);setPeopleOpen(false);}} /> : null}
    {itemOpen && options.data ? <ResourceItemDialog schoolId={schoolId} options={options.data} timezone={timezone} refresh={async()=>{await options.refetch({throwOnError:true});await refresh();}} onClose={()=>setItemOpen(false)} onCreated={result=>{const first=result.created_items[0]!;setCreatedItem(first);setCreatedQuantity(result.quantity);setHolding(first.id);setItemOpen(false);}} /> : null}
  </PlannerDialog>;
}
