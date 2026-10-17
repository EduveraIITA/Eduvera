import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertAttendanceCompletionCoordinationDemoSeedAllowed,
} from "../src/database/seed-attendance-completion-coordination.js";

const seed = readFileSync(
  new URL("../src/database/seed-attendance-completion-coordination.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("attendance-completion coordination demo seed", () => {
  it("requires explicit demo opt-in and a non-production environment", () => {
    expect(() => assertAttendanceCompletionCoordinationDemoSeedAllowed({ demoMode: false, explicitOptIn: true, environment: "development" })).toThrow(/DEMO_MODE/);
    expect(() => assertAttendanceCompletionCoordinationDemoSeedAllowed({ demoMode: true, explicitOptIn: false, environment: "development" })).toThrow(/SEED_ATTENDANCE_COMPLETION_COORDINATION/);
    for (const environment of ["production", "stage", "staging", "preview", ""]) {
      expect(() => assertAttendanceCompletionCoordinationDemoSeedAllowed({ demoMode: true, explicitOptIn: true, environment }), environment || "empty").toThrow(/limited to development/);
    }
    expect(() => assertAttendanceCompletionCoordinationDemoSeedAllowed({ demoMode: true, explicitOptIn: true, environment: "local" })).not.toThrow();
  });

  it("installs exact-owner Tasks for daily and subject register events", () => {
    expect(seed).toContain("'attendance_completion:complete'");
    expect(seed).toContain('selector_key: "attendance_register_owner"');
    expect(seed).toContain('eventType: "attendance.register.overdue"');
    expect(seed).toContain('eventType: "attendance.session.overdue"');
    expect(seed).toContain('message_kind=\'task\'');
    expect(seed).not.toContain("auto_submit");
  });

  it("runs only through the guarded demo seed chain", () => {
    expect(packageJson.scripts["db:seed:attendance-completion-coordination"])
      .toContain("DEMO_MODE=true SEED_ATTENDANCE_COMPLETION_COORDINATION=true");
    expect(packageJson.scripts["db:seed"]).toContain("db:seed:attendance-completion-coordination");
  });
});
