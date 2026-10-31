import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import { createCampus } from "../office/api";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { createResourceItem, getResourceOptions, type ResourceItemCreation, type ResourceOptions } from "./resourceApi";
import { ResourceWriteFeedback } from "./ResourceWriteFeedback";
import { useResourceCommand } from "./useResourceCommand";

/** Creates exact tracked copies in the existing topology, never a pooled quantity. */
export function ResourceItemDialog({schoolId,options,timezone,refresh,onClose,onCreated}: {
  schoolId:string;options:ResourceOptions;timezone:string;refresh:()=>Promise<unknown>;onClose:()=>void;onCreated:(result:ResourceItemCreation)=>void;
}) {
  const [campuses,setCampuses]=useState(options.campuses),[campus,setCampus]=useState("");
  const [name,setName]=useState(""),[tag,setTag]=useState(""),[campusName,setCampusName]=useState(""),[campusCode,setCampusCode]=useState("");
  const [quantity,setQuantity]=useState("1");
  const count=Number(quantity),validQuantity=quantity!=="" && Number.isInteger(count) && count>=1 && count<=100;
  const tagLimit=count>1 ? 76 : 80,tagTooLong=tag.trim().length>tagLimit;
  const [confirmed,setConfirmed]=useState(false),[campusBusy,setCampusBusy]=useState(false),[campusUnknown,setCampusUnknown]=useState(false),[error,setError]=useState("");
  const pending=useRef(false),createdItem=useRef<ResourceItemCreation|null>(null),write=useResourceCommand({schoolId,kind:"item",refresh,onAccepted:id=>{
    if(createdItem.current?.id===id)onCreated(createdItem.current);
  }});
  useUnsavedChangesGuard(campusBusy || campusUnknown,"The campus creation has not been confirmed. Stay here to check the campus list.");
  const addCampus=async()=>{
    if(pending.current || campusUnknown || campuses.length || !confirmed)return;
    pending.current=true;setCampusBusy(true);setError("");
    try{
      const created=await createCampus(schoolId,{name:campusName.trim(),code:campusCode.trim(),campus_type:"main",is_primary:true,status:"active",timezone});
      setCampuses([{id:created.id,name:created.name}]);setCampus(created.id);
    }catch(cause){
      const uncertain=!(cause instanceof ApiError) || cause.status===409 || cause.status>=500 || cause.status<400;
      setCampusUnknown(uncertain);setError(uncertain ? "The campus result is not confirmed. Refresh the list before continuing; do not create it again." : cause instanceof Error ? cause.message : "The campus could not be added.");
    }finally{pending.current=false;setCampusBusy(false);}
  };
  const reviewCampuses=async()=>{
    if(pending.current)return;pending.current=true;setCampusBusy(true);setError("");
    try{
      const next=await getResourceOptions(schoolId);setCampuses(next.campuses);setCampus("");
      if(!next.campuses.length)setError("No campus is visible yet. Keep this action here and check again. No second creation will be sent.");
    }catch(cause){setError(cause instanceof Error ? cause.message : "The campus list could not be checked.");}
    finally{pending.current=false;setCampusBusy(false);}
  };
  const submit=(event:FormEvent)=>{
    event.preventDefault();if(!campus || campusUnknown)return;
    if(!validQuantity){setError("Choose a whole quantity from 1 to 100.");return;}
    if(tagTooLong){setError(`Use at most ${tagLimit} characters for the ${count>1 ? "tag prefix" : "asset tag"}.`);return;}
    setError("");
    const body={name:name.trim(),quantity:count,...(tag.trim() ? {asset_tag:tag.trim()} : {}),campus_id:campus};
    void write.execute(async command_id=>{
      const item=await createResourceItem(schoolId,{...body,command_id});
      if(item.id!==command_id || item.quantity!==body.quantity || !Array.isArray(item.created_items)
        || item.created_items.length!==body.quantity || item.created_items[0]?.id!==command_id
        || item.created_items.some(copy=>!copy || typeof copy.id!=="string" || !copy.id || copy.campus_id!==body.campus_id || copy.tracking_mode!=="individual")
        || new Set(item.created_items.map(copy=>copy.id)).size!==body.quantity)
        throw new Error("The response did not confirm every copy for this action. Keep it here and retry the same action.");
      createdItem.current=item;return item;
    });
  };
  const locked=write.locked || campusBusy;
  return <PlannerDialog title="Add an item" subtitle="Each copy tracked separately" busy={locked || campusUnknown} onClose={onClose}><form className="resource-form" onSubmit={submit}>
    <fieldset disabled={locked}>
      <div className="resource-item-identity"><label>Item name<input autoFocus required minLength={2} maxLength={160} value={name} onChange={event=>setName(event.target.value)} placeholder="Camera, book…" /></label><label>Quantity<input type="number" inputMode="numeric" required min={1} max={100} step={1} value={quantity} onChange={event=>setQuantity(event.target.value)} /></label></div>
      {quantity!=="" && !validQuantity ? <p className="resource-error" role="alert">Choose a whole quantity from 1 to 100.</p> : null}
      {validQuantity && count>1 ? <p className="resource-caption" role="status">{count} separate copies will be created.</p> : null}
      <label><span>{count>1 ? "Tag prefix" : "Asset tag"} <small className="resource-caption">Optional</small></span><input maxLength={tagLimit} value={tag} onChange={event=>setTag(event.target.value)} placeholder="Generated automatically" /></label>
      {tagTooLong ? <p className="resource-error" role="alert">Use at most {tagLimit} characters for the {count>1 ? "tag prefix" : "asset tag"}.</p> : null}
      {campuses.length ? <label>Campus<select required value={campus} onChange={event=>setCampus(event.target.value)}><option value="">Choose campus</option>{campuses.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : !campusUnknown ? <section className="resource-review"><h3>Add your first campus</h3><div className="resource-pair"><label>Campus name<input minLength={2} maxLength={160} value={campusName} onChange={event=>setCampusName(event.target.value)} /></label><label>Code<input maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={campusCode} onChange={event=>setCampusCode(event.target.value.toUpperCase())} /></label></div><label className="resource-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} /><span>Create this campus for the item catalogue.</span></label><button type="button" className="is-secondary" disabled={!confirmed || campusName.trim().length<2 || !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(campusCode)} onClick={()=>void addCampus()}>Create campus</button></section> : null}
    </fieldset>
    {error ? <p role="alert" className="resource-error">{error}</p> : null}
    {campusUnknown ? <div className="resource-write-state"><button type="button" className="is-secondary" disabled={campusBusy} onClick={()=>void reviewCampuses()}>{campusBusy ? "Checking…" : "Refresh campus list"}</button>{campuses.length ? <><p className="resource-caption">Choose an existing campus above. This does not assert which creation completed.</p><button type="button" disabled={!campus || campusBusy} onClick={()=>setCampusUnknown(false)}>Continue with selected campus</button></> : null}</div> : null}
    <ResourceWriteFeedback write={write} />
    {write.error && !write.locked ? <button type="button" className="is-text" disabled={campusBusy} onClick={()=>void reviewCampuses()}>Refresh campus choices</button> : null}
    <footer><button type="button" className="is-secondary" disabled={locked || campusUnknown} onClick={onClose}>Cancel</button><button type="submit" disabled={locked || campusUnknown || !campus || name.trim().length<2 || !validQuantity || tagTooLong}>{write.busy ? "Adding…" : validQuantity && count>1 ? `Add ${count} copies` : "Add item"}</button></footer>
  </form></PlannerDialog>;
}
