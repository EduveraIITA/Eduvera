import { api } from "../lib/api";

export interface Person { id: string; first_name: string; last_name: string; email: string }
export interface Student extends Person { admission_number: string; date_of_birth: string | null; onboarding_pending: boolean }
export interface Term { id: string; name: string; academic_year: string; starts_on: string; ends_on: string; attendance_threshold: string; is_active: boolean }
export interface Section { id: string; grade: string; section: string; academic_year: string; room_number: string; board: string }
export interface Subject { id: string; code: string; name: string; short_name: string }
export interface Member extends Person { user_id: string; role: string; is_active: boolean }
export interface Invitation { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }
export interface Administration {
  school: { id: string; name: string; code: string };
  students: Student[]; terms: Term[]; classes: Section[]; subjects: Subject[]; members: Member[];
  guardians: Array<Person & { student_id: string; relationship: string; phone: string }>;
  enrollments: Array<{ id: string; student_id: string; class_section_id: string; term_id: string; roll_number: number }>;
  audit: Array<Person & { action: string; created_at: string }>;
  invitations: Invitation[]; grants: Array<{ user_id: string; permission: string }>;
}
export type InvoiceCollectionState = "collectible" | "paid" | "credited" | "refund_due" | "partially_refunded" | "refunded";
export interface Invoice {
  id: string;
  student_id: string;
  reference: string;
  description: string;
  due_on: string;
  amount_paise: number;
  paid_paise: number;
  credited_paise: number;
  refunded_paise: number;
  adjusted_amount_paise: number;
  net_paid_paise: number;
  balance_paise: number;
  refund_due_paise: number;
  collection_state: InvoiceCollectionState;
  first_name: string;
  last_name: string;
  admission_number: string;
}
export interface Payment { id: string; invoice_id: string; amount_paise: number; method: string; reference: string; created_at: string }
export interface Fees { currency: string; invoices: Invoice[]; payments: Payment[]; online_payments_enabled: boolean }
export function invoiceStateLabel(invoice: Invoice, today: string): string {
  if (invoice.collection_state === "refund_due") return "Refund due";
  if (invoice.collection_state === "partially_refunded") return "Refund partly recorded";
  if (invoice.collection_state === "refunded") return "Refunded";
  if (invoice.collection_state === "credited") return "Credited";
  if (invoice.collection_state === "paid") return "Paid";
  return invoice.due_on < today ? "Overdue" : "Open";
}
export const canRecordInvoicePayment = (invoice: Invoice) => invoice.collection_state === "collectible" && invoice.balance_paise > 0;
export function feeLedgerSummary(invoices: Invoice[]) {
  return invoices.reduce((summary, invoice) => ({
    adjusted_paise: summary.adjusted_paise + invoice.adjusted_amount_paise,
    received_paise: summary.received_paise + invoice.paid_paise,
    outstanding_paise: summary.outstanding_paise + invoice.balance_paise,
    refund_due_paise: summary.refund_due_paise + invoice.refund_due_paise,
  }), { adjusted_paise: 0, received_paise: 0, outstanding_paise: 0, refund_due_paise: 0 });
}
export const schoolPath = (school: string, path: string) => `/api/v1/schools/${school}/${path}/`;
export const administration = (school: string) => api<Administration>(schoolPath(school, "administration"));
export const save = <T,>(school: string, path: string, body: unknown, method = "POST") => api<T>(schoolPath(school, path), { method, body: JSON.stringify(body) });
export const fullName = (person: { first_name: string; last_name: string }) => `${person.first_name} ${person.last_name}`;
export const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
