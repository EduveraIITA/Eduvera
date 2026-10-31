import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { PersonFeesLedger } from "./PersonFeesLedger";
import { feeLedgerHref, feeLedgerRecords } from "./feeLedgerCollections";
import type { PersonFeeInvoice } from "./personFeesApi";
import type { FeeBatchResult } from "./feeBatchApi";
import type { Payment } from "./api";
import { FeeCollectionDetail } from "./FeeCollectionDetail";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "issuer", active_school_id: "school" }, memberships: [] }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, backTo, children }: { title: string; backTo?: string; children: ReactNode }) => <><h1>{title}</h1>{backTo ? <Link to={backTo}>Back</Link> : null}{children}</> }));
vi.mock("./NativeFeeReviewsPanel", () => ({ NativeFeeReviewsPanel: () => <section>Payment reports</section> }));
vi.mock("./FinanceArrangementsPanel", () => ({ FinanceArrangementsPanel: () => <section>Payment plans</section> }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button type="button" onClick={onClose}>Close</button>{children}</section> }));
function fixture(count = 4) {
  const names = count === 4 ? ["Aarav", "Bina", "Cora", "Dev"] : Array.from({ length: count }, (_, index) => `Name ${index + 1}`);
  const meta = { id: "batch", reference: "RV-ROBOTICS", description: "Robotics workshop", person_count: count };
  const invoices: PersonFeeInvoice[] = names.map((name, index) => ({ id: `invoice-${index + 1}`, student_id: null, first_name: name, last_name: "", admission_number: "", beneficiary: { kind: "person", person_id: `person-${String(index + 1).padStart(2, "0")}`, student_id: null, name }, reference: `${meta.reference}/${String(index + 1).padStart(3, "0")}`, description: meta.description, due_on: "2026-10-24", amount_paise: 200_000, paid_paise: 0, adjusted_amount_paise: index === count - 1 ? 0 : 200_000, balance_paise: index === count - 1 ? 0 : 200_000, refund_due_paise: 0, collection_state: index === count - 1 ? "paid" : "collectible", charge_state: index === count - 1 ? "cancelled" : "active", can_correct: true, charge_batch: { ...meta } }));
  const batch: FeeBatchResult = { ...meta, batch_id: meta.id, person_count: count, amount_paise: 200_000, due_on: "2026-10-24", total_amount_paise: count * 200_000, revision: 1, replayed: false, invoices: invoices.map(invoice => ({ person_id: invoice.beneficiary.person_id!, invoice_id: invoice.id, name: invoice.beneficiary.name, reference: invoice.reference })) };
  return { invoices, batch, payments: [] as Payment[] };
}
let data = fixture();
function mount(route = "/areas/fees/ledger") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><PersonFeesLedger /></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  data = fixture(); vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/charge-batches/") ? data.batch : { today: "2026-10-24", timezone: "Asia/Kolkata", can_issue: true, currency: "INR", invoices: data.invoices, payments: data.payments }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function dragHorizontally(target: Element, dx: number) {
  for (const [type, clientX] of [["pointerdown", 160], ["pointermove", 160 + dx], ["pointerup", 160 + dx]] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX, clientY: 40 }); fireEvent(target, event);
  }
}

