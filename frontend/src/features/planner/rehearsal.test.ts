import { describe, expect, it } from "vitest";
import { resolveTimetableDisplayDate, timetableRehearsalInstant, type TimetableRehearsalIndicator } from "./rehearsal";

const rehearsal: TimetableRehearsalIndicator = {
  label: "Simulated school day",
  status: "running",
  referenceDate: "2026-10-14",
  simulatedAt: "2026-10-14T09:10:00+05:30",
  phaseLabel: "Period 1",
  phaseMode: "lesson",
  nextChangeAt: null,
  activeSlotIds: ["slot-1"],
  timeZone: "Asia/Kolkata",
  campusPath: "/principal/campus",
};

describe("timetable rehearsal display context", () => {
  it("uses the rehearsal date only when the URL does not select a date", () => {
    expect(resolveTimetableDisplayDate("2026-10-20", rehearsal, "2026-10-16")).toBe("2026-10-20");
    expect(resolveTimetableDisplayDate(null, rehearsal, "2026-10-16")).toBe("2026-10-14");
    expect(resolveTimetableDisplayDate(null, null, "2026-10-16")).toBe("2026-10-16");
  });

  it("uses the labelled simulated instant without changing the fallback clock", () => {
    const fallback = new Date("2026-10-16T05:00:00Z");
    expect(timetableRehearsalInstant(rehearsal, fallback).toISOString()).toBe("2026-10-14T03:40:00.000Z");
    expect(timetableRehearsalInstant(null, fallback)).toBe(fallback);
  });
});
