import { Check, ShieldCheck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { saveProfile, type ProfileDuty, type WorkProfile, type WorkProfileTemplate } from "./api";

export function RoleEditor({ school, profile, templates, duties, onSaved, onCancel }: {
  school:string; profile:WorkProfile|null; templates:WorkProfileTemplate[]; duties:ProfileDuty[];
  onSaved:()=>Promise<void>; onCancel:()=>void;
}) {
  const [name,setName]=useState(profile?.name ?? "");
  const [description,setDescription]=useState(profile?.description ?? "");
  const [selectedDuties,setSelectedDuties]=useState<string[]>(profile?.duty_ids ?? []);
  const [templateKey,setTemplateKey]=useState<string|null>(profile?.template_key ?? null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const dutyGroups=useMemo(()=>[...new Set(duties.map(duty=>duty.category))],[duties]);
  const chosen=duties.filter(duty=>selectedDuties.includes(duty.id));
  function chooseTemplate(template:WorkProfileTemplate) {
    setTemplateKey(template.key);
    setName(template.name);
    setDescription(template.description);
    setSelectedDuties(duties.filter(duty=>template.duty_codes.includes(duty.code)).map(duty=>duty.id));
  }
  const toggleDuty=(id:string)=>setSelectedDuties(current=>current.includes(id) ? current.filter(item=>item!==id) : [...current,id]);
  async function submit(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await saveProfile(school,{name,description,duty_ids:selectedDuties,template_key:templateKey,...(profile ? {expected_revision:profile.revision}: {})},profile?.id);
      await onSaved();
    } catch(cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <form className="office-panel roles-editor" onSubmit={event=>void submit(event)} aria-label={profile ? "Edit role" : "Create role"}>
    <div className="roles-section-heading"><div><span className="roles-eyebrow">ROLE</span><h2>{profile ? "Edit role" : "New role"}</h2></div><strong>{selectedDuties.length} responsibilities</strong></div>
    {!profile ? <section className="roles-template-picker" aria-label="Role templates"><p>Start with a common role</p><div>{templates.map(template=><button type="button" key={template.key} className={templateKey===template.key?"is-selected":""} onClick={()=>chooseTemplate(template)}><strong>{template.name}</strong><small>{template.description}</small></button>)}</div></section> : null}
    <div className="roles-form-grid">
      <label className="office-field">Role name<input value={name} onChange={event=>{setName(event.target.value);setTemplateKey(null);}} minLength={2} maxLength={80} required placeholder="e.g. Transport staff" /></label>
      <label className="office-field">Purpose<textarea value={description} onChange={event=>setDescription(event.target.value)} maxLength={500} rows={2} placeholder="A short description for administrators" /></label>
    </div>
    <fieldset disabled={busy} className="roles-duties"><legend>Responsibilities</legend>
      {dutyGroups.map(group=><section key={group} className="roles-duty-group"><h3>{group.replaceAll("_"," ")}</h3><div>{duties.filter(duty=>duty.category===group).map(duty=><label className={`roles-duty${selectedDuties.includes(duty.id)?" is-selected":""}`} key={duty.id}><input type="checkbox" checked={selectedDuties.includes(duty.id)} onChange={()=>toggleDuty(duty.id)} /><span><strong>{duty.name}</strong><small>{duty.description}</small></span>{selectedDuties.includes(duty.id)?<Check size={17}/>:null}</label>)}</div></section>)}</fieldset>
    <aside className="roles-calculated-note"><ShieldCheck size={19}/><div><strong>Access is automatic</strong><p>{chosen.length ? "People receive only the app access required by their active, scoped responsibilities." : "Choose what people in this role may be assigned."}</p></div></aside>
    {error ? <p className="office-alert" role="alert">{error}</p> : null}
    <div className="office-actions"><button type="button" className="office-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy || !selectedDuties.length}>{busy ? "Saving…" : "Save role"}</button></div>
  </form>;
}
