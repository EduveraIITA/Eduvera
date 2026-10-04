import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getCompany,createInstitution,inviteAdmin,revokeAdmin,invitationState,type ReadyInvitation } from './api';
import { InvitationReceipt } from './InvitationReceipt';
import '../office/office.css';
import './onboarding.css';

export function normalizeInstitutionCode(value:string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,32)
    .replace(/-+$/g,'');
}

export default function CompanyPage() {
  const auth=useAuth();const query=useQuery({queryKey:['company','institutions'],queryFn:getCompany});
  const [creating,setCreating]=useState(false);const [invite,setInvite]=useState<ReadyInvitation|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [search,setSearch]=useState('');
  const [institutionName,setInstitutionName]=useState('');const [institutionCode,setInstitutionCode]=useState('');const [codeEdited,setCodeEdited]=useState(false);
  function openCreator(){setInstitutionName('');setInstitutionCode('');setCodeEdited(false);setError('');setCreating(true);}
  function updateName(value:string){setInstitutionName(value);if(!codeEdited)setInstitutionCode(normalizeInstitutionCode(value));}
  function updateCode(value:string){setCodeEdited(true);setInstitutionCode(value);}
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);const rawCode=form.get('code');const code=normalizeInstitutionCode(typeof rawCode==='string'?rawCode:'');setInstitutionCode(code);setError('');
    if(code.length<2){setError('Enter at least two letters or numbers for the institution code.');return;}
    form.set('code',code);setBusy(true);
    try{const result=await createInstitution(Object.fromEntries(form));setInvite(result.invitation);setCreating(false);await query.refetch();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  async function admin(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');
    const schoolId=form.get('school_id');const email=form.get('email');
    try{if(typeof schoolId!=='string'||typeof email!=='string')throw new Error('Administrator invitation details are invalid.');setInvite(await inviteAdmin(schoolId,email));await query.refetch();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  return <main className="company-console"><header className="company-top"><a href="/company" className="company-brand"><ShieldCheck/>Eduera <span>Company console</span></a><div><span>{auth.user?.display_name}</span><button className="office-secondary" onClick={()=>void auth.logout()}>Sign out</button></div></header><div className="office-page">
    <header className="company-title"><div><h1>Institutions</h1><p>Create a school or college and hand setup to its administrator.</p></div><button className="office-primary" disabled={busy} onClick={openCreator}><Plus size={16}/>Create institution</button></header>
    <ol className="institution-onboarding-steps" aria-label="Institution onboarding"><li><strong>1. Company provisions</strong><span>Create institution and admin invitation.</span></li><li><strong>2. Admin activates</strong><span>Accept the code and sign in.</span></li><li><strong>3. School takes over</strong><span>Set up terms, invite people and delegate roles.</span></li></ol>
    {error?<p className="office-alert" role="alert">{error}</p>:null}{invite?<InvitationReceipt invite={invite} onClose={()=>setInvite(null)}/>:null}
    {creating?<form className="office-panel office-form" aria-label="Create institution" onSubmit={event=>void create(event)}><h2>Create institution</h2><fieldset disabled={busy} className="onboarding-fields"><div className="office-form-grid"><label className="office-field">Institution name<input name="name" required minLength={2} maxLength={180} value={institutionName} onChange={event=>updateName(event.target.value)}/></label><label className="office-field">Institution type<select name="institution_kind"><option value="school">School</option><option value="college">College</option></select></label><div className="office-field"><label htmlFor="institution-code">Unique code</label><input id="institution-code" name="code" required minLength={2} maxLength={32} placeholder="e.g. lotus-college" value={institutionCode} onChange={event=>updateCode(event.target.value)} onBlur={()=>setInstitutionCode(normalizeInstitutionCode(institutionCode))} autoCapitalize="none" spellCheck={false} aria-describedby="institution-code-help"/><small id="institution-code-help">Generated from the name. You can edit it; spaces and capitals are converted automatically.</small></div><label className="office-field">Timezone<input name="timezone" defaultValue="Asia/Kolkata" required maxLength={80}/></label></div><label className="office-field">First administrator email<input type="email" name="admin_email" required maxLength={254}/></label><p className="office-hint">The recipient activates their own account. Company access does not grant access to student records.</p><div className="office-actions"><button type="button" className="office-secondary" onClick={()=>setCreating(false)}>Cancel</button><button className="office-primary">{busy?'Creating…':'Create & invite admin'}</button></div></fieldset></form>:null}
    {query.isPending?<p role="status">Loading institutions…</p>:query.isError?<section className="office-panel"><p role="alert">{query.error.message}</p><button className="office-secondary" onClick={()=>void query.refetch()}>Retry</button></section>:query.data?<>
      <label className="office-field">Find institution<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or code"/></label><div className="institution-list">{query.data.schools.filter(s=>(s.name+' '+s.code).toLowerCase().includes(search.toLowerCase())).map(s=><article className="office-panel" key={s.id}><div className="company-title"><div><h2><Building2 size={18}/>{s.name}</h2><p>{s.institution_kind} · {s.code}</p></div><span className="office-status">{s.admin_count?'Active':'Awaiting admin'}</span></div><p>{s.admin_count} active administrators · {s.pending_admins} pending admin invitations</p><details><summary>Invite or replace administrator invitation</summary><form className="office-form" onSubmit={event=>void admin(event)}><input type="hidden" name="school_id" value={s.id}/><label className="office-field">Administrator email<input type="email" name="email" required disabled={busy}/></label><button className="office-secondary" disabled={busy}>{busy?'Creating…':'Create admin invitation'}</button></form></details></article>)}</div>
      {!query.data.schools.length?<p>No institutions yet. Create the first school or college.</p>:!query.data.schools.some(s=>(s.name+' '+s.code).toLowerCase().includes(search.toLowerCase()))?<p>No matching institutions.</p>:null}
      <section className="office-panel"><h2>Admin invitations</h2><ul className="office-list office-list--cards">{query.data.invitations.map(i=><li key={i.id}><div><strong>{i.school_name}</strong><span>{i.email}</span><small>Expires {new Date(i.expires_at).toLocaleString()}</small></div><span>{invitationState(i)}</span>{invitationState(i)==='Pending'?<button disabled={busy} onClick={()=>{setBusy(true);setError('');void revokeAdmin(i.school_id!,i.id).then(()=>query.refetch()).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Revoke</button>:null}</li>)}</ul>{!query.data.invitations.length?<p>No admin invitations created yet.</p>:null}</section>
    </>:null}
  </div></main>;
}
