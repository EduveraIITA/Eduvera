import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { getInvitations,inviteMember,revokeMember,invitationState,type ReadyInvitation } from './api';
import { InvitationReceipt } from './InvitationReceipt';
import '../office/office.css';
import './onboarding.css';
export default function InvitationsPage() {
  const auth=useAuth();const portal=auth.hasPortal('principal')?'principal':'teacher';
  const schools=auth.memberships.filter(m=>m.role==='admin'||(m.role==='staff'&&m.permissions?.includes('members.invite')));
  const [selected,setSelected]=useState('');const school=selected||schools[0]?.school_id||'';
  const query=useQuery({queryKey:['invitations',school],queryFn:()=>getInvitations(school),enabled:!!school});
  const [role,setRole]=useState('staff');const [target,setTarget]=useState('');const [email,setEmail]=useState('');const [roleId,setRoleId]=useState('');const [invite,setInvite]=useState<ReadyInvitation|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try{const result=await inviteMember(school,{email,role,...(role==='student'?{student_id:target}:{}),...(role==='guardian'&&target?{guardian_id:target}:{}),...(role==='staff'&&roleId?{custom_role_id:roleId}:{})});setInvite({...result,email});await query.refetch();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  const records=role==='student'?query.data?.students:query.data?.guardians;
  const recordLabel=(record:NonNullable<typeof records>[number])=>{const admission='admission_number' in record&&typeof record.admission_number==='string'?` · ${record.admission_number}`:'';return `${record.name}${admission}`;};
  return <OperationsShell portal={portal} active="more" title="Invite members" backTo={`/${portal}/more`} contentHasHeading><div className="office-page institution-invitations"><header><h1>Invite members</h1><p>Activate accounts for staff, students and guardians.</p></header>
    {schools.length>1?<label className="office-field">Institution<select value={school} onChange={e=>{setSelected(e.target.value);setTarget('');setRoleId('');setInvite(null);setError('');}}>{schools.map(m=><option value={m.school_id} key={m.school_id}>{m.school_name}</option>)}</select></label>:null}
    {error?<p className="office-alert" role="alert">{error}</p>:null}{invite?<InvitationReceipt invite={invite} onClose={()=>setInvite(null)}/>:null}
    {!school?<p role="alert">School admin access or the Invite school members permission is required.</p>:query.isPending?<p role="status">Loading invitations…</p>:query.isError?<section className="office-panel"><p role="alert">{query.error.message}</p><button className="office-secondary" onClick={()=>void query.refetch()}>Retry</button></section>:query.data?<>
      <form className="office-panel office-form" aria-label="Invite member" onSubmit={event=>void submit(event)}><h2>Create invitation</h2><fieldset className="onboarding-fields" disabled={busy}><label className="office-field">Account role<select value={role} onChange={e=>{setRole(e.target.value);setTarget('');setRoleId('');setEmail('');}}><option value="staff">Staff</option><option value="student">Student</option><option value="guardian">Guardian</option>{query.data.can_invite_admin?<option value="admin">Administrator</option>:null}</select></label>
      {role==='student'||role==='guardian'?<><label className="office-field">{role==='student'?'Student record':'Guardian record'}<select value={target} required={role==='student'} onChange={e=>{setTarget(e.target.value);setEmail(records?.find(r=>r.id===e.target.value)?.email||'');}}><option value="">{role==='student'?'Select enrolled student':'Account access only'}</option>{records?.map(r=><option key={r.id} value={r.id}>{recordLabel(r)}</option>)}</select></label><p className="office-hint">Student and guardian records can exist without accounts. An invitation adds login access when needed. <Link to={`/${portal}/students`}>Open student directory</Link></p></>:null}
      <label className="office-field">Recipient email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label>
      {role==='staff'&&query.data.can_invite_admin?<label className="office-field">Role on joining<select value={roleId} onChange={e=>setRoleId(e.target.value)}><option value="">Default staff</option>{query.data.roles.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select><small>Create custom roles under <Link to="/principal/roles">Roles & permissions</Link>.</small></label>:null}
      {!query.data.can_invite_admin?<p className="office-hint">Your role can invite school members. School admins control administrator access and custom role assignment.</p>:null}<button className="office-primary">{busy?'Creating…':'Create invitation'}</button></fieldset></form>
      <section className="office-panel"><h2>Invitations</h2><ul className="office-list office-list--cards">{query.data.invitations.map(i=><li key={i.id}><div><strong>{i.email}</strong><span>{i.role} · expires {new Date(i.expires_at).toLocaleString()}</span></div><span>{invitationState(i)}</span>{invitationState(i)==='Pending'?<button disabled={busy} onClick={()=>{setBusy(true);setError('');void revokeMember(school,i.id).then(()=>query.refetch()).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Revoke</button>:null}</li>)}</ul>{!query.data.invitations.length?<p>No invitations yet.</p>:null}</section>
    </>:null}</div></OperationsShell>;
}
