import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
// Infrastructure bindings, not alternate domain logic. They contain only ports
// addressing the dedicated Simulation database, never Live clients or credentials.
const bindings = new Map();
export function bindSimulationResources(binding) {
    const prior = bindings.get(binding.environment.namespace_id);
    if (prior && (prior.environment.run_id !== binding.environment.run_id
        || prior.environment.institution_id !== binding.environment.institution_id)) {
        throw new ConflictException("Simulation resources belong to a different world.");
    }
    bindings.set(binding.environment.namespace_id, binding);
}
export function unbindSimulationResources(namespaceId) {
    bindings.delete(namespaceId);
}
export function selectedSimulationResources() {
    const environment = executionEnvironmentStorage.getStore();
    if (environment?.kind !== "simulation")
        return null;
    const binding = bindings.get(environment.namespace_id);
    if (!binding || binding.environment.run_id !== environment.run_id
        || binding.environment.scenario_id !== environment.scenario_id
        || binding.environment.institution_id !== environment.institution_id) {
        throw new ConflictException({ code: "simulation_resources_unavailable",
            message: "This world's isolated effects and files are unavailable. Live services have not been used." });
    }
    return { ...binding, environment };
}
export function simulationLogicalDigest(value) {
    return createHash("sha256").update(value).digest("hex");
}
/** Capture a provider-neutral effect before any Live config or credential read. */
export async function captureSimulationProviderEffect(input) {
    const selected = selectedSimulationResources();
    if (!selected)
        return null;
    const { environment } = selected;
    const payload = input.payload ?? {};
    const digest = simulationLogicalDigest(JSON.stringify({ provider: input.provider, operation: input.operation,
        target: simulationLogicalDigest(input.logicalKey), payload }));
    const key = input.idempotencyKey ?? `${input.provider}:${input.operation}:${digest}:${executionNow().toISOString()}`;
    // An explicit logical-event key must replay the exact first envelope even if
    // the world's virtual clock has advanced. The sink still compares the full
    // digest, so reusing that key with changed payload remains a hard conflict.
    const replay = input.idempotencyKey
        ? await selected.effectReplay?.lookupEffectTiming(input.kind, key)
        : null;
    const requestedAt = replay?.requested_at ?? executionNow().toISOString();
    const receipt = await selected.effects.route(environment, {
        kind: input.kind, effect_id: simulationLogicalDigest(`${environment.run_id}:${key}`),
        schema_name: `simulation.${input.provider}.${input.operation}`, schema_version: 1,
        institution_id: environment.institution_id, namespace_id: environment.namespace_id,
        idempotency_key: key, correlation_id: `simulation-effect:${environment.run_id}:${digest}`,
        causation_id: null, requested_at: requestedAt,
        // An infrastructure adapter identity, never impersonation or a human grant.
        actor_agent_id: `simulation-effect-adapter:${environment.run_id}`,
        logical_target: { kind: input.provider, ref: `sha256:${simulationLogicalDigest(input.logicalKey)}` },
        privacy_class: "institution_internal", payload,
    });
    if (receipt.environment_kind !== "simulation")
        throw new Error("A Simulation effect returned a Live receipt.");
    return receipt;
}
//# sourceMappingURL=simulation-resources.js.map