/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
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
