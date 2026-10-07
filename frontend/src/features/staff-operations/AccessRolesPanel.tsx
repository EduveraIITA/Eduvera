import { Copy, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AccessDialog } from "./AccessDialog";
import { saveAccessRole, type AccessRole, type RoleContext, type RoleOptions } from "./access-api";
import type { AdminStaffWorkspace } from "./api";
import "./access-roles.css";

export function AccessRolesPanel({schoolId,data,refresh}: {schoolId:string;data:AdminStaffWorkspace;refresh:()=>Promise<void>}) {
  const [editing,setEditing]=useState<{role?:AccessRole;copy?:AccessRole}|null>(null);
  const [search,setSearch]=useState("");
  const roles=data.access_roles ?? [];
  const options=data.role_options;
  const visible=roles.filter((role)=>`${role.name} ${role.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="staff-panel staff-access-roles">
    <header><div><h2>Roles & access</h2><p>Use a built-in role or customise its allowed actions.</p></div><button className="staff-primary" disabled={!options} onClick={()=>setEditing({})}><Plus size={16}/> New role</button></header>
    <label className="staff-access-search"><span className="sr-only">Search roles</span><input type="search" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search roles" /></label>
    <div className="staff-access-role-list">{visible.map((role)=><article key={role.id}>
      <ShieldCheck size={21} aria-hidden="true"/><div><h3>{role.name}</h3><p>{options?.contexts.find((item)=>item.code===role.context_kind)?.label} · {role.permissions.length} {role.permissions.length===1?"action":"actions"} · {role.assignment_count} {role.assignment_count===1?"assignment":"assignments"}</p>
        <small>{role.source_kind==="system" ? "Built-in" : "Custom"}</small></div>
      <button className="staff-secondary" aria-label={`${role.source_kind==="system" ? "Customise" : "Edit"} ${role.name}`} onClick={()=>setEditing(role.source_kind==="system" ? {copy:role} : {role})}>{role.source_kind==="system" ? <Copy size={16}/> : <Pencil size={16}/>}<span>{role.source_kind==="system" ? "Customise" : "Edit"}</span></button>
    </article>)}</div>
    {!visible.length ? <p className="staff-empty">{search ? "No matching roles." : "No roles available."}</p> : null}
    {editing && options ? <AccessRoleEditor key={editing.role?.id ?? editing.copy?.id ?? "new"} schoolId={schoolId} roles={roles} options={options} role={editing.role} copy={editing.copy} onClose={()=>setEditing(null)} onSaved={async()=>{await refresh();setEditing(null);}}/> : null}
  </section>;
}

export function AccessRoleEditor({schoolId,roles,options,role,copy,onClose,onSaved}: {
  schoolId:string;roles:AccessRole[];options:RoleOptions;role?:AccessRole;copy?:AccessRole;onClose:()=>void;onSaved:()=>Promise<void>;
}) {
  const [templateId,setTemplateId]=useState(copy?.id ?? "");
  const [name,setName]=useState(role?.name ?? (copy ? `${copy.name} — custom` : ""));
  const [description,setDescription]=useState(role?.description ?? copy?.description ?? "");
  const [context,setContext]=useState<RoleContext>(role?.context_kind ?? copy?.context_kind ?? "class");
  const [selected,setSelected]=useState<string[]>(role?.permissions ?? copy?.permissions ?? []);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const available=options.permissions.filter((p)=>options.contexts.find((c)=>c.code===context)?.permissions.includes(p.code));
  const groups=[...new Set(available.map((item)=>item.group))];
  const changed=Boolean(role && [...selected].sort().join() !== [...role.permissions].sort().join());
  function toggle(code:string,checked:boolean) {
    setConfirmed(false);
    setSelected((old)=>checked ? [...new Set([...old.filter((item)=>!(code==="assessments.mark"&&item==="assessments.moderate")&&!(code==="assessments.moderate"&&item==="assessments.mark")),code,...(options.prerequisites[code] ?? [])])] : old.filter((item)=>item!==code && !options.prerequisites[item]?.includes(code)));
  }
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try { await saveAccessRole(schoolId,{name,description,context_kind:context,permissions:selected,...(!role ? {template_id:templateId || null} : {expected_revision:role.revision,expected_assignment_count:role.assignment_count})},role?.id); await onSaved(); }
    catch(cause) {setError((cause as Error).message);setBusy(false);}
  }
  return <AccessDialog title={role ? "Edit role" : "Create role"} onClose={onClose}>
    <form className="staff-form" onSubmit={(event)=>void submit(event)}>
      {!role ? <label>Start from<select value={templateId} onChange={(event)=>{const template=roles.find((item)=>item.id===event.target.value);setTemplateId(event.target.value);if(template){setContext(template.context_kind);setSelected(template.permissions);setName(`${template.name} — custom`);setDescription(template.description);}else{setSelected([]);}}}><option value="">Blank role</option>{roles.filter((item)=>item.is_active).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
      <label>Role name<input value={name} onChange={(event)=>setName(event.target.value)} required minLength={2} maxLength={100} placeholder="e.g. Class mentor"/></label>
      <label>Applies to<select value={context} disabled={Boolean(role)} onChange={(event)=>{setContext(event.target.value as RoleContext);setTemplateId("");setSelected([]);}}>{options.contexts.map((item)=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <fieldset className="staff-access-actions"><legend>Allowed actions</legend>{groups.map((group)=><div key={group}><h3>{group}</h3>{available.filter((item)=>item.group===group).map((item)=><label key={item.code}><input type="checkbox" checked={selected.includes(item.code)} onChange={(event)=>toggle(item.code,event.target.checked)}/><span>{item.label}</span></label>)}</div>)}</fieldset>
      <details className="staff-role-description"><summary>Description (optional)</summary><label><span className="sr-only">Role description</span><textarea value={description} onChange={(event)=>setDescription(event.target.value)} maxLength={500} rows={2}/></label></details>
      {changed && (role?.assignment_count ?? 0)>0 ? <label className="staff-role-impact"><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)}/><span>Apply these access changes to {role!.assignment_count} existing assignments.</span></label> : null}
      {error ? <p className="staff-error" role="alert">{error}</p> : null}
      <footer><button className="staff-secondary" type="button" onClick={onClose}>Cancel</button><button className="staff-primary" disabled={busy || !selected.length || (changed && (role?.assignment_count ?? 0)>0 && !confirmed)}>{busy ? "Saving…" : "Save role"}</button></footer>
    </form>
  </AccessDialog>;
}
