import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveSimulationWorkspace } from "./ActiveSimulationWorkspace";
import { ApplicationExecutionEnvironmentProvider } from "./ApplicationExecutionEnvironment";
import { createSimulationExecutionEnvironment } from "./executionEnvironment";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";
import {
  configureSimulationBehaviour,
  getSimulationRun,
  getSimulationRunResources,
  pauseSimulationRun,
  resumeSimulationRun,
  startSimulationRun,
  stopSimulationRun,
  updateSimulationDraft,
  type SimulationRunView,
} from "./simulationApi";

vi.mock("./executionEnvironmentApi", () => ({
  getExecutionEnvironment: vi.fn(),
  selectExecutionEnvironment: vi.fn(),
}));
vi.mock("./ScenarioEditorLinks", () => ({ ScenarioEditorLinks: () => <nav aria-label="Scenario editors" /> }));
vi.mock("./simulationApi", () => ({
  configureSimulationBehaviour: vi.fn(),
  getSimulationRun: vi.fn(),
  getSimulationRunResources: vi.fn(),
  pauseSimulationRun: vi.fn(),
  resumeSimulationRun: vi.fn(),
  startSimulationRun: vi.fn(),
  stopSimulationRun: vi.fn(),
  updateSimulationDraft: vi.fn(),
}));

const getRunMock = vi.mocked(getSimulationRun);
const getResourcesMock = vi.mocked(getSimulationRunResources);
const updateDraftMock = vi.mocked(updateSimulationDraft);
const configureBehaviourMock = vi.mocked(configureSimulationBehaviour);
const startRunMock = vi.mocked(startSimulationRun);
const pauseRunMock = vi.mocked(pauseSimulationRun);
const resumeRunMock = vi.mocked(resumeSimulationRun);
const stopRunMock = vi.mocked(stopSimulationRun);

function changeFixture(index: number) {
  return {
    id: `change-${index}`,
    domain: "timetable",
    change_kind: "update",
    target_ref: `period-${index}`,
    summary: `Scenario change ${index}`,
    recorded_at: `2020-01-01T0${index}:00:00.000Z`,
    source_revision: String(index),
  };
}

function runFixture(overrides: Partial<SimulationRunView> = {}): SimulationRunView {
  const status = overrides.status ?? "draft";
  return {
    id: "run-1",
    scenario_id: "scenario-1",
    namespace_id: "simulation:run-1",
    kind: "scenario",
    name: "Alternative staffing",
    status,
    created_at: "2020-01-01T04:00:00.000Z",
    updated_at: "2020-01-01T04:01:00.000Z",
    started_at: status === "running" || status === "paused" ? "2020-01-01T04:01:00.000Z" : null,
    paused_at: status === "paused" ? "2020-01-01T04:02:00.000Z" : null,
    stopped_at: status === "stopped" ? "2020-01-01T04:03:00.000Z" : null,
    completed_at: status === "completed" ? "2020-01-01T04:03:00.000Z" : null,
    failure_reason: status === "failed" ? "The run could not advance." : null,
    created_by_me: true,
    speed: 20,
    clock: {
      virtual_now: "2020-01-02T04:00:00.000Z",
      time_zone: "UTC",
      simulated_elapsed_ms: 86_400_000,
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
      captured_at: "2020-01-01T04:00:00.000Z",
      source_revisions: { timetable: "7", people: "11" },
    },
    world: { ref: "world-1", revision: 3, manifest_ref: "manifest-1", limitations: [] },
    progress: { event_count: 7, checkpoint_count: 2, last_checkpoint_at: "2020-01-02T04:00:00.000Z", next_wake_at: null },
    metrics: [],
    draft_changes: [],
    behaviour: null,
    retention: { pinned: false, pinned_at: null, expires_at: null, policy_version: 1, state: "retained", world_discarded_at: null },
    resources: { reservation_bytes: 0, observed_storage_bytes: 0, measured_at: null, paused_at: null, pause_reason: null, lease_recovery_count: 0 },
    ...overrides,
  };
}

function response(run: SimulationRunView) {
  return { schema_version: 1 as const, run };
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

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current query">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
    </>
  );
}

