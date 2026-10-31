import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import {
  compareSimulationRuns,
  configureSimulationBehaviour,
  createSimulationRun,
  duplicateSimulationRun,
  getSimulationRun,
  getSimulationRunResources,
  listSimulationRuns,
  listRetainedSimulationRuns,
  removeSimulationRun,
  pauseSimulationRun,
  pinSimulationRun,
  resumeSimulationRun,
  startSimulationRun,
  stopSimulationRun,
  updateSimulationDraft,
  unpinSimulationRun,
} from "./simulationApi";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => apiFetchMock.mockReset());

describe("simulationApi", () => {
  it("binds draft discard Stop to the exact reviewed revision and draft state", async () => {
    apiFetchMock.mockResolvedValue({});
    await stopSimulationRun("school-1", "run-1", { expected_revision: 17, expected_status: "draft" });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/schools/school-1/simulation/runs/run-1/stop", {
      method: "POST", body: JSON.stringify({ expected_revision: 17, expected_status: "draft" }),
    });
  });
  it("pages all retained worlds and removes only an exact displayed control revision", async () => {
    apiFetchMock.mockResolvedValue({});
    await listRetainedSimulationRuns("school one", 3);
    await removeSimulationRun("school one", "run/one", { expected_revision: 7 });
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/v1/schools/school%20one/simulation/runs?view=retained&page=3", { signal: undefined });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/v1/schools/school%20one/simulation/runs/run%2Fone/remove", { method: "POST", body: JSON.stringify({ expected_revision: 7 }) });
  });
  it("uses the durable institution simulation collection for create, list and detail", async () => {
    apiFetchMock.mockResolvedValue({});

    await createSimulationRun("school one", {
      kind: "scenario",
      name: "Alternative week",
      speed: 20,
      end_at: null,
      idempotency_key: "request-1",
    });
    await listSimulationRuns("school one", 10);
    await getSimulationRun("school one", "run/one");

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/v1/schools/school%20one/simulation/runs", {
      method: "POST",
      body: JSON.stringify({ kind: "scenario", name: "Alternative week", speed: 20, end_at: null, idempotency_key: "request-1" }),
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/v1/schools/school%20one/simulation/runs?limit=10", { signal: undefined });
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, "/api/v1/schools/school%20one/simulation/runs/run%2Fone", { signal: undefined });
  });

  it("uses explicit lifecycle commands and draft updates", async () => {
    apiFetchMock.mockResolvedValue({});

    await updateSimulationDraft("school-1", "run-1", { name: "Revised", speed: 50, end_at: null });
    await configureSimulationBehaviour("school-1", "run-1", {
      schema_version: 2,
      attendance: { enabled: true, present: .88, late: .04, absent: .04, excused: .04, submission_delay_minutes: 10 },
      coverage_offers: { enabled: true, accepted: .65, declined: .25, no_response: .1, response_delay_minutes: 15 },
      invigilation_offers: { enabled: false, accepted: 0, declined: 0, no_response: 1, response_delay_minutes: 60 },
    });
    await startSimulationRun("school-1", "run-1", { speed: 50, end_at: null });
    await pauseSimulationRun("school-1", "run-1");
    await resumeSimulationRun("school-1", "run-1", { speed: 20 });
    await stopSimulationRun("school-1", "run-1");
    await pinSimulationRun("school-1", "run-1");
    await unpinSimulationRun("school-1", "run-1");

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/v1/schools/school-1/simulation/runs/run-1/draft", expect.objectContaining({ method: "PATCH" }));
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/v1/schools/school-1/simulation/runs/run-1/behaviour", expect.objectContaining({ method: "PUT" }));
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, "/api/v1/schools/school-1/simulation/runs/run-1/start", { method: "POST", body: JSON.stringify({ speed: 50, end_at: null }) });
    expect(apiFetchMock).toHaveBeenNthCalledWith(4, "/api/v1/schools/school-1/simulation/runs/run-1/pause", { method: "POST", body: JSON.stringify({}) });
    expect(apiFetchMock).toHaveBeenNthCalledWith(5, "/api/v1/schools/school-1/simulation/runs/run-1/resume", { method: "POST", body: JSON.stringify({ speed: 20 }) });
    expect(apiFetchMock).toHaveBeenNthCalledWith(6, "/api/v1/schools/school-1/simulation/runs/run-1/stop", { method: "POST", body: JSON.stringify({}) });
    expect(apiFetchMock).toHaveBeenNthCalledWith(7, "/api/v1/schools/school-1/simulation/runs/run-1/pin", { method: "POST" });
    expect(apiFetchMock).toHaveBeenNthCalledWith(8, "/api/v1/schools/school-1/simulation/runs/run-1/unpin", { method: "POST" });
  });

  it("reads only paged, redacted Simulation effect evidence", async () => {
    apiFetchMock.mockResolvedValue({});

    await getSimulationRunResources("school one", "run/one", 2, 5);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/schools/school%20one/simulation/runs/run%2Fone/resources?page=2&page_size=5",
      { signal: undefined },
    );
  });

  it("keeps duplication and aligned comparison under the same simulation aggregate", async () => {
    apiFetchMock.mockResolvedValue({});

    await duplicateSimulationRun("school-1", "run-1", {
      name: "Copy",
      kind: "scenario",
      speed: 20,
      end_at: null,
      idempotency_key: "duplicate-1",
    });
    await compareSimulationRuns("school-1", { run_ids: ["run-1", "run-2"], duration_ms: 86_400_000 });

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/v1/schools/school-1/simulation/runs/run-1/duplicate", expect.objectContaining({ method: "POST" }));
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/v1/schools/school-1/simulation/compare", {
      method: "POST",
      body: JSON.stringify({ run_ids: ["run-1", "run-2"], duration_ms: 86_400_000 }),
    });
  });
});
