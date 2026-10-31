import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationRunHistory } from "./SimulationRunHistory";
import { compareSimulationRuns, getSimulationRun, listRetainedSimulationRuns, listSimulationRuns, pauseSimulationRun, removeSimulationRun, stopSimulationRun, type SimulationRunView } from "./simulationApi";

const interaction = vi.hoisted(() => ({ enterSimulation: vi.fn() }));
vi.mock("./ApplicationExecutionEnvironment", () => ({ useApplicationExecutionEnvironment: () => ({ enterSimulation: interaction.enterSimulation, switchState: "idle" }) }));
vi.mock("./ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => ({ mode: "live" }) }));
vi.mock("./simulationApi", () => ({ compareSimulationRuns: vi.fn(), getSimulationRun: vi.fn(), duplicateSimulationRun: vi.fn(), listSimulationRuns: vi.fn(), listRetainedSimulationRuns: vi.fn(), pauseSimulationRun: vi.fn(), pinSimulationRun: vi.fn(), removeSimulationRun: vi.fn(), resumeSimulationRun: vi.fn(), startSimulationRun: vi.fn(), stopSimulationRun: vi.fn(), unpinSimulationRun: vi.fn() }));
const list = vi.mocked(listRetainedSimulationRuns), history = vi.mocked(listSimulationRuns), remove = vi.mocked(removeSimulationRun), stop = vi.mocked(stopSimulationRun), get = vi.mocked(getSimulationRun);
const clients: QueryClient[] = [];
function run(index: number, overrides: Partial<SimulationRunView> = {}): SimulationRunView {
  return { id: `run-${index}`, revision: index + 10, scenario_id: `scenario-${index}`, namespace_id: `simulation:run-${index}`, kind: "baseline", name: `Run ${index}`, status: "stopped", created_at: "2026-10-27T04:00:00.000Z", updated_at: "2026-10-27T04:01:00.000Z", started_at: "2026-10-27T04:00:00.000Z", paused_at: null, stopped_at: "2026-10-27T04:01:00.000Z", completed_at: null, failure_reason: null, created_by_me: true, speed: 20,
    clock: { virtual_now: "2026-10-28T04:00:00.000Z", time_zone: "Asia/Kolkata", simulated_elapsed_ms: 86_400_000, end_at: null, unbounded: true }, can_open: true, available_actions: ["open", "compare", "remove"], snapshot: { ref: "snapshot-1", hash: "snapshot-hash", captured_at: "2026-10-27T04:00:00.000Z", source_revisions: {} }, world: { ref: `world-${index}`, revision: 999, manifest_ref: "manifest-1", limitations: [] }, progress: { event_count: 0, checkpoint_count: 0, last_checkpoint_at: null, next_wake_at: null }, metrics: [], draft_changes: [], behaviour: null,
    retention: { pinned: false, pinned_at: null, expires_at: null, policy_version: 1, state: "retained", world_discarded_at: null }, resources: { reservation_bytes: 0, observed_storage_bytes: 0, measured_at: null, paused_at: null, pause_reason: null, lease_recovery_count: 0 }, ...overrides };
}
const draft = () => run(1, { status: "draft", started_at: null, stopped_at: null, available_actions: ["open", "start", "stop", "compare"] });
const page = (results = [run(1)], number = 1, total = results.length) => ({ schema_version: 1 as const, results, page: { number, page_size: 5, total, total_pages: Math.max(1, Math.ceil(total / 5)) } });
function LocationProbe() { return <output data-testid="location">{useLocation().search}</output>; }
function show(entry = "/more/simulation?panel=recent") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><SimulationRunHistory schoolId="school-1" /><LocationProbe /></MemoryRouter></QueryClientProvider>);
}
async function actions(name = "Run 1") { const card = (await screen.findByRole("heading", { name })).closest("li")!; await userEvent.click(within(card).getByRole("button", { name: `More actions for ${name}` })); return within(card); }
async function chooseRemoval(name = "Run 1") { const card = await actions(name); await userEvent.click(card.getByRole("button", { name: "Remove simulation" })); return screen.getByRole("group", { name: `Remove ${name}` }); }
async function chooseDiscard() { const card = await actions(); await userEvent.click(card.getByRole("button", { name: "Discard draft" })); return screen.getByRole("group", { name: "Discard Run 1" }); }

