import { getDepartureWorkspace, type DepartureMode } from "../departure/api";
import "../departure/departure.css";
import { TemporalInput } from "../../components/forms/TemporalInput";
const value = (form: FormData, key: string) => { const entry = form.get(key); return typeof entry === "string" ? entry : ""; };
const modeLabel = (mode: string) => mode.replaceAll("_", " ");
export function DepartureRulesForm({data,submit,onDirtyChange=()=>undefined}:{data:Awaited<ReturnType<typeof getDepartureWorkspace>>;submit:(payload:Record<string,unknown>)=>void;onDirtyChange?:(dirty:boolean)=>void}){
  return <form className="departure-form" onChange={()=>onDirtyChange(true)} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);submit({expected_revision:data.policy.revision,enabled:form.get("enabled")==="on",enabled_modes:form.getAll("modes"),change_cutoff:value(form,"cutoff"),location_retention_hours:Number(value(form,"retention")),location_stale_seconds:Number(value(form,"stale"))});}}>
    <label className="departure-check"><input name="enabled" type="checkbox" defaultChecked={data.policy.enabled}/> Enable controlled departure</label>
    <fieldset className="departure-mode-options departure-span"><legend>Allowed arrangements</legend>{(["guardian_pickup","authorized_collector","independent_departure","school_transport","external_transport"] as DepartureMode[]).map(item=><label key={item}><input type="checkbox" name="modes" value={item} defaultChecked={data.policy.enabled_modes.includes(item)}/>{modeLabel(item)}</label>)}</fieldset>
    <label>Same-day cutoff<TemporalInput name="cutoff" type="time" defaultValue={data.policy.change_cutoff.slice(0,5)} required/></label>
    <label>Location retention (hours)<input name="retention" type="number" min={1} max={168} defaultValue={data.policy.location_retention_hours} required/></label>
    <label>Stale after (seconds)<input name="stale" type="number" min={30} max={600} defaultValue={data.policy.location_stale_seconds} required/></label>
    <button className="departure-primary">Save rules</button>
  </form>;
}
