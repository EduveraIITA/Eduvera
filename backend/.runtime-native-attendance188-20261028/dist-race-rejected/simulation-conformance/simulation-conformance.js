import { createHash } from "node:crypto";
import { SIMULATION_CONFORMANCE_BUILD, } from "./simulation-conformance.generated.js";
import { SIMULATION_CONFORMANCE_REVISION, SIMULATION_BOUNDARY_REGISTRY, SIMULATION_EFFECT_FAMILY_REGISTRY, SIMULATION_MODULE_REGISTRY, SIMULATION_STANDALONE_WORKER_REGISTRY, SIMULATION_WORKER_REGISTRY, evaluateRegisteredModuleEvidence, } from "./simulation-conformance.registry.js";
function inventoryDigest(value) {
    return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
/**
 * Runtime receipt produced from the lock that CI verified against the current
 * repository. A stale build lock and concrete unadapted material boundary fail
 * closed. Capability evidence remains visible per module without falsely
 * claiming exhaustive workflow parity or disabling otherwise isolated worlds.
 */
export function currentSimulationPlatformConformance() {
    const coverage = evaluateRegisteredModuleEvidence();
    const blockers = [];
    blockers.push(...SIMULATION_WORKER_REGISTRY
        .filter((worker) => worker.conformance === "required")
        .map((worker) => `worker:${worker.owner}:${worker.disposition}`));
    blockers.push(...SIMULATION_STANDALONE_WORKER_REGISTRY
        .filter((worker) => worker.conformance === "required")
        .map((worker) => `standalone_worker:${worker.owner}:${worker.disposition}`));
    blockers.push(...SIMULATION_BOUNDARY_REGISTRY
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
        });
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
    blockers;
    constructor(blockers) {
        super(`Simulation platform conformance is incomplete: ${blockers.join(", ")}`);
        this.blockers = blockers;
        this.name = "SimulationPlatformConformanceError";
    }
}
export function assertCurrentSimulationPlatformConformance() {
    const attestation = currentSimulationPlatformConformance();
    if (!attestation.ready)
        throw new SimulationPlatformConformanceError(attestation.blockers);
    return attestation;
}
export { SIMULATION_CONFORMANCE_BUILD, SIMULATION_CONFORMANCE_REVISION, };
//# sourceMappingURL=simulation-conformance.js.map