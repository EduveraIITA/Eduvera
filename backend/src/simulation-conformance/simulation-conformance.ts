import { createHash } from "node:crypto";
import {
  SIMULATION_CONFORMANCE_BUILD,
} from "./simulation-conformance.generated.js";
import {
  SIMULATION_CONFORMANCE_REVISION,
  SIMULATION_BOUNDARY_REGISTRY,
  SIMULATION_EFFECT_FAMILY_REGISTRY,
  SIMULATION_MODULE_REGISTRY,
  SIMULATION_STANDALONE_WORKER_REGISTRY,
  SIMULATION_WORKER_REGISTRY,
  evaluateRegisteredModuleEvidence,
  type SimulationBoundaryRegistration,
  type SimulationDataPlaneCapability,
  type SimulationStandaloneWorkerRegistration,
  type SimulationWorkerRegistration,
} from "./simulation-conformance.registry.js";

export interface SimulationPlatformModuleAttestation {
  readonly module_id: string;
  readonly disposition: (typeof SIMULATION_MODULE_REGISTRY)[number]["disposition"];
  readonly capabilities: Readonly<Record<SimulationDataPlaneCapability, "verified" | "unverified" | "not_applicable">>;
}

export interface SimulationPlatformConformanceAttestation {
  readonly schema_version: 1;
  readonly revision: number;
  readonly fingerprint: string;
  readonly manifest_version: string;
  /** Safe to open: registered graph, lock, workers and material boundaries are fail-closed. */
  readonly ready: boolean;
  readonly blockers: readonly string[];
  /** Product evidence is reported independently; it never masquerades as a safety boundary. */
  readonly coverage_complete: boolean;
  readonly coverage_gaps: readonly string[];
  readonly modules: readonly SimulationPlatformModuleAttestation[];
  readonly effect_families: readonly string[];
  readonly worker_inventory_digest: string;
}

function inventoryDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/**
 * Runtime receipt produced from the lock that CI verified against the current
 * repository. A stale build lock and concrete unadapted material boundary fail
 * closed. Capability evidence remains visible per module without falsely
 * claiming exhaustive workflow parity or disabling otherwise isolated worlds.
 */
export function currentSimulationPlatformConformance(): SimulationPlatformConformanceAttestation {
  const coverage = evaluateRegisteredModuleEvidence();
  const blockers: string[] = [];
  blockers.push(...(SIMULATION_WORKER_REGISTRY as readonly SimulationWorkerRegistration[])
    .filter((worker) => worker.conformance === "required")
    .map((worker) => `worker:${worker.owner}:${worker.disposition}`));
  blockers.push(...(SIMULATION_STANDALONE_WORKER_REGISTRY as readonly SimulationStandaloneWorkerRegistration[])
    .filter((worker) => worker.conformance === "required")
    .map((worker) => `standalone_worker:${worker.owner}:${worker.disposition}`));
  blockers.push(...(SIMULATION_BOUNDARY_REGISTRY as readonly SimulationBoundaryRegistration[])
    .filter((boundary) => boundary.conformance === "required")
    .map((boundary) => `boundary:${boundary.kind}:${boundary.file}`));
  if (Number(SIMULATION_CONFORMANCE_BUILD.revision) !== Number(SIMULATION_CONFORMANCE_REVISION)) {
    blockers.push("conformance_revision_mismatch");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(SIMULATION_CONFORMANCE_BUILD.fingerprint)) {
    blockers.push("conformance_build_lock_invalid");
  }

  const modules = SIMULATION_MODULE_REGISTRY.map((module) => {
    const covered = new Set(coverage.covered_capabilities[module.module_class] ?? []);
    const operational = module.disposition === "campus_operational";
    return Object.freeze({
      module_id: module.module_class,
      disposition: module.disposition,
      capabilities: Object.freeze({
        snapshot: operational ? (covered.has("snapshot") ? "verified" : "unverified") : "not_applicable",
        queries: operational ? (covered.has("queries") ? "verified" : "unverified") : "not_applicable",
        commands: operational ? (covered.has("commands") ? "verified" : "unverified") : "not_applicable",
        events: operational ? (covered.has("events") ? "verified" : "unverified") : "not_applicable",
        realtime: operational ? (covered.has("realtime") ? "verified" : "unverified") : "not_applicable",
      }),
    } satisfies SimulationPlatformModuleAttestation);
  });

  return Object.freeze({
    schema_version: 1,
    revision: SIMULATION_CONFORMANCE_REVISION,
    fingerprint: SIMULATION_CONFORMANCE_BUILD.fingerprint,
    manifest_version: `simulation-platform/v${SIMULATION_CONFORMANCE_REVISION}`,
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers.sort()),
    coverage_complete: coverage.ready,
    coverage_gaps: coverage.incomplete,
    modules: Object.freeze(modules),
    effect_families: SIMULATION_EFFECT_FAMILY_REGISTRY,
    worker_inventory_digest: inventoryDigest({ timers: SIMULATION_WORKER_REGISTRY,
      standalone: SIMULATION_STANDALONE_WORKER_REGISTRY }),
  });
}

export class SimulationPlatformConformanceError extends Error {
  constructor(readonly blockers: readonly string[]) {
    super(`Simulation platform conformance is incomplete: ${blockers.join(", ")}`);
    this.name = "SimulationPlatformConformanceError";
  }
}

export function assertCurrentSimulationPlatformConformance(): SimulationPlatformConformanceAttestation {
  const attestation = currentSimulationPlatformConformance();
  if (!attestation.ready) throw new SimulationPlatformConformanceError(attestation.blockers);
  return attestation;
}

export {
  SIMULATION_CONFORMANCE_BUILD,
  SIMULATION_CONFORMANCE_REVISION,
};
