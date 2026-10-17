import type { ExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../campus-model-core/execution-environment.runtime.js";
import type { TransientExecutionRunReference } from "../campus-model-core/transient-execution-run.contracts.js";

export type ExecutionEnvironmentView =
  | {
    mode: "live";
    institution_id: string | null;
    namespace_id: `live:${string}` | null;
  }
  | {
    mode: "simulation";
    institution_id: string;
    scenario_id: string;
    run_id: string;
    namespace_id: `scenario:${string}:run:${string}`;
    virtual_clock: { now: string; time_zone: string };
    source_snapshot_at: string;
    expires_at: string;
    unavailable?: never;
    unavailable_reason?: never;
  }
  | {
    mode: "simulation";
    unavailable: true;
    unavailable_reason: UnavailableSimulationReason;
    institution_id: string;
    scenario_id: string;
    run_id: string;
    namespace_id: string;
    expires_at: string | null;
    virtual_clock?: never;
    source_snapshot_at?: never;
  };

export type UnavailableSimulationReason =
  | "binding_invalid"
  | "expired"
  | "run_unavailable"
  | "authorization_lost"
  | "runtime_unavailable"
  | "data_plane_unavailable";

export interface ResolvedSessionExecutionEnvironment {
  environment: ExecutionEnvironment | null;
  view: ExecutionEnvironmentView;
}

export function liveSessionExecutionEnvironment(
  institutionId: string | null | undefined,
): ResolvedSessionExecutionEnvironment {
  if (!institutionId) {
    return {
      environment: null,
      view: { mode: "live", institution_id: null, namespace_id: null },
    };
  }
  const clock = Object.freeze({
    now: () => new Date(),
    nowIso: () => new Date().toISOString(),
  });
  const environment = createLiveExecutionEnvironment({
    institution_id: institutionId,
    clock,
  });
  return {
    environment,
    view: {
      mode: "live",
      institution_id: institutionId,
      namespace_id: environment.namespace_id,
    },
  };
}

export function simulationSessionExecutionEnvironment(
  run: TransientExecutionRunReference,
  coverageGate: { manifest_ref: string; checked_at: string },
): ResolvedSessionExecutionEnvironment {
  const instant = new Date(run.virtual_now).toISOString();
  const virtualClock = Object.freeze({
    now: () => new Date(instant),
    nowIso: () => instant,
    advanceBy: () => {
      throw new Error("A request-bound Simulation clock cannot be advanced by domain code.");
    },
    advanceTo: () => {
      throw new Error("A request-bound Simulation clock cannot be advanced by domain code.");
    },
  });
  const environment = createSimulationExecutionEnvironment({
    institution_id: run.institution_id,
    scenario_id: run.scenario_id,
    run_id: run.run_id,
    virtual_clock: virtualClock,
    source_snapshot_ref: run.source_snapshot_ref,
    coverage_gate: {
      status: "passed",
      manifest_ref: coverageGate.manifest_ref,
      checked_at: coverageGate.checked_at,
    },
    expires_at: run.expires_at,
  });
  return {
    environment,
    view: {
      mode: "simulation",
      institution_id: run.institution_id,
      scenario_id: run.scenario_id,
      run_id: run.run_id,
      namespace_id: environment.namespace_id,
      virtual_clock: { now: instant, time_zone: run.time_zone },
      source_snapshot_at: run.source_snapshot_at,
      expires_at: run.expires_at,
    },
  };
}

/**
 * Keeps an authenticated session visibly bound to a Simulation that can no
 * longer be resolved. There is deliberately no executable environment or
 * virtual clock: ordinary domain requests must fail closed until the user
 * explicitly returns the session to Live.
 */
export function unavailableSimulationSessionExecutionEnvironment(
  binding: {
    school_id: string;
    scenario_id: string;
    run_id: string;
    namespace_id: string;
    expires_at: Date | string;
  },
  reason: UnavailableSimulationReason,
): ResolvedSessionExecutionEnvironment {
  const expiry = new Date(binding.expires_at);
  return {
    environment: null,
    view: {
      mode: "simulation",
      unavailable: true,
      unavailable_reason: reason,
      institution_id: binding.school_id,
      scenario_id: binding.scenario_id,
      run_id: binding.run_id,
      namespace_id: binding.namespace_id,
      expires_at: Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null,
    },
  };
}
