import {useEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {ShieldCheck,X} from "lucide-react";
import {changeGuardianAuthority,getGuardianAuthority,type AuthorityCommand,type AuthoritySnapshot,type GuardianAuthority} from "./api";

function dateLabel(value:string){return new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));}
function bounds(value:AuthoritySnapshot){return value.enabled?`${value.valid_from?`From ${dateLabel(value.valid_from)}`:"Existing grant"}${value.valid_until?` through ${dateLabel(value.valid_until)}`:" · no end date"}`:"Leave signing is not permitted.";}
export function GuardianAuthorityPanel({schoolId,id,onClose}:{schoolId:string;id:string;onClose:()=>void}){
  const heading=useRef<HTMLHeadingElement>(null);
  const client=useQueryClient();const [editing,setEditing]=useState<GuardianAuthority|null>(null);const [saved,setSaved]=useState(false);
  const query=useQuery({queryKey:["school","people","authority",schoolId,id],queryFn:()=>getGuardianAuthority(schoolId,id)});
  useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;heading.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  const data=query.data;
  return <section className="people-panel people-authority" aria-labelledby="authority-heading">
    <header className="people-heading"><h2 id="authority-heading" tabIndex={-1} ref={heading}><ShieldCheck size={20}/>Guardian permissions</h2><button type="button" className="people-secondary" aria-label="Close guardian permissions" disabled={Boolean(editing)} onClick={onClose}><X size={18}/></button></header>
    {query.isPending?<p role="status">Loading guardian permissions…</p>:null}
    {query.isError?<p role="alert" className="people-error">Permissions could not load. <button type="button" onClick={()=>void query.refetch()}>Try again</button></p>:null}
    {data?<>
      <p className="people-authority-names"><strong>{data.guardian_name}</strong><span>Guardian of {data.student_name}</span></p>
      <p className="people-muted">Leave signing only. This does not grant collection authority or change access to student records.</p>
      {saved?<p role="status" className="people-success">Permission updated. Previously signed requests remain in the record.</p>:null}
      <div className="people-authority-current"><h3>Sign leave requests</h3><strong>{data.effective?"Permitted now":data.enabled&&data.valid_from&&data.valid_from>data.today?"Scheduled":data.enabled?"Expired":"Not permitted"}</strong><p>{bounds(data)}</p>
        {data.source==="legacy"?<p className="people-muted">Existing school setting · not yet reverified here.</p>:null}
        {!editing?<button type="button" className="people-secondary" onClick={()=>{setSaved(false);setEditing(data);}}>Review permission</button>:null}
      </div>
      {editing?<AuthorityEditor schoolId={schoolId} data={editing} stale={editing.revision!==data.revision} onCancel={()=>setEditing(null)} onSaved={async()=>{
        setEditing(null);setSaved(true);await client.invalidateQueries({queryKey:["school","people"]});
        await client.invalidateQueries({queryKey:["school","parent"]});await client.invalidateQueries({queryKey:["school","student","leave"]});
      }}/>:null}
      <details className="people-authority-history"><summary>Permission history{data.history.length?` (${data.history.length})`:""}</summary>
        {data.history.length?<><p className="people-muted">Latest 50 changes. Dates use the school's calendar.</p><ol>{data.history.map(h=><li key={h.id}><strong>{h.result.enabled?"Grant recorded":"Permission revoked"}</strong><span>{bounds(h.result)}</span><p>{h.reason}</p><small>{h.actor_name} · {new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short"}).format(new Date(h.recorded_at))}</small></li>)}</ol></>:<p className="people-muted">No permission changes recorded here yet.</p>}
      </details>
    </>:null}
  </section>;
}

function AuthorityEditor({schoolId,data,stale,onCancel,onSaved}:{schoolId:string;data:GuardianAuthority;stale:boolean;onCancel:()=>void;onSaved:()=>Promise<void>}){
  const [enabled,setEnabled]=useState(data.enabled);const [start,setStart]=useState(data.today);const [end,setEnd]=useState(data.valid_until&&data.valid_until>=data.today?data.valid_until:"");
  const [reason,setReason]=useState("");const [review,setReview]=useState<AuthorityCommand|null>(null);const [verified,setVerified]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const [attempted,setAttempted]=useState(false);
  const title=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{title.current?.focus();},[review]);
  async function save(){if(!review||!verified||saving)return;setSaving(true);setAttempted(true);setError("");try{await changeGuardianAuthority(data.id,review);await onSaved();}catch(e){setError(e instanceof Error?e.message:"Could not update permission.");}finally{setSaving(false);}}
  return <form className="people-form people-authority-editor" onSubmit={e=>{e.preventDefault();setError("");setVerified(false);setReview({school_id:schoolId,expected_revision:data.revision,enabled,valid_from:enabled?start:null,valid_until:enabled&&end?end:null,reason:reason.trim(),verified:true,idempotency_key:crypto.randomUUID()});}}>
    <h3 ref={title} tabIndex={-1}>{review?"Confirm permission change":"Update leave-signing permission"}</h3>
    {stale?<p role="alert" className="people-error">{attempted?"The live setting changed. Retry the same save to confirm its outcome, or edit details and cancel to review the latest setting.":"This permission changed while you were editing. Cancel and review the latest setting."}</p>:null}
    {error?<p role="alert" className="people-error">{error}</p>:null}
    {review?<>
      <div className="people-warning"><strong>{review.enabled?`Allow ${data.guardian_name} to sign leave requests for ${data.student_name}`:`Revoke ${data.guardian_name}'s leave-signing permission for ${data.student_name}`}</strong><p>{review.enabled?bounds({...review,revision:data.revision,source:"reviewed"}):"Effective immediately. New signatures will be blocked; existing signatures and the family relationship will be retained."}</p><p>{review.reason}</p></div>
      <label className="people-confirm"><input type="checkbox" checked={verified} disabled={saving} onChange={e=>setVerified(e.target.checked)}/>I have verified this guardian's leave-signing authority with the school.</label>
      <footer className="people-authority-actions"><button type="button" className="people-secondary" disabled={saving} onClick={()=>{setReview(null);setError("");setAttempted(false);}}>Edit details</button><button type="button" className="people-primary" disabled={!verified||saving||(stale&&!attempted)} onClick={()=>void save()}>{saving?"Saving…":attempted&&error?"Retry same save":"Confirm permission"}</button></footer>
    </>:<>
      <label>Leave-signing permission<select value={enabled?"allow":"revoke"} onChange={e=>setEnabled(e.target.value==="allow")}><option value="allow">Allow signing</option><option value="revoke">Not permitted · revoke now</option></select></label>
      {enabled?<div className="people-form-grid"><label>Valid from<input type="date" required min={data.today} value={start} onChange={e=>setStart(e.target.value)}/></label><label>Valid through (optional)<input type="date" min={start||data.today} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>:<p className="people-muted">Revocation takes effect immediately after confirmation.</p>}
      <label>Reason for change<textarea required minLength={10} maxLength={500} rows={3} placeholder="Record the school-verified basis. Avoid sensitive personal details." value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <footer className="people-authority-actions"><button type="button" className="people-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="people-primary" disabled={stale||reason.trim().length<10}>Review change</button></footer>
    </>}
  </form>;
}
