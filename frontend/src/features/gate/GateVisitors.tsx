import { useState } from 'react';
import { CheckCircle2, Clock3, DoorOpen, LogIn, LogOut, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import type { Visitor } from './api';

const states={en:{pending:'Waiting for approval',approved:'Approved',denied:'Declined',inside:'Inside',out:'Checked out',expired:'Expired'},hi:{pending:'अनुमति का इंतज़ार',approved:'अनुमति मिली',denied:'अनुमति नहीं मिली',inside:'अंदर है',out:'निकास दर्ज',expired:'समय समाप्त'}};
export function GateVisitors({visitors,hindi,busy,onMove}:{visitors:Visitor[];hindi:boolean;busy:boolean;onMove:(visitor:Visitor,action:'in'|'out')=>void}) {
  const [filter,setFilter]=useState('all');
  const labels=states[hindi?'hi':'en'];
  const filters:Array<[string,string]>=[['all',hindi?'सभी':'All'],['pending',hindi?'इंतज़ार':'Waiting'],['approved',hindi?'स्वीकृत':'Approved'],['inside',hindi?'अंदर':'Inside'],['closed',hindi?'पूर्ण':'Closed']];
  const visible=visitors.filter(visitor=>filter==='all'||filter==='closed'&&['out','denied','expired'].includes(visitor.state)||visitor.state===filter);
  return <section className="gate-visitors" aria-labelledby="gate-visitors-title">
    <header className="gate-section-heading"><span className="gate-section-icon"><DoorOpen size={23}/></span><div><h2 id="gate-visitors-title">{hindi?'आगंतुक अनुरोध':'Visitor requests'}</h2><p>{hindi?'अनुमति और प्रवेश की वर्तमान स्थिति।':'Approvals, arrivals and departures at a glance.'}</p></div></header>
    <div className="gate-visitor-filters" role="group" aria-label={hindi?'आगंतुक फ़िल्टर':'Filter visitors'}>{filters.map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}<span>{visitors.filter(v=>key==='all'||key==='closed'&&['out','denied','expired'].includes(v.state)||v.state===key).length}</span></button>)}</div>
    <div className="gate-visitor-list" aria-busy={busy}>
      {!visible.length?<div className="gate-visitor-empty"><ShieldCheck size={28}/><h3>{hindi?'कोई अनुरोध नहीं':'No requests here'}</h3><p>{hindi?'इस स्थिति के आगंतुक यहाँ दिखाई देंगे।':'Visitors with this status will appear here.'}</p></div>:null}
      {visible.map(visitor=>{
        const Icon=visitor.state==='pending'?Clock3:['approved','out'].includes(visitor.state)?CheckCircle2:['denied','expired'].includes(visitor.state)?XCircle:DoorOpen;
        return <article key={visitor.id} className="gate-visitor-card">
          <div className="gate-visitor-identity"><span className="gate-visitor-avatar"><UserRound size={21}/></span><div><h3>{visitor.name}</h3><p>{visitor.purpose}</p></div><span className={`gate-visitor-status is-${visitor.state}`}><Icon size={14}/>{labels[visitor.state]}</span></div>
          <dl className="gate-visitor-meta">{visitor.host_name?<div><dt>{hindi?'मिलने वाला व्यक्ति':'Visiting'}</dt><dd>{visitor.host_name}</dd></div>:null}{visitor.phone?<div><dt>{hindi?'मोबाइल':'Mobile'}</dt><dd>{visitor.phone}</dd></div>:null}</dl>
          <footer>{visitor.state==='pending'?<p><Clock3 size={15}/>{hindi?'मिलने वाले व्यक्ति की अनुमति का इंतज़ार है।':'Waiting for the host’s decision.'}</p>:visitor.state==='approved'||visitor.state==='inside'?<><p>{visitor.state==='approved'?(hindi?'अनुमति मिल गई। पहचान जाँचकर प्रवेश दर्ज करें।':'Approved. Check their identity before entry.'):(hindi?'आगंतुक स्कूल के अंदर है।':'Visitor is currently inside the school.')}</p><button className={visitor.state==='approved'?'gate-visitor-enter':'gate-visitor-exit'} disabled={busy} onClick={()=>onMove(visitor,visitor.state==='approved'?'in':'out')}>{visitor.state==='approved'?<LogIn size={17}/>:<LogOut size={17}/>}{visitor.state==='approved'?(hindi?'प्रवेश दर्ज करें':'Confirm Entry'):(hindi?'निकास दर्ज करें':'Confirm Exit')}</button></>:<p>{visitor.state==='denied'?(hindi?'प्रवेश की अनुमति नहीं है।':'Entry was declined.') :visitor.state==='expired'?(hindi?'नया अनुरोध भेजें।':'A new request is required.'):(hindi?'आगंतुक जा चुका है।':'Visit completed.')}</p>}</footer>
        </article>;
      })}
    </div>
  </section>;
}
