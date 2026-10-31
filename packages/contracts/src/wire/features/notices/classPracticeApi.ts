/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface ClassPracticeItem { id:string;date:string;title:string;body:string;due_at:string|null;published_at:string;term_id:string;subject_id:string|null;revision:1 }

export interface ClassPracticeList { school_id:string;timezone:string;today:string;class_section:{id:string;label:string};terms:Array<{id:string;name:string}>;subjects:Array<{id:string;name:string}>;can_publish:boolean;can_publish_general:boolean;items:ClassPracticeItem[];page:number;has_more:boolean }

export interface PracticeNote { id:string;body:string;author_name:string;created_at:string }

export interface ClassPracticeDetail { item:ClassPracticeItem;progress:{items:Array<{id:string;name:string;completed_at:string|null}>;total:number;completed:number;page:number};can_reply:boolean;thread?:PracticeNote[] }