describe("saved Finance collection identity", () => {
  it("uses the authorized server collection summary when only its representative is on a bounded page", () => {
    const representative = { ...data.invoices[0]!, charge_batch: { ...data.invoices[0]!.charge_batch!, summary: { complete: true, outstanding: 600_000, cancelled: 1 } } };
    expect(feeLedgerRecords([representative], true)).toHaveLength(1);
    expect(feeLedgerRecords([representative], true)[0]).toMatchObject({ kind: "collection", personCount: 4, complete: true, outstanding: 600_000, cancelled: 1 });
  });
  it("groups four recorded people into one current ₹6,000 collection with one cancellation", () => {
    const records = feeLedgerRecords(data.invoices, true); expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ kind: "collection", personCount: 4, cancelled: 1, outstanding: 600_000, complete: true });
  });
  it("never groups same descriptions, references, or separate saved batch IDs", () => {
    const invoices = [data.invoices[0]!, { ...data.invoices[1]!, charge_batch: { ...data.invoices[1]!.charge_batch!, id: "other" } }, { ...data.invoices[2]!, charge_batch: null }];
    expect(feeLedgerRecords(invoices, true)).toHaveLength(3); expect(feeLedgerRecords(data.invoices, false)).toHaveLength(4);
  });
  it.each(["missing", "duplicate", "reference", "description", "count", "person"])("does not present a complete collection for %s source records", variant => {
    const invoices = structuredClone(data.invoices);
    if (variant === "missing") invoices.pop();
    if (variant === "duplicate") invoices[3] = { ...invoices[0]! };
    if (variant === "reference") invoices[1]!.charge_batch!.reference = "OTHER";
    if (variant === "description") invoices[1]!.charge_batch!.description = "Other workshop";
    if (variant === "count") invoices[1]!.charge_batch!.person_count = 5;
    if (variant === "person") invoices[1]!.beneficiary.person_id = invoices[0]!.beneficiary.person_id;
    expect(feeLedgerRecords(invoices, true)[0]).toMatchObject({ kind: "collection", complete: false, outstanding: null });
  });
  it("does not merge malformed blank identities into a guessed collection", () => {
    const invoices = data.invoices.map(invoice => ({ ...invoice, charge_batch: { ...invoice.charge_batch!, id: " " } })); const records = feeLedgerRecords(invoices, true);
    expect(records).toHaveLength(4); expect(records.every(record => record.kind === "charge" && record.collectionUnavailable)).toBe(true);
  });
  it("retains only known presentation state, never a return URL or foreign authority scope", () => {
    const href = feeLedgerHref(new URLSearchParams("fee_charges_search=Cora&fee_charges_page=2&collection_view=receipts&collection_receipts_page=2&return=https://evil.test&person_id=other&student_id=other"), { batch_id: "batch" });
    expect(href).toContain("fee_charges_search=Cora"); expect(href).toContain("collection_receipts_page=2"); expect(href).not.toContain("evil"); expect(href).not.toContain("person_id"); expect(href).not.toContain("student_id");
  });
});

