import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "kysely";
import type { AuthUser, AuthenticatedRequest } from "../common/request.js";
import type { Plan, PlanDb, PlanPeriod, StoredPeriod } from "./contracts.js";
import { uuid } from "./contracts.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
export async function authorize(
  db: PlanDb,
  user: AuthUser,
  schoolId: string,
  role: "admin" | "staff",
  lock = false,
) {
  const found = (
    await sql`SELECT m.id FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=${uuid.parse(schoolId)}::uuid AND m.user_id=${user.id}::uuid AND m.role=${role} AND m.is_active AND u.is_active ${lock ? sql`FOR SHARE OF m,u` : sql``}`.execute(
      db,
    )
  ).rows[0];
  if (!found)
    throw new ForbiddenException(
      `An active ${role === "admin" ? "administrator" : "teacher"} membership is required in this school.`,
    );
}
export async function getPlan(
  db: PlanDb,
  schoolId: string,
  id: string,
  lock = false,
) {
  const plan = (
    await sql<Plan>`SELECT * FROM day_plans WHERE school_id=${uuid.parse(schoolId)}::uuid AND id=${uuid.parse(id)}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(
      db,
    )
  ).rows[0];
  if (!plan) throw new NotFoundException("Day plan not found in this school.");
  return plan;
}
export async function periods(
  db: PlanDb,
  planId: string,
  version: number,
): Promise<StoredPeriod[]> {
  return (
    await sql<StoredPeriod>`SELECT p.*,m.user_id AS teacher_user_id,CASE WHEN u.id IS NOT NULL THEN concat_ws(' ',u.first_name,u.last_name) ELSE NULL END AS teacher_name FROM day_plan_periods p LEFT JOIN school_memberships m ON m.id=p.teacher_membership_id LEFT JOIN users u ON u.id=m.user_id WHERE p.plan_id=${planId}::uuid AND p.version=${version} ORDER BY p.starts_at,p.period_number`.execute(
      db,
    )
  ).rows;
}
export async function dayContext(db: PlanDb, schoolId: string, date: string) {
  const row = (
    await sql<{
      today: string;
      local_time: string;
      is_instructional: boolean | null;
      label: string | null;
      timezone: string;
    }>`SELECT (${executionNow()}::timestamptz AT TIME ZONE s.timezone)::date::text AS today,to_char(${executionNow()}::timestamptz AT TIME ZONE s.timezone,'HH24:MI') AS local_time,s.timezone,c.is_instructional,c.label FROM schools s LEFT JOIN school_calendar_days c ON c.school_id=s.id AND c.date=${date}::date WHERE s.id=${schoolId}::uuid`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw new NotFoundException("School not found.");
  return row;
}
export async function activeTeachers(
  db: PlanDb,
  schoolId: string,
  ids: string[],
  lock = false,
) {
  if (!ids.length) return new Map<string, string>();
  const rows = (
    await sql<{
      id: string;
      user_id: string;
    }>`SELECT m.id,m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=${schoolId}::uuid AND m.user_id=ANY(${ids}::uuid[]) AND m.role='staff' AND m.is_active AND u.is_active ORDER BY m.id ${lock ? sql`FOR SHARE OF m,u` : sql``}`.execute(
      db,
    )
  ).rows;
  if (new Set(rows.map((r) => r.user_id)).size !== new Set(ids).size)
    throw new BadRequestException(
      "A selected teacher is no longer active in this school. Choose a current teacher.",
    );
  return new Map(rows.map((r) => [r.user_id, r.id]));
}
export async function validatePeriodSpaces(db: PlanDb, schoolId: string, rows: readonly { space_id?: string | null | undefined }[]) {
  const spaceIds = [...new Set(rows.flatMap(period => period.space_id ? [period.space_id] : []))];
  if (!spaceIds.length) return;
  const current = (await sql<{ id: string }>`SELECT place.id FROM campus_spaces place
    JOIN institution_campuses campus ON campus.id=place.campus_id AND campus.school_id=place.school_id
    WHERE place.school_id=${schoolId}::uuid AND place.id=ANY(${spaceIds}::uuid[])
      AND place.status='active' AND campus.status='active' FOR SHARE OF place,campus`.execute(db)).rows;
  if (current.length !== spaceIds.length) throw new BadRequestException("Select a current campus place belonging to this institution.");
}
export async function insertPeriods(
  db: PlanDb,
  plan: Plan,
  version: number,
  rows: PlanPeriod[],
) {
  const teacherIds = rows.flatMap((p) =>
    p.teacher_user_id ? [p.teacher_user_id] : [],
  );
  const teachers = await activeTeachers(db, plan.school_id, teacherIds, true);
  if (!rows.length) return;
  const subjects = (
    await db
      .selectFrom("subjects")
      .select("id")
      .where("school_id", "=", plan.school_id)
      .execute()
  ).map((s) => s.id);
  if (rows.some((p) => p.subject_id && !subjects.includes(p.subject_id)))
    throw new BadRequestException("Select a subject belonging to this school.");
  await validatePeriodSpaces(db, plan.school_id, rows);
  const data = rows.map((p) => ({
    ...p,
    // Label-only clients explicitly leave the canonical destination unknown.
    // Never preserve an obsolete ID or infer one from a typed room name.
    space_id: p.space_id ?? null,
    teacher_membership_id: p.teacher_user_id
      ? teachers.get(p.teacher_user_id)
      : null,
  }));
  await sql`INSERT INTO day_plan_periods(school_id,plan_id,version,period_number,starts_at,ends_at,title,slot_type,room,teacher_membership_id,cancelled,materials,subject_id,space_id)
    SELECT ${plan.school_id}::uuid,${plan.id}::uuid,${version},p.period_number,p.starts_at::time,p.ends_at::time,p.title,p.slot_type,p.room,p.teacher_membership_id::uuid,p.cancelled,p.materials,p.subject_id::uuid,p.space_id::uuid
    FROM jsonb_to_recordset(${JSON.stringify(data)}::jsonb) AS p(period_number smallint,starts_at text,ends_at text,title text,slot_type text,room text,teacher_membership_id text,cancelled boolean,materials text[],subject_id text,space_id text)`.execute(
    db,
  );
}
export async function audit(
  db: PlanDb,
  req: AuthenticatedRequest,
  plan: Plan,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db
    .insertInto("audit_events")
    .values({
      school_id: plan.school_id,
      actor_id: req.authUser.id,
      action: `day_plan.${action}`,
      target_type: "day_plan",
      target_id: plan.id,
      request_id: req.requestId,
      ip_hash: null,
      metadata: {
        ...metadata,
        date: plan.date,
        class_section_id: plan.class_section_id,
      },
    })
    .execute();
}
