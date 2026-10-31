import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { NativeFeeReviewsPanel } from "./NativeFeeReviewsPanel";
import { confirmNativeFeeReview, type NativeFeeReview, type NativeFeeReviewInvoice } from "./nativeFeeReviewsApi";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "actor", active_school_id: "school" }, memberships: [] }) }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose}>Close</button>{children}</section> }));
const review: NativeFeeReview = { id: "review", invoice_id: "invoice", kind: "payment", amount_paise: 1_000_000, method: "bank_transfer", reference: "UTR12345", note: "First payment", submitted_at: "2026-10-23T12:00:00Z", status: "pending", revision: 1,
  reviewer: { user_id: "finance", person_id: "finance-person", label: "Imran" }, route_state: "waiting_for_review", can_decide: false, can_verify: false, basis_changed: false, can_withdraw: true, response: null, payment_id: null, decided_at: null };
const invoice: NativeFeeReviewInvoice = { id: "invoice", student_id: null, person_id: "sana", context_kind: "person", label: "Sana", reference: "RV-001", description: "Robotics workshop", balance_paise: 3_000_000, basis_hash: "a".repeat(64), basis_revision: 0, stream_revision: 0, can_report: true, can_question: true,
  reviewers: [{ user_id: "finance", person_id: "finance-person", label: "Imran", eligibility_hash: "b".repeat(64) }], reviews: [] };
