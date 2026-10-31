/** Existing account, invitation and progressive setup wire contracts. No UI or transport. */
export type InvitationDelivery='manual'|'queued'|'sending'|'email_accepted'|'failed'|'unknown'|'cancelled';
export interface Invitation {delivery_job_id?:string|null;delivery?:InvitationDelivery|null;id:string;person_id?:string|null;school_id?:string;school_name?:string;email:string;role?:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}
export interface ReadyInvitation {delivery_job_id?:string;id?:string;token:string;email:string;expires_at:string;delivery?:InvitationDelivery;delivery_error?:string;delivery_message?:string;replayed?:boolean}
export interface Institution {id:string;name:string;code:string;institution_kind:'school'|'college'|'coaching'|'hybrid'|'unspecified';admin_count:number;pending_admins:number;onboarding_status?:'setup_in_progress'|'active'|'suspended'}
export type InstitutionApplicationStatus='submitted'|'needs_information'|'approved'|'rejected'|'withdrawn';
export interface InstitutionApplication {id:string;workspace_school_id?:string|null;institution_name:string;requested_code:string;institution_kind:'school'|'college'|'coaching'|'hybrid';timezone:string;state_code:string;district:string;website:string;applicant_role_title:string;regulator_type:'udise'|'aishe'|'board_affiliation'|'trust_registration'|'other';regulator_reference:string;status:InstitutionApplicationStatus;review_note:string;revision:number;submitted_at:string;updated_at:string;provisioned_school_id:string|null;first_name?:string;last_name?:string;applicant_email?:string;timeline?:Array<{action:string;from_status:string|null;to_status:string;note:string;created_at:string}>}
export interface CompanyWorkspace {schools:Institution[];invitations:Invitation[];applications:InstitutionApplication[]}
export interface InvitationWorkspace {invitations:Invitation[];students:Array<{id:string;name:string;admission_number:string;email:string|null}>;guardians:Array<{id:string;name:string;email:string|null}>;staff:Array<{id:string;name:string;email:string|null;staff_code:string}>;roles:Array<{id:string;name:string}>;can_invite_admin:boolean}
export type GoalKey = 'attendance'|'gate'|'timetable'|'assignments'|'fees'|'resources'|'facilities'|'accommodation'|'dining'|'examinations'|'performance'|'staff'|'messages';
export interface StartingGoal {key:GoalKey|'whole_campus'|'explore';label:string;description:string;destination:string;selection_kind:'goal'|'shortcut'|'demo';selected:boolean}
export interface ProgressiveWorkspace {
  status:'workspace_required'|'purpose_required'|'ready';
  workspace:null|{id:string;display_name:string;profile_named:boolean;timezone:string;verification_status:string;onboarding_model:string};
  goals:{selected:GoalKey[];primary:GoalKey|null};
  resume:{step:'purpose'|'first_use'|'operating';goal:GoalKey|null;path:string;
    continuation?:{kind:'activity_plan'|'learning_assignment';actor_user_id:string;school_id:string;source_id:string;source_revision:number;requires_recheck:true}};
  catalogue:StartingGoal[];applications:InstitutionApplication[];
  guidance?:'whole_campus'|null;
  guidance_resume?:null|{kind:'whole_campus';path:'/more/setup/whole-campus';actor_user_id:string;school_id:string;requires_recheck:true};
}
export interface AttendanceOperationReadiness {
  actor_user_id:string;
  action:'record'|'review'|'view';
  state:'ready'|'opens_later'|'waiting_for_recorder'|'waiting_for_review'|'automatic_pending'|'complete'|'requires_domain_check';
  scope:{kind:'occurrence'|'class';id:string;date:string};
  source_revision:number|null;register_revision:number|null;evaluated_at:string;starts_at:string|null;requires_recheck:true;
}
export interface TimetableOperationReadiness {
  actor_user_id:string;environment_namespace_id:string;action:'create'|'continue'|'view'|'unavailable';
  state:'ready_to_create'|'draft'|'published'|'historical'|'cancelled'|'superseded'|'unavailable';
  scope:{kind:'plan';id:string;date:string}|null;source_revision:number|null;evaluated_at:string;requires_recheck:true;
  recovery?:'source_changed'|'source_unavailable'|'authority_changed';
}
export interface AssignmentsOperationReadiness {
  actor_user_id:string;environment_namespace_id:string;action:'create'|'continue'|'view'|'unavailable';
  state:'requires_setup'|'ready_to_create'|'draft'|'published'|'unavailable';
  scope:{kind:'class'|'offering'|'person'|'assignment';id:string}|null;source_revision:number|null;
  evaluated_at:string;requires_recheck:true;destination:string;
  recovery?:'source_changed'|'source_unavailable'|'authority_changed';
}
export interface FeesOperationReadiness {
  actor_user_id:string;environment_namespace_id:string;action:'record_charge'|'view'|'unavailable';
  state:'ready_to_record'|'charge_recorded'|'unavailable';scope:{kind:'invoice';id:string;person_id:string}|{kind:'batch';id:string;person_count:number}|null;
  source_revision:number|null;evaluated_at:string;requires_recheck:true;destination:string;
}
export interface ResourceLoansOperationReadiness {actor_user_id:string;environment_namespace_id:string;action:'issue'|'view'|'unavailable';state:'ready_to_issue'|'loan_recorded'|'borrower_view'|'unavailable';scope:{kind:'loan';id:string}|null;source_revision:number|null;evaluated_at:string;requires_recheck:true;destination:string}
export interface FacilitiesOperationReadiness {actor_user_id:string;environment_namespace_id:string;action:'report'|'view'|'configure'|'unavailable';state:'repair_recorded'|'ready_to_report'|'needs_intake'|'unavailable';scope:{kind:'repair';id:string}|null;source_revision:number|null;evaluated_at:string;requires_recheck:true;destination:string}
export interface AccommodationOperationReadiness {actor_user_id:string;environment_namespace_id:string;action:'offer'|'view'|'configure'|'unavailable';state:'arrangement_recorded'|'offer_recorded'|'ready_to_offer'|'needs_rooms'|'unavailable';scope:{kind:'stay';id:string}|null;source_revision:number|null;evaluated_at:string;requires_recheck:true;destination:string}
export interface DiningOperationReadiness {actor_user_id:string;environment_namespace_id:string;action:'view'|'publish'|'configure'|'unavailable';state:'menu_published'|'draft_recorded'|'ready_to_plan'|'needs_service'|'unavailable';scope:{kind:'session'|'plan';id:string}|null;source_revision:number|null;evaluated_at:string;requires_recheck:true;destination:string}
export interface CapabilityReadiness {capability:GoalKey;label:string;status:'working'|'needs_setup';destination:string;setup_path:string;counts:Record<string,number>;missing:Array<{key:string;label:string;reason:string;destination:string}>;operation?:AttendanceOperationReadiness;timetable_operation?:TimetableOperationReadiness;assignments_operation?:AssignmentsOperationReadiness;fees_operation?:FeesOperationReadiness;resources_operation?:ResourceLoansOperationReadiness;facilities_operation?:FacilitiesOperationReadiness;accommodation_operation?:AccommodationOperationReadiness;dining_operation?:DiningOperationReadiness}
export interface SetupOption {id:string;label:string}
export interface ProgressiveSetup {school_id:string;working_now:CapabilityReadiness[];useful_next:CapabilityReadiness[];available_anytime:CapabilityReadiness[];options:{classes:SetupOption[];students:SetupOption[];staff:SetupOption[];gates:SetupOption[]}}
export interface SetupResult {capability:GoalKey;status:'working';readiness:CapabilityReadiness;destination:string;notes:string[];created:Record<string,number|boolean>;reused:Record<string,number|boolean>}
