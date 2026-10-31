import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { getWorkspaceManifest } from "../workspace/api";
import { ApplicationExecutionEnvironmentProvider } from "./ApplicationExecutionEnvironment";
import { createSimulationExecutionEnvironment } from "./executionEnvironment";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";
import {
  compareSimulationRuns,
  configureSimulationBehaviour,
  createSimulationRun,
  duplicateSimulationRun,
  getSimulationRun,
  getSimulationRunResources,
  listSimulationRuns,
  listRetainedSimulationRuns,
  pauseSimulationRun,
  resumeSimulationRun,
  startSimulationRun,
  stopSimulationRun,
  updateSimulationDraft,
  type SimulationRunStatus,
  type SimulationRunView,
} from "./simulationApi";
import { SimulationWorkspacePage } from "./SimulationWorkspacePage";
import { ApiError } from "../../lib/api";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children, backTo, title, contentHasHeading }: { children: ReactNode; backTo: string; title: string; contentHasHeading: boolean }) => <div data-testid="operations-shell" data-back-to={backTo}>{!contentHasHeading ? <h1>{title}</h1> : null}{children}</div>,
}));
vi.mock("./executionEnvironmentApi", () => ({ selectExecutionEnvironment: vi.fn() }));
vi.mock("../workspace/api", () => ({ getWorkspaceManifest: vi.fn() }));
vi.mock("./simulationApi", () => ({
  compareSimulationRuns: vi.fn(),
  configureSimulationBehaviour: vi.fn(),
  createSimulationRun: vi.fn(),
  duplicateSimulationRun: vi.fn(),
  getSimulationRun: vi.fn(),
  getSimulationRunResources: vi.fn(),
  listSimulationRuns: vi.fn(),
  listRetainedSimulationRuns: vi.fn(),
  removeSimulationRun: vi.fn(),
  pauseSimulationRun: vi.fn(),
  pinSimulationRun: vi.fn(),
  resumeSimulationRun: vi.fn(),
  startSimulationRun: vi.fn(),
  stopSimulationRun: vi.fn(),
  updateSimulationDraft: vi.fn(),
  unpinSimulationRun: vi.fn(),
}));

const createRunMock = vi.mocked(createSimulationRun);
const configureBehaviourMock = vi.mocked(configureSimulationBehaviour);
const listRunsMock = vi.mocked(listSimulationRuns);
const retainedRunsMock = vi.mocked(listRetainedSimulationRuns);
const getRunMock = vi.mocked(getSimulationRun);
const getResourcesMock = vi.mocked(getSimulationRunResources);
const startRunMock = vi.mocked(startSimulationRun);
const pauseRunMock = vi.mocked(pauseSimulationRun);
const resumeRunMock = vi.mocked(resumeSimulationRun);
const stopRunMock = vi.mocked(stopSimulationRun);
const updateDraftMock = vi.mocked(updateSimulationDraft);
const duplicateRunMock = vi.mocked(duplicateSimulationRun);
const compareRunsMock = vi.mocked(compareSimulationRuns);
const selectEnvironmentMock = vi.mocked(selectExecutionEnvironment);

