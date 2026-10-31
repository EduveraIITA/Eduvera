import { describe, expect, it } from "vitest";
import { attendanceHistorySchema } from "../src/attendance/activity-attendance.contracts.js";
import { decodeAttendanceActivity, encodeAttendanceActivity } from "../src/attendance/activity-attendance-history.js";
const scope = { user_id: "11111111-1111-4111-8111-111111111111", school_id: "22222222-2222-4222-8222-222222222222",
  register_id: "33333333-3333-4333-8333-333333333333", namespace_id: "live:campus" };
const key = "command:44444444-4444-4444-8444-444444444444";
describe("attendance activity evidence locators", () => {
  it("keeps native commands distinct from retained individual evidence", () => {
    expect(decodeAttendanceActivity(encodeAttendanceActivity(scope, key), scope)).toBe(key);
    expect(decodeAttendanceActivity(encodeAttendanceActivity(scope, "evidence:decision:37"), scope)).toBe("evidence:decision:37");
    expect(() => encodeAttendanceActivity(scope, "command:------------------------------------")).toThrow();
    const extra = "attendance-activity-v1." + Buffer.from(JSON.stringify({ version: 1, ...scope, key, actor_id: scope.user_id })).toString("base64url");
    expect(() => decodeAttendanceActivity(extra, scope)).toThrow("another context");
  });
  it.each(["user_id", "school_id", "register_id", "namespace_id"] as const)("rejects another %s without accepting authority from a locator", field => {
    const other = { ...scope, [field]: field === "namespace_id" ? "scenario:other:run:other" : "55555555-5555-4555-8555-555555555555" };
    expect(() => decodeAttendanceActivity(encodeAttendanceActivity(scope, key), other)).toThrow("another context");
  });
  it.each(["", "attendance-activity-v1.???", "other.abc", "attendance-activity-v1." + "a".repeat(2100)])("rejects malformed tokens %s", token => {
    expect(() => decodeAttendanceActivity(token, scope)).toThrow("another context");
  });
  it("keeps legacy raw reads compatible and refuses conflicting read modes", () => {
    expect(attendanceHistorySchema.parse({ page: "2" })).toEqual({ page: 2, page_size: 20 });
    expect(attendanceHistorySchema.parse({ view: "activities", page_size: "8" })).toMatchObject({ view: "activities", page_size: 8 });
    expect(() => attendanceHistorySchema.parse({ view: "activities", batch: "token" })).toThrow();
    expect(() => attendanceHistorySchema.parse({ actor_id: scope.user_id })).toThrow();
  });
});
