import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { MessageCircleMore } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { Portal } from './AuthContext';

interface Connection {
  portal:Portal;student_id:string|null;linked_at:string;last_inbound_at:string|null;last_outbound_at:string|null;
}
interface Provider {
  name:'telegram'|'whatsapp';configured:boolean;label:string;username?:string;connection:Connection|null;
}
interface Response {providers:Provider[]}

export function AgentChannelConnections({portal,studentId}:{portal:Portal;studentId?:string}){
  const cache=useQueryClient();const [busy,setBusy]=useState('');const [error,setError]=useState('');
  const query=useQuery({queryKey:['agent-channels'],queryFn:()=>apiFetch<Response>('/api/v1/agent/channels'),staleTime:15_000});
  const providers=query.data?.providers??[];
  async function connect(provider:Provider){
    setBusy(provider.name);setError('');
    try{
      const result=await apiFetch<{connect_url:string}>('/api/v1/agent/channels/link',{method:'POST',body:JSON.stringify({provider:provider.name,portal,...(studentId?{student_id:studentId}:{})})});
      window.location.assign(result.connect_url);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not start the connection.');setBusy('');}
  }
  async function disconnect(provider:Provider){
    setBusy(provider.name);setError('');
    try{await apiFetch(`/api/v1/agent/channels/${provider.name}`,{method:'DELETE'});await cache.invalidateQueries({queryKey:['agent-channels']});}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not disconnect this app.');}
    finally{setBusy('');}
  }
  return <section className="account-profile-group account-channels" aria-labelledby="connected-apps-title">
    <div className="account-profile-row account-channels__heading">
      <span className="account-profile-row__icon"><MessageCircleMore size={20}/></span>
      <span className="account-profile-row__copy"><strong id="connected-apps-title">Connected apps</strong><small>Use the same assistant from supported messaging apps</small></span>
    </div>
    {query.isPending?<p className="account-channels__state" role="status">Checking connections…</p>:null}
    {query.isError?<p className="account-channels__state security-alert" role="alert">Could not load connected apps. <button type="button" onClick={()=>void query.refetch()}>Retry</button></p>:null}
    {providers.map(provider=><div className="account-channels__provider" key={provider.name}>
      <span className="account-channels__mark" aria-hidden="true">{provider.name==='telegram'?'➤':'●'}</span>
      <span className="account-channels__copy"><strong>{provider.label}</strong><small>{provider.connection?`Connected to ${provider.connection.portal}`:provider.configured?(provider.username??'Ready to connect'):'Not configured by the administrator'}</small></span>
      {provider.connection?<button type="button" disabled={busy===provider.name} onClick={()=>void disconnect(provider)}>Disconnect</button>
        :provider.configured?<button type="button" disabled={busy===provider.name} onClick={()=>void connect(provider)}>{busy===provider.name?'Opening…':'Connect'}</button>:null}
    </div>)}
    {!query.isPending&&!query.isError&&!providers.length?<p className="account-channels__state">No messaging provider is configured yet.</p>:null}
    {error?<p className="account-channels__state security-alert" role="alert">{error}</p>:null}
    <p className="account-profile-explainer">Connected chats use your current school access and AI allowance. Actions that require review still open securely in ThatCampus.</p>
  </section>;
}
