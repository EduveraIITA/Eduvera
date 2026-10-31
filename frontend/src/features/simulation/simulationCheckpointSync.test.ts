import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSimulationExecutionEnvironment,
  executionEnvironmentIdentity,
  type ExecutionEnvironment,
} from "./executionEnvironment";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";
import { refreshCommittedSimulationCheckpoint } from "./simulationCheckpointSync";

const current = createSimulationExecutionEnvironment({
  namespaceId: "scenario:one:run:one", runId: "run-1", institutionId: "school-1",
  virtualClock: { now: "2026-10-19T12:00:00.000Z", timeZone: "UTC" }, worldRevision: 1,
});
const committed = createSimulationExecutionEnvironment({ ...current, worldRevision: 2 });
const clients: QueryClient[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  clients.splice(0).forEach((client) => client.clear());
});
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(value);
  return value;
}
function observe(queryClient: QueryClient, queryKey: QueryKey) {
  const fetch = vi.fn().mockResolvedValue("Final");
  const observer = new QueryObserver(queryClient, { queryKey, queryFn: fetch, initialData: "Finalizing" });
  cleanups.push(observer.subscribe(() => undefined));
  return fetch;
}

describe("committed Simulation checkpoint refresh", () => {
  it("refetches ordinary active campus data, Today/Work and namespaced domain queries on a durable commit", async () => {
    const queryClient = client();
    const keys = [
      ["responsibility-attendance", "registers", "2026-10-19"],
      ["responsibility-workspace", executionEnvironmentIdentity(current)],
      ["requests", "teacher"],
      ["school", "student", "timetable"],
      ["timetable", "workspace", "self", "student-1"],
      ["organization", "school-1"],
      ["assigned-classes", "teacher-1"],
      executionEnvironmentQueryKey(current, ["gate", "visitors"]),
    ];
    const fetches = keys.map((key) => observe(queryClient, key));
    await refreshCommittedSimulationCheckpoint(queryClient, current, committed);
    fetches.forEach((fetch) => expect(fetch).toHaveBeenCalledOnce());
    keys.forEach((key) => expect(queryClient.getQueryData(key)).toBe("Final"));
  });

  it("also supports a committed virtual-time change when an older descriptor has no revision", async () => {
    const queryClient = client();
    const fetch = observe(queryClient, ["calendar"]);
    const previous = createSimulationExecutionEnvironment({ ...current, worldRevision: undefined });
    const next = createSimulationExecutionEnvironment({ ...previous, virtualClock: { ...previous.virtualClock, now: "2026-10-19T12:05:00.000Z" } });
    await refreshCommittedSimulationCheckpoint(queryClient, previous, next);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not refetch the same checkpoint for lifecycle, speed or equivalent clock formatting changes", async () => {
    const queryClient = client();
    const fetch = observe(queryClient, ["responsibility-attendance", "registers"]);
    const sameCheckpoint = createSimulationExecutionEnvironment({
      ...current, runStatus: "paused", speed: 50,
      virtualClock: { ...current.virtualClock, now: "2026-10-19T14:00:00.000+02:00" },
    });
    await refreshCommittedSimulationCheckpoint(queryClient, current, sameCheckpoint);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<ExecutionEnvironment>([
    { mode: "live" },
    { mode: "simulation", unavailable: true, unavailableReason: "data_plane_unavailable", namespaceId: current.namespaceId, runId: current.runId },
    createSimulationExecutionEnvironment({ ...committed, namespaceId: "other-world", runId: "run-2" }),
  ])("leaves Live, unavailable contexts and environment-switch cache handling alone (%j)", async (other) => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await refreshCommittedSimulationCheckpoint(queryClient, other, committed);
    await refreshCommittedSimulationCheckpoint(queryClient, current, other);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("marks inactive campus data stale without fetching it or clearing its cached content", async () => {
    const queryClient = client();
    const key = ["institution-setup", "school-1"];
    queryClient.setQueryData(key, "Captured campus");
    await refreshCommittedSimulationCheckpoint(queryClient, current, committed);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(key)).toBe("Captured campus");
  });

  it("never refreshes auth, run-control, Live or sibling-world cache entries", async () => {
    const queryClient = client();
    const sibling = createSimulationExecutionEnvironment({ ...current, runId: "run-2", namespaceId: "sibling" });
    const keys = [
      ["auth", "session"],
      executionEnvironmentQueryKey(current, ["simulation-session-run", "school-1", "run-1"]),
      executionEnvironmentQueryKey(current, ["simulation-run", "school-1", "run-1"]),
      executionEnvironmentQueryKey({ mode: "live" }, ["gate", "visitors"]),
      executionEnvironmentQueryKey(sibling, ["gate", "visitors"]),
      ["responsibility-workspace", executionEnvironmentIdentity(sibling)],
      ["responsibility-workspace", "live:school-1"],
    ];
    const fetches = keys.map((key) => observe(queryClient, key));
    await refreshCommittedSimulationCheckpoint(queryClient, current, committed);
    fetches.forEach((fetch) => expect(fetch).not.toHaveBeenCalled());
    keys.forEach((key) => {
      expect(queryClient.getQueryData(key)).toBe("Finalizing");
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    });
  });

  it("restarts an active pre-commit request instead of skipping it and leaving the final checkpoint stale", async () => {
    const queryClient = client();
    const key = ["responsibility-attendance", "registers"];
    let resolveOld!: (value: string) => void;
    const oldResponse = new Promise<string>((resolve) => { resolveOld = resolve; });
    const aborted = vi.fn();
    const fetch = vi.fn().mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener("abort", aborted);
      return oldResponse;
    }).mockResolvedValue("Final");
    const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: fetch, initialData: "Finalizing" });
    cleanups.push(observer.subscribe(() => undefined));
    void observer.refetch();
    expect(fetch).toHaveBeenCalledOnce();

    await refreshCommittedSimulationCheckpoint(queryClient, current, committed);
    expect(aborted).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(key)).toBe("Final");
    resolveOld("Stale pre-commit response");
    await oldResponse;
    expect(queryClient.getQueryData(key)).toBe("Final");
  });
});
