import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulationFunctionDefinition, type SimulationBranch } from "../src/database/simulation-branch.driver.js";

const migration = readFileSync(new URL("../migrations/141_responsibility_workspace_manifest.sql", import.meta.url), "utf8");
const branch = { schema_name: "dt_run_0123456789abcdef0123456789abcdef" } as SimulationBranch;
const projectors = ["ensure_live_responsibility_scope", "reconcile_campus_responsibility_binding_source",
  "reconcile_campus_responsibility_substitution"];

function definition(name: string) {
  const start = migration.indexOf(`CREATE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`Missing owning projector ${name}`);
  return migration.slice(start, migration.indexOf("END $$;", start) + "END $$;".length);
}

describe("reviewed Simulation responsibility projector binding", () => {
  it.each(projectors)("binds only the namespace selector in %s and keeps current authority/scope checks", name => {
    const source = definition(name);
    const bound = simulationFunctionDefinition(source, branch);
    expect(bound).toContain("namespace.namespace_id=current_setting('thatcampus.namespace_id')");
    expect(bound).not.toContain("namespace.environment_kind='live'");
    expect(bound).toContain("namespace.realm_id=realm.id");
    expect(bound).toContain("namespace.status='active'");
    expect(source).toContain("namespace.environment_kind='live'");
    expect(bound).toContain("realm.status IN ('setup','active')");
    if (name === "reconcile_campus_responsibility_binding_source") {
      expect(bound).toContain("agent.person_id=profile.person_id");
    }
  });

  it("rejects an unknown projector or changed reviewed lookup instead of copying a Live namespace selector", () => {
    const source = definition("ensure_live_responsibility_scope");
    expect(() => simulationFunctionDefinition(source.replace("CREATE FUNCTION ensure_live_responsibility_scope(",
      "CREATE FUNCTION unreviewed_responsibility_scope("), branch)).toThrow(/unreviewed Live namespace/);
    expect(() => simulationFunctionDefinition(source.replace("namespace.environment_kind='live'", "namespace.environment_kind='simulation'"), branch))
      .toThrow(/unreviewed namespace lookup/);
    expect(() => simulationFunctionDefinition(source.replace("namespace.environment_kind='live'",
      "namespace.environment_kind='live' AND namespace.environment_kind='live'"), branch)).toThrow(/unreviewed namespace lookup/);
  });

  it("does not turn unrelated Live authority checks into Simulation grants", () => {
    const source = "CREATE FUNCTION authorize() RETURNS boolean LANGUAGE sql AS $$ SELECT actor_mode='live' AND source.environment_kind='live' $$";
    expect(simulationFunctionDefinition(source, branch)).toBe(source);
  });
});
