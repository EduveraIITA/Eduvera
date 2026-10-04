import { useState, type FormEvent } from "react";
import { saveRole, type CustomRole, type Permission } from "./api";
export function RoleEditor({ school, role, permissions, onSaved, onCancel }: {school:string;role:CustomRole|null;permissions:Permission[];onSaved:()=>Promise<void>;onCancel:()=>void}) {
  const [name,setName]=useState(role?.name ?? "");
  const [description,setDescription]=useState(role?.description ?? "");
  const [selected,setSelected]=useState<string[]>(role?.permissions ?? []);
  const [search,setSearch]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const groups=[...new Set(permissions.map(p=>p.group))];
  const toggle=(code:string)=>setSelected(current=>current.includes(code) ? current.filter(p=>p!==code) : [...current,code]);
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try { await saveRole(school,{name,description,permissions:selected,...(role ? {expected_revision:role.revision}: {})},role?.id);await onSaved(); }
    catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  return <form className="office-panel roles-editor" onSubmit={event=>void submit(event)} aria-label={role ? "Edit role" : "Create role"}>
    <div className="roles-section-heading"><h2>{role ? `Edit ${role.name}` : "Create custom role"}</h2><span>{selected.length} of {permissions.length} selected</span></div>
    <label className="office-field">Role name<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required placeholder="e.g. Accountant" /></label>
    <label className="office-field">Description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={500} rows={2} placeholder="What this role is responsible for" /></label>
    <p className="roles-help">The selected permissions replace the staff member's default tool access. School, class and relationship checks still apply. Admin and principal access stays protected.</p>
    <label className="office-field">Find a permission<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search attendance, fees, messages…" /></label>
    <fieldset disabled={busy} className="roles-permissions"><legend>Permissions</legend>
      {groups.map(group=>{const all=permissions.filter(p=>p.group===group);const visible=all.filter(p=>(p.label+' '+p.description+' '+p.code).toLowerCase().includes(search.toLowerCase()));if(!visible.length)return null;return <fieldset key={group} className="roles-group"><legend>{group}</legend>
        <label className="office-check roles-group-toggle"><input type="checkbox" checked={all.every(p=>selected.includes(p.code))} onChange={e=>setSelected(current=>e.target.checked ? [...new Set([...current,...all.map(p=>p.code)])] : current.filter(code=>!all.some(p=>p.code===code)))} /> Select all in {group}</label>
        {visible.map(permission=><label className="roles-permission" key={permission.code}><input type="checkbox" checked={selected.includes(permission.code)} onChange={()=>toggle(permission.code)} /><span><strong>{permission.label}</strong><small>{permission.description}</small></span></label>)}
      </fieldset>})}
      {!permissions.some(p=>(p.label+' '+p.description+' '+p.code).toLowerCase().includes(search.toLowerCase())) ? <p>No matching permissions.</p> : null}
    </fieldset>
    {!selected.length ? <p className="roles-help">No staff tools selected. Assigned staff retain their account and personal family access.</p> : null}
    {error ? <p className="office-alert" role="alert">{error}</p> : null}
    <div className="office-actions"><button type="button" className="office-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save role"}</button></div>
  </form>;
}
