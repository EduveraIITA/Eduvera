import { ApiError, apiFetch } from "../../lib/api";
import type { FeeCommandConfirmation } from "./personFeesApi";

export interface CorrectedChargeState {
  amount_paise: number; description: string; due_on: string; charge_state: "active" | "cancelled";
  paid_paise: number; balance_paise: number; credit_paise: number;
}
export type ChargeCorrectionChange = { kind: "amend"; amount_paise?: number; description?: string; due_on?: string } | { kind: "cancel" };
export interface ChargeCorrectionPreviewInput { selection: { invoice_ids: string[]; batch_id?: string }; change: ChargeCorrectionChange }
export interface ChargeCorrectionQuote {
  snapshot_hash: string; today: string; person_count: number;
  items: Array<{ invoice_id: string; person_id: string; student_id: string | null; name: string; reference: string; revision: number; before: CorrectedChargeState; after: CorrectedChargeState }>;
  before_total_amount_paise: number; after_total_amount_paise: number; before_balance_paise: number; after_balance_paise: number; credit_paise: number;
}
export interface ChargeCorrectionApply extends ChargeCorrectionPreviewInput { command_id: string; correction_id: string; snapshot_hash: string; reason: string; attested_recording_error: true }
export interface ChargeCorrectionResult { id: string; correction_id: string; invoice_ids: string[]; revision: 1; replayed: boolean }
export type PaymentCorrectionPreviewInput = { action: "reverse" } | { action: "replace"; replacement: { amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string } };
export interface PaymentCorrectionQuote {
  snapshot_hash: string; today: string; invoice_id: string; payment_id: string; reference: string; amount_paise: number; method: string;
  before: CorrectedChargeState; after: CorrectedChargeState; can_reverse: boolean; can_replace: boolean;
}
export type PaymentCorrectionRetained = ({ action: "reverse" } | (Extract<PaymentCorrectionPreviewInput, { action: "replace" }> & { verified_funds: true })) & { correction_id: string; snapshot_hash: string; reason: string; attested_recording_error: true };
export type PaymentCorrectionApply = PaymentCorrectionRetained & { command_id: string };
export interface PaymentCorrectionResult { id: string; correction_id: string; invoice_id: string; payment_id: string; replacement_payment_id: string | null; action: "reverse" | "replace"; revision: 1; replayed: boolean }
const base = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
const money = (value: number) => Number.isSafeInteger(value) && value >= 0;
const stateValid = (value: CorrectedChargeState) => Boolean(value && money(value.amount_paise) && money(value.paid_paise) && money(value.balance_paise) && money(value.credit_paise)
  && typeof value.description === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.due_on) && ["active", "cancelled"].includes(value.charge_state));
