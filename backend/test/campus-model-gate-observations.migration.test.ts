import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "migrations/105_campus_model_gate_observations.sql"), "utf8");

describe("campus model gate observation migration", () => {
  it("normalizes retained gate events without changing the owning domain", () => {
    expect(migration).toContain("INSERT INTO campus_model_observations");
    expect(migration).toContain("'movement.gate_observed'");
    expect(migration).toContain("'gate.movement'");
    expect(migration).toContain("'accepted'");
    expect(migration).not.toMatch(/UPDATE gate_events|DELETE FROM gate_events/);
  });

  it("keeps missing legacy capture identity explicit", () => {
    expect(migration).toContain("'legacy-gate-events'");
    expect(migration).toContain("'backfilled',true");
    expect(migration).toContain("'identity_verified',false");
    expect(migration).not.toContain("agent_kind,'device'");
  });

  it("supports context lookup without granting browser table access", () => {
    expect(migration).toContain("campus_model_observations_context_time_idx");
    expect(migration).not.toMatch(/GRANT\s+.+campus_model_observations/i);
  });
});
