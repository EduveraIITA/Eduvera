import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { FeeAuthoritySetup } from "./FeeAuthoritySetup";
import { confirmFeeAuthority, getFeeAuthority, type FeeAuthorityWorkspace } from "./feeAuthorityApi";

const auth = vi.hoisted(() => ({ user: { id: "finance-holder" } }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => auth }));
vi.mock("./feeAuthorityApi", () => ({ getFeeAuthority: vi.fn(), confirmFeeAuthority: vi.fn() }));
const initial: FeeAuthorityWorkspace = {
  school_id: "campus", route: { state: "missing", reason: "Confirm existing authority.", rule_id: null, revision: 0, reviewer: null },
  candidates: [{ mandate_id: "mandate", title: "Payment-plan authority", office_title: "Accounts officer", holder_name: "Imran",
    max_amount_paise: 5000000, can_confirm: true, expected: { mandate_revision: 1, office_revision: 2, appointment_revision: 3,
      rule_revision: 0, source_revisions: [{ id: "source", revision: 4 }] },
    sources: [{ id: "source", revision: 4, title: "Recorded Finance mandate", reference: "F-26", provision: "Payment plans",
      verification_state: "verified", effective_from: "2026-01-01", effective_until: "2026-12-31" }] }],
  other_holders: [], reasons: [],
};
const ready: FeeAuthorityWorkspace = { ...initial, candidates: [], route: { state: "ready", reason: null, rule_id: "rule", revision: 1,
  reviewer: { user_id: "finance-holder", person_id: "person", name: "Imran", office_title: "Accounts officer" } },
  confirmation: { state: "accepted", adoption_id: "adoption", rule_id: "rule", revision: 1 } };
function pending() { let resolve!: (value: { adoption_id: string; rule_id: string; revision: number; replayed: boolean }) => void;
  const promise = new Promise<{ adoption_id: string; rule_id: string; revision: number; replayed: boolean }>(done => { resolve = done; }); return { promise, resolve }; }
function mount(environment: ExecutionEnvironment = { mode: "live" }, onConfirmed = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (selected: ExecutionEnvironment) => <QueryClientProvider client={client}><MemoryRouter>
    <ExecutionEnvironmentProvider environment={selected}><FeeAuthoritySetup schoolId="campus" onConfirmed={onConfirmed} /></ExecutionEnvironmentProvider>
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree(environment)); return { onConfirmed, rerender: (selected: ExecutionEnvironment = environment) => view.rerender(tree(selected)) };
}
async function confirm() {
  await userEvent.click(await screen.findByRole("checkbox", { name: "I confirm this authority covers payment-plan decisions." }));
  await userEvent.click(screen.getByRole("button", { name: "Use existing authority" }));
}
beforeEach(() => { vi.clearAllMocks(); auth.user.id = "finance-holder"; vi.mocked(getFeeAuthority).mockResolvedValue(initial); });
afterEach(cleanup);

