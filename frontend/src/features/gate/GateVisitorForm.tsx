import { Clock3, Send, UserRoundPlus } from 'lucide-react';
import type { Workspace } from './api';

export function GateVisitorForm({hosts,hindi,busy,onSubmit}:{hosts:Workspace['hosts'];hindi:boolean;busy:boolean;onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void}) {
  return <form className="gate-form gate-visitor-form" onSubmit={onSubmit}>
    <header className="gate-section-heading"><span className="gate-section-icon"><UserRoundPlus size={23}/></span><div><h2>{hindi?'आगंतुक प्रवेश':'Visitor Entry'}</h2><p>{hindi?'जानकारी दर्ज करें। मिलने वाले व्यक्ति से अनुमति माँगी जाएगी।':'Send a request to the person they’re visiting.'}</p></div></header>
    <div className="gate-visitor-fields">
      <label>{hindi?'आगंतुक का नाम':'Visitor name'}<input name="name" autoComplete="name" placeholder={hindi?'पूरा नाम':'Full name'} required minLength={2} maxLength={150} disabled={busy}/></label>
      <label>{hindi?'मोबाइल नंबर':'Mobile number'}<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="98765 43210" required minLength={6} maxLength={32} disabled={busy}/></label>
      <label className="gate-field-wide">{hindi?'किससे मिलना है?':'Whom are they visiting?'}<select name="host_user_id" required disabled={busy||hosts.length===0}><option value="">{hindi?'मिलने वाले व्यक्ति को चुनें':'Select a host'}</option>{hosts.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</select></label>
      <label className="gate-field-wide">{hindi?'आने का कारण':'Purpose of visit'}<input name="purpose" placeholder={hindi?'जैसे: बैठक या दस्तावेज़ देना':'For example, a meeting or document delivery'} required minLength={3} maxLength={300} disabled={busy}/></label>
    </div>
    {!hosts.length?<p className="gate-error" role="status">{hindi?'कोई उपलब्ध व्यक्ति नहीं मिला। स्कूल कार्यालय से संपर्क करें।':'No hosts are available. Contact the school office.'}</p>:null}
    <p className="gate-form-note"><Clock3 size={17}/>{hindi?'अनुमति मिलने तक आगंतुक को गेट पर रुकने के लिए कहें।':'Ask the visitor to wait at the gate until approved.'}</p>
    <button className="gate-primary gate-send-request" disabled={busy||!hosts.length}><Send size={17}/>{busy?(hindi?'भेज रहे हैं…':'Sending request…'):(hindi?'अनुमति माँगें':'Request approval')}</button>
  </form>;
}
