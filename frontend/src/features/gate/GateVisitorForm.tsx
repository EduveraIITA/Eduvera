import { useState } from 'react';
import { Clock3, LogIn, Send } from 'lucide-react';
import type { Workspace } from './api';
import { VisitorPhotoCapture } from './VisitorPhotoCapture';

export function GateVisitorForm({hosts,hindi,busy,onSubmit}:{hosts:Workspace['hosts'];hindi:boolean;busy:boolean;onSubmit:(form:FormData)=>void}) {
 const [host,setHost]=useState(''),[photo,setPhoto]=useState<File|null>(null),[processing,setProcessing]=useState(false);
 const categories=[['parent',hindi?'अभिभावक':'Parent'],['vendor',hindi?'विक्रेता':'Vendor'],['delivery',hindi?'डिलीवरी':'Delivery'],['guest',hindi?'अतिथि':'Guest']];
 return <form className="gate-form gate-visitor-form" onSubmit={event=>{event.preventDefault();if(processing)return;const form=new FormData(event.currentTarget);if(photo)form.set('photo',photo);onSubmit(form);}}>
  <header className="gate-visitor-heading"><h2>{hindi?'आगंतुक प्रवेश':'Visitor Entry'}</h2></header>
  <VisitorPhotoCapture hindi={hindi} busy={busy||processing} onChange={setPhoto} onProcessing={setProcessing}/>
  <div className="gate-visitor-fields">
   <label>{hindi?'आगंतुक का नाम':'Visitor name'}<input name="name" autoComplete="name" placeholder={hindi?'पूरा नाम':'Full name'} required minLength={2} maxLength={150} disabled={busy}/></label>
   <label>{hindi?'मोबाइल नंबर':'Mobile number'}<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="98765 43210" required minLength={6} maxLength={32} disabled={busy}/></label>
   <fieldset className="gate-field-wide gate-category"><legend>{hindi?'आगंतुक श्रेणी':'Visitor category'}</legend>{categories.map(([value,label])=><label key={value}><input type="radio" name="category" value={value} defaultChecked={value==='guest'} disabled={busy}/><span>{label}</span></label>)}</fieldset>
   <label className="gate-field-wide">{hindi?'किससे मिलना है? (वैकल्पिक)':'Whom are they visiting? (optional)'}<select name="host_user_id" value={host} onChange={e=>setHost(e.target.value)} disabled={busy}><option value="">{hindi?'कोई होस्ट नहीं — सीधा प्रवेश':'No host — direct entry'}</option>{hosts.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
   <label className="gate-field-wide">{hindi?'आने का कारण (वैकल्पिक)':'Purpose of visit (optional)'}<textarea name="purpose" placeholder={hindi?'जैसे: बैठक या दस्तावेज़ देना':'For example, a meeting or document delivery'} maxLength={300} rows={2} disabled={busy}/></label>
  </div>
  {host?<p className="gate-form-note"><Clock3 size={17}/><span>{hindi?'अनुमति मिलने तक आगंतुक को गेट पर रुकने के लिए कहें।':'Ask the visitor to wait at the gate until approved.'}</span></p>:null}
  <button className="gate-primary gate-send-request" disabled={busy||processing}>{host?<Send size={17}/>:<LogIn size={17}/>} {processing?(hindi?'फोटो तैयार हो रही है…':'Preparing photo…'):busy?(hindi?'सहेज रहे हैं…':'Saving…'):host?(hindi?'अनुमति माँगें':'Request approval'):(hindi?'प्रवेश दर्ज करें':'Record visitor entry')}</button>
 </form>;
}
