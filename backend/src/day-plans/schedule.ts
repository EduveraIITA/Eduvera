import { BadRequestException } from "@nestjs/common";
import { sql } from "kysely";
import type { PlanDb, PlanPeriod } from "./contracts.js";
export interface ScheduleRow extends PlanPeriod {
  id: string;
  class_section_id: string;
  term_id: string;
  weekday: number;
  teacher_designation: string;
  subject_id: string | null;
  day_plan_id: string | null;
  plan_version: number | null;
  notice: string;
  coverage_status: string;
}
export async function effectiveSchedule(
  db: PlanDb,
  schoolId: string,
  date: string,
) {
  return (
    await sql<ScheduleRow>`SELECT * FROM effective_school_schedule(${schoolId}::uuid,${date}::date) ORDER BY starts_at,period_number`.execute(
      db,
    )
  ).rows;
}
export async function lockSchedule(db: PlanDb, schoolId: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${schoolId}`},0))`.execute(
    db,
  );
}
export interface ScheduleConflict {
  period_number: number;
  other_period: number;
  class_name: string;
  type: "class" | "teacher" | "room";
}
export async function scheduleConflicts(
  db: PlanDb,
  schoolId: string,
  date: string,
  classId: string,
  periods: PlanPeriod[],
): Promise<ScheduleConflict[]> {
  const others = (await effectiveSchedule(db, schoolId, date)).filter(
    (p) => p.class_section_id !== classId && !p.cancelled,
  );
  const classes = (
    await sql<{
      id: string;
      name: string;
    }>`SELECT id,concat('Class ',grade,section) AS name FROM class_sections WHERE school_id=${schoolId}::uuid`.execute(
      db,
    )
  ).rows;
  const names = new Map(classes.map((c) => [c.id, c.name]));
  const result: ScheduleConflict[] = [];
  const active = periods.filter((p) => !p.cancelled);
  const overlap = (a: PlanPeriod, b: PlanPeriod) =>
    a.starts_at.slice(0, 5) < b.ends_at.slice(0, 5) &&
    b.starts_at.slice(0, 5) < a.ends_at.slice(0, 5);
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    for (const b of active.slice(i + 1))
      if (overlap(a, b))
        result.push({
          period_number: a.period_number,
          other_period: b.period_number,
          class_name: names.get(classId) ?? "This class",
          type: "class",
        });
    for (const b of others) {
      if (!overlap(a, b)) continue;
      if (a.teacher_user_id && a.teacher_user_id === b.teacher_user_id)
        result.push({
          period_number: a.period_number,
          other_period: b.period_number,
          class_name: names.get(b.class_section_id) ?? "Another class",
          type: "teacher",
        });
      if (
        a.room.trim() &&
        a.room.trim().toLowerCase() === b.room.trim().toLowerCase() &&
        a.slot_type !== "break" &&
        b.slot_type !== "break"
      )
        result.push({
          period_number: a.period_number,
          other_period: b.period_number,
          class_name: names.get(b.class_section_id) ?? "Another class",
          type: "room",
        });
    }
  }
  return result;
}
// Weekly edits share the same schedule lock and cannot invalidate a published day plan.
export async function protectPublishedPlans(db: PlanDb, schoolId: string) {
  const days = (
    await sql<{
      date: string;
    }>`SELECT DISTINCT date FROM day_plans WHERE school_id=${schoolId}::uuid AND published_version IS NOT NULL AND date>=(SELECT (now() AT TIME ZONE timezone)::date FROM schools WHERE id=${schoolId}::uuid)`.execute(
      db,
    )
  ).rows;
  for (const { date } of days) {
    const schedule = await effectiveSchedule(db, schoolId, date);
    const ids = [
      ...new Set(
        schedule.filter((p) => p.day_plan_id).map((p) => p.class_section_id),
      ),
    ];
    for (const id of ids)
      if (
        (
          await scheduleConflicts(
            db,
            schoolId,
            date,
            id,
            schedule.filter((p) => p.class_section_id === id),
          )
        ).length
      )
        throw new BadRequestException(
          `This weekly change conflicts with a published day plan on ${date}. Revise that day's plan first.`,
        );
  }
}
