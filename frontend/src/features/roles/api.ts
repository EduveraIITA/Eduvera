import { apiFetch } from "../../lib/api";

export interface AccessOption { code: string; group: string; label: string; description: string }
export interface WorkProfileTemplate { key: string; name: string; description: string; duty_codes: readonly string[] }
export interface ProfileDuty {
  id: string; code: string; name: string; category: string; scope_kind: string;
  description: string; access_summary: string; requires_acceptance: boolean; restricted: boolean;
}
export interface WorkProfile {
  id: string; name: string; description: string; template_key: string | null; system_managed: boolean;
  duty_ids: string[]; revision: number; member_count: number;
}
export interface DutyMismatch { kind: "responsibility" | "class" | "event" | "assessment" | "transport" | "support"; id: string; title: string; status: string; scope_label: string }
export interface ProfileMember {
  user_id: string; name: string; email: string; role: string; profile_ids: string[];
  primary_profile_id: string | null; role_id: string | null; duty_mismatches: DutyMismatch[];
}
export interface AccessException {
  id: string; user_id?: string; permission: string; label?: string; reason: string;
  source_kind: string; scope_kind: string; valid_from: string; valid_until: string;
  review_due_on: string; status: string; revision: number;
}
export interface AccessExplanation {
  permission: string; label: string; source_type: string; source_id: string;
  source_name: string; scope_label: string; starts_on: string; ends_on: string | null;
}
export interface MemberAccess {
  member: { name: string; email: string };
  permissions: string[];
  explanations: AccessExplanation[];
  exceptions: AccessException[];
}
export interface WorkProfileWorkspace {
  templates: WorkProfileTemplate[]; exception_options: AccessOption[]; duties: ProfileDuty[];
  profiles: WorkProfile[]; roles: WorkProfile[]; members: ProfileMember[]; exceptions: AccessException[];
}

const base=(school:string)=>`/api/v1/schools/${school}/roles`;
export const getRoles=(school:string)=>apiFetch<WorkProfileWorkspace>(`${base(school)}/workspace/`);
export const saveProfile=(school:string,data:{name:string;description:string;duty_ids:string[];template_key:string|null;expected_revision?:number},id?:string)=>apiFetch<WorkProfile>(`${base(school)}/${id ? id+'/' : ''}`,{method:id?'PATCH':'POST',body:JSON.stringify(data)});
export const deleteProfile=(school:string,profile:WorkProfile)=>apiFetch(`${base(school)}/${profile.id}/delete/`,{method:'POST',body:JSON.stringify({expected_revision:profile.revision})});
export const assignProfiles=(school:string,member:ProfileMember,profileIds:string[],primaryProfileId:string|null)=>apiFetch(`${base(school)}/members/${member.user_id}/assignment/`,{method:'POST',body:JSON.stringify({profile_ids:profileIds,primary_profile_id:primaryProfileId,expected_profile_ids:member.profile_ids})});
export const getMemberAccess=(school:string,userId:string)=>apiFetch<MemberAccess>(`${base(school)}/members/${userId}/access/`);
export const addAccessException=(school:string,userId:string,data:{permission:string;reason:string;scope_kind:"institution"|"assigned_resources";valid_from:string;valid_until:string})=>apiFetch(`${base(school)}/members/${userId}/exceptions/`,{method:'POST',body:JSON.stringify(data)});
export const revokeAccessException=(school:string,exceptionRow:AccessException,reason:string)=>apiFetch(`${base(school)}/exceptions/${exceptionRow.id}/revoke/`,{method:'POST',body:JSON.stringify({expected_revision:exceptionRow.revision,reason})});

export type CustomRole = WorkProfile;
