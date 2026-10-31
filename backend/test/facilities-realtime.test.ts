import { describe, expect, it, vi } from "vitest";
import { createLiveExecutionEnvironment, createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { ExecutionClock } from "../src/campus-model-core/execution-environment.contracts.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { executionRealtimeBinding, type ExecutionRealtimeBinding } from "../src/school/execution-realtime.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

const at = "2026-10-24T09:00:00.000Z";
const clock: ExecutionClock = { now: () => new Date(at), nowIso: () => at };
function binding(runId?: string) {
  return executionRealtimeBinding(runId ? createSimulationExecutionEnvironment({
    institution_id: "repair-campus", scenario_id: "repair-scenario", run_id: runId,
    virtual_clock: { ...clock, advanceBy: () => at, advanceTo: () => at },
    source_snapshot_ref: "repair-snapshot", expires_at: "2099-10-24T10:00:00.000Z",
    coverage_gate: { status: "passed", manifest_ref: "repair-realtime-boundary", checked_at: at },
  }) : createLiveExecutionEnvironment({ institution_id: "repair-campus", clock }));
}
function client(scope: ExecutionRealtimeBinding, frames: string[]) {
  return { id: `client:${scope.namespace_id}`, userId: "repair-participant", sessionHash: scope.namespace_id, binding: scope,
    reply: { raw: { destroyed: false, writableEnded: false,
      write: (frame: string) => { frames.push(frame); return true; }, end: vi.fn(), destroy: vi.fn() } },
    lastSequence: 0, replaying: false, replayOverflow: false, pendingEvents: new Map(), closed: false };
}
describe("Private campus service selected-world realtime transport", () => {
  it("delivers minimal repair, accommodation and dining refreshes only in their exact namespace", () => {
    for (const { domain, source, key } of [
      { domain: "facilities", source: "facility_repair", key: "repair_id" },
      { domain: "accommodation", source: "accommodation_stay", key: "source_id" },
      { domain: "dining", source: "dining_session", key: "source_id" },
      { domain: "campus_assets", source: "campus_asset", key: "holding_id" },
    ]) {
    const service = new SchoolEventService({} as DatabaseService), liveFrames: string[] = [], branchFrames: string[] = [], siblingFrames: string[] = [];
    const clients = [client(binding(), liveFrames), client(binding("branch"), branchFrames), client(binding("sibling"), siblingFrames)];
    const transport = service as unknown as { clients: Map<string, ReturnType<typeof client>>; dispatch(event: Record<string, unknown>, namespace: string): void };
    for (const selected of clients) transport.clients.set(selected.id, selected);
    transport.dispatch({ id: "repair-refresh", sequence: 1, school_id: "repair-campus", event_type: `${domain}.updated`,
      aggregate_type: source, aggregate_id: "repair", audience_user_ids: ["repair-participant"],
      payload: domain==='campus_assets'
        ? {holding_id:'repair',campus_id:'campus',revision:2,source_command_id:'repair-command',refresh:['campus-assets']}
        : { [key]: "repair", revision: 2, action: "updated", source_command_id: "repair-command", refresh: [domain, "workspace", "attention"] },
      created_at: at }, clients[1]!.binding.namespace_id);
    expect(liveFrames).toEqual([]); expect(siblingFrames).toEqual([]); expect(branchFrames).toHaveLength(1);
    expect(branchFrames[0]).toContain(`${domain}.updated`); expect(branchFrames[0]).toContain(`"${key}":"repair"`);
    expect(branchFrames[0]).not.toMatch(/problem|location_note|photo|wait_reason|person_id|instructions|actual_move|menu_text|count_total|source_url/u);
    }
  });
});
