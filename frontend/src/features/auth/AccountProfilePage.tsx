import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useAuth } from './AuthContext';
import { proFeaturesKey, useProFeatures, type ProFeaturesPreference } from './useProFeatures';
import { AssistantMemorySettings } from './AssistantMemorySettings';
import { DemoProfileSwitcher } from './DemoProfileSwitcher';
import { AgentChannelConnections } from './AgentChannelConnections';
import { CalendarConnections } from './CalendarConnections';
import './account-security.css';
import './account-profile.css';
import './account-navigation.css';

export function AccountProfilePage() {
  const auth=useAuth();
  const queryClient=useQueryClient();
  const preference=useProFeatures();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const location=useLocation();
  const navigate=useNavigate();
  const from=new URLSearchParams(location.search).get('from');
  const back=from && /^\/(principal|teacher|parent|student)(?:\/|$)/.test(from) && !from.includes('://') ? from : '/';
  const returnState=location.state as {accountReturnTo?:unknown;accountCanPop?:unknown}|null;
  const canPopBack=returnState?.accountReturnTo===back&&returnState.accountCanPop===true;
  const profileHref=`${location.pathname}${location.search}`;
  const backUrl=new URL(back,window.location.origin);
  const portal=(['principal','teacher','parent','student'].includes(backUrl.pathname.split('/')[1]??'')?backUrl.pathname.split('/')[1]
    :auth.user?.role==='admin'?'principal':auth.user?.role==='staff'?'teacher':auth.user?.role==='parent'?'parent':'student') as import('./AuthContext').Portal;
  const studentId=portal==='parent'?backUrl.searchParams.get('student_id')??undefined:undefined;
  async function setEnabled(enabled:boolean) {
    setBusy(true);setError('');
    try {
      const result=await apiFetch<ProFeaturesPreference>('/api/v1/auth/pro-features/',{method:'POST',body:JSON.stringify({enabled})});
      queryClient.setQueryData(proFeaturesKey(auth.user?.id),result);
      await queryClient.invalidateQueries({predicate:query=>String(query.queryKey[0]).startsWith('agent-')});
    } catch(cause) { setError(cause instanceof Error?cause.message:'Could not update Pro features.'); }
    finally { setBusy(false); }
  }
  return <main className="security-page account-profile-page">
    <header className="security-header"><button type="button" aria-label="Back" onClick={()=>{if(canPopBack)void navigate(-1);else void navigate(back,{replace:true});}}><ArrowLeft size={21}/></button><div><h1>Profile</h1><p>{auth.user?.display_name||auth.user?.email}</p></div></header>
    <DemoProfileSwitcher/>
    <section className="account-profile-group" aria-labelledby="pro-features-title">
      <div className="account-profile-row">
        <span className="account-profile-row__icon"><Sparkles size={20}/></span>
        <span className="account-profile-row__copy"><strong id="pro-features-title">Pro features</strong><small>Advanced assistant tools, charts and specialist AI</small></span>
        <button className="account-profile-switch" type="button" role="switch" aria-label="Pro features" aria-checked={preference.enabled}
          disabled={busy||preference.isPending||preference.isError} onClick={()=>void setEnabled(!preference.enabled)}><span/></button>
      </div>
      <p className="account-profile-explainer">Optional preview. Turning this off removes the AI assistant, specialist tools and charts, and dismisses unfinished AI work. Ordinary school screens and Messages stay available.</p>
    </section>
    {preference.isPending?<p className="account-profile-status" role="status">Loading preference…</p>:null}
    {preference.isError?<p className="security-alert" role="alert">Could not load your preference. <button type="button" onClick={()=>void preference.refetch()}>Try again</button></p>:null}
    {error?<p className="security-alert" role="alert">{error}</p>:null}
    <CalendarConnections portal={portal} studentId={studentId}/>
    {preference.enabled ? <><AgentChannelConnections portal={portal} studentId={studentId}/><AssistantMemorySettings userId={auth.user?.id}/></> : null}
    <Link className="account-profile-security" to={`/account/security?from=${encodeURIComponent(profileHref)}`} state={{accountReturnTo:profileHref,accountCanPop:true}}><ShieldCheck size={18}/> Account security <span aria-hidden="true">›</span></Link>
  </main>;
}
