import { describe, expect, it } from "vitest";

import { buildTimetableSummaryFromWeeklyTimetables, type StudentTimetableResponse } from "./api";

function week(selectedDate: string): StudentTimetableResponse {
  return {
    student: {
      id: "student-1",
      user: { id: "user-1", display_name: "Aarav Sharma" },
      admission_number: "CIS-2023-071",
      avatar_url: "",
      current_enrollment: {
        class_name: "Class 7A",
        grade: "7",
        section: "A",
        board: "CBSE",
        room_number: "204",
        roll_number: 17,
        term: { name: "Term 1", academic_year: "2026-27", starts_on: "2026-08-01", ends_on: "2026-12-16" },
      },
    },
    mode: "week",
    selected_date: selectedDate,
    class_name: "Class 7A",
    days: [
      {
        weekday: 1,
        weekday_label: "Monday",
        periods: [
          {
            id: "period-1",
            weekday: 1,
            weekday_label: "Monday",
            period_number: 1,
            starts_at: "09:00",
            ends_at: "09:45",
            display_title: "Mathematics",
            room: "204",
            subject: null,
            teacher: null,
          },
          {
            id: "period-2",
            weekday: 1,
            weekday_label: "Monday",
            period_number: 2,
            starts_at: "09:50",
            ends_at: "10:35",
            display_title: "Science",
            room: "204",
            subject: null,
            teacher: null,
            cancelled: true,
          },
        ],
      },
      {
        weekday: 3,
        weekday_label: "Wednesday",
        periods: [
          {
            id: "period-3",
            weekday: 3,
            weekday_label: "Wednesday",
            period_number: 1,
            starts_at: "09:00",
            ends_at: "09:45",
            display_title: "English",
            room: "204",
            subject: null,
            teacher: null,
            date: "2026-10-07",
          },
        ],
      },
    ],
  };
}

describe("student and parent timetable summary compatibility", () => {
  it("maps a dated published week into complete calendar totals", () => {
    const summary = buildTimetableSummaryFromWeeklyTimetables(
      [week("2026-10-08")],
      "2026-10-05",
      "2026-10-11",
    );

    expect(summary.days).toHaveLength(7);
    expect(summary.days.find((day) => day.date === "2026-10-05")).toMatchObject({
      periods: 1,
      classes: 1,
      cancelled: 1,
    });
    expect(summary.days.find((day) => day.date === "2026-10-07")).toMatchObject({
      periods: 1,
      classes: 1,
    });
    expect(summary.days.find((day) => day.date === "2026-10-11")).toMatchObject({
      periods: 0,
      classes: 0,
    });
    expect(summary.totals).toMatchObject({ periods: 2, classes: 2, cancelled: 1 });
  });
});
