import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, DoorOpen, LogIn, LogOut, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import type { Visitor, VisitorCounts, VisitorFilter, VisitorPagination } from './api';
import { countVisibleVisitors, GateVisitorFilters, GateVisitorPagination, visitorMatchesFilter } from './GateVisitorNavigation';

const states={en:{pending:'Waiting for approval',approved:'Approved',denied:'Declined',inside:'Inside',out:'Checked out',expired:'Expired'},hi:{pending:'अनुमति का इंतज़ार',approved:'अनुमति मिली',denied:'अनुमति नहीं मिली',inside:'अंदर है',out:'निकास दर्ज',expired:'समय समाप्त'}};
export function GateVisitors({visitors,hindi,busy,onMove,counts,pagination,onFilterChange,onPageChange,loading=false}:{visitors:Visitor[];hindi:boolean;busy:boolean;onMove:(visitor:Visitor,action:'in'|'out')=>void;counts?:VisitorCounts;pagination?:VisitorPagination;onFilterChange?:(filter:VisitorFilter)=>void;onPageChange?:(page:number)=>void;loading?:boolean}) {
  const [localFilter,setLocalFilter]=useState<VisitorFilter>('all');
  const filter=pagination?.filter??localFilter;
  const heading=useRef<HTMLHeadingElement>(null);
  const previousPage=useRef<string|undefined>(undefined);
  useEffect(()=>{
    if(!pagination)return;
    const key=`${pagination.filter}:${pagination.page}`;
    if(previousPage.current&&previousPage.current!==key)heading.current?.focus({preventScroll:true});
    previousPage.current=key;
  },[pagination]);
  const labels=states[hindi?'hi':'en'];
  const visible=pagination?visitors:visitors.filter(visitor=>visitorMatchesFilter(visitor,filter));
  return <section className="gate-visitors" aria-labelledby="gate-visitors-title">
    <header className="gate-section-heading"><span className="gate-section-icon"><DoorOpen size={23}/></span><div><h2 id="gate-visitors-title" ref={heading} tabIndex={-1}>{hindi?'आगंतुक अनुरोध':'Visitor requests'}</h2><p>{hindi?'अनुमति और प्रवेश की वर्तमान स्थिति।':'Approvals, arrivals and departures at a glance.'}</p></div></header>
    <GateVisitorFilters filter={filter} counts={counts??countVisibleVisitors(visitors)} hindi={hindi} busy={busy||loading} onChange={next=>{if(onFilterChange)onFilterChange(next);else setLocalFilter(next);}}/>
    <div className="gate-visitor-list" aria-busy={busy||loading}>
      {loading?<p role="status">{hindi?'आगंतुक लोड हो रहे हैं…':'Loading visitors…'}</p>:!visible.length?<div className="gate-visitor-empty"><ShieldCheck size={28}/><h3>{hindi?'कोई अनुरोध नहीं':'No requests here'}</h3><p>{hindi?'इस स्थिति के आगंतुक यहाँ दिखाई देंगे।':'Visitors with this status will appear here.'}</p></div>:null}
      {visible.map(visitor=>{
        const Icon=visitor.state==='pending'?Clock3:['approved','out'].includes(visitor.state)?CheckCircle2:['denied','expired'].includes(visitor.state)?XCircle:DoorOpen;
        return <article key={visitor.id} className="gate-visitor-card">
          <div className="gate-visitor-identity"><span className="gate-visitor-avatar">{visitor.photo_url?<img src={visitor.photo_url} alt={hindi?`${visitor.name} की फोटो`:`Photo of ${visitor.name}`}/>:<UserRound size={21}/>}</span><div><h3>{visitor.name}</h3><p>{visitor.purpose}</p></div><span className={`gate-visitor-status is-${visitor.state}`}><Icon size={14}/>{labels[visitor.state]}</span></div>
          <dl className="gate-visitor-meta">{!visitor.host_user_id?<div><dt>{hindi?'प्रवेश':'Entry'}</dt><dd>{hindi?'सीधा प्रवेश · कोई होस्ट नहीं':'Direct entry · no host'}</dd></div>:null}{visitor.host_name?<div><dt>{hindi?'मिलने वाला व्यक्ति':'Visiting'}</dt><dd>{visitor.host_name}</dd></div>:null}{visitor.phone?<div><dt>{hindi?'मोबाइल':'Mobile'}</dt><dd>{visitor.phone}</dd></div>:null}</dl>
          <footer>{visitor.state==='pending'?<p><Clock3 size={15}/>{hindi?'मिलने वाले व्यक्ति की अनुमति का इंतज़ार है।':'Waiting for the host’s decision.'}</p>:visitor.state==='approved'||visitor.state==='inside'?<><p>{visitor.state==='approved'?(hindi?'अनुमति मिल गई। पहचान जाँचकर प्रवेश दर्ज करें।':'Approved. Check their identity before entry.'):(hindi?'आगंतुक स्कूल के अंदर है।':'Visitor is currently inside the school.')}</p><button className={visitor.state==='approved'?'gate-visitor-enter':'gate-visitor-exit'} disabled={busy} onClick={()=>onMove(visitor,visitor.state==='approved'?'in':'out')}>{visitor.state==='approved'?<LogIn size={17}/>:<LogOut size={17}/>}{visitor.state==='approved'?(hindi?'प्रवेश दर्ज करें':'Confirm Entry'):(hindi?'निकास दर्ज करें':'Confirm Exit')}</button></>:<p>{visitor.state==='denied'?(hindi?'प्रवेश की अनुमति नहीं है।':'Entry was declined.') :visitor.state==='expired'?(hindi?'नया अनुरोध भेजें।':'A new request is required.'):(hindi?'आगंतुक जा चुका है।':'Visit completed.')}</p>}</footer>
        </article>;
      })}
    </div>
    <GateVisitorPagination pagination={pagination} hindi={hindi} busy={busy||loading} onChange={page=>onPageChange?.(page)}/>
  </section>;
}
