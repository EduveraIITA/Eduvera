import type { GradingPolicyConfiguration, ReportCalculation, ResultPolicySnapshot } from "./academic-reports";

/** Existing versioned half-up rule used for preview and policy-bound display.
 * Boundary tests execute the grading owner; no saved grade is recalculated. */
function roundGradeValue(value: number, decimalPlaces = 2): number {
  if (!Number.isFinite(value) || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) throw new Error("Invalid grading value or precision.");
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * factor) / factor;
}

/** Entry assistance only. Published values always come from the owning API. */
export function previewConfiguredGrade(marks: string, maximumMarks: string, configuration: GradingPolicyConfiguration) {
  if (!marks.trim() || !Number.isFinite(Number(marks)) || Number(marks) < 0 || !Number.isFinite(Number(maximumMarks)) || Number(maximumMarks) <= 0 || Number(marks) > Number(maximumMarks)) return null;
  const rawPercentage = Number(marks) / Number(maximumMarks) * 100;
  const percentage = roundGradeValue(rawPercentage, 2);
  const band = configuration.bands.find((item) => percentage >= item.minimum_percentage && percentage <= item.maximum_percentage);
  return band ? { percentage, grade: band.code, grade_points: band.grade_points, passed: band.passed } : null;
}

export function resultNumber(value: string | number | null | undefined, policy?: ResultPolicySnapshot | null) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return policy ? roundGradeValue(Number(value), policy.configuration.decimal_places).toFixed(policy.configuration.decimal_places) : String(value);
}

/** Credit quantities retain their exact recorded precision, without SQL padding. */
export function creditNumber(value: string | number | null | undefined) {
  if (typeof value === "string" && !value.trim()) return "—";
  const number = resultNumber(typeof value === "string" ? value.trim() : value);
  return number.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function policyDescription(policy?: ResultPolicySnapshot | null) {
  if (!policy) return "Percentage and grade";
  const configuration = policy.configuration;
  const format = configuration.result_format === "gpa" ? `${configuration.grade_point_scale}-point scale` : configuration.result_format === "grade" ? "Grades" : "Percentage";
  return `${format} · ${configuration.aggregation === "credit_weighted" ? "Credit weighted" : "Equal subject weight"}`;
}

export function cumulativeUnavailableReason(reason: ReportCalculation["cgpa_unavailable_reason"]) {
  return reason === "missing_prior_terms" ? "Earlier terms are not all published." : reason === "incompatible_policy" ? "Earlier terms use an incompatible grading policy." : reason === "incomplete_courses" ? "Included courses are incomplete." : reason === "failed_courses" ? "GPA is withheld until included courses pass." : reason === "ambiguous_prior_terms" ? "More than one report is available for an earlier term. The institution must resolve which report applies." : reason === "ambiguous_course_attempts" ? "A course has more than one attempt in the same term. The institution must resolve the source records." : "Cumulative result unavailable.";
}

export function reportPrimaryResult(report: ReportCalculation & { overall_percentage: string | null; overall_grade: string; outcome: string }, fallbackPolicy?: ResultPolicySnapshot | null) {
  const policy = report.result_policy ?? fallbackPolicy;
  if (policy?.configuration.result_format === "gpa") {
    const number = resultNumber(report.gpa, policy);
    return { label: "SGPA", value: number === "—" ? number : `${number} / ${policy.configuration.grade_point_scale}`, secondary: "" };
  }
  if (policy?.configuration.result_format === "grade") return { label: "Grade", value: report.overall_grade || "—", secondary: "" };
  const number = resultNumber(report.overall_percentage, policy);
  return { label: "Overall", value: number === "—" ? report.overall_grade || "—" : `${number}%`, secondary: report.overall_grade };
}

export function assessmentPrimaryResult(result: { outcome: string; marks: string | null; maximum_marks: string; grade: string; percentage?: string | null; grade_points?: string | null; result_policy?: ResultPolicySnapshot | null }) {
  const policy = result.result_policy;
  if (result.outcome !== "scored") return { label: "Result", value: result.outcome.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), secondary: "" };
  if (policy?.configuration.result_format === "grade") return { label: "Grade", value: result.grade || "—", secondary: "" };
  if (policy?.configuration.result_format === "gpa") {
    const points = resultNumber(result.grade_points, policy);
    return { label: "Grade points", value: points === "—" ? points : `${points} / ${policy.configuration.grade_point_scale}`, secondary: result.grade };
  }
  if (policy) {
    const percentage = resultNumber(result.percentage, policy);
    return { label: "Percentage", value: percentage === "—" ? percentage : `${percentage}%`, secondary: result.grade };
  }
  return { label: "Marks", value: result.marks === null ? "—" : `${result.marks}/${result.maximum_marks}`, secondary: result.grade };
}
