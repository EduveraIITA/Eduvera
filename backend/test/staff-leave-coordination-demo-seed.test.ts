import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertGovernanceAuthorityDemoSeedAllowed,
  selectExactDemoPersonIdentity,
} from "../src/database/seed-governance-authority.js";
import { assertStaffLeaveCoordinationDemoSeedAllowed } from "../src/database/seed-staff-leave-coordination.js";

const coordinationSeed = readFileSync(
  new URL("../src/database/seed-staff-leave-coordination.ts", import.meta.url),
  "utf8",
);
const governanceSeed = readFileSync(
  new URL("../src/database/seed-governance-authority.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("staff-leave coordination demo seed safety", () => {
  it("protects the prerequisite governance seed with its own explicit local-only opt-in", () => {
    expect(() => assertGovernanceAuthorityDemoSeedAllowed({
      demoMode: false,
      explicitOptIn: true,
      environment: "development",
    })).toThrow(/DEMO_MODE=true/);
    expect(() => assertGovernanceAuthorityDemoSeedAllowed({
      demoMode: true,
      explicitOptIn: false,
      environment: "development",
    })).toThrow(/SEED_GOVERNANCE_AUTHORITY=true/);
    for (const environment of ["production", "stage", "staging", "preview", ""]) {
      expect(() => assertGovernanceAuthorityDemoSeedAllowed({
        demoMode: true,
        explicitOptIn: true,
        environment,
      }), environment || "empty").toThrow(/limited to development, local or test/);
    }
    expect(() => assertGovernanceAuthorityDemoSeedAllowed({
      demoMode: true,
      explicitOptIn: true,
      environment: "local",
    })).not.toThrow();
  });

  it("requires demo mode, explicit opt-in and a non-production environment", () => {
    expect(() => assertStaffLeaveCoordinationDemoSeedAllowed({
      demoMode: false,
      explicitOptIn: true,
      environment: "development",
    })).toThrow(/DEMO_MODE=true/);
    expect(() => assertStaffLeaveCoordinationDemoSeedAllowed({
      demoMode: true,
      explicitOptIn: false,
      environment: "development",
    })).toThrow(/SEED_STAFF_LEAVE_COORDINATION=true/);
    for (const environment of ["production", "stage", "staging", "preview"]) {
      expect(() => assertStaffLeaveCoordinationDemoSeedAllowed({
        demoMode: true,
        explicitOptIn: true,
        environment,
      }), environment).toThrow(/limited to development, local or test/);
    }
    expect(() => assertStaffLeaveCoordinationDemoSeedAllowed({
      demoMode: true,
      explicitOptIn: true,
      environment: "test",
    })).not.toThrow();
  });

  it("runs only after the demo governance fixture in the explicit demo seed chain", () => {
    const seedChain = packageJson.scripts["db:seed"]!;
    expect(seedChain.indexOf("db:seed:governance-authority"))
      .toBeLessThan(seedChain.indexOf("db:seed:staff-leave-coordination"));
    expect(packageJson.scripts["db:seed:governance-authority"])
      .toContain("DEMO_MODE=true SEED_GOVERNANCE_AUTHORITY=true");
    expect(packageJson.scripts["db:seed:staff-leave-coordination"])
      .toContain("DEMO_MODE=true SEED_STAFF_LEAVE_COORDINATION=true");
  });
});

