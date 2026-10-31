import { describe, expect, it } from "vitest";
import { calculateCreditGpa, evaluatePolicyPercentage, gradingPolicyConfigurationSchema, gradingPolicySnapshotSchema, latestCourseAttempts, policySemanticFingerprint, roundGradeValue,
  type GradingCreditCourse } from "../src/academic-reports/grading-policy.js";
import { policyInput, schemeInput, subjectPlanInput } from "../src/academic-reports/academic-reports.service.js";

const rules = (overrides: Record<string, unknown> = {}) => gradingPolicyConfigurationSchema.parse({ schema_version: 1, result_format: "gpa", grade_point_scale: 10,
  decimal_places: 2, aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include",
  bands: [{ code: "F", label: "Needs support", minimum_percentage: 0, maximum_percentage: 49.99, grade_points: 0, passed: false },
    { code: "C", label: "Pass", minimum_percentage: 50, maximum_percentage: 69.99, grade_points: 6, passed: true },
    { code: "B", label: "Very good", minimum_percentage: 70, maximum_percentage: 79.99, grade_points: 8, passed: true },
    { code: "A", label: "Excellent", minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true }], ...overrides });
const course = (code: string, points: number | null, credits: number, term = 1, extra: Partial<GradingCreditCourse> = {}): GradingCreditCourse => ({
  course_code: code, grade_points: points, credits, term_index: term, batch_id: `batch-${term}`, report_student_id: `student-${term}`,
  report_subject_id: `${code}-${term}`, percentage: points === null ? null : points * 10, outcome: "complete", passed: points !== null && points > 0, ...extra,
});

