import { apiFetch } from "../../lib/api";
import type { Invitation } from "../onboarding/api";
import { gateRoot } from "./api";
import type { VisitPerson, VisitPlace } from "./visitApi";

export interface SharedVisit {
  id: string; revision: number; title: string; guest_label: string; party_size: number;
  starts_at: string; ends_at: string; state: "confirmed" | "cancelled";
  place: VisitPlace; contact: { label: string };
}
export interface VisitQuestionEntry { id: string; kind: "question" | "reply"; note: string; recorded_at: string; author: "organiser" | "campus"; author_label: string }
export interface VisitQuestion { id: string; revision: number; state: "waiting_for_review" | "answered" | "withdrawn"; entries: VisitQuestionEntry[]; entries_has_more: boolean }
export interface SharedVisitChange { revision: number; recorded_at: string; title: string; starts_at: string; ends_at: string; state: SharedVisit["state"]; party_size: number; place_label: string; contact_label: string }
export interface SharedVisitDetail {
  timezone: string;
  visit: SharedVisit;
  share: { id: string; root_id: string; revision: number; starts_at: string; ends_at: string; directions: string; owner: { label: string; available: boolean }; can_ask: boolean; can_reply: boolean };
  changes: SharedVisitChange[]; changes_has_more: boolean; question: VisitQuestion | null;
}
export interface VisitSharing {
  visit_revision: number; share_revision: number; can_share: boolean; can_open_shared: boolean;
  current: null | {
    id: string; root_id: string; revision: number; organiser: VisitPerson & { has_app_access: boolean };
    starts_at: string; ends_at: string; directions: string; state: "active" | "expired" | "revoked" | "party_changed";
    owner: { id: string; label: string; available: boolean }; can_renew: boolean; can_revoke: boolean; can_takeover: boolean;
    invitation: Pick<Invitation, "id" | "email" | "expires_at" | "accepted_at" | "revoked_at" | "delivery" | "delivery_job_id"> | null;
  };
}
export interface VisitSharingReceipt { visit_id: string; share_id: string; share_root_id: string; question_id?: string; revision: number; action: string }
export type VisitSharingConfirmation = { state: "accepted"; result: VisitSharingReceipt } | { state: "pending" | "not_found" | "not_accepted" };
export interface VisitSharingCommand { command_id: string; expected_revision: number }
const root = (school: string) => `${gateRoot(school)}/visit-arrangements`;
const source = (school: string, visit: string) => `${root(school)}/${encodeURIComponent(visit)}`;
export const getVisitSharingDiscovery = (school: string, signal?: AbortSignal) => apiFetch<{ can_manage: boolean; has_shared: boolean; has_questions: boolean }>(`${root(school)}/shared/discovery/`, { signal });
export const getSharedVisits = (school: string, page: number, signal?: AbortSignal) => apiFetch<{ visits: SharedVisit[]; timezone: string; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(`${root(school)}/shared/?page=${page}`, { signal });
export const getSharedVisit = (school: string, visit: string, signal?: AbortSignal) => apiFetch<SharedVisitDetail>(`${source(school, visit)}/shared/`, { signal });
export const getVisitSharing = (school: string, visit: string, signal?: AbortSignal) => apiFetch<VisitSharing>(`${source(school, visit)}/sharing/`, { signal });
export const shareVisit = (school: string, visit: string, input: VisitSharingCommand & { expected_visit_revision: number; organiser_person_id: string; organiser_person_revision: number; ends_at: string; directions: string }) => apiFetch<VisitSharing>(`${source(school, visit)}/shares/`, { method: "POST", body: JSON.stringify(input) });
export const revokeVisitSharing = (school: string, visit: string, share: string, input: VisitSharingCommand) => apiFetch<VisitSharing>(`${source(school, visit)}/shares/${encodeURIComponent(share)}/revoke/`, { method: "POST", body: JSON.stringify(input) });
export const takeOverVisitQuestions = (school: string, visit: string, share: string, input: VisitSharingCommand) => apiFetch<VisitSharing>(`${source(school, visit)}/shares/${encodeURIComponent(share)}/takeover/`, { method: "POST", body: JSON.stringify(input) });
export const askVisitQuestion = (school: string, visit: string, input: VisitSharingCommand & { share_id: string; note: string }) => apiFetch<SharedVisitDetail>(`${source(school, visit)}/shared/questions/`, { method: "POST", body: JSON.stringify(input) });
export const replyToVisitQuestion = (school: string, visit: string, question: string, input: VisitSharingCommand & { note: string }) => apiFetch<SharedVisitDetail>(`${source(school, visit)}/shared/questions/${encodeURIComponent(question)}/replies/`, { method: "POST", body: JSON.stringify(input) });
export const confirmVisitSharingCommand = (school: string, visit: string, command: string) => apiFetch<VisitSharingConfirmation>(`${source(school, visit)}/shared/commands/${encodeURIComponent(command)}/`);