function show(run: SimulationRunView, entry = "/more/simulation") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  getRunMock.mockResolvedValue(response(run));
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ApplicationExecutionEnvironmentProvider confirmedEnvironment={environmentFor(run)}>
          <NavigationProbe />
          <ActiveSimulationWorkspace schoolId="school-1" />
        </ApplicationExecutionEnvironmentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getResourcesMock.mockResolvedValue({
    schema_version: 1,
    run_id: "run-1",
    counts: { effects: {}, artifacts: 0, artifact_bytes: 0 },
    effects: { page: 1, page_size: 5, total: 0, results: [] },
  });
  pauseRunMock.mockResolvedValue(response(runFixture({ status: "paused" })));
  resumeRunMock.mockResolvedValue(response(runFixture({ status: "running" })));
  stopRunMock.mockResolvedValue(response(runFixture({ status: "stopped" })));
});

afterEach(cleanup);

describe("ActiveSimulationWorkspace progressive navigation", () => {
  it("refreshes a fresh cached draft ledger when returning from any ordinary editor", async () => {
    const user = userEvent.setup();
    const draft = runFixture();
    const updated = runFixture({ draft_changes: [changeFixture(1)] });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    });
    const runKey = executionEnvironmentQueryKey(environmentFor(draft), ["simulation-run", "school-1", draft.id]);
    getRunMock.mockResolvedValueOnce(response(draft)).mockResolvedValue(response(updated));
    const rendered = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/more/simulation"]}>
          <ApplicationExecutionEnvironmentProvider confirmedEnvironment={environmentFor(draft)}>
            <Routes>
              <Route path="/more/simulation" element={<>
                <Link to="/areas/campus">Open ordinary editor</Link>
                <ActiveSimulationWorkspace schoolId="school-1" />
              </>} />
              <Route path="/areas/campus" element={<>
                <h1>Ordinary campus editor</h1>
                <Link to="/more/simulation">Return to scenario</Link>
              </>} />
            </Routes>
          </ApplicationExecutionEnvironmentProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Scenario changes 0" })).toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("link", { name: "Open ordinary editor" }));
    expect(await screen.findByRole("heading", { name: "Ordinary campus editor" })).toBeInTheDocument();
    expect(client.getQueryState(runKey)?.isInvalidated).toBe(false);
    expect(getRunMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("link", { name: "Return to scenario" }));
    expect(await screen.findByRole("heading", { name: "Scenario changes 1" })).toBeInTheDocument();
    expect(screen.getByText("Scenario change 1")).toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledTimes(2);
    rendered.unmount();
    client.clear();
  });

  it("keeps mounted draft controls and unsaved input during the return refresh", async () => {
    const user = userEvent.setup();
    const draft = runFixture();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    });
    const runKey = executionEnvironmentQueryKey(environmentFor(draft), ["simulation-run", "school-1", draft.id]);
    client.setQueryData(runKey, response(draft));
    let finishRefresh!: (result: ReturnType<typeof response>) => void;
    const refresh = new Promise<ReturnType<typeof response>>((resolve) => { finishRefresh = resolve; });
    getRunMock.mockReturnValue(refresh);
    const rendered = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/more/simulation?view=settings"]}>
          <ApplicationExecutionEnvironmentProvider confirmedEnvironment={environmentFor(draft)}>
            <ActiveSimulationWorkspace schoolId="school-1" />
          </ApplicationExecutionEnvironmentProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const name = await screen.findByRole("textbox", { name: /Name/ });
    await waitFor(() => expect(getRunMock).toHaveBeenCalledTimes(1));
    await user.clear(name);
    await user.type(name, "Unsaved local alternative");
    await user.selectOptions(screen.getByRole("combobox", { name: "Simulation speed" }), "50");
    await user.click(screen.getByRole("checkbox", { name: /Stop at a simulated date and time/ }));
    await user.type(screen.getByLabelText(/End date and time/), "2020-01-03T04:00");
    await user.click(screen.getByRole("button", { name: /Synthetic activity models/ }));
    await user.click(screen.getByRole("checkbox", { name: /Model routine attendance/ }));
    name.focus();

    await act(async () => {
      finishRefresh(response(runFixture({
        name: "Server-side alternative",
        speed: 10,
        draft_changes: [changeFixture(1)],
      })));
      await refresh;
    });

    expect(screen.getByRole("textbox", { name: /Name/ })).toBe(name);
    expect(name).toHaveValue("Unsaved local alternative");
    expect(name).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Simulation speed" })).toHaveValue("50");
    expect(screen.getByLabelText(/End date and time/)).toHaveValue("2020-01-03T04:00");
    expect(screen.getByRole("checkbox", { name: /Model routine attendance/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(await screen.findByRole("heading", { name: "Scenario changes 1" })).toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledTimes(1);
    rendered.unmount();
    client.clear();
  });

  it("bounds change pages in the URL, preserves Back history, and focuses each changed page", async () => {
    const user = userEvent.setup();
    const draft = runFixture({ draft_changes: [1, 2, 3, 4].map(changeFixture) });
    show(draft, "/more/simulation?keep=1&changesPage=99");

    const editHeading = await screen.findByRole("heading", { name: "Edit this isolated campus" });
    await waitFor(() => expect(editHeading).toHaveFocus());
    await waitFor(() => expect(screen.getByLabelText("Current query")).toHaveTextContent("keep=1&changesPage=2"));
    expect(screen.getByText("Scenario change 4")).toBeInTheDocument();
    expect(screen.queryByText("Scenario change 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Next/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Previous/ }));
    await waitFor(() => expect(screen.getByLabelText("Current query")).toHaveTextContent("?keep=1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Scenario changes/ })).toHaveFocus());
    expect(screen.getByText("Scenario change 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await waitFor(() => expect(screen.getByLabelText("Current query")).toHaveTextContent("changesPage=2"));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Scenario changes/ })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Browser back" }));
    await waitFor(() => expect(screen.getByLabelText("Current query")).toHaveTextContent("?keep=1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Scenario changes/ })).toHaveFocus());
    expect(screen.getByText("Scenario change 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue to run settings/ }));
    const settingsHeading = await screen.findByRole("heading", { name: "Run settings" });
    await waitFor(() => expect(settingsHeading).toHaveFocus());
    expect(screen.getByLabelText("Current query")).toHaveTextContent("view=settings");
    await user.click(screen.getByRole("button", { name: "Browser back" }));
    const returnedEditHeading = await screen.findByRole("heading", { name: "Edit this isolated campus" });
    await waitFor(() => expect(returnedEditHeading).toHaveFocus());
  });

  it("patches changed settings before behaviour and start, using the simulated clock for a finite end", async () => {
    const user = userEvent.setup();
    const draft = runFixture();
    const updated = runFixture({ name: "Staffing v2", speed: 50, clock: { ...draft.clock, end_at: "2020-01-03T04:00:00.000Z", unbounded: false } });
    const running = runFixture({ ...updated, status: "running", available_actions: ["open", "pause", "stop", "duplicate", "compare"] });
    getRunMock.mockResolvedValueOnce(response(draft));
    updateDraftMock.mockResolvedValue(response(updated));
    configureBehaviourMock.mockResolvedValue(response(updated));
    startRunMock.mockResolvedValue(response(running));
    show(draft, "/more/simulation?view=settings");
    getRunMock.mockResolvedValue(response(running));

    const name = await screen.findByRole("textbox", { name: /Name/ });
    await user.clear(name);
    await user.type(name, "Staffing v2");
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Staffing v2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Simulation speed" }), "50");
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Staffing v2");
    await user.click(screen.getByRole("checkbox", { name: /Stop at a simulated date and time/ }));
    await user.type(screen.getByLabelText(/End date and time/), "2020-01-03T04:00");
    await user.click(screen.getByRole("button", { name: /Synthetic activity models/ }));
    await user.click(screen.getByRole("checkbox", { name: /Model routine attendance/ }));
    expect(name).toHaveValue("Staffing v2");
    expect(screen.queryByRole("spinbutton", { name: /Present/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Adjust attendance pattern" }));
    expect(screen.getByRole("spinbutton", { name: /Present/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    await waitFor(() => expect(startRunMock).toHaveBeenCalled());
    const expectedEndAt = new Date("2020-01-03T04:00").toISOString();
    expect(updateDraftMock).toHaveBeenCalledWith("school-1", "run-1", {
      name: "Staffing v2",
      speed: 50,
      end_at: expectedEndAt,
    });
    expect(configureBehaviourMock).toHaveBeenCalledWith("school-1", "run-1", expect.any(Object));
    expect(configureBehaviourMock.mock.calls[0]?.[2].attendance.enabled).toBe(true);
    expect(startRunMock).toHaveBeenCalledWith("school-1", "run-1", {
      speed: 50,
      end_at: expectedEndAt,
    });
    expect(updateDraftMock.mock.invocationCallOrder[0]).toBeLessThan(configureBehaviourMock.mock.invocationCallOrder[0]!);
    expect(configureBehaviourMock.mock.invocationCallOrder[0]).toBeLessThan(startRunMock.mock.invocationCallOrder[0]!);
    expect(await screen.findByRole("heading", { name: "Simulation overview" })).toBeInTheDocument();
  });

  it("keeps the backend run bound to the session while switching between overview and empty results", async () => {
    const user = userEvent.setup();
    const running = runFixture({
      status: "running",
      world: { ref: "world-1", revision: 3, manifest_ref: "manifest-1", limitations: ["Outbound messages", "Live cameras"] },
      draft_changes: [1, 2, 3, 4].map(changeFixture),
    });
    show(running, "/more/simulation?run=forged-run&view=results");

    const resultsHeading = await screen.findByRole("heading", { name: "Simulation results" });
    await waitFor(() => expect(resultsHeading).toHaveFocus());
    expect(screen.getByText("No measured results yet")).toBeInTheDocument();
    expect(screen.getByText("Scenario change 1")).toBeInTheDocument();
    expect(screen.queryByText("Scenario change 4")).not.toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledWith("school-1", "run-1", expect.anything());
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Scenario changes/ })).toHaveFocus());
    expect(screen.getByText("Scenario change 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Current query")).toHaveTextContent("changesPage=2");

    await user.click(screen.getByRole("button", { name: "Back to overview" }));
    const overviewHeading = await screen.findByRole("heading", { name: "Simulation overview" });
    await waitFor(() => expect(overviewHeading).toHaveFocus());
    expect(screen.getByLabelText("Current query")).toHaveTextContent("run=forged-run&view=overview");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop simulation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to Live" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Today/ })).toHaveAttribute("href", "/today");
    const limitations = screen.getByText("Not modelled in this run").closest("details");
    expect(limitations).not.toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "Results" }));
    expect(await screen.findByText("Scenario change 4")).toBeInTheDocument();
  });

  it("retains a terminal world as a frozen read-only overview", async () => {
    show(runFixture({ status: "stopped", name: "Retained staffing result" }));

    expect(await screen.findByRole("heading", { name: "Simulation overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open frozen Today" })).toHaveAttribute("href", "/today");
    expect(screen.getByText(/read-only record/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop simulation/ })).not.toBeInTheDocument();
  });

  it("keeps entering the simulated campus as the primary paused-run action", async () => {
    show(runFixture({ status: "paused" }));

    const openToday = await screen.findByRole("link", { name: /Open Today/ });
    const resume = screen.getByRole("button", { name: "Resume" });
    expect(openToday).toHaveClass("simulation-button--primary");
    expect(resume).toHaveClass("simulation-button--secondary");
    expect(openToday.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("explains a resource pause without treating a compatibility condition as storage loss", async () => {
    const user = userEvent.setup();
    show(runFixture({
      status: "paused",
      resources: {
        reservation_bytes: 2_048,
        observed_storage_bytes: 1_024,
        measured_at: "2020-01-01T04:02:00.000Z",
        paused_at: "2020-01-01T04:02:00.000Z",
        pause_reason: "snapshot_schema_incompatible:v2",
        lease_recovery_count: 0,
      },
    }));

    const notice = await screen.findByRole("status", { name: "Simulation advancement paused" });
    expect(notice).toHaveTextContent(/retained snapshot needs a compatible Simulation runtime/i);
    expect(notice).toHaveTextContent(/isolated world was retained; no active world was deleted/i);
    expect(notice).toHaveTextContent(/then choose Resume/i);
    expect(notice).not.toHaveTextContent(/capacity limit/i);
    const details = screen.getByText("Pause details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("snapshot_schema_incompatible:v2")).not.toBeVisible();
    await user.click(screen.getByText("Pause details"));
    expect(screen.getByText("snapshot_schema_incompatible:v2")).toBeVisible();
  });
});
