import { apiFetch } from "../../lib/api";

export type NoticePortal = "parent" | "teacher" | "principal";
export type NoticeStatus = "draft" | "published" | "cancelled";
export type NoticeResponseMode = "information" | "acknowledgement" | "choice";
export type NoticePriority = "urgent" | "high" | "normal";
export type NoticeChannel = "app" | "sms" | "paper" | "phone" | "in_person";

export interface NoticeAudience { kind: "school_staff" | "school_guardians" | "class_guardians"; class_section_id?: string | null }
export interface NoticeDelivery { id: string; channel: NoticeChannel; status: "queued" | "attempted" | "delivered" | "failed" | "cancelled"; note: string; provider_reference: string; attempted_at: string; created_at: string }
export interface NoticeRecipient {
  id: string; recipient_role: "guardian" | "staff" | "admin"; user_id: string | null; guardian_id: string | null;
  student_id: string | null; student_name?: string | null; recipient_name: string; contact_phone: string; contact_email: string;
  opened_at: string | null; responded_at: string | null; response_value: string | null; response_note: string;
  response_channel: NoticeChannel | null; response_observed_at: string | null; revision: number; deliveries: NoticeDelivery[];
}
export interface NoticeSummary {
  id: string; title: string; body: string; response_mode: NoticeResponseMode; response_options: string[]; priority: NoticePriority;
  due_at: string | null; status: NoticeStatus; revision: number; published_at: string | null; cancelled_at: string | null;
  cancellation_reason: string; created_at: string; can_manage?: boolean; recipient_id?: string | null; student_id?: string | null;
  student_name?: string | null; opened_at?: string | null; responded_at?: string | null; response_value?: string | null;
  response_channel?: NoticeChannel | null; recipient_revision?: number | null; recipient_count?: number; response_count?: number;
  delivery_channel?: NoticeChannel | null; delivery_status?: NoticeDelivery["status"] | null;
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

function withQuery(path: string, values: Record<string, string | undefined>) {
  const parameters = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value) parameters.set(key, value); });
  const encoded = parameters.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function noticeCommandKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16); globalThis.crypto?.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function getNotices(portal: NoticePortal, options: { schoolId?: string; studentId?: string; status?: NoticeStatus } = {}) {
  return apiFetch<{ portal: NoticePortal; school_id: string; student_id: string | null; results: NoticeSummary[] }>(withQuery("/api/v1/notices", {
    portal, school_id: options.schoolId, student_id: options.studentId, status: options.status,
  }));
}

export function getNotice(portal: NoticePortal, noticeId: string, studentId?: string) {
  return apiFetch<NoticeDetail>(withQuery(`/api/v1/notices/${encodeURIComponent(noticeId)}`, { portal, student_id: studentId }));
}

export function getNoticeReferences(portal: "teacher" | "principal", schoolId?: string) {
  return apiFetch<{ school_id: string; classes: Array<{ id: string; name: string }> }>(withQuery("/api/v1/notices/references", { portal, school_id: schoolId }));
}

export function createNotice(schoolId: string, input: NoticeContent, idempotencyKey = noticeCommandKey()) {
  return apiFetch<{ id: string; revision: number; status: NoticeStatus }>("/api/v1/notices", {
    method: "POST", body: JSON.stringify({ school_id: schoolId, ...input, idempotency_key: idempotencyKey }),
  });
}

export function updateNotice(noticeId: string, input: NoticeContent, expectedRevision: number, idempotencyKey = noticeCommandKey()) {
  return apiFetch<{ id: string; revision: number; status: NoticeStatus }>(`/api/v1/notices/${encodeURIComponent(noticeId)}`, {
    method: "PATCH", body: JSON.stringify({ ...input, expected_revision: expectedRevision, idempotency_key: idempotencyKey }),
  });
}

export function publishNotice(noticeId: string, expectedRevision: number, idempotencyKey = noticeCommandKey()) {
  return apiFetch<{ id: string; revision: number; status: NoticeStatus; recipient_count: number }>(`/api/v1/notices/${encodeURIComponent(noticeId)}/publish`, {
    method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, idempotency_key: idempotencyKey }),
  });
}

export function cancelNotice(noticeId: string, expectedRevision: number, reason: string, idempotencyKey = noticeCommandKey()) {
  return apiFetch<{ id: string; revision: number; status: NoticeStatus }>(`/api/v1/notices/${encodeURIComponent(noticeId)}/cancel`, {
    method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, reason, idempotency_key: idempotencyKey }),
  });
}

export function openNotice(noticeId: string, studentId?: string) {
  return apiFetch(`/api/v1/notices/${encodeURIComponent(noticeId)}/open`, { method: "POST", body: JSON.stringify({ student_id: studentId }) });
}

export function respondToNotice(noticeId: string, input: { expected_revision: number; response_value?: string; response_note?: string; student_id?: string }, idempotencyKey = noticeCommandKey()) {
  return apiFetch(`/api/v1/notices/${encodeURIComponent(noticeId)}/respond`, {
    method: "POST", body: JSON.stringify({ ...input, idempotency_key: idempotencyKey }),
  });
}

export function recordAssistedNoticeResponse(noticeId: string, input: { recipient_id: string; expected_revision: number; response_value?: string; response_note?: string; channel: Exclude<NoticeChannel, "app">; observed_at: string }, idempotencyKey = noticeCommandKey()) {
  return apiFetch(`/api/v1/notices/${encodeURIComponent(noticeId)}/assisted-responses`, {
    method: "POST", body: JSON.stringify({ ...input, idempotency_key: idempotencyKey }),
  });
}

export function recordNoticeDelivery(noticeId: string, input: { recipient_id: string; channel: Exclude<NoticeChannel, "app">; status: NoticeDelivery["status"]; note?: string; provider_reference?: string; attempted_at: string }, idempotencyKey = noticeCommandKey()) {
  return apiFetch(`/api/v1/notices/${encodeURIComponent(noticeId)}/deliveries`, {
    method: "POST", body: JSON.stringify({ ...input, idempotency_key: idempotencyKey }),
  });
}