describe("in-context payment-plan authority", () => {
  it("asks for one confirmation, with source details on demand rather than a configuration form", async () => {
    mount(); expect(await screen.findByText("Imran")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use existing authority" })).toBeDisabled();
    const summary = screen.getByText("Authority details"); await userEvent.click(summary);
    expect(screen.getByText("Recorded Finance mandate")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("does not offer to manufacture authority when no qualified holder exists", async () => {
    vi.mocked(getFeeAuthority).mockResolvedValue({ ...initial, candidates: [], other_holders: [{ name: "Nisha", office_title: "Finance lead" }] });
    mount(); expect(await screen.findByText("Ask Nisha to confirm their existing authority.")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Use existing authority" })).not.toBeInTheDocument();
  });
  it("retains explicit source revisions and prevents duplicate pending confirmation", async () => {
    const write = pending(); vi.mocked(confirmFeeAuthority).mockReturnValue(write.promise); const { onConfirmed } = mount();
    await confirm(); expect(confirmFeeAuthority).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmFeeAuthority).mock.calls[0]?.[1]).toMatchObject({ mandate_id: "mandate", expected: initial.candidates[0]!.expected, attestation: true });
    expect(screen.getByRole("checkbox")).toBeDisabled(); expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    vi.mocked(getFeeAuthority).mockResolvedValue(ready);
    await act(async () => { write.resolve({ adoption_id: "adoption", rule_id: "rule", revision: 1, replayed: false }); await write.promise; });
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
  });
  it("recovers accepted writes with a read only, not a second mutation", async () => {
    vi.mocked(confirmFeeAuthority).mockResolvedValue({ adoption_id: "adoption", rule_id: "rule", revision: 1, replayed: false });
    vi.mocked(getFeeAuthority).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(ready);
    const { onConfirmed } = mount(); await confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("confirmation was saved"); expect(screen.getByRole("checkbox")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh current authority" }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1)); expect(confirmFeeAuthority).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getFeeAuthority).mock.calls.at(-1)?.[1]).toEqual(expect.any(String));
  });
  it("does not unlock an unknown write merely because a generic source refresh succeeds", async () => {
    vi.mocked(confirmFeeAuthority).mockRejectedValue(new TypeError("lost response"));
    vi.mocked(getFeeAuthority).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, confirmation: { state: "pending" } });
    mount(); await confirm(); expect(await screen.findByRole("alert")).toHaveTextContent("not received");
    await userEvent.click(screen.getByRole("button", { name: "Refresh current authority" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still unconfirmed"); expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(confirmFeeAuthority).toHaveBeenCalledTimes(1);
  });
  it("does not claim the current route is ready when authority changes after acceptance", async () => {
    vi.mocked(confirmFeeAuthority).mockResolvedValue({ adoption_id: "adoption", rule_id: "rule", revision: 1, replayed: false });
    vi.mocked(getFeeAuthority).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, confirmation: { state: "accepted" } });
    const { onConfirmed } = mount(); await confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("current authority is unavailable");
    expect(onConfirmed).not.toHaveBeenCalled(); expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(confirmFeeAuthority).toHaveBeenCalledTimes(1);
  });
  it("requires a fresh attestation only after exact receipt lookup proves no accepted command", async () => {
    vi.mocked(confirmFeeAuthority).mockRejectedValue(new TypeError("lost response"));
    vi.mocked(getFeeAuthority).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, confirmation: { state: "not_found" } });
    mount(); await confirm(); await userEvent.click(await screen.findByRole("button", { name: "Refresh current authority" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("button", { name: "Use existing authority" })).toBeDisabled();
  });
  it("keeps a known validation refusal editable without claiming acceptance", async () => {
    vi.mocked(confirmFeeAuthority).mockRejectedValue(new ApiError("Review the source reference.", 400));
    mount(); await confirm(); expect(await screen.findByRole("alert")).toHaveTextContent("Review the source reference");
    expect(screen.getByRole("checkbox")).toBeEnabled(); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it.each(["actor", "world"])("ignores late acceptance after a %s switch", async boundary => {
    const write = pending(); vi.mocked(confirmFeeAuthority).mockReturnValue(write.promise); const view = mount(); await confirm();
    if (boundary === "actor") { auth.user.id = "other-holder"; view.rerender(); }
    else view.rerender({ mode: "simulation", namespaceId: "branch", runId: "run", virtualClock: { now: "2026-10-23T10:00:00Z", timeZone: "UTC" } });
    await act(async () => { write.resolve({ adoption_id: "adoption", rule_id: "rule", revision: 1, replayed: false }); await write.promise; });
    expect(view.onConfirmed).not.toHaveBeenCalled();
  });
  it("does not query an unavailable world or offer stopped-world writes", async () => {
    const view = mount({ mode: "simulation", namespaceId: "branch", runId: "run", unavailable: true, unavailableReason: "run_unavailable" });
    expect(screen.getByRole("status")).toHaveTextContent("Simulation is unavailable"); expect(getFeeAuthority).not.toHaveBeenCalled();
    view.rerender({ mode: "simulation", namespaceId: "branch", runId: "run", runStatus: "stopped", virtualClock: { now: "2026-10-23T10:00:00Z", timeZone: "UTC" } });
    expect(await screen.findByRole("checkbox")).toBeDisabled();
  });
});
