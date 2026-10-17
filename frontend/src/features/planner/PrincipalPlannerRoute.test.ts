import { describe, expect, it } from "vitest";
import { effectivePeriodsForDate, plannerDates, resolvePlannerDate } from "./PrincipalPlannerRoute";
import { minutesFromTime, periodEvents, timelineBounds, timelineNowInstant } from "./PlannerTimeline";
import { timetableRehearsalPeriodIsActive, type TimetableRehearsalIndicator } from "./rehearsal";
import type { ScheduleScreen } from "../schedule-planning/api";

const data: ScheduleScreen = {
  school_id: "school-1",
  school_date: "2026-10-14",
  selected_term_id: "term-1",
  terms: [{ id: "term-1", academic_year: "2026", name: "Term 1", starts_on: "2026-06-01", ends_on: "2026-12-20", is_active: true }],
  classes: [{ id: "class-1", name: "Class 7A", grade: "7", section: "A", room_number: "204" }],
  subjects: [{ id: "subject-1", code: "MATH", name: "Mathematics", short_name: "Maths", color: "blue" }],
  teachers: [{ id: "teacher-1", name: "Meera Kapoor" }],
  slots: [{ id: "slot-1", class_section_id: "class-1", class_name: "Class 7A", subject_id: "subject-1", display_title: "Mathematics", teacher_user_id: "teacher-1", teacher_name: "Meera Kapoor", weekday: 3, weekday_label: "Wednesday", period_number: 1, starts_at: "09:00", ends_at: "09:45", slot_type: "class", room: "204" }],
  conflicts: [], coverage: [], calendar_exceptions: [], versions: [],
};

const rehearsal: TimetableRehearsalIndicator = {
  label: "Simulated school day", status: "running", referenceDate: "2026-10-14",
  simulatedAt: "2026-10-14T09:10:00+05:30", phaseLabel: "Period 1", phaseMode: "lesson",
  nextChangeAt: null, activeSlotIds: ["slot-1"], timeZone: "Asia/Kolkata", campusPath: "/principal/campus",
};

describe("unified planner projections", () => {
  it("keeps a stable Monday-first week around the selected date", () => {
    expect(plannerDates("2026-10-14", "week")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });

  it("uses the authoritative recurring timetable and suppresses it on a closure", () => {
    expect(effectivePeriodsForDate(data, "2026-10-14")[0]).toMatchObject({ display_title: "Mathematics", class_name: "Class 7A" });
    const closed = { ...data, calendar_exceptions: [{ id: "closure-1", date: "2026-10-14", is_instructional: false, label: "Diwali", kind: "public_holiday" as const, reason: "Holiday", revision: 1 }] };
    expect(effectivePeriodsForDate(closed, "2026-10-14")).toEqual([]);
  });

  it("prefers a dated published timetable over the weekly baseline", () => {
    const arranged: ScheduleScreen = { ...data, versions: [{ id: "version-1", class_section_id: "class-1", term_id: "term-1", state: "published", starts_on: "2026-10-12", ends_on: "2026-10-16", revision: 2, baseline: false, periods: [{ id: "period-1", weekday: 3, period_number: 2, starts_at: "10:00", ends_at: "10:45", subject_id: "subject-1", teacher_user_id: "teacher-1", title: "Mathematics", slot_type: "class", room: "204" }] }] };
    expect(effectivePeriodsForDate(arranged, "2026-10-14")).toHaveLength(1);
    expect(effectivePeriodsForDate(arranged, "2026-10-14")[0]?.id).toBe("period-1");
  });

  it("shows an in-progress draft on the same calendar without changing the published baseline", () => {
    const drafting: ScheduleScreen = { ...data, versions: [{ id: "draft-1", class_section_id: "class-1", term_id: "term-1", state: "draft", starts_on: "2026-10-12", ends_on: "2026-10-16", revision: 1, baseline: false, periods: [{ id: "draft-period-1", weekday: 3, period_number: 2, starts_at: "11:00", ends_at: "11:45", subject_id: "subject-1", teacher_user_id: "teacher-1", title: "Mathematics", slot_type: "class", room: "204" }] }] };
    expect(effectivePeriodsForDate(drafting, "2026-10-14")[0]).toMatchObject({ id: "draft-period-1", version_state: "draft" });
  });

  it("derives proportional timeline bounds and extends them to the current time", () => {
    expect(minutesFromTime("09:45")).toBe(585);
    expect(timelineBounds([{ start: 540, end: 585 }], 1060)).toEqual({ start: 480, end: 1140 });
  });

  it("defaults to the rehearsal date only when the URL has no explicit date", () => {
    expect(resolvePlannerDate("2026-10-20", rehearsal, "2026-10-15", "2026-10-16")).toBe("2026-10-20");
    expect(resolvePlannerDate(null, rehearsal, "2026-10-15", "2026-10-16")).toBe("2026-10-14");
    expect(resolvePlannerDate(null, null, "2026-10-15", "2026-10-16")).toBe("2026-10-15");
  });

  it("uses the same rehearsal instant and exact published slot ids for timeline state", () => {
    expect(timelineNowInstant(rehearsal, ["2026-10-14"]).toISOString()).toBe("2026-10-14T03:40:00.000Z");
    expect(timetableRehearsalPeriodIsActive(rehearsal, "2026-10-14", "slot-1")).toBe(true);
    expect(timetableRehearsalPeriodIsActive(rehearsal, "2026-10-15", "slot-1")).toBe(false);
    const period = effectivePeriodsForDate(data, "2026-10-14")[0]!;
    expect(periodEvents([period], "2026-10-14", false, rehearsal)[0]?.extendedProps).toMatchObject({ isRehearsalActive: true });
    expect(periodEvents([period], "2026-10-14", true, rehearsal)[0]?.extendedProps).toMatchObject({ isRehearsalActive: true });
  });
});
