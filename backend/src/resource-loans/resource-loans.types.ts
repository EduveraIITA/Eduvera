import type { Generated } from 'kysely';

export interface ResourceLoanTable {
 id:string;issue_order:Generated<string>;school_id:string;holding_id:string;borrower_person_id:string;custodian_person_id:string;issued_by_user_id:string;
 item_name:string;asset_tag:string;issued_at:Date;due_at:Date;custody_purpose:string;revision:Generated<number>;created_at:Date;
}
export interface ResourceLoanPartTable {id:string;school_id:string;loan_id:string;kind:'item'|'component';label:string;quantity:number}
export interface ResourceLoanQuestionTable {
 id:string;school_id:string;loan_id:string;reporter_person_id:string;kind:'question'|'returned_claim';note:string;
 state:Generated<'open'|'resolved'>;revision:number;created_at:Date;resolved_at:Date|null;claimed_return_at:Date|null;coordination_receipt:Generated<unknown>;
}
export type ResourceLoanAction='issued'|'return_recorded'|'return_corrected'|'due_changed'|'question_asked'|'replied'|'resolved'|'custody_changed';
export interface ResourceLoanReceiptTable {
 id:string;school_id:string;loan_id:string;revision:number;command_id:string;action:ResourceLoanAction;actor_person_id:string;actor_user_id:string;
 observed_at:Date|null;recorded_at:Date;reason:Generated<string>;note:Generated<string>;due_at:Date|null;previous_due_at:Date|null;
 supersedes_receipt_id:string|null;question_id:string|null;
 previous_custodian_person_id:Generated<string|null>;custodian_person_id:Generated<string|null>;
 custody_basis:Generated<'named_custodian'|'orphan_recovery'|null>;previous_question_message_id:Generated<string|null>;
}
export interface ResourceLoanReceiptPartTable {school_id:string;loan_id:string;receipt_id:string;part_id:string;quantity:number;condition:'usable'|'damaged'|'held'}
