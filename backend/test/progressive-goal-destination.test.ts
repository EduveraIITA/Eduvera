import { describe, expect, it } from "vitest";
import { canonicalProgressiveGoalDestination } from "../src/institution-onboarding/progressive-goal-destination.js";

describe("progressive first-use destinations", () => {
  it.each(["attendance", "gate", "timetable", "assignments", "fees", "examinations", "performance", "staff", "messages"])(
    "normalizes historical catalogue and retained resume paths for %s", (goal) => {
      const expected = `/more/setup/capabilities?task=${goal}`;
      expect(canonicalProgressiveGoalDestination(goal, `/principal/get-started/${goal}`)).toBe(expected);
      expect(canonicalProgressiveGoalDestination(goal, `/principal/get-started?task=${goal}`)).toBe(expected);
      expect(canonicalProgressiveGoalDestination(goal, expected)).toBe(expected);
    },
  );

  it("brings the historical performance starter into the same capability guide", () => {
    expect(canonicalProgressiveGoalDestination("performance", "/principal/results"))
      .toBe("/more/setup/capabilities?task=performance");
  });

  it.each([
    [null, "/today"], ["unregistered", "/principal/get-started?task=unregistered"],
    ["gate", "/principal/get-started/attendance"], ["gate", "/principal/get-started?task=attendance"],
    ["gate", "/principal/get-started?task=gate&task=attendance"],
    ["attendance", "/areas/attendance/registers?class_section_id=exact-class&date=2026-10-19"],
    ["attendance", "//outside.invalid/principal/get-started?task=attendance"],
  ])("does not reinterpret unrelated or mismatched destinations (%s, %s)", (goal, path) => {
    expect(canonicalProgressiveGoalDestination(goal, path)).toBe(path);
  });
});
