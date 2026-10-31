/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type ResourceView = "loans" | "items" | "mine";

export type ResourceCondition = "usable" | "damaged" | "held";

export interface ResourceItem {
  id: string; name: string; asset_tag: string | null; campus_id: string; campus_name: string; revision: number;
  tracking_mode: string; state: string; available: boolean; unavailable_reason: string | null; active_loan_id: string | null;
}

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
