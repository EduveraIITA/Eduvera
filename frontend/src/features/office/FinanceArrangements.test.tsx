import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { FinanceArrangementsPanel } from "./FinanceArrangementsPanel";
import { decidePaymentPlan, enableInvoiceSelfPayer, getFinanceArrangements, requestPaymentPlan, withdrawPaymentPlan, type ArrangementInvoice, type FinanceArrangementsWorkspace } from "./financeArrangementsApi";

let actor = "guardian";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: actor, active_school_id: "school" }, memberships: [] }) }));
vi.mock("./FeeAuthoritySetup", () => ({ FeeAuthoritySetup: () => <p>Confirm existing Finance reviewer</p> }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button aria-label="Close" disabled={busy} onClick={onClose}>Close</button>{children}</section> }));
vi.mock("./financeArrangementsApi", () => ({ getFinanceArrangements: vi.fn(), requestPaymentPlan: vi.fn(), decidePaymentPlan: vi.fn(), withdrawPaymentPlan: vi.fn(), enableInvoiceSelfPayer: vi.fn(), revokeInvoiceSelfPayer: vi.fn() }));
const invoice: ArrangementInvoice = { id: "invoice", student_id: "learner", student_label: "Sana", reference: "F-001", description: "Course fees", original_due_on: "2026-10-20",
  balance_paise: 3_000_000, basis_hash: "a".repeat(64), basis_revision: 0, stream_revision: 0, can_request: true, can_enable_self_payer: false, can_revoke_self_payer: false,
  self_payer_account_available: true, self_payer: null, agreement: null, requests: [] };
const data = (change: Partial<ArrangementInvoice> = {}, manager = false): FinanceArrangementsWorkspace => ({ school_id: "school", today: "2026-10-23", timezone: "UTC", supported_mode: "approval_required",
  can_manage: manager, review_route: { state: "ready", reviewer: { user_id: "reviewer", label: "Imran" } }, invoices: [{ ...invoice, ...change }] });
