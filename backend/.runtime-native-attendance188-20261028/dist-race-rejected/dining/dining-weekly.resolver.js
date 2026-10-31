import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { sql } from "kysely";
import { recurrenceDays, localInstantChoices, } from "../schedule-planning/shared-recurrence.js";
import { diningDateHref, } from "./dining.contracts.js";
export const diningDateValue = (value) => value == null
    ? null
    : value instanceof Date
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
        : typeof value === "string"
            ? value.slice(0, 10)
            : (() => {
                throw new BadRequestException("Invalid stored calendar date.");
            })();
export function normalizeWeeklyPlan(plan) {
    return {
        ...plan,
        starts_on: diningDateValue(plan.starts_on),
        ends_on: diningDateValue(plan.ends_on),
        stop_from: diningDateValue(plan.stop_from),
    };
}
export const addDiningDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function diningDateId(school, series, date) {
    const hash = createHash("sha256")
        .update(`dining-date:${school}:${series}:${date}`)
        .digest("hex")
        .slice(0, 32)
        .split("");
    hash[12] = "5";
    hash[16] = ((parseInt(hash[16], 16) & 3) | 8).toString(16);
    const value = hash.join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export function validateDiningRange(from, until) {
    if (until < from ||
        Date.parse(`${until}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`) >
            34 * 86400000)
        throw new BadRequestException("Choose up to 35 calendar days.");
}
export function resolveDiningWallTime(plan, day, date) {
    const start = localInstantChoices(date, day.starts_at, plan.timezone), end = localInstantChoices(addDiningDays(date, day.end_day_offset), day.ends_at, plan.timezone);
    let reason = !start.length || !end.length
        ? "nonexistent_time"
        : (start.length > 1 && day.start_fold === "reject") ||
            (end.length > 1 && day.end_fold === "reject")
            ? "ambiguous_time"
            : null;
    const choose = (choices, policy) => choices[policy === "later" ? choices.length - 1 : 0];
    const starts = reason ? null : choose(start, day.start_fold), ends = reason ? null : choose(end, day.end_fold);
    if (starts &&
        ends &&
        (Date.parse(ends) <= Date.parse(starts) ||
            Date.parse(ends) - Date.parse(starts) > 86400000))
        reason = "invalid_duration";
    return {
        plan,
        day,
        date,
        starts_at: reason ? null : starts,
        ends_at: reason ? null : ends,
        warning: reason
            ? {
                plan_id: plan.series_id,
                plan_version_id: plan.id,
                local_date: date,
                weekday: day.weekday,
                reason,
                href: diningDateHref(plan.series_id, date),
            }
            : null,
    };
}
/** The only weekly walker: source owners reuse the shared once/weekly date SQL.
 * Candidate versions are selected before day expansion, so expired successors do
 * not resurrect an older plan. No persistence or claims occur here. */
export async function expandDiningDates(tx, school, from, until, options = {}) {
    const rows = (options.plan
        ? [options.plan]
        : await tx
            .selectFrom("dining_weekly_plans")
            .selectAll()
            .where("school_id", "=", school)
            .where("published_at", "is not", null)
            .where("starts_on", "<=", until)
            .$if(Boolean(options.series), (q) => q.where("series_id", "=", options.series))
            .orderBy("version_number", "desc")
            .execute()).map(normalizeWeeklyPlan);
    if (!rows.length)
        return [];
    const days = await tx
        .selectFrom("dining_weekly_days")
        .selectAll()
        .where("school_id", "=", school)
        .where("plan_id", "in", rows.map((p) => p.id))
        .orderBy("weekday")
        .execute();
    const candidates = (await sql `SELECT plan.id AS plan_id,weekday.weekday,dates.day::text AS date
 FROM dining_weekly_plans plan JOIN dining_weekly_days weekday ON weekday.school_id=plan.school_id AND weekday.plan_id=plan.id
 CROSS JOIN LATERAL ${recurrenceDays({ startsOn: sql `plan.starts_on`, endsOn: sql `plan.ends_on`, from: sql `${from}`, until: sql `${until}`, weekday: sql `weekday.weekday`, kind: sql `'weekly'` })} dates
      WHERE plan.school_id=${school}::uuid AND plan.id=ANY(${rows.map((row) => row.id)}::uuid[]) AND dates.day>=${from}::date
      ${options.plan ? (options.plan.stop_from ? sql `AND dates.day<${options.plan.stop_from}::date` : sql ``) : sql `AND(plan.stop_from IS NULL OR dates.day<plan.stop_from)`}
 ${options.ownedPerson ? sql `AND(plan.coordinator_person_id=${options.ownedPerson}::uuid OR weekday.operator_person_id=${options.ownedPerson}::uuid)` : sql ``}
 ${options.plan ? sql `` : sql `AND NOT EXISTS(SELECT 1 FROM dining_weekly_plans successor WHERE successor.school_id=plan.school_id AND successor.series_id=plan.series_id AND successor.published_at IS NOT NULL AND successor.version_number>plan.version_number AND successor.starts_on<=dates.day)`}
 ORDER BY dates.day,plan.series_id`.execute(tx)).rows;
    const byPlan = new Map(rows.map((row) => [row.id, row])), byDay = new Map(days.map((row) => [`${row.plan_id}:${row.weekday}`, row]));
    const result = candidates.map((candidate) => resolveDiningWallTime(byPlan.get(candidate.plan_id), byDay.get(`${candidate.plan_id}:${candidate.weekday}`), candidate.date));
    return result.sort((a, b) => a.date.localeCompare(b.date) ||
        (a.starts_at ?? "").localeCompare(b.starts_at ?? "") ||
        a.plan.series_id.localeCompare(b.plan.series_id));
}
//# sourceMappingURL=dining-weekly.resolver.js.map