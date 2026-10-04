import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { ScreenLoading, LiveRouteError } from "../school/LiveRouteState";
import { assignRole, deleteRole, getRoles, type CustomRole, type RoleMember } from "./api";
import { RoleEditor } from "./RoleEditor";
import "../office/office.css";
import "./roles.css";
export default function RolesPage() {
  const auth=useAuth();const schools=auth.memberships.filter(m=>m.role==='admin');
  const [selectedSchool,setSchool]=useState("");const school=selectedSchool || schools[0]?.school_id || "";
  const [editor,setEditor]=useState<CustomRole|null|undefined>();const [error,setError]=useState("");const [busy,setBusy]=useState("");const [notice,setNotice]=useState("");const [search,setSearch]=useState("");
  const query=useQuery({queryKey:['roles',school],queryFn:()=>getRoles(school),enabled:!!school,refetchOnWindowFocus:true});
  async function refresh(){await query.refetch();await auth.refresh();}
  async function assign(member:RoleMember,id:string){setBusy(member.user_id);setError("");try{await assignRole(school,member,id||null);await refresh();setNotice(`Access updated for ${member.name}.`);}catch(cause){setError((cause as Error).message);}finally{setBusy("");}}
  async function remove(role:CustomRole){setBusy(role.id);setError("");try{await deleteRole(school,role);await refresh();setNotice(`${role.name} deleted.`);}catch(cause){setError((cause as Error).message);}finally{setBusy("");}}
  return <OperationsShell portal="principal" active="more" title="Roles & permissions" subtitle="School access" backTo="/principal/more" contentHasHeading>
    <div className="office-page roles-page"><header className="roles-heading"><span className="office-panel-icon"><ShieldCheck size={22}/></span><div><h1>Roles & permissions</h1><p>Create roles, choose tools and assign staff.</p></div></header>
    {schools.length>1 ? <label className="office-field">School<select value={school} onChange={e=>{setSchool(e.target.value);setEditor(undefined);setNotice("");setError("");}}>{schools.map(m=><option key={m.school_id} value={m.school_id}>{m.school_name}</option>)}</select></label> : null}
    {notice ? <p className="roles-success" role="status">{notice}</p> : null}{error ? <p className="office-alert" role="alert">{error}</p> : null}
    {!school ? <p className="office-alert">An active admin or principal school membership is required.</p> : query.isPending ? <ScreenLoading/> : query.isError ? <LiveRouteError error={query.error} onRetry={query.refetch}/> : query.data ? <>
      <div className="roles-protected"><ShieldCheck size={18}/><div><strong>Admin & Principal</strong><p>Built-in school leadership access. Only school admins and principals can create, edit and assign custom roles.</p></div><span>Protected</span></div>
      {editor!==undefined ? <RoleEditor key={`${school}:${editor?.id ?? 'new'}`} school={school} role={editor} permissions={query.data.permissions} onCancel={()=>setEditor(undefined)} onSaved={async()=>{await refresh();setEditor(undefined);setNotice('Role saved. Assigned staff permissions take effect on their next request.');}}/> : <>
        <div className="roles-section-heading"><h2>Custom roles <span>({query.data.roles.length})</span></h2><button className="office-primary" onClick={()=>{setEditor(null);setNotice("");}}><Plus size={16}/> Create role</button></div>
        {!query.data.roles.length ? <div className="office-panel"><h3>No custom roles yet</h3><p>Start with an Accountant, Class Teacher or Office Coordinator role.</p><button className="office-secondary" onClick={()=>setEditor(null)}>Choose permissions</button></div> : <div className="roles-list">{query.data.roles.map(role=><article className="office-panel roles-card" key={role.id}><div><h3>{role.name}</h3><p>{role.description || 'Custom staff access'}</p><small>{role.permissions.length} permissions · {role.member_count} assigned staff</small></div><div className="roles-card-actions"><button className="office-secondary" onClick={()=>setEditor(role)} aria-label={`Edit ${role.name}`}><Pencil size={16}/><span>Edit</span></button><button className="office-secondary" disabled={!!busy || role.member_count>0} title={role.member_count ? 'Reassign staff before deleting' : 'Delete unused role'} onClick={()=>void remove(role)} aria-label={`Delete ${role.name}`}><Trash2 size={16}/></button></div></article>)}</div>}
      </>}
      <section className="office-panel"><h2>Staff assignments</h2><p className="roles-help">Assign one custom role per staff member. Choose Default staff to restore their existing teacher tools and individual office/finance grants.</p><label className="office-field">Find staff<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or email"/></label>
        <div className="roles-members">{query.data.members.filter(m=>(m.name+' '+m.email).toLowerCase().includes(search.toLowerCase())).map(member=><div className="roles-member" key={member.user_id}><div><strong>{member.name}</strong><small>{member.email}</small></div>{member.role==='admin' ? <span className="roles-badge">Admin / Principal</span> : <label className="office-field"><span className="roles-sr-only">Role for {member.name}</span><select aria-label={`Role for ${member.name}`} value={member.role_id || ''} disabled={!!busy} onChange={e=>void assign(member,e.target.value)}><option value="">Default staff</option>{query.data!.roles.map(role=><option value={role.id} key={role.id}>{role.name}</option>)}</select></label>}</div>)}</div>
        {!query.data.members.some(m=>(m.name+' '+m.email).toLowerCase().includes(search.toLowerCase())) ? <p>No staff match your search.</p> : null}
      </section>
    </> : null}</div>
  </OperationsShell>;
}
