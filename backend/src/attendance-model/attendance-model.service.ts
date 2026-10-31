import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { operatingRules } from "../operating-rules/rules.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { ActivityAttendanceService } from "../attendance/activity-attendance.service.js";
import { AcademicParticipationBridge } from "../attendance/academic-participation-bridge.service.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";

type Db = Kysely<Database> | Transaction<Database>;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(datePattern);
const sessionSaveSchema = z.object({
  records: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(["present", "absent", "late", "excused"]),
    remarks: z.string().trim().max(500).optional().default(""),
  })).min(1).max(2000),
  expected_revision: z.number().int().min(0),
  photo_session_id: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
const evidenceDecisionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().min(3).max(500),
  expected_revision: z.number().int().min(0),
}).strict();

interface Membership { school_id: string; role: "staff" | "admin" }
interface SessionRow {
  id: string; school_id: string; class_section_id: string; term_id: string; subject_id: string;
  schedule_slot_id: string; session_date: string; period_number: number; starts_at: string; ends_at: string;
  title: string; room: string; scheduled_teacher_id: string | null; state: "draft" | "submitted" | "locked";
  revision: number; submitted_by: string | null; submitted_at: Date | null; auto_finalize_at: Date | null;
  finalization_policy_revision: number | null; finalization_source: "manual" | "automatic" | null;
  locked_by: string | null; locked_at: Date | null; reopened_by: string | null; reopened_at: Date | null;
  reopen_reason: string | null;
}

