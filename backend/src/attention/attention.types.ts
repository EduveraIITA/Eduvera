import type { RequestInboxResponse, RequestPortal, RequestPriority } from "../requests/requests.types.js";

export type AttentionPortal = RequestPortal;
export type AttentionPriority = RequestPriority;
export type AttentionState = "new" | "action_required" | "exception";

/**
 * Navigation identifiers intentionally match the owning portal destination.
 * `requests` is a cross-module rollup; every item itself keeps its owning module.
 */
export type AttentionModuleId =
  | "requests"
  | "attendance"
  | "registers"
  | "leave"
  | "diary"
  | "events"
  | "notices"
  | "policies"
  | "governance"
  | "fees"
  | "assessments"
  | "report-cards"
  | "results"
  | "teacher-feedback"
  | "calendar"
  | "timetable"
  | "weekly"
  | "transport"
  | "departure"
  | "safeguarding"
  | "staff"
  | "responsibilities"
  | "people"
  | "messages";

export interface AttentionItem {
  id: string;
  source_kind: string;
  source_id: string;
  module: Exclude<AttentionModuleId, "requests">;
  /**
   * `state` is the strongest signal and is used only for ordering/presentation.
   * `signals` is the lossless attention contract: one notice may be both new
   * and awaiting a response, and opening it must clear only the new signal.
   */
  state: AttentionState;
  signals: AttentionState[];
  priority: AttentionPriority;
  title: string;
  status_label: string;
  subject_label: string | null;
  due_at: string | null;
  created_at: string | null;
  href: string;
}

export interface AttentionRollup {
  total: number;
  new: number;
  action_required: number;
  exceptions: number;
  urgent: number;
  high: number;
  normal: number;
  highest_priority: AttentionPriority | null;
}

export interface AttentionModuleRollup extends AttentionRollup {
  href: string;
  first_item_href: string | null;
}

export interface AttentionResponse {
  portal: AttentionPortal;
  generated_at: string;
  scope: RequestInboxResponse["scope"];
  summary: AttentionRollup;
  modules: Partial<Record<AttentionModuleId, AttentionModuleRollup>>;
  items: AttentionItem[];
}

export interface NoticeAttentionItem {
  id: string;
  source_kind: "notice";
  source_id: string;
  module: "notices";
  state: AttentionState;
  attention_reasons?: Array<"unread" | "response_required" | "delivery_failed" | "response_overdue">;
  source_revision?: number;
  priority: AttentionPriority;
  title: string;
  status_label: string;
  subject_label: string | null;
  due_at: string | null;
  created_at: string | null;
  href: string;
}

export interface ChatAttentionConversation {
  id: string;
  school_id: string;
  title: string;
  context_student_id?: string | null;
  student_name?: string | null;
  unread_count: number | string;
  last_message_at?: Date | string | null;
  created_at?: Date | string | null;
}

export interface NoticeAttentionProjection {
  summary: {
    total: number;
    unread: number;
    action_required: number;
    exceptions: number;
  };
  items: NoticeAttentionItem[];
}
