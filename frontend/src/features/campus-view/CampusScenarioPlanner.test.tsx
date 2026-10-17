import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusScenarioPlanner } from "./CampusScenarioPlanner";
import { createCampusScenario, discardCampusScenario, getCampusScenario, getCampusScenarioTargets } from "./scenarioApi";
import type { CampusScenarioResponse } from "./scenarioApi";

vi.mock("./scenarioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scenarioApi")>();
  return { ...actual, createCampusScenario: vi.fn(), getCampusScenario: vi.fn(), getCampusScenarioTargets: vi.fn(), discardCampusScenario: vi.fn() };
});

const createMock = vi.mocked(createCampusScenario);
const getMock = vi.mocked(getCampusScenario);
const targetsMock = vi.mocked(getCampusScenarioTargets);
const discardMock = vi.mocked(discardCampusScenario);

const result: CampusScenarioResponse = {
  schema_version: 1,
  evidence_mode: "simulation",
  run: {
    id: "scenario-1",
    status: "completed",
    created_at: "2026-10-17T08:00:00.000Z",
    snapshot_at: "2026-10-17T08:00:00.000Z",
    expires_at: "2026-10-18T08:00:00.000Z",
    horizon_days: 30,
    intervention: { type: "teacher_unavailable", target_id: "teacher-1", target_label: "Kavita Mehta", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T15:30:00.000Z" },
    assumptions: ["Published timetable remains unchanged."],
    unsupported_domains: ["Transport routing"],
    metrics: [{
      key: "uncovered_sessions",
      label: "Uncovered teaching sessions",
      unit: "sessions",
      direction: "lower",
      baseline: { p10: null, p50: 1, p90: null },
      scenario: { p10: null, p50: 4, p90: null },
      availability: "partial",
      unavailable_reason: "No validated cohort behaviour policy is active.",
      explanation: "Scheduled sessions without confirmed cover.",
    }],
    progress: 100,
    failure_reason: null,
    side_effect_policy: { mode: "sink_only", production_writes: false, production_messages: false, production_connectors: false },
    source_snapshot: {
      hash: "snapshot-hash",
      schedule_revision_max: 4,
      space_revision_max: 3,
      agent_revision_max: 2,
      coverage_evidence_revision: null,
      counts: { sessions: 40, spaces: 28, teachers: 17, enrolments: 200 },
      captured_at: "2026-10-17T08:00:00.000Z",
      consistency: "repeatable_read_transaction",
    },
    uncertainty_status: "deterministic",
    stochastic_policy: null,
  },
};

function renderPlanner(overrides?: { teachers?: Array<{ id: string; label: string }>; spaces?: Array<{ id: string; label: string }> }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CampusScenarioPlanner
    schoolId="school-1"
    campusId="campus-1"
    timezone="Asia/Kolkata"
    teachers={overrides?.teachers ?? [{ id: "teacher-1", label: "Kavita Mehta" }]}
    spaces={overrides?.spaces ?? [{ id: "room-201", label: "Classroom 201" }]}
  /></QueryClientProvider>);
}

