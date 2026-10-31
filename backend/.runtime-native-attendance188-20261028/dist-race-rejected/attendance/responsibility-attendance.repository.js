var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
let ResponsibilityAttendanceRepository = class ResponsibilityAttendanceRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async dailyRegisters(input) {
        const result = await sql `
      WITH today AS MATERIALIZED (
        SELECT * FROM effective_school_schedule(${input.school_id}::uuid,${input.date}::date)
        WHERE NOT cancelled AND weekday=EXTRACT(ISODOW FROM ${input.date}::date)::int
      ), lessons AS (
        SELECT slot.class_section_id,slot.term_id,
          count(*) FILTER(WHERE slot.slot_type IN ('class','activity'))::int AS instructional_slots,
          count(*) FILTER(WHERE slot.slot_type IN ('class','activity'))::int AS periods_today,
          min(slot.starts_at) FILTER(WHERE slot.slot_type IN ('class','activity')) AS starts_at,
          max(slot.ends_at) FILTER(WHERE slot.slot_type IN ('class','activity')) AS ends_at,
          array_agg(DISTINCT COALESCE(subject.short_name,slot.title))
            FILTER(WHERE slot.slot_type IN ('class','activity')) AS subjects,
          array_agg(DISTINCT trim(concat_ws(' ',teacher.first_name,teacher.last_name)))
            FILTER(WHERE slot.slot_type IN ('class','activity') AND teacher.id IS NOT NULL
              AND slot.coverage_status IN ('not_required','accepted')) AS assigned_teachers
        FROM today slot
        LEFT JOIN users teacher ON teacher.id=slot.teacher_user_id
        LEFT JOIN subjects subject ON subject.id=slot.subject_id
        GROUP BY slot.class_section_id,slot.term_id
      ), records AS (
        SELECT enrollment.class_section_id,enrollment.term_id,count(*)::int AS student_count,
          count(record.id)::int AS marked_count,
          count(record.id) FILTER(WHERE record.status IN ('present','late','half_day'))::int AS attending_count,
          count(record.id) FILTER(WHERE record.status='absent')::int AS absent_count
        FROM enrollments enrollment
        JOIN class_sections section ON section.id=enrollment.class_section_id
          AND section.school_id=${input.school_id}::uuid
        LEFT JOIN attendance_records record ON record.student_id=enrollment.student_id
          AND record.class_section_id=enrollment.class_section_id AND record.date=${input.date}::date
        WHERE enrollment.is_active AND enrollment.enrolled_on<=${input.date}::date
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${input.date}::date)
        GROUP BY enrollment.class_section_id,enrollment.term_id
      )
      SELECT section.id AS class_section_id,'Class '||section.grade||section.section AS class_name,
        section.grade,section.section,section.room_number,term.id AS term_id,term.name AS term_name,
        term.academic_year,lesson.starts_at,lesson.ends_at,COALESCE(lesson.periods_today,0)::int AS periods_today,
        COALESCE(record.student_count,0)::int AS student_count,COALESCE(record.marked_count,0)::int AS marked_count,
        COALESCE(record.attending_count,0)::int AS attending_count,COALESCE(record.absent_count,0)::int AS absent_count,
        COALESCE(lesson.subjects,ARRAY[]::text[]) AS subjects,
        COALESCE(lesson.assigned_teachers,ARRAY[]::text[]) AS assigned_teachers,
        'regular'::text AS assignment_kind,
        CASE WHEN register.state IN ('submitted','locked') THEN register.state
          WHEN COALESCE(record.marked_count,0)>0 THEN 'in_progress' ELSE 'not_started' END AS submission_status,
        CASE WHEN submitter.id IS NULL THEN NULL ELSE trim(concat_ws(' ',submitter.first_name,submitter.last_name)) END AS submitted_by_name,
        register.submitted_at,register.auto_finalize_at,register.finalization_policy_revision,register.finalization_source,
        CASE
          WHEN register.submitted_by IS NULL THEN true
          WHEN EXISTS(SELECT 1 FROM school_memberships membership
            WHERE membership.school_id=section.school_id AND membership.user_id=register.submitted_by
              AND membership.role='admin' AND membership.is_active) THEN true
          ELSE EXISTS(SELECT 1 FROM today submitted_slot
            WHERE submitted_slot.class_section_id=section.id AND submitted_slot.term_id=term.id
              AND submitted_slot.slot_type IN ('class','activity')
              AND submitted_slot.teacher_user_id=register.submitted_by
              AND submitted_slot.coverage_status IN ('not_required','accepted'))
        END AS submission_authorized,
        COALESCE(lesson.instructional_slots,0)>0 AS instructional,
        ${input.date}::date<=${input.current_local_date}::date AS date_open,
        (${input.date}::date<=${input.current_local_date}::date
          AND COALESCE(lesson.instructional_slots,0)>0
          AND COALESCE(record.student_count,0)>0
          AND (${input.access.record_all} OR section.id=ANY(${sql.val([...input.access.record_class_ids])}::uuid[]))) AS can_mark,
        CASE
          WHEN ${input.date}::date>${input.current_local_date}::date THEN 'Attendance opens on the selected date.'
          WHEN COALESCE(lesson.instructional_slots,0)=0 THEN 'No attendance is required because this class has no scheduled lesson.'
          WHEN COALESCE(record.student_count,0)=0 THEN 'No enrolled students require attendance for this date.'
          WHEN NOT (${input.access.record_all} OR section.id=ANY(${sql.val([...input.access.record_class_ids])}::uuid[]))
            THEN 'Your current responsibility allows review, but not recording attendance for this class.'
          ELSE NULL
        END AS availability_reason
      FROM class_sections section
      JOIN academic_terms term ON term.school_id=section.school_id AND term.academic_year=section.academic_year
        AND ${input.date}::date BETWEEN term.starts_on AND term.ends_on
      LEFT JOIN lessons lesson ON lesson.class_section_id=section.id AND lesson.term_id=term.id
      LEFT JOIN records record ON record.class_section_id=section.id AND record.term_id=term.id
      LEFT JOIN attendance_registers register ON register.class_section_id=section.id
        AND register.term_id=term.id AND register.date=${input.date}::date
      LEFT JOIN users submitter ON submitter.id=register.submitted_by
      WHERE section.school_id=${input.school_id}::uuid
        AND (COALESCE(lesson.instructional_slots,0)>0 OR register.id IS NOT NULL)
        AND (${input.access.view_all} OR section.id=ANY(${sql.val([...input.access.view_class_ids])}::uuid[]))
      ORDER BY lesson.starts_at NULLS LAST,section.grade,section.section
    `.execute(this.db);
        return result.rows;
    }
    async continuity(input) {
        const inScope = sql `${input.access.coordinate_all}
      OR batch.class_section_id=ANY(${sql.val([...input.access.coordinate_class_ids])}::uuid[])`;
        const [summary, cases] = await Promise.all([
            sql `
        SELECT count(*) FILTER(WHERE batch.status='pending')::int AS pending,
          count(*) FILTER(WHERE batch.status='quarantined')::int AS quarantined,
          count(*) FILTER(WHERE batch.status='accepted' AND batch.date=${input.date}::date)::int AS accepted,
          count(*) FILTER(WHERE batch.status='rejected' AND batch.date=${input.date}::date)::int AS rejected
        FROM attendance_capture_batches batch
        WHERE batch.school_id=${input.school_id}::uuid AND (${inScope})
      `.execute(this.db),
            sql `
        SELECT review.id,review.reason_code,review.reason,review.details,review.state,review.opened_at,
          batch.id AS batch_id,batch.date,batch.source,batch.source_reference,batch.observed_at,
          batch.received_at,batch.roster_count,batch.expected_register_revision,
          section.id AS class_section_id,'Class '||section.grade||section.section AS class_name,
          trim(concat_ws(' ',actor.first_name,actor.last_name)) AS recorded_by_name,
          COALESCE(register.revision,0)::int AS current_revision,register.state AS register_state
        FROM attendance_reconciliation_cases review
        JOIN attendance_capture_batches batch ON batch.id=review.batch_id
        JOIN class_sections section ON section.id=batch.class_section_id AND section.school_id=batch.school_id
        JOIN users actor ON actor.id=batch.recorded_by
        LEFT JOIN attendance_registers register ON register.class_section_id=batch.class_section_id
          AND register.term_id=batch.term_id AND register.date=batch.date
        WHERE review.school_id=${input.school_id}::uuid AND review.state='open' AND (${inScope})
        ORDER BY (review.id=${input.selected_case_id}::uuid) DESC,review.opened_at,section.grade,section.section
        LIMIT 50
      `.execute(this.db),
        ]);
        return {
            date: input.date,
            summary: summary.rows[0] ?? { pending: 0, quarantined: 0, accepted: 0, rejected: 0 },
            cases: cases.rows,
        };
    }
    async thresholds(input) {
        const rows = await sql `
      WITH scores AS (
        SELECT student.id,student.admission_number,
          btrim(person.first_name||' '||person.last_name) AS name,
          section.id AS class_section_id,'Class '||section.grade||section.section AS class_name,
          term.attendance_threshold,
          count(record.id) FILTER(WHERE record.status<>'excused')::int AS recorded_days,
          COALESCE(sum(CASE WHEN record.status IN ('present','late') THEN 1.0
            WHEN record.status='half_day' THEN 0.5 ELSE 0 END),0)::numeric AS points
        FROM students student
        JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
        JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
          AND enrollment.enrolled_on<=${input.date}::date
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${input.date}::date)
        JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=student.school_id
        JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
          AND ${input.date}::date BETWEEN term.starts_on AND term.ends_on
        LEFT JOIN attendance_records record ON record.student_id=student.id
          AND record.class_section_id=section.id
          AND record.date BETWEEN term.starts_on AND LEAST(term.ends_on,${input.date}::date)
        WHERE student.school_id=${input.school_id}::uuid
          AND (${input.access.view_all} OR section.id=ANY(${sql.val([...input.access.view_class_ids])}::uuid[]))
        GROUP BY student.id,student.admission_number,person.first_name,person.last_name,
          section.id,section.grade,section.section,term.attendance_threshold
      )
      SELECT id::text,admission_number,name,class_section_id::text,class_name,recorded_days,
        round(points*100.0/NULLIF(recorded_days,0),2) AS percentage,
        attendance_threshold AS threshold
      FROM scores
      WHERE recorded_days>=5 AND points*100.0/NULLIF(recorded_days,0)<attendance_threshold
      ORDER BY percentage,class_name,name,id
      LIMIT 100
    `.execute(this.db);
        return rows.rows.map((row) => ({
            ...row,
            percentage: Number(row.percentage),
            threshold: Number(row.threshold),
        }));
    }
};
ResponsibilityAttendanceRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], ResponsibilityAttendanceRepository);
export { ResponsibilityAttendanceRepository };
//# sourceMappingURL=responsibility-attendance.repository.js.map