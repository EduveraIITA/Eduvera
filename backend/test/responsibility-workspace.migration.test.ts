import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(new URL("../migrations/141_responsibility_workspace_manifest.sql", import.meta.url), "utf8");
const repository = await readFile(new URL("../src/workspace/workspace.repository.ts", import.meta.url), "utf8");
const contracts = await readFile(new URL("../src/workspace/workspace.contracts.ts", import.meta.url), "utf8");

describe("canonical responsibility workspace migration", () => {
  it("stores one effective, environment-qualified responsibility contract", () => {
    expect(migration).toContain("CREATE TABLE campus_responsibility_assignments");
    expect(migration).toContain("owner_agent_id uuid NOT NULL");
    expect(migration).toContain("capability_key varchar(120) NOT NULL");
    expect(migration).toContain("action_key varchar(160) NOT NULL");
    expect(migration).toContain("scope_entity_id uuid NOT NULL");
    expect(migration).toContain("effective_schedule jsonb");
    expect(migration).toContain("authority_source_kind varchar(40) NOT NULL");
    expect(migration).toContain("fallback_agent_id uuid");
    expect(migration).toContain("provenance jsonb NOT NULL");
    expect(migration).toContain("FOREIGN KEY(scope_entity_id,realm_id,environment_namespace_id)");
  });

  it("supports effective teams while requiring a concrete human team member", () => {
    expect(migration).toContain("CREATE TABLE campus_responsibility_team_memberships");
    expect(migration).toContain("team_agent_id uuid NOT NULL");
    expect(migration).toContain("member_agent_id uuid NOT NULL");
    expect(migration).toContain("agent_kind='team'");
    expect(migration).toContain("agent_kind='human'");
  });

  it("projects every supported assignment writer atomically and never grants operations from admin membership", () => {
    expect(migration).toContain("template_ref");
    expect(migration).toContain("FOREACH permission_key IN ARRAY binding.permissions");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON staff_responsibility_assignments");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON class_section_staff_assignments");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON campus_event_staff");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON assessment_staff_assignments");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON transport_trips");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF state,coverage_task_revision ON staff_timetable_substitutions");
    expect(migration).toContain("AFTER UPDATE OF name ON transport_routes");
    expect(migration).toContain("AFTER UPDATE OF user_id,person_id,status ON staff_profiles");
    expect(migration).toContain("AFTER UPDATE OF capability_permissions,is_active,name,description");
    expect(migration).toContain("projection_contract','responsibility_assignment.v1'");
    expect(migration).not.toMatch(/school_memberships[\s\S]{0,200}role\s*=\s*'admin'/);
    expect(migration).not.toMatch(/principal/i);
  });

  it("projects accepted temporary cover as an occurrence-bounded delegation", () => {
    expect(migration).toContain("CREATE FUNCTION reconcile_campus_responsibility_substitution");
    expect(migration).toContain("'delegation','staff_coverage_task:'||substitution.coverage_task_id::text");
    expect(migration).toContain("(substitution.duty_date+substitution.starts_at)");
    expect(migration).toContain("(substitution.duty_date+substitution.ends_at)");
    expect(migration).toContain("'projection_contract','accepted_timetable_substitution.v1'");
    expect(migration).toContain("'attendance.record'");
    expect(migration).toContain("'messages.send'");
    expect(migration).toContain("WHEN substitution.state<>'effective' THEN 'revoked'");
    expect(migration).not.toContain("coverage.offer");
  });

  it("binds assignments to a stable human agent without making the login endpoint the authority", () => {
    expect(migration).toContain("agent.person_id=profile.person_id");
    expect(migration).toContain("profile.user_id=binding.user_id");
    expect(migration).toContain("WHEN resolved_agent_status='suspended' OR resolved_profile_status<>'active'");
    expect(migration).toContain("resolved_profile_status<>'active'");
    expect(migration).not.toContain("responsibility_projection_account_endpoint");
  });

  it("removes the runtime legacy assignment adapter after canonical reconciliation", () => {
    expect(repository).toContain('projection_source: "canonical"');
    expect(repository).toContain("this.projection.loadEffectiveAgentWork(transaction, input)");
    expect(repository).not.toContain("staff_role_bindings");
    expect(repository).not.toContain("legacy_assignment_adapter");
    expect(contracts).not.toContain("legacy_assignment_adapter");
    expect(migration).not.toContain("staff_role_bindings.v1");
  });
});
