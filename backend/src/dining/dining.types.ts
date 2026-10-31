import type { Generated } from "kysely";
export type DiningMode = "native" | "reference";
export type DiningState =
  | "draft"
  | "published"
  | "open"
  | "paused"
  | "ended"
  | "cancelled";
export type DiningIssueState = "open" | "accepted" | "resolved";
export interface DiningServiceTable {
  id: string;
  school_id: string;
  name: string;
  coordinator_person_id: string;
  space_id: string | null;
  menu_mode: DiningMode;
  operations_mode: DiningMode;
  source_label: string;
  source_url: string | null;
  source_reference: string;
  source_observed_at: Date | null;
  active: boolean;
  revision: number;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}
export interface DiningServiceReceiptTable extends DiningServiceTable {
  service_id: string;
  command_id: string;
  actor_person_id: string;
  actor_user_id: string;
  reason: string;
  recorded_at: Date;
}
export interface DiningSessionTable {
  id: string;
  school_id: string;
  service_id: string;
  service_revision: number;
  label: string;
  coordinator_person_id: string;
  operator_person_id: string;
  space_id: string | null;
  menu_mode: DiningMode;
  operations_mode: DiningMode;
  source_label: string;
  source_url: string | null;
  source_reference: string;
  source_observed_at: Date | null;
  menu_text: string;
  starts_at: Date;
  ends_at: Date;
  state: DiningState;
  revision: number;
  published_at: Date | null;
  count_total: number;
  current_count_receipt_id: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  coordination_receipt: Generated<unknown>;
  weekly_plan_id: Generated<string | null>;
  weekly_series_id: Generated<string | null>;
  weekly_date: Generated<string | null>;
  weekly_exception: Generated<boolean>;
}
export interface DiningSessionReceiptTable {
  id: string;
  school_id: string;
  session_id: string;
  revision: number;
  command_id: string;
  action: string;
  actor_person_id: string;
  actor_user_id: string;
  note: string;
  state: DiningState;
  label: string;
  menu_text: string;
  starts_at: Date;
  ends_at: Date;
  space_id: string | null;
  coordinator_person_id: string;
  operator_person_id: string;
  count_total: number;
  observed_at: Date | null;
  supersedes_receipt_id: string | null;
  recorded_at: Date;
}
export interface DiningIssueTable {
  id: string;
  school_id: string;
  session_id: string;
  reporter_person_id: string;
  handler_person_id: string;
  coordinator_person_id: string;
  title: string;
  detail: string;
  state: DiningIssueState;
  revision: number;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  coordination_receipt: Generated<unknown>;
}
export interface DiningIssueReceiptTable {
  id: string;
  school_id: string;
  issue_id: string;
  revision: number;
  command_id: string;
  action: string;
  actor_person_id: string;
  actor_user_id: string;
  note: string;
  state: DiningIssueState;
  handler_person_id: string;
  coordinator_person_id: string;
  recorded_at: Date;
}
export interface DiningCoordinationReceipt {
  event_id: string;
  event_type: string;
  source_revision: number;
  message_id: string | null;
  recipient_person_id: string | null;
  recipient_user_id: string | null;
  route_unavailable: boolean;
}
export interface DiningWeeklyPlanTable {
  id: string;
  school_id: string;
  series_id: string;
  service_id: string;
  service_revision: number;
  version_number: number;
  label: string;
  timezone: string;
  starts_on: string;
  ends_on: string | null;
  coordinator_person_id: string;
  menu_mode: DiningMode;
  operations_mode: DiningMode;
  source_label: string;
  source_url: string | null;
  source_reference: string;
  source_observed_at: Date | null;
  state: "draft" | "published" | "stopped";
  revision: number;
  replaces_plan_id: string | null;
  replaces_revision: number | null;
  stop_from: string | null;
  published_at: Date | null;
  projection_receipt: Generated<unknown>;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}
export interface DiningWeeklyDayTable {
  school_id: string;
  plan_id: string;
  weekday: number;
  menu_text: string;
  starts_at: string;
  ends_at: string;
  end_day_offset: 0 | 1;
  space_id: string | null;
  operator_person_id: string;
  start_fold: "reject" | "earlier" | "later";
  end_fold: "reject" | "earlier" | "later";
}
export interface DiningWeeklyReceiptTable {
  id: string;
  school_id: string;
  plan_id: string;
  revision: number;
  command_id: string;
  action: string;
  actor_person_id: string;
  actor_user_id: string;
  note: string;
  snapshot: unknown;
  recorded_at: Date;
  exception_date: Generated<string | null>;
  date_session_id: Generated<string | null>;
}
