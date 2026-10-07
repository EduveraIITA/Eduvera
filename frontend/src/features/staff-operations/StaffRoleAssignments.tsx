import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AccessDialog } from "./AccessDialog";
import { assignAccessRole, changeAssignmentRole, endClassRoleAssignment, type RoleAssignment } from "./access-api";
import { revokeResponsibility, type AdminStaffWorkspace, type StaffProfile } from "./api";
import { StaffAssignmentOverview } from "./StaffAssignmentOverview";
import { assignmentLink, assignmentStatus, assignmentWhen } from "./assignment-overview";
import "./access-roles.css";

const formText=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value:"";};

export function StaffRoleAssignments({schoolId,profile,data,refresh}: {schoolId:string;profile:StaffProfile;data:AdminStaffWorkspace;refresh:()=>Promise<void>}) {
  const [adding,setAdding]=useState<string|null>(null);
  const [editing,setEditing]=useState<RoleAssignment|null>(null);
  const assignments=(data.role_assignments ?? []).filter((item)=>item.staff_profile_id===profile.id);
  const canAssign=Boolean(profile.user_id && profile.status==="active");
  return <section className="staff-role-assignments">
    <header><h3>Roles & assignments</h3><button className="staff-secondary" disabled={!canAssign} onClick={()=>setAdding("")}><Plus size={15}/> Assign role</button></header>
    <StaffAssignmentOverview key={profile.id} assignments={assignments} roles={data.access_roles ?? []} options={data.role_options} canAssign={canAssign} onAssign={(role)=>setAdding(role.id)} onManage={setEditing}/>
    <nav className="staff-assignment-links" aria-label="Assign operational work"><Link to="/principal/events">Event staffing</Link><Link to="/principal/assessments">Exam staffing</Link><Link to="/principal/departure">Journey roster</Link></nav>
    {adding!==null ? <AssignRoleDialog schoolId={schoolId} profile={profile} data={data} initialRoleId={adding} onClose={()=>setAdding(null)} onSaved={async()=>{await refresh();setAdding(null);}}/> : null}
    {editing ? <ManageAssignment schoolId={schoolId} assignment={editing} data={data} onClose={()=>setEditing(null)} onSaved={async()=>{await refresh();setEditing(null);}}/> : null}
  </section>;
}

function AssignRoleDialog({schoolId,profile,data,initialRoleId,onClose,onSaved}: {schoolId:string;profile:StaffProfile;data:AdminStaffWorkspace;initialRoleId:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const roles=(data.access_roles ?? []).filter((item)=>item.is_active && ["class","institution"].includes(item.context_kind));
  const [roleId,setRoleId]=useState(initialRoleId || roles[0]?.id || "");
  const role=roles.find((item)=>item.id===roleId);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);
    try {await assignAccessRole(schoolId,{role_id:roleId,staff_profile_id:profile.id,scope_id:role?.context_kind==="class" ? formText(form,"class") : null,subject_id:formText(form,"subject") || null,starts_on:formText(form,"starts"),ends_on:formText(form,"ends") || null});await onSaved();}
    catch(cause){setError((cause as Error).message);setBusy(false);}
  }
  return <AccessDialog title={`Assign role · ${profile.first_name}`} onClose={onClose}><form className="staff-form" onSubmit={(event)=>void submit(event)}>
    <label>Role<select value={roleId} onChange={(event)=>setRoleId(event.target.value)} required>{roles.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {role?.context_kind==="class" ? <><label>Class<select name="class" required defaultValue=""><option value="" disabled>Choose class</option>{data.references.classes.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select name="subject" defaultValue=""><option value="">All subjects</option>{data.references.subjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></> : <p className="staff-inline-note">Applies to this institution.</p>}
    <div className="staff-form-grid"><label>Starts<input type="date" name="starts" defaultValue={new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date())} required/></label><label>Ends (optional)<input type="date" name="ends"/></label></div>
    <details><summary>Allowed actions</summary><ul>{role?.permissions.map((code)=><li key={code}>{data.role_options?.permissions.find((p)=>p.code===code)?.label ?? code}</li>)}</ul></details>
    <p className="staff-inline-note">For an exam, event or journey, select the person in that planning screen. It appears here automatically.</p>
    {error ? <p className="staff-error" role="alert">{error}</p> : null}
    <footer><button type="button" className="staff-secondary" onClick={onClose}>Cancel</button><button className="staff-primary" disabled={busy || !role}>{busy ? "Assigning…" : "Assign role"}</button></footer>
  </form></AccessDialog>;
}

function ManageAssignment({schoolId,assignment,data,onClose,onSaved}: {schoolId:string;assignment:RoleAssignment;data:AdminStaffWorkspace;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [roleId,setRoleId]=useState(assignment.role_id);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const roles=(data.access_roles ?? []).filter((item)=>item.context_kind===assignment.context_kind && item.is_active);
  async function save(end=false) {
    setBusy(true);setError("");
    try {if(end) {if(assignment.source_kind==="class_assignment")await endClassRoleAssignment(schoolId,assignment,reason);else await revokeResponsibility(schoolId,assignment.source_id,{reason,expected_revision:assignment.revision});}else await changeAssignmentRole(schoolId,assignment,roleId);await onSaved();}
    catch(cause){setError((cause as Error).message);setBusy(false);}
  }
  return <AccessDialog title="Manage assignment" onClose={onClose}><form className="staff-form" onSubmit={(event)=>{event.preventDefault();void save();}}>
    <p>{assignment.scope_label}</p><label>Role<select value={roleId} onChange={(event)=>setRoleId(event.target.value)}>{roles.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p className="staff-inline-note">Changes apply only to this assignment.</p>
    {["assignment","class_assignment"].includes(assignment.source_kind) ? <details><summary>End this assignment</summary><label>Reason<input value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={500}/></label><button className="staff-secondary" type="button" disabled={busy || reason.trim().length<4} onClick={()=>void save(true)}>End assignment</button></details> : assignmentLink(assignment,"principal") ? <Link to={assignmentLink(assignment,"principal")!}>Change staffing in the planning screen</Link> : null}
    {error ? <p className="staff-error" role="alert">{error}</p> : null}<footer><button type="button" className="staff-secondary" onClick={onClose}>Cancel</button><button className="staff-primary" disabled={busy || roleId===assignment.role_id}>{busy ? "Saving…" : "Save assignment"}</button></footer>
  </form></AccessDialog>;
}

export function MyRoleAssignments({assignments}: {assignments:RoleAssignment[]}) {
  return <div className="staff-role-assignments">{assignments.filter((item)=>["active","scheduled"].includes(item.display_status)).map((item)=>{const status=assignmentStatus(item);return <article className="staff-role-assignment" key={`${item.source_kind}:${item.source_id}:${item.user_id}`}>
    <header><strong>{item.role_name}</strong><span className={`staff-status staff-status--${status.tone}`}>{status.label}</span></header><p>{item.scope_label}</p><small>{assignmentWhen(item, true)}</small>{assignmentLink(item,"teacher") ? <footer><Link to={assignmentLink(item,"teacher")!}>Open assigned work</Link></footer> : null}
  </article>;})}</div>;
}
