import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";

type Db = Kysely<Database> | Transaction<Database>;
type LeaveStatus = "draft" | "pending_guardian" | "authorized" | "declined" | "school_approved" | "school_rejected" | "withdrawn";

interface StudentContext {
  id: string; user_id: string; school_id: string; admission_number: string;
  date_of_birth: string | null; blood_group: string | null; emergency_contact: string | null;
  avatar_url: string; username: string; email: string; first_name: string; last_name: string;
  school_name: string; school_code: string;
}

interface EnrollmentContext {
  id: string; class_section_id: string; term_id: string; roll_number: number; is_active: boolean;
  grade: string; section: string; board: string; room_number: string;
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
  records: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(["present", "absent", "late", "excused", "half_day"]),
    remarks: z.string().trim().max(500).optional().default(""),
  })).min(1).max(100),
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

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

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

@Injectable()
export class SchoolService {
  constructor(private readonly db: DatabaseService) {}

  async studentForUser(user: AuthUser, requestedId?: string): Promise<StudentContext> {
    const result = await sql<StudentContext>`
      SELECT st.id, st.user_id, st.school_id, st.admission_number, st.date_of_birth,
        st.blood_group, st.emergency_contact, st.avatar_url, u.username, u.email,
        u.first_name, u.last_name, sc.name AS school_name, sc.code AS school_code
      FROM students st
      JOIN users u ON u.id = st.user_id
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
              AND m.school_id = st.school_id AND m.role IN ('staff', 'admin') AND m.is_active
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
        OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id AND m.role IN ('staff','admin') AND m.is_active)
      ) ORDER BY st.id
    `.execute(this.db);
    return Promise.all(ids.rows.map(async (row) => this.studentDto(await this.studentForUser(user, row.id))));
  }

