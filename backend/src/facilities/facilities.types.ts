import type { Generated } from 'kysely';

export type FacilitiesState='reported'|'accepted'|'in_progress'|'waiting'|'awaiting_verification'|'closed';
export type FacilitiesAction='reported'|'accepted'|'assigned'|'updated'|'completed'|'verified'|'reopened'|'photo_added'|'external_shared'|'external_ready'|'external_ended';
export type FacilitiesWaitReason='parts'|'contractor'|'approval'|'access'|'other';
export type FacilitiesAssetImpact='not_working'|'degraded';
export interface FacilitiesIntakeRuleTable {
 id:string;school_id:string;revision:number;handler_person_id:string;verifier_mode:'reporter'|'handler'|'named';verifier_person_id:string|null;
 emergency_contact:string;created_by_person_id:string;created_by_user_id:string;command_id:string;created_at:Date;
}
export interface FacilitiesRepairTable {
 id:string;school_id:string;rule_id:string;problem:string;space_id:string|null;holding_id:string|null;location_note:string;asset_impact:FacilitiesAssetImpact|null;
 reporter_person_id:string;recorder_person_id:string;coordinator_person_id:string;handler_person_id:string;verifier_person_id:string;urgent:boolean;
 state:FacilitiesState;wait_reason:FacilitiesWaitReason|null;expected_finish_at:Date|null;
 revision:Generated<number>;created_at:Date;updated_at:Date;coordination_receipt:Generated<unknown>;external_assignment_id:Generated<string|null>;
}
export interface FacilitiesRepairReceiptTable {
 id:string;school_id:string;repair_id:string;revision:number;command_id:string;action:FacilitiesAction;
 actor_person_id:string;actor_user_id:string;note:string;state:FacilitiesState;wait_reason:FacilitiesWaitReason|null;
 reopen_kind:'further_work'|'record_amendment'|null;
 expected_finish_at:Date|null;handler_person_id:string;previous_handler_person_id:string|null;verifier_person_id:string;previous_verifier_person_id:string|null;coordinator_person_id:string;previous_coordinator_person_id:string|null;recorded_at:Date;external_assignment_id:Generated<string|null>;
}
export interface FacilitiesExternalAssignmentTable {
 id:string;school_id:string;repair_id:string;source_revision:number;person_id:string;person_revision:number;
 starts_at:Date;ends_at:Date;instructions:string;shared_photo_ids:string[];status:'granted'|'ended';previous_assignment_id:string|null;
 actor_person_id:string;actor_user_id:string;command_id:string;recorded_at:Date;
}
export interface FacilitiesRepairPhotoTable {
 id:string;school_id:string;repair_id:string;receipt_revision:number;file_name:string;content_type:'image/jpeg'|'image/png';
 size:number;sha256:string;created_by_person_id:string;created_at:Date;
}
