/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type InvitationDelivery='manual'|'queued'|'sending'|'email_accepted'|'failed'|'unknown'|'cancelled';

export interface Invitation {delivery_job_id?:string|null;delivery?:InvitationDelivery|null;id:string;person_id?:string|null;school_id?:string;school_name?:string;email:string;role?:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}

export type InstitutionApplicationStatus='submitted'|'needs_information'|'approved'|'rejected'|'withdrawn';

export interface InstitutionApplication {id:string;workspace_school_id?:string|null;institution_name:string;requested_code:string;institution_kind:'school'|'college'|'coaching'|'hybrid';timezone:string;state_code:string;district:string;website:string;applicant_role_title:string;regulator_type:'udise'|'aishe'|'board_affiliation'|'trust_registration'|'other';regulator_reference:string;status:InstitutionApplicationStatus;review_note:string;revision:number;submitted_at:string;updated_at:string;provisioned_school_id:string|null;first_name?:string;last_name?:string;applicant_email?:string;timeline?:Array<{action:string;from_status:string|null;to_status:string;note:string;created_at:string}>}
