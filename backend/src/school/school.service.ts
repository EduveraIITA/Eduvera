import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "./school-event.service.js";
import {lockSchedule,protectPublishedPlans} from '../day-plans/schedule.js';
import { attendanceDayPolicy, attendanceWorkspace } from '../attendance/attendance-workspace.js';

type Db = Kysely<Database> | Transaction<Database>;
type LeaveStatus = "draft" | "pending_guardian" | "authorized" | "declined" | "school_approved" | "school_rejected" | "withdrawn";

interface StudentContext {
  id: string; person_id: string; user_id: string | null; school_id: string; admission_number: string;
  date_of_birth: string | null; blood_group: string | null; emergency_contact: string | null;
  avatar_url: string; username: string | null; email: string | null; first_name: string; last_name: string;
  school_name: string; school_code: string; school_timezone: string;
}

interface EnrollmentContext {
  id: string; class_section_id: string; term_id: string; roll_number: number; is_active: boolean;
  grade: string; section: string; board: string; room_number: string;
  school_id: string; school_timezone: string; school_date: string;
  academic_year: string; term_name: string; starts_on: string; ends_on: string; attendance_threshold: string;
}

export interface UploadInput { filename: string; mimetype: string; data: Buffer }

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const leaveSchema = z.object({
  student_id: z.string().uuid().optional(),
  category: z.enum(["medical", "family", "travel", "personal"]),
  starts_on: z.string().regex(datePattern),
  ends_on: z.string().regex(datePattern),
  reason: z.string().trim().min(5).max(2000),
});
const attendanceBulkSchema = z.object({
  class_section_id: z.string().uuid(),
  date: z.string().regex(datePattern),
  expected_revision: z.number().int().min(0),
  photo_session_id: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  records: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(["present", "absent", "late", "excused", "half_day"]),
    remarks: z.string().trim().max(500).optional().default(""),
  })).min(1).max(100),
});
const attendanceLockSchema = z.object({
  date: z.string().regex(datePattern),
  reason: z.string().trim().min(3).max(500).optional(),
});
const timetableSlotSchema = z.object({
  class_section_id: z.string().uuid(),
  subject_id: z.string().uuid().nullable().optional(),
  weekday: z.number().int().min(1).max(7),
  period_number: z.number().int().min(1).max(20),
  starts_at: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  slot_type: z.enum(["class", "break", "activity"]),
  title: z.string().trim().max(120).optional().default(""),
  room: z.string().trim().max(80).optional().default(""),
  teacher_user_id: z.string().uuid().nullable().optional(),
  teacher_designation: z.string().trim().max(120).optional().default("Subject Teacher"),
});
const notificationPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
});
const actionLabels: Record<string, string> = {
  submitted: "Submitted", document_added: "Document added", clarification_requested: "Clarification requested",
  authorized: "Guardian authorized", declined: "Guardian declined", approved: "School approved",
  rejected: "School rejected", withdrawn: "Withdrawn",
};
const categoryLabels: Record<string, string> = { medical: "Medical", family: "Family commitment", travel: "Travel", personal: "Personal / domestic" };
const statusLabels: Record<string, string> = {
  draft: "Draft", pending_guardian: "Pending guardian authorization", authorized: "Guardian authorized",
  declined: "Guardian declined", school_approved: "School approved", school_rejected: "School rejected", withdrawn: "Withdrawn",
};
const weekdayLabels = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoWeekday(value: string): number {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error("Database returned an invalid calendar date.");
  return match[0];
}

function daysInclusive(start: string | Date, end: string | Date): number {
  const startTime = Date.parse(`${dateOnly(start)}T00:00:00Z`);
  const endTime = Date.parse(`${dateOnly(end)}T00:00:00Z`);
  return Math.round((endTime - startTime) / 86_400_000) + 1;
}

function notificationCursor(value?: string): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const parsed = z.object({ created_at: z.string().datetime(), id: z.string().uuid() }).parse(decoded);
    return { createdAt: new Date(parsed.created_at), id: parsed.id };
  } catch {
    throw new BadRequestException("The notification cursor is invalid or expired.");
  }
}

