import { afterEach, describe, expect, it, vi } from "vitest";
import { agentExecutionLimits } from "../src/agent/limits.js";
afterEach(() => vi.unstubAllEnvs());
describe("deployment execution limits", () => {
  it("accepts bounded overrides", () => {
    vi.stubEnv("AGENT_MAX_MODEL_CALLS", "15");
    vi.stubEnv("AGENT_MAX_TOOL_CALLS", "20");
    vi.stubEnv("AGENT_MAX_TOOL_BATCH", "2");
    expect(agentExecutionLimits()).toEqual({ modelCalls: 15, tools: 20, batch: 2 });
  });
  it("rejects unbounded cost or parallel execution settings", () => {
    vi.stubEnv("AGENT_MAX_MODEL_CALLS", "100000");
    expect(() => agentExecutionLimits()).toThrow();
    vi.stubEnv("AGENT_MAX_MODEL_CALLS", "10");
    vi.stubEnv("AGENT_MAX_TOOL_BATCH", "5");
    expect(() => agentExecutionLimits()).toThrow();
  });
});
