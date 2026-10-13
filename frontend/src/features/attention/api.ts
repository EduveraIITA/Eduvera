import { apiFetch } from "../../lib/api";

export type AttentionPortal = "parent" | "teacher" | "principal";

export interface AttentionCounts {
  total: number;
  new: number;
  action_required: number;
  exceptions: number;
  urgent: number;
  high?: number;
  normal?: number;
  highest_priority?: "urgent" | "high" | "normal" | null;
}

export interface AttentionModule extends AttentionCounts {
  href: string;
  first_item_href: string | null;
}

export interface AttentionItem {
  id: string;
  source_kind: string;
  source_id: string;
  module: string;
  state: "new" | "action_required" | "exception";
  signals: Array<"new" | "action_required" | "exception">;
  priority: "urgent" | "high" | "normal";
  title: string;
  status_label: string;
  subject_label: string | null;
  href: string;
  created_at: string | null;
  due_at: string | null;
}

export interface AttentionResponse {
  portal: AttentionPortal;
  generated_at: string;
  scope?: {
    school_id: string;
    school_name: string;
    timezone: string;
    student_id: string | null;
    student_name: string | null;
  };
  summary: AttentionCounts;
  modules: Record<string, AttentionModule>;
  items: AttentionItem[];
}

export function getAttention(portal: AttentionPortal, studentId?: string) {
  const parameters = new URLSearchParams({ portal });
  if (studentId) parameters.set("student_id", studentId);
  return apiFetch<AttentionResponse>(`/api/v1/attention?${parameters.toString()}`);
}
