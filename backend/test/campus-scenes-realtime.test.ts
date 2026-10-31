import { describe, expect, it, vi } from "vitest";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import type { ExecutionClock } from "../src/campus-model-core/execution-environment.contracts.js";
import type { DatabaseService } from "../src/database/database.service.js";
import {
  executionRealtimeBinding,
  type ExecutionRealtimeBinding,
} from "../src/school/execution-realtime.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
const at = "2026-10-25T09:00:00.000Z",
  clock: ExecutionClock = { now: () => new Date(at), nowIso: () => at };
function binding(runId?: string) {
  return executionRealtimeBinding(
    runId
      ? createSimulationExecutionEnvironment({
          institution_id: "map-campus",
          scenario_id: "map-scenario",
          run_id: runId,
          virtual_clock: { ...clock, advanceBy: () => at, advanceTo: () => at },
          source_snapshot_ref: "map-snapshot",
          expires_at: "2099-10-25T10:00:00.000Z",
          coverage_gate: {
            status: "passed",
            manifest_ref: "campus-scenes-realtime-boundary",
            checked_at: at,
          },
        })
      : createLiveExecutionEnvironment({ institution_id: "map-campus", clock }),
  );
}
function client(scope: ExecutionRealtimeBinding, frames: string[]) {
  return {
    id: `client:${scope.namespace_id}`,
    userId: "campus-member",
    sessionHash: scope.namespace_id,
    binding: scope,
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
describe("Campus scene selected-world realtime transport", () => {
  it("delivers only minimal publication refreshes in the exact selected namespace", () => {
    const service = new SchoolEventService({} as DatabaseService),
      live: string[] = [],
      branch: string[] = [],
      sibling: string[] = [];
    const clients = [
      client(binding(), live),
      client(binding("branch"), branch),
      client(binding("sibling"), sibling),
    ];
    const transport = service as unknown as {
      clients: Map<string, ReturnType<typeof client>>;
      dispatch(event: Record<string, unknown>, namespace: string): void;
    };
    for (const connection of clients)
      transport.clients.set(connection.id, connection);
    transport.dispatch(
      {
        id: "map-refresh",
        sequence: 1,
        school_id: "map-campus",
        event_type: "campus_scenes.updated",
        aggregate_type: "campus_scene",
        aggregate_id: "map",
        audience_user_ids: ["campus-member"],
        payload: {
          scene_id: "map",
          campus_id: "campus",
          revision: 2,
          action: "published",
          source_command_id: "map-command",
          refresh: ["campus-scenes"],
        },
        created_at: at,
      },
      clients[1]!.binding.namespace_id,
    );
    expect(live).toEqual([]);
    expect(sibling).toEqual([]);
    expect(branch).toHaveLength(1);
    expect(branch[0]).toContain("campus_scenes.updated");
    expect(branch[0]).toContain('"revision":2');
    expect(branch[0]).not.toMatch(
      /document|image_asset_id|source_url|notes|provider|bytes|person_id/u,
    );
  });
});
