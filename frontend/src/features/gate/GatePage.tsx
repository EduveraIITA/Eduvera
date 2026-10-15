import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Link } from 'react-router-dom';
import { Check, QrCode, Search, UserRoundPlus, ArrowLeft, ShieldCheck, ArrowRight, Clock3, Languages } from 'lucide-react';
import { useAuth, authDestination } from '../auth/AuthContext';
import { getGateStudent, gateCommand, getGateWorkspace, type GateStudent, type Visitor, type Workspace } from './api';
import { GateFrame } from './GateFrame';
import { GateStudentSearch } from './GateStudentSearch';
import { GateVisitorForm } from './GateVisitorForm';
import { GateVisitors } from './GateVisitors';
import { gateError } from './gateError';
import { isGateOnlyMember } from '../auth/staffAccess';
import QRScanner from './QRScanner';
import './gate.css';
type Mode='home'|'scan'|'search'|'visitor'|'pending';
const copy={en:{title:'Gate & Safety',scan:'Scan QR',find:'Find Student',visitor:'Visitor Entry',back:'Back',confirmIn:'Confirm Entry',confirmOut:'Confirm Exit',verify:'I checked the student and collecting person',pending:'Pending approvals',allowed:'Allowed',blocked:'Contact school office',waiting:'Waiting for approval',saved:'Recorded successfully',retry:'Please try again',search:'Name or admission number',name:'Visitor name',phone:'Mobile number',purpose:'Purpose of visit',host:'Whom are they visiting?',submit:'Request approval',logout:'Sign out',visitors:'Visitors',inside:'Currently inside',offline:'Offline — contact school office',online:'Connected',entry:'Entry',exit:'Exit',pickup:'Check the collecting person matches this photo',verifyRecord:'Verify the collecting person against the approved school record',expired:'QR is invalid, expired or the pickup arrangement changed. Contact school office.'},hi:{title:'गेट और सुरक्षा',scan:'QR स्कैन करें',find:'छात्र खोजें',visitor:'आगंतुक प्रवेश',back:'वापस',confirmIn:'प्रवेश दर्ज करें',confirmOut:'निकास दर्ज करें',verify:'मैंने छात्र और लेने आए व्यक्ति की पहचान जाँच ली है',pending:'अनुमति बाकी',allowed:'अनुमति है',blocked:'स्कूल कार्यालय से संपर्क करें',waiting:'अनुमति का इंतज़ार है',saved:'सफलतापूर्वक दर्ज हुआ',retry:'कृपया फिर से कोशिश करें',search:'नाम या प्रवेश संख्या',name:'आगंतुक का नाम',phone:'मोबाइल नंबर',purpose:'आने का कारण',host:'किससे मिलना है?',submit:'अनुमति माँगें',logout:'लॉग आउट',visitors:'आगंतुक',inside:'अंदर मौजूद',offline:'इंटरनेट नहीं है — स्कूल कार्यालय से संपर्क करें',online:'जुड़ा हुआ',entry:'प्रवेश',exit:'निकास',pickup:'लेने आए व्यक्ति को इस फोटो से मिलाएँ',verifyRecord:'स्कूल के स्वीकृत रिकॉर्ड से लेने आए व्यक्ति की पहचान जाँचें',expired:'QR अमान्य है, समाप्त हो गया है या अनुमति बदल गई है। स्कूल कार्यालय से संपर्क करें।'}};
export default function GatePage(){
 const auth=useAuth();const member=auth.memberships.find(m=>m.permissions?.includes('gate.manage')||m.role==='admin');
 const school=member?.school_id??'';const key=`eduera:gate-language:${auth.user?.id}:${school}`;
 const [language,setLanguage]=useState<'en'|'hi'>(()=>localStorage.getItem(key)==='hi'?'hi':'en');const t=copy[language];
 const [scannedVisitor,setScannedVisitor]=useState<Visitor|null>(null);
 const [mode,setMode]=useState<Mode>('home');const [person,setPerson]=useState<GateStudent|null>(null);
 const [qr,setQr]=useState<string>();const [kind,setKind]=useState<'student'|'pickup'>('student');
 const [verified,setVerified]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
 const [commandId,setCommandId]=useState(()=>crypto.randomUUID());
 const [visitorRequestId,setVisitorRequestId]=useState(()=>crypto.randomUUID());
 const queryClient=useQueryClient();
 useEffect(()=>{if(!success)return;const timer=window.setTimeout(()=>setSuccess(''),4500);return()=>window.clearTimeout(timer);},[success]);
 const workspace=useQuery({queryKey:['gate',auth.user?.id,school],queryFn:()=>getGateWorkspace(school),enabled:Boolean(school),refetchInterval:30000,retry:false});
 if(!member)return <Navigate to={authDestination(auth)} replace/>;
 function reset(){setMode('home');setScannedVisitor(null);setPerson(null);setQr(undefined);setVerified(false);setError('');setSuccess('');setCommandId(crypto.randomUUID());setVisitorRequestId(crypto.randomUUID());}
 function updateVisitor(visitor:Visitor){queryClient.setQueryData<Workspace>(['gate',auth.user?.id,school],data=>{if(!data)return data;const visitors=data.visitors.some(v=>v.id===visitor.id)?data.visitors.map(v=>v.id===visitor.id?visitor:v):[visitor,...data.visitors];return {...data,visitors,pending:visitors.filter(v=>v.state==='pending').length};});void workspace.refetch();}
 async function scan(value:string){setBusy(true);setError('');try{const r=await gateCommand<{student:GateStudent;kind:'student'|'pickup'}|{visitor:Visitor;kind:'visitor'}>(school,'scan',{qr:value});if(r.kind==='visitor'){setScannedVisitor(r.visitor);setMode('pending');return;}setPerson(r.student);setKind(r.kind);setQr(value);setVerified(false);setCommandId(crypto.randomUUID());}catch{setError(t.expired);setMode('home');}finally{setBusy(false);}}
 async function selectStudent(id:string){setBusy(true);setError('');try{setPerson(await getGateStudent(school,id));setKind('student');setQr(undefined);setVerified(false);setCommandId(crypto.randomUUID());}catch{setError(t.retry);}finally{setBusy(false);}}
 const direction=kind==='pickup'?'out':'in';
 const allowed=person&&(direction==='in'?person.direction!=='in':person.direction==='in'&&person.plan_state==='ready');
 async function confirm(){if(!person||!verified)return;setBusy(true);setError('');try{await gateCommand(school,'movements',{student_id:person.id,direction,qr,identity_verified:true,command_id:commandId});reset();setSuccess(t.saved);void workspace.refetch();}catch{setError(t.expired);}finally{setBusy(false);}}
 async function visitor(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');setSuccess('');try{const result=await gateCommand<Visitor>(school,'visitors',{...Object.fromEntries(form),request_id:visitorRequestId});reset();updateVisitor(result);setMode('pending');setSuccess(language==='hi'?'अनुमति का अनुरोध भेज दिया गया।':'Approval request sent to the host.');}catch(error){setError(gateError(error,language==='hi',t.retry));}finally{setBusy(false);}}
 async function moveVisitor(visitor:Visitor,action:'in'|'out'){setBusy(true);setError('');setSuccess('');try{const result=await gateCommand<{saved:boolean;visitor:Visitor}>(school,`visitors/${visitor.id}/${action}`,{expected_revision:visitor.revision});reset();updateVisitor(result.visitor);setMode('pending');setSuccess(language==='hi'?(action==='in'?'आगंतुक का प्रवेश दर्ज हुआ।':'आगंतुक का निकास दर्ज हुआ।'):(action==='in'?'Visitor entry recorded.':'Visitor exit recorded.'));}catch(error){setError(gateError(error,language==='hi',t.retry));void workspace.refetch();}finally{setBusy(false);}}
 const Heading=isGateOnlyMember(member)?'h1':'h2';
 return <GateFrame member={member} hindi={language==='hi'}><section className="gate-shell gate-workspace" lang={language==='hi'?'hi':'en'}>
  <header className="gate-header"><div><span className="gate-eyebrow"><ShieldCheck size={15} aria-hidden="true"/>{language==='hi'?'प्रवेश और निकास':'Manage In & Out'}</span><Heading>{t.title}</Heading><p>{language==='hi'?'छात्रों और आगंतुकों का सुरक्षित प्रवेश और निकास।':'Safe arrivals and departures, all in one place.'}</p></div><button className="gate-language" onClick={()=>{const next=language==='en'?'hi':'en';setLanguage(next);localStorage.setItem(key,next);setError('');setSuccess('');}} aria-label="Switch Hindi / English"><Languages size={17} aria-hidden="true"/>{language==='en'?'हिन्दी':'English'}</button></header>
  {mode!=='home'||person?<button className="gate-back" disabled={busy} onClick={reset}><ArrowLeft size={20}/>{t.back}</button>:null}
  {success?<div className="gate-success" role="status"><Check/>{success}<button onClick={()=>setSuccess('')} aria-label={t.back}>×</button></div>:null}
  {error?<p className="gate-error" role="alert">{error}</p>:null}
  {workspace.isError?<p className="gate-error" role="alert">{t.offline}<button onClick={()=>void workspace.refetch()}>{t.retry}</button></p>:null}
  {(error||person&&!allowed)&&workspace.data?.office?.phone?<a className="gate-office" href={`tel:${workspace.data.office.phone}`}>{t.blocked}</a>:null}
  {busy?<p className="gate-search-status" role="status">{language==='hi'?'कृपया रुकें…':'Please wait…'}</p>:null}
  {person?<section className="gate-person"><div className="gate-person-heading">{person.avatar_url?<img src={person.avatar_url} alt={person.name}/>:<div className="gate-avatar" aria-hidden="true">{person.name.slice(0,1)}</div>}<h2>{person.name}</h2><p>{person.class_label} · {person.admission_number}</p></div><p className={allowed?'gate-status allowed':'gate-status blocked'}>{allowed?t.allowed:t.blocked} · {direction==='in'?t.entry:t.exit}</p>
   {direction==='out'?<div className="gate-collector">{person.collector_photo?<img src={person.collector_photo} alt={person.collector_name??''}/>:null}<strong>{person.collector_name|| (language==='hi'?'स्वतंत्र निकास स्वीकृत':'Independent departure approved')}</strong>{person.mode!=='independent_departure'?<p>{person.collector_photo?t.pickup:t.verifyRecord}</p>:null}</div>:null}
   {allowed?<><label className="gate-verify"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>{t.verify}</label><button className="gate-primary" disabled={!verified||busy} onClick={()=>void confirm()}>{direction==='in'?t.confirmIn:t.confirmOut}</button></>:null}
  </section>:mode==='home'?<>
   <div className="gate-actions">
    <button className="gate-action gate-action--scan" disabled={busy} onClick={()=>{setSuccess('');setMode('scan');}} aria-label={t.scan}><span className="gate-action-icon"><QrCode aria-hidden="true"/></span><span className="gate-action-copy"><strong>{t.scan}</strong><small>{language==='hi'?'छात्र या पिकअप पास स्कैन करें':'Student or pickup pass'}</small></span><ArrowRight className="gate-action-arrow" size={21} aria-hidden="true"/></button>
    <button className="gate-action" onClick={()=>{setSuccess('');setMode('search');}} aria-label={t.find}><span className="gate-action-icon"><Search aria-hidden="true"/></span><span className="gate-action-copy"><strong>{t.find}</strong><small>{language==='hi'?'नाम या प्रवेश संख्या से खोजें':'Search name or admission no.'}</small></span><ArrowRight className="gate-action-arrow" size={18} aria-hidden="true"/></button>
    <button className="gate-action" onClick={()=>{setSuccess('');setMode('visitor');}} aria-label={t.visitor}><span className="gate-action-icon gate-action-icon--visitor"><UserRoundPlus aria-hidden="true"/></span><span className="gate-action-copy"><strong>{t.visitor}</strong><small>{language==='hi'?'जानकारी दर्ज करें और अनुमति माँगें':'Register and request approval'}</small></span><ArrowRight className="gate-action-arrow" size={18} aria-hidden="true"/></button>
   </div>
   <button className="gate-pending" onClick={()=>setMode('pending')}><Clock3 size={20} aria-hidden="true"/><span>{t.pending}</span><strong>{workspace.data?.pending??'—'}</strong><ArrowRight size={17} aria-hidden="true"/></button>
   <p className="gate-safety-note"><ShieldCheck size={17} aria-hidden="true"/>{language==='hi'?'दर्ज करने से पहले छात्र और लेने आए व्यक्ति की पहचान जाँचें।':'Check the student and collecting person before confirming.'}</p>
   {member.role==='admin'?<Link className="gate-admin-link" to="/principal/gate">Manage gate access <ArrowRight size={16}/></Link>:null}
  </>:mode==='scan'?<QRScanner hindi={language==='hi'} onScan={value=>void scan(value)}/>:mode==='search'?<GateStudentSearch school={school} hindi={language==='hi'} busy={busy} onSelect={student=>void selectStudent(student.id)}/>:mode==='visitor'?<GateVisitorForm hosts={workspace.data?.hosts??[]} hindi={language==='hi'} busy={busy} onSubmit={event=>void visitor(event)}/>:<GateVisitors visitors={scannedVisitor?[scannedVisitor]:workspace.data?.visitors??[]} hindi={language==='hi'} busy={busy} onMove={(visitor,action)=>void moveVisitor(visitor,action)}/>}
 </section></GateFrame>;
}
