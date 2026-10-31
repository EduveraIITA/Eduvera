import { describe, expect, it, vi } from "vitest";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import type { ExecutionClock } from "../src/campus-model-core/execution-environment.contracts.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { executionRealtimeBinding, type ExecutionRealtimeBinding } from "../src/school/execution-realtime.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

const at = "2026-10-24T09:00:00.000Z";
const clock: ExecutionClock = { now: () => new Date(at), nowIso: () => at };

function binding(runId?: string) {
  return executionRealtimeBinding(runId ? createSimulationExecutionEnvironment({
    institution_id: "resource-campus", scenario_id: "resource-scenario", run_id: runId,
    virtual_clock: { ...clock, advanceBy: () => at, advanceTo: () => at },
    source_snapshot_ref: "resource-snapshot", expires_at: "2099-10-24T10:00:00.000Z",
    coverage_gate: { status: "passed", manifest_ref: "resource-realtime-boundary", checked_at: at },
  }) : createLiveExecutionEnvironment({ institution_id: "resource-campus", clock }));
}

function client(scope: ExecutionRealtimeBinding, frames: string[]) {
  return {
    id: `client:${scope.namespace_id}`, userId: "resource-borrower", sessionHash: scope.namespace_id,
    binding: scope,
    reply: { raw: { destroyed: false, writableEnded: false,
      write: (frame: string) => { frames.push(frame); return true; }, end: vi.fn(), destroy: vi.fn() } },
    lastSequence: 0, replaying: false, replayOverflow: false, pendingEvents: new Map(), closed: false,
  };
}

describe("Resources selected-world realtime transport", () => {
  it("delivers a resource loan refresh only to the exact selected namespace, not Live or a sibling", () => {
    const events = new SchoolEventService({} as DatabaseService);
    const liveFrames: string[] = [], branchFrames: string[] = [], siblingFrames: string[] = [];
    const clients = [client(binding(), liveFrames), client(binding("branch"), branchFrames), client(binding("sibling"), siblingFrames)];
    const transport = events as unknown as {
      clients: Map<string, ReturnType<typeof client>>;
      dispatch(event: Record<string, unknown>, namespace: string): void;
    };
    for (const selected of clients) transport.clients.set(selected.id, selected);
    transport.dispatch({
      id: "resource-refresh", sequence: 1, school_id: "resource-campus", event_type: "resources.updated",
      aggregate_type: "resource_loan", aggregate_id: "resource-loan", audience_user_ids: ["resource-borrower"],
      payload: { loan_id: "resource-loan", revision: 2, action: "return_recorded", command_id: "resource-command",
        refresh: ["resources", "workspace", "attention"] }, created_at: at,
    }, clients[1]!.binding.namespace_id);
    expect(liveFrames).toEqual([]);
    expect(siblingFrames).toEqual([]);
    expect(branchFrames).toHaveLength(1);
    expect(branchFrames[0]).toContain("resources.updated");
    expect(branchFrames[0]).toContain('"loan_id":"resource-loan"');
    expect(branchFrames[0]).not.toMatch(/question_body|reply_body|claimed_return_at|borrower_person_id/u);
  });
});
