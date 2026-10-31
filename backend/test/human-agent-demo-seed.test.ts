import { describe, expect, it } from "vitest";
import { assertHumanAgentIdentityDemoSeedAllowed } from "../src/database/seed-human-agent-identities.js";

describe("human-agent demo seed safety", () => {
  it("requires explicit demo mode and a non-production environment", () => {
    expect(() => assertHumanAgentIdentityDemoSeedAllowed({ demoMode: false, environment: "test" }))
      .toThrow(/DEMO_MODE/);
    expect(() => assertHumanAgentIdentityDemoSeedAllowed({ demoMode: true, environment: "production" }))
      .toThrow(/limited/);
    expect(() => assertHumanAgentIdentityDemoSeedAllowed({ demoMode: true, environment: "stage" }))
      .toThrow(/limited/);
    expect(() => assertHumanAgentIdentityDemoSeedAllowed({ demoMode: true, environment: "test" }))
      .not.toThrow();
  });
});
