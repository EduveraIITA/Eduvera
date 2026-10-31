import { describe, expect, it } from "vitest";
import { activityCalendarScrollTime, activityDate, activityDates, activityInterval, activityPage, initialActivity, validateActivity } from "./activityExperience";

describe("purpose-first activity experience", () => {
  it("recovers invalid presentation dates and pages without changing authority", () => {
    expect(activityDate("2026-02-30", "2026-10-20")).toBe("2026-10-20");
    expect(activityDate("2026-10-21", "2026-10-20")).toBe("2026-10-21");
    expect(["-1", "Infinity", "1.5", null].map(activityPage)).toEqual([1, 1, 1, 1]);
  });
  it("starts without academic or account prerequisites", () => {
    expect(initialActivity("2026-10-20", "Europe/London")).toMatchObject({ person_ids: [], group_ids: [], class_section_id: null, term_id: null, subject_id: null, timezone: "Europe/London", recurrence: "once" });
  });
  it("makes overnight intent explicit and leaves weekly plans unbounded", () => {
    const plan = { ...initialActivity("2026-10-20", "Asia/Kolkata"), title: "Night duty", person_ids: ["person-1"], attendance_mode: "none" as const, recurrence: "weekly" as const, ends_on: null, starts_at: "22:00", ends_at: "06:00" };
    expect(validateActivity(plan)).toContain("Ends next day");
    expect(validateActivity({ ...plan, end_day_offset: 1 })).toBeNull();
    expect(validateActivity({ ...plan, end_day_offset: 1, ends_at: "23:00" })).toContain("24 hours");
  });
  it("keeps participant identity separate from recorder and reviewer authority", () => {
    const plan = { ...initialActivity("2026-10-20", "UTC"), title: "Shared training", person_ids: ["learner", "worker"] };
    expect(validateActivity(plan)).toContain("recorder");
    expect(validateActivity(plan)).toContain("Time & place");
    expect(validateActivity({ ...plan, recorder_person_id: "admin" })).toContain("reviewing");
    expect(validateActivity({ ...plan, recorder_person_id: "admin", reviewer_person_id: "admin" })).toBeNull();
  });
  it("rejects a cleared repeat end date without imposing one on open-ended plans", () => {
    const plan = { ...initialActivity("2026-10-21", "Asia/Kolkata"), title: "Weekly attendance", person_ids: ["person-1"], attendance_mode: "none" as const, recurrence: "weekly" as const };
    expect(validateActivity({ ...plan, ends_on: "" }, { publishing: false })).toBe("Choose a last date or leave the repeat open-ended.");
    expect(validateActivity({ ...plan, ends_on: null }, { publishing: false })).toBeNull();
    expect(validateActivity({ ...plan, ends_on: "2026-10-28" }, { publishing: false })).toBeNull();
  });
  it("permits an unfinished draft without weakening publication or participant validation", () => {
    const draft = { ...initialActivity("2026-10-20", "UTC"), title: "Team attendance", person_ids: ["worker"] };
    expect(validateActivity(draft, { publishing: false })).toBeNull();
    expect(validateActivity(draft)).toContain("recorder before publishing");
    expect(validateActivity({ ...draft, recorder_person_id: "admin" })).toContain("reviewing attendance before publishing");
    expect(validateActivity({ ...draft, person_ids: [] }, { publishing: false })).toContain("existing person or group");
    expect(validateActivity({ ...draft, location_kind: "on_campus" }, { publishing: false })).toBe("Choose the campus place.");
  });
  it("uses campus timezone to label the actual overnight interval", () => {
    expect(activityInterval("2026-10-20T16:30:00Z", "2026-10-21T00:30:00Z", "Asia/Kolkata")).toMatch(/ends (Oct 21|21 Oct)/);
    expect(activityDates("2026-10-21", "week")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });
  it.each([
    ["day", "2026-10-19", "2026-10-18T23:00:00Z", "2026-10-19T02:00:00Z", "00:00:00"],
    ["week", "2026-10-21", "2026-10-18T23:00:00Z", "2026-10-19T02:00:00Z", "00:00:00"],
    ["week", "2026-10-21", "2026-10-20T23:00:00Z", "2026-10-21T02:00:00Z", "00:00:00"],
    ["week", "2026-10-21", "2026-10-20T23:00:00Z", "2026-10-21T00:00:00Z", "22:00:00"],
    ["week", "2026-10-21", "2026-10-25T23:00:00Z", "2026-10-26T02:00:00Z", "22:00:00"],
  ] as const)("opens %s near the visible overnight segment for %s", (view, date, starts_at, ends_at, expected) => {
    expect(activityCalendarScrollTime(date, view, "UTC", [{ starts_at, ends_at, state: "expected" }])).toBe(expected);
  });
  it("positions local scheduled hours without treating cancelled work as visible", () => {
    const item = { starts_at: "2026-10-20T03:30:00Z", ends_at: "2026-10-20T04:30:00Z", state: "expected" as const };
    expect(activityCalendarScrollTime("2026-10-20", "day", "Asia/Kolkata", [item])).toBe("08:00:00");
    expect(activityCalendarScrollTime("2026-10-20", "day", "Asia/Kolkata", [{ ...item, state: "cancelled" }])).toBe("07:00:00");
  });
});