function encodeNotificationCursor(row: { created_at: Date | string; id: string }): string {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

@Injectable()
export class SchoolService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  async studentForUser(user: AuthUser, requestedId?: string): Promise<StudentContext> {
    const result = await sql<StudentContext>`
      SELECT st.id, st.person_id, st.user_id, st.school_id, st.admission_number, st.date_of_birth,
        st.blood_group, st.emergency_contact, st.avatar_url, account.username, account.email,
        u.first_name, u.last_name, sc.name AS school_name, sc.code AS school_code,
        sc.timezone AS school_timezone
      FROM students st
      JOIN school_people u ON u.id = st.person_id
      LEFT JOIN users account ON account.id = st.user_id
      JOIN schools sc ON sc.id = st.school_id
      WHERE (${requestedId ?? null}::uuid IS NULL OR st.id = ${requestedId ?? null}::uuid)
        AND (${user.active_school_id ?? null}::uuid IS NULL OR st.school_id=${user.active_school_id ?? null}::uuid)
        AND (
          (st.user_id = ${user.id}::uuid AND EXISTS (
            SELECT 1 FROM school_memberships m WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'student' AND m.is_active
          ))
          OR EXISTS (
            SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id = p.id
            JOIN school_memberships m ON m.user_id = p.user_id AND m.school_id = st.school_id
            WHERE p.user_id = ${user.id}::uuid AND gr.student_id = st.id
              AND m.role = 'guardian' AND m.is_active
          )
          OR EXISTS (
            SELECT 1 FROM school_memberships m WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'admin' AND m.is_active
          )
          OR EXISTS (
            SELECT 1
            FROM school_memberships m
            JOIN enrollments assigned_enrollment
              ON assigned_enrollment.student_id = st.id AND assigned_enrollment.is_active
            JOIN timetable_slots assigned_slot
              ON assigned_slot.class_section_id = assigned_enrollment.class_section_id
              AND assigned_slot.term_id = assigned_enrollment.term_id
              AND assigned_slot.teacher_user_id = m.user_id
            WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'staff' AND m.is_active
          )
        )
      ORDER BY CASE WHEN st.user_id = ${user.id}::uuid THEN 0 ELSE 1 END,
        st.admission_number DESC, st.id
      LIMIT 1
    `.execute(this.db);
    const student = result.rows[0];
    if (!student) throw new NotFoundException("No accessible student matches this request.");
    return student;
  }

  async accessibleStudentDtos(user: AuthUser) {
    const ids = await sql<{ id: string }>`
      SELECT DISTINCT st.id FROM students st WHERE (${user.active_school_id ?? null}::uuid IS NULL OR st.school_id=${user.active_school_id ?? null}::uuid) AND (
        (st.user_id = ${user.id}::uuid AND EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id AND m.role='student' AND m.is_active))
        OR EXISTS (SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id AND m.role='guardian' AND m.is_active WHERE p.user_id=${user.id}::uuid AND gr.student_id=st.id)
        OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id AND m.role='admin' AND m.is_active)
        OR EXISTS (
          SELECT 1
          FROM school_memberships m
          JOIN enrollments assigned_enrollment ON assigned_enrollment.student_id=st.id AND assigned_enrollment.is_active
          JOIN timetable_slots assigned_slot
            ON assigned_slot.class_section_id=assigned_enrollment.class_section_id
            AND assigned_slot.term_id=assigned_enrollment.term_id
            AND assigned_slot.teacher_user_id=m.user_id
          WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id
            AND m.role='staff' AND m.is_active
        )
      )
      ORDER BY st.id
    `.execute(this.db);
    return Promise.all(ids.rows.map(async (row) => this.studentDto(await this.studentForUser(user, row.id))));
  }

  async enrollment(studentId: string, onDate?: string): Promise<EnrollmentContext> {
    const result = await sql<EnrollmentContext>`
      SELECT e.id, e.class_section_id, e.term_id, e.roll_number, e.is_active,
        cs.grade, cs.section, cs.board, cs.room_number, t.academic_year, t.name AS term_name,
        cs.school_id, school.timezone AS school_timezone,
        (now() AT TIME ZONE school.timezone)::date::text AS school_date,
        t.starts_on, t.ends_on, t.attendance_threshold
      FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id
      JOIN academic_terms t ON t.id=e.term_id
      JOIN schools school ON school.id=cs.school_id
      WHERE e.student_id=${studentId}::uuid AND e.is_active
      ORDER BY CASE WHEN COALESCE(${onDate ?? null}::date, (now() AT TIME ZONE school.timezone)::date)
        BETWEEN t.starts_on AND t.ends_on THEN 0 ELSE 1 END,
        t.starts_on DESC LIMIT 1
    `.execute(this.db);
    const enrollment = result.rows[0];
    if (!enrollment) throw new NotFoundException("The student has no active enrollment.");
    return enrollment;
  }

  async studentDto(student: StudentContext, knownEnrollment?: EnrollmentContext) {
    const enrollment = knownEnrollment ?? await this.enrollment(student.id);
    return {
      id: student.id,
      person: {id:student.person_id,first_name:student.first_name,last_name:student.last_name,display_name:`${student.first_name} ${student.last_name}`.trim()},
      account: student.user_id ? {id:student.user_id,username:student.username,email:student.email} : null,
      // Backwards-compatible display container. A null id means no login exists.
      user: {
        id: student.user_id, username: student.username, email: student.email,
        first_name: student.first_name, last_name: student.last_name,
        display_name: `${student.first_name} ${student.last_name}`.trim(), role: "student",
      },
      school: { id: student.school_id, name: student.school_name, code: student.school_code },
      admission_number: student.admission_number,
      date_of_birth: student.date_of_birth,
      blood_group: student.blood_group,
      emergency_contact: student.emergency_contact,
      avatar_url: student.avatar_url,
      current_enrollment: {
        id: enrollment.id, class_name: `Class ${enrollment.grade}${enrollment.section}`,
        grade: enrollment.grade, section: enrollment.section, board: enrollment.board,
        room_number: enrollment.room_number, roll_number: enrollment.roll_number,
        is_active: enrollment.is_active,
        term: {
          id: enrollment.term_id, academic_year: enrollment.academic_year, name: enrollment.term_name,
          starts_on: enrollment.starts_on, ends_on: enrollment.ends_on,
          attendance_threshold: enrollment.attendance_threshold, is_active: true,
        },
      },
    };
  }

  async requireRole(user: AuthUser, student: StudentContext, role: "student" | "guardian" | "staff"): Promise<void> {
    let allowed = false;
    if (role === "student") {
      allowed = student.user_id === user.id && Boolean(await this.db.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", student.school_id).where("role", "=", "student").where("is_active", "=", true).executeTakeFirst());
    } else if (role === "guardian") {
      const found = await sql<{ ok: boolean }>`SELECT true AS ok FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=${student.school_id}::uuid WHERE p.user_id=${user.id}::uuid AND gr.student_id=${student.id}::uuid AND m.role='guardian' AND m.is_active LIMIT 1`.execute(this.db);
      allowed = Boolean(found.rows[0]?.ok);
    } else {
      allowed = Boolean(await this.db.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", student.school_id)
        .where("role", "in", ["staff", "admin"]).where("is_active", "=", true).executeTakeFirst());
    }
    if (!allowed) throw new ForbiddenException(`An active ${role} membership is required for this operation.`);
  }

  private async requireSchoolRole(user: AuthUser, roles: Array<"staff" | "admin">, schoolId?: string) {
    let query = this.db.selectFrom("school_memberships").select(["id", "school_id", "role"])
      .where("user_id", "=", user.id).where("role", "in", roles).where("is_active", "=", true);
    const scopedSchoolId = schoolId ?? user.active_school_id;
    if (scopedSchoolId) query = query.where("school_id", "=", scopedSchoolId);
    const memberships = await query.orderBy("role").execute();
    if (!scopedSchoolId && new Set(memberships.map((m) => m.school_id)).size > 1) {
      throw new BadRequestException("Select an active school before opening this workspace.");
    }
    const membership = memberships[0];
    if (!membership) throw new ForbiddenException(`An active ${roles.join(" or ")} membership is required.`);
    return membership;
  }

  private async schoolLocalDate(schoolId: string): Promise<string> {
    const result = await sql<{ date: string }>`
      SELECT (now() AT TIME ZONE timezone)::date::text AS date
      FROM schools WHERE id=${schoolId}::uuid
    `.execute(this.db);
    if (!result.rows[0]?.date) throw new NotFoundException("School not found.");
    return result.rows[0].date;
  }

  async attendanceSummary(studentId: string, term: EnrollmentContext): Promise<{ total: number; present: number; absent: number; late: number; excused: number; half_day: number; percentage: number }> {
    const result = await sql<{ total: string; present: string; absent: string; late: string; excused: string; half_day: string }>`
      SELECT count(*) FILTER (WHERE status <> 'excused')::text AS total,
        count(*) FILTER (WHERE status='present')::text AS present,
        count(*) FILTER (WHERE status='absent')::text AS absent,
        count(*) FILTER (WHERE status='late')::text AS late,
        count(*) FILTER (WHERE status='excused')::text AS excused,
        count(*) FILTER (WHERE status='half_day')::text AS half_day
      FROM attendance_records WHERE student_id=${studentId}::uuid
        AND date BETWEEN ${term.starts_on}::date AND LEAST(${term.ends_on}::date, ${term.school_date}::date)
    `.execute(this.db);
    const row = result.rows[0] ?? { total: "0", present: "0", absent: "0", late: "0", excused: "0", half_day: "0" };
    const values = { total: Number(row.total), present: Number(row.present), absent: Number(row.absent), late: Number(row.late), excused: Number(row.excused), half_day: Number(row.half_day) };
    const attended = values.present + values.late + values.half_day * 0.5;
    return { ...values, percentage: values.total ? Math.round(attended * 10_000 / values.total) / 100 : 0 };
  }

  async attendanceRecords(studentId: string, term?: EnrollmentContext) {
    let query = this.db.selectFrom("attendance_records").selectAll().where("student_id", "=", studentId);
    if (term) query = query.where("date", ">=", term.starts_on)
      .where("date", "<=", term.ends_on).where("date", "<=", term.school_date);
    const rows = await query.orderBy("date", "desc").execute();
    return rows.map((row) => ({ ...row, status_label: row.status.replace("_", " ").replace(/^./, (value) => value.toUpperCase()) }));
  }

  async latestGate(studentId: string, date?: string) {
    let query = this.db.selectFrom("gate_events").selectAll()
      .where("student_id", "=", studentId)
      .where("occurred_at", "<=", new Date());
    if (date) query = query.where(sql<boolean>`occurred_at::date = ${date}::date`);
    const row = await query.orderBy("occurred_at", "desc").executeTakeFirst();
    return row ? { ...row, direction_label: row.direction === "in" ? "Entry" : "Exit" } : null;
  }

  async dbGateEvents(studentId: string) {
    const rows = await this.db.selectFrom("gate_events").selectAll().where("student_id", "=", studentId)
      .orderBy("occurred_at", "desc").limit(100).execute();
    return rows.map((row) => ({ ...row, direction_label: row.direction === "in" ? "Entry" : "Exit" }));
  }

  async subjectAttendance(studentId: string, termId: string) {
    const result = await sql<any>`
      SELECT sa.id, sa.classes_held, sa.classes_attended, sa.classes_excused,
        CASE WHEN sa.classes_held-sa.classes_excused=0 THEN 0 ELSE round(sa.classes_attended*100.0/(sa.classes_held-sa.classes_excused), 2) END AS percentage,
        s.id AS subject_id, s.code, s.name, s.short_name, s.color, s.icon,
        next_slot.room, next_slot.weekday AS next_weekday, next_slot.starts_at AS next_starts_at,
        next_slot.teacher_user_id, next_slot.teacher_first_name, next_slot.teacher_last_name,
        next_slot.teacher_designation
      FROM subject_attendance sa
      JOIN subjects s ON s.id=sa.subject_id
      JOIN students subject_student ON subject_student.id=sa.student_id
      JOIN schools subject_school ON subject_school.id=subject_student.school_id
      LEFT JOIN LATERAL (
        SELECT ts.room, ts.weekday, ts.starts_at, ts.teacher_user_id, ts.teacher_designation,
          u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM enrollments e
        JOIN timetable_slots ts ON ts.class_section_id=e.class_section_id
          AND ts.term_id=e.term_id AND ts.subject_id=sa.subject_id
        LEFT JOIN users u ON u.id=ts.teacher_user_id
        WHERE e.student_id=sa.student_id AND e.term_id=sa.term_id AND e.is_active
        ORDER BY CASE
          WHEN ts.weekday=extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
            AND ts.starts_at > (current_timestamp AT TIME ZONE subject_school.timezone)::time THEN 0
          WHEN ts.weekday > extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
            THEN ts.weekday-extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
          ELSE 7-extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int+ts.weekday
        END, ts.starts_at
        LIMIT 1
      ) next_slot ON true
      WHERE sa.student_id=${studentId}::uuid AND sa.term_id=${termId}::uuid ORDER BY s.name
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id,
      subject: { id: row.subject_id, code: row.code, name: row.name, short_name: row.short_name, color: row.color, icon: row.icon },
      classes_held: row.classes_held, classes_attended: row.classes_attended,
      classes_excused: row.classes_excused, percentage: row.percentage,
      room: row.room || null,
      teacher: row.teacher_user_id ? {
        id: row.teacher_user_id,
        name: `${row.teacher_first_name} ${row.teacher_last_name}`.trim(),
        designation: row.teacher_designation,
      } : null,
      next_class: row.next_weekday ? {
        weekday: Number(row.next_weekday),
        weekday_label: weekdayLabels[Number(row.next_weekday)],
        starts_at: row.next_starts_at,
      } : null,
    }));
  }

  async classAttendanceRanking(studentId: string, enrollment: EnrollmentContext) {
    const result = await sql<any>`
      WITH attendance_scores AS (
        SELECT st.id AS student_id, st.avatar_url, e.roll_number, u.first_name, u.last_name,
          count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS recorded_days,
          array_agg(ar.status ORDER BY ar.date DESC) FILTER (WHERE ar.id IS NOT NULL AND ar.status <> 'excused') AS recent_statuses,
          COALESCE(sum(CASE
            WHEN ar.status IN ('present','late') THEN 1.0
            WHEN ar.status='half_day' THEN 0.5
            ELSE 0.0
          END), 0)::numeric AS attendance_points
        FROM enrollments e
        JOIN students st ON st.id=e.student_id
        JOIN school_people u ON u.id=st.person_id
        LEFT JOIN attendance_records ar ON ar.student_id=st.id
          AND ar.date BETWEEN ${enrollment.starts_on}::date AND LEAST(${enrollment.ends_on}::date, ${enrollment.school_date}::date)
        WHERE e.class_section_id=${enrollment.class_section_id}::uuid
          AND e.term_id=${enrollment.term_id}::uuid AND e.is_active
        GROUP BY st.id, st.avatar_url, e.roll_number, u.first_name, u.last_name
      ), eligible_scores AS (
        SELECT *, round(attendance_points * 100.0 / NULLIF(recorded_days, 0), 2) AS percentage
        FROM attendance_scores WHERE recorded_days >= 5
      ), ranked AS (
        SELECT *, dense_rank() OVER (
          ORDER BY percentage DESC, attendance_points DESC, recorded_days DESC
        )::int AS rank
        FROM eligible_scores
      )
      SELECT attendance_scores.*,
        round(attendance_scores.attendance_points * 100.0 / NULLIF(attendance_scores.recorded_days, 0), 2) AS percentage,
        ranked.rank
      FROM attendance_scores LEFT JOIN ranked ON ranked.student_id=attendance_scores.student_id
      ORDER BY ranked.rank NULLS LAST, attendance_scores.roll_number
    `.execute(this.db);
    const rows = result.rows.map((row) => {
      const recentStatuses = (row.recent_statuses ?? []) as string[];
      const firstMissedDay = recentStatuses.findIndex((status) => !["present", "late"].includes(status));
      return {
        student_id: row.student_id,
        avatar_url: row.avatar_url || null,
        rank: row.rank == null ? null : Number(row.rank),
        name: row.student_id === studentId
          ? `${row.first_name} ${row.last_name}`.trim()
          : `${row.first_name} ${String(row.last_name ?? "").slice(0, 1)}.`.trim(),
        attended: Number(row.attendance_points),
        held: Number(row.recorded_days),
        streak: firstMissedDay === -1 ? recentStatuses.length : firstMissedDay,
        percentage: row.percentage == null ? null : Number(row.percentage),
      };
    });
    const eligible = rows.filter((row) => row.rank !== null);
    const current = eligible.find((row) => row.student_id === studentId);
    const published = eligible.length > 1 && Boolean(current);
    return {
      published,
      as_of: enrollment.school_date,
      cohort_size: eligible.length,
      minimum_recorded_days: 5,
      methodology: "Daily attendance points: present or late = 1, half day = 0.5, absent = 0, and excused leave is excluded; ranked by percentage, then attendance points and recorded days.",
      current_rank: current?.rank ?? null,
      current_streak: current?.streak ?? 0,
      leaders: eligible.slice(0, 3).map((row) => ({
        rank: row.rank,
        name: row.name,
        avatar_url: row.avatar_url,
        attended: row.attended,
        held: row.held,
        streak: row.streak,
        percentage: row.percentage,
      })),
      students: published ? rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        avatar_url: row.avatar_url,
        attended: row.attended,
        held: row.held,
        streak: row.streak,
        percentage: row.percentage,
        is_current: row.student_id === studentId,
      })) : [],
    };
  }

  async timetable(enrollment: Pick<EnrollmentContext, "class_section_id" | "term_id">, weekday?: number, date?: string) {
    const result = await sql<any>`
      SELECT ts.*, s.code, s.name AS subject_name, s.short_name,
        u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
      FROM ${date?sql`effective_school_schedule((SELECT school_id FROM class_sections WHERE id=${enrollment.class_section_id}::uuid),${date}::date)`:sql`timetable_slots`} ts LEFT JOIN subjects s ON s.id=ts.subject_id
      LEFT JOIN users u ON u.id=ts.teacher_user_id
      WHERE ts.class_section_id=${enrollment.class_section_id}::uuid AND ts.term_id=${enrollment.term_id}::uuid
        AND (${weekday ?? null}::smallint IS NULL OR ts.weekday=${weekday ?? null}::smallint)
      ORDER BY ts.weekday, ts.period_number
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id, weekday: row.weekday, weekday_label: weekdayLabels[row.weekday],
      period_number: row.period_number, starts_at: row.starts_at, ends_at: row.ends_at,
      slot_type: row.slot_type, slot_type_label: String(row.slot_type).replace(/^./, (v: string) => v.toUpperCase()),
      display_title: row.day_plan_id?row.title:row.subject_name ?? row.title, title: row.title, room: row.room,
      subject: row.subject_id ? { id: row.subject_id, code: row.code, name: row.subject_name, short_name: row.short_name } : null,
      teacher: row.teacher_user_id ? { id: row.teacher_user_id, name: `${row.teacher_first_name} ${row.teacher_last_name}`.trim(), designation: row.teacher_designation } : null,
      cancelled: row.cancelled ?? false, materials: row.materials ?? [], day_plan_id: row.day_plan_id ?? null,
      plan_version: row.plan_version ?? null, notice: row.notice ?? '', date: date ?? null,
    }));
  }

  async dayPlanSummary(classId:string,date:string){
    return (await sql`SELECT d.id,d.date,d.published_version AS version,v.notice,v.published_at,
      (SELECT count(*)::int FROM day_plan_periods p WHERE p.plan_id=d.id AND p.version=d.published_version AND p.cancelled) AS cancelled_periods
      FROM day_plans d JOIN day_plan_versions v ON v.plan_id=d.id AND v.version=d.published_version
      WHERE d.class_section_id=${classId}::uuid AND d.date=${date}::date`.execute(this.db)).rows[0]??null;
  }

  async diaryItems(studentId: string, enrollment: EnrollmentContext, dateFrom?: string, dateTo?: string) {
    const result = await sql<any>`
      SELECT di.*, s.id AS subject_join_id, s.name AS subject_name, s.short_name,
        au.first_name AS author_first_name, au.last_name AS author_last_name,
        EXISTS(SELECT 1 FROM diary_acknowledgements da WHERE da.item_id=di.id AND da.student_id=${studentId}::uuid) AS acknowledged
      FROM diary_items di LEFT JOIN subjects s ON s.id=di.subject_id JOIN users au ON au.id=di.author_id
      WHERE di.class_section_id=${enrollment.class_section_id}::uuid AND di.term_id=${enrollment.term_id}::uuid
        AND di.published_at <= now()
        AND (${dateFrom ?? null}::date IS NULL OR di.date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR di.date <= ${dateTo ?? null}::date)
      ORDER BY di.date DESC, di.created_at DESC LIMIT 200
    `.execute(this.db);
    const items = [];
    for (const row of result.rows) {
      const notes = await sql<any>`
        SELECT dn.id, dn.body, dn.created_at, u.first_name, u.last_name
        FROM diary_notes dn JOIN users u ON u.id=dn.author_id
        WHERE dn.item_id=${row.id}::uuid AND dn.student_id=${studentId}::uuid ORDER BY dn.created_at
      `.execute(this.db);
      items.push({
        id: row.id, date: row.date, item_type: row.item_type,
        item_type_label: String(row.item_type).replace(/^./, (value: string) => value.toUpperCase()),
        subject: row.subject_join_id ? { id: row.subject_join_id, name: row.subject_name, short_name: row.short_name } : null,
        title: row.title, body: row.body,
        author_name: `${row.author_first_name} ${row.author_last_name}`.trim(), due_at: row.due_at,
        requires_acknowledgement: row.requires_acknowledgement, acknowledged: row.acknowledged,
        published_at: row.published_at,
        notes: notes.rows.map((note) => ({ id: note.id, author_name: `${note.first_name} ${note.last_name}`.trim(), body: note.body, created_at: note.created_at })),
      });
    }
    return items;
  }

  async contacts(schoolId: string) {
    return this.db.selectFrom("school_contacts").select(["id", "label", "name", "phone", "email", "availability"])
      .where("school_id", "=", schoolId).orderBy("priority").limit(5).execute();
  }

  async leaveDto(leaveId: string, request?: FastifyRequest) {
    const result = await sql<any>`
      SELECT lr.*, ru.first_name AS requester_first, ru.last_name AS requester_last,
        gu.first_name AS guardian_first, gu.last_name AS guardian_last,
        du.first_name AS decider_first, du.last_name AS decider_last
      FROM leave_requests lr JOIN users ru ON ru.id=lr.requested_by
      LEFT JOIN users gu ON gu.id=lr.guardian_authorized_by
      LEFT JOIN users du ON du.id=lr.decided_by WHERE lr.id=${leaveId}::uuid
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Leave request not found.");
    const [documents, audits] = await Promise.all([
      this.db.selectFrom("leave_documents").selectAll()
        .where("leave_request_id", "=", leaveId).orderBy("created_at").execute(),
      sql<any>`
        SELECT la.*, u.first_name, u.last_name FROM leave_audits la JOIN users u ON u.id=la.actor_id
        WHERE la.leave_request_id=${leaveId}::uuid ORDER BY la.created_at,
          CASE la.action WHEN 'submitted' THEN 0 WHEN 'document_added' THEN 1 WHEN 'clarification_requested' THEN 2 WHEN 'authorized' THEN 3 WHEN 'declined' THEN 3 WHEN 'approved' THEN 4 WHEN 'rejected' THEN 4 WHEN 'withdrawn' THEN 5 ELSE 9 END,
          la.id
      `.execute(this.db),
    ]);
    const origin = request ? `${request.protocol}://${request.headers.host}` : "";
    return {
      id: row.id, student_id: row.student_id, term_id: row.term_id,
      category: row.category, category_label: categoryLabels[row.category] ?? row.category,
      starts_on: dateOnly(row.starts_on), ends_on: dateOnly(row.ends_on),
      duration_days: daysInclusive(row.starts_on, row.ends_on), reason: row.reason,
      status: row.status, status_label: statusLabels[row.status] ?? row.status,
      requested_by_name: `${row.requester_first} ${row.requester_last}`.trim(), submitted_at: row.submitted_at,
      guardian_authorized_by_name: row.guardian_authorized_by ? `${row.guardian_first} ${row.guardian_last}`.trim() : null,
      guardian_authorized_at: row.guardian_authorized_at,
      decided_by_name: row.decided_by ? `${row.decider_first} ${row.decider_last}`.trim() : null,
      decided_at: row.decided_at,
      documents: documents.map((document) => ({
        id: document.id, original_name: document.original_name, content_type: document.content_type,
        size_bytes: document.size_bytes,
        file_url: `${origin}/api/v1/leave-requests/${leaveId}/documents/${document.id}/download/`,
        created_at: document.created_at,
      })),
      audit_log: audits.rows.map((audit) => ({
        id: audit.id, action: audit.action, action_label: actionLabels[audit.action] ?? audit.action,
        from_status: audit.from_status, to_status: audit.to_status, note: audit.note,
        actor_name: `${audit.first_name} ${audit.last_name}`.trim(), created_at: audit.created_at,
      })),
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  async leaveForUser(user: AuthUser, leaveId: string) {
    const row = await this.db.selectFrom("leave_requests").select(["id", "student_id", "status", "requested_by"])
      .where("id", "=", leaveId).executeTakeFirst();
    if (!row) throw new NotFoundException("Leave request not found.");
    const student = await this.studentForUser(user, row.student_id);
    return { leave: row, student };
  }

  async leaveList(user: AuthUser, studentId?: string, status?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    const valid = ["draft", "pending_guardian", "authorized", "declined", "school_approved", "school_rejected", "withdrawn"];
    if (status && !valid.includes(status)) throw new BadRequestException("Unknown leave status.");
    let query = this.db.selectFrom("leave_requests").select("id").where("student_id", "=", student.id);
    if (status) query = query.where("status", "=", status as LeaveStatus);
    const rows = await query.orderBy("created_at", "desc").execute();
    return Promise.all(rows.map((row) => this.leaveDto(row.id, request)));
  }

  private validateUpload(upload: UploadInput): void {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(upload.mimetype)) {
      throw new BadRequestException("Only PDF, JPEG, and PNG documents are accepted.");
    }
    if (upload.data.byteLength > 10 * 1024 * 1024) throw new BadRequestException("File must not exceed 10 MB.");
    if (!upload.data.byteLength) throw new BadRequestException("The uploaded document is empty.");
  }

  private async guardianRelationship(db: Db, userId: string, studentId: string, lock = false) {
    const result = await sql<{ id: string; can_authorize_leave: boolean; relationship: string }>`
      SELECT gr.id, guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date) AS can_authorize_leave, gr.relationship FROM guardian_relationships gr
      JOIN parents p ON p.id=gr.guardian_id JOIN students st ON st.id=gr.student_id
      JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id
      JOIN schools sc ON sc.id=st.school_id JOIN users u ON u.id=p.user_id AND u.is_active
      WHERE p.user_id=${userId}::uuid AND gr.student_id=${studentId}::uuid
        AND m.role='guardian' AND m.is_active LIMIT 1 ${lock ? sql`FOR SHARE OF gr,m,u` : sql``}
    `.execute(db);
    return result.rows[0] ?? null;
  }

  private async addLeaveAudit(db: Db, leaveId: string, actorId: string, action: any, fromStatus: string, toStatus: string, note = "") {
    await db.insertInto("leave_audits").values({ leave_request_id: leaveId, actor_id: actorId, action, from_status: fromStatus, to_status: toStatus, note: note.slice(0, 500) }).execute();
  }

  private async notify(db: Db, recipientId: string | null, input: { title: string; body: string; link: string; metadata: Record<string, unknown> }) {
    if (!recipientId) return; // A school person without an account cannot receive an app notification.
    await db.insertInto("notifications").values({ recipient_id: recipientId, kind: "leave", title: input.title, body: input.body.slice(0, 500), link: input.link, metadata: input.metadata, read_at: null }).execute();
  }

  private async leaveEventAudience(db: Db, student: StudentContext): Promise<string[]> {
    const result = await sql<{ user_id: string }>`
      SELECT DISTINCT audience.user_id FROM (
        SELECT ${student.user_id}::uuid AS user_id
        UNION
        SELECT p.user_id
        FROM guardian_relationships gr
        JOIN parents p ON p.id=gr.guardian_id
        JOIN users u ON u.id=p.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=p.user_id
          AND m.school_id=${student.school_id}::uuid AND m.role='guardian' AND m.is_active
        WHERE gr.student_id=${student.id}::uuid
        UNION
        SELECT m.user_id
        FROM school_memberships m
        JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${student.school_id}::uuid AND m.is_active
          AND (m.role='admin' OR (m.role='staff' AND EXISTS (
            SELECT 1
            FROM enrollments e
            JOIN timetable_slots slot ON slot.class_section_id=e.class_section_id
              AND slot.term_id=e.term_id AND slot.teacher_user_id=m.user_id
            WHERE e.student_id=${student.id}::uuid AND e.is_active
          )))
      ) audience WHERE audience.user_id IS NOT NULL
    `.execute(db);
    return result.rows.map((row) => row.user_id);
  }

  private async enqueueLeaveUpdate(db: Db, input: {
    student: StudentContext;
    leaveId: string;
    requestId: string;
    action: string;
    status: LeaveStatus;
    changedAttendanceDates?: string[];
  }): Promise<void> {
    const changedAttendanceDates = input.changedAttendanceDates ?? [];
    const refresh = [
      "student.leave", "student.home", "parent.leave", "parent.home",
      "notifications", "teacher.home", "principal.home",
      ...(changedAttendanceDates.length
        ? ["student.attendance", "parent.attendance", "teacher.attendance", "principal.attendance"]
        : []),
    ];
    await this.events.enqueueUserEvent(db, {
      schoolId: input.student.school_id,
      eventType: "leave.updated",
      aggregateType: "leave_request",
      aggregateId: input.leaveId,
      audienceUserIds: await this.leaveEventAudience(db, input.student),
      payload: {
        leave_request_id: input.leaveId,
        student_id: input.student.id,
        action: input.action,
        status: input.status,
        changed_attendance_dates: changedAttendanceDates,
        refresh,
      },
      idempotencyKey: `leave:${input.requestId}:${input.leaveId}:${input.action}:${input.status}`,
    });
  }

  private async leaveConstraints(termId: string) {
    const policy = await this.db.selectFrom("attendance_policies")
      .select("medical_document_after_days")
      .where("term_id", "=", termId)
      .executeTakeFirst();
    return {
      max_duration_days: 31,
      medical_document_after_days: policy?.medical_document_after_days ?? null,
      accepted_documents: ["application/pdf", "image/jpeg", "image/png"],
      max_document_size_bytes: 10 * 1024 * 1024,
    };
  }

  async createLeave(user: AuthUser, body: unknown, upload: UploadInput | undefined, request: FastifyRequest) {
    const data = leaveSchema.parse(body);
    const duration = daysInclusive(data.starts_on, data.ends_on);
    if (duration < 1) throw new BadRequestException("Leave must end on or after its start date.");
    if (duration > 31) throw new BadRequestException("A single leave request cannot exceed 31 calendar days.");
    if (upload) this.validateUpload(upload);
    const student = await this.studentForUser(user, data.student_id);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may submit this leave request.");
    const termResult = await sql<{ id: string }>`
      SELECT term.id
      FROM academic_terms term
      JOIN enrollments enrollment ON enrollment.term_id=term.id
        AND enrollment.student_id=${student.id}::uuid AND enrollment.is_active
      WHERE term.school_id=${student.school_id}::uuid
        AND term.starts_on <= ${data.starts_on}::date
        AND term.ends_on >= ${data.ends_on}::date
      ORDER BY term.is_active DESC, term.starts_on DESC
      LIMIT 1
    `.execute(this.db);
    const termId = termResult.rows[0]?.id;
    if (!termId) throw new BadRequestException("The full leave range must fall inside an active enrollment term.");
    const constraints = await this.leaveConstraints(termId);
    const medicalDocumentAfterDays = constraints.medical_document_after_days;
    if (data.category === "medical" && medicalDocumentAfterDays !== null && duration > medicalDocumentAfterDays && !upload) {
      throw new BadRequestException(
        `A supporting document is required for medical leave longer than ${medicalDocumentAfterDays} calendar days.`,
      );
    }

    let temporaryPath: string | undefined;
    let finalPath: string | undefined;
    let storageKey: string | undefined;
    if (upload) {
      await mkdir(config().uploadDir, { recursive: true, mode: 0o750 });
      const extension = [".pdf", ".jpg", ".jpeg", ".png"].includes(extname(upload.filename).toLowerCase()) ? extname(upload.filename).toLowerCase() : "";
      storageKey = `${randomUUID()}${extension}`;
      temporaryPath = join(config().uploadDir, `.${storageKey}.pending`);
      finalPath = join(config().uploadDir, storageKey);
      await writeFile(temporaryPath, upload.data, { flag: "wx", mode: 0o640 });
    }
    const requestId = (request as AuthenticatedRequest).requestId ?? randomUUID();
    try {
      const leaveId = await this.db.transaction().execute(async (trx) => {
        const currentGuardian = await this.guardianRelationship(trx, user.id, student.id, true);
        if (!self && !currentGuardian) throw new ForbiddenException("Your guardian access is no longer active.");
        const leave = await trx.insertInto("leave_requests").values({
          student_id: student.id, term_id: termId, requested_by: user.id, category: data.category,
          starts_on: data.starts_on, ends_on: data.ends_on, reason: data.reason,
          status: "pending_guardian", submitted_at: new Date(), guardian_authorized_by: null,
          guardian_authorized_at: null, decided_by: null, decided_at: null,
        }).returning("id").executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leave.id, user.id, "submitted", "draft", "pending_guardian", guardian ? "Leave request submitted by a guardian." : "Leave request submitted for guardian authorization.");
        let status: LeaveStatus = "pending_guardian";
        if (currentGuardian?.can_authorize_leave) {
          status = "authorized";
          await trx.updateTable("leave_requests").set({ status, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leave.id).execute();
          await this.addLeaveAudit(trx, leave.id, user.id, "authorized", "pending_guardian", status, "Guardian submitted and authorized the leave request.");
          await this.notify(trx, student.user_id, { title: "Leave request ready for school review", body: `${user.first_name} ${user.last_name} submitted and authorized the request; it is ready for school review.`, link: `/student/leave?leave_id=${leave.id}`, metadata: { leave_request_id: leave.id, student_id: student.id } });
        } else {
          const guardians = await sql<{ user_id: string }>`
            SELECT DISTINCT p.user_id
            FROM parents p
            JOIN guardian_relationships gr ON gr.guardian_id=p.id
            JOIN users u ON u.id=p.user_id AND u.is_active
            JOIN school_memberships m ON m.user_id=p.user_id
              AND m.school_id=${student.school_id}::uuid
              AND m.role='guardian' AND m.is_active
            JOIN schools sc ON sc.id=gr.school_id
            WHERE gr.student_id=${student.id}::uuid AND guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date)
          `.execute(trx);
          for (const recipient of guardians.rows) await this.notify(trx, recipient.user_id, {
            title: "Leave authorization required",
            body: `${student.first_name} ${student.last_name} submitted a ${duration}-day leave request.`,
            link: `/parent/leave?leave_id=${leave.id}&student_id=${student.id}`,
            metadata: { leave_request_id: leave.id, student_id: student.id },
          });
        }
        if (upload && storageKey && temporaryPath && finalPath) {
          await rename(temporaryPath, finalPath);
          temporaryPath = undefined;
          await trx.insertInto("leave_documents").values({ leave_request_id: leave.id, storage_key: storageKey, original_name: upload.filename.slice(0, 255), content_type: upload.mimetype, size_bytes: upload.data.byteLength, uploaded_by: user.id }).execute();
          await this.addLeaveAudit(trx, leave.id, user.id, "document_added", status, status, `Added ${upload.filename}`);
        }
        await this.enqueueLeaveUpdate(trx, {
          student, leaveId: leave.id, requestId, action: "created", status,
        });
        return leave.id;
      });
      return await this.leaveDto(leaveId, request);
    } catch (error) {
      if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
      if (finalPath) await unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  async addLeaveDocument(user: AuthUser, leaveId: string, upload: UploadInput, request: FastifyRequest) {
    this.validateUpload(upload);
    const scoped = await this.leaveForUser(user, leaveId);
    const self = scoped.student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, scoped.student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may add leave documents.");
    if (!["draft", "pending_guardian", "authorized"].includes(scoped.leave.status)) throw new BadRequestException("Documents cannot be added to a closed leave request.");
    await mkdir(config().uploadDir, { recursive: true, mode: 0o750 });
    const extension = [".pdf", ".jpg", ".jpeg", ".png"].includes(extname(upload.filename).toLowerCase()) ? extname(upload.filename).toLowerCase() : "";
    const storageKey = `${randomUUID()}${extension}`;
    const temporaryPath = join(config().uploadDir, `.${storageKey}.pending`);
    const finalPath = join(config().uploadDir, storageKey);
    await writeFile(temporaryPath, upload.data, { flag: "wx", mode: 0o640 });
    let moved = false;
    try {
      const document = await this.db.transaction().execute(async (trx) => {
        const locked = await sql<{ student_id: string; status: LeaveStatus }>`
          SELECT student_id, status FROM leave_requests WHERE id=${leaveId}::uuid FOR UPDATE
        `.execute(trx);
        const current = locked.rows[0];
        if (!current || current.student_id !== scoped.student.id) throw new NotFoundException("Leave request not found.");
        const currentGuardian = await this.guardianRelationship(trx, user.id, current.student_id);
        if (scoped.student.user_id !== user.id && !currentGuardian) {
          throw new ForbiddenException("Your authority to add a leave document has changed.");
        }
        if (!["draft", "pending_guardian", "authorized"].includes(current.status)) {
          throw new BadRequestException("Documents cannot be added to a closed leave request.");
        }
        await rename(temporaryPath, finalPath); moved = true;
        const row = await trx.insertInto("leave_documents").values({ leave_request_id: leaveId, storage_key: storageKey, original_name: upload.filename.slice(0, 255), content_type: upload.mimetype, size_bytes: upload.data.byteLength, uploaded_by: user.id }).returningAll().executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leaveId, user.id, "document_added", current.status, current.status, `Added ${upload.filename}`);
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student,
          leaveId,
          requestId: (request as AuthenticatedRequest).requestId ?? randomUUID(),
          action: "document_added",
          status: current.status,
        });
        return row;
      });
      const origin = `${request.protocol}://${request.headers.host}`;
      return { id: document.id, original_name: document.original_name, content_type: document.content_type, size_bytes: document.size_bytes, file_url: `${origin}/api/v1/leave-requests/${leaveId}/documents/${document.id}/download/`, created_at: document.created_at };
    } catch (error) {
      await unlink(moved ? finalPath : temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async leaveDocument(user: AuthUser, leaveId: string, documentId: string) {
    const scoped = await this.leaveForUser(user, leaveId);
    const self = scoped.student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, scoped.student.id);
    const administrator = await this.db.selectFrom("school_memberships").select("id")
      .where("user_id", "=", user.id).where("school_id", "=", scoped.student.school_id)
      .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!self && !guardian && !administrator) throw new ForbiddenException("Leave documents are limited to the family and authorized school administrators.");
    const document = await this.db.selectFrom("leave_documents").selectAll()
      .where("id", "=", documentId).where("leave_request_id", "=", leaveId).executeTakeFirst();
    if (!document) throw new NotFoundException("Leave document not found.");
    return { document, stream: createReadStream(join(config().uploadDir, document.storage_key)) };
  }

  private async applyApprovedLeaveAttendance(db: Db, input: {
    leaveId: string; studentId: string; schoolId: string; termId: string;
    startsOn: string; endsOn: string; actorId: string; requestId: string;
  }): Promise<string[]> {
    const enrollment = await db.selectFrom("enrollments").select(["class_section_id", "term_id"])
      .where("student_id", "=", input.studentId).where("term_id", "=", input.termId)
      .where("is_active", "=", true).executeTakeFirst();
    if (!enrollment) throw new BadRequestException("The student is not actively enrolled for the leave term.");
    const days = await sql<{ date: string }>`
      SELECT candidate.day::date::text AS date
      FROM generate_series(${input.startsOn}::date, ${input.endsOn}::date, interval '1 day') candidate(day)
      LEFT JOIN school_calendar_days calendar ON calendar.school_id=${input.schoolId}::uuid
        AND calendar.date=candidate.day::date
      WHERE COALESCE(calendar.is_instructional, EXISTS (
        SELECT 1 FROM timetable_slots slot
        WHERE slot.class_section_id=${enrollment.class_section_id}::uuid
          AND slot.term_id=${input.termId}::uuid
          AND slot.weekday=EXTRACT(ISODOW FROM candidate.day)::int
          AND slot.slot_type IN ('class','activity')
      ))
      ORDER BY candidate.day
    `.execute(db);
    const changedDates: string[] = [];
    for (const day of days.rows) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${enrollment.class_section_id}:${day.date}`}, 0))`.execute(db);
      const current = await db.selectFrom("attendance_records").selectAll()
        .where("student_id", "=", input.studentId).where("date", "=", day.date).executeTakeFirst();
      if (current && current.status !== "absent") continue;
      const registerRows = await sql<any>`
        SELECT * FROM attendance_registers WHERE class_section_id=${enrollment.class_section_id}::uuid
          AND term_id=${input.termId}::uuid AND date=${day.date}::date FOR UPDATE
      `.execute(db);
      const existingRegister = registerRows.rows[0];
      if (existingRegister?.state === "locked") {
        throw new ConflictException("Reopen the locked attendance register before approving leave for this date.");
      }
      const registerRevision = Number(existingRegister?.revision ?? 0) + 1;
      const now = new Date();
      const register = existingRegister
        ? await db.updateTable("attendance_registers").set({ revision: registerRevision, updated_at: now })
            .where("id", "=", existingRegister.id).returningAll().executeTakeFirstOrThrow()
        : await db.insertInto("attendance_registers").values({
            school_id: input.schoolId, class_section_id: enrollment.class_section_id,
            term_id: input.termId, date: day.date, state: "draft", revision: registerRevision,
            submitted_by: null, submitted_at: null, locked_by: null, locked_at: null,
            reopened_by: null, reopened_at: null, reopen_reason: null,
          }).returningAll().executeTakeFirstOrThrow();
      const saved = current
        ? await db.updateTable("attendance_records").set({
            status: "excused", remarks: `Approved leave ${input.leaveId}`,
            marked_by: input.actorId, revision: registerRevision,
            source_request_id: input.requestId, updated_at: now,
          }).where("id", "=", current.id).returningAll().executeTakeFirstOrThrow()
        : await db.insertInto("attendance_records").values({
            student_id: input.studentId, class_section_id: enrollment.class_section_id,
            date: day.date, status: "excused", remarks: `Approved leave ${input.leaveId}`,
            marked_by: input.actorId, revision: registerRevision,
            source_request_id: input.requestId,
          }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("attendance_record_revisions").values({
        attendance_record_id: saved.id, attendance_submission_id: null,
        attendance_register_id: register.id, school_id: input.schoolId,
        student_id: input.studentId, class_section_id: enrollment.class_section_id,
        date: day.date, previous_status: current?.status ?? null, new_status: "excused",
        previous_remarks: current?.remarks ?? null, new_remarks: saved.remarks,
        previous_check_in_at: current?.check_in_at ?? null, new_check_in_at: saved.check_in_at,
        previous_check_out_at: current?.check_out_at ?? null, new_check_out_at: saved.check_out_at,
        reason: "School-approved leave", changed_by: input.actorId,
        request_id: input.requestId, register_revision: registerRevision,
      }).execute();
      await this.events.enqueueAttendanceUpdates(db, {
        schoolId: input.schoolId, classSectionId: enrollment.class_section_id,
        termId: input.termId,
        date: day.date, requestId: input.requestId,
        records: [{ student_id: input.studentId, status: "excused", previous_status: current?.status ?? null, revision: registerRevision }],
        suppressNotifications: true,
      });
      changedDates.push(day.date);
    }
    if (changedDates.length) await this.refreshSubjectAttendance(db, [input.studentId]);
    return changedDates;
  }

  async performLeaveAction(user: AuthUser, leaveId: string, action: string, noteValue: unknown, request: FastifyRequest) {
    const note = z.string().max(500).optional().default("").parse(noteValue).trim();
    const requestId = (request as AuthenticatedRequest).requestId ?? randomUUID();
    const scoped = await this.leaveForUser(user, leaveId);
    const validActions = ["authorize", "clarify", "decline", "withdraw", "approve", "reject"];
    if (!validActions.includes(action)) throw new NotFoundException();

    await this.db.transaction().execute(async (trx) => {
      const lockedResult = await sql<{ status: LeaveStatus; requested_by: string; term_id: string; starts_on: string; ends_on: string }>`SELECT status, requested_by, term_id, starts_on::text, ends_on::text FROM leave_requests WHERE id=${leaveId}::uuid FOR UPDATE`.execute(trx);
      const locked = lockedResult.rows[0];
      if (!locked) throw new NotFoundException("Leave request not found.");
      const guardian = await this.guardianRelationship(trx, user.id, scoped.student.id, true);
      const isSchoolApprover = Boolean(await trx.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", scoped.student.school_id)
        .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
      if (["authorize", "clarify", "decline"].includes(action)) {
        if (!guardian?.can_authorize_leave) throw new ForbiddenException("You are not authorized to review leave for this student.");
        if (locked.status !== "pending_guardian") throw new BadRequestException("Only requests awaiting guardian authorization can be reviewed.");
      }
      if (action === "clarify") {
        if (!note) throw new BadRequestException("Explain what clarification the student should provide.");
        await this.addLeaveAudit(trx, leaveId, user.id, "clarification_requested", locked.status, locked.status, note);
        await this.notify(trx, scoped.student.user_id, { title: "Clarification requested for leave", body: `${user.first_name} ${user.last_name} requested clarification: ${note}`, link: `/student/leave?leave_id=${leaveId}`, metadata: { action: "clarify", leave_request_id: leaveId, student_id: scoped.student.id } });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: "clarification_requested", status: locked.status,
        });
        return;
      }
      if (action === "withdraw") {
        if (user.id !== locked.requested_by && !guardian) throw new ForbiddenException("Only the requester or a linked guardian may withdraw this request.");
        if (!["draft", "pending_guardian", "authorized"].includes(locked.status)) throw new BadRequestException("This leave request can no longer be withdrawn.");
        await trx.updateTable("leave_requests").set({ status: "withdrawn", updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, "withdrawn", locked.status, "withdrawn", note);
        await this.notify(trx, scoped.student.user_id, { title: "Leave request withdrawn", body: "The leave request has been withdrawn.", link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: "withdrawn", status: "withdrawn",
        });
        return;
      }
      if (["approve", "reject"].includes(action)) {
        if (!isSchoolApprover) throw new ForbiddenException("An active school administrator must decide a leave request.");
        if (locked.status !== "authorized") throw new BadRequestException("Guardian authorization is required before a school decision.");
        const next = action === "approve" ? "school_approved" : "school_rejected";
        await trx.updateTable("leave_requests").set({ status: next, decided_by: user.id, decided_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, action === "approve" ? "approved" : "rejected", locked.status, next, note);
        const changedAttendanceDates = action === "approve" ? await this.applyApprovedLeaveAttendance(trx, {
          leaveId, studentId: scoped.student.id, schoolId: scoped.student.school_id,
          termId: locked.term_id, startsOn: locked.starts_on, endsOn: locked.ends_on,
          actorId: user.id, requestId,
        }) : [];
        const guardianUsers = await sql<{ user_id: string }>`
          SELECT DISTINCT p.user_id FROM guardian_relationships gr
          JOIN parents p ON p.id=gr.guardian_id
          JOIN users u ON u.id=p.user_id AND u.is_active
          JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=${scoped.student.school_id}::uuid
            AND m.role='guardian' AND m.is_active
          WHERE gr.student_id=${scoped.student.id}::uuid
        `.execute(trx);
        const recipients = [scoped.student.user_id, ...guardianUsers.rows.map((row) => row.user_id)];
        const notification = {
          title: action === "approve" ? "Leave request approved" : "Leave request not approved",
          body: action === "approve"
            ? `The school approved the leave request${changedAttendanceDates.length ? ` and excused ${changedAttendanceDates.length} instructional day${changedAttendanceDates.length === 1 ? "" : "s"}` : ""}.`
            : "The school did not approve the leave request. Review the decision note or contact the office.",
        };
        for (const recipientId of recipients) await this.notify(trx, recipientId, {
          ...notification,
          link: recipientId === scoped.student.user_id ? `/student/leave?leave_id=${leaveId}` : `/parent/leave?leave_id=${leaveId}&student_id=${scoped.student.id}`,
          metadata: { leave_request_id: leaveId, student_id: scoped.student.id, status: next, changed_attendance_dates: changedAttendanceDates },
        });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: action === "approve" ? "approved" : "rejected",
          status: next,
          changedAttendanceDates,
        });
        return;
      }
      const next = action === "authorize" ? "authorized" : "declined";
      await trx.updateTable("leave_requests").set({ status: next, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
      await this.addLeaveAudit(trx, leaveId, user.id, action === "authorize" ? "authorized" : "declined", locked.status, next, note);
      await this.notify(trx, scoped.student.user_id, { title: action === "authorize" ? "Leave request authorized" : "Leave request declined", body: action === "authorize" ? `${user.first_name} ${user.last_name} authorized the request; it is ready for school review.` : `${user.first_name} ${user.last_name} declined the leave authorization request.`, link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
      await this.enqueueLeaveUpdate(trx, {
        student: scoped.student, leaveId, requestId,
        action: action === "authorize" ? "authorized" : "declined",
        status: next,
      });
    });
    return this.leaveDto(leaveId, request);
  }

  async acknowledgeDiary(user: AuthUser, itemId: string, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may acknowledge this item.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").selectAll().where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id).executeTakeFirst();
    if (!item) throw new NotFoundException("Diary item not found.");
    if (!item.requires_acknowledgement) throw new BadRequestException("This diary item does not require acknowledgement.");
    const existing = await this.db.selectFrom("diary_acknowledgements").selectAll().where("item_id", "=", itemId).where("student_id", "=", student.id).executeTakeFirst();
    if (existing) return { data: { id: existing.id, acknowledged_by_name: `${user.first_name} ${user.last_name}`.trim(), acknowledged_at: existing.acknowledged_at }, created: false };
    const created = await this.db.insertInto("diary_acknowledgements").values({ item_id: itemId, student_id: student.id, acknowledged_by: user.id }).returningAll().executeTakeFirstOrThrow();
    return { data: { id: created.id, acknowledged_by_name: `${user.first_name} ${user.last_name}`.trim(), acknowledged_at: created.acknowledged_at }, created: true };
  }

  async setHomeworkCompleted(user: AuthUser, itemId: string, studentId: string | undefined, completed: boolean) {
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may update homework.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").select("id").where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id)
      .where("item_type", "=", "homework").where("published_at", "<=", new Date()).executeTakeFirst();
    if (!item) throw new NotFoundException("Homework not found.");
    if (completed) {
      await this.db.insertInto("homework_completions").values({ item_id: itemId, student_id: student.id, completed_by: user.id })
        .onConflict((conflict) => conflict.columns(["item_id", "student_id"]).doNothing()).execute();
    } else {
      await this.db.deleteFrom("homework_completions").where("item_id", "=", itemId).where("student_id", "=", student.id).execute();
    }
    return { item_id: itemId, student_id: student.id, completed };
  }

  async addDiaryNote(user: AuthUser, itemId: string, studentId: string | undefined, bodyValue: unknown) {
    const body = z.string().trim().min(2).max(2000).parse(bodyValue);
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may add a diary note.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").select("id").where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id).executeTakeFirst();
    if (!item) throw new NotFoundException("Diary item not found.");
    const note = await this.db.insertInto("diary_notes").values({ item_id: itemId, student_id: student.id, author_id: user.id, body }).returningAll().executeTakeFirstOrThrow();
    return { id: note.id, author_name: `${user.first_name} ${user.last_name}`.trim(), body: note.body, created_at: note.created_at };
  }

  async notifications(user: AuthUser, rawPage: { limit?: string | undefined; cursor?: string | undefined } = {}) {
    const page = notificationPageSchema.parse(rawPage);
    const after = notificationCursor(page.cursor);
    let query = this.db.selectFrom("notifications")
      .select(["id", "kind", "title", "body", "link", "metadata", "read_at", "created_at"])
      .where("recipient_id", "=", user.id);
    if (after) {
      query = query.where((expression) => expression.or([
        expression("created_at", "<", after.createdAt),
        expression.and([
          expression("created_at", "=", after.createdAt),
          expression("id", "<", after.id),
        ]),
      ]));
    }
    const [rows, unread] = await Promise.all([
      query.orderBy("created_at", "desc").orderBy("id", "desc").limit(page.limit + 1).execute(),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count"))
        .where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
    ]);
    const results = rows.slice(0, page.limit);
    return {
      results,
      unread_count: Number(unread?.count ?? 0),
      next_cursor: rows.length > page.limit && results.length
        ? encodeNotificationCursor(results[results.length - 1]!)
        : null,
    };
  }

  async markNotificationRead(user: AuthUser, id: string) {
    const row = await this.db.updateTable("notifications").set({ read_at: new Date() }).where("id", "=", id)
      .where("recipient_id", "=", user.id).returning(["id", "read_at"]).executeTakeFirst();
    if (!row) throw new NotFoundException("Notification not found.");
    return row;
  }

  async parentHome(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "guardian"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [summary, campus, schedule, diary, contacts, siblings, unread, pending, homework, recentAttendance, ranking, homeworkItems] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.diaryItems(student.id, enrollment, schoolDate, schoolDate),
      this.contacts(student.school_id),
      this.accessibleStudentDtos(user),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count")).where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
      this.db.selectFrom("leave_requests").select("id").where("student_id", "=", student.id).where("status", "=", "pending_guardian").orderBy("created_at", "desc").executeTakeFirst(),
      this.db.selectFrom("diary_items").select([
        sql<string>`count(*) FILTER (WHERE published_at >= now() - interval '30 days')::text`.as("recent"),
        sql<string>`count(*) FILTER (WHERE published_at >= now() - interval '60 days' AND published_at < now() - interval '30 days')::text`.as("previous"),
      ])
        .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id)
        .where("item_type", "=", "homework").where("published_at", "<=", new Date()).executeTakeFirst(),
      this.db.selectFrom("attendance_records").select("status")
        .where("student_id", "=", student.id).where("date", ">=", enrollment.starts_on)
        .where("date", "<=", enrollment.ends_on).where("date", "<=", schoolDate)
        .where("status", "!=", "excused")
        .orderBy("date", "desc").limit(20).execute(),
      this.classAttendanceRanking(student.id, enrollment),
      this.db.selectFrom("diary_items as item")
        .leftJoin("homework_completions as completion", (join) => join.onRef("completion.item_id", "=", "item.id").on("completion.student_id", "=", student.id))
        .leftJoin("subjects as subject", "subject.id", "item.subject_id")
        .select(["item.id", "item.title", "item.body", "item.due_at", "item.published_at", "subject.name as subject_name", "completion.completed_at"])
        .where("item.class_section_id", "=", enrollment.class_section_id).where("item.term_id", "=", enrollment.term_id)
        .where("item.item_type", "=", "homework").where("item.published_at", "<=", new Date())
        .orderBy("item.published_at", "desc").execute(),
    ]);
    const sampleSize = Math.min(10, Math.floor(recentAttendance.length / 2));
    const attendanceScore = (statuses: typeof recentAttendance) => statuses.reduce((score, item) =>
      score + (item.status === "present" || item.status === "late" ? 1 : item.status === "half_day" ? 0.5 : 0), 0) * 100 / statuses.length;
    const attendanceTrend = sampleSize >= 3 ? Math.round((
      attendanceScore(recentAttendance.slice(0, sampleSize)) - attendanceScore(recentAttendance.slice(sampleSize, sampleSize * 2))
    ) * 10) / 10 : null;
    const recentHomework = Number(homework?.recent ?? 0);
    const previousHomework = Number(homework?.previous ?? 0);
    const actionRequired = pending ? await this.leaveDto(pending.id) : null;
    return {
      student: await this.studentDto(student, enrollment), siblings: siblings.filter((item) => item.id !== student.id),
      campus_presence: campus, attendance: summary,
      ranking,
      action_required: actionRequired,
      today_schedule: schedule, day_plan:await this.dayPlanSummary(enrollment.class_section_id,schoolDate), diary_preview: diary.slice(0, 3), unread_notifications: Number(unread?.count ?? 0),
      homework_items: homeworkItems,
      semester_metrics: {
        attendance_percentage: summary.percentage,
        attendance_threshold: Number(enrollment.attendance_threshold),
        attendance_trend_percent: attendanceTrend,
        attendance_rank: ranking.published ? ranking.current_rank : null,
        attendance_cohort_size: ranking.published ? ranking.cohort_size : null,
        periods_today: schedule.length,
        homework_due: homeworkItems.filter((item) => !item.completed_at).length,
        homework_total: homeworkItems.length,
        homework_recent: recentHomework,
        homework_previous: previousHomework,
        dues_status: "All Cleared",
        dues_status_scope: "display_only_demo",
      },
      contacts,
    };
  }

  async parentAttendance(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "guardian"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [records, schedule, summary, latestGate, contacts, ranking] = await Promise.all([
      this.attendanceRecords(student.id, enrollment),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.contacts(student.school_id),
      this.classAttendanceRanking(student.id, enrollment),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: { id: enrollment.term_id, name: enrollment.term_name, academic_year: enrollment.academic_year, threshold: enrollment.attendance_threshold },
      summary,
      ranking,
      today: records.find((row) => row.date === schoolDate) ?? null,
      latest_gate_event: latestGate,
      expected_dismissal_at: schedule.filter(p=>!p.cancelled).at(-1)?.ends_at ?? null,
      calendar: records,
      contacts,
    };
  }

  async parentDiary(user: AuthUser, studentId?: string, selectedDateValue?: string) {
    const student = await this.studentForUser(user, studentId);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(student.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    await this.requireRole(user, student, "guardian");
    const enrollment = await this.enrollment(student.id, selectedDate);
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    return {
      student: await this.studentDto(student), date: selectedDate,
      items: await this.diaryItems(student.id, enrollment, selectedDate, selectedDate),
      schedule: (await this.timetable(enrollment, isoWeekday(selectedDate),selectedDate)).filter(p=>!p.cancelled),
      guardian: {
        name: `${user.first_name} ${user.last_name}`.trim() || user.username,
        relationship: guardian?.relationship ?? "guardian",
        verified_id: user.username,
      },
    };
  }

  async parentLeave(user: AuthUser, leaveId: string, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "guardian");
    const leave = await this.db.selectFrom("leave_requests").select(["id", "status", "term_id"]).where("id", "=", leaveId).where("student_id", "=", student.id).executeTakeFirst();
    if (!leave) throw new NotFoundException("Leave request not found.");
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    return {
      student: await this.studentDto(student),
      request: await this.leaveDto(leave.id, request),
      can_authorize: Boolean(guardian?.can_authorize_leave && leave.status === "pending_guardian"),
      constraints: await this.leaveConstraints(leave.term_id),
    };
  }

  async studentAttendanceScreen(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "student"), this.enrollment(student.id)]);
    const [summary, subjects, ranking] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.subjectAttendance(student.id, enrollment.term_id),
      this.classAttendanceRanking(student.id, enrollment),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: { id: enrollment.term_id, name: enrollment.term_name, academic_year: enrollment.academic_year, threshold: enrollment.attendance_threshold },
      summary,
      subjects,
      ranking,
    };
  }

  async studentHomeScreen(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "student"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [attendance, records, campus, schedule, diary, activeLeaves, unread] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.attendanceRecords(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.diaryItems(student.id, enrollment, schoolDate, schoolDate),
      this.db.selectFrom("leave_requests").select(sql<string>`count(*)::text`.as("count"))
        .where("student_id", "=", student.id).where("status", "in", ["pending_guardian", "authorized"]).executeTakeFirst(),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count"))
        .where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: {
        id: enrollment.term_id,
        name: enrollment.term_name,
        academic_year: enrollment.academic_year,
        threshold: enrollment.attendance_threshold,
      },
      date: schoolDate,
      attendance,
      today_attendance: records.find((record) => record.date === schoolDate) ?? null,
      campus_presence: campus,
      today_schedule: schedule,
      day_plan: await this.dayPlanSummary(enrollment.class_section_id,schoolDate),
      diary_preview: diary.slice(0, 4),
      active_leave_count: Number(activeLeaves?.count ?? 0),
      unread_notifications: Number(unread?.count ?? 0),
    };
  }

  async eligibilityScreen(user: AuthUser, studentId?: string, subjectId?: string, additionalMissedValue = "1") {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const enrollment = await this.enrollment(student.id);
    const additionalMissed = Number(additionalMissedValue);
    if (!Number.isInteger(additionalMissed) || additionalMissed < 0 || additionalMissed > 30) throw new BadRequestException("additional_missed must be an integer from 0 to 30.");
    const subjects = await this.subjectAttendance(student.id, enrollment.term_id);
    const subject = subjectId ? subjects.find((item) => item.subject.id === subjectId) : [...subjects].sort((a, b) => Number(a.percentage) - Number(b.percentage))[0];
    if (!subject) throw new NotFoundException("No subject attendance has been recorded.");
    const policy = await this.db.selectFrom("attendance_policies").selectAll().where("term_id", "=", enrollment.term_id).executeTakeFirst();
    const threshold = Number(policy?.minimum_percentage ?? enrollment.attendance_threshold);
    const projected = subject.classes_held + additionalMissed ? Math.round(subject.classes_attended * 10_000 / (subject.classes_held + additionalMissed)) / 100 : 0;
    return {
      student: await this.studentDto(student), subject,
      projection: { additional_missed: additionalMissed, projected_percentage: projected, eligible: projected >= threshold, threshold, is_advisory: true },
      policy: { name: policy?.name ?? "Term attendance requirement", minimum_percentage: threshold, medical_document_after_days: policy?.medical_document_after_days ?? null, text: policy?.policy_text ?? "" },
    };
  }

  async timetableScreen(user: AuthUser, mode: string, studentId?: string, selectedDateValue?: string, portal: "student" | "guardian" = "student") {
    if (!['day', 'week'].includes(mode)) throw new NotFoundException();
    const student = await this.studentForUser(user, studentId);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(student.school_id);
    z.iso.date().parse(selectedDate);
    await this.requireRole(user, student, portal);
    const enrollment = await this.enrollment(student.id, selectedDate);
    const monday=new Date(`${selectedDate}T00:00:00Z`);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    const dates=mode==='day'?[selectedDate]:Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
    const slots=(await Promise.all(dates.map(d=>this.timetable(enrollment,undefined,d)))).flat();
    const grouped = new Map<number, any[]>();
    for (const slot of slots) grouped.set(slot.weekday, [...(grouped.get(slot.weekday) ?? []), slot]);
    return {
      student: await this.studentDto(student,enrollment), mode, selected_date: selectedDate,
      class_name: `Class ${enrollment.grade}${enrollment.section}`,
      day_plan: await this.dayPlanSummary(enrollment.class_section_id,selectedDate),
      days: [...grouped.entries()].sort(([left], [right]) => left - right).map(([weekday, periods]) => ({ weekday, weekday_label: weekdayLabels[weekday], periods })),
    };
  }

  async leaveApplyScreen(user: AuthUser, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const enrollment = await this.enrollment(student.id);
    const guardians = await sql<any>`SELECT gr.id, gr.relationship, gr.is_primary,
      guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date) AS can_authorize_leave,
      p.id AS parent_id, u.contact_phone AS phone, p.user_id, u.first_name, u.last_name, u.contact_email AS email
      FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
      JOIN schools sc ON sc.id=gr.school_id
      JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${student.school_id}::uuid
      JOIN school_people u ON u.id=gp.person_id WHERE gr.student_id=${student.id}::uuid ORDER BY gr.is_primary DESC`.execute(this.db);
    const recent = (await this.leaveList(user, student.id, undefined, request)).slice(0, 3);
    return {
      student: await this.studentDto(student),
      categories: Object.entries(categoryLabels).map(([value, label]) => ({ value, label })),
      guardians: guardians.rows.map((row) => ({ id: row.id, relationship: row.relationship, is_primary: row.is_primary, can_authorize_leave: row.can_authorize_leave, guardian: { id: row.parent_id, user_id: row.user_id, name: `${row.first_name} ${row.last_name}`.trim(), email: row.email, phone: row.phone } })),
      recent_requests: recent,
      constraints: await this.leaveConstraints(enrollment.term_id),
    };
  }

  async leaveStatusScreen(user: AuthUser, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const leaves = await this.leaveList(user, student.id, undefined, request);
    return { student: await this.studentDto(student), active: leaves.filter((item) => ["pending_guardian", "authorized"].includes(item.status)), history: leaves.filter((item) => !["pending_guardian", "authorized"].includes(item.status)) };
  }

  async teacherHomeScreen(user: AuthUser, selectedDateValue?: string) {
    const membership = await this.requireSchoolRole(user, ["staff", "admin"]);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(membership.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const classes = await attendanceWorkspace(this.db, membership.school_id, user.id, membership.role, selectedDate);
    const weekly = await sql<any>`
      SELECT ts.id, ts.weekday, ts.period_number, ts.starts_at, ts.ends_at, ts.room,
        COALESCE(s.name, ts.title) AS subject_name, cs.id AS class_section_id, cs.grade, cs.section
      FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id
      JOIN academic_terms t ON t.id=ts.term_id AND ${selectedDate}::date BETWEEN t.starts_on AND t.ends_on
      LEFT JOIN subjects s ON s.id=ts.subject_id
      WHERE cs.school_id=${membership.school_id}::uuid
        AND (${membership.role}='admin' OR ts.teacher_user_id=${user.id}::uuid)
      ORDER BY ts.weekday, ts.period_number, cs.grade, cs.section
    `.execute(this.db);
    return {
      date: selectedDate,
      teacher: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim(), role: membership.role },
      classes,
      weekly_timetable: weekly.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, weekday_label: weekdayLabels[row.weekday] })),
    };
  }

  async teacherAttendanceScreen(user: AuthUser, classSectionId: string | undefined, selectedDateValue?: string) {
    if (!classSectionId) throw new BadRequestException("class_section_id is required.");
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(target.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const section = await this.db.selectFrom("class_sections as cs")
      .innerJoin("academic_terms as t", (join) => join
        .onRef("t.school_id", "=", "cs.school_id")
        .onRef("t.academic_year", "=", "cs.academic_year"))
      .select(["cs.id", "cs.school_id", "cs.grade", "cs.section", "cs.room_number", "cs.board", "t.id as term_id", "t.name as term_name", "t.academic_year", "t.starts_on", "t.ends_on"])
      .where("cs.id", "=", classSectionId)
      .where("t.starts_on", "<=", selectedDate)
      .where("t.ends_on", ">=", selectedDate)
      .orderBy("t.starts_on", "desc")
      .executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["staff", "admin"], section.school_id);
    if (membership.role !== "admin") {
      const assigned = await this.db.selectFrom("timetable_slots").select("id")
        .where("class_section_id", "=", classSectionId).where("term_id", "=", section.term_id)
        .where("teacher_user_id", "=", user.id).executeTakeFirst();
      const substitute=(await sql`SELECT id FROM effective_school_schedule(${section.school_id}::uuid,${selectedDate}::date) WHERE class_section_id=${classSectionId}::uuid AND term_id=${section.term_id}::uuid AND teacher_user_id=${user.id}::uuid AND NOT cancelled AND coverage_status='accepted' LIMIT 1`.execute(this.db)).rows[0];
      if (!assigned&&!substitute) throw new ForbiddenException("This class is not assigned to the signed-in teacher.");
    }
    const [roster, register] = await Promise.all([sql<any>`
      SELECT st.id AS student_id, st.admission_number, st.avatar_url, e.roll_number,
        u.first_name, u.last_name, ar.id AS attendance_id, ar.status, ar.remarks,
        ar.revision AS attendance_revision, ar.updated_at
      FROM enrollments e JOIN students st ON st.id=e.student_id JOIN school_people u ON u.id=st.person_id
      LEFT JOIN attendance_records ar ON ar.student_id=st.id AND ar.date=${selectedDate}::date
      WHERE e.class_section_id=${classSectionId}::uuid AND e.term_id=${section.term_id}::uuid AND e.is_active
        AND e.enrolled_on<=${selectedDate}::date
      ORDER BY e.roll_number
    `.execute(this.db), this.db.selectFrom("attendance_registers")
      .selectAll().where("class_section_id", "=", classSectionId)
      .where("term_id", "=", section.term_id).where("date", "=", selectedDate).executeTakeFirst()]);
    const periods = await this.timetable({
      class_section_id: classSectionId,
      term_id: section.term_id,
    }, isoWeekday(selectedDate),selectedDate);
    const dayPolicy = await attendanceDayPolicy(
      this.db,
      section.school_id,
      classSectionId,
      section.term_id,
      selectedDate,
      { userId: user.id, role: membership.role },
    );
    const hasRoster = roster.rows.length > 0;
    const canMark = Boolean(
      dayPolicy?.completed
      && dayPolicy?.instructional
      && dayPolicy?.actor_scheduled
      && hasRoster,
    );
    return {
      date: selectedDate,
      availability: {
        can_mark: canMark,
        reason: !dayPolicy?.completed
          ? "Attendance opens on the selected date."
          : !dayPolicy?.instructional
            ? "No attendance is required because this class has no scheduled lesson."
            : !hasRoster
              ? "No enrolled students require attendance for this date."
              : !dayPolicy?.actor_scheduled
                ? "You have no scheduled or accepted cover period for this class on this date."
                : null,
      },
      class: { id: section.id, school_id: section.school_id, term_id: section.term_id, name: `Class ${section.grade}${section.section}`, grade: section.grade, section: section.section, room: section.room_number, board: section.board, term: `${section.term_name} • ${section.academic_year}`, term_starts_on: section.starts_on, term_ends_on: section.ends_on },
      register: register ? {
        id: register.id, state: register.state, revision: register.revision,
        submitted_by: register.submitted_by, submitted_at: register.submitted_at,
        submitted_by_name: dayPolicy?.submitted_by_name ?? null,
        locked_by: register.locked_by, locked_at: register.locked_at,
        reopened_by: register.reopened_by, reopened_at: register.reopened_at,
        reopen_reason: register.reopen_reason,
      } : {
        id: null, state: "draft" as const, revision: 0, submitted_by: null,
        submitted_at: null, locked_by: null, locked_at: null,
        reopened_by: null, reopened_at: null, reopen_reason: null,
      },
      periods,
      roster: roster.rows.map((row) => ({
        id: row.student_id, admission_number: row.admission_number, avatar_url: row.avatar_url,
        roll_number: row.roll_number, name: `${row.first_name} ${row.last_name}`.trim(),
        status: row.status ?? null, remarks: row.remarks ?? "", attendance_id: row.attendance_id,
        attendance_revision: Number(row.attendance_revision ?? 0), updated_at: row.updated_at,
      })),
    };
  }

  async refreshSubjectAttendance(db: Db, studentIds: string[]): Promise<void> {
    if (!studentIds.length) return;
    await sql`
      DELETE FROM subject_attendance sa
      USING enrollments e
      WHERE sa.student_id=e.student_id AND sa.term_id=e.term_id AND e.is_active
        AND e.student_id=ANY(${studentIds}::uuid[])
    `.execute(db);
    await sql`
      WITH recorded_days AS (
        SELECT DISTINCT student.school_id,ar.date FROM attendance_records ar JOIN students student ON student.id=ar.student_id
        WHERE ar.student_id=ANY(${studentIds}::uuid[])
      ), scheduled_slots AS (
        SELECT slot.*,days.date,
          row_number() OVER (
            PARTITION BY slot.class_section_id, slot.term_id, days.date
            ORDER BY slot.period_number, slot.starts_at, slot.id
          )::int AS instructional_index,
          count(*) OVER (
            PARTITION BY slot.class_section_id, slot.term_id, days.date
          )::int AS instructional_count
        FROM recorded_days days CROSS JOIN LATERAL effective_school_schedule(days.school_id,days.date) slot
        WHERE slot.slot_type='class' AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
      )
      INSERT INTO subject_attendance (student_id, subject_id, term_id, classes_held, classes_attended, classes_excused)
      SELECT e.student_id, ts.subject_id, e.term_id,
        count(*)::int AS classes_held,
        count(*) FILTER (WHERE
          ar.status IN ('present','late')
          OR (
            ar.status='half_day'
            AND ar.check_out_at IS NOT NULL
            AND (ar.check_out_at AT TIME ZONE school.timezone)::date=ar.date
            AND (ar.check_out_at AT TIME ZONE school.timezone)::time >= ts.ends_at
          ) OR (
            ar.status='half_day'
            AND ar.check_out_at IS NULL
            AND ts.instructional_index * 2 <= ts.instructional_count + 1
          )
        )::int AS classes_attended,
        count(*) FILTER (WHERE ar.status='excused')::int AS classes_excused
      FROM enrollments e
      JOIN academic_terms term ON term.id=e.term_id
      JOIN class_sections section ON section.id=e.class_section_id
      JOIN schools school ON school.id=section.school_id
      JOIN attendance_records ar ON ar.student_id=e.student_id
        AND ar.class_section_id=e.class_section_id
        AND ar.date BETWEEN term.starts_on
          AND LEAST(term.ends_on, (now() AT TIME ZONE school.timezone)::date)
      JOIN scheduled_slots ts ON ts.class_section_id=e.class_section_id AND ts.term_id=e.term_id
        AND ts.date=ar.date AND ar.date>=e.enrolled_on
      WHERE e.is_active AND e.student_id=ANY(${studentIds}::uuid[])
      GROUP BY e.student_id, ts.subject_id, e.term_id
      ON CONFLICT (student_id, subject_id, term_id) DO UPDATE SET
        classes_held=EXCLUDED.classes_held,
        classes_attended=EXCLUDED.classes_attended,
        classes_excused=EXCLUDED.classes_excused
    `.execute(db);
    await sql`
      INSERT INTO subject_attendance (
        student_id, subject_id, term_id,
        classes_held, classes_attended, classes_excused
      )
      SELECT DISTINCT enrollment.student_id, slot.subject_id, enrollment.term_id, 0, 0, 0
      FROM enrollments enrollment
      JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
        AND slot.term_id=enrollment.term_id
        AND slot.slot_type='class' AND slot.subject_id IS NOT NULL
      WHERE enrollment.is_active
        AND enrollment.student_id=ANY(${studentIds}::uuid[])
      ON CONFLICT (student_id, subject_id, term_id) DO NOTHING
    `.execute(db);
  }

  async saveTeacherAttendance(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceBulkSchema.parse(body);
    const rawIdempotencyKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey;
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header (8–128 safe characters) is required.");
    }
    const screen = await this.teacherAttendanceScreen(user, data.class_section_id, data.date);
    const membership = await this.requireSchoolRole(user, ["staff", "admin"], screen.class.school_id);
    const rosterIds = new Set(screen.roster.map((student) => student.id));
    if (data.records.some((record) => !rosterIds.has(record.student_id))) throw new BadRequestException("Every attendance record must belong to the selected class roster.");
    if (new Set(data.records.map((record) => record.student_id)).size !== data.records.length) throw new BadRequestException("A student may only appear once in an attendance submission.");
    if (data.records.length !== rosterIds.size) throw new BadRequestException("Mark every student before submitting the class register.");
    if (data.date < screen.class.term_starts_on || data.date > screen.class.term_ends_on) {
      throw new BadRequestException("Attendance can only be submitted inside the selected class term.");
    }
    const canonical = {
      class_section_id: data.class_section_id,
      date: data.date,
      expected_revision: data.expected_revision,
      photo_session_id: data.photo_session_id ?? null,
      reason: data.reason ?? "",
      records: [...data.records].sort((a, b) => a.student_id.localeCompare(b.student_id)),
    };
    const requestHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");

    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${membership.school_id}:${user.id}:${idempotencyKey}`}, 0))`.execute(tx);
      const duplicate = await tx.selectFrom("attendance_submissions").select(["request_hash", "result_body"])
        .where("school_id", "=", membership.school_id).where("submitted_by", "=", user.id)
        .where("idempotency_key", "=", idempotencyKey).executeTakeFirst();
      if (duplicate) {
        if (duplicate.request_hash !== requestHash) {
          throw new ConflictException({ message: "This Idempotency-Key was already used for different attendance data.", code: "idempotency_conflict" });
        }
        return duplicate.result_body;
      }
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${data.class_section_id}:${data.date}`}, 0))`.execute(tx);
      // Re-check authorization and the roster after acquiring the write lock.
      // The screen read above is only a UX preflight; it must never authorize
      // a command after a concurrent membership, assignment, or enrollment
      // change. Locking the class also blocks new FK-backed enrollments until
      // this register transaction commits.
      const lockedClass = await sql<{ id: string }>`
        SELECT section.id
        FROM class_sections section
        WHERE section.id=${data.class_section_id}::uuid
          AND section.school_id=${membership.school_id}::uuid
        FOR UPDATE
      `.execute(tx);
      if (!lockedClass.rows[0]) throw new NotFoundException("Class section not found.");
      const currentMembership = await sql<{ role: "staff" | "admin" }>`
        SELECT current_membership.role
        FROM school_memberships current_membership
        JOIN users account ON account.id=current_membership.user_id AND account.is_active
        WHERE current_membership.user_id=${user.id}::uuid
          AND current_membership.school_id=${membership.school_id}::uuid
          AND current_membership.role IN ('staff','admin')
          AND current_membership.is_active
        FOR SHARE OF current_membership
      `.execute(tx);
      const currentRole = currentMembership.rows[0]?.role;
      if (!currentRole) throw new ForbiddenException("An active school staff membership is required.");
      if (currentRole !== "admin") {
        const currentAssignment = await sql<{ id: string }>`
          SELECT slot.id
          FROM timetable_slots slot
          WHERE slot.class_section_id=${data.class_section_id}::uuid
            AND slot.term_id=${screen.class.term_id}::uuid
            AND slot.teacher_user_id=${user.id}::uuid
          ORDER BY slot.id
          LIMIT 1
          FOR SHARE OF slot
        `.execute(tx);
        const currentSubstitute=(await sql`SELECT id FROM effective_school_schedule(${membership.school_id}::uuid,${data.date}::date) WHERE class_section_id=${data.class_section_id}::uuid AND term_id=${screen.class.term_id}::uuid AND teacher_user_id=${user.id}::uuid AND NOT cancelled AND coverage_status='accepted' LIMIT 1`.execute(tx)).rows[0];
        if (!currentAssignment.rows[0]&&!currentSubstitute) {
          throw new ForbiddenException("This class is no longer assigned to the signed-in teacher.");
        }
      }
      const currentRoster = await sql<{ student_id: string }>`
        SELECT enrollment.student_id
        FROM enrollments enrollment
        JOIN students student ON student.id=enrollment.student_id
          AND student.school_id=${membership.school_id}::uuid
        WHERE enrollment.class_section_id=${data.class_section_id}::uuid
          AND enrollment.term_id=${screen.class.term_id}::uuid
          AND enrollment.is_active
          AND enrollment.enrolled_on<=${data.date}::date
        ORDER BY enrollment.student_id
        FOR SHARE OF enrollment, student
      `.execute(tx);
      const lockedRosterIds = new Set(currentRoster.rows.map((row) => row.student_id));
      if (
        lockedRosterIds.size !== rosterIds.size
        || [...lockedRosterIds].some((studentId) => !rosterIds.has(studentId))
      ) {
        throw new ConflictException({
          message: "The class roster changed after this register was opened. Refresh before submitting.",
          code: "roster_changed",
        });
      }
      const dayPolicy = await attendanceDayPolicy(
        tx,
        membership.school_id,
        data.class_section_id,
        screen.class.term_id,
        data.date,
        { userId: user.id, role: currentRole },
      );
      if (!dayPolicy?.completed) {
        throw new BadRequestException("Attendance opens on the selected date.");
      }
      if (!dayPolicy.instructional) {
        throw new BadRequestException("Attendance cannot be submitted because this class has no scheduled lesson on the selected date.");
      }
      if (!dayPolicy.actor_scheduled) {
        throw new ForbiddenException("You have no scheduled or accepted cover period for this class on the selected date.");
      }
      const registerResult = await sql<any>`
        SELECT * FROM attendance_registers
        WHERE class_section_id=${data.class_section_id}::uuid
          AND term_id=${screen.class.term_id}::uuid AND date=${data.date}::date
        FOR UPDATE
      `.execute(tx);
      const currentRegister = registerResult.rows[0];
      const currentRevision = Number(currentRegister?.revision ?? 0);
      if (currentRevision !== data.expected_revision) {
        throw new ConflictException({
          message: "This register changed after it was opened. Refresh it before submitting.",
          code: "revision_conflict", current_revision: currentRevision,
        });
      }
      if (currentRegister?.state === "locked") {
        throw new ForbiddenException("This attendance register is locked. A principal must reopen it before a teacher can make corrections.");
      }

      const sourcePhotoSession = data.photo_session_id
        ? await tx.selectFrom("photo_attendance_sessions").selectAll()
          .where("id", "=", data.photo_session_id)
          .where("school_id", "=", membership.school_id)
          .where("class_section_id", "=", data.class_section_id)
          .where("date", "=", data.date)
          .forUpdate()
          .executeTakeFirst()
        : undefined;
      if (data.photo_session_id && !sourcePhotoSession) {
        throw new BadRequestException("The selected photo analysis does not belong to this class register.");
      }
      if (sourcePhotoSession && sourcePhotoSession.expires_at < new Date()) {
        throw new ConflictException("The photo analysis expired. Capture a new photo or continue manually.");
      }
      if (sourcePhotoSession && sourcePhotoSession.state !== "analyzed") {
        throw new ConflictException("This photo analysis has already been applied or discarded.");
      }

      const currentRows = await sql<any>`
        SELECT * FROM attendance_records
        WHERE date=${data.date}::date AND student_id=ANY(${[...rosterIds]}::uuid[])
        FOR UPDATE
      `.execute(tx);
      const previousByStudent = new Map(currentRows.rows.map((row) => [row.student_id as string, row]));
      const conflictingClass = currentRows.rows.find((row) => row.class_section_id !== data.class_section_id);
      if (conflictingClass) {
        throw new ConflictException({
          message: "An existing attendance record belongs to a different class. Resolve the enrollment transfer before submitting.",
          code: "attendance_class_conflict",
          student_id: conflictingClass.student_id,
        });
      }
      const changed = data.records.filter((record) => {
        const previous = previousByStudent.get(record.student_id);
        return !previous || previous.status !== record.status || previous.remarks !== record.remarks;
      });
      if (changed.some((record) => previousByStudent.has(record.student_id)) && !data.reason) {
        throw new BadRequestException("A correction reason is required when changing an existing attendance record.");
      }
      const advancesRevision = changed.length > 0 || !currentRegister || currentRegister.state === "draft";
      const nextRevision = currentRevision + (advancesRevision ? 1 : 0);
      const effectiveRevision = Math.max(1, nextRevision);
      const now = new Date();
      const nextState = "submitted" as const;
      const register = currentRegister
        ? await tx.updateTable("attendance_registers").set({
            state: nextState, revision: effectiveRevision, submitted_by: user.id,
            submitted_at: now, updated_at: now,
          }).where("id", "=", currentRegister.id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto("attendance_registers").values({
            school_id: membership.school_id, class_section_id: data.class_section_id,
            term_id: screen.class.term_id, date: data.date, state: "submitted",
            revision: effectiveRevision, submitted_by: user.id, submitted_at: now,
            locked_by: null, locked_at: null, reopened_by: null, reopened_at: null,
            reopen_reason: null,
          }).returningAll().executeTakeFirstOrThrow();

      const provisionalResult = {
        ...screen,
        register: {
          id: register.id, state: register.state, revision: register.revision,
          submitted_by: register.submitted_by, submitted_at: register.submitted_at,
          locked_by: register.locked_by, locked_at: register.locked_at,
          reopened_by: register.reopened_by, reopened_at: register.reopened_at,
          reopen_reason: register.reopen_reason,
        },
      };
      const submission = await tx.insertInto("attendance_submissions").values({
        school_id: membership.school_id, class_section_id: data.class_section_id,
        term_id: screen.class.term_id, date: data.date, submitted_by: user.id,
        idempotency_key: idempotencyKey, request_hash: requestHash, request_id: request.requestId,
        register_revision: effectiveRevision, records_count: data.records.length,
        changed_count: changed.length, result_body: provisionalResult as any,
        source_photo_session_id: sourcePhotoSession?.id ?? null, completed_at: now,
      }).returning("id").executeTakeFirstOrThrow();

      if (sourcePhotoSession) {
        await tx.updateTable("photo_attendance_sessions").set({
          state: "applied",
          applied_at: now,
          applied_submission_id: submission.id,
          updated_at: now,
        }).where("id", "=", sourcePhotoSession.id).execute();
      }

      let persisted = new Map<string, any>();
      if (changed.length) {
        const saved = await tx.insertInto("attendance_records").values(changed.map((record) => ({
          student_id: record.student_id, class_section_id: data.class_section_id, date: data.date,
          status: record.status, remarks: record.remarks, marked_by: user.id,
          revision: effectiveRevision, source_request_id: request.requestId, updated_at: now,
        }))).onConflict((conflict) => conflict.columns(["student_id", "date"]).doUpdateSet({
          status: sql`excluded.status`, remarks: sql`excluded.remarks`, marked_by: user.id,
          revision: effectiveRevision, source_request_id: request.requestId, updated_at: now,
        })).returningAll().execute();
        persisted = new Map(saved.map((row) => [row.student_id, row]));
        await tx.insertInto("attendance_record_revisions").values(changed.map((record) => {
          const previous = previousByStudent.get(record.student_id);
          const savedRecord = persisted.get(record.student_id)!;
          return {
            attendance_record_id: savedRecord.id,
            attendance_submission_id: submission.id,
            attendance_register_id: register.id,
            school_id: membership.school_id, student_id: record.student_id,
            class_section_id: data.class_section_id, date: data.date,
            previous_status: previous?.status ?? null, new_status: record.status,
            previous_remarks: previous?.remarks ?? null, new_remarks: record.remarks,
            previous_check_in_at: previous?.check_in_at ?? null,
            new_check_in_at: savedRecord.check_in_at ?? null,
            previous_check_out_at: previous?.check_out_at ?? null,
            new_check_out_at: savedRecord.check_out_at ?? null,
            reason: previous ? data.reason! : "Initial register submission", changed_by: user.id,
            request_id: request.requestId, register_revision: effectiveRevision,
          };
        })).execute();
      }

      const submittedByStudent = new Map(data.records.map((record) => [record.student_id, record]));
      const result = {
        ...provisionalResult,
        roster: screen.roster.map((student) => {
          const submitted = submittedByStudent.get(student.id)!;
          const saved = persisted.get(student.id);
          return {
            ...student, status: submitted.status, remarks: submitted.remarks,
            attendance_id: saved?.id ?? student.attendance_id,
            attendance_revision: saved?.revision ?? student.attendance_revision,
            updated_at: saved?.updated_at ?? student.updated_at,
          };
        }),
      };
      await tx.updateTable("attendance_submissions").set({ result_body: result as any }).where("id", "=", submission.id).execute();
      await tx.insertInto("audit_events").values({
        action: "attendance.class.submitted", actor_id: user.id, school_id: membership.school_id,
        target_type: "class_section", target_id: data.class_section_id, request_id: request.requestId,
        ip_hash: null, metadata: {
          date: data.date, records: data.records.length, changed: changed.length,
          register_revision: effectiveRevision, register_state: register.state,
          correction_reason: data.reason ?? null,
          photo_session_id: sourcePhotoSession?.id ?? null,
        },
      }).execute();
      if (changed.length) {
        await this.refreshSubjectAttendance(tx, changed.map((record) => record.student_id));
        await this.events.enqueueAttendanceUpdates(tx, {
          schoolId: membership.school_id, classSectionId: data.class_section_id,
          termId: screen.class.term_id,
          date: data.date, requestId: request.requestId,
          records: changed.map((record) => ({
            ...record, previous_status: previousByStudent.get(record.student_id)?.status ?? null,
            revision: effectiveRevision,
          })),
        });
      }
      await this.events.enqueueRegisterEvent(tx, {
        schoolId: membership.school_id, classSectionId: data.class_section_id,
        termId: screen.class.term_id,
        date: data.date, requestId: request.requestId, state: register.state,
        revision: effectiveRevision, actorId: user.id,
      });
      return result;
    });
  }

  async setAttendanceRegisterLock(user: AuthUser, classSectionId: string, locked: boolean, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceLockSchema.parse(body);
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], target.school_id);
    const screen = await this.teacherAttendanceScreen(user, classSectionId, data.date);
    if (!locked && !data.reason) throw new BadRequestException("A reason is required to reopen a locked register.");
    let changed = false;
    await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${classSectionId}:${data.date}`}, 0))`.execute(tx);
      const found = await sql<any>`
        SELECT * FROM attendance_registers WHERE class_section_id=${classSectionId}::uuid
          AND term_id=${screen.class.term_id}::uuid AND date=${data.date}::date FOR UPDATE
      `.execute(tx);
      const register = found.rows[0];
      if (!register) throw new BadRequestException("Submit the attendance register before locking it.");
      if (locked && register.state === "locked") return;
      if (!locked && register.state !== "locked") return;
      if (locked && register.state !== "submitted") throw new BadRequestException("Only a submitted register can be locked.");
      const revision = Number(register.revision) + 1;
      const now = new Date();
      await tx.updateTable("attendance_registers").set(locked ? {
        state: "locked", revision, locked_by: user.id, locked_at: now, updated_at: now,
      } : {
        state: "submitted", revision, locked_by: null, locked_at: null,
        reopened_by: user.id, reopened_at: now, reopen_reason: data.reason!, updated_at: now,
      }).where("id", "=", register.id).execute();
      await tx.insertInto("audit_events").values({
        action: locked ? "attendance.register.locked" : "attendance.register.reopened",
        actor_id: user.id, school_id: membership.school_id, target_type: "attendance_register",
        target_id: register.id, request_id: request.requestId, ip_hash: null,
        metadata: { class_section_id: classSectionId, date: data.date, revision, reason: data.reason ?? null },
      }).execute();
      await this.events.enqueueRegisterEvent(tx, {
        schoolId: membership.school_id, classSectionId, date: data.date,
        termId: screen.class.term_id,
        requestId: request.requestId, state: locked ? "locked" : "unlocked",
        revision, actorId: user.id,
      });
      changed = true;
    });
    const refreshed = await this.teacherAttendanceScreen(user, classSectionId, data.date);
    return { ...refreshed, lifecycle_changed: changed };
  }

  async attendanceRegisterHistory(user: AuthUser, classSectionId: string, selectedDate: string) {
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    await this.requireSchoolRole(user, ["admin"], target.school_id);
    const screen = await this.teacherAttendanceScreen(user, classSectionId, selectedDate);
    const [revisions, submissions] = await Promise.all([
      sql<any>`
        SELECT history.id, history.student_id, history.previous_status, history.new_status,
          history.previous_remarks, history.new_remarks, history.reason,
          history.register_revision, history.created_at,
          trim(concat_ws(' ', student_user.first_name, student_user.last_name)) AS student_name,
          trim(concat_ws(' ', actor.first_name, actor.last_name)) AS changed_by_name
        FROM attendance_record_revisions history
        JOIN students student ON student.id=history.student_id
        JOIN school_people student_user ON student_user.id=student.person_id
        JOIN users actor ON actor.id=history.changed_by
        WHERE history.class_section_id=${classSectionId}::uuid AND history.date=${selectedDate}::date
        ORDER BY history.register_revision DESC, student_name, history.id DESC
      `.execute(this.db),
      sql<any>`
        SELECT submission.id, submission.register_revision, submission.records_count,
          submission.changed_count, submission.created_at,
          trim(concat_ws(' ', actor.first_name, actor.last_name)) AS submitted_by_name
        FROM attendance_submissions submission JOIN users actor ON actor.id=submission.submitted_by
        WHERE submission.class_section_id=${classSectionId}::uuid AND submission.date=${selectedDate}::date
        ORDER BY submission.register_revision DESC, submission.created_at DESC
      `.execute(this.db),
    ]);
    return { date: selectedDate, class: screen.class, register: screen.register, submissions: submissions.rows, revisions: revisions.rows };
  }

  async principalHomeScreen(user: AuthUser, selectedDateValue?: string) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(membership.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const workspace = await attendanceWorkspace(this.db, membership.school_id, user.id, membership.role, selectedDate);
    const classContext = new Map(workspace.map((item) => [item.class_section_id, item]));
    const classes = await sql<any>`
      WITH attendance_rollup AS (
        SELECT e.class_section_id, e.term_id,
          count(*)::int AS student_count,
          count(ar.id)::int AS marked_count,
          count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS scored_count,
          COALESCE(sum(CASE
            WHEN ar.status IN ('present','late') THEN 1.0
            WHEN ar.status='half_day' THEN 0.5
            ELSE 0
          END), 0)::numeric AS attending_count,
          count(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count,
          count(ar.id) FILTER (WHERE ar.status='late')::int AS late_count,
          count(ar.id) FILTER (WHERE ar.status='excused')::int AS excused_count
        FROM enrollments e
        JOIN class_sections section ON section.id=e.class_section_id
        LEFT JOIN attendance_records ar ON ar.student_id=e.student_id
          AND ar.class_section_id=e.class_section_id AND ar.date=${selectedDate}::date
        WHERE e.is_active AND section.school_id=${membership.school_id}::uuid AND e.enrolled_on<=${selectedDate}::date
        GROUP BY e.class_section_id, e.term_id
      ), timetable_rollup AS (
        SELECT ts.class_section_id, ts.term_id,
          count(*)::int AS timetable_slots,
          count(*) FILTER (WHERE ts.teacher_user_id IS NULL AND ts.slot_type='class')::int AS unassigned_slots
        FROM effective_school_schedule(${membership.school_id}::uuid,${selectedDate}::date) ts
        JOIN class_sections section ON section.id=ts.class_section_id
        WHERE section.school_id=${membership.school_id}::uuid
          AND ts.weekday=${isoWeekday(selectedDate)} AND NOT ts.cancelled
        GROUP BY ts.class_section_id, ts.term_id
      )
      SELECT cs.id, cs.grade, cs.section, cs.room_number,
        t.id AS term_id, t.name AS term_name, t.academic_year,
        reg.state AS register_state, reg.revision AS register_revision,
        COALESCE(attendance.student_count, 0)::int AS student_count,
        COALESCE(attendance.marked_count, 0)::int AS marked_count,
        COALESCE(attendance.scored_count, 0)::int AS scored_count,
        COALESCE(attendance.attending_count, 0)::numeric AS attending_count,
        COALESCE(attendance.absent_count, 0)::int AS absent_count,
        COALESCE(attendance.late_count, 0)::int AS late_count,
        COALESCE(attendance.excused_count, 0)::int AS excused_count,
        COALESCE(timetable.timetable_slots, 0)::int AS timetable_slots,
        COALESCE(timetable.unassigned_slots, 0)::int AS unassigned_slots
      FROM class_sections cs
      JOIN academic_terms t ON t.school_id=cs.school_id
        AND t.academic_year=cs.academic_year
        AND ${selectedDate}::date BETWEEN t.starts_on AND t.ends_on
      LEFT JOIN attendance_rollup attendance
        ON attendance.class_section_id=cs.id AND attendance.term_id=t.id
      LEFT JOIN attendance_registers reg
        ON reg.class_section_id=cs.id AND reg.term_id=t.id AND reg.date=${selectedDate}::date
      LEFT JOIN timetable_rollup timetable
        ON timetable.class_section_id=cs.id AND timetable.term_id=t.id
      WHERE cs.school_id=${membership.school_id}::uuid
      ORDER BY cs.grade, cs.section
    `.execute(this.db);
    const exceptions = await sql<any>`
      WITH scores AS (
        SELECT st.id, st.admission_number, u.first_name, u.last_name, cs.id AS class_section_id, cs.grade, cs.section,
          t.attendance_threshold, count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS recorded_days,
          COALESCE(sum(CASE WHEN ar.status IN ('present','late') THEN 1.0 WHEN ar.status='half_day' THEN 0.5 ELSE 0 END),0)::numeric AS points
        FROM students st JOIN school_people u ON u.id=st.person_id JOIN enrollments e ON e.student_id=st.id AND e.is_active
        JOIN class_sections cs ON cs.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id AND t.is_active
        LEFT JOIN attendance_records ar ON ar.student_id=st.id
          AND ar.date BETWEEN t.starts_on AND LEAST(t.ends_on, ${selectedDate}::date)
        WHERE st.school_id=${membership.school_id}::uuid
        GROUP BY st.id, st.admission_number, u.first_name, u.last_name, cs.id, cs.grade, cs.section, t.attendance_threshold
      ) SELECT *, round(points*100.0/NULLIF(recorded_days,0),2) AS percentage FROM scores
      WHERE recorded_days >= 5 AND points*100.0/NULLIF(recorded_days,0) < attendance_threshold
      ORDER BY percentage, grade, section LIMIT 20
    `.execute(this.db);
    const operationalRows = classes.rows.filter((row) => classContext.has(row.id));
    const dueRows = operationalRows.filter((row) => classContext.get(row.id)?.can_mark);
    const totals = dueRows.reduce((result, row) => ({
      students: result.students + Number(row.student_count), marked: result.marked + Number(row.marked_count),
      scored: result.scored + Number(row.scored_count), attending: result.attending + Number(row.attending_count),
      absent: result.absent + Number(row.absent_count), late: result.late + Number(row.late_count),
      excused: result.excused + Number(row.excused_count),
    }), { students: 0, marked: 0, scored: 0, attending: 0, absent: 0, late: 0, excused: 0 });
    return {
      date: selectedDate,
      principal: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim() },
      summary: { ...totals, attendance_percentage: totals.scored ? Math.round(totals.attending * 10_000 / totals.scored) / 100 : 0, classes_total: dueRows.length, classes_submitted: dueRows.filter((row) => ["submitted", "locked"].includes(row.register_state) && classContext.get(row.id)?.submission_authorized !== false).length },
      classes: operationalRows.map((row) => ({ ...classContext.get(row.id), ...row, name: `Class ${row.grade}${row.section}`, submission_status: classContext.get(row.id)?.submission_status ?? "not_started", attendance_percentage: Number(row.scored_count) ? Math.round(Number(row.attending_count) * 10_000 / Number(row.scored_count)) / 100 : 0 })),
      exceptions: exceptions.rows.map((row) => ({ ...row, name: `${row.first_name} ${row.last_name}`.trim(), class_name: `Class ${row.grade}${row.section}`, percentage: Number(row.percentage), threshold: Number(row.attendance_threshold) })),
    };
  }

  async principalTimetableScreen(user: AuthUser) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const [classes, subjects, teachers, slots] = await Promise.all([
      this.db.selectFrom("class_sections").selectAll().where("school_id", "=", membership.school_id).orderBy("grade").orderBy("section").execute(),
      this.db.selectFrom("subjects").select(["id", "code", "name", "short_name", "color"]).where("school_id", "=", membership.school_id).orderBy("name").execute(),
      this.db.selectFrom("school_memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.first_name", "u.last_name"]).where("m.school_id", "=", membership.school_id).where("m.role", "=", "staff").where("m.is_active", "=", true).execute(),
      sql<any>`SELECT ts.*, cs.grade, cs.section, s.name AS subject_name, u.first_name, u.last_name FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id JOIN academic_terms t ON t.id=ts.term_id AND t.is_active LEFT JOIN subjects s ON s.id=ts.subject_id LEFT JOIN users u ON u.id=ts.teacher_user_id WHERE cs.school_id=${membership.school_id}::uuid ORDER BY ts.weekday,ts.period_number,cs.grade,cs.section`.execute(this.db),
    ]);
    const conflicts = await sql<any>`
      SELECT a.id AS first_slot_id, b.id AS second_slot_id, a.weekday, a.starts_at, a.ends_at,
        CASE WHEN a.teacher_user_id=b.teacher_user_id AND a.teacher_user_id IS NOT NULL THEN 'teacher' ELSE 'room' END AS type
      FROM timetable_slots a JOIN timetable_slots b ON a.id < b.id AND a.weekday=b.weekday
        AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
        AND ((a.teacher_user_id=b.teacher_user_id AND a.teacher_user_id IS NOT NULL) OR (a.room=b.room AND a.room<>''))
      JOIN class_sections cs ON cs.id=a.class_section_id WHERE cs.school_id=${membership.school_id}::uuid
      ORDER BY a.weekday,a.starts_at
    `.execute(this.db);
    return {
      classes: classes.map((row) => ({ ...row, name: `Class ${row.grade}${row.section}` })), subjects,
      teachers: teachers.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })),
      slots: slots.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, display_title: row.subject_name ?? row.title, teacher_name: row.teacher_user_id ? `${row.first_name} ${row.last_name}`.trim() : null, weekday_label: weekdayLabels[row.weekday] })),
      conflicts: conflicts.rows,
    };
  }

  async createTimetableSlot(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = timetableSlotSchema.parse(body);
    if (data.ends_at <= data.starts_at) throw new BadRequestException("End time must be after start time.");
    const section = await this.db.selectFrom("class_sections").selectAll().where("id", "=", data.class_section_id).executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], section.school_id);
    const term = await this.db.selectFrom("academic_terms").select("id").where("school_id", "=", membership.school_id).where("academic_year", "=", section.academic_year).where("is_active", "=", true).executeTakeFirst();
    if (!term) throw new NotFoundException("No active term exists for this class.");
    if (data.teacher_user_id) {
      const teacher = await this.db.selectFrom("school_memberships").select("id").where("school_id", "=", membership.school_id).where("user_id", "=", data.teacher_user_id).where("role", "=", "staff").where("is_active", "=", true).executeTakeFirst();
      if (!teacher) throw new BadRequestException("Selected teacher is not active in this school.");
    }
    const conflict = data.teacher_user_id || data.room ? await this.db.selectFrom("timetable_slots").select("id").where("term_id", "=", term.id).where("weekday", "=", data.weekday)
      .where("starts_at", "<", data.ends_at).where("ends_at", ">", data.starts_at)
      .where((eb) => eb.or([
        ...(data.teacher_user_id ? [eb("teacher_user_id", "=", data.teacher_user_id)] : []),
        ...(data.room ? [eb("room", "=", data.room)] : []),
      ])).executeTakeFirst() : undefined;
    if (conflict) throw new BadRequestException("The selected teacher or room already has an overlapping timetable slot.");
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      const slot = await tx.insertInto("timetable_slots").values({
        class_section_id: data.class_section_id, term_id: term.id, subject_id: data.subject_id ?? null,
        weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at,
        slot_type: data.slot_type, title: data.title, room: data.room, teacher_user_id: data.teacher_user_id ?? null,
        teacher_designation: data.teacher_designation,
      }).returningAll().executeTakeFirstOrThrow();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.created", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: data.class_section_id, slotId: slot.id, requestId: request.requestId, action: "created" });
      return slot;
    });
  }

  async updateTimetableSlot(user: AuthUser, slotId: string, body: unknown, request: AuthenticatedRequest) {
    const data = timetableSlotSchema.parse(body);
    if (data.ends_at <= data.starts_at) throw new BadRequestException("End time must be after start time.");
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.term_id", "ts.class_section_id", "cs.school_id"]).where("ts.id", "=", slotId).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], current.school_id);
    const section = await this.db.selectFrom("class_sections").select("id").where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst();
    if (!section) throw new BadRequestException("Selected class does not belong to this school.");
    if (data.teacher_user_id) {
      const teacher = await this.db.selectFrom("school_memberships").select("id").where("school_id", "=", membership.school_id).where("user_id", "=", data.teacher_user_id).where("role", "=", "staff").where("is_active", "=", true).executeTakeFirst();
      if (!teacher) throw new BadRequestException("Selected teacher is not active in this school.");
    }
    const conflict = data.teacher_user_id || data.room ? await this.db.selectFrom("timetable_slots").select("id").where("term_id", "=", current.term_id).where("id", "!=", slotId).where("weekday", "=", data.weekday).where("starts_at", "<", data.ends_at).where("ends_at", ">", data.starts_at).where((eb) => eb.or([...(data.teacher_user_id ? [eb("teacher_user_id", "=", data.teacher_user_id)] : []), ...(data.room ? [eb("room", "=", data.room)] : [])])).executeTakeFirst() : undefined;
    if (conflict) throw new BadRequestException("The selected teacher or room already has an overlapping timetable slot.");
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      const slot = await tx.updateTable("timetable_slots").set({ class_section_id: data.class_section_id, subject_id: data.subject_id ?? null, teacher_user_id: data.teacher_user_id ?? null, weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at, slot_type: data.slot_type, title: data.title, room: data.room, teacher_designation: data.teacher_designation }).where("id", "=", slotId).returningAll().executeTakeFirstOrThrow();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.updated", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: data.class_section_id, slotId: slot.id, requestId: request.requestId, action: "updated" });
      if (current.class_section_id !== data.class_section_id) await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: current.class_section_id, slotId: slot.id, requestId: request.requestId, action: "updated" });
      return slot;
    });
  }

  async deleteTimetableSlot(user: AuthUser, slotId: string, request: AuthenticatedRequest) {
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.class_section_id", "cs.school_id"]).where("ts.id", "=", slotId).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], current.school_id);
    await this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      await tx.deleteFrom("timetable_slots").where("id", "=", slotId).execute();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.deleted", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slotId, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: current.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: current.class_section_id, slotId, requestId: request.requestId, action: "deleted" });
    });
    return { deleted: true, id: slotId };
  }

}
