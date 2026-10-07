import { apiFetch } from "../../lib/api";

export interface InsightStudent {
  id:string;name:string;class_id:string;class_name:string;expected:number;recorded:number;scored:number;points:number;
  previous_expected:number;previous_recorded:number;previous_scored:number;previous_points:number;
  missing_homework:number;open_followups:number;current:number;previous:number;change:number;combined:boolean;
}
export interface PrincipalInsights {
  school_id:string;school_name:string;generated_at:string;timezone:string;operational_date:string;class_section_id:string|null;threshold:number;
  period:{start:string;end:string;baseline_start:string;baseline_end:string;days:number};classes:Array<{id:string;name:string}>;
  attendance:{expected:number;recorded:number;scored:number;points:number;percentage:number|null;completeness:number|null;
    daily:Array<{date:string;expected:number;recorded:number;scored:number;points:number;percentage:number|null}>;
    classes:Array<{id:string;name:string;expected:number;recorded:number;scored:number;points:number;percentage:number|null;completeness:number|null}>};
  engagement:{total:number;combined:number;without_followup:number;students:InsightStudent[];without_followup_students:InsightStudent[]};
  followups:{awaiting:number;review:number;resolved:number;overdue:number;details:Array<{id:string;student_name:string;class_id:string;attendance_date:string;state:string;owner:string;overdue:boolean}>};
  learning:Array<{id:string;title:string;class_name:string;subject:string;assessed:number;below:number;roster:number;published_at:string}>;
  schedule:Array<{date:string;planned:number;unassigned:number;cancelled:number}>;
  deadlines:Array<{date:string;class_id:string;class_name:string;homework:number;assessments:number;total:number}>;
  fees:Array<{band:string;due_paise:number;paid_paise:number;balance_paise:number}>;
}
export function getPrincipalInsights(schoolId:string,date:string,days:number,classId:string,threshold:number) {
  const params=new URLSearchParams({date,days:String(days),threshold:String(threshold)});
  if(classId) params.set("class_section_id",classId);
  return apiFetch<PrincipalInsights>(`/api/v1/schools/${encodeURIComponent(schoolId)}/principal-insights/?${params}`);
}
