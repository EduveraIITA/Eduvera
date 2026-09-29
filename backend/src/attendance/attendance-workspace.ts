import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../database/types.js";

export interface AttendanceClassWorkspace {
  class_section_id: string;
  class_name: string;
  grade: string;
  section: string;
  room_number: string;
  term_id: string;
  term_name: string;
  academic_year: string;
  starts_at: string | null;
  ends_at: string | null;
  periods_today: number;
  student_count: number;
  marked_count: number;
  attending_count: number;
  absent_count: number;
  subjects: string[];
  assigned_teachers: string[];
  assignment_kind: "regular" | "substitute";
  submission_status: "not_started" | "in_progress" | "submitted" | "locked";
  submitted_by_name: string | null;
  submitted_at: string | null;
  submission_authorized: boolean;
  instructional: boolean;
  date_open: boolean;
  can_mark: boolean;
  availability_reason: string | null;
}

export async function attendanceDayPolicy(
  db: Kysely<Database> | Transaction<Database>, schoolId: string,
  classId: string, termId: string, date: string,
  actor?: { userId: string; role: string },
) {
  const result = await sql<{
    completed: boolean;
    instructional: boolean;
    actor_scheduled: boolean;
    submitted_by_name: string | null;
  }>`
    SELECT ${date}::date <= (now() AT TIME ZONE school.timezone)::date AS completed,
      EXISTS (
        SELECT 1 FROM effective_school_schedule(${schoolId}::uuid,${date}::date) slot
        WHERE slot.class_section_id=${classId}::uuid AND slot.term_id=${termId}::uuid
          AND slot.weekday=EXTRACT(ISODOW FROM ${date}::date)::int
          AND slot.slot_type IN ('class','activity') AND NOT slot.cancelled
      ) AS instructional,
      CASE
        WHEN ${actor?.role ?? "admin"}='admin' THEN true
        ELSE EXISTS (
          SELECT 1 FROM effective_school_schedule(${schoolId}::uuid,${date}::date) slot
          WHERE slot.class_section_id=${classId}::uuid AND slot.term_id=${termId}::uuid
            AND slot.weekday=EXTRACT(ISODOW FROM ${date}::date)::int
            AND slot.slot_type IN ('class','activity') AND NOT slot.cancelled
            AND slot.teacher_user_id=${actor?.userId ?? null}::uuid
            AND slot.coverage_status IN ('not_required','accepted')
        )
      END AS actor_scheduled,
      CASE WHEN actor.id IS NOT NULL THEN trim(concat_ws(' ',actor.first_name,actor.last_name)) END AS submitted_by_name
    FROM schools school
    LEFT JOIN attendance_registers reg ON reg.school_id=school.id AND reg.class_section_id=${classId}::uuid
      AND reg.term_id=${termId}::uuid AND reg.date=${date}::date
    LEFT JOIN users actor ON actor.id=reg.submitted_by
    WHERE school.id=${schoolId}::uuid
  `.execute(db);
  return result.rows[0];
}

/** Effective dated lessons and accepted cover, matching register access.
 * One school-scoped batch query; no per-class network/database requests.
 */