const mismatch = () => new ApiError("The result does not match this correction. Keep this screen to check the exact result.", 200);
function sameIds(actual: string[], expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));
}
export async function previewChargeCorrection(schoolId: string, input: ChargeCorrectionPreviewInput) {
  const quote = await apiFetch<ChargeCorrectionQuote>(`${base(schoolId)}/corrections/preview/`, { method: "POST", body: JSON.stringify({ selection: input.selection, change: input.change }) });
  if (!quote || !Array.isArray(quote.items) || quote.items.some(item => !item || typeof item.invoice_id !== "string" || typeof item.person_id !== "string" || !item.person_id || typeof item.name !== "string" || typeof item.reference !== "string" || !Number.isSafeInteger(item.revision) || item.revision < 0 || !stateValid(item.before) || !stateValid(item.after))) throw mismatch();
  if (!quote || !/^[a-f0-9]{64}$/.test(quote.snapshot_hash) || !/^\d{4}-\d{2}-\d{2}$/.test(quote.today)
    || !Array.isArray(quote.items) || !sameIds(quote.items.map(item => item.invoice_id), input.selection.invoice_ids)
    || quote.person_count !== new Set(quote.items.map(item => item.person_id)).size
    || ![quote.before_total_amount_paise, quote.after_total_amount_paise, quote.before_balance_paise, quote.after_balance_paise, quote.credit_paise].every(money)
    || quote.before_total_amount_paise !== quote.items.reduce((sum, item) => sum + item.before.amount_paise, 0) || quote.after_total_amount_paise !== quote.items.reduce((sum, item) => sum + item.after.amount_paise, 0)
    || quote.before_balance_paise !== quote.items.reduce((sum, item) => sum + item.before.balance_paise, 0) || quote.after_balance_paise !== quote.items.reduce((sum, item) => sum + item.after.balance_paise, 0)
    || quote.credit_paise !== quote.items.reduce((sum, item) => sum + item.after.credit_paise, 0)
    || quote.items.some(item => input.change.kind === "cancel" ? item.after.amount_paise !== 0 || item.after.charge_state !== "cancelled"
        : item.after.amount_paise !== (input.change.amount_paise ?? item.before.amount_paise) || item.after.description !== (input.change.description ?? item.before.description) || item.after.due_on !== (input.change.due_on ?? item.before.due_on))) throw mismatch();
  return quote;
}
function checkedChargeResult(value: ChargeCorrectionResult, input: Omit<ChargeCorrectionApply, "command_id">) {
  if (!value || value.id !== input.correction_id || value.correction_id !== input.correction_id || value.revision !== 1 || typeof value.replayed !== "boolean" || !sameIds(value.invoice_ids, input.selection.invoice_ids)) throw mismatch();
  return value;
}
export async function applyChargeCorrection(schoolId: string, input: ChargeCorrectionApply) {
  return checkedChargeResult(await apiFetch<ChargeCorrectionResult>(`${base(schoolId)}/corrections/`, { method: "POST", body: JSON.stringify(input) }), input);
}
export async function previewPaymentCorrection(schoolId: string, paymentId: string, invoiceId: string, input: PaymentCorrectionPreviewInput) {
  const quote = await apiFetch<PaymentCorrectionQuote>(`${base(schoolId)}/payments/${encodeURIComponent(paymentId)}/correction-preview/`, { method: "POST", body: JSON.stringify(input.action === "reverse" ? { action: "reverse" } : { action: "replace", replacement: input.replacement }) });
  if (!quote || !/^[a-f0-9]{64}$/.test(quote.snapshot_hash) || !/^\d{4}-\d{2}-\d{2}$/.test(quote.today) || quote.payment_id !== paymentId || quote.invoice_id !== invoiceId
    || !stateValid(quote.before) || !stateValid(quote.after) || !money(quote.amount_paise) || typeof quote.reference !== "string" || typeof quote.method !== "string"
    || typeof quote.can_reverse !== "boolean" || typeof quote.can_replace !== "boolean" || !(input.action === "replace" ? quote.can_replace : quote.can_reverse)) throw mismatch();
  return quote;
}
function checkedPaymentResult(value: PaymentCorrectionResult, input: PaymentCorrectionRetained, quote: PaymentCorrectionQuote) {
  if (!value || value.id !== input.correction_id || value.correction_id !== input.correction_id || value.revision !== 1 || typeof value.replayed !== "boolean" || value.invoice_id !== quote.invoice_id || value.payment_id !== quote.payment_id || value.action !== input.action
    || (input.action === "reverse" ? value.replacement_payment_id !== null : typeof value.replacement_payment_id !== "string" || !value.replacement_payment_id || value.replacement_payment_id === quote.payment_id)) throw mismatch();
  return value;
}
export async function applyPaymentCorrection(schoolId: string, input: PaymentCorrectionApply, quote: PaymentCorrectionQuote) {
  return checkedPaymentResult(await apiFetch<PaymentCorrectionResult>(`${base(schoolId)}/payments/${encodeURIComponent(quote.payment_id)}/corrections/`, { method: "POST", body: JSON.stringify(input) }), input, quote);
}
function checkConfirmation<T>(value: Omit<FeeCommandConfirmation, "result"> & { result?: T }, handler: string, sourceId: string, commandId: string) {
  if (!value || value.handler !== handler || value.source_id !== sourceId || value.command_id !== commandId || value.action !== "apply" || !["not_found", "pending", "accepted", "not_accepted"].includes(value.state)) throw new ApiError("This result does not belong to the correction being checked.", 409);
  return value;
}
export async function confirmChargeCorrection(schoolId: string, input: Omit<ChargeCorrectionApply, "command_id">, commandId: string) {
  const receipt = checkConfirmation(await apiFetch<Omit<FeeCommandConfirmation, "result"> & { result?: ChargeCorrectionResult }>(`${base(schoolId)}/corrections/${encodeURIComponent(input.correction_id)}/confirmation/?command_id=${encodeURIComponent(commandId)}`), "finance.charge_correction", input.correction_id, commandId);
  if (receipt.state === "accepted") { if (!receipt.result) throw mismatch(); checkedChargeResult(receipt.result, input); }
  return receipt;
}
export async function confirmPaymentCorrection(schoolId: string, input: PaymentCorrectionRetained, quote: PaymentCorrectionQuote, commandId: string) {
  const receipt = checkConfirmation(await apiFetch<Omit<FeeCommandConfirmation, "result"> & { result?: PaymentCorrectionResult }>(`${base(schoolId)}/payment-corrections/${encodeURIComponent(input.correction_id)}/confirmation/?command_id=${encodeURIComponent(commandId)}`), "finance.payment_correction", input.correction_id, commandId);
  if (receipt.state === "accepted") { if (!receipt.result) throw mismatch(); checkedPaymentResult(receipt.result, input, quote); }
  return receipt;
}
