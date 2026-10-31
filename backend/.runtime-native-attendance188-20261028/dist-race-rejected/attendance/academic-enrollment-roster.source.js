import { ConflictException, ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
const sourceSchema = z.object({ kind: z.enum(["intake", "import", "lifecycle"]), review_id: z.string().uuid(), command_id: z.string().uuid() }).strict();
/** The owning People transaction has already written the reviewed enrollment.
 * This proof is deliberately not an HTTP flag or a cached permission receipt. */
export async function authorizedEnrollmentRosterSource(tx, identities, verifier, user, schoolId, rawSource, phase = "accepted") {
    const source = sourceSchema.parse(rawSource);
    await institutionSchoolPermission(tx, user, schoolId, "sis.manage", true);
    const actor = await identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting)
        throw new ForbiddenException("A current campus identity is required to reconcile enrollment expectations.");
    const expectedType = source.kind === "intake" ? ["people.learner.intake", "people.learner.attach"]
        : source.kind === "import" ? ["people.enrollment.import"] : ["people.enrollment.move_class", "people.enrollment.withdraw", "people.enrollment.transfer_out"];
    const command = await verifier.verifyPreparedDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id, command_id: source.command_id,
        correlation_id: source.review_id, source_domain: "people", required_capability: "people:manage", allowed_command_types: expectedType });
    if (command.safe_context.source_ref !== source.review_id && command.safe_context.review_id !== source.review_id) {
        throw new ConflictException("The prepared command does not reference this exact People review.");
    }
    const preparedTargets = z.array(z.object({ class_id: z.string().uuid(), term_id: z.string().uuid(), effective_on: z.iso.date() }).strict()).min(1)
        .parse(command.safe_context.enrollment_roster_targets);
    const preparedSource = (await sql `SELECT 1 FROM people_intakes review WHERE ${source.kind}='intake' AND review.id=${source.review_id}::uuid
      AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid
    UNION ALL SELECT 1 FROM people_imports review WHERE ${source.kind}='import' AND review.id=${source.review_id}::uuid
      AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid AND review.state='draft'
    UNION ALL SELECT 1 FROM student_enrollment_change_reviews review WHERE ${source.kind}='lifecycle' AND review.id=${source.review_id}::uuid
      AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid`.execute(tx)).rows;
    if (!preparedSource.length || !expectedType.includes(command.command_type))
        throw new ConflictException("The prepared command does not match this current People review.");
    if (phase === "prepare")
        return { source, targets: preparedTargets, decision_source: { kind: "reviewed_enrollment_roster_change", source_kind: source.kind,
                review_id: source.review_id, source_command_id: source.command_id, school_id: schoolId, actor_user_id: user.id } };
    let targets;
    if (source.kind === "intake") {
        if (!["people.learner.intake", "people.learner.attach"].includes(command.command_type))
            throw new ConflictException("The prepared command is not this enrollment intake.");
        targets = (await sql `SELECT enrollment.class_section_id AS class_id,enrollment.term_id,enrollment.enrolled_on::text AS effective_on
      FROM people_intakes review JOIN students student ON student.id=review.committed_student_id AND student.school_id=review.school_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
        AND enrollment.class_section_id=(review.input->>'class_section_id')::uuid AND enrollment.term_id=(review.input->>'term_id')::uuid
        AND enrollment.enrolled_on=(review.input->>'enrolled_on')::date
      WHERE review.id=${source.review_id}::uuid AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid
      FOR SHARE OF review,student,enrollment`.execute(tx)).rows;
    }
    else if (source.kind === "import") {
        if (command.command_type !== "people.enrollment.import")
            throw new ConflictException("The prepared command is not this enrollment import.");
        targets = (await sql `SELECT enrollment.class_section_id AS class_id,enrollment.term_id,min(enrollment.enrolled_on)::text AS effective_on
      FROM people_imports review JOIN people_import_rows row ON row.import_id=review.id AND row.school_id=review.school_id
        AND row.decision='include' AND row.student_id IS NOT NULL
      JOIN students student ON student.id=row.student_id AND student.school_id=review.school_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.term_id=review.term_id AND enrollment.is_active
      WHERE review.id=${source.review_id}::uuid AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid AND review.state='draft'
      GROUP BY enrollment.class_section_id,enrollment.term_id`.execute(tx)).rows;
    }
    else {
        targets = (await sql `SELECT DISTINCT scope.class_id,previous.term_id,(review.input->>'effective_on') AS effective_on
      FROM student_enrollment_change_reviews review
      JOIN enrollments previous ON previous.id=review.expected_enrollment_id AND previous.student_id=review.student_id
        AND NOT previous.is_active AND previous.revision=review.expected_revision+1
        AND previous.inactive_from=(review.input->>'effective_on')::date AND previous.ended_by=${user.id}::uuid
      JOIN students student ON student.id=previous.student_id AND student.school_id=review.school_id
      CROSS JOIN LATERAL(SELECT previous.class_section_id AS class_id UNION SELECT resulting.class_section_id
        FROM enrollments resulting WHERE resulting.id=review.result_enrollment_id AND resulting.student_id=review.student_id
          AND resulting.term_id=previous.term_id AND resulting.is_active AND resulting.enrolled_on=previous.inactive_from) scope
      WHERE review.id=${source.review_id}::uuid AND review.school_id=${schoolId}::uuid AND review.created_by=${user.id}::uuid
        AND review.committed_at IS NOT NULL AND ${command.command_type}='people.enrollment.'||review.action`.execute(tx)).rows;
    }
    if (!targets.length)
        throw new ConflictException("The reviewed enrollment change has no matching accepted enrollment source.");
    const scopeKey = (target) => `${target.class_id}:${target.term_id}:${target.effective_on}`;
    if (JSON.stringify(targets.map(scopeKey).sort()) !== JSON.stringify(preparedTargets.map(scopeKey).sort())) {
        throw new ConflictException("The accepted enrollment scope differs from its prepared People command.");
    }
    return { source, targets, decision_source: { kind: "reviewed_enrollment_roster_change", source_kind: source.kind,
            review_id: source.review_id, source_command_id: source.command_id, school_id: schoolId, actor_user_id: user.id } };
}
//# sourceMappingURL=academic-enrollment-roster.source.js.map