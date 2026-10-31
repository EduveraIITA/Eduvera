import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { FeeChargeCorrectionDialog } from "./FeeChargeCorrectionDialog";
import { FeePaymentCorrectionDialog } from "./FeePaymentCorrectionDialog";
import { FeeCorrectionRecipients } from "./FeeCorrectionRecipients";
import { PersonFeeInvoiceDetail } from "./PersonFeesAccount";
import { PersonFeesLedger } from "./PersonFeesLedger";
import { FinanceResponsibilityWorkspace } from "./FeeLedgerPage";
import { FamilyReceiptDetail } from "./FamilyFeeRecords";
import { FamilyFeePrint } from "./FamilyFeePrint";
import { FamilyFeeOverview } from "./FamilyFeeOverview";
import type { PersonFeeInvoice } from "./personFeesApi";
import type { Payment } from "./api";
import type { ChargeCorrectionApply, ChargeCorrectionPreviewInput, ChargeCorrectionQuote, PaymentCorrectionApply, PaymentCorrectionPreviewInput, PaymentCorrectionQuote } from "./feeCorrectionsApi";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator", active_school_id: "school" }, memberships: [{ school_id: "school", school_name: "Riverview", permissions: ["fees.manage"] }] }) }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose}>Close</button>{children}</section> }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./NativeFeeReviewsPanel", () => ({ NativeFeeReviewsPanel: () => <section>Payment reports</section> }));
vi.mock("./FinanceArrangementsPanel", () => ({ FinanceArrangementsPanel: () => <section>Payment plans</section> }));
const close = vi.fn(), reload = vi.fn();
const invoice = (index = 1): PersonFeeInvoice => ({ id: `invoice-${index}`, student_id: null, first_name: "Sana", last_name: String(index), admission_number: "", beneficiary: { kind: "person", person_id: `person-${index}`, student_id: null, name: `Sana ${index}` }, reference: `RV-${index}`, description: "Workshop", due_on: "2026-10-23", amount_paise: 10_000, paid_paise: 2_000, adjusted_amount_paise: 10_000, balance_paise: 8_000, refund_due_paise: 0, collection_state: "collectible", can_correct: true });
const payment: Payment = { id: "payment-a", invoice_id: "invoice-1", amount_paise: 2_000, method: "bank_transfer", reference: "OLD", created_at: "2026-10-23T10:00:00Z", status: "active", can_reverse: true, can_replace: true };
const before = { amount_paise: 10_000, description: "Workshop", due_on: "2026-10-23", charge_state: "active" as const, paid_paise: 2_000, balance_paise: 8_000, credit_paise: 0 };
function chargeQuote(input: ChargeCorrectionPreviewInput, hash = "a"): ChargeCorrectionQuote {
  const items = input.selection.invoice_ids.map(id => { const amount = input.change.kind === "cancel" ? 0 : input.change.amount_paise ?? before.amount_paise;
    return { invoice_id: id, person_id: id.replace("invoice", "person"), student_id: null, name: `Sana ${id.split("-")[1]}`, reference: id.replace("invoice", "RV"), revision: 0, before,
      after: { ...before, amount_paise: amount, description: input.change.kind === "amend" ? input.change.description ?? before.description : before.description, due_on: input.change.kind === "amend" ? input.change.due_on ?? before.due_on : before.due_on, charge_state: input.change.kind === "cancel" ? "cancelled" as const : "active" as const, balance_paise: Math.max(0, amount - before.paid_paise), credit_paise: Math.max(0, before.paid_paise - amount) } }; });
  return { snapshot_hash: hash.repeat(64), today: "2026-10-23", items, person_count: items.length, before_total_amount_paise: items.reduce((sum, item) => sum + item.before.amount_paise, 0), after_total_amount_paise: items.reduce((sum, item) => sum + item.after.amount_paise, 0), before_balance_paise: items.reduce((sum, item) => sum + item.before.balance_paise, 0), after_balance_paise: items.reduce((sum, item) => sum + item.after.balance_paise, 0), credit_paise: items.reduce((sum, item) => sum + item.after.credit_paise, 0) };
}
const paymentQuote = (input: PaymentCorrectionPreviewInput): PaymentCorrectionQuote => ({ snapshot_hash: "b".repeat(64), today: "2026-10-23", invoice_id: payment.invoice_id, payment_id: payment.id, reference: payment.reference, amount_paise: payment.amount_paise, method: payment.method, before, after: { ...before, paid_paise: input.action === "replace" ? input.replacement.amount_paise : 0, balance_paise: input.action === "replace" ? before.amount_paise - input.replacement.amount_paise : before.amount_paise }, can_reverse: true, can_replace: true });
const parse = (init?: RequestInit) => JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
let sentCharge: ChargeCorrectionApply | undefined, sentPayment: PaymentCorrectionApply | undefined;
const chargeResult = (input: ChargeCorrectionApply) => ({ id: input.correction_id, correction_id: input.correction_id, invoice_ids: input.selection.invoice_ids, revision: 1, replayed: false });
const paymentResult = (input: PaymentCorrectionApply) => ({ id: input.correction_id, correction_id: input.correction_id, invoice_id: payment.invoice_id, payment_id: payment.id, replacement_payment_id: input.action === "replace" ? "payment-b" : null, action: input.action, revision: 1, replayed: false });
function mount(content: ReactNode, route = "/areas/fees/ledger") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><ExecutionEnvironmentProvider environment={{ mode: "live" }}>{content}</ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>); return client;
}
async function readyCharge() { const user = userEvent.setup(); mount(<FeeChargeCorrectionDialog schoolId="school" invoices={[invoice()]} onClose={close} onReload={reload} />); await user.type(screen.getByLabelText("Correct amount (₹)"), "80"); await user.type(screen.getByLabelText("Reason"), "Wrong amount recorded"); await user.click(screen.getByRole("button", { name: "Review correction" })); await screen.findByRole("checkbox", { name: /not a concession/ }); return user; }
beforeEach(() => {
  sentCharge = undefined; sentPayment = undefined; reload.mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockImplementation((path, init) => {
    if (path.includes("/corrections/preview/")) return Promise.resolve(chargeQuote(parse(init) as unknown as ChargeCorrectionPreviewInput));
    if (path.includes("/correction-preview/")) return Promise.resolve(paymentQuote(parse(init) as PaymentCorrectionPreviewInput));
    if (path.includes("/payments/") && path.endsWith("/corrections/")) { sentPayment = parse(init) as PaymentCorrectionApply; return Promise.resolve(paymentResult(sentPayment)); }
    if (path.endsWith("/fees/corrections/")) { sentCharge = parse(init) as unknown as ChargeCorrectionApply; return Promise.resolve(chargeResult(sentCharge)); }
    if (path.includes("/fees/students/")) return Promise.resolve({ results: [{ id: "student", first_name: "Sana", last_name: "1", admission_number: "S1" }] });
    if (path.includes("/fees/workspace/")) return Promise.resolve({ today: "2026-10-23", timezone: "UTC", can_issue: true, currency: "INR", invoices: [invoice()], payments: [payment] });
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("recording-error correction flows", () => {
  it("closes an untouched single-charge shortcut without a discard prompt", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false), user = userEvent.setup(); mount(<FeeChargeCorrectionDialog schoolId="school" invoices={[invoice()]} onClose={close} onReload={reload} />);
    await user.click(screen.getByRole("button", { name: "Cancel" })); expect(confirm).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(apiFetch).not.toHaveBeenCalled();
  });
  it.each(["reason", "amount", "kind", "selection"])("retains the discard guard after changing %s", async field => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false), user = userEvent.setup(); mount(<FeeChargeCorrectionDialog schoolId="school" invoices={field === "selection" ? [invoice(), invoice(2)] : [invoice()]} onClose={close} onReload={reload} />);
    if (field === "reason") await user.type(screen.getByLabelText("Reason"), "Wrong amount");
    if (field === "amount") await user.type(screen.getByLabelText("Correct amount (₹)"), "80");
    if (field === "kind") await user.selectOptions(screen.getByLabelText("Correction"), "cancel");
    if (field === "selection") await user.click(screen.getByRole("checkbox", { name: /Sana 2/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" })); expect(confirm).toHaveBeenCalledWith("Discard this unsent correction?"); expect(close).not.toHaveBeenCalled(); expect(apiFetch).not.toHaveBeenCalled();
  });
  it("reviews one selected charge from the retained collection before one atomic correction", async () => {
    const user = userEvent.setup(); mount(<FeeChargeCorrectionDialog schoolId="school" invoices={[invoice(), invoice(2)]} batchId="batch" onClose={close} onReload={reload} />);
    await user.click(screen.getByRole("checkbox", { name: /Sana 2/ })); await user.type(screen.getByLabelText("Correct amount (₹)"), "80"); await user.type(screen.getByLabelText("Reason"), "Wrong amount recorded"); await user.click(screen.getByRole("button", { name: "Review correction" }));
    expect(await screen.findByText("1 charge · 1 person")).toBeVisible(); expect(sentCharge).toBeUndefined(); expect(screen.getByRole("button", { name: "Record correction" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /not a concession/ })); await user.click(screen.getByRole("button", { name: "Record correction" })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(sentCharge).toMatchObject({ selection: { invoice_ids: ["invoice-2"], batch_id: "batch" }, change: { kind: "amend", amount_paise: 8_000 }, attested_recording_error: true, reason: "Wrong amount recorded" });
  });
  it("keeps charge selections across finite pages and search without fetching current group members", async () => {
    function Harness() { const [selected, setSelected] = useState<string[]>([]); return <form className="person-fee-form"><FeeCorrectionRecipients invoices={Array.from({ length: 12 }, (_, index) => invoice(index + 1))} selected={selected} onChange={setSelected} /></form>; }
    const user = userEvent.setup(); mount(<Harness />); await user.click(screen.getByRole("checkbox", { name: /Sana 1 RV-1$/ })); await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("checkbox", { name: /Sana 11/ })); await user.type(screen.getByLabelText("Find a charge"), "Sana 2"); expect(screen.getByText("2 selected")).toBeVisible(); expect(apiFetch).not.toHaveBeenCalled();
  });
  it("keeps an accepted correction locked on refresh failure without posting again", async () => {
    reload.mockRejectedValueOnce(new Error("Refresh failed")).mockResolvedValue(undefined); const user = await readyCharge(); await user.click(screen.getByRole("checkbox", { name: /not a concession/ })); await user.click(screen.getByRole("button", { name: "Record correction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved. Refresh"); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled(); await user.click(screen.getByRole("button", { name: "Check result" })); await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith("/fees/corrections/"))).toHaveLength(1);
  });
  it("keeps an unknown correction locked when a lookup belongs to another source", async () => {
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.includes("/corrections/preview/")) return Promise.resolve(chargeQuote(parse(init) as unknown as ChargeCorrectionPreviewInput));
      if (path.endsWith("/fees/corrections/")) { sentCharge = parse(init) as unknown as ChargeCorrectionApply; return Promise.reject(new Error("Connection lost")); }
      return Promise.resolve({ handler: "finance.charge_correction", source_id: "another-correction", command_id: sentCharge!.command_id, action: "apply", state: "accepted", result: chargeResult(sentCharge!) });
    });
    const user = await readyCharge(); await user.click(screen.getByRole("checkbox", { name: /not a concession/ })); await user.click(screen.getByRole("button", { name: "Record correction" })); await user.click(await screen.findByRole("button", { name: "Check result" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not belong"); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled(); expect(close).not.toHaveBeenCalled();
  });
  it("keeps an unknown correction locked through a stale retry until terminal rejection", async () => {
    let writes = 0, checks = 0;
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.includes("/corrections/preview/")) return Promise.resolve(chargeQuote(parse(init) as unknown as ChargeCorrectionPreviewInput, writes >= 2 ? "b" : "a"));
      if (path.endsWith("/fees/corrections/")) { sentCharge = parse(init) as unknown as ChargeCorrectionApply; if (++writes === 1) return Promise.reject(new Error("Connection lost")); if (writes === 2) return Promise.reject(new ApiError("Current charges changed", 400)); return Promise.resolve(chargeResult(sentCharge)); }
      return Promise.resolve({ handler: "finance.charge_correction", source_id: sentCharge!.correction_id, command_id: sentCharge!.command_id, action: "apply", state: ++checks === 1 ? "not_found" : "not_accepted" });
    });
    const user = await readyCharge(); await user.click(screen.getByRole("checkbox", { name: /not a concession/ })); await user.click(screen.getByRole("button", { name: "Record correction" })); const original = sentCharge;
    await user.click(await screen.findByRole("button", { name: "Check result" })); await user.click(screen.getByRole("button", { name: "Retry same action" })); expect(await screen.findByRole("alert")).toHaveTextContent("Current charges changed"); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled(); expect(sentCharge).toEqual(original);
    await user.click(screen.getByRole("button", { name: "Check result" })); await user.click(await screen.findByRole("button", { name: "Review current charges" })); expect(screen.getByLabelText("Reason")).toHaveValue("Wrong amount recorded"); expect(screen.getByLabelText("Correct amount (₹)")).toHaveValue("80");
    await user.click(screen.getByRole("button", { name: "Review correction" })); await user.click(await screen.findByRole("checkbox", { name: /not a concession/ })); await user.click(screen.getByRole("button", { name: "Record correction" })); await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(sentCharge?.command_id).not.toBe(original?.command_id); expect(sentCharge?.snapshot_hash).toBe("b".repeat(64));
  });
  it("requires independently verified funds when replacing a receipt", async () => {
    const user = userEvent.setup(); mount(<FeePaymentCorrectionDialog schoolId="school" payment={payment} onClose={close} onReload={reload} />); await user.selectOptions(screen.getByLabelText("Correction"), "replace"); await user.clear(screen.getByLabelText("Verified amount (₹)")); await user.type(screen.getByLabelText("Verified amount (₹)"), "10"); await user.type(screen.getByLabelText("Payment reference"), "NEW"); await user.type(screen.getByLabelText("Reason"), "Wrong receipt amount"); await user.click(screen.getByRole("button", { name: "Review correction" }));
    await user.click(await screen.findByRole("checkbox", { name: /not a refund/ })); expect(screen.getByRole("button", { name: "Record correction" })).toBeDisabled(); expect(sentPayment).toBeUndefined(); await user.click(screen.getByRole("checkbox", { name: /independently verified/ })); await user.click(screen.getByRole("button", { name: "Record correction" })); await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(sentPayment).toMatchObject({ action: "replace", replacement: { amount_paise: 1_000, reference: "NEW", method: "bank_transfer" }, verified_funds: true });
  });
  it("does not offer replacement without the explicit source capability", () => {
    mount(<FeePaymentCorrectionDialog schoolId="school" payment={{ ...payment, can_replace: false }} onClose={close} onReload={reload} />); expect(screen.getByRole("option", { name: "Reverse and replace" })).toBeDisabled();
  });
  it("does not permit a new correction in a stopped Simulation", () => {
    render(<MemoryRouter><ExecutionEnvironmentProvider environment={{ mode: "simulation", namespaceId: "world", runId: "run", runStatus: "stopped", virtualClock: { now: "2026-10-23T10:00:00Z", timeZone: "Asia/Kolkata" } }}><FeeChargeCorrectionDialog schoolId="school" invoices={[invoice()]} onClose={close} onReload={reload} /></ExecutionEnvironmentProvider></MemoryRouter>);
    expect(screen.getByLabelText("Correct amount (₹)")).toBeDisabled(); expect(screen.getByRole("button", { name: "Review correction" })).toBeDisabled(); expect(apiFetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("offers charge corrections only in the manager context with current source permission (permitted=%s)", permitted => {
    mount(<PersonFeeInvoiceDetail schoolId="school" invoice={{ ...invoice(), can_correct: permitted }} payments={[]} onReload={reload} allowCorrections />); expect(Boolean(screen.queryByRole("button", { name: "Correct charge" }))).toBe(permitted);
  });
  it("does not add correction powers to payer views even if an operator opens their own account", () => {
    mount(<PersonFeeInvoiceDetail schoolId="school" invoice={invoice()} payments={[]} onReload={reload} />); expect(screen.queryByRole("button", { name: "Correct charge" })).not.toBeInTheDocument();
  });
  it("keeps an open correction on transient read failure and removes private data after revocation", async () => {
    const user = userEvent.setup(), client = mount(<PersonFeesLedger />, "/areas/fees/ledger?invoice_id=invoice-1"); await user.click(await screen.findByRole("button", { name: "Correct charge" })); await user.type(screen.getByLabelText("Reason"), "Wrong amount recorded");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Temporarily unavailable", 503)); await act(async () => { await client.refetchQueries(); }); expect(screen.getByLabelText("Reason")).toHaveValue("Wrong amount recorded");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Access ended", 403)); await act(async () => { await client.refetchQueries(); }); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(screen.queryByText("Workshop")).not.toBeInTheDocument();
  });
  it("offers the same correction dialog from the retained student Finance ledger", async () => {
    const user = userEvent.setup(); mount(<FinanceResponsibilityWorkspace />, "/areas/fees/ledger?student_id=student"); await user.click(await screen.findByRole("button", { name: "Correct charge" })); expect(screen.getByRole("dialog", { name: "Correct charge" })).toBeVisible(); expect(screen.getByLabelText("Correct amount (₹)")).toBeVisible();
  });
  it("offers receipt correction from the retained student receipt register", async () => {
    const user = userEvent.setup(); mount(<FinanceResponsibilityWorkspace />, "/areas/fees/ledger?student_id=student&view=receipts"); await user.click(await screen.findByRole("button", { name: "Correct receipt" })); expect(screen.getByRole("dialog", { name: "Correct receipt" })).toBeVisible();
  });
});

describe("read-only financial correction history", () => {
  it("keeps original and replacement receipts visibly linked without a mutation action", () => {
    mount(<FamilyReceiptDetail payment={{ ...payment, status: "replaced", replacement_payment_id: "payment-b", correction_reason: "Wrong amount recorded" }} receiptHref={id => `/receipt/${id}`} />); expect(screen.getByText("Receipt replaced")).toBeVisible(); expect(screen.getByRole("link", { name: "View replacement receipt" })).toHaveAttribute("href", "/receipt/payment-b"); expect(screen.queryByRole("button", { name: "Correct receipt" })).not.toBeInTheDocument();
  });
  it("prints reversed status and excludes reversed money from Paid to date", () => {
    const old = { ...payment, status: "reversed" as const }, current = { ...payment, id: "payment-b", amount_paise: 1_000, replaces_payment_id: payment.id }, ledger = { currency: "INR" as const, invoices: [], payments: [old, current], online_payments_enabled: false };
    mount(<><FamilyFeeOverview ledger={ledger} canPay={false} payHref="/pay" /><FamilyFeePrint schoolName="Riverview" ledger={ledger} view="receipts" /></>);
    expect(screen.getByText("Paid to date").parentElement).toHaveTextContent("₹10.00"); const printed = document.querySelector<HTMLElement>(".family-fee-print-document"); expect(printed).not.toBeNull(); expect(within(printed!).getByText("Receipt reversed")).toBeInTheDocument(); expect(within(printed!).getByText("This is a replacement receipt.")).toBeInTheDocument();
  });
});
