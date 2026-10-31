import { HttpException, HttpStatus } from "@nestjs/common";
import { config } from "../config.js";
export const SIMULATION_RESOURCE_POLICY = Symbol.for("thatcampus.simulation-resource-policy");
export const DEFAULT_SIMULATION_RESOURCE_POLICY = Object.freeze({
    max_worlds_per_institution: 12,
    max_running_runs_per_institution: 4,
    max_leases_per_institution: 4,
    max_storage_bytes_per_institution: 2_147_483_648,
    run_storage_reservation_bytes: 104_857_600,
    max_pinned_runs_per_institution: 4,
    terminal_retention_ms: 30 * 24 * 60 * 60 * 1_000,
    preparation_timeout_ms: 15 * 60 * 1_000,
    worker_interval_ms: 1_000,
    worker_max_runs_per_poll: 4,
    worker_lease_seconds: 60,
    gc_enabled: false,
    gc_interval_ms: 60_000,
    gc_batch_size: 4,
    gc_lease_seconds: 120,
});
export function simulationResourcePolicy() {
    const settings = config();
    return Object.freeze({
        max_worlds_per_institution: settings.SIMULATION_MAX_WORLDS_PER_INSTITUTION,
        max_running_runs_per_institution: settings.SIMULATION_MAX_RUNNING_RUNS_PER_INSTITUTION,
        max_leases_per_institution: settings.SIMULATION_MAX_LEASES_PER_INSTITUTION,
        max_storage_bytes_per_institution: settings.SIMULATION_MAX_STORAGE_BYTES_PER_INSTITUTION,
        run_storage_reservation_bytes: settings.SIMULATION_RUN_STORAGE_RESERVATION_BYTES,
        max_pinned_runs_per_institution: settings.SIMULATION_MAX_PINNED_RUNS_PER_INSTITUTION,
        terminal_retention_ms: settings.SIMULATION_TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        preparation_timeout_ms: settings.SIMULATION_PREPARATION_TIMEOUT_MS,
        worker_interval_ms: settings.SIMULATION_WORKER_INTERVAL_MS,
        worker_max_runs_per_poll: settings.SIMULATION_WORKER_MAX_RUNS_PER_POLL,
        worker_lease_seconds: settings.SIMULATION_WORKER_LEASE_SECONDS,
        gc_enabled: settings.SIMULATION_GC_ENABLED,
        gc_interval_ms: settings.SIMULATION_GC_INTERVAL_MS,
        gc_batch_size: settings.SIMULATION_GC_BATCH_SIZE,
        gc_lease_seconds: settings.SIMULATION_GC_LEASE_SECONDS,
    });
}
export function terminalRetentionExpiry(now, policy) {
    return new Date(Date.parse(now) + policy.terminal_retention_ms).toISOString();
}
export class SimulationCapacityException extends HttpException {
    constructor(resource, limit) {
        const messages = {
            worlds: "Saved simulations are full. Remove an ended simulation to make room; stopping a run alone does not free a saved place.",
            running_runs: "The running simulation limit has been reached. Pause or stop another running simulation, then try again.",
            storage: "Simulation storage is full. Remove an ended simulation to make room, or ask for a higher storage limit.",
            pinned_runs: "The pinned simulation limit has been reached. Unpin another ended simulation before pinning this one.",
        };
        super({
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            code: "simulation_institution_capacity",
            resource,
            limit,
            message: messages[resource],
        }, HttpStatus.TOO_MANY_REQUESTS);
    }
}
//# sourceMappingURL=simulation-resource-policy.js.map