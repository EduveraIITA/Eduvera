import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile as writeFixture } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXECUTION_EFFECT_KINDS,
  type ExecutionEffectIntent,
} from "../src/campus-model-core/execution-effects.contracts.js";
import {
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import {
  ExecutionEffectRouter,
  RunScopedInMemoryExecutionEffectSink,
} from "../src/campus-model-core/execution-effects.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import {
  bindSimulationResources,
  unbindSimulationResources,
  type SimulationArtifactPort,
} from "../src/common/simulation-resources.js";
import {
  mkdir,
  readEnvironmentStoredFile,
  rename,
  unlink,
  writeFile,
} from "../src/common/environment-files.js";
import {
  currentSimulationPlatformConformance,
} from "../src/simulation-conformance/simulation-conformance.js";
import {
  SIMULATION_CONFORMANCE_EVIDENCE,
  SIMULATION_DATA_PLANE_CAPABILITIES,
  SIMULATION_EFFECT_FAMILY_REGISTRY,
  SIMULATION_MODULE_REGISTRY,
  evaluateRegisteredModuleEvidence,
} from "../src/simulation-conformance/simulation-conformance.registry.js";
import { auditSimulationConformance, digestSharedClientContracts } from "../scripts/verify-simulation-conformance.js";

const instant = "2026-10-19T07:30:00.000Z";
const environment = createSimulationExecutionEnvironment({
  institution_id: "10000000-0000-4000-8000-000000000001",
  scenario_id: "20000000-0000-4000-8000-000000000001",
  run_id: "30000000-0000-4000-8000-000000000001",
  virtual_clock: {
    now: () => new Date(instant),
    nowIso: () => instant,
    advanceBy: () => { throw new Error("test clock is immutable"); },
    advanceTo: () => { throw new Error("test clock is immutable"); },
  },
  source_snapshot_ref: "sha256:conformance-test",
  coverage_gate: {
    status: "passed",
    manifest_ref: "simulation-conformance:test",
    checked_at: instant,
  },
  expires_at: "9999-12-31T23:59:59.999Z",
});

function effectIntent(kind: (typeof EXECUTION_EFFECT_KINDS)[number]): ExecutionEffectIntent {
  return {
    kind,
    effect_id: `effect-${kind}`,
    schema_name: `conformance.${kind}`,
    schema_version: 1,
    institution_id: environment.institution_id,
    namespace_id: environment.namespace_id,
    idempotency_key: `conformance:${kind}`,
    correlation_id: "conformance-matrix",
    causation_id: null,
    requested_at: instant,
    actor_agent_id: "simulation-conformance-test",
    logical_target: { kind: "test", ref: kind },
    privacy_class: "institution_internal",
    payload: { kind },
  };
}

afterEach(() => {
  unbindSimulationResources(environment.namespace_id);
  vi.restoreAllMocks();
});

