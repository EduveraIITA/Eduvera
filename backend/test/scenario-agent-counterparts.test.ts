import { describe, expect, it } from "vitest";
import { createScenarioExecutionContext } from "../src/campus-model-core/scenarios/runtime.js";
import {
  buildScenarioIdentityMappings,
  type ScenarioAgentIdentityRow,
} from "../src/campus-scenarios/campus-scenario.repository.js";

const agents: readonly ScenarioAgentIdentityRow[] = [
  { id: "human-1", agent_kind: "human", person_id: "person-1", external_ref: null, revision: 11 },
  { id: "team-1", agent_kind: "team", person_id: null, external_ref: "team:attendance", revision: 12 },
  { id: "device-1", agent_kind: "device", person_id: null, external_ref: "camera:front-gate", revision: 13 },
  { id: "integration-1", agent_kind: "integration", person_id: null, external_ref: "integration:sis", revision: 14 },
  { id: "software-1", agent_kind: "software", person_id: null, external_ref: "software:coverage", revision: 15 },
];

function capture(runId: string, capturedAgents = agents) {
  return buildScenarioIdentityMappings({
    scenario_id: "scenario-1",
    run_id: runId,
    behaviour_policy_version_id: "behaviour-v3",
    agents: capturedAgents,
  }).map((mapping) => {
    if (!("counterpart" in mapping)) throw new Error("Expected a generalized counterpart mapping.");
    return mapping;
  });
}

function executionContext(runId: string, identities = capture(runId)) {
  return createScenarioExecutionContext({
    mode: "simulation",
    namespace_id: `scenario:scenario-1:run:${runId}`,
    institution_id: "institution-1",
    scenario_id: "scenario-1",
    run_id: runId,
    deterministic_seed: `seed:${runId}`,
    horizon: {
      from: "2026-10-19T00:00:00.000Z",
      to: "2026-10-20T00:00:00.000Z",
    },
    configuration_snapshot: [],
    identities,
  });
}

describe("run-local synthetic agent counterparts", () => {
  it("captures every supported source-agent kind exactly once with explicit readiness", () => {
    const mappings = capture("run-a");

    expect(mappings).toHaveLength(agents.length);
    expect(new Set(mappings.map((mapping) => mapping.counterpart.source_agent_id)).size)
      .toBe(agents.length);
    expect(new Set(mappings.map((mapping) => mapping.counterpart.scenario_counterpart_id)).size)
      .toBe(agents.length);
    expect(mappings.map((mapping) => ({
      kind: mapping.counterpart.source_agent_kind,
      revision: mapping.counterpart.source_agent_revision,
      readiness: mapping.counterpart.readiness,
      reason: mapping.counterpart.readiness_reason,
    }))).toEqual([
      { kind: "human", revision: 11, readiness: "modelled", reason: "approved_human_behaviour_policy" },
      { kind: "team", revision: 12, readiness: "passive", reason: "team_queue_identity_only" },
      { kind: "device", revision: 13, readiness: "unsupported", reason: "device_scenario_reaction_not_configured" },
      { kind: "integration", revision: 14, readiness: "unsupported", reason: "integration_scenario_reaction_not_configured" },
      { kind: "software", revision: 15, readiness: "unsupported", reason: "software_scenario_reaction_not_configured" },
    ]);
    expect(mappings.every((mapping) => mapping.counterpart.run_id === "run-a")).toBe(true);
    expect(mappings.every((mapping) => (
      mapping.counterpart.namespace_id === "scenario:scenario-1:run:run-a"
    ))).toBe(true);
    expect(mappings.every((mapping) => (
      mapping.counterpart.scenario_counterpart_id !== mapping.counterpart.source_agent_id
    ))).toBe(true);

    const context = executionContext("run-a", mappings);
    for (const mapping of mappings) {
      expect(context.identity_resolver.counterpartForSource(mapping.counterpart.source_agent_id))
        .toEqual(mapping.counterpart);
      expect(context.identity_resolver.sourceForCounterpart(mapping.counterpart.scenario_counterpart_id))
        .toEqual(mapping.source);
    }
  });

  it("uses a different counterpart identity for every run and rejects cross-run reuse", () => {
    const first = capture("run-a");
    const second = capture("run-b");

    expect(first.map((mapping) => mapping.counterpart.source_agent_id))
      .toEqual(second.map((mapping) => mapping.counterpart.source_agent_id));
    expect(first.map((mapping) => mapping.counterpart.scenario_counterpart_id))
      .not.toEqual(second.map((mapping) => mapping.counterpart.scenario_counterpart_id));
    expect(() => executionContext("run-b", first)).toThrow("active run");

    const wrongNamespace = structuredClone(second);
    const firstMapping = wrongNamespace[0];
    if (!firstMapping) throw new Error("Expected a counterpart mapping.");
    firstMapping.counterpart.namespace_id = "scenario:scenario-1:run:another-run";
    expect(() => executionContext("run-b", wrongNamespace)).toThrow("active namespace");

    const missingRevision = structuredClone(second);
    const revisionlessMapping = missingRevision[0];
    if (!revisionlessMapping) throw new Error("Expected a counterpart mapping.");
    revisionlessMapping.counterpart.source_agent_revision = null;
    expect(() => executionContext("run-b", missingRevision)).toThrow("positive source agent revision");
  });

  it("freezes membership at the capture boundary while the next run sees new agents", () => {
    const firstRun = capture("run-a", agents.slice(0, 2));
    const laterAgent: ScenarioAgentIdentityRow = {
      id: "device-later",
      agent_kind: "device",
      person_id: null,
      external_ref: "camera:library",
      revision: 1,
    };
    const secondRun = capture("run-b", [...agents.slice(0, 2), laterAgent]);

    expect(firstRun.map((mapping) => mapping.counterpart.source_agent_id))
      .toEqual(["human-1", "team-1"]);
    expect(secondRun.map((mapping) => mapping.counterpart.source_agent_id))
      .toEqual(["human-1", "team-1", "device-later"]);
    expect(executionContext("run-a", firstRun).identity_resolver.counterpartForSource("device-later"))
      .toBeNull();
  });
});
