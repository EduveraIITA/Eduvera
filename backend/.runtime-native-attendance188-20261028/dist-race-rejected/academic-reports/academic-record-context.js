import { ConflictException } from "@nestjs/common";
import { sql } from "kysely";
/** Same People interval as the canonical academic occurrence adapter: the end
 * date is exclusive. Today's active flag is not a historical eligibility test. */
export async function datedAcademicRoster(db, schoolId, classId, termId, asOf) {
    const rows = (await sql `
    SELECT enrollment.student_id,enrollment.id AS enrollment_id,enrollment.revision AS enrollment_revision,enrollment.roll_number
    FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${schoolId}::uuid
    JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
    JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=student.school_id
    WHERE enrollment.class_section_id=${classId}::uuid AND enrollment.term_id=${termId}::uuid
      AND ${asOf}::date BETWEEN term.starts_on AND term.ends_on
      AND enrollment.enrolled_on<=${asOf}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${asOf}::date)
    ORDER BY enrollment.roll_number NULLS LAST,enrollment.student_id,enrollment.id
  `.execute(db)).rows;
    const seen = new Set();
    return rows.map(row => {
        if (seen.has(row.student_id))
            throw new ConflictException("This assessment date has overlapping learner placements. Correct the enrollment history before opening marking.");
        seen.add(row.student_id);
        return { ...row, academic_roster_source: { schema_version: 1, kind: "dated_enrollment", enrollment_id: row.enrollment_id,
                enrollment_revision: row.enrollment_revision, roll_number: row.roll_number, as_of: asOf } };
    });
}
export async function captureAcademicContext(db, schoolId, classId, termId) {
    const row = (await sql `SELECT section.id AS class_section_id,
      'Class '||section.grade||section.section AS class_name,term.id AS term_id,term.name AS term_name,term.academic_year
    FROM class_sections section JOIN academic_terms term ON term.school_id=section.school_id AND term.academic_year=section.academic_year
    WHERE section.school_id=${schoolId}::uuid AND section.id=${classId}::uuid AND term.id=${termId}::uuid
    FOR SHARE OF section,term`.execute(db)).rows[0];
    if (!row)
        throw new ConflictException("The academic class and term context is unavailable. Refresh before continuing.");
    return { schema_version: 1, ...row };
}
export function retainedAcademicContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const row = value;
    return row.schema_version === 1 && typeof row.class_section_id === "string" && typeof row.class_name === "string"
        && typeof row.term_id === "string" && typeof row.term_name === "string" && typeof row.academic_year === "string"
        ? row : null;
}
/** Report membership comes from the selected immutable publications. A correction
 * retains the earlier report's audience; it is not a second class intake. */
export async function publishedAcademicRoster(db, schoolId, schemeId, sources) {
    const previous = await db.selectFrom("grading_report_batches").select("id").where("school_id", "=", schoolId)
        .where("scheme_id", "=", schemeId).orderBy("sequence", "desc").executeTakeFirst();
    if (previous)
        return (await db.selectFrom("grading_report_students").select(["student_id", "academic_roster_source"])
            .where("school_id", "=", schoolId).where("batch_id", "=", previous.id).orderBy("student_id").execute())
            .map(row => ({ student_id: row.student_id, academic_roster_source: row.academic_roster_source }));
    const ids = [...new Set(sources.flatMap(source => [...source.results.keys()]))].sort();
    return ids.map(studentId => {
        const evidence = sources.filter(source => source.results.has(studentId));
        const dated = evidence.filter(source => source.scheduled_on !== null).sort((a, b) => b.scheduled_on.localeCompare(a.scheduled_on));
        const latest = dated.filter(source => source.scheduled_on === dated[0]?.scheduled_on);
        const enrollmentSources = latest.map(source => source.results.get(studentId).academic_roster_source)
            .filter((source) => Boolean(source && typeof source === "object" && !Array.isArray(source)
            && source.schema_version === 1
            && ["dated_enrollment", "physical_candidate"].includes(source.kind)
            && typeof source.enrollment_id === "string"
            && Number.isInteger(source.enrollment_revision) && source.enrollment_revision > 0
            && typeof source.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(source.as_of)
            && (source.roll_number === null || Number.isInteger(source.roll_number))));
        const unique = new Map(enrollmentSources.map(source => [JSON.stringify({ enrollment_id: source.enrollment_id,
                roll_number: source.roll_number, as_of: source.as_of }), source]));
        const resolved = enrollmentSources.length === latest.length && unique.size === 1 ? [...unique.values()][0] : null;
        return { student_id: studentId, academic_roster_source: { schema_version: 1, kind: "published_assessments",
                source_refs: evidence.map(source => ({ assessment_id: source.assessment_id, publication_id: source.publication_id })),
                enrollment_source: resolved, roll_number: resolved?.roll_number ?? null,
                unavailable_reason: resolved ? null : unique.size > 1 ? "ambiguous_published_enrollment" : "historical_enrollment_not_recorded" } };
    });
}
//# sourceMappingURL=academic-record-context.js.map