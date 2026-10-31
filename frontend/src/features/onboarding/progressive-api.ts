import { apiFetch } from '../../lib/api';
import type { InstitutionApplication } from './api';

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
export const getProgressiveWorkspace=()=>apiFetch<ProgressiveWorkspace>('/api/v1/onboarding/workspace/');
export const createPrivateWorkspace=(body:{goals?:Array<GoalKey|'whole_campus'>;timezone?:string;guidance?:'whole_campus'|null})=>apiFetch<ProgressiveWorkspace>('/api/v1/onboarding/workspace/',{method:'POST',body:JSON.stringify(body)});
export const saveStartingGoals=(goals:Array<GoalKey|'whole_campus'>,primary?:GoalKey,guidance?:'whole_campus'|null)=>apiFetch<ProgressiveWorkspace>('/api/v1/onboarding/goals/',{method:'PUT',body:JSON.stringify({goals,primary,...(guidance===undefined?{}:{guidance})})});
export const saveWorkspaceProfile=(body:{display_name:string;timezone?:string})=>apiFetch('/api/v1/onboarding/workspace-profile/',{method:'PATCH',body:JSON.stringify(body)});
export const saveOnboardingResume=(body:{step:'purpose'|'first_use'|'operating';goal?:GoalKey;path:string})=>apiFetch('/api/v1/onboarding/resume/',{method:'PATCH',body:JSON.stringify(body)});
export const getProgressiveSetup=(school:string)=>apiFetch<ProgressiveSetup>(`/api/v1/schools/${school}/get-started/`);
export const prepareCapability=(school:string,capability:'attendance'|'gate',body:unknown)=>apiFetch<SetupResult>(`/api/v1/schools/${school}/get-started/${capability}/`,{method:'POST',body:JSON.stringify(body)});