const manifest: WorkspaceManifest = {
  revision: "workspace-1",
  generated_at: "2026-10-19T04:00:00.000Z",
  context: {
    institution_id: "school-1",
    institution_label: "Your campus",
    environment: { kind: "live", namespace_id: "live:school-1" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [],
  more: {
    groups: [{ key: "simulation", label: "Simulation", items: [{ key: "simulation", label: "Simulation", href: "/more/simulation", icon: "simulation" }] }],
    setup: [],
    other: [],
  },
  freshness: { state: "current", as_of: "9:30 AM", source_revision: "workspace-1" },
};

function runFixture(overrides: Partial<SimulationRunView> = {}): SimulationRunView {
  const status = overrides.status ?? "draft";
  return {
    id: "run-1",
    scenario_id: "scenario-1",
    namespace_id: "simulation:run-1",
    kind: "scenario",
    name: "Alternative staffing",
    status,
    created_at: "2026-10-19T04:00:00.000Z",
    updated_at: "2026-10-19T04:01:00.000Z",
    started_at: status === "running" || status === "paused" ? "2026-10-19T04:01:00.000Z" : null,
    paused_at: status === "paused" ? "2026-10-19T04:02:00.000Z" : null,
    stopped_at: status === "stopped" ? "2026-10-19T04:03:00.000Z" : null,
    completed_at: status === "completed" ? "2026-10-19T04:03:00.000Z" : null,
    failure_reason: status === "failed" ? "The run could not advance." : null,
    created_by_me: true,
    speed: 20,
    clock: {
      virtual_now: "2026-10-21T04:00:00.000Z",
      time_zone: "Asia/Kolkata",
      simulated_elapsed_ms: 172_800_000,
      end_at: null,
      unbounded: true,
    },
    can_open: !["preparing", "failed"].includes(status),
    available_actions: status === "draft"
      ? ["open", "start", "stop", "duplicate", "compare"]
      : status === "running"
        ? ["open", "pause", "stop", "duplicate", "compare"]
        : status === "paused"
          ? ["open", "resume", "stop", "duplicate", "compare"]
          : status === "stopped" || status === "completed"
            ? ["open", "duplicate", "compare"]
            : ["duplicate", "compare"],
    snapshot: {
      ref: "snapshot-1",
      hash: "snapshot-hash-1",
      captured_at: "2026-10-19T04:00:00.000Z",
      source_revisions: { timetable: "7", people: "11" },
    },
    world: { ref: "world-1", revision: 3, manifest_ref: "manifest-1", limitations: [] },
    progress: { event_count: 7, checkpoint_count: 2, last_checkpoint_at: "2026-10-19T04:02:00.000Z", next_wake_at: null },
    metrics: [],
    draft_changes: [],
    behaviour: null,
    retention: { pinned: false, pinned_at: null, expires_at: null, policy_version: 1, state: "retained", world_discarded_at: null },
    resources: { reservation_bytes: 0, observed_storage_bytes: 0, measured_at: null, paused_at: null, pause_reason: null, lease_recovery_count: 0 },
    ...overrides,
  };
}

function environmentFor(run: SimulationRunView) {
  return createSimulationExecutionEnvironment({
    namespaceId: run.namespace_id,
    runId: run.id,
    scenarioId: run.scenario_id,
    institutionId: "school-1",
    virtualClock: { now: run.clock.virtual_now, timeZone: run.clock.time_zone },
    sourceSnapshotAt: run.snapshot?.captured_at,
  });
}

function response(run: SimulationRunView) {
  return { schema_version: 1 as const, run };
}

function show(environment: { mode: "live" } | ReturnType<typeof createSimulationExecutionEnvironment> = { mode: "live" }, initialEntry = "/more/simulation") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ApplicationExecutionEnvironmentProvider confirmedEnvironment={environment}>
          <SimulationWorkspacePage manifest={manifest} />
        </ApplicationExecutionEnvironmentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkspaceManifest).mockResolvedValue({
    ...manifest,
    context: { ...manifest.context, environment: { kind: "simulation", namespace_id: "simulation:run-1", virtual_now: "2026-10-21T04:00:00.000Z" } },
    areas: [{ key: "timetable", label: "Timetable", href: "/areas/timetable", capabilities: ["timetable.manage"], scopes: [], surfaces: [{ key: "planning", label: "Timetable planning", href: "/areas/timetable/planning", capabilities: ["timetable.manage"], scopes: [] }] }],
    more: { ...manifest.more, setup: [{ key: "institution", label: "Campus setup", href: "/more/setup/institution" }] },
  });
  getResourcesMock.mockResolvedValue({
    schema_version: 1,
    run_id: "run-1",
    counts: { effects: {}, artifacts: 0, artifact_bytes: 0 },
    effects: { page: 1, page_size: 5, total: 0, results: [] },
  });
  listRunsMock.mockResolvedValue({ schema_version: 1, results: [] });
  retainedRunsMock.mockResolvedValue({ schema_version: 1, results: [], page: { number: 1, page_size: 5, total: 0, total_pages: 1 } });
  const defaultRun = runFixture();
  getRunMock.mockResolvedValue(response(defaultRun));
  createRunMock.mockResolvedValue(response(defaultRun));
  configureBehaviourMock.mockResolvedValue(response(defaultRun));
  startRunMock.mockResolvedValue(response(runFixture({ status: "running" })));
  pauseRunMock.mockResolvedValue(response(runFixture({ status: "paused" })));
  resumeRunMock.mockResolvedValue(response(runFixture({ status: "running" })));
  stopRunMock.mockResolvedValue(response(runFixture({ status: "stopped" })));
  updateDraftMock.mockImplementation((_schoolId, _runId, input) => Promise.resolve(response(runFixture({
    ...(input.name ? { name: input.name } : {}),
    ...(input.speed ? { speed: input.speed } : {}),
  }))));
  duplicateRunMock.mockResolvedValue(response(runFixture({ id: "run-copy", name: "Copy of Alternative staffing" })));
  selectEnvironmentMock.mockResolvedValue(environmentFor(defaultRun));
});

afterEach(cleanup);