let current = invoice;
const reload = vi.fn();
const bodyText = (body: RequestInit["body"]) => typeof body === "string" ? body : "";
function mount(environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (next: ExecutionEnvironment) => <QueryClientProvider client={client}><MemoryRouter><ExecutionEnvironmentProvider environment={next}><NativeFeeReviewsPanel schoolId="school" personId="sana" invoiceId="invoice" onLedgerReload={reload} /></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>;
  const result = render(view(environment)); return { ...result, client, change: (next: ExecutionEnvironment) => result.rerender(view(next)) };
}
beforeEach(() => {
  current = invoice; reload.mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockImplementation((_path, init) => Promise.resolve(init?.method === "POST" ? { id: (JSON.parse(bodyText(init.body)) as { review_id?: string }).review_id ?? "review", invoice_id: "invoice", revision: 1 }
    : { school_id: "school", today: "2026-10-23", timezone: "UTC", can_manage: false, invoices: [current] }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("native payment reports and questions", () => {
  it("requires a named independent reviewer and reports a payment without a receipt claim", async () => {
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Report payment" }));
    const dialog = within(screen.getByRole("dialog")); expect(dialog.getByLabelText("Who should review?")).toHaveValue("");
    await user.type(dialog.getByLabelText("Amount paid (₹)"), "10000"); await user.type(dialog.getByLabelText("Payment reference"), "UTR12345");
    await user.selectOptions(dialog.getByLabelText("Who should review?"), "finance");
    expect(dialog.getByRole("button", { name: "Review", exact: true })).toBeDisabled();
    await user.click(dialog.getByRole("checkbox")); await user.click(dialog.getByRole("button", { name: "Review", exact: true }));
    expect(dialog.getByText("The balance changes only after Finance verifies the funds.")).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Send for review" })); await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    const [path, options] = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(path).toContain("/invoices/invoice/payment-reviews/");
    expect(JSON.parse(bodyText(options?.body))).toMatchObject({ kind: "payment", payment_made: true, amount_paise: 1_000_000, reviewer: { user_id: "finance", person_id: "finance-person", eligibility_hash: "b".repeat(64) } });
  });
  it("shows a named waiting state and explicit withdrawal, not a paid balance", async () => {
    current = { ...invoice, can_report: false, stream_revision: 1, reviews: [review] }; const user = userEvent.setup(); mount();
    expect(await screen.findByText("Waiting for Imran")).toBeVisible(); expect(screen.queryByText("Payment verified")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw" })); expect(screen.getByText(/charge, balance and any verified payments stay unchanged/)).toBeVisible();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
  it("requires independent-funds confirmation before one verified receipt", async () => {
    current = { ...invoice, can_report: false, stream_revision: 1, reviews: [{ ...review, can_decide: true, can_verify: true, can_withdraw: false }] };
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Review request" })); const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("Response"), "Bank transaction confirmed."); expect(dialog.getByRole("button", { name: "Confirm receipt" })).toBeDisabled();
    await user.click(dialog.getByRole("checkbox")); await user.dblClick(dialog.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce()); const writes = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes).toHaveLength(1);
    expect(JSON.parse(bodyText(writes[0]![1]?.body))).toMatchObject({ outcome: "verified", verified_funds: true, expected_revision: 1 });
  });
  it("allows rejection but not verification after the ledger changes", async () => {
    current = { ...invoice, stream_revision: 1, reviews: [{ ...review, can_decide: true, basis_changed: true, can_verify: false, can_withdraw: false }] };
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Review request" })); const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Decision")).toHaveValue("rejected"); expect(dialog.getByRole("option", { name: "Funds verified" })).toBeDisabled(); expect(dialog.getByRole("alert")).toHaveTextContent("ledger changed");
  });
  it("keeps typed input on transient read failure and removes it on explicit revocation", async () => {
    const user = userEvent.setup(), { client } = mount(); await user.click(await screen.findByRole("button", { name: "Question charge" }));
    await user.type(screen.getByLabelText("What needs checking?"), "Please check this charge.");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Temporarily unavailable", 503)); await act(async () => { await client.refetchQueries(); });
    await screen.findByText("Requests could not be refreshed. Previously loaded information and unsent choices are kept.");
    expect(screen.getByLabelText("What needs checking?")).toHaveValue("Please check this charge.");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Access revoked", 403)); await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(screen.queryByText("Robotics workshop")).not.toBeInTheDocument();
  });
  it.each(["source", "action", "invoice", "command"])("rejects an accepted recovery receipt for a different %s", async mismatch => {
    const receipt = { handler: "finance.payment_review", source_id: "review", action: "decide", invoice_id: "invoice", command_id: "command", state: "accepted", result: { id: "review", invoice_id: "invoice", revision: 2 } };
    const changed = { ...receipt, ...(mismatch === "source" ? { source_id: "other" } : mismatch === "action" ? { action: "report" } : mismatch === "invoice" ? { invoice_id: "other" } : { command_id: "other" }) };
    vi.mocked(apiFetch).mockResolvedValue({ confirmation: changed }); await expect(confirmNativeFeeReview("school", { invoiceId: "invoice", personId: "sana" }, "command", "review", "decide")).rejects.toThrow("does not match");
  });
  it("isolates editor state across runs even when their namespace is the same", async () => {
    const world = (runId: string): ExecutionEnvironment => ({ mode: "simulation", namespaceId: "shared-namespace", runId, virtualClock: { now: "2026-10-23T12:00:00Z", timeZone: "UTC" }, runStatus: "paused" });
    const user = userEvent.setup(), view = mount(world("one")); await user.click(await screen.findByRole("button", { name: "Question charge" }));
    await user.type(screen.getByLabelText("What needs checking?"), "First run private text"); view.change(world("two"));
    await screen.findByRole("button", { name: "Question charge" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByDisplayValue("First run private text")).not.toBeInTheDocument();
    expect([...view.client.getQueryCache().getAll()].map(query => query.queryKey).some(key => key.includes("one"))).toBe(true);
    expect([...view.client.getQueryCache().getAll()].map(query => query.queryKey).some(key => key.includes("two"))).toBe(true);
  });
  it("never reads Live while the selected Simulation is unavailable", () => {
    mount({ mode: "simulation", unavailable: true, unavailableReason: "run_unavailable", namespaceId: "gone", runId: "gone" }); expect(apiFetch).not.toHaveBeenCalled();
  });
});
