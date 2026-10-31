import "reflect-metadata";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { FacilitiesWorkRecord } from "../src/facilities/facilities.contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import { executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { WorkspaceProjectionReads } from "../src/workspace/workspace-projection-reads.js";
import type { WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";
import { WorkspaceService } from "../src/workspace/workspace.service.js";

function barrier() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

describe("workspace projection read admission", () => {
  it("shares the default three-operation limit across overlapping manifests before invoking work", async () => {
    const reads = new WorkspaceProjectionReads();
    const gates = Array.from({ length: 10 }, barrier);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const manifest = (indices: number[]) => indices.map((index) => reads.run(async () => {
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      try {
        await gates[index]!.ready;
        return `result-${index}`;
      } finally { active -= 1; }
    }));
    const first = manifest([0, 1, 2, 3, 4]);
    const second = manifest([5, 6, 7, 8, 9]);
    try {
      await setImmediate();
      expect(started).toEqual([0, 1, 2]);
      expect(active).toBe(3);

      gates[1]!.release();
      await first[1];
      await setImmediate();
      expect(started).toEqual([0, 1, 2, 3]);
      expect(active).toBe(3);

      gates[0]!.release();
      gates[2]!.release();
      await Promise.all([first[0], first[2]]);
      await setImmediate();
      expect(started).toEqual([0, 1, 2, 3, 4, 5]);
      expect(active).toBe(3);
    } finally { gates.forEach((gate) => gate.release()); }

    expect(await Promise.all(first)).toEqual([0, 1, 2, 3, 4].map((index) => `result-${index}`));
    expect(await Promise.all(second)).toEqual([5, 6, 7, 8, 9].map((index) => `result-${index}`));
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it.each(["synchronous", "asynchronous"] as const)("releases a queued permit after a %s failure", async (kind) => {
    const reads = new WorkspaceProjectionReads(1);
    const gate = barrier();
    const failed = new Error(`${kind} projection failed`);
    const started: string[] = [];
    const first = reads.run(async () => {
      started.push("first");
      await gate.ready;
      return "first-result";
    });
    const rejected = reads.run(() => {
      started.push("failed");
      if (kind === "synchronous") throw failed;
      return Promise.reject(failed);
    });
    const checkedRejection = expect(rejected).rejects.toBe(failed);
    const last = reads.run(() => { started.push("last"); return "last-result"; });
    await setImmediate();
    expect(started).toEqual(["first"]);
    gate.release();
    expect(await first).toBe("first-result");
    await checkedRejection;
    expect(await last).toBe("last-result");
    expect(started).toEqual(["first", "failed", "last"]);
    expect(await reads.run(() => "reusable")).toBe("reusable");
  });

  it("retains each originating selected-world context while another request releases the queue", async () => {
    const reads = new WorkspaceProjectionReads(1);
    const scope = new ExecutionDataPlaneScope();
    const gate = barrier();
    const liveAt = "2026-10-26T12:00:00.000Z";
    const live = createLiveExecutionEnvironment({
      institution_id: "admission-test-campus",
      clock: { now: () => new Date(liveAt), nowIso: () => liveAt },
    });
    const simulation = (run: string, instant: string) => createSimulationExecutionEnvironment({
      institution_id: "admission-test-campus", scenario_id: `scenario-${run}`, run_id: run,
      source_snapshot_ref: `snapshot:${run}`,
      coverage_gate: { status: "passed", manifest_ref: `manifest:${run}`, checked_at: liveAt },
      virtual_clock: {
        now: () => new Date(instant), nowIso: () => instant,
        advanceBy: () => instant, advanceTo: () => instant,
      },
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const firstWorld = simulation("run-a", "2026-11-01T08:00:00.000Z");
    const siblingWorld = simulation("run-b", "2026-12-01T09:00:00.000Z");
    const first = scope.run(live, () => reads.run(async () => {
      await gate.ready;
      return scope.current();
    }));
    const capture = async () => {
      const before = scope.current();
      await Promise.resolve();
      return { before, after: scope.current(), now: executionNow().toISOString() };
    };
    const queuedFirstWorld = scope.run(firstWorld, () => reads.run(capture));
    const queuedSiblingWorld = scope.run(siblingWorld, () => reads.run(capture));
    const queuedUnscoped = reads.run(() => scope.current());
    gate.release();

    expect(await first).toBe(live);
    expect(await queuedFirstWorld).toEqual({ before: firstWorld, after: firstWorld, now: "2026-11-01T08:00:00.000Z" });
    expect(await queuedSiblingWorld).toEqual({ before: siblingWorld, after: siblingWorld, now: "2026-12-01T09:00:00.000Z" });
    expect(await queuedUnscoped).toBeUndefined();
    expect(scope.current()).toBeUndefined();
  });

  it("actually shares admission between WorkspaceService manifests without mixing their native results", async () => {
    const school = "00000000-0000-4000-8000-000000000001";
    const instant = new Date("2026-10-26T12:00:00.000Z");
    const snapshot: WorkspaceRepositorySnapshot = {
      institution: { id: school, name: "Fictional admission-test campus", code: "admission-test", timezone: "UTC" },
      membership_roles: ["member"], realm_id: "00000000-0000-4000-8000-000000000002",
      environment_namespace_id: `live:${school}`, acting_agent_id: "00000000-0000-4000-8000-000000000003",
      owner_agent_ids: [], assignments: [], messages: [], relationships: [],
    };
    const clock = { now: () => instant, read: () => ({
      environment_kind: "live", namespace_id: `live:${school}`, institution_id: school,
      instant, iso_instant: instant.toISOString(), time_zone: "UTC", local_date: "2026-10-26", local_time: "12:00:00",
    }) };
    const gate = barrier();
    const started: Array<{ user: string; projection: string }> = [];
    let active = 0;
    let peak = 0;
    const project = async <T>(projection: string, user: AuthUser, value: T): Promise<T> => {
      started.push({ user: user.id, projection });
      active += 1;
      peak = Math.max(peak, active);
      try { await gate.ready; return value; }
      finally { active -= 1; }
    };
    const emptyWork = { needs_me: [], waiting: [] };
    const learning = {
      projectWork: (user: AuthUser) => project("learning-work", user, []),
      readiness: (user: AuthUser) => project("learning-readiness", user, null),
    };
    const finance = {
      work: (user: AuthUser) => project("finance-work", user, emptyWork),
      discovery: (user: AuthUser) => project("finance-discovery", user, { can_record_charge: false, accounts: [] }),
    };
    const feeReviews = { work: (user: AuthUser) => project("fee-reviews", user, emptyWork) };
    const resources = {
      work: (user: AuthUser) => project("resources-work", user, emptyWork),
      discovery: (user: AuthUser) => project("resources-discovery", user, { can_manage: false, can_issue: false, borrower: false, has_loans: false }),
    };
    const facilities = {
      work: (user: AuthUser) => {
        const item: FacilitiesWorkRecord = {
          id: user.id, repair_id: user.id, revision: 1, title: `${user.first_name}'s repair`, state: "review_needed",
          href: `/areas/facilities?repair_id=${user.id}`, created_at: instant.toISOString(), due_at: null,
          message_id: null, owner: { user_id: user.id, label: user.first_name }, action: "work",
        };
        return project("facilities-work", user, { needs_me: [item], waiting: [] });
      },
      discovery: (user: AuthUser) => project("facilities-discovery", user, { can_manage: false, can_report: false, has_repairs: true }),
    };
    const accommodation = {
      work: (user: AuthUser) => project("accommodation-work", user, emptyWork),
      discovery: (user: AuthUser) => project("accommodation-discovery", user, { can_manage: false, can_offer: false, has_stays: false }),
    };
    const dining = {
      work: (user: AuthUser) => project("dining-work", user, emptyWork),
      discovery: (user: AuthUser) => project("dining-discovery", user, { can_manage: false, has_services: false, has_published_sessions: false }),
      ownedAvailability: () => Promise.resolve({ items: [], warnings: [] }),
    };
    const service = new WorkspaceService(
      { load: () => Promise.resolve(snapshot) } as never, clock as never,
      undefined, undefined, undefined, undefined, learning as never, finance as never, undefined,
      feeReviews as never, resources as never, facilities as never, accommodation as never, dining as never,
    );
    const person = (id: string, first_name: string): AuthUser => ({
      id, first_name, last_name: "Fixture", username: first_name.toLowerCase(), email: `${first_name.toLowerCase()}@example.test`,
      role: "member", is_active: true, active_school_id: school,
    });
    const firstPerson = person("00000000-0000-4000-8000-000000000004", "First");
    const secondPerson = person("00000000-0000-4000-8000-000000000005", "Second");
    const view = { mode: "live", institution_id: school, namespace_id: `live:${school}` } as const;
    const first = service.manifest(firstPerson, null, view);
    const second = service.manifest(secondPerson, null, view);
    try {
      await setImmediate();
      // A limit instantiated separately by each manifest would start six;
      // an unbounded Promise.all would eagerly start all 26 native reads.
      expect(started).toHaveLength(3);
      expect(active).toBe(3);
    } finally { gate.release(); }

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(started.filter((entry) => entry.user === firstPerson.id)).toHaveLength(13);
    expect(started.filter((entry) => entry.user === secondPerson.id)).toHaveLength(13);
    expect(firstResult.context.actor_user_id).toBe(firstPerson.id);
    expect(secondResult.context.actor_user_id).toBe(secondPerson.id);
    expect(firstResult.work.items.map((item) => item.title)).toEqual(["First's repair"]);
    expect(secondResult.work.items.map((item) => item.title)).toEqual(["Second's repair"]);
  });
});
