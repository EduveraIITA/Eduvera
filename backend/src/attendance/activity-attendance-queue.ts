import type { z } from "zod";
import type { ActivityAttendanceSummary, attendanceQueueSchema } from "./activity-attendance.contracts.js";

export const attendanceQueueCategories = ["needs_recording", "awaiting_review", "automatic_pending", "upcoming", "completed", "cancelled"] as const;
export type AttendanceQueueCategory = typeof attendanceQueueCategories[number];

/** Projection only: never grants recording authority or changes register truth. */
export function attendanceQueueCategory(item: ActivityAttendanceSummary, now: Date): AttendanceQueueCategory {
  if (item.occurrence_state === "cancelled") return "cancelled";
  if (item.state === "submitted") return item.finalization?.state === "automatic_pending" ? "automatic_pending" : "awaiting_review";
  if (item.state === "locked") return "completed";
  if (Date.parse(item.starts_at) > now.getTime()) return "upcoming";
  return "needs_recording";
}

/** Compose facets and filters over ALL currently authorized dated summaries,
 * before page slicing/materialization. Never count only the visible page. */
export function composeAttendanceQueue(items: readonly ActivityAttendanceSummary[], input: z.infer<typeof attendanceQueueSchema>, now: Date) {
  const search = input.search.toLocaleLowerCase();
  const searched = items.filter(item => !search || `${item.title} ${item.place_label} ${item.kind}`.toLocaleLowerCase().includes(search));
  const availableKinds = [...new Set(searched.map(item => item.kind))].sort().map(kind => ({ kind, count: searched.filter(item => item.kind === kind).length }));
  const matching = searched.filter(item => !input.kind || item.kind === input.kind).map(item => ({ ...item, queue_category: attendanceQueueCategory(item, now) }));
  const counts = { all: matching.length, needs_recording: 0, awaiting_review: 0, automatic_pending: 0, upcoming: 0, completed: 0, cancelled: 0 };
  for (const item of matching) counts[item.queue_category]++;
  const filtered = matching.filter(item => input.view === "all" || item.queue_category === input.view);
  filtered.sort((a, b) => attendanceQueueCategories.indexOf(a.queue_category) - attendanceQueueCategories.indexOf(b.queue_category)
    || a.starts_at.localeCompare(b.starts_at) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { items: filtered, counts, available_kinds: availableKinds, unfiltered_total: items.length };
}
