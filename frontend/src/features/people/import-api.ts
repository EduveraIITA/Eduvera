import {apiFetch} from "../../lib/api";
export const importColumns=["admission_number","first_name","last_name","date_of_birth","class","roll_number","enrolled_on","guardian_key","guardian_first_name","guardian_last_name","guardian_phone","guardian_email","relationship"] as const;
export type ImportValues=Record<typeof importColumns[number],string>;
export type ImportGuardianChoice={mode:"new"}|{mode:"existing";id:string};
export interface ImportRow {row_number:number;values:ImportValues;decision:"include"|"skip";guardian_choice:ImportGuardianChoice;errors:string[];warnings:string[];guardian_name:string;class_name:string}
export interface ImportSummary {total:number;included:number;skipped:number;errors:number;warnings:number;new_guardians:number;existing_guardians:number;registers_reopened:number}
export interface ImportReceipt {import_id:string;students:number;guardians_created:number;guardians_reused:number;skipped:number;registers_reopened:number;enrolled:Array<{row_number:number;student_id:string;admission_number:string}>}
export interface ImportDetail {id:string;filename:string;state:"draft"|"committed"|"cancelled"|"expired";revision:number;row_count:number;created_at:string;expires_at:string;receipt:ImportReceipt|null;review:null|{rows:ImportRow[];classes:Array<{id:string;label:string;room:string}>;term:{id:string;name:string;today:string;starts_on:string;ends_on:string};summary:ImportSummary;validation_token:string}}
export interface ImportHistory {id:string;filename:string;state:ImportDetail["state"];revision:number;row_count:number;created_at:string;expires_at:string;term_name:string;created_by_name:string;summary:Omit<ImportReceipt,"enrolled">|null}
export const importsBase="/api/v1/people/imports";
export const importTemplateUrl=(schoolId:string)=>`${importsBase}/template?school_id=${schoolId}`;
export const importReportUrl=(schoolId:string,id:string)=>`${importsBase}/${id}/report?school_id=${schoolId}`;
export const getImports=(schoolId:string,cursor?:string)=>apiFetch<{results:ImportHistory[];next_cursor:string|null}>(`${importsBase}?${new URLSearchParams({school_id:schoolId,...(cursor?{cursor}:{})})}`);
export const getImport=(schoolId:string,id:string)=>apiFetch<ImportDetail>(`${importsBase}/${id}?school_id=${schoolId}`);
export const stageImport=(body:{school_id:string;term_id:string;filename:string;csv:string;idempotency_key:string})=>apiFetch<{id:string}>(importsBase,{method:"POST",body:JSON.stringify(body)});
export const updateImportRow=(id:string,row:number,body:{school_id:string;expected_revision:number;values:ImportValues;decision:"include"|"skip";guardian_choice:ImportGuardianChoice})=>apiFetch<{revision:number}>(`${importsBase}/${id}/rows/${row}`,{method:"POST",body:JSON.stringify(body)});
export const commitImport=(id:string,body:{school_id:string;expected_revision:number;validation_token:string;verified:true})=>apiFetch<ImportReceipt>(`${importsBase}/${id}/commit`,{method:"POST",body:JSON.stringify(body)});
export const cancelImport=(id:string,body:{school_id:string;expected_revision:number})=>apiFetch<{state:string}>(`${importsBase}/${id}/cancel`,{method:"POST",body:JSON.stringify(body)});
