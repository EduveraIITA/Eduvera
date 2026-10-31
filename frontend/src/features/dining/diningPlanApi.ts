import { apiFetch } from "../../lib/api";
import type { DiningAccepted, DiningCommand, DiningHistory, DiningMode, DiningPagination, DiningRef, DiningSession, DiningSource } from "./diningApi";

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
export interface DiningPlanInput {
  id?: string; service_id: string; service_expected_revision: number; label: string; timezone: string;
  starts_on: string; ends_on: string | null; days: DiningPlanDayInput[]; note: string;
}
export interface DiningPlanDateInput {
  command_id: string; expected_plan_version_id: string; expected_plan_revision: number; expected_session_revision: 0;
  action: "open" | "publish_changes" | "cancel"; note: string;
  menu_text?: string; starts_at?: string; ends_at?: string; space_id?: string | null;
}
const root = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/dining/plans`;
const query = (values: Record<string, string | number>) => new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
const post = (url: string, body: unknown) => apiFetch<DiningAccepted>(url, { method: "POST", body: JSON.stringify(body) });
export const getDiningPlans = (school: string, serviceId: string, page = 1) => apiFetch<DiningPlanPage<DiningPlanDetail>>(`${root(school)}?${query({ service_id: serviceId, page })}`);
export const getDiningPlan = (school: string, id: string, historyPage = 1) => apiFetch<DiningPlanDetail>(`${root(school)}/${encodeURIComponent(id)}?${query({ history_page: historyPage })}`);
export const saveDiningPlan = (school: string, input: DiningCommand & DiningPlanInput) => post(root(school), input);
export const publishDiningPlan = (school: string, id: string, input: DiningCommand & { note: string; expected_parent_revision?: number }) => post(`${root(school)}/${encodeURIComponent(id)}/publish`, input);
export const reviseDiningPlan = (school: string, id: string, input: DiningCommand & { starts_on: string; note: string }) => post(`${root(school)}/${encodeURIComponent(id)}/revise`, input);
export const stopDiningPlan = (school: string, id: string, input: DiningCommand & { stop_from: string; note: string }) => post(`${root(school)}/${encodeURIComponent(id)}/stop`, input);
export const recoverDiningPlan = (school: string, id: string, input: DiningCommand & { coordinator_person_id: string; note: string }) => post(`${root(school)}/${encodeURIComponent(id)}/recover`, input);
export const getDiningPlanDates = (school: string, plan: DiningPlan, from: string, until: string, page = 1) => apiFetch<DiningPlanDatePage>(`${root(school)}/${encodeURIComponent(plan.id)}/${plan.state === "draft" ? "preview" : "occurrences"}?${query({ from, until, page })}`);
export const getDiningPlanDate = (school: string, seriesId: string, date: string) => apiFetch<DiningResolvedDate>(`${root(school)}/${encodeURIComponent(seriesId)}/dates/${encodeURIComponent(date)}`);
export const actOnDiningPlanDate = (school: string, seriesId: string, date: string, input: DiningPlanDateInput) => post(`${root(school)}/${encodeURIComponent(seriesId)}/dates/${encodeURIComponent(date)}/actions`, input);

/** Derived availability is not a saved session or an observation of serving. */
export function diningDatePresentation(date: DiningPlanDate): DiningSession {
  return { ...date, starts_at: date.starts_at ?? "", ends_at: date.ends_at ?? "", state: date.cancelled_for_date ? "cancelled" : "published", revision: 0, count_total: null, count_receipt_id: null, published_at: null, history: [], issues: [] };
}
