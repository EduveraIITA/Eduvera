import type { Term, ClassSection, Subject, Administration, InstitutionCampus, CampusSpace, CampusResourceType, CampusResourceHolding, CampusObservationSource, InstitutionSetup, FeeStudent, Invoice, Payment, GatewayPaymentReview, FeeLedger, FeeLedgerReadOptions, CatalogKind, CatalogMutation } from "../../../../packages/contracts/src/institution";
export type { Term, ClassSection, Subject, Member, Invitation, Administration, InstitutionCampus, CampusSpace, CampusResourceType, CampusResourceHolding, CampusObservationSource, InstitutionSetup, FeeStudent, Invoice, Payment, GatewayPaymentReview, FeeLedgerPagination, FeeLedger, FeeLedgerReadOptions, CatalogKind, CatalogMutation, FeeReview, FeePaymentSettings } from "../../../../packages/contracts/src/institution";
import { applicationNow } from "../simulation/applicationTime";
import { apiFetch } from "../../lib/api";
export const invoiceDescription = (invoice: Pick<Invoice, "description" | "effective_description">) => invoice.effective_description ?? invoice.description;
export const invoiceAmount = (invoice: Pick<Invoice, "amount_paise" | "effective_amount_paise">) => invoice.effective_amount_paise ?? invoice.amount_paise;
export const invoicePersonLabel = (invoice: { first_name: string; last_name: string; beneficiary?: { name: string } }) => invoice.beneficiary?.name ?? `${invoice.first_name} ${invoice.last_name}`.trim();
export const paymentIsActive = (payment: Pick<Payment, "status">) => payment.status === undefined || payment.status === "active";
export function feeLedgerReadOptions(params: URLSearchParams, invoiceId?: string): FeeLedgerReadOptions {
  const exact = invoiceId || params.get("receipt") || params.get("batch_id") || params.get("review");
  return { ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(params.get("receipt") ? { receipt_id: params.get("receipt")! } : {}),
    ...(params.get("batch_id") ? { batch_id: params.get("batch_id")! } : {}),
    ...(params.get("review") ? { review_id: params.get("review")! } : {}),
    payment_cursor: params.get("receipt") ? undefined : params.get("ledger_payment_cursor") ?? undefined,
    ...(!params.get("review") && params.get("ledger_review_cursor") ? { review_cursor: params.get("ledger_review_cursor")! } : {}),
    ...(!exact ? { cursor: params.get("ledger_cursor") ?? undefined,
      search: params.get("ledger_search") ?? undefined } : {}) };
}
export function feeLedgerReadSearch(options: FeeLedgerReadOptions = {}) { return new URLSearchParams(Object.entries(options).filter((entry): entry is [string, string] => Boolean(entry[1]))); }

