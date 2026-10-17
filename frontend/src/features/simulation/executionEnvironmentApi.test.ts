import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

describe("execution environment session API", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("asks the authenticated session to enter a run without client environment headers", async () => {
    apiFetchMock.mockResolvedValue({
      execution_environment: {
        mode: "simulation",
        namespace_id: "scenario:run-1",
        run_id: "run-1",
        virtual_clock: { now: "2026-10-19T09:00:00.000+05:30", time_zone: "Asia/Kolkata" },
      },
    });

    await expect(selectExecutionEnvironment({ mode: "simulation", run_id: "run-1" })).resolves.toMatchObject({
      mode: "simulation",
      namespaceId: "scenario:run-1",
      runId: "run-1",
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/auth/execution-environment/", {
      method: "POST",
      body: JSON.stringify({ mode: "simulation", run_id: "run-1" }),
    });
    expect(apiFetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("returns to Live through the same server-owned session endpoint", async () => {
    apiFetchMock.mockResolvedValue({ execution_environment: { mode: "live", namespace_id: "live:school-1" } });
    await expect(selectExecutionEnvironment({ mode: "live" })).resolves.toMatchObject({ mode: "live" });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/auth/execution-environment/", {
      method: "POST",
      body: JSON.stringify({ mode: "live" }),
    });
  });
});