beforeEach(() => {
  createMock.mockReset();
  getMock.mockReset();
  targetsMock.mockReset();
  discardMock.mockReset();
  createMock.mockResolvedValue(result);
  getMock.mockResolvedValue(result);
  targetsMock.mockResolvedValue({
    schema_version: 1,
    evidence_mode: "simulation",
    campus_id: "campus-1",
    horizon_days: 30,
    horizon: { from: "2026-10-17T08:00:00.000Z", to: "2026-11-16T08:00:00.000Z" },
    teachers: [{
      id: "teacher-1", label: "Kavita Mehta", session_dates: ["2026-10-19"], suggested_date: "2026-10-19",
      session_windows: [
        { date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" },
        { date: "2026-10-19", starts_at: "2026-10-19T14:30:00.000Z", ends_at: "2026-10-19T15:30:00.000Z" },
      ],
      date_windows: [{ date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T15:30:00.000Z" }],
      suggested_window: { starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" },
    }],
    spaces: [{
      id: "room-201", label: "Classroom 201", kind: "classroom", capacity: 30, session_dates: ["2026-10-19"], suggested_date: "2026-10-19",
      session_windows: [{ date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" }],
      date_windows: [{ date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" }],
      suggested_window: { starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" },
    }],
  });
  discardMock.mockResolvedValue({ schema_version: 1, evidence_mode: "simulation", discarded: true, run_id: "scenario-1" });
});
afterEach(() => cleanup());

describe("CampusScenarioPlanner", () => {
  it("runs an isolated bounded scenario and explains deterministic uncertainty", async () => {
    const user = userEvent.setup();
    renderPlanner();

    expect(screen.getByText(/No live changes or messages/i)).toBeInTheDocument();
    await screen.findByText(/Eligible teachers and spaces come from scheduled sessions/i);
    expect(screen.getByRole("combobox", { name: "Teacher" })).toHaveValue("teacher-1");
    await user.click(screen.getByRole("button", { name: "Run isolated scenario" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledOnce());
    expect(createMock.mock.calls[0]?.[0]).toBe("school-1");
    expect(createMock.mock.calls[0]?.[1]).toEqual({
      campus_id: "campus-1",
      horizon_days: 30,
      intervention: {
        type: "teacher_unavailable",
        target_id: "teacher-1",
        starts_at: "2026-10-19T12:30:00.000Z",
        ends_at: "2026-10-19T15:30:00.000Z",
      },
    });
    expect(await screen.findByRole("heading", { name: "Kavita Mehta unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("With change")).toBeInTheDocument();
    expect(screen.getByText("Point estimate")).toBeInTheDocument();
    expect(screen.getByText(/Point estimate from this snapshot/i)).toBeInTheDocument();
    expect(screen.queryByText(/P10–P90/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Transport routing/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard scenario" }));
    await waitFor(() => expect(discardMock).toHaveBeenCalledWith("school-1", "scenario-1"));
    expect(await screen.findByRole("button", { name: "Run isolated scenario" })).toBeInTheDocument();
  });

  it("does not expose free-form identifiers when the snapshot has no eligible teacher", async () => {
    const user = userEvent.setup();
    targetsMock.mockResolvedValue({ schema_version: 1, evidence_mode: "simulation", campus_id: "campus-1", horizon_days: 30, horizon: { from: "2026-10-17T08:00:00.000Z", to: "2026-11-16T08:00:00.000Z" }, teachers: [], spaces: [{ id: "room-201", label: "Classroom 201", kind: "classroom", capacity: 30, session_dates: ["2026-10-19"], session_windows: [{ date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" }], date_windows: [{ date: "2026-10-19", starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" }], suggested_date: "2026-10-19", suggested_window: { starts_at: "2026-10-19T12:30:00.000Z", ends_at: "2026-10-19T13:30:00.000Z" } }] });
    renderPlanner({ teachers: [] });

    await screen.findByText(/Eligible teachers and spaces come from scheduled sessions/i);
    expect(screen.getByRole("button", { name: "Teacher unavailable" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Campus space" })).toHaveValue("room-201");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run isolated scenario" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledOnce());
    expect(createMock.mock.calls[0]?.[0]).toBe("school-1");
    expect(createMock.mock.calls[0]?.[1].intervention).toMatchObject({ type: "space_unavailable", target_id: "room-201" });
  });

  it("shows a recoverable catalogue error instead of unusable disabled controls", async () => {
    const user = userEvent.setup();
    targetsMock.mockRejectedValue(new Error("offline"));
    renderPlanner();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Planning options couldn’t be loaded/i);
    expect(screen.queryByRole("combobox", { name: "Teacher" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run isolated scenario" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(targetsMock).toHaveBeenCalledTimes(2));
  });

  it("explains an empty published plan and lets the operator broaden or refresh it", async () => {
    const user = userEvent.setup();
    targetsMock.mockResolvedValue({
      schema_version: 1,
      evidence_mode: "simulation",
      campus_id: "campus-1",
      horizon_days: 30,
      horizon: { from: "2026-10-17T08:00:00.000Z", to: "2026-11-16T08:00:00.000Z" },
      teachers: [],
      spaces: [],
    });
    renderPlanner();

    expect(await screen.findByText("No future sessions available")).toBeInTheDocument();
    expect(screen.getByText(/no eligible teacher or space sessions/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run isolated scenario" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check 14 days" }));
    await waitFor(() => expect(targetsMock).toHaveBeenLastCalledWith(
      "school-1",
      { campusId: "campus-1", horizonDays: 14 },
      expect.anything(),
    ));
  });

  it("does not present an unavailable behaviour estimate as zero", async () => {
    const unavailable = {
      ...result,
      run: {
        ...result.run,
        metrics: [{
          ...result.run.metrics[0]!,
          key: "modelled_response_acceptances",
          label: "Modelled cohort responses",
          baseline: { p10: null, p50: 0, p90: null },
          scenario: { p10: null, p50: 0, p90: null },
          availability: "unavailable" as const,
          unavailable_reason: "No reviewed cohort behaviour policy is active.",
        }],
      },
    };
    createMock.mockResolvedValue(unavailable);
    getMock.mockResolvedValue(unavailable);
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByText(/Eligible teachers and spaces come from scheduled sessions/i);
    await user.click(screen.getByRole("button", { name: "Run isolated scenario" }));

    const metric = (await screen.findByText("Modelled cohort responses")).closest("li");
    expect(metric).not.toBeNull();
    expect(within(metric!).getAllByText("Unavailable")).toHaveLength(2);
    expect(within(metric!).queryByText("0 sessions")).not.toBeInTheDocument();
  });

  it("shows quantiles only for a calibrated ensemble", async () => {
    const calibrated: CampusScenarioResponse = {
      ...result,
      run: {
        ...result.run,
        uncertainty_status: "calibrated_ensemble",
        stochastic_policy: {
          policy_id: "coverage-response",
          version_id: "policy-version-1",
          configuration_hash: "policy-hash",
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          calibration: { method: "historical_coverage_reviewed", calibrated_at: "2026-10-16T00:00:00.000Z", sample_size: 45, window: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" } },
          parameters: {},
        },
        metrics: [{
          ...result.run.metrics[0]!,
          baseline: { p10: 0, p50: 1, p90: 2 },
          scenario: { p10: 2, p50: 4, p90: 7 },
          availability: "available",
          unavailable_reason: null,
        }],
      },
    };
    createMock.mockResolvedValue(calibrated);
    getMock.mockResolvedValue(calibrated);
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByText(/Eligible teachers and spaces come from scheduled sessions/i);
    await user.click(screen.getByRole("button", { name: "Run isolated scenario" }));

    expect(await screen.findByText("P50 estimate")).toBeInTheDocument();
    expect(screen.getByText(/P10–P90 estimate/i)).toBeInTheDocument();
  });
});
