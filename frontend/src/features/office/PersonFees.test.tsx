import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { FeeChargeDialog } from "./FeeChargeDialog";
import { PersonFeesLedger } from "./PersonFeesLedger";
import { PersonFeeInvoiceDetail } from "./PersonFeesAccount";
import { confirmIssuedCharge, type PersonFeeInvoice } from "./personFeesApi";
import type { FeeAudiencePreview, FeeAudienceSelection, FeeBatchIssue, FeeBatchResult } from "./feeBatchApi";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "issuer", active_school_id: "school" }, memberships: [] }) }));
vi.mock("./FeeBeneficiaryPicker", () => ({ FeeBeneficiaryPicker: ({ onChange, onClose, onAddPeople }: { onChange: (selection: FeeAudienceSelection) => void; onClose: () => void; onAddPeople: () => void }) => <section role="dialog" aria-label="Choose recipients"><button type="button" onClick={() => { onChange({ person_ids: ["person-a"], groups: [] }); onClose(); }}>Choose Sana</button><button type="button" onClick={() => { onChange({ person_ids: ["person-a"], groups: [{ kind: "participation", id: "robotics" }] }); onClose(); }}>Choose Robotics and Sana</button><button type="button" onClick={onAddPeople}>Add people</button></section> }));
vi.mock("../people/PeopleBulkAddDialog", () => ({ PeopleBulkAddDialog: ({ onDone }: { onDone: (people: Array<{ id: string; label: string; affiliations: string[] }>) => void }) => <button type="button" onClick={() => onDone([{ id: "person-a", label: "Sana", affiliations: [] }, { id: "person-b", label: "Sana", affiliations: [] }])}>Use two imported people</button> }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose}>Close</button>{children}</section> }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, children, backTo }: { title: string; children: ReactNode; backTo?: string }) => <><h1>{title}</h1>{backTo ? <Link to={backTo}>Back</Link> : null}{children}</> }));
vi.mock("./FinanceArrangementsPanel", () => ({ FinanceArrangementsPanel: () => <section>Payment plans</section> }));
vi.mock("./NativeFeeReviewsPanel", () => ({ NativeFeeReviewsPanel: ({ receiptHref }: { receiptHref?: (id: string) => string }) => <section>Payment reports{receiptHref ? <Link to={receiptHref("payment-person-a")}>View receipt</Link> : null}</section> }));
const onClose = vi.fn(), onReload = vi.fn(), onIssued = vi.fn(), onBatchIssued = vi.fn();
const body = (init?: RequestInit) => JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
let sent: FeeBatchIssue | undefined;
const preview = (selection: FeeAudienceSelection): FeeAudiencePreview => {
  const ids = [...new Set([...selection.person_ids, ...(selection.groups.length ? ["person-a", "person-b"] : [])])].sort();
  return { snapshot_hash: "a".repeat(64), today: "2026-10-23", people: ids.map(person_id => ({ person_id, name: "Sana", revision: 2 })),
    groups: selection.groups.map(group => ({ ...group, name: "Robotics", member_count: 2 })), person_count: ids.length, duplicate_count: selection.groups.length && selection.person_ids.includes("person-a") ? 1 : 0 };
};
const result = (issue: FeeBatchIssue, source = preview(issue.selection)): FeeBatchResult => {
  return { id: issue.batch_id, batch_id: issue.batch_id, reference: issue.reference, description: issue.description, amount_paise: issue.amount_paise, due_on: issue.due_on,
    person_count: source.person_count, total_amount_paise: issue.amount_paise * source.person_count, revision: 1, replayed: false,
    invoices: source.people.map((person, index) => ({ person_id: person.person_id, name: person.name, invoice_id: `invoice-${person.person_id}`, reference: `${issue.reference}/${String(index + 1).padStart(3, "0")}` })) };
};
function receiptWorkspace() {
  const issue: FeeBatchIssue = { batch_id: "batch", command_id: "command", selection: { person_ids: ["person-a", "person-b"], groups: [] }, snapshot_hash: "a".repeat(64), reference: "RV-001", description: "Robotics workshop", amount_paise: 3_000_000, due_on: "2026-10-23" };
  const invoices: PersonFeeInvoice[] = ["person-a", "person-b", "person-c"].map(person => ({ id: `invoice-${person}`, student_id: null, first_name: person, last_name: "", admission_number: "", beneficiary: { kind: "person", person_id: person, student_id: null, name: person }, reference: person, description: "Robotics workshop", due_on: "2026-10-23", amount_paise: 3_000_000, paid_paise: 100_000, adjusted_amount_paise: 3_000_000, balance_paise: 2_900_000, refund_due_paise: 0, collection_state: "collectible" }));
  const payments = invoices.map(invoice => ({ id: `payment-${invoice.beneficiary.person_id}`, invoice_id: invoice.id, amount_paise: 100_000, method: "bank_transfer", reference: `paid-${invoice.beneficiary.person_id}`, created_at: "2026-10-23T10:00:00Z" }));
  const workspace = { today: "2026-10-23", timezone: "UTC", can_issue: true, invoices, payments, currency: "INR" };
  vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/charge-batches/") ? result(issue) : workspace));
  return workspace;
}
function mount(children: ReactNode, route = "/areas/fees/ledger") { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[route]}><ExecutionEnvironmentProvider environment={{ mode: "live" }}>{children}</ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>); }
async function readyCharge(choice = "Choose Sana") {
  const user = userEvent.setup(); mount(<FeeChargeDialog schoolId="school" today="2026-10-23" onClose={onClose} onReload={onReload} onIssued={onIssued} onBatchIssued={onBatchIssued} />);
  await user.click(screen.getByRole("button", { name: "Choose people or groups" })); await user.click(screen.getByRole("button", { name: choice }));
  expect(screen.getByRole("button", { name: choice === "Choose Sana" ? "1 person · 0 groups" : "1 person · 1 group" })).toBeVisible();
  await user.type(screen.getByLabelText("What is the charge for?"), "Robotics workshop"); await user.type(screen.getByLabelText("Amount per person (₹)"), "30000"); await user.type(screen.getByLabelText("Reference"), "RV-001");
  await user.click(screen.getByRole("button", { name: "Review charge" })); await screen.findByText("One charge per person, not a payment. Corrections keep the original record."); return user;
}
beforeEach(() => {
  sent = undefined; onReload.mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockImplementation((path, init) => {
    if (path.includes("/charge-audience/preview/")) return Promise.resolve(preview(body(init).selection as FeeAudienceSelection));
    if (path.endsWith("/charge-batches/") && init?.method === "POST") { sent = body(init) as unknown as FeeBatchIssue; return Promise.resolve(result(sent)); }
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("person-based charge first use", () => {
  it("keeps payment plans optional while balance and payment reports stay visible", async () => {
    const invoice: PersonFeeInvoice = { id: "invoice", student_id: null, first_name: "Sana", last_name: "", admission_number: "", beneficiary: { kind: "person", person_id: "person-a", student_id: null, name: "Sana" }, reference: "RV-001", description: "Robotics workshop", due_on: "2026-10-23", amount_paise: 3_000_000, paid_paise: 0, adjusted_amount_paise: 3_000_000, balance_paise: 3_000_000, refund_due_paise: 0, collection_state: "collectible" };
    const user = userEvent.setup(); mount(<PersonFeeInvoiceDetail schoolId="school" invoice={invoice} payments={[]} onReload={onReload} />); const summary = screen.getByText("Payment plans & account access"), options = summary.closest("details");
    expect(options).not.toHaveAttribute("open"); expect(screen.getByText("Payment plans")).not.toBeVisible(); expect(screen.getByText("Outstanding")).toBeVisible(); expect(screen.getByText("Payment reports")).toBeVisible();
    await user.click(summary); expect(options).toHaveAttribute("open"); expect(screen.getByText("Payment plans")).toBeVisible(); expect(screen.getByText("Outstanding")).toBeVisible(); expect(screen.getByText("Payment reports")).toBeVisible();
  });
  it("reviews a person then uses one batch command without creating school enrollment", async () => {
    const user = await readyCharge(); expect(sent).toBeUndefined(); await user.click(screen.getByRole("button", { name: "Record charge" }));
    await waitFor(() => expect(onIssued).toHaveBeenCalledWith("person-a", "invoice-person-a")); expect(sent).toMatchObject({ selection: { person_ids: ["person-a"], groups: [] }, amount_paise: 3_000_000, due_on: "2026-10-23", snapshot_hash: "a".repeat(64) });
    expect(sent).not.toHaveProperty("student_id"); expect(sent).not.toHaveProperty("term_id"); expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith("/charge-batches/"))).toHaveLength(1);
  });
  it("reviews group overlap once and returns the whole batch without picking the first person", async () => {
    const user = await readyCharge("Choose Robotics and Sana"); expect(screen.getByText("Overlapping selections are counted once.")).toBeVisible(); expect(screen.getByText(/2 people · ₹30,000.00 each/)).toBeVisible();
    await user.click(screen.getByText("People & references · 2")); expect(screen.getByText("RV-001/001")).toBeVisible(); expect(screen.getByText("RV-001/002")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Record 2 charges" })); await waitFor(() => expect(onBatchIssued).toHaveBeenCalledWith(sent?.batch_id)); expect(onIssued).not.toHaveBeenCalled();
  });
  it("pages reviewed people without changing their canonical reference assignments", async () => {
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      const selection = body(init).selection as FeeAudienceSelection;
      if (path.includes("/charge-audience/preview/")) return Promise.resolve({ ...preview(selection), person_count: 12, people: Array.from({ length: 12 }, (_, index) => ({ person_id: `person-${String.fromCharCode(97 + index)}`, name: `Person ${index + 1}`, revision: 1 })) });
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    const user = await readyCharge("Choose Robotics and Sana"); await user.click(screen.getByText("People & references · 12"));
    expect(screen.getByText("RV-001/001")).toBeVisible(); expect(screen.getByText("RV-001/010")).toBeVisible(); expect(screen.queryByText("RV-001/011")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" })); expect(screen.getByText("RV-001/011")).toBeVisible(); expect(screen.getByText("RV-001/012")).toBeVisible(); expect(screen.queryByText("RV-001/001")).not.toBeInTheDocument(); expect(sent).toBeUndefined();
  });
  it("selects every accepted imported person, including equal names with different IDs", async () => {
    const user = userEvent.setup(); mount(<FeeChargeDialog schoolId="school" today="2026-10-23" onClose={onClose} onReload={onReload} onIssued={onIssued} />);
    await user.click(screen.getByRole("button", { name: "Choose people or groups" })); await user.click(screen.getByRole("button", { name: "Add people" })); await user.click(screen.getByRole("button", { name: "Use two imported people" }));
    expect(screen.getByRole("button", { name: "2 people · 0 groups" })).toBeVisible();
  });
  it("refreshes accepted-but-unrefreshed charges without another mutation", async () => {
    onReload.mockRejectedValueOnce(new Error("Refresh interrupted")).mockResolvedValue(undefined); const user = await readyCharge(); await user.click(screen.getByRole("button", { name: "Record charge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved. Refresh the view"); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check result" })); await waitFor(() => expect(onIssued).toHaveBeenCalledOnce()); expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith("/charge-batches/"))).toHaveLength(1);
  });
  it("keeps an uncertain batch locked and retries only its retained reviewed payload", async () => {
    let issueCount = 0;
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.includes("/charge-audience/preview/")) return Promise.resolve(preview(body(init).selection as FeeAudienceSelection));
      if (path.endsWith("/charge-batches/")) { sent = body(init) as unknown as FeeBatchIssue; if (++issueCount === 1) return Promise.reject(new Error("Network interrupted")); return Promise.resolve(result(sent)); }
      return Promise.resolve({ handler: "finance.charge_batch", source_id: sent!.batch_id, command_id: sent!.command_id, action: "issue", state: "not_found" });
    });
    const user = await readyCharge(); await user.click(screen.getByRole("button", { name: "Record charge" })); const original = sent;
    await user.click(await screen.findByRole("button", { name: "Check result" })); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled(); await user.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(onIssued).toHaveBeenCalledOnce()); expect(sent).toEqual(original);
  });
  it("requires a fresh visible audience review after definitive stale-snapshot rejection", async () => {
    let stale = true;
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.includes("/charge-audience/preview/")) return Promise.resolve({ ...preview(body(init).selection as FeeAudienceSelection), snapshot_hash: (stale ? "a" : "b").repeat(64) });
      sent = body(init) as unknown as FeeBatchIssue;
      if (stale) { stale = false; return Promise.reject(new ApiError("Membership changed. Review the audience again.", 400, { error: { code: "finance.charge_audience_changed" } })); }
      return Promise.resolve(result(sent));
    });
    const user = await readyCharge(); await user.click(screen.getByRole("button", { name: "Record charge" })); const original = sent;
    expect(await screen.findByLabelText("What is the charge for?")).toHaveValue("Robotics workshop"); expect(screen.getByRole("alert")).toHaveTextContent("Membership changed");
    await user.click(screen.getByRole("button", { name: "Review charge" })); await screen.findByText("One charge per person, not a payment. Corrections keep the original record."); await user.click(screen.getByRole("button", { name: "Record charge" }));
    await waitFor(() => expect(onIssued).toHaveBeenCalledOnce()); expect(sent?.snapshot_hash).toBe("b".repeat(64)); expect(sent?.batch_id).toBe(original?.batch_id); expect(sent?.command_id).not.toBe(original?.command_id);
  });
  it("uses the selected-world date in an empty ordinary Fees workspace", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ today: "2031-01-02", timezone: "UTC", can_issue: true, invoices: [], payments: [], currency: "INR" }); const user = userEvent.setup(); mount(<PersonFeesLedger />); await user.click(await screen.findByRole("button", { name: "Record charge" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Due date")).toHaveValue("2031-01-02"); expect(screen.queryByText("Current view")).not.toBeInTheDocument(); expect(screen.queryByText("All students")).not.toBeInTheDocument();
  });
  it.each([false, true])("filters the ordinary ledger to its batch and never reports an incomplete balance (missing=%s)", async missing => {
    const issue: FeeBatchIssue = { batch_id: "batch", command_id: "command", selection: { person_ids: ["person-a", "person-b"], groups: [] }, snapshot_hash: "a".repeat(64), reference: "RV-001", description: "Robotics workshop", amount_paise: 3_000_000, due_on: "2026-10-23" };
    const manifest = result(issue);
    const invoices: PersonFeeInvoice[] = ["person-a", ...(missing ? [] : ["person-b"]), "person-c"].map(person => ({ id: `invoice-${person}`, student_id: null, first_name: person, last_name: "", admission_number: "", beneficiary: { kind: "person", person_id: person, student_id: null, name: person }, reference: person, description: person === "person-c" ? "Unrelated charge" : "Robotics workshop", due_on: "2026-10-23", amount_paise: 3_000_000, paid_paise: 0, adjusted_amount_paise: 3_000_000, balance_paise: 3_000_000, refund_due_paise: 0, collection_state: "collectible" }));
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/charge-batches/") ? manifest : { today: "2026-10-23", timezone: "UTC", can_issue: true, invoices, payments: [], currency: "INR" }));
    mount(<PersonFeesLedger />, "/areas/fees/ledger?batch_id=batch&person_id=must-not-filter");
    expect(await screen.findByText("2 people · RV-001")).toBeVisible(); expect(screen.queryByText("Unrelated charge")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").filter(link => link.getAttribute("href")?.includes("invoice_id="))).toHaveLength(missing ? 1 : 2);
    if (missing) { expect(screen.getAllByText("Unavailable")).toHaveLength(2); expect(screen.getByRole("alert")).toHaveTextContent("Some recorded charges are unavailable"); }
    else expect(screen.getByText("₹60,000.00")).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.includes("person_id=must-not-filter"))).toBe(false);
  });
  it.each([false, true])("preserves batch navigation and refuses an unrelated invoice in that context (unrelated=%s)", async unrelated => {
    const issue: FeeBatchIssue = { batch_id: "batch", command_id: "command", selection: { person_ids: ["person-a"], groups: [] }, snapshot_hash: "a".repeat(64), reference: "RV-001", description: "Robotics workshop", amount_paise: 3_000_000, due_on: "2026-10-23" };
    const manifest = result(issue);
    const invoices: PersonFeeInvoice[] = ["person-a", "person-c"].map(person => ({ id: `invoice-${person}`, student_id: null, first_name: person, last_name: "", admission_number: "", beneficiary: { kind: "person", person_id: person, student_id: null, name: person }, reference: person, description: "Robotics workshop", due_on: "2026-10-23", amount_paise: 3_000_000, paid_paise: 0, adjusted_amount_paise: 3_000_000, balance_paise: 3_000_000, refund_due_paise: 0, collection_state: "collectible" }));
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/charge-batches/") ? manifest : { today: "2026-10-23", timezone: "UTC", can_issue: true, invoices, payments: [], currency: "INR" }));
    const user = userEvent.setup(); mount(<PersonFeesLedger />, unrelated ? "/areas/fees/ledger?batch_id=batch&invoice_id=invoice-person-c" : "/areas/fees/ledger?batch_id=batch");
    if (unrelated) expect(await screen.findByRole("alert")).toHaveTextContent("This charge is unavailable");
    else {
      const charge = await screen.findByRole("link", { name: /person-a person-a/ }); expect(charge).toHaveAttribute("href", "/areas/fees/ledger?person_id=person-a&invoice_id=invoice-person-a&batch_id=batch"); await user.click(charge);
      expect(screen.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/areas/fees/ledger?batch_id=batch"); await user.click(screen.getByRole("link", { name: "Back", exact: true })); expect(await screen.findByText("1 person · RV-001")).toBeVisible();
    }
  });
  it("preserves validated batch context through a payment review receipt and Back", async () => {
    receiptWorkspace(); const user = userEvent.setup(); mount(<PersonFeesLedger />, "/areas/fees/ledger?batch_id=batch");
    await user.click(await screen.findByRole("link", { name: /person-a person-a/ }));
    const receipt = screen.getByRole("link", { name: "View receipt" }); expect(receipt).toHaveAttribute("href", "/areas/fees/ledger?person_id=person-a&invoice_id=invoice-person-a&batch_id=batch&receipt=payment-person-a"); await user.click(receipt);
    expect(await screen.findByRole("region", { name: "Receipt details" })).toHaveTextContent("paid-person-a"); expect(screen.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/areas/fees/ledger?batch_id=batch");
    await user.click(screen.getByRole("link", { name: "Back", exact: true })); expect(await screen.findByText("2 people · RV-001")).toBeVisible(); expect(screen.queryByRole("region", { name: "Receipt details" })).not.toBeInTheDocument();
  });
  it.each(["outside-batch", "different-invoice"])("refuses a receipt outside the selected batch or charge (%s)", async mismatch => {
    receiptWorkspace(); mount(<PersonFeesLedger />, mismatch === "outside-batch" ? "/areas/fees/ledger?batch_id=batch&receipt=payment-person-c" : "/areas/fees/ledger?batch_id=batch&invoice_id=invoice-person-b&receipt=payment-person-a");
    expect(await screen.findByRole("alert")).toHaveTextContent("This receipt is unavailable"); expect(screen.queryByRole("region", { name: "Receipt details" })).not.toBeInTheDocument(); expect(screen.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/areas/fees/ledger?batch_id=batch");
  });
  it("does not copy an unvalidated batch query into a standalone invoice receipt link", () => {
    const workspace = receiptWorkspace(); mount(<PersonFeeInvoiceDetail schoolId="school" invoice={workspace.invoices[0]!} payments={workspace.payments.slice(0, 1)} onReload={onReload} manager />, "/areas/fees/ledger?batch_id=unvalidated");
    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute("href", "/areas/fees/ledger?person_id=person-a&invoice_id=invoice-person-a&receipt=payment-person-a");
  });
  it("requires terminal rejection before rebasing an unknown command against a changed roster", async () => {
    let issues = 0, checks = 0;
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.includes("/charge-audience/preview/")) return Promise.resolve({ ...preview(body(init).selection as FeeAudienceSelection), snapshot_hash: (issues >= 2 ? "b" : "a").repeat(64) });
      if (path.endsWith("/charge-batches/")) {
        sent = body(init) as unknown as FeeBatchIssue; issues++;
        if (issues === 1) return Promise.reject(new Error("Connection interrupted"));
        if (issues === 2) return Promise.reject(new ApiError("Audience changed", 400, { error: { code: "finance.charge_audience_changed" } }));
        return Promise.resolve(result(sent));
      }
      return Promise.resolve({ handler: "finance.charge_batch", source_id: sent!.batch_id, command_id: sent!.command_id, action: "issue", state: ++checks === 1 ? "not_found" : "not_accepted" });
    });
    const user = await readyCharge("Choose Robotics and Sana"); await user.click(screen.getByRole("button", { name: "Record 2 charges" })); const original = sent;
    await user.click(await screen.findByRole("button", { name: "Check result" })); await user.click(screen.getByRole("button", { name: "Retry same action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Audience changed"); expect(screen.getByRole("button", { name: "Back" })).toBeDisabled(); expect(screen.queryByRole("button", { name: "Review current people" })).not.toBeInTheDocument(); expect(sent).toEqual(original);
    await user.click(screen.getByRole("button", { name: "Check result" })); await user.click(await screen.findByRole("button", { name: "Review current people" }));
    expect(screen.getByLabelText("What is the charge for?")).toHaveValue("Robotics workshop"); expect(screen.getByLabelText("Amount per person (₹)")).toHaveValue("30000");
    await user.click(screen.getByRole("button", { name: "Review charge" })); await screen.findByRole("button", { name: "Record 2 charges" }); await user.click(screen.getByRole("button", { name: "Record 2 charges" }));
    await waitFor(() => expect(onBatchIssued).toHaveBeenCalledOnce()); expect(sent?.batch_id).toBe(original?.batch_id); expect(sent?.command_id).not.toBe(original?.command_id); expect(sent?.snapshot_hash).toBe("b".repeat(64));
  });
  it("retains the legacy single-charge confirmation boundary", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ handler: "finance.charge", source_id: "other", command_id: "cmd", action: "issue", state: "accepted", result: { id: "other" } }); await expect(confirmIssuedCharge("school", "invoice", "cmd")).rejects.toThrow("does not match");
  });
});