describe("collection-first ledger and drill-down", () => {
  it("uses one all-ledger search and no nested client pages for a server-bounded result", async () => {
    data = fixture(12);
    data.invoices = data.invoices.map(invoice => ({ ...invoice, charge_batch: null }));
    vi.mocked(apiFetch).mockResolvedValue({ today: "2026-10-24", timezone: "Asia/Kolkata", can_issue: true,
      currency: "INR", invoices: data.invoices, payments: [], pagination: { limit: 50, payment_limit: 50,
        next_cursor: "next-page", next_payment_cursor: null, search: "", exact: false, grouped: true } });
    mount();
    expect(await screen.findByRole("searchbox", { name: "Search all records" })).toBeVisible();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.queryByLabelText("Find a collection or charge")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("records pages")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next charges" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Name \d+ RV-ROBOTICS/ })).toHaveLength(12);
  });
  it("shows one collection tile and does not mistake the cancelled charge for payment", async () => {
    mount(); const tile = await screen.findByRole("link", { name: /Robotics workshop 4 people · 1 cancelled/ }); expect(within(tile).getByText("₹6,000.00")).toBeVisible(); expect(tile).toHaveAttribute("href", "/areas/fees/ledger?batch_id=batch");
    expect(screen.getAllByText("Robotics workshop")).toHaveLength(1); expect(screen.queryByText("Paid")).not.toBeInTheDocument(); expect(screen.queryByText("Aarav")).not.toBeInTheDocument();
  });
  it("matches a person inside a collection without splitting its tile or totals", async () => {
    const user = userEvent.setup(); mount("/areas/fees/ledger?fee_charges_search=Cora"); await user.click(await screen.findByRole("link", { name: /Robotics workshop 4 people/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Robotics workshop" })).toBeVisible(); expect(screen.getByRole("link", { name: /Aarav/ })).toBeVisible(); expect(screen.getByRole("link", { name: /Dev/ })).toBeVisible(); expect(screen.getAllByText("Robotics workshop")).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: "Back", exact: true })); expect(await screen.findByLabelText("Find a collection or charge")).toHaveValue("Cora");
  });
  it("shows active, reversed and replaced receipts but counts only active received money", async () => {
    data.invoices[0]!.paid_paise = 100_000; data.invoices[0]!.balance_paise = 100_000;
    data.payments = [{ id: "old", invoice_id: "invoice-1", reference: "OLD", amount_paise: 200_000, method: "cash", created_at: "2026-10-24T08:00:00Z", status: "replaced" }, { id: "reversed", invoice_id: "invoice-2", reference: "REVERSED", amount_paise: 50_000, method: "cash", created_at: "2026-10-24T09:00:00Z", status: "reversed" }, { id: "current", invoice_id: "invoice-1", reference: "CURRENT", amount_paise: 100_000, method: "cash", created_at: "2026-10-24T10:00:00Z", status: "active", replaces_payment_id: "old" }];
    mount("/areas/fees/ledger?batch_id=batch&collection_view=receipts"); const balances = await screen.findByRole("region", { name: "Collection balance" }); expect(within(balances).getByText("Received").parentElement).toHaveTextContent("₹1,000.00");
    expect(screen.getByText("1 active · 1 reversed · 1 replaced")).toBeVisible(); expect(screen.getByRole("link", { name: /Active replacement receipt/ })).toBeVisible(); expect(screen.getAllByText("History only")).toHaveLength(2); expect(screen.getByRole("button", { name: "Receipts · 3" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps people search/page through an individual detail and Back", async () => {
    data = fixture(12); const user = userEvent.setup(); mount("/areas/fees/ledger?batch_id=batch&fee_charges_search=Workshop&collection_people_search=Name&collection_people_page=2"); await user.click(await screen.findByRole("link", { name: /Name 11/ }));
    const back = screen.getByRole("link", { name: "Back", exact: true }); expect(back.getAttribute("href")).toContain("collection_people_page=2"); expect(back.getAttribute("href")).toContain("fee_charges_search=Workshop"); await user.click(back);
    expect(await screen.findByRole("link", { name: /Name 11/ })).toBeVisible(); expect(screen.queryByRole("link", { name: /Name 1 RV/ })).not.toBeInTheDocument(); expect(screen.getByLabelText("Find a person")).toHaveValue("Name");
  });
  it("keeps receipt view/search/page through receipt detail and Back", async () => {
    data.payments = Array.from({ length: 12 }, (_, index) => ({ id: `receipt-${index + 1}`, invoice_id: "invoice-1", reference: `Receipt ${index + 1}`, amount_paise: 1_000, method: "cash", created_at: "2026-10-24T10:00:00Z", status: "active" }));
    const user = userEvent.setup(); mount("/areas/fees/ledger?batch_id=batch&collection_view=receipts&collection_receipts_search=Receipt&collection_receipts_page=2"); await user.click(await screen.findByRole("link", { name: /Receipt 11/ }));
    expect(await screen.findByRole("region", { name: "Receipt details" })).toHaveTextContent("Receipt 11"); const back = screen.getByRole("link", { name: "Back", exact: true }); expect(back.getAttribute("href")).toContain("collection_view=receipts"); expect(back.getAttribute("href")).toContain("collection_receipts_page=2"); await user.click(back); expect(await screen.findByRole("link", { name: /Receipt 11/ })).toBeVisible(); expect(screen.getByLabelText("Find a receipt")).toHaveValue("Receipt");
  });
  it.each(["ledger", "batch"])("removes cached private collection title and cards after %s access is revoked", async endpoint => {
    const client = mount("/areas/fees/ledger?batch_id=batch"); await screen.findByRole("heading", { level: 1, name: "Robotics workshop" });
    vi.mocked(apiFetch).mockImplementation(path => path.includes("/charge-batches/") === (endpoint === "batch") ? Promise.reject(new ApiError("Access ended", 403)) : Promise.resolve(path.includes("/charge-batches/") ? data.batch : { today: "2026-10-24", timezone: "UTC", can_issue: true, invoices: data.invoices, payments: data.payments, currency: "INR" }));
    await act(async () => { await client.refetchQueries(); }); await waitFor(() => expect(screen.queryByText("Robotics workshop")).not.toBeInTheDocument()); expect(screen.getByRole("heading", { level: 1, name: "Fees & receipts" })).toBeVisible(); expect(screen.queryByText("Aarav")).not.toBeInTheDocument();
  });
  it("does not turn missing collection records into zero received or fully settled", async () => {
    data.invoices.pop(); mount("/areas/fees/ledger?batch_id=batch&collection_view=receipts"); expect(await screen.findByRole("alert")).toHaveTextContent("Some recorded charges are unavailable"); expect(screen.getAllByText("Unavailable")).toHaveLength(2); expect(screen.queryByText("No receipts recorded for this collection.")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Receipts", exact: true })).toBeVisible();
  });
});

describe("ordinary Finance card navigation", () => {
  it.each(["collection", "person", "receipt"] as const)("has no swipe controls on a %s card, including after a horizontal drag", async kind => {
    data.payments = [{ id: "current", invoice_id: "invoice-1", reference: "CURRENT", amount_paise: 100_000, method: "cash", created_at: "2026-10-24T10:00:00Z", status: "active", can_reverse: true, can_replace: false }];
    const user = userEvent.setup(); mount(kind === "collection" ? "/areas/fees/ledger" : `/areas/fees/ledger?batch_id=batch${kind === "receipt" ? "&collection_view=receipts" : ""}`);
    const card = await screen.findByRole("link", { name: kind === "collection" ? /Robotics workshop 4 people/ : kind === "person" ? /Aarav RV-ROBOTICS/ : /Aarav CURRENT/ });
    expect(card.closest(".swipe-actions")).toBeNull(); expect(screen.queryByRole("button", { name: /Actions for|^Correct (?:charge|charges|receipt):/ })).not.toBeInTheDocument();
    dragHorizontally(card, -140); dragHorizontally(card, 140);
    expect(card.closest(".swipe-actions")).toBeNull(); expect(screen.queryByRole("button", { name: /Actions for|^Correct (?:charge|charges|receipt):/ })).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
    await user.click(card);
    if (kind === "collection") expect(await screen.findByRole("heading", { level: 1, name: "Robotics workshop" })).toBeVisible();
    else if (kind === "person") expect(await screen.findByRole("button", { name: "Correct charge", exact: true })).toBeVisible();
    else expect(await screen.findByRole("region", { name: "Receipt details" })).toHaveTextContent("CURRENT");
  });
  it("does not infer correction authority from collection membership or receipt ownership", () => {
    const callback = vi.fn(); data.invoices.forEach(invoice => { invoice.can_correct = false; }); data.payments = [{ id: "old", invoice_id: "invoice-1", reference: "OLD", amount_paise: 100_000, method: "cash", created_at: "2026-10-24T10:00:00Z", status: "reversed", can_reverse: false, can_replace: false }];
    render(<MemoryRouter><FeeCollectionDetail batch={data.batch} invoices={data.invoices} payments={data.payments} complete view="receipts" onView={vi.fn()} chargeHref={() => "/charge"} receiptHref={() => "/receipt"} onCorrect={callback} canCorrect={false} stale={false} onRefresh={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Aarav OLD/ })).toBeVisible(); expect(screen.queryByRole("button", { name: /Actions for|Correct charge|Correct receipt/ })).not.toBeInTheDocument(); expect(callback).not.toHaveBeenCalled();
  });
  it("does not offer collection correction for incomplete source records", async () => {
    data.invoices.pop(); mount("/areas/fees/ledger?batch_id=batch");
    expect(await screen.findByRole("button", { name: "Correct charges", exact: true })).toBeDisabled(); expect(screen.getByRole("alert")).toHaveTextContent("Some recorded charges are unavailable");
  });
  it("retains collection Receipts and correction actions through ordinary keyboard navigation without a second menu", async () => {
    const user = userEvent.setup(); mount(); const tile = await screen.findByRole("link", { name: /Robotics workshop 4 people/ }); tile.focus(); expect(tile).toHaveFocus(); await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Robotics workshop" })).toBeVisible(); expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Receipts · 0" })); expect(screen.getByText("No receipts recorded for this collection.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Correct charges", exact: true })); const dialog = await screen.findByRole("dialog", { name: "Correct charges" });
    expect(within(within(dialog).getByRole("region", { name: "Charges to correct" })).getAllByRole("checkbox")).toHaveLength(4); expect(within(dialog).getByRole("button", { name: "Review correction" })).toBeDisabled();
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
  it("retains the one-person correction action through an ordinary person-card click", async () => {
    const user = userEvent.setup(); mount("/areas/fees/ledger?batch_id=batch"); await user.click(await screen.findByRole("link", { name: /Aarav RV-ROBOTICS/ }));
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument(); await user.click(await screen.findByRole("button", { name: "Correct charge", exact: true }));
    const dialog = await screen.findByRole("dialog", { name: "Correct charge" }); expect(dialog).toHaveTextContent("Aarav · RV-ROBOTICS/001"); expect(within(dialog).queryByRole("region", { name: "Charges to correct" })).not.toBeInTheDocument(); expect(within(dialog).getByLabelText("Reason")).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
  it("retains the permitted receipt correction action through an ordinary receipt-card click", async () => {
    data.payments = [{ id: "current", invoice_id: "invoice-1", reference: "CURRENT", amount_paise: 100_000, method: "cash", created_at: "2026-10-24T10:00:00Z", status: "active", can_reverse: true, can_replace: false }];
    const user = userEvent.setup(); mount("/areas/fees/ledger?batch_id=batch&collection_view=receipts"); await user.click(await screen.findByRole("link", { name: /Aarav CURRENT/ }));
    expect(await screen.findByRole("region", { name: "Receipt details" })).toHaveTextContent("CURRENT"); expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Correct receipt", exact: true })); const dialog = await screen.findByRole("dialog", { name: "Correct receipt" }); expect(dialog).toHaveTextContent("CURRENT"); expect(within(dialog).getByLabelText("Reason")).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
});
