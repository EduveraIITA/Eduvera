import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { blockExecutionRequests, confirmExecutionRequestScope } from "../../lib/executionRequestScope";
import { activateGradingPolicy, createGradingScheme, generateReportBatch, reportBatchAction, updateReportComments } from "./api";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
function commandBody(index: number) {
  const body = vi.mocked(apiFetch).mock.calls[index]?.[1]?.body;
  if (typeof body !== "string") throw new Error("A JSON command was expected.");
  return JSON.parse(body) as { idempotency_key: string };
}

describe("grading command response-loss recovery", () => {
  it("pins remark saves to both learner and batch revisions", async () => {
    vi.mocked(apiFetch).mockReset().mockResolvedValue({ batch_revision: 8, comment_revision: 4 });
    await updateReportComments("school-1", "batch-1", "student-1", { expected_revision: 3, expected_batch_revision: 7, class_teacher_comment: "Reviewed remark", principal_comment: "" });
    expect(vi.mocked(apiFetch).mock.calls[0]).toEqual(["/api/v1/schools/school-1/academic-reports/batches/batch-1/students/student-1/comments/", { method: "PUT", body: JSON.stringify({ expected_revision: 3, expected_batch_revision: 7, class_teacher_comment: "Reviewed remark", principal_comment: "" }) }]);
  });
  it("reuses an uncertain create key, clears it after success, and gives changed payloads a different key", async () => {
    confirmExecutionRequestScope("live:retry-campus");
    vi.mocked(apiFetch).mockReset().mockRejectedValueOnce(new Error("Response interrupted")).mockResolvedValue({ id: "scheme-1" });
    const payload = { name: "Semester I", grading_policy_id: "policy-1" };
    await expect(createGradingScheme("retry-campus", payload)).rejects.toThrow("Response interrupted");
    await createGradingScheme("retry-campus", payload);
    expect(commandBody(1).idempotency_key).toBe(commandBody(0).idempotency_key);
    await createGradingScheme("retry-campus", payload);
    expect(commandBody(2).idempotency_key).not.toBe(commandBody(0).idempotency_key);
    await createGradingScheme("retry-campus", { ...payload, name: "Semester II" });
    expect(commandBody(3).idempotency_key).not.toBe(commandBody(2).idempotency_key);
  });

  it("partitions uncertain retries when the authenticated session or selected world is reconfirmed", async () => {
    vi.mocked(apiFetch).mockReset().mockRejectedValue(new Error("Response interrupted"));
    confirmExecutionRequestScope("live:scope-campus");
    await expect(activateGradingPolicy("scope-campus", "policy-1", 2, "Reviewed")).rejects.toThrow();
    blockExecutionRequests();
    confirmExecutionRequestScope("live:scope-campus");
    await expect(activateGradingPolicy("scope-campus", "policy-1", 2, "Reviewed")).rejects.toThrow();
    expect(commandBody(1).idempotency_key).not.toBe(commandBody(0).idempotency_key);
    confirmExecutionRequestScope("scenario:scope-campus:isolated-run");
    await expect(activateGradingPolicy("scope-campus", "policy-1", 2, "Reviewed")).rejects.toThrow();
    expect(commandBody(2).idempotency_key).not.toBe(commandBody(1).idempotency_key);
  });

  it("keeps generation and publication retries stable without sharing keys between actions", async () => {
    confirmExecutionRequestScope("live:release-campus");
    vi.mocked(apiFetch).mockReset().mockRejectedValue(new Error("Response interrupted"));
    await expect(generateReportBatch("release-campus", "scheme-1", 2, "")).rejects.toThrow();
    await expect(generateReportBatch("release-campus", "scheme-1", 2, "")).rejects.toThrow();
    expect(commandBody(1).idempotency_key).toBe(commandBody(0).idempotency_key);
    await expect(reportBatchAction("release-campus", "batch-1", "review", 1, "Reviewed")).rejects.toThrow();
    await expect(reportBatchAction("release-campus", "batch-1", "publish", 2, "Reviewed")).rejects.toThrow();
    expect(commandBody(2).idempotency_key).not.toBe(commandBody(0).idempotency_key);
    expect(commandBody(3).idempotency_key).not.toBe(commandBody(2).idempotency_key);
  });
});
