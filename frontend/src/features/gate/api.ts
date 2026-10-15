import { apiFetch } from '../../lib/api';
export interface GateStudent {id:string;name:string;avatar_url:string;admission_number:string;class_label:string;direction:'in'|'out'|null;plan_id:string|null;plan_state:string|null;mode:string|null;collector_name:string|null;collector_photo:string|null}
export type GateStudentMatch = Pick<GateStudent, 'id' | 'name' | 'avatar_url' | 'admission_number' | 'class_label' | 'plan_state'>;
export interface Visitor {id:string;name:string;purpose:string;state:'pending'|'approved'|'denied'|'inside'|'out'}
export interface Workspace {office?:{name:string;phone:string}|null;visitors:Visitor[];hosts:Array<{id:string;name:string}>;pending:number}
export interface QRPass {qr:string;expires_at:string;kind:string;name:string}
export const gateRoot=(school:string)=>`/api/v1/gate/schools/${school}`;
export const gateCommand=<T,>(school:string,path:string,body:unknown={})=>apiFetch<T>(`${gateRoot(school)}/${path}/`,{method:'POST',body:JSON.stringify(body)});
export const getGateWorkspace=(school:string)=>apiFetch<Workspace>(`${gateRoot(school)}/workspace/`);
export const findGateStudents=(school:string,q:string,signal?:AbortSignal)=>apiFetch<GateStudentMatch[]>(`${gateRoot(school)}/students/?q=${encodeURIComponent(q)}`,{signal});
export const getGateStudent=(school:string,id:string)=>apiFetch<GateStudent>(`${gateRoot(school)}/students/${encodeURIComponent(id)}/`);
