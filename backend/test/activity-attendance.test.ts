import { describe, expect, it } from "vitest";
import { attendancePageSchema, participationCounts, participationEvidenceSchema, participationMarksSchema,
  participationRosterFingerprint } from "../src/attendance/activity-attendance.contracts.js";

const person = "00000000-0000-4000-8000-000000000001";
describe("participant-neutral attendance contracts", () => {
  it("keeps not recorded distinct from absent and calculates factual counts", () => {
    expect(participationCounts([{ status: null }, { status: "present" }, { status: "absent" }, { status: "excused" }]))
      .toEqual({ participants: 4, recorded: 3, unrecorded: 1, present: 1, absent: 1, late: 0, excused: 1, half_day: 0 });
  });
  it("accepts one person identity without an account, enrollment or job title", () => {
    expect(participationMarksSchema.parse({ expected_revision: 0, records: [{ person_id: person, status: "present" }] }))
      .toEqual({ expected_revision: 0, records: [{ person_id: person, status: "present", remarks: "" }] });
  });
  it("supports an explicit draft withdrawal without interpreting unknown as absent", () => {
    expect(participationMarksSchema.parse({ expected_revision: 1, reason: "Wrong row selected", records: [{ person_id: person, status: null }] }).records[0]!.status).toBeNull();
  });
  it("rejects duplicate participant decisions and unreviewed object fields", () => {
    expect(() => participationMarksSchema.parse({ expected_revision: 0, records: [
      { person_id: person, status: "present" }, { person_id: person, status: "absent" },
    ] })).toThrow("only once");
    expect(() => participationMarksSchema.parse({ expected_revision: 0, grant_account: true, records: [{ person_id: person, status: "present" }] })).toThrow();
  });
  it("requires a reviewed adapter instead of accepting a human's claimed device authority", () => {
    expect(() => participationEvidenceSchema.parse({ expected_revision: 0, person_id: person,
      claimed_status: "present", capture_channel: "registered_device", observed_at: "2026-10-20T04:00:00Z", note: "Claimed scan" })).toThrow();
  });
  it("bounds register and history pages", () => {
    expect(attendancePageSchema.parse({ page: "2", page_size: "25" })).toEqual({ page: 2, page_size: 25 });
    expect(() => attendancePageSchema.parse({ page_size: 1000 })).toThrow();
    expect(() => attendancePageSchema.parse({ page: 0 })).toThrow();
  });
  it("canonicalizes roster order but retains membership revisions and roles", () => {
    const first = { person_id: person, source_kind: "person", source_ref: person, source_revision: 1, participation_role: "participant", requirement: "required" };
    const second = { ...first, person_id: "00000000-0000-4000-8000-000000000002" };
    expect(participationRosterFingerprint([first, second])).toBe(participationRosterFingerprint([second, first]));
    expect(participationRosterFingerprint([first])).not.toBe(participationRosterFingerprint([{ ...first, source_revision: 2 }]));
    expect(participationRosterFingerprint([first])).not.toBe(participationRosterFingerprint([{ ...first, participation_role: "lead" }]));
  });
});
