import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../../lib/api';
import { AuthLayout } from '../auth/AuthPages';
import '../office/office.css';
import './onboarding.css';
export default function JoinPage() {
  const auth=useAuth();const navigate=useNavigate();const [nextPath,setNextPath]=useState('/');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [accepted,setAccepted]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));setBusy(true);setError('');
    try{if(typeof data.email!=='string'||typeof data.token!=='string')throw new Error('Invitation details are invalid.');await apiFetch('/api/v1/auth/csrf/');const result=await apiFetch<{school_id:string;role:string}>('/api/v1/invitations/accept/',{method:'POST',body:JSON.stringify({...data,email:data.email.trim().toLowerCase(),token:data.token.trim()})});setNextPath(result.role==='admin'?`/principal/administration?school=${result.school_id}`:'/');setAccepted(true);}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  async function continueToLogin(){if(auth.status==='authenticated')await auth.logout();void navigate(`/login?next=${encodeURIComponent(nextPath)}`);}
  return <AuthLayout eyebrow="Institution invitation" title={accepted?'Your access is ready':'Accept invitation'} description="Use the code shared by your company team or school administrator.">{accepted?<><p role="status">Your institution membership is active. Sign in to start setting up your workspace.</p><button className="auth-primary-button" onClick={()=>void continueToLogin()}>Sign in</button></>:<form className="auth-form" onSubmit={event=>void submit(event)}><p>New account: choose a password. Existing account: use your current password.</p><fieldset disabled={busy} className="onboarding-fields"><label className="office-field">Invitation code<input name="token" required minLength={40} maxLength={100} autoComplete="off"/></label><label className="office-field">Email<input name="email" type="email" required autoComplete="email"/></label><label className="office-field">First name<input name="first_name" required maxLength={150} autoComplete="given-name"/></label><label className="office-field">Last name<input name="last_name" required maxLength={150} autoComplete="family-name"/></label><label className="office-field">Password<input name="password" type="password" required minLength={1} maxLength={128} autoComplete="off"/></label>{error?<p role="alert" className="auth-error">{error}</p>:null}<button className="auth-primary-button">{busy?'Activating…':'Accept invitation'}</button></fieldset><Link to="/login">Back to sign in</Link></form>}</AuthLayout>;
}
