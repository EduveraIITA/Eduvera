import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ProductIcon } from '../../components/ProductIcon';
import { AssistantIcon } from '../assistant/AssistantIcon';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { authDestination, useAuth } from './AuthContext';
import { safeAccountReturnTarget } from './accountReturnTarget';
import { proFeaturesKey, useProFeatures, type ProFeaturesPreference } from './useProFeatures';
import { AssistantMemorySettings } from './AssistantMemorySettings';
import { DemoProfileSwitcher } from './DemoProfileSwitcher';
import { AgentChannelConnections } from './AgentChannelConnections';
import { CalendarConnections } from './CalendarConnections';
import { AppearanceControl } from '../appearance';
import { useOptionalExecutionEnvironment } from '../simulation/ExecutionEnvironmentContext';
import { profileConnectionAudience } from './profileConnectionScope';
import { AccountNameEditor } from './AccountNameEditor';
import './account-security.css';
import './account-profile.css';
import './account-navigation.css';
import './account-profile-layout.css';

export function AccountProfilePage({
  presentation = "standalone",
  includeConnections = true,
  securityHref,
}: {
  presentation?: "standalone" | "workspace";
  includeConnections?: boolean;
  securityHref?: string;
} = {}) {
  const auth=useAuth();
  const simulation=useOptionalExecutionEnvironment()?.mode==='simulation';
  const queryClient=useQueryClient();
  const preference=useProFeatures();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [failedAvatar,setFailedAvatar]=useState<string|null>(null);
  const location=useLocation();
  const navigate=useNavigate();
  const from=safeAccountReturnTarget(new URLSearchParams(location.search).get('from'));
  const back=from??authDestination(auth);
  const returnState=location.state as {accountReturnTo?:unknown;accountCanPop?:unknown}|null;
  const canPopBack=Boolean(from)&&safeAccountReturnTarget(returnState?.accountReturnTo)===from&&returnState?.accountCanPop===true;
  const profileHref=`${location.pathname}${location.search}`;
  const backUrl=new URL(back,window.location.origin);
  const connectionAudience=includeConnections?profileConnectionAudience(auth.memberships,backUrl.pathname):null;
  const studentId=connectionAudience==='parent'?backUrl.searchParams.get('student_id')??undefined:undefined;
  const accountLabel=auth.user?.display_name?.trim()||auth.user?.email||'Your account';
  const accountInitials=accountLabel.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase();
  async function setEnabled(enabled:boolean) {
    setBusy(true);setError('');
    try {
      const result=await apiFetch<ProFeaturesPreference>('/api/v1/auth/pro-features/',{method:'POST',body:JSON.stringify({enabled})});
      queryClient.setQueryData(proFeaturesKey(auth.user?.id),result);
      await queryClient.invalidateQueries({predicate:query=>String(query.queryKey[0]).startsWith('agent-')});
    } catch(cause) { setError(cause instanceof Error?cause.message:'Could not update Pro features.'); }
    finally { setBusy(false); }
  }
  const content = <>
    <section className="account-profile-identity" aria-label="Signed-in account">
      <span className="account-profile-identity__avatar" aria-hidden="true">
        {auth.user?.avatar_url&&failedAvatar!==auth.user.avatar_url
          ? <img src={auth.user.avatar_url} alt="" onError={()=>setFailedAvatar(auth.user?.avatar_url??null)}/>
          : accountInitials}
      </span>
      <div><span className="account-profile-identity__label">Signed-in account</span><strong>{accountLabel}</strong>
        {auth.user?.email&&auth.user.email!==accountLabel?<span className="account-profile-identity__email" aria-label={`Sign-in email: ${auth.user.email}`}>{auth.user.email}</span>:null}
      </div>
    </section>
    <AccountNameEditor/>
    <DemoProfileSwitcher/>
    <div className="account-profile-appearance"><AppearanceControl/></div>
    <section className="account-profile-group" aria-labelledby="pro-features-title">
      <div className="account-profile-row">
        <span className="account-profile-row__icon"><AssistantIcon size={26}/></span>
        <span className="account-profile-row__copy"><strong id="pro-features-title">Pro features</strong><small>Advanced assistant tools, charts and specialist AI</small></span>
        <button className="account-profile-switch" type="button" role="switch" aria-label="Pro features" aria-checked={preference.enabled}
          disabled={busy||preference.isPending||preference.isError} onClick={()=>void setEnabled(!preference.enabled)}><span/></button>
      </div>
      <p className="account-profile-explainer">Optional preview. Turning this off removes the AI assistant, specialist tools and charts, and dismisses unfinished AI work. Ordinary school screens and Messages stay available.</p>
    </section>
    {preference.isPending?<p className="account-profile-status" role="status">Loading preference…</p>:null}
    {preference.isError?<p className="security-alert" role="alert">Could not load your preference. <button type="button" onClick={()=>void preference.refetch()}>Try again</button></p>:null}
    {error?<p className="security-alert" role="alert">{error}</p>:null}
    {connectionAudience?<CalendarConnections audience={connectionAudience} studentId={studentId}/>:null}
    {preference.enabled ? <>{connectionAudience?<AgentChannelConnections audience={connectionAudience} studentId={studentId}/>:null}{simulation ? <section className="account-profile-group" aria-labelledby="assistant-memory-live-title">
      <div className="account-profile-row"><span className="account-profile-row__copy"><strong id="assistant-memory-live-title">Assistant memory</strong><small>Assistant memory is available in Live.</small></span></div>
      <p className="account-profile-explainer">Memory is not loaded or changed in Simulation. Return to Live to manage your assistant preferences.</p>
    </section> : <AssistantMemorySettings userId={auth.user?.id}/>}</> : null}
    <Link className="account-profile-security" to={securityHref??`/account/security?from=${encodeURIComponent(profileHref)}`} state={{accountReturnTo:profileHref,accountCanPop:true}}><ProductIcon name="security" size={28}/> Account security <span aria-hidden="true">›</span></Link>
  </>;
  if(presentation==="workspace") return <div className="security-page account-profile-page account-profile-page--workspace">{content}</div>;
  return <main className="security-page account-profile-page">
    <header className="security-header"><button type="button" aria-label="Back" onClick={()=>{if(canPopBack)void navigate(-1);else void navigate(back,{replace:true});}}><ArrowLeft size={21}/></button><div><h1>Profile</h1><p>{auth.user?.display_name||auth.user?.email}</p></div></header>
    {content}
  </main>;
}
