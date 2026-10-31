import { describe, expect, it } from "vitest";
import {
  SimulationSnapshotCompatibilityError,
  assertSimulationSnapshotCompatibility,
  buildSimulationSnapshotCompatibility,
  createSimulationSnapshotCompatibility,
  simulationSnapshotCompatibilityIssues,
} from "../src/simulation/simulation-runtime-compatibility.js";

const schemaFingerprint = `sha256:${"a".repeat(64)}`;
const identity = {
  template_schema: "dt_template_0123456789abcdef",
  catalogue: {
    tables: [{ name: "schools", columns: ["id", "name"] }],
    functions: [],
    views: [],
  },
} as const;

function compatibility(conformance = `sha256:${"b".repeat(64)}`) {
  return buildSimulationSnapshotCompatibility(identity, {
    platform_schema_fingerprint: schemaFingerprint,
    conformance_manifest_version: "simulation-platform/v1",
    conformance_fingerprint: conformance,
  });
}

describe("Simulation retained-snapshot compatibility", () => {
  it("stamps the current verified platform identity", () => {
    const envelope = createSimulationSnapshotCompatibility(identity);
    expect(envelope.manifest.branch_adapter_abi).toBe(2);
    expect(envelope.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(simulationSnapshotCompatibilityIssues({ ...envelope, identity })).toEqual([]);
  });

  it("accepts the reviewed semantic ABI and schema identity", () => {
    const envelope = compatibility();
    expect(assertSimulationSnapshotCompatibility({
      ...envelope,
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toEqual(envelope.manifest);
  });

  it("canonicalizes manifest keys so PostgreSQL jsonb ordering does not change its hash", () => {
    const envelope = compatibility();
    const reordered = Object.fromEntries(Object.entries(envelope.manifest).reverse());
    expect(simulationSnapshotCompatibilityIssues({
      manifest: reordered,
      hash: envelope.hash,
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toEqual([]);
  });

  it("rejects legacy, tampered, and unsupported runtime contracts fail closed", () => {
    expect(simulationSnapshotCompatibilityIssues({
      manifest: null,
      hash: null,
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toContain("compatibility_manifest_missing");

    const envelope = compatibility();
    expect(simulationSnapshotCompatibilityIssues({
      manifest: envelope.manifest,
      hash: "0".repeat(64),
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toContain("compatibility_hash_mismatch");
    expect(simulationSnapshotCompatibilityIssues({
      manifest: { ...envelope.manifest, branch_adapter_abi: 1 },
      hash: envelope.hash, identity, supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toContain("branch_adapter_abi_unsupported");
    expect(() => assertSimulationSnapshotCompatibility({
      manifest: { ...envelope.manifest, runtime_action_abi: 2 },
      hash: envelope.hash,
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toThrow(SimulationSnapshotCompatibilityError);
    expect(simulationSnapshotCompatibilityIssues({
      ...envelope,
      identity,
      supported_platform_schema_fingerprints: [`sha256:${"c".repeat(64)}`],
    })).toContain("platform_schema_fingerprint_unsupported");
  });

  it("retains release conformance as provenance without treating every build as a schema break", () => {
    const laterBuild = compatibility(`sha256:${"d".repeat(64)}`);
    expect(simulationSnapshotCompatibilityIssues({
      ...laterBuild,
      identity,
      supported_platform_schema_fingerprints: [schemaFingerprint],
    })).toEqual([]);
  });
});
