import { ConflictException } from "@nestjs/common";
/**
 * Attendance remains authoritative in its domain tables. This adapter only
 * records the accepted (or explicitly pending) evidence envelope used by the
 * Campus Model projections, in the caller's domain transaction.
 */
export async function recordAttendanceModelObservations(input) {
    if (!input.records.length)
        return [];
    if (!input.ingress)
        throw new ConflictException("The attendance evidence bridge is unavailable.");
    const studentIds = [...new Set(input.records.map((record) => record.studentId))];
    const [studentRows, classRow] = await Promise.all([
        input.transaction.selectFrom("students as student")
            .innerJoin("school_people as person", "person.id", "student.person_id")
            .select([
            "student.id",
            "student.admission_number",
            "person.first_name",
            "person.last_name",
            "person.revision as person_revision",
        ])
            .where("student.school_id", "=", input.schoolId)
            .where("student.id", "in", studentIds)
            .execute(),
        input.transaction.selectFrom("class_sections")
            .select(["id", "grade", "section", "revision"])
            .where("school_id", "=", input.schoolId)
            .where("id", "=", input.classSectionId)
            .executeTakeFirst(),
    ]);
    if (!classRow || studentRows.length !== studentIds.length) {
        throw new ConflictException("The attendance evidence could not be connected to the campus model.");
    }
    const students = new Map(studentRows.map((student) => [student.id, student]));
    return input.ingress.recordObservations(input.transaction, input.records.map((record) => {
        const student = students.get(record.studentId);
        if (!student)
            throw new ConflictException("The attendance student could not be connected to the campus model.");
        return {
            school_id: input.schoolId,
            actor_user_id: input.actorUserId,
            kind: "attendance.status_observed",
            subject: {
                kind: "student",
                domain: "people",
                domain_id: student.id,
                label: `${student.first_name} ${student.last_name}`.trim() || student.admission_number,
                lifecycle_state: "active",
                source_revision: student.person_revision,
                metadata: { admission_number: student.admission_number },
            },
            context: {
                kind: "class",
                domain: "academic_structure",
                domain_id: classRow.id,
                label: `Class ${classRow.grade}${classRow.section}`,
                lifecycle_state: "active",
                source_revision: classRow.revision,
                metadata: {},
            },
            source_type: input.sourceType,
            source_ref: input.sourceRef,
            source_record_id: record.sourceRecordId,
            observed_at: record.observedAt.toISOString(),
            received_at: input.receivedAt.toISOString(),
            evidence_refs: record.evidenceRefs,
            payload: {
                ...(input.state === "accepted"
                    ? { attendance_status: record.status }
                    : { claimed_attendance_status: record.status }),
                attendance_date: input.date,
                class_section_id: input.classSectionId,
                ...(input.sessionId ? { session_id: input.sessionId } : {}),
                participation_scope: input.participationScope,
                evidence_scope: "attendance_participation_only",
                capture_source: record.captureSource,
                decision_provenance: record.decisionProvenance,
            },
            schema_version: 1,
            state: input.state,
            idempotency_key: `attendance-model:${input.sourceType}:${record.sourceRecordId}`,
            domain_event_id: record.domainEventId,
            contract_refs: {
                subject_type: { namespace: "thatcampus.people", type_key: "student", version: 1 },
                context_type: { namespace: "thatcampus.academic_structure", type_key: "class", version: 1 },
                observation_schema: {
                    namespace: "thatcampus.attendance",
                    schema_key: "attendance.status_observed",
                    version: 1,
                },
                capability_manifest: {
                    namespace: "thatcampus.attendance",
                    capability_key: "attendance",
                    version: 1,
                },
            },
        };
    }));
}
//# sourceMappingURL=attendance-model-observation.js.map