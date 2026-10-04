import { apiFetch } from "../../lib/api";
export interface Permission { code: string; group: string; label: string; description: string }
export interface CustomRole { id: string; name: string; description: string; permissions: string[]; revision: number; member_count: number }
export interface RoleMember { user_id: string; name: string; email: string; role: string; role_id: string | null }
export interface Workspace { permissions: Permission[]; roles: CustomRole[]; members: RoleMember[] }
const base=(school:string)=>`/api/v1/schools/${school}/roles`;
export const getRoles=(school:string)=>apiFetch<Workspace>(`${base(school)}/workspace/`);
export const saveRole=(school:string,data:{name:string;description:string;permissions:string[];expected_revision?:number},id?:string)=>apiFetch(`${base(school)}/${id ? id+'/' : ''}`,{method:id?'PATCH':'POST',body:JSON.stringify(data)});
export const deleteRole=(school:string,role:CustomRole)=>apiFetch(`${base(school)}/${role.id}/delete/`,{method:'POST',body:JSON.stringify({expected_revision:role.revision})});
export const assignRole=(school:string,member:RoleMember,role:string|null)=>apiFetch(`${base(school)}/members/${member.user_id}/assignment/`,{method:'POST',body:JSON.stringify({role_id:role,expected_role_id:member.role_id})});
