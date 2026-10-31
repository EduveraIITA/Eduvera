import { ApiError, apiFetch } from "../../lib/api";
import { feeLedgerReadSearch, type FeeLedger, type Invoice, type FeeLedgerReadOptions } from "./api";

export interface FeeBeneficiary {
  kind: "person" | "student"; person_id: string | null; name: string; student_id: string | null;
}
export interface PersonFeeInvoice extends Omit<Invoice, "student_id"> {
  student_id: string | null; person_id?: string | null; beneficiary: FeeBeneficiary;
}
export interface PersonFeeWorkspace extends Omit<FeeLedger, "invoices"> {
  invoices: PersonFeeInvoice[]; can_issue: boolean; today: string; timezone: string;
}
export interface FeeAccounts {
  school_id: string; today: string; timezone: string; can_issue: boolean;
  items: Array<{ kind: "person" | "student"; person_id: string | null; student_id: string | null; name: string; href: string }>;
}
export interface IssueCharge {
  command_id: string; invoice_id: string; beneficiary: { person_id: string; expected_revision: number };
  reference: string; description: string; amount_paise: number; due_on: string;
}
export interface FeeCommandConfirmation {
  state: "not_found" | "pending" | "accepted" | "not_accepted"; result?: { id: string; invoice_id?: string; revision?: number };
  handler?: string; source_id?: string | null; command_id?: string; invoice_id?: string; action?: string | null;
}
const base = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
export const getPersonFeeWorkspace = (schoolId: string, personId?: string, options: FeeLedgerReadOptions = {}) => {
  const search = feeLedgerReadSearch(options); if (personId) search.set("person_id", personId);
  return apiFetch<PersonFeeWorkspace>(`${base(schoolId)}/workspace/${search.size ? `?${search}` : ""}`);
};
export const getFeeAccounts = (schoolId: string) => apiFetch<FeeAccounts>(`${base(schoolId)}/accounts/`);
export const issuePersonCharge = async (schoolId: string, body: IssueCharge) => {
  const result = await apiFetch<{ id: string; invoice_id: string; revision: number; replayed: boolean }>(`${base(schoolId)}/invoices/`, { method: "POST", body: JSON.stringify(body) });
  if (!result || result.id !== body.invoice_id || result.invoice_id !== body.invoice_id || result.revision !== 1 || typeof result.replayed !== "boolean")
    throw new ApiError("The server did not return this charge’s exact result. Check the result before continuing.", 200);
  return result;
};
export const confirmIssuedCharge = async (schoolId: string, invoiceId: string, commandId: string) => {
  const confirmation = await apiFetch<FeeCommandConfirmation>(`${base(schoolId)}/invoices/${encodeURIComponent(invoiceId)}/confirmation/?command_id=${encodeURIComponent(commandId)}`);
  if (confirmation.handler !== "finance.charge" || confirmation.source_id !== invoiceId || confirmation.command_id !== commandId || confirmation.action !== "issue"
    || confirmation.state === "accepted" && (confirmation.result?.id !== invoiceId || confirmation.result.invoice_id !== invoiceId)) throw new ApiError("This result does not match the charge being checked.", 409);
  return confirmation;
};
export const personFeeAccountHref = (personId: string, invoiceId?: string) => `/areas/fees/account?${new URLSearchParams({ scope: "person", person_id: personId, ...(invoiceId ? { invoice_id: invoiceId } : {}) })}`;
export const feeReadDenied = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
