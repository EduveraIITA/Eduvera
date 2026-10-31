/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
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
