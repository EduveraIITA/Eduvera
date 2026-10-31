import { describe, expect, it } from "vitest";
import { assessmentGrading } from "../src/assessments/assessment-grading.js";
import { gradingPolicyConfigurationSchema, policySemanticFingerprint } from "../src/academic-reports/grading-policy.js";
const configuration = gradingPolicyConfigurationSchema.parse({
  result_format: "gpa", grade_point_scale: 10, decimal_places: 2, aggregation: "credit_weighted",
  bands: [
    { code: "F", label: "Fail", minimum_percentage: 0, maximum_percentage: 49.99, grade_points: 0, passed: false },
    { code: "B", label: "Good", minimum_percentage: 50, maximum_percentage: 79.99, grade_points: 7, passed: true },
    { code: "A", label: "Excellent", minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true },
  ],
});
const snapshot = { policy_id: "81917b64-571a-4390-8431-4292d58c8a59", code: "GPA", name: "College scale", version: 1, configuration, semantic_fingerprint: policySemanticFingerprint(configuration) };
describe("frozen assessment grading", () => {
  it("keeps legacy marks without pretending they have a policy", () => expect(assessmentGrading(null, 16, 20)).toBeNull());
  it("derives grade points from the selected scale, rather than marks divided by ten", () => {
    expect(assessmentGrading(snapshot, 16, 20)?.result).toEqual({ percentage: 80, grade: "A", grade_points: 10, passed: true });
    expect(assessmentGrading(snapshot, 15, 20)?.result).toEqual({ percentage: 75, grade: "B", grade_points: 7, passed: true });
  });
  it("keeps zero scored and missing outcomes unscored", () => {
    expect(assessmentGrading(snapshot, 0, 20)?.result).toEqual({ percentage: 0, grade: "F", grade_points: 0, passed: false });
    expect(assessmentGrading(snapshot, null, 20)?.result).toBeNull();
  });
  it("refuses damaged snapshots instead of silently falling back to a different scale", () => {
    expect(() => assessmentGrading({ ...snapshot, configuration: { ...configuration, grade_point_scale: 4 } }, 16, 20)).toThrow(/cannot be verified/);
    expect(() => assessmentGrading({ ...snapshot, semantic_fingerprint: "0".repeat(64) }, 16, 20)).toThrow(/cannot be verified/);
  });
  it.each([[-1, 20], [21, 20], [0, 0], [Number.NaN, 20]])("refuses invalid evidence %s/%s", (marks, maximum) => {
    expect(() => assessmentGrading(snapshot, marks, maximum)).toThrow(/cannot be evaluated/);
  });
  it("selects the band after the documented hundredth rounding", () => {
    expect(assessmentGrading(snapshot, 79.995, 100)?.result).toMatchObject({ percentage: 80, grade: "A" });
  });
});