export async function attendanceWorkspace(
  db: Kysely<Database>, schoolId: string, userId: string, role: string, date: string,
): Promise<AttendanceClassWorkspace[]> {
  const result = await sql<AttendanceClassWorkspace>`
    WITH today AS MATERIALIZED (
      SELECT * FROM effective_school_schedule(${schoolId}::uuid, ${date}::date)
      WHERE NOT cancelled AND weekday=EXTRACT(ISODOW FROM ${date}::date)::int
    ), lessons AS (
      SELECT slot.class_section_id, slot.term_id,
        bool_or(slot.teacher_user_id=${userId}::uuid AND slot.coverage_status='not_required') AS regular,
        bool_or(teacher_user_id=${userId}::uuid AND coverage_status='accepted') AS substitute,
        count(*) FILTER (WHERE slot_type IN ('class','activity'))::int AS instructional_slots,
        count(*) FILTER (WHERE slot_type IN ('class','activity') AND
          (${role}='admin' OR (teacher_user_id=${userId}::uuid AND coverage_status IN ('not_required','accepted'))))::int AS periods_today,
        min(starts_at) FILTER (WHERE teacher_user_id=${userId}::uuid AND coverage_status IN ('not_required','accepted')) AS starts_at,
        max(ends_at) FILTER (WHERE teacher_user_id=${userId}::uuid AND coverage_status IN ('not_required','accepted')) AS ends_at,
        array_agg(DISTINCT COALESCE(subject.short_name, slot.title))
          FILTER (WHERE slot.slot_type IN ('class','activity') AND
            (${role}='admin' OR (slot.teacher_user_id=${userId}::uuid AND slot.coverage_status IN ('not_required','accepted')))) AS subjects,
        array_agg(DISTINCT trim(concat_ws(' ', teacher.first_name, teacher.last_name)))
          FILTER (WHERE slot.slot_type IN ('class','activity') AND teacher.id IS NOT NULL
            AND slot.coverage_status IN ('not_required','accepted')) AS assigned_teachers
      FROM today slot
      LEFT JOIN users teacher ON teacher.id=slot.teacher_user_id
      LEFT JOIN subjects subject ON subject.id=slot.subject_id
      GROUP BY slot.class_section_id, slot.term_id
    ), records AS (
      SELECT e.class_section_id, e.term_id, count(*)::int AS student_count,
        count(ar.id)::int AS marked_count,
        count(ar.id) FILTER (WHERE ar.status IN ('present','late','half_day'))::int AS attending_count,
        count(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count
      FROM enrollments e
      JOIN class_sections cs ON cs.id=e.class_section_id AND cs.school_id=${schoolId}::uuid
      LEFT JOIN attendance_records ar ON ar.student_id=e.student_id
        AND ar.class_section_id=e.class_section_id AND ar.date=${date}::date
      WHERE e.is_active AND e.enrolled_on<=${date}::date
      GROUP BY e.class_section_id, e.term_id
    )
    SELECT cs.id AS class_section_id, 'Class ' || cs.grade || cs.section AS class_name,
      cs.grade, cs.section, cs.room_number, t.id AS term_id, t.name AS term_name, t.academic_year,
      l.starts_at, l.ends_at, COALESCE(l.periods_today,0)::int AS periods_today,
      COALESCE(r.student_count,0)::int AS student_count, COALESCE(r.marked_count,0)::int AS marked_count,
      COALESCE(r.attending_count,0)::int AS attending_count, COALESCE(r.absent_count,0)::int AS absent_count,
      COALESCE(l.subjects,ARRAY[]::text[]) AS subjects,
      COALESCE(l.assigned_teachers,ARRAY[]::text[]) AS assigned_teachers,
      CASE WHEN l.regular THEN 'regular' ELSE 'substitute' END AS assignment_kind,
      CASE WHEN reg.state IN ('submitted','locked') THEN reg.state
        WHEN COALESCE(r.marked_count,0)>0 THEN 'in_progress' ELSE 'not_started' END AS submission_status,
      CASE WHEN actor.id IS NOT NULL THEN trim(concat_ws(' ',actor.first_name,actor.last_name)) END AS submitted_by_name,
      reg.submitted_at,
      CASE
        WHEN reg.submitted_by IS NULL THEN true
        WHEN EXISTS (
          SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=cs.school_id AND membership.user_id=reg.submitted_by
            AND membership.role='admin' AND membership.is_active
        ) THEN true
        ELSE EXISTS (
          SELECT 1 FROM today submitter_slot
          WHERE submitter_slot.class_section_id=cs.id AND submitter_slot.term_id=t.id
            AND submitter_slot.slot_type IN ('class','activity')
            AND submitter_slot.teacher_user_id=reg.submitted_by
            AND submitter_slot.coverage_status IN ('not_required','accepted')
        )
      END AS submission_authorized,
      COALESCE(l.instructional_slots,0)>0 AS instructional,
      ${date}::date <= (now() AT TIME ZONE school.timezone)::date AS date_open,
      (${date}::date <= (now() AT TIME ZONE school.timezone)::date
        AND COALESCE(l.instructional_slots,0)>0
        AND COALESCE(r.student_count,0)>0
        AND (${role}='admin' OR COALESCE(l.periods_today,0)>0)) AS can_mark,
      CASE
        WHEN ${date}::date > (now() AT TIME ZONE school.timezone)::date THEN 'Attendance opens on the selected date.'
        WHEN COALESCE(l.instructional_slots,0)=0 THEN 'No attendance is required because this class has no scheduled lesson.'
        WHEN COALESCE(r.student_count,0)=0 THEN 'No enrolled students require attendance for this date.'
        WHEN ${role}<>'admin' AND COALESCE(l.periods_today,0)=0 THEN 'You have no scheduled or accepted cover period for this class on this date.'
        ELSE NULL
      END AS availability_reason
    FROM class_sections cs JOIN schools school ON school.id=cs.school_id
    JOIN academic_terms t ON t.school_id=cs.school_id AND t.academic_year=cs.academic_year
      AND ${date}::date BETWEEN t.starts_on AND t.ends_on
    LEFT JOIN lessons l ON l.class_section_id=cs.id AND l.term_id=t.id
    LEFT JOIN records r ON r.class_section_id=cs.id AND r.term_id=t.id
    LEFT JOIN attendance_registers reg ON reg.class_section_id=cs.id AND reg.term_id=t.id AND reg.date=${date}::date
    LEFT JOIN users actor ON actor.id=reg.submitted_by
    WHERE cs.school_id=${schoolId}::uuid
      AND (COALESCE(l.instructional_slots,0)>0 OR reg.id IS NOT NULL)
      AND (${role}='admin' OR COALESCE(l.periods_today,0)>0)
    ORDER BY l.starts_at NULLS LAST, cs.grade, cs.section
  `.execute(db);
  return result.rows;
}