describe("SimulationWorkspacePage", () => {
  it("presents baseline and scenario as the two primary product choices", async () => {
    const user = userEvent.setup();
    show();

    expect(screen.getByRole("heading", { name: "Simulation", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up baseline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create scenario draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start new" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start baseline simulation" })).not.toBeInTheDocument();
    expect(createRunMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot write back to Live/i)).toBeInTheDocument();
    expect(screen.queryByText("No simulations yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Saved simulations" }));
    expect(await screen.findByText("No saved simulations")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create scenario draft" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New simulation" }));
    expect(createRunMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("uses a focused, reversible URL step for baseline settings", async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    const heading = screen.getByRole("heading", { name: "Baseline settings" });
    expect(createRunMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-back-to", "/more/simulation");
    expect(screen.queryByRole("button", { name: "Create scenario draft" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to choices" }));
    expect(screen.getByRole("button", { name: "Create scenario draft" })).toBeInTheDocument();
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-back-to", "/more");
  });

  it("takes a capacity refusal directly to all saved worlds without claiming stop frees space", async () => {
    const user = userEvent.setup();
    createRunMock.mockRejectedValueOnce(new ApiError("All 12 saved Simulation slots are in use.", 429, { error: { status: 429, code: "simulation_institution_capacity", detail: "All 12 saved Simulation slots are in use.", resource: "worlds", limit: 12, request_id: "capacity-test" } }));
    retainedRunsMock.mockResolvedValue({ schema_version: 1, results: [], page: { number: 1, page_size: 5, total: 0, total_pages: 1 } });
    show();
    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    await user.click(screen.getByRole("button", { name: "Start baseline simulation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("All 12 saved Simulation slots");
    await user.click(screen.getByRole("button", { name: "Manage saved simulations" }));
    expect(await screen.findByRole("heading", { name: "Saved simulations" })).toBeVisible();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("starts an existing baseline draft from Recent without another capture", async () => {
    const user = userEvent.setup(), draft = runFixture({ id: "saved-baseline", kind: "baseline", name: "Saved baseline", can_open: false, available_actions: ["start", "stop"] });
    const running = runFixture({ ...draft, can_open: true, status: "running", available_actions: ["open", "pause", "stop"] });
    retainedRunsMock.mockResolvedValueOnce({ schema_version: 1, results: [draft], page: { number: 1, page_size: 5, total: 1, total_pages: 1 } }).mockResolvedValue({ schema_version: 1, results: [running], page: { number: 1, page_size: 5, total: 1, total_pages: 1 } });
    startRunMock.mockResolvedValue(response(running)); getRunMock.mockResolvedValue(response(running));
    selectEnvironmentMock.mockResolvedValueOnce(environmentFor(running));
    show({ mode: "live" }, "/more/simulation?panel=recent");
    await user.click(await screen.findByRole("button", { name: "More actions for Saved baseline" }));
    await user.click(screen.getByRole("button", { name: "Start saved simulation" }));
    expect(startRunMock).toHaveBeenCalledWith("school-1", "saved-baseline");
    expect(createRunMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved baseline started");
    expect(selectEnvironmentMock).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Open", exact: true }));
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "simulation", run_id: "saved-baseline" }));
  });

  it("retries the already saved baseline instead of accumulating new drafts after start refusal", async () => {
    const user = userEvent.setup(), draft = runFixture({ id: "saved-baseline", kind: "baseline" });
    const running = runFixture({ ...draft, status: "running", available_actions: ["open", "pause", "stop"] });
    createRunMock.mockResolvedValueOnce(response(draft));
    startRunMock.mockRejectedValueOnce(new ApiError("Stop a running simulation before starting another.", 429, { code: "simulation_institution_capacity", resource: "running_runs" })).mockResolvedValueOnce(response(running));
    getRunMock.mockResolvedValueOnce(response(draft)).mockResolvedValue(response(running)); selectEnvironmentMock.mockResolvedValueOnce(environmentFor(running));
    show();
    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    await user.click(screen.getByRole("button", { name: "Start baseline simulation" }));
    const retry = await screen.findByRole("button", { name: "Start saved baseline" });
    expect(screen.getByRole("combobox", { name: /^Simulation speed/ })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "simulation", run_id: "saved-baseline" }));
    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(startRunMock).toHaveBeenCalledTimes(2);
    expect(startRunMock.mock.calls.map(call => call[1])).toEqual(["saved-baseline", "saved-baseline"]);
  });

  it("checks the saved run after a lost Start response instead of starting it twice", async () => {
    const user = userEvent.setup(), draft = runFixture({ kind: "baseline" });
    const running = runFixture({ ...draft, status: "running", available_actions: ["open", "pause", "stop"] });
    createRunMock.mockResolvedValueOnce(response(draft));
    startRunMock.mockRejectedValueOnce(new TypeError("Start response lost after acceptance"));
    getRunMock.mockResolvedValue(response(running)); selectEnvironmentMock.mockResolvedValueOnce(environmentFor(running));
    show();
    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    await user.click(screen.getByRole("button", { name: "Start baseline simulation" }));
    await user.click(await screen.findByRole("button", { name: "Start saved baseline" }));
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "simulation", run_id: draft.id }));
    expect(createRunMock).toHaveBeenCalledTimes(1); expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(getRunMock).toHaveBeenCalledWith("school-1", draft.id);
  });

  it("retains the exact snapshot intent and locked settings after an unconfirmed capture response", async () => {
    const user = userEvent.setup(), draft = runFixture({ kind: "baseline" });
    createRunMock.mockRejectedValueOnce(new TypeError("Response lost")).mockResolvedValueOnce(response(draft));
    startRunMock.mockResolvedValue(response(runFixture({ ...draft, status: "running" })));
    selectEnvironmentMock.mockResolvedValueOnce(environmentFor(runFixture({ ...draft, status: "running" })));
    getRunMock.mockResolvedValue(response(runFixture({ ...draft, status: "running" })));
    show();
    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    await user.click(screen.getByRole("button", { name: "Start baseline simulation" }));
    const retry = await screen.findByRole("button", { name: "Retry snapshot" });
    expect(screen.getByRole("combobox", { name: /^Simulation speed/ })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(startRunMock).toHaveBeenCalled());
    expect(createRunMock.mock.calls[1]).toEqual(createRunMock.mock.calls[0]);
    expect(await screen.findByRole("heading", { name: draft.name })).toBeVisible();
  });

  it("captures, starts and opens a baseline without exposing an edit step", async () => {
    const user = userEvent.setup();
    const baselineDraft = runFixture({ id: "baseline-1", scenario_id: "scenario-baseline", namespace_id: "simulation:baseline-1", kind: "baseline", name: "Current campus baseline" });
    const baselineRunning = runFixture({ ...baselineDraft, status: "running", available_actions: ["open", "pause", "stop", "compare"] });
    createRunMock.mockResolvedValueOnce(response(baselineDraft));
    configureBehaviourMock.mockResolvedValueOnce(response(baselineDraft));
    startRunMock.mockResolvedValueOnce(response(baselineRunning));
    getRunMock.mockResolvedValue(response(baselineRunning));
    selectEnvironmentMock.mockResolvedValueOnce(environmentFor(baselineRunning));
    show();

    await user.click(screen.getByRole("button", { name: "Set up baseline" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /^Simulation speed/ }), "50");
    await user.click(screen.getByRole("checkbox", { name: /Stop at a simulated date and time/ }));
    const endLocal = "2030-01-03T04:00";
    fireEvent.input(screen.getByLabelText(/End date and time/), { target: { value: endLocal } });
    await user.click(screen.getByRole("button", { name: /Synthetic activity models/ }));
    await user.click(screen.getByRole("checkbox", { name: /Model routine attendance/ }));
    await user.click(screen.getByRole("button", { name: "Start baseline simulation" }));

    const endAt = new Date(endLocal).toISOString();
    await waitFor(() => expect(createRunMock).toHaveBeenCalledWith("school-1", expect.objectContaining({ kind: "baseline", speed: 50, end_at: endAt })));
    expect(configureBehaviourMock).toHaveBeenCalledWith("school-1", "baseline-1", {
      schema_version: 2,
      attendance: { enabled: true, present: .88, late: .04, absent: .04, excused: .04, submission_delay_minutes: 10 },
      coverage_offers: { enabled: false, accepted: .65, declined: .25, no_response: .1, response_delay_minutes: 15 },
      invigilation_offers: { enabled: false, accepted: .75, declined: .15, no_response: .1, response_delay_minutes: 60 },
    });
    expect(startRunMock).toHaveBeenCalledWith("school-1", "baseline-1", { speed: 50, end_at: endAt });
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "simulation", run_id: "baseline-1" }));
    expect(await screen.findByRole("heading", { name: "Current campus baseline" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit this isolated campus" })).not.toBeInTheDocument();
  });

  it("opens a scenario draft in the same app, exposes standard editors, then starts it", async () => {
    const user = userEvent.setup();
    const draft = runFixture({
      draft_changes: [{ id: "change-1", domain: "timetable", change_kind: "update", target_ref: "period-1", summary: "Moved Year 8 science to period 3", recorded_at: "2026-10-19T04:03:00.000Z", source_revision: "8" }],
    });
    createRunMock.mockResolvedValueOnce(response(draft));
    getRunMock.mockResolvedValue(response(draft));
    selectEnvironmentMock.mockResolvedValueOnce(environmentFor(draft));
    show();

    await user.click(screen.getByRole("button", { name: "Create scenario draft" }));
    await waitFor(() => expect(createRunMock).toHaveBeenCalledWith("school-1", expect.objectContaining({ kind: "scenario", speed: 20, end_at: null })));
    await waitFor(() => expect(selectEnvironmentMock).toHaveBeenCalledWith({ mode: "simulation", run_id: "run-1" }));
    expect(startRunMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Edit this isolated campus" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Timetable/ })).toHaveAttribute("href", "/areas/timetable/planning");
    expect(screen.getByRole("link", { name: /Operating rules/ })).toHaveAttribute("href", "/more/setup/institution/operating-rules");
    expect(screen.getByText("Moved Year 8 science to period 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue to run settings/ }));
    const settingsHeading = await screen.findByRole("heading", { name: "Run settings" });
    await waitFor(() => expect(settingsHeading).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith("school-1", "run-1", { speed: 20, end_at: null }));
  });

  it("manages recent runs and compares values at an aligned duration", async () => {
    const user = userEvent.setup();
    const first = runFixture({ id: "run-first", name: "Baseline Monday", kind: "baseline", status: "completed" });
    const second = runFixture({ id: "run-second", name: "Later lunch", status: "paused", available_actions: ["open", "resume", "stop", "duplicate", "compare"] });
    retainedRunsMock.mockResolvedValue({ schema_version: 1, results: [first, second], page: { number: 1, page_size: 5, total: 2, total_pages: 1 } });
    compareRunsMock.mockResolvedValue({
      schema_version: 1,
      comparison: {
        duration_ms: 86_400_000,
        controlled_snapshot: true,
        provenance_warning: null,
        runs: [
          { run_id: first.id, name: first.name, kind: first.kind, status: first.status, snapshot: first.snapshot!, actual_duration_ms: 86_400_000 },
          { run_id: second.id, name: second.name, kind: second.kind, status: second.status, snapshot: second.snapshot!, actual_duration_ms: 86_400_000 },
        ],
        metrics: [{
          key: "coverage_gap",
          label: "Coverage gaps",
          unit: "sessions",
          values: [
            { run_id: first.id, value: 4, measured_at: "2026-10-20T04:00:00.000Z" },
            { run_id: second.id, value: 1, measured_at: "2026-10-20T04:00:00.000Z" },
          ],
          deltas_from_first: [{ run_id: second.id, delta: -3, delta_percent: -75 }],
        }],
      },
    });
    show();

    await user.click(screen.getByRole("button", { name: "Saved simulations" }));
    expect(await screen.findByRole("heading", { name: "Baseline Monday" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open" })).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "More actions for Baseline Monday" }));
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(duplicateRunMock).toHaveBeenCalledWith("school-1", "run-first", expect.objectContaining({ kind: "scenario", speed: 20 })));
    await user.click(screen.getByRole("button", { name: "More actions for Later lunch" }));
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resumeRunMock).toHaveBeenCalledWith("school-1", "run-second", { speed: 20 }));

    await user.click(screen.getByRole("button", { name: "Compare runs" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Baseline Monday for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Later lunch for comparison" }));
    await user.click(screen.getByRole("button", { name: "Compare selected" }));

    expect(await screen.findByRole("heading", { name: /Runs aligned at 1d simulated/ })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Baseline Monday" })).toBeInTheDocument();
    expect(within(table).getByText("-3 from first")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to simulations" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it.each<SimulationRunStatus>(["preparing", "failed"])("does not fabricate snapshot evidence for a %s run", async (status) => {
    const run = runFixture({
      status,
      snapshot: null,
      world: null,
      available_actions: status === "preparing" ? [] : ["duplicate"],
      can_open: true,
    });
    getRunMock.mockResolvedValue(response(run));
    show(environmentFor(run));

    expect(await screen.findByText("Snapshot is being prepared")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("opens a retained terminal world as a frozen read-only campus", async () => {
    const stopped = runFixture({ status: "stopped", name: "Retained staffing result" });
    getRunMock.mockResolvedValue(response(stopped));
    show(environmentFor(stopped));

    expect(await screen.findByRole("heading", { name: "Retained staffing result" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open frozen Today/ })).toHaveAttribute("href", "/today");
    expect(screen.getByText(/read-only record/i)).toBeInTheDocument();
  });
});
