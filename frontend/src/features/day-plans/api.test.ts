import { describe, expect, it } from "vitest";

import type { PrincipalTimetableResponse } from "../operations/api";
import { buildAdminSummaryFromPublishedTimetables } from "./api";

const timetable: PrincipalTimetableResponse = {
  terms: [
    {
      id: "term-1",
      academic_year: "2026-27",
      name: "Term 1",
      starts_on: "2026-10-01",
      ends_on: "2026-10-31",
      is_active: true,
    },
  ],
  selected_term_id: "term-1",
  classes: [
    { id: "class-a", name: "Class 6A", grade: "6", section: "A", room_number: "201" },
    { id: "class-b", name: "Class 6B", grade: "6", section: "B", room_number: "202" },
  ],
  subjects: [],
  teachers: [],
  slots: [
    {
      id: "monday-a",
      class_section_id: "class-a",
      class_name: "Class 6A",
      subject_id: null,
      display_title: "Mathematics",
      teacher_user_id: null,
      teacher_name: null,
      weekday: 1,
      weekday_label: "Monday",
      period_number: 1,
      starts_at: "09:00",
      ends_at: "09:45",
      slot_type: "class",
      room: "201",
    },
    {
      id: "monday-b",
      class_section_id: "class-b",
      class_name: "Class 6B",
      subject_id: null,
      display_title: "Science",
      teacher_user_id: "teacher-1",
      teacher_name: "Teacher",
      weekday: 1,
      weekday_label: "Monday",
      period_number: 1,
      starts_at: "09:00",
      ends_at: "09:45",
      slot_type: "class",
      room: "202",
    },
    {
      id: "tuesday-a",
      class_section_id: "class-a",
      class_name: "Class 6A",
      subject_id: null,
      display_title: "English",
      teacher_user_id: "teacher-1",
      teacher_name: "Teacher",
      weekday: 2,
      weekday_label: "Tuesday",
      period_number: 1,
      starts_at: "09:00",
      ends_at: "09:45",
      slot_type: "class",
      room: "201",
    },
  ],
  conflicts: [],
  coverage: [],
  calendar_exceptions: [
    {
      id: "holiday",
      date: "2026-10-12",
      is_instructional: false,
      label: "Holiday",
      kind: "public_holiday",
      reason: "Public holiday",
      revision: 1,
    },
  ],
  school_date: "2026-10-02",
};

describe("principal timetable summary fallback", () => {
  it("uses the published weekly plan, selected class, and school closures", () => {
    const summary = buildAdminSummaryFromPublishedTimetables(
      [timetable],
      "2026-10-05",
      "2026-10-13",
      "class-a",
    );

    expect(summary.days.find((day) => day.date === "2026-10-05")).toMatchObject({
      periods: 1,
      classes: 1,
      pending: 1,
    });
    expect(summary.days.find((day) => day.date === "2026-10-12")).toMatchObject({
      periods: 0,
      classes: 0,
    });
    expect(summary.totals).toMatchObject({ periods: 3, classes: 3, pending: 1 });
  });
});
