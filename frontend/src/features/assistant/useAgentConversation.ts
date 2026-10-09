import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOptionalAuth } from '../auth/AuthContext';
import { agentApi, type AgentThread } from './agentApi';
import { ApiError } from '../../lib/api';
import type { AssistantContext } from './context';

export function useAgentConversation(context:AssistantContext) {
  const auth=useOptionalAuth();
  const cache=useQueryClient();
  const scopeKey=[auth?.user?.id,auth?.user?.active_school_id,context.portal,context.studentId??'self'];
  const selectionKey=['agent-selection',...scopeKey];
  const selection=useQuery<string|null>({queryKey:selectionKey,queryFn:()=>Promise.resolve(null),enabled:false,staleTime:Infinity});
  const list=useQuery({queryKey:['agent-threads',...scopeKey],queryFn:({signal})=>agentApi.threads(context,signal),enabled:Boolean(auth?.user),staleTime:15000});
  const status=useQuery({queryKey:['agent-status',...scopeKey],queryFn:({signal})=>agentApi.status(context,signal),enabled:Boolean(auth?.user),staleTime:30000});
  const threadId=selection.data??list.data?.threads[0]?.id;
  const queryKey=['agent-thread',...scopeKey,threadId];
  const detail=useQuery({queryKey,queryFn:({signal})=>agentApi.detail(threadId!,signal),enabled:Boolean(threadId),
    refetchInterval:query=>query.state.data?.runs.some(run=>run.status==='running'||run.action?.status==='executing')?1500:query.state.data?.runs.some(run=>run.action?.status==='pending')?10000:false,
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const runs=detail.data?.runs??[];
  const active=runs.find(run=>run.status==='running');
  const awaiting=runs.find(run=>run.action?.status==='pending'||run.action?.status==='executing');
  const accessDenied=status.error instanceof ApiError && status.error.status===403;
  const refresh=async()=>{await cache.invalidateQueries({queryKey:['agent-thread',...scopeKey]});await cache.invalidateQueries({queryKey:['agent-threads',...scopeKey]});};
  async function perform(work:()=>Promise<void>) {
    setBusy(true);setError('');
    try {await work();return true;}catch(cause){setError(cause instanceof Error?cause.message:'The assistant could not connect. Please try again.');return false;}finally{setBusy(false);}
  }
  return {runs,threads:list.data?.threads??[],threadId,status:status.data,accessDenied,busy,pending:Boolean(active),awaiting:Boolean(awaiting),
    loading:list.isLoading||Boolean(threadId&&detail.isLoading),error:error||list.error?.message||detail.error?.message||status.error?.message||'',
    select:(id:string)=>{setError('');cache.setQueryData(selectionKey,id);},
    newChat:()=>perform(async()=>{const thread=await agentApi.create(context);cache.setQueryData(selectionKey,thread.id);cache.setQueryData<AgentThread>(['agent-thread',...scopeKey,thread.id],{id:thread.id,title:'New conversation',runs:[]});await cache.invalidateQueries({queryKey:['agent-threads',...scopeKey]});}),
    send:(question:string,clientId:string)=>perform(async()=>{
      let id=threadId;
      if(!id){id=(await agentApi.create(context)).id;cache.setQueryData(selectionKey,id);}
      await agentApi.send(id,question,clientId);await refresh();
    }),
    cancel:()=>perform(async()=>{if(threadId&&active){await agentApi.cancel(threadId,active.id);await refresh();}}),
    decide:(actionId:string,decision:'confirm'|'reject')=>perform(async()=>{
      if(!threadId)return;
      await agentApi.decide(threadId,actionId,decision);
      await cache.invalidateQueries({predicate:query=>!String(query.queryKey[0]).startsWith('agent-')});await refresh();
    }),
    retry:()=>{setError('');void refresh();void status.refetch();},
  };
}
