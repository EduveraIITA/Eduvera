import { ConflictException } from "@nestjs/common";
import { evaluatePolicyPercentage, gradedPolicySnapshotSchema, policySemanticFingerprint } from "../academic-reports/grading-policy.js";
/** Marks remain the evidence. A policy derives a grade/points, never the reverse. */
export function assessmentGrading(snapshot, marks, maximumMarks) {
    if (snapshot === null || snapshot === undefined)
        return null;
    const parsed = gradedPolicySnapshotSchema.safeParse(snapshot);
    if (!parsed.success || parsed.data.semantic_fingerprint !== policySemanticFingerprint(parsed.data.configuration)) {
        throw new ConflictException("This assessment's grading policy cannot be verified. Recover its policy before recording or publishing results.");
    }
    if (marks === null)
        return { policy: parsed.data, result: null };
    if (!Number.isFinite(marks) || !Number.isFinite(maximumMarks) || maximumMarks <= 0 || marks < 0 || marks > maximumMarks) {
        throw new ConflictException("This assessment's marks cannot be evaluated against its grading policy.");
    }
    return { policy: parsed.data, result: evaluatePolicyPercentage(parsed.data.configuration, marks / maximumMarks * 100) };
}
//# sourceMappingURL=assessment-grading.js.map