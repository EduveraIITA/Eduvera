import { describe, expect, it } from "vitest";
import { rulesSchema } from "../src/operating-rules/rules.js";

const rules = { event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 30, message_edit_minutes: 2, message_attachment_mb: 10, attendance_submission_cutoff: "10:30" };
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
  ])("rejects invalid %s value %s", (key, value) => {
    expect(rulesSchema.safeParse({ ...rules, [key]: value }).success).toBe(false);
  });
  it("rejects arbitrary settings instead of accepting an unvalidated configuration blob", () => {
    expect(rulesSchema.safeParse({ ...rules, bypass_consent: true }).success).toBe(false);
  });
});
