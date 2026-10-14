import { useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../auth/AuthContext';
import { gateCommand, type QRPass } from './api';
import './gate.css';
export function FamilyGatePass({school,student}:{school:string;student:string}) {
 const auth=useAuth();const [pass,setPass]=useState<{data:QRPass;image:string}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(!auth.memberships.some(m=>m.role==='guardian'&&m.school_id===school))return null;
 async function issue(kind:'student'|'pickup'){setBusy(true);setError('');try{const data=await gateCommand<QRPass>(school,'passes',{student_id:student,kind});setPass({data,image:await QRCode.toDataURL(data.qr,{width:320,margin:2})});}catch(e){setError(e instanceof Error?e.message:'Pass unavailable.');}finally{setBusy(false);}}
 return <section className="gate-admin-section gate-qr"><h2>Gate QR pass</h2><button disabled={busy} onClick={()=>void issue('student')}>Student entry QR</button> <button disabled={busy} onClick={()=>void issue('pickup')}>My pickup QR</button>{error?<p role="alert">{error}</p>:null}{pass?<><img src={pass.image} alt={`${pass.data.kind} QR pass`}/><p>{pass.data.kind==='pickup'?'Show this to the gatekeeper. Identity verification is required.':'Student entry pass — does not authorize pickup.'}</p><p>Expires: {new Date(pass.data.expires_at).toLocaleString()}</p><button onClick={()=>setPass(undefined)}>Hide pass</button></>:null}</section>;
}
