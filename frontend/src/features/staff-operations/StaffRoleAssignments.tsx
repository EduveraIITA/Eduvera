import { applicationNow } from "../simulation/applicationTime";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AccessDialog } from "./AccessDialog";
import { assignAccessRole, changeAssignmentRole, endClassRoleAssignment, type RoleAssignment } from "./access-api";
import { revokeResponsibility, type AdminStaffWorkspace, type StaffProfile } from "./api";
import { StaffAssignmentOverview } from "./StaffAssignmentOverview";
import { assignmentLink, assignmentStatus, assignmentWhen } from "./assignment-overview";
import "./access-roles.css";

import { TemporalInput } from "../../components/forms/TemporalInput";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import { ApiError } from "../../lib/api";
const formText=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value:"";};

type AssignmentProps={schoolId:string;profile:StaffProfile;data:AdminStaffWorkspace;refresh:()=>Promise<void>;focusAssignmentId?:string};
export function StaffRoleAssignments(props: AssignmentProps) {
  const auth=useOptionalAuth(),environment=useExecutionEnvironment();
  return <StaffRoleAssignmentsContext key={JSON.stringify([props.schoolId,props.profile.id,auth?.user?.id,executionEnvironmentIdentity(environment)])} {...props}/>;
}

/** A confirmed write is never resubmitted just because refreshing its view failed. */
function useAssignmentWrite(onSaved:()=>Promise<void>) {
  const active=useRef(true),pending=useRef(false),confirmed=useRef(false),unconfirmed=useRef(false);
  const [busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const refreshSaved=async()=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");
    try{await onSaved();}catch{if(active.current)setError(confirmed.current?"The change was saved. Couldn’t refresh assignments. Refresh to see the current record.":"The change is still unconfirmed. Couldn’t refresh assignments. Check the connection and refresh.");}
    finally{pending.current=false;if(active.current)setBusy(false);}
  };
  const write=async(operation:()=>Promise<unknown>)=>{
    if(pending.current||confirmed.current||unconfirmed.current)return;
    pending.current=true;setBusy(true);setError("");
    try{
      await operation();
      confirmed.current=true;
      if(!active.current)return;
      setAccepted(true);
      try{await onSaved();}catch{if(active.current)setError("The change was saved. Couldn’t refresh assignments. Refresh to see the current record.");}
    }catch(cause){if(active.current){
      const unknown=!(cause instanceof ApiError)||cause.status<400||cause.status>=500;
      unconfirmed.current=unknown;setUncertain(unknown);
      setError(unknown?"The change was not confirmed. Refresh assignments before trying again.":cause.message);
    }}
    finally{pending.current=false;if(active.current)setBusy(false);}
  };
  return {busy,accepted,uncertain,error,write,refreshSaved};
}

function StaffRoleAssignmentsContext({schoolId,profile,data,refresh,focusAssignmentId}: AssignmentProps) {
  const [adding,setAdding]=useState<string|null>(null);
  const [editing,setEditing]=useState<RoleAssignment|null>(null);
  const assignments=(data.role_assignments ?? []).filter((item)=>item.staff_profile_id===profile.id);
  const canAssign=Boolean(profile.user_id && profile.status==="active");
  return <section className="staff-role-assignments">
    <header><h3>Roles & assignments</h3><button className="staff-secondary" disabled={!canAssign} onClick={()=>setAdding("")}><Plus size={15}/> Assign role</button></header>
    <StaffAssignmentOverview key={profile.id} assignments={assignments} roles={data.access_roles ?? []} options={data.role_options} canAssign={canAssign} onAssign={(role)=>setAdding(role.id)} onManage={setEditing} focusAssignmentId={focusAssignmentId}/>
    <nav className="staff-assignment-links" aria-label="Assign operational work"><Link to="/areas/events/manage">Event staffing</Link><Link to="/areas/assessments/manage">Exam staffing</Link><Link to="/areas/departure/manage">Journey roster</Link></nav>
    {adding!==null ? <AssignRoleDialog schoolId={schoolId} profile={profile} data={data} initialRoleId={adding} onClose={()=>setAdding(null)} onSaved={async()=>{await refresh();setAdding(null);}}/> : null}
    {editing ? <ManageAssignment schoolId={schoolId} assignment={editing} data={data} onClose={()=>setEditing(null)} onSaved={async()=>{await refresh();setEditing(null);}}/> : null}
  </section>;
}

