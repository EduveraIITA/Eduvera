/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
declare const importColumns: readonly ["admission_number", "first_name", "last_name", "date_of_birth", "class", "roll_number", "enrolled_on", "guardian_key", "guardian_first_name", "guardian_last_name", "guardian_phone", "guardian_email", "relationship"];

export type ImportValues=Record<typeof importColumns[number],string>&Partial<Record<"person_id"|"person_revision"|"guardian_person_id"|"guardian_person_revision",string>>;

export type ImportGuardianChoice={mode:"new"}|{mode:"existing";id:string}|{mode:"none"}|{mode:"person";person_id:string;expected_revision:number};

export interface ImportRow {row_number:number;values:ImportValues;decision:"include"|"skip";guardian_choice:ImportGuardianChoice;errors:string[];warnings:string[];guardian_name:string;class_name:string;normalized?:{person?:{id:string;expected_revision:number}}|null}

export interface ImportSummary {total:number;included:number;skipped:number;errors:number;warnings:number;new_guardians:number;existing_guardians:number;registers_reopened:number}

export interface ImportReceipt {import_id:string;students:number;guardians_created:number;guardians_reused:number;skipped:number;registers_reopened:number;enrolled:Array<{row_number:number;student_id:string;admission_number:string}>}

export interface ImportDetail {id:string;filename:string;state:"draft"|"committed"|"cancelled"|"expired";revision:number;row_count:number;created_at:string;expires_at:string;receipt:ImportReceipt|null;review:null|{rows:ImportRow[];classes:Array<{id:string;label:string;room:string}>;term:{id:string;name:string;today:string;starts_on:string;ends_on:string};summary:ImportSummary;validation_token:string}}

export interface ImportHistory {id:string;filename:string;state:ImportDetail["state"];revision:number;row_count:number;created_at:string;expires_at:string;term_name:string;created_by_name:string;summary:Omit<ImportReceipt,"enrolled">|null}
