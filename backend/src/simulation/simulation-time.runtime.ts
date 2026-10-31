import type { PersistedSimulationRun } from "./simulation.contracts.js";

export const SIMULATION_CHECKPOINT_QUANTUM_MS = 5 * 60 * 1_000;
export const SIMULATION_MAX_ADVANCE_STEP_MS = 24 * 60 * 60 * 1_000;

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO date-time.`);
  return parsed;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function assertSpeed(value: number): void {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error("Simulation speed must be between 1 and 100.");
  }
}

export function projectedVirtualNow(
  run: Pick<PersistedSimulationRun,
    "status" | "speed" | "virtual_now" | "wall_anchor_at" | "virtual_anchor_at" | "end_at">,
  wallNow: string,
): string {
  if (!run.virtual_now) throw new Error("A captured simulation must have a virtual clock.");
  if (run.status !== "running") return new Date(run.virtual_now).toISOString();
  if (!run.wall_anchor_at || !run.virtual_anchor_at) {
    throw new Error("A running simulation must retain wall and virtual clock anchors.");
  }
  assertSpeed(run.speed);
  const wallDelta = Math.max(0, instant(wallNow, "Wall time") - instant(run.wall_anchor_at, "Wall anchor"));
  const projected = instant(run.virtual_anchor_at, "Virtual anchor") + wallDelta * run.speed;
  const capped = run.end_at ? Math.min(projected, instant(run.end_at, "Simulation end")) : projected;
  return iso(Math.max(instant(run.virtual_now, "Committed virtual time"), capped));
}

export function advanceTarget(input: {
  run: Pick<PersistedSimulationRun,
    "status" | "speed" | "virtual_started_at" | "virtual_now" | "wall_anchor_at" | "virtual_anchor_at" | "end_at">;
  wall_now: string;
  max_step_ms?: number;
  quantum_ms?: number;
}): string {
  const committed = instant(input.run.virtual_now ?? "", "Committed virtual time");
  const started = instant(input.run.virtual_started_at ?? "", "Virtual start time");
  const projected = instant(projectedVirtualNow(input.run, input.wall_now), "Projected virtual time");
  const maxStep = input.max_step_ms ?? SIMULATION_MAX_ADVANCE_STEP_MS;
  if (!Number.isSafeInteger(maxStep) || maxStep <= 0) throw new Error("Maximum advance step must be positive.");
  const quantum = input.quantum_ms ?? SIMULATION_CHECKPOINT_QUANTUM_MS;
  if (!Number.isSafeInteger(quantum) || quantum <= 0) throw new Error("Checkpoint quantum must be positive.");
  const elapsed = Math.max(0, committed - started);
  const nextAligned = started + (Math.floor(elapsed / quantum) + 1) * quantum;
  const end = input.run.end_at ? instant(input.run.end_at, "Simulation end") : Number.POSITIVE_INFINITY;
  return iso(Math.min(projected, committed + maxStep, nextAligned, end));
}

export function nextSimulationWakeAt(input: {
  wall_now: string;
  virtual_now: string;
  virtual_started_at?: string;
  wall_anchor_at?: string;
  virtual_anchor_at?: string;
  speed: number;
  end_at: string | null;
  next_event_at: string | null;
  quantum_ms?: number;
}): string | null {
  assertSpeed(input.speed);
  const current = instant(input.virtual_now, "Virtual time");
  const quantum = input.quantum_ms ?? SIMULATION_CHECKPOINT_QUANTUM_MS;
  if (!Number.isSafeInteger(quantum) || quantum <= 0) throw new Error("Checkpoint quantum must be positive.");
  const started = input.virtual_started_at ? instant(input.virtual_started_at, "Virtual start time") : current;
  const elapsed = Math.max(0, current - started);
  const nextAligned = started + (Math.floor(elapsed / quantum) + 1) * quantum;
  const candidates = [nextAligned];
  if (input.end_at) candidates.push(instant(input.end_at, "Simulation end"));
  if (input.next_event_at) candidates.push(instant(input.next_event_at, "Next event"));
  const future = candidates.filter((candidate) => candidate > current);
  if (future.length === 0) return null;
  if ((input.wall_anchor_at === undefined) !== (input.virtual_anchor_at === undefined)) {
    throw new Error("Simulation wall and virtual anchors must be supplied together.");
  }
  const wallNow = instant(input.wall_now, "Wall time");
  const wallAnchor = input.wall_anchor_at === undefined
    ? wallNow
    : instant(input.wall_anchor_at, "Wall anchor");
  const virtualAnchor = input.virtual_anchor_at === undefined
    ? current
    : instant(input.virtual_anchor_at, "Virtual anchor");
  const scheduledWall = wallAnchor + (Math.min(...future) - virtualAnchor) / input.speed;
  // A late or restarted worker catches up checkpoint-by-checkpoint immediately,
  // while the persisted anchor keeps the configured speed tied to wall time.
  return iso(Math.max(wallNow + 1, Math.ceil(scheduledWall)));
}

export function simulationReachedEnd(virtualNow: string, endAt: string | null): boolean {
  return endAt !== null && instant(virtualNow, "Virtual time") >= instant(endAt, "Simulation end");
}

/**
 * Selects the greatest completed checkpoint offset present in every run. This
 * prevents comparisons from silently using different simulated durations.
 */
export function greatestCommonCheckpointDuration(
  offsetsByRun: readonly (readonly number[])[],
  requestedMaximum?: number,
): number {
  if (offsetsByRun.length < 2) throw new Error("At least two runs are required for comparison.");
  const limit = requestedMaximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Comparison duration must be non-negative.");
  const normalized = offsetsByRun.map((offsets) => new Set(offsets.filter((offset) => (
    Number.isSafeInteger(offset) && offset >= 0 && offset <= limit
  ))));
  let common = [...(normalized[0] ?? new Set<number>())];
  for (const offsets of normalized.slice(1)) common = common.filter((offset) => offsets.has(offset));
  if (common.length === 0) {
    throw new Error("The selected runs do not yet share a completed comparison checkpoint.");
  }
  return Math.max(...common);
}

export function metricDelta(baseline: number | null, value: number | null): {
  delta: number | null;
  delta_percent: number | null;
} {
  if (baseline === null || value === null) return { delta: null, delta_percent: null };
  const delta = value - baseline;
  return {
    delta,
    delta_percent: baseline === 0 ? null : (delta / Math.abs(baseline)) * 100,
  };
}
