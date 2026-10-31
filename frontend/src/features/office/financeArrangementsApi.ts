import { apiFetch } from "../../lib/api";

export interface ProposedInstalment { amount_paise: number; due_on: string }
export interface ArrangementRequest {
  id: string; revision: number; status: "pending" | "approved" | "rejected" | "withdrawn"; schedule: ProposedInstalment[];
  note: string; submitted_at: string; decision_response: string | null; decision_at: string | null;
  reviewer: { user_id: string; label: string }; route_state?: "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "review_window_ended";
  basis_changed: boolean; can_decide: boolean; can_approve: boolean; can_withdraw: boolean;
}
export interface ArrangementInvoice {
  id: string; student_id: string | null; person_id?: string | null; context_kind?: "student" | "person"; student_label: string; reference: string; description: string; original_due_on: string;
  balance_paise: number; basis_hash: string; basis_revision: number; stream_revision: number; can_request: boolean;
  can_enable_self_payer: boolean; can_revoke_self_payer: boolean; self_payer_account_available: boolean;
  self_payer: { id: string; valid_from: string; valid_until: string; state: "active" | "scheduled" | "expired" | "revoked" } | null;
  agreement: { request_id: string; approved_at: string; state: "active" | "satisfied" | "needs_review"; next_due_on: string | null;
    rows: Array<ProposedInstalment & { allocated_paise: number | null; remaining_paise: number | null }> } | null;
  requests: ArrangementRequest[];
}
export interface FinanceArrangementsWorkspace {
  school_id: string; today: string; timezone: string; supported_mode: "approval_required"; can_manage: boolean;
  review_route: { state: "ready" | "unavailable"; reviewer: { user_id: string; label: string } | null }; invoices: ArrangementInvoice[];
  confirmation?: { state: "not_found" | "pending" | "accepted" | "not_accepted"; result?: { id: string; invoice_id: string; revision: number } };
}
const base = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
export function getFinanceArrangements(schoolId: string, studentId?: string | null, invoiceId?: string, commandId?: string, personId?: string) {
  const params = new URLSearchParams(); if (personId) params.set("person_id", personId); else if (studentId) params.set("student_id", studentId); if (invoiceId) params.set("invoice_id", invoiceId);
  if (commandId) params.set("command_id", commandId);
  return apiFetch<FinanceArrangementsWorkspace>(`${base(schoolId)}/arrangements/workspace/${params.size ? `?${params}` : ""}`);
}
export function getInvoiceFinanceArrangements(schoolId: string, invoice: ArrangementInvoice, commandId?: string) {
  return getFinanceArrangements(schoolId, invoice.student_id, invoice.id, commandId, invoice.context_kind === "person" || !invoice.student_id ? invoice.person_id ?? undefined : undefined);
}
const send = (path: string, body: object) => apiFetch<{ id: string; revision: number; replayed: boolean }>(path, { method: "POST", body: JSON.stringify(body) });
export const requestPaymentPlan = (schoolId: string, invoiceId: string, body: object) => send(`${base(schoolId)}/invoices/${encodeURIComponent(invoiceId)}/arrangements/request/`, body);
export const decidePaymentPlan = (schoolId: string, requestId: string, body: object) => send(`${base(schoolId)}/arrangements/${encodeURIComponent(requestId)}/decision/`, body);
export const withdrawPaymentPlan = (schoolId: string, requestId: string, body: object) => send(`${base(schoolId)}/arrangements/${encodeURIComponent(requestId)}/withdraw/`, body);
export const enableInvoiceSelfPayer = (schoolId: string, invoiceId: string, body: object) => send(`${base(schoolId)}/invoices/${encodeURIComponent(invoiceId)}/self-payer/enable/`, body);
export const revokeInvoiceSelfPayer = (schoolId: string, invoiceId: string, body: object) => send(`${base(schoolId)}/invoices/${encodeURIComponent(invoiceId)}/self-payer/revoke/`, body);
