import { apiFetch } from "../../lib/api";

export interface OfferingPerson { id: string; name: string; revision: number }
export interface LearningOfferingSummary {
  id: string; name: string; revision: number; can_manage: boolean; can_publish: boolean; can_review: boolean;
  own_enrollment: { id: string; person_id: string; revision: number } | null;
  current_instructor: { id: string; person_id: string; name: string; revision: number } | null;
  learner_count?: number;
}
export interface LearningOfferingList {
  can_create: boolean; actor_person: OfferingPerson | null; timezone: string; today: string;
  items: LearningOfferingSummary[]; page: number; has_more: boolean;
}
export interface LearningOfferingDetail extends LearningOfferingSummary {
  starts_on: string; today: string; timezone: string;
  enrollments: Array<{ id: string; person_id: string; name: string; revision: number; starts_on: string; ends_on: string | null }>;
}
export interface OfferingCreateResult { id: string; revision: number; teaching_assignment_id: string; enrollments: Array<{ id: string; person_id: string; revision: number }>; replayed?: boolean }
const root = "/api/v1/learning/offerings/";
export const listLearningOfferings = (page = 1, search = "") => apiFetch<LearningOfferingList>(`${root}?${new URLSearchParams({ page: String(page), search })}`);
export const getLearningOffering = (id: string) => apiFetch<LearningOfferingDetail>(`${root}${encodeURIComponent(id)}/`);
export const createLearningOffering = (body: { command_id: string; offering_id: string; name: string; participants: Array<{ id: string; expected_revision: number }>; instructor: { id: string; expected_revision: number }; starts_on: string }) =>
  apiFetch<OfferingCreateResult>(root, { method: "POST", body: JSON.stringify(body) });
export const enrollOfferingPeople = (id: string, body: { command_id: string; expected_revision: number; participants: Array<{ id: string; expected_revision: number }>; starts_on: string }) =>
  apiFetch<{ id: string; revision: number }>(`${root}${encodeURIComponent(id)}/enrollments/`, { method: "POST", body: JSON.stringify(body) });
export const appointOfferingInstructor = (id: string, body: { command_id: string; expected_revision: number; instructor: { id: string; expected_revision: number }; starts_on: string }) =>
  apiFetch<{ id: string; revision: number }>(`${root}${encodeURIComponent(id)}/instructors/`, { method: "POST", body: JSON.stringify(body) });
export const endOfferingResponsibility = (id: string, kind: "enrollments" | "instructors", recordId: string, body: { command_id: string; expected_revision: number; reason: string }) =>
  apiFetch<{ id: string; revision: number }>(`${root}${encodeURIComponent(id)}/${kind}/${encodeURIComponent(recordId)}/end/`, { method: "POST", body: JSON.stringify(body) });