describe("staff-leave coordination demo fixture", () => {
  it("keeps one Principal person whether migration 107 runs before or after demo identity creation", () => {
    const deterministicFallback = "10000000-0000-4000-8000-000000000001";
    const preProvisionedPerson = "20000000-0000-4000-8000-000000000002";

    // Clean install: migration 107 ran while the database was empty, so the
    // governance seed creates the deterministic person after the account exists.
    expect(selectExactDemoPersonIdentity([], deterministicFallback, "Principal demo"))
      .toBe(deterministicFallback);
    // Upgrade/partial install: migration 107 or the Core already retained the
    // exact account endpoint, so governance must reuse that person.
    expect(selectExactDemoPersonIdentity(
      [preProvisionedPerson, preProvisionedPerson],
      deterministicFallback,
      "Principal demo",
    )).toBe(preProvisionedPerson);
    expect(() => selectExactDemoPersonIdentity(
      [preProvisionedPerson, deterministicFallback],
      deterministicFallback,
      "Principal demo",
    )).toThrow(/more than one campus person/);

    expect(governanceSeed).toContain("campus_model_agent_endpoints endpoint");
    expect(governanceSeed).toContain("person: people[0]!.id");
  });

  it("uses Kavita's exact staff person for her governance appointment", () => {
    expect(governanceSeed).toContain("teacher_profile.person_id teacher_person_id");
    expect(governanceSeed).toContain("person: scope.teacher_person_id");
    expect(governanceSeed).toContain("profile.person_id=appointment.person_id");
    expect(governanceSeed).not.toContain('demoId("governance-person-kavita-mehta")');
  });

  it("does not manufacture governance revisions when the demo seed is replayed unchanged", () => {
    const reconciliationUpdates = governanceSeed.match(/ON CONFLICT(?:\([^\n]+\))? DO UPDATE SET/g) ?? [];
    const changeGuards = governanceSeed.match(/IS DISTINCT FROM/g) ?? [];

    expect(reconciliationUpdates).toHaveLength(8);
    expect(changeGuards).toHaveLength(reconciliationUpdates.length);
    expect(governanceSeed).not.toContain("verified_at=EXCLUDED.verified_at");
    expect(governanceSeed).toContain('assertAbsentOrExactFixture(existingLocalSource, "Cambridge demo management source")');
    expect(governanceSeed).toContain('assertAbsentOrExactFixture(existingPrincipalOffice, "Cambridge demo Principal office")');
    expect(governanceSeed).toContain('assertAbsentOrExactFixture(existingPrincipalAppointment, "Cambridge demo Principal appointment")');
  });

  it("installs an individual Principal decision route rather than an unevidenced delegation", () => {
    expect(coordinationSeed).toContain("'staff_leave_decision'");
    expect(coordinationSeed).toContain("'individual',$3,null,null");
    expect(coordinationSeed).not.toMatch(/staff_leave_decision[^\n]*'delegated'/);
    expect(coordinationSeed).toContain("appointment.linked_user_id=principal.id");
    expect(coordinationSeed).toContain("source.verification_state='verified'");
    expect(coordinationSeed).toContain('assertOneExactRow(effectiveOfficeholders, "sole effective Principal officeholder")');
    expect(coordinationSeed).toContain("effectiveOfficeholders[0]!.id");
  });

  it("configures one authorized recipient without adding a runtime default", () => {
    expect(coordinationSeed).toContain("'staff_leave:decide'");
    expect(coordinationSeed).toContain('mode: "explicit_authorized_agents"');
    expect(coordinationSeed).toContain('selector_key: "leave_decision_owner"');
    expect(coordinationSeed).toContain('min_recipients: 1');
    expect(coordinationSeed).toContain('max_recipients: 1');
    expect(coordinationSeed).toContain("'staff_operations','staff.leave_submitted'");
    expect(coordinationSeed).toContain("'request',1");
  });

  it("uses insert-if-absent plus exact rereads for every mutable fixture record", () => {
    expect(coordinationSeed.match(/ON CONFLICT DO NOTHING/g)?.length).toBeGreaterThanOrEqual(5);
    for (const description of [
      "staff-leave decision rule",
      "Principal staff-leave capability grant",
      "approved staff-leave behaviour version",
      "staff-leave event subscription",
    ]) {
      expect(coordinationSeed).toContain(`assertOneExactRow(${description.startsWith("staff-leave decision") ? "rules"
        : description.startsWith("Principal") ? "authorities"
          : description.startsWith("approved") ? "behaviours" : "subscriptions"}, "${description}")`);
    }
  });
});
