import { BadRequestException, ConflictException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";

type Db = Kysely<Database> | Transaction<Database>;
export const offeringAcademicInput = z.object({
  term_id: z.uuid(), subject_id: z.uuid(), course_code: z.string().trim().min(2).max(80).transform(value => value.toUpperCase()),
  credits: z.number().finite().positive().max(1000).multipleOf(0.0001),
  programme_key: z.string().trim().min(2).max(80).transform(value => value.toUpperCase()).nullable().default(null),
}).strict();
export interface OfferingAcademicContext extends z.infer<typeof offeringAcademicInput> {
  term_name: string; academic_year: string; starts_on: string; ends_on: string;
  subject_name: string; color: string; icon: string;
}

/** Read only after the calling owner has checked its own current authority. */
export async function offeringAcademicContext(db: Db, schoolId: string, offeringId: string): Promise<OfferingAcademicContext | null> {
  const row = (await sql<Omit<OfferingAcademicContext, "credits"> & { credits: string }>`SELECT binding.term_id,binding.subject_id,binding.course_code,binding.credits,binding.programme_key,
    term.name AS term_name,term.academic_year,term.starts_on::text,term.ends_on::text,subject.name AS subject_name,subject.color,subject.icon
    FROM learning_offering_academic_contexts binding JOIN academic_terms term ON term.id=binding.term_id AND term.school_id=binding.school_id
    JOIN subjects subject ON subject.id=binding.subject_id AND subject.school_id=binding.school_id
    WHERE binding.school_id=${schoolId}::uuid AND binding.offering_id=${offeringId}::uuid`.execute(db)).rows[0];
  return row ? { ...row, credits: Number(row.credits) } : null;
}

export async function validateOfferingAcademicContext(db: Db, schoolId: string, raw: unknown) {
  const input = offeringAcademicInput.parse(raw);
  const term = await db.selectFrom("academic_terms").select("id").where("school_id", "=", schoolId).where("id", "=", input.term_id).forShare().executeTakeFirst();
  const subject = await db.selectFrom("subjects").select("id").where("school_id", "=", schoolId).where("id", "=", input.subject_id).forShare().executeTakeFirst();
  if (!term || !subject) throw new BadRequestException("Choose an existing term and subject from this campus.");
  return input;
}

export async function saveOfferingAcademicContext(db: Transaction<Database>, schoolId: string, offeringId: string, actorId: string, raw: unknown) {
  const input = await validateOfferingAcademicContext(db, schoolId, raw);
  const previous = await db.selectFrom("learning_offering_academic_contexts").selectAll().where("school_id", "=", schoolId).where("offering_id", "=", offeringId).forUpdate().executeTakeFirst();
  if (previous) {
    const used = (await sql`SELECT 1 FROM assessments WHERE school_id=${schoolId}::uuid AND offering_id=${offeringId}::uuid
      UNION ALL SELECT 1 FROM schedule_versions WHERE school_id=${schoolId}::uuid AND offering_id=${offeringId}::uuid AND published_at IS NOT NULL
      UNION ALL SELECT 1 FROM grading_scheme_offerings WHERE school_id=${schoolId}::uuid AND offering_id=${offeringId}::uuid LIMIT 1`.execute(db)).rows.length;
    if (used) throw new ConflictException("This course context is already used by a published plan, assessment or report scheme. Its earlier evidence is retained; create a separate offering for a different course.");
    await db.updateTable("learning_offering_academic_contexts").set({ ...input, credits: String(input.credits), revision: previous.revision + 1, updated_by: actorId, updated_at: executionNow() })
      .where("school_id", "=", schoolId).where("offering_id", "=", offeringId).execute();
  } else await db.insertInto("learning_offering_academic_contexts").values({ school_id: schoolId, offering_id: offeringId, ...input, credits: String(input.credits), revision: 1,
    created_by: actorId, updated_by: actorId, created_at: executionNow(), updated_at: executionNow() }).execute();
  return (await offeringAcademicContext(db, schoolId, offeringId))!;
}

/** Bounded references for an already-authorized planning/assessment/report owner.
 * An option or appointed instructor is not a permission grant. */
export async function offeringAcademicReferences(db: Db, schoolId: string, academicOnly = false) {
  const rows = (await sql<{ id: string; name: string; revision: number; learner_count: number; current_instructor: {person_id:string;name:string}|null; academic_context: OfferingAcademicContext|null }>`SELECT offering.id,offering.name,offering.revision,
    (SELECT count(*)::int FROM learning_offering_enrollments e
      WHERE e.school_id=offering.school_id AND e.offering_id=offering.id AND e.starts_on<=(${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date
        AND(e.ends_on IS NULL OR e.ends_on>(${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date)) AS learner_count,
    (SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(jsonb_build_object('person_id',appointment.person_id,'name',concat_ws(' ',person.first_name,NULLIF(person.last_name,'')))))->0 ELSE NULL END
      FROM learning_offering_teaching_assignments appointment JOIN school_people person ON person.school_id=appointment.school_id AND person.id=appointment.person_id AND person.retired_at IS NULL
      WHERE appointment.school_id=offering.school_id AND appointment.offering_id=offering.id AND appointment.can_publish
        AND appointment.starts_on<=(${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date
        AND(appointment.ends_on IS NULL OR appointment.ends_on>(${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date)) AS current_instructor,
    CASE WHEN binding.offering_id IS NULL THEN NULL ELSE jsonb_build_object('term_id',binding.term_id,'subject_id',binding.subject_id,'course_code',binding.course_code,
      'credits',binding.credits,'programme_key',binding.programme_key,'term_name',term.name,'academic_year',term.academic_year,'starts_on',term.starts_on::text,'ends_on',term.ends_on::text,
      'subject_name',subject.name,'color',subject.color,'icon',subject.icon) END AS academic_context
    FROM learning_offerings offering JOIN schools school ON school.id=offering.school_id
    LEFT JOIN learning_offering_academic_contexts binding ON binding.school_id=offering.school_id AND binding.offering_id=offering.id
    LEFT JOIN academic_terms term ON term.school_id=binding.school_id AND term.id=binding.term_id
    LEFT JOIN subjects subject ON subject.school_id=binding.school_id AND subject.id=binding.subject_id
    WHERE offering.school_id=${schoolId}::uuid AND offering.state='active' AND(NOT ${academicOnly} OR binding.offering_id IS NOT NULL)
    ORDER BY offering.name,offering.id LIMIT 500`.execute(db)).rows;
  return rows;
}
