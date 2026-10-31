import { findDraftPeriod, type PlannerPeriod } from '../../../packages/contracts/src/academic-planner';
import type { ScheduleScreen, ScheduleVersion } from '../../../packages/contracts/src/wire/features/schedule-planning/api';
import { academicDateRange, cleanSchedulePeriod, validateSchedulePeriods } from './schedule-academic-policy';
import { nativeCalendarShiftDay, nativeCalendarValidDate } from './native-calendar';
export function academicLessonDraftBody(data:ScheduleScreen,classId:string,date:string) {
  const term=data.terms.find(row=>row.id===data.selected_term_id);
  if(!term||!nativeCalendarValidDate(date)||!data.classes.some(row=>row.id===classId)||data.versions.some(row=>row.class_section_id===classId&&row.state==='draft'))throw new Error('Review the current class, term and existing draft before preparing another arrangement.');
  const starts=[date,nativeCalendarShiftDay(data.school_date,1),term.starts_on].sort().at(-1)!;academicDateRange(starts,term.ends_on,data);
  return {term_id:term.id,class_section_id:classId,starts_on:starts,ends_on:term.ends_on};
}
export function academicLessonEditBody(data:ScheduleScreen,original:PlannerPeriod,reviewed:ScheduleVersion,proposal:{subject:string;teacher:string;title:string;room:string;start:string;end:string}) {
  const draft=data.versions.find(row=>row.id===reviewed.id&&row.class_section_id===original.class_section_id&&row.term_id===data.selected_term_id&&row.state==='draft'&&row.revision===reviewed.revision),teaching=original.slot_type==='class';
  if(!draft)throw new Error('This recurring draft changed. Your proposal is kept. Review its current saved revision.');
  const match=findDraftPeriod(draft,original);
  if(!match)throw new Error('The original lesson no longer matches a period in this class draft. Review the current timetable.');
  if(teaching&&(!data.subjects.some(row=>row.id===proposal.subject)||!data.teachers.some(row=>row.id===proposal.teacher)))throw new Error('Choose the current subject and assigned teacher.');
  const updated={...match,subject_id:teaching?proposal.subject:null,teacher_user_id:teaching?proposal.teacher:match.teacher_user_id,title:teaching?data.subjects.find(row=>row.id===proposal.subject)!.name:proposal.title,room:proposal.room,starts_at:proposal.start,ends_at:proposal.end};
  const periods=validateSchedulePeriods(draft.periods.map(row=>cleanSchedulePeriod(row.id===match.id?updated:row)),data);
  return {expected_revision:draft.revision,starts_on:draft.starts_on,ends_on:draft.ends_on,periods};
}
export function academicPlannerReturn(value:string|null,classId:string,date:string,schoolId:string):string|null {
  if(!value)return null;
  try{const url=new URL(value,'https://thatcampus.invalid'),q=url.searchParams;
    if(url.origin!=='https://thatcampus.invalid'||url.pathname!=='/areas/timetable/planning'||url.hash||q.get('class')!==classId||q.get('date')!==date||!nativeCalendarValidDate(date)||q.has('school')&&q.get('school')!==schoolId||q.has('source')&&q.get('source')!=='academic'||[...q.keys()].some(key=>!['source','date','class','period','term','view','school'].includes(key)||q.getAll(key).length!==1))return null;
    q.set('source','academic');return url.pathname+'?'+q;
  }catch{return null;}
}
