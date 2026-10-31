import { createHash } from "node:crypto";
const LIVE_CURSOR_VERSION = "v2";
const SIMULATION_CURSOR_VERSION = "v3";
export function executionRealtimeBinding(environment) {
    return Object.freeze({
        environment,
        kind: environment.kind,
        institution_id: environment.institution_id,
        namespace_id: environment.namespace_id,
    });
}
export function liveRealtimeNamespace(institutionId) {
    return `live:${institutionId}`;
}
function simulationCursorScope(namespaceId) {
    return createHash("sha256").update(namespaceId).digest("base64url").slice(0, 16);
}
/**
 * Cursor identity is scoped to the server-selected environment. Live keeps the
 * established v2 format for compatible reconnects; Simulation includes an opaque
 * namespace fingerprint so a browser cursor from another run can only trigger a
 * full sync, never select or cross into that run.
 */
export function executionRealtimeCursor(binding, sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error("Realtime cursor sequence must be a non-negative safe integer.");
    }
    if (binding.kind === "live")
        return `${LIVE_CURSOR_VERSION}-${sequence}`;
    return `${SIMULATION_CURSOR_VERSION}-${simulationCursorScope(binding.namespace_id)}-${sequence}`;
}
/**
 * Last-Event-ID is only a position inside the already server-bound environment.
 * It is deliberately incapable of selecting a namespace.
 */
export function parseExecutionRealtimeCursor(binding, value) {
    if (!value)
        return null;
    const match = binding.kind === "live"
        ? value.match(/^v2-(\d+)$/)
        : value.match(new RegExp(`^v3-${simulationCursorScope(binding.namespace_id)}-(\\d+)$`));
    const sequence = match?.[1] === undefined ? null : Number(match[1]);
    return sequence !== null && Number.isSafeInteger(sequence) && sequence >= 0
        ? sequence
        : null;
}
//# sourceMappingURL=execution-realtime.js.map