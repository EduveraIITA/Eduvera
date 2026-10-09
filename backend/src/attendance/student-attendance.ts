import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../database/types.js';

export const studentAttendanceInput = z.object({
  class_section_id: z.string().uuid(), student_id: z.string().uuid(), date: z.iso.date(),
  expected_revision: z.number().int().min(0),
  status: z.enum(['present', 'absent', 'late', 'excused', 'half_day']),
  remarks: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();

export const studentAttendanceSearch = z.object({
  student: z.string().trim().min(2).max(120), date: z.iso.date().optional(),
  class_name: z.string().trim().min(1).max(80).optional(),
}).strict();

/** Name/admission lookup within the SAME dated class access as the register.
 * No guardian contacts, date of birth, or other unrelated student profile data.
 */
export async function findAttendanceStudents(db: Kysely<Database>, schoolId: string, userId: string,
  role: string, date: string, search: string, className?: string) {
  return (await sql<{ id: string; name: string; admission_number: string; class_section_id: string; class_name: string }>`
    SELECT DISTINCT student.id, trim(concat_ws(' ',person.first_name,person.last_name)) AS name,
      student.admission_number, section.id AS class_section_id, 'Class ' || section.grade || section.section AS class_name
    FROM students student
    JOIN school_people person ON person.id=student.person_id
    JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
      AND enrollment.enrolled_on<=${date}::date
    JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=${schoolId}::uuid
    JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=section.school_id
      AND ${date}::date BETWEEN term.starts_on AND term.ends_on
    WHERE student.school_id=${schoolId}::uuid
      AND (position(lower(${search}) in lower(trim(concat_ws(' ',person.first_name,person.last_name))))>0
        OR lower(student.admission_number)=lower(${search}) OR student.id::text=${search})
      AND (${className ?? null}::text IS NULL
        OR lower(regexp_replace('Class ' || section.grade || section.section,'[^a-zA-Z0-9]','','g'))
          =lower(regexp_replace(${className ?? ''},'[^a-zA-Z0-9]','','g'))
        OR lower(section.grade || section.section)=lower(regexp_replace(${className ?? ''},'[^a-zA-Z0-9]','','g')))
      AND (${role}='admin' OR staff_has_class_permission(${schoolId}::uuid,${userId}::uuid,'attendance.view',section.id,${date}::date)
        OR EXISTS (SELECT 1 FROM effective_school_schedule(${schoolId}::uuid,${date}::date) slot
          WHERE slot.class_section_id=section.id AND slot.term_id=term.id AND slot.teacher_user_id=${userId}::uuid
            AND NOT slot.cancelled AND slot.coverage_status='accepted'))
    ORDER BY name, class_name, student.id LIMIT 21
  `.execute(db)).rows;
}
