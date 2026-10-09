import { CircleAlert, X } from 'lucide-react';
import type { ReadyInvitation } from './api';

export function InvitationReceipt({invite,onClose}:{invite:ReadyInvitation;onClose:()=>void}) {
  const sent=invite.delivery==='email_accepted';
  return <section className={`invitation-confirmation${sent?' invitation-confirmation--sent':''}`}>
    <div className="invitation-confirmation__icon" aria-hidden="true">
      {sent?<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21"/><path d="m14 24 7 7 14-14"/></svg>:<CircleAlert size={32}/>}
    </div>
    <div className="invitation-confirmation__message" role={sent?'status':'alert'} aria-atomic="true">
      <h2>{sent?'Invitation sent':'Invitation not sent'}</h2>
      <p>{invite.email}</p>
      {!sent?<p className="invitation-confirmation__help">{invite.delivery==='failed'?'We couldn’t confirm the email was sent. Check the email settings, then resend from the list.':'Email sending is unavailable. Enable invitation emails, then resend from the list.'}</p>:null}
    </div>
    <button type="button" className="invitation-confirmation__close" aria-label="Dismiss invitation notification" onClick={onClose}><X size={18}/></button>
  </section>;
}
