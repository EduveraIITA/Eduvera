import { apiFetch } from "../../lib/api";
export interface EnrollmentOption {class_section_id:string;term_id:string;class_name:string;term_name:string;starts_on:string;ends_on:string;today:string;next_roll:number}
export interface GuardianChoice {id:string;name:string;phone:string;linked_admissions:string}
export type GuardianInput = {mode:"existing";id:string}|{mode:"new";first_name:string;last_name:string;phone:string;email:string};
export interface EnrollmentInput {school_id:string;first_name:string;last_name:string;admission_number:string;date_of_birth:string;class_section_id:string;term_id:string;roll_number:number;enrolled_on:string;guardian:GuardianInput;relationship:"mother"|"father"|"guardian";can_authorize_leave:boolean}
export interface EnrollmentReview {id:string;expires_at:string;input:EnrollmentInput;class_name:string;term_name:string;guardian:{id:string;name:string;phone:string};warnings:string[]}
export interface DirectoryStudent {id:string;name:string;admission_number:string;date_of_birth:string;has_account:boolean;class_name:string;roll_number:number;enrolled_on:string;guardians:Array<{id:string;name:string;phone:string;relationship:string;has_account:boolean}>}
const base="/api/v1/people";
export const enrollmentOptions=(schoolId:string)=>apiFetch<{results:EnrollmentOption[]}>(`${base}/enrollment-options?school_id=${schoolId}`);
export const searchGuardians=(schoolId:string,search:string)=>apiFetch<{results:GuardianChoice[]}>(`${base}/guardians?${new URLSearchParams({school_id:schoolId,search})}`);
export const listStudents=(schoolId:string,search:string,cursor?:string)=>apiFetch<{results:DirectoryStudent[];next_cursor:string|null}>(`${base}/students?${new URLSearchParams({school_id:schoolId,search,...(cursor?{cursor}:{})})}`);
export const reviewEnrollment=(input:EnrollmentInput)=>apiFetch<EnrollmentReview>(`${base}/enrollment-reviews`,{method:"POST",body:JSON.stringify(input)});
export const commitEnrollment=(id:string)=>apiFetch<{student_id:string}>(`${base}/enrollment-reviews/${id}/commit`,{method:"POST",body:"{}"});
export interface AuthoritySnapshot {revision:number;enabled:boolean;valid_from:string|null;valid_until:string|null;source:string}
export interface GuardianAuthority extends AuthoritySnapshot {id:string;student_id:string;student_name:string;guardian_name:string;effective:boolean;today:string;history:Array<{id:string;previous:AuthoritySnapshot;result:AuthoritySnapshot;reason:string;recorded_at:string;actor_name:string}>}
export interface AuthorityCommand {school_id:string;expected_revision:number;enabled:boolean;valid_from:string|null;valid_until:string|null;reason:string;verified:true;idempotency_key:string}
export const getGuardianAuthority=(schoolId:string,id:string)=>apiFetch<GuardianAuthority>(`${base}/guardian-relationships/${id}/leave-authority?school_id=${schoolId}`);
export const changeGuardianAuthority=(id:string,input:AuthorityCommand)=>apiFetch<AuthoritySnapshot>(`${base}/guardian-relationships/${id}/leave-authority`,{method:"POST",body:JSON.stringify(input)});
