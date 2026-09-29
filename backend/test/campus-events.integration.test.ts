import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { CampusEventsService } from "../src/campus-events/campus-events.service.js";
import type { CampusEventDto } from "../src/campus-events/contracts.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const request = (user: AuthUser): AuthenticatedRequest => ({
  authUser: user,
  requestId: randomUUID(),
  sessionHash: "campus-event-integration",
  csrfToken: "campus-event-integration",
  protocol: "http",
  headers: { host: "localhost" },
  ip: "127.0.0.1",
} as AuthenticatedRequest);

describe.skipIf(!isolated)("campus event business rules", () => {
  let service: CampusEventsService;
  let schoolId: string;
  let classId: string;
  let subjectId: string;
  let validStart: string;
  let validEnd: string;
  let sundayStart: string;
  let sundayEnd: string;
  let teacher: AuthenticatedRequest;
  let classTeacher: AuthenticatedRequest;
  let unrelatedTeacher: AuthenticatedRequest;
  let principal: AuthenticatedRequest;
  let student: AuthenticatedRequest;
  let guardian: AuthenticatedRequest;
  let picnicDutyStaff: AuthenticatedRequest;
  let picnicAttendanceStaff: AuthenticatedRequest;
  let picnicId: string;
  let picnicSessionId: string;
  let aaravId: string;
  let rohanId: string;

  beforeAll(async () => {
    service = new CampusEventsService(new DatabaseService(), new SchoolEventService(new DatabaseService()));
    const context = (await pool.query<{
      school_id: string; class_id: string; subject_id: string;
      valid_start: Date; valid_end: Date; sunday_start: Date; sunday_end: Date;
    }>(`
      WITH context AS (
        SELECT school.id AS school_id,section.id AS class_id,subject.id AS subject_id,school.timezone,
          (now() AT TIME ZONE school.timezone)::date AS today
        FROM schools school
        JOIN class_sections section ON section.school_id=school.id AND section.grade='7' AND section.section='A'
        JOIN subjects subject ON subject.school_id=school.id AND subject.code='MAT'
        WHERE school.code='cis'
      ), valid_period AS (
        SELECT day::date AS value,schedule.starts_at,schedule.ends_at
        FROM context,
          LATERAL generate_series(context.today+1,context.today+120,interval '1 day') day,
          LATERAL effective_school_schedule(context.school_id,day::date) schedule
        WHERE schedule.class_section_id=context.class_id
          AND schedule.subject_id=context.subject_id
          AND schedule.slot_type='class' AND NOT schedule.cancelled
          AND NOT EXISTS(SELECT 1 FROM campus_events event
            WHERE event.school_id=context.school_id AND event.status='published'
              AND (event.audience_mode='school' OR EXISTS(
                SELECT 1 FROM campus_event_class_sections audience
                WHERE audience.event_id=event.id AND audience.class_section_id=context.class_id
              ))
              AND event.starts_at < ((day::date+schedule.ends_at) AT TIME ZONE context.timezone)
              AND event.ends_at > ((day::date+schedule.starts_at) AT TIME ZONE context.timezone))
        ORDER BY day,schedule.starts_at LIMIT 1
      ), sunday AS (
        SELECT day::date AS value FROM context,
          LATERAL generate_series(context.today+1,context.today+120,interval '1 day') day
        WHERE extract(isodow FROM day)=7 ORDER BY day LIMIT 1
      )
      SELECT context.school_id,context.class_id,context.subject_id,
        ((valid_period.value+valid_period.starts_at) AT TIME ZONE context.timezone) AS valid_start,
        ((valid_period.value+valid_period.ends_at) AT TIME ZONE context.timezone) AS valid_end,
        ((sunday.value+time '09:00') AT TIME ZONE context.timezone) AS sunday_start,
        ((sunday.value+time '09:45') AT TIME ZONE context.timezone) AS sunday_end
      FROM context,valid_period,sunday
    `)).rows[0]!;
    schoolId = context.school_id;
    classId = context.class_id;
    subjectId = context.subject_id;
    validStart = context.valid_start.toISOString();
    validEnd = context.valid_end.toISOString();
    sundayStart = context.sunday_start.toISOString();
    sundayEnd = context.sunday_end.toISOString();
    const users = (await pool.query<AuthUser & { username: string }>(`
      SELECT account.*, $1::uuid AS active_school_id FROM users account
      WHERE account.username IN (
        'kavita.staff','arjun.teacher','anil.sharma','meera.principal',
        'aarav.student','pooja.parent','vikram.singh','sunita.attendance','parent.cis0052'
      )
    `, [schoolId])).rows;
    teacher = request(users.find((user) => user.username === "kavita.staff")!);
    classTeacher = request(users.find((user) => user.username === "arjun.teacher")!);
    unrelatedTeacher = request(users.find((user) => user.username === "anil.sharma")!);
    principal = request(users.find((user) => user.username === "meera.principal")!);
    student = request(users.find((user) => user.username === "aarav.student")!);
    guardian = request(users.find((user) => user.username === "pooja.parent")!);
    picnicDutyStaff = request(users.find((user) => user.username === "vikram.singh")!);
    picnicAttendanceStaff = request(users.find((user) => user.username === "sunita.attendance")!);
    const eventContext = (await pool.query<{
      picnic_id: string; picnic_session_id: string; aarav_id: string; rohan_id: string;
    }>(`
      SELECT event.id AS picnic_id,
        (SELECT session.id FROM campus_event_sessions session WHERE session.event_id=event.id ORDER BY session.starts_at LIMIT 1) AS picnic_session_id,
        (SELECT student.id FROM students student JOIN users account ON account.id=student.user_id
          WHERE student.school_id=event.school_id AND account.username='aarav.student') AS aarav_id,
        (SELECT student.id FROM students student JOIN school_people person ON person.id=student.person_id
          WHERE student.school_id=event.school_id AND person.first_name='Rohan' AND person.last_name='Verma' LIMIT 1) AS rohan_id
      FROM campus_events event WHERE event.school_id=$1 AND event.event_type='excursion' LIMIT 1
    `, [schoolId])).rows[0]!;
    picnicId = eventContext.picnic_id;
    picnicSessionId = eventContext.picnic_session_id;
    aaravId = eventContext.aarav_id;
    rohanId = eventContext.rohan_id;
  });

  afterAll(async () => { await pool.end(); });

  function classTest(startsAt = validStart, endsAt = validEnd) {
    return {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "class_test",
      subject_id: subjectId,
      title: "Mathematics fractions check",
      description: "Fractions and decimals.",
      venue: "Room 204",
      starts_at: startsAt,
      ends_at: endsAt,
      audience: { mode: "class_sections", class_section_ids: [classId], student_ids: [] },
      participation_requirement: "mandatory",
      requires_rsvp: false,
      requires_guardian_consent: false,
      payment_required: false,
      payment_amount_paise: null,
      payment_due_on: null,
      payment_currency: "INR",
      sessions: [{
        title: "Unit test", session_type: "general", venue: "Room 204",
        starts_at: startsAt, ends_at: endsAt, attendance_mode: "check_in",
        participant_student_ids: [],
      }],
      checklist: [],
      staff: [],
    };
  }

  function editableEvent(event: CampusEventDto) {
    return {
      event_type: event.event_type,
      subject_id: event.subject_id,
      title: event.title,
      description: event.description,
      venue: event.venue,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      audience: event.audience,
      participation_requirement: event.participation_requirement,
      requires_rsvp: event.requires_rsvp,
      requires_guardian_consent: event.requires_guardian_consent,
      payment_required: event.payment_required,
      payment_amount_paise: event.payment_amount_paise,
      payment_due_on: event.payment_due_on,
      payment_currency: event.payment_currency,
      sessions: event.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        session_type: session.session_type,
        venue: session.venue,
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        attendance_mode: session.attendance_mode,
        participant_student_ids: session.participant_student_ids,
      })),
      checklist: event.checklist.map((item) => ({
        id: item.id,
        label: item.label,
        required: item.required,
      })),
      staff: event.staff.map((row) => ({ user_id: row.user_id, role: row.role })),
    };
  }

  it("allows the assigned Mathematics teacher while denying an unrelated teacher", async () => {
    await expect(service.create(unrelatedTeacher, classTest())).rejects.toThrow(/assigned class teacher|assigned subject teacher|school administrator/i);
    const academicBefore = Number((await pool.query("SELECT count(*)::text AS value FROM attendance_records")).rows[0].value);
    const created = await service.create(teacher, classTest());
    expect(created.event_type).toBe("class_test");
    expect(created.academic_attendance_impact).toBe("none");
    expect(created.permissions.can_publish).toBe(true);
    const academicAfter = Number((await pool.query("SELECT count(*)::text AS value FROM attendance_records")).rows[0].value);
    expect(academicAfter).toBe(academicBefore);
    await service.discard(teacher, created.id, {
      school_id: schoolId,
      expected_revision: created.revision,
      idempotency_key: randomUUID(),
    });

    const classTeacherCreated = await service.create(classTeacher, {
      ...classTest(),
      title: "Class-teacher scheduled Mathematics check",
      staff: [{ user_id: unrelatedTeacher.authUser.id, role: "duty_staff" }],
    });
    expect(classTeacherCreated.staff).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: classTeacher.authUser.id, role: "organizer" }),
      expect.objectContaining({ user_id: teacher.authUser.id, role: "attendance_taker" }),
    ]));
    expect(classTeacherCreated.staff.some((row) => row.user_id === unrelatedTeacher.authUser.id)).toBe(false);
    await service.discard(classTeacher, classTeacherCreated.id, {
      school_id: schoolId,
      expected_revision: classTeacherCreated.revision,
      idempotency_key: randomUUID(),
    });
  });

  it("rejects a class test on a non-instructional Sunday", async () => {
    await expect(service.create(teacher, classTest(sundayStart, sundayEnd))).rejects.toThrow(/instructional date/i);
  });

  it("rejects a class test outside its effective subject period", async () => {
    const outsideStart = new Date(Date.parse(validStart) - 5 * 60 * 1000).toISOString();
    await expect(service.create(teacher, classTest(outsideStart, validEnd))).rejects.toThrow(/effective period/i);
  });

  it("serializes overlapping class-test drafts so only one can be published", async () => {
    const firstDraft = await service.create(teacher, {
      ...classTest(),
      title: `Concurrent class test A ${randomUUID().slice(0, 8)}`,
    });
    const secondDraft = await service.create(teacher, {
      ...classTest(),
      title: `Concurrent class test B ${randomUUID().slice(0, 8)}`,
    });

    const results = await Promise.allSettled([
      service.publish(teacher, firstDraft.id, {
        school_id: schoolId,
        expected_revision: firstDraft.revision,
        idempotency_key: randomUUID(),
      }),
      service.publish(teacher, secondDraft.id, {
        school_id: schoolId,
        expected_revision: secondDraft.revision,
        idempotency_key: randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected?.reason as Error).message).toMatch(/another published campus event/i);

    const current = await pool.query<{ id: string; status: string; revision: number }>(`
      SELECT id,status,revision FROM campus_events WHERE id=ANY($1::uuid[]) ORDER BY id
    `, [[firstDraft.id, secondDraft.id]]);
    expect(current.rows.filter((row) => row.status === "published")).toHaveLength(1);
    expect(current.rows.filter((row) => row.status === "draft")).toHaveLength(1);
    const published = current.rows.find((row) => row.status === "published")!;
    const blockedDraft = current.rows.find((row) => row.status === "draft")!;
    await service.cancel(teacher, published.id, {
      school_id: schoolId,
      expected_revision: published.revision,
      idempotency_key: randomUUID(),
      internal_reason: "Concurrent publication invariant verified.",
      audience_notice: "This test event has been cancelled.",
    });
    await service.discard(teacher, blockedDraft.id, {
      school_id: schoolId,
      expected_revision: blockedDraft.revision,
      idempotency_key: randomUUID(),
    });
  });

  it("revalidates the teacher's dated class and subject authority at publication", async () => {
    const draft = await service.create(teacher, {
      ...classTest(),
      title: `Assignment revalidation ${randomUUID().slice(0, 8)}`,
    });
    const assignments = (await pool.query<{ id: string; valid_from: string; valid_until: string | null }>(`
      SELECT assignment.id,assignment.valid_from::text,assignment.valid_until::text
      FROM class_section_staff_assignments assignment
      WHERE assignment.school_id=$1 AND assignment.class_section_id=$2
        AND assignment.user_id=$3
        AND ((assignment.role='subject_teacher' AND assignment.subject_id=$4)
          OR assignment.role='class_teacher')
      ORDER BY assignment.id
    `, [schoolId, classId, teacher.authUser.id, subjectId])).rows;
    expect(assignments.length).toBeGreaterThan(0);
    const expiredOn = (await pool.query<{ value: string }>(`
      SELECT (($1::timestamptz AT TIME ZONE school.timezone)::date - 1)::text AS value
      FROM class_section_staff_assignments assignment
      JOIN schools school ON school.id=assignment.school_id
      WHERE assignment.id=$2
    `, [validStart, assignments[0]!.id])).rows[0]!.value;

    try {
      await pool.query(`
        UPDATE class_section_staff_assignments
        SET valid_from=LEAST(valid_from,$1::date),valid_until=$1::date
        WHERE id=ANY($2::uuid[])
      `, [expiredOn, assignments.map((row) => row.id)]);
      await expect(service.publish(teacher, draft.id, {
        school_id: schoolId,
        expected_revision: draft.revision,
        idempotency_key: randomUUID(),
      })).rejects.toThrow(/assigned class teacher|assigned subject teacher/i);
      expect((await pool.query<{ status: string }>(
        "SELECT status FROM campus_events WHERE id=$1",
        [draft.id],
      )).rows[0]?.status).toBe("draft");
    } finally {
      for (const assignment of assignments) {
        await pool.query(
          "UPDATE class_section_staff_assignments SET valid_from=$1::date,valid_until=$2::date WHERE id=$3",
          [assignment.valid_from, assignment.valid_until, assignment.id],
        );
      }
      const current = (await pool.query<{ status: string; revision: number }>(
        "SELECT status,revision FROM campus_events WHERE id=$1",
        [draft.id],
      )).rows[0];
      if (current?.status === "draft") {
        await service.discard(principal, draft.id, {
          school_id: schoolId,
          expected_revision: current.revision,
          idempotency_key: randomUUID(),
        });
      }
    }
  });

  it("keeps paid RSVP guardian-only and redacts fee details from ordinary event staff", async () => {
    await expect(service.rsvp(student, picnicId, {
      school_id: schoolId,
      student_id: aaravId,
      status: "accepted",
      expected_revision: 0,
      idempotency_key: randomUUID(),
    })).rejects.toThrow(/guardian must accept a paid event/i);

    const staffView = await service.detail(picnicDutyStaff.authUser, picnicId, schoolId);
    expect(staffView.permissions.can_view_finance_details).toBe(false);
    expect(staffView.viewer_participants.length).toBeGreaterThan(0);
    expect(staffView.viewer_participants.every((row) =>
      row.fee_invoice_id === null && row.payment_amount_paise === 0 && row.payment_paid_paise === 0
    )).toBe(true);
    const adminView = await service.detail(principal.authUser, picnicId, schoolId);
    expect(adminView.permissions.can_view_finance_details).toBe(true);
    expect(adminView.viewer_participants.some((row) => row.fee_invoice_id && row.payment_amount_paise > 0)).toBe(true);
  });

  it("projects only the selected family's child and keeps register locking separate from marking", async () => {
    const familyView = await service.detail(guardian.authUser, picnicId, schoolId, aaravId);
    expect(familyView.viewer_participants.map((row) => row.student_id)).toEqual([aaravId]);
    expect(familyView.staff).toEqual([]);
    expect(familyView.counts).toMatchObject({ participants: 1, rsvp_accepted: 1 });
    expect(familyView.sessions.every((session) =>
      session.participant_student_ids.every((studentId) => studentId === aaravId)
    )).toBe(true);
    expect(familyView.sessions.every((session) =>
      session.counts.recorded + session.counts.not_recorded <= 1
      && session.counts.present <= 1
      && session.counts.late <= 1
      && session.counts.excused <= 1
      && session.counts.no_show <= 1
      && session.counts.checked_out <= 1
    )).toBe(true);
    expect(familyView.sessions.every((session) =>
      session.viewer_attendance.length === 1
      && session.viewer_attendance[0]?.student_id === aaravId
      && session.viewer_attendance[0]?.expected === true
    )).toBe(true);
    const adminView = await service.detail(principal.authUser, picnicId, schoolId);
    expect(adminView.counts.participants).toBeGreaterThan(1);
    expect(adminView.staff.length).toBeGreaterThan(0);

    const register = await service.roster(picnicAttendanceStaff.authUser, picnicId, picnicSessionId, schoolId);
    expect(register.permissions.can_lock).toBe(false);
    expect(register.permissions.lock_disabled_reason).toBe("session_not_ended");
    expect(register.permissions.can_view_finance_details).toBe(false);
    expect(register.rows.every((row: { fee_invoice_id: string | null; payment_amount_paise: number; payment_paid_paise: number }) =>
      row.fee_invoice_id === null && row.payment_amount_paise === 0 && row.payment_paid_paise === 0
    )).toBe(true);
  });

  it("updates optimistic session revisions with optional RSVP roster changes without leaking the child id in SSE", async () => {
    const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const draft = await service.create(principal, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "workshop",
      subject_id: null,
      title: `Optional RSVP revision test ${randomUUID().slice(0, 8)}`,
      description: "Isolated integration coverage for accepted-only event registers.",
      venue: "Activity Studio",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience: { mode: "students", class_section_ids: [], student_ids: [rohanId] },
      participation_requirement: "optional",
      requires_rsvp: true,
      requires_guardian_consent: false,
      payment_required: false,
      payment_amount_paise: null,
      payment_due_on: null,
      payment_currency: "INR",
      sessions: [{
        title: "Workshop", session_type: "activity", venue: "Activity Studio",
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        attendance_mode: "check_in", participant_student_ids: [],
      }],
      checklist: [],
      staff: [],
    });
    const published = await service.publish(principal, draft.id, {
      school_id: schoolId,
      expected_revision: draft.revision,
      idempotency_key: randomUUID(),
    }) as CampusEventDto;
    const sessionId = published.sessions[0]!.id;
    expect(published.sessions[0]!.revision).toBe(1);
    expect(published.sessions[0]!.counts.not_recorded).toBe(0);

    const rohanGuardian = request((await pool.query<AuthUser>(`
      SELECT account.*,$1::uuid AS active_school_id
      FROM students student
      JOIN guardian_relationships relationship ON relationship.student_id=student.id
      JOIN parents parent ON parent.id=relationship.guardian_id
      JOIN users account ON account.id=parent.user_id
      WHERE student.id=$2
    `, [schoolId, rohanId])).rows[0]!);
    const accepted = await service.rsvp(rohanGuardian, draft.id, {
      school_id: schoolId,
      student_id: rohanId,
      status: "accepted",
      expected_revision: 0,
      idempotency_key: randomUUID(),
    });
    expect(accepted.sessions[0]!.revision).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS value FROM campus_event_session_participants WHERE session_id=$1", [sessionId])).rows[0].value).toBe(1);
    const payload = (await pool.query<{ payload: Record<string, unknown> }>(`
      SELECT payload FROM event_outbox
      WHERE aggregate_id=$1 AND payload->>'change_kind'='rsvp'
      ORDER BY created_at DESC LIMIT 1
    `, [draft.id])).rows[0]!.payload;
    expect(payload).not.toHaveProperty("student_id");

    const declined = await service.rsvp(rohanGuardian, draft.id, {
      school_id: schoolId,
      student_id: rohanId,
      status: "declined",
      expected_revision: 1,
      idempotency_key: randomUUID(),
    });
    expect(declined.sessions[0]!.revision).toBe(3);
    expect((await pool.query("SELECT count(*)::int AS value FROM campus_event_session_participants WHERE session_id=$1", [sessionId])).rows[0].value).toBe(0);
    await service.cancel(principal, draft.id, {
      school_id: schoolId,
      expected_revision: declined.revision,
      idempotency_key: randomUUID(),
      internal_reason: "Integration fixture complete.",
      audience_notice: "This integration event has been cancelled.",
    });
  });

  it("orders current and upcoming events before history and exposes a bounded stable cursor", async () => {
    const first = await service.list(principal.authUser, { school_id: schoolId, limit: "1" });
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).toBe(first.items[0]?.id);
    expect(Date.parse(first.items[0]!.ends_at)).toBeGreaterThanOrEqual(Date.now());

    const second = await service.list(principal.authUser, {
      school_id: schoolId,
      limit: "1",
      cursor: first.next_cursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await expect(service.list(principal.authUser, { school_id: schoolId, limit: "101" })).rejects.toThrow();
  });

  it("gives organizers bounded event management and reports required checklist readiness separately", async () => {
    const startsAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const draft = await service.create(principal, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "workshop",
      subject_id: null,
      title: `Organizer workflow ${randomUUID().slice(0, 8)}`,
      description: "A free preparation workshop managed by the assigned organizer.",
      venue: "Activity Studio",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience: { mode: "students", class_section_ids: [], student_ids: [aaravId] },
      participation_requirement: "mandatory",
      requires_rsvp: false,
      requires_guardian_consent: false,
      payment_required: false,
      payment_amount_paise: null,
      payment_due_on: null,
      payment_currency: "INR",
      sessions: [{
        title: "Workshop", session_type: "activity", venue: "Activity Studio",
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        attendance_mode: "none", participant_student_ids: [],
      }],
      checklist: [
        { label: "Signed activity sheet", required: true },
        { label: "Optional colour pencils", required: false },
      ],
      staff: [{ user_id: teacher.authUser.id, role: "organizer" }],
    });
    const organizerView = await service.detail(teacher.authUser, draft.id, schoolId);
    expect(organizerView.permissions).toMatchObject({
      can_edit: true, can_publish: true, can_cancel: false,
      can_manage_policy: false, can_manage_staff: false,
    });
    const saved = await service.save(teacher, draft.id, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      expected_revision: organizerView.revision,
      ...editableEvent({ ...organizerView, title: `${organizerView.title} · revised` }),
    });
    const published = await service.publish(teacher, draft.id, {
      school_id: schoolId,
      expected_revision: saved.revision,
      idempotency_key: randomUUID(),
    }) as CampusEventDto;
    expect(published.status).toBe("published");
    expect(published.permissions.can_cancel).toBe(false);

    const familyBefore = await service.detail(guardian.authUser, draft.id, schoolId, aaravId);
    expect(familyBefore.viewer_participants[0]).toMatchObject({
      checklist_completed: 0,
      checklist_total: 2,
      checklist_required: 1,
      checklist_required_completed: 0,
      checklist_ready: false,
    });
    expect(familyBefore.counts).toMatchObject({ checklist_ready: 0, checklist_required_items: 1 });
    const optional = published.checklist.find((item) => !item.required)!;
    const afterOptional = await service.checklist(guardian, draft.id, optional.id, {
      school_id: schoolId,
      student_id: aaravId,
      completed: true,
      idempotency_key: randomUUID(),
    });
    expect(afterOptional.viewer_participants[0]).toMatchObject({
      checklist_completed: 1,
      checklist_required_completed: 0,
      checklist_ready: false,
    });
    const required = published.checklist.find((item) => item.required)!;
    const afterRequired = await service.checklist(guardian, draft.id, required.id, {
      school_id: schoolId,
      student_id: aaravId,
      completed: true,
      idempotency_key: randomUUID(),
    });
    expect(afterRequired.viewer_participants[0]).toMatchObject({
      checklist_completed: 2,
      checklist_required_completed: 1,
      checklist_ready: true,
    });
    expect(afterRequired.counts.checklist_ready).toBe(1);
    await service.cancel(principal, draft.id, {
      school_id: schoolId,
      expected_revision: published.revision,
      idempotency_key: randomUUID(),
      internal_reason: "Integration fixture complete.",
      audience_notice: "This integration event has been cancelled.",
    });
  });

  it("keeps paid policy, staff authority, publication and cancellation under administrator control", async () => {
    const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const dueOn = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const draft = await service.create(principal, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "excursion",
      subject_id: null,
      title: `Paid organizer guard ${randomUUID().slice(0, 8)}`,
      description: "Paid-event authority boundary coverage.",
      venue: "City Museum",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience: { mode: "students", class_section_ids: [], student_ids: [aaravId] },
      participation_requirement: "optional",
      requires_rsvp: true,
      requires_guardian_consent: false,
      payment_required: true,
      payment_amount_paise: 25_000,
      payment_due_on: dueOn,
      payment_currency: "INR",
      sessions: [{
        title: "Museum visit", session_type: "activity", venue: "City Museum",
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        attendance_mode: "check_in_out", participant_student_ids: [],
      }],
      checklist: [],
      staff: [{ user_id: teacher.authUser.id, role: "organizer" }],
    });
    const organizerView = await service.detail(teacher.authUser, draft.id, schoolId);
    expect(organizerView.permissions).toMatchObject({
      can_edit: true, can_publish: false, can_cancel: false,
      can_manage_policy: false, can_manage_staff: false,
    });
    const safelySaved = await service.save(teacher, draft.id, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      expected_revision: organizerView.revision,
      ...editableEvent({ ...organizerView, description: "Organizer updated the operational brief." }),
    });
    await expect(service.save(teacher, draft.id, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      expected_revision: safelySaved.revision,
      ...editableEvent({ ...safelySaved, payment_amount_paise: safelySaved.payment_amount_paise! + 100 }),
    })).rejects.toThrow(/administrator review/i);
    await expect(service.save(teacher, draft.id, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      expected_revision: safelySaved.revision,
      ...editableEvent({ ...safelySaved, staff: safelySaved.staff.filter((row) => row.user_id === teacher.authUser.id) }),
    })).rejects.toThrow(/administrator can change event staff/i);
    await expect(service.publish(teacher, draft.id, {
      school_id: schoolId,
      expected_revision: safelySaved.revision,
      idempotency_key: randomUUID(),
    })).rejects.toThrow(/administrator must review and publish a paid event/i);
    await service.discard(principal, draft.id, {
      school_id: schoolId,
      expected_revision: safelySaved.revision,
      idempotency_key: randomUUID(),
    });
  });

  it("persists physical observation time separately from receipt time and preserves a reasoned clear revision", async () => {
    const startsAt = new Date(Date.now() + 30 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const draft = await service.create(principal, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "workshop",
      subject_id: null,
      title: `Observed attendance test ${randomUUID().slice(0, 8)}`,
      description: "Isolated integration coverage for observed and received timestamps.",
      venue: "Activity Studio",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience: { mode: "students", class_section_ids: [], student_ids: [aaravId] },
      participation_requirement: "mandatory",
      requires_rsvp: false,
      requires_guardian_consent: false,
      payment_required: false,
      payment_amount_paise: null,
      payment_due_on: null,
      payment_currency: "INR",
      sessions: [{
        title: "Workshop", session_type: "activity", venue: "Activity Studio",
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        attendance_mode: "check_in_out", participant_student_ids: [],
      }],
      checklist: [],
      staff: [],
    });
    const published = await service.publish(principal, draft.id, {
      school_id: schoolId,
      expected_revision: draft.revision,
      idempotency_key: randomUUID(),
    }) as CampusEventDto;
    const sessionId = published.sessions[0]!.id;
    const observedAt = new Date().toISOString();
    const marked = await service.attendance(request(principal.authUser), draft.id, sessionId, {
      school_id: schoolId,
      expected_revision: 1,
      idempotency_key: randomUUID(),
      records: [{ student_id: aaravId, status: "present", note: "", observed_at: observedAt }],
    });
    expect(marked.session.revision).toBe(2);
    expect(marked.rows.find((row) => row.student_id === aaravId)?.attendance_status).toBe("present");
    const stored = (await pool.query<{ status: string; checked_in_at: Date; marked_at: Date }>(`
      SELECT status,checked_in_at,marked_at FROM campus_event_attendance_records
      WHERE event_id=$1 AND session_id=$2 AND student_id=$3
    `, [draft.id, sessionId, aaravId])).rows[0]!;
    expect(stored.status).toBe("present");
    expect(stored.checked_in_at.toISOString()).toBe(observedAt);
    expect(stored.marked_at.getTime()).toBeGreaterThanOrEqual(new Date(observedAt).getTime());

    const checkedOutAt = new Date().toISOString();
    const checkedOut = await service.attendance(request(principal.authUser), draft.id, sessionId, {
      school_id: schoolId,
      expected_revision: 2,
      idempotency_key: randomUUID(),
      reason: "Recorded supervised departure.",
      records: [{ student_id: aaravId, status: "checked_out", note: "", observed_at: checkedOutAt }],
    });
    expect(checkedOut.session.revision).toBe(3);
    expect(checkedOut.rows.find((row) => row.student_id === aaravId)?.attendance_status).toBe("checked_out");
    const correctedCheckout = await service.attendance(request(principal.authUser), draft.id, sessionId, {
      school_id: schoolId,
      expected_revision: 3,
      idempotency_key: randomUUID(),
      reason: "Verified the recorded departure evidence.",
      records: [{ student_id: aaravId, status: "checked_out", note: "Departure verified", observed_at: checkedOutAt }],
    });
    expect(correctedCheckout.session.revision).toBe(4);

    const cleared = await service.attendance(request(principal.authUser), draft.id, sessionId, {
      school_id: schoolId,
      expected_revision: 4,
      idempotency_key: randomUUID(),
      reason: "Teacher cleared an accidental mark.",
      records: [{ student_id: aaravId, status: "not_recorded", note: "", observed_at: null }],
    });
    expect(cleared.session.revision).toBe(5);
    expect(cleared.rows.find((row) => row.student_id === aaravId)?.attendance_status).toBe("not_recorded");
    const history = await service.history(principal.authUser, draft.id, sessionId, schoolId);
    expect(history.items).toHaveLength(4);
    expect(history.items[0]).toMatchObject({
      previous_status: "checked_out",
      new_status: "not_recorded",
      reason: "Teacher cleared an accidental mark.",
      new_checked_in_at: null,
    });
    await service.cancel(principal, draft.id, {
      school_id: schoolId,
      expected_revision: published.revision,
      idempotency_key: randomUUID(),
      internal_reason: "Integration fixture complete.",
      audience_notice: "This integration event has been cancelled.",
    });
  });

  it("keeps event-consent grants and revocations append-only without rewriting historical decisions", async () => {
    const authorityContext = (await pool.query<{
      relationship_id: string; authority_id: string; authority_revision: number; school_date: string;
    }>(`
      SELECT relationship.id AS relationship_id,authority.id AS authority_id,
        authority.revision AS authority_revision,(now() AT TIME ZONE school.timezone)::date::text AS school_date
      FROM students student
      JOIN users account ON account.id=student.user_id AND account.username='aarav.student'
      JOIN guardian_relationships relationship ON relationship.school_id=student.school_id
        AND relationship.student_id=student.id
      JOIN parents parent ON parent.id=relationship.guardian_id
      JOIN users guardian_account ON guardian_account.id=parent.user_id AND guardian_account.username='pooja.parent'
      JOIN schools school ON school.id=student.school_id
      JOIN campus_event_consent_authorities authority ON authority.school_id=relationship.school_id
        AND authority.relationship_id=relationship.id
      WHERE student.school_id=$1
        AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
          WHERE revocation.authority_id=authority.id)
      ORDER BY authority.revision DESC LIMIT 1
    `, [schoolId])).rows[0]!;
    const initialRevision = authorityContext.authority_revision;
    expect(initialRevision).toBeGreaterThan(0);

    const revokeRequest = request(principal.authUser);
    const revoked = await service.revokeConsentAuthority(revokeRequest, authorityContext.relationship_id, {
      school_id: schoolId,
      expected_revision: initialRevision,
      idempotency_key: randomUUID(),
      reason: "Guardian consent authority reviewed and withdrawn.",
    }) as { id: string; revision: number; status: string };
    expect(revoked).toMatchObject({
      id: authorityContext.authority_id,
      revision: initialRevision + 1,
      status: "revoked",
    });

    const immutableGrant = (await pool.query<{
      status: string; revision: number; revoked_at: Date | null;
    }>("SELECT status,revision,revoked_at FROM campus_event_consent_authorities WHERE id=$1", [authorityContext.authority_id])).rows[0]!;
    expect(immutableGrant).toMatchObject({ status: "active", revision: initialRevision, revoked_at: null });
    expect((await pool.query<{ revision: number }>(
      "SELECT revision FROM campus_event_consent_authority_revocations WHERE authority_id=$1",
      [authorityContext.authority_id],
    )).rows[0]?.revision).toBe(initialRevision + 1);
    await expect(pool.query(
      "UPDATE campus_event_consent_authorities SET provenance='rewritten' WHERE id=$1",
      [authorityContext.authority_id],
    )).rejects.toThrow(/append-only/i);

    const invalidated = await service.detail(guardian.authUser, picnicId, schoolId, aaravId);
    expect(invalidated.viewer_participants[0]).toMatchObject({
      student_id: aaravId,
      consent_status: "pending",
      consent_readiness: "authority_expired",
    });
    expect((await pool.query<{ status: string; authority_id: string }>(
      "SELECT status,authority_id FROM campus_event_consents WHERE event_id=$1 AND student_id=$2",
      [picnicId, aaravId],
    )).rows[0]).toMatchObject({ status: "granted", authority_id: authorityContext.authority_id });

    const grantRequest = request(principal.authUser);
    const replacement = await service.grantConsentAuthority(grantRequest, authorityContext.relationship_id, {
      school_id: schoolId,
      expected_revision: initialRevision + 1,
      idempotency_key: randomUUID(),
      valid_from: authorityContext.school_date,
      valid_until: null,
      provenance: "Reviewed guardian authorization for school event consent.",
      verified: true,
    }) as { id: string; revision: number; status: string };
    expect(replacement.revision).toBe(initialRevision + 2);
    expect(replacement.id).not.toBe(authorityContext.authority_id);
    const beforeRenewedDecision = await service.detail(guardian.authUser, picnicId, schoolId, aaravId);
    expect(beforeRenewedDecision.viewer_participants[0]).toMatchObject({
      consent_status: "pending",
      consent_readiness: "ready",
    });

    const renewed = await service.consent(request(guardian.authUser), picnicId, {
      school_id: schoolId,
      student_id: aaravId,
      status: "granted",
      note: "Consent renewed after authority review.",
      expected_revision: beforeRenewedDecision.viewer_participants[0]!.consent_revision,
      idempotency_key: randomUUID(),
    });
    expect(renewed.viewer_participants[0]).toMatchObject({ consent_status: "granted", consent_readiness: "ready" });
    const auditTargets = (await pool.query<{ target_type: string }>(`
      SELECT target_type FROM audit_events
      WHERE action IN ('campus_event.consent_authority_granted','campus_event.consent_authority_revoked')
        AND request_id=ANY($1::uuid[])
    `, [[revokeRequest.requestId, grantRequest.requestId]])).rows;
    expect(auditTargets).toHaveLength(2);
    expect(auditTargets.every((row) => row.target_type === "campus_event_consent_authority")).toBe(true);
  });
});
