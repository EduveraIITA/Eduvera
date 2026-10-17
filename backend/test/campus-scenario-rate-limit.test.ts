import { describe, expect, it } from "vitest";
import { rateLimitRule } from "../src/common/rate-limit.js";

describe("campus scenario rate limits", () => {
  it("applies narrow limits to target discovery and execution", () => {
    expect(rateLimitRule(
      "/api/v1/schools/example/campus-view/scenarios/targets/",
      "GET",
    )).toEqual({ limit: 12, windowMs: 60_000 });
    expect(rateLimitRule(
      "/api/v1/schools/example/campus-view/scenarios/",
      "POST",
    )).toEqual({ limit: 6, windowMs: 60_000 });
  });
});
