import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock3, ShieldCheck, UserRound, X } from 'lucide-react';
import type { Visitor } from './api';

export function VisitorApprovalPrompt({visitor,hindi,busy,error,outcome,onComplete,onLater,onDecide,onRetry}:{visitor:Visitor;hindi:boolean;busy:boolean;error:string;outcome:'approve'|'deny'|null;onComplete:()=>void;onLater:()=>void;onDecide:(action:'approve'|'deny')=>void;onRetry:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);const later=useRef<HTMLButtonElement>(null);const done=useRef<HTMLButtonElement>(null);const title=useId();
  useEffect(()=>{
    const element=dialog.current;const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    if(element?.showModal)element.showModal();else element?.setAttribute('open','');
    later.current?.focus();
    return()=>{if(element?.open)element.close?.();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{if(outcome)done.current?.focus();},[outcome]);
  const close=outcome?onComplete:onLater;
  return createPortal(<dialog className="gate-approval-dialog" ref={dialog} aria-modal="true" aria-labelledby={title} lang={hindi?'hi':'en'} onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    {outcome?<section className={`gate-approval-result gate-approval-result--${outcome}`} role="status" aria-live="polite">
      <button className="gate-approval-close" aria-label={hindi?'बंद करें':'Close'} onClick={onComplete}><X size={19}/></button>
      <span className="gate-approval-result-mark" aria-hidden="true">{outcome==='approve'?<Check size={38}/>:<X size={38}/>}</span>
      <h2 id={title}>{outcome==='approve'?(hindi?'आगंतुक को अनुमति दी गई':'Visitor approved'):(hindi?'अनुरोध अस्वीकार किया गया':'Visitor declined')}</h2>
      <p className="gate-approval-name">{visitor.name}</p>
      <p className="gate-approval-wait">{hindi?'आपका निर्णय गेट के लिए सहेज लिया गया है।':'Your decision is saved for the gate.'}</p>
      <button className="gate-approval-later" ref={done} onClick={onComplete}>{hindi?'ठीक है':'Done'}</button>
    </section>:<>
    <header><span className="gate-approval-eyebrow"><ShieldCheck size={15}/>{hindi?'गेट से अनुरोध':'REQUEST FROM THE GATE'}</span><button className="gate-approval-close" disabled={busy} aria-label={hindi?'बाद में देखें':'Review later'} onClick={onLater}><X size={19}/></button></header>
    <span className="gate-approval-avatar">{visitor.photo_url?<img src={visitor.photo_url} alt={hindi?`${visitor.name} की फोटो`:`Photo of ${visitor.name}`}/>:<UserRound size={32}/>}</span>
    <h2 id={title}>{hindi?'आगंतुक को अनुमति दें?':'Approve this visitor?'}</h2>
    <p className="gate-approval-name">{visitor.name}</p><p className="gate-approval-school">{visitor.school_name}</p>
    <dl><div><dt>{hindi?'आने का कारण':'Purpose'}</dt><dd>{visitor.purpose}</dd></div>{visitor.phone?<div><dt>{hindi?'मोबाइल':'Mobile'}</dt><dd>{visitor.phone}</dd></div>:null}</dl>
    <p className="gate-approval-wait"><Clock3 size={16}/>{hindi?'आगंतुक आपसे मिलने के लिए गेट पर इंतज़ार कर रहा है।':'Waiting at the gate to meet you.'}</p>
    {error?<div className="gate-approval-error" role="alert"><p>{error}</p><button className="gate-approval-retry" disabled={busy} onClick={onRetry}>{hindi?'फिर कोशिश करें':'Retry request'}</button></div>:null}
    {busy?<p className="gate-approval-wait" role="status">{hindi?'निर्णय दर्ज हो रहा है…':'Saving your decision…'}</p>:null}
    <div className="gate-approval-actions"><button className="gate-approval-decline" disabled={busy||Boolean(error)} onClick={()=>onDecide('deny')}><X size={18}/>{hindi?'अनुमति न दें':'Decline'}</button><button className="gate-approval-approve" disabled={busy||Boolean(error)} onClick={()=>onDecide('approve')}><Check size={18}/>{hindi?'अनुमति दें':'Approve'}</button></div>
    <button className="gate-approval-later" ref={later} disabled={busy} onClick={onLater}>{hindi?'बाद में देखें':'Review later'}</button>
    </>}
  </dialog>,document.body);
}