  async enrollment(studentId: string, onDate = today()): Promise<EnrollmentContext> {
    const result = await sql<EnrollmentContext>`
      SELECT e.id, e.class_section_id, e.term_id, e.roll_number, e.is_active,
        cs.grade, cs.section, cs.board, cs.room_number, t.academic_year, t.name AS term_name,
        t.starts_on, t.ends_on, t.attendance_threshold
      FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id
      JOIN academic_terms t ON t.id=e.term_id
      WHERE e.student_id=${studentId}::uuid AND e.is_active
      ORDER BY CASE WHEN ${onDate}::date BETWEEN t.starts_on AND t.ends_on THEN 0 ELSE 1 END,
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

  private async requireSchoolRole(user: AuthUser, roles: Array<"staff" | "admin">) {
    let query = this.db.selectFrom("school_memberships").select(["id", "school_id", "role"])
      .where("user_id", "=", user.id).where("role", "in", roles).where("is_active", "=", true);
    if (user.active_school_id) query = query.where("school_id", "=", user.active_school_id);
    const memberships = await query.orderBy("role").execute();
    if (new Set(memberships.map((m) => m.school_id)).size > 1) throw new BadRequestException("Select an active school before opening this workspace.");
    const membership = memberships[0];
    if (!membership) throw new ForbiddenException(`An active ${roles.join(" or ")} membership is required.`);
    return membership;
  }

  async attendanceSummary(studentId: string, term: EnrollmentContext): Promise<{ total: number; present: number; absent: number; late: number; excused: number; half_day: number; percentage: number }> {
    const result = await sql<{ total: string; present: string; absent: string; late: string; excused: string; half_day: string }>`
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE status='present')::text AS present,
        count(*) FILTER (WHERE status='absent')::text AS absent,
        count(*) FILTER (WHERE status='late')::text AS late,
        count(*) FILTER (WHERE status='excused')::text AS excused,
        count(*) FILTER (WHERE status='half_day')::text AS half_day
      FROM attendance_records WHERE student_id=${studentId}::uuid
        AND date BETWEEN ${term.starts_on}::date AND LEAST(${term.ends_on}::date, CURRENT_DATE)
    `.execute(this.db);
    const row = result.rows[0] ?? { total: "0", present: "0", absent: "0", late: "0", excused: "0", half_day: "0" };
    const values = { total: Number(row.total), present: Number(row.present), absent: Number(row.absent), late: Number(row.late), excused: Number(row.excused), half_day: Number(row.half_day) };
    const attended = values.present + values.late + values.half_day * 0.5;
    return { ...values, percentage: values.total ? Math.round(attended * 10_000 / values.total) / 100 : 0 };
  }

  async attendanceRecords(studentId: string, term?: EnrollmentContext) {
    let query = this.db.selectFrom("attendance_records").selectAll().where("student_id", "=", studentId);
    if (term) query = query.where("date", ">=", term.starts_on).where("date", "<=", term.ends_on);
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
        CASE WHEN sa.classes_held=0 THEN 0 ELSE round(sa.classes_attended*100.0/sa.classes_held, 2) END AS percentage,
        s.id AS subject_id, s.code, s.name, s.short_name, s.color, s.icon,
        next_slot.room, next_slot.weekday AS next_weekday, next_slot.starts_at AS next_starts_at,
        next_slot.teacher_user_id, next_slot.teacher_first_name, next_slot.teacher_last_name,
        next_slot.teacher_designation
      FROM subject_attendance sa JOIN subjects s ON s.id=sa.subject_id
      LEFT JOIN LATERAL (
        SELECT ts.room, ts.weekday, ts.starts_at, ts.teacher_user_id, ts.teacher_designation,
          u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM enrollments e
        JOIN timetable_slots ts ON ts.class_section_id=e.class_section_id
          AND ts.term_id=e.term_id AND ts.subject_id=sa.subject_id
        LEFT JOIN users u ON u.id=ts.teacher_user_id
        WHERE e.student_id=sa.student_id AND e.term_id=sa.term_id AND e.is_active
        ORDER BY CASE
          WHEN ts.weekday=extract(isodow FROM current_timestamp AT TIME ZONE 'Asia/Kolkata')::int
            AND ts.starts_at > (current_timestamp AT TIME ZONE 'Asia/Kolkata')::time THEN 0
          WHEN ts.weekday > extract(isodow FROM current_timestamp AT TIME ZONE 'Asia/Kolkata')::int
            THEN ts.weekday-extract(isodow FROM current_timestamp AT TIME ZONE 'Asia/Kolkata')::int
          ELSE 7-extract(isodow FROM current_timestamp AT TIME ZONE 'Asia/Kolkata')::int+ts.weekday
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
          count(ar.id)::int AS recorded_days,
          array_agg(ar.status ORDER BY ar.date DESC) FILTER (WHERE ar.id IS NOT NULL) AS recent_statuses,
          COALESCE(sum(CASE
            WHEN ar.status IN ('present','late') THEN 1.0
            WHEN ar.status='half_day' THEN 0.5
            ELSE 0.0
          END), 0)::numeric AS attendance_points
        FROM enrollments e
        JOIN students st ON st.id=e.student_id
        JOIN users u ON u.id=st.user_id
        LEFT JOIN attendance_records ar ON ar.student_id=st.id
          AND ar.date BETWEEN ${enrollment.starts_on}::date AND LEAST(${enrollment.ends_on}::date, CURRENT_DATE)
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
      as_of: today(),
      cohort_size: eligible.length,
      minimum_recorded_days: 5,
      methodology: "Daily attendance points: present or late = 1, half day = 0.5, absent or excused = 0; ranked by percentage, then attendance points and recorded days.",
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

  async timetable(enrollment: EnrollmentContext, weekday?: number) {
    const result = await sql<any>`
      SELECT ts.*, s.code, s.name AS subject_name, s.short_name,
        u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
      FROM timetable_slots ts LEFT JOIN subjects s ON s.id=ts.subject_id
      LEFT JOIN users u ON u.id=ts.teacher_user_id
      WHERE ts.class_section_id=${enrollment.class_section_id}::uuid AND ts.term_id=${enrollment.term_id}::uuid
        AND (${weekday ?? null}::smallint IS NULL OR ts.weekday=${weekday ?? null}::smallint)
      ORDER BY ts.weekday, ts.period_number
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id, weekday: row.weekday, weekday_label: weekdayLabels[row.weekday],
      period_number: row.period_number, starts_at: row.starts_at, ends_at: row.ends_at,
      slot_type: row.slot_type, slot_type_label: String(row.slot_type).replace(/^./, (v: string) => v.toUpperCase()),
      display_title: row.subject_name ?? row.title, title: row.title, room: row.room,
      subject: row.subject_id ? { id: row.subject_id, code: row.code, name: row.subject_name, short_name: row.short_name } : null,
      teacher: row.teacher_user_id ? { id: row.teacher_user_id, name: `${row.teacher_first_name} ${row.teacher_last_name}`.trim(), designation: row.teacher_designation } : null,
    }));
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

  private async guardianRelationship(db: Db, userId: string, studentId: string) {
    const result = await sql<{ id: string; can_authorize_leave: boolean; relationship: string }>`
      SELECT gr.id, gr.can_authorize_leave, gr.relationship FROM guardian_relationships gr
      JOIN parents p ON p.id=gr.guardian_id JOIN students st ON st.id=gr.student_id
      JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id
      WHERE p.user_id=${userId}::uuid AND gr.student_id=${studentId}::uuid
        AND m.role='guardian' AND m.is_active LIMIT 1
    `.execute(db);
    return result.rows[0] ?? null;
  }

  private async addLeaveAudit(db: Db, leaveId: string, actorId: string, action: any, fromStatus: string, toStatus: string, note = "") {
    await db.insertInto("leave_audits").values({ leave_request_id: leaveId, actor_id: actorId, action, from_status: fromStatus, to_status: toStatus, note: note.slice(0, 500) }).execute();
  }

  private async notify(db: Db, recipientId: string, input: { title: string; body: string; link: string; metadata: Record<string, unknown> }) {
    await db.insertInto("notifications").values({ recipient_id: recipientId, kind: "leave", title: input.title, body: input.body.slice(0, 500), link: input.link, metadata: input.metadata, read_at: null }).execute();
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
    const termResult = await sql<{ id: string }>`SELECT id FROM academic_terms WHERE school_id=${student.school_id}::uuid ORDER BY CASE WHEN ${data.starts_on}::date BETWEEN starts_on AND ends_on THEN 0 ELSE 1 END, starts_on DESC LIMIT 1`.execute(this.db);
    const termId = termResult.rows[0]?.id;
    if (!termId) throw new NotFoundException("No academic term covers this request.");
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
    try {
      const leaveId = await this.db.transaction().execute(async (trx) => {
        const leave = await trx.insertInto("leave_requests").values({
          student_id: student.id, term_id: termId, requested_by: user.id, category: data.category,
          starts_on: data.starts_on, ends_on: data.ends_on, reason: data.reason,
          status: "pending_guardian", submitted_at: new Date(), guardian_authorized_by: null,
          guardian_authorized_at: null, decided_by: null, decided_at: null,
        }).returning("id").executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leave.id, user.id, "submitted", "draft", "pending_guardian", guardian ? "Leave request submitted by a guardian." : "Leave request submitted for guardian authorization.");
        let status: LeaveStatus = "pending_guardian";
        if (guardian?.can_authorize_leave) {
          status = "authorized";
          await trx.updateTable("leave_requests").set({ status, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leave.id).execute();
          await this.addLeaveAudit(trx, leave.id, user.id, "authorized", "pending_guardian", status, "Guardian submitted and authorized the leave request.");
          await this.notify(trx, student.user_id, { title: "Leave request ready for school review", body: `${user.first_name} ${user.last_name} submitted and authorized the request; it is ready for school review.`, link: `/student/leave?leave_id=${leave.id}`, metadata: { leave_request_id: leave.id, student_id: student.id } });
        } else {
          const guardians = await sql<{ user_id: string }>`SELECT p.user_id FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id WHERE gr.student_id=${student.id}::uuid AND gr.can_authorize_leave`.execute(trx);
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
        await rename(temporaryPath, finalPath); moved = true;
        const row = await trx.insertInto("leave_documents").values({ leave_request_id: leaveId, storage_key: storageKey, original_name: upload.filename.slice(0, 255), content_type: upload.mimetype, size_bytes: upload.data.byteLength, uploaded_by: user.id }).returningAll().executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leaveId, user.id, "document_added", scoped.leave.status, scoped.leave.status, `Added ${upload.filename}`);
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
    await this.leaveForUser(user, leaveId);
    const document = await this.db.selectFrom("leave_documents").selectAll()
      .where("id", "=", documentId).where("leave_request_id", "=", leaveId).executeTakeFirst();
    if (!document) throw new NotFoundException("Leave document not found.");
    return { document, stream: createReadStream(join(config().uploadDir, document.storage_key)) };
  }

  async performLeaveAction(user: AuthUser, leaveId: string, action: string, noteValue: unknown, request: FastifyRequest) {
    const note = z.string().max(500).optional().default("").parse(noteValue).trim();
    const scoped = await this.leaveForUser(user, leaveId);
    const guardian = await this.guardianRelationship(this.db, user.id, scoped.student.id);
    const isStaff = Boolean(await this.db.selectFrom("school_memberships").select("id")
      .where("user_id", "=", user.id).where("school_id", "=", scoped.student.school_id)
      .where("role", "in", ["staff", "admin"]).where("is_active", "=", true).executeTakeFirst());
    const validActions = ["authorize", "clarify", "decline", "withdraw", "approve", "reject"];
    if (!validActions.includes(action)) throw new NotFoundException();

    await this.db.transaction().execute(async (trx) => {
      const lockedResult = await sql<{ status: LeaveStatus; requested_by: string }>`SELECT status, requested_by FROM leave_requests WHERE id=${leaveId}::uuid FOR UPDATE`.execute(trx);
      const locked = lockedResult.rows[0];
      if (!locked) throw new NotFoundException("Leave request not found.");
      if (["authorize", "clarify", "decline"].includes(action)) {
        if (!guardian?.can_authorize_leave) throw new ForbiddenException("You are not authorized to review leave for this student.");
        if (locked.status !== "pending_guardian") throw new BadRequestException("Only requests awaiting guardian authorization can be reviewed.");
      }
      if (action === "clarify") {
        if (!note) throw new BadRequestException("Explain what clarification the student should provide.");
        await this.addLeaveAudit(trx, leaveId, user.id, "clarification_requested", locked.status, locked.status, note);
        await this.notify(trx, scoped.student.user_id, { title: "Clarification requested for leave", body: `${user.first_name} ${user.last_name} requested clarification: ${note}`, link: `/student/leave?leave_id=${leaveId}`, metadata: { action: "clarify", leave_request_id: leaveId, student_id: scoped.student.id } });
        return;
      }
      if (action === "withdraw") {
        if (user.id !== locked.requested_by && !guardian) throw new ForbiddenException("Only the requester or a linked guardian may withdraw this request.");
        if (!["draft", "pending_guardian", "authorized"].includes(locked.status)) throw new BadRequestException("This leave request can no longer be withdrawn.");
        await trx.updateTable("leave_requests").set({ status: "withdrawn", updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, "withdrawn", locked.status, "withdrawn", note);
        await this.notify(trx, scoped.student.user_id, { title: "Leave request withdrawn", body: "The leave request has been withdrawn.", link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
        return;
      }
      if (["approve", "reject"].includes(action)) {
        if (!isStaff) throw new ForbiddenException("Active staff membership in the student's school is required.");
        if (locked.status !== "authorized") throw new BadRequestException("Guardian authorization is required before a school decision.");
        const next = action === "approve" ? "school_approved" : "school_rejected";
        await trx.updateTable("leave_requests").set({ status: next, decided_by: user.id, decided_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, action === "approve" ? "approved" : "rejected", locked.status, next, note);
        await this.notify(trx, scoped.student.user_id, { title: action === "approve" ? "Leave request approved" : "Leave request not approved", body: action === "approve" ? "The school approved the leave request." : "The school did not approve the leave request. Review the decision note or contact the office.", link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
        return;
      }
      const next = action === "authorize" ? "authorized" : "declined";
      await trx.updateTable("leave_requests").set({ status: next, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
      await this.addLeaveAudit(trx, leaveId, user.id, action === "authorize" ? "authorized" : "declined", locked.status, next, note);
      await this.notify(trx, scoped.student.user_id, { title: action === "authorize" ? "Leave request authorized" : "Leave request declined", body: action === "authorize" ? `${user.first_name} ${user.last_name} authorized the request; it is ready for school review.` : `${user.first_name} ${user.last_name} declined the leave authorization request.`, link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
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

  async notifications(user: AuthUser) {
    return this.db.selectFrom("notifications").select(["id", "kind", "title", "body", "link", "metadata", "read_at", "created_at"])
      .where("recipient_id", "=", user.id).orderBy("created_at", "desc").limit(100).execute();
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
    const [summary, campus, schedule, diary, contacts, siblings, unread, pending, homework, recentAttendance, ranking, homeworkItems] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, today()),
      this.timetable(enrollment, isoWeekday(today())),
      this.diaryItems(student.id, enrollment, today(), today()),
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
        .where("date", "<=", enrollment.ends_on).where("date", "<=", today())
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
      today_schedule: schedule, diary_preview: diary.slice(0, 3), unread_notifications: Number(unread?.count ?? 0),
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
    const [records, schedule, summary, latestGate, contacts, ranking] = await Promise.all([
      this.attendanceRecords(student.id, enrollment),
      this.timetable(enrollment, isoWeekday(today())),
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, today()),
      this.contacts(student.school_id),
      this.classAttendanceRanking(student.id, enrollment),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: { id: enrollment.term_id, name: enrollment.term_name, academic_year: enrollment.academic_year, threshold: enrollment.attendance_threshold },
      summary,
      ranking,
      today: records.find((row) => row.date === today()) ?? null,
      latest_gate_event: latestGate,
      expected_dismissal_at: schedule.at(-1)?.ends_at ?? null,
      calendar: records,
      contacts,
    };
  }

  async parentDiary(user: AuthUser, studentId?: string, selectedDate = today()) {
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "guardian");
    const enrollment = await this.enrollment(student.id, selectedDate);
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    return {
      student: await this.studentDto(student), date: selectedDate,
      items: await this.diaryItems(student.id, enrollment, selectedDate, selectedDate),
      schedule: await this.timetable(enrollment, isoWeekday(selectedDate)),
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
    const schoolDate = today();
    const [attendance, records, campus, schedule, diary, activeLeaves, unread] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.attendanceRecords(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.timetable(enrollment, isoWeekday(schoolDate)),
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

  async timetableScreen(user: AuthUser, mode: string, studentId?: string, selectedDate = today(), portal: "student" | "guardian" = "student") {
    if (!['day', 'week'].includes(mode)) throw new NotFoundException();
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, portal);
    const enrollment = await this.enrollment(student.id, selectedDate);
    const slots = await this.timetable(enrollment, mode === "day" ? isoWeekday(selectedDate) : undefined);
    const grouped = new Map<number, any[]>();
    for (const slot of slots) grouped.set(slot.weekday, [...(grouped.get(slot.weekday) ?? []), slot]);
    return {
      student: await this.studentDto(student), mode, selected_date: selectedDate,
      class_name: `Class ${enrollment.grade}${enrollment.section}`,
      days: [...grouped.entries()].sort(([left], [right]) => left - right).map(([weekday, periods]) => ({ weekday, weekday_label: weekdayLabels[weekday], periods })),
    };
  }

  async leaveApplyScreen(user: AuthUser, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const enrollment = await this.enrollment(student.id);
    const guardians = await sql<any>`SELECT gr.id, gr.relationship, gr.is_primary, gr.can_authorize_leave, p.id AS parent_id, p.phone, u.id AS user_id, u.first_name, u.last_name, u.email FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id JOIN users u ON u.id=p.user_id WHERE gr.student_id=${student.id}::uuid ORDER BY gr.is_primary DESC`.execute(this.db);
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

  async teacherHomeScreen(user: AuthUser, selectedDate = today()) {
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const membership = await this.requireSchoolRole(user, ["staff", "admin"]);
    const weekday = isoWeekday(selectedDate);
    const classes = await sql<any>`
      SELECT cs.id AS class_section_id, cs.grade, cs.section, cs.room_number,
        t.id AS term_id, t.name AS term_name, t.academic_year,
        min(ts.starts_at) AS starts_at, max(ts.ends_at) AS ends_at,
        count(DISTINCT e.student_id)::int AS student_count,
        count(DISTINCT ar.student_id)::int AS marked_count,
        count(DISTINCT ar.student_id) FILTER (WHERE ar.status IN ('present','late','half_day'))::int AS attending_count,
        count(DISTINCT ar.student_id) FILTER (WHERE ar.status='absent')::int AS absent_count,
        array_agg(DISTINCT COALESCE(s.short_name, ts.title)) FILTER (WHERE COALESCE(s.short_name, ts.title) <> '') AS subjects
      FROM timetable_slots ts
      JOIN class_sections cs ON cs.id=ts.class_section_id
      JOIN academic_terms t ON t.id=ts.term_id AND t.is_active
      LEFT JOIN subjects s ON s.id=ts.subject_id
      LEFT JOIN enrollments e ON e.class_section_id=cs.id AND e.term_id=t.id AND e.is_active
      LEFT JOIN attendance_records ar ON ar.student_id=e.student_id AND ar.date=${selectedDate}::date
      WHERE cs.school_id=${membership.school_id}::uuid AND ts.weekday=${weekday}
        AND (${membership.role}='admin' OR ts.teacher_user_id=${user.id}::uuid)
      GROUP BY cs.id, cs.grade, cs.section, cs.room_number, t.id, t.name, t.academic_year
      ORDER BY starts_at, cs.grade, cs.section
    `.execute(this.db);
    const weekly = await sql<any>`
      SELECT ts.id, ts.weekday, ts.period_number, ts.starts_at, ts.ends_at, ts.room,
        COALESCE(s.name, ts.title) AS subject_name, cs.id AS class_section_id, cs.grade, cs.section
      FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id
      JOIN academic_terms t ON t.id=ts.term_id AND t.is_active
      LEFT JOIN subjects s ON s.id=ts.subject_id
      WHERE cs.school_id=${membership.school_id}::uuid
        AND (${membership.role}='admin' OR ts.teacher_user_id=${user.id}::uuid)
      ORDER BY ts.weekday, ts.period_number, cs.grade, cs.section
    `.execute(this.db);
    return {
      date: selectedDate,
      teacher: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim(), role: membership.role },
      classes: classes.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, submission_status: Number(row.marked_count) === 0 ? "not_started" : Number(row.marked_count) < Number(row.student_count) ? "in_progress" : "submitted" })),
      weekly_timetable: weekly.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, weekday_label: weekdayLabels[row.weekday] })),
    };
  }

  async teacherAttendanceScreen(user: AuthUser, classSectionId: string | undefined, selectedDate = today()) {
    if (!classSectionId) throw new BadRequestException("class_section_id is required.");
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const membership = await this.requireSchoolRole(user, ["staff", "admin"]);
    const section = await this.db.selectFrom("class_sections as cs")
      .innerJoin("academic_terms as t", (join) => join.onRef("t.school_id", "=", "cs.school_id").on("t.is_active", "=", true))
      .select(["cs.id", "cs.school_id", "cs.grade", "cs.section", "cs.room_number", "cs.board", "t.id as term_id", "t.name as term_name", "t.academic_year"])
      .where("cs.id", "=", classSectionId).where("cs.school_id", "=", membership.school_id).executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
    if (membership.role !== "admin") {
      const assigned = await this.db.selectFrom("timetable_slots").select("id")
        .where("class_section_id", "=", classSectionId).where("term_id", "=", section.term_id)
        .where("teacher_user_id", "=", user.id).executeTakeFirst();
      if (!assigned) throw new ForbiddenException("This class is not assigned to the signed-in teacher.");
    }
    const roster = await sql<any>`
      SELECT st.id AS student_id, st.admission_number, st.avatar_url, e.roll_number,
        u.first_name, u.last_name, ar.id AS attendance_id, ar.status, ar.remarks, ar.updated_at
      FROM enrollments e JOIN students st ON st.id=e.student_id JOIN users u ON u.id=st.user_id
      LEFT JOIN attendance_records ar ON ar.student_id=st.id AND ar.date=${selectedDate}::date
      WHERE e.class_section_id=${classSectionId}::uuid AND e.term_id=${section.term_id}::uuid AND e.is_active
      ORDER BY e.roll_number
    `.execute(this.db);
    const periods = await this.timetable({
      id: "", class_section_id: classSectionId, term_id: section.term_id, roll_number: 0, is_active: true,
      grade: section.grade, section: section.section, board: section.board, room_number: section.room_number,
      academic_year: section.academic_year, term_name: section.term_name, starts_on: selectedDate, ends_on: selectedDate, attendance_threshold: "85",
    }, isoWeekday(selectedDate));
    return {
      date: selectedDate,
      class: { id: section.id, name: `Class ${section.grade}${section.section}`, grade: section.grade, section: section.section, room: section.room_number, board: section.board, term: `${section.term_name} • ${section.academic_year}` },
      periods,
      roster: roster.rows.map((row) => ({
        id: row.student_id, admission_number: row.admission_number, avatar_url: row.avatar_url,
        roll_number: row.roll_number, name: `${row.first_name} ${row.last_name}`.trim(),
        status: row.status ?? null, remarks: row.remarks ?? "", attendance_id: row.attendance_id, updated_at: row.updated_at,
      })),
    };
  }

  async saveTeacherAttendance(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceBulkSchema.parse(body);
    const membership = await this.requireSchoolRole(user, ["staff", "admin"]);
    const screen = await this.teacherAttendanceScreen(user, data.class_section_id, data.date);
    const rosterIds = new Set(screen.roster.map((student) => student.id));
    if (data.records.some((record) => !rosterIds.has(record.student_id))) throw new BadRequestException("Every attendance record must belong to the selected class roster.");
    if (new Set(data.records.map((record) => record.student_id)).size !== data.records.length) throw new BadRequestException("A student may only appear once in an attendance submission.");
    await this.db.transaction().execute(async (tx) => {
      for (const record of data.records) {
        await tx.insertInto("attendance_records").values({
          student_id: record.student_id, class_section_id: data.class_section_id, date: data.date,
          status: record.status, remarks: record.remarks, marked_by: user.id,
        }).onConflict((conflict) => conflict.columns(["student_id", "date"]).doUpdateSet({
          class_section_id: data.class_section_id, status: record.status, remarks: record.remarks,
          marked_by: user.id, updated_at: new Date(),
        })).execute();
      }
      await tx.insertInto("audit_events").values({
        action: "attendance.class.submitted", actor_id: user.id, school_id: membership.school_id,
        target_type: "class_section", target_id: data.class_section_id, request_id: request.requestId,
        ip_hash: null, metadata: { date: data.date, records: data.records.length },
      }).execute();
    });
    return this.teacherAttendanceScreen(user, data.class_section_id, data.date);
  }

  async principalHomeScreen(user: AuthUser, selectedDate = today()) {
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const classes = await sql<any>`
      SELECT cs.id, cs.grade, cs.section, cs.room_number, t.id AS term_id, t.name AS term_name, t.academic_year,
        count(DISTINCT e.student_id)::int AS student_count,
        count(DISTINCT ar.student_id)::int AS marked_count,
        count(DISTINCT ar.student_id) FILTER (WHERE ar.status IN ('present','late','half_day'))::int AS attending_count,
        count(DISTINCT ar.student_id) FILTER (WHERE ar.status='absent')::int AS absent_count,
        count(DISTINCT ar.student_id) FILTER (WHERE ar.status='late')::int AS late_count,
        count(DISTINCT ts.id)::int AS timetable_slots,
        count(DISTINCT ts.id) FILTER (WHERE ts.teacher_user_id IS NULL AND ts.slot_type='class')::int AS unassigned_slots
      FROM class_sections cs JOIN academic_terms t ON t.school_id=cs.school_id AND t.academic_year=cs.academic_year AND t.is_active
      LEFT JOIN enrollments e ON e.class_section_id=cs.id AND e.term_id=t.id AND e.is_active
      LEFT JOIN attendance_records ar ON ar.student_id=e.student_id AND ar.date=${selectedDate}::date
      LEFT JOIN timetable_slots ts ON ts.class_section_id=cs.id AND ts.term_id=t.id AND ts.weekday=${isoWeekday(selectedDate)}
      WHERE cs.school_id=${membership.school_id}::uuid
      GROUP BY cs.id, cs.grade, cs.section, cs.room_number, t.id, t.name, t.academic_year
      ORDER BY cs.grade, cs.section
    `.execute(this.db);
    const exceptions = await sql<any>`
      WITH scores AS (
        SELECT st.id, st.admission_number, u.first_name, u.last_name, cs.id AS class_section_id, cs.grade, cs.section,
          t.attendance_threshold, count(ar.id)::int AS recorded_days,
          COALESCE(sum(CASE WHEN ar.status IN ('present','late') THEN 1.0 WHEN ar.status='half_day' THEN 0.5 ELSE 0 END),0)::numeric AS points
        FROM students st JOIN users u ON u.id=st.user_id JOIN enrollments e ON e.student_id=st.id AND e.is_active
        JOIN class_sections cs ON cs.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id AND t.is_active
        LEFT JOIN attendance_records ar ON ar.student_id=st.id AND ar.date BETWEEN t.starts_on AND LEAST(t.ends_on,CURRENT_DATE)
        WHERE st.school_id=${membership.school_id}::uuid
        GROUP BY st.id, st.admission_number, u.first_name, u.last_name, cs.id, cs.grade, cs.section, t.attendance_threshold
      ) SELECT *, round(points*100.0/NULLIF(recorded_days,0),2) AS percentage FROM scores
      WHERE recorded_days >= 5 AND points*100.0/NULLIF(recorded_days,0) < attendance_threshold
      ORDER BY percentage, grade, section LIMIT 20
    `.execute(this.db);
    const totals = classes.rows.reduce((result, row) => ({
      students: result.students + Number(row.student_count), marked: result.marked + Number(row.marked_count),
      attending: result.attending + Number(row.attending_count), absent: result.absent + Number(row.absent_count), late: result.late + Number(row.late_count),
    }), { students: 0, marked: 0, attending: 0, absent: 0, late: 0 });
    return {
      date: selectedDate,
      principal: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim() },
      summary: { ...totals, attendance_percentage: totals.marked ? Math.round(totals.attending * 10_000 / totals.marked) / 100 : 0, classes_total: classes.rows.length, classes_submitted: classes.rows.filter((row) => Number(row.student_count) > 0 && Number(row.student_count) === Number(row.marked_count)).length },
      classes: classes.rows.map((row) => ({ ...row, name: `Class ${row.grade}${row.section}`, submission_status: Number(row.marked_count) === 0 ? "not_started" : Number(row.marked_count) < Number(row.student_count) ? "in_progress" : "submitted", attendance_percentage: Number(row.marked_count) ? Math.round(Number(row.attending_count) * 10_000 / Number(row.marked_count)) / 100 : 0 })),
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
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const section = await this.db.selectFrom("class_sections").selectAll().where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
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
    const slot = await this.db.insertInto("timetable_slots").values({
      class_section_id: data.class_section_id, term_id: term.id, subject_id: data.subject_id ?? null,
      weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at,
      slot_type: data.slot_type, title: data.title, room: data.room, teacher_user_id: data.teacher_user_id ?? null,
      teacher_designation: data.teacher_designation,
    }).returningAll().executeTakeFirstOrThrow();
    await this.db.insertInto("audit_events").values({ action: "timetable.slot.created", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
    return slot;
  }

  async updateTimetableSlot(user: AuthUser, slotId: string, body: unknown, request: AuthenticatedRequest) {
    const data = timetableSlotSchema.parse(body);
    if (data.ends_at <= data.starts_at) throw new BadRequestException("End time must be after start time.");
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.term_id"]).where("ts.id", "=", slotId).where("cs.school_id", "=", membership.school_id).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    const section = await this.db.selectFrom("class_sections").select("id").where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst();
    if (!section) throw new BadRequestException("Selected class does not belong to this school.");
    if (data.teacher_user_id) {
      const teacher = await this.db.selectFrom("school_memberships").select("id").where("school_id", "=", membership.school_id).where("user_id", "=", data.teacher_user_id).where("role", "=", "staff").where("is_active", "=", true).executeTakeFirst();
      if (!teacher) throw new BadRequestException("Selected teacher is not active in this school.");
    }
    const conflict = data.teacher_user_id || data.room ? await this.db.selectFrom("timetable_slots").select("id").where("term_id", "=", current.term_id).where("id", "!=", slotId).where("weekday", "=", data.weekday).where("starts_at", "<", data.ends_at).where("ends_at", ">", data.starts_at).where((eb) => eb.or([...(data.teacher_user_id ? [eb("teacher_user_id", "=", data.teacher_user_id)] : []), ...(data.room ? [eb("room", "=", data.room)] : [])])).executeTakeFirst() : undefined;
    if (conflict) throw new BadRequestException("The selected teacher or room already has an overlapping timetable slot.");
    const slot = await this.db.updateTable("timetable_slots").set({ class_section_id: data.class_section_id, subject_id: data.subject_id ?? null, teacher_user_id: data.teacher_user_id ?? null, weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at, slot_type: data.slot_type, title: data.title, room: data.room, teacher_designation: data.teacher_designation }).where("id", "=", slotId).returningAll().executeTakeFirstOrThrow();
    await this.db.insertInto("audit_events").values({ action: "timetable.slot.updated", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
    return slot;
  }

  async deleteTimetableSlot(user: AuthUser, slotId: string, request: AuthenticatedRequest) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.class_section_id"]).where("ts.id", "=", slotId).where("cs.school_id", "=", membership.school_id).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom("timetable_slots").where("id", "=", slotId).execute();
      await tx.insertInto("audit_events").values({ action: "timetable.slot.deleted", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slotId, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: current.class_section_id } }).execute();
    });
    return { deleted: true, id: slotId };
  }

  async attendanceCreate(user: AuthUser, body: unknown) {
    const data = z.object({ student: z.string().uuid(), class_section: z.string().uuid(), date: z.string().regex(datePattern), status: z.enum(["present", "absent", "late", "excused", "half_day"]), check_in_at: z.string().datetime().nullable().optional(), check_out_at: z.string().datetime().nullable().optional(), remarks: z.string().max(500).optional() }).parse(body);
    const student = await this.studentForUser(user, data.student);
    await this.requireRole(user, student, "staff");
    const section = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", data.class_section).executeTakeFirst();
    if (!section || section.school_id !== student.school_id) throw new BadRequestException("Student and class section must belong to the same school.");
    return this.db.insertInto("attendance_records").values({ student_id: student.id, class_section_id: data.class_section, date: data.date, status: data.status, check_in_at: data.check_in_at ? new Date(data.check_in_at) : null, check_out_at: data.check_out_at ? new Date(data.check_out_at) : null, remarks: data.remarks ?? "", marked_by: user.id }).returningAll().executeTakeFirstOrThrow();
  }

  async attendanceUpdate(user: AuthUser, id: string, body: unknown) {
    const current = await this.db.selectFrom("attendance_records").selectAll().where("id", "=", id).executeTakeFirst();
    if (!current) throw new NotFoundException("Attendance record not found.");
    const student = await this.studentForUser(user, current.student_id);
    await this.requireRole(user, student, "staff");
    const data = z.object({ student: z.string().uuid().optional(), status: z.enum(["present", "absent", "late", "excused", "half_day"]).optional(), check_in_at: z.string().datetime().nullable().optional(), check_out_at: z.string().datetime().nullable().optional(), remarks: z.string().max(500).optional() }).parse(body);
    if (data.student && data.student !== current.student_id) throw new BadRequestException("An attendance record cannot be reassigned.");
    return this.db.updateTable("attendance_records").set({ ...(data.status ? { status: data.status } : {}), ...(data.check_in_at !== undefined ? { check_in_at: data.check_in_at ? new Date(data.check_in_at) : null } : {}), ...(data.check_out_at !== undefined ? { check_out_at: data.check_out_at ? new Date(data.check_out_at) : null } : {}), ...(data.remarks !== undefined ? { remarks: data.remarks } : {}), marked_by: user.id, updated_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }
}
