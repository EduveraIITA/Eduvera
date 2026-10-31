import type { SchedulePeriod } from './schedule-period';
/** Date-only planner projection. The selected-world date is always explicit. */
export interface AcademicPlannerData {
  classes:Array<{id:string;name:string}>;
  teachers:Array<{id:string;name:string}>;
  subjects:Array<{id:string;name:string}>;
  versions:Array<{id:string;class_section_id:string;state:'draft'|'published';starts_on:string;ends_on:string;baseline:boolean;periods:SchedulePeriod[]}>;
  calendar_exceptions:Array<{date:string;is_instructional:boolean}>;
  slots:Array<Omit<SchedulePeriod,'title'>&{class_section_id:string;class_name:string;teacher_name:string|null;display_title:string}>;
}
const isoWeekday=(date:string)=>{const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day===0?7:day;};
function activeVersion(data: AcademicPlannerData, classId: string, date: string) {
  return data.versions
    .filter((version) => version.class_section_id === classId && version.state === "published" && version.starts_on <= date && version.ends_on >= date)
    .sort((left, right) => Number(left.baseline) - Number(right.baseline) || right.starts_on.localeCompare(left.starts_on))[0];
}

export interface PlannerPeriod extends SchedulePeriod {
  class_section_id: string;
  class_name: string;
  teacher_name: string | null;
  display_title: string;
  version_id: string | null;
  version_state: "draft" | "published" | null;
}

export function effectivePeriodsForDate(data: AcademicPlannerData, date: string, classFilter = "all"): PlannerPeriod[] {
  if (data.calendar_exceptions.some((item) => item.date === date && !item.is_instructional)) return [];
  const weekday = isoWeekday(date);
  return data.classes.flatMap<PlannerPeriod>((schoolClass) => {
    if (classFilter !== "all" && classFilter !== schoolClass.id) return [];
    const draft = data.versions.find((version) => version.class_section_id === schoolClass.id && version.state === "draft" && version.starts_on <= date && version.ends_on >= date);
    const version = draft ?? activeVersion(data, schoolClass.id, date);
    if (version) return version.periods.filter((period) => period.weekday === weekday).map((period) => ({
      ...period,
      class_section_id: schoolClass.id,
      class_name: schoolClass.name,
      teacher_name: data.teachers.find((teacher) => teacher.id === period.teacher_user_id)?.name ?? null,
      display_title: data.subjects.find((subject) => subject.id === period.subject_id)?.name ?? period.title,
      version_id: version.id,
      version_state: version.state,
    }));
    return data.slots.filter((slot) => slot.class_section_id === schoolClass.id && slot.weekday === weekday).map((slot) => ({
      id: slot.id,
      class_section_id: slot.class_section_id,
      class_name: slot.class_name,
      subject_id: slot.subject_id,
      teacher_user_id: slot.teacher_user_id,
      teacher_name: slot.teacher_name,
      weekday: slot.weekday,
      period_number: slot.period_number,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      title: slot.display_title,
      display_title: slot.display_title,
      version_id: null,
      version_state: "published" as const,
      slot_type: slot.slot_type,
      room: slot.room,
    }));
  }).sort((left, right) => left.starts_at.localeCompare(right.starts_at) || left.class_name.localeCompare(right.class_name));
}


/** Draft copies have new IDs; match the same period within the selected class. */
export function findDraftPeriod(draft:{periods:SchedulePeriod[]},original:SchedulePeriod) {
  return draft.periods.find(item=>item.id===original.id)??draft.periods.find(item=>item.weekday===original.weekday&&item.period_number===original.period_number&&item.subject_id===original.subject_id&&item.starts_at.slice(0,5)===original.starts_at.slice(0,5));
}
