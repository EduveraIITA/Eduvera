import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { applyChargeCorrection, confirmChargeCorrection, confirmPaymentCorrection, previewChargeCorrection, previewPaymentCorrection, type ChargeCorrectionApply, type ChargeCorrectionQuote, type PaymentCorrectionQuote, type PaymentCorrectionRetained } from "./feeCorrectionsApi";
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
const before = { amount_paise: 10_000, description: "Workshop", due_on: "2026-10-23", charge_state: "active" as const, paid_paise: 2_000, balance_paise: 8_000, credit_paise: 0 };
const quote: ChargeCorrectionQuote = { snapshot_hash: "a".repeat(64), today: "2026-10-23", person_count: 1, items: [{ invoice_id: "invoice-a", person_id: "person-a", student_id: null, name: "Sana", reference: "RV-001", revision: 0, before, after: { ...before, amount_paise: 8_000, balance_paise: 6_000 } }], before_total_amount_paise: 10_000, after_total_amount_paise: 8_000, before_balance_paise: 8_000, after_balance_paise: 6_000, credit_paise: 0 };
const issue: ChargeCorrectionApply = { command_id: "command", correction_id: "correction", selection: { invoice_ids: ["invoice-a"], batch_id: "batch" }, change: { kind: "amend", amount_paise: 8_000 }, snapshot_hash: quote.snapshot_hash, reason: "Wrong amount recorded", attested_recording_error: true };
const chargeResult = { id: "correction", correction_id: "correction", invoice_ids: ["invoice-a"], revision: 1, replayed: false };
const paymentQuote: PaymentCorrectionQuote = { snapshot_hash: "b".repeat(64), today: "2026-10-23", invoice_id: "invoice-a", payment_id: "payment-a", reference: "OLD", amount_paise: 2_000, method: "bank_transfer", before, after: { ...before, paid_paise: 1_000, balance_paise: 9_000 }, can_reverse: true, can_replace: true };
const payment: PaymentCorrectionRetained = { correction_id: "correction", action: "replace", replacement: { amount_paise: 1_000, method: "bank_transfer", reference: "NEW" }, snapshot_hash: paymentQuote.snapshot_hash, reason: "Wrong amount recorded", attested_recording_error: true, verified_funds: true };
const paymentResult = { id: "correction", correction_id: "correction", invoice_id: "invoice-a", payment_id: "payment-a", replacement_payment_id: "payment-b", action: "replace", revision: 1, replayed: false };
const receipt = (handler: string, result: unknown) => ({ handler, source_id: "correction", command_id: "command", action: "apply", state: "accepted", result });
beforeEach(() => { vi.resetAllMocks(); });
describe("exact financial correction boundaries", () => {
  it("accepts a fresh revision-zero quote and sends one atomic command for the reviewed selection", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(quote).mockResolvedValueOnce(chargeResult); expect(await previewChargeCorrection("school", issue)).toEqual(quote); expect(await applyChargeCorrection("school", issue)).toEqual(chargeResult);
    expect(apiFetch).toHaveBeenLastCalledWith("/api/v1/schools/school/fees/corrections/", { method: "POST", body: JSON.stringify(issue) });
  });
  it("counts two selected charges for one person without merging the liabilities", async () => {
    const two = { ...quote, items: [...quote.items, { ...quote.items[0]!, invoice_id: "invoice-b", reference: "RV-002" }], before_total_amount_paise: 20_000, after_total_amount_paise: 16_000, before_balance_paise: 16_000, after_balance_paise: 12_000 };
    vi.mocked(apiFetch).mockResolvedValue(two); expect((await previewChargeCorrection("school", { ...issue, selection: { invoice_ids: ["invoice-a", "invoice-b"] } })).person_count).toBe(1);
  });
  it.each(["source", "duplicate", "count", "before_total", "after_total", "balance", "credit", "change", "negative_revision"])("rejects an inconsistent %s quote", async variant => {
    const wrong = structuredClone(quote);
    if (variant === "source") wrong.items[0]!.invoice_id = "other";
    if (variant === "duplicate") wrong.items.push(wrong.items[0]!);
    if (variant === "count") wrong.person_count = 2;
    if (variant === "before_total") wrong.before_total_amount_paise++;
    if (variant === "after_total") wrong.after_total_amount_paise++;
    if (variant === "balance") wrong.after_balance_paise++;
    if (variant === "credit") wrong.credit_paise++;
    if (variant === "change") { wrong.items[0]!.after.amount_paise = 9_000; wrong.after_total_amount_paise = 9_000; }
    if (variant === "negative_revision") wrong.items[0]!.revision = -1;
    vi.mocked(apiFetch).mockResolvedValue(wrong); await expect(previewChargeCorrection("school", issue)).rejects.toThrow("does not match");
  });
  it.each(["handler", "source_id", "command_id", "action"])("rejects an accepted correction for a different %s", async field => {
    vi.mocked(apiFetch).mockResolvedValue({ ...receipt("finance.charge_correction", chargeResult), [field]: "other" }); await expect(confirmChargeCorrection("school", issue, "command")).rejects.toThrow("does not belong");
  });
  it("rejects a same-command receipt for an unrelated selected invoice", async () => {
    vi.mocked(apiFetch).mockResolvedValue(receipt("finance.charge_correction", { ...chargeResult, invoice_ids: ["other"] })); await expect(confirmChargeCorrection("school", issue, "command")).rejects.toThrow("does not match");
  });
  it.each(["payment_id", "invoice_id", "capability"])("rejects a receipt correction preview with wrong %s", async field => {
    vi.mocked(apiFetch).mockResolvedValue({ ...paymentQuote, ...(field === "capability" ? { can_replace: false } : { [field]: "other" }) }); await expect(previewPaymentCorrection("school", "payment-a", "invoice-a", payment)).rejects.toThrow("does not match");
  });
  it.each(["payment_id", "invoice_id", "action", "replacement_payment_id"])("rejects a payment correction receipt with wrong %s", async field => {
    vi.mocked(apiFetch).mockResolvedValue(receipt("finance.payment_correction", { ...paymentResult, [field]: field === "replacement_payment_id" ? "payment-a" : "other" })); await expect(confirmPaymentCorrection("school", payment, paymentQuote, "command")).rejects.toThrow("does not match");
  });
  it("accepts the exact terminal rejection only as a re-review recovery fact", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...receipt("finance.charge_correction", undefined), state: "not_accepted" }); expect((await confirmChargeCorrection("school", issue, "command")).state).toBe("not_accepted");
  });
});
