import { apiFetch } from "../../lib/api";
import { gateRoot } from "./api";

export interface VisitPerson { id: string; label: string; revision: number; avatar_url?: string | null; has_app_access?: boolean }
export interface VisitPlace { id: string; label: string; kind: string; campus_label?: string | null }
export interface ArrangedVisit {
  id: string; revision: number; title: string;
  person: VisitPerson | null; guest_name: string | null; guest_label: string; party_size: number;
  starts_at: string; ends_at: string; place: VisitPlace; contact: VisitPerson;
  state: "confirmed" | "cancelled"; created_at: string; updated_at: string; cancelled_at: string | null;
  last_movement: { direction: "in" | "out"; occurred_at: string; observed_count: number } | null;
}
export interface VisitDetail {
  visit: ArrangedVisit; can_edit: boolean; can_cancel: boolean;
  can_record_arrival: boolean; can_record_exit: boolean;
  history?: VisitHistory[]; history_has_more?: boolean;
}
export interface VisitHistory {
  revision: number; action: "arranged" | "changed" | "cancelled" | "movement_recorded";
  recorded_at: string; actor: { id: string; label: string }; title: string;
  guest_name: string | null; guest_label?: string; person_id: string | null; party_size: number;
  starts_at: string; ends_at: string; place_id: string; place_label?: string;
  contact_person_id: string; contact_label?: string; state: "confirmed" | "cancelled";
  last_movement: ArrangedVisit["last_movement"];
}
export type VisitsView = "upcoming" | "past" | "cancelled" | "all";
export interface VisitsWorkspace {
  visits: ArrangedVisit[]; timezone: string; can_manage: boolean;
  totals: { upcoming: number; past: number; cancelled: number };
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}
export interface VisitOptions {
  actor: { person_id: string; label: string; revision: number } | null;
  people: VisitPerson[]; places: VisitPlace[]; timezone: string;
  pagination: { page: number; page_size: number; people_has_more: boolean; places_has_more: boolean };
}
export interface VisitInput {
  person_id: string | null; person_revision: number | null; guest_name: string | null;
  party_size: number; title: string; starts_at: string; ends_at: string;
  place_id: string; contact_person_id: string; contact_revision: number;
}
export interface VisitCommand { command_id: string; expected_revision: number }
const root = (school: string) => `${gateRoot(school)}/visit-arrangements`;
export const getVisits = (school: string, values: { view: VisitsView; search: string; page: number }, signal?: AbortSignal) =>
  apiFetch<VisitsWorkspace>(`${root(school)}/?${new URLSearchParams({ view: values.view, search: values.search, page: String(values.page) })}`, { signal });
export const getVisit = (school: string, id: string, signal?: AbortSignal) => apiFetch<VisitDetail>(`${root(school)}/${encodeURIComponent(id)}/`, { signal });
export const getVisitOptions = (school: string, values: { q?: string; page?: number; person_id?: string; contact_person_id?: string; place_id?: string } = {}, signal?: AbortSignal) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<VisitOptions>(`${root(school)}/options/${query.size ? `?${query}` : ""}`, { signal });
};
export const createVisit = (school: string, input: VisitInput & VisitCommand) => apiFetch<VisitDetail>(`${root(school)}/`, { method: "POST", body: JSON.stringify(input) });
export const updateVisit = (school: string, id: string, input: VisitInput & VisitCommand) => apiFetch<VisitDetail>(`${root(school)}/${encodeURIComponent(id)}/update/`, { method: "POST", body: JSON.stringify(input) });
export const cancelVisit = (school: string, id: string, input: VisitCommand) => apiFetch<VisitDetail>(`${root(school)}/${encodeURIComponent(id)}/cancel/`, { method: "POST", body: JSON.stringify(input) });
export const recordVisitMovement = (school: string, id: string, input: VisitCommand & { direction: "in" | "out"; observed_count: number; occurred_at?: string }) => apiFetch<VisitDetail>(`${root(school)}/${encodeURIComponent(id)}/movements/`, { method: "POST", body: JSON.stringify(input) });
export const confirmVisitCommand = (school: string, id: string, command: string) => apiFetch<{ state: "accepted"; result: VisitDetail } | { state: "pending" | "not_found" | "not_accepted" }>(`${root(school)}/${encodeURIComponent(id)}/commands/${encodeURIComponent(command)}/`);
