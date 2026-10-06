import { apiFetch } from "../../lib/api";

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
}

export interface AcademicReportReferences {
  terms: Array<{ id: string; name: string; academic_year: string; starts_on: string; ends_on: string }>;
  classes: Array<{ id: string; name: string; academic_year: string }>;
  subjects: Array<{ id: string; name: string; color: string; icon: string }>;
  assessments: Array<{ id: string; title: string; subject_id: string; class_section_id: string; term_id: string; maximum_marks: string; publication_sequence: number }>;
}

export type AcademicReportWorkspace =
  | { mode: "admin"; schemes: GradingSchemeSummary[]; batches: ReportBatchSummary[]; references: AcademicReportReferences }
  | { mode: "staff"; schemes: GradingSchemeSummary[]; batches: ReportBatchSummary[] };

export interface GradingSchemeDetail {
  scheme: GradingSchemeSummary;
  bands: Array<{ id: string; code: string; label: string; minimum_percentage: string; maximum_percentage: string; display_order: number }>;
  subjects: Array<{ id: string; subject_id: string; subject_name: string; color: string; icon: string; pass_percentage: string | null; display_order: number }>;
  components: Array<{ id: string; scheme_subject_id: string; code: string; name: string; weight_percentage: string; display_order: number; assessment_ids: string[]; assessment_titles: string[] }>;
}

export interface ReportBatchDetail {
  batch: ReportBatchSummary & { class_section_id: string; academic_year: string; review_note: string; publication_note: string };
  students: Array<{ id: string; student_id: string; first_name: string; last_name: string; admission_number: string; roll_number: number | null; outcome: "complete" | "incomplete" | "withheld"; overall_percentage: string | null; overall_grade: string; class_teacher_comment: string; principal_comment: string; comment_revision: number }>;
  subjects: Array<{ id: string; report_student_id: string; subject_name: string; color: string; icon: string; outcome: "complete" | "incomplete" | "exempt" | "withheld"; percentage: string | null; grade: string; passed: boolean | null }>;
  components: Array<{ id: string; report_subject_id: string; component_name: string; weight_percentage: string; outcome: "complete" | "incomplete" | "exempt"; percentage: string | null }>;
}

export interface FamilyReportCards {
  student: { id: string; first_name: string; last_name: string; admission_number: string; class_name: string | null };
  reports: Array<{ report_student_id: string; batch_id: string; sequence: number; published_at: string; correction_reason: string; scheme_id: string; scheme_name: string; term_name: string; academic_year: string; outcome: "complete" | "incomplete" | "withheld"; overall_percentage: string | null; overall_grade: string; class_teacher_comment: string; principal_comment: string; subjects: Array<{ id: string; subject_name: string; color: string; icon: string; outcome: string; percentage: string | null; grade: string; passed: boolean | null; assessment_ids?: string[] }> }>;
}

const root = (schoolId: string, path = "") => `/api/v1/schools/${encodeURIComponent(schoolId)}/academic-reports${path}`;

export const getAcademicReportWorkspace = (schoolId: string) => apiFetch<AcademicReportWorkspace>(root(schoolId, "/workspace/"));
export const getGradingScheme = (schoolId: string, schemeId: string) => apiFetch<GradingSchemeDetail>(root(schoolId, `/schemes/${schemeId}/`));
export const createGradingScheme = (schoolId: string, body: Record<string, unknown>) => apiFetch<GradingSchemeSummary>(root(schoolId, "/schemes/"), { method: "POST", body: JSON.stringify(body) });
export const saveGradingSubject = (schoolId: string, schemeId: string, body: Record<string, unknown>) => apiFetch<GradingSchemeSummary>(root(schoolId, `/schemes/${schemeId}/subjects/`), { method: "PUT", body: JSON.stringify(body) });
export const activateGradingScheme = (schoolId: string, schemeId: string, expectedRevision: number, note: string) => apiFetch<GradingSchemeSummary>(root(schoolId, `/schemes/${schemeId}/activate/`), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, note }) });
export const generateReportBatch = (schoolId: string, schemeId: string, expectedRevision: number, correctionReason: string) => apiFetch<ReportBatchSummary>(root(schoolId, `/schemes/${schemeId}/generate/`), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, correction_reason: correctionReason }) });
export const getReportBatch = (schoolId: string, batchId: string) => apiFetch<ReportBatchDetail>(root(schoolId, `/batches/${batchId}/`));
export const updateReportComments = (schoolId: string, batchId: string, studentId: string, body: Record<string, unknown>) => apiFetch(root(schoolId, `/batches/${batchId}/students/${studentId}/comments/`), { method: "PUT", body: JSON.stringify(body) });
export const reportBatchAction = (schoolId: string, batchId: string, action: string, expectedRevision: number, note: string) => apiFetch<ReportBatchSummary>(root(schoolId, `/batches/${batchId}/actions/${action}/`), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, note }) });
export const getFamilyReportCards = (schoolId: string, studentId: string) => apiFetch<FamilyReportCards>(`${root(schoolId, "/family/")}?student_id=${encodeURIComponent(studentId)}`);
