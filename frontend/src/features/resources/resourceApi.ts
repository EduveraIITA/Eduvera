import { apiFetch } from "../../lib/api";

export type ResourceView = "loans" | "items" | "mine";
export type ResourceFilter = "all" | "outstanding" | "overdue" | "returned" | "questions";
export type ResourceCondition = "usable" | "damaged" | "held";
export interface ResourceItem {
  id: string; name: string; asset_tag: string | null; campus_id: string; campus_name: string; revision: number;
  tracking_mode: string; state: string; available: boolean; unavailable_reason: string | null; active_loan_id: string | null;
}
/** Quantity is the accepted creation count; every created item is still one tracked copy. */
export interface ResourceItemCreation extends ResourceItem {quantity:number;created_items:ResourceItem[]}
export interface ResourceLoan {
  id: string; title: string; asset_tag: string; borrower: { id: string; label: string }; custodian: { id: string; label: string };
  issued_at: string; due_at: string; revision: number; state: "outstanding" | "overdue" | "returned" | "held";
  outstanding_count: number; question_count: number;
}
export interface ResourceReceipt {
  id: string; action: string; actor_label: string; observed_at: string | null; recorded_at: string;
  reason: string | null; note: string | null; due_at: string | null; previous_due_at: string | null; supersedes_receipt_id: string | null; question_id: string | null;
  parts: Array<{ part_id: string; quantity: number; condition: ResourceCondition }>;
  previous_custodian?:{id:string;label:string}|null;custodian?:{id:string;label:string}|null;custody_basis?:"named_custodian"|"orphan_recovery"|null;
}
export interface ResourcePart { id: string; label: string; quantity: number; returned_quantity: number; outstanding_quantity: number; condition: ResourceCondition }
export interface ResourceQuestion {
  id: string; kind: "question" | "returned_claim"; note: string; state: "open" | "resolved";
  reporter: { id: string; label: string }; created_at: string; resolved_at: string | null; claimed_return_at: string | null; revision: number;
  replies: Array<{ id: string; note: string; actor_label: string; recorded_at: string; action: "replied" | "resolved" }>;
}
export interface ResourceLoanDetail extends ResourceLoan {
  parts: ResourcePart[]; history: ResourceReceipt[]; history_has_more: boolean; questions: ResourceQuestion[];
  can_record_return: boolean; can_change_due: boolean; can_question: boolean; can_reply: boolean; can_resolve:boolean;
  can_change_custodian:boolean;custody_recovery:boolean;
}
export interface ResourceCustodians {people:Array<{id:string;label:string}>;recovery:boolean;pagination:{page:number;page_size:number;total:number}}
export interface ResourcesPage {
  view: ResourceView; can_manage: boolean; can_issue: boolean; loans: ResourceLoan[]; items: ResourceItem[];
  totals: { outstanding: number; overdue: number; questions: number }; pagination: { page: number; page_size: number; total: number };
}
export interface ResourceOptions {
  campuses: Array<{ id: string; name: string }>; people: Array<{ id: string; label: string; revision:number }>; holdings: ResourceItem[];
  actor: { person_id: string; label: string }; can_manage: boolean; can_add_people:boolean;
  pagination:{page:number;page_size:25;people_total:number;holdings_total:number};
}
export interface ResourceConfirmation { state: "not_found" | "pending" | "not_accepted" | "accepted"; result?: { id: string; revision: number } }
export interface ResourceCommand { command_id: string; expected_revision: number }
export interface ResourceIssue extends ResourceCommand {
  holding_id: string; borrower_person_id: string; due_at: string; custody_confirmed: true; custody_purpose: string;
  components: Array<{ label: string; quantity: number }>;
}
export interface ResourceReturn extends ResourceCommand {
  observed_at: string; reason: string; correction: boolean; supersedes_receipt_id?: string;
  parts: Array<{ part_id: string; quantity: number; condition: ResourceCondition }>;
}
const root=(schoolId:string)=>`/api/v1/schools/${encodeURIComponent(schoolId)}/resources`;
const loan=(schoolId:string,id:string)=>`${root(schoolId)}/loans/${encodeURIComponent(id)}`;
const post=<T>(path:string,body:unknown)=>apiFetch<T>(path,{method:"POST",body:JSON.stringify(body)});
export const getResources=(schoolId:string,query:{view:ResourceView;state:ResourceFilter;search:string;page:number})=>apiFetch<ResourcesPage>(`${root(schoolId)}/workspace?${new URLSearchParams({...query,page:String(query.page)})}`);
export const getResourceOptions=(schoolId:string,query:{search?:string;page?:number;holding_id?:string;person_id?:string}={})=>{
  const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined && value!=="")params.set(key,String(value));
  return apiFetch<ResourceOptions>(`${root(schoolId)}/options${params.size ? `?${params}` : ""}`);
};
export const createResourceItem=(schoolId:string,body:{name:string;quantity?:number;asset_tag?:string;campus_id:string;resource_type_id?:string;command_id:string})=>post<ResourceItemCreation>(`${root(schoolId)}/items`,body);
export const issueResource=(schoolId:string,body:ResourceIssue)=>post<ResourceLoanDetail>(`${root(schoolId)}/loans`,body);
export const getResourceLoan=(schoolId:string,id:string)=>apiFetch<ResourceLoanDetail>(loan(schoolId,id));
export const returnResource=(schoolId:string,id:string,body:ResourceReturn)=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/returns`,body);
export const changeResourceDue=(schoolId:string,id:string,body:ResourceCommand&{due_at:string;reason:string})=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/due-date`,body);
export const getResourceCustodians=(schoolId:string,id:string,query:{search?:string;page?:number}={})=>apiFetch<ResourceCustodians>(`${loan(schoolId,id)}/custodians?${new URLSearchParams({search:query.search??"",page:String(query.page??1)})}`);
export const changeResourceCustodian=(schoolId:string,id:string,body:ResourceCommand&{custodian_person_id:string;reason:string})=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/responsibility`,body);
export const askResourceQuestion=(schoolId:string,id:string,body:ResourceCommand&{kind:"question"|"returned_claim";note:string;claimed_return_at?:string|null})=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/questions`,body);
export const replyResourceQuestion=(schoolId:string,id:string,questionId:string,body:ResourceCommand&{note:string})=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/questions/${encodeURIComponent(questionId)}/replies`,body);
export const resolveResourceQuestion=(schoolId:string,id:string,questionId:string,body:ResourceCommand&{note:string})=>post<ResourceLoanDetail>(`${loan(schoolId,id)}/questions/${encodeURIComponent(questionId)}/resolve`,body);
export const confirmResourceCommand=(schoolId:string,id:string,commandId:string)=>apiFetch<ResourceConfirmation>(`${loan(schoolId,id)}/confirmation?${new URLSearchParams({command_id:commandId})}`);
