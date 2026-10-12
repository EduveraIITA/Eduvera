import { apiFetch } from "../../lib/api";

export type RequestPortal = "parent" | "teacher" | "principal";
export type RequestPriority = "urgent" | "high" | "normal";
export type RequestCategory =
  | "attendance"
  | "academics"
  | "events"
  | "leave"
  | "staffing"
  | "transport"
  | "finance"
  | "governance"
  | "communication"
  | "care";

export interface RequestInboxItem {
  id: string;
  kind: string;
  category: RequestCategory;
  priority: RequestPriority;
  title: string;
  detail: string;
  status_label: string;
  action_label: string;
  href: string;
  source_id: string;
  subject_label: string | null;
  occurs_at: string | null;
  due_at: string | null;
  created_at: string | null;
}

export interface RequestInboxResponse {
  portal: RequestPortal;
  generated_at: string;
  scope: { school_id: string; school_name: string; timezone: string; student_id: string | null; student_name: string | null };
  summary: {
    total: number;
    urgent: number;
    high: number;
    normal: number;
    categories: Partial<Record<RequestCategory, number>>;
  };
  items: RequestInboxItem[];
}

export function getRequestsInbox(portal: RequestPortal, studentId?: string) {
  const params = new URLSearchParams({ portal });
  if (studentId) params.set("student_id", studentId);
  return apiFetch<RequestInboxResponse>(`/api/v1/requests/?${params.toString()}`);
}
