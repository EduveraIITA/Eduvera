import type {Kysely,Transaction} from "kysely";
import type {Database} from "../database/types.js";
import type {GuardianChoice,ImportValues} from "./import-csv.js";
export type ImportDb=Kysely<Database>|Transaction<Database>;
export interface ImportJob {id:string;school_id:string;term_id:string;created_by:string;filename:string;state:"draft"|"committed"|"cancelled"|"expired";revision:number;row_count:number;receipt:ImportReceipt|null;commit_token:string|null;created_at:Date;expires_at:Date}
export interface ImportRow {row_number:number;values:ImportValues;decision:"include"|"skip";guardian_choice:GuardianChoice;student_id?:string|null}
export interface ImportReceipt {import_id:string;students:number;guardians_created:number;guardians_reused:number;skipped:number;registers_reopened:number;enrolled:Array<{row_number:number;student_id:string;admission_number:string}>}
export interface ClassOption {id:string;label:string;room:string}
export interface ImportTerm {id:string;name:string;starts_on:string;ends_on:string;today:string;is_active:boolean;academic_year:string}
export interface ExistingGuardian {id:string;name:string;phone:string;email:string;revision:number}
export interface ImportRegister {id:string;class_section_id:string;date:string;state:string;revision:number}
export interface NormalizedRow {row_number:number;admission_number:string;first_name:string;last_name:string;date_of_birth:string;class_section_id:string;roll_number:number;enrolled_on:string;relationship:"mother"|"father"|"guardian";guardian_group:string;guardian_choice:GuardianChoice;guardian_first_name:string;guardian_last_name:string;guardian_phone:string;guardian_email:string}
export interface CheckedRow extends ImportRow {errors:string[];warnings:string[];normalized:NormalizedRow|null;guardian_name:string;class_name:string}
export interface ImportValidation {rows:CheckedRow[];classes:ClassOption[];term:ImportTerm;registers:ImportRegister[];selected_guardians:ExistingGuardian[];validation_token:string;summary:{total:number;included:number;skipped:number;errors:number;warnings:number;new_guardians:number;existing_guardians:number;registers_reopened:number}}
