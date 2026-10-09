import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { getInvitations,inviteMember,resendMemberInvitation,revokeMember,invitationState,type ReadyInvitation } from './api';
import { InvitationReceipt } from './InvitationReceipt';
import { Plus } from 'lucide-react';
import '../office/office.css';
import './onboarding.css';
export default function InvitationsPage() {
  const auth=useAuth();const portal=auth.hasPortal('principal')?'principal':'teacher';
  const [params,setParams]=useSearchParams();
  const creating=params.get('create')==='invitation'||(!params.has('view')&&params.has('role'));
  const [filter,setFilter]=useState('Pending');
  const showList=()=>{setInvite(null);setError('');setTarget('');setEmail('');setParams(current=>{current.delete('create');current.set('view','history');return current;});};
  const schools=auth.memberships.filter(m=>m.role==='admin'||(m.role==='staff'&&m.permissions?.includes('members.invite')));
  const [selected,setSelected]=useState('');const school=selected||schools.find(m=>m.school_id===params.get('school'))?.school_id||schools[0]?.school_id||'';
  const backTo=params.get('from')==='staff'&&portal==='principal'?'/principal/staff':params.get('from')==='students'?`/${portal}/students`:params.get('from')==='settings'&&portal==='principal'?`/principal/administration?section=access&school=${encodeURIComponent(school)}`:`/${portal}/more`;
  const query=useQuery({queryKey:['invitations',school],queryFn:()=>getInvitations(school),enabled:!!school});
  const [role,setRole]=useState(()=>['staff','student','guardian'].includes(params.get('role')??'')?params.get('role')!:'staff');const [target,setTarget]=useState('');const [email,setEmail]=useState('');const [invite,setInvite]=useState<ReadyInvitation|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setInvite(null);
    try{const result=await inviteMember(school,{email,role,...(role==='student'?{student_id:target}:{}),...(role==='guardian'&&target?{guardian_id:target}:{})});showList();setInvite({...result,email});await query.refetch();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  const records=role==='student'?query.data?.students:query.data?.guardians;
  const recordLabel=(record:NonNullable<typeof records>[number])=>{const admission='admission_number' in record&&typeof record.admission_number==='string'?` · ${record.admission_number}`:'';return `${record.name}${admission}`;};
  const listParams=new URLSearchParams(params);listParams.delete('create');listParams.set('view','history');
  const visibleInvitations=query.data?.invitations.filter(item=>filter==='All'||invitationState(item)===filter)??[];
  return <OperationsShell portal={portal} active="more" title={creating?'Invite member':'Invitations'} backTo={creating?`/${portal}/invitations?${listParams}`:backTo} contentHasHeading><div className="office-page institution-invitations">
    {schools.length>1?<label className="office-field">Institution<select value={school} onChange={e=>{setSelected(e.target.value);setTarget('');setInvite(null);setError('');}}>{schools.map(m=><option value={m.school_id} key={m.school_id}>{m.school_name}</option>)}</select></label>:null}
    {error?<p className="office-alert" role="alert">{error}</p>:null}{invite?<InvitationReceipt key={invite.token} invite={invite} onClose={()=>setInvite(null)}/>:null}
    {!school?<p role="alert">School admin access or the Invite school members permission is required.</p>:query.isPending?<p role="status">Loading invitations…</p>:query.isError?<section className="office-panel"><p role="alert">{query.error.message}</p><button className="office-secondary" onClick={()=>void query.refetch()}>Retry</button></section>:query.data?<>
      {creating&&!invite?<form className="office-panel office-form" aria-label="Invite member" onSubmit={event=>void submit(event)}><h2 className="sr-only">Create invitation</h2><fieldset className="onboarding-fields" disabled={busy}><label className="office-field">Account type<select value={role} onChange={e=>{setRole(e.target.value);setTarget('');setEmail('');}}><option value="staff">Staff</option><option value="student">Student</option><option value="guardian">Guardian</option>{query.data.can_invite_admin?<option value="admin">Administrator</option>:null}</select></label>
      {role==='student'||role==='guardian'?<><label className="office-field">{role==='student'?'Student record':'Guardian record'}<select value={target} required={role==='student'} onChange={e=>{setTarget(e.target.value);setEmail(records?.find(r=>r.id===e.target.value)?.email||'');}}><option value="">{role==='student'?'Select enrolled student':'Account access only'}</option>{records?.map(r=><option key={r.id} value={r.id}>{recordLabel(r)}</option>)}</select></label><p className="office-hint">Student and guardian records can exist without accounts. An invitation adds login access when needed. <Link to={`/${portal}/students`}>Open student directory</Link></p></>:null}
      <p className="office-hint">Send an email with an invitation link and a single-use code. The recipient can check their inbox or spam folder.</p><label className="office-field">Recipient email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label>
      {role==='staff'?<p className="office-hint">{portal==='principal'?<>Manage positions and work assignments in <Link to="/principal/staff">Staff</Link>.</>:"An administrator manages staff positions and work assignments."} Access follows active work.</p>:null}
      {!query.data.can_invite_admin?<p className="office-hint">You can invite institution members. Administrators control administrator access and staff work.</p>:null}<div className="office-actions"><button type="button" className="office-secondary" onClick={showList}>Cancel</button><button className="office-primary">{busy?'Sending…':'Send invitation email'}</button></div></fieldset></form>:null}
      {!creating?<><div className="invitation-toolbar"><label className="office-field"><span className="sr-only">Invitation status</span><select value={filter} onChange={event=>setFilter(event.target.value)}>{['Pending','Accepted','Expired','Revoked','All'].map(value=><option key={value}>{value}</option>)}</select></label><button className="office-primary" onClick={()=>{setError('');setInvite(null);setTarget('');setEmail('');setParams(current=>{current.set('create','invitation');return current;});}}><Plus size={18}/>Invite member</button></div>
      <section className="office-panel invitation-list" aria-label="Invitations"><ul className="office-list">{visibleInvitations.map(i=><li key={i.id}><div><strong>{i.email}</strong><span>{i.role} · expires {new Date(i.expires_at).toLocaleString()}</span><span>{invitationState(i)}</span></div>{['Pending','Expired'].includes(invitationState(i))?<button disabled={busy} onClick={()=>{setBusy(true);setError('');setInvite(null);void resendMemberInvitation(school,i.id).then(result=>{setInvite(result);return query.refetch();}).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Resend invitation email</button>:null}{invitationState(i)==='Pending'?<button disabled={busy} onClick={()=>{setBusy(true);setError('');setInvite(null);void revokeMember(school,i.id).then(()=>query.refetch()).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Revoke</button>:null}</li>)}</ul>{!visibleInvitations.length?<p className="office-empty">{query.data.invitations.length?`No ${filter.toLowerCase()} invitations.`:'No invitations yet.'}</p>:null}</section></>:null}
    </>:null}</div></OperationsShell>;
}
