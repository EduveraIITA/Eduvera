import { ConflictException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { offeringAcademicContext } from "../learning/learning-offering-academic.js";

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

export function retainedAcademicContext(value: unknown): AcademicRecordContext | Awaited<ReturnType<typeof captureOfferingAcademicContext>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.term_id !== "string" || typeof row.term_name !== "string" || typeof row.academic_year !== "string" || typeof row.class_name !== "string") return null;
  if (row.schema_version === 1 && typeof row.class_section_id === "string") return value as AcademicRecordContext;
  if (row.schema_version === 2 && row.context_kind === "learning_offering" && row.class_section_id === null
    && typeof row.offering_id === "string" && typeof row.offering_name === "string" && typeof row.offering_revision === "number"
    && typeof row.subject_id === "string" && typeof row.course_code === "string" && typeof row.credits === "number")
    return value as Awaited<ReturnType<typeof captureOfferingAcademicContext>>;
  return null;
}

export interface PublishedRosterSource {
  assessment_id: string;
  publication_id: string;
  scheduled_on: string | null;
  results: ReadonlyMap<string, { academic_roster_source: unknown; person_id?: string; student_id?: string | null }>;
}
export interface PublishedAcademicLearner {
  student_id: string | null;
  learner_id?: string;
  person_id?: string;
  academic_roster_source: Record<string, unknown>;
}

export interface OfferingEnrollmentSource {
  schema_version: 2; kind: "learning_offering"; offering_id: string; person_id: string;
  enrollment_id: string; enrollment_revision: number; as_of: string;
}
export async function datedOfferingRoster(db: Db, schoolId: string, offeringId: string, termId: string, asOf: string) {
  const rows = (await sql<{ person_id: string; enrollment_id: string; enrollment_revision: number }>`SELECT enrollment.person_id,enrollment.id AS enrollment_id,enrollment.revision AS enrollment_revision
    FROM learning_offering_enrollments enrollment JOIN school_people person ON person.school_id=enrollment.school_id AND person.id=enrollment.person_id
    JOIN learning_offering_academic_contexts binding ON binding.school_id=enrollment.school_id AND binding.offering_id=enrollment.offering_id
    JOIN academic_terms term ON term.school_id=binding.school_id AND term.id=binding.term_id
    WHERE enrollment.school_id=${schoolId}::uuid AND enrollment.offering_id=${offeringId}::uuid AND term.id=${termId}::uuid
      AND ${asOf}::date BETWEEN term.starts_on AND term.ends_on AND enrollment.starts_on<=${asOf}::date
      AND(enrollment.ends_on IS NULL OR enrollment.ends_on>${asOf}::date)
      AND(person.retired_at IS NULL OR person.retired_at>(${asOf}::date::timestamp AT TIME ZONE (SELECT timezone FROM schools WHERE id=${schoolId}::uuid)))
    ORDER BY enrollment.person_id,enrollment.id FOR SHARE OF enrollment,person,binding,term`.execute(db)).rows;
  const seen = new Set<string>();
  return rows.map(row => {
    if (seen.has(row.person_id)) throw new ConflictException("This assessment date has overlapping course enrollments. Correct the offering history before opening marking.");
    seen.add(row.person_id);
    const source: OfferingEnrollmentSource = { schema_version: 2, kind: "learning_offering", offering_id: offeringId, person_id: row.person_id,
      enrollment_id: row.enrollment_id, enrollment_revision: row.enrollment_revision, as_of: asOf };
    return { learner_id: row.person_id, person_id: row.person_id, student_id: null, academic_roster_source: source };
  });
}

export async function captureOfferingAcademicContext(db: Db, schoolId: string, offeringId: string, assessmentOn?: string) {
  const offering = await db.selectFrom("learning_offerings").select(["id", "name", "revision"]).where("school_id", "=", schoolId).where("id", "=", offeringId).forShare().executeTakeFirst();
  const binding = await offeringAcademicContext(db, schoolId, offeringId);
  if (!offering || !binding) throw new ConflictException("This course's term and subject are unavailable. Review its setup before continuing.");
  return { schema_version: 2 as const, context_kind: "learning_offering" as const, offering_id: offering.id, offering_name: offering.name,
    offering_revision: offering.revision, class_section_id: null, class_name: offering.name, ...binding, ...(assessmentOn ? { assessment_on: assessmentOn } : {}) };
}

/** A first course report freezes immutable publication audiences plus enrollment
 * at the selected campus date (capped at term end). A missing result stays
 * incomplete; an ended elective without marks is excluded. Corrections retain
 * the first audience, enrollment evidence and included course set. */
