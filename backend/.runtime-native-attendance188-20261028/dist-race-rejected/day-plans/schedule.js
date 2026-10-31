import { BadRequestException } from "@nestjs/common";
import { sql } from "kysely";
import { lockCampusSpaceUse } from "../common/campus-space-use.js";
export async function effectiveSchedule(db, schoolId, date) {
    return (await sql `SELECT * FROM effective_school_schedule_v4(${schoolId}::uuid,${date}::date) ORDER BY starts_at,period_number`.execute(db)).rows;
}
export async function lockSchedule(db, schoolId) {
    await lockCampusSpaceUse(db, schoolId);
    await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${schoolId}`},0))`.execute(db);
}
export async function scheduleConflicts(db, schoolId, date, classId, periods) {
    const others = (await effectiveSchedule(db, schoolId, date)).filter((p) => p.class_section_id !== classId && !p.cancelled);
    const classes = (await sql `SELECT id,concat('Class ',grade,section) AS name FROM class_sections WHERE school_id=${schoolId}::uuid`.execute(db)).rows;
    const names = new Map(classes.map((c) => [c.id, c.name]));
    const result = [];
    const active = periods.filter((p) => !p.cancelled);
    const overlap = (a, b) => a.starts_at.slice(0, 5) < b.ends_at.slice(0, 5) &&
        b.starts_at.slice(0, 5) < a.ends_at.slice(0, 5);
    for (let i = 0; i < active.length; i++) {
        const a = active[i];
        for (const b of active.slice(i + 1))
            if (overlap(a, b))
                result.push({
                    period_number: a.period_number,
                    other_period: b.period_number,
                    class_name: names.get(classId) ?? "This class",
                    type: "class",
                });
        for (const b of others) {
            if (!overlap(a, b))
                continue;
            if (a.teacher_user_id && a.teacher_user_id === b.teacher_user_id)
                result.push({
                    period_number: a.period_number,
                    other_period: b.period_number,
                    class_name: names.get(b.class_section_id) ?? "Another class",
                    type: "teacher",
                });
            if ((a.space_id && b.space_id ? a.space_id === b.space_id : a.room.trim() &&
                a.room.trim().toLowerCase() === b.room.trim().toLowerCase()) &&
                a.slot_type !== "break" &&
                b.slot_type !== "break")
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
export async function protectPublishedPlans(db, schoolId) {
    const days = (await sql `SELECT DISTINCT date FROM day_plans WHERE school_id=${schoolId}::uuid AND published_version IS NOT NULL AND date>=(SELECT (now() AT TIME ZONE timezone)::date FROM schools WHERE id=${schoolId}::uuid)`.execute(db)).rows;
    for (const { date } of days) {
        const schedule = await effectiveSchedule(db, schoolId, date);
        const ids = [
            ...new Set(schedule.filter((p) => p.day_plan_id).map((p) => p.class_section_id)),
        ];
        for (const id of ids)
            if ((await scheduleConflicts(db, schoolId, date, id, schedule.filter((p) => p.class_section_id === id))).length)
                throw new BadRequestException(`This weekly change conflicts with a published day plan on ${date}. Revise that day's plan first.`);
    }
}
//# sourceMappingURL=schedule.js.map