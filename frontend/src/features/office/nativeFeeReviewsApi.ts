import { ApiError, apiFetch } from "../../lib/api";
import type { FeeCommandConfirmation } from "./personFeesApi";

export interface NativeFeeReviewer { user_id: string; person_id: string; label: string; eligibility_hash: string }
export interface NativeFeeReview {
  id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; method: string | null; reference: string | null;
  note: string; submitted_at: string; status: "pending" | "verified" | "rejected" | "answered" | "withdrawn"; revision: number;
  reviewer: { user_id: string; person_id: string; label: string }; route_state: string;
  can_decide: boolean; can_verify: boolean; basis_changed: boolean; can_withdraw: boolean; response: string | null; payment_id: string | null; decided_at: string | null;
}
export interface NativeFeeReviewInvoice {
  id: string; student_id: string | null; person_id: string | null; context_kind: "student" | "person"; label: string;
  reference: string; description: string; balance_paise: number; basis_hash: string; basis_revision: number; stream_revision: number;
  can_report: boolean; can_question: boolean; reviewers: NativeFeeReviewer[]; reviews: NativeFeeReview[];
}
export interface NativeFeeReviewWorkspace {
  school_id: string; today: string; timezone: string; can_manage: boolean; invoices: NativeFeeReviewInvoice[]; confirmation?: FeeCommandConfirmation;
}
export interface NativeFeeReviewRecovery {
  id: string; invoice_id: string; stream_revision: number; status: NativeFeeReview["status"];
  reviewer: { user_id: string; label: string }; can_withdraw: boolean; confirmation?: FeeCommandConfirmation;
}
const base = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
export const getNativeFeeReviewRecovery = (schoolId: string, reviewId: string, commandId?: string) => apiFetch<NativeFeeReviewRecovery>(`${base(schoolId)}/payment-reviews/${encodeURIComponent(reviewId)}/recovery/${commandId ? `?command_id=${encodeURIComponent(commandId)}` : ""}`);
export const getNativeFeeReviews = (schoolId: string, context: { invoiceId?: string; personId?: string; studentId?: string }, commandId?: string) => {
  const params = new URLSearchParams(); if (context.invoiceId) params.set("invoice_id", context.invoiceId); if (context.personId) params.set("person_id", context.personId);
  if (context.studentId) params.set("student_id", context.studentId); if (commandId) params.set("command_id", commandId);
  return apiFetch<NativeFeeReviewWorkspace>(`${base(schoolId)}/payment-reviews/workspace/${params.size ? `?${params}` : ""}`);
};
export const confirmNativeFeeReview = async (schoolId: string, context: { invoiceId: string; personId?: string; studentId?: string }, commandId: string, reviewId: string, action: "report" | "decide" | "withdraw") => {
  const confirmation = (await getNativeFeeReviews(schoolId, context, commandId)).confirmation;
  return validateNativeFeeConfirmation(confirmation, context.invoiceId, commandId, reviewId, action);
};
export function validateNativeFeeConfirmation(confirmation: FeeCommandConfirmation | undefined, invoiceId: string, commandId: string, reviewId: string, action: "report" | "decide" | "withdraw") {
  if (!confirmation || confirmation.handler !== "finance.payment_review" || confirmation.invoice_id !== invoiceId || confirmation.command_id !== commandId
    || confirmation.state !== "not_found" && (confirmation.source_id !== reviewId || confirmation.action !== action)
    || confirmation.state === "accepted" && (confirmation.result?.id !== reviewId || confirmation.result.invoice_id !== invoiceId))
    throw new ApiError("This result does not match the fee request being checked.", 409);
  return confirmation;
}
const send = async (path: string, body: object, reviewId: string, invoiceId: string) => {
  const result = await apiFetch<{ id: string; invoice_id: string; revision: number; payment_id?: string | null }>(path, { method: "POST", body: JSON.stringify(body) });
  if (!result || result.id !== reviewId || result.invoice_id !== invoiceId || !Number.isSafeInteger(result.revision) || result.revision < 1)
    throw new ApiError("The server did not return this fee request’s exact result. Check the result before continuing.", 200);
  return result;
};
export const reportNativeFeeReview = (schoolId: string, invoiceId: string, body: Record<string, unknown> & { review_id: string }) => send(`${base(schoolId)}/invoices/${encodeURIComponent(invoiceId)}/payment-reviews/`, body, body.review_id, invoiceId);
export const decideNativeFeeReview = (schoolId: string, reviewId: string, invoiceId: string, body: object) => send(`${base(schoolId)}/payment-reviews/${encodeURIComponent(reviewId)}/decision/`, body, reviewId, invoiceId);
export const withdrawNativeFeeReview = (schoolId: string, reviewId: string, invoiceId: string, body: object) => send(`${base(schoolId)}/payment-reviews/${encodeURIComponent(reviewId)}/withdraw/`, body, reviewId, invoiceId);
export function nativeFeeReviewObsolete(cause: unknown, commandId: string, invoice: Pick<NativeFeeReviewInvoice, "id" | "stream_revision">, reviewId: string) {
  if (!(cause instanceof ApiError) || cause.status !== 409) return false;
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const error = object(object(cause.details).error), proof = object(object(error.fields).native_fee_review_obsolete);
  return error.code === "native_fee_review_obsolete" && proof.handler === "finance.payment_review" && proof.confirmation === "permanently_inapplicable" && proof.receipt_state === "absent"
    && proof.invoice_id === invoice.id && proof.review_id === reviewId && proof.command_id === commandId && proof.expected_revision === invoice.stream_revision
    && Number.isSafeInteger(proof.current_revision) && Number(proof.current_revision) >= invoice.stream_revision
    && (proof.reason === "stream_advanced" && Number(proof.current_revision) > invoice.stream_revision || ["ledger_basis_diverged", "already_decided"].includes(String(proof.reason)));
}
