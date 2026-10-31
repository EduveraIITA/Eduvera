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
let OperatingDayRepository = class OperatingDayRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    membership(userId, schoolId) {
        return this.db.selectFrom("school_memberships")
            .select(["school_id", "role"])
            .where("user_id", "=", userId)
            .where("school_id", "=", schoolId)
            .where("role", "in", ["admin", "staff"])
            .where("is_active", "=", true)
            .executeTakeFirst();
    }
    async school(schoolId) {
        return (await sql `SELECT school.id::text,school.name,school.timezone,
        COALESCE(rule.attendance_academic_mode,'scheduled_session')::text AS attendance_academic_mode
      FROM schools school
      LEFT JOIN institution_operating_rules rule ON rule.school_id=school.id
      WHERE school.id=${schoolId}::uuid`.execute(this.db)).rows[0];
    }
    async attendance(schoolId, date, mode, occurrences) {
        if (mode === "none" || !occurrences.length)
            return [];
        if (mode === "scheduled_session") {
            const values = sql.join(occurrences.map((occurrence) => sql `(
        ${occurrence.id}::text,
        ${occurrence.class_domain_id}::uuid,
        ${occurrence.period_domain_id}::uuid
      )`));
            return (await sql `WITH expected(scope_key,class_section_id,schedule_slot_id) AS (
          VALUES ${values}
        ), roster AS (
          SELECT expected.scope_key,count(enrollment.id)::int AS expected_count
          FROM expected LEFT JOIN enrollments enrollment
            ON enrollment.class_section_id=expected.class_section_id
            AND enrollment.is_active AND enrollment.enrolled_on<=${date}::date
          GROUP BY expected.scope_key
        ), marked AS (
          SELECT expected.scope_key,count(entry.id)::int AS marked_count
          FROM expected
          JOIN attendance_session_registers register
            ON register.school_id=${schoolId}::uuid
            AND register.session_date=${date}::date
            AND register.schedule_slot_id=expected.schedule_slot_id
          LEFT JOIN attendance_session_entries entry ON entry.session_id=register.id
          GROUP BY expected.scope_key
        )
        SELECT expected.scope_key,register.id::text AS register_id,expected.class_section_id::text,
          COALESCE(register.state,'draft')::text AS state,
          COALESCE(register.revision,0)::int AS revision,
          COALESCE(marked.marked_count,0)::int AS marked_count,
          COALESCE(roster.expected_count,0)::int AS expected_count,
          register.submitted_at
        FROM expected
        JOIN class_sections section ON section.id=expected.class_section_id
          AND section.school_id=${schoolId}::uuid
        LEFT JOIN attendance_session_registers register
          ON register.school_id=${schoolId}::uuid
          AND register.session_date=${date}::date
          AND register.schedule_slot_id=expected.schedule_slot_id
        LEFT JOIN roster ON roster.scope_key=expected.scope_key
        LEFT JOIN marked ON marked.scope_key=expected.scope_key
        ORDER BY expected.scope_key`.execute(this.db)).rows;
        }
        const classSectionIds = [...new Set(occurrences.map((occurrence) => occurrence.class_domain_id))];
        return (await sql `WITH classes AS (
        SELECT unnest(${sql.val(classSectionIds)}::uuid[]) AS class_section_id
      ), roster AS (
        SELECT classes.class_section_id,count(enrollment.id)::int AS expected_count
        FROM classes LEFT JOIN enrollments enrollment
          ON enrollment.class_section_id=classes.class_section_id
          AND enrollment.is_active AND enrollment.enrolled_on<=${date}::date
        GROUP BY classes.class_section_id
      ), marked AS (
        SELECT record.class_section_id,count(*)::int AS marked_count
        FROM attendance_records record
        WHERE record.class_section_id=ANY(${sql.val(classSectionIds)}::uuid[])
          AND record.date=${date}::date
        GROUP BY record.class_section_id
      )
      SELECT classes.class_section_id::text AS scope_key,register.id::text AS register_id,classes.class_section_id::text,
        COALESCE(register.state,'draft')::text AS state,
        COALESCE(register.revision,0)::int AS revision,
        COALESCE(marked.marked_count,0)::int AS marked_count,
        COALESCE(roster.expected_count,0)::int AS expected_count,
        register.submitted_at
      FROM classes
      JOIN class_sections section ON section.id=classes.class_section_id
        AND section.school_id=${schoolId}::uuid
      LEFT JOIN LATERAL (
        SELECT candidate.id,candidate.state,candidate.revision,candidate.submitted_at
        FROM attendance_registers candidate
        WHERE candidate.class_section_id=classes.class_section_id
          AND candidate.date=${date}::date
        ORDER BY candidate.updated_at DESC,candidate.id DESC LIMIT 1
      ) register ON true
      LEFT JOIN roster ON roster.class_section_id=classes.class_section_id
      LEFT JOIN marked ON marked.class_section_id=classes.class_section_id
      ORDER BY classes.class_section_id`.execute(this.db)).rows;
    }
    async gateTotals(schoolId, date, timezone, asOf) {
        return (await sql `SELECT
        count(*) FILTER(WHERE event.direction='in')::int AS entries,
        count(*) FILTER(WHERE event.direction='out')::int AS exits
      FROM gate_events event
      JOIN students student ON student.id=event.student_id AND student.school_id=${schoolId}::uuid
      WHERE (event.occurred_at AT TIME ZONE ${timezone})::date=${date}::date
        AND event.occurred_at<=${asOf}::timestamptz`.execute(this.db)).rows[0] ?? { entries: 0, exits: 0 };
    }
};
OperatingDayRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], OperatingDayRepository);
export { OperatingDayRepository };
//# sourceMappingURL=operating-day.repository.js.map