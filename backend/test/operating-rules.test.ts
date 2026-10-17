import { describe, expect, it } from "vitest";
import { rulesSchema } from "../src/operating-rules/rules.js";

const rules = { attendance_academic_mode: "scheduled_session", attendance_campus_mode: "none", attendance_academic_channels: ["staff_roll_call"], attendance_campus_channels: ["staff_entry"], attendance_self_check_in_mode: "staff_review", attendance_session_open_before_minutes: 10, attendance_session_close_after_minutes: 30, attendance_finalization_mode: "automatic", attendance_auto_finalize_minutes: 30, attendance_overdue_reminder_minutes: 15, attendance_overdue_escalation_minutes: 60, event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 30, message_edit_minutes: 2, message_attachment_mb: 10, attendance_submission_cutoff: "10:30" };
describe("institution operating rule contract", () => {
  it("accepts current defaults and disabled editing", () => {
    expect(rulesSchema.parse(rules)).toEqual(rules);
    expect(rulesSchema.parse({ ...rules, message_edit_minutes: 0 }).message_edit_minutes).toBe(0);
  });
  it.each([
    ["event_entry_hours_before", -1], ["event_entry_hours_before", 169],
    ["event_staff_hours_after", 721], ["journey_lead_minutes", 241],
    ["message_edit_minutes", 61], ["message_attachment_mb", 11],
    ["message_attachment_mb", 0], ["attendance_submission_cutoff", "24:00"],
    ["attendance_submission_cutoff", "10:61"], ["journey_lead_minutes", 1.5],
    ["attendance_finalization_mode", "silent"], ["attendance_auto_finalize_minutes", -1],
    ["attendance_auto_finalize_minutes", 1441],
    ["attendance_overdue_reminder_minutes", -1], ["attendance_overdue_escalation_minutes", 2881],
    ["attendance_academic_mode", "subject-ish"], ["attendance_campus_mode", "maybe"],
    ["attendance_academic_channels", []], ["attendance_academic_channels", ["face_magic"]],
    ["attendance_campus_channels", []], ["attendance_self_check_in_mode", "unrestricted"],
    ["attendance_session_open_before_minutes", 241], ["attendance_session_close_after_minutes", 1441],
  ])("rejects invalid %s value %s", (key, value) => {
    expect(rulesSchema.safeParse({ ...rules, [key]: value }).success).toBe(false);
  });
  it("requires escalation to follow the first reminder", () => {
    expect(rulesSchema.safeParse({ ...rules, attendance_overdue_reminder_minutes: 60, attendance_overdue_escalation_minutes: 60 }).success).toBe(false);
  });
  it("rejects arbitrary settings instead of accepting an unvalidated configuration blob", () => {
    expect(rulesSchema.safeParse({ ...rules, bypass_consent: true }).success).toBe(false);
  });
});
