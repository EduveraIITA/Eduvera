import { sql } from "kysely";
import type { DatabaseService } from "../database/database.service.js";
import { round } from "./analytics-metrics.js";

type InstitutionScope = { school: string; term: string; today: string; from: string; to: string; classId: string | null };

/** Admin-only read models. Callers must authorize the principal portal first. */
export async function institutionSnapshot(db: DatabaseService, scope: InstitutionScope) {
  const { school, term, today, to } = scope;
  const [classResult, staffResult] = await Promise.all([
    sql<{ id: string; name: string; students: number }>`
      SELECT c.id,'Class '||c.grade||c.section AS name,count(s.id)::int AS students
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      LEFT JOIN enrollments e ON e.class_section_id=c.id AND e.term_id=t.id AND e.is_active AND e.enrolled_on<=${to}::date
      LEFT JOIN students s ON s.id=e.student_id AND s.school_id=c.school_id
      WHERE c.school_id=${school}::uuid AND t.id=${term}::uuid
      GROUP BY c.id,c.grade,c.section ORDER BY c.grade,c.section`.execute(db),
    sql<{ teaching: number; non_teaching: number }>`
      SELECT count(*) FILTER(WHERE staff_kind='teaching')::int AS teaching,
        count(*) FILTER(WHERE staff_kind='non_teaching')::int AS non_teaching
      FROM staff_profiles WHERE school_id=${school}::uuid AND status='active' AND joined_on<=${today}::date`.execute(db),
  ]);
  const classes = classResult.rows.sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const students = classes.reduce((sum, row) => sum+row.students, 0);
  const populated = classes.filter(row => row.students>0).length;
  const staff = staffResult.rows[0]!;
  return { as_of: today, enrollment_as_of: to, students, configured_classes: classes.length, populated_classes: populated,
    average_class_size: populated ? round(students/populated) : null,
    teaching_staff: staff.teaching, non_teaching_staff: staff.non_teaching,
    students_per_teacher: staff.teaching ? round(students/staff.teaching) : null, classes };
}

export async function registerSubmission(db: DatabaseService, scope: InstitutionScope) {
  const { school, term, from, to, classId } = scope;
  const result = await sql<{ id: string; name: string; expected: number; submitted: number; locked: number; latest_unsubmitted: string | null }>`
    WITH roster AS MATERIALIZED (
      SELECT c.id,'Class '||c.grade||c.section AS name,min(e.enrolled_on) AS first_enrollment
      FROM class_sections c JOIN enrollments e ON e.class_section_id=c.id AND e.term_id=${term}::uuid
      JOIN students s ON s.id=e.student_id AND s.school_id=c.school_id
      WHERE c.school_id=${school}::uuid AND e.is_active AND e.enrolled_on<=${to}::date
        AND (${classId}::uuid IS NULL OR c.id=${classId}::uuid)
      GROUP BY c.id,c.grade,c.section
    ), dates AS (
      SELECT ${from}::date+offset_day AS date FROM generate_series(0,${to}::date-${from}::date) offset_day
    ), expected AS MATERIALIZED (
      SELECT DISTINCT roster.id,dates.date
      FROM dates CROSS JOIN LATERAL effective_school_schedule(${school}::uuid,dates.date) slot
      JOIN roster ON roster.id=slot.class_section_id AND roster.first_enrollment<=dates.date
      WHERE slot.term_id=${term}::uuid AND NOT slot.cancelled AND slot.slot_type IN ('class','activity')
        AND slot.weekday=EXTRACT(ISODOW FROM dates.date)::int
    ) SELECT roster.id,roster.name,count(expected.date)::int AS expected,
      count(*) FILTER(WHERE reg.state='submitted')::int AS submitted,
      count(*) FILTER(WHERE reg.state='locked')::int AS locked,
      max(expected.date) FILTER(WHERE reg.state IS NULL OR reg.state='draft')::text AS latest_unsubmitted
    FROM roster LEFT JOIN expected ON expected.id=roster.id
    LEFT JOIN attendance_registers reg ON reg.school_id=${school}::uuid AND reg.term_id=${term}::uuid
      AND reg.class_section_id=expected.id AND reg.date=expected.date
    GROUP BY roster.id,roster.name ORDER BY roster.name`.execute(db);
  const classes = result.rows.map(row => ({ ...row, outstanding: row.expected-row.submitted-row.locked,
    percentage: row.expected ? round((row.submitted+row.locked)*100/row.expected) : null }))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = classes.reduce((sum, row) => ({ expected: sum.expected+row.expected, submitted: sum.submitted+row.submitted,
    locked: sum.locked+row.locked, outstanding: sum.outstanding+row.outstanding }), { expected: 0, submitted: 0, locked: 0, outstanding: 0 });
  return { ...total, percentage: total.expected ? round((total.submitted+total.locked)*100/total.expected) : null,
    unscheduled_classes: classes.filter(row => row.expected===0).length, classes };
}
