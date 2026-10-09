import { apiFetch } from '../../lib/api';
export interface Invitation {id:string;school_id?:string;school_name?:string;email:string;role?:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}
export interface ReadyInvitation {token:string;email:string;expires_at:string;delivery?:'manual'|'email_accepted'|'failed';delivery_error?:string;delivery_message?:string}
export interface Institution {id:string;name:string;code:string;institution_kind:'school'|'college'|'coaching'|'hybrid';admin_count:number;pending_admins:number;onboarding_status?:'setup_in_progress'|'active'|'suspended'}
export type InstitutionApplicationStatus='submitted'|'needs_information'|'approved'|'rejected'|'withdrawn';
export interface InstitutionApplication {id:string;institution_name:string;requested_code:string;institution_kind:'school'|'college'|'hybrid';timezone:string;state_code:string;district:string;website:string;applicant_role_title:string;regulator_type:'udise'|'aishe'|'board_affiliation'|'trust_registration'|'other';regulator_reference:string;status:InstitutionApplicationStatus;review_note:string;revision:number;submitted_at:string;updated_at:string;provisioned_school_id:string|null;first_name?:string;last_name?:string;applicant_email?:string;timeline?:Array<{action:string;from_status:string|null;to_status:string;note:string;created_at:string}>}
export interface CompanyWorkspace {schools:Institution[];invitations:Invitation[];applications:InstitutionApplication[]}
export interface OnboardingWorkspace {applications:InstitutionApplication[];coaching_workspaces:Array<{id:string;name:string;code:string;timezone:string;institution_kind:'coaching';onboarding_model:'self_service_coaching';verification_status:'not_required';created_at:string}>}
export interface InvitationWorkspace {invitations:Invitation[];students:Array<{id:string;name:string;admission_number:string;email:string|null}>;guardians:Array<{id:string;name:string;email:string|null}>;roles:Array<{id:string;name:string}>;can_invite_admin:boolean}
export const getCompany=()=>apiFetch<CompanyWorkspace>('/api/v1/company/workspace/');
export const createInstitution=(body:unknown)=>apiFetch<{school:Institution;invitation:ReadyInvitation}>('/api/v1/company/institutions/',{method:'POST',body:JSON.stringify(body)});
export const inviteAdmin=(school:string,email:string)=>apiFetch<ReadyInvitation>(`/api/v1/company/institutions/${school}/admin-invitations/`,{method:'POST',body:JSON.stringify({email})});
export const revokeAdmin=(school:string,id:string)=>apiFetch(`/api/v1/company/institutions/${school}/admin-invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export const reviewInstitutionApplication=(id:string,body:{action:'request_information'|'approve'|'reject';note:string;institution_code?:string})=>apiFetch(`/api/v1/company/institution-applications/${id}/review/`,{method:'POST',body:JSON.stringify(body)});
export const getOnboardingWorkspace=()=>apiFetch<OnboardingWorkspace>('/api/v1/onboarding/workspace/');
export const submitInstitutionApplication=(body:unknown)=>apiFetch<InstitutionApplication>('/api/v1/onboarding/institution-applications/',{method:'POST',body:JSON.stringify(body)});
export const createCoachingWorkspace=(body:unknown)=>apiFetch<{id:string;name:string;code:string}>('/api/v1/onboarding/coaching-workspaces/',{method:'POST',body:JSON.stringify(body)});
export const getInvitations=(school:string)=>apiFetch<InvitationWorkspace>(`/api/v1/schools/${school}/invitations/workspace/`);
export const inviteMember=(school:string,body:unknown)=>apiFetch<ReadyInvitation>(`/api/v1/schools/${school}/invitations/`,{method:'POST',body:JSON.stringify(body)});
export const revokeMember=(school:string,id:string)=>apiFetch(`/api/v1/schools/${school}/invitations/${id}/revoke/`,{method:'POST',body:'{}'});
export function invitationState(invitation:Invitation) {return invitation.accepted_at?'Accepted':invitation.revoked_at?'Revoked':new Date(invitation.expires_at)>new Date()?'Pending':'Expired';}

export const resendMemberInvitation=(school:string,id:string)=>apiFetch<ReadyInvitation>(`/api/v1/schools/${school}/invitations/${id}/resend/`,{method:'POST',body:'{}'});

export const resendAdminInvitation=(school:string,id:string)=>apiFetch<ReadyInvitation>(`/api/v1/company/institutions/${school}/admin-invitations/${id}/resend/`,{method:'POST',body:'{}'});
