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
export interface FeeStudent { id: string; admission_number: string; first_name: string; last_name: string }
export interface Invoice extends FeeStudent {
  id: string; student_id: string; reference: string; description: string; due_on: string;
  amount_paise: number; paid_paise: number; adjusted_amount_paise: number; balance_paise: number;
  refund_due_paise: number; collection_state: "collectible" | "paid" | "credited" | "refund_due" | "partially_refunded" | "refunded";
}
export interface Payment { id: string; invoice_id: string; amount_paise: number; method: string; reference: string; created_at: string }
export interface FeeLedger { currency: "INR"; invoices: Invoice[]; payments: Payment[]; online_payments_enabled: boolean }

const schoolPath = (schoolId: string, path: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/${path}/`;
export const getAdministration = (schoolId: string) => apiFetch<Administration>(schoolPath(schoolId, "administration"));
export type CatalogKind = "terms" | "classes" | "subjects";
export type CatalogMutation = Record<string, unknown> & { expected_revision?: number; confirmed?: boolean; change_reason?: string };
export const saveCatalog = (schoolId: string, kind: CatalogKind, values: CatalogMutation, id?: string) => apiFetch<Term | ClassSection | Subject>(schoolPath(schoolId, `catalog/${kind}${id ? `/${id}` : ""}`), { method: id ? "PATCH" : "POST", body: JSON.stringify(values) });
export const createInvitation = (schoolId: string, values: { email: string; role: string }) => apiFetch<{ token: string; expires_at: string }>(schoolPath(schoolId, "invitations"), { method: "POST", body: JSON.stringify(values) });
export const revokeInvitation = (schoolId: string, id: string) => apiFetch(schoolPath(schoolId, `invitations/${id}/revoke`), { method: "POST", body: "{}" });
export const updateMember = (schoolId: string, id: string, values: { is_active: boolean; permissions: string[] }) => apiFetch(schoolPath(schoolId, `members/${id}`), { method: "PATCH", body: JSON.stringify(values) });
export const createSchool = (values: { name: string; code: string }) => apiFetch<{ id: string }>("/api/v1/schools/", { method: "POST", body: JSON.stringify(values) });
export const selectActiveSchool = (schoolId: string) => apiFetch("/api/v1/auth/active-school/", { method: "POST", body: JSON.stringify({ school_id: schoolId }) });
export const promoteClass = (schoolId: string, values: { source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }>; confirm: boolean }) => apiFetch<{ count: number; confirmed: boolean }>(schoolPath(schoolId, "rollover"), { method: "POST", body: JSON.stringify(values) });
export const getFeeStudents = (schoolId: string) => apiFetch<{ results: FeeStudent[] }>(schoolPath(schoolId, "fees/students"));
export const getFeeLedger = (schoolId: string, studentId?: string) => apiFetch<FeeLedger>(`${schoolPath(schoolId, "fees")}${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`);
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
