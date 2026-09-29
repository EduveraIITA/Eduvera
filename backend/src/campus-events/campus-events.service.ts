import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";
import {
  attendanceCommandSchema,
  cancelEventSchema,
  checklistCompletionSchema,
  consentSchema,
  createEventSchema,
  eventActionSchema,
  eventStatus,
  grantConsentAuthoritySchema,
  lockSessionSchema,
  reopenSessionSchema,
  revokeConsentAuthoritySchema,
  rsvpSchema,
  saveEventSchema,
  uuid,
  type CampusEventDto,
  type CampusEventListDto,
} from "./contracts.js";

type Db = Kysely<Database> | Transaction<Database>;
type MemberRole = "student" | "guardian" | "staff" | "admin";
type AttendanceValue = "not_recorded" | "present" | "late" | "excused" | "no_show" | "checked_out";

interface EventRow {
  id: string; school_id: string; event_type: CampusEventDto["event_type"]; subject_id: string | null;
  status: CampusEventDto["status"]; title: string; description: string; venue: string;
  starts_at: Date; ends_at: Date; audience_mode: CampusEventDto["audience"]["mode"];
  participation_requirement: CampusEventDto["participation_requirement"];
  requires_rsvp: boolean; requires_guardian_consent: boolean; payment_required: boolean;
  payment_amount_paise: number | null; payment_due_on: string | null; payment_currency: "INR";
  academic_attendance_impact: "none"; revision: number; created_by: string;
  published_at: Date | null; cancelled_at: Date | null; cancellation_reason: string | null;
  cancellation_internal_reason: string | null;
}
interface ActorAccess {
  role: MemberRole;
  assigned: boolean;
  organizerAssigned: boolean;
  attendanceAssigned: boolean;
  ownsClassTest: boolean;
  financeGranted: boolean;
}

