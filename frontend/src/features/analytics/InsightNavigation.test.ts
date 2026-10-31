import { describe, expect, it } from "vitest";
import { canonicalInsightsPath, insightPath, legacyInsightDestination } from "./InsightNavigation";

describe("canonical Insights navigation", () => {
  it("maps transitional analytics audiences to neutral workspace scopes", () => {
    expect(insightPath("principal", "results", "period=90")).toBe("/areas/insights/results?period=90&scope=institution");
    expect(insightPath("teacher", "attendance")).toBe("/areas/insights/attendance?scope=assigned");
    expect(insightPath("parent", "", "student_id=learner-1")).toBe("/areas/insights?student_id=learner-1&scope=dependent");
    expect(insightPath("student", "results", "student_id=learner-1")).toBe("/areas/insights/results?student_id=learner-1&scope=self");
  });

  it("never overwrites an exact scope already supplied by the manifest route", () => {
    expect(insightPath("principal", "attendance", "scope=dependent&student_id=learner-2&period=30"))
      .toBe("/areas/insights/attendance?scope=dependent&student_id=learner-2&period=30");
  });

  it("redirects every legacy route while retaining topic, query and fragment", () => {
    expect(legacyInsightDestination(
      "/parent/analytics/results",
      "?student_id=learner-2&period=90",
      "#published",
    )).toBe("/areas/insights/results?student_id=learner-2&period=90&scope=dependent#published");
    expect(legacyInsightDestination("/principal/insights/operations", "?date=2026-10-07"))
      .toBe("/areas/insights/operations?date=2026-10-07&scope=institution");
    expect(legacyInsightDestination("/teacher/insights/results/", "?period=30"))
      .toBe("/areas/insights/results?period=30&scope=assigned");
  });

  it("normalizes the historical class filter on canonical links", () => {
    expect(canonicalInsightsPath("attendance", "?insight_class=class-7&period=30"))
      .toBe("/areas/insights/attendance?period=30&class=class-7");
  });
});
