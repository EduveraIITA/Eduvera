import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { executionEnvironmentStorage, executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { assertLiveExternalEffect } from "../src/common/simulation-effects.js";
import { sendTransactionalEmail } from "../src/common/email-transport.js";
import { RazorpayClient } from "../src/operations/razorpay.client.js";
import { MatrixClient } from "../src/chat/matrix/matrix-client.js";
import { AgentChannelService } from "../src/agent/channels/channel.service.js";
import type { AuthenticatedRequest } from "../src/common/request.js";

const institutionId = "10000000-0000-4000-8000-000000000001";
const virtualNow = "2030-02-03T04:05:06.000Z";
const simulation = simulationRequestEnvironment({ institution_id: institutionId,
  scenario_id: "20000000-0000-4000-8000-000000000001", run_id: "30000000-0000-4000-8000-000000000001",
  virtual_now: virtualNow, source_snapshot_ref: "sha256:source", manifest_ref: "manifest:one", checked_at: "2026-10-19T00:00:00.000Z" });

afterEach(() => vi.unstubAllGlobals());

describe("Simulation provider and execution-time boundaries", () => {
  it("uses virtual domain time without globally patching Date or leaking into concurrent Live work", async () => {
    const realBefore = Date.now();
    const values = await Promise.all([
      executionEnvironmentStorage.run(simulation, async () => { await Promise.resolve(); return executionNow().toISOString(); }),
      Promise.resolve().then(() => executionNow().getTime()),
    ]);
    expect(values[0]).toBe(virtualNow);
    expect(values[1]).toBeGreaterThanOrEqual(realBefore);
    expect(Date.now()).toBeLessThan(Date.parse(virtualNow));
  });

  it("denies external effects before any provider configuration or network call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Network must not be called"));
    vi.stubGlobal("fetch", fetcher);
    const matrix = new MatrixClient({ enabled: true, baseUrl: "https://matrix.invalid", serverName: "matrix.invalid",
      asToken: "not-a-real-token", botLocalpart: "bot", requestTimeoutMs: 1_000 }, fetcher);
    await executionEnvironmentStorage.run(simulation, async () => {
      await expect(sendTransactionalEmail({ to: "nobody@example.invalid", senderName: "Simulation", subject: "test", text: "test" }))
        .rejects.toBeInstanceOf(ConflictException);
      await expect(new RazorpayClient().request("orders", {})).rejects.toBeInstanceOf(ConflictException);
      await expect(matrix.request("POST", "/_matrix/client/v3/register", {})).rejects.toBeInstanceOf(ConflictException);
      expect(() => assertLiveExternalEffect("Stored evidence")).toThrow(ConflictException);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed for every external assistant-channel route before provider or database access", async () => {
    const unavailable = new Proxy({}, { get: () => { throw new Error("Live dependency was accessed"); } });
    const channels = new AgentChannelService(unavailable as never, unavailable as never, unavailable as never);
    const request = {} as AuthenticatedRequest;

    await executionEnvironmentStorage.run(simulation, async () => {
      await expect(channels.list(request)).rejects.toBeInstanceOf(ConflictException);
      await expect(channels.issueLink(request)).rejects.toBeInstanceOf(ConflictException);
      await expect(channels.revoke(request, "telegram")).rejects.toBeInstanceOf(ConflictException);
      await expect(channels.ingest("telegram", undefined, {})).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it("does not disable Live effects when a separate session is simulated", () => {
    const live = createLiveExecutionEnvironment({ institution_id: institutionId,
      clock: { now: () => new Date(), nowIso: () => new Date().toISOString() } });
    expect(() => executionEnvironmentStorage.run(live, () => assertLiveExternalEffect("Allowed Live effect"))).not.toThrow();
    expect(() => assertLiveExternalEffect("Unscoped Live worker effect")).not.toThrow();
  });
});
