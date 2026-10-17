import { describe, expect, it, vi } from "vitest";
import type { ExecutionClock, SimulationVirtualClock } from "../src/campus-model-core/execution-environment.contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { FastifyReply } from "fastify";
import {
  executionRealtimeBinding,
  executionRealtimeCursor,
  parseExecutionRealtimeCursor,
  type ExecutionRealtimeBinding,
} from "../src/school/execution-realtime.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

const instant = "2026-10-17T06:30:00.000Z";
const liveClock: ExecutionClock = {
  now: () => new Date(instant),
  nowIso: () => instant,
};
const virtualClock: SimulationVirtualClock = {
  now: () => new Date(instant),
  nowIso: () => instant,
  advanceBy: () => instant,
  advanceTo: () => instant,
};

function liveBinding() {
  return executionRealtimeBinding(createLiveExecutionEnvironment({
    institution_id: "school-cis",
    clock: liveClock,
  }));
}

function simulationBinding(runId: string) {
  return executionRealtimeBinding(createSimulationExecutionEnvironment({
    institution_id: "school-cis",
    scenario_id: "scenario-cover",
    run_id: runId,
    virtual_clock: virtualClock,
    source_snapshot_ref: "snapshot:cis:42",
    coverage_gate: {
      status: "passed",
      manifest_ref: "coverage:cis:42",
      checked_at: instant,
    },
    expires_at: "2026-10-18T06:30:00.000Z",
  }));
}

function streamClient(binding: ExecutionRealtimeBinding, frames: string[]) {
  return {
    id: `client:${binding.namespace_id}`,
    userId: "user-1",
    sessionHash: `session:${binding.namespace_id}`,
    binding,
    reply: {
      raw: {
        destroyed: false,
        writableEnded: false,
        write: (frame: string) => {
          frames.push(frame);
          return true;
        },
        end: vi.fn(),
        destroy: vi.fn(),
      },
    },
    lastSequence: 0,
    replaying: false,
    replayOverflow: false,
    pendingEvents: new Map(),
    closed: false,
  };
}

