import { apiFetch } from "../../lib/api";

/** Published food availability, never an activity, reservation or diner roster. */
export interface DiningAvailabilityItem {
  id: string;
  service_id: string;
  service_name: string;
  source_kind: "session" | "plan_date";
  source_id: string;
  source_revision: number;
  session_id: string | null;
  plan_id: string | null;
  local_date: string;
  label: string;
  menu_text: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  space_id: string | null;
  space_label: string | null;
  state: "planned" | "published" | "open" | "paused" | "ended" | "cancelled";
  changed_for_date: boolean;
  updated_at: string;
  href: string;
  availability_only: true;
  venue_reserved: false;
}

export interface DiningAvailabilityPage {
  items: DiningAvailabilityItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  from: string;
  until: string;
  timezone: string;
  warnings?: DiningAvailabilityWarning[];
}

export interface DiningAvailabilityWarning {
  plan_id: string;
  plan_version_id: string;
  local_date: string;
  weekday: number;
  reason: "nonexistent_time" | "ambiguous_time" | "invalid_duration" | "cancelled_for_date";
  href: string;
}

export const diningAvailabilityNotice: Record<DiningAvailabilityWarning["reason"], string> = {
  nonexistent_time: "Published dining hours need review: the local time does not exist when the clocks change.",
  ambiguous_time: "Published dining hours need review: the local time occurs twice when the clocks change.",
  invalid_duration: "Published dining hours need review: the times do not form a valid serving window.",
  cancelled_for_date: "Dining cancelled for this date.",
};

export const getDiningAvailability = (school: string, date: string, page: number, signal?: AbortSignal) =>
  apiFetch<DiningAvailabilityPage>(`/api/v1/schools/${encodeURIComponent(school)}/dining/availability?${new URLSearchParams({ from: date, until: date, page: String(page) })}`, { signal });

export const diningAvailabilityLabels: Record<DiningAvailabilityItem["state"], string> = {
  planned: "Planned hours",
  published: "Published hours",
  open: "Reported open",
  paused: "Paused",
  ended: "Ended",
  cancelled: "Cancelled",
};