function AssignRoleDialog({schoolId,profile,data,initialRoleId,onClose,onSaved}: {schoolId:string;profile:StaffProfile;data:AdminStaffWorkspace;initialRoleId:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const roles=(data.access_roles ?? []).filter((item)=>item.is_active && ["class","institution"].includes(item.context_kind));
  const [roleId,setRoleId]=useState(initialRoleId || roles[0]?.id || "");
  const role=roles.find((item)=>item.id===roleId);
  const {busy,accepted,uncertain,error,write,refreshSaved}=useAssignmentWrite(onSaved);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);
    await write(()=>assignAccessRole(schoolId,{role_id:roleId,staff_profile_id:profile.id,scope_id:role?.context_kind==="class" ? formText(form,"class") : null,subject_id:formText(form,"subject") || null,starts_on:formText(form,"starts"),ends_on:formText(form,"ends") || null}));
  }
  return <AccessDialog title={`Assign role · ${profile.first_name}`} onClose={onClose} busy={busy}><form className="staff-form" onSubmit={(event)=>void submit(event)}>
    <fieldset className="staff-form-fields" disabled={busy||accepted||uncertain}>
    <label>Role<select value={roleId} onChange={(event)=>setRoleId(event.target.value)} required>{roles.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {role?.context_kind==="class" ? <><label>Class<select name="class" required defaultValue=""><option value="" disabled>Choose class</option>{data.references.classes.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select name="subject" defaultValue=""><option value="">All subjects</option>{data.references.subjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></> : <p className="staff-inline-note">Applies to this institution.</p>}
    <div className="staff-form-grid"><label>Starts<TemporalInput type="date" name="starts" defaultValue={new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(applicationNow())} required/></label><label>Ends (optional)<TemporalInput type="date" name="ends"/></label></div>
    <details><summary>Allowed actions</summary><ul>{role?.permissions.map((code)=><li key={code}>{data.role_options?.permissions.find((p)=>p.code===code)?.label ?? code}</li>)}</ul></details>
    <p className="staff-inline-note">For an exam, event or journey, select the person in that planning screen. It appears here automatically.</p>
    </fieldset>
    {error ? <p className="staff-error" role="alert">{error}</p> : null}
    <footer><button type="button" className="staff-secondary" disabled={busy} onClick={onClose}>{accepted||uncertain?"Close":"Cancel"}</button>{accepted||uncertain?<button type="button" className="staff-primary" disabled={busy} onClick={()=>void refreshSaved()}>{busy?"Refreshing…":"Refresh assignments"}</button>:<button className="staff-primary" disabled={busy || !role}>{busy ? "Assigning…" : "Assign role"}</button>}</footer>
  </form></AccessDialog>;
}

function ManageAssignment({schoolId,assignment,data,onClose,onSaved}: {schoolId:string;assignment:RoleAssignment;data:AdminStaffWorkspace;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [roleId,setRoleId]=useState(assignment.role_id);
  const [reason,setReason]=useState("");
  const {busy,accepted,uncertain,error,write,refreshSaved}=useAssignmentWrite(onSaved);
  const roles=(data.access_roles ?? []).filter((item)=>item.context_kind===assignment.context_kind && item.is_active);
  async function save(end=false) {
    await write(()=>end?(assignment.source_kind==="class_assignment"?endClassRoleAssignment(schoolId,assignment,reason):revokeResponsibility(schoolId,assignment.source_id,{reason,expected_revision:assignment.revision})):changeAssignmentRole(schoolId,assignment,roleId));
  }
  return <AccessDialog title="Manage assignment" onClose={onClose} busy={busy}><form className="staff-form" onSubmit={(event)=>{event.preventDefault();void save();}}>
    <fieldset className="staff-form-fields" disabled={busy||accepted||uncertain}>
    <p>{assignment.scope_label}</p><label>Role<select value={roleId} onChange={(event)=>setRoleId(event.target.value)}>{roles.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p className="staff-inline-note">Changes apply only to this assignment.</p>
    {["assignment","class_assignment"].includes(assignment.source_kind) ? <details><summary>End this assignment</summary><label>Reason<input value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={500}/></label><button className="staff-secondary" type="button" disabled={busy || reason.trim().length<4} onClick={()=>void save(true)}>End assignment</button></details> : assignmentLink(assignment,"principal") ? busy||accepted||uncertain?<span>Change staffing in the planning screen</span>:<Link to={assignmentLink(assignment,"principal")!}>Change staffing in the planning screen</Link> : null}
    </fieldset>
    {error ? <p className="staff-error" role="alert">{error}</p> : null}<footer><button type="button" className="staff-secondary" disabled={busy} onClick={onClose}>{accepted||uncertain?"Close":"Cancel"}</button>{accepted||uncertain?<button type="button" className="staff-primary" disabled={busy} onClick={()=>void refreshSaved()}>{busy?"Refreshing…":"Refresh assignments"}</button>:<button className="staff-primary" disabled={busy || roleId===assignment.role_id}>{busy ? "Saving…" : "Save assignment"}</button>}</footer>
  </form></AccessDialog>;
}

export function MyRoleAssignments({assignments}: {assignments:RoleAssignment[]}) {
  const current = assignments.filter((item)=>["active","scheduled"].includes(item.display_status));
  const history = assignments.filter((item)=>!["active","scheduled","offered"].includes(item.display_status));
  const cards = (items: RoleAssignment[], historical = false) => items.map((item)=>{const status=assignmentStatus(item);return <article className="staff-role-assignment" key={`${item.source_kind}:${item.source_id}:${item.user_id}`}>
    <header><strong>{item.role_name}</strong><span className={`staff-status staff-status--${status.tone}`}>{status.label}</span></header><p>{item.scope_label}</p><small>{assignmentWhen(item, historical)}</small>{!historical && assignmentLink(item,"teacher") ? <footer><Link to={assignmentLink(item,"teacher")!}>Open assigned work</Link></footer> : null}
  </article>;});
  return <div className="staff-role-assignments">
    {cards(current)}
    {history.length ? <details className="staff-assignment-history"><summary>Past assignments <span>{history.length}</span></summary>{cards(history, true)}</details> : null}
  </div>;
}