@Injectable()
export class AttendanceModelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SchoolEventService,
    private readonly participation: ActivityAttendanceService,
    private readonly academic: AcademicParticipationBridge,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commandGateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly domainJournal: DomainEventJournalPort,
  ) {}

  private async membership(db: Db, user: AuthUser, roles: Array<"staff" | "admin">, schoolId?: string): Promise<Membership> {
    const scoped = schoolId ?? user.active_school_id ?? null;
    const result = await sql<Membership>`SELECT school_id,role FROM school_memberships
      WHERE user_id=${user.id}::uuid AND is_active AND role=ANY(${roles}::text[])
        AND (${scoped}::uuid IS NULL OR school_id=${scoped}::uuid)
      ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END,school_id`.execute(db);
    if (!scoped && new Set(result.rows.map((row) => row.school_id)).size > 1) throw new BadRequestException("Select an active institution first.");
    const member = result.rows[0];
    if (!member) throw new ForbiddenException("An active staff membership is required.");
    return member;
  }

  private async canRecord(db: Db, member: Membership, userId: string, session: SessionRow): Promise<boolean> {
    if (member.role === "admin") return true;
    if (session.scheduled_teacher_id === userId) return true;
    const permission = await sql<{ allowed: boolean }>`SELECT
      staff_has_resource_permission(${member.school_id}::uuid,${userId}::uuid,'attendance.record','class',${session.class_section_id}::uuid,${session.session_date}::date)
      OR staff_has_resource_permission(${member.school_id}::uuid,${userId}::uuid,'attendance.record','institution',${member.school_id}::uuid,${session.session_date}::date) AS allowed`.execute(db);
    return Boolean(permission.rows[0]?.allowed);
  }

  private async materialize(db: Db, schoolId: string, date: string) {
    await sql`INSERT INTO attendance_session_registers(
        school_id,class_section_id,term_id,subject_id,schedule_slot_id,session_date,
        period_number,starts_at,ends_at,title,room,scheduled_teacher_id)
      SELECT ${schoolId}::uuid,slot.class_section_id,slot.term_id,slot.subject_id,slot.id,${date}::date,
        slot.period_number,slot.starts_at,slot.ends_at,COALESCE(NULLIF(subject.name,''),NULLIF(slot.title,''),'Scheduled session'),
        slot.room,slot.teacher_user_id
      FROM effective_school_schedule(${schoolId}::uuid,${date}::date) slot
      JOIN subjects subject ON subject.id=slot.subject_id AND subject.school_id=${schoolId}::uuid
      WHERE slot.weekday=EXTRACT(ISODOW FROM ${date}::date)::int
        AND slot.slot_type='class' AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
      ON CONFLICT(school_id,session_date,schedule_slot_id) DO NOTHING`.execute(db);
  }

  async workspace(user: AuthUser, selectedDate: string) {
    const date = dateSchema.parse(selectedDate);
    const member = await this.membership(this.db, user, ["staff", "admin"]);
    const policy = await operatingRules(this.db, member.school_id);
    if (policy.attendance_academic_mode !== "scheduled_session") {
      return { mode: policy.attendance_academic_mode, campus_mode: policy.attendance_campus_mode, capture_channels: policy.attendance_academic_channels, registers: [] };
    }
    await this.materialize(this.db, member.school_id, date);
    const result = await sql<any>`SELECT register.id AS session_id,register.class_section_id,
        register.schedule_slot_id,register.scheduled_teacher_id,teacher.username AS scheduled_teacher_username,
        'Class '||section.grade||section.section AS class_name,section.grade,section.section,
        COALESCE(NULLIF(register.room,''),section.room_number) AS room_number,
        register.term_id,term.name AS term_name,term.academic_year,register.subject_id,subject.name AS subject_name,
        register.period_number,register.starts_at::text,register.ends_at::text,register.room,
        register.state,register.revision,register.submitted_at,register.auto_finalize_at,
        CASE WHEN submitter.id IS NULL THEN NULL ELSE trim(concat_ws(' ',submitter.first_name,submitter.last_name)) END AS submitted_by_name,
        CASE WHEN teacher.id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[trim(concat_ws(' ',teacher.first_name,teacher.last_name))] END AS assigned_teachers,
        count(enrollment.student_id)::int AS student_count,
        count(entry.id)::int AS marked_count,
        count(entry.id) FILTER(WHERE entry.status IN ('present','late'))::int AS attending_count,
        count(entry.id) FILTER(WHERE entry.status='absent')::int AS absent_count,
        (${date}::date <= (${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date) AS date_open,
        (${member.role}='admin' OR register.scheduled_teacher_id=${user.id}::uuid OR
          staff_has_resource_permission(${member.school_id}::uuid,${user.id}::uuid,'attendance.record','class',register.class_section_id,register.session_date) OR
          staff_has_resource_permission(${member.school_id}::uuid,${user.id}::uuid,'attendance.record','institution',${member.school_id}::uuid,register.session_date)) AS authorized
      FROM attendance_session_registers register
      JOIN schools school ON school.id=register.school_id
      JOIN class_sections section ON section.id=register.class_section_id
      JOIN academic_terms term ON term.id=register.term_id
      JOIN subjects subject ON subject.id=register.subject_id
      LEFT JOIN users teacher ON teacher.id=register.scheduled_teacher_id
      LEFT JOIN users submitter ON submitter.id=register.submitted_by
      LEFT JOIN enrollments enrollment ON enrollment.class_section_id=register.class_section_id
        AND enrollment.term_id=register.term_id AND enrollment.is_active AND enrollment.enrolled_on<=register.session_date
      LEFT JOIN attendance_session_entries entry ON entry.session_id=register.id AND entry.student_id=enrollment.student_id
      WHERE register.school_id=${member.school_id}::uuid AND register.session_date=${date}::date
        AND (${member.role}='admin' OR register.scheduled_teacher_id=${user.id}::uuid OR
          staff_has_resource_permission(${member.school_id}::uuid,${user.id}::uuid,'attendance.view','class',register.class_section_id,register.session_date) OR
          staff_has_resource_permission(${member.school_id}::uuid,${user.id}::uuid,'attendance.view','institution',${member.school_id}::uuid,register.session_date))
      GROUP BY register.id,section.id,term.id,subject.id,school.timezone,teacher.id,submitter.id
      ORDER BY register.starts_at,section.grade,section.section,register.period_number`.execute(this.db);
    return {
      mode: policy.attendance_academic_mode,
      campus_mode: policy.attendance_campus_mode,
      capture_channels: policy.attendance_academic_channels,
      registers: result.rows.map((row: any) => ({
        ...row,
        attendance_scope: "scheduled_session" as const,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        periods_today: 1,
        subjects: [row.subject_name],
        assignment_kind: "regular" as const,
        submission_status: row.state === "submitted" || row.state === "locked" ? row.state : Number(row.marked_count) ? "in_progress" : "not_started",
        submission_authorized: true,
        instructional: true,
        can_mark: Boolean(row.date_open && row.authorized && Number(row.student_count)),
        availability_reason: !row.date_open ? "Attendance opens on the selected date." : !row.authorized ? "This subject session is not assigned to you." : !Number(row.student_count) ? "No enrolled students require attendance for this session." : null,
      })),
    };
  }

  /**
   * Responsibility-native register projection used by the canonical Attendance
   * workspace. The caller supplies already-authorized, effective scopes; this
   * method never infers visibility from a membership role or job title.
   */
  async responsibilityWorkspace(input: {
    school_id: string;
    date: string;
    current_local_date: string;
    view_all: boolean;
    record_all: boolean;
    view_class_ids: readonly string[];
    record_class_ids: readonly string[];
  }) {
    const date = dateSchema.parse(input.date);
    const policy = await operatingRules(this.db, input.school_id);
    if (policy.attendance_academic_mode !== "scheduled_session") {
      return {
        mode: policy.attendance_academic_mode,
        campus_mode: policy.attendance_campus_mode,
        capture_channels: policy.attendance_academic_channels,
        registers: [],
      };
    }
    await this.materialize(this.db, input.school_id, date);
    const result = await sql<any>`SELECT register.id AS session_id,register.class_section_id,
        register.schedule_slot_id,register.scheduled_teacher_id,teacher.username AS scheduled_teacher_username,
        'Class '||section.grade||section.section AS class_name,section.grade,section.section,
        COALESCE(NULLIF(register.room,''),section.room_number) AS room_number,
        register.term_id,term.name AS term_name,term.academic_year,register.subject_id,subject.name AS subject_name,
        register.period_number,register.starts_at::text,register.ends_at::text,register.room,
        register.state,register.revision,register.submitted_at,register.auto_finalize_at,
        register.finalization_policy_revision,register.finalization_source,
        CASE WHEN submitter.id IS NULL THEN NULL ELSE trim(concat_ws(' ',submitter.first_name,submitter.last_name)) END AS submitted_by_name,
        CASE WHEN teacher.id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[trim(concat_ws(' ',teacher.first_name,teacher.last_name))] END AS assigned_teachers,
        count(enrollment.student_id)::int AS student_count,count(entry.id)::int AS marked_count,
        count(entry.id) FILTER(WHERE entry.status IN ('present','late'))::int AS attending_count,
        count(entry.id) FILTER(WHERE entry.status='absent')::int AS absent_count,
        (${date}::date<=${input.current_local_date}::date) AS date_open,
        (${input.record_all} OR register.class_section_id=ANY(${sql.val([...input.record_class_ids])}::uuid[])) AS authorized
      FROM attendance_session_registers register
      JOIN class_sections section ON section.id=register.class_section_id
      JOIN academic_terms term ON term.id=register.term_id
      JOIN subjects subject ON subject.id=register.subject_id
      LEFT JOIN users teacher ON teacher.id=register.scheduled_teacher_id
      LEFT JOIN users submitter ON submitter.id=register.submitted_by
      LEFT JOIN enrollments enrollment ON enrollment.class_section_id=register.class_section_id
        AND enrollment.term_id=register.term_id AND enrollment.is_active
        AND enrollment.enrolled_on<=register.session_date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>register.session_date)
      LEFT JOIN attendance_session_entries entry ON entry.session_id=register.id AND entry.student_id=enrollment.student_id
      WHERE register.school_id=${input.school_id}::uuid AND register.session_date=${date}::date
        AND (${input.view_all} OR register.class_section_id=ANY(${sql.val([...input.view_class_ids])}::uuid[]))
      GROUP BY register.id,section.id,term.id,subject.id,teacher.id,submitter.id
      ORDER BY register.starts_at,section.grade,section.section,register.period_number`.execute(this.db);
    return {
      mode: policy.attendance_academic_mode,
      campus_mode: policy.attendance_campus_mode,
      capture_channels: policy.attendance_academic_channels,
      registers: result.rows.map((row: any) => ({
        ...row,
        attendance_scope: "scheduled_session" as const,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        periods_today: 1,
        subjects: [row.subject_name],
        assignment_kind: "regular" as const,
        submission_status: row.state === "submitted" || row.state === "locked"
          ? row.state
          : Number(row.marked_count) ? "in_progress" : "not_started",
        submission_authorized: true,
        instructional: true,
        can_mark: Boolean(row.date_open && row.authorized && Number(row.student_count)),
        availability_reason: !row.date_open
          ? "Attendance opens on the selected date."
          : !row.authorized
            ? "Your current responsibility allows review, but not recording attendance for this session."
            : !Number(row.student_count)
              ? "No enrolled students require attendance for this session."
              : null,
      })),
    };
  }

  private async sessionRow(db: Db, sessionId: string): Promise<SessionRow> {
    const result = await sql<SessionRow>`SELECT id,school_id,class_section_id,term_id,subject_id,schedule_slot_id,
      session_date::text,period_number,starts_at::text,ends_at::text,title,room,scheduled_teacher_id,
      state,revision,submitted_by,submitted_at,auto_finalize_at,finalization_policy_revision,finalization_source,
      locked_by,locked_at,reopened_by,reopened_at,reopen_reason
      FROM attendance_session_registers WHERE id=${sessionId}::uuid`.execute(db);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Attendance session not found.");
    return row;
  }

  private async screenFromDb(db: Db, user: AuthUser, sessionIdValue: string) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const session = await this.sessionRow(db, sessionId);
    const member = await this.membership(db, user, ["staff", "admin"], session.school_id);
    const canRecord = await this.canRecord(db, member, user.id, session);
    if (!canRecord) throw new ForbiddenException("This subject session is not assigned to you.");
    const policy = await operatingRules(db, session.school_id);
    if (policy.attendance_academic_mode !== "scheduled_session") throw new ConflictException("Subject-session attendance is not enabled for this institution.");
    const result = await sql<any>`SELECT student.id,student.admission_number,student.avatar_url,enrollment.roll_number,
        trim(concat_ws(' ',person.first_name,person.last_name)) AS name,entry.id AS attendance_id,
        entry.status,COALESCE(entry.remarks,'') AS remarks,entry.revision AS attendance_revision,entry.updated_at
      FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
      JOIN school_people person ON person.id=student.person_id
      LEFT JOIN attendance_session_entries entry ON entry.session_id=${session.id}::uuid AND entry.student_id=student.id
      WHERE enrollment.class_section_id=${session.class_section_id}::uuid AND enrollment.term_id=${session.term_id}::uuid
        AND enrollment.is_active AND enrollment.enrolled_on<=${session.session_date}::date
      ORDER BY enrollment.roll_number`.execute(db);
    const pendingEvidence = await sql<any>`SELECT evidence.id,evidence.student_id,evidence.capture_channel,
        evidence.observed_at,evidence.updated_at,
        trim(concat_ws(' ',person.first_name,person.last_name)) AS student_name,
        student.admission_number
      FROM attendance_session_evidence evidence
      JOIN students student ON student.id=evidence.student_id AND student.school_id=evidence.school_id
      JOIN school_people person ON person.id=student.person_id
      WHERE evidence.session_id=${session.id}::uuid AND evidence.state='pending'
      ORDER BY evidence.observed_at,evidence.id`.execute(db);
    const context = await sql<any>`SELECT section.grade,section.section,section.room_number,section.board,
        term.name AS term_name,term.academic_year,term.starts_on::text,term.ends_on::text,
        subject.name AS subject_name,school.timezone,
        CASE WHEN actor.id IS NULL THEN NULL ELSE trim(concat_ws(' ',actor.first_name,actor.last_name)) END AS submitted_by_name,
        ${session.session_date}::date <= (${executionNow()}::timestamptz AT TIME ZONE school.timezone)::date AS date_open
      FROM class_sections section JOIN academic_terms term ON term.id=${session.term_id}::uuid
      JOIN subjects subject ON subject.id=${session.subject_id}::uuid JOIN schools school ON school.id=${session.school_id}::uuid
      LEFT JOIN users actor ON actor.id=${session.submitted_by}::uuid WHERE section.id=${session.class_section_id}::uuid`.execute(db);
    const info = context.rows[0];
    const capturedAt = executionNow().toISOString();
    return {
      attendance_scope: "scheduled_session" as const,
      session: { id: session.id, subject_id: session.subject_id, subject_name: info.subject_name, period_number: session.period_number, starts_at: session.starts_at, ends_at: session.ends_at },
      capture_policy: { channels: policy.attendance_academic_channels, self_check_in_mode: policy.attendance_self_check_in_mode },
      date: session.session_date,
      availability: { can_mark: Boolean(info.date_open && canRecord && session.state !== "locked"), reason: !info.date_open ? "Attendance opens on the selected date." : session.state === "locked" ? "This register is final." : null },
      class: { id: session.class_section_id, school_id: session.school_id, term_id: session.term_id, name: `Class ${info.grade}${info.section}`, grade: info.grade, section: info.section, room: session.room || info.room_number, board: info.board, term: `${info.term_name} • ${info.academic_year}`, term_starts_on: info.starts_on, term_ends_on: info.ends_on },
      register: { id: session.id, state: session.state, revision: session.revision, submitted_by: session.submitted_by, submitted_at: session.submitted_at, submitted_by_name: info.submitted_by_name, locked_by: session.locked_by, locked_at: session.locked_at, reopened_by: session.reopened_by, reopened_at: session.reopened_at, reopen_reason: session.reopen_reason, auto_finalize_at: session.auto_finalize_at, finalization_policy_revision: session.finalization_policy_revision, finalization_source: session.finalization_source },
      periods: [{ id: session.schedule_slot_id, period_number: session.period_number, starts_at: session.starts_at, ends_at: session.ends_at, display_title: info.subject_name, room: session.room || info.room_number }],
      roster: result.rows,
      pending_evidence: pendingEvidence.rows,
      continuity_snapshot: { roster_fingerprint: createHash("sha256").update(result.rows.map((row: any) => row.id).sort().join(":" )).digest("hex"), roster_count: result.rows.length, captured_at: capturedAt, expires_at: capturedAt, token: "" },
      latest_capture: null,
    };
  }

  async screen(user: AuthUser, sessionIdValue: string) {
    return this.screenFromDb(this.db, user, sessionIdValue);
  }

  async save(user: AuthUser, sessionIdValue: string, body: unknown, request: AuthenticatedRequest) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const input = sessionSaveSchema.parse(body);
    return this.db.transaction().execute(async (db) => {
      const session = await this.sessionRow(db,sessionId);
      const member = await this.membership(db,user,["staff","admin"],session.school_id);
      if (!await this.canRecord(db,member,user.id,session)) throw new ForbiddenException("This subject session is not assigned to you.");
      const policy = await operatingRules(db,session.school_id);
      if (policy.attendance_academic_mode !== "scheduled_session") throw new ConflictException("Subject-session attendance is not enabled.");
      const accepted = await this.academic.saveSessionRecordsInTransaction(db,user,session.school_id,sessionId,input,request);
      if ("legacy_result" in accepted) return accepted.legacy_result as Awaited<ReturnType<AttendanceModelService['screenFromDb']>>;
      const result = await this.screenFromDb(db,user,sessionId);
      await this.academic.retainLegacyResult(db,{command_id: accepted.command_id,school_id: session.school_id,
        source_kind: "scheduled_session",source_id: sessionId,request_hash: accepted.request_hash,
        result_body: result,records_count: input.records.length,photo_session_id: input.photo_session_id});
      return result;
    });
  }

  async setLock(user: AuthUser, sessionIdValue: string, locked: boolean, body: unknown, request: AuthenticatedRequest) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const input = z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict().parse(body ?? {});
    if (!locked && !input.reason) throw new BadRequestException("A reason is required to reopen a final register.");
    return this.db.transaction().execute(async(db) => {
      const session = await this.sessionRow(db,sessionId);
      await this.membership(db,user,["admin"],session.school_id);
      const prepared = await this.academic.prepareSessionInTransaction(db,user,session.school_id,sessionId,true);
      const current = (await sql<{state:string;revision:number}>`SELECT state,revision FROM activity_attendance_registers
        WHERE id=${prepared.register_id}::uuid FOR UPDATE`.execute(db)).rows[0]!;
      if ((locked&&current.state==='locked') || (!locked&&current.state!=='locked')) return this.screenFromDb(db,user,sessionId);
      const commandRequest = {...request,headers:{...request.headers,"idempotency-key":request.headers["idempotency-key"] ?? `legacy-lifecycle:${request.requestId}`}} as AuthenticatedRequest;
      await this.participation.transition(user,session.school_id,prepared.register_id,locked ? "finalize" : "reopen",
        {expected_revision:current.revision,...(input.reason ? {reason:input.reason} : {})},commandRequest,db);
      return this.screenFromDb(db,user,sessionId);
    });
  }

  async history(user: AuthUser, sessionIdValue: string) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const session = await this.sessionRow(this.db, sessionId);
    await this.membership(this.db, user, ["admin"], session.school_id);
    const screen = await this.screenFromDb(this.db, user, sessionId);
    const [submissions, revisions] = await Promise.all([
      sql<any>`SELECT submission.id,submission.register_revision,submission.records_count,submission.changed_count,
          submission.created_at,trim(concat_ws(' ',actor.first_name,actor.last_name)) AS submitted_by_name,
          submission.capture_source,NULL::timestamptz AS observed_at,submission.source_photo_session_id::text AS source_reference
        FROM attendance_session_submissions submission JOIN users actor ON actor.id=submission.submitted_by
        WHERE submission.session_id=${sessionId}::uuid ORDER BY submission.register_revision DESC,submission.created_at DESC`.execute(this.db),
      sql<any>`SELECT history.id,history.student_id,history.previous_status,history.new_status,
          history.previous_remarks,history.new_remarks,history.reason,history.register_revision,history.created_at,
          trim(concat_ws(' ',person.first_name,person.last_name)) AS student_name,
          trim(concat_ws(' ',actor.first_name,actor.last_name)) AS changed_by_name
        FROM attendance_session_entry_revisions history
        JOIN students student ON student.id=history.student_id
        JOIN school_people person ON person.id=student.person_id
        JOIN users actor ON actor.id=history.changed_by
        WHERE history.session_id=${sessionId}::uuid
        ORDER BY history.register_revision DESC,student_name,history.id DESC`.execute(this.db),
    ]);
    return { date: session.session_date, class: screen.class, register: screen.register, submissions: submissions.rows, revisions: revisions.rows };
  }

  async refreshSubjectAggregate(db: Db, schoolId: string, termId: string, subjectId: string) {
    await sql`INSERT INTO subject_attendance(student_id,subject_id,term_id,classes_held,classes_attended,classes_excused)
      SELECT enrollment.student_id,${subjectId}::uuid,${termId}::uuid,
        count(register.id) FILTER(WHERE register.state IN ('submitted','locked'))::int,
        count(entry.id) FILTER(WHERE register.state IN ('submitted','locked') AND entry.status IN ('present','late'))::int,
        count(entry.id) FILTER(WHERE register.state IN ('submitted','locked') AND entry.status='excused')::int
      FROM enrollments enrollment
      JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=${schoolId}::uuid
      LEFT JOIN attendance_session_registers register ON register.class_section_id=enrollment.class_section_id
        AND register.term_id=enrollment.term_id AND register.subject_id=${subjectId}::uuid
      LEFT JOIN attendance_session_entries entry ON entry.session_id=register.id AND entry.student_id=enrollment.student_id
      WHERE enrollment.term_id=${termId}::uuid AND enrollment.is_active
      GROUP BY enrollment.student_id
      ON CONFLICT(student_id,subject_id,term_id) DO UPDATE SET classes_held=excluded.classes_held,
        classes_attended=excluded.classes_attended,classes_excused=excluded.classes_excused`.execute(db);
  }

  async issueQr(user: AuthUser, sessionIdValue: string, request: AuthenticatedRequest) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    return this.db.transaction().execute(async (db) => {
      let session = await this.sessionRow(db, sessionId);
      const member = await this.membership(db, user, ["staff", "admin"], session.school_id);
      if (!await this.canRecord(db, member, user.id, session)) throw new ForbiddenException("This subject session is not assigned to you.");
      if (session.state === "locked") throw new ForbiddenException("This attendance register is final.");
      const policy = await operatingRules(db, session.school_id);
      const approved = (await sql<{ allowed: boolean }>`SELECT revision>0 AND updated_by IS NOT NULL AS allowed
        FROM institution_operating_rules WHERE school_id=${session.school_id}::uuid FOR SHARE`.execute(db)).rows[0]?.allowed;
      if (!approved || !policy.attendance_academic_channels.includes("student_qr") || policy.attendance_self_check_in_mode === "disabled") {
        throw new ConflictException("QR check-in needs an explicitly approved current institution rule.");
      }
      const common = await this.academic.prepareSessionInTransaction(db,user,session.school_id,session.id,true);
      // Common truth precedes its derived legacy lifecycle row in every writer.
      // The short-lived source must use that same lock order.
      await sql`SELECT id FROM activity_attendance_registers WHERE id=${common.register_id}::uuid
        AND school_id=${session.school_id}::uuid FOR UPDATE`.execute(db);
      session=await this.sessionRow(db,sessionId);
      if (session.state === "locked") throw new ForbiddenException("This attendance register is final.");
      if (!await this.canRecord(db,member,user.id,session)) throw new ForbiddenException("This subject session is not assigned to you.");
      const targetId = common.register_id;
      const target = { kind: "attendance_register" as const,domain: "attendance",domain_id: targetId,label: session.title,
        lifecycle_state: "active" as const,source_revision: Math.max(1,session.revision),metadata: {} };
      const now = executionNow(), expiresAt = new Date(now.getTime()+2*60_000), challengeId = randomUUID();
      const prepared = await this.commandGateway.prepareDomainCommand(db,{ school_id: session.school_id,actor_user_id: user.id,
        command_type: "attendance.qr.issue",handler_key: "attendance.qr_issue",handler_version: 1,source_domain: "attendance",target,
        current_revision: session.revision,expected_revision: session.revision,capability: "attendance:record",purpose: "issue_short_lived_own_check_in_source",
        requested_at: now.toISOString(),correlation_id: request.requestId,causation_id: null,idempotency_key: `qr-issue:${request.requestId}`,
        operating_rule_version_ref: `institution_operating_rules:${session.school_id}:${policy.revision}`,configuration_refs: [],
        authority_attestation: { evaluator_domain: "attendance",decision: "allowed",reason_codes: ["current_academic_recorder"],
          authority_source_refs: [{ session_id: session.id,register_id: targetId,school_id: session.school_id }],
          operating_rule_refs: [{ revision: policy.revision }],valid_until: expiresAt.toISOString() },safe_context: { session_id: session.id } });
      if (prepared.status !== "ready") throw new ConflictException("Request a fresh QR challenge.");
      const token = randomBytes(32).toString("base64url"), hash = createHash("sha256").update(token).digest("hex");
      await sql`INSERT INTO attendance_qr_challenges(id,school_id,session_id,token_hash,issued_by,expires_at)
        VALUES(${challengeId}::uuid,${session.school_id}::uuid,${session.id}::uuid,${hash},${user.id}::uuid,${expiresAt})`.execute(db);
      const eventId = await this.events.enqueueRegisterEvent(db,{ schoolId: session.school_id,classSectionId: session.class_section_id,
        termId: session.term_id,date: session.session_date,sessionId: session.id,requestId: request.requestId,state: session.state,
        revision: session.revision,actorId: user.id,action: "qr.issued" });
      const event = await this.domainJournal.recordAcceptedEvent(db,{ school_id: session.school_id,source_outbox_event_id: eventId,
        event_type: `attendance.register.${session.state}`,subject: target,actor_user_id: user.id,context: null,audience_user_ids: [user.id],
        occurred_at: now.toISOString(),effective_from: now.toISOString(),effective_until: expiresAt.toISOString(),source_domain: "attendance",
        source_record_id: session.id,source_revision: Math.max(1,session.revision),correlation_id: request.requestId,causation_event_id: null,
        idempotency_key: `qr-issued:${challengeId}`,payload: { challenge_id: challengeId,session_id: session.id,expires_at: expiresAt.toISOString() } });
      await this.commandGateway.completeDomainCommand(db,{ school_id: session.school_id,command_id: prepared.command_id,terminal_state: "accepted",
        code: "short_lived_qr_issued",explanation: "The authorized recorder issued a short-lived source for each identified participant's own report, not attendance authority.",
        resulting_revision: session.revision,domain_event_id: eventId,metadata: { challenge_id: challengeId,model_event_id: event.event_id },completed_at: now.toISOString() });
      return { token,expires_at: expiresAt.toISOString(),session_id: session.id };
    });
  }

  async selfCheckIn(user: AuthUser, tokenValue: unknown, request: AuthenticatedRequest) {
    const token = z.string().min(32).max(128).parse(tokenValue), hash = createHash("sha256").update(token).digest("hex");
    return this.db.transaction().execute(async (db) => {
      const challenge = (await sql<{ id: string;session_id: string;school_id: string;expires_at: Date;revoked_at: Date | null }>`
        SELECT id,session_id,school_id,expires_at,revoked_at FROM attendance_qr_challenges WHERE token_hash=${hash} FOR UPDATE`.execute(db)).rows[0];
      if (!challenge || challenge.revoked_at || new Date(challenge.expires_at).getTime()<=executionNow().getTime()) {
        throw new BadRequestException("This QR check-in has expired.");
      }
      const prepared = await this.academic.prepareSessionForParticipantInTransaction(db,user,challenge.school_id,challenge.session_id,true);
      const policy = await operatingRules(db,challenge.school_id);
      const window = (await sql<{ opens_at: Date;closes_at: Date }>`SELECT
        ((${prepared.context.date}::date+session.starts_at) AT TIME ZONE school.timezone)-make_interval(mins=>${policy.attendance_session_open_before_minutes}) AS opens_at,
        ((${prepared.context.date}::date+session.ends_at) AT TIME ZONE school.timezone)+make_interval(mins=>${policy.attendance_session_close_after_minutes}) AS closes_at
        FROM attendance_session_registers session JOIN schools school ON school.id=session.school_id
        WHERE session.id=${challenge.session_id}::uuid AND session.school_id=${challenge.school_id}::uuid`.execute(db)).rows[0]!;
      const result = await this.participation.selfCheckInInTransaction(db,user,challenge.school_id,prepared.register_id,
        {source_reference:challenge.id,window:{opens_at:window.opens_at.toISOString(),closes_at:window.closes_at.toISOString()}},request);
      return {status:result.status,evidence_id:result.evidence_id,session_id:challenge.session_id};
    });
  }

  async decideEvidence(
    user: AuthUser,sessionIdValue: string,evidenceIdValue: string,body: unknown,request: AuthenticatedRequest,
  ) {
    const sessionId=z.string().uuid().parse(sessionIdValue),evidenceId=z.string().uuid().parse(evidenceIdValue),input=evidenceDecisionSchema.parse(body);
    return this.db.transaction().execute(async(db) => {
      const session=await this.sessionRow(db,sessionId);
      const prepared=await this.academic.prepareSessionInTransaction(db,user,session.school_id,sessionId,true);
      await this.participation.decideEvidence(user,session.school_id,prepared.register_id,evidenceId,
        {decision:input.decision,reason:input.note,expected_revision:input.expected_revision},request,db);
      return this.screenFromDb(db,user,sessionId);
    });
  }

}
