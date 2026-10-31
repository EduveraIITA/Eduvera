import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationExecutionEnvironmentProvider } from "./ApplicationExecutionEnvironment";
import { createSimulationExecutionEnvironment } from "./executionEnvironment";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";
import { getSimulationRun, pauseSimulationRun, type SimulationRunView } from "./simulationApi";
import { SimulationSessionControls } from "./SimulationSessionControls";

vi.mock("./executionEnvironmentApi", () => ({ selectExecutionEnvironment: vi.fn() }));
vi.mock("./simulationApi", () => ({
  getSimulationRun: vi.fn(),
  pauseSimulationRun: vi.fn(),
  resumeSimulationRun: vi.fn(),
}));

const getRunMock = vi.mocked(getSimulationRun);
const pauseRunMock = vi.mocked(pauseSimulationRun);
const selectEnvironmentMock = vi.mocked(selectExecutionEnvironment);

const run: SimulationRunView = {
  id: "run-1",
  scenario_id: "scenario-1",
  namespace_id: "simulation:run-1",
  kind: "baseline",
  name: "Monday baseline",
  status: "running",
  created_at: "2026-10-19T04:00:00.000Z",
  updated_at: "2026-10-19T04:01:00.000Z",
  started_at: "2026-10-19T04:01:00.000Z",
  paused_at: null,
  stopped_at: null,
  completed_at: null,
  failure_reason: null,
  created_by_me: true,
  speed: 20,
  clock: { virtual_now: "2026-10-21T04:00:00.000Z", time_zone: "Asia/Kolkata", simulated_elapsed_ms: 172_800_000, end_at: null, unbounded: true },
  can_open: true,
  available_actions: ["open", "pause", "stop", "duplicate", "compare"],
  snapshot: { ref: "snapshot-1", hash: "hash-1", captured_at: "2026-10-19T04:00:00.000Z", source_revisions: {} },
  world: { ref: "world-1", revision: 2, manifest_ref: "manifest-1", limitations: [] },
  progress: { event_count: 2, checkpoint_count: 1, last_checkpoint_at: null, next_wake_at: null },
  metrics: [],
  draft_changes: [],
  behaviour: null,
  retention: { pinned: false, pinned_at: null, expires_at: null, policy_version: 1, state: "retained", world_discarded_at: null },
  resources: { reservation_bytes: 0, observed_storage_bytes: 0, measured_at: null, paused_at: null, pause_reason: null, lease_recovery_count: 0 },
};

const simulationEnvironment = createSimulationExecutionEnvironment({
  namespaceId: run.namespace_id,
  runId: run.id,
  scenarioId: run.scenario_id,
  institutionId: "school-1",
  virtualClock: { now: run.clock.virtual_now, timeZone: run.clock.time_zone },
  runStatus: "running",
  speed: 20,
  sourceSnapshotAt: run.snapshot!.captured_at,
});

function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show(path = "/today", environment: { mode: "live" } | typeof simulationEnvironment = simulationEnvironment) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ApplicationExecutionEnvironmentProvider confirmedEnvironment={environment}>
          <SimulationSessionControls schoolId="school-1" />
          <LocationProbe />
        </ApplicationExecutionEnvironmentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRunMock.mockResolvedValue({ schema_version: 1, run });
  pauseRunMock.mockResolvedValue({ schema_version: 1, run: { ...run, status: "paused", available_actions: ["open", "resume", "stop"] } });
  selectEnvironmentMock.mockResolvedValue({ mode: "live", institutionId: "school-1" });
});

afterEach(cleanup);

describe("SimulationSessionControls", () => {
  it("drops world-specific register selections only after a confirmed return to Live", async () => {
    show("/areas/attendance/registers?date=2026-10-20&register_id=scenario-only&occurrence_id=branch-only");
    await userEvent.click(await screen.findByRole("button", { name: "Return to Live" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/areas/attendance/registers?date=2026-10-20"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("scenario-only");
  });
  it("does not discard the selected register when returning to Live fails", async () => {
    selectEnvironmentMock.mockRejectedValueOnce(new Error("Disconnected"));
    show("/areas/attendance/registers?register_id=scenario-only");
    await userEvent.click(await screen.findByRole("button", { name: "Return to Live" }));
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalled());
    expect(screen.getByTestId("location")).toHaveTextContent("register_id=scenario-only");
  });
  it("keeps compact virtual-time controls in normal application routes", async () => {
    const user = userEvent.setup();
    show();

    const controls = await screen.findByRole("complementary", { name: "Selected simulation" });
    expect(controls).toHaveTextContent("Simulation time");
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(controls).toHaveTextContent("20×");
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/more/simulation");
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("title", "Manage simulation");
    expect(screen.getByRole("button", { name: "Return to Live" })).toHaveClass("simulation-session-controls__return");
    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute("title", "Pause simulation");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pauseRunMock).toHaveBeenCalledWith("school-1", "run-1"));
    await user.click(screen.getByRole("button", { name: "Return to Live" }));
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "live" }));
  });

  it("does not duplicate the full controls on the Simulation workspace or show them in Live", () => {
    const first = show("/more/simulation");
    expect(screen.queryByRole("complementary", { name: "Selected simulation" })).not.toBeInTheDocument();
    first.unmount();

    show("/today", { mode: "live" });
    expect(screen.queryByRole("complementary", { name: "Selected simulation" })).not.toBeInTheDocument();
  });

  it("keeps a direct return to Live on the Simulation workspace while editing a scenario draft", async () => {
    const draftRun = { ...run, kind: "scenario" as const, status: "draft" as const, available_actions: ["open", "start"] };
    getRunMock.mockResolvedValueOnce({ schema_version: 1, run: draftRun });
    const draftEnvironment = createSimulationExecutionEnvironment({
      namespaceId: draftRun.namespace_id,
      runId: draftRun.id,
      scenarioId: draftRun.scenario_id,
      institutionId: "school-1",
      virtualClock: { now: draftRun.clock.virtual_now, timeZone: draftRun.clock.time_zone },
      runStatus: "draft",
      speed: draftRun.speed,
      sourceSnapshotAt: draftRun.snapshot!.captured_at,
    });

    show("/more/simulation", draftEnvironment);

    const controls = await screen.findByRole("complementary", { name: "Selected simulation" });
    expect(controls).toHaveTextContent("Draft");
    expect(screen.getByRole("button", { name: "Return to Live" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("keeps the server-confirmed lifecycle visible when run detail is temporarily unavailable", async () => {
    getRunMock.mockRejectedValueOnce(new Error("offline"));
    show();

    const controls = await screen.findByRole("complementary", { name: "Selected simulation" });
    expect(controls).toHaveTextContent("Running");
    expect(controls).toHaveTextContent("20×");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});