const pending = { id: "request", revision: 1, status: "pending" as const, schedule: [{ amount_paise: 1_000_000, due_on: "2026-10-24" }, { amount_paise: 2_000_000, due_on: "2026-11-23" }],
  note: "Private explanation", submitted_at: "2026-10-23T09:00:00Z", decision_response: null, decision_at: null, reviewer: { user_id: "reviewer", label: "Imran" },
  route_state: "waiting_for_review" as const, basis_changed: false, can_decide: false, can_approve: false, can_withdraw: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function obsoleteError(body: object, requestId?: string) {
  const input = body as { command_id: string; expected_revision: number; request_id?: string };
  return new ApiError("The fee balance changed. Refresh and review.", 409, { error: { status: 409, code: "fee_arrangement_obsolete", fields: {
    fee_arrangement_obsolete: { confirmation: "permanently_inapplicable", invoice_id: "invoice", command_id: input.command_id,
      expected_revision: input.expected_revision, current_revision: input.expected_revision, reason: "ledger_basis_diverged", request_id: requestId ?? input.request_id },
  } } });
}
function mount(environment: ExecutionEnvironment = { mode: "live" }, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = (next: ExecutionEnvironment) => <QueryClientProvider client={client}><MemoryRouter><ExecutionEnvironmentProvider environment={next}><FinanceArrangementsPanel schoolId="school" studentId="learner" invoiceId="invoice" /></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>;
  const rendered = render(view(environment)); return { ...rendered, change: (next: ExecutionEnvironment) => rendered.rerender(view(next)) };
}
beforeEach(() => {
  actor = "guardian"; vi.mocked(getFinanceArrangements).mockResolvedValue(data());
  vi.mocked(requestPaymentPlan).mockResolvedValue({ id: "request", revision: 1, replayed: false });
  vi.mocked(decidePaymentPlan).mockResolvedValue({ id: "decision", revision: 2, replayed: false });
  vi.mocked(withdrawPaymentPlan).mockResolvedValue({ id: "withdrawal", revision: 2, replayed: false });
  vi.mocked(enableInvoiceSelfPayer).mockResolvedValue({ id: "entitlement", revision: 1, replayed: false });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("bounded payment-plan UI", () => {
  it.each(["guardian", "self", "manager"])("shows the real person and invoice identity on a %s payment-plan card", async audience => {
    actor=audience;vi.mocked(getFinanceArrangements).mockResolvedValue(data({},audience==="manager"));mount();
    expect(await screen.findByText("Sana · F-001")).toBeVisible();
  });
  it("retains the visible section heading for the embedded family panel", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Payment plans", level: 2 })).toBeVisible();
    expect(screen.getByRole("region", { name: "Payment plans" })).toBeVisible();
  });
  it("does not offer a proposal before a real Finance reviewer is available", async () => {
    vi.mocked(getFinanceArrangements).mockResolvedValue({ ...data(), review_route: { state: "unavailable", reviewer: null } }); mount();
    expect(await screen.findByText("Finance has not confirmed a reviewer yet. Contact Finance before sending a proposal.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Propose payment dates" })).not.toBeInTheDocument(); expect(screen.getByText("Course fees")).toBeVisible();
  });
  it("reviews arbitrary payment dates against the current balance without posting a payment", async () => {
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.clear(dialog.getByLabelText("Amount 1 (₹)")); await user.type(dialog.getByLabelText("Amount 1 (₹)"), "10000");
    fireEvent.change(dialog.getByLabelText("Date 1"), { target: { value: "2026-10-24" } });
    await user.click(dialog.getByRole("button", { name: "Add payment" }));
    await user.type(dialog.getByLabelText("Amount 2 (₹)"), "20000"); fireEvent.change(dialog.getByLabelText("Date 2"), { target: { value: "2026-11-23" } });
    await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    expect(dialog.getByText("For Imran to review.")).toBeVisible(); expect(requestPaymentPlan).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Send proposal" }));
    await waitFor(() => expect(requestPaymentPlan).toHaveBeenCalledOnce());
    expect(requestPaymentPlan).toHaveBeenCalledWith("school", "invoice", expect.objectContaining({ expected_revision: 0, basis_hash: "a".repeat(64),
      schedule: [{ amount_paise: 1_000_000, due_on: "2026-10-24" }, { amount_paise: 2_000_000, due_on: "2026-11-23" }] }));
  });
  it("allows one deferred payment but requires amounts to match before sending", async () => {
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.clear(dialog.getByLabelText("Amount 1 (₹)")); await user.type(dialog.getByLabelText("Amount 1 (₹)"), "12");
    await user.click(dialog.getByRole("button", { name: "Review", exact: true })); expect(dialog.getByRole("alert")).toHaveTextContent("add up");
    expect(requestPaymentPlan).not.toHaveBeenCalled();
  });
  it("shows named waiting and an explicit withdraw confirmation, without implying a receipt", async () => {
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ requests: [pending], stream_revision: 1, can_request: false }));
    const user = userEvent.setup(); mount(); expect(await screen.findByText("Waiting for Imran")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Withdraw proposal" }));
    expect(withdrawPaymentPlan).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw proposal" }));
    await waitFor(() => expect(withdrawPaymentPlan).toHaveBeenCalledWith("school", "request", expect.objectContaining({ expected_revision: 1 })));
  });
  it("makes changed ledger proposals decline-only and does not hide the current balance", async () => {
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ requests: [{ ...pending, can_decide: true, can_withdraw: false, basis_changed: true }], stream_revision: 1, can_request: false }, true));
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Review proposal" }));
    const dialog = within(screen.getByRole("dialog")); expect(dialog.getByLabelText("Approve dates")).toBeDisabled();
    await user.type(dialog.getByLabelText("Reason"), "The balance changed; send a fresh proposal."); await user.click(dialog.getByRole("button", { name: "Send decision" }));
    await waitFor(() => expect(decidePaymentPlan).toHaveBeenCalledWith("school", "request", expect.objectContaining({ decision: "rejected", expected_revision: 1 })));
  });
  it("requires explicit adult/self-payer attestation and finite dates, not a date-of-birth guess", async () => {
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ can_request: false, can_enable_self_payer: true }, true));
    const user = userEvent.setup(); mount(); await user.click(await screen.findByText("Learner self-service"));
    await user.click(screen.getByRole("button", { name: "Enable for learner" }));
    const dialog = within(screen.getByRole("dialog")); expect(dialog.queryByText(/birth/i)).not.toBeInTheDocument();
    expect(dialog.getByRole("checkbox")).toBeRequired(); expect(dialog.getByLabelText("Until")).toBeRequired();
    fireEvent.change(dialog.getByLabelText("Until"), { target: { value: "2026-12-31" } });
    await user.click(dialog.getByRole("checkbox")); await user.click(dialog.getByRole("button", { name: "Enable self-service" }));
    await waitFor(() => expect(enableInvoiceSelfPayer).toHaveBeenCalledWith("school", "invoice", expect.objectContaining({ attested_adult_self_payer: true, valid_until: "2026-12-31" })));
  });
  it("blocks a double send and retains an accepted-but-unrefreshed recovery without another mutation", async () => {
    const user = userEvent.setup(), write = deferred<{ id: string; revision: number; replayed: boolean }>();
    vi.mocked(requestPaymentPlan).mockReturnValue(write.promise);
    vi.mocked(getFinanceArrangements).mockResolvedValueOnce(data()).mockRejectedValue(new Error("Connection interrupted"));
    mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    await user.dblClick(dialog.getByRole("button", { name: "Send proposal" })); expect(requestPaymentPlan).toHaveBeenCalledOnce();
    expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    await act(async () => { write.resolve({ id: "request", revision: 1, replayed: false }); await write.promise; });
    expect(await dialog.findByRole("alert")).toHaveTextContent("Saved. Refresh");
    expect(dialog.queryByRole("button", { name: "Send proposal" })).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Refresh account" }));
    expect(requestPaymentPlan).toHaveBeenCalledOnce();
  });
  it("preserves proposed values after a known stale refusal", async () => {
    vi.mocked(requestPaymentPlan).mockImplementation((_school, _invoice, body) => Promise.reject(obsoleteError(body)));
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true })); await user.click(dialog.getByRole("button", { name: "Send proposal" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("balance changed");
    expect(dialog.getByRole("button", { name: "Send proposal" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Back" })); expect(dialog.getByLabelText("Amount 1 (₹)")).toHaveValue("30000.00");
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ balance_paise: 2_900_000, basis_hash: "b".repeat(64), basis_revision: 1 }));
    await user.click(dialog.getByRole("button", { name: "Refresh balance" }));
    expect(dialog.getByLabelText("Amount 1 (₹)")).toHaveValue("30000.00");
    await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    expect(dialog.getByRole("alert")).toHaveTextContent("add up");
    expect(requestPaymentPlan).toHaveBeenCalledOnce();
  });
  it("keeps an uncertain command locked through pending confirmation and retries only the exact retained payload after not-found", async () => {
    vi.mocked(requestPaymentPlan).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({ id: "request", revision: 1, replayed: true });
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    await user.click(dialog.getByRole("button", { name: "Send proposal" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    vi.mocked(getFinanceArrangements).mockResolvedValue({ ...data(), confirmation: { state: "pending" } });
    await user.click(dialog.getByRole("button", { name: "Refresh account" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled(); expect(requestPaymentPlan).toHaveBeenCalledOnce();
    const original = vi.mocked(requestPaymentPlan).mock.calls[0]!;
    expect(getFinanceArrangements).toHaveBeenLastCalledWith("school", "learner", "invoice", (original[2] as { command_id: string }).command_id);
    vi.mocked(getFinanceArrangements).mockResolvedValue({ ...data(), confirmation: { state: "not_found" } });
    await user.click(dialog.getByRole("button", { name: "Refresh account" }));
    expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(requestPaymentPlan).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestPaymentPlan).mock.calls[1]).toEqual(original);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps retained entries unsent and allows close when obsolete refresh finds another pending proposal", async () => {
    vi.mocked(requestPaymentPlan).mockImplementation((_school, _invoice, body) => Promise.reject(obsoleteError(body)));
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    await user.click(dialog.getByRole("button", { name: "Send proposal" })); await dialog.findByRole("alert");
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ can_request: false, stream_revision: 1, requests: [pending] }));
    await user.click(dialog.getByRole("button", { name: "Refresh balance" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("proposal is already pending");
    expect(dialog.getByRole("button", { name: "Send proposal" })).toBeDisabled(); expect(dialog.getByRole("button", { name: "Close" })).toBeEnabled();
    await user.click(dialog.getByRole("button", { name: "Back" })); expect(dialog.getByLabelText("Amount 1 (₹)")).toHaveValue("30000.00");
    expect(dialog.getByRole("button", { name: "Review", exact: true })).toBeDisabled(); expect(requestPaymentPlan).toHaveBeenCalledOnce();
    await user.click(dialog.getByRole("button", { name: "Cancel" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each(["flat", "different_command", "different_revision", "different_request"])("does not unlock for a %s stale proof", async variant => {
    vi.mocked(requestPaymentPlan).mockImplementation((_school, _invoice, body) => {
      const details = obsoleteError(body).details as { error: { fields: { fee_arrangement_obsolete: Record<string, unknown> } } };
      const proof = details.error.fields.fee_arrangement_obsolete;
      if (variant === "different_command") proof.command_id = "another-command";
      if (variant === "different_revision") proof.expected_revision = 999;
      if (variant === "different_request") proof.request_id = "another-request";
      return Promise.reject(new ApiError("An unconfirmed conflict", 409, variant === "flat" ? { code: "fee_arrangement_obsolete", confirmation: "permanently_inapplicable" } : details));
    });
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true })); await user.click(dialog.getByRole("button", { name: "Send proposal" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("unconfirmed conflict"); expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(dialog.queryByRole("button", { name: "Refresh balance" })).not.toBeInTheDocument();
  });
  it("requires a fresh decline-only review after stale approval without losing the typed response", async () => {
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ requests: [{ ...pending, can_decide: true, can_approve: true, can_withdraw: false }], stream_revision: 1, can_request: false }, true));
    vi.mocked(decidePaymentPlan).mockImplementationOnce((_school, _request, body) => Promise.reject(obsoleteError(body, "request")));
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Review proposal" }));
    const dialog = within(screen.getByRole("dialog")); await user.type(dialog.getByLabelText("Response · Optional"), "Please send the current balance.");
    await user.click(dialog.getByRole("button", { name: "Approve schedule" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("balance changed"); expect(dialog.getByRole("button", { name: "Approve schedule" })).toBeDisabled();
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ requests: [{ ...pending, can_decide: true, basis_changed: true, can_withdraw: false }], stream_revision: 2, can_request: false }, true));
    await user.click(dialog.getByRole("button", { name: "Refresh proposal" }));
    expect(dialog.getByLabelText("Reason")).toHaveValue("Please send the current balance."); expect(dialog.getByLabelText("Approve dates")).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Send decision" }));
    await waitFor(() => expect(decidePaymentPlan).toHaveBeenLastCalledWith("school", "request", expect.objectContaining({ expected_revision: 2, decision: "rejected", response: "Please send the current balance." })));
  });
  it("uses current-world caches, ignores late prior-world accepted callbacks and makes stopped worlds read-only", async () => {
    const user = userEvent.setup(), write = deferred<{ id: string; revision: number; replayed: boolean }>(); vi.mocked(requestPaymentPlan).mockReturnValue(write.promise);
    const view = mount(); await user.click(await screen.findByRole("button", { name: "Propose payment dates" }));
    const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("button", { name: "Review", exact: true })); await user.click(dialog.getByRole("button", { name: "Send proposal" }));
    vi.mocked(getFinanceArrangements).mockResolvedValue(data({ description: "Scenario account" }));
    view.change({ mode: "simulation", namespaceId: "scenario:test:run:one", runId: "one", virtualClock: { now: "2026-10-23T09:00:00Z", timeZone: "UTC" }, runStatus: "stopped" });
    expect(await screen.findByText("Scenario account")).toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Propose payment dates" })).not.toBeInTheDocument();
    const reads = vi.mocked(getFinanceArrangements).mock.calls.length;
    await act(async () => { write.resolve({ id: "old-live", revision: 1, replayed: false }); await write.promise; });
    expect(getFinanceArrangements).toHaveBeenCalledTimes(reads);
  });
  it("fails closed for an unavailable world without reading Live or constructing a run query key", () => {
    mount({ mode: "simulation", unavailable: true, unavailableReason: "run_unavailable", namespaceId: "scenario:test:run:gone", runId: "gone" });
    expect(getFinanceArrangements).not.toHaveBeenCalled(); expect(screen.queryByText("Course fees")).not.toBeInTheDocument();
  });
});
