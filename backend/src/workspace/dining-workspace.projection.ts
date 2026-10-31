import type { DiningService } from "../dining/dining.service.js";
import type { WorkspaceRecord } from "./workspace.contracts.js";

type Availability = Awaited<ReturnType<DiningService["ownedAvailability"]>>;

const labels = {
  planned: "Planned hours",
  published: "Published hours",
  open: "Reported open",
  paused: "Paused",
  ended: "Ended",
  cancelled: "Cancelled",
} as const;

/** Exact native responsibilities only: no diner assignment, booking or attendance. */
export function diningTodayRecords(source: Availability, at: Date) {
  const candidates = source.items.flatMap(item => {
    const starts = Date.parse(item.starts_at), ends = Date.parse(item.ends_at);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts
      || item.state === "cancelled" || item.state === "ended" || ends <= at.getTime()) return [];
    const time = new Intl.DateTimeFormat("en", { timeZone: item.timezone, hour: "numeric", minute: "2-digit" });
    const current = starts <= at.getTime() && ends > at.getTime();
    const record: WorkspaceRecord = {
      id: `dining-availability:${item.id}`,
      title: item.label,
      detail: [item.service_name, item.space_label, labels[item.state], item.changed_for_date ? "Changed for this date" : null].filter(Boolean).join(" · "),
      status_label: labels[item.state],
      time_label: `${time.format(new Date(item.starts_at))}–${time.format(new Date(item.ends_at))}`,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      local_date: item.local_date,
      href: item.href,
      action_label: "Open dining",
      source_label: "Published dining availability · not a venue booking or proof of service",
      source_at: item.updated_at,
      tone: item.state === "paused" ? "attention" : current ? "info" : "neutral",
    };
    return [{ record, starts, current }];
  }).sort((a, b) => a.starts - b.starts || a.record.id.localeCompare(b.record.id));
  return {
    now: candidates.filter(item => item.current).slice(0, 5).map(item => item.record),
    next: [
      ...(source.warnings ?? []).filter(warning => warning.reason !== "cancelled_for_date").map(warning => ({
        id: `dining-time-warning:${warning.plan_version_id}:${warning.local_date}`,
        title: "Dining time needs review",
        detail: warning.reason === "nonexistent_time" ? "Published hours fall in a clock-change gap."
          : warning.reason === "invalid_duration" ? "Published hours do not form a valid serving window." : "Published hours repeat during a clock change.",
        status_label: "Time unresolved",
        local_date: warning.local_date,
        href: warning.href,
        action_label: "View dining date",
        source_label: "Published dining pattern · no resolved serving time",
        tone: "attention" as const,
      })),
      ...candidates.filter(item => !item.current).map(item => item.record),
    ].slice(0, 5),
  };
}
