import { createHash } from "node:crypto";
function required(value, label) {
    if (!value.trim())
        throw new Error(`${label} must not be empty.`);
    return value;
}
function canonicalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function sourceAgentId(source) {
    return source.kind === "human" ? source.human_agent_id : source.agent_id;
}
function safeConfigurationRef(reference) {
    return {
        kind: reference.kind,
        key: required(reference.key, "Scenario configuration key"),
        version_id: required(reference.version_id, "Scenario configuration version ID"),
        configuration_hash: required(reference.configuration_hash, "Scenario configuration hash"),
        effective_from: required(reference.effective_from, "Scenario configuration effective_from"),
        effective_until: reference.effective_until,
    };
}
function configurationSortKey(reference) {
    return [
        reference.kind,
        reference.key,
        reference.version_id,
        reference.configuration_hash,
        reference.effective_from,
        reference.effective_until ?? "",
    ].join("\u0000");
}
function manifestEntry(input, mapping) {
    const source = "source" in mapping ? mapping.source : mapping.human;
    const sourceId = required(sourceAgentId(source), "Scenario manifest source agent ID");
    const counterpart = "counterpart" in mapping
        ? mapping.counterpart
        : {
            scenario_counterpart_id: mapping.persona.scenario_persona_id,
            scenario_id: mapping.persona.scenario_id,
            run_id: input.run_id,
            namespace_id: input.namespace_id,
            source_agent_id: mapping.persona.source_human_agent_id,
            source_agent_kind: "human",
            source_agent_revision: null,
            behaviour_policy_version_id: mapping.persona.behaviour_policy_version_id,
            readiness: mapping.persona.behaviour_policy_version_id ? "modelled" : "passive",
            readiness_reason: mapping.persona.behaviour_policy_version_id
                ? "legacy_approved_behaviour_policy"
                : "legacy_structural_identity_only",
        };
    if (counterpart.source_agent_id !== sourceId || counterpart.source_agent_kind !== source.kind) {
        throw new Error("Scenario manifest counterpart lineage must match its source agent and kind.");
    }
    if (counterpart.scenario_id !== input.scenario_id
        || counterpart.run_id !== input.run_id
        || counterpart.namespace_id !== input.namespace_id) {
        throw new Error("Scenario manifest counterpart lineage must match its scenario run namespace.");
    }
    if ("counterpart" in mapping
        && (counterpart.source_agent_revision === null
            || !Number.isSafeInteger(counterpart.source_agent_revision)
            || counterpart.source_agent_revision < 1)) {
        throw new Error("Scenario manifest counterpart lineage requires a positive source agent revision.");
    }
    return {
        source_agent_kind: source.kind,
        source_agent_id: sourceId,
        source_agent_revision: counterpart.source_agent_revision,
        counterpart_id: required(counterpart.scenario_counterpart_id, "Scenario manifest counterpart ID"),
        scenario_id: counterpart.scenario_id,
        run_id: counterpart.run_id,
        namespace_id: counterpart.namespace_id,
        readiness: counterpart.readiness,
        readiness_reason: required(counterpart.readiness_reason, "Scenario manifest counterpart readiness reason"),
        behaviour_policy_version_id: counterpart.behaviour_policy_version_id,
        delegates: mapping.delegates.map((delegate) => ({
            delegate_agent_id: required(delegate.delegate_agent_id, "Scenario manifest delegate ID"),
            acts_for_human_agent_id: required(delegate.acts_for_human_agent_id, "Scenario manifest delegate source ID"),
            authority_snapshot_ref: required(delegate.authority_snapshot_ref, "Scenario manifest delegate authority snapshot reference"),
        })).sort((left, right) => canonicalCompare(left.delegate_agent_id, right.delegate_agent_id)),
    };
}
/**
 * Projects the execution identities into a strict allow-list. Extra properties
 * on source records or counterparts are never copied, so credentials, endpoint
 * data and sessions cannot enter the sealed provenance manifest accidentally.
 */
export function createScenarioIdentityManifest(input) {
    const identities = input.identities.map((mapping) => manifestEntry(input, mapping))
        .sort((left, right) => (canonicalCompare(`${left.source_agent_kind}\u0000${left.source_agent_id}\u0000${left.counterpart_id}`, `${right.source_agent_kind}\u0000${right.source_agent_id}\u0000${right.counterpart_id}`)));
    const actorIds = new Set();
    for (const identity of identities) {
        for (const actorId of [
            identity.source_agent_id,
            identity.counterpart_id,
            ...identity.delegates.map((delegate) => delegate.delegate_agent_id),
        ]) {
            if (actorIds.has(actorId)) {
                throw new Error("Scenario identity manifest actor IDs must be distinct and one-to-one.");
            }
            actorIds.add(actorId);
        }
    }
    return {
        schema_version: 1,
        institution_id: required(input.institution_id, "Scenario manifest institution ID"),
        scenario_id: required(input.scenario_id, "Scenario manifest scenario ID"),
        run_id: required(input.run_id, "Scenario manifest run ID"),
        namespace_id: required(input.namespace_id, "Scenario manifest namespace ID"),
        source_snapshot: {
            hash: required(input.source_snapshot_hash, "Scenario manifest source snapshot hash"),
            version: required(input.source_snapshot_version, "Scenario manifest source snapshot version"),
            captured_at: required(input.source_snapshot_at, "Scenario manifest source snapshot captured_at"),
        },
        configuration_refs: input.configuration_snapshot.map(safeConfigurationRef)
            .sort((left, right) => canonicalCompare(configurationSortKey(left), configurationSortKey(right))),
        identities,
    };
}
function canonicalJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Scenario manifest values must be finite.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        const record = value;
        return `{${Object.keys(record).sort().map((key) => (`${JSON.stringify(key)}:${canonicalJson(record[key])}`)).join(",")}}`;
    }
    throw new Error("Scenario manifest contains a non-canonical value.");
}
export function scenarioIdentityManifestHash(manifest) {
    return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}
//# sourceMappingURL=identity-manifest.js.map