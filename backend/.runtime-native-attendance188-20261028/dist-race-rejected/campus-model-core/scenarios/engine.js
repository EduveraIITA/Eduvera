import { createHash } from "node:crypto";
import { cloneScenarioValue, createScenarioExecutionContext, deepFreezeScenarioValue, } from "./runtime.js";
import { createScenarioIdentityManifest, scenarioIdentityManifestHash, } from "./identity-manifest.js";
function instant(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        throw new Error(`${label} must be an ISO date-time.`);
    return parsed;
}
function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => (`${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)).join(",")}}`;
}
export function scenarioSnapshotHash(snapshot) {
    return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}
function validateMetrics(metrics) {
    for (const [key, value] of Object.entries(metrics)) {
        if (key.trim().length === 0)
            throw new Error("Scenario metric keys must not be empty.");
        if (value !== null && !Number.isFinite(value)) {
            throw new Error(`Scenario metric ${key} must be finite or null.`);
        }
    }
}
function validateRequest(request) {
    const required = {
        scenario_id: request.scenario_id,
        namespace_id: request.namespace_id,
        institution_id: request.institution_id,
        run_id: request.run_id,
        deterministic_seed: request.deterministic_seed,
        snapshot_version: request.source.snapshot_version,
        baseline_label: request.baseline.label,
        alternative_label: request.alternative.label,
    };
    for (const [label, value] of Object.entries(required)) {
        if (value.trim().length === 0)
            throw new Error(`${label} must not be empty.`);
    }
    if (request.namespace_id === request.institution_id) {
        throw new Error("Scenario namespace must be isolated from the production institution namespace.");
    }
    const requestedAt = instant(request.requested_at, "Scenario requested_at");
    const expiresAt = instant(request.expires_at, "Scenario expires_at");
    const from = instant(request.horizon.from, "Scenario horizon from");
    const to = instant(request.horizon.to, "Scenario horizon to");
    instant(request.source.snapshot_at, "Scenario snapshot_at");
    if (expiresAt <= requestedAt)
        throw new Error("Scenario expiry must follow its request time.");
    if (to <= from)
        throw new Error("Scenario horizon end must follow its start.");
    if (request.monte_carlo) {
        if (!Number.isSafeInteger(request.monte_carlo.sample_count)
            || request.monte_carlo.sample_count < 2
            || request.monte_carlo.sample_count > 10_000) {
            throw new Error("Monte Carlo sample_count must be a whole number from 2 to 10000.");
        }
        const policy = request.monte_carlo.behaviour_policy;
        if (!policy.policy_id.trim() || !policy.version_id.trim() || !policy.configuration_hash.trim()) {
            throw new Error("Stochastic simulation requires an identified, versioned behaviour policy.");
        }
        instant(policy.effective_from, "Behaviour policy effective_from");
        if (policy.effective_until)
            instant(policy.effective_until, "Behaviour policy effective_until");
        instant(policy.calibration.calibrated_at, "Behaviour policy calibrated_at");
    }
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
function uniqueUnsupported(values) {
    const byKey = new Map();
    for (const value of values) {
        const key = `${value.domain}\u0000${value.capability}\u0000${value.reason}`;
        if (!byKey.has(key))
            byKey.set(key, structuredClone(value));
    }
    return [...byKey.values()].sort((left, right) => (`${left.domain}:${left.capability}`.localeCompare(`${right.domain}:${right.capability}`)));
}
function comparison(baseline, alternative) {
    const output = {};
    const keys = [...new Set([...Object.keys(baseline), ...Object.keys(alternative)])].sort();
    for (const key of keys) {
        const before = baseline[key] ?? null;
        const after = alternative[key] ?? null;
        const delta = before === null || after === null ? null : after - before;
        output[key] = {
            baseline: before,
            alternative: after,
            delta,
            delta_percent: delta === null || before === null || before === 0
                ? null
                : (delta / Math.abs(before)) * 100,
        };
    }
    return output;
}
function quantile(values, probability) {
    if (values.length === 0)
        return null;
    const ordered = [...values].sort((left, right) => left - right);
    const position = (ordered.length - 1) * probability;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = ordered[lowerIndex];
    const upper = ordered[upperIndex];
    if (lower === undefined || upper === undefined)
        return null;
    if (lowerIndex === upperIndex)
        return lower;
    return lower + ((upper - lower) * (position - lowerIndex));
}
function range(values) {
    return {
        p10: quantile(values, 0.1),
        p50: quantile(values, 0.5),
        p90: quantile(values, 0.9),
    };
}
function deterministicRange(value) {
    return { p10: null, p50: value, p90: null };
}
function wrapArtifacts(request, output) {
    return output.artifacts.map((artifact) => ({
        ...structuredClone(artifact),
        scenario_id: request.scenario_id,
        namespace_id: request.namespace_id,
        run_id: request.run_id,
    }));
}
function executionResult(request, key, label, output, messages) {
    validateMetrics(output.metrics);
    return {
        plan: key,
        label,
        metrics: structuredClone(output.metrics),
        artifacts: wrapArtifacts(request, output),
        messages: structuredClone(messages),
        assumptions: uniqueStrings(output.assumptions),
        unsupported: uniqueUnsupported(output.unsupported),
    };
}
export class IsolatedScenarioEngine {
    async run(request, executor) {
        validateRequest(request);
        if (!executor.executor_id.trim() || !executor.version.trim()) {
            throw new Error("Scenario executor must publish an ID and version.");
        }
        const snapshot = deepFreezeScenarioValue(cloneScenarioValue(request.source.snapshot));
        const snapshotHash = scenarioSnapshotHash(snapshot);
        const identities = structuredClone(request.identities);
        const configurationSnapshot = structuredClone(request.configuration_snapshot);
        const identityManifest = createScenarioIdentityManifest({
            institution_id: request.institution_id,
            scenario_id: request.scenario_id,
            run_id: request.run_id,
            namespace_id: request.namespace_id,
            source_snapshot_hash: snapshotHash,
            source_snapshot_version: request.source.snapshot_version,
            source_snapshot_at: new Date(instant(request.source.snapshot_at, "Scenario snapshot_at")).toISOString(),
            configuration_snapshot: configurationSnapshot,
            identities,
        });
        const identityManifestHash = scenarioIdentityManifestHash(identityManifest);
        const execute = async (plan, sampleKind, sampleIndex, seed) => {
            const context = createScenarioExecutionContext({
                mode: request.mode,
                namespace_id: request.namespace_id,
                institution_id: request.institution_id,
                scenario_id: request.scenario_id,
                run_id: request.run_id,
                deterministic_seed: seed,
                horizon: request.horizon,
                configuration_snapshot: configurationSnapshot,
                identities,
            });
            const output = await executor.execute({
                context,
                snapshot,
                horizon: structuredClone(request.horizon),
                plan: structuredClone(plan),
                sample: {
                    kind: sampleKind,
                    index: sampleIndex,
                    behaviour_policy: sampleKind === "monte_carlo"
                        ? structuredClone(request.monte_carlo?.behaviour_policy ?? null)
                        : null,
                },
            });
            validateMetrics(output.metrics);
            return { output, messages: context.message_dispatcher.messages() };
        };
        const baselineExecution = await execute(request.baseline, "deterministic", null, `${request.deterministic_seed}::deterministic::baseline`);
        const alternativeExecution = await execute(request.alternative, "deterministic", null, `${request.deterministic_seed}::deterministic::alternative`);
        const baseline = executionResult(request, "baseline", request.baseline.label, baselineExecution.output, baselineExecution.messages);
        const alternative = executionResult(request, "alternative", request.alternative.label, alternativeExecution.output, alternativeExecution.messages);
        const deterministicComparison = comparison(baseline.metrics, alternative.metrics);
        const ensembleMetrics = {};
        const ensembleAssumptions = [];
        const ensembleUnsupported = [];
        if (request.monte_carlo) {
            const samples = new Map();
            for (let index = 0; index < request.monte_carlo.sample_count; index += 1) {
                // Both alternatives intentionally share a sample seed (common random numbers).
                const sampleSeed = `${request.deterministic_seed}::monte_carlo::${index}`;
                const before = await execute(request.baseline, "monte_carlo", index, sampleSeed);
                const after = await execute(request.alternative, "monte_carlo", index, sampleSeed);
                ensembleAssumptions.push(...before.output.assumptions, ...after.output.assumptions);
                ensembleUnsupported.push(...before.output.unsupported, ...after.output.unsupported);
                const keys = new Set([...Object.keys(before.output.metrics), ...Object.keys(after.output.metrics)]);
                for (const key of keys) {
                    let accumulator = samples.get(key);
                    if (!accumulator) {
                        accumulator = { baseline: [], alternative: [], delta: [] };
                        samples.set(key, accumulator);
                    }
                    const left = before.output.metrics[key];
                    const right = after.output.metrics[key];
                    if (left !== null && left !== undefined)
                        accumulator.baseline.push(left);
                    if (right !== null && right !== undefined)
                        accumulator.alternative.push(right);
                    if (left !== null && left !== undefined && right !== null && right !== undefined) {
                        accumulator.delta.push(right - left);
                    }
                }
            }
            for (const [key, values] of [...samples.entries()].sort(([left], [right]) => left.localeCompare(right))) {
                ensembleMetrics[key] = {
                    baseline: range(values.baseline),
                    alternative: range(values.alternative),
                    delta: range(values.delta),
                };
            }
        }
        else {
            for (const [key, item] of Object.entries(deterministicComparison)) {
                ensembleMetrics[key] = {
                    baseline: deterministicRange(item.baseline),
                    alternative: deterministicRange(item.alternative),
                    delta: deterministicRange(item.delta),
                };
            }
        }
        const assumptions = uniqueStrings([
            ...request.assumptions,
            ...baseline.assumptions,
            ...alternative.assumptions,
            ...ensembleAssumptions,
        ]);
        const unsupported = uniqueUnsupported([
            ...baseline.unsupported,
            ...alternative.unsupported,
            ...ensembleUnsupported,
        ]);
        return {
            schema_version: 1,
            mode: request.mode,
            scenario_id: request.scenario_id,
            namespace_id: request.namespace_id,
            institution_id: request.institution_id,
            run_id: request.run_id,
            requested_at: new Date(instant(request.requested_at, "Scenario requested_at")).toISOString(),
            expires_at: new Date(instant(request.expires_at, "Scenario expires_at")).toISOString(),
            snapshot_hash: snapshotHash,
            snapshot_version: request.source.snapshot_version,
            snapshot_at: new Date(instant(request.source.snapshot_at, "Scenario snapshot_at")).toISOString(),
            source_revisions: structuredClone(request.source.source_revisions),
            identity_manifest: structuredClone(identityManifest),
            identity_manifest_hash: identityManifestHash,
            deterministic_seed: request.deterministic_seed,
            horizon: structuredClone(request.horizon),
            executor: { id: executor.executor_id, version: executor.version },
            configuration_snapshot: structuredClone(configurationSnapshot),
            assumptions,
            unsupported,
            baseline,
            alternative,
            comparison: deterministicComparison,
            ensemble: {
                status: request.monte_carlo ? "calibrated" : "not_calibrated",
                sample_count: request.monte_carlo?.sample_count ?? 0,
                behaviour_policy: request.monte_carlo
                    ? structuredClone(request.monte_carlo.behaviour_policy)
                    : null,
                metrics: ensembleMetrics,
            },
        };
    }
}
//# sourceMappingURL=engine.js.map