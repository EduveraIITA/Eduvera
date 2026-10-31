import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulationFunctionDefinition, type SimulationBranch } from "../src/database/simulation-branch.driver.js";

const migration = readFileSync(new URL("../migrations/205_institution_local_permission_dates.sql", import.meta.url), "utf8");
describe("selected-world institution permission date migration", () => {
  it("clones the real date helper against the selected Simulation clock and school timezone", () => {
    const source = migration.slice(migration.indexOf("CREATE FUNCTION campus_permission_date"), migration.indexOf("REVOKE ALL"));
    const branch = { schema_name: "dt_run_authority_clock" } as SimulationBranch;
    const cloned = simulationFunctionDefinition(source, branch);
    expect(cloned).toContain('DEFAULT "dt_run_authority_clock".simulation_now()');
    expect(cloned).toContain('SET search_path TO "dt_run_authority_clock", public');
    expect(cloned).toContain("AT TIME ZONE timezone");
    expect(cloned).not.toMatch(/\b(?:current_date|now\(\))/i);
    // The helper resolves a school from its selected-world search path, rather
    // than converting the execution clock using the connection TimeZone.
    expect(cloned).toContain("FROM schools WHERE id=tenant");
  });
  it("keeps explicit-date callers while requiring current campus authority, and preserves the event dispatcher OID", () => {
    expect(migration).toContain("at_date date DEFAULT NULL");
    expect(migration).toContain("COALESCE(at_date,campus_permission_date(tenant)) BETWEEN b.starts_on");
    expect(migration).toContain("AND campus_permission_date(tenant) BETWEEN b.starts_on");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION event_user_is_authorized(");
    expect(migration).not.toMatch(/ALTER FUNCTION event_user_is_authorized.*RENAME/);
    expect(migration).toContain("binding.context_kind='institution' AND binding.scope_id=tenant");
    expect(migration).toContain("exception.scope_kind='institution'");
  });
  it("keeps role administration preconditions, grant starts and compatibility readers off the process date", () => {
    for (const source of ["roles/authorization.ts", "roles/roles.service.ts", "roles/access-roles.service.ts", "operations/operations.service.ts"]) {
      expect(readFileSync(new URL(`../src/${source}`, import.meta.url), "utf8")).not.toMatch(/\bcurrent_date\b/i);
    }
  });
  it("retains prior Finance event-name decisions instead of granting unknown event types", () => {
    const dispatch = readFileSync(new URL("../migrations/207_preserve_finance_event_dispatch.sql", import.meta.url), "utf8");
    expect(dispatch).toContain("fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id) AND (%s)");
    expect(dispatch).toContain("CREATE OR REPLACE FUNCTION event_user_is_authorized(");
    expect(dispatch).not.toMatch(/ALTER FUNCTION event_user_is_authorized.*RENAME/);
    const allowlist = readFileSync(new URL("../migrations/208_typed_finance_event_allowlist.sql", import.meta.url), "utf8");
    expect(allowlist).toContain("event_name NOT IN (");
    expect(allowlist).toContain(") THEN false ELSE (%s) END");
    expect(new Set([...allowlist.matchAll(/'(finance\.[a-z_.]+)'/g)].map(match => match[1]))).toEqual(new Set([
      "finance.charge.issued", "finance.charge_batch.issued", "finance.charge.corrected", "finance.payment.corrected",
      "finance.payment_review.reported", "finance.payment_review.decided", "finance.payment_review.withdrawn",
      "finance.instalment.requested", "finance.instalment.decided", "finance.instalment.withdrawn",
      "finance.self_payer.enabled", "finance.self_payer.revoked",
    ]));
    const sources = readFileSync(new URL("../migrations/209_preserve_fee_refresh_source_guards.sql", import.meta.url), "utf8");
    expect(sources).toContain("AND event_user_is_authorized_before_teaching_sessions(event_school_id,event_name,event_payload,candidate_user_id)");
    expect(sources).toContain("event_payload->>'source_domain' IS DISTINCT FROM 'teaching_sessions'");
  });
});
