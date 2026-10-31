import { apiFetch } from "../../lib/api";

export interface DiningRef { id: string; label: string }
export type DiningMode = "native" | "reference";
export type DiningAction = "save" | "publish" | "publish_changes" | "open" | "pause" | "resume" | "end" | "cancel" | "count" | "correct_count" | "reassign";
export interface DiningSource { label: string | null; url: string | null; reference: string | null; observed_at: string | null }
export interface DiningHistory { id: string; action?: string; actor_label: string; recorded_at: string; observed_at?: string | null; note?: string | null; reason?: string; count_total?: number | null }
export interface DiningIssue {
  id: string; session_id: string; revision: number; title: string; note?: string; state: string; handler: DiningRef; reporter: DiningRef;
  allowed_actions: string[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  session?: DiningRef & { href: string }; service?: DiningRef; place?: DiningRef | null; detail?: string; route_unavailable?: boolean;
}
export interface DiningPagination { page: number; page_size: number; has_more: boolean }
export interface DiningService {
  id: string; revision: number; name: string; coordinator: DiningRef; place: DiningRef | null; menu_mode: DiningMode;
  operations_mode: DiningMode; source: DiningSource | null; active: boolean; allowed_actions: string[];
  sessions?: DiningSession[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  sessions_pagination?: DiningPagination; has_sessions?: boolean; modes_locked?: boolean;
}
export interface DiningSession {
  recovery_only?: false;
  id: string; revision: number; label: string; state: string; service: DiningRef; coordinator: DiningRef; operator: DiningRef;
  place: DiningRef | null; starts_at: string; ends_at: string; menu_text: string; menu_mode: DiningMode; operations_mode: DiningMode;
  source: DiningSource | null; count_total: number | null; count_receipt_id: string | null; published_at: string | null;
  allowed_actions: string[]; issues?: DiningIssue[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  access_transferred?: boolean;
  route_unavailable?: boolean; availability_only?: boolean; venue_reserved?: boolean; issues_pagination?: DiningPagination;
  location_path?: DiningRef[];
}
export interface DiningRecovery { id: string; revision: number; state: string; recovery_only: true; allowed_actions: string[]; session_id?: string }
export type DiningSessionDetail = DiningSession | DiningRecovery;
export type DiningIssueDetail = DiningIssue | DiningRecovery;
export interface DiningWorkspace { services: DiningService[]; sessions: DiningSession[]; can_manage: boolean; pagination: DiningPagination; date?: string; timezone?: string }
export interface DiningOptions {
  actor?: DiningRef | null; people: Array<DiningRef & { has_app: boolean }>; spaces: DiningRef[];
  people_has_more: boolean; spaces_has_more: boolean; can_manage?: boolean;
  can_create_places?: boolean; campuses?: Array<DiningRef & { is_primary: boolean }>;
}
export interface DiningCommand { command_id: string; expected_revision: number }
export interface DiningServiceInput {
  id?: string; name: string; coordinator_person_id: string; space_id: string | null; menu_mode: DiningMode; operations_mode: DiningMode;
  source_label: string; source_url: string | null; source_reference: string; source_observed_at: string | null; reason: string; active: boolean;
}
export interface DiningSessionInput { service_id: string; service_expected_revision: number; label: string; operator_person_id: string; space_id: string | null; starts_at: string; ends_at: string; menu_text: string }
export interface DiningActionInput { action: DiningAction; note: string; menu_text?: string; starts_at?: string; ends_at?: string; space_id?: string | null; operator_person_id?: string; coordinator_person_id?: string; count_total?: number; observed_at?: string; supersedes_receipt_id?: string }
export interface DiningAccepted { id: string; kind: "service" | "session" | "issue" | "plan"; revision: number; series_id?: string }
export interface DiningConfirmation { state: "accepted" | "pending" | "not_found" | "not_accepted"; result?: DiningAccepted | null }
const root = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/dining`;
const query = (values: Record<string, string | number | undefined>) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value)); return params; };
const post = <T>(url: string, body: unknown) => apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
export const getDiningWorkspace = (school: string, values: { view: "today" | "services"; date?: string; search?: string; page: number }) => apiFetch<DiningWorkspace>(`${root(school)}/workspace?${query(values)}`);
export const getDiningOptions = (school: string, values: { search?: string; page?: number; service_id?: string; session_id?: string; issue_id?: string; plan_id?: string; person_id?: string; space_id?: string } = {}) => apiFetch<DiningOptions>(`${root(school)}/options?${query(values)}`);
export const getDiningService = (school: string, id: string, page = 1, historyPage = 1) => apiFetch<DiningService>(`${root(school)}/services/${encodeURIComponent(id)}?${query({ page, history_page: historyPage })}`);
export const saveDiningService = (school: string, input: DiningCommand & DiningServiceInput) => post<DiningAccepted>(`${root(school)}/services`, input);
export const createDiningSession = (school: string, input: DiningCommand & DiningSessionInput) => post<DiningAccepted>(`${root(school)}/sessions`, input);
export const getDiningSession = (school: string, id: string, historyPage = 1, issuesPage = 1) => apiFetch<DiningSessionDetail>(`${root(school)}/sessions/${encodeURIComponent(id)}?${query({ history_page: historyPage, page: issuesPage })}`);
export const actOnDiningSession = (school: string, id: string, input: DiningCommand & DiningActionInput) => post<DiningAccepted>(`${root(school)}/sessions/${encodeURIComponent(id)}/actions`, input);
export const reportDiningIssue = (school: string, id: string, input: DiningCommand & { title: string; note: string; handler_person_id: string }) => post<DiningAccepted>(`${root(school)}/sessions/${encodeURIComponent(id)}/issues`, input);
export const getDiningIssue = (school: string, id: string, page = 1) => apiFetch<DiningIssueDetail>(`${root(school)}/issues/${encodeURIComponent(id)}?${query({ history_page: page })}`);
export const actOnDiningIssue = (school: string, id: string, input: DiningCommand & { action: "accept" | "resolve" | "reopen" | "reassign"; note: string; handler_person_id?: string }) => post<DiningAccepted>(`${root(school)}/issues/${encodeURIComponent(id)}/actions`, input);
export const confirmDiningCommand = (school: string, commandId: string, sourceId: string) => apiFetch<DiningConfirmation>(`${root(school)}/confirmation?${query({ command_id: commandId, source_id: sourceId })}`);
