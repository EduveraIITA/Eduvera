import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, X } from 'lucide-react';
import type { ReadyInvitation } from './api';

export function InvitationReceipt({invite,onClose}:{invite:ReadyInvitation;onClose:()=>void}) {
  const sent=invite.delivery==='email_accepted';
  const titleId=useId();const emailId=useId();
  const dialogRef=useRef<HTMLDialogElement>(null);
  const closeButtonRef=useRef<HTMLButtonElement>(null);
  const onCloseRef=useRef(onClose);
  useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
  useEffect(()=>{
    if(!sent)return;
    const dialog=dialogRef.current;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    if(dialog?.showModal)dialog.showModal();else dialog?.setAttribute('open','');
    closeButtonRef.current?.focus();
    const timeout=window.setTimeout(()=>onCloseRef.current(),4000);
    return ()=>{
      window.clearTimeout(timeout);
      if(dialog?.open)dialog.close?.();
      document.body.style.overflow=previousOverflow;
      if(previousFocus?.isConnected&&previousFocus!==document.body)previousFocus.focus();
      else document.querySelector<HTMLElement>('.invitation-toolbar button')?.focus();
    };
  },[sent,invite.token]);
  const content=<>
    <div className="invitation-confirmation__icon" aria-hidden="true">
      {sent?<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21"/><path d="m14 24 7 7 14-14"/></svg>:<CircleAlert size={32}/>}
    </div>
    <div className="invitation-confirmation__message" role={sent?'status':'alert'} aria-atomic="true">
      <h2 id={titleId}>{sent?'Invitation sent':'Invitation not sent'}</h2>
      <p id={emailId}>{invite.email}</p>
      {!sent?<p className="invitation-confirmation__help">{invite.delivery==='failed'?'We couldn’t confirm the email was sent. Check the email settings, then resend from the list.':'Email sending is unavailable. Enable invitation emails, then resend from the list.'}</p>:null}
    </div>
    <button ref={closeButtonRef} type="button" className="invitation-confirmation__close" aria-label="Dismiss invitation notification" onClick={onClose}><X size={18}/></button>
  </>;
  if(!sent)return <section className="invitation-confirmation">{content}</section>;
  return createPortal(<dialog ref={dialogRef} className="invitation-confirmation invitation-confirmation--sent invitation-confirmation--popup" aria-modal="true" aria-labelledby={titleId} aria-describedby={emailId} onCancel={event=>{event.preventDefault();onClose();}}>{content}</dialog>,document.body);
}
