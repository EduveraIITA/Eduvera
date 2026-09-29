import { sql } from "kysely";
import type { AuthUser } from "../common/request.js";
import type { PlanDb } from "./contracts.js";
import { authorize, dayContext, getPlan, periods } from "./repository.js";
import { scheduleConflicts } from "./schedule.js";
export async function planDetail(
  db: PlanDb,
  user: AuthUser,
  schoolId: string,
  id: string,
) {
  await authorize(db, user, schoolId, "admin");
  const plan = await getPlan(db, schoolId, id);
  const versions = (
    await sql<{
      version: number;
      state: string;
      notice: string;
      reason: string;
      created_at: Date;
      published_at: Date | null;
      author: string;
    }>`SELECT v.*,concat_ws(' ',u.first_name,u.last_name) AS author FROM day_plan_versions v JOIN users u ON u.id=v.created_by WHERE v.plan_id=${id}::uuid ORDER BY v.version DESC`.execute(
      db,
    )
  ).rows;
  const selected = plan.draft_version ?? plan.published_version;
  const rows = selected ? await periods(db, id, selected) : [];
  const published = plan.published_version
    ? await periods(db, id, plan.published_version)
    : [];
  return {
    ...plan,
    versions,
    selected_version: selected,
    periods: rows,
    published_periods: published,
    context: await dayContext(db, schoolId, plan.date),
    conflicts: await scheduleConflicts(
      db,
      schoolId,
      plan.date,
      plan.class_section_id,
      rows,
    ),
  };
}
export async function planOptions(
  db: PlanDb,
  user: AuthUser,
  schoolId: string,
  date: string,
) {
  await authorize(db, user, schoolId, "admin");
  const classes = (
    await sql<{
      id: string;
      name: string;
      room_number: string;
      term_id: string;
      plan_id: string | null;
      revision: number | null;
      draft_version: number | null;
      published_version: number | null;
      unresolved: number;
    }>`SELECT cs.id,concat('Class ',cs.grade,cs.section) AS name,cs.room_number,t.id AS term_id,d.id AS plan_id,d.revision,d.draft_version,d.published_version,
    (SELECT count(*)::int FROM day_plan_periods p WHERE p.plan_id=d.id AND p.version=d.published_version AND NOT p.cancelled AND p.coverage_status IN ('unassigned','pending','declined')) AS unresolved
    FROM class_sections cs JOIN academic_terms t ON t.school_id=cs.school_id AND t.academic_year=cs.academic_year AND ${date}::date BETWEEN t.starts_on AND t.ends_on
    LEFT JOIN day_plans d ON d.class_section_id=cs.id AND d.date=${date}::date WHERE cs.school_id=${schoolId}::uuid ORDER BY cs.grade,cs.section`.execute(
      db,
    )
  ).rows;
  const teachers = (
    await sql<{
      id: string;
      name: string;
    }>`SELECT m.user_id AS id,concat_ws(' ',u.first_name,u.last_name) AS name FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=${schoolId}::uuid AND m.role='staff' AND m.is_active ORDER BY u.first_name,u.last_name`.execute(
      db,
    )
  ).rows;
  const schedule = (
    await sql`SELECT e.*,CASE WHEN u.id IS NOT NULL THEN concat_ws(' ',u.first_name,u.last_name) ELSE NULL END AS teacher_name,0 AS response_revision,'' AS response_note,NULL AS response_source,NULL AS responded_at FROM effective_school_schedule(${schoolId}::uuid,${date}::date) e LEFT JOIN users u ON u.id=e.teacher_user_id ORDER BY e.starts_at,e.period_number`.execute(
      db,
    )
  ).rows;
  const subjects = await db
    .selectFrom("subjects")
    .select(["id", "name"])
    .where("school_id", "=", schoolId)
    .orderBy("name")
    .execute();
  return {
    classes,
    teachers,
    subjects,
    schedule,
    context: await dayContext(db, schoolId, date),
  };
}
export async function teacherDay(
  db: PlanDb,
  user: AuthUser,
  schoolId: string,
  date: string,
) {
  await authorize(db, user, schoolId, "staff");
  const rows = (
    await sql`SELECT e.*,concat('Class ',c.grade,c.section) AS class_name,p.response_revision,p.response_note,p.response_source,p.responded_at,
    CASE WHEN e.day_plan_id IS NOT NULL THEN d.owner_id ELSE NULL END AS owner_id,
    CASE WHEN owner.id IS NOT NULL THEN concat_ws(' ',owner.first_name,owner.last_name) ELSE NULL END AS owner_name
    FROM effective_school_schedule(${schoolId}::uuid,${date}::date) e JOIN class_sections c ON c.id=e.class_section_id
    LEFT JOIN day_plan_periods p ON p.id=e.id LEFT JOIN day_plans d ON d.id=e.day_plan_id LEFT JOIN users owner ON owner.id=d.owner_id
    WHERE e.teacher_user_id=${user.id}::uuid ORDER BY e.starts_at,e.period_number`.execute(
      db,
    )
  ).rows;
  return { date, periods: rows, context: await dayContext(db, schoolId, date) };
}

export async function teacherSummary(
  db: PlanDb,
  user: AuthUser,
  schoolId: string,
  start: string,
  end: string,
) {
  await authorize(db, user, schoolId, "staff");
  const days = (
    await sql<{
      date: string;
      periods: number;
      classes: number;
      pending: number;
      accepted: number;
      declined: number;
      cancelled: number;
    }>`WITH days AS (
      SELECT generate_series(${start}::date,${end}::date,'1 day')::date AS day
    )
    SELECT d.day::text AS date,
      count(e.id) FILTER (WHERE NOT e.cancelled)::int AS periods,
      count(DISTINCT e.class_section_id) FILTER (WHERE e.id IS NOT NULL AND NOT e.cancelled)::int AS classes,
      count(e.id) FILTER (WHERE e.coverage_status='pending' AND NOT e.cancelled)::int AS pending,
      count(e.id) FILTER (WHERE e.coverage_status='accepted' AND NOT e.cancelled)::int AS accepted,
      count(e.id) FILTER (WHERE e.coverage_status='declined' AND NOT e.cancelled)::int AS declined,
      count(e.id) FILTER (WHERE e.cancelled)::int AS cancelled
    FROM days d
    LEFT JOIN LATERAL (
      SELECT * FROM effective_school_schedule(${schoolId}::uuid,d.day)
      WHERE teacher_user_id=${user.id}::uuid
    ) e ON true
    GROUP BY d.day
    ORDER BY d.day`.execute(db)
  ).rows;
  const totals = days.reduce(
    (sum, day) => ({
      periods: sum.periods + day.periods,
      classes: sum.classes + day.classes,
      pending: sum.pending + day.pending,
      accepted: sum.accepted + day.accepted,
      declined: sum.declined + day.declined,
      cancelled: sum.cancelled + day.cancelled,
    }),
    {
      periods: 0,
      classes: 0,
      pending: 0,
      accepted: 0,
      declined: 0,
      cancelled: 0,
    },
  );
  return { start, end, days, totals };
}
