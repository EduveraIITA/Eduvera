/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { DiningHistory, DiningMode, DiningPagination, DiningRef, DiningSession, DiningSource } from './diningApi';

export type DiningFoldPolicy = "reject" | "earlier" | "later";

export interface DiningPlanDayInput {
  weekday: number; menu_text: string; starts_at: string; ends_at: string; end_day_offset: 0 | 1;
  space_id: string | null; operator_person_id: string; start_fold: DiningFoldPolicy; end_fold: DiningFoldPolicy;
}

export interface DiningPlanDay extends DiningPlanDayInput { place: DiningRef | null; operator: DiningRef }

export interface DiningPlan {
  recovery_only?: false;
  id: string; series_id: string; revision: number; version_number: number; service: DiningRef; service_id: string; service_revision: number;
  label: string; timezone: string; starts_on: string; ends_on: string | null; state: "draft" | "published" | "stopped";
  coordinator: DiningRef; menu_mode: DiningMode; operations_mode: DiningMode; source: DiningSource | null; days: DiningPlanDay[];
  replaces_plan_id: string | null; replaces_revision?: number | null; current_parent_revision?: number | null; parent_changed?: boolean; stop_from: string | null; published_at: string | null; allowed_actions: string[];
  history: DiningHistory[]; history_pagination: DiningPagination; draft_id: string | null; current_published_id: string | null;
}

export interface DiningPlanRecovery { id: string; series_id: string; revision: number; state: string; recovery_only: true; allowed_actions: string[] }

export type DiningPlanDetail = DiningPlan | DiningPlanRecovery;

export interface DiningPlanDate {
  origin: "plan_date"; id: string; series_id: string; plan_version_id: string; plan_revision: number; local_date: string;
  service: DiningRef; label: string; menu_text: string; starts_at: string | null; ends_at: string | null; timezone: string;
  menu_mode: DiningMode; operations_mode: DiningMode; source: DiningSource | null; place: DiningRef | null;
  coordinator: DiningRef; operator: DiningRef; location_path?: DiningRef[];
  allowed_actions: string[]; availability_only: true; venue_reserved: false; session: null;
  needs_time_resolution?: boolean; wall_times?: { starts_at: string; ends_at: string; end_day_offset: 0 | 1 }; day?: DiningPlanDay;
  state?: "planned" | "cancelled"; cancelled_for_date?: boolean;
}

export type DiningResolvedDate = DiningPlanDate | { origin: "session"; session: DiningSession };

export interface DiningPlanPage<T> { items: T[]; page: number; page_size: number; total: number; total_pages: number }

export interface DiningPlanDatePage extends DiningPlanPage<DiningResolvedDate> { warnings?: Array<{ local_date: string; weekday: number; reason: "nonexistent_time" | "ambiguous_time" | "invalid_duration" }>; issues?: Array<{ local_date: string; weekday: number; reason: string }> }
