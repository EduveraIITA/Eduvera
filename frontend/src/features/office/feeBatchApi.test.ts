import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { confirmFeeChargeBatch, getFeeChargeBatch, issueFeeChargeBatch, previewFeeChargeAudience, type FeeAudiencePreview, type FeeBatchIssue, type FeeBatchResult } from "./feeBatchApi";
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
const preview: FeeAudiencePreview = { snapshot_hash: "a".repeat(64), today: "2026-10-23", person_count: 2, duplicate_count: 0, groups: [], people: [{ person_id: "a", name: "Sana", revision: 1 }, { person_id: "b", name: "Riya", revision: 2 }] };
const issue: FeeBatchIssue = { command_id: "command", batch_id: "batch", selection: { person_ids: ["a", "b"], groups: [] }, snapshot_hash: preview.snapshot_hash, reference: "RV-001", description: "Workshop", amount_paise: 50_000, due_on: "2026-11-01" };
const accepted: FeeBatchResult = { id: "batch", batch_id: "batch", reference: issue.reference, description: issue.description, amount_paise: issue.amount_paise, due_on: issue.due_on, person_count: 2, total_amount_paise: 100_000, revision: 1, replayed: false,
  invoices: [{ person_id: "a", invoice_id: "invoice-a", reference: "RV-001/001", name: "Sana" }, { person_id: "b", invoice_id: "invoice-b", reference: "RV-001/002", name: "Riya" }] };
const confirmation = (result = accepted) => ({ handler: "finance.charge_batch", source_id: "batch", command_id: "command", action: "issue", state: "accepted", result });
beforeEach(() => { vi.resetAllMocks(); });
describe("reviewed atomic charge API boundaries", () => {
  it("sends one batch command for the exact reviewed people and resolves its full manifest", async () => {
    vi.mocked(apiFetch).mockResolvedValue(accepted); expect(await issueFeeChargeBatch("school", issue, preview)).toEqual(accepted);
    expect(apiFetch).toHaveBeenCalledOnce(); expect(apiFetch).toHaveBeenCalledWith("/api/v1/schools/school/fees/charge-batches/", { method: "POST", body: JSON.stringify(issue) });
  });
  it.each(["handler", "source", "command", "action"])("rejects an accepted receipt bound to another %s", async field => {
    const wrong = { ...confirmation(), ...(field === "handler" ? { handler: "finance.charge" } : field === "source" ? { source_id: "other" } : field === "command" ? { command_id: "other" } : { action: "preview" }) };
    vi.mocked(apiFetch).mockResolvedValue(wrong); await expect(confirmFeeChargeBatch("school", issue, preview, "command")).rejects.toThrow("does not match");
  });
  it.each(["person", "order", "name", "reference", "invoice", "count", "amount", "description"])("rejects a same-batch accepted receipt with wrong %s mapping", async variant => {
    const copy = structuredClone(accepted);
    if (variant === "person") copy.invoices[1]!.person_id = "other";
    if (variant === "order") copy.invoices.reverse();
    if (variant === "name") copy.invoices[0]!.name = "Unreviewed name";
    if (variant === "reference") copy.invoices[1]!.reference = "RV-001/001";
    if (variant === "invoice") copy.invoices[1]!.invoice_id = copy.invoices[0]!.invoice_id;
    if (variant === "count") copy.person_count = 3;
    if (variant === "amount") copy.total_amount_paise = 50_000;
    if (variant === "description") copy.description = "Another charge";
    vi.mocked(apiFetch).mockResolvedValue(confirmation(copy)); await expect(confirmFeeChargeBatch("school", issue, preview, "command")).rejects.toThrow("does not match");
  });
  it("accepts an exact not-found lookup only as an exact-command recovery fact", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...confirmation(), state: "not_found", result: undefined }); expect((await confirmFeeChargeBatch("school", issue, preview, "command")).state).toBe("not_found");
  });
  it("loads a complete batch manifest without a selected first person", async () => {
    vi.mocked(apiFetch).mockResolvedValue(accepted); expect((await getFeeChargeBatch("school", "batch")).invoices).toHaveLength(2);
  });
  it("rejects an unordered manifest even when each suffix follows its array position", async () => {
    const copy = structuredClone(accepted); copy.invoices.reverse(); copy.invoices.forEach((invoice, index) => { invoice.reference = `${copy.reference}/${String(index + 1).padStart(3, "0")}`; });
    vi.mocked(apiFetch).mockResolvedValue(copy); await expect(getFeeChargeBatch("school", "batch")).rejects.toThrow("does not match");
  });
  it.each(["truncated", "unordered", "missing_direct"])("refuses an incomplete or %s audience preview", async variant => {
    const copy = structuredClone(preview);
    if (variant === "truncated") copy.people.pop();
    if (variant === "unordered") copy.people.reverse();
    if (variant === "missing_direct") copy.people[1]!.person_id = "z";
    vi.mocked(apiFetch).mockResolvedValue(copy); await expect(previewFeeChargeAudience("school", issue.selection)).rejects.toThrow("could not be confirmed");
  });
});
