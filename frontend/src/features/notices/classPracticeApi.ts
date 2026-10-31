import { apiFetch } from "../../lib/api";
export interface PracticeCommand { command_id: string }
export interface ClassPracticeItem { id:string;date:string;title:string;body:string;due_at:string|null;published_at:string;term_id:string;subject_id:string|null;revision:1 }
export interface ClassPracticeList { school_id:string;timezone:string;today:string;class_section:{id:string;label:string};terms:Array<{id:string;name:string}>;subjects:Array<{id:string;name:string}>;can_publish:boolean;can_publish_general:boolean;items:ClassPracticeItem[];page:number;has_more:boolean }
export interface PracticeNote { id:string;body:string;author_name:string;created_at:string }
export interface ClassPracticeDetail { item:ClassPracticeItem;progress:{items:Array<{id:string;name:string;completed_at:string|null}>;total:number;completed:number;page:number};can_reply:boolean;thread?:PracticeNote[] }
export const getClassPractice=(classId:string,page:number)=>apiFetch<ClassPracticeList>(`/api/v1/learning/practice/?${new URLSearchParams({class_section_id:classId,page:String(page)})}`);
export const getClassPracticeDetail=(classId:string,id:string,page:number,studentId?:string)=>apiFetch<ClassPracticeDetail>(`/api/v1/learning/practice/${encodeURIComponent(id)}/?${new URLSearchParams({class_section_id:classId,page:String(page),...(studentId?{student_id:studentId}:{})})}`);
export const publishClassPractice=(input:PracticeCommand&{practice_id:string;class_section_id:string;term_id:string;subject_id:string|null;date:string;title:string;body:string;due_at:string|null})=>apiFetch<{id:string;revision:1;replayed:boolean}>("/api/v1/learning/practice/",{method:"POST",body:JSON.stringify(input)});
export const replyToPractice=(id:string,input:PracticeCommand&{note_id:string;student_id:string;body:string})=>apiFetch(`/api/v1/learning/practice/${encodeURIComponent(id)}/notes/`,{method:"POST",body:JSON.stringify(input)});
