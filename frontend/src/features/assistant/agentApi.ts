import { apiFetch } from '../../lib/api';
import type { AssistantContext } from './context';
export interface AgentSource { id: string; title: string; href: string; retrieved_at: string; capability: string }
export interface AgentAction {
  capability?: string;
  preview?: { student?: string; class_name?: string; date: string; previous_status: string; status: string; reason?: string; remarks?: string; register_note: string };
  id: string; title: string; status: 'pending'|'executing'|'succeeded'|'rejected'|'expired'|'stale'|'failed'|'uncertain';
  input: { id?: string; body?: Record<string,unknown>; basis_id: string }; labels: Record<string,string>; href: string; expires_at: string;
  receipt: { message?: string; request_id?: string; completed_at?: string; href?: string } | null;
}
export interface AgentRun { id:string; question:string; answer:string; status:'running'|'completed'|'confirmation'|'failed'|'cancelled'; progress:string; provider:string; model:string; evidence:AgentSource[]; action:AgentAction|null; created_at:string }
export interface AgentThread { id:string; title:string; runs:AgentRun[] }
export interface ThreadSummary { id:string; title:string; updated_at:string }
export interface AgentStatus { provider:string; model:string; ready:boolean; local:boolean; tools:number }
const root='/api/v1/agent';
const scope=(context:AssistantContext)=>({ portal:context.portal,...(context.studentId ? { student_id:context.studentId } : {}) });
export const agentApi={
  status:(context:AssistantContext,signal?:AbortSignal)=>apiFetch<AgentStatus>(`${root}/status?${new URLSearchParams(scope(context))}`,{signal}),
  threads:(context:AssistantContext,signal?:AbortSignal)=>apiFetch<{threads:ThreadSummary[]}>(`${root}/threads?${new URLSearchParams(scope(context))}`,{signal}),
  create:(context:AssistantContext)=>apiFetch<{id:string}>(`${root}/threads`,{method:'POST',body:JSON.stringify(scope(context))}),
  detail:(id:string,signal?:AbortSignal)=>apiFetch<AgentThread>(`${root}/threads/${id}`,{signal}),
  send:(id:string,question:string,clientId:string)=>apiFetch(`${root}/threads/${id}/messages`,{method:'POST',body:JSON.stringify({question,client_id:clientId})}),
  cancel:(id:string,runId:string)=>apiFetch(`${root}/threads/${id}/runs/${runId}/cancel`,{method:'POST',body:'{}'}),
  decide:(id:string,actionId:string,decision:'confirm'|'reject')=>apiFetch(`${root}/threads/${id}/actions/${actionId}`,{method:'POST',body:JSON.stringify({decision})}),
};
