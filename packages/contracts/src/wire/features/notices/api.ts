/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type NoticeStatus = "draft" | "published" | "cancelled";

export type NoticeResponseMode = "information" | "acknowledgement" | "choice";

export type NoticePriority = "urgent" | "high" | "normal";

export type NoticeChannel = "app" | "sms" | "paper" | "phone" | "in_person";

export type NoticeAttentionReason = "unread" | "response_required" | "delivery_failed" | "response_overdue";

export interface NoticeAudience { kind: "school_staff" | "school_guardians" | "class_guardians"; class_section_id?: string | null }

export interface NoticeDelivery { id: string; channel: NoticeChannel; status: "queued" | "attempted" | "delivered" | "failed" | "cancelled"; note: string; provider_reference: string; attempted_at: string; created_at: string }

export interface NoticeRecipient {
  id: string; recipient_role: "guardian" | "staff" | "admin"; user_id: string | null; guardian_id: string | null;
  student_id: string | null; student_name?: string | null; recipient_name: string; contact_phone: string; contact_email: string;
  opened_at: string | null; responded_at: string | null; response_value: string | null; response_note: string;
  response_channel: NoticeChannel | null; response_observed_at: string | null; revision: number;
  last_seen_notice_revision: number; deliveries: NoticeDelivery[];
}

export interface NoticeSummary {
  id: string; title: string; body: string; response_mode: NoticeResponseMode; response_options: string[]; priority: NoticePriority;
  due_at: string | null; status: NoticeStatus; revision: number; published_at: string | null; cancelled_at: string | null;
  cancellation_reason: string; created_at: string; can_manage?: boolean; recipient_id?: string | null; student_id?: string | null;
  student_name?: string | null; opened_at?: string | null; responded_at?: string | null; response_value?: string | null;
  response_channel?: NoticeChannel | null; recipient_revision?: number | null; recipient_count?: number; response_count?: number;
  delivery_channel?: NoticeChannel | null; delivery_status?: NoticeDelivery["status"] | null;
  attention_reasons?: NoticeAttentionReason[]; unopened_count?: number; pending_response_count?: number;
  delivery_exception_count?: number;
}

export interface NoticeDetail extends NoticeSummary {
  audiences: NoticeAudience[]; can_manage: boolean; recipients?: NoticeRecipient[];
  recipient?: NoticeRecipient; self_recipient?: NoticeRecipient | null; metrics?: { recipients: number; opened: number; responded: number; delivery_exceptions: number; app_accounts: number; assisted: number };
  audits?: Array<{ id: string; action: string; from_status: string | null; to_status: string; metadata: Record<string, unknown>; created_at: string; actor_name: string; recipient_id: string | null }>;
}

export interface NoticeContent {
  title: string; body: string; response_mode: NoticeResponseMode; response_options: string[];
  priority: NoticePriority; due_at?: string | null; audiences: NoticeAudience[];
}

export interface NoticeReferences {
  school_id: string;
  classes: Array<{ id: string; name: string }>;
  audience_kinds?: NoticeAudience["kind"][];
}
