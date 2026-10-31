import type { ActivityRegisterCategory, ActivityRegisterSummary } from "./activity-register";

export const registerCategories: Array<{ value: ActivityRegisterCategory; label: string }> = [
  { value: "needs_recording", label: "To record" },
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "automatic_pending", label: "Automatic pending" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Final" },
  { value: "cancelled", label: "Cancelled" },
];
export function registerCategory(value: string | null): "all" | ActivityRegisterCategory {
  return registerCategories.some(item => item.value === value) ? value as ActivityRegisterCategory : "all";
}
export function registerGroup(item: ActivityRegisterSummary, now: Date): ActivityRegisterCategory {
  if (item.queue_category) return item.queue_category;
  if (item.occurrence_state === "cancelled") return "cancelled";
  if (item.state === "submitted") return item.finalization?.state === "automatic_pending" ? "automatic_pending" : "awaiting_review";
  if (item.state === "locked") return "completed";
  return Date.parse(item.starts_at) > now.getTime() ? "upcoming" : "needs_recording";
}
export function registerKindLabel(kind: string) {
  return ({ teaching: "Lessons & daily attendance", duty: "Duties", training: "Training", meeting: "Meetings", event: "Events", examination: "Examinations", other: "Other activities" } as Record<string, string>)[kind]
    ?? kind.replaceAll("_", " ");
}
export function registerListParams(current: URLSearchParams, values: Record<string, string>) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(values)) {
    if (value) next.set(key, value); else next.delete(key);
  }
  if (["date", "search", "attendance_view", "activity_kind"].some(key => key in values)) next.delete("page");
  return next;
}
