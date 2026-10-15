import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useAuth, authDestination } from '../auth/AuthContext';
import { gateCommand, getGateWorkspace, findGateStudents, type GateStudent, type QRPass } from './api';
import './gate.css';
export default function GateAdminPage(){
 const auth=useAuth(),member=auth.memberships.find(m=>m.role==='admin'),school=member?.school_id??'';
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [q,setQ]=useState(''),[students,setStudents]=useState<GateStudent[]>([]),[pass,setPass]=useState<{image:string;data:QRPass}>();
 const workspace=useQuery({queryKey:['gate-admin',school],queryFn:()=>getGateWorkspace(school),enabled:!!school,refetchInterval:10000});
 if(!member)return <Navigate to={authDestination(auth)} replace/>;
 async function search(e:React.FormEvent){e.preventDefault();setBusy(true);try{setStudents(await findGateStudents(school,q));}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function issue(student:string,kind:'student'|'pickup'){setBusy(true);setError('');try{const data=await gateCommand<QRPass>(school,'passes',{student_id:student,kind});setPass({data,image:await QRCode.toDataURL(data.qr,{width:320,margin:2})});}catch(e){setError(e instanceof Error?e.message:'QR unavailable.');}finally{setBusy(false);}}
 async function visitorQR(id:string){setBusy(true);setError('');try{const data=await gateCommand<QRPass>(school,`visitors/${id}/pass`);setPass({data,image:await QRCode.toDataURL(data.qr,{width:320,margin:2})});}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function decide(id:string,action:string){setBusy(true);try{await gateCommand(school,`visitors/${id}/${action}`);void workspace.refetch();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <main className="gate-shell"><header className="gate-header"><div><h1>Gate & Safety</h1><small>{member.school_name}</small></div><Link to="/principal/more">Back</Link></header><Link to="/gate">Open gatekeeper screen</Link>{error?<p className="gate-error" role="alert">{error}</p>:null}
 <p>Configure <strong>Manage In & Out</strong> through <Link to="/principal/staff?section=roles">Roles & permissions</Link>, then assign the role from the <Link to="/principal/staff?section=directory">staff member’s profile</Link>. Users with gate access can choose Hindi or English on the gatekeeper screen.</p>
 <section className="gate-admin-section"><h2>Student & pickup QR passes</h2><p>Pickup passes require today’s approved departure plan to be marked ready. They expire after 15 minutes and can be used once.</p><form className="gate-form" onSubmit={e=>void search(e)}><label>Find student<input value={q} onChange={e=>setQ(e.target.value)}/></label><button disabled={busy}>Search</button></form><div className="gate-list">{students.map(s=><div key={s.id}><strong>{s.name}</strong><p>{s.class_label} · {s.admission_number}</p><button disabled={busy} onClick={()=>void issue(s.id,'student')}>Student QR</button> <button disabled={busy||s.plan_state!=='ready'} onClick={()=>void issue(s.id,'pickup')}>Pickup QR</button></div>)}</div>{pass?<div className="gate-qr"><h3>{pass.data.name}</h3><img src={pass.image} alt={`${pass.data.kind} QR pass`}/><p>Expires: {new Date(pass.data.expires_at).toLocaleString()}</p><a href={pass.image} download={`eduera-${pass.data.kind}-qr.png`}>Download QR</a><button onClick={()=>setPass(undefined)}>Close</button></div>:null}</section>
 <section className="gate-admin-section"><h2>Visitor approvals</h2>{workspace.isError?<p role="alert">Unable to load visitors. <button onClick={()=>void workspace.refetch()}>Retry</button></p>:null}<div className="gate-list">{workspace.data?.visitors.map(v=><div key={v.id}><strong>{v.name}</strong><p>{v.purpose} · {v.state}</p>{['approved','inside'].includes(v.state)?<button disabled={busy} onClick={()=>void visitorQR(v.id)}>Visitor QR</button>:null}{v.state==='pending'?<><button disabled={busy} onClick={()=>void decide(v.id,'approve')}>Approve</button> <button disabled={busy} onClick={()=>void decide(v.id,'deny')}>Deny</button></>:null}</div>)}</div></section></main>;
}
