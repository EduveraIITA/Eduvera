import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useOptionalAuth } from '../auth/AuthContext';
import { useProFeatures } from '../auth/useProFeatures';
import { currentStaffMembership } from '../auth/staffAccess';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { ParentShell } from '../../pages/parent/ParentShell';
import { StudentShell } from '../../pages/student/StudentShell';
import { AssistantComposer, useAssistantKeyboard } from './AssistantComposer';
import { useAgentConversation } from './useAgentConversation';
import { AgentReply } from './AgentReply';
import { AssistantHeaderActions } from './AssistantHeaderActions';
import { useAssistantNavigation } from './useAssistantNavigation';
import { requestAssistantReopen } from './useDemoChat';
import type { AssistantContext, AssistantPortal } from './context';
import { browserHistoryIndex, previousPortalLocation } from '../navigation/portalHistory';
import { samePortalHref } from '../navigation/portalReturnState';
import { ThatCampusLoader } from '../../components/ThatCampusLoader';
import { AssistantElectricBorder } from './AssistantElectricBorder';
import './assistant.css';

export default function AssistantPage({portal}:{portal:AssistantPortal}) {
  const proFeatures=useProFeatures();
  const fallback=portal==='parent'?'/parent/home':'/'+portal;
  if(proFeatures.isPending)return <ThatCampusLoader label="Opening ThatCampus AI…"/>;
  if(!proFeatures.enabled)return <Navigate to={fallback} replace/>;
  return <AssistantPageContent portal={portal}/>;
}

function AssistantPageContent({portal}:{portal:AssistantPortal}) {
  const location=useLocation();
  const auth=useOptionalAuth();
  const navigate=useAssistantNavigation();
  const search=new URLSearchParams(location.search);
  const studentId=search.get('student_id')??undefined;
  const linkedThreadId=search.get('thread')??undefined;
  const context:AssistantContext={portal,pageTitle:'Assistant',studentId:portal==='parent'?studentId:undefined,permissions:currentStaffMembership(auth?.memberships??[])?.permissions};
  const conversation=useAgentConversation(context,linkedThreadId);
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
  const restoreScroll=()=>window.scrollTo({top:typeof state?.assistantScrollY==='number'?state.assistantScrollY:0,behavior:'instant'});
  const onBack=()=>{
    if(samePortalHref(previousPortalLocation(browserHistoryIndex()),returnTo)){
      requestAssistantReopen(returnTo);
      navigate.back(restoreScroll);
      return;
    }
    navigate.go(returnTo,{replace:true,state:{assistantReopen:true}},restoreScroll);
  };
  const headerActions=<AssistantHeaderActions threads={conversation.threads} currentThreadId={conversation.threadId}
    disabled={conversation.busy||conversation.pending||conversation.awaiting||conversation.accessDenied}
    onNewChat={()=>void conversation.newChat()} onSelect={conversation.select}/>;
  const content=<div className="assistant-page" ref={page}>
    {conversation.error?<div role="alert" className="agent-error">{conversation.error}<button type="button" onClick={conversation.retry}>Retry connection</button></div>:null}
    {conversation.accessDenied?<p className="agent-caption">Ask your school administrator to enable “Use AI assistance” for your role.</p>:null}
    {conversation.status&&!conversation.status.ready?<p role="status" className="agent-error">{conversation.status.local?'The local model is unavailable. Ask the server administrator to check Ollama and the configured model.':'The configured model is unavailable. Check the server’s model and provider settings.'}</p>:null}
    {conversation.loading?<p role="status">Loading your conversation…</p>:conversation.runs.length?<ol className="assistant-conversation" aria-label="Conversation">
      {conversation.runs.map(run=>{
        const reply=<div className="assistant-full-reply assistant-response__content"><span className="sr-only">Assistant response: </span>
          <AgentReply run={run} busy={conversation.busy} onDecide={(id,decision)=>void conversation.decide(id,decision)}/>
        </div>;
        return <li key={run.id} data-agent-run={run.id}>
          <div className="assistant-question"><span className="sr-only">You: </span>{run.question}</div>
          {run.id===latest?.id?<AssistantElectricBorder>{reply}</AssistantElectricBorder>:reply}
        </li>;
      })}
    </ol>:<div className="assistant-page__empty"><p>What would you like to know?</p><p className="agent-caption">{conversation.status?.pro_features_enabled?'Check school records, plan your day or prepare a change. You’ll review changes before they are saved.':'Ask about your day or recorded attendance.'}</p></div>}
    <div ref={end} className="assistant-page__end"/>
    <div className="assistant-page__composer" ref={footer}>
      {conversation.pending||conversation.awaiting?<p role="status">{conversation.pending?latest?.progress+'…':'Review the pending action above.'}</p>:null}
      <AssistantComposer key={portal+':'+(studentId??'self')+':'+conversation.threadId} onSend={conversation.send} disabled={conversation.busy||conversation.awaiting||conversation.loading||conversation.accessDenied||conversation.status?.ready===false} pending={conversation.pending} onCancel={()=>void conversation.cancel()}/>
    </div>
  </div>;
  if(portal==='teacher'||portal==='principal')return <OperationsShell portal={portal} active="chat" title="Assistant" pageTitleTrailing={headerActions} onBack={onBack}>{content}</OperationsShell>;
  if(portal==='parent')return <ParentShell active="chat" pageLabel="Assistant" pageTitleTrailing={headerActions} selectedChildId={studentId} childSwitchDisabled={conversation.busy} onBack={onBack}>{content}</ParentShell>;
  return <StudentShell activeNav="chat" pageTitle="Assistant" pageTitleTrailing={headerActions} onBack={onBack}>{content}</StudentShell>;
}
