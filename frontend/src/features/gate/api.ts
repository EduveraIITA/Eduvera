import { apiFetch } from '../../lib/api';
export interface GateStudent {id:string;name:string;avatar_url:string;admission_number:string;class_label:string;direction:'in'|'out'|null;plan_id:string|null;plan_state:string|null;mode:string|null;collector_name:string|null;collector_photo:string|null}
export type GateStudentMatch = {roll_number?:number|null} & Pick<GateStudent, 'id' | 'name' | 'avatar_url' | 'admission_number' | 'class_label' | 'plan_state' | 'direction'>;
export interface GateStaff {id:string;name:string;avatar_url:string;staff_code:string;designation:string;department:string;direction:'in'|'out'|null;last_movement_at:string|null;revision:number}
export interface GateActivity {id:string;kind:'student'|'staff'|'visitor';person_id:string;name:string;avatar_url:string|null;detail:string;direction:'in'|'out'|null;status:'pending'|'approved'|'in'|'out';occurred_at:string;state:string|null}
export interface Visitor {id:string;name:string;phone?:string;purpose:string;state:'pending'|'approved'|'denied'|'inside'|'out'|'expired';school_id:string;school_name?:string;photo_url?:string|null;category?:string;host_user_id?:string|null;host_name?:string;revision:number;created_at?:string;expires_at?:string;checked_in_at?:string;checked_out_at?:string}
export interface Workspace {office?:{name:string;phone:string}|null;visitors:Visitor[];hosts:Array<{id:string;name:string}>;pending:number;activity:GateActivity[]}
export interface QRPass {qr:string;expires_at:string;kind:string;name:string}
export const gateRoot=(school:string)=>`/api/v1/gate/schools/${school}`;
export const gateCommand=<T,>(school:string,path:string,body:unknown={})=>apiFetch<T>(`${gateRoot(school)}/${path}/`,{method:'POST',body:JSON.stringify(body)});
export const getGateWorkspace=(school:string)=>apiFetch<Workspace>(`${gateRoot(school)}/workspace/`);
export const findGateStudents=(school:string,q:string,signal?:AbortSignal)=>apiFetch<GateStudentMatch[]>(`${gateRoot(school)}/students/?q=${encodeURIComponent(q)}`,{signal});
export const getGateStudent=(school:string,id:string)=>apiFetch<GateStudent>(`${gateRoot(school)}/students/${encodeURIComponent(id)}/`);
export const findGateStaff=(school:string,q:string,signal?:AbortSignal)=>apiFetch<GateStaff[]>(`${gateRoot(school)}/staff/?q=${encodeURIComponent(q)}`,{signal});
export const getGateStaff=(school:string,id:string)=>apiFetch<GateStaff>(`${gateRoot(school)}/staff/${encodeURIComponent(id)}/`);
export const getVisitorApprovals=(signal?:AbortSignal)=>apiFetch<Visitor[]>('/api/v1/gate/visitor-approvals/',{signal});
export const gateApprovalsQueryKey=(userId:string|undefined,activeSchoolId:string|null|undefined)=>['gate-approvals',userId,activeSchoolId??'all'] as const;

export const createGateVisitor=(school:string,form:FormData)=>apiFetch<Visitor>(`${gateRoot(school)}/visitors/`,{method:'POST',body:form});
