import { weekdayOf } from "../activities/activityExperience";
import { applicationNow } from "../simulation/applicationTime";
import type { DiningRef, DiningService } from "./diningApi";
import type { DiningPlanDay, DiningPlanDayInput } from "./diningPlanApi";
import { diningInput } from "./diningTime";

export interface DiningMenuDraft { label: string; start: string; end: string; menu: string; operator: DiningRef | null; place: DiningRef | null }
export function initialDiningMenu(service: DiningService, timezone: string): DiningMenuDraft {
  return { label: "", start: diningInput(applicationNow(), timezone), end: diningInput(new Date(applicationNow().getTime() + 3600000), timezone), menu: "", operator: service.coordinator, place: service.place };
}
export function diningDraftDay(draft: DiningMenuDraft): DiningPlanDay {
  return { weekday: weekdayOf(draft.start.slice(0, 10)), menu_text: draft.menu, starts_at: draft.start.slice(11, 16), ends_at: draft.end.slice(11, 16), end_day_offset: draft.end.slice(0, 10) > draft.start.slice(0, 10) ? 1 : 0,
    space_id: draft.place?.id ?? null, place: draft.place, operator_person_id: draft.operator?.id ?? "", operator: draft.operator ?? { id: "", label: "Choose a person" }, start_fold: "reject", end_fold: "reject" };
}
export function diningDayInput(day: DiningPlanDay): DiningPlanDayInput {
  const { weekday, menu_text, starts_at, ends_at, end_day_offset, space_id, operator_person_id, start_fold, end_fold } = day;
  return { weekday, menu_text: menu_text.trim(), starts_at, ends_at, end_day_offset, space_id, operator_person_id, start_fold, end_fold };
}
export function validDiningDay(day: DiningPlanDay) {
  return Boolean(day.operator_person_id && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.starts_at) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.ends_at)
    && (day.end_day_offset ? day.ends_at <= day.starts_at : day.ends_at > day.starts_at));
}
