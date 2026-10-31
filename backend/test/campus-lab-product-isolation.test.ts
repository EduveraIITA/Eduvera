import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");
}

describe("Campus Lab product isolation", () => {
  it("keeps the Cambridge harness out of normal product module composition", () => {
    const applicationModule = source("app.module.ts");
    const databaseModule = source("database/database.module.ts");

    expect(applicationModule).not.toContain("CampusLabHostedModule");
    expect(databaseModule).not.toContain("CampusLabSimulationEnvironmentService");
  });

  it("allows product sessions to resolve only generic transient Simulation runs", () => {
    const authService = source("auth/auth.service.ts");
    const authController = source("auth/auth.controller.ts");

    expect(authService).not.toContain("CampusLabSimulationEnvironmentService");
    expect(authService).not.toContain("bindCampusLabSimulation");
    expect(authController).not.toContain("campus-lab-simulation");
    expect(authService).toContain("this.transientRuns?.resolveAuthorizedRun");
  });

  it("retains the synthetic harness behind its own opt-in module", () => {
    const harnessModule = source("campus-lab-hosted/campus-lab-hosted.module.ts");
    const harnessService = source("campus-lab-hosted/campus-lab-hosted.service.ts");

    expect(harnessModule).toContain("CampusLabSimulationEnvironmentService");
    expect(harnessModule).toContain("The product AppModule deliberately does not");
    expect(harnessService).toContain("await this.auth.returnSessionToLive(request.sessionHash)");
    expect(harnessService).not.toContain("bindCampusLabSimulation");
  });
});
