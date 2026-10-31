import type { GradingPolicyConfiguration, GradingPolicy, GradingSchemeSummary, ReportBatchSummary, AcademicReportWorkspace, GradingSchemeDetail, ReportBatchDetail, FamilyReportCards, ReportCommentUpdate } from "../../../../packages/contracts/src/academic-reports";
export type { GradingPolicyConfiguration, GradingPolicy, ResultPolicySnapshot, ReportCalculation, GradingSchemeSummary, ReportBatchSummary, AcademicReportReferences, AcademicReportWorkspace, GradingSchemeDetail, ReportBatchDetail, FamilyReportCards, ReportCommentUpdate } from "../../../../packages/contracts/src/academic-reports";
import { apiFetch } from "../../lib/api";
import { executionRequestIdentity } from "../../lib/executionRequestScope";

const root = (schoolId: string, path = "") => `/api/v1/schools/${encodeURIComponent(schoolId)}/academic-reports${path}`;

// A lost response must not create a second policy version or report release.
// This bounded, memory-only retry cache is partitioned by the confirmed request
// epoch. apiFetch still enforces session, institution and selected-world scope.
const pendingCommandKeys = new Map<string, string>();
async function reportCommand<T>(path: string, body: Record<string, unknown>) {
  const request = `${executionRequestIdentity()}:${path}:${JSON.stringify(body)}`;
  const idempotencyKey = pendingCommandKeys.get(request) ?? crypto.randomUUID();
  pendingCommandKeys.delete(request);
  pendingCommandKeys.set(request, idempotencyKey);
  while (pendingCommandKeys.size > 200) pendingCommandKeys.delete(pendingCommandKeys.keys().next().value!);
  const result = await apiFetch<T>(path, { method: "POST", body: JSON.stringify({ ...body, idempotency_key: idempotencyKey }) });
  if (pendingCommandKeys.get(request) === idempotencyKey) pendingCommandKeys.delete(request);
  return result;
}

export const getGradingPolicies = (schoolId: string) => apiFetch<{ policies: GradingPolicy[] }>(root(schoolId, "/policies/"));
export const createGradingPolicy = (schoolId: string, body: { name: string; code: string; configuration: GradingPolicyConfiguration }) => reportCommand<GradingPolicy>(root(schoolId, "/policies/"), body);
export const activateGradingPolicy = (schoolId: string, policyId: string, expectedRevision: number, note: string) => reportCommand<GradingPolicy>(root(schoolId, `/policies/${policyId}/activate/`), { expected_revision: expectedRevision, note });
export const getAcademicReportWorkspace = (schoolId: string) => apiFetch<AcademicReportWorkspace>(root(schoolId, "/workspace/"));
export const getGradingScheme = (schoolId: string, schemeId: string) => apiFetch<GradingSchemeDetail>(root(schoolId, `/schemes/${schemeId}/`));
export const createGradingScheme = (schoolId: string, body: Record<string, unknown>) => reportCommand<GradingSchemeSummary>(root(schoolId, "/schemes/"), body);
export const saveGradingSubject = (schoolId: string, schemeId: string, body: Record<string, unknown>) => apiFetch<GradingSchemeSummary>(root(schoolId, `/schemes/${schemeId}/subjects/`), { method: "PUT", body: JSON.stringify(body) });
export const activateGradingScheme = (schoolId: string, schemeId: string, expectedRevision: number, note: string) => reportCommand<GradingSchemeSummary>(root(schoolId, `/schemes/${schemeId}/activate/`), { expected_revision: expectedRevision, note });
export const generateReportBatch = (schoolId: string, schemeId: string, expectedRevision: number, correctionReason: string) => reportCommand<ReportBatchSummary>(root(schoolId, `/schemes/${schemeId}/generate/`), { expected_revision: expectedRevision, correction_reason: correctionReason });
export const getReportBatch = (schoolId: string, batchId: string) => apiFetch<ReportBatchDetail>(root(schoolId, `/batches/${batchId}/`));
export const updateReportComments = (schoolId: string, batchId: string, studentId: string, body: { expected_revision: number; expected_batch_revision: number; class_teacher_comment: string; principal_comment: string }) => apiFetch<ReportCommentUpdate>(root(schoolId, `/batches/${batchId}/students/${studentId}/comments/`), { method: "PUT", body: JSON.stringify(body) });
export const reportBatchAction = (schoolId: string, batchId: string, action: string, expectedRevision: number, note: string) => reportCommand<ReportBatchSummary>(root(schoolId, `/batches/${batchId}/actions/${action}/`), { expected_revision: expectedRevision, note });
export const getFamilyReportCards = (schoolId: string, studentId: string) => apiFetch<FamilyReportCards>(`${root(schoolId, "/family/")}?student_id=${encodeURIComponent(studentId)}`);
