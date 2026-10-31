import { describe, expect, it, vi } from "vitest";
import { createLiveExecutionEnvironment, createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { ExecutionClock } from "../src/campus-model-core/execution-environment.contracts.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { executionRealtimeBinding, type ExecutionRealtimeBinding } from "../src/school/execution-realtime.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

const at = "2026-10-26T09:00:00.000Z";
const clock: ExecutionClock = { now: () => new Date(at), nowIso: () => at };
function binding(runId?: string) {
  return executionRealtimeBinding(runId ? createSimulationExecutionEnvironment({
    institution_id: "visit-campus", scenario_id: "visit-scenario", run_id: runId,
    virtual_clock: { ...clock, advanceBy: () => at, advanceTo: () => at },
    source_snapshot_ref: "visit-snapshot", expires_at: "2099-10-26T10:00:00.000Z",
    coverage_gate: { status: "passed", manifest_ref: "visit-realtime-boundary", checked_at: at },
  }) : createLiveExecutionEnvironment({ institution_id: "visit-campus", clock }));
}
function client(scope: ExecutionRealtimeBinding, frames: string[]) {
  return { id: `client:${scope.namespace_id}`, userId: "visit-coordinator", sessionHash: scope.namespace_id, binding: scope,
    reply: { raw: { destroyed: false, writableEnded: false,
      write: (frame: string) => { frames.push(frame); return true; }, end: vi.fn(), destroy: vi.fn() } },
    lastSequence: 0, replaying: false, replayOverflow: false, pendingEvents: new Map(), closed: false };
}

describe("Arranged visit selected-world realtime transport", () => {
  it("delivers a minimal refresh only to the same actor in the exact selected namespace", () => {
    const service = new SchoolEventService({} as DatabaseService);
    const liveFrames: string[] = [], branchFrames: string[] = [], siblingFrames: string[] = [];
    const clients = [client(binding(), liveFrames), client(binding("branch"), branchFrames), client(binding("sibling"), siblingFrames)];
    const transport = service as unknown as { clients: Map<string, ReturnType<typeof client>>; dispatch(event: Record<string, unknown>, namespace: string): void };
    for (const selected of clients) transport.clients.set(selected.id, selected);
    transport.dispatch({ id: "visit-refresh", sequence: 1, school_id: "visit-campus", event_type: "gate.visit_arrangement.updated",
      aggregate_type: "gate_visit_arrangement", aggregate_id: "visit", audience_user_ids: ["visit-coordinator"],
      payload: { visit_id: "visit", revision: 2, action: "changed", source_command_id: "visit-command", refresh: ["gate-visits"] },
      created_at: at }, clients[1]!.binding.namespace_id);
    expect(liveFrames).toEqual([]); expect(siblingFrames).toEqual([]); expect(branchFrames).toHaveLength(1);
    expect(branchFrames[0]).toContain("gate.visit_arrangement.updated");
    expect(branchFrames[0]).toContain('"visit_id":"visit"');
    expect(branchFrames[0]).not.toMatch(/guest_name|phone|email|purpose|title|person_id|place_id|contact/u);
  });

  it("delivers a minimal private shared-visit refresh only to its exact recipient and selected world", () => {
    const service = new SchoolEventService({} as DatabaseService);
    const liveFrames: string[] = [], branchFrames: string[] = [], siblingFrames: string[] = [], unrelatedFrames: string[] = [];
    const clients = [client(binding(), liveFrames), client(binding("shared-branch"), branchFrames), client(binding("shared-sibling"), siblingFrames)];
    for (const selected of clients) selected.userId = "visit-guest";
    const unrelated = { ...client(binding("shared-branch"), unrelatedFrames), id: "unrelated-source-reader", userId: "unrelated-manager" };
    const transport = service as unknown as { clients: Map<string, ReturnType<typeof client>>; dispatch(event: Record<string, unknown>, namespace: string): void };
    for (const selected of [...clients, unrelated]) transport.clients.set(selected.id, selected);
    transport.dispatch({ id: "private-share-refresh", sequence: 2, school_id: "visit-campus", event_type: "gate.visit_shared.updated",
      aggregate_type: "gate_visit_shared", aggregate_id: "visit", audience_user_ids: ["visit-guest"],
      payload: { visit_id: "visit", share_id: "shared-version", root_id: "logical-share", question_id: "private-question",
        revision: 2, action: "replied", source_command_id: "reply-command", refresh: ["gate-visits", "workspace", "attention"] }, created_at: at }, clients[1]!.binding.namespace_id);
    expect(branchFrames).toHaveLength(1);
    expect(liveFrames).toEqual([]); expect(siblingFrames).toEqual([]); expect(unrelatedFrames).toEqual([]);
    expect(branchFrames[0]).toContain("gate.visit_shared.updated");
    expect(branchFrames[0]).not.toMatch(/guest_name|phone|email|purpose|title|directions|note|person_id|place_id|contact|author/u);
  });
});
