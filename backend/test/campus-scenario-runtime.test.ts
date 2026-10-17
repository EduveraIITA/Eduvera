import { describe, expect, it } from "vitest";
import type {
  PureScenarioExecutor,
  ScenarioBehaviourPolicy,
  ScenarioExecutorInput,
  ScenarioRunRequest,
  ScenarioValue,
} from "../src/campus-model-core/scenarios/contracts.js";
import { IsolatedScenarioEngine, scenarioSnapshotHash } from "../src/campus-model-core/scenarios/engine.js";
import {
  createScenarioExecutionContext,
  DeterministicVirtualClock,
  SeededRandom,
  SideEffectDeniedError,
} from "../src/campus-model-core/scenarios/runtime.js";
import {
  InMemoryScenarioRunStore,
  ScenarioRunStoreCapacityError,
} from "../src/campus-model-core/scenarios/store.js";

const policy: ScenarioBehaviourPolicy = {
  policy_id: "cover-response-distribution",
  version_id: "cover-response-distribution:v3",
  configuration_hash: "sha256:behaviour-v3",
  effective_from: "2026-10-01T00:00:00.000Z",
  effective_until: null,
  calibration: {
    method: "historical_role_cohort",
    calibrated_at: "2026-10-16T18:30:00.000Z",
    sample_size: 120,
    window: { from: "2026-04-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
  },
  parameters: { response_minutes_mean: 20, response_minutes_sd: 5 },
};

function request(monteCarlo = false): ScenarioRunRequest {
  return {
    mode: "simulation",
    scenario_id: "scenario-teacher-away",
    namespace_id: "scenario:scenario-teacher-away",
    institution_id: "school-cis",
    run_id: "run-001",
    requested_at: "2026-10-17T04:00:00.000Z",
    expires_at: "2026-10-17T05:00:00.000Z",
    deterministic_seed: "cis:teacher-away:2026-10",
    source: {
      snapshot: { capacity: 40, planned_students: 30, response_minutes: 20 },
      snapshot_version: "campus-snapshot:42",
      snapshot_at: "2026-10-17T03:55:00.000Z",
      source_revisions: { timetable: "81", staff: "19" },
    },
    horizon: { from: "2026-10-18T03:30:00.000Z", to: "2026-11-17T12:30:00.000Z" },
    configuration_snapshot: [{
      kind: "operating_rule",
      key: "staff_cover",
      version_id: "staff-cover:v4",
      configuration_hash: "sha256:staff-cover-v4",
      effective_from: "2026-10-01T00:00:00.000Z",
      effective_until: null,
    }],
    identities: [{
      human: { kind: "human", human_agent_id: "human-kavita", person_id: "person-kavita" },
      delegates: [{
        kind: "delegate",
        delegate_agent_id: "delegate-kavita",
        acts_for_human_agent_id: "human-kavita",
        authority_snapshot_ref: "authority:kavita:v2",
      }],
      persona: {
        kind: "scenario_persona",
        scenario_persona_id: "persona-kavita",
        scenario_id: "scenario-teacher-away",
        source_human_agent_id: "human-kavita",
        behaviour_policy_version_id: monteCarlo ? policy.version_id : null,
      },
    }],
    assumptions: ["Published timetable remains effective for the horizon."],
    baseline: { key: "baseline", label: "Current plan", intervention: null },
    alternative: {
      key: "alternative",
      label: "Kavita unavailable",
      intervention: { uncovered_classes_added: 3 },
    },
    monte_carlo: monteCarlo ? { sample_count: 40, behaviour_policy: policy } : null,
  };
}

const executor: PureScenarioExecutor = {
  executor_id: "test-campus-executor",
  version: "1.0.0",
  execute(input: ScenarioExecutorInput) {
    const snapshot = input.snapshot as Readonly<Record<string, ScenarioValue>>;
    const intervention = input.plan.intervention as Readonly<Record<string, ScenarioValue>> | null;
    const added = typeof intervention?.uncovered_classes_added === "number"
      ? intervention.uncovered_classes_added
      : 0;
    const responseBase = typeof snapshot.response_minutes === "number" ? snapshot.response_minutes : 0;
    let responseMinutes = responseBase;
    if (input.sample.kind === "monte_carlo") {
      const parameters = input.sample.behaviour_policy?.parameters as Readonly<Record<string, ScenarioValue>>;
      const mean = typeof parameters.response_minutes_mean === "number"
        ? parameters.response_minutes_mean
        : Number.NaN;
      const deviation = typeof parameters.response_minutes_sd === "number"
        ? parameters.response_minutes_sd
        : Number.NaN;
      responseMinutes = input.context.random.normal(mean, deviation);
    }
    input.context.message_dispatcher.dispatch({
      id: `message:${input.plan.key}:${input.sample.index ?? "deterministic"}`,
      scenario_id: input.context.scenario_id,
      namespace_id: input.context.namespace_id,
      run_id: input.context.run_id,
      sender_persona_id: "persona-kavita",
      recipient_persona_id: "persona-kavita",
      protocol: "scenario.self_check",
      payload: { plan: input.plan.key },
      sent_at: input.context.clock.nowIso(),
    });
    return Promise.resolve({
      metrics: {
        "staff.uncovered_classes": added,
        "staff.cover_response_minutes": responseMinutes + added,
      },
      artifacts: [{
        kind: "projected_cover_state",
        payload: { added },
        occurred_at: input.context.clock.nowIso(),
      }],
      assumptions: ["Role-cohort behavior is used; no individual intent is inferred."],
      unsupported: [{
        domain: "transport",
        capability: "live_vehicle_provider",
        reason: "No deterministic scenario executor is registered.",
      }],
    });
  },
};

describe("isolated campus scenario runtime", () => {
  it("runs repeatable baseline and alternative comparisons without calibrated bounds", async () => {
    const engine = new IsolatedScenarioEngine();
    const first = await engine.run(request(), executor);
    const second = await engine.run(request(), executor);

    expect(first).toEqual(second);
    expect(first.snapshot_hash).toHaveLength(64);
    expect(first.snapshot_hash).toBe(scenarioSnapshotHash({
      response_minutes: 20,
      planned_students: 30,
      capacity: 40,
    }));
    expect(first.comparison["staff.uncovered_classes"]).toEqual({
      baseline: 0,
      alternative: 3,
      delta: 3,
      delta_percent: null,
    });
    expect(first.ensemble).toMatchObject({ status: "not_calibrated", sample_count: 0 });
    expect(first.ensemble.metrics["staff.cover_response_minutes"]).toEqual({
      baseline: { p10: null, p50: 20, p90: null },
      alternative: { p10: null, p50: 23, p90: null },
      delta: { p10: null, p50: 3, p90: null },
    });
    expect(first.alternative.artifacts[0]).toMatchObject({
      scenario_id: first.scenario_id,
      namespace_id: first.namespace_id,
      run_id: first.run_id,
      kind: "projected_cover_state",
    });
    expect(first.alternative.messages[0]).toMatchObject({
      scenario_id: first.scenario_id,
      namespace_id: first.namespace_id,
      run_id: first.run_id,
    });
    expect(first.unsupported).toHaveLength(1);
  });

  it("runs a deterministic calibrated ensemble with common-random-number comparison", async () => {
    const engine = new IsolatedScenarioEngine();
    const first = await engine.run(request(true), executor);
    const second = await engine.run(request(true), executor);
    const response = first.ensemble.metrics["staff.cover_response_minutes"];

    expect(first).toEqual(second);
    expect(first.ensemble.status).toBe("calibrated");
    expect(first.ensemble.sample_count).toBe(40);
    expect(response?.baseline.p10).not.toBeNull();
    expect(response?.baseline.p90).not.toBeNull();
    expect(response?.delta).toEqual({ p10: 3, p50: 3, p90: 3 });
    expect(first.ensemble.behaviour_policy?.version_id).toBe(policy.version_id);
  });

  it("requires an explicit valid stochastic policy instead of inventing behavior", async () => {
    const invalid = request(true);
    const invalidPolicy = invalid.monte_carlo?.behaviour_policy;
    if (!invalidPolicy) throw new Error("Fixture must include policy.");
    invalid.monte_carlo = {
      sample_count: 4,
      behaviour_policy: { ...invalidPolicy, version_id: "" },
    };
    await expect(new IsolatedScenarioEngine().run(invalid, executor))
      .rejects.toThrow("versioned behaviour policy");
  });

  it("separates human, delegate and scenario persona identities and denies live side effects", () => {
    const fixture = request();
    const context = createScenarioExecutionContext({
      mode: fixture.mode,
      namespace_id: fixture.namespace_id,
      institution_id: fixture.institution_id,
      scenario_id: fixture.scenario_id,
      run_id: fixture.run_id,
      deterministic_seed: fixture.deterministic_seed,
      horizon: fixture.horizon,
      configuration_snapshot: fixture.configuration_snapshot,
      identities: fixture.identities,
    });

    expect(context.identity_resolver.humanForPersona("persona-kavita"))
      .toMatchObject({ kind: "human", human_agent_id: "human-kavita" });
    expect(context.identity_resolver.delegate("delegate-kavita"))
      .toMatchObject({ kind: "delegate", acts_for_human_agent_id: "human-kavita" });
    expect(context.identity_resolver.resolvePersona("delegate-kavita")).toBeNull();
    expect(() => context.side_effect_policy.assertPermitted({
      kind: "production_command",
      target_namespace_id: fixture.institution_id,
      target_ref: "attendance.submit",
    })).toThrow(SideEffectDeniedError);
    expect(() => context.side_effect_policy.assertPermitted({
      kind: "external_notification",
      target_namespace_id: fixture.namespace_id,
      target_ref: "teacher@example.test",
    })).toThrow(SideEffectDeniedError);
  });

  it("uses deterministic random streams and a bounded forward-only virtual clock", () => {
    const first = new SeededRandom("seed-a");
    const second = new SeededRandom("seed-a");
    expect([first.next(), first.integer(1, 10), first.normal(5, 2)])
      .toEqual([second.next(), second.integer(1, 10), second.normal(5, 2)]);
    expect(first.fork("cover").next()).toBe(new SeededRandom("seed-a").fork("cover").next());

    const clock = new DeterministicVirtualClock(
      "2026-10-17T04:00:00.000Z",
      "2026-10-17T05:00:00.000Z",
    );
    expect(clock.advanceBy(15 * 60_000)).toBe("2026-10-17T04:15:00.000Z");
    expect(() => clock.advanceTo("2026-10-17T04:14:00.000Z")).toThrow("backwards");
    expect(() => clock.advanceTo("2026-10-17T05:01:00.000Z")).toThrow("horizon");
  });

  it("keeps results transient, tenant-scoped, defensively copied and TTL/quota bounded", async () => {
    let now = new Date("2026-10-17T04:01:00.000Z");
    const store = new InMemoryScenarioRunStore({
      now: () => now,
      max_total_runs: 2,
      max_runs_per_institution: 1,
      max_result_bytes: 1_000_000,
    });
    const result = await new IsolatedScenarioEngine().run(request(), executor);
    store.save(result);

    const read = store.get(result.institution_id, result.run_id);
    expect(read).toEqual(result);
    if (!read) throw new Error("Stored run expected.");
    (read as unknown as { assumptions: string[] }).assumptions.push("mutated copy");
    expect(store.get(result.institution_id, result.run_id)?.assumptions)
      .not.toContain("mutated copy");
    expect(store.get("another-school", result.run_id)).toBeNull();

    const second = structuredClone(result);
    second.run_id = "run-002";
    expect(() => store.save(second)).toThrow(ScenarioRunStoreCapacityError);

    now = new Date(result.expires_at);
    expect(store.get(result.institution_id, result.run_id)).toBeNull();
    expect(store.size()).toBe(0);
  });
});