const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class CampusEventsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SchoolEventService,
  ) {}

  private async membership(db: Db, user: AuthUser, schoolId: string, lock = false) {
    if (user.active_school_id && user.active_school_id !== schoolId) {
      throw new NotFoundException("Campus event not found in the active school.");
    }
    const row = (await sql<{ role: MemberRole }>`
      SELECT membership.role
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid
        AND membership.is_active
      ${lock ? sql`FOR SHARE OF membership,account` : sql``}
    `.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Campus event not found in the active school.");
    return row.role;
  }

  private async requireAdmin(db: Db, user: AuthUser, schoolId: string, lock = false) {
    const role = await this.membership(db, user, schoolId, lock);
    if (role !== "admin") throw new ForbiddenException("Only a current school administrator can perform this action.");
    return role;
  }

  private async eventRow(db: Db, schoolId: string, eventId: string, lock = false): Promise<EventRow> {
    const row = (await sql<EventRow>`
      SELECT id,school_id,event_type,subject_id,status,title,description,venue,starts_at,ends_at,
        audience_mode,participation_requirement,requires_rsvp,requires_guardian_consent,
        payment_required,payment_amount_paise,payment_due_on::text,payment_currency,
        academic_attendance_impact,revision,created_by,published_at,
        cancelled_at,cancellation_reason,cancellation_internal_reason
      FROM campus_events
      WHERE school_id=${schoolId}::uuid AND id=${eventId}::uuid
      ${lock ? sql`FOR UPDATE` : sql``}
    `.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Campus event not found.");
    return row;
  }

  private async isAssignedClassTestTeacher(
    db: Db,
    userId: string,
    schoolId: string,
    classSectionId: string,
    subjectId: string,
    at: Date | string,
    lock = false,
  ) {
    const row = (await sql<{ allowed: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM class_section_staff_assignments assignment
        JOIN school_memberships membership ON membership.school_id=assignment.school_id
          AND membership.user_id=assignment.user_id AND membership.role='staff' AND membership.is_active
        JOIN users account ON account.id=membership.user_id AND account.is_active
        JOIN schools school ON school.id=assignment.school_id
        WHERE assignment.school_id=${schoolId}::uuid
          AND assignment.class_section_id=${classSectionId}::uuid
          AND ((assignment.role='subject_teacher' AND assignment.subject_id=${subjectId}::uuid)
            OR (assignment.role='class_teacher' AND EXISTS(
              SELECT 1 FROM timetable_slots slot
              WHERE slot.class_section_id=assignment.class_section_id AND slot.subject_id=${subjectId}::uuid
            )))
          AND assignment.user_id=${userId}::uuid
          AND (${at}::timestamptz AT TIME ZONE school.timezone)::date
            BETWEEN assignment.valid_from AND COALESCE(assignment.valid_until,'infinity'::date)
        ${lock ? sql`FOR SHARE OF assignment,membership,account` : sql``}
      ) AS allowed
    `.execute(db)).rows[0];
    return Boolean(row?.allowed);
  }

  private async access(db: Db, user: AuthUser, event: EventRow, lock = false): Promise<ActorAccess> {
    const role = await this.membership(db, user, event.school_id, lock);
    const assignment = role === "staff" ? (await sql<{
      assigned: boolean; organizer_assigned: boolean; attendance_assigned: boolean; finance_granted: boolean;
    }>`
      SELECT EXISTS(SELECT 1 FROM campus_event_staff staff
        WHERE staff.school_id=${event.school_id}::uuid AND staff.event_id=${event.id}::uuid
          AND staff.user_id=${user.id}::uuid) AS assigned,
        EXISTS(SELECT 1 FROM campus_event_staff staff
          WHERE staff.school_id=${event.school_id}::uuid AND staff.event_id=${event.id}::uuid
            AND staff.user_id=${user.id}::uuid AND staff.role='organizer') AS organizer_assigned,
        EXISTS(SELECT 1 FROM campus_event_staff staff
          WHERE staff.school_id=${event.school_id}::uuid AND staff.event_id=${event.id}::uuid
            AND staff.user_id=${user.id}::uuid AND staff.role='attendance_taker') AS attendance_assigned,
        EXISTS(SELECT 1 FROM school_permission_grants permission
          WHERE permission.school_id=${event.school_id}::uuid AND permission.user_id=${user.id}::uuid
            AND permission.permission='fees.manage') AS finance_granted
    `.execute(db)).rows[0] : {
      assigned: false, organizer_assigned: false, attendance_assigned: false, finance_granted: false,
    };
    const assigned = Boolean(assignment?.assigned);
    const classTarget = event.event_type === "class_test" ? (await sql<{ class_section_id: string }>`
      SELECT class_section_id FROM campus_event_class_sections
      WHERE school_id=${event.school_id}::uuid AND event_id=${event.id}::uuid
      ORDER BY class_section_id LIMIT 1
    `.execute(db)).rows[0]?.class_section_id : undefined;
    const ownsClassTest = role === "staff" && event.created_by === user.id && Boolean(
      classTarget && event.subject_id && await this.isAssignedClassTestTeacher(
        db, user.id, event.school_id, classTarget, event.subject_id, event.starts_at, lock,
      ),
    );
    if (role === "admin" || assigned || ownsClassTest) return {
      role,
      assigned,
      organizerAssigned: Boolean(assignment?.organizer_assigned),
      attendanceAssigned: Boolean(assignment?.attendance_assigned),
      ownsClassTest,
      financeGranted: role === "admin" || Boolean(assignment?.finance_granted),
    };
    if (event.status !== "draft") {
      const family = (await sql<{ ok: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM campus_event_participants participant
          JOIN students student ON student.id=participant.student_id
          WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
            AND ((student.user_id=${user.id}::uuid AND ${role}='student') OR (${role}='guardian' AND EXISTS (
              SELECT 1 FROM parents parent JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
              WHERE parent.user_id=${user.id}::uuid AND relationship.school_id=participant.school_id
                AND relationship.student_id=participant.student_id
            )))
        ) AS ok
      `.execute(db)).rows[0]?.ok;
      if (family) return {
        role, assigned: false, organizerAssigned: false, attendanceAssigned: false,
        ownsClassTest: false, financeGranted: false,
      };
    }
    throw new NotFoundException("Campus event not found or no longer accessible.");
  }

  private async priorCommand<T>(db: Db, schoolId: string, actorId: string, key: string, operation: string, requestHash: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`campus-event:${schoolId}:${actorId}:${key}`},0))`.execute(db);
    const previous = (await sql<{ operation: string; request_hash: string; result: T }>`
      SELECT operation,request_hash,result FROM campus_event_commands
      WHERE school_id=${schoolId}::uuid AND actor_id=${actorId}::uuid AND command_key=${key}::uuid
    `.execute(db)).rows[0];
    if (!previous) return null;
    if (previous.operation !== operation || previous.request_hash !== requestHash) {
      throw new ConflictException("This request key was already used for a different campus-event action.");
    }
    return previous.result;
  }

  private async saveCommand(db: Db, schoolId: string, actorId: string, key: string, operation: string, requestHash: string, result: unknown) {
    await sql`INSERT INTO campus_event_commands(school_id,actor_id,command_key,operation,request_hash,result)
      VALUES(${schoolId}::uuid,${actorId}::uuid,${key}::uuid,${operation},${requestHash},${JSON.stringify(result)}::jsonb)`.execute(db);
  }

  private async audit(
    db: Db,
    req: AuthenticatedRequest,
    action: string,
    schoolId: string,
    targetId: string,
    metadata: Record<string, unknown>,
    targetType = "campus_event",
  ) {
    await db.insertInto("audit_events").values({
      action, actor_id: req.authUser.id, school_id: schoolId,
      target_type: targetType, target_id: targetId, request_id: req.requestId,
      ip_hash: null, metadata,
    }).execute();
  }

  private async audience(db: Db, eventId: string, schoolId: string) {
    return (await sql<{ user_id: string }>`
      SELECT DISTINCT candidate.user_id FROM (
        SELECT membership.user_id FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
        UNION ALL
        SELECT staff.user_id FROM campus_event_staff staff
        JOIN school_memberships membership ON membership.school_id=staff.school_id
          AND membership.user_id=staff.user_id AND membership.role IN ('staff','admin') AND membership.is_active
        JOIN users account ON account.id=staff.user_id AND account.is_active
        WHERE staff.school_id=${schoolId}::uuid AND staff.event_id=${eventId}::uuid
        UNION ALL
        SELECT student.user_id FROM campus_event_participants participant
        JOIN students student ON student.id=participant.student_id AND student.user_id IS NOT NULL
        JOIN school_memberships membership ON membership.school_id=participant.school_id
          AND membership.user_id=student.user_id AND membership.role='student' AND membership.is_active
        JOIN users account ON account.id=student.user_id AND account.is_active
        WHERE participant.school_id=${schoolId}::uuid AND participant.event_id=${eventId}::uuid
        UNION ALL
        SELECT parent.user_id FROM campus_event_participants participant
        JOIN guardian_relationships relationship ON relationship.school_id=participant.school_id
          AND relationship.student_id=participant.student_id
        JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
        JOIN school_memberships membership ON membership.school_id=participant.school_id
          AND membership.user_id=parent.user_id AND membership.role='guardian' AND membership.is_active
        JOIN users account ON account.id=parent.user_id AND account.is_active
        WHERE participant.school_id=${schoolId}::uuid AND participant.event_id=${eventId}::uuid
      ) candidate WHERE candidate.user_id IS NOT NULL
    `.execute(db)).rows.map((row) => row.user_id);
  }

  private async enqueue(
    db: Db,
    event: EventRow,
    changeKind: string,
    key: string,
    notification?: { title: string; body: string; users: string[] },
    extra: Record<string, unknown> = {},
  ) {
    const audience = await this.audience(db, event.id, event.school_id);
    await this.events.enqueueUserEvent(db, {
      schoolId: event.school_id,
      eventType: "campus_event.updated",
      aggregateType: "campus_event",
      aggregateId: event.id,
      audienceUserIds: audience,
      idempotencyKey: key,
      payload: {
        event_id: event.id, revision: event.revision, change_kind: changeKind,
        ...extra,
        refresh: ["campus-events", "student.home", "parent.home", "teacher.home", "principal.home", "notifications"],
      },
      notificationUserIds: notification?.users ?? [],
      notificationPayload: notification ? {
        kind: "general", title: notification.title, body: notification.body,
        link: `/events/${event.id}`, student_link: `/student/events/${event.id}`,
        parent_link: `/parent/events/${event.id}`, staff_link: `/teacher/events/${event.id}`,
        admin_link: `/principal/events/${event.id}`, event_id: event.id,
      } : null,
    });
  }

  private async invalidateFutureConsentReadiness(
    db: Db,
    schoolId: string,
    studentId: string,
    authorityId: string,
    authorityRevision: number,
  ) {
    const ids = (await sql<{ id: string }>`
      SELECT event.id FROM campus_events event
      JOIN campus_event_participants participant ON participant.event_id=event.id AND participant.school_id=event.school_id
      WHERE event.school_id=${schoolId}::uuid AND participant.student_id=${studentId}::uuid
        AND event.status='published' AND event.starts_at>now() AND event.requires_guardian_consent
      ORDER BY event.starts_at,event.id
    `.execute(db)).rows;
    for (const row of ids) {
      const event = await this.eventRow(db, schoolId, row.id);
      await this.enqueue(
        db,
        event,
        "consent_authority",
        `campus-event:${event.id}:consent-authority:${authorityId}:${authorityRevision}`,
      );
    }
  }

  private async validateRelations(
    db: Db,
    input: z.infer<typeof createEventSchema>,
    actor: AuthUser,
    excludeEventId?: string,
  ) {
    await this.validatePaymentTerms(db, input);
    const classIds = input.audience.class_section_ids;
    const studentIds = input.audience.student_ids;
    const sessionStudentIds = [...new Set(input.sessions.flatMap((session) => session.participant_student_ids))];
    const staffIds = [...new Set(input.staff.map((row) => row.user_id))];
    const counts = (await sql<{ classes: string; students: string; session_students: string; staff: string; subject: string }>`
      SELECT
        (SELECT count(*)::text FROM class_sections WHERE school_id=${input.school_id}::uuid AND id=ANY(${classIds}::uuid[])) AS classes,
        (SELECT count(*)::text FROM students WHERE school_id=${input.school_id}::uuid AND id=ANY(${studentIds}::uuid[])) AS students,
        (SELECT count(*)::text FROM students WHERE school_id=${input.school_id}::uuid AND id=ANY(${sessionStudentIds}::uuid[])) AS session_students,
        (SELECT count(DISTINCT membership.user_id)::text FROM school_memberships membership
          JOIN users account ON account.id=membership.user_id AND account.is_active
          WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=ANY(${staffIds}::uuid[])
            AND membership.role IN ('staff','admin') AND membership.is_active) AS staff,
        (SELECT count(*)::text FROM subjects WHERE school_id=${input.school_id}::uuid AND id=${input.subject_id}::uuid) AS subject
    `.execute(db)).rows[0]!;
    if (Number(counts.classes) !== classIds.length || Number(counts.students) !== studentIds.length ||
      Number(counts.session_students) !== sessionStudentIds.length || Number(counts.staff) !== staffIds.length) {
      throw new BadRequestException("One or more event audience or staff selections are not active in this school.");
    }
    if (input.subject_id && Number(counts.subject) !== 1) throw new BadRequestException("Choose a subject from this school.");
    if (input.event_type !== "class_test" && input.subject_id) throw new BadRequestException("Only a class test may be linked to a subject.");
    if (input.event_type === "class_test") await this.validateClassTest(db, input, actor, excludeEventId);
  }

  private async validatePaymentTerms(db: Db, input: z.infer<typeof createEventSchema>) {
    if (input.payment_currency !== "INR") throw new BadRequestException("Campus event fees are supported in INR only.");
    if (input.payment_required) {
      if (!Number.isSafeInteger(input.payment_amount_paise) || !input.payment_amount_paise || input.payment_amount_paise <= 0 || input.payment_amount_paise > 100_000_000) {
        throw new BadRequestException("Enter a valid event fee between INR 0.01 and INR 10,00,000.");
      }
      if (!input.payment_due_on) throw new BadRequestException("A paid event requires a due date.");
      const dates = (await sql<{ school_date: string; event_date: string }>`
        SELECT (now() AT TIME ZONE school.timezone)::date::text AS school_date,
          (${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date::text AS event_date
        FROM schools school WHERE school.id=${input.school_id}::uuid
      `.execute(db)).rows[0];
      if (!dates) throw new NotFoundException("School not found.");
      if (input.payment_due_on < dates.school_date) throw new BadRequestException("The event fee due date cannot be before the current school date.");
      if (input.payment_due_on > dates.event_date) throw new BadRequestException("The event fee must be due no later than the event school date.");
    } else if (input.payment_amount_paise !== null || input.payment_due_on !== null) {
      throw new BadRequestException("A free event must not include fee terms.");
    }
  }

  private async validateClassTest(db: Db, input: z.infer<typeof createEventSchema>, actor: AuthUser, excludeEventId?: string) {
    if (!input.subject_id || input.audience.mode !== "class_sections" || input.audience.class_section_ids.length !== 1 ||
      input.participation_requirement !== "mandatory" || input.requires_rsvp || input.requires_guardian_consent || input.payment_required || !input.sessions.length) {
      throw new BadRequestException("A class test needs one class, one subject, mandatory participation, at least one session, and no RSVP, consent, or payment workflow.");
    }
    const classId = input.audience.class_section_ids[0]!;
    // Drafts for the same class can be prepared independently. Serialize the
    // final validation boundary so two overlapping drafts cannot both pass a
    // publish-time conflict check before either transaction commits.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`campus-class-test:${input.school_id}:${classId}`},0
    ))`.execute(db);
    const context = (await sql<{
      school_date: string;
      event_date: string;
      same_day: boolean;
      instructional: boolean;
      term_ok: boolean;
      fits_subject_period: boolean;
    }>`
      SELECT (now() AT TIME ZONE school.timezone)::date::text AS school_date,
        (${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date::text AS event_date,
        ((${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date =
          (${input.ends_at}::timestamptz AT TIME ZONE school.timezone)::date) AS same_day,
        COALESCE((SELECT day.is_instructional FROM school_calendar_days day
          WHERE day.school_id=school.id AND day.date=(${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date),
          EXISTS(SELECT 1 FROM effective_school_schedule(
            school.id,(${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
          ) schedule WHERE schedule.class_section_id=${classId}::uuid AND NOT schedule.cancelled)) AS instructional,
        EXISTS(SELECT 1 FROM class_sections section JOIN academic_terms term
          ON term.school_id=section.school_id AND term.academic_year=section.academic_year
          WHERE section.school_id=school.id AND section.id=${classId}::uuid
            AND (${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on) AS term_ok,
        EXISTS(SELECT 1 FROM effective_school_schedule(
            school.id,(${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
          ) schedule
          WHERE schedule.class_section_id=${classId}::uuid AND schedule.subject_id=${input.subject_id}::uuid
            AND schedule.slot_type='class' AND NOT schedule.cancelled
            AND (${input.starts_at}::timestamptz AT TIME ZONE school.timezone)::time>=schedule.starts_at
            AND (${input.ends_at}::timestamptz AT TIME ZONE school.timezone)::time<=schedule.ends_at
        ) AS fits_subject_period
      FROM schools school WHERE school.id=${input.school_id}::uuid
    `.execute(db)).rows[0]!;
    if (!context.same_day) throw new BadRequestException("A class test must start and finish on one school day.");
    if (context.event_date <= context.school_date) throw new BadRequestException("A class test must be scheduled for a future school day.");
    if (!context.instructional || !context.term_ok) throw new BadRequestException("Choose an instructional date within the class academic term.");
    if (!context.fits_subject_period) throw new BadRequestException("The class test must fit within an effective period for the selected subject.");
    const role = await this.membership(db, actor, input.school_id, true);
    if (role !== "admin" && !(role === "staff" && await this.isAssignedClassTestTeacher(
      db, actor.id, input.school_id, classId, input.subject_id, input.starts_at, true,
    ))) throw new ForbiddenException("Only an assigned class teacher, assigned subject teacher, or school administrator can schedule this class test.");
    const clash = (await sql<{ id: string }>`
      SELECT event.id FROM campus_events event
      WHERE event.school_id=${input.school_id}::uuid AND event.status='published'
        AND (event.audience_mode='school' OR EXISTS(
          SELECT 1 FROM campus_event_class_sections audience
          WHERE audience.school_id=event.school_id AND audience.event_id=event.id
            AND audience.class_section_id=${classId}::uuid
        ))
        AND event.starts_at<${input.ends_at}::timestamptz AND event.ends_at>${input.starts_at}::timestamptz
        AND (${excludeEventId ?? null}::uuid IS NULL OR event.id<>${excludeEventId ?? null}::uuid)
      LIMIT 1
    `.execute(db)).rows[0];
    if (clash) throw new ConflictException("This class already has another published campus event in that time window.");
  }

  private async assignedSubjectTeacher(
    db: Db,
    schoolId: string,
    classSectionId: string,
    subjectId: string,
    at: Date | string,
  ) {
    return (await sql<{ user_id: string }>`
      SELECT assignment.user_id
      FROM class_section_staff_assignments assignment
      JOIN school_memberships membership ON membership.school_id=assignment.school_id
        AND membership.user_id=assignment.user_id AND membership.role='staff' AND membership.is_active
      JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN schools school ON school.id=assignment.school_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.class_section_id=${classSectionId}::uuid
        AND assignment.role='subject_teacher' AND assignment.subject_id=${subjectId}::uuid
        AND (${at}::timestamptz AT TIME ZONE school.timezone)::date
          BETWEEN assignment.valid_from AND COALESCE(assignment.valid_until,'infinity'::date)
      ORDER BY assignment.valid_from DESC,assignment.user_id LIMIT 1
    `.execute(db)).rows[0]?.user_id;
  }

  async catalog(user: AuthUser, schoolValue: string) {
    const schoolId = uuid.parse(schoolValue);
    const role = await this.membership(this.db, user, schoolId);
    if (!new Set<MemberRole>(["admin", "staff"]).has(role)) throw new ForbiddenException("This event catalog is available to school staff only.");
    const classes = (await sql<{ id: string; name: string; grade: string; section: string }>`
      SELECT DISTINCT section.id,concat('Class ',section.grade,section.section) AS name,section.grade,section.section
      FROM class_sections section
      WHERE section.school_id=${schoolId}::uuid AND (${role}='admin' OR EXISTS (
        SELECT 1 FROM class_section_staff_assignments assignment
        WHERE assignment.school_id=section.school_id AND assignment.class_section_id=section.id
          AND assignment.user_id=${user.id}::uuid
          AND (now() AT TIME ZONE (SELECT timezone FROM schools WHERE id=section.school_id))::date
            BETWEEN assignment.valid_from AND COALESCE(assignment.valid_until,'infinity'::date)
      )) ORDER BY section.grade,section.section,section.id
    `.execute(this.db)).rows;
    const students = role === "admin" ? (await sql<{ id: string; name: string; class_section_id: string; admission_number: string }>`
      SELECT DISTINCT student.id,concat_ws(' ',person.first_name,person.last_name) AS name,
        enrollment.class_section_id,student.admission_number
      FROM students student JOIN school_people person ON person.id=student.person_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
      JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
      JOIN schools school ON school.id=student.school_id
      WHERE student.school_id=${schoolId}::uuid
        AND enrollment.enrolled_on<=(now() AT TIME ZONE school.timezone)::date
        AND (now() AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
      ORDER BY name,student.id
    `.execute(this.db)).rows : [];
    const staff = role === "admin" ? (await sql<{ user_id: string; name: string }>`
      SELECT membership.user_id,concat_ws(' ',account.first_name,account.last_name) AS name
      FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.role IN ('staff','admin') AND membership.is_active
      ORDER BY name,membership.user_id
    `.execute(this.db)).rows : [];
    const subjects = (await sql<{ id: string; name: string; short_name: string; class_section_ids: string[] }>`
      SELECT subject.id,subject.name,subject.short_name,
        COALESCE(array_agg(DISTINCT scope.class_section_id) FILTER(WHERE scope.class_section_id IS NOT NULL),ARRAY[]::uuid[]) AS class_section_ids
      FROM subjects subject
      LEFT JOIN LATERAL (
        SELECT DISTINCT section.id AS class_section_id
        FROM class_sections section
        WHERE section.school_id=subject.school_id AND (
          (${role}='admin' AND EXISTS(SELECT 1 FROM timetable_slots slot
            WHERE slot.class_section_id=section.id AND slot.subject_id=subject.id))
          OR EXISTS(SELECT 1 FROM class_section_staff_assignments assignment
            WHERE assignment.school_id=section.school_id AND assignment.class_section_id=section.id
              AND assignment.user_id=${user.id}::uuid
              AND (now() AT TIME ZONE (SELECT timezone FROM schools WHERE id=section.school_id))::date
                BETWEEN assignment.valid_from AND COALESCE(assignment.valid_until,'infinity'::date)
              AND ((assignment.role='subject_teacher' AND assignment.subject_id=subject.id)
                OR (assignment.role='class_teacher' AND EXISTS(SELECT 1 FROM timetable_slots slot
                  WHERE slot.class_section_id=section.id AND slot.subject_id=subject.id)))
          ))
        )
      ) scope ON true
      WHERE subject.school_id=${schoolId}::uuid
      GROUP BY subject.id,subject.name,subject.short_name
      HAVING count(scope.class_section_id)>0
      ORDER BY subject.name,subject.id
    `.execute(this.db)).rows;
    return { class_sections: classes, students, staff, subjects };
  }

  async list(user: AuthUser, query: Record<string, string | undefined>): Promise<CampusEventListDto> {
    const input = z.object({
      school_id: uuid,
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
      status: eventStatus.optional(),
      student_id: uuid.optional(),
      cursor: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(query);
    const role = await this.membership(this.db, user, input.school_id);
    if (input.student_id && new Set<MemberRole>(["student", "guardian"]).has(role)) {
      const allowed = (await sql<{ ok: boolean }>`SELECT EXISTS(
        SELECT 1 FROM students student WHERE student.school_id=${input.school_id}::uuid AND student.id=${input.student_id}::uuid
          AND ((student.user_id=${user.id}::uuid AND ${role}='student') OR (${role}='guardian' AND EXISTS(
            SELECT 1 FROM parents parent JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
            WHERE parent.user_id=${user.id}::uuid AND relationship.school_id=student.school_id AND relationship.student_id=student.id
          )))
      ) AS ok`.execute(this.db)).rows[0]?.ok;
      if (!allowed) throw new NotFoundException("Student not found or no longer accessible.");
    }
    const sortNow = new Date().toISOString();
    const rows = (await sql<{ id: string }>`
      WITH visible AS (
        SELECT event.id,event.starts_at,event.ends_at
        FROM campus_events event
        WHERE event.school_id=${input.school_id}::uuid
          AND (${input.from ?? null}::timestamptz IS NULL OR event.ends_at>=${input.from ?? null}::timestamptz)
          AND (${input.to ?? null}::timestamptz IS NULL OR event.starts_at<=${input.to ?? null}::timestamptz)
          AND (${input.status ?? null}::text IS NULL OR event.status=${input.status ?? null})
          AND (${input.student_id ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM campus_event_participants selected_participant
            WHERE selected_participant.event_id=event.id AND selected_participant.student_id=${input.student_id ?? null}::uuid))
          AND (
            ${role}='admin'
            OR (${role}='staff' AND EXISTS(SELECT 1 FROM campus_event_staff staff
              WHERE staff.event_id=event.id AND staff.user_id=${user.id}::uuid))
            OR (${role}='student' AND event.status<>'draft' AND EXISTS(
              SELECT 1 FROM campus_event_participants participant JOIN students student ON student.id=participant.student_id
              WHERE participant.event_id=event.id AND student.user_id=${user.id}::uuid))
            OR (${role}='guardian' AND event.status<>'draft' AND EXISTS(
              SELECT 1 FROM campus_event_participants participant
              JOIN guardian_relationships relationship ON relationship.student_id=participant.student_id
              JOIN parents parent ON parent.id=relationship.guardian_id
              WHERE participant.event_id=event.id AND parent.user_id=${user.id}::uuid))
          )
      ), cursor_event AS (
        SELECT id,starts_at,ends_at FROM visible WHERE id=${input.cursor ?? null}::uuid
      )
      SELECT event.id
      FROM visible event LEFT JOIN cursor_event cursor ON true
      WHERE ${input.cursor ?? null}::uuid IS NULL OR (
        cursor.id IS NOT NULL AND (
          (cursor.ends_at>=${sortNow}::timestamptz AND (
            (event.ends_at>=${sortNow}::timestamptz AND (event.starts_at,event.id)>(cursor.starts_at,cursor.id))
            OR event.ends_at<${sortNow}::timestamptz
          ))
          OR (cursor.ends_at<${sortNow}::timestamptz AND event.ends_at<${sortNow}::timestamptz
            AND (event.starts_at,event.id)<(cursor.starts_at,cursor.id))
        )
      )
      ORDER BY (event.ends_at<${sortNow}::timestamptz),
        CASE WHEN event.ends_at>=${sortNow}::timestamptz THEN event.starts_at END ASC,
        CASE WHEN event.ends_at<${sortNow}::timestamptz THEN event.starts_at END DESC,
        CASE WHEN event.ends_at>=${sortNow}::timestamptz THEN event.id END ASC,
        CASE WHEN event.ends_at<${sortNow}::timestamptz THEN event.id END DESC
      LIMIT ${input.limit + 1}
    `.execute(this.db)).rows;
    const page = rows.slice(0, input.limit);
    return {
      items: await Promise.all(page.map((row) => this.detail(user, row.id, input.school_id, input.student_id, true))),
      next_cursor: rows.length > input.limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async detail(user: AuthUser, eventValue: string, schoolValue: string, requestedStudentValue?: string, summary = false): Promise<CampusEventDto> {
    const eventId = uuid.parse(eventValue), schoolId = uuid.parse(schoolValue);
    const requestedStudentId = requestedStudentValue ? uuid.parse(requestedStudentValue) : undefined;
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async (db) => {
      const event = await this.eventRow(db, schoolId, eventId);
      const actor = await this.access(db, user, event);
      if (requestedStudentId && (actor.role === "student" || actor.role === "guardian")) {
        await this.familyParticipant(db, user, event, requestedStudentId);
      }
      return this.dto(db, user, event, actor, requestedStudentId, summary);
    });
  }

  private async dto(db: Db, user: AuthUser, event: EventRow, actor: ActorAccess, requestedStudentId?: string, summary = false): Promise<CampusEventDto> {
    const classIds = (await sql<{ id: string }>`SELECT class_section_id AS id FROM campus_event_class_sections WHERE event_id=${event.id}::uuid ORDER BY class_section_id`.execute(db)).rows.map((r) => r.id);
    const studentIds = (await sql<{ id: string }>`SELECT student_id AS id FROM campus_event_selected_students WHERE event_id=${event.id}::uuid ORDER BY student_id`.execute(db)).rows.map((r) => r.id);
    const sessions = (await sql<{
      id: string; title: string; session_type: "general" | "rehearsal" | "departure" | "activity" | "return";
      venue: string; starts_at: Date; ends_at: Date; attendance_mode: "none" | "check_in" | "check_in_out";
      state: "open" | "locked"; revision: number; recorded: string; present: string; late: string;
      excused: string; no_show: string; checked_out: string; expected: string; selected_ids: string[];
    }>`
      SELECT session.id,session.title,session.session_type,session.venue,session.starts_at,session.ends_at,
        session.attendance_mode,session.state,session.revision,
        count(DISTINCT roster.student_id)::text AS expected,
        COALESCE((SELECT array_agg(selected.student_id ORDER BY selected.student_id)
          FROM campus_event_session_selected_students selected WHERE selected.session_id=session.id),ARRAY[]::uuid[]) AS selected_ids,
        count(record.id) FILTER(WHERE record.status<>'not_recorded')::text AS recorded,
        count(record.id) FILTER(WHERE record.status='present')::text AS present,
        count(record.id) FILTER(WHERE record.status='late')::text AS late,
        count(record.id) FILTER(WHERE record.status='excused')::text AS excused,
        count(record.id) FILTER(WHERE record.status='no_show')::text AS no_show,
        count(record.id) FILTER(WHERE record.status='checked_out')::text AS checked_out
      FROM campus_event_sessions session
      LEFT JOIN campus_event_session_participants roster ON roster.session_id=session.id AND (
        ${actor.role} IN ('admin','staff') OR (
          (${requestedStudentId ?? null}::uuid IS NULL OR roster.student_id=${requestedStudentId ?? null}::uuid)
          AND EXISTS(
            SELECT 1 FROM students visible_student
            WHERE visible_student.id=roster.student_id AND visible_student.school_id=roster.school_id
              AND (visible_student.user_id=${user.id}::uuid OR EXISTS(
                SELECT 1 FROM guardian_relationships visible_relationship
                JOIN parents visible_parent ON visible_parent.id=visible_relationship.guardian_id
                WHERE visible_relationship.school_id=roster.school_id
                  AND visible_relationship.student_id=visible_student.id
                  AND visible_parent.user_id=${user.id}::uuid
              ))
          )
        )
      )
      LEFT JOIN campus_event_attendance_records record ON record.session_id=session.id AND record.student_id=roster.student_id
      WHERE session.event_id=${event.id}::uuid
      GROUP BY session.id ORDER BY session.starts_at,session.id
    `.execute(db)).rows.map((row) => ({
      id: row.id, title: row.title, session_type: row.session_type, venue: row.venue,
      starts_at: iso(row.starts_at)!, ends_at: iso(row.ends_at)!, attendance_mode: row.attendance_mode,
      state: row.state, revision: row.revision, participant_student_ids: row.selected_ids,
      counts: {
        recorded: Number(row.recorded), not_recorded: Math.max(0, Number(row.expected) - Number(row.recorded)),
        present: Number(row.present), late: Number(row.late), excused: Number(row.excused),
        no_show: Number(row.no_show), checked_out: Number(row.checked_out),
      },
    }));
    const checklist = (await sql<{ id: string; label: string; required: boolean; sort_order: number }>`
      SELECT id,label,required,sort_order FROM campus_event_checklist_items
      WHERE event_id=${event.id}::uuid ORDER BY sort_order,id
    `.execute(db)).rows;
    const viewerParticipants = summary && (actor.role === "admin" || actor.role === "staff") ? [] : (await sql<{
      student_id: string; student_name: string; avatar_url: string;
      participation_requirement: "optional" | "mandatory"; rsvp_status: "pending" | "accepted" | "declined";
      rsvp_revision: number;
      consent_status: "pending" | "granted" | "denied" | "withdrawn";
      consent_revision: number;
      payment_status: "not_required" | "pending" | "paid"; payment_amount_paise: number;
      payment_paid_paise: number; fee_invoice_id: string | null;
      completed_ids: string[]; authority_state: "ready" | "missing" | "expired";
    }>`
      SELECT participant.student_id,concat_ws(' ',person.first_name,person.last_name) AS student_name,
        student.avatar_url,participant.participation_requirement,participant.rsvp_status,participant.rsvp_revision,
        CASE WHEN consent.event_id IS NOT NULL AND decision_authority.id IS NOT NULL THEN consent.status ELSE 'pending' END AS consent_status,
        COALESCE(consent.revision,0)::int AS consent_revision,
        CASE WHEN invoice.id IS NULL THEN 'not_required'
          WHEN COALESCE(payment.paid_paise,0)>=invoice.amount_paise THEN 'paid' ELSE 'pending' END AS payment_status,
        COALESCE(invoice.amount_paise,0)::int AS payment_amount_paise,
        COALESCE(payment.paid_paise,0)::int AS payment_paid_paise,invoice.id AS fee_invoice_id,
        COALESCE(array_agg(DISTINCT completion.item_id) FILTER(WHERE completion.item_id IS NOT NULL),ARRAY[]::uuid[]) AS completed_ids,
        CASE WHEN EXISTS(
          SELECT 1 FROM guardian_relationships relationship
          JOIN campus_event_consent_authorities authority ON authority.relationship_id=relationship.id
            AND authority.school_id=relationship.school_id
          JOIN schools school ON school.id=authority.school_id
          WHERE relationship.student_id=participant.student_id
            AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
              BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
            AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
              WHERE revocation.authority_id=authority.id AND revocation.revoked_at<=${event.starts_at}::timestamptz)
        ) THEN 'ready' WHEN EXISTS(
          SELECT 1 FROM guardian_relationships relationship
          JOIN campus_event_consent_authorities authority ON authority.relationship_id=relationship.id
            AND authority.school_id=relationship.school_id
          WHERE relationship.student_id=participant.student_id
        ) THEN 'expired' ELSE 'missing' END AS authority_state
      FROM campus_event_participants participant
      JOIN students student ON student.id=participant.student_id JOIN school_people person ON person.id=student.person_id
      LEFT JOIN campus_event_consents consent ON consent.event_id=participant.event_id AND consent.student_id=participant.student_id
      LEFT JOIN campus_event_consent_authorities decision_authority ON decision_authority.id=consent.authority_id
        AND (consent.decided_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=participant.school_id))::date
          BETWEEN decision_authority.valid_from AND COALESCE(decision_authority.valid_until,'infinity'::date)
        AND (${event.starts_at}::timestamptz AT TIME ZONE (SELECT timezone FROM schools WHERE id=participant.school_id))::date
          BETWEEN decision_authority.valid_from AND COALESCE(decision_authority.valid_until,'infinity'::date)
        AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations decision_revocation
          WHERE decision_revocation.authority_id=decision_authority.id
            AND decision_revocation.revoked_at<=${event.starts_at}::timestamptz)
      LEFT JOIN campus_event_checklist_completions completion ON completion.event_id=participant.event_id AND completion.student_id=participant.student_id
      LEFT JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
      LEFT JOIN LATERAL (SELECT COALESCE(sum(fee_payment.amount_paise),0)::int AS paid_paise
        FROM fee_payments fee_payment WHERE fee_payment.invoice_id=invoice.id) payment ON true
      WHERE participant.event_id=${event.id}::uuid
        AND (${requestedStudentId ?? null}::uuid IS NULL OR participant.student_id=${requestedStudentId ?? null}::uuid)
        AND (${actor.role} IN ('admin','staff') OR student.user_id=${user.id}::uuid OR EXISTS(
          SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
          WHERE relationship.student_id=participant.student_id AND parent.user_id=${user.id}::uuid
        ))
      GROUP BY participant.student_id,student.avatar_url,person.first_name,person.last_name,
        participant.participation_requirement,participant.rsvp_status,participant.rsvp_revision,
        consent.event_id,consent.status,consent.revision,decision_authority.id,
        invoice.id,invoice.amount_paise,payment.paid_paise
      ORDER BY student_name,participant.student_id
    `.execute(db)).rows;
    const familyViewer = actor.role === "student" || actor.role === "guardian";
    const viewerAttendance = !familyViewer ? [] : (await sql<{
      session_id: string; student_id: string; expected: boolean; status: AttendanceValue;
      checked_in_at: Date | null; checked_out_at: Date | null;
    }>`
      SELECT session.id AS session_id,participant.student_id,
        (roster.student_id IS NOT NULL) AS expected,
        COALESCE(record.status,'not_recorded') AS status,
        record.checked_in_at,record.checked_out_at
      FROM campus_event_sessions session
      JOIN campus_event_participants participant ON participant.event_id=session.event_id
      JOIN students student ON student.id=participant.student_id
      LEFT JOIN campus_event_session_participants roster ON roster.session_id=session.id
        AND roster.student_id=participant.student_id
      LEFT JOIN campus_event_attendance_records record ON record.session_id=session.id
        AND record.student_id=participant.student_id
      WHERE session.event_id=${event.id}::uuid
        AND (${requestedStudentId ?? null}::uuid IS NULL OR participant.student_id=${requestedStudentId ?? null}::uuid)
        AND (student.user_id=${user.id}::uuid OR EXISTS(
          SELECT 1 FROM guardian_relationships relationship
          JOIN parents parent ON parent.id=relationship.guardian_id
          WHERE relationship.school_id=participant.school_id
            AND relationship.student_id=participant.student_id
            AND parent.user_id=${user.id}::uuid
        ))
      ORDER BY session.starts_at,session.id,participant.student_id
    `.execute(db)).rows.map((row) => ({
      ...row,
      checked_in_at: iso(row.checked_in_at),
      checked_out_at: iso(row.checked_out_at),
    }));
    const counts = (await sql<{
      participants: string; mandatory: string; rsvp_accepted: string; consent_granted: string;
      checklist_ready: string; checklist_required_items: string;
    }>`
      SELECT count(*)::text AS participants,
        count(*) FILTER(WHERE participant.participation_requirement='mandatory')::text AS mandatory,
        count(*) FILTER(WHERE participant.rsvp_status='accepted')::text AS rsvp_accepted,
        count(*) FILTER(WHERE consent.status='granted' AND authority.id IS NOT NULL)::text AS consent_granted,
        count(*) FILTER(WHERE NOT EXISTS(
          SELECT 1 FROM campus_event_checklist_items required_item
          WHERE required_item.event_id=participant.event_id AND required_item.required
            AND NOT EXISTS(SELECT 1 FROM campus_event_checklist_completions required_completion
              WHERE required_completion.item_id=required_item.id
                AND required_completion.student_id=participant.student_id)
        ))::text AS checklist_ready,
        (SELECT count(*)::text FROM campus_event_checklist_items required_item
          WHERE required_item.event_id=${event.id}::uuid AND required_item.required) AS checklist_required_items
      FROM campus_event_participants participant
      JOIN students count_student ON count_student.id=participant.student_id
      LEFT JOIN campus_event_consents consent ON consent.event_id=participant.event_id AND consent.student_id=participant.student_id
      LEFT JOIN campus_event_consent_authorities authority ON authority.id=consent.authority_id
        AND (consent.decided_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=participant.school_id))::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND (${event.starts_at}::timestamptz AT TIME ZONE (SELECT timezone FROM schools WHERE id=participant.school_id))::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations count_revocation
          WHERE count_revocation.authority_id=authority.id
            AND count_revocation.revoked_at<=${event.starts_at}::timestamptz)
      WHERE participant.event_id=${event.id}::uuid
        AND (${requestedStudentId ?? null}::uuid IS NULL OR participant.student_id=${requestedStudentId ?? null}::uuid)
        AND (${actor.role} IN ('admin','staff') OR count_student.user_id=${user.id}::uuid OR EXISTS(
          SELECT 1 FROM guardian_relationships count_relationship
          JOIN parents count_parent ON count_parent.id=count_relationship.guardian_id
          WHERE count_relationship.school_id=participant.school_id
            AND count_relationship.student_id=participant.student_id
            AND count_parent.user_id=${user.id}::uuid
        ))
    `.execute(db)).rows[0]!;
    const staff = (await sql<{ user_id: string; name: string; role: "organizer" | "duty_staff" | "attendance_taker" }>`
      SELECT staff.user_id,concat_ws(' ',account.first_name,account.last_name) AS name,staff.role
      FROM campus_event_staff staff JOIN users account ON account.id=staff.user_id
      WHERE staff.event_id=${event.id}::uuid ORDER BY name,staff.role,staff.user_id
    `.execute(db)).rows;
    const familyOpen = event.status === "published" && Date.now() < new Date(event.starts_at).getTime();
    const canTake = this.canTake(actor) && sessions.some((session) => {
      if (event.status !== "published" || session.attendance_mode === "none" || session.state !== "open") return false;
      const now = Date.now();
      if (now < Date.parse(session.starts_at) - 2 * 60 * 60 * 1000) return false;
      return actor.role === "admin" || now <= Date.parse(session.ends_at) + 24 * 60 * 60 * 1000;
    });
    const draftEditor = event.status === "draft"
      && (actor.role === "admin" || actor.ownsClassTest || actor.organizerAssigned);
    const draftPublisher = draftEditor
      && (actor.role === "admin" || actor.ownsClassTest || !event.payment_required);
    const actorConsentReady = actor.role === "guardian" && Boolean((await sql<{ ok: boolean }>`SELECT EXISTS(
      SELECT 1 FROM campus_event_participants participant
      JOIN guardian_relationships relationship ON relationship.student_id=participant.student_id AND relationship.school_id=participant.school_id
      JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id=${user.id}::uuid
      JOIN campus_event_consent_authorities authority ON authority.relationship_id=relationship.id
        AND authority.school_id=relationship.school_id
      JOIN schools school ON school.id=authority.school_id
      WHERE participant.event_id=${event.id}::uuid
        AND (${requestedStudentId ?? null}::uuid IS NULL OR participant.student_id=${requestedStudentId ?? null}::uuid)
        AND (now() AT TIME ZONE school.timezone)::date BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
          WHERE revocation.authority_id=authority.id)
    ) AS ok`.execute(db)).rows[0]?.ok);
    const trackedSessionsReady = Boolean((await sql<{ ok: boolean }>`SELECT NOT EXISTS(
      SELECT 1 FROM campus_event_sessions session WHERE session.event_id=${event.id}::uuid
        AND session.attendance_mode<>'none' AND session.state<>'locked'
    ) AS ok`.execute(db)).rows[0]?.ok);
    const canViewParticipantFinance = actor.financeGranted || familyViewer;
    const financeReconciliationRequired = actor.financeGranted
      ? await this.financeReconciliationCount(db, event.id)
      : 0;
    const visibleParticipantIds = new Set(viewerParticipants.map((participant) => participant.student_id));
    const requiredChecklistIds = new Set(checklist.filter((item) => item.required).map((item) => item.id));
    const projectedSessions = sessions.map((session) => ({
      ...session,
      participant_student_ids: actor.role === "admin" || actor.role === "staff"
        ? session.participant_student_ids
        : session.participant_student_ids.filter((studentId) => visibleParticipantIds.has(studentId)),
      viewer_attendance: familyViewer
        ? viewerAttendance.filter((row) => row.session_id === session.id).map((row) => ({
            student_id: row.student_id,
            expected: row.expected,
            status: row.status,
            checked_in_at: row.checked_in_at,
            checked_out_at: row.checked_out_at,
          }))
        : [],
    }));
    return {
      id: event.id, school_id: event.school_id, event_type: event.event_type, subject_id: event.subject_id,
      status: event.status, title: event.title, description: event.description, venue: event.venue,
      starts_at: iso(event.starts_at)!, ends_at: iso(event.ends_at)!,
      audience: {
        mode: event.audience_mode,
        class_section_ids: actor.role === "admin" || actor.role === "staff" ? classIds : [],
        student_ids: actor.role === "admin" || actor.role === "staff" ? studentIds : [],
      },
      participation_requirement: event.participation_requirement,
      requires_rsvp: event.requires_rsvp, requires_guardian_consent: event.requires_guardian_consent,
      payment_required: event.payment_required, payment_amount_paise: event.payment_amount_paise,
      payment_due_on: event.payment_due_on, payment_currency: event.payment_currency,
      academic_attendance_impact: "none",
      revision: event.revision, published_at: iso(event.published_at), cancelled_at: iso(event.cancelled_at),
      cancellation_reason: event.cancellation_reason,
      cancellation_internal_reason: actor.role === "admin" || actor.role === "staff"
        ? event.cancellation_internal_reason
        : null,
      sessions: projectedSessions, checklist,
      staff: actor.role === "admin" || actor.role === "staff" ? staff : [],
      viewer_participants: viewerParticipants.map((row) => {
        const requiredCompleted = row.completed_ids.filter((itemId) => requiredChecklistIds.has(itemId)).length;
        return {
          student_id: row.student_id, student_name: row.student_name, avatar_url: row.avatar_url,
          participation_requirement: row.participation_requirement, rsvp_status: row.rsvp_status,
          rsvp_revision: row.rsvp_revision, consent_status: row.consent_status,
          consent_revision: row.consent_revision,
          payment_status: canViewParticipantFinance ? row.payment_status : "not_required",
          payment_amount_paise: canViewParticipantFinance ? row.payment_amount_paise : 0,
          payment_paid_paise: canViewParticipantFinance ? row.payment_paid_paise : 0,
          fee_invoice_id: canViewParticipantFinance ? row.fee_invoice_id : null,
          fee_invoice_status: canViewParticipantFinance ? row.payment_status : "not_required",
          consent_readiness: !event.requires_guardian_consent ? "not_required" : row.authority_state === "ready" ? "ready" : row.authority_state === "expired" ? "authority_expired" : "authority_missing",
          checklist_completed: row.completed_ids.length, checklist_total: checklist.length,
          checklist_completed_item_ids: row.completed_ids,
          checklist_required: requiredChecklistIds.size,
          checklist_required_completed: requiredCompleted,
          checklist_ready: requiredCompleted === requiredChecklistIds.size,
        };
      }),
      counts: {
        participants: Number(counts.participants), mandatory: Number(counts.mandatory),
        rsvp_accepted: Number(counts.rsvp_accepted), consent_granted: Number(counts.consent_granted),
        checklist_ready: Number(counts.checklist_ready),
        checklist_required_items: Number(counts.checklist_required_items),
        finance_reconciliation_required: financeReconciliationRequired,
      },
      permissions: {
        can_edit: draftEditor, can_publish: draftPublisher,
        can_cancel: event.status === "published" && Date.now() < new Date(event.starts_at).getTime()
          && (actor.role === "admin" || actor.ownsClassTest),
        can_complete: event.status === "published" && Date.now() >= new Date(event.ends_at).getTime()
          && trackedSessionsReady && actor.role === "admin",
        can_manage_policy: event.status === "draft" && actor.role === "admin",
        can_manage_audience: event.status === "draft" && (actor.role === "admin" || actor.ownsClassTest),
        can_manage_staff: event.status === "draft" && actor.role === "admin",
        can_rsvp: familyOpen && event.requires_rsvp && familyViewer && viewerParticipants.length > 0
          && (!event.payment_required || actor.role === "guardian"),
        can_consent: familyOpen && event.requires_guardian_consent && actorConsentReady,
        can_take_attendance: canTake,
        can_view_finance_details: canViewParticipantFinance,
      },
    };
  }

  private async writeDefinition(db: Db, eventId: string, input: z.infer<typeof createEventSchema>, creatorId: string) {
    await sql`DELETE FROM campus_event_class_sections WHERE event_id=${eventId}::uuid`.execute(db);
    await sql`DELETE FROM campus_event_selected_students WHERE event_id=${eventId}::uuid`.execute(db);
    await sql`DELETE FROM campus_event_staff WHERE event_id=${eventId}::uuid`.execute(db);
    await sql`DELETE FROM campus_event_sessions WHERE event_id=${eventId}::uuid`.execute(db);
    await sql`DELETE FROM campus_event_checklist_items WHERE event_id=${eventId}::uuid`.execute(db);
    if (input.audience.class_section_ids.length) await sql`
      INSERT INTO campus_event_class_sections(school_id,event_id,class_section_id)
      SELECT ${input.school_id}::uuid,${eventId}::uuid,id FROM unnest(${input.audience.class_section_ids}::uuid[]) id
    `.execute(db);
    if (input.audience.student_ids.length) await sql`
      INSERT INTO campus_event_selected_students(school_id,event_id,student_id)
      SELECT ${input.school_id}::uuid,${eventId}::uuid,id FROM unnest(${input.audience.student_ids}::uuid[]) id
    `.execute(db);
    const configuredStaff = [...input.staff];
    if (input.event_type === "class_test" && input.subject_id && input.audience.class_section_ids.length === 1) {
      const subjectTeacherId = await this.assignedSubjectTeacher(
        db,
        input.school_id,
        input.audience.class_section_ids[0]!,
        input.subject_id,
        input.starts_at,
      );
      if (subjectTeacherId && subjectTeacherId !== creatorId && !configuredStaff.some((row) => row.user_id === subjectTeacherId)) {
        configuredStaff.push({ user_id: subjectTeacherId, role: "attendance_taker" });
      }
    }
    const staff = configuredStaff.some((row) => row.user_id === creatorId)
      ? configuredStaff
      : [...configuredStaff, { user_id: creatorId, role: "organizer" as const }];
    if (staff.length) await sql`
      INSERT INTO campus_event_staff(school_id,event_id,user_id,role)
      SELECT ${input.school_id}::uuid,${eventId}::uuid,item.user_id,item.role
      FROM jsonb_to_recordset(${JSON.stringify(staff)}::jsonb) item(user_id uuid,role varchar)
    `.execute(db);
    for (const session of input.sessions) {
      const sessionId = session.id ?? randomUUID();
      await sql`
        INSERT INTO campus_event_sessions(id,school_id,event_id,title,session_type,venue,starts_at,ends_at,attendance_mode)
        VALUES(${sessionId}::uuid,${input.school_id}::uuid,${eventId}::uuid,${session.title},${session.session_type},${session.venue},
          ${session.starts_at}::timestamptz,${session.ends_at}::timestamptz,${session.attendance_mode})
      `.execute(db);
      if (session.participant_student_ids.length) await sql`
        INSERT INTO campus_event_session_selected_students(school_id,event_id,session_id,student_id)
        SELECT ${input.school_id}::uuid,${eventId}::uuid,${sessionId}::uuid,id
        FROM unnest(${session.participant_student_ids}::uuid[]) id
      `.execute(db);
    }
    for (const [index, item] of input.checklist.entries()) await sql`
      INSERT INTO campus_event_checklist_items(id,school_id,event_id,label,required,sort_order)
      VALUES(${item.id ?? randomUUID()}::uuid,${input.school_id}::uuid,${eventId}::uuid,${item.label},${item.required},${index})
    `.execute(db);
  }

  private assertOrganizerDefinitionBoundary(
    event: EventRow,
    input: z.infer<typeof createEventSchema>,
    existing: z.infer<typeof createEventSchema>,
  ) {
    const sorted = (values: string[]) => [...values].sort().join("|");
    const audienceChanged = input.audience.mode !== existing.audience.mode
      || sorted(input.audience.class_section_ids) !== sorted(existing.audience.class_section_ids)
      || sorted(input.audience.student_ids) !== sorted(existing.audience.student_ids);
    const sessionAudience = (value: z.infer<typeof createEventSchema>) => value.sessions
      .map((session) => `${session.id ?? ""}:${sorted(session.participant_student_ids)}`)
      .sort()
      .join("||");
    const protectedPolicyChanged = input.event_type !== event.event_type
      || input.subject_id !== event.subject_id
      || input.participation_requirement !== event.participation_requirement
      || input.requires_rsvp !== event.requires_rsvp
      || input.requires_guardian_consent !== event.requires_guardian_consent
      || input.payment_required !== event.payment_required
      || input.payment_amount_paise !== event.payment_amount_paise
      || input.payment_due_on !== event.payment_due_on
      || input.payment_currency !== event.payment_currency;
    const staffKey = (rows: Array<{ user_id: string; role: string }>) => rows
      .map((row) => `${row.user_id}:${row.role}`)
      .sort()
      .join("|");
    if (audienceChanged || sessionAudience(input) !== sessionAudience(existing)) {
      throw new ForbiddenException("Only a school administrator can change an event audience or session participant scope.");
    }
    if (protectedPolicyChanged) {
      throw new ForbiddenException("An organizer can update event delivery details, but participation, consent and financial policy require administrator review.");
    }
    if (staffKey(input.staff) !== staffKey(existing.staff)) {
      throw new ForbiddenException("Only a school administrator can change event staff authority.");
    }
  }

  async create(req: AuthenticatedRequest, body: unknown) {
    const input = createEventSchema.parse(body), requestHash = hash({ operation: "create", input });
    return this.db.transaction().execute(async (db) => {
      const role = await this.membership(db, req.authUser, input.school_id, true);
      if (role !== "admin" && !(role === "staff" && input.event_type === "class_test")) {
        throw new ForbiddenException("Only administrators may create this kind of event.");
      }
      const prior = await this.priorCommand<CampusEventDto>(db, input.school_id, req.authUser.id, input.idempotency_key, "create", requestHash);
      if (prior) return prior;
      // A teacher cannot turn a class-test draft into a general staff-access
      // grant. Duties for teacher-managed tests are derived from explicit
      // class/subject authority below.
      const definition = role === "staff" && input.event_type === "class_test"
        ? { ...input, staff: [] }
        : input;
      await this.validateRelations(db, definition, req.authUser);
      const event = (await sql<EventRow>`
        INSERT INTO campus_events(school_id,event_type,subject_id,title,description,venue,starts_at,ends_at,audience_mode,
          participation_requirement,requires_rsvp,requires_guardian_consent,payment_required,payment_amount_paise,payment_due_on,payment_currency,created_by)
        VALUES(${input.school_id}::uuid,${input.event_type},${input.subject_id}::uuid,${input.title},${input.description},${input.venue},
          ${input.starts_at}::timestamptz,${input.ends_at}::timestamptz,${input.audience.mode},${input.participation_requirement},
          ${input.requires_rsvp},${input.requires_guardian_consent},${input.payment_required},${input.payment_amount_paise},
          ${input.payment_due_on}::date,${input.payment_currency},${req.authUser.id}::uuid)
        RETURNING id,school_id,event_type,subject_id,status,title,description,venue,starts_at,ends_at,audience_mode,
          participation_requirement,requires_rsvp,requires_guardian_consent,payment_required,payment_amount_paise,
          payment_due_on::text,payment_currency,academic_attendance_impact,
          revision,created_by,published_at,cancelled_at,cancellation_reason,cancellation_internal_reason
      `.execute(db)).rows[0]!;
      await this.writeDefinition(db, event.id, definition, req.authUser.id);
      await this.audit(db, req, "campus_event.created", event.school_id, event.id, { revision: event.revision, event_type: event.event_type });
      await this.enqueue(db, event, "draft", `campus-event:${event.id}:draft:${event.revision}`);
      const result = await this.dto(db, req.authUser, event, {
        role,
        assigned: true,
        organizerAssigned: true,
        attendanceAssigned: false,
        ownsClassTest: event.event_type === "class_test",
        financeGranted: role === "admin",
      });
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "create", requestHash, result);
      return result;
    });
  }

  async save(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    const eventId = uuid.parse(eventValue), input = saveEventSchema.parse(body);
    const requestHash = hash({ operation: "save", eventId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.eventRow(db, input.school_id, eventId, true);
      const actor = await this.access(db, req.authUser, event, true);
      if (event.status !== "draft") throw new ConflictException("Published event structure is immutable. Cancel and create a reviewed replacement.");
      if (actor.role !== "admin" && !actor.ownsClassTest && !actor.organizerAssigned) {
        throw new ForbiddenException("You cannot edit this event.");
      }
      const prior = await this.priorCommand<CampusEventDto>(db, input.school_id, req.authUser.id, input.idempotency_key, "save", requestHash);
      if (prior) return prior;
      if (event.revision !== input.expected_revision) throw new ConflictException("This event changed. Reload the current revision.");
      if (actor.ownsClassTest && (event.event_type !== "class_test" || input.event_type !== "class_test" || event.created_by !== req.authUser.id)) {
        throw new ForbiddenException("Teachers may only edit their own class tests.");
      }
      if (actor.role !== "admin" && actor.organizerAssigned && !actor.ownsClassTest) {
        this.assertOrganizerDefinitionBoundary(event, input, await this.definitionInput(db, event));
      }
      const definition = actor.ownsClassTest
        ? { ...input, staff: [] }
        : input;
      await this.validateRelations(db, definition, req.authUser, event.id);
      await sql`UPDATE campus_events SET event_type=${input.event_type},subject_id=${input.subject_id}::uuid,title=${input.title},
        description=${input.description},venue=${input.venue},starts_at=${input.starts_at}::timestamptz,ends_at=${input.ends_at}::timestamptz,
        audience_mode=${input.audience.mode},participation_requirement=${input.participation_requirement},requires_rsvp=${input.requires_rsvp},
        requires_guardian_consent=${input.requires_guardian_consent},payment_required=${input.payment_required},
        payment_amount_paise=${input.payment_amount_paise},payment_due_on=${input.payment_due_on}::date,payment_currency=${input.payment_currency},
        revision=revision+1,updated_at=now()
        WHERE id=${event.id}::uuid`.execute(db);
      await this.writeDefinition(db, event.id, definition, event.created_by);
      const updated = await this.eventRow(db, input.school_id, event.id);
      await this.audit(db, req, "campus_event.saved", event.school_id, event.id, { revision: updated.revision });
      await this.enqueue(db, updated, "draft", `campus-event:${event.id}:draft:${updated.revision}`);
      const result = await this.dto(db, req.authUser, updated, actor);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "save", requestHash, result);
      return result;
    });
  }

  private async rosterStudentIds(db: Db, event: EventRow) {
    return (await sql<{ student_id: string }>`
      SELECT DISTINCT student.id AS student_id
      FROM students student
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
      JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
      JOIN schools school ON school.id=student.school_id
      WHERE student.school_id=${event.school_id}::uuid AND (
        (${event.audience_mode}='school')
        OR (${event.audience_mode}='class_sections' AND EXISTS(SELECT 1 FROM campus_event_class_sections audience
          WHERE audience.event_id=${event.id}::uuid AND audience.class_section_id=enrollment.class_section_id))
        OR (${event.audience_mode}='students' AND EXISTS(SELECT 1 FROM campus_event_selected_students audience
          WHERE audience.event_id=${event.id}::uuid AND audience.student_id=student.id))
      )
        AND enrollment.enrolled_on<=(${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
        AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
      ORDER BY student.id
    `.execute(db)).rows.map((row) => row.student_id);
  }

  async publish(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    return this.eventAction(req, eventValue, body, "publish");
  }
  async cancel(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    return this.eventAction(req, eventValue, body, "cancel");
  }
  async complete(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    return this.eventAction(req, eventValue, body, "complete");
  }
  async discard(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    return this.eventAction(req, eventValue, body, "discard");
  }

  private async eventAction(req: AuthenticatedRequest, eventValue: string, body: unknown, operation: "publish" | "cancel" | "complete" | "discard") {
    const eventId = uuid.parse(eventValue);
    const input = operation === "cancel" ? cancelEventSchema.parse(body) : eventActionSchema.parse(body);
    const requestHash = hash({ operation, eventId, input });
    return this.db.transaction().execute(async (db) => {
      // Look up the durable command before the aggregate. A successful draft
      // discard deletes that aggregate, but the same command key must still
      // replay its original result rather than degrade into a 404.
      const prior = await this.priorCommand<unknown>(db, input.school_id, req.authUser.id, input.idempotency_key, operation, requestHash);
      if (prior) return prior;
      const event = await this.eventRow(db, input.school_id, eventId, true);
      const actor = await this.access(db, req.authUser, event, true);
      const organizerMayManage = actor.organizerAssigned && event.status === "draft";
      const lifecycleAllowed = operation === "complete"
        ? actor.role === "admin"
        : operation === "cancel"
          ? actor.role === "admin" || actor.ownsClassTest
          : operation === "publish"
            ? actor.role === "admin" || actor.ownsClassTest || (organizerMayManage && !event.payment_required)
            : actor.role === "admin" || actor.ownsClassTest || organizerMayManage;
      if (!lifecycleAllowed) {
        throw new ForbiddenException(operation === "complete"
          ? "Only a school administrator can complete an event."
          : operation === "publish" && actor.organizerAssigned && event.payment_required
            ? "A school administrator must review and publish a paid event."
            : operation === "cancel" && actor.organizerAssigned
              ? "A school administrator must cancel a published event."
              : "You cannot manage this event lifecycle.");
      }
      if (event.revision !== input.expected_revision) throw new ConflictException("This event changed. Reload the current revision.");
      if (operation === "publish") {
        const definition = await this.definitionInput(db, event);
        await this.validateRelations(db, definition, req.authUser, event.id);
      }
      if (operation === "discard") {
        if (event.status !== "draft") throw new ConflictException("Only a draft event can be discarded.");
        await this.audit(db, req, "campus_event.discarded", event.school_id, event.id, { revision: event.revision });
        await sql`DELETE FROM campus_events WHERE id=${event.id}::uuid`.execute(db);
        const result = { id: event.id, discarded: true };
        await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, operation, requestHash, result);
        return result;
      }
      if (operation === "publish") {
        if (event.status !== "draft") throw new ConflictException("Only a draft event can be published.");
        if (new Date(event.starts_at).getTime() <= Date.now()) throw new ConflictException("An event must be published before it starts.");
        const sessionCount = Number((await sql<{ value: string }>`SELECT count(*)::text AS value FROM campus_event_sessions WHERE event_id=${event.id}::uuid`.execute(db)).rows[0]?.value ?? 0);
        if (!sessionCount) throw new BadRequestException("Add at least one event session before publishing.");
        const students = await this.rosterStudentIds(db, event);
        if (!students.length) throw new BadRequestException("The selected audience has no active enrolled students.");
        if (event.audience_mode === "students") {
          const selectedCount = Number((await sql<{ value: string }>`SELECT count(*)::text AS value
            FROM campus_event_selected_students WHERE event_id=${event.id}::uuid`.execute(db)).rows[0]?.value ?? 0);
          if (students.length !== selectedCount) {
            throw new BadRequestException("Every selected student must have an active enrollment covering the event date.");
          }
        }
        await sql`INSERT INTO campus_event_participants(school_id,event_id,student_id,participation_requirement)
          SELECT ${event.school_id}::uuid,${event.id}::uuid,id,${event.participation_requirement}
          FROM unnest(${students}::uuid[]) id`.execute(db);
        const invalidSessionSelection = Number((await sql<{ value: string }>`SELECT count(*)::text AS value
          FROM campus_event_session_selected_students selected
          WHERE selected.event_id=${event.id}::uuid AND NOT EXISTS(SELECT 1 FROM campus_event_participants participant
            WHERE participant.event_id=selected.event_id AND participant.student_id=selected.student_id)`.execute(db)).rows[0]?.value ?? 0);
        if (invalidSessionSelection) throw new BadRequestException("Every session-specific participant must belong to the event audience.");
        await sql`INSERT INTO campus_event_session_participants(school_id,event_id,session_id,student_id,participation_requirement)
          SELECT session.school_id,session.event_id,session.id,participant.student_id,participant.participation_requirement
          FROM campus_event_sessions session JOIN campus_event_participants participant ON participant.event_id=session.event_id
          WHERE session.event_id=${event.id}::uuid
            AND (participant.participation_requirement='mandatory' OR participant.rsvp_status='accepted')
            AND (
              NOT EXISTS(SELECT 1 FROM campus_event_session_selected_students selected WHERE selected.session_id=session.id)
              OR EXISTS(SELECT 1 FROM campus_event_session_selected_students selected
                WHERE selected.session_id=session.id AND selected.student_id=participant.student_id)
            )`.execute(db);
        if (event.payment_required && event.participation_requirement === "mandatory") {
          await sql`
            WITH posted AS (
              INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
              SELECT participant.school_id,participant.student_id,
                concat('EVT-',${event.id}::text,'-',participant.student_id::text),
                left(concat('Event: ',${event.title}),200),${event.payment_amount_paise},${event.payment_due_on}::date,${req.authUser.id}::uuid
              FROM campus_event_participants participant WHERE participant.event_id=${event.id}::uuid
              RETURNING id,student_id
            )
            UPDATE campus_event_participants participant SET fee_invoice_id=posted.id
            FROM posted WHERE participant.event_id=${event.id}::uuid AND participant.student_id=posted.student_id
          `.execute(db);
        }
        await sql`UPDATE campus_events SET status='published',published_by=${req.authUser.id}::uuid,published_at=now(),
          revision=revision+1,updated_at=now() WHERE id=${event.id}::uuid`.execute(db);
      } else if (operation === "cancel") {
        if (event.status !== "published") throw new ConflictException("Only a published event can be cancelled.");
        if (Date.now() >= new Date(event.starts_at).getTime()) {
          throw new ConflictException("This event has already started. Use the separately reviewed event-abort and reconciliation workflow; cancellation cannot rewrite an event in progress.");
        }
        const cancellation = input as z.infer<typeof cancelEventSchema>;
        await sql`UPDATE campus_events SET status='cancelled',cancelled_by=${req.authUser.id}::uuid,cancelled_at=now(),
          cancellation_internal_reason=${cancellation.internal_reason},cancellation_reason=${cancellation.audience_notice},
          revision=revision+1,updated_at=now() WHERE id=${event.id}::uuid`.execute(db);
      } else {
        if (event.status !== "published") throw new ConflictException("Only a published event can be completed.");
        if (Date.now() < new Date(event.ends_at).getTime()) throw new ConflictException("An event cannot be completed before it ends.");
        const openTracked = Number((await sql<{ value: string }>`SELECT count(*)::text AS value FROM campus_event_sessions
          WHERE event_id=${event.id}::uuid AND attendance_mode<>'none' AND state<>'locked'`.execute(db)).rows[0]?.value ?? 0);
        if (openTracked) throw new ConflictException("Lock every attendance-tracked session before completing the event.");
        await sql`UPDATE campus_events SET status='completed',completed_by=${req.authUser.id}::uuid,completed_at=now(),
          revision=revision+1,updated_at=now() WHERE id=${event.id}::uuid`.execute(db);
      }
      const updated = await this.eventRow(db, input.school_id, event.id);
      const auditAction = operation === "publish" ? "campus_event.published"
        : operation === "cancel" ? "campus_event.cancelled" : "campus_event.completed";
      const financeReconciliationRequired = operation === "cancel"
        ? await this.financeReconciliationCount(db, event.id)
        : 0;
      await this.audit(db, req, auditAction, event.school_id, event.id, {
        revision: updated.revision,
        ...(operation === "cancel" ? {
          internal_reason: (input as z.infer<typeof cancelEventSchema>).internal_reason,
          audience_notice: (input as z.infer<typeof cancelEventSchema>).audience_notice,
          finance_reconciliation_required: financeReconciliationRequired,
        } : {}),
      });
      const audience = await this.audience(db, event.id, event.school_id);
      const label = operation === "publish" ? "published" : operation === "cancel" ? "cancelled" : "completed";
      await this.enqueue(db, updated, label, `campus-event:${event.id}:${label}:${updated.revision}`, {
        users: audience, title: `${event.title} ${label}`, body: operation === "cancel"
          ? (input as z.infer<typeof cancelEventSchema>).audience_notice
          : `${event.title} has been ${label}.`,
      });
      const result = await this.dto(db, req.authUser, updated, actor);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, operation, requestHash, result);
      return result;
    });
  }

  private async definitionInput(db: Db, event: EventRow): Promise<z.infer<typeof createEventSchema>> {
    const audience = {
      mode: event.audience_mode,
      class_section_ids: (await sql<{ id: string }>`SELECT class_section_id AS id FROM campus_event_class_sections WHERE event_id=${event.id}::uuid`.execute(db)).rows.map((r) => r.id),
      student_ids: (await sql<{ id: string }>`SELECT student_id AS id FROM campus_event_selected_students WHERE event_id=${event.id}::uuid`.execute(db)).rows.map((r) => r.id),
    };
    const sessions = (await sql<{ id: string; title: string; session_type: "general" | "rehearsal" | "departure" | "activity" | "return"; venue: string; starts_at: Date; ends_at: Date; attendance_mode: "none" | "check_in" | "check_in_out"; participant_student_ids: string[] }>`
      SELECT session.id,session.title,session.session_type,session.venue,session.starts_at,session.ends_at,session.attendance_mode,
        COALESCE(array_agg(selected.student_id ORDER BY selected.student_id) FILTER(WHERE selected.student_id IS NOT NULL),ARRAY[]::uuid[]) AS participant_student_ids
      FROM campus_event_sessions session LEFT JOIN campus_event_session_selected_students selected ON selected.session_id=session.id
      WHERE session.event_id=${event.id}::uuid GROUP BY session.id ORDER BY session.starts_at,session.id
    `.execute(db)).rows.map((row) => ({ ...row, starts_at: iso(row.starts_at)!, ends_at: iso(row.ends_at)! }));
    const checklist = (await sql<{ id: string; label: string; required: boolean }>`SELECT id,label,required FROM campus_event_checklist_items WHERE event_id=${event.id}::uuid ORDER BY sort_order,id`.execute(db)).rows;
    const staff = (await sql<{ user_id: string; role: "organizer" | "duty_staff" | "attendance_taker" }>`SELECT user_id,role FROM campus_event_staff WHERE event_id=${event.id}::uuid`.execute(db)).rows;
    return createEventSchema.parse({
      school_id: event.school_id, idempotency_key: randomUUID(), event_type: event.event_type, subject_id: event.subject_id,
      title: event.title, description: event.description, venue: event.venue, starts_at: iso(event.starts_at)!, ends_at: iso(event.ends_at)!,
      audience, participation_requirement: event.participation_requirement, requires_rsvp: event.requires_rsvp,
      requires_guardian_consent: event.requires_guardian_consent, payment_required: event.payment_required,
      payment_amount_paise: event.payment_amount_paise, payment_due_on: event.payment_due_on, payment_currency: event.payment_currency,
      sessions, checklist, staff,
    });
  }

  private async familyParticipant(db: Db, user: AuthUser, event: EventRow, studentId: string, guardianOnly = false) {
    const role = await this.membership(db, user, event.school_id, true);
    if (guardianOnly && role !== "guardian") throw new ForbiddenException("A guardian must record this consent decision.");
    const row = (await sql<{ relationship_id: string | null; guardian_id: string | null }>`
      SELECT CASE WHEN ${role}='guardian' THEN relationship.id END AS relationship_id,
        CASE WHEN ${role}='guardian' THEN parent.id END AS guardian_id
      FROM campus_event_participants participant JOIN students student ON student.id=participant.student_id
      LEFT JOIN parents parent ON parent.user_id=${user.id}::uuid
      LEFT JOIN guardian_relationships relationship ON relationship.school_id=participant.school_id
        AND relationship.student_id=participant.student_id AND relationship.guardian_id=parent.id
      WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
        AND participant.student_id=${studentId}::uuid
        AND ((${role}='student' AND student.user_id=${user.id}::uuid) OR (${role}='guardian' AND relationship.id IS NOT NULL))
    `.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Event participant not found or no longer accessible.");
    return { role, ...row };
  }

  private ensureFamilyResponseOpen(event: EventRow) {
    if (event.status !== "published" || Date.now() >= new Date(event.starts_at).getTime()) {
      throw new ConflictException("Responses close when the published event starts.");
    }
  }

  private async postEventInvoice(db: Db, event: EventRow, studentId: string, actorId: string) {
    if (!event.payment_required || !event.payment_amount_paise || !event.payment_due_on) {
      throw new Error("Paid campus event is missing its validated fee terms.");
    }
    const invoice = (await sql<{ id: string }>`INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
      VALUES(${event.school_id}::uuid,${studentId}::uuid,${`EVT-${event.id}-${studentId}`},
        ${`Event: ${event.title}`.slice(0, 200)},${event.payment_amount_paise},${event.payment_due_on}::date,${actorId}::uuid)
      RETURNING id`.execute(db)).rows[0]!;
    await sql`UPDATE campus_event_participants SET fee_invoice_id=${invoice.id}::uuid
      WHERE event_id=${event.id}::uuid AND student_id=${studentId}::uuid`.execute(db);
    return invoice.id;
  }

  private async financeReconciliationCount(db: Db, eventId: string) {
    return Number((await sql<{ value: string }>`
      SELECT count(*)::text AS value
      FROM campus_event_participants participant
      JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(entry.amount_paise),0)::int AS amount_paise
        FROM fee_payments entry WHERE entry.invoice_id=invoice.id
      ) payment ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(entry.amount_paise),0)::int AS amount_paise
        FROM fee_invoice_credits entry WHERE entry.invoice_id=invoice.id
      ) credit ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(entry.amount_paise),0)::int AS amount_paise
        FROM fee_refunds entry WHERE entry.invoice_id=invoice.id
      ) refund ON true
      WHERE participant.event_id=${eventId}::uuid
        AND GREATEST(
          payment.amount_paise-GREATEST(invoice.amount_paise-credit.amount_paise,0)-refund.amount_paise,
          0
        )>0
    `.execute(db)).rows[0]?.value ?? 0);
  }

  async rsvp(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    const eventId = uuid.parse(eventValue), input = rsvpSchema.parse(body), requestHash = hash({ eventId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.eventRow(db, input.school_id, eventId, true);
      if (!event.requires_rsvp) throw new BadRequestException("This event does not require an RSVP.");
      const family = await this.familyParticipant(db, req.authUser, event, input.student_id);
      if (event.payment_required && family.role !== "guardian") {
        throw new ForbiddenException("A guardian must accept a paid event before its fee invoice is posted.");
      }
      const prior = await this.priorCommand<CampusEventDto>(db, input.school_id, req.authUser.id, input.idempotency_key, "rsvp", requestHash);
      if (prior) return prior;
      this.ensureFamilyResponseOpen(event);
      const before = (await sql<{
        rsvp_status: string;
        rsvp_revision: number;
        fee_invoice_id: string | null;
        participation_requirement: "optional" | "mandatory";
      }>`SELECT rsvp_status,rsvp_revision,fee_invoice_id,participation_requirement FROM campus_event_participants
        WHERE event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid FOR UPDATE`.execute(db)).rows[0]!;
      if (before.rsvp_revision !== input.expected_revision) {
        throw new ConflictException("This RSVP changed. Reload the participant's current revision.");
      }
      if (input.status === "accepted" && Boolean((await sql<{ value: boolean }>`SELECT EXISTS(
        SELECT 1 FROM campus_event_participant_withdrawals withdrawal
        WHERE withdrawal.school_id=${event.school_id}::uuid AND withdrawal.event_id=${event.id}::uuid
          AND withdrawal.student_id=${input.student_id}::uuid
      ) AS value`.execute(db)).rows[0]?.value)) {
        throw new ConflictException("This event place was withdrawn and its invoice was credited. Create a reviewed replacement invitation rather than reopening the financial history.");
      }
      if (input.status === "declined" && before.fee_invoice_id) {
        throw new ConflictException("A fee invoice has already been posted for this RSVP. The school office must reconcile the obligation before the response can be declined.");
      }
      if (input.status === "declined" && before.participation_requirement === "optional") {
        const attendanceExists = Boolean((await sql<{ value: boolean }>`SELECT EXISTS(
          SELECT 1 FROM campus_event_attendance_records record
          WHERE record.event_id=${event.id}::uuid AND record.student_id=${input.student_id}::uuid
        ) AS value`.execute(db)).rows[0]?.value);
        if (attendanceExists) {
          throw new ConflictException("Attendance has already been recorded for this participant. An administrator must reconcile the register before RSVP can be declined.");
        }
        const affectedSessions = (await sql<{ session_id: string }>`DELETE FROM campus_event_session_participants
          WHERE event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid
          RETURNING session_id`.execute(db)).rows.map((row) => row.session_id);
        if (affectedSessions.length) await sql`UPDATE campus_event_sessions
          SET revision=revision+1,updated_at=now()
          WHERE event_id=${event.id}::uuid AND id=ANY(${affectedSessions}::uuid[])`.execute(db);
      }
      if (input.status === "accepted" && event.payment_required && !before.fee_invoice_id) {
        await this.postEventInvoice(db, event, input.student_id, req.authUser.id);
      }
      await sql`UPDATE campus_event_participants SET rsvp_status=${input.status},rsvp_revision=rsvp_revision+1,
        rsvp_by=${req.authUser.id}::uuid,rsvp_at=now()
        WHERE event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid`.execute(db);
      if (input.status === "accepted" && before.participation_requirement === "optional") {
        const affectedSessions = (await sql<{ session_id: string }>`INSERT INTO campus_event_session_participants(
            school_id,event_id,session_id,student_id,participation_requirement
          )
          SELECT session.school_id,session.event_id,session.id,${input.student_id}::uuid,'optional'
          FROM campus_event_sessions session
          WHERE session.event_id=${event.id}::uuid AND (
            NOT EXISTS(SELECT 1 FROM campus_event_session_selected_students selected WHERE selected.session_id=session.id)
            OR EXISTS(SELECT 1 FROM campus_event_session_selected_students selected
              WHERE selected.session_id=session.id AND selected.student_id=${input.student_id}::uuid)
          )
          ON CONFLICT(session_id,student_id) DO NOTHING
          RETURNING session_id`.execute(db)).rows.map((row) => row.session_id);
        if (affectedSessions.length) await sql`UPDATE campus_event_sessions
          SET revision=revision+1,updated_at=now()
          WHERE event_id=${event.id}::uuid AND id=ANY(${affectedSessions}::uuid[])`.execute(db);
      }
      await this.audit(db, req, "campus_event.rsvp_changed", event.school_id, event.id, { student_id: input.student_id, previous_status: before.rsvp_status, new_status: input.status });
      await this.enqueue(db, event, "rsvp", `campus-event:${event.id}:rsvp:${input.student_id}:${input.idempotency_key}`);
      const actor = await this.access(db, req.authUser, event);
      const result = await this.dto(db, req.authUser, event, actor);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "rsvp", requestHash, result);
      return result;
    });
  }

  async consent(req: AuthenticatedRequest, eventValue: string, body: unknown) {
    const eventId = uuid.parse(eventValue), input = consentSchema.parse(body), requestHash = hash({ eventId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.eventRow(db, input.school_id, eventId, true);
      if (!event.requires_guardian_consent) throw new BadRequestException("This event does not require guardian consent.");
      const family = await this.familyParticipant(db, req.authUser, event, input.student_id, true);
      const prior = await this.priorCommand<CampusEventDto>(db, input.school_id, req.authUser.id, input.idempotency_key, "consent", requestHash);
      if (prior) return prior;
      this.ensureFamilyResponseOpen(event);
      const before = (await sql<{
        status: "granted" | "denied" | "withdrawn"; note: string; revision: number;
        relationship_id: string; authority_id: string;
      }>`
        SELECT status,note,revision,relationship_id,authority_id FROM campus_event_consents
        WHERE event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid FOR UPDATE
      `.execute(db)).rows[0];
      if ((before?.revision ?? 0) !== input.expected_revision) {
        throw new ConflictException("This consent decision changed. Reload the participant's current revision.");
      }
      const authority = input.status === "withdrawn"
        ? before && before.relationship_id === family.relationship_id
          ? (await sql<{ id: string }>`SELECT id FROM campus_event_consent_authorities
              WHERE school_id=${event.school_id}::uuid AND id=${before.authority_id}::uuid
                AND relationship_id=${family.relationship_id}::uuid FOR SHARE`.execute(db)).rows[0]
          : undefined
        : (await sql<{ id: string }>`
            SELECT authority.id FROM campus_event_consent_authorities authority
            JOIN schools school ON school.id=authority.school_id
            WHERE authority.school_id=${event.school_id}::uuid AND authority.relationship_id=${family.relationship_id}::uuid
              AND (now() AT TIME ZONE school.timezone)::date
                BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
              AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
                BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
              AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
                WHERE revocation.authority_id=authority.id)
            FOR SHARE OF authority
          `.execute(db)).rows[0];
      if (!authority) {
        if (input.status === "withdrawn") throw new ForbiddenException("Only the guardian relationship that recorded this consent can withdraw it.");
        throw new ForbiddenException("This guardian relationship has no active, reviewed authority for event consent.");
      }
      const revision = input.expected_revision + 1;
      await sql`
        INSERT INTO campus_event_consents(school_id,event_id,student_id,relationship_id,authority_id,status,note,decided_by,revision)
        VALUES(${event.school_id}::uuid,${event.id}::uuid,${input.student_id}::uuid,${family.relationship_id}::uuid,
          ${authority.id}::uuid,${input.status},${input.note},${req.authUser.id}::uuid,${revision})
        ON CONFLICT(event_id,student_id) DO UPDATE SET relationship_id=EXCLUDED.relationship_id,authority_id=EXCLUDED.authority_id,
          status=EXCLUDED.status,note=EXCLUDED.note,decided_by=EXCLUDED.decided_by,decided_at=now(),revision=EXCLUDED.revision
      `.execute(db);
      await sql`INSERT INTO campus_event_consent_revisions(school_id,event_id,student_id,relationship_id,authority_id,
        previous_status,new_status,previous_note,new_note,revision,decided_by,request_id)
        VALUES(${event.school_id}::uuid,${event.id}::uuid,${input.student_id}::uuid,${family.relationship_id}::uuid,
          ${authority.id}::uuid,${before?.status ?? null},${input.status},${before?.note ?? null},${input.note},${revision},
          ${req.authUser.id}::uuid,${req.requestId}::uuid)`.execute(db);
      await this.audit(db, req, "campus_event.consent_changed", event.school_id, event.id, { student_id: input.student_id, revision, status: input.status, authority_id: authority.id });
      await this.enqueue(db, event, "consent", `campus-event:${event.id}:consent:${input.student_id}:${revision}`);
      const actor = await this.access(db, req.authUser, event);
      const result = await this.dto(db, req.authUser, event, actor);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "consent", requestHash, result);
      return result;
    });
  }

  async checklist(req: AuthenticatedRequest, eventValue: string, itemValue: string, body: unknown) {
    const eventId = uuid.parse(eventValue), itemId = uuid.parse(itemValue), input = checklistCompletionSchema.parse(body);
    const requestHash = hash({ eventId, itemId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.eventRow(db, input.school_id, eventId, true);
      await this.familyParticipant(db, req.authUser, event, input.student_id);
      const item = (await sql<{ id: string }>`SELECT id FROM campus_event_checklist_items WHERE school_id=${event.school_id}::uuid AND event_id=${event.id}::uuid AND id=${itemId}::uuid`.execute(db)).rows[0];
      if (!item) throw new NotFoundException("Event checklist item not found.");
      const prior = await this.priorCommand<CampusEventDto>(db, input.school_id, req.authUser.id, input.idempotency_key, "checklist", requestHash);
      if (prior) return prior;
      this.ensureFamilyResponseOpen(event);
      if (input.completed) await sql`INSERT INTO campus_event_checklist_completions(school_id,event_id,item_id,student_id,completed_by)
        VALUES(${event.school_id}::uuid,${event.id}::uuid,${itemId}::uuid,${input.student_id}::uuid,${req.authUser.id}::uuid)
        ON CONFLICT(item_id,student_id) DO UPDATE SET completed_by=EXCLUDED.completed_by,completed_at=now()`.execute(db);
      else await sql`DELETE FROM campus_event_checklist_completions WHERE item_id=${itemId}::uuid AND student_id=${input.student_id}::uuid`.execute(db);
      await this.audit(db, req, "campus_event.checklist_changed", event.school_id, event.id, { student_id: input.student_id, item_id: itemId, completed: input.completed });
      await this.enqueue(db, event, "checklist", `campus-event:${event.id}:checklist:${itemId}:${input.student_id}:${input.idempotency_key}`);
      const actor = await this.access(db, req.authUser, event);
      const result = await this.dto(db, req.authUser, event, actor);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "checklist", requestHash, result);
      return result;
    });
  }

  private async sessionContext(db: Db, user: AuthUser, schoolId: string, eventId: string, sessionId: string, lock = false) {
    const event = await this.eventRow(db, schoolId, eventId, lock);
    const actor = await this.access(db, user, event, lock);
    const session = (await sql<{
      id: string; title: string; session_type: "general" | "rehearsal" | "departure" | "activity" | "return";
      starts_at: Date; ends_at: Date; attendance_mode: "none" | "check_in" | "check_in_out";
      state: "open" | "locked"; revision: number;
    }>`SELECT id,title,session_type,starts_at,ends_at,attendance_mode,state,revision FROM campus_event_sessions
      WHERE school_id=${schoolId}::uuid AND event_id=${eventId}::uuid AND id=${sessionId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(db)).rows[0];
    if (!session) throw new NotFoundException("Event session not found.");
    return { event, actor, session };
  }

  private canTake(actor: ActorAccess) { return actor.role === "admin" || actor.attendanceAssigned || actor.ownsClassTest; }

  private attendanceDisabledReason(
    event: EventRow,
    actor: ActorAccess,
    session: { attendance_mode: "none" | "check_in" | "check_in_out"; state: "open" | "locked"; starts_at: Date; ends_at: Date },
  ) {
    if (event.status !== "published") return "event_not_published";
    if (session.attendance_mode === "none") return "attendance_not_enabled";
    if (session.state !== "open") return "register_locked";
    if (!this.canTake(actor)) return "not_attendance_taker";
    const now = Date.now();
    if (now < new Date(session.starts_at).getTime() - 2 * 60 * 60 * 1000) return "attendance_window_not_open";
    if (actor.role !== "admin" && now > new Date(session.ends_at).getTime() + 24 * 60 * 60 * 1000) {
      return "outside_attendance_window";
    }
    return null;
  }

  private lockDisabledReason(
    event: EventRow,
    actor: ActorAccess,
    session: { attendance_mode: "none" | "check_in" | "check_in_out"; state: "open" | "locked"; starts_at: Date; ends_at: Date },
    statuses: AttendanceValue[],
  ) {
    if (event.status !== "published") return "event_not_published";
    if (session.attendance_mode === "none") return "attendance_not_enabled";
    if (session.state !== "open") return "register_locked";
    if (!this.canTake(actor)) return "not_attendance_taker";
    const now = Date.now();
    const endsAt = new Date(session.ends_at).getTime();
    if (now < endsAt) return "session_not_ended";
    if (actor.role !== "admin" && now > endsAt + 24 * 60 * 60 * 1000) return "lock_window_closed";
    if (statuses.includes("not_recorded")) return "attendance_incomplete";
    if (session.attendance_mode === "check_in_out" && statuses.some((status) => status === "present" || status === "late")) {
      return "checkout_incomplete";
    }
    return null;
  }

  async roster(user: AuthUser, eventValue: string, sessionValue: string, schoolValue: string) {
    const eventId = uuid.parse(eventValue), sessionId = uuid.parse(sessionValue), schoolId = uuid.parse(schoolValue);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async (db) => {
      const { event, actor, session } = await this.sessionContext(db, user, schoolId, eventId, sessionId);
      if (!(actor.role === "admin" || actor.assigned || actor.ownsClassTest)) {
        throw new NotFoundException("Event register not found or no longer accessible.");
      }
      const rows = (await sql<{
        student_id: string; student_name: string; admission_number: string; avatar_url: string;
        participation_requirement: "optional" | "mandatory"; rsvp_status: "pending" | "accepted" | "declined";
        consent_status: "pending" | "granted" | "denied" | "withdrawn";
        consent_readiness: "not_required" | "ready" | "authority_missing" | "authority_expired";
        consent_required: boolean; consent_effective: boolean; checklist_ready: boolean;
        payment_status: "not_required" | "pending" | "paid"; payment_amount_paise: number; payment_paid_paise: number;
        fee_invoice_id: string | null;
        attendance_status: AttendanceValue; note: string; record_revision: number;
        readiness_contradiction_note: string | null; checked_in_at: Date | null; checked_out_at: Date | null;
      }>`
        SELECT roster.student_id,concat_ws(' ',person.first_name,person.last_name) AS student_name,
          student.admission_number,COALESCE(student.avatar_url,'') AS avatar_url,
          roster.participation_requirement,participant.rsvp_status,
          ${event.requires_guardian_consent}::boolean AS consent_required,
          CASE WHEN consent.event_id IS NOT NULL AND decision_authority.id IS NOT NULL THEN consent.status ELSE 'pending' END AS consent_status,
          (NOT ${event.requires_guardian_consent} OR (consent.status='granted' AND decision_authority.id IS NOT NULL)) AS consent_effective,
          CASE WHEN NOT ${event.requires_guardian_consent} THEN 'not_required'
            WHEN EXISTS(SELECT 1 FROM guardian_relationships relationship
              JOIN campus_event_consent_authorities authority ON authority.relationship_id=relationship.id
                AND authority.school_id=relationship.school_id
              JOIN schools school ON school.id=authority.school_id
              WHERE relationship.student_id=roster.student_id
                AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
                  BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
                AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
                  WHERE revocation.authority_id=authority.id
                    AND revocation.revoked_at<=${event.starts_at}::timestamptz)) THEN 'ready'
            WHEN EXISTS(SELECT 1 FROM guardian_relationships relationship
              JOIN campus_event_consent_authorities authority ON authority.relationship_id=relationship.id
                AND authority.school_id=relationship.school_id WHERE relationship.student_id=roster.student_id) THEN 'authority_expired'
            ELSE 'authority_missing' END AS consent_readiness,
          NOT EXISTS(SELECT 1 FROM campus_event_checklist_items required_item
            WHERE required_item.event_id=participant.event_id AND required_item.required
              AND NOT EXISTS(SELECT 1 FROM campus_event_checklist_completions completion
                WHERE completion.item_id=required_item.id AND completion.student_id=roster.student_id)) AS checklist_ready,
          CASE WHEN invoice.id IS NULL THEN 'not_required'
            WHEN COALESCE(payment.paid_paise,0)>=invoice.amount_paise THEN 'paid' ELSE 'pending' END AS payment_status,
          COALESCE(invoice.amount_paise,0)::int AS payment_amount_paise,
          COALESCE(payment.paid_paise,0)::int AS payment_paid_paise,invoice.id AS fee_invoice_id,
          COALESCE(record.status,'not_recorded') AS attendance_status,COALESCE(record.note,'') AS note,
          COALESCE(record.revision,0) AS record_revision,record.readiness_contradiction_note,
          record.checked_in_at,record.checked_out_at
        FROM campus_event_session_participants roster
        JOIN campus_event_participants participant ON participant.event_id=roster.event_id AND participant.student_id=roster.student_id
        JOIN students student ON student.id=roster.student_id
        JOIN school_people person ON person.id=student.person_id
        LEFT JOIN campus_event_consents consent ON consent.event_id=participant.event_id AND consent.student_id=participant.student_id
        LEFT JOIN campus_event_consent_authorities decision_authority ON decision_authority.id=consent.authority_id
          AND (consent.decided_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=roster.school_id))::date
            BETWEEN decision_authority.valid_from AND COALESCE(decision_authority.valid_until,'infinity'::date)
          AND (${event.starts_at}::timestamptz AT TIME ZONE (SELECT timezone FROM schools WHERE id=roster.school_id))::date
            BETWEEN decision_authority.valid_from AND COALESCE(decision_authority.valid_until,'infinity'::date)
          AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations decision_revocation
            WHERE decision_revocation.authority_id=decision_authority.id
              AND decision_revocation.revoked_at<=${event.starts_at}::timestamptz)
        LEFT JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
        LEFT JOIN LATERAL (SELECT COALESCE(sum(fee_payment.amount_paise),0)::int AS paid_paise
          FROM fee_payments fee_payment WHERE fee_payment.invoice_id=invoice.id) payment ON true
        LEFT JOIN campus_event_attendance_records record ON record.event_id=participant.event_id
          AND record.session_id=roster.session_id AND record.student_id=roster.student_id
        WHERE roster.event_id=${event.id}::uuid AND roster.session_id=${session.id}::uuid
        ORDER BY student_name,student.admission_number,roster.student_id
      `.execute(db)).rows;
      const count = (value: AttendanceValue) => rows.filter((row) => row.attendance_status === value).length;
      const recorded = rows.filter((row) => row.attendance_status !== "not_recorded").length;
      const attendanceDisabledReason = this.attendanceDisabledReason(event, actor, session);
      const lockDisabledReason = this.lockDisabledReason(event, actor, session, rows.map((row) => row.attendance_status));
      const canViewFinanceDetails = actor.financeGranted;
      return {
        event: { id: event.id, title: event.title, status: event.status },
        session: { id: session.id, title: session.title, session_type: session.session_type, starts_at: iso(session.starts_at)!, ends_at: iso(session.ends_at)!, attendance_mode: session.attendance_mode, state: session.state, revision: session.revision },
        counts: { participants: rows.length, recorded, not_recorded: rows.length - recorded, present: count("present"), late: count("late"), excused: count("excused"), no_show: count("no_show"), checked_out: count("checked_out") },
        rows: rows.map((row) => ({
          ...row,
          participation_ready: row.consent_effective && row.checklist_ready,
          readiness_blockers: [
            ...(!row.consent_effective ? ["guardian_consent" as const] : []),
            ...(!row.checklist_ready ? ["required_checklist" as const] : []),
          ],
          payment_status: canViewFinanceDetails ? row.payment_status : "not_required",
          payment_amount_paise: canViewFinanceDetails ? row.payment_amount_paise : 0,
          payment_paid_paise: canViewFinanceDetails ? row.payment_paid_paise : 0,
          fee_invoice_id: canViewFinanceDetails ? row.fee_invoice_id : null,
        })),
        permissions: {
          can_take_attendance: attendanceDisabledReason === null,
          attendance_disabled_reason: attendanceDisabledReason,
          can_lock: lockDisabledReason === null,
          lock_disabled_reason: lockDisabledReason,
          can_reopen: actor.role === "admin" && event.status === "published" && session.attendance_mode !== "none" && session.state === "locked",
          can_view_finance_details: canViewFinanceDetails,
        },
      };
    });
  }

  async history(user: AuthUser, eventValue: string, sessionValue: string, schoolValue: string) {
    const eventId = uuid.parse(eventValue), sessionId = uuid.parse(sessionValue), schoolId = uuid.parse(schoolValue);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async (db) => {
      const { event, actor, session } = await this.sessionContext(db, user, schoolId, eventId, sessionId);
      if (!(actor.role === "admin" || actor.assigned || actor.ownsClassTest)) {
        throw new NotFoundException("Event attendance history not found or no longer accessible.");
      }
      const items = (await sql<{
        id: number; student_id: string; student_name: string; revision: number;
        previous_status: AttendanceValue | null; new_status: AttendanceValue;
        previous_note: string | null; new_note: string;
        previous_readiness_contradiction_note: string | null; new_readiness_contradiction_note: string | null;
        previous_checked_in_at: Date | null; new_checked_in_at: Date | null;
        previous_checked_out_at: Date | null; new_checked_out_at: Date | null;
        reason: string; changed_by: string; changed_by_name: string; created_at: Date;
      }>`
        SELECT history.id,history.student_id,concat_ws(' ',person.first_name,person.last_name) AS student_name,
          history.revision,history.previous_status,history.new_status,history.previous_note,history.new_note,
          history.previous_readiness_contradiction_note,history.new_readiness_contradiction_note,
          history.previous_checked_in_at,history.new_checked_in_at,
          history.previous_checked_out_at,history.new_checked_out_at,
          history.reason,history.changed_by,concat_ws(' ',actor.first_name,actor.last_name) AS changed_by_name,
          history.created_at
        FROM campus_event_attendance_revisions history
        JOIN students student ON student.id=history.student_id
        JOIN school_people person ON person.id=student.person_id
        JOIN users actor ON actor.id=history.changed_by
        WHERE history.school_id=${schoolId}::uuid AND history.event_id=${event.id}::uuid
          AND history.session_id=${session.id}::uuid
        ORDER BY history.id DESC LIMIT 500
      `.execute(db)).rows.map((row) => ({
        ...row,
        previous_checked_in_at: iso(row.previous_checked_in_at),
        new_checked_in_at: iso(row.new_checked_in_at),
        previous_checked_out_at: iso(row.previous_checked_out_at),
        new_checked_out_at: iso(row.new_checked_out_at),
        created_at: iso(row.created_at)!,
      }));
      return {
        event: { id: event.id, title: event.title },
        session: { id: session.id, title: session.title },
        items,
      };
    });
  }

  async attendance(req: AuthenticatedRequest, eventValue: string, sessionValue: string, body: unknown) {
    const eventId = uuid.parse(eventValue), sessionId = uuid.parse(sessionValue), input = attendanceCommandSchema.parse(body);
    const requestHash = hash({ eventId, sessionId, input });
    await this.db.transaction().execute(async (db) => {
      const { event, actor, session } = await this.sessionContext(db, req.authUser, input.school_id, eventId, sessionId, true);
      if (!this.canTake(actor)) throw new ForbiddenException("You are not assigned to this event register.");
      const prior = await this.priorCommand<unknown>(db, input.school_id, req.authUser.id, input.idempotency_key, "attendance", requestHash);
      if (prior) return prior;
      if (event.status !== "published" || session.attendance_mode === "none") throw new ConflictException("Attendance is unavailable for this event session.");
      if (session.state !== "open") throw new ConflictException("Reopen this locked event register before correcting it.");
      if (session.revision !== input.expected_revision) throw new ConflictException("This event register changed. Reload its current revision.");
      const now = new Date();
      if (now.getTime() < new Date(session.starts_at).getTime() - 2 * 60 * 60 * 1000) {
        throw new ForbiddenException("Event attendance cannot be recorded before the session check-in window opens.");
      }
      if (actor.role !== "admin" && now.getTime() > new Date(session.ends_at).getTime() + 24 * 60 * 60 * 1000) {
        throw new ForbiddenException("Assigned staff can record attendance from two hours before this session until 24 hours after it ends.");
      }
      const participantRows = (await sql<{
        student_id: string;
        participation_requirement: "optional" | "mandatory";
        rsvp_status: "pending" | "accepted" | "declined";
        consent_effective: boolean;
        checklist_ready: boolean;
      }>`
        SELECT roster.student_id,roster.participation_requirement,participant.rsvp_status,
          (NOT ${event.requires_guardian_consent} OR EXISTS(
            SELECT 1 FROM campus_event_consents consent
            JOIN campus_event_consent_authorities authority ON authority.id=consent.authority_id
            JOIN schools school ON school.id=authority.school_id
            WHERE consent.event_id=roster.event_id AND consent.student_id=roster.student_id
              AND consent.status='granted'
              AND (consent.decided_at AT TIME ZONE school.timezone)::date
                BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
              AND (${event.starts_at}::timestamptz AT TIME ZONE school.timezone)::date
                BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
              AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
                WHERE revocation.authority_id=authority.id AND revocation.revoked_at<=${event.starts_at}::timestamptz)
          )) AS consent_effective,
          NOT EXISTS(SELECT 1 FROM campus_event_checklist_items required_item
            WHERE required_item.event_id=roster.event_id AND required_item.required
              AND NOT EXISTS(SELECT 1 FROM campus_event_checklist_completions completion
                WHERE completion.item_id=required_item.id AND completion.student_id=roster.student_id)) AS checklist_ready
        FROM campus_event_session_participants roster
        JOIN campus_event_participants participant ON participant.event_id=roster.event_id
          AND participant.student_id=roster.student_id
        WHERE roster.event_id=${event.id}::uuid AND roster.session_id=${session.id}::uuid
          AND roster.student_id=ANY(${input.records.map((row) => row.student_id)}::uuid[])
      `.execute(db)).rows;
      if (participantRows.length !== input.records.length) throw new BadRequestException("Every attendance row must belong to this session roster.");
      const eligibility = new Map(participantRows.map((row) => [row.student_id, row]));
      const existingRows = (await sql<{
        id: string; student_id: string; status: AttendanceValue; note: string; revision: number;
        readiness_contradiction_note: string | null; checked_in_at: Date | null; checked_out_at: Date | null;
      }>`SELECT id,student_id,status,note,revision,readiness_contradiction_note,checked_in_at,checked_out_at FROM campus_event_attendance_records
        WHERE session_id=${session.id}::uuid AND student_id=ANY(${input.records.map((row) => row.student_id)}::uuid[]) FOR UPDATE`.execute(db)).rows;
      const existing = new Map(existingRows.map((row) => [row.student_id, row]));
      const changes = input.records.filter((row) => {
        const before = existing.get(row.student_id);
        if (!before) return row.status !== "not_recorded";
        const previousObserved = row.status === "checked_out" ? before.checked_out_at
          : row.status === "present" || row.status === "late" ? before.checked_in_at : null;
        const nextObserved = row.observed_at ? new Date(row.observed_at) : null;
        return before.status !== row.status || before.note !== row.note
          || before.readiness_contradiction_note !== row.readiness_contradiction_note
          || (previousObserved?.getTime() ?? null) !== (nextObserved?.getTime() ?? null);
      });
      if (changes.some((row) => existing.has(row.student_id)) && (!input.reason || input.reason.trim().length < 3)) {
        throw new BadRequestException("Explain every attendance correction or clear action.");
      }
      for (const row of changes) {
        const before = existing.get(row.student_id);
        const participant = eligibility.get(row.student_id)!;
        const participationReady = participant.consent_effective && participant.checklist_ready;
        const physical = row.status === "present" || row.status === "late" || row.status === "checked_out";
        const observedAt = row.observed_at ? new Date(row.observed_at) : null;
        if (observedAt && observedAt.getTime() > now.getTime()) {
          throw new BadRequestException("An event attendance observation cannot be in the future.");
        }
        if (observedAt && (
          observedAt.getTime() < new Date(session.starts_at).getTime() - 2 * 60 * 60 * 1000
          || observedAt.getTime() > new Date(session.ends_at).getTime() + 4 * 60 * 60 * 1000
        )) {
          throw new BadRequestException("The attendance observation must fall between two hours before and four hours after this session.");
        }
        if (row.status === "no_show" && (
          !(participant.participation_requirement === "mandatory"
            || participant.participation_requirement === "optional" && participant.rsvp_status === "accepted")
          || now < new Date(session.ends_at) || !participationReady
        )) {
          throw new BadRequestException("No-show requires an expected participant with complete consent/readiness, and can only be recorded after the session ends.");
        }
        if (physical && !participationReady && !row.readiness_contradiction_note) {
          throw new BadRequestException("Record a readiness contradiction note when a participant is physically observed without complete consent/readiness.");
        }
        if (row.status === "late" && observedAt! < new Date(session.starts_at)) {
          throw new BadRequestException("A participant cannot be observed late before the session starts.");
        }
        if (row.status === "checked_out" && (
          session.attendance_mode !== "check_in_out"
          || !before?.checked_in_at
          || !new Set<AttendanceValue>(["present", "late", "checked_out"]).has(before.status)
        )) {
          throw new BadRequestException("Check-out requires an earlier present or late check-in in a check-in/out session.");
        }
        if (row.status === "checked_out" && observedAt! < before!.checked_in_at!) {
          throw new BadRequestException("Check-out observation time cannot precede check-in.");
        }
        const checkedIn = row.status === "present" || row.status === "late"
          ? observedAt
          : row.status === "checked_out" ? before!.checked_in_at : null;
        const checkedOut = row.status === "checked_out" ? observedAt : null;
        const record = before ? (await sql<{ id: string; revision: number }>`
          UPDATE campus_event_attendance_records SET status=${row.status},note=${row.note},
            readiness_contradiction_note=${row.readiness_contradiction_note},checked_in_at=${checkedIn},checked_out_at=${checkedOut},
            revision=revision+1,marked_by=${req.authUser.id}::uuid,marked_at=now(),updated_at=now()
          WHERE id=${before.id}::uuid RETURNING id,revision
        `.execute(db)).rows[0]! : (await sql<{ id: string; revision: number }>`
          INSERT INTO campus_event_attendance_records(school_id,event_id,session_id,student_id,status,note,
            readiness_contradiction_note,checked_in_at,checked_out_at,marked_by)
          VALUES(${event.school_id}::uuid,${event.id}::uuid,${session.id}::uuid,${row.student_id}::uuid,${row.status},${row.note},
            ${row.readiness_contradiction_note},${checkedIn},${checkedOut},${req.authUser.id}::uuid)
          RETURNING id,revision
        `.execute(db)).rows[0]!;
        await sql`INSERT INTO campus_event_attendance_revisions(school_id,event_id,session_id,student_id,attendance_record_id,
          previous_status,new_status,previous_note,new_note,previous_readiness_contradiction_note,new_readiness_contradiction_note,
          previous_checked_in_at,new_checked_in_at,previous_checked_out_at,new_checked_out_at,
          reason,revision,changed_by,request_id)
          VALUES(${event.school_id}::uuid,${event.id}::uuid,${session.id}::uuid,${row.student_id}::uuid,${record.id}::uuid,
            ${before?.status ?? null},${row.status},${before?.note ?? null},${row.note},
            ${before?.readiness_contradiction_note ?? null},${row.readiness_contradiction_note},${before?.checked_in_at ?? null},${checkedIn},
            ${before?.checked_out_at ?? null},${checkedOut},${before ? input.reason! : "Initial event attendance mark."},${record.revision},
            ${req.authUser.id}::uuid,${req.requestId}::uuid)`.execute(db);
      }
      if (changes.length) await sql`UPDATE campus_event_sessions SET revision=revision+1,updated_at=now() WHERE id=${session.id}::uuid`.execute(db);
      const revision = changes.length ? session.revision + 1 : session.revision;
      await this.audit(db, req, "campus_event.attendance_saved", event.school_id, event.id, { session_id: session.id, revision, changed_count: changes.length });
      await this.enqueue(db, event, "attendance", `campus-event:${event.id}:session:${session.id}:attendance:${input.idempotency_key}`, undefined, { session_id: session.id, session_revision: revision });
      const result = { event_id: event.id, session_id: session.id, revision, changed_count: changes.length };
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "attendance", requestHash, result);
      return result;
    });
    return this.roster(req.authUser, eventId, sessionId, input.school_id);
  }

  async lock(req: AuthenticatedRequest, eventValue: string, sessionValue: string, body: unknown) {
    return this.sessionAction(req, eventValue, sessionValue, body, "lock");
  }
  async reopen(req: AuthenticatedRequest, eventValue: string, sessionValue: string, body: unknown) {
    return this.sessionAction(req, eventValue, sessionValue, body, "reopen");
  }

  private async sessionAction(req: AuthenticatedRequest, eventValue: string, sessionValue: string, body: unknown, operation: "lock" | "reopen") {
    const eventId = uuid.parse(eventValue), sessionId = uuid.parse(sessionValue);
    const input = operation === "lock" ? lockSessionSchema.parse(body) : reopenSessionSchema.parse(body);
    const requestHash = hash({ operation, eventId, sessionId, input });
    await this.db.transaction().execute(async (db) => {
      const { event, actor, session } = await this.sessionContext(db, req.authUser, input.school_id, eventId, sessionId, true);
      if (event.status !== "published" || session.attendance_mode === "none") throw new ConflictException("This session has no live event register.");
      if (operation === "lock" && !this.canTake(actor)) throw new ForbiddenException("You are not assigned to lock this event register.");
      if (operation === "reopen" && actor.role !== "admin") throw new ForbiddenException("Only a school administrator can reopen a locked event register.");
      const prior = await this.priorCommand<unknown>(db, input.school_id, req.authUser.id, input.idempotency_key, operation, requestHash);
      if (prior) return prior;
      if (session.revision !== input.expected_revision) throw new ConflictException("This event register changed. Reload its current revision.");
      if (operation === "lock") {
        if (session.state !== "open") throw new ConflictException("This event register is already locked.");
        const statuses = (await sql<{ status: AttendanceValue }>`
          SELECT COALESCE(record.status,'not_recorded') AS status
          FROM campus_event_session_participants roster
          LEFT JOIN campus_event_attendance_records record
            ON record.session_id=roster.session_id AND record.student_id=roster.student_id
          WHERE roster.event_id=${event.id}::uuid AND roster.session_id=${session.id}::uuid
          ORDER BY roster.student_id
        `.execute(db)).rows.map((row) => row.status);
        const disabled = this.lockDisabledReason(event, actor, session, statuses);
        if (disabled) throw new ConflictException(`This event register cannot be locked (${disabled}).`);
        await sql`UPDATE campus_event_sessions SET state='locked',revision=revision+1,locked_by=${req.authUser.id}::uuid,
          locked_at=now(),lock_reason=${input.reason},updated_at=now() WHERE id=${session.id}::uuid`.execute(db);
      } else {
        if (session.state !== "locked") throw new ConflictException("This event register is already open.");
        await sql`UPDATE campus_event_sessions SET state='open',revision=revision+1,locked_by=NULL,locked_at=NULL,lock_reason=NULL,
          reopened_by=${req.authUser.id}::uuid,reopened_at=now(),reopen_reason=${input.reason},updated_at=now() WHERE id=${session.id}::uuid`.execute(db);
      }
      const revision = session.revision + 1;
      await this.audit(db, req, `campus_event.session_${operation}ed`, event.school_id, event.id, { session_id: session.id, revision, reason: input.reason });
      await this.enqueue(db, event, operation, `campus-event:${event.id}:session:${session.id}:${operation}:${revision}`, undefined, { session_id: session.id, session_revision: revision });
      const result = { event_id: event.id, session_id: session.id, state: operation === "lock" ? "locked" : "open", revision };
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, operation, requestHash, result);
      return result;
    });
    return this.roster(req.authUser, eventId, sessionId, input.school_id);
  }

  async consentAuthorities(user: AuthUser, schoolValue: string, studentValue: string) {
    const schoolId = uuid.parse(schoolValue), studentId = uuid.parse(studentValue);
    await this.requireAdmin(this.db, user, schoolId);
    return {
      items: (await sql`
        SELECT relationship.id AS relationship_id,relationship.authority_revision AS relationship_revision,
          concat_ws(' ',person.first_name,person.last_name) AS guardian_name,
          authority.id,
          CASE WHEN revocation.authority_id IS NOT NULL THEN 'revoked'
            WHEN authority.id IS NOT NULL THEN 'active' ELSE NULL END AS status,
          authority.valid_from,authority.valid_until,authority.source,authority.provenance,
          COALESCE(revocation.revision,authority.revision) AS revision,authority.granted_at,
          revocation.revoked_at,revocation.reason AS revocation_reason,
          CASE WHEN authority.id IS NOT NULL AND revocation.authority_id IS NULL
            AND (now() AT TIME ZONE school.timezone)::date
              BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
            THEN true ELSE false END AS effective
        FROM guardian_relationships relationship
        JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=relationship.guardian_id
        JOIN school_people person ON person.id=profile.person_id JOIN schools school ON school.id=relationship.school_id
        LEFT JOIN LATERAL (SELECT * FROM campus_event_consent_authorities candidate
          WHERE candidate.school_id=relationship.school_id AND candidate.relationship_id=relationship.id
          ORDER BY candidate.revision DESC,candidate.id DESC LIMIT 1) authority ON true
        LEFT JOIN campus_event_consent_authority_revocations revocation
          ON revocation.authority_id=authority.id
        WHERE relationship.school_id=${schoolId}::uuid AND relationship.student_id=${studentId}::uuid
        ORDER BY relationship.is_primary DESC,guardian_name,relationship.id
      `.execute(this.db)).rows,
    };
  }

  async grantConsentAuthority(req: AuthenticatedRequest, relationshipValue: string, body: unknown) {
    const relationshipId = uuid.parse(relationshipValue), input = grantConsentAuthoritySchema.parse(body);
    const requestHash = hash({ relationshipId, input });
    return this.db.transaction().execute(async (db) => {
      await this.requireAdmin(db, req.authUser, input.school_id, true);
      const relationship = (await sql<{ id: string; student_id: string }>`SELECT id,student_id FROM guardian_relationships
        WHERE school_id=${input.school_id}::uuid AND id=${relationshipId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!relationship) throw new NotFoundException("Guardian relationship not found in this school.");
      const prior = await this.priorCommand<unknown>(db, input.school_id, req.authUser.id, input.idempotency_key, "grant_consent_authority", requestHash);
      if (prior) return prior;
      const latestRevision = Number((await sql<{ revision: number }>`SELECT COALESCE(max(version),0)::int AS revision FROM (
        SELECT authority.revision AS version FROM campus_event_consent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid AND authority.relationship_id=${relationshipId}::uuid
        UNION ALL
        SELECT revocation.revision AS version FROM campus_event_consent_authority_revocations revocation
        WHERE revocation.school_id=${input.school_id}::uuid AND revocation.relationship_id=${relationshipId}::uuid
      ) lifecycle`.execute(db)).rows[0]!.revision);
      if (latestRevision !== input.expected_revision) throw new ConflictException("Event-consent authority changed. Reload before reviewing it again.");
      const unrevoked = (await sql<{ id: string }>`SELECT authority.id FROM campus_event_consent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid AND authority.relationship_id=${relationshipId}::uuid
          AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
            WHERE revocation.authority_id=authority.id)
        LIMIT 1`.execute(db)).rows[0];
      if (unrevoked) throw new ConflictException("An event-consent authority is already active. Revoke it before recording a replacement grant.");
      const schoolDate = (await sql<{ value: string }>`SELECT (now() AT TIME ZONE timezone)::date::text AS value FROM schools WHERE id=${input.school_id}::uuid`.execute(db)).rows[0]!.value;
      if (input.valid_from < schoolDate) throw new BadRequestException("A new event-consent grant cannot be backdated.");
      const authority = (await sql<{ id: string; revision: number }>`INSERT INTO campus_event_consent_authorities(
          school_id,relationship_id,valid_from,valid_until,source,provenance,revision,granted_by
        ) VALUES(
          ${input.school_id}::uuid,${relationshipId}::uuid,${input.valid_from}::date,${input.valid_until}::date,
          'reviewed',${input.provenance},${latestRevision + 1},${req.authUser.id}::uuid
        ) RETURNING id,revision`.execute(db)).rows[0]!;
      await this.audit(db, req, "campus_event.consent_authority_granted", input.school_id, authority.id, {
        relationship_id: relationshipId, student_id: relationship.student_id, revision: authority.revision,
      }, "campus_event_consent_authority");
      await this.invalidateFutureConsentReadiness(db, input.school_id, relationship.student_id, authority.id, authority.revision);
      const result = { id: authority.id, relationship_id: relationshipId, student_id: relationship.student_id, status: "active", revision: authority.revision, valid_from: input.valid_from, valid_until: input.valid_until, provenance: input.provenance };
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "grant_consent_authority", requestHash, result);
      return result;
    });
  }

  async revokeConsentAuthority(req: AuthenticatedRequest, relationshipValue: string, body: unknown) {
    const relationshipId = uuid.parse(relationshipValue), input = revokeConsentAuthoritySchema.parse(body);
    const requestHash = hash({ relationshipId, input });
    return this.db.transaction().execute(async (db) => {
      await this.requireAdmin(db, req.authUser, input.school_id, true);
      const prior = await this.priorCommand<unknown>(db, input.school_id, req.authUser.id, input.idempotency_key, "revoke_consent_authority", requestHash);
      if (prior) return prior;
      const relationship = (await sql<{ student_id: string }>`SELECT student_id FROM guardian_relationships
        WHERE school_id=${input.school_id}::uuid AND id=${relationshipId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!relationship) throw new NotFoundException("Guardian relationship not found in this school.");
      const latestRevision = Number((await sql<{ revision: number }>`SELECT COALESCE(max(version),0)::int AS revision FROM (
        SELECT authority.revision AS version FROM campus_event_consent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid AND authority.relationship_id=${relationshipId}::uuid
        UNION ALL
        SELECT revocation.revision AS version FROM campus_event_consent_authority_revocations revocation
        WHERE revocation.school_id=${input.school_id}::uuid AND revocation.relationship_id=${relationshipId}::uuid
      ) lifecycle`.execute(db)).rows[0]!.revision);
      const current = (await sql<{ id: string }>`SELECT authority.id
        FROM campus_event_consent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid AND authority.relationship_id=${relationshipId}::uuid
          AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
            WHERE revocation.authority_id=authority.id)
        ORDER BY authority.revision DESC,authority.id DESC LIMIT 1`.execute(db)).rows[0];
      if (!current) throw new NotFoundException("No active event-consent authority exists for this guardian relationship.");
      if (latestRevision !== input.expected_revision) throw new ConflictException("Event-consent authority changed. Reload before revoking it.");
      const revision = latestRevision + 1;
      await sql`INSERT INTO campus_event_consent_authority_revocations(
          school_id,authority_id,relationship_id,revision,revoked_by,reason,request_id
        ) VALUES(
          ${input.school_id}::uuid,${current.id}::uuid,${relationshipId}::uuid,${revision},
          ${req.authUser.id}::uuid,${input.reason},${req.requestId}::uuid
        )`.execute(db);
      await this.audit(db, req, "campus_event.consent_authority_revoked", input.school_id, current.id, {
        relationship_id: relationshipId, student_id: relationship.student_id, revision, reason: input.reason,
      }, "campus_event_consent_authority");
      await this.invalidateFutureConsentReadiness(db, input.school_id, relationship.student_id, current.id, revision);
      const result = { id: current.id, relationship_id: relationshipId, student_id: relationship.student_id, status: "revoked", revision };
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "revoke_consent_authority", requestHash, result);
      return result;
    });
  }
}
