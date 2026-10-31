import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { schoolOptions } from '../auth/schoolOptions';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { deliveryPending,deliveryLabel,getInvitations,inviteMember,resendMemberInvitation,revokeMember,invitationState,type ReadyInvitation } from './api';
import { InvitationReceipt } from './InvitationReceipt';
import { Plus } from 'lucide-react';
import { useExecutionEnvironment } from '../simulation/ExecutionEnvironmentContext';
import { executionEnvironmentQueryKey } from '../simulation/executionEnvironmentQueryKey';
import '../office/office.css';
import './onboarding.css';
export default function InvitationsPage() {
  const environment=useExecutionEnvironment();
  if(environment.mode!=='live')return <OperationsShell active="more" title="Invitations" backTo="/more/setup/people"><div className="office-page institution-invitations"><section className="office-panel"><h2>App access is managed in Live</h2><p>Invitations and real account changes are unavailable in this simulation. Return to Live to manage app access.</p></section></div></OperationsShell>;
  return <LiveInvitationsPage/>;
}
function LiveInvitationsPage() {
  const environment=useExecutionEnvironment();
  const [invite,setInvite]=useState<ReadyInvitation|null>(null);
  const auth=useAuth();
  const navigate=useNavigate();
  const [params,setParams]=useSearchParams();
  const creating=params.get('create')==='invitation'||(!params.has('view')&&params.has('role'));
  const [filter,setFilter]=useState('Pending');
  const schools=schoolOptions(auth.memberships.filter(m=>m.role==='admin'||m.permissions?.includes('members.invite')));
  const [selected,setSelected]=useState('');const school=selected||schools.find(m=>m.school_id===params.get('school'))?.school_id||schools[0]?.school_id||'';
  const backTo=params.get('from')==='staff'?'/more/setup/responsibilities':params.get('from')==='students'?'/areas/people/records':params.get('from')==='settings'?`/more/setup/people/access?school=${encodeURIComponent(school)}`:'/more/setup/people';
  const query=useQuery({queryKey:executionEnvironmentQueryKey(environment,['invitations',school]),queryFn:()=>getInvitations(school),enabled:!!school&&environment.mode==='live',refetchInterval:q=>(deliveryPending(invite?.delivery)||q.state.data?.invitations.some(i=>deliveryPending(i.delivery)))?2000:false});
  const [role,setRole]=useState(()=>['staff','student','guardian'].includes(params.get('role')??'')?params.get('role')!:'staff');const [target,setTarget]=useState('');const [email,setEmail]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const listParams=new URLSearchParams(params);listParams.delete('create');
  // Older contextual links opened the form through `role` alone. Mark those
  // as history when they close; ordinary list -> create flows return to the
  // exact list URL that was pushed beneath the form.
  if(!listParams.has('view')&&listParams.has('role'))listParams.set('view','history');
  const listQuery=listParams.toString();
  const listPath=`/more/setup/people/invitations${listQuery?`?${listQuery}`:''}`;
  const showList=()=>{
    setInvite(null);setError('');setTarget('');setEmail('');
    void navigate(listPath,{replace:true});
  };
  async function submit(event:FormEvent) {
    event.preventDefault();if(environment.mode!=='live')return;
    if(role==='staff'&&!target){setError('Choose the staff person to invite.');return;}
    setBusy(true);setError('');setInvite(null);
    try{const result=await inviteMember(school,{email,role,...(role==='staff'?{person_id:target}:{}),...(role==='student'?{student_id:target}:{}),...(role==='guardian'&&target?{guardian_id:target}:{})});showList();setInvite({...result,email});await query.refetch();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  const records=role==='staff'?query.data?.staff:role==='student'?query.data?.students:query.data?.guardians;
  const recordLabel=(record:NonNullable<typeof records>[number])=>{const reference='staff_code' in record&&typeof record.staff_code==='string'?record.staff_code:'admission_number' in record&&typeof record.admission_number==='string'?record.admission_number:'';return `${record.name}${reference?` · ${reference}`:''}`;};
  const staffSetup=`/more/setup/responsibilities?section=directory&school=${encodeURIComponent(school)}`;
  const visibleInvitations=query.data?.invitations.filter(item=>filter==='All'||invitationState(item)===filter)??[];
  return <OperationsShell active="more" title={creating?'Invite member':'Invitations'} backTo={creating?listPath:backTo}><div className="office-page institution-invitations">
    {schools.length>1?<label className="office-field">Institution<select value={school} onChange={e=>{setSelected(e.target.value);setTarget('');setEmail('');setInvite(null);setError('');}}>{schools.map(m=><option value={m.school_id} key={m.school_id}>{m.school_name}</option>)}</select></label>:null}
    {error?<p className="office-alert" role="alert">{error}</p>:null}{invite?<InvitationReceipt key={invite.token} invite={{...invite,delivery:query.data?.invitations.find(i=>i.id===invite.id&&i.delivery_job_id===invite.delivery_job_id)?.delivery??invite.delivery}} onClose={()=>setInvite(null)}/>:null}
    {!school?<p role="alert">School admin access or the Invite school members permission is required.</p>:query.isPending?<p role="status">Loading invitations…</p>:query.isError?<section className="office-panel"><p role="alert">{query.error.message}</p><button className="office-secondary" onClick={()=>void query.refetch()}>Retry</button></section>:query.data?<>
      {creating&&!invite?<form className="office-panel office-form" aria-label="Invite member" onSubmit={event=>void submit(event)}><h2 className="sr-only">Create invitation</h2><fieldset className="onboarding-fields" disabled={busy}><label className="office-field">Account type<select value={role} onChange={e=>{setRole(e.target.value);setTarget('');setEmail('');}}><option value="staff">Staff</option><option value="student">Student</option><option value="guardian">Guardian</option>{query.data.can_invite_admin?<option value="admin">Administrator</option>:null}</select></label>
      {role==='staff'||role==='student'||role==='guardian'?<><label className="office-field">{role==='staff'?'Staff person':role==='student'?'Student record':'Guardian record'}<select value={target} required={role!=='guardian'} onChange={e=>{setTarget(e.target.value);setEmail(records?.find(r=>r.id===e.target.value)?.email||'');}}><option value="">{role==='staff'?'Choose staff person':role==='student'?'Select enrolled student':'Account access only'}</option>{records?.map(r=><option key={r.id} value={r.id}>{recordLabel(r)}</option>)}</select></label>{role==='staff'?<p className="office-hint">{records?.length?'Not listed? ':'No staff are ready for an invitation. '}<Link to={staffSetup}>Open staff onboarding</Link></p>:<p className="office-hint">Student and guardian records can exist without accounts. An invitation adds login access when needed. <Link to="/areas/people/records">Open student directory</Link></p>}</>:null}
      <p className="office-hint">Send an email with an invitation link and a single-use code. The recipient can check their inbox or spam folder.</p><label className="office-field">Recipient email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label>
      {role==='staff'?<p className="office-hint">Manage scoped work and fallback in <Link to="/more/setup/responsibilities">Responsibilities</Link>. Access follows active work.</p>:null}
      {!query.data.can_invite_admin?<p className="office-hint">You can invite institution members. Administrators control administrator access and staff work.</p>:null}<div className="office-actions"><button type="button" className="office-secondary" onClick={showList}>Cancel</button><button className="office-primary" disabled={role==='staff'&&!target}>{busy?'Sending…':'Send invitation email'}</button></div></fieldset></form>:null}
      {!creating?<><div className="invitation-toolbar"><label className="office-field"><span className="sr-only">Invitation status</span><select value={filter} onChange={event=>setFilter(event.target.value)}>{['Pending','Accepted','Expired','Revoked','All'].map(value=><option key={value}>{value}</option>)}</select></label><button className="office-primary" onClick={()=>{setError('');setInvite(null);setTarget('');setEmail('');setParams(current=>{const next=new URLSearchParams(current);next.set('create','invitation');return next;});}}><Plus size={18}/>Invite member</button></div>
      <section className="office-panel invitation-list" aria-label="Invitations"><ul className="office-list">{visibleInvitations.map(i=><li key={i.id}><div><strong>{i.email}</strong><span>{i.role} · expires {new Date(i.expires_at).toLocaleString()}</span><span>{invitationState(i)}</span><small aria-live="polite">{deliveryLabel(i.delivery)}</small></div>{['Pending','Expired'].includes(invitationState(i))?<button disabled={busy||deliveryPending(i.delivery)} onClick={()=>{setBusy(true);setError('');setInvite(null);void resendMemberInvitation(school,i.id).then(result=>{setInvite(result);return query.refetch();}).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Resend invitation email</button>:null}{invitationState(i)==='Pending'?<button disabled={busy} onClick={()=>{setBusy(true);setError('');setInvite(null);void revokeMember(school,i.id).then(()=>query.refetch()).catch(cause=>setError((cause as Error).message)).finally(()=>setBusy(false));}}>Revoke</button>:null}</li>)}</ul>{!visibleInvitations.length?<p className="office-empty">{query.data.invitations.length?`No ${filter.toLowerCase()} invitations.`:'No invitations yet.'}</p>:null}</section></>:null}
    </>:null}</div></OperationsShell>;
}