export async function publishedOfferingRoster(db: Db, schoolId: string, schemeId: string, sources: readonly PublishedRosterSource[]): Promise<PublishedAcademicLearner[]> {
  const previous = await db.selectFrom("grading_report_batches").select("id").where("school_id", "=", schoolId).where("scheme_id", "=", schemeId).orderBy("sequence", "desc").executeTakeFirst();
  if (previous) return db.selectFrom("grading_report_students").select(["student_id", "learner_id", "person_id", "academic_roster_source"])
    .where("school_id", "=", schoolId).where("batch_id", "=", previous.id).orderBy("learner_id").execute();
  const term=(await sql<{starts_on:string;as_of:string}>`SELECT term.starts_on::text,LEAST(term.ends_on,(${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date)::text AS as_of
    FROM grading_schemes scheme JOIN academic_terms term ON term.school_id=scheme.school_id AND term.id=scheme.term_id JOIN schools school ON school.id=scheme.school_id
    WHERE scheme.school_id=${schoolId}::uuid AND scheme.id=${schemeId}::uuid FOR SHARE OF scheme,term`.execute(db)).rows[0];
  if(!term||term.as_of<term.starts_on)throw new ConflictException("The course report term has not started. Keep future expectations separate from an issued academic report.");
  const dated = (await sql<{person_id:string;offering_id:string;enrollment_id:string;enrollment_revision:number;as_of:string}>`SELECT enrollment.person_id,selected.offering_id,
      enrollment.id AS enrollment_id,enrollment.revision AS enrollment_revision,${term.as_of}::text AS as_of
    FROM grading_scheme_offerings selected JOIN learning_offering_enrollments enrollment ON enrollment.school_id=selected.school_id AND enrollment.offering_id=selected.offering_id
    JOIN school_people person ON person.school_id=enrollment.school_id AND person.id=enrollment.person_id JOIN schools school ON school.id=selected.school_id
    WHERE selected.school_id=${schoolId}::uuid AND selected.scheme_id=${schemeId}::uuid
      AND enrollment.starts_on<=${term.as_of}::date AND(enrollment.ends_on IS NULL OR enrollment.ends_on>${term.as_of}::date)
      AND(person.retired_at IS NULL OR person.retired_at>(${term.as_of}::date::timestamp AT TIME ZONE school.timezone))
    ORDER BY enrollment.person_id,selected.offering_id,enrollment.id FOR SHARE OF enrollment,person`.execute(db)).rows;
  const ids = [...new Set([...sources.flatMap(source => [...source.results.keys()]),...dated.map(row=>row.person_id)])].sort();
  return ids.map(id => {
    const evidence = sources.filter(source => source.results.has(id));
    const identities = evidence.map(source => source.results.get(id)!);
    if (identities.some(row => row.student_id !== null || row.person_id !== id)) throw new ConflictException("The selected course publications have incompatible learner identity.");
    const provenance = evidence.map(source => ({ assessment_id: source.assessment_id, publication_id: source.publication_id,
      enrollment_source: source.results.get(id)!.academic_roster_source }));
    return { student_id: null, learner_id: id, person_id: id, academic_roster_source: { schema_version: 2, kind: "published_and_dated_offering_roster", sources: provenance, eligibility_as_of:term.as_of,
      dated_enrollments:dated.filter(row=>row.person_id===id) } };
  });
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

/** Existing family selectors keep their class-history floor. New course records
 * additionally require the currently linked canonical student/guardian endpoint. */
export async function currentFamilyCourseAccess(db:Db,schoolId:string,userId:string,studentId:string){
  return (await sql<{allowed:boolean}>`SELECT EXISTS(SELECT 1 FROM students student JOIN school_memberships member ON member.school_id=student.school_id AND member.user_id=${userId}::uuid AND member.is_active
    WHERE student.school_id=${schoolId}::uuid AND student.id=${studentId}::uuid AND(
      (member.role='student' AND student.user_id=${userId}::uuid AND campus_model_account_person_is_active(${schoolId}::uuid,${userId}::uuid,student.person_id,${executionNow()}::timestamptz))
      OR(member.role='guardian' AND EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id=${userId}::uuid
        JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=parent.id
        WHERE relationship.school_id=student.school_id AND relationship.student_id=student.id AND campus_model_account_person_is_active(${schoolId}::uuid,${userId}::uuid,profile.person_id,${executionNow()}::timestamptz))))) AS allowed`.execute(db)).rows[0]!.allowed;
}
