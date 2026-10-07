import { apiFetch } from "../../lib/api";

export type FollowupContext = "staff" | "guardian";
export interface Followup {
  id: string; student_id: string; student_name: string; owner_name: string;
  attendance_date: string; question: string; due_at: string; overdue: boolean;
  state: "awaiting_response" | "in_review" | "resolved"; revision: number;
  outcome: "absence_explained" | "record_corrected" | "query_withdrawn" | null;
  updated_at: string; created_at: string;
}
export interface FollowupDetail extends Followup {
  can_resolve: boolean;
  entries: Array<{ id: string; kind: string; channel: string; body: string; actor_name: string;
    guardian_name: string | null; observed_at: string; recorded_at: string }>;
  guardians: Array<{ id: string; name: string }>;
}
export interface FollowupEntryInput {
  context: FollowupContext; kind: "guardian_reply" | "assisted_reply" | "resolved";
  body: string; expected_revision: number; idempotency_key: string;
  channel?: "app" | "phone" | "paper" | "in_person"; guardian_id?: string; observed_at?: string;
  outcome?: Followup["outcome"];
}
const base = "/api/v1/coordination/follow-ups";
export const getFollowups = (context: FollowupContext, state: string, studentId?: string, cursor?: string) => {
  const params = new URLSearchParams({ context, state });
  if (studentId) params.set("student_id", studentId);
  if (cursor) params.set("cursor", cursor);
  return apiFetch<{ results: Followup[]; next_cursor: string | null }>(`${base}?${params}`);
};
export const getFollowup = (id: string, context: FollowupContext) => apiFetch<FollowupDetail>(`${base}/${id}?context=${context}`);
export const addFollowupEntry = (id: string, input: FollowupEntryInput) => apiFetch<{ id: string; revision: number }>(`${base}/${id}/entries`, { method: "POST", body: JSON.stringify(input) });
export const createFollowup = (input: { student_id: string; attendance_date: string; question: string; due_at: string; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(base, { method: "POST", body: JSON.stringify(input) });
