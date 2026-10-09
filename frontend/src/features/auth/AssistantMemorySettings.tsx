import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface AssistantMemory {
  id:string;
  portal:'principal'|'teacher'|'parent'|'student';
  category:'communication_preference'|'workflow_preference'|'app_knowledge';
  topic:string;
  content:string;
  expires_at:string;
}
interface AssistantMemoryResponse {
  items:AssistantMemory[];
  budget:{used_tokens:number;max_tokens:number;used_items:number;max_items:number};
  contract:string;
}

const labels:Record<AssistantMemory['category'],string>={
  communication_preference:'Communication',
  workflow_preference:'Workflow',
  app_knowledge:'App familiarity',
};
const memoryKey=(userId?:string)=>['agent-memory',userId] as const;

export function AssistantMemorySettings({userId}:{userId?:string}) {
  const client=useQueryClient();
  const [confirmingClear,setConfirmingClear]=useState(false);
  const query=useQuery({
    queryKey:memoryKey(userId),
    queryFn:()=>apiFetch<AssistantMemoryResponse>('/api/v1/agent/memories'),
    enabled:Boolean(userId),staleTime:30_000,
  });
  const forget=useMutation({
    mutationFn:(id:string)=>apiFetch(`/api/v1/agent/memories/${id}`,{method:'DELETE'}),
    onSuccess:()=>client.invalidateQueries({queryKey:memoryKey(userId)}),
  });
  const clear=useMutation({
    mutationFn:()=>apiFetch('/api/v1/agent/memories',{method:'DELETE'}),
    onSuccess:async()=>{setConfirmingClear(false);await client.invalidateQueries({queryKey:memoryKey(userId)});},
  });
  const data=query.data;
  return <section className="account-profile-group account-memory" aria-labelledby="assistant-memory-title">
    <div className="account-profile-row account-memory__heading">
      <span className="account-profile-row__icon"><Brain size={20}/></span>
      <span className="account-profile-row__copy"><strong id="assistant-memory-title">Assistant memory</strong><small>Your stated preferences and app familiarity</small></span>
    </div>
    <p className="account-profile-explainer">Memory personalizes how the assistant communicates. School records and permissions are always checked live.</p>
    {query.isPending?<p className="account-memory__state" role="status">Loading remembered preferences…</p>:null}
    {query.isError?<p className="account-memory__state security-alert" role="alert">Could not load assistant memory. <button type="button" onClick={()=>void query.refetch()}>Try again</button></p>:null}
    {data&&!data.items.length?<p className="account-memory__state">Nothing remembered yet. The assistant saves only durable preferences you clearly state.</p>:null}
    {data?.items.length?<>
      <ul className="account-memory__list" aria-label="Remembered preferences">
        {data.items.map(item=><li key={item.id}>
          <span><small>{labels[item.category]}</small><strong>{item.content}</strong></span>
          <button type="button" aria-label={`Forget ${item.content}`} disabled={forget.isPending||clear.isPending}
            onClick={()=>forget.mutate(item.id)}><Trash2 size={17}/></button>
        </li>)}
      </ul>
      <div className="account-memory__footer">
        <small>{data.budget.used_tokens.toLocaleString()} of {data.budget.max_tokens.toLocaleString()} memory tokens used</small>
        {confirmingClear?<span className="account-memory__confirm"><button type="button" onClick={()=>setConfirmingClear(false)}>Cancel</button><button type="button" disabled={clear.isPending} onClick={()=>clear.mutate()}>{clear.isPending?'Clearing…':'Confirm clear'}</button></span>
          :<button type="button" onClick={()=>setConfirmingClear(true)}>Clear memory</button>}
      </div>
    </>:null}
    {forget.isError||clear.isError?<p className="account-memory__state security-alert" role="alert">Memory could not be changed. Please try again.</p>:null}
  </section>;
}
