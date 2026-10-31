import { createHash } from "node:crypto";
import { SIMULATION_CONFORMANCE_BUILD, assertCurrentSimulationPlatformConformance, } from "../simulation-conformance/index.js";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
export const SIMULATION_SNAPSHOT_ABI = Object.freeze({
    schema_version: 1,
    capture_format_version: 1,
    branch_adapter_abi: 2,
    model_core_contract_abi: 1,
    runtime_action_abi: 1,
    effect_contract_abi: 1,
    artifact_contract_abi: 1,
    behaviour_contract_abi: 2,
});
function canonicalJson(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
function sha256(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value) {
    return typeof value === "string" ? value : "";
}
/**
 * Captures the semantic runtime contract which may safely reopen this immutable
 * snapshot. Release/build fingerprints are provenance; only reviewed ABI and
 * schema fingerprints are compatibility gates.
 */
export function createSimulationSnapshotCompatibility(identity) {
    const conformance = assertCurrentSimulationPlatformConformance();
    const platformSchema = SIMULATION_CONFORMANCE_BUILD.components.schema;
    if (!SHA256.test(platformSchema)) {
        throw new Error("The Simulation schema compatibility fingerprint is unavailable for this build.");
    }
    return buildSimulationSnapshotCompatibility(identity, {
        platform_schema_fingerprint: platformSchema,
        conformance_manifest_version: conformance.manifest_version,
        conformance_fingerprint: conformance.fingerprint,
    });
}
export function buildSimulationSnapshotCompatibility(identity, runtime) {
    if (!SHA256.test(runtime.platform_schema_fingerprint)
        || !SHA256.test(runtime.conformance_fingerprint)
        || !runtime.conformance_manifest_version.trim()) {
        throw new Error("The Simulation runtime compatibility identity is invalid.");
    }
    const manifest = Object.freeze({
        ...SIMULATION_SNAPSHOT_ABI,
        platform_schema_fingerprint: runtime.platform_schema_fingerprint,
        schema_catalogue_hash: `sha256:${sha256(identity)}`,
        conformance_manifest_version: runtime.conformance_manifest_version,
        conformance_fingerprint: runtime.conformance_fingerprint,
    });
    return Object.freeze({ manifest, hash: sha256(manifest) });
}
export function simulationSnapshotCompatibilityIssues(input) {
    if (!isRecord(input.manifest))
        return Object.freeze(["compatibility_manifest_missing"]);
    const manifest = input.manifest;
    const issues = [];
    for (const [field, expected] of Object.entries(SIMULATION_SNAPSHOT_ABI)) {
        if (manifest[field] !== expected)
            issues.push(`${field}_unsupported`);
    }
    const supportedSchemas = input.supported_platform_schema_fingerprints
        ?? [SIMULATION_CONFORMANCE_BUILD.components.schema];
    if (!supportedSchemas.length || supportedSchemas.some((fingerprint) => !SHA256.test(fingerprint))) {
        issues.push("runtime_schema_fingerprint_invalid");
    }
    if (!SHA256.test(stringValue(manifest.platform_schema_fingerprint))) {
        issues.push("platform_schema_fingerprint_invalid");
    }
    else if (!supportedSchemas.includes(manifest.platform_schema_fingerprint)) {
        issues.push("platform_schema_fingerprint_unsupported");
    }
    const catalogueHash = stringValue(manifest.schema_catalogue_hash);
    if (!SHA256.test(catalogueHash)) {
        issues.push("schema_catalogue_hash_invalid");
    }
    else if (catalogueHash !== `sha256:${sha256(input.identity)}`) {
        issues.push("schema_catalogue_hash_mismatch");
    }
    if (typeof manifest.conformance_manifest_version !== "string"
        || !manifest.conformance_manifest_version.trim()) {
        issues.push("conformance_manifest_version_invalid");
    }
    if (!SHA256.test(stringValue(manifest.conformance_fingerprint))) {
        issues.push("conformance_fingerprint_invalid");
    }
    if (!HEX_SHA256.test(stringValue(input.hash))) {
        issues.push("compatibility_hash_invalid");
    }
    else if (input.hash !== sha256(manifest)) {
        issues.push("compatibility_hash_mismatch");
    }
    return Object.freeze([...new Set(issues)]);
}
export class SimulationSnapshotCompatibilityError extends Error {
    incompatibilities;
    code = "simulation_snapshot_incompatible";
    constructor(incompatibilities) {
        super("This Simulation snapshot is incompatible with the current runtime. Create a fresh snapshot or use an approved target-only upgrade.");
        this.incompatibilities = incompatibilities;
        this.name = "SimulationSnapshotCompatibilityError";
    }
}
export function assertSimulationSnapshotCompatibility(input) {
    const issues = simulationSnapshotCompatibilityIssues(input);
    if (issues.length)
        throw new SimulationSnapshotCompatibilityError(issues);
    return input.manifest;
}
//# sourceMappingURL=simulation-runtime-compatibility.js.map