const schoolPath = (schoolId: string, path: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/${path}/`;
export const getAdministration = (schoolId: string) => apiFetch<Administration>(schoolPath(schoolId, "administration"));
export const getInstitutionSetup = (schoolId: string) => apiFetch<InstitutionSetup>(schoolPath(schoolId, "institution-setup"));
export const createCampus = (schoolId: string, values: object) => apiFetch<InstitutionCampus>(schoolPath(schoolId, "institution-setup/campuses"), { method: "POST", body: JSON.stringify(values) });
export const updateCampus = (schoolId: string, id: string, values: object) => apiFetch<InstitutionCampus>(schoolPath(schoolId, `institution-setup/campuses/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createSpace = (schoolId: string, values: object) => apiFetch<CampusSpace>(schoolPath(schoolId, "institution-setup/spaces"), { method: "POST", body: JSON.stringify(values) });
export const updateSpace = (schoolId: string, id: string, values: object) => apiFetch<CampusSpace>(schoolPath(schoolId, `institution-setup/spaces/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createResourceType = (schoolId: string, values: object) => apiFetch<CampusResourceType>(schoolPath(schoolId, "institution-setup/resource-types"), { method: "POST", body: JSON.stringify(values) });
export const updateResourceType = (schoolId: string, id: string, values: object) => apiFetch<CampusResourceType>(schoolPath(schoolId, `institution-setup/resource-types/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createAsset = (schoolId: string, values: object) => apiFetch<CampusResourceHolding>(schoolPath(schoolId, "institution-setup/assets"), { method: "POST", body: JSON.stringify(values) });
export const updateAsset = (schoolId: string, id: string, values: object) => apiFetch<CampusResourceHolding>(schoolPath(schoolId, `institution-setup/assets/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const placeClass = (schoolId: string, id: string, values: object) => apiFetch(schoolPath(schoolId, `institution-setup/classes/${id}/location`), { method: "PATCH", body: JSON.stringify(values) });
export const placeStaff = (schoolId: string, id: string, values: object) => apiFetch(schoolPath(schoolId, `institution-setup/staff/${id}/campus`), { method: "POST", body: JSON.stringify(values) });
export const registerObservationSource = (schoolId: string, values: object) => apiFetch<CampusObservationSource>(schoolPath(schoolId, "institution-setup/observation-sources"), { method: "POST", body: JSON.stringify(values) });
export const setObservationSourceStatus = (schoolId: string, id: string, values: object) => apiFetch<CampusObservationSource>(schoolPath(schoolId, `institution-setup/observation-sources/${id}/status`), { method: "PATCH", body: JSON.stringify(values) });
export const saveCatalog = (schoolId: string, kind: CatalogKind, values: CatalogMutation, id?: string) => apiFetch<Term | ClassSection | Subject>(schoolPath(schoolId, `catalog/${kind}${id ? `/${id}` : ""}`), { method: id ? "PATCH" : "POST", body: JSON.stringify(values) });
export const createInvitation = (schoolId: string, values: { email: string; role: string }) => apiFetch<{ token: string; expires_at: string }>(schoolPath(schoolId, "invitations"), { method: "POST", body: JSON.stringify(values) });
export const revokeInvitation = (schoolId: string, id: string) => apiFetch(schoolPath(schoolId, `invitations/${id}/revoke`), { method: "POST", body: "{}" });
export const updateMember = (schoolId: string, id: string, values: { is_active: boolean }) => apiFetch(schoolPath(schoolId, `members/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createSchool = (values: { name: string; code: string }) => apiFetch<{ id: string }>("/api/v1/schools/", { method: "POST", body: JSON.stringify(values) });
export const selectActiveSchool = (schoolId: string) => apiFetch("/api/v1/auth/active-school/", { method: "POST", body: JSON.stringify({ school_id: schoolId }) });
export const promoteClass = (schoolId: string, values: { source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }>; confirm: boolean }) => apiFetch<{ count: number; confirmed: boolean }>(schoolPath(schoolId, "rollover"), { method: "POST", body: JSON.stringify(values) });
export const getFeeStudents = (schoolId: string, options: { cursor?: string; search?: string } = {}) => {
  const search = feeLedgerReadSearch(options);
  return apiFetch<{ results: FeeStudent[]; next_cursor?: string | null }>(`${schoolPath(schoolId, "fees/students")}${search.size ? `?${search}` : ""}`);
};
export const getFeeLedger = (schoolId: string, studentId?: string, options: FeeLedgerReadOptions = {}) => {
  const search = feeLedgerReadSearch(options); if (studentId) search.set("student_id", studentId);
  return apiFetch<FeeLedger>(`${schoolPath(schoolId, "fees/workspace")}${search.size ? `?${search}` : ""}`);
};
export const getGatewayPaymentReview = (schoolId: string, orderId: string) => apiFetch<GatewayPaymentReview>(schoolPath(schoolId, `fees/gateway-orders/${encodeURIComponent(orderId)}`));
export const postInvoice = (schoolId: string, values: object) => apiFetch(schoolPath(schoolId, "fees/invoices"), { method: "POST", body: JSON.stringify(values) });
export const recordPayment = (schoolId: string, invoiceId: string, values: object) => apiFetch(schoolPath(schoolId, `fees/invoices/${invoiceId}/payments`), { method: "POST", body: JSON.stringify(values) });
export const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
export const personName = (person: { first_name: string; last_name: string }) => `${person.first_name} ${person.last_name}`.trim();
export function invoiceStatusLabel(invoice: Invoice) {
  if (invoice.charge_state === "cancelled") return "Cancelled";
  if (invoice.collection_state === "refund_due") return "Refund due";
  if (invoice.collection_state === "partially_refunded") return "Refund partly recorded";
  if (invoice.collection_state === "refunded") return "Refunded";
  if (invoice.collection_state === "credited") return "Credited";
  if (invoice.collection_state === "paid") return "Paid";
  if (invoice.payment_plan_state === "needs_review") return "Plan needs review";
  const today = invoice.collection_today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(applicationNow());
  const due = invoiceCollectionDue(invoice);
  return due && due < today ? "Overdue" : "Open";
}
export const invoiceCollectionDue = (invoice: Invoice) => invoice.charge_state === "cancelled" || invoice.payment_plan_state === "needs_review" || invoice.payment_plan_state === "satisfied" ? null : invoice.collection_due_on === undefined ? invoice.effective_due_on ?? invoice.due_on : invoice.collection_due_on;
export const submitFeeReview = (schoolId: string, invoiceId: string, values: object) => apiFetch(schoolPath(schoolId, `fees/invoices/${invoiceId}/reviews`), { method: "POST", body: JSON.stringify(values) });
export const decideFeeReview = (schoolId: string, id: string, values: object) => apiFetch(schoolPath(schoolId, `fees/reviews/${id}/decision`), { method: "POST", body: JSON.stringify(values) });
export const saveFeePaymentSettings = (schoolId: string, values: object) => apiFetch(schoolPath(schoolId, "fees/settings"), { method: "POST", body: JSON.stringify(values) });
export function parseRupees(input: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input.trim())) throw new Error("Enter rupees with at most two decimal places.");
  const [whole, fraction = ""] = input.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) throw new Error("Enter an amount from ₹0.01 to ₹10,00,000.");
  return amount;
}
