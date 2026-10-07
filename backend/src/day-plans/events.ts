import { sql } from "kysely";
import type { SchoolEventService } from "../school/school-event.service.js";
import type { Plan, PlanDb } from "./contracts.js";
export async function planEvent(
  db: PlanDb,
  events: SchoolEventService,
  plan: Plan,
  revision: number,
  kind: "draft" | "published" | "coverage",
  periodTeacher?: string,
) {
  const staff = (
    await sql<{
      user_id: string;
    }>`SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=${plan.school_id}::uuid AND m.is_active AND (m.role='admin' OR (m.role='staff' AND ${kind}<>'draft' AND (m.user_id=${periodTeacher ?? null}::uuid OR EXISTS(SELECT 1 FROM day_plan_periods p JOIN school_memberships assigned ON assigned.id=p.teacher_membership_id WHERE p.plan_id=${plan.id}::uuid AND assigned.user_id=m.user_id) OR EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=${plan.class_section_id}::uuid AND slot.teacher_user_id=m.user_id))))`.execute(
      db,
    )
  ).rows.map((r) => r.user_id);
  const families =
    kind === "published"
      ? (
          await sql<{ user_id: string; role: string; student_id: string }>`
    SELECT DISTINCT audience.* FROM (
      SELECT s.user_id,'student' AS role,s.id AS student_id FROM enrollments e JOIN students s ON s.id=e.student_id WHERE e.class_section_id=${plan.class_section_id}::uuid AND e.term_id=${plan.term_id}::uuid AND e.is_active AND e.enrolled_on<=${plan.date}::date
      UNION SELECT p.user_id,'guardian',e.student_id FROM enrollments e JOIN guardian_relationships g ON g.student_id=e.student_id AND g.school_id=${plan.school_id}::uuid JOIN parents p ON p.id=g.guardian_id WHERE e.class_section_id=${plan.class_section_id}::uuid AND e.term_id=${plan.term_id}::uuid AND e.is_active AND e.enrolled_on<=${plan.date}::date
    ) audience JOIN users u ON u.id=audience.user_id AND u.is_active WHERE EXISTS(SELECT 1 FROM school_memberships m WHERE m.school_id=${plan.school_id}::uuid AND m.user_id=audience.user_id AND m.role=audience.role AND m.is_active)`.execute(
            db,
          )
        ).rows
      : [];
  // Operational notice is persisted with publication; viewing it is not an acknowledgment.
  if (kind === "published") {
    const recipients = new Map<string, { user_id: string; link: string }>();
    for (const f of families)
      recipients.set(f.user_id, {
        user_id: f.user_id,
        link: `/${f.role === "guardian" ? "parent" : "student"}/timetable?date=${plan.date}${f.role === "guardian" ? `&student=${f.student_id}` : ""}`,
      });
    const administrators = new Set(
      (
        await sql<{
          user_id: string;
        }>`SELECT user_id FROM school_memberships WHERE school_id=${plan.school_id}::uuid AND role='admin' AND is_active`.execute(
          db,
        )
      ).rows.map((r) => r.user_id),
    );
    for (const id of staff)
      if (!recipients.has(id))
        recipients.set(id, {
          user_id: id,
          link: administrators.has(id)
            ? `/principal/timetable/day?school=${plan.school_id}&date=${plan.date}&class=${plan.class_section_id}`
            : `/teacher/timetable?date=${plan.date}`,
        });
    if (recipients.size)
      await sql`INSERT INTO notifications(recipient_id,kind,title,body,link,metadata,dedupe_key) SELECT r.user_id::uuid,'general','School day updated',${`The published schedule for ${plan.date} has changed. Open Timetable to review the latest plan.`},r.link,${JSON.stringify({ school_id: plan.school_id, day_plan_id: plan.id, date: plan.date, version: plan.published_version })}::jsonb,${`day-plan:${plan.id}:${plan.published_version}:`}||r.user_id FROM jsonb_to_recordset(${JSON.stringify([...recipients.values()])}::jsonb) AS r(user_id text,link text) ON CONFLICT(recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`.execute(
        db,
      );
  }
  const familyRefresh = [
    "student.home",
    "student.timetable",
    "parent.home",
    "parent.timetable",
  ];
  await events.enqueueUserEvent(db, {
    schoolId: plan.school_id,
    eventType: "day_plan.updated",
    aggregateType: "day_plan",
    aggregateId: plan.id,
    audienceUserIds: [...staff, ...families.map((f) => f.user_id)],
    idempotencyKey: `day-plan:${plan.id}:${revision}:${kind}`,
    payload: {
      day_plan_id: plan.id,
      class_section_id: plan.class_section_id,
      term_id: plan.term_id,
      date: plan.date,
      revision,
      change_kind: kind,
      refresh:
        kind === "draft"
          ? ["day-plans"]
          : kind === "coverage"
            ? ["day-plans", "teacher.home", "teacher.attendance"]
            : [
                "day-plans",
                ...familyRefresh,
                "student.attendance",
                "student.eligibility",
                "parent.attendance",
                "teacher.home",
                "teacher.attendance",
                "principal.home",
                "notifications",
              ],
    },
  });
}
