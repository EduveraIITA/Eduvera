import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { recordAttendanceModelObservations } from "../attendance/attendance-model-observation.js";
import { CAMPUS_MODEL_CORE_PORT, type CampusModelCorePort } from "../campus-model-core/campus-model-core.port.js";
import { OBSERVATION_INGRESS_PORT, type ObservationIngressPort } from "../campus-model-core/observation-ingress.port.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { operatingRules } from "../operating-rules/rules.js";
import { SchoolEventService } from "../school/school-event.service.js";

type Db = Kysely<Database> | Transaction<Database>;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(datePattern);
const sessionSaveSchema = z.object({
  records: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(["present", "absent", "late", "excused"]),
    remarks: z.string().trim().max(500).optional().default(""),
  })).min(1).max(250),
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
    @Inject(CAMPUS_MODEL_CORE_PORT) private readonly campusModelCore: CampusModelCorePort,
    @Optional() @Inject(OBSERVATION_INGRESS_PORT) private readonly observationIngress?: ObservationIngressPort,
  ) {}

  private recordModelCommand(
    db: Transaction<Database>,
    input: {
      session: SessionRow;
      actorUserId: string;
      commandType: string;
      idempotencyKey: string;
      correlationId: string;
      expectedRevision: number;
      resultingRevision: number;
      operatingRuleRevision: number;
      domainEventId: string;
      outcomeCode: string;
      explanation: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.campusModelCore.recordAcceptedChange(db, {
      school_id: input.session.school_id,
      actor_user_id: input.actorUserId,
      command_type: input.commandType,
      target: { domain: "attendance", domain_id: input.session.id },
      idempotency_key: input.idempotencyKey,
      correlation_id: input.correlationId,
      causation_id: null,
      expected_revision: input.expectedRevision,
      authority_evidence: [
        `attendance_session_register:${input.session.id}`,
        `institution_operating_rules:${input.operatingRuleRevision}`,
      ],
      operating_rule_version_ref: `institution_operating_rules:${input.operatingRuleRevision}`,
      source_domain: "attendance",
      safe_context: {
        class_section_id: input.session.class_section_id,
        subject_id: input.session.subject_id,
        session_date: input.session.session_date,
        period_number: input.session.period_number,
      },
      entities: [{
        kind: "attendance_register",
        domain: "attendance",
        domain_id: input.session.id,
        label: input.session.title,
        lifecycle_state: "active",
        source_revision: input.resultingRevision,
        metadata: {
          class_section_id: input.session.class_section_id,
          subject_id: input.session.subject_id,
          session_date: input.session.session_date,
          period_number: input.session.period_number,
        },
      }],
      relationships: [],
      outcome: {
        code: input.outcomeCode,
        explanation: input.explanation,
        resulting_revision: input.resultingRevision,
        metadata: input.metadata ?? {},
      },
      domain_event_id: input.domainEventId,
    });
  }

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
        (${date}::date <= (now() AT TIME ZONE school.timezone)::date) AS date_open,
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

  private async sessionRow(db: Db, sessionId: string, forUpdate = false): Promise<SessionRow> {
    const result = await sql<SessionRow>`SELECT id,school_id,class_section_id,term_id,subject_id,schedule_slot_id,
      session_date::text,period_number,starts_at::text,ends_at::text,title,room,scheduled_teacher_id,
      state,revision,submitted_by,submitted_at,auto_finalize_at,finalization_policy_revision,finalization_source,
      locked_by,locked_at,reopened_by,reopened_at,reopen_reason
      FROM attendance_session_registers WHERE id=${sessionId}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`.execute(db);
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
        ${session.session_date}::date <= (now() AT TIME ZONE school.timezone)::date AS date_open
      FROM class_sections section JOIN academic_terms term ON term.id=${session.term_id}::uuid
      JOIN subjects subject ON subject.id=${session.subject_id}::uuid JOIN schools school ON school.id=${session.school_id}::uuid
      LEFT JOIN users actor ON actor.id=${session.submitted_by}::uuid WHERE section.id=${session.class_section_id}::uuid`.execute(db);
    const info = context.rows[0];
    const capturedAt = new Date().toISOString();
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
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new BadRequestException("A valid Idempotency-Key header is required.");
    const requestHash = createHash("sha256").update(JSON.stringify({ sessionId, ...input, records: [...input.records].sort((a,b) => a.student_id.localeCompare(b.student_id)) })).digest("hex");
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(db);
      const session = await this.sessionRow(db, sessionId, true);
      const member = await this.membership(db, user, ["staff", "admin"], session.school_id);
      if (!await this.canRecord(db, member, user.id, session)) throw new ForbiddenException("This subject session is not assigned to you.");
      const policy = await operatingRules(db, session.school_id);
      if (policy.attendance_academic_mode !== "scheduled_session") throw new ConflictException("Subject-session attendance is not enabled.");
      const duplicate = await sql<{ request_hash: string; result_body: any }>`SELECT request_hash,result_body FROM attendance_session_submissions
        WHERE school_id=${session.school_id}::uuid AND submitted_by=${user.id}::uuid AND idempotency_key=${idempotencyKey}`.execute(db);
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== requestHash) throw new ConflictException("This Idempotency-Key was used for different attendance data.");
        return duplicate.rows[0].result_body;
      }
      if (session.revision !== input.expected_revision) throw new ConflictException("This register changed after it was opened. Refresh before submitting.");
      if (session.state === "locked") throw new ForbiddenException("This attendance register is final.");
      const roster = await sql<{ student_id: string }>`SELECT enrollment.student_id FROM enrollments enrollment
        JOIN students student ON student.id=enrollment.student_id AND student.school_id=${session.school_id}::uuid
        WHERE enrollment.class_section_id=${session.class_section_id}::uuid AND enrollment.term_id=${session.term_id}::uuid
          AND enrollment.is_active AND enrollment.enrolled_on<=${session.session_date}::date
        ORDER BY enrollment.student_id FOR SHARE OF enrollment,student`.execute(db);
      const rosterIds = new Set(roster.rows.map((row) => row.student_id));
      if (input.records.length !== rosterIds.size || input.records.some((record) => !rosterIds.has(record.student_id)) || new Set(input.records.map((record) => record.student_id)).size !== input.records.length) throw new BadRequestException("Mark every enrolled student once before submitting this subject register.");
      const previousResult = await sql<any>`SELECT * FROM attendance_session_entries WHERE session_id=${session.id}::uuid FOR UPDATE`.execute(db);
      const previous = new Map(previousResult.rows.map((row: any) => [row.student_id as string,row]));
      const changed = input.records.filter((record) => { const before = previous.get(record.student_id); return !before || before.status !== record.status || before.remarks !== record.remarks; });
      if (changed.some((record) => previous.has(record.student_id)) && !input.reason) throw new BadRequestException("Add a reason when correcting recorded attendance.");
      let photo: { id: string; analysis_summary: any; observed_at: Date } | undefined;
      if (input.photo_session_id) {
        const photoResult = await sql<{ id: string; analysis_summary: any; observed_at: Date; state: string; expires_at: Date }>`SELECT id,analysis_summary,observed_at,state,expires_at
          FROM photo_attendance_sessions WHERE id=${input.photo_session_id}::uuid AND school_id=${session.school_id}::uuid
            AND class_section_id=${session.class_section_id}::uuid AND date=${session.session_date}::date
            AND attendance_session_id=${session.id}::uuid FOR UPDATE`.execute(db);
        const candidate = photoResult.rows[0];
        if (!candidate) throw new BadRequestException("The selected photo analysis does not belong to this subject register.");
        if (candidate.expires_at < new Date()) throw new ConflictException("The photo analysis expired. Capture a new photo or continue manually.");
        if (candidate.state !== "analyzed") throw new ConflictException("This photo analysis has already been applied or discarded.");
        photo = candidate;
      }
      const photoMatched = new Set<string>(Array.isArray(photo?.analysis_summary?.matched_student_ids) ? photo.analysis_summary.matched_student_ids : []);
      const revision = session.revision + 1;
      const now = new Date();
      const autoFinalizeAt = policy.attendance_finalization_mode === "automatic" ? new Date(now.getTime() + policy.attendance_auto_finalize_minutes * 60_000) : null;
      await sql`UPDATE attendance_session_registers SET state='submitted',revision=${revision},submitted_by=${user.id}::uuid,
        submitted_at=${now},auto_finalize_at=${autoFinalizeAt},finalization_policy_revision=${policy.revision},finalization_source=NULL,updated_at=${now}
        WHERE id=${session.id}::uuid`.execute(db);
      const submission = await sql<{ id: string }>`INSERT INTO attendance_session_submissions(school_id,session_id,submitted_by,idempotency_key,request_hash,request_id,register_revision,records_count,changed_count,capture_source,source_photo_session_id)
        VALUES(${session.school_id}::uuid,${session.id}::uuid,${user.id}::uuid,${idempotencyKey},${requestHash},${request.requestId}::uuid,${revision},${input.records.length},${changed.length},${photo ? "camera_assisted" : "staff_roll_call"},${photo?.id ?? null}::uuid) RETURNING id`.execute(db);
      const changedRevisions: Array<{
        revisionId: string;
        entryId: string;
        studentId: string;
        status: "present" | "absent" | "late" | "excused";
        remarks: string;
        previousStatus: "present" | "absent" | "late" | "excused" | null;
        captureSource: string;
        observedAt: Date;
        cameraMatched: boolean;
      }> = [];
      for (const record of changed) {
        const before = previous.get(record.student_id);
        const cameraMatched = Boolean(photo && record.status === "present" && photoMatched.has(record.student_id));
        const captureChannel = cameraMatched ? "camera_assisted" : "staff_roll_call";
        const observedAt = cameraMatched ? photo!.observed_at : now;
        const saved = await sql<{ id: string }>`INSERT INTO attendance_session_entries(school_id,session_id,student_id,status,remarks,capture_channel,observed_at,recorded_by,revision,updated_at)
          VALUES(${session.school_id}::uuid,${session.id}::uuid,${record.student_id}::uuid,${record.status},${record.remarks},${captureChannel},${observedAt},${user.id}::uuid,${revision},${now})
          ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,remarks=excluded.remarks,capture_channel=excluded.capture_channel,observed_at=excluded.observed_at,recorded_by=excluded.recorded_by,revision=excluded.revision,updated_at=excluded.updated_at RETURNING id`.execute(db);
        const savedRevision = await sql<{ id: string }>`INSERT INTO attendance_session_entry_revisions(school_id,session_id,entry_id,submission_id,student_id,previous_status,new_status,previous_remarks,new_remarks,capture_channel,reason,changed_by,request_id,register_revision)
          VALUES(${session.school_id}::uuid,${session.id}::uuid,${saved.rows[0]!.id}::uuid,${submission.rows[0]!.id}::uuid,${record.student_id}::uuid,${before?.status ?? null},${record.status},${before?.remarks ?? null},${record.remarks},${captureChannel},${before ? input.reason! : cameraMatched ? 'Teacher accepted the camera-assisted presence suggestion.' : 'Initial subject register submission'},${user.id}::uuid,${request.requestId}::uuid,${revision}) RETURNING id`.execute(db);
        changedRevisions.push({
          revisionId: savedRevision.rows[0]!.id,
          entryId: saved.rows[0]!.id,
          studentId: record.student_id,
          status: record.status,
          remarks: record.remarks,
          previousStatus: before?.status ?? null,
          captureSource: captureChannel,
          observedAt,
          cameraMatched,
        });
        if (cameraMatched) {
          await sql`INSERT INTO attendance_session_evidence(school_id,session_id,student_id,capture_channel,state,observed_at,submitted_by,provider_reference,metadata,decided_by,decided_at,decision_note)
            VALUES(${session.school_id}::uuid,${session.id}::uuid,${record.student_id}::uuid,'camera_assisted','accepted',${observedAt},${user.id}::uuid,${photo!.id}::text,
              ${JSON.stringify({ photo_session_id: photo!.id })}::jsonb,${user.id}::uuid,${now},'Accepted during full-register photo review.')
            ON CONFLICT(session_id,student_id,capture_channel) WHERE state<>'rejected' DO UPDATE SET state='accepted',observed_at=excluded.observed_at,
              provider_reference=excluded.provider_reference,metadata=excluded.metadata,decided_by=excluded.decided_by,decided_at=excluded.decided_at,decision_note=excluded.decision_note,updated_at=now()`.execute(db);
        }
      }
      if (photo) {
        await sql`UPDATE photo_attendance_sessions SET state='applied',applied_at=${now},applied_session_submission_id=${submission.rows[0]!.id}::uuid,updated_at=${now}
          WHERE id=${photo.id}::uuid`.execute(db);
      }
      await this.refreshSubjectAggregate(db, session.school_id, session.term_id, session.subject_id);
      await sql`INSERT INTO attendance_session_audits(school_id,session_id,actor_id,action,metadata)
        VALUES(${session.school_id}::uuid,${session.id}::uuid,${user.id}::uuid,'register.submitted',${JSON.stringify({ revision, changed: changed.length, records: input.records.length, source: photo ? "camera_assisted" : "staff_roll_call", photo_session_id: photo?.id ?? null })}::jsonb)`.execute(db);
      const attendanceEvents = changedRevisions.length
        ? await this.events.enqueueAttendanceUpdates(db, {
          schoolId: session.school_id,
          classSectionId: session.class_section_id,
          termId: session.term_id,
          date: session.session_date,
          sessionId: session.id,
          requestId: request.requestId,
          suppressNotifications: true,
          records: changedRevisions.map((record) => ({
            id: record.entryId,
            student_id: record.studentId,
            status: record.status,
            remarks: record.remarks,
            previous_status: record.previousStatus,
            revision,
          })),
        })
        : { studentEventIds: new Map<string, string>(), classEventId: null };
      const registerEventId = await this.events.enqueueRegisterEvent(db, {
        schoolId: session.school_id,
        classSectionId: session.class_section_id,
        termId: session.term_id,
        date: session.session_date,
        sessionId: session.id,
        requestId: request.requestId,
        state: "submitted",
        revision,
        actorId: user.id,
      });
      await recordAttendanceModelObservations({
        ingress: this.observationIngress,
        transaction: db,
        schoolId: session.school_id,
        classSectionId: session.class_section_id,
        date: session.session_date,
        sessionId: session.id,
        actorUserId: user.id,
        sourceType: "attendance.session",
        sourceRef: submission.rows[0]!.id,
        state: "accepted",
        receivedAt: now,
        participationScope: "scheduled_session",
        records: changedRevisions.map((record) => {
          const domainEventId = attendanceEvents.studentEventIds.get(record.studentId);
          if (!domainEventId) throw new ConflictException("The subject attendance evidence chain could not be retained.");
          return {
            studentId: record.studentId,
            sourceRecordId: record.revisionId,
            status: record.status,
            observedAt: record.observedAt,
            captureSource: record.captureSource,
            evidenceRefs: [
              `attendance_session_entry_revision:${record.revisionId}`,
              `attendance_session_submission:${submission.rows[0]!.id}`,
              ...(record.cameraMatched && photo ? [`photo_attendance_session:${photo.id}`] : []),
            ],
            domainEventId,
            decisionProvenance: record.cameraMatched ? "human_accepted_camera_suggestion" : "human_attendance_decision",
          };
        }),
      });
      await this.recordModelCommand(db, {
        session,
        actorUserId: user.id,
        commandType: "attendance.register.submit",
        idempotencyKey: `attendance-register-submit:${submission.rows[0]!.id}`,
        correlationId: request.requestId,
        expectedRevision: session.revision,
        resultingRevision: revision,
        operatingRuleRevision: policy.revision,
        domainEventId: registerEventId,
        outcomeCode: "submitted",
        explanation: "The authorized staff member submitted the complete subject attendance register.",
        metadata: {
          submission_id: submission.rows[0]!.id,
          records_count: input.records.length,
          changed_count: changed.length,
          finalization_mode: policy.attendance_finalization_mode,
          auto_finalize_at: autoFinalizeAt?.toISOString() ?? null,
        },
      });
      const result = await this.screenFromDb(db, user, session.id);
      await sql`UPDATE attendance_session_submissions SET result_body=${JSON.stringify(result)}::jsonb WHERE id=${submission.rows[0]!.id}::uuid`.execute(db);
      return result;
    });
  }

  async setLock(user: AuthUser, sessionIdValue: string, locked: boolean, body: unknown, request: AuthenticatedRequest) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const input = z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict().parse(body ?? {});
    if (!locked && !input.reason) throw new BadRequestException("A reason is required to reopen a final register.");
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(db);
      const session = await this.sessionRow(db, sessionId, true);
      await this.membership(db, user, ["admin"], session.school_id);
      if ((locked && session.state === "locked") || (!locked && session.state !== "locked")) return this.screenFromDb(db, user, sessionId);
      if (locked && session.state !== "submitted") throw new BadRequestException("Submit the subject register before finalizing it.");
      const revision = Number(session.revision) + 1;
      const now = new Date();
      if (locked) {
        await sql`UPDATE attendance_session_registers SET state='locked',revision=${revision},locked_by=${user.id}::uuid,
          locked_at=${now},auto_finalize_at=NULL,finalization_source='manual',updated_at=${now} WHERE id=${sessionId}::uuid`.execute(db);
      } else {
        await sql`UPDATE attendance_session_registers SET state='submitted',revision=${revision},locked_by=NULL,locked_at=NULL,
          reopened_by=${user.id}::uuid,reopened_at=${now},reopen_reason=${input.reason!},auto_finalize_at=NULL,
          finalization_policy_revision=NULL,finalization_source=NULL,updated_at=${now} WHERE id=${sessionId}::uuid`.execute(db);
      }
      await sql`INSERT INTO attendance_session_audits(school_id,session_id,actor_id,action,metadata)
        VALUES(${session.school_id}::uuid,${sessionId}::uuid,${user.id}::uuid,${locked ? 'register.locked' : 'register.reopened'},
          ${JSON.stringify({ revision, reason: input.reason ?? null, request_id: request.requestId })}::jsonb)`.execute(db);
      await this.events.enqueueRegisterEvent(db, {
        schoolId: session.school_id,
        classSectionId: session.class_section_id,
        termId: session.term_id,
        date: session.session_date,
        sessionId,
        requestId: request.requestId,
        state: locked ? "locked" : "unlocked",
        revision,
        actorId: user.id,
        action: locked ? "locked" : "reopened",
      });
      return this.screenFromDb(db, user, sessionId);
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

  private async refreshSubjectAggregate(db: Db, schoolId: string, termId: string, subjectId: string) {
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

  async issueQr(user: AuthUser, sessionIdValue: string) {
    const session = await this.sessionRow(this.db, z.string().uuid().parse(sessionIdValue));
    const member = await this.membership(this.db, user, ["staff", "admin"], session.school_id);
    if (!await this.canRecord(this.db, member, user.id, session)) throw new ForbiddenException("This subject session is not assigned to you.");
    const policy = await operatingRules(this.db, session.school_id);
    if (!policy.attendance_academic_channels.includes("student_qr") || policy.attendance_self_check_in_mode === "disabled") throw new ConflictException("Student QR check-in is not enabled.");
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 2 * 60_000);
    await sql`INSERT INTO attendance_qr_challenges(school_id,session_id,token_hash,issued_by,expires_at)
      VALUES(${session.school_id}::uuid,${session.id}::uuid,${hash},${user.id}::uuid,${expiresAt})`.execute(this.db);
    return { token, expires_at: expiresAt.toISOString(), session_id: session.id };
  }

  async selfCheckIn(user: AuthUser, tokenValue: unknown, request: AuthenticatedRequest) {
    const token = z.string().min(32).max(128).parse(tokenValue);
    const hash = createHash("sha256").update(token).digest("hex");
    return this.db.transaction().execute(async (db) => {
      const challenge = await sql<{
        challenge_id: string; expires_at: Date; revoked_at: Date | null;
        session_id: string; school_id: string; class_section_id: string; term_id: string; subject_id: string;
        session_date: string; starts_at: string; ends_at: string; revision: number;
        state: "draft" | "submitted" | "locked";
      }>`SELECT challenge.id AS challenge_id,challenge.expires_at,challenge.revoked_at,
          register.id AS session_id,register.school_id,register.class_section_id,register.term_id,register.subject_id,
          register.session_date::text,register.starts_at::text,register.ends_at::text,register.revision,register.state
        FROM attendance_qr_challenges challenge JOIN attendance_session_registers register ON register.id=challenge.session_id
        WHERE challenge.token_hash=${hash} FOR UPDATE OF challenge`.execute(db);
      const row = challenge.rows[0];
      if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) throw new BadRequestException("This QR check-in has expired.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${row.session_id}`},0))`.execute(db);
      const lockedSession = await this.sessionRow(db, row.session_id, true);
      if (lockedSession.state === "locked") throw new ForbiddenException("This attendance register is final.");
      row.state = lockedSession.state;
      row.revision = lockedSession.revision;
      const policy = await operatingRules(db, row.school_id);
      if (!policy.attendance_academic_channels.includes("student_qr") || policy.attendance_self_check_in_mode === "disabled") throw new ConflictException("Student QR check-in is not enabled.");
      const student = await sql<{ id: string }>`SELECT student.id FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id
        WHERE student.user_id=${user.id}::uuid AND student.school_id=${row.school_id}::uuid
          AND enrollment.class_section_id=${row.class_section_id}::uuid AND enrollment.term_id=${row.term_id}::uuid
          AND enrollment.is_active AND enrollment.enrolled_on<=${row.session_date}::date`.execute(db);
      if (!student.rows[0]) throw new ForbiddenException("This check-in is not for your current class.");
      const inWindow = await sql<{ valid: boolean }>`SELECT now() BETWEEN
        ((${row.session_date}::date+${row.starts_at}::time) AT TIME ZONE school.timezone) - make_interval(mins=>${policy.attendance_session_open_before_minutes})
        AND ((${row.session_date}::date+${row.ends_at}::time) AT TIME ZONE school.timezone) + make_interval(mins=>${policy.attendance_session_close_after_minutes}) AS valid
        FROM schools school WHERE school.id=${row.school_id}::uuid`.execute(db);
      if (!inWindow.rows[0]?.valid) throw new BadRequestException("Check-in is outside this session’s attendance window.");
      const existing = await sql<{ id: string }>`SELECT id FROM attendance_session_entries WHERE session_id=${row.session_id}::uuid AND student_id=${student.rows[0].id}::uuid FOR UPDATE`.execute(db);
      const automatic = policy.attendance_self_check_in_mode === "automatic" && !existing.rows[0];
      const observedAt = new Date();
      const evidenceRuleSnapshot = {
        operating_rule_revision: policy.revision,
        self_check_in_mode: policy.attendance_self_check_in_mode,
        session_open_before_minutes: policy.attendance_session_open_before_minutes,
        session_close_after_minutes: policy.attendance_session_close_after_minutes,
      };
      const evidence = await sql<{ id: string; state: "accepted" | "pending"; observed_at: Date }>`INSERT INTO attendance_session_evidence(school_id,session_id,student_id,capture_channel,state,observed_at,submitted_by,provider_reference,metadata,decided_by,decided_at,decision_note)
        VALUES(${row.school_id}::uuid,${row.session_id}::uuid,${student.rows[0].id}::uuid,'student_qr',${automatic ? 'accepted' : 'pending'},${observedAt},${user.id}::uuid,${row.challenge_id}::text,${JSON.stringify(evidenceRuleSnapshot)}::jsonb,NULL,${automatic ? observedAt : null},${automatic ? 'Accepted by the configured automatic QR rule.' : ''})
        ON CONFLICT(session_id,student_id,capture_channel) WHERE state<>'rejected' DO UPDATE SET
          state=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.state ELSE excluded.state END,
          observed_at=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.observed_at ELSE excluded.observed_at END,
          submitted_by=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.submitted_by ELSE excluded.submitted_by END,
          provider_reference=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.provider_reference ELSE excluded.provider_reference END,
          metadata=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.metadata ELSE excluded.metadata END,
          decided_by=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.decided_by ELSE excluded.decided_by END,
          decided_at=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.decided_at ELSE excluded.decided_at END,
          decision_note=CASE WHEN attendance_session_evidence.state='accepted' THEN attendance_session_evidence.decision_note ELSE excluded.decision_note END,
          updated_at=now() RETURNING id,state,observed_at`.execute(db);
      const alreadyAccepted = !automatic && evidence.rows[0]!.state === "accepted";
      let resultingRevision = Number(row.revision);
      let entryRevisionId: string | null = null;
      if (automatic) {
        const nextRevision = Number(row.revision) + 1;
        const saved = await sql<{ id: string }>`INSERT INTO attendance_session_entries(school_id,session_id,student_id,status,remarks,capture_channel,observed_at,recorded_by,revision)
          VALUES(${row.school_id}::uuid,${row.session_id}::uuid,${student.rows[0].id}::uuid,'present','','student_qr',${observedAt},${user.id}::uuid,${nextRevision}) RETURNING id`.execute(db);
        const revision = await sql<{ id: string }>`INSERT INTO attendance_session_entry_revisions(school_id,session_id,entry_id,submission_id,student_id,previous_status,new_status,previous_remarks,new_remarks,capture_channel,reason,changed_by,request_id,register_revision)
          VALUES(${row.school_id}::uuid,${row.session_id}::uuid,${saved.rows[0]!.id}::uuid,NULL,${student.rows[0].id}::uuid,NULL,'present',NULL,'','student_qr','Accepted by the configured automatic QR rule.',${user.id}::uuid,${request.requestId}::uuid,${nextRevision}) RETURNING id`.execute(db);
        entryRevisionId = revision.rows[0]!.id;
        resultingRevision = nextRevision;
        await sql`UPDATE attendance_session_registers SET revision=${nextRevision},updated_at=now() WHERE id=${row.session_id}::uuid`.execute(db);
        await this.refreshSubjectAggregate(db,row.school_id,row.term_id,row.subject_id);
      }
      await sql`INSERT INTO attendance_session_audits(school_id,session_id,actor_id,action,metadata)
        VALUES(${row.school_id}::uuid,${row.session_id}::uuid,${user.id}::uuid,${automatic ? 'qr.accepted' : alreadyAccepted ? 'qr.already_recorded' : 'qr.review_requested'},${JSON.stringify({ evidence_id: evidence.rows[0]!.id, request_id: request.requestId, ...evidenceRuleSnapshot })}::jsonb)`.execute(db);
      const attendanceEvent = automatic
        ? await this.events.enqueueAttendanceUpdates(db, {
          schoolId: row.school_id,
          classSectionId: row.class_section_id,
          termId: row.term_id,
          date: row.session_date,
          sessionId: row.session_id,
          requestId: request.requestId,
          suppressNotifications: true,
          records: [{
            student_id: student.rows[0].id,
            status: "present",
            previous_status: null,
            revision: resultingRevision,
          }],
        })
        : null;
      const registerEventId = await this.events.enqueueRegisterEvent(db, {
        schoolId: row.school_id,
        classSectionId: row.class_section_id,
        termId: row.term_id,
        date: row.session_date,
        sessionId: row.session_id,
        requestId: request.requestId,
        state: row.state,
        revision: resultingRevision,
        actorId: user.id,
        action: automatic ? "qr.accepted" : alreadyAccepted ? "qr.already_recorded" : "qr.review_requested",
      });
      if (alreadyAccepted) {
        return { status: "recorded", evidence_id: evidence.rows[0]!.id, session_id: row.session_id };
      }
      const domainEventId = automatic
        ? attendanceEvent?.studentEventIds.get(student.rows[0].id)
        : registerEventId;
      const sourceRecordId = entryRevisionId ?? `${evidence.rows[0]!.id}:${request.requestId}`;
      if (!domainEventId) throw new ConflictException("The QR attendance evidence chain could not be retained.");
      await recordAttendanceModelObservations({
        ingress: this.observationIngress,
        transaction: db,
        schoolId: row.school_id,
        classSectionId: row.class_section_id,
        date: row.session_date,
        sessionId: row.session_id,
        actorUserId: user.id,
        sourceType: "attendance.self_check_in",
        sourceRef: evidence.rows[0]!.id,
        state: automatic ? "accepted" : "pending",
        receivedAt: observedAt,
        participationScope: "scheduled_session",
        records: [{
          studentId: student.rows[0].id,
          sourceRecordId,
          status: "present",
          observedAt: new Date(evidence.rows[0]!.observed_at),
          captureSource: "student_qr",
          evidenceRefs: [
            `attendance_session_evidence:${evidence.rows[0]!.id}`,
            `attendance_qr_challenge:${row.challenge_id}`,
            ...(entryRevisionId ? [`attendance_session_entry_revision:${entryRevisionId}`] : []),
          ],
          domainEventId,
          decisionProvenance: automatic ? "human_self_check_in_accepted_by_operating_rule" : "human_self_check_in_awaiting_review",
        }],
      });
      if (automatic) {
        await this.recordModelCommand(db, {
          session: lockedSession,
          actorUserId: user.id,
          commandType: "attendance.self_check_in.accept_automatically",
          idempotencyKey: `attendance-qr-auto:${evidence.rows[0]!.id}`,
          correlationId: request.requestId,
          expectedRevision: row.revision,
          resultingRevision,
          operatingRuleRevision: policy.revision,
          domainEventId,
          outcomeCode: "accepted_present",
          explanation: "The student QR observation was accepted by the configured institution operating rule.",
          metadata: {
            evidence_id: evidence.rows[0]!.id,
            student_id: student.rows[0].id,
            capture_channel: "student_qr",
          },
        });
      }
      return { status: automatic ? "recorded" : "pending_review", evidence_id: evidence.rows[0]!.id, session_id: row.session_id };
    });
  }

  async decideEvidence(
    user: AuthUser,
    sessionIdValue: string,
    evidenceIdValue: string,
    body: unknown,
    request: AuthenticatedRequest,
  ) {
    const sessionId = z.string().uuid().parse(sessionIdValue);
    const evidenceId = z.string().uuid().parse(evidenceIdValue);
    const input = evidenceDecisionSchema.parse(body);
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header is required.");
    }
    const requestHash = createHash("sha256").update(JSON.stringify({ sessionId, evidenceId, ...input })).digest("hex");
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(db);
      const session = await this.sessionRow(db, sessionId, true);
      const member = await this.membership(db, user, ["staff", "admin"], session.school_id);
      if (!await this.canRecord(db, member, user.id, session)) throw new ForbiddenException("This subject session is not assigned to you.");
      if (session.state === "locked") throw new ForbiddenException("This attendance register is final.");
      const policy = await operatingRules(db, session.school_id);
      const evidenceResult = await sql<{
        id: string; student_id: string; capture_channel: string; state: "pending" | "accepted" | "rejected";
        observed_at: Date; metadata: Record<string, unknown> | null;
      }>`SELECT id,student_id,capture_channel,state,observed_at,metadata
        FROM attendance_session_evidence
        WHERE id=${evidenceId}::uuid AND session_id=${sessionId}::uuid AND school_id=${session.school_id}::uuid
        FOR UPDATE`.execute(db);
      const evidence = evidenceResult.rows[0];
      if (!evidence) throw new NotFoundException("Attendance evidence not found.");
      const priorMetadata = evidence.metadata ?? {};
      if (evidence.state !== "pending") {
        if (priorMetadata.decision_idempotency_key === idempotencyKey && priorMetadata.decision_request_hash === requestHash) {
          return this.screenFromDb(db, user, sessionId);
        }
        throw new ConflictException("This attendance evidence has already been decided.");
      }
      if (session.revision !== input.expected_revision) {
        throw new ConflictException("This register changed after the evidence was opened. Refresh before deciding.");
      }
      const now = new Date();
      let resultingRevision = session.revision;
      let entryRevisionId: string | null = null;
      let attendanceEventId: string | null = null;
      if (input.decision === "accepted") {
        const existing = await sql<{ id: string; status: "present" | "absent" | "late" | "excused"; remarks: string }>`SELECT id,status,remarks
          FROM attendance_session_entries
          WHERE session_id=${session.id}::uuid AND student_id=${evidence.student_id}::uuid
          FOR UPDATE`.execute(db);
        resultingRevision = session.revision + 1;
        const entry = await sql<{ id: string }>`INSERT INTO attendance_session_entries(
            school_id,session_id,student_id,status,remarks,capture_channel,observed_at,recorded_by,revision,updated_at)
          VALUES(${session.school_id}::uuid,${session.id}::uuid,${evidence.student_id}::uuid,'present','',${evidence.capture_channel},${evidence.observed_at},${user.id}::uuid,${resultingRevision},${now})
          ON CONFLICT(session_id,student_id) DO UPDATE SET status='present',remarks='',capture_channel=excluded.capture_channel,
            observed_at=excluded.observed_at,recorded_by=excluded.recorded_by,revision=excluded.revision,updated_at=excluded.updated_at
          RETURNING id`.execute(db);
        const revision = await sql<{ id: string }>`INSERT INTO attendance_session_entry_revisions(
            school_id,session_id,entry_id,submission_id,student_id,previous_status,new_status,previous_remarks,new_remarks,
            capture_channel,reason,changed_by,request_id,register_revision)
          VALUES(${session.school_id}::uuid,${session.id}::uuid,${entry.rows[0]!.id}::uuid,NULL,${evidence.student_id}::uuid,
            ${existing.rows[0]?.status ?? null},'present',${existing.rows[0]?.remarks ?? null},'',${evidence.capture_channel},${input.note},
            ${user.id}::uuid,${request.requestId}::uuid,${resultingRevision}) RETURNING id`.execute(db);
        entryRevisionId = revision.rows[0]!.id;
        await sql`UPDATE attendance_session_registers SET revision=${resultingRevision},updated_at=${now} WHERE id=${session.id}::uuid`.execute(db);
        await this.refreshSubjectAggregate(db, session.school_id, session.term_id, session.subject_id);
        const attendanceEvents = await this.events.enqueueAttendanceUpdates(db, {
          schoolId: session.school_id,
          classSectionId: session.class_section_id,
          termId: session.term_id,
          date: session.session_date,
          sessionId: session.id,
          requestId: request.requestId,
          suppressNotifications: true,
          records: [{
            id: entry.rows[0]!.id,
            student_id: evidence.student_id,
            status: "present",
            previous_status: existing.rows[0]?.status ?? null,
            revision: resultingRevision,
          }],
        });
        attendanceEventId = attendanceEvents.studentEventIds.get(evidence.student_id) ?? null;
        if (!attendanceEventId) throw new ConflictException("The reviewed attendance evidence chain could not be retained.");
        if (this.observationIngress) {
          await this.observationIngress.transitionObservations(db, {
            school_id: session.school_id,
            source_type: "attendance.self_check_in",
            source_ref: evidence.id,
            state: "superseded",
          });
        }
        await recordAttendanceModelObservations({
          ingress: this.observationIngress,
          transaction: db,
          schoolId: session.school_id,
          classSectionId: session.class_section_id,
          date: session.session_date,
          sessionId: session.id,
          actorUserId: user.id,
          sourceType: "attendance.self_check_in",
          sourceRef: evidence.id,
          state: "accepted",
          receivedAt: now,
          participationScope: "scheduled_session",
          records: [{
            studentId: evidence.student_id,
            sourceRecordId: entryRevisionId,
            status: "present",
            observedAt: new Date(evidence.observed_at),
            captureSource: evidence.capture_channel,
            evidenceRefs: [
              `attendance_session_evidence:${evidence.id}`,
              `attendance_session_entry_revision:${entryRevisionId}`,
            ],
            domainEventId: attendanceEventId,
            decisionProvenance: "authorized_staff_accepted_pending_evidence",
          }],
        });
      } else if (this.observationIngress) {
        await this.observationIngress.transitionObservations(db, {
          school_id: session.school_id,
          source_type: "attendance.self_check_in",
          source_ref: evidence.id,
          state: "rejected",
        });
      }
      const decisionMetadata = {
        ...priorMetadata,
        decision_idempotency_key: idempotencyKey,
        decision_request_hash: requestHash,
        decision_operating_rule_revision: policy.revision,
        resulting_register_revision: resultingRevision,
      };
      await sql`UPDATE attendance_session_evidence SET state=${input.decision},decided_by=${user.id}::uuid,decided_at=${now},
        decision_note=${input.note},metadata=${JSON.stringify(decisionMetadata)}::jsonb,updated_at=${now}
        WHERE id=${evidence.id}::uuid`.execute(db);
      await sql`INSERT INTO attendance_session_audits(school_id,session_id,actor_id,action,metadata)
        VALUES(${session.school_id}::uuid,${session.id}::uuid,${user.id}::uuid,${input.decision === "accepted" ? "qr.review_accepted" : "qr.review_rejected"},
          ${JSON.stringify({ evidence_id: evidence.id, note: input.note, request_id: request.requestId, operating_rule_revision: policy.revision, resulting_revision: resultingRevision })}::jsonb)`.execute(db);
      const registerEventId = await this.events.enqueueRegisterEvent(db, {
        schoolId: session.school_id,
        classSectionId: session.class_section_id,
        termId: session.term_id,
        date: session.session_date,
        sessionId: session.id,
        requestId: request.requestId,
        state: session.state,
        revision: resultingRevision,
        actorId: user.id,
        action: input.decision === "accepted" ? "qr.review_accepted" : "qr.review_rejected",
      });
      await this.recordModelCommand(db, {
        session,
        actorUserId: user.id,
        commandType: `attendance.evidence.${input.decision}`,
        idempotencyKey: `attendance-evidence-decision:${evidence.id}:${idempotencyKey}`,
        correlationId: request.requestId,
        expectedRevision: session.revision,
        resultingRevision,
        operatingRuleRevision: policy.revision,
        domainEventId: registerEventId,
        outcomeCode: input.decision,
        explanation: input.decision === "accepted"
          ? "Authorized staff accepted the pending attendance evidence and recorded the student present."
          : "Authorized staff rejected the pending attendance evidence without changing the register.",
        metadata: {
          evidence_id: evidence.id,
          student_id: evidence.student_id,
          capture_channel: evidence.capture_channel,
          attendance_event_id: attendanceEventId,
        },
      });
      return this.screenFromDb(db, user, sessionId);
    });
  }
}