beforeEach(() => {
  vi.clearAllMocks(); list.mockResolvedValue(page()); history.mockResolvedValue({ schema_version: 1, results: [run(1)] }); interaction.enterSimulation.mockResolvedValue(true);
  remove.mockResolvedValue({ schema_version: 1, run: run(1, { retention: { ...run(1).retention, state: "deleted" } }) });
  stop.mockResolvedValue({ schema_version: 1, run: run(1, { revision: 12, started_at: null }) }); get.mockResolvedValue({ schema_version: 1, run: run(1, { revision: 12, started_at: null }) });
  vi.mocked(pauseSimulationRun).mockResolvedValue({ schema_version: 1, run: run(1, { status: "paused" }) });
  vi.mocked(compareSimulationRuns).mockResolvedValue({ schema_version: 1, comparison: { duration_ms: 86_400_000, controlled_snapshot: true, provenance_warning: null, runs: [], metrics: [] } });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("one Simulation run manager", () => {
  it("defaults to all retained owner runs without checkboxes or a second management page", async () => {
    show(); await screen.findByRole("heading", { name: "Run 1" });
    expect(list).toHaveBeenCalledWith("school-1", 1, expect.any(AbortSignal)); expect(history).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByText("0 selected")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved simulations" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
  it("pages the full retained catalogue and preserves unrelated URL context", async () => {
    list.mockImplementation((_id, number) => Promise.resolve(page(Array.from({ length: number === 3 ? 2 : 5 }, (_, index) => run((number - 1) * 5 + index + 1)), number, 12)));
    show("/more/simulation?panel=recent&page=2&keep=yes"); await screen.findByRole("heading", { name: "Run 6" });
    await userEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByRole("heading", { name: "Run 12" });
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument(); expect(screen.getByTestId("location")).toHaveTextContent("page=3&keep=yes");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Saved simulations" })).toHaveFocus());
  });
  it("keeps removed audit records only in explicit History, with no checkbox", async () => {
    history.mockResolvedValue({ schema_version: 1, results: [run(2, { can_open: false, available_actions: [], retention: { ...run(2).retention, state: "deleted", world_discarded_at: "2026-10-28T04:00:00Z" } })] });
    show(); await screen.findByRole("heading", { name: "Run 1" }); await userEvent.click(screen.getByRole("button", { name: "Run history" }));
    await screen.findByRole("heading", { name: "Run 2" }); expect(screen.queryByRole("heading", { name: "Run 1" })).not.toBeInTheDocument();
    expect(screen.getByText("World removed")).toBeInTheDocument(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });
  it("shows comparison checkboxes only after Compare, only for comparable rows, and cancels cleanly", async () => {
    list.mockResolvedValue(page([run(1), run(2, { available_actions: ["open"] })])); show(); await screen.findByRole("heading", { name: "Run 1" });
    await userEvent.click(screen.getByRole("button", { name: "Compare runs" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); await userEvent.click(screen.getByRole("checkbox")); expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel comparison" })); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });
  it("preserves comparison selections across retained pages and returns from focused results", async () => {
    list.mockImplementation((_id, number) => Promise.resolve(page([run(number)], number, 6))); show(); await screen.findByRole("heading", { name: "Run 1" });
    await userEvent.click(screen.getByRole("button", { name: "Compare runs" })); await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Run 2" }); await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(screen.getByRole("button", { name: "Compare selected" }));
    await screen.findByRole("heading", { name: "Runs aligned at 1d simulated" }); expect(compareSimulationRuns).toHaveBeenCalledWith("school-1", { run_ids: ["run-1", "run-2"] });
    await userEvent.click(screen.getByRole("button", { name: "Back to simulations" })); expect(await screen.findByRole("checkbox")).toBeChecked(); expect(screen.getByText("2 selected")).toBeInTheDocument();
  });
  it("normalizes stale focused comparison and invalid page URLs", async () => {
    show("/more/simulation?panel=recent&page=-1&compare=1&keep=yes"); await screen.findByRole("heading", { name: "Run 1" });
    await waitFor(() => { expect(screen.getByTestId("location")).toHaveTextContent("page=1"); expect(screen.getByTestId("location")).not.toHaveTextContent("compare=1"); });
  });
  it("does not resurrect an ineligible comparison selection after leaving a refreshed page", async () => {
    list.mockImplementation((_id, number) => Promise.resolve(page([run(number)], number, 6))); show(); await screen.findByRole("heading", { name: "Run 1" });
    await userEvent.click(screen.getByRole("button", { name: "Compare runs" })); await userEvent.click(screen.getByRole("checkbox"));
    list.mockImplementation((_id, number) => Promise.resolve(page([run(number, { available_actions: number === 1 ? ["open"] : ["open", "compare"] })], number, 6)));
    await userEvent.click(screen.getByRole("button", { name: "Refresh simulations" })); await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByRole("heading", { name: "Run 2" }); expect(screen.getByText("0 selected")).toBeInTheDocument();
  });
  it("opens through the normal selected-environment boundary and explains refusal", async () => {
    interaction.enterSimulation.mockResolvedValue(false); show(); await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(interaction.enterSimulation).toHaveBeenCalledWith("run-1"); expect(await screen.findByRole("alert")).toHaveTextContent("Live campus is unchanged");
  });
  it("keeps active Stop separate from removal and never offers direct draft Stop", async () => {
    list.mockResolvedValue(page([run(1, { status: "running", available_actions: ["open", "pause", "stop"] }), run(2, { status: "draft", started_at: null, available_actions: ["open", "start", "stop"] })])); show();
    const active = await actions(); expect(active.queryByRole("button", { name: "Remove simulation" })).not.toBeInTheDocument(); await userEvent.click(active.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith("school-1", "run-1")); expect(remove).not.toHaveBeenCalled();
    const pending = await actions("Run 2"); expect(pending.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(); expect(pending.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();
  });
  it("keeps pins, owner boundaries and missing native revision guarded", async () => {
    list.mockResolvedValue(page([run(1, { retention: { ...run(1).retention, pinned: true }, available_actions: ["unpin", "remove"] }), run(2, { created_by_me: false }), run(3, { revision: undefined })])); show();
    for (const name of ["Run 1", "Run 2", "Run 3"]) { const row = await actions(name); expect(row.queryByRole("button", { name: "Remove simulation" })).not.toBeInTheDocument(); if (name === "Run 1") expect(row.getByText("Unpin this simulation before removing it.")).toBeInTheDocument(); }
    expect(remove).not.toHaveBeenCalled();
  });
  it("requires named confirmation; Cancel sends no command and restores row focus", async () => {
    show(); const confirmation = await chooseRemoval(); expect(within(confirmation).getByRole("heading", { name: "Remove Run 1?" })).toHaveFocus();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Cancel" })); expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions for Run 1" })).toHaveFocus());
  });
  it("discards a draft through guarded stop, returned fresh revision and native remove", async () => {
    list.mockResolvedValue(page([draft()])); show(); const confirmation = await chooseDiscard(); expect(stop).not.toHaveBeenCalled();
    list.mockResolvedValue(page([], 1, 0)); await userEvent.click(within(confirmation).getByRole("button", { name: "Discard draft" }));
    await screen.findByText("No saved simulations"); expect(stop).toHaveBeenCalledExactlyOnceWith("school-1", "run-1", { expected_revision: 11, expected_status: "draft" });
    expect(remove).toHaveBeenCalledExactlyOnceWith("school-1", "run-1", { expected_revision: 12 });
  });
  it("reconciles a lost draft-stop response by GET and never stops twice", async () => {
    list.mockResolvedValue(page([draft()])); stop.mockRejectedValueOnce(new Error("Lost response")); show(); const confirmation = await chooseDiscard();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Discard draft" })); expect(await screen.findByRole("alert")).toHaveTextContent("Discard is not confirmed"); expect(remove).not.toHaveBeenCalled();
    list.mockResolvedValue(page([], 1, 0)); await userEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("No saved simulations");
    expect(stop).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledExactlyOnceWith("school-1", "run-1"); expect(remove).toHaveBeenCalledWith("school-1", "run-1", { expected_revision: 12 });
  });
  it.each([draft(), run(1, { status: "running", revision: 12 }), run(1, { status: "stopped", started_at: null, revision: 99 })])("never rebases discard after an uncertain stop onto changed or un-stopped state %#", async current => {
    list.mockResolvedValue(page([draft()])); stop.mockRejectedValueOnce(new Error("Unknown")); get.mockResolvedValue({ schema_version: 1, run: current }); show(); const confirmation = await chooseDiscard();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Discard draft" })); await screen.findByRole("alert"); await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(get).toHaveBeenCalledOnce()); expect(remove).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  });
  it("never removes an unexpectedly started run returned by draft Stop", async () => {
    list.mockResolvedValue(page([draft()])); stop.mockResolvedValue({ schema_version: 1, run: run(1, { revision: 12 }) }); show();
    await userEvent.click(within(await chooseDiscard()).getByRole("button", { name: "Discard draft" })); expect(await screen.findByRole("alert")).toHaveTextContent("draft changed"); expect(remove).not.toHaveBeenCalled();
  });
  it("retains an uncertain removal's original revision even after refreshing newer rows", async () => {
    remove.mockRejectedValueOnce(new Error("Connection lost")); show(); await userEvent.click(within(await chooseRemoval()).getByRole("button", { name: "Remove simulation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Removal is not confirmed"); list.mockResolvedValue(page([run(1, { revision: 88 })]));
    await userEvent.click(screen.getByRole("button", { name: "Refresh list" })); await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    list.mockResolvedValue(page([], 1, 0)); await userEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("No saved simulations");
    expect(remove).toHaveBeenNthCalledWith(1, "school-1", "run-1", { expected_revision: 11 }); expect(remove).toHaveBeenNthCalledWith(2, "school-1", "run-1", { expected_revision: 11 });
  });
  it("keeps exact retry visible when the uncertain target disappears from its page", async () => {
    remove.mockRejectedValueOnce(new Error("Unknown")); list.mockResolvedValue(page([run(1), run(2)], 1, 6)); show();
    await userEvent.click(within(await chooseRemoval()).getByRole("button", { name: "Remove simulation" })); await screen.findByRole("alert"); list.mockResolvedValue(page([run(2)], 1, 6));
    await userEvent.click(screen.getByRole("button", { name: "Refresh list" })); await waitFor(() => expect(screen.queryByRole("heading", { name: "Run 1" })).not.toBeInTheDocument());
    expect(screen.getByRole("group", { name: "Remove Run 1" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Close" })); expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("does not resend accepted removal after refresh fails", async () => {
    list.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("List unavailable")); show(); await userEvent.click(within(await chooseRemoval()).getByRole("button", { name: "Remove simulation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Removed. Refresh the list"); expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    list.mockResolvedValue(page([], 1, 0)); await userEvent.click(screen.getByRole("button", { name: "Refresh list" })); await screen.findByText("No saved simulations"); expect(remove).toHaveBeenCalledOnce();
  });
  it("serializes removal and locks paging and contextual actions until response", async () => {
    let accept!: (value: Awaited<ReturnType<typeof removeSimulationRun>>) => void;
    remove.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; })); list.mockResolvedValue(page([run(1), run(2)], 1, 6)); show();
    await userEvent.dblClick(within(await chooseRemoval()).getByRole("button", { name: "Remove simulation" })); expect(remove).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Next" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Run history" })).toBeDisabled();
    list.mockResolvedValue(page([run(2)], 1, 5)); act(() => accept({ schema_version: 1, run: run(1) })); await waitFor(() => expect(screen.queryByRole("group", { name: "Remove Run 1" })).not.toBeInTheDocument());
  });
  it("retries a failed list with GET only", async () => {
    list.mockRejectedValueOnce(new Error("Unavailable")); show(); expect(await screen.findByRole("alert")).toHaveTextContent("Simulations could not be loaded");
    list.mockResolvedValue(page()); await userEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("heading", { name: "Run 1" }); expect(remove).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
});
