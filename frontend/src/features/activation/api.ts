import { apiFetch } from "../../lib/api";

export interface ActivationCheck { key:string; label:string; description:string; target_path:string; required:boolean; complete:boolean; detail:string }
export interface ActivationWorkspace {
  institution:{ id:string;name:string;code:string;timezone:string;institution_kind:string;onboarding_model:string;verification_status:string;capability_pack:string;capability_label:string;capability_description:string;cohort_label:string;learner_label:string;default_subject_names:string[];requires_staff:boolean;status:"draft"|"ready"|"active";revision:number;reviewed_at:string|null;activated_at:string|null };
  checks:ActivationCheck[];
  summary:{completed:number;required:number;percent:number;ready:boolean};
  counts:{terms:number;cohorts:number;subjects:number;staff:number;learners:number;schedule:number};
  history:Array<{id:string;action:string;from_status:string|null;to_status:string;note:string;created_at:string}>;
}

const path=(schoolId:string,suffix="")=>`/api/v1/schools/${schoolId}/activation/${suffix}`;
export const getActivation=(schoolId:string)=>apiFetch<ActivationWorkspace>(path(schoolId));
export const applyQuickStart=(schoolId:string,body:unknown)=>apiFetch<ActivationWorkspace>(path(schoolId,"quick-start/"),{method:"POST",body:JSON.stringify(body)});
export const reviewActivation=(schoolId:string)=>apiFetch<ActivationWorkspace>(path(schoolId,"review/"),{method:"POST",body:"{}"});
export const activateInstitution=(schoolId:string,expectedRevision:number)=>apiFetch<ActivationWorkspace>(path(schoolId,"activate/"),{method:"POST",body:JSON.stringify({expected_revision:expectedRevision})});