describe("Simulation platform conformance", () => {
  it("includes conformance sources and evidence in the container build stage only", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    const buildStage = dockerfile.split("AS backend-build\n")[1]?.split("\nFROM ")[0];
    expect(buildStage).toBeDefined();
    for (const input of [
      "COPY backend/src ./src",
      "COPY backend/scripts ./scripts",
      "COPY backend/test ./test",
      "COPY backend/migrations ./migrations",
      "COPY frontend/src /build/frontend/src",
      "COPY packages/contracts/src /build/packages/contracts/src",
    ]) expect(buildStage).toContain(input);
    expect(buildStage).toContain("RUN npm run build");
    const runtimeStage = dockerfile.split("AS runtime\n")[1];
    expect(runtimeStage).toBeDefined();
    expect(runtimeStage).not.toMatch(/COPY[^\n]*(?:backend\/(?:src|scripts|test)|frontend\/src)/u);
    const frontendStage = dockerfile.split("AS frontend-build\n")[1]?.split("\nFROM ")[0];
    expect(frontendStage).toContain("COPY packages/contracts/src /build/packages/contracts/src");
    expect(dockerfile).toContain("npm ci --ignore-scripts --prefix /build/packages/contracts");
  });

  it("invalidates conformance when a migrated shared implementation changes, while ignoring test-only and comment changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "thatcampus-contract-conformance-"));
    try {
      const owner = join(directory, "published-policy.ts");
      await writeFixture(owner, "export const acceptedRevision = () => 1;\n");
      const first = await digestSharedClientContracts(directory);
      await writeFixture(owner, "// formatting and comments are not execution drift\nexport const acceptedRevision = () => 1;\n");
      expect(await digestSharedClientContracts(directory)).toBe(first);
      await writeFixture(join(directory, "published-policy.test.ts"), "throw new Error('fixture only');\n");
      expect(await digestSharedClientContracts(directory)).toBe(first);
      await writeFixture(owner, "export const acceptedRevision = () => 2;\n");
      expect(await digestSharedClientContracts(directory)).not.toBe(first);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("classifies the exact application module graph without treating registration as proof", async () => {
    const audit = await auditSimulationConformance();
    expect(audit.errors).toEqual([]);
    expect(audit.components.shared_contracts).toBe(await digestSharedClientContracts());
    expect(new Set(audit.app_modules)).toEqual(new Set(
      SIMULATION_MODULE_REGISTRY.map((module) => module.module_class),
    ));

    const coverage = evaluateRegisteredModuleEvidence();
    expect(coverage.ready).toBe(false);
    expect(coverage.incomplete).toContain("PeopleModule:realtime");
    expect(coverage.covered_capabilities.PeopleModule).toEqual(["snapshot", "queries", "commands", "events"]);
    expect(coverage.incomplete).not.toContain("PeopleModule:queries");
    expect(coverage.incomplete).not.toContain("ChatModule:commands");
    expect(coverage.covered_capabilities.ChatModule).toEqual(SIMULATION_DATA_PLANE_CAPABILITIES);
    expect(coverage.covered_capabilities.SchoolModule)
      .toEqual(SIMULATION_DATA_PLANE_CAPABILITIES);
    const conformance = currentSimulationPlatformConformance();
    expect(conformance).toMatchObject({
      coverage_complete: false,
      coverage_gaps: expect.arrayContaining(["PeopleModule:realtime", "OperatingRulesModule:realtime"]),
      blockers: expect.not.arrayContaining(["PeopleModule:realtime", "OperatingRulesModule:realtime"]),
    });
    expect(conformance.ready).toBe(conformance.blockers.length === 0);
  });

  it("binds every reviewed effect family to the exact run and captures each one", async () => {
    expect(SIMULATION_EFFECT_FAMILY_REGISTRY).toEqual(EXECUTION_EFFECT_KINDS);
    const router = new ExecutionEffectRouter();
    const sinks = EXECUTION_EFFECT_KINDS.map((kind) => (
      new RunScopedInMemoryExecutionEffectSink(kind, `conformance:${kind}`, environment)
    ));
    const coverage = router.bindSimulationSinks({ environment, sinks });
    expect(coverage).toMatchObject({
      status: "ready",
      configured_kinds: EXECUTION_EFFECT_KINDS,
      missing_kinds: [],
      production_ports_reachable: false,
    });

    await executionEnvironmentStorage.run(environment, async () => {
      for (const kind of EXECUTION_EFFECT_KINDS) {
        const receipt = await router.route(environment, effectIntent(kind));
        expect(receipt).toMatchObject({
          environment_kind: "simulation",
          effect_kind: kind,
          namespace_id: environment.namespace_id,
          run_id: environment.run_id,
        });
      }
    });
    for (const sink of sinks) expect(sink.records()).toHaveLength(1);
  });

  it("routes file writes and reads through the run-local artifact port without touching a Live path", async () => {
    const contents = new Map<string, Buffer>();
    const writeArtifact = vi.fn<SimulationArtifactPort["write"]>((key, data, exclusive) => {
      if (exclusive && contents.has(key)) throw new Error("exists");
      contents.set(key, Buffer.from(data));
      return Promise.resolve();
    });
    const readArtifact = vi.fn<SimulationArtifactPort["read"]>((key) => Promise.resolve(contents.get(key) ?? null));
    const renameArtifact = vi.fn<SimulationArtifactPort["rename"]>((from, to) => {
      const value = contents.get(from);
      if (!value) throw new Error("missing");
      contents.delete(from);
      contents.set(to, value);
      return Promise.resolve();
    });
    const removeArtifact = vi.fn<SimulationArtifactPort["remove"]>((key) => {
      contents.delete(key);
      return Promise.resolve();
    });
    const artifacts: SimulationArtifactPort = {
      write: writeArtifact,
      read: readArtifact,
      rename: renameArtifact,
      remove: removeArtifact,
    };
    const router = new ExecutionEffectRouter();
    const sinks = EXECUTION_EFFECT_KINDS.map((kind) => (
      new RunScopedInMemoryExecutionEffectSink(kind, `artifact:${kind}`, environment)
    ));
    router.bindSimulationSinks({ environment, sinks });
    bindSimulationResources({ environment, effects: router, artifacts });

    await executionEnvironmentStorage.run(environment, async () => {
      const impossibleLiveDirectory = "/thatcampus-live-must-not-exist/conformance";
      await mkdir(impossibleLiveDirectory, { recursive: true });
      await writeFile(`${impossibleLiveDirectory}/pending`, Buffer.from("scenario evidence"), { flag: "wx" });
      await rename(`${impossibleLiveDirectory}/pending`, `${impossibleLiveDirectory}/final`);
      const stored = await readEnvironmentStoredFile(
        `${impossibleLiveDirectory}/final`,
        "text/plain",
        "evidence.txt",
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe("scenario evidence");
      expect(stored.evidence_mode).toBe("simulation");
      await unlink(`${impossibleLiveDirectory}/final`);
    });

    expect(writeArtifact.mock.calls).toHaveLength(1);
    expect(renameArtifact.mock.calls).toHaveLength(1);
    expect(readArtifact.mock.calls).toHaveLength(1);
    expect(removeArtifact.mock.calls).toHaveLength(1);
    const fileSink = sinks.find((sink) => sink.kind === "file_write");
    expect(fileSink?.records()).toHaveLength(1);
  });

  it("keeps evidence capability-specific and rejects a documentation-only parity claim", () => {
    const evidenceIds = new Set(SIMULATION_CONFORMANCE_EVIDENCE.map((item) => item.id));
    for (const module of SIMULATION_MODULE_REGISTRY) {
      for (const evidenceId of module.evidence) expect(evidenceIds.has(evidenceId)).toBe(true);
    }
    const people = SIMULATION_MODULE_REGISTRY.find((module) => module.module_class === "PeopleModule");
    expect(people?.disposition).toBe("campus_operational");
    expect(people?.evidence).toEqual(["world:native-people-transport-workers",
      "world:canonical-people-connections", "world:exact-person-owning-attachments", "world:fee-charge-audience", "world:reviewed-enrollment-roster",
      "world:canonical-staff-current-identity", "world:explicit-guardian-current-identity"]);
    for (const id of ["world:canonical-staff-current-identity", "world:explicit-guardian-current-identity"]) {
      const evidence = SIMULATION_CONFORMANCE_EVIDENCE.find(item => item.id === id);
      expect(evidence?.kind).toBe("real_postgres");
      expect(evidence?.capabilities).toEqual(["snapshot", "queries", "commands", "events"]);
      expect(evidence?.proves).toMatch(/Live.*sibling/);
      expect(evidence?.capabilities).not.toContain("realtime");
    }
    expect(evaluateRegisteredModuleEvidence().incomplete)
      .toEqual(expect.arrayContaining(["PeopleModule:realtime"]));
  });
});
