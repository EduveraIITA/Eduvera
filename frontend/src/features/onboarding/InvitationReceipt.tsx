import { useState } from 'react';
import type { ReadyInvitation } from './api';
export function InvitationReceipt({invite,onClose}:{invite:ReadyInvitation;onClose:()=>void}) {
  const [message,setMessage]=useState('');
  async function copy() {try{await navigator.clipboard.writeText(`Join Eduera: ${window.location.origin}/join\nEmail: ${invite.email}\nInvitation code: ${invite.token}\nExpires: ${new Date(invite.expires_at).toLocaleString()}`);setMessage('Invitation copied.');}catch{setMessage('Copy is unavailable. Select the code and copy it manually.');}}
  return <section className="office-secret" aria-label="Invitation ready"><h2>Invitation ready</h2><p>For <strong>{invite.email}</strong>. Share this code privately with the recipient. No email has been sent.</p><p>Open <a href="/join">{window.location.origin}/join</a> and use the same email. Valid until {new Date(invite.expires_at).toLocaleString()}.</p><code>{invite.token}</code><p className="office-hint">This code is shown once. Create a replacement invitation if it is lost.</p><div className="office-actions"><button type="button" className="office-secondary" onClick={()=>void copy()}>Copy invitation</button><button type="button" className="office-secondary" onClick={onClose}>Dismiss</button></div>{message?<p role="status">{message}</p>:null}</section>;
}
