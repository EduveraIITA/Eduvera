import { apiFetch } from '../../lib/api';
export type Rating = 'low'|'okay'|'high'|'na';
export interface Campaign {id:string;title:string;teacher_name:string;class_name:string;audience:'students'|'parents';parameters:string[];closes_at:string;is_closed:boolean;response_count:number;submitted?:boolean}
export interface Workspace {teachers:Array<{id:string;name:string}>;classes:Array<{id:string;grade:string;section:string;academic_year:string}>;campaigns:Campaign[];default_parameters:string[]}
export interface Summary {campaign:Campaign;response_count:number;available:boolean;parameters:Array<{parameter:string;rated:number;counts:Record<Rating,number>|null;signal:string}>}
const root=(school:string,path='')=>`/api/v1/schools/${encodeURIComponent(school)}/teacher-feedback${path}/`;
export const getWorkspace=(school:string)=>apiFetch<Workspace>(root(school));
export const getPending=(school:string)=>apiFetch<{campaigns:Campaign[]}>(root(school,'/pending'));
export const getResults=(school:string,id:string)=>apiFetch<Summary>(root(school,`/${id}/results`));
export const createCampaign=(school:string,data:{title:string;teacher_user_id:string;class_section_id:string;audience:string;parameters:string[];closes_at:string})=>apiFetch<{id:string}>(root(school),{method:'POST',body:JSON.stringify(data)});
export const closeCampaign=(school:string,id:string)=>apiFetch(root(school,`/${id}/close`),{method:'POST'});
export const submitFeedback=(school:string,id:string,ratings:Record<string,Rating>)=>apiFetch(root(school,`/${id}/responses`),{method:'POST',body:JSON.stringify({ratings})});