describe("execution-environment realtime isolation", () => {
  it("treats Last-Event-ID only as a cursor inside the server-selected namespace", () => {
    const live = liveBinding();
    const firstRun = simulationBinding("run-001");
    const secondRun = simulationBinding("run-002");

    const liveCursor = executionRealtimeCursor(live, 17);
    const firstRunCursor = executionRealtimeCursor(firstRun, 23);

    expect(liveCursor).toBe("v2-17");
    expect(parseExecutionRealtimeCursor(live, liveCursor)).toBe(17);
    expect(parseExecutionRealtimeCursor(firstRun, liveCursor)).toBeNull();
    expect(parseExecutionRealtimeCursor(firstRun, firstRunCursor)).toBe(23);
    expect(parseExecutionRealtimeCursor(secondRun, firstRunCursor)).toBeNull();
    expect(parseExecutionRealtimeCursor(firstRun, "23")).toBeNull();
  });

  it("broadcasts an event only to clients in the exact source namespace", () => {
    const events = new SchoolEventService({} as DatabaseService);
    const liveFrames: string[] = [];
    const firstRunFrames: string[] = [];
    const secondRunFrames: string[] = [];
    const live = streamClient(liveBinding(), liveFrames);
    const firstRun = streamClient(simulationBinding("run-001"), firstRunFrames);
    const secondRun = streamClient(simulationBinding("run-002"), secondRunFrames);
    (events as any).clients.set(live.id, live);
    (events as any).clients.set(firstRun.id, firstRun);
    (events as any).clients.set(secondRun.id, secondRun);
    const envelope = {
      id: "event-1",
      sequence: 1,
      school_id: "school-cis",
      event_type: "attendance.updated",
      aggregate_type: "class_section",
      aggregate_id: "class-6a",
      audience_user_ids: ["user-1"],
      payload: { refresh: ["principal.attendance"] },
      created_at: instant,
    };

    (events as any).dispatch(envelope, live.binding.namespace_id);
    expect(liveFrames).toHaveLength(1);
    expect(firstRunFrames).toHaveLength(0);
    expect(secondRunFrames).toHaveLength(0);

    (events as any).dispatch({ ...envelope, id: "event-2", sequence: 2 }, firstRun.binding.namespace_id);
    expect(liveFrames).toHaveLength(1);
    expect(firstRunFrames).toHaveLength(1);
    expect(secondRunFrames).toHaveLength(0);
    expect(firstRunFrames[0]).toContain("id: v3-");
  });

  it("binds a stream from the server session and ignores caller environment hints", async () => {
    process.env.DATABASE_URL ??= "postgresql://localhost/thatcampus_realtime_unit";
    const live = liveBinding();
    const foreignRun = simulationBinding("run-foreign");
    const frames: string[] = [];
    const events = new SchoolEventService({} as DatabaseService);
    (events as any).brokerReady = true;
    (events as any).requestFullSync = vi.fn().mockImplementation((client: { lastSequence: number | null }) => {
      client.lastSequence = 0;
      return Promise.resolve();
    });
    const request = {
      executionEnvironment: live.environment,
      sessionHash: "session-1",
      headers: {
        "last-event-id": executionRealtimeCursor(foreignRun, 99),
        "x-execution-environment": foreignRun.namespace_id,
      },
      raw: { once: vi.fn() },
    } as unknown as AuthenticatedRequest;
    const reply = {
      hijack: vi.fn(),
      raw: {
        destroyed: false,
        writableEnded: false,
        writeHead: vi.fn(),
        write: (frame: string) => {
          frames.push(frame);
          return true;
        },
        once: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      },
    } as unknown as FastifyReply;
    const user = {
      id: "user-1",
      username: "principal",
      email: "principal@example.test",
      first_name: "Test",
      last_name: "Principal",
      role: "admin",
      is_active: true,
      active_school_id: "school-cis",
    } satisfies AuthUser;

    await events.openStream(user, reply, request);

    const [client] = [...(events as any).clients.values()] as Array<{
      binding: ExecutionRealtimeBinding;
      lastSequence: number | null;
    }>;
    expect(client?.binding.namespace_id).toBe(live.namespace_id);
    expect(client?.lastSequence).toBe(0);
    expect((events as any).requestFullSync).toHaveBeenCalledWith(
      expect.objectContaining({ binding: expect.objectContaining({ namespace_id: live.namespace_id }) }),
      "initial_connection",
    );
    expect(frames.join(""))
      .toContain(`"namespace_id":"${live.namespace_id}"`);
    expect(frames.join(""))
      .not.toContain(foreignRun.namespace_id);
  });

  it("runs Simulation replay and publication only inside its server-owned data-plane scope", async () => {
    const firstRun = simulationBinding("run-001");
    const seenNamespaces: string[] = [];
    let current: typeof firstRun.environment | undefined;
    const scope = {
      current: () => current,
      run: async (environment: typeof firstRun.environment, callback: () => Promise<void>) => {
        seenNamespaces.push(environment.namespace_id);
        current = environment;
        try {
          await callback();
        } finally {
          current = undefined;
        }
      },
    } as unknown as ExecutionDataPlaneScope;
    const events = new SchoolEventService(
      {} as DatabaseService,
      undefined,
      undefined,
      scope,
    );
    const client = streamClient(firstRun, []);
    (events as any).clients.set(client.id, client);
    (events as any).publishPendingInSelectedEnvironment = vi.fn().mockResolvedValue(undefined);
    (events as any).replay = vi.fn().mockImplementation(() => {
      expect(current?.namespace_id).toBe(firstRun.namespace_id);
      return Promise.resolve();
    });

    await (events as any).publishSimulationNamespace(firstRun);

    expect(seenNamespaces).toEqual([firstRun.namespace_id]);
    expect((events as any).publishPendingInSelectedEnvironment).toHaveBeenCalledWith(false);
    expect((events as any).replay).toHaveBeenCalledWith(client, 0);
  });

  it("rejects nested realtime work when the active scope belongs to another environment", () => {
    const live = liveBinding();
    const simulation = simulationBinding("run-001");
    const scope = {
      current: () => live.environment,
      run: vi.fn(),
    } as unknown as ExecutionDataPlaneScope;
    const events = new SchoolEventService(
      {} as DatabaseService,
      undefined,
      undefined,
      scope,
    );
    const client = streamClient(simulation, []);

    expect(() => (events as any).runInClientEnvironment(client, () => undefined))
      .toThrow("Realtime work cannot cross the selected execution-environment namespace.");
    expect((scope as any).run).not.toHaveBeenCalled();
  });
});
