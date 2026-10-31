import { ApiError, apiFetch } from "../../lib/api";
import type { FeeCommandConfirmation } from "./personFeesApi";

export type FeeGroupKind = "participation" | "class" | "organization" | "learning";
export interface FeeAudienceSelection { person_ids: string[]; groups: Array<{ kind: FeeGroupKind; id: string }> }
export interface FeeAudiencePerson { id: string; label: string; revision: number }
export interface FeeAudienceGroup { kind: FeeGroupKind; id: string; name: string; member_count: number }
export interface FeeAudiencePage<T> { results: T[]; page: number; page_size: 25; total: number; can_add_people: boolean }
export interface FeeAudiencePreview {
  snapshot_hash: string; today: string; people: Array<{ person_id: string; name: string; revision: number }>;
  groups: FeeAudienceGroup[]; person_count: number; duplicate_count: number;
}
export interface FeeBatchIssue {
  command_id: string; batch_id: string; selection: FeeAudienceSelection; snapshot_hash: string;
  reference: string; description: string; amount_paise: number; due_on: string;
}
export interface FeeBatchResult {
  id: string; batch_id: string; reference: string; description: string; amount_paise: number; due_on: string;
  person_count: number; total_amount_paise: number; revision: 1; replayed: boolean;
  invoices: Array<{ person_id: string; invoice_id: string; reference: string; name: string }>;
}
const base = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
export const getFeeChargeAudience = <T extends "people" | "groups">(schoolId: string, kind: T, search = "", page = 1) =>
  apiFetch<FeeAudiencePage<T extends "people" ? FeeAudiencePerson : FeeAudienceGroup>>(`${base(schoolId)}/charge-audience/?${new URLSearchParams({ kind, search, page: String(page) })}`);
export const previewFeeChargeAudience = async (schoolId: string, selection: FeeAudienceSelection) => {
  const preview = await apiFetch<FeeAudiencePreview>(`${base(schoolId)}/charge-audience/preview/`, { method: "POST", body: JSON.stringify({ selection }) });
  const people = Array.isArray(preview?.people) ? preview.people : [], groups = Array.isArray(preview?.groups) ? preview.groups : [];
  if (!preview || !/^[a-f0-9]{64}$/.test(preview.snapshot_hash) || !/^\d{4}-\d{2}-\d{2}$/.test(preview.today)
    || !Number.isSafeInteger(preview.person_count) || preview.person_count < 1 || preview.person_count > 500 || people.length !== preview.person_count
    || new Set(people.map(person => person.person_id)).size !== people.length
    || people.some((person, index) => typeof person.person_id !== "string" || !person.person_id || typeof person.name !== "string" || !Number.isSafeInteger(person.revision) || person.revision < 1 || index > 0 && person.person_id <= people[index - 1]!.person_id)
    || selection.person_ids.some(id => !people.some(person => person.person_id === id)) || groups.length !== selection.groups.length
    || selection.groups.some(group => !groups.some(item => item.kind === group.kind && item.id === group.id))
    || !Number.isSafeInteger(preview.duplicate_count) || preview.duplicate_count < 0)
    throw new ApiError("The selected people could not be confirmed. Review the selection again.", 200);
  return preview;
};

/** Never interpret a malformed financial result as accepted or select its first invoice. */
function checkedBatch(value: FeeBatchResult, batchId: string, expected?: { issue: Omit<FeeBatchIssue, "command_id">; preview: FeeAudiencePreview }) {
  const invoices = Array.isArray(value?.invoices) ? value.invoices : [];
  const count = value?.person_count;
  const valid = value && value.id === batchId && value.batch_id === batchId && value.revision === 1 && typeof value.replayed === "boolean"
    && Number.isSafeInteger(count) && count >= 1 && count <= 500 && invoices.length === count
    && Number.isSafeInteger(value.amount_paise) && value.amount_paise > 0 && value.amount_paise <= 100_000_000
    && value.total_amount_paise === count * value.amount_paise && typeof value.reference === "string" && value.reference.length > 0
    && new Set(invoices.map(item => item.person_id)).size === count && new Set(invoices.map(item => item.invoice_id)).size === count
    && invoices.every((item, index) => typeof item.person_id === "string" && item.person_id.length > 0 && (index === 0 || item.person_id > invoices[index - 1]!.person_id) && typeof item.invoice_id === "string" && item.invoice_id.length > 0
      && typeof item.name === "string" && item.reference === `${value.reference}/${String(index + 1).padStart(3, "0")}`
      && (!expected || item.person_id === expected.preview.people[index]?.person_id && item.name === expected.preview.people[index]?.name));
  if (!valid || expected && (count !== expected.preview.person_count || value.reference !== expected.issue.reference || value.description !== expected.issue.description
    || value.amount_paise !== expected.issue.amount_paise || value.due_on !== expected.issue.due_on)) throw new ApiError("The result does not match the reviewed charges. Check the exact result before continuing.", 200);
  return value;
}
export async function issueFeeChargeBatch(schoolId: string, issue: FeeBatchIssue, preview: FeeAudiencePreview) {
  return checkedBatch(await apiFetch<FeeBatchResult>(`${base(schoolId)}/charge-batches/`, { method: "POST", body: JSON.stringify(issue) }), issue.batch_id, { issue, preview });
}
export async function getFeeChargeBatch(schoolId: string, batchId: string) {
  return checkedBatch(await apiFetch<FeeBatchResult>(`${base(schoolId)}/charge-batches/${encodeURIComponent(batchId)}/`), batchId);
}
export async function confirmFeeChargeBatch(schoolId: string, issue: Omit<FeeBatchIssue, "command_id">, preview: FeeAudiencePreview, commandId: string) {
  const confirmation = await apiFetch<Omit<FeeCommandConfirmation, "result"> & { result?: FeeBatchResult }>(`${base(schoolId)}/charge-batches/${encodeURIComponent(issue.batch_id)}/confirmation/?command_id=${encodeURIComponent(commandId)}`);
  if (!confirmation || confirmation.handler !== "finance.charge_batch" || confirmation.source_id !== issue.batch_id || confirmation.command_id !== commandId || confirmation.action !== "issue")
    throw new ApiError("This result does not match the charges being checked.", 409);
  if (confirmation.state === "accepted") {
    if (!confirmation.result) throw new ApiError("The accepted charge result is incomplete. Keep this screen to check again.", 200);
    checkedBatch(confirmation.result, issue.batch_id, { issue, preview });
  }
  return confirmation;
}
