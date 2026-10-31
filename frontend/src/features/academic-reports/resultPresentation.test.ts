import { describe, expect, it } from "vitest";
import type { GradingPolicyConfiguration, ResultPolicySnapshot } from "./api";
import { assessmentPrimaryResult, previewConfiguredGrade, reportPrimaryResult } from "./resultPresentation";

const configuration: GradingPolicyConfiguration = { schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2, aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include", bands: [{ code: "B", label: "Good", minimum_percentage: 0, maximum_percentage: 79.99, grade_points: 8, passed: true }, { code: "A", label: "Excellent", minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true }] };
const policy: ResultPolicySnapshot = { policy_id: "policy-1", name: "College credits", code: "CREDITS", version: 1, semantic_fingerprint: "frozen-1", configuration };

describe("policy-aware result presentation", () => {
  it("matches half-up percentage band boundaries used by the owning calculation", () => {
    expect(previewConfiguredGrade("15999", "20000", configuration)).toEqual({ percentage: 80, grade: "A", grade_points: 10, passed: true });
    expect(previewConfiguredGrade("79.99", "100", configuration)?.grade).toBe("B");
  });
  it("preserves a real zero and never derives a grade from a blank entry", () => {
    expect(previewConfiguredGrade("", "100", configuration)).toBeNull();
    expect(previewConfiguredGrade("101", "100", configuration)).toBeNull();
    expect(previewConfiguredGrade("0", "100", configuration)?.percentage).toBe(0);
  });
  it("uses frozen GPA and grade formats rather than converting stored percentages", () => {
    expect(reportPrimaryResult({ outcome: "complete", overall_percentage: "84.25", overall_grade: "A", gpa: "8.30", result_policy: policy })).toEqual({ label: "SGPA", value: "8.30 / 10", secondary: "" });
    expect(reportPrimaryResult({ outcome: "complete", overall_percentage: "84.25", overall_grade: "A", result_policy: { ...policy, configuration: { ...configuration, result_format: "grade", grade_point_scale: null } } }).value).toBe("A");
    expect(reportPrimaryResult({ outcome: "complete", overall_percentage: "84.25", overall_grade: "A", result_policy: policy }).value).toBe("—");
  });
  it("uses server-published assessment points without presenting them as SGPA", () => {
    const result = { outcome: "scored", marks: "84.25", maximum_marks: "100", grade: "A", percentage: "84.25", grade_points: "9", result_policy: policy };
    expect(assessmentPrimaryResult(result)).toEqual({ label: "Grade points", value: "9.00 / 10", secondary: "A" });
    expect(assessmentPrimaryResult({ ...result, grade_points: null }).value).toBe("—");
    expect(assessmentPrimaryResult({ ...result, outcome: "withheld", marks: null }).value).toBe("Withheld");
  });
});
