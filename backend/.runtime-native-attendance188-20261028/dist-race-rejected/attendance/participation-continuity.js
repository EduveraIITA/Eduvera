import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
/** Lock the authoritative row, never a UNION compatibility projection. */
export async function findAcademicAttendanceDecision(db, input) {
    const current = (await sql `SELECT entry.id,person.student_id,entry.school_id,
      (link.context_snapshot->'context'->>'class_id')::uuid AS class_section_id,
      link.context_snapshot->'context'->>'date' AS date,entry.status,entry.revision,'participation'::text AS store
    FROM activity_attendance_source_contexts link
    JOIN activity_attendance_academic_roster person ON person.register_id=link.register_id AND person.school_id=link.school_id
    JOIN activity_attendance_entries entry ON entry.register_id=person.register_id AND entry.person_id=person.person_id
    WHERE link.school_id=${input.school_id}::uuid AND link.source_kind='daily_class' AND link.state='active'
      AND person.student_id=${input.student_id}::uuid AND link.context_snapshot->'context'->>'date'=${input.date}
      AND (${input.record_id ?? null}::uuid IS NULL OR entry.id=${input.record_id ?? null}::uuid)
    FOR UPDATE OF entry`.execute(db)).rows[0];
    if (current)
        return current;
    const archive = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'attendance_records_legacy_source')) IS NOT NULL AS ready`.execute(db)).rows[0]?.ready;
    return (await sql `SELECT record.id,record.student_id,student.school_id,
      record.class_section_id,record.date::text,record.status,record.revision,'legacy'::text AS store
    FROM ${sql.table(archive ? "attendance_records_legacy_source" : "attendance_records")} record JOIN students student ON student.id=record.student_id
    WHERE student.school_id=${input.school_id}::uuid AND record.student_id=${input.student_id}::uuid AND record.date=${input.date}::date
      AND (${input.record_id ?? null}::uuid IS NULL OR record.id=${input.record_id ?? null}::uuid)
      AND NOT EXISTS(SELECT 1 FROM activity_attendance_source_contexts link WHERE link.school_id=student.school_id
        AND link.state='active' AND link.source_kind='daily_class'
        AND link.context_snapshot->'context'->>'class_id'=record.class_section_id::text
        AND link.context_snapshot->'context'->>'date'=record.date::text)
    FOR UPDATE OF record`.execute(db)).rows[0] ?? null;
}
/** Owning-domain linkage only. A retained photo remains a proposal, not presence. */
export async function findAcademicParticipationRegister(db, input) {
    return (await sql `SELECT link.register_id FROM activity_attendance_source_contexts link
    WHERE link.school_id=${input.school_id}::uuid AND link.state='active'
      AND link.source_kind=${input.attendance_session_id ? "scheduled_session" : "daily_class"}
      AND link.context_snapshot->'context'->>'class_id'=${input.class_section_id}
      AND link.context_snapshot->'context'->>'term_id'=${input.term_id}
      AND link.context_snapshot->'context'->>'date'=${input.date}
      AND (${input.attendance_session_id ?? null}::uuid IS NULL
        OR link.source_id=${input.attendance_session_id ?? null})`.execute(db)).rows[0] ?? null;
}
export async function validateParticipationPhoto(db, input) {
    const photo = (await sql `SELECT photo.id,photo.observed_at,photo.analysis_summary,
      photo.state,photo.expires_at,photo.participation_register_id FROM photo_attendance_sessions photo
    JOIN activity_attendance_source_contexts link ON link.register_id=${input.register_id}::uuid AND link.school_id=photo.school_id
      AND link.state='active' AND link.source_kind=${input.attendance_session_id ? "scheduled_session" : "daily_class"}
      AND link.context_snapshot->'context'->>'class_id'=photo.class_section_id::text
      AND link.context_snapshot->'context'->>'term_id'=photo.term_id::text
      AND link.context_snapshot->'context'->>'date'=photo.date::text
    WHERE photo.id=${input.photo_session_id}::uuid AND photo.school_id=${input.school_id}::uuid
      AND photo.class_section_id=${input.class_section_id}::uuid AND photo.date=${input.date}::date
      AND photo.attendance_session_id IS NOT DISTINCT FROM ${input.attendance_session_id ?? null}::uuid
      AND (${input.attendance_session_id ?? null}::uuid IS NULL OR link.source_id=${input.attendance_session_id ?? null})
    FOR UPDATE OF photo`.execute(db)).rows[0];
    if (!photo || (photo.participation_register_id && photo.participation_register_id !== input.register_id)) {
        throw new BadRequestException("The selected photo analysis does not belong to this exact attendance register.");
    }
    const authorized = (await sql `SELECT EXISTS(
    SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=${input.actor_id}::uuid
        AND membership.is_active AND (membership.role='admin' OR (membership.role='staff'
          AND staff_has_class_permission(membership.school_id,membership.user_id,'photo.use',${input.class_section_id}::uuid,${input.date}::date)))
    ) AS allowed`.execute(db)).rows[0]?.allowed;
    if (!authorized)
        throw new ForbiddenException("Your current assignment does not allow photo attendance for this class.");
    if (new Date(photo.expires_at).getTime() <= executionNow().getTime()) {
        throw new ConflictException("The photo analysis expired. Capture a new photo or continue manually.");
    }
    if (photo.state !== "analyzed")
        throw new ConflictException("This photo analysis has already been applied or discarded.");
    const summary = photo.analysis_summary;
    const matched = Array.isArray(summary?.matched_student_ids)
        ? [...new Set(summary.matched_student_ids.filter((id) => typeof id === "string"))] : [];
    return { id: photo.id, observed_at: new Date(photo.observed_at), matched_student_ids: matched,
        evidence_ref: `photo_attendance_session:${photo.id}` };
}
/** Caller holds the artifact lock and the shared attendance command transaction. */
export async function completeParticipationPhoto(db, artifactId, commandId, registerId) {
    const now = executionNow();
    const updated = (await sql `UPDATE photo_attendance_sessions
    SET state='applied',applied_at=${now},participation_register_id=${registerId}::uuid,
      applied_participation_command_id=${commandId}::uuid,updated_at=${now}
    WHERE id=${artifactId}::uuid AND state='analyzed' RETURNING id`.execute(db)).rows[0];
    if (!updated)
        throw new ConflictException("This photo analysis was applied or discarded by another action.");
}
export async function findParticipationAcceptance(db, schoolId, actorId, key) {
    return (await sql `
    SELECT command.id,command.register_id,command.register_revision,command.result_body FROM activity_attendance_commands command
    JOIN activity_attendance_source_contexts link ON link.register_id=command.register_id AND link.school_id=command.school_id
      AND link.state='active' AND link.source_kind='daily_class'
    WHERE command.school_id=${schoolId}::uuid AND command.actor_id=${actorId}::uuid
      AND command.idempotency_key=${key} AND command.operation IN ('marks','submit')`.execute(db)).rows[0] ?? null;
}
/** The capture owns its response snapshot; immutable shared command results are not rewritten. */
export async function completeParticipationCapture(db, input) {
    const now = executionNow();
    const updated = (await sql `UPDATE attendance_capture_batches
    SET status='accepted',participation_register_id=${input.register_id}::uuid,
      accepted_participation_command_id=${input.command_id}::uuid,accepted_result_body=${JSON.stringify(input.result_body)}::jsonb,
      accepted_at=${now},resolved_by=COALESCE(${input.resolved_by ?? null}::uuid,resolved_by),
      resolved_at=CASE WHEN ${input.resolved_by ?? null}::uuid IS NOT NULL THEN ${now} ELSE resolved_at END,
      resolution_note=COALESCE(${input.resolution_note ?? null},resolution_note),updated_at=${now}
    WHERE id=${input.batch_id}::uuid AND status IN ('pending','quarantined') RETURNING id`.execute(db)).rows[0];
    if (!updated)
        throw new ConflictException("This attendance capture was already accepted or rejected. Refresh its latest result.");
}
//# sourceMappingURL=participation-continuity.js.map