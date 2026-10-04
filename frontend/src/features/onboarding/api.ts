import { apiFetch } from '../../lib/api';
export interface Invitation {id:string;school_id?:string;school_name?:string;email:string;role?:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}
export interface ReadyInvitation {token:string;email:string;expires_at:string}
export interface Institution {id:string;name:string;code:string;institution_kind:'school'|'college';admin_count:number;pending_admins:number}
export interface CompanyWorkspace {schools:Institution[];invitations:Invitation[]}
export interface InvitationWorkspace {invitations:Invitation[];students:Array<{id:string;name:string;admission_number:string;email:string|null}>;guardians:Array<{id:string;name:string;email:string|null}>;roles:Array<{id:string;name:string}>;can_invite_admin:boolean}
export const getCompany=()=>apiFetch<CompanyWorkspace>('/api/v1/company/workspace/');
export const createInstitution=(body:unknown)=>apiFetch<{school:Institution;invitation:ReadyInvitation}>('/api/v1/company/institutions/',{method:'POST',body:JSON.stringify(body)});
export const inviteAdmin=(school:string,email:string)=>apiFetch<ReadyInvitation>(`/api/v1/company/institutions/${school}/admin-invitations/`,{method:'POST',body:JSON.stringify({email})});
export const revokeAdmin=(school:string,id:string)=>apiFetch(`/api/v1/company/institutions/${school}/admin-invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export const getInvitations=(school:string)=>apiFetch<InvitationWorkspace>(`/api/v1/schools/${school}/invitations/workspace/`);
export const inviteMember=(school:string,body:unknown)=>apiFetch<ReadyInvitation>(`/api/v1/schools/${school}/invitations/`,{method:'POST',body:JSON.stringify(body)});
export const revokeMember=(school:string,id:string)=>apiFetch(`/api/v1/schools/${school}/invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export function invitationState(invitation:Invitation) {return invitation.accepted_at?'Accepted':invitation.revoked_at?'Revoked':new Date(invitation.expires_at)>new Date()?'Pending':'Expired';}
