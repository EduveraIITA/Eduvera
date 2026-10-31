import { createLiveExecutionEnvironment, createSimulationExecutionEnvironment, } from "../campus-model-core/execution-environment.runtime.js";
export function liveSessionExecutionEnvironment(institutionId) {
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
export function simulationSessionExecutionEnvironment(run, coverageGate) {
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
        ...(["stopped", "completed"].includes(run.run_status ?? "") ? { domain_read_only: true } : {}),
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
            ...(run.run_status ? { run_status: run.run_status } : {}),
            ...(run.speed ? { speed: run.speed } : {}),
            ...(run.world_revision !== undefined ? { world_revision: run.world_revision } : {}),
        },
    };
}
/**
 * Keeps an authenticated session visibly bound to a Simulation that can no
 * longer be resolved. There is deliberately no executable environment or
 * virtual clock: ordinary domain requests must fail closed until the user
 * explicitly returns the session to Live.
 */
export function unavailableSimulationSessionExecutionEnvironment(binding, reason) {
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
//# sourceMappingURL=session-execution-environment.js.map