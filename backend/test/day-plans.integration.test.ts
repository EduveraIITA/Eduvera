import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import { DayPlanService } from "../src/day-plans/day-plan.service.js";
import { comparable, type PlanPeriod } from "../src/day-plans/contracts.js";
import {
  effectiveSchedule,
  protectPublishedPlans,
} from "../src/day-plans/schedule.js";
import type { AuthUser, AuthenticatedRequest } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const pool = new Pool({
  connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
  max: 3,
});
let db: DatabaseService,
  service: DayPlanService,
  school: SchoolService,
  schoolId: string,
  termId: string,
  classA: string,
  classB: string,
  studentId: string,
  studentUser: string,
  parentId: string,
  today: string;
let admin: AuthenticatedRequest,
  teacher: AuthenticatedRequest,
  other: AuthenticatedRequest,
  parent: AuthenticatedRequest,
  student: AuthenticatedRequest;
let offset = 1;
const request = (u: AuthUser) =>
  ({
    authUser: u,
    requestId: randomUUID(),
    protocol: "http",
    headers: { host: "localhost" },
    ip: "127.0.0.1",
  }) as AuthenticatedRequest;
const command = () => ({ school_id: schoolId, idempotency_key: randomUUID() });
function future() {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset++);
  return d.toISOString().slice(0, 10);
}
const detail = (id: string) => service.detail(admin.authUser, id, schoolId);
async function start(date = future(), classId = classA) {
  const result = await service.start(admin, {
    ...command(),
    class_section_id: classId,
    date,
  });
  return detail(result.id);
}
async function save(
  id: string,
  patch: Partial<PlanPeriod> = {},
  options: { notice?: string; reason?: string; all?: PlanPeriod[] } = {},
) {
  const p = await detail(id);
  return service.save(admin, id, {
    ...command(),
    expected_revision: p.revision,
    notice: options.notice ?? "Bring a graph notebook.",
    reason: options.reason ?? "Teacher coverage adjustment.",
    periods:
      options.all ??
      p.periods.map((r, i) => ({
        ...comparable(r),
        ...(i === 0 ? patch : {}),
      })),
  });
}
async function publish(id: string) {
  const p = await detail(id);
  return service.publish(admin, id, {
    ...command(),
    expected_revision: p.revision,
  });
}
beforeAll(async () => {
  db = new DatabaseService();
  const events = new SchoolEventService(db);
  school = new SchoolService(db, events);
  service = new DayPlanService(db, events, school);
  const users = (
    await pool.query<AuthUser>(
      "SELECT * FROM users WHERE username IN ('kavita.staff','pooja.parent','suresh.staff') OR role='admin' ORDER BY created_at",
    )
  ).rows;
  admin = request(users.find((u) => u.role === "admin")!);
  teacher = request(users.find((u) => u.username === "kavita.staff")!);
  parent = request(users.find((u) => u.username === "pooja.parent")!);
  const second = (
    await pool.query<AuthUser>(
      "SELECT * FROM users WHERE role='staff' AND id<>$1 LIMIT 1",
      [teacher.authUser.id],
    )
  ).rows[0]!;
  other = request(second);
  schoolId = (
    await pool.query(
      "INSERT INTO schools(name,code,timezone) VALUES('Day plan test school',$1,'Asia/Kolkata') RETURNING id",
      [`day-${randomUUID().slice(0, 10)}`],
    )
  ).rows[0].id;
  today = (
    await pool.query(
      "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today",
    )
  ).rows[0].today;
  termId = (
    await pool.query(
      "INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active) VALUES($1,'2026-27','Day plan term',$2::date-90,$2::date+90,85,true) RETURNING id",
      [schoolId, today],
    )
  ).rows[0].id;
  const classes = (
    await pool.query(
      "INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A'),($1,'2026-27','7','B') RETURNING id,section",
      [schoolId],
    )
  ).rows;
  classA = classes.find((c) => c.section === "A").id;
  classB = classes.find((c) => c.section === "B").id;
  await pool.query(
    "INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'staff'),($3,$5,'staff'),($4,$5,'guardian')",
    [
      admin.authUser.id,
      teacher.authUser.id,
      other.authUser.id,
      parent.authUser.id,
      schoolId,
    ],
  );
  await pool.query(
    "INSERT INTO timetable_slots(class_section_id,term_id,weekday,period_number,starts_at,ends_at,title,room,teacher_user_id) SELECT $1,$2,d,1,'09:00','09:45','Mathematics','Room A',$3 FROM generate_series(1,7) d",
    [classA, termId, teacher.authUser.id],
  );
  await pool.query(
    "INSERT INTO timetable_slots(class_section_id,term_id,weekday,period_number,starts_at,ends_at,title,room,teacher_user_id) SELECT $1,$2,d,1,'10:00','10:45','Science','Room B',$3 FROM generate_series(1,7) d",
    [classB, termId, other.authUser.id],
  );
  const u = (
    await pool.query<AuthUser>(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'!','Myra','Rao','student') RETURNING *",
      [`day-${randomUUID()}`, `day-${randomUUID()}@example.invalid`],
    )
  ).rows[0]!;
  studentUser = u.id;
  student = request(u);
  await pool.query(
    "INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'student')",
    [u.id, schoolId],
  );
  const person = (
    await pool.query(
      "INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Myra','Rao') RETURNING id",
      [schoolId],
    )
  ).rows[0].id;
  studentId = (
    await pool.query(
      "INSERT INTO students(user_id,person_id,school_id,admission_number) VALUES($1,$2,$3,'DAY-001') RETURNING id",
      [u.id, person, schoolId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4::date-30)",
    [studentId, classA, termId, today],
  );
  parentId = (
    await pool.query("SELECT id FROM parents WHERE user_id=$1", [
      parent.authUser.id,
    ])
  ).rows[0].id;
  const guardian = (
    await pool.query(
      "INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Pooja','Sharma') RETURNING id",
      [schoolId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)",
    [schoolId, parentId, guardian],
  );
  await pool.query(
    "INSERT INTO guardian_relationships(school_id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'mother')",
    [schoolId, studentId, parentId],
  );
});
afterAll(async () => {
  if (schoolId) {
    await pool.query(
      "DELETE FROM notifications WHERE metadata->>'school_id'=$1",
      [schoolId],
    );
    await pool.query("DELETE FROM day_plans WHERE school_id=$1", [schoolId]);
    await pool.query("DELETE FROM event_outbox WHERE school_id=$1", [schoolId]);
    await pool.query("DELETE FROM audit_events WHERE school_id=$1", [schoolId]);
    await pool.query("DELETE FROM guardian_relationships WHERE school_id=$1", [schoolId]);
    await pool.query("DELETE FROM students WHERE school_id=$1", [schoolId]);
    await pool.query(
      "DELETE FROM guardian_school_profiles WHERE school_id=$1",
      [schoolId],
    );
    await pool.query("DELETE FROM class_sections WHERE school_id=$1", [
      schoolId,
    ]);
    await pool.query("DELETE FROM academic_terms WHERE school_id=$1", [
      schoolId,
    ]);
    await pool.query("DELETE FROM school_people WHERE school_id=$1", [
      schoolId,
    ]);
    await pool.query("DELETE FROM schools WHERE id=$1", [schoolId]);
    if (studentUser)
      await pool.query("DELETE FROM users WHERE id=$1", [studentUser]);
  }
  await db?.destroy();
  await pool.end();
});
describe("Daily school plans", () => {
  it("prepares a resumable draft without changing the public weekly schedule", async () => {
    const p = await start();
    await save(p.id, { room: "Lab 2" });
    expect(
      (await effectiveSchedule(db, schoolId, p.date)).find(
        (r) => r.class_section_id === classA,
      )?.room,
    ).toBe("Room A");
    const again = await service.start(admin, {
      ...command(),
      class_section_id: classA,
      date: p.date,
    });
    expect(again.id).toBe(p.id);
    const event = (
      await pool.query(
        "SELECT audience_user_ids FROM event_outbox WHERE aggregate_id=$1 LIMIT 1",
        [p.id],
      )
    ).rows[0];
    expect(event.audience_user_ids).toEqual([admin.authUser.id]);
  });
  it("publishes shared Home/Timetable data, materials and scoped notifications atomically", async () => {
    const p = await start();
    await save(p.id, {
      room: "Lab 2",
      teacher_user_id: other.authUser.id,
      materials: ["Graph notebook", "Ruler"],
    });
    await publish(p.id);
    const studentView = await school.timetableScreen(
      student.authUser,
      "week",
      studentId,
      p.date,
    );
    const parentView = await school.timetableScreen(
      parent.authUser,
      "week",
      studentId,
      p.date,
      "guardian",
    );
    const find = (v: typeof studentView) =>
      v.days.flatMap((d) => d.periods).find((r) => r.date === p.date);
    expect(find(studentView)).toMatchObject({
      room: "Lab 2",
      teacher: { id: other.authUser.id },
      materials: ["Graph notebook", "Ruler"],
    });
    expect(find(parentView)).toEqual(find(studentView));
    const notices = (
      await pool.query(
        "SELECT recipient_id FROM notifications WHERE metadata->>'day_plan_id'=$1",
        [p.id],
      )
    ).rows.map((r) => r.recipient_id);
    expect(notices).toContain(parent.authUser.id);
    expect(notices).toContain(student.authUser.id);
    expect(new Set(notices).size).toBe(notices.length);
    expect(
      (
        await pool.query(
          "SELECT id FROM attendance_records WHERE student_id=$1",
          [studentId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("preserves publication on draft edits and discard", async () => {
    const p = await start();
    await save(p.id, { room: "Library" });
    await publish(p.id);
    const revision = await start(p.date);
    await save(revision.id, { room: "Courtyard" });
    const latest = await detail(p.id);
    await service.discard(admin, p.id, {
      ...command(),
      expected_revision: latest.revision,
    });
    expect(
      (await effectiveSchedule(db, schoolId, p.date)).find(
        (r) => r.class_section_id === classA,
      )?.room,
    ).toBe("Library");
    expect((await detail(p.id)).versions.map((v) => v.state)).toEqual([
      "discarded",
      "published",
    ]);
  });
  it("deduplicates concurrent publish retries and rejects changed command payloads", async () => {
    const p = await start();
    await save(p.id);
    const latest = await detail(p.id),
      body = { ...command(), expected_revision: latest.revision };
    const results = await Promise.all([
      service.publish(admin, p.id, body),
      service.publish(admin, p.id, body),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await detail(p.id)).published_version).toBe(1);
    await expect(service.discard(admin, p.id, body)).rejects.toThrow(
      "different action",
    );
  });
  it("rejects stale edits and cannot publish without a review reason", async () => {
    const p = await start();
    await save(p.id, {}, { reason: "" });
    await expect(
      service.save(admin, p.id, {
        ...command(),
        expected_revision: p.revision,
        notice: "",
        reason: "test",
        periods: [],
      }),
    ).rejects.toThrow("changed");
    await expect(publish(p.id)).rejects.toThrow("reason");
  });
  it("blocks teacher, room and within-class conflicts without publishing anything", async () => {
    const p = await start();
    await save(p.id, {
      starts_at: "10:00",
      ends_at: "10:45",
      teacher_user_id: other.authUser.id,
      room: "Room B",
    });
    const conflicts = (await detail(p.id)).conflicts;
    expect(conflicts.map((c) => c.type)).toEqual(
      expect.arrayContaining(["teacher", "room"]),
    );
    await expect(publish(p.id)).rejects.toThrow("conflicts");
    const original = comparable(p.periods[0]!);
    await save(
      p.id,
      {},
      { all: [original, { ...original, period_number: 2 }] },
    );
    expect((await detail(p.id)).conflicts[0]?.type).toBe("class");
  });
  it("serializes competing allocations across two classes", async () => {
    const day = future(),
      a = await start(day),
      b = await start(day, classB);
    await save(a.id, { room: "Shared lab" });
    await save(b.id, {
      starts_at: "09:00",
      ends_at: "09:45",
      room: "Shared lab",
    });
    const results = await Promise.allSettled([publish(a.id), publish(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("requires current teacher identity and rejects response by another teacher", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const assignment = (await detail(p.id)).published_periods[0]!;
    expect(assignment.coverage_status).toBe("pending");
    await expect(
      service.respond(teacher, assignment.id, {
        ...command(),
        expected_revision: 0,
        status: "accepted",
        note: "",
        source: "app",
      }),
    ).rejects.toThrow("not yours");
    await service.respond(other, assignment.id, {
      ...command(),
      expected_revision: 0,
      status: "accepted",
      note: "I can cover.",
      source: "app",
    });
    expect((await detail(p.id)).published_periods[0]!.coverage_status).toBe(
      "accepted",
    );
    expect(
      (await service.teacher(other.authUser, schoolId, p.date)).periods,
    ).toHaveLength(2);
    expect(
      await service.teacherSummary(other.authUser, schoolId, p.date, p.date),
    ).toMatchObject({
      days: [
        {
          date: p.date,
          periods: 2,
          classes: 2,
          pending: 0,
          accepted: 1,
        },
      ],
      totals: {
        periods: 2,
        classes: 2,
        pending: 0,
        accepted: 1,
      },
    });
  });
  it("records unavailable and assisted responses separately from attendance", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const assignment = (await detail(p.id)).published_periods[0]!;
    await service.respond(other, assignment.id, {
      ...command(),
      expected_revision: 0,
      status: "declined",
      note: "Covering an office duty.",
      source: "app",
    });
    expect(
      (await service.options(admin.authUser, schoolId, p.date)).classes.find(
        (c) => c.id === classA,
      )?.unresolved,
    ).toBe(1);
    await service.respond(admin, assignment.id, {
      ...command(),
      expected_revision: 1,
      status: "accepted",
      note: "Confirmed availability in person.",
      source: "in_person",
      received_at: new Date().toISOString(),
    });
    const row = (await detail(p.id)).published_periods[0]!;
    expect(row).toMatchObject({
      coverage_status: "accepted",
      response_source: "in_person",
      responded_by: admin.authUser.id,
    });
    expect(
      (
        await pool.query(
          "SELECT id FROM attendance_records WHERE student_id=$1",
          [studentId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("supersedes old assignments and requests fresh confirmation for changed arrangements", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const old = (await detail(p.id)).published_periods[0]!;
    await service.respond(other, old.id, {
      ...command(),
      expected_revision: 0,
      status: "accepted",
      note: "",
      source: "app",
    });
    await start(p.date);
    await save(p.id, { room: "New room" });
    await publish(p.id);
    await expect(
      service.respond(other, old.id, {
        ...command(),
        expected_revision: 1,
        status: "accepted",
        note: "",
        source: "app",
      }),
    ).rejects.toThrow("superseded");
    expect((await detail(p.id)).published_periods[0]!.coverage_status).toBe(
      "pending",
    );
  });
  it("keeps unchanged teacher confirmations when only the family notice changes", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const old = (await detail(p.id)).published_periods[0]!;
    await service.respond(other, old.id, {
      ...command(),
      expected_revision: 0,
      status: "accepted",
      note: "Confirmed.",
      source: "app",
    });
    await start(p.date);
    await save(p.id, {}, { notice: "Bring a water bottle." });
    await publish(p.id);
    expect((await detail(p.id)).published_periods[0]).toMatchObject({
      coverage_status: "accepted",
      response_note: "Confirmed.",
    });
  });
  it("retains cancelled periods in the shared schedule without claiming attendance", async () => {
    const p = await start();
    await save(p.id, { cancelled: true, materials: ["Obsolete kit"] });
    await publish(p.id);
    const rows = await effectiveSchedule(db, schoolId, p.date);
    expect(rows.find((r) => r.class_section_id === classA)?.cancelled).toBe(
      true,
    );
    expect((await detail(p.id)).published_periods[0]!.coverage_status).toBe(
      "not_required",
    );
  });
  it("blocks invalid dates, past changes, holidays and cross-school references", async () => {
    await expect(
      service.start(admin, {
        ...command(),
        class_section_id: classA,
        date: "2026-02-30",
      }),
    ).rejects.toThrow();
    await expect(start("2020-01-01")).rejects.toThrow("read-only");
    const p = await start();
    await pool.query(
      "INSERT INTO school_calendar_days(school_id,date,is_instructional,label) VALUES($1,$2,false,'Holiday')",
      [schoolId, p.date],
    );
    await save(p.id);
    await expect(publish(p.id)).rejects.toThrow("non-instructional");
    await expect(
      service.detail(admin.authUser, p.id, randomUUID()),
    ).rejects.toThrow("membership");
    await expect(
      service.detail(parent.authUser, p.id, schoolId),
    ).rejects.toThrow("administrator");
    await expect(
      service.start(admin, {
        ...command(),
        class_section_id: randomUUID(),
        date: future(),
      }),
    ).rejects.toThrow("Choose a class");
  });
  it("rechecks revoked administrator and teacher memberships", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await pool.query(
      "UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2 AND role='staff'",
      [schoolId, other.authUser.id],
    );
    try {
      await expect(publish(p.id)).rejects.toThrow("no longer active");
    } finally {
      await pool.query(
        "UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2 AND role='staff'",
        [schoolId, other.authUser.id],
      );
    }
    await pool.query(
      "UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2 AND role='admin'",
      [schoolId, admin.authUser.id],
    );
    try {
      await expect(publish(p.id)).rejects.toThrow("membership");
    } finally {
      await pool.query(
        "UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2 AND role='admin'",
        [schoolId, admin.authUser.id],
      );
    }
  });
  it("detects weekly edits which would invalidate a published allocation", async () => {
    const p = await start();
    await save(p.id, { room: "Special room" });
    await publish(p.id);
    await expect(
      db.transaction().execute(async (tx) => {
        await tx
          .updateTable("timetable_slots")
          .set({ starts_at: "09:00", ends_at: "09:45", room: "Special room" })
          .where("class_section_id", "=", classB)
          .execute();
        await protectPublishedPlans(tx, schoolId);
      }),
    ).rejects.toThrow("published day plan");
  });
  it("revalidates event audiences for new substitutes and keeps draft/coverage data private", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const payload = {
      day_plan_id: p.id,
      class_section_id: classA,
      term_id: termId,
      date: p.date,
      change_kind: "published",
    };
    const authorized = async (userId: string, kind = "published") =>
      (
        await pool.query(
          "SELECT event_user_is_authorized($1,$2,$3::jsonb,$4) AS allowed",
          [
            schoolId,
            "day_plan.updated",
            JSON.stringify({ ...payload, change_kind: kind }),
            userId,
          ],
        )
      ).rows[0].allowed;
    expect(await authorized(other.authUser.id)).toBe(true);
    expect(await authorized(other.authUser.id, "draft")).toBe(false);
    expect(await authorized(parent.authUser.id)).toBe(true);
    expect(await authorized(parent.authUser.id, "coverage")).toBe(false);
    await pool.query(
      "UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2",
      [schoolId, other.authUser.id],
    );
    try {
      expect(await authorized(other.authUser.id)).toBe(false);
    } finally {
      await pool.query(
        "UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2",
        [schoolId, other.authUser.id],
      );
    }
  });
  it("grants register access only after acceptance and only for the assignment date", async () => {
    const p = await start();
    await save(p.id, { teacher_user_id: other.authUser.id });
    await publish(p.id);
    const row = (await detail(p.id)).published_periods[0]!;
    await expect(
      school.teacherAttendanceScreen(other.authUser, classA, p.date),
    ).rejects.toThrow("not assigned");
    await service.respond(other, row.id, {
      ...command(),
      expected_revision: 0,
      status: "accepted",
      note: "Confirmed cover.",
      source: "app",
    });
    expect(
      (
        await school.teacherAttendanceScreen(other.authUser, classA, p.date)
      ).roster.map((s) => s.id),
    ).toContain(studentId);
    const events = new SchoolEventService(db);
    const eventRequest = randomUUID();
    await events.enqueueRegisterEvent(db, {
      schoolId,
      classSectionId: classA,
      termId,
      date: p.date,
      requestId: eventRequest,
      state: "draft",
      revision: 1,
      actorId: teacher.authUser.id,
    });
    const delivered = (
      await pool.query(
        "SELECT audience_user_ids,payload,event_type FROM event_outbox WHERE idempotency_key LIKE $1",
        [`%${eventRequest}%`],
      )
    ).rows[0];
    expect(delivered.audience_user_ids).toContain(other.authUser.id);
    expect(
      (
        await pool.query(
          "SELECT event_user_is_authorized($1,$2,$3::jsonb,$4) AS allowed",
          [
            schoolId,
            delivered.event_type,
            JSON.stringify(delivered.payload),
            other.authUser.id,
          ],
        )
      ).rows[0].allowed,
    ).toBe(true);
    await expect(
      school.teacherAttendanceScreen(other.authUser, classA, future()),
    ).rejects.toThrow("not assigned");
    await service.respond(other, row.id, {
      ...command(),
      expected_revision: 1,
      status: "declined",
      note: "No longer available.",
      source: "app",
    });
    await expect(
      school.teacherAttendanceScreen(other.authUser, classA, p.date),
    ).rejects.toThrow("not assigned");
  });
  it("rejects publication from a stale weekly baseline even without a resource conflict", async () => {
    const p = await start();
    await save(p.id, { room: "Lab 5" });
    await pool.query(
      "UPDATE timetable_slots SET title='Revised mathematics' WHERE class_section_id=$1",
      [classA],
    );
    try {
      await expect(publish(p.id)).rejects.toThrow(
        "underlying timetable changed",
      );
    } finally {
      await pool.query(
        "UPDATE timetable_slots SET title='Mathematics' WHERE class_section_id=$1",
        [classA],
      );
    }
  });
  it("calculates subject attendance from dated published periods and excludes cancellations", async () => {
    const subjectId = (
      await pool.query(
        "INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'DP-MAT','Mathematics','Maths') RETURNING id",
        [schoolId],
      )
    ).rows[0].id;
    const p = await start();
    await save(p.id, { subject_id: subjectId });
    await publish(p.id);
    // Place the published test fixture in recorded history without depending on the wall-clock hour.
    const historical = (
      await pool.query("SELECT ($1::date-1)::text AS date", [today])
    ).rows[0].date;
    await pool.query("UPDATE day_plans SET date=$2 WHERE id=$1", [
      p.id,
      historical,
    ]);
    await pool.query(
      "INSERT INTO attendance_records(student_id,class_section_id,date,status) VALUES($1,$2,$3,'present')",
      [studentId, classA, historical],
    );
    try {
      await school.refreshSubjectAttendance(db, [studentId]);
      expect(
        (
          await pool.query(
            "SELECT classes_held,classes_attended FROM subject_attendance WHERE student_id=$1 AND subject_id=$2",
            [studentId, subjectId],
          )
        ).rows,
      ).toEqual([{ classes_held: 1, classes_attended: 1 }]);
      await pool.query(
        "UPDATE day_plan_periods SET cancelled=true WHERE plan_id=$1",
        [p.id],
      );
      await school.refreshSubjectAttendance(db, [studentId]);
      expect(
        (
          await pool.query(
            "SELECT classes_held FROM subject_attendance WHERE student_id=$1 AND subject_id=$2",
            [studentId, subjectId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query(
            "SELECT status FROM attendance_records WHERE student_id=$1 AND date=$2",
            [studentId, historical],
          )
        ).rows[0].status,
      ).toBe("present");
    } finally {
      await pool.query(
        "DELETE FROM attendance_records WHERE student_id=$1 AND date=$2",
        [studentId, historical],
      );
    }
  });
});
