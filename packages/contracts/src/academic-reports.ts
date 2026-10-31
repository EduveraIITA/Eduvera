export interface GradingPolicyConfiguration {
  schema_version: 1;
  result_format: "percentage" | "grade" | "gpa";
  grade_point_scale: number | null;
  decimal_places: number;
  aggregation: "equal" | "credit_weighted";
  absence_treatment: "incomplete" | "zero";
  exemption_treatment: "exclude";
  gpa_failure_treatment: "include" | "withhold";
  bands: Array<{ code: string; label: string; minimum_percentage: number; maximum_percentage: number; grade_points: number | null; passed: boolean }>;
}

export interface GradingPolicy {
  id: string;
  name: string;
  code: string;
  version: number;
  status: "draft" | "active";
  revision: number;
  configuration: GradingPolicyConfiguration;
}

export interface ResultPolicySnapshot {
  policy_id: string;
  name: string;
  code: string;
  version: number;
  configuration: GradingPolicyConfiguration;
  semantic_fingerprint: string;
}

export interface ReportCalculation {
  result_policy?: ResultPolicySnapshot | null;
  gpa?: string | null;
  gpa_unavailable_reason?: "incomplete_courses" | "failed_courses" | null;
  cgpa?: string | null;
  credit_total?: string | null;
  credit_points?: string | null;
  cumulative_credits?: string | null;
  cumulative_credit_points?: string | null;
  cgpa_unavailable_reason?: "missing_prior_terms" | "incompatible_policy" | "incomplete_courses" | "failed_courses" | "ambiguous_prior_terms" | "ambiguous_course_attempts" | null;
  cumulative_sources?: Array<{ course_code: string; credits: number; grade_points: number | null; passed: boolean | null; outcome: string; term_index: number; batch_id: string; report_student_id: string; report_subject_id: string; percentage: number | null; included: boolean; reason: "latest_attempt" | "superseded_attempt" }>;
}

export interface GradingSchemeSummary {
  id: string;
  term_id: string;
  class_section_id: string;
  name: string;
  code: string;
  status: "draft" | "active" | "archived";
  absence_treatment: "incomplete" | "zero";
  review_mode: "owner_review" | "independent";
  revision: number;
  term_name: string;
  academic_year: string;
  class_name: string;
  subject_count: number;
  report_count: number;
  grading_policy_id?: string | null;
  result_policy?: ResultPolicySnapshot | null;
  programme_key?: string | null;
  term_index?: number | null;
}

export interface ReportBatchSummary {
  id: string;
  scheme_id: string;
  scheme_name: string;
  class_name: string;
  term_name: string;
  review_mode: "owner_review" | "independent";
  sequence: number;
  status: "draft" | "reviewed" | "published" | "cancelled";
  revision: number;
  correction_reason: string;
  generated_at: string;
  published_at: string | null;
  learner_count: number;
  incomplete_count: number;
  result_policy?: ResultPolicySnapshot | null;
  programme_key?: string | null;
  term_index?: number | null;
}

export interface AcademicReportReferences {
  terms: Array<{ id: string; name: string; academic_year: string; starts_on: string; ends_on: string }>;
  classes: Array<{ id: string; name: string; academic_year: string }>;
  subjects: Array<{ id: string; name: string; color: string; icon: string }>;
  assessments: Array<{ id: string; title: string; subject_id: string; class_section_id: string; term_id: string; maximum_marks: string; publication_sequence: number }>;
}

export type AcademicReportWorkspace =
  | { mode: "admin"; schemes: GradingSchemeSummary[]; batches: ReportBatchSummary[]; references: AcademicReportReferences; policies?: GradingPolicy[] }
  | { mode: "staff"; schemes: GradingSchemeSummary[]; batches: ReportBatchSummary[]; policies?: GradingPolicy[] };

export interface GradingSchemeDetail {
  scheme: GradingSchemeSummary;
  bands: Array<{ id: string; code: string; label: string; minimum_percentage: string; maximum_percentage: string; display_order: number }>;
  subjects: Array<{ id: string; subject_id: string; subject_name: string; color: string; icon: string; pass_percentage: string | null; display_order: number; credits?: string | null; course_code?: string | null }>;
  components: Array<{ id: string; scheme_subject_id: string; code: string; name: string; weight_percentage: string; display_order: number; assessment_ids: string[]; assessment_titles: string[] }>;
}

export interface ReportBatchDetail {
  batch: ReportBatchSummary & { class_section_id: string; academic_year: string; review_note: string; publication_note: string };
  students: Array<ReportCalculation & { id: string; student_id: string; first_name: string; last_name: string; admission_number: string; roll_number: number | null; outcome: "complete" | "incomplete" | "withheld"; overall_percentage: string | null; overall_grade: string; class_teacher_comment: string; principal_comment: string; comment_revision: number }>;
  subjects: Array<{ id: string; report_student_id: string; subject_name: string; color: string; icon: string; outcome: "complete" | "incomplete" | "exempt" | "withheld"; percentage: string | null; grade: string; passed: boolean | null; grade_points?: string | null; credits?: string | null; course_code?: string | null }>;
  components: Array<{ id: string; report_subject_id: string; component_name: string; weight_percentage: string; outcome: "complete" | "incomplete" | "exempt"; percentage: string | null }>;
}

export interface FamilyReportCards {
  student: { id: string; first_name: string; last_name: string; admission_number: string; class_name: string | null };
  reports: Array<ReportCalculation & { report_student_id: string; batch_id: string; sequence: number; published_at: string; correction_reason: string; scheme_id: string; scheme_name: string; term_name: string; academic_year: string; class_name?: string | null; outcome: "complete" | "incomplete" | "withheld"; overall_percentage: string | null; overall_grade: string; class_teacher_comment: string; principal_comment: string; subjects: Array<{ id: string; subject_name: string; color: string; icon: string; outcome: string; percentage: string | null; grade: string; passed: boolean | null; assessment_ids?: string[]; grade_points?: string | null; credits?: string | null; course_code?: string | null }> }>;
}

export interface ReportCommentUpdate {
  id: string;
  student_id: string;
  class_teacher_comment: string;
  principal_comment: string;
  comment_revision: number;
  batch_revision: number;
}
