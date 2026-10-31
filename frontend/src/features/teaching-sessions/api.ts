import { apiFetch } from "../../lib/api";

export interface TeachingSessionItem {
  id: string; date: string; title: string; group_label: string; starts_at: string; ends_at: string; timezone: string;
  place_label: string | null; teacher_name: string | null; original_teacher_name: string | null; is_cover: boolean;
  source_kind: "academic" | "activity"; state: "expected" | "cancelled"; source_fingerprint: string;
  lesson_state: "empty" | "prepared" | "reported"; href: string;
}
export interface TeachingLesson {
  revision: number; state: "empty" | "prepared" | "reported"; topic: string; learner_notes: string;
  preparation?: string; reported_at: string | null; updated_at: string | null;
}
export interface TeachingMaterial {
  id: string; title: string; kind: "link" | "text" | "file"; url: string | null; body: string | null;
  original_name: string | null; content_type: string | null; size_bytes: number | null; sha256: string | null;
  shared: boolean; replaces_material_id: string | null; created_at: string; download_href: string | null; source_content_omitted: boolean;
}
export interface SessionAction { href: string; label: string }
export interface SessionWorkOption { work_kind: "assignment" | "practice"; work_id: string; title: string; due_at: string | null; href: string }
export interface SessionWorkOptions { supported: boolean; reason: string | null; page: number; page_size: number; has_more: boolean; items: SessionWorkOption[] }
export interface TeachingSessionDetail {
  session: TeachingSessionItem; lesson: TeachingLesson; capabilities: { can_manage: boolean; can_read_preparation: boolean; can_link_work?: boolean };
  materials: TeachingMaterial[];
  associated_work?: Array<SessionWorkOption & { id: string }>;
  history: { items: Array<{ revision: number; state: string; topic: string; learner_notes: string; reason: string; recorded_at: string; actor_name: string; preparation?: string }>; page: number; has_more: boolean };
  previous_lesson: { id: string; date: string; topic: string; learner_notes: string; href: string } | null;
  related: { attendance: (SessionAction & { grain: "daily_class" | "scheduled_session" | "activity" }) | null; practice: SessionAction | null; assignments: SessionAction | null; schedule: SessionAction | null };
  availability_reason: string | null;
}
export interface TeachingSessionList { date: string; page: number; page_size: number; total: number; total_pages: number; items: TeachingSessionItem[] }
export interface SessionCommand { command_id: string; expected_revision: number; source_fingerprint: string }
export interface LessonInput { preparation: string; topic: string; learner_notes: string; state: "prepared" | "reported"; reason?: string }
export interface MaterialInput { material_id: string; title: string; kind: "link" | "text"; url?: string; body?: string; shared: boolean; replaces_material_id?: string }
export type TeachingSessionSelection = { sessionId: string } | { occurrenceId: string } | { classId: string; period: number };
const root = "/api/v1/learning/sessions";
const path = (id: string, date: string, action = "") => `${root}/${encodeURIComponent(id)}${action}?${new URLSearchParams({ date })}`;
export const getTeachingSessions = (date: string, page: number) => apiFetch<TeachingSessionList>(`${root}?${new URLSearchParams({ date, page: String(page) })}`);
export const getTeachingSession = (id: string, date: string, historyPage = 1) => apiFetch<TeachingSessionDetail>(`${path(id, date)}&history_page=${historyPage}`);
export const openTeachingSession = (date: string, selection: Exclude<TeachingSessionSelection, { sessionId: string }>, historyPage = 1) => apiFetch<TeachingSessionDetail>(`${root}/open?${new URLSearchParams({ date, history_page: String(historyPage), ...("occurrenceId" in selection ? { occurrence_id: selection.occurrenceId } : { class_section_id: selection.classId, period_number: String(selection.period) }) })}`);
export const saveTeachingLesson = (id: string, date: string, body: SessionCommand & LessonInput) => apiFetch<{ revision: number }>(path(id, date, "/lesson"), { method: "PUT", body: JSON.stringify(body) });
export const addTeachingMaterial = (id: string, date: string, body: SessionCommand & MaterialInput) => apiFetch<{ id: string; revision: number }>(path(id, date, "/materials"), { method: "POST", body: JSON.stringify(body) });
export const uploadTeachingMaterial = (id: string, date: string, body: FormData) => apiFetch<{ id: string; revision: number }>(path(id, date, "/materials/files"), { method: "POST", body });
export const getTeachingWorkOptions = (id: string, date: string, page = 1) => apiFetch<SessionWorkOptions>(`${path(id, date, "/work-options")}&page=${page}`);
export const linkTeachingWork = (id: string, date: string, body: SessionCommand & Pick<SessionWorkOption, "work_kind" | "work_id">) => apiFetch<{ id: string; revision: number }>(path(id, date, "/work"), { method: "POST", body: JSON.stringify(body) });

/** Server links still pass a local route boundary; never accept executable URLs. */
export function sessionActionHref(href: string | null | undefined) {
  if (!href?.startsWith("/") || href.startsWith("//")) return null;
  try { const url = new URL(href, window.location.origin); return url.origin === window.location.origin && ["/areas/", "/work"].some(prefix => url.pathname.startsWith(prefix)) ? `${url.pathname}${url.search}${url.hash}` : null; }
  catch { return null; }
}
export function teachingDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export const sessionHref = (id: string, date: string) => `/areas/timetable/session?${new URLSearchParams({ session_id: id, date })}`;
export const sessionDateLabel = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
export function sessionTimeLabel(value: string, timezone: string) {
  const date = value.includes("T") ? new Date(value) : new Date(`2000-01-01T${value}`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", ...(value.includes("T") ? { timeZone: timezone } : {}) }).format(date);
}
