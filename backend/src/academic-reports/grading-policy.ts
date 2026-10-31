import { createHash } from "node:crypto";
import { z } from "zod";

const finite = z.number().finite();
const bandSchema = z.object({
  code: z.string().trim().min(1).max(24).transform(value => value.toUpperCase()),
  label: z.string().trim().min(1).max(80),
  minimum_percentage: finite.min(0).max(100).multipleOf(0.01),
  maximum_percentage: finite.min(0).max(100).multipleOf(0.01),
  grade_points: finite.min(0).max(100).multipleOf(0.0001).nullable().default(null),
  passed: z.boolean(),
}).strict();

/** Percentages use hundredths for band selection; decimal_places controls the
 * primary displayed value only. Half-up rounding is fixed and versioned. */
export const gradingPolicyConfigurationSchema = z.object({
  schema_version: z.literal(1).default(1),
  result_format: z.enum(["percentage", "grade", "gpa"]),
  grade_point_scale: finite.positive().max(100).multipleOf(0.0001).nullable().default(null),
  decimal_places: z.number().int().min(0).max(4).default(2),
  aggregation: z.enum(["equal", "credit_weighted"]).default("equal"),
  absence_treatment: z.enum(["incomplete", "zero"]).default("incomplete"),
  exemption_treatment: z.literal("exclude").default("exclude"),
  gpa_failure_treatment: z.enum(["include", "withhold"]).default("include"),
  bands: z.array(bandSchema).min(1).max(30),
}).strict().superRefine((value, context) => {
  const sorted = [...value.bands].sort((a, b) => a.minimum_percentage - b.minimum_percentage);
  const add = (message: string) => context.addIssue({ code: "custom", path: ["bands"], message });
  if (sorted[0]!.minimum_percentage !== 0 || sorted.at(-1)!.maximum_percentage !== 100) add("Grade bands must cover 0 through 100.");
  if (new Set(sorted.map(band => band.code)).size !== sorted.length) add("Grade codes must be unique.");
  sorted.forEach((band, index) => {
    if (band.maximum_percentage < band.minimum_percentage) add("A grade band cannot end before it starts.");
    if (index && Math.round(band.minimum_percentage * 100) !== Math.round(sorted[index - 1]!.maximum_percentage * 100) + 1) add("Grade bands cannot overlap or leave gaps.");
    if (value.result_format === "gpa" && (band.grade_points === null || value.grade_point_scale === null || band.grade_points > value.grade_point_scale)) add("Every GPA grade needs points within the configured scale.");
    if (value.result_format !== "gpa" && band.grade_points !== null) add("Grade points belong to a GPA policy.");
  });
  if (value.result_format === "gpa" && value.grade_point_scale === null) context.addIssue({ code: "custom", path: ["grade_point_scale"], message: "Choose a grade point scale." });
  if (value.result_format === "gpa" && value.aggregation !== "credit_weighted") context.addIssue({ code: "custom", path: ["aggregation"], message: "GPA uses credit weighting." });
  if (value.result_format !== "gpa" && value.grade_point_scale !== null) context.addIssue({ code: "custom", path: ["grade_point_scale"], message: "Only GPA policies have a grade point scale." });
});

