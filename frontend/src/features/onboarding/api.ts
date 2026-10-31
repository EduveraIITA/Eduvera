import { applicationNow } from "../simulation/applicationTime";
import { apiFetch } from '../../lib/api';
export type InvitationDelivery='manual'|'queued'|'sending'|'email_accepted'|'failed'|'unknown'|'cancelled';
export const deliveryPending=(delivery?:InvitationDelivery|null)=>delivery==='queued'||delivery==='sending';
export const deliveryLabel=(delivery?:InvitationDelivery|null)=>deliveryPending(delivery)?'Sending email…':delivery==='email_accepted'?'Email sent':delivery==='failed'?'Email failed — resend invitation':delivery==='unknown'?'Email unconfirmed — check inbox before resending':delivery==='cancelled'?'Email cancelled':'';
export interface Invitation {delivery_job_id?:string|null;delivery?:InvitationDelivery|null;id:string;person_id?:string|null;school_id?:string;school_name?:string;email:string;role?:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}
export interface ReadyInvitation {delivery_job_id?:string;id?:string;token:string;email:string;expires_at:string;delivery?:InvitationDelivery;delivery_error?:string;delivery_message?:string;replayed?:boolean}
export interface Institution {id:string;name:string;code:string;institution_kind:'school'|'college'|'coaching'|'hybrid'|'unspecified';admin_count:number;pending_admins:number;onboarding_status?:'setup_in_progress'|'active'|'suspended'}
export type InstitutionApplicationStatus='submitted'|'needs_information'|'approved'|'rejected'|'withdrawn';
export interface InstitutionApplication {id:string;workspace_school_id?:string|null;institution_name:string;requested_code:string;institution_kind:'school'|'college'|'coaching'|'hybrid';timezone:string;state_code:string;district:string;website:string;applicant_role_title:string;regulator_type:'udise'|'aishe'|'board_affiliation'|'trust_registration'|'other';regulator_reference:string;status:InstitutionApplicationStatus;review_note:string;revision:number;submitted_at:string;updated_at:string;provisioned_school_id:string|null;first_name?:string;last_name?:string;applicant_email?:string;timeline?:Array<{action:string;from_status:string|null;to_status:string;note:string;created_at:string}>}
export interface CompanyWorkspace {schools:Institution[];invitations:Invitation[];applications:InstitutionApplication[]}
export interface InvitationWorkspace {invitations:Invitation[];students:Array<{id:string;name:string;admission_number:string;email:string|null}>;guardians:Array<{id:string;name:string;email:string|null}>;staff:Array<{id:string;name:string;email:string|null;staff_code:string}>;roles:Array<{id:string;name:string}>;can_invite_admin:boolean}
export const getCompany=()=>apiFetch<CompanyWorkspace>('/api/v1/company/workspace/');
export const createInstitution=(body:unknown)=>apiFetch<{school:Institution;invitation:ReadyInvitation}>('/api/v1/company/institutions/',{method:'POST',body:JSON.stringify(body)});
export const inviteAdmin=(school:string,email:string)=>apiFetch<ReadyInvitation>(`/api/v1/company/institutions/${school}/admin-invitations/`,{method:'POST',body:JSON.stringify({email})});
export const revokeAdmin=(school:string,id:string)=>apiFetch(`/api/v1/company/institutions/${school}/admin-invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export const reviewInstitutionApplication=(id:string,body:{action:'request_information'|'approve'|'reject';note:string;institution_code?:string})=>apiFetch(`/api/v1/company/institution-applications/${id}/review/`,{method:'POST',body:JSON.stringify(body)});
export const submitInstitutionApplication=(body:unknown)=>apiFetch<InstitutionApplication>('/api/v1/onboarding/institution-applications/',{method:'POST',body:JSON.stringify(body)});
export const getInvitations=(school:string)=>apiFetch<InvitationWorkspace>(`/api/v1/schools/${school}/invitations/workspace/`);
export const inviteMember=(school:string,body:unknown)=>apiFetch<ReadyInvitation>(`/api/v1/schools/${school}/invitations/`,{method:'POST',body:JSON.stringify(body)});
export const invitePersonToApp=(school:string,body:{email:string;role:"member";person_id:string;idempotency_key:string;work_context?:{kind:"facility_repair"|"visit_arrangement";source_id:string;access_id:string}})=>apiFetch<ReadyInvitation & {id:string}>(`/api/v1/schools/${encodeURIComponent(school)}/invitations/`,{method:'POST',body:JSON.stringify(body)});
export const getMemberInvitation=(school:string,id:string)=>apiFetch<Invitation>(`/api/v1/schools/${encodeURIComponent(school)}/invitations/${encodeURIComponent(id)}/`);
export const revokeMember=(school:string,id:string)=>apiFetch(`/api/v1/schools/${school}/invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export function invitationState(invitation:Invitation) {return invitation.accepted_at?'Accepted':invitation.revoked_at?'Revoked':new Date(invitation.expires_at)>applicationNow()?'Pending':'Expired';}

export const resendMemberInvitation=(school:string,id:string)=>apiFetch<ReadyInvitation>(`/api/v1/schools/${school}/invitations/${id}/resend/`,{method:'POST',body:'{}'});

export const resendAdminInvitation=(school:string,id:string)=>apiFetch<ReadyInvitation>(`/api/v1/company/institutions/${school}/admin-invitations/${id}/resend/`,{method:'POST',body:'{}'});
