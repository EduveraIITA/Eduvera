import { useEffect, useRef } from 'react';
import { ArrowRight, Maximize2, MessageCircle, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { AssistantContext } from './context';
import type { DemoChatControl } from './useDemoChat';
import { useAgentConversation } from './useAgentConversation';
import { AssistantComposer, useAssistantKeyboard } from './AssistantComposer';
import { useAssistantNavigation } from './useAssistantNavigation';
import { AssistantText } from './AssistantText';
import './assistant.css';

export function AssistantTab({chat,className='',sidebar=false}:{chat:DemoChatControl;className?:string;sidebar?:boolean}) {
  return <button type="button" className={'assistant-tab '+(sidebar?'assistant-tab--sidebar ':'')+className+(chat.active?' is-active':'')}
    aria-label="Chat" aria-current={chat.fullPage?'page':undefined} aria-expanded={chat.fullPage?undefined:chat.open} aria-controls={chat.open?chat.id:undefined} onClick={chat.toggle}>
    <MessageCircle size={22} strokeWidth={chat.active?2.25:1.9} aria-hidden="true"/><span>Chat</span>
  </button>;
}
export function AssistantPanel({chat,context}:{chat:DemoChatControl;context:AssistantContext}) {
  return chat.open?<OpenAssistant key={chat.key} chat={chat} context={context}/>:null;
}
function OpenAssistant({chat,context}:{chat:DemoChatControl;context:AssistantContext}) {
  const conversation=useAgentConversation(context);
  const latest=conversation.runs.at(-1);
  const text=conversation.error|| (latest?.status==='running'?latest.progress+'…':latest?.answer) || 'Ask about your school records, or tell me what you’d like to do.';
  const panel=useRef<HTMLElement>(null);
  const close=useRef(chat.close);
  const location=useLocation();
  const navigate=useAssistantNavigation();
  const fullPath='/'+context.portal+'/assistant'+(context.studentId?'?student_id='+encodeURIComponent(context.studentId):'');
  const returnState={assistantReturnTo:location.pathname+location.search,assistantScrollY:window.scrollY};
  useAssistantKeyboard(panel);
  useEffect(()=>{close.current=chat.close;},[chat.close]);
  useEffect(()=>{
    panel.current?.focus({preventScroll:true});
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();}};
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[]);
  const source=latest?.action ? {href:latest.action.receipt?.href??latest.action.href,title:latest.action.status==='succeeded'?'Verify in app':'Open affected screen'} : latest?.evidence.at(-1);
  return <><div className="assistant-backdrop" aria-hidden="true" onClick={chat.close}/>
    <section id={chat.id} ref={panel} className="assistant-dock" tabIndex={-1} aria-label="AI chat">
      <div className="assistant-response">
        <header><span>Assistant <span className="assistant-demo-label">{conversation.status?.local?'Local':''}</span></span>
          <div className="assistant-response__controls">
            <Link className="assistant-expand" to={fullPath} state={returnState} aria-label="Open full chat" onClick={event=>navigate.fromLink(event,fullPath,{state:returnState})}><Maximize2 size={16} aria-hidden="true"/></Link>
            <button type="button" aria-label="Close chat" onClick={chat.close}><X size={18} aria-hidden="true"/></button>
          </div>
        </header>
        <div className="assistant-response__body" aria-live="polite" aria-atomic="true" aria-busy={conversation.pending}>
          <div key={(latest?.id??'welcome')+':'+(latest?.status??'')} className="assistant-response__content">
            <Link className="assistant-open-thread" to={fullPath} state={returnState} onClick={event=>navigate.fromLink(event,fullPath,{state:returnState})}><p><AssistantText text={text}/></p><span className="sr-only">Open full conversation</span></Link>
            {latest?.action?.status==='pending'?<Link className="assistant-source-link" to={fullPath} state={returnState} onClick={event=>navigate.fromLink(event,fullPath,{state:returnState})}>Review action<ArrowRight size={17} aria-hidden="true"/></Link>
              :source?<Link className="assistant-source-link" to={source.href} onClick={chat.close}>{source.title}<ArrowRight size={17} aria-hidden="true"/></Link>:null}
          </div>
        </div>
        <span className="assistant-demo-note">{conversation.pending?'Checking your school records…':conversation.awaiting?'Nothing changes until you confirm.':'Changes need your confirmation.'}</span>
      </div>
      <AssistantComposer onSend={conversation.send} disabled={conversation.busy||conversation.awaiting||conversation.loading||conversation.accessDenied||conversation.status?.ready===false} pending={conversation.pending} onCancel={()=>void conversation.cancel()}/>
    </section>
  </>;
}
