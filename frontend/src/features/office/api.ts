import { apiFetch } from "../../lib/api";

interface CatalogRecord { id: string; revision: number; updated_at: string; updated_by: string | null }
export interface Term extends CatalogRecord { name: string; academic_year: string; starts_on: string; ends_on: string; attendance_threshold: string; is_active: boolean; enrollment_count: number; timetable_count: number; register_count: number }
export interface ClassSection extends CatalogRecord { grade: string; section: string; academic_year: string; room_number: string; board: string; enrollment_count: number; timetable_count: number; assignment_count: number }
export interface Subject extends CatalogRecord { code: string; name: string; short_name: string; color: string; icon: string; timetable_count: number; attendance_count: number; diary_count: number; day_plan_count: number }
export interface Member { id: string; user_id: string; first_name: string; last_name: string; email: string; role: string; is_active: boolean }
export interface Invitation { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }
export interface Administration {
  school: { id: string; name: string; code: string };
  students: Array<{ id: string }>;
  terms: Term[]; classes: ClassSection[]; subjects: Subject[]; members: Member[];
  invitations: Invitation[]; grants: Array<{ user_id: string; permission: string }>;
  audit: Array<{ id: string; action: string; target_id: string | null; metadata: Record<string, unknown>; created_at: string; first_name: string; last_name: string }>;
}
export interface InstitutionCampus {
  id: string; school_id: string; parent_campus_id: string | null; name: string; code: string; campus_type: "main" | "branch" | "learning_centre" | "virtual";
  status: "active" | "inactive"; is_primary: boolean; address_line: string; city: string; state: string; postal_code: string;
  timezone: string; revision: number;
}
export interface CampusSpace {
  id: string; school_id: string; campus_id: string; parent_space_id: string | null; name: string; code: string;
  kind: "building" | "wing" | "floor" | "classroom" | "laboratory" | "library" | "office" | "auditorium" | "sports_area" | "workshop" | "staff_room" | "gate" | "outdoor_area" | "virtual" | "other";
  capacity: number | null; is_accessible: boolean; is_bookable: boolean; status: "active" | "inactive"; revision: number;
}
export interface CampusResourceType {
  id: string; school_id: string; code: string; name: string; category: "computer" | "display" | "tablet" | "lab_equipment" | "furniture" | "vehicle" | "network" | "safety" | "other";
  tracking_mode: "pooled" | "individual"; unit_label: string; is_active: boolean; revision: number;
}
export interface CampusResourceHolding {
  id: string; school_id: string; campus_id: string; space_id: string | null; resource_type_id: string; name: string;
  quantity: number; asset_tag: string | null; state: "available" | "unavailable" | "retired"; notes: string; revision: number;
  resource_type_name: string; category: CampusResourceType["category"]; tracking_mode: CampusResourceType["tracking_mode"]; unit_label: string;
}
export interface InstitutionSetup {
  school: { id: string; name: string; code: string; timezone: string; institution_kind: string };
  campuses: InstitutionCampus[]; spaces: CampusSpace[]; resource_types: CampusResourceType[]; holdings: CampusResourceHolding[];
  classes: Array<{ id: string; grade: string; section: string; academic_year: string; class_revision: number; placement_id: string | null; campus_id: string | null; home_space_id: string | null; home_space_name: string | null; placement_revision: number | null; effective_from: string | null; effective_until: string | null }>;
  staff: Array<{ id: string; first_name: string; last_name: string; staff_code: string; designation: string; status: string; assignment_id: string | null; campus_id: string | null; assignment_revision: number | null; effective_from: string | null; effective_until: string | null }>;
  readiness: Array<{ key: string; label: string; complete: boolean; detail: string }>;
  summary: { campuses: number; spaces: number; resources: number; classes: number; classes_with_home_space: number; staff: number; complete: boolean };
}
export interface FeeStudent { id: string; admission_number: string; first_name: string; last_name: string }
export interface Invoice extends FeeStudent {
  id: string; student_id: string; reference: string; description: string; due_on: string;
  amount_paise: number; paid_paise: number; adjusted_amount_paise: number; balance_paise: number;
  refund_due_paise: number; collection_state: "collectible" | "paid" | "credited" | "refund_due" | "partially_refunded" | "refunded";
}
export interface Payment { id: string; invoice_id: string; amount_paise: number; method: string; reference: string; created_at: string }
export interface GatewayPaymentReview { id: string; invoice_id: string; amount_paise: number; state: string; provider_payment_id: string | null; payment_id: string | null }
export interface FeeLedger { currency: "INR"; invoices: Invoice[]; payments: Payment[]; online_payments_enabled: boolean; gateway_payments?: GatewayPaymentReview[]; reviews?: FeeReview[]; payment_settings?: FeePaymentSettings; can_submit?: boolean }

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
export type CatalogKind = "terms" | "classes" | "subjects";
export type CatalogMutation = Record<string, unknown> & { expected_revision?: number; confirmed?: boolean; change_reason?: string };
export const saveCatalog = (schoolId: string, kind: CatalogKind, values: CatalogMutation, id?: string) => apiFetch<Term | ClassSection | Subject>(schoolPath(schoolId, `catalog/${kind}${id ? `/${id}` : ""}`), { method: id ? "PATCH" : "POST", body: JSON.stringify(values) });
export const createInvitation = (schoolId: string, values: { email: string; role: string }) => apiFetch<{ token: string; expires_at: string }>(schoolPath(schoolId, "invitations"), { method: "POST", body: JSON.stringify(values) });
export const revokeInvitation = (schoolId: string, id: string) => apiFetch(schoolPath(schoolId, `invitations/${id}/revoke`), { method: "POST", body: "{}" });
export const updateMember = (schoolId: string, id: string, values: { is_active: boolean }) => apiFetch(schoolPath(schoolId, `members/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createSchool = (values: { name: string; code: string }) => apiFetch<{ id: string }>("/api/v1/schools/", { method: "POST", body: JSON.stringify(values) });
export const selectActiveSchool = (schoolId: string) => apiFetch("/api/v1/auth/active-school/", { method: "POST", body: JSON.stringify({ school_id: schoolId }) });
export const promoteClass = (schoolId: string, values: { source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }>; confirm: boolean }) => apiFetch<{ count: number; confirmed: boolean }>(schoolPath(schoolId, "rollover"), { method: "POST", body: JSON.stringify(values) });
export const getFeeStudents = (schoolId: string) => apiFetch<{ results: FeeStudent[] }>(schoolPath(schoolId, "fees/students"));
export const getFeeLedger = (schoolId: string, studentId?: string) => apiFetch<FeeLedger>(`${schoolPath(schoolId, "fees/workspace")}${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`);
export const getGatewayPaymentReview = (schoolId: string, orderId: string) => apiFetch<GatewayPaymentReview>(schoolPath(schoolId, `fees/gateway-orders/${encodeURIComponent(orderId)}`));
export const postInvoice = (schoolId: string, values: object) => apiFetch(schoolPath(schoolId, "fees/invoices"), { method: "POST", body: JSON.stringify(values) });
export const recordPayment = (schoolId: string, invoiceId: string, values: object) => apiFetch(schoolPath(schoolId, `fees/invoices/${invoiceId}/payments`), { method: "POST", body: JSON.stringify(values) });
export const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
export const personName = (person: { first_name: string; last_name: string }) => `${person.first_name} ${person.last_name}`.trim();
export function invoiceStatusLabel(invoice: Invoice) {
  if (invoice.collection_state === "refund_due") return "Refund due";
  if (invoice.collection_state === "partially_refunded") return "Refund partly recorded";
  if (invoice.collection_state === "refunded") return "Refunded";
  if (invoice.collection_state === "credited") return "Credited";
  if (invoice.collection_state === "paid") return "Paid";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return invoice.due_on < today ? "Overdue" : "Open";
}

export interface FeeReview { id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; method: string | null; reference: string | null; note: string; created_at: string; status: "pending" | "verified" | "rejected" | "answered"; decision_id?: string | null; response: string | null; payment_id: string | null; reviewed_at: string | null }
export interface FeePaymentSettings { payee_name: string; upi_id: string; instructions: string; revision: number }
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
