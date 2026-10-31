import { setTimeout } from "node:timers/promises";
import { PostgresQueryCompiler, type CompiledQuery, type OperationNode } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import { RequestsService } from "../src/requests/requests.service.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";

const school = "20000000-0000-4000-8000-000000000002";
const actor = { id: "10000000-0000-4000-8000-000000000001", active_school_id: school } as AuthUser;
const context = { school_id: school, school_name: "Synthetic campus", timezone: "Asia/Kolkata", student_id: null, student_name: null };
interface Probe {
  schoolAttendanceClock: () => Promise<unknown>;
  principalCanonicalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
  principalOperationalItems: (scope: unknown) => Promise<RequestInboxItem[]>;
}

function fixture() {
  const compiler = new PostgresQueryCompiler();
  const scope = new ExecutionDataPlaneScope();
  let active = 0, peak = 0;
  const observed: Array<{ sql: string; world: string | null; at: string }> = [];
  const row = { id: "followup-1", target_id: "invoice-1", title: "Source-owned item", detail: "Authoritative source",
    status_label: "Needs review", due_at: "2026-10-29T12:00:00.000Z", occurs_at: "2026-10-28T12:00:00.000Z",
    created_at: "2026-10-27T12:00:00.000Z", urgent: false, subject_label: null };
  const executor = {
    transformQuery: (node: OperationNode) => node,
    compileQuery: (node: Parameters<PostgresQueryCompiler["compileQuery"]>[0], queryId: Parameters<PostgresQueryCompiler["compileQuery"]>[1]) => compiler.compileQuery(node, queryId),
    executeQuery: async (query: CompiledQuery) => {
      active += 1;
      peak = Math.max(peak, active);
      // Models clients occupied behind the cold COW gate. A fourth simultaneous
      // lease would fail instead of silently using an unlimited fake pool.
      if (active > 3) { active -= 1; throw new Error("cold finite pool exhausted"); }
      observed.push({ sql: query.sql, world: scope.current()?.namespace_id ?? null, at: executionNow().toISOString() });
      try {
        await setTimeout(5);
        if (query.sql.includes("SELECT membership.role\n")) return { rows: [{ role: "admin" }] };
        if (query.sql.includes("to_regclass('fee_gateway_orders')")) return { rows: [{ available: true }] };
        if (query.sql.includes("FROM fee_gateway_orders gateway")) return { rows: [{ ...row, id: "payment-1" }] };
        if (query.sql.includes("SELECT followup.id,concat")) return { rows: [row] };
        return { rows: [] };
      } finally { active -= 1; }
    },
  };
  const database = { getExecutor: () => executor } as unknown as DatabaseService;
  const service = new RequestsService(database, undefined, scope);
  const probe = service as unknown as Probe;
  vi.spyOn(probe, "schoolAttendanceClock").mockResolvedValue({ date: "2026-10-28", academic_mode: "scheduled_session" });
  return { probe, scope, observed, peak: () => peak, active: () => active };
}

describe("Requests cold-world read admission", () => {
  it("caps nested and overlapping principal projections at three leaves and preserves complete source results", async () => {
    const f = fixture();
    const [first, second, operational] = await Promise.all([
      f.probe.principalCanonicalItems(actor, context),
      f.probe.principalCanonicalItems(actor, context),
      f.probe.principalOperationalItems(context),
    ]);
    expect(first.map(item => item.kind)).toEqual(["attendance_followup", "payment_capture_review"]);
    expect(second).toEqual(first);
    expect(operational.map(item => item.kind)).toEqual(["payment_capture_review"]);
    expect(first[1]).toMatchObject({ source_id: "payment-1", href: expect.stringContaining("invoice-1") });
    expect(f.peak()).toBe(3);
    expect(f.active()).toBe(0);
    expect(f.observed.length).toBeGreaterThan(40);
  });

  it("keeps the originating run and clock when another world's query releases a queued slot", async () => {
    const f = fixture();
    const environment = (suffix: string, at: string) => createSimulationExecutionEnvironment({
      institution_id: school,
      scenario_id: `30000000-0000-4000-8000-00000000000${suffix}`,
      run_id: `40000000-0000-4000-8000-00000000000${suffix}`,
      source_snapshot_ref: "sha256:source", coverage_gate: { status: "passed", manifest_ref: "manifest:test", checked_at: "2026-10-28T12:00:00.000Z" },
      virtual_clock: { now: () => new Date(at), nowIso: () => at, advanceBy: () => { throw new Error("test clock"); }, advanceTo: () => { throw new Error("test clock"); } },
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const a = environment("1", "2026-11-01T12:00:00.000Z"), b = environment("2", "2026-12-01T12:00:00.000Z");
    await Promise.all([
      f.scope.run(a, () => f.probe.principalOperationalItems(context)),
      f.scope.run(b, () => f.probe.principalOperationalItems(context)),
    ]);
    expect(new Set(f.observed.map(item => item.world))).toEqual(new Set([a.namespace_id, b.namespace_id]));
    for (const query of f.observed) expect(query.at).toBe(query.world === a.namespace_id ? a.virtual_clock.nowIso() : b.virtual_clock.nowIso());
    expect(f.peak()).toBe(3);
    expect(f.active()).toBe(0);
  });
});
