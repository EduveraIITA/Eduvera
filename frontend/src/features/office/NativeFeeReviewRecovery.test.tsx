import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { NativeFeeReviewRecoveryRoute } from "./NativeFeeReviewRecovery";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "sender", active_school_id: "school" }, memberships: [] }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <><h1>{title}</h1>{children}</> }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) => <section role="dialog" aria-label={title}><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose}>Close</button>{children}</section> }));
const source = { id: "review", invoice_id: "invoice", stream_revision: 1, status: "pending", reviewer: { user_id: "finance", label: "Imran" }, can_withdraw: true };
const bodyText = (body: RequestInit["body"]) => typeof body === "string" ? body : "";
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/work/fee-reviews/review"]}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><Routes><Route path="/work/fee-reviews/:reviewId" element={<NativeFeeReviewRecoveryRoute />} /></Routes></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.mocked(apiFetch).mockResolvedValue(source); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("retained own-request recovery", () => {
  it("shows neutral source state without former private invoice details", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...source, description: "Private robotics charge", amount_paise: 3_000_000, note: "Private explanation", reference: "BANK-123" }); mount();
    expect(await screen.findByRole("heading", { name: "Pending review" })).toBeVisible(); expect(screen.getByText("Waiting for Imran")).toBeVisible();
    expect(screen.queryByText("Private robotics charge")).not.toBeInTheDocument(); expect(screen.queryByText("Private explanation")).not.toBeInTheDocument(); expect(screen.queryByText("BANK-123")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeVisible();
  });
  it("withdraws the exact own request and confirms its current state", async () => {
    let withdrawn = false;
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => {
      await Promise.resolve();
      if (init?.method === "POST") { withdrawn = true; return { id: "review", invoice_id: "invoice", revision: 2, outcome: "withdrawn" }; }
      return { ...source, status: withdrawn ? "withdrawn" : "pending", can_withdraw: !withdrawn };
    });
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Withdraw request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw request" }));
    expect(await screen.findByRole("heading", { name: "Request withdrawn" })).toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const writes = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes).toHaveLength(1); expect(JSON.parse(bodyText(writes[0]![1]?.body))).toMatchObject({ expected_revision: 1 });
  });
  it("keeps accepted-but-unrefreshed withdrawal mounted without reposting", async () => {
    let calls = 0, written = false;
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => {
      await Promise.resolve();
      if (init?.method === "POST") { written = true; return { id: "review", invoice_id: "invoice", revision: 2, outcome: "withdrawn" }; }
      if (written && ++calls === 1) throw new ApiError("Refresh unavailable", 503);
      return { ...source, status: written ? "withdrawn" : "pending", can_withdraw: !written };
    });
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Withdraw request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw request" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Saved. Refresh");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
