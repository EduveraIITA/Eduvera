import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useAuth } from './AuthContext';
import { proFeaturesKey, useProFeatures, type ProFeaturesPreference } from './useProFeatures';
import './account-security.css';
import './account-profile.css';

export function AccountProfilePage() {
  const auth=useAuth();
  const queryClient=useQueryClient();
  const preference=useProFeatures();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const location=useLocation();
  const from=new URLSearchParams(location.search).get('from');
  const back=from && /^\/(principal|teacher|parent|student)(?:\/|$)/.test(from) && !from.includes('://') ? from : '/';
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
    <header className="security-header"><Link to={back} aria-label="Back"><ArrowLeft size={21}/></Link><div><h1>Profile</h1><p>{auth.user?.display_name||auth.user?.email}</p></div></header>
    <section className="account-profile-group" aria-labelledby="pro-features-title">
      <div className="account-profile-row">
        <span className="account-profile-row__icon"><Sparkles size={20}/></span>
        <span className="account-profile-row__copy"><strong id="pro-features-title">Pro features</strong><small>Advanced assistant tools, charts and specialist AI</small></span>
        <button className="account-profile-switch" type="button" role="switch" aria-label="Pro features" aria-checked={preference.enabled}
          disabled={busy||preference.isPending||preference.isError} onClick={()=>void setEnabled(!preference.enabled)}><span/></button>
      </div>
      <p className="account-profile-explainer">Optional preview. Your usual school screens and basic chat stay available. Turning this off also stops pending AI actions from being confirmed.</p>
    </section>
    {preference.isPending?<p className="account-profile-status" role="status">Loading preference…</p>:null}
    {preference.isError?<p className="security-alert" role="alert">Could not load your preference. <button type="button" onClick={()=>void preference.refetch()}>Try again</button></p>:null}
    {error?<p className="security-alert" role="alert">{error}</p>:null}
    <Link className="account-profile-security" to="/account/security"><ShieldCheck size={18}/> Account security <span aria-hidden="true">›</span></Link>
  </main>;
}