export type GradingPolicyConfiguration = z.infer<typeof gradingPolicyConfigurationSchema>;
export const gradingPolicySnapshotSchema = z.object({
  policy_id: z.string().uuid(), code: z.string(), name: z.string(), version: z.number().int().positive(),
  configuration: gradingPolicyConfigurationSchema,
  semantic_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((value, context) => {
  const configuration = gradingPolicyConfigurationSchema.safeParse(value.configuration);
  if (!configuration.success) return;
  if (policySemanticFingerprint(configuration.data) !== value.semantic_fingerprint) context.addIssue({ code: "custom", path: ["semantic_fingerprint"], message: "The grading policy snapshot does not match its calculation rules." });
});
// Kept as a named export for the assessment owner to validate frozen snapshots.
export const gradedPolicySnapshotSchema = gradingPolicySnapshotSchema;
export type GradingPolicySnapshot = z.infer<typeof gradingPolicySnapshotSchema>;

export function roundGradeValue(value: number, decimalPlaces = 2): number {
  if (!Number.isFinite(value) || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) throw new Error("Invalid grading value or precision.");
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * factor) / factor;
}

export function policySemanticFingerprint(configuration: GradingPolicyConfiguration): string {
  const canonical = gradingPolicyConfigurationSchema.parse(configuration);
  // Names and policy-version identities are not arithmetic. Grade labels and
  // display precision do not make otherwise identical cumulative scales unsafe.
  const semantics = { schema_version: canonical.schema_version, result_format: canonical.result_format,
    grade_point_scale: canonical.grade_point_scale, absence_treatment: canonical.absence_treatment,
    exemption_treatment: canonical.exemption_treatment, gpa_failure_treatment: canonical.gpa_failure_treatment,
    bands: [...canonical.bands].sort((a, b) => a.minimum_percentage - b.minimum_percentage).map(({ code, minimum_percentage, maximum_percentage, grade_points, passed }) => ({ code, minimum_percentage, maximum_percentage, grade_points, passed })) };
  return createHash("sha256").update(JSON.stringify(semantics)).digest("hex");
}

export function evaluatePolicyPercentage(configuration: GradingPolicyConfiguration, rawPercentage: number) {
  if (!Number.isFinite(rawPercentage) || rawPercentage < 0 || rawPercentage > 100) throw new Error("A scored percentage must be between 0 and 100.");
  const percentage = roundGradeValue(rawPercentage, 2);
  const band = configuration.bands.find(item => percentage >= item.minimum_percentage && percentage <= item.maximum_percentage);
  if (!band) throw new Error("The grading policy does not cover this result.");
  return { percentage, grade: band.code, grade_points: band.grade_points, passed: band.passed };
}

export interface GradingCreditCourse {
  course_code: string; credits: number; grade_points: number | null; passed: boolean | null;
  outcome: string; term_index: number; batch_id: string; report_student_id: string; report_subject_id: string;
  percentage: number | null;
}

export function calculateCreditGpa(configuration: GradingPolicyConfiguration, courses: GradingCreditCourse[]) {
  const included = courses.filter(course => course.outcome !== "exempt");
  const complete = included.length > 0 && included.every(course => course.outcome === "complete" && course.grade_points !== null && Number.isFinite(course.grade_points) && course.grade_points >= 0 && course.grade_points <= configuration.grade_point_scale! && Number.isFinite(course.credits) && course.credits > 0);
  const credits = included.reduce((total, course) => total + course.credits, 0);
  const points = included.reduce((total, course) => total + course.credits * (course.grade_points ?? 0), 0);
  const suppressed = configuration.gpa_failure_treatment === "withhold" && included.some(course => course.passed === false);
  return { gpa: complete && !suppressed ? roundGradeValue(points / credits, configuration.decimal_places) : null,
    credits: roundGradeValue(credits, 4), credit_points: complete ? roundGradeValue(points, 8) : null,
    unavailable_reason: !complete ? "incomplete_courses" : suppressed ? "failed_courses" : null };
}

/** A course's latest attempt replaces an earlier attempt, including a later
 * failed/incomplete attempt. Never improve CGPA by dropping failed credits. */
export function latestCourseAttempts(courses: GradingCreditCourse[]): GradingCreditCourse[] {
  const latest = new Map<string, GradingCreditCourse>();
  for (const course of courses) {
    const previous = latest.get(course.course_code);
    if (!previous || course.term_index > previous.term_index) latest.set(course.course_code, course);
    else if (course.term_index === previous.term_index && course.report_subject_id !== previous.report_subject_id) throw new Error(`Course ${course.course_code} has ambiguous attempts in one term.`);
  }
  return [...latest.values()].sort((a, b) => a.course_code.localeCompare(b.course_code));
}
