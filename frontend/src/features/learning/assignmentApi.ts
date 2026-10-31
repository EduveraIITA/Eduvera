import { apiFetch } from "../../lib/api";

export interface AssignmentItem {
  id: string; school_id: string; class_section_id: string | null; term_id: string | null; subject_id: string | null; author_id: string; reviewer_id: string;
  context_kind?: "class_term" | "learning_offering"; offering_id?: string | null;
  title: string; instructions: string; due_at: string | null; cutoff_at: string | null; state: "draft" | "published"; revision: number;
  published_at: string | null; submission_mode: "text" | "files" | "either"; max_attempts: number | null; policy_version: 1; resubmission_mode: "on_request";
}
export interface AssignmentList {
  context: "class" | "offering" | "learner"; can_create: boolean; can_general?: boolean; timezone: string;
  class_section?: { id: string; label: string }; student?: { id: string; name: string } | null;
  offering?: { id: string; name: string; revision: number }; learner?: { id: string; person_id: string; name: string };
  terms?: Array<{ id: string; name: string }>; subjects?: Array<{ id: string; name: string }>;
  reviewers?: Array<{ id: string; name: string; subject_id: string | null }>;
  items: AssignmentItem[]; page: number; has_more: boolean;
}
export interface AssignmentFile { id: string; original_name: string; content_type: string; size_bytes: number; sha256: string }
export interface AssignmentAttempt {
  id: string; attempt_number: number; body: string; submitted_at: string; manifest_hash: string; late: boolean; files: AssignmentFile[];
  review: { id: string; decision: "reviewed" | "request_changes"; feedback: string; reviewed_at: string } | null;
}
export interface AssignmentWork {
  context: "reviewer" | "learner"; item: AssignmentItem; timezone: string; student?: { id: string; name: string } | null;
  learner?: { id: string; person_id: string; name: string };
  state: "not_started" | "draft" | "submitted" | "changes_requested" | "reviewed";
  can_write: boolean; can_review: boolean; can_request_changes?: boolean; can_submit?: boolean; submission_blocked_reason?: string | null; draft: { body: string; revision: number; updated_at: string | null } | null;
  files: AssignmentFile[]; attempts: AssignmentAttempt[];
}
export interface AssignmentClassDetail {
  context: "class" | "offering"; item: AssignmentItem; timezone: string; can_review: boolean; can_edit: boolean;
  publication_preview: { count: number; audience_hash: string } | null;
  progress: { items: Array<{ id: string; name: string; status: string }>; total: number; submitted: number; needs_review: number; page: number; has_more: boolean };
}
export type AssignmentDetail = AssignmentWork | AssignmentClassDetail;
const root = "/api/v1/learning/assignments/";
export type AssignmentIdentityKind = "student" | "person";
const path = (id: string, learnerId?: string, kind: AssignmentIdentityKind = "student") => `${root}${encodeURIComponent(id)}/${learnerId ? `${kind === "person" ? "people" : "work"}/${encodeURIComponent(learnerId)}/` : ""}`;
export const getAssignments = (scope: { class_section_id?: string; student_id?: string; offering_id?: string; person_id?: string }, page: number) =>
  apiFetch<AssignmentList>(`${root}?${new URLSearchParams({ ...scope, page: String(page) })}`);
export const getAssignment = (id: string, learnerId?: string, page = 1, kind: AssignmentIdentityKind = "student") => apiFetch<AssignmentDetail>(`${path(id, learnerId, kind)}?page=${page}`);
export const saveAssignment = (body: Record<string, unknown>) => apiFetch<{ id: string; revision: number }>(root, { method: "POST", body: JSON.stringify(body) });
export const publishAssignment = (id: string, body: Record<string, unknown>) => apiFetch<{ id: string; revision: number; audience_count: number }>(`${path(id)}publish/`, { method: "POST", body: JSON.stringify(body) });
export const saveAssignmentWork = (id: string, learner: string, body: Record<string, unknown>, kind?: AssignmentIdentityKind) => apiFetch<{ revision: number }>(path(id, learner, kind), { method: "PUT", body: JSON.stringify(body) });
export const uploadAssignmentFile = (id: string, learner: string, body: FormData, kind?: AssignmentIdentityKind) => apiFetch<{ revision: number }>(`${path(id, learner, kind)}files/`, { method: "POST", body });
export const detachAssignmentFile = (id: string, learner: string, file: string, body: Record<string, unknown>, kind?: AssignmentIdentityKind) => apiFetch<{ revision: number }>(`${path(id, learner, kind)}files/${encodeURIComponent(file)}/`, { method: "DELETE", body: JSON.stringify(body) });
export const assignmentFileHref = (id: string, learner: string, file: string, kind?: AssignmentIdentityKind) => `${path(id, learner, kind)}files/${encodeURIComponent(file)}/`;
export const submitAssignmentWork = (id: string, learner: string, body: Record<string, unknown>, kind?: AssignmentIdentityKind) => apiFetch<{ attempt_id: string; attempt_number: number; submitted_at: string; revision: number }>(`${path(id, learner, kind)}submit/`, { method: "POST", body: JSON.stringify(body) });
export const reviewAssignmentWork = (id: string, learner: string, body: Record<string, unknown>, kind?: AssignmentIdentityKind) => apiFetch(`${path(id, learner, kind)}review/`, { method: "POST", body: JSON.stringify(body) });
