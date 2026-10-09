import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useOptionalAuth } from '../auth/AuthContext';
import { currentStaffMembership } from '../auth/staffAccess';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { ParentShell } from '../../pages/parent/ParentShell';
import { StudentShell } from '../../pages/student/StudentShell';
import { AssistantComposer, useAssistantKeyboard } from './AssistantComposer';
import { useAgentConversation } from './useAgentConversation';
import { AgentReply } from './AgentReply';
import { useAssistantNavigation } from './useAssistantNavigation';
import type { AssistantContext, AssistantPortal } from './context';
import './assistant.css';

export default function AssistantPage({portal}:{portal:AssistantPortal}) {
  const location=useLocation();
  const auth=useOptionalAuth();
  const navigate=useAssistantNavigation();
  const studentId=new URLSearchParams(location.search).get('student_id')??undefined;
  const context:AssistantContext={portal,pageTitle:'Chat',studentId:portal==='parent'?studentId:undefined,permissions:currentStaffMembership(auth?.memberships??[])?.permissions};
  const conversation=useAgentConversation(context);
  const footer=useRef<HTMLDivElement>(null);
  const end=useRef<HTMLDivElement>(null);
  const page=useRef<HTMLDivElement>(null);
  useAssistantKeyboard(footer);
  const latest=conversation.runs.at(-1);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      const review=latest?.status==='confirmation'?page.current?.querySelector<HTMLElement>(`[data-agent-run="${latest.id}"] .agent-action`):null;
      if(review){
        const header=document.querySelector('.operations-topbar, .student-topbar, .parent-header');
        review.style.scrollMarginTop=`${(header?.getBoundingClientRect().height??0)+16}px`;
        review.scrollIntoView({block:'start',behavior:'instant'});
      }else end.current?.scrollIntoView({block:'end',behavior:'instant'});
    });
    return()=>cancelAnimationFrame(frame);
  },[conversation.runs.length,latest?.id,latest?.status]);
  useEffect(()=>{
    const viewport=window.visualViewport;
    const fit=()=>{
      const keyboard=viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
      if(page.current)page.current.style.paddingBottom=`${(footer.current?.getBoundingClientRect().height??116)+keyboard+24}px`;
    };
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(fit);
    if(footer.current)observer?.observe(footer.current);
    fit();viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit);
    return()=>{observer?.disconnect();viewport?.removeEventListener('resize',fit);viewport?.removeEventListener('scroll',fit);};
  },[]);
  const state=location.state as {assistantReturnTo?:unknown;assistantScrollY?:unknown}|null;
  const fallback=portal==='parent'?'/parent/home':'/'+portal;
  const returnTo=typeof state?.assistantReturnTo==='string'&&(state.assistantReturnTo===fallback||state.assistantReturnTo.startsWith('/'+portal+'/'))&&!state.assistantReturnTo.startsWith('/'+portal+'/assistant')?state.assistantReturnTo:fallback;
  const onBack=()=>navigate.go(returnTo,{replace:true,state:{assistantReopen:true}},()=>window.scrollTo({top:typeof state?.assistantScrollY==='number'?state.assistantScrollY:0,behavior:'instant'}));
  const content=<div className="assistant-page" ref={page}>
    <div className="assistant-page__notice">
      <span>{conversation.status?.local?'Local model':conversation.status?.provider??'Assistant'}{conversation.status?.model?' · '+conversation.status.model:''}</span>
      <button type="button" onClick={()=>void conversation.newChat()} disabled={conversation.busy||conversation.pending||conversation.awaiting||conversation.accessDenied}>New chat</button>
    </div>
    {conversation.threads.length>1?<details className="agent-history"><summary>Conversations</summary><ul>{conversation.threads.map(thread=><li key={thread.id}><button type="button" aria-current={thread.id===conversation.threadId?'true':undefined} disabled={conversation.busy} onClick={()=>conversation.select(thread.id)}>{thread.title}</button></li>)}</ul></details>:null}
    {conversation.error?<div role="alert" className="agent-error">{conversation.error}<button type="button" onClick={conversation.retry}>Retry connection</button></div>:null}
    {conversation.accessDenied?<p className="agent-caption">Ask your school administrator to enable “Use AI assistance” for your role.</p>:null}
    {conversation.status&&!conversation.status.ready?<p role="status" className="agent-error">{conversation.status.local?'The local model is unavailable. Ask the server administrator to check Ollama and the configured model.':'The configured model is unavailable. Check the server’s model and provider settings.'}</p>:null}
    {conversation.loading?<p role="status">Loading your conversation…</p>:conversation.runs.length?<ol className="assistant-conversation" aria-label="Conversation">
      {conversation.runs.map(run=><li key={run.id} data-agent-run={run.id}>
        <div className="assistant-question"><span className="sr-only">You: </span>{run.question}</div>
        <div className="assistant-full-reply assistant-response__content"><span className="assistant-full-reply__label">Assistant</span>
          <AgentReply run={run} busy={conversation.busy} onDecide={(id,decision)=>void conversation.decide(id,decision)}/>
        </div>
      </li>)}
    </ol>:<div className="assistant-page__empty"><p>What would you like to do?</p><p className="agent-caption">Check school records, plan your day or prepare a change. You’ll review changes before they are saved.</p></div>}
    <div ref={end} className="assistant-page__end"/>
    <div className="assistant-page__composer" ref={footer}>
      <p role="status">{conversation.pending?latest?.progress+'…':conversation.awaiting?'Review the pending action above.':'Answers use your access. Changes need confirmation.'}</p>
      <AssistantComposer key={portal+':'+(studentId??'self')+':'+conversation.threadId} onSend={conversation.send} disabled={conversation.busy||conversation.awaiting||conversation.loading||conversation.accessDenied||conversation.status?.ready===false} pending={conversation.pending} onCancel={()=>void conversation.cancel()}/>
    </div>
  </div>;
  if(portal==='teacher'||portal==='principal')return <OperationsShell portal={portal} active="chat" title="Chat" onBack={onBack}>{content}</OperationsShell>;
  if(portal==='parent')return <ParentShell active="chat" pageLabel="Chat" selectedChildId={studentId} childSwitchDisabled={conversation.busy} onBack={onBack}>{content}</ParentShell>;
  return <StudentShell activeNav="chat" pageTitle="Chat" onBack={onBack}>{content}</StudentShell>;
}