describe("institution grading arithmetic and policy truth", () => {
  it.each([[49.994, "F", 49.99], [49.995, "C", 50], [69.994, "C", 69.99], [69.995, "B", 70], [79.995, "A", 80], [0, "F", 0], [100, "A", 100]])(
    "rounds %s to the exact hundredth band before assigning %s", (value, grade, percentage) => {
      expect(evaluatePolicyPercentage(rules(), Number(value))).toMatchObject({ grade, percentage });
    },
  );
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 100.01])("rejects an invalid scored percentage %s", value => {
    expect(() => evaluatePolicyPercentage(rules(), value)).toThrow();
  });
  it("weights grade points by credits instead of averaging percentages or semester GPAs", () => {
    expect(calculateCreditGpa(rules(), [course("DB", 8, 2), course("ML", 6, 4)])).toMatchObject({ gpa: 6.67, credits: 6, credit_points: 40 });
  });
  it("uses the latest course attempt including a later failure", () => {
    const attempts = [course("DB", 8, 2), course("ML", 6, 4), course("DB", 0, 2, 2), course("OS", 8, 4, 2)];
    expect(latestCourseAttempts(attempts).map(item => [item.course_code, item.grade_points])).toEqual([["DB", 0], ["ML", 6], ["OS", 8]]);
    expect(calculateCreditGpa(rules(), latestCourseAttempts(attempts))).toMatchObject({ gpa: 5.6, credits: 10, credit_points: 56 });
  });
  it("calculates cumulative points from courses after a successful retake", () => {
    const attempts = [course("DB", 8, 2), course("ML", 6, 4), course("DB", 10, 2, 2), course("OS", 8, 4, 2)];
    expect(calculateCreditGpa(rules(), latestCourseAttempts(attempts))).toMatchObject({ gpa: 7.6, credits: 10, credit_points: 76 });
  });
  it("withholds the entire GPA when configured instead of dropping failed credits", () => {
    expect(calculateCreditGpa(rules({ gpa_failure_treatment: "withhold" }), [course("DB", 0, 2), course("ML", 8, 4)])).toMatchObject({ gpa: null, credits: 6, credit_points: 32, unavailable_reason: "failed_courses" });
  });
  it.each(["incomplete", "withheld"])("never turns a %s course into zero", outcome => {
    expect(calculateCreditGpa(rules(), [course("DB", null, 2, 1, { outcome, passed: null }), course("ML", 8, 4)])).toMatchObject({ gpa: null, credits: 6, credit_points: null, unavailable_reason: "incomplete_courses" });
  });
  it("excludes exempt courses from points and denominator, without treating all exempt as GPA zero", () => {
    const exempt = course("EX", null, 2, 1, { outcome: "exempt", passed: null });
    expect(calculateCreditGpa(rules(), [exempt, course("ML", 8, 4)])).toMatchObject({ gpa: 8, credits: 4, credit_points: 32 });
    expect(calculateCreditGpa(rules(), [exempt])).toMatchObject({ gpa: null, credits: 0, credit_points: null });
  });
  it("rejects two different attempts for the same course in one term", () => {
    expect(() => latestCourseAttempts([course("DB", 8, 2), course("DB", 10, 2, 1, { report_subject_id: "other" })])).toThrow(/ambiguous/);
  });
  it("allows four and custom point scales and four-decimal display precision", () => {
    const configuration = rules({ grade_point_scale: 4, decimal_places: 4,
      bands: [{ code: "F", label: "Fail", minimum_percentage: 0, maximum_percentage: 49.99, grade_points: 0, passed: false }, { code: "P", label: "Pass", minimum_percentage: 50, maximum_percentage: 100, grade_points: 3.3333, passed: true }] });
    expect(evaluatePolicyPercentage(configuration, 80).grade_points).toBe(3.3333);
    expect(calculateCreditGpa(configuration, [course("DB", 3.3333, 3), course("ML", 4, 2)])).toMatchObject({ gpa: 3.6, credit_points: 17.9999 });
    expect(roundGradeValue(8.666666, 4)).toBe(8.6667);
  });
  it.each([
    { grade_point_scale: 4 }, { aggregation: "equal" }, { grade_point_scale: null },
    { decimal_places: 5 }, { decimal_places: "2" }, { grade_point_scale: "10" },
    { bands: [{ code: "A", label: "Gap", minimum_percentage: 1, maximum_percentage: 100, grade_points: 10, passed: true }] },
    { bands: [{ code: "A", label: "Fractional boundary", minimum_percentage: 0.001, maximum_percentage: 100, grade_points: 10, passed: true }] },
  ])("rejects invalid or coerced policy configuration %j", override => {
    expect(() => rules(override)).toThrow();
  });
  it("compares cumulative semantics across new names and display precision but rejects changed scales or absence rules", () => {
    const original = rules();
    expect(policySemanticFingerprint(rules({ decimal_places: 4 }))).toBe(policySemanticFingerprint(original));
    expect(policySemanticFingerprint(rules({ absence_treatment: "zero" }))).not.toBe(policySemanticFingerprint(original));
  });
  it("validates frozen snapshots without throwing from safeParse on corrupt configuration", () => {
    const configuration = rules();
    const snapshot = { policy_id: "ff90d5eb-c37f-494b-bb96-cac31f55d6ad", code: "TEN", name: "Ten points", version: 1, configuration, semantic_fingerprint: policySemanticFingerprint(configuration) };
    expect(gradingPolicySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(gradingPolicySnapshotSchema.safeParse({ ...snapshot, configuration: { ...configuration, grade_point_scale: 4 } }).success).toBe(false);
    expect(gradingPolicySnapshotSchema.safeParse({ ...snapshot, semantic_fingerprint: "0".repeat(64) }).success).toBe(false);
  });
  it("accepts configured schemes without a legacy bands array and refuses missing grading configuration", () => {
    const body = { term_id: "ff90d5eb-c37f-494b-bb96-cac31f55d6ad", class_section_id: "ff90d5eb-c37f-494b-bb96-cac31f55d6ad", name: "Semester", code: "SEM", grading_policy_id: "ff90d5eb-c37f-494b-bb96-cac31f55d6ad", programme_key: "MTECH-DE-2032", term_index: 1 };
    expect(schemeInput.safeParse(body).success).toBe(true);
    expect(schemeInput.safeParse({ ...body, grading_policy_id: null }).success).toBe(false);
  });
  it("never coerces missing course credits into a zero or an invented score", () => {
    const body = { subject_id: "ff90d5eb-c37f-494b-bb96-cac31f55d6ad", expected_revision: 1, components: [{ code: "TERM", name: "Term", weight_percentage: 100, assessment_ids: ["ff90d5eb-c37f-494b-bb96-cac31f55d6ad"] }] };
    expect(subjectPlanInput.parse(body).credits).toBeNull();
    expect(subjectPlanInput.safeParse({ ...body, credits: "" }).success).toBe(false);
    expect(subjectPlanInput.safeParse({ ...body, credits: 0 }).success).toBe(false);
    expect(policyInput.safeParse({ name: "Semester grading", code: "TERM", configuration: rules() }).success).toBe(true);
  });
});
