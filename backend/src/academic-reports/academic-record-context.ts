import { ConflictException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../database/types.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface AcademicRecordContext {
  schema_version: 1;
  class_section_id: string;
  class_name: string;
  term_id: string;
  term_name: string;
  academic_year: string;
  assessment_on?: string;
}
export interface AcademicEnrollmentSource {
  schema_version: 1;
  kind: "dated_enrollment" | "physical_candidate";
  enrollment_id: string;
  enrollment_revision: number;
  roll_number: number | null;
  as_of: string;
  candidate_id?: string;
  sitting_id?: string;
}
export interface DatedAcademicLearner {
  student_id: string;
  enrollment_id: string;
  enrollment_revision: number;
  roll_number: number | null;
  academic_roster_source: AcademicEnrollmentSource;
}

/** Same People interval as the canonical academic occurrence adapter: the end
 * date is exclusive. Today's active flag is not a historical eligibility test. */
export async function datedAcademicRoster(db: Db, schoolId: string, classId: string, termId: string, asOf: string): Promise<DatedAcademicLearner[]> {
  const rows = (await sql<Omit<DatedAcademicLearner, "academic_roster_source">>`
    SELECT enrollment.student_id,enrollment.id AS enrollment_id,enrollment.revision AS enrollment_revision,enrollment.roll_number
    FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${schoolId}::uuid
    JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
    JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=student.school_id
    WHERE enrollment.class_section_id=${classId}::uuid AND enrollment.term_id=${termId}::uuid
      AND ${asOf}::date BETWEEN term.starts_on AND term.ends_on
      AND enrollment.enrolled_on<=${asOf}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${asOf}::date)
    ORDER BY enrollment.roll_number NULLS LAST,enrollment.student_id,enrollment.id
  `.execute(db)).rows;
  const seen = new Set<string>();
  return rows.map(row => {
    if (seen.has(row.student_id)) throw new ConflictException("This assessment date has overlapping learner placements. Correct the enrollment history before opening marking.");
    seen.add(row.student_id);
    return { ...row, academic_roster_source: { schema_version: 1, kind: "dated_enrollment", enrollment_id: row.enrollment_id,
      enrollment_revision: row.enrollment_revision, roll_number: row.roll_number, as_of: asOf } };
  });
}

export async function captureAcademicContext(db: Db, schoolId: string, classId: string, termId: string): Promise<AcademicRecordContext> {
  const row = (await sql<Omit<AcademicRecordContext, "schema_version">>`SELECT section.id AS class_section_id,
      'Class '||section.grade||section.section AS class_name,term.id AS term_id,term.name AS term_name,term.academic_year
    FROM class_sections section JOIN academic_terms term ON term.school_id=section.school_id AND term.academic_year=section.academic_year
    WHERE section.school_id=${schoolId}::uuid AND section.id=${classId}::uuid AND term.id=${termId}::uuid
    FOR SHARE OF section,term`.execute(db)).rows[0];
  if (!row) throw new ConflictException("The academic class and term context is unavailable. Refresh before continuing.");
  return { schema_version: 1, ...row };
}

export function retainedAcademicContext(value: unknown): AcademicRecordContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<AcademicRecordContext>;
  return row.schema_version === 1 && typeof row.class_section_id === "string" && typeof row.class_name === "string"
    && typeof row.term_id === "string" && typeof row.term_name === "string" && typeof row.academic_year === "string"
    ? row as AcademicRecordContext : null;
}

export interface PublishedRosterSource {
  assessment_id: string;
  publication_id: string;
  scheduled_on: string | null;
  results: ReadonlyMap<string, { academic_roster_source: unknown }>;
}
export interface PublishedAcademicLearner {
  student_id: string;
  academic_roster_source: Record<string, unknown>;
}

/** Report membership comes from the selected immutable publications. A correction
 * retains the earlier report's audience; it is not a second class intake. */
export async function publishedAcademicRoster(db: Db, schoolId: string, schemeId: string, sources: readonly PublishedRosterSource[]): Promise<PublishedAcademicLearner[]> {
  const previous = await db.selectFrom("grading_report_batches").select("id").where("school_id", "=", schoolId)
    .where("scheme_id", "=", schemeId).orderBy("sequence", "desc").executeTakeFirst();
  if (previous) return (await db.selectFrom("grading_report_students").select(["student_id", "academic_roster_source"])
    .where("school_id", "=", schoolId).where("batch_id", "=", previous.id).orderBy("student_id").execute())
    .map(row => ({ student_id: row.student_id, academic_roster_source: row.academic_roster_source }));
  const ids = [...new Set(sources.flatMap(source => [...source.results.keys()]))].sort();
  return ids.map(studentId => {
    const evidence = sources.filter(source => source.results.has(studentId));
    const dated = evidence.filter(source => source.scheduled_on !== null).sort((a, b) => b.scheduled_on!.localeCompare(a.scheduled_on!));
    const latest = dated.filter(source => source.scheduled_on === dated[0]?.scheduled_on);
    const enrollmentSources = latest.map(source => source.results.get(studentId)!.academic_roster_source)
      .filter((source): source is AcademicEnrollmentSource => Boolean(source && typeof source === "object" && !Array.isArray(source)
        && (source as AcademicEnrollmentSource).schema_version === 1
        && ["dated_enrollment", "physical_candidate"].includes((source as AcademicEnrollmentSource).kind)
        && typeof (source as AcademicEnrollmentSource).enrollment_id === "string"
        && Number.isInteger((source as AcademicEnrollmentSource).enrollment_revision) && (source as AcademicEnrollmentSource).enrollment_revision > 0
        && typeof (source as AcademicEnrollmentSource).as_of === "string" && /^\d{4}-\d{2}-\d{2}$/u.test((source as AcademicEnrollmentSource).as_of)
        && ((source as AcademicEnrollmentSource).roll_number === null || Number.isInteger((source as AcademicEnrollmentSource).roll_number))));
    const unique = new Map(enrollmentSources.map(source => [JSON.stringify({ enrollment_id: source.enrollment_id,
      roll_number: source.roll_number, as_of: source.as_of }), source]));
    const resolved = enrollmentSources.length === latest.length && unique.size === 1 ? [...unique.values()][0]! : null;
    return { student_id: studentId, academic_roster_source: { schema_version: 1, kind: "published_assessments",
      source_refs: evidence.map(source => ({ assessment_id: source.assessment_id, publication_id: source.publication_id })),
      enrollment_source: resolved, roll_number: resolved?.roll_number ?? null,
      unavailable_reason: resolved ? null : unique.size > 1 ? "ambiguous_published_enrollment" : "historical_enrollment_not_recorded" } };
  });
}
