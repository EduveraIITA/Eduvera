import { describe, expect, it } from "vitest";
import { moreAttentionCounts, type HomeAction } from "../src/school/school.service.js";

function action(kind: HomeAction["kind"], id: string): HomeAction {
  return { id, kind, priority: "normal", title: id, detail: "", status_label: "", action_label: "",
    href: "/", source_id: id, occurs_at: null, due_at: null };
}

describe("More action badges", () => {
  it("counts current actionable work by destination without treating updates as tasks", () => {
    expect(moreAttentionCounts([
      action("event_rsvp", "rsvp"), action("event_consent", "consent"), action("event_payment", "payment"),
      action("event_checklist", "checklist"), action("event_upcoming", "upcoming"), action("event_duty", "duty"),
      action("leave_signature", "leave"), action("diary_acknowledgement", "diary"),
      action("attendance_register", "register"), action("attendance_followup", "followup"),
    ], "guardian")).toEqual({ events: 4, leave: 1, diary: 1, registers: 1 });
  });

  it("does not badge decisions a student can only view while a guardian acts", () => {
    expect(moreAttentionCounts([
      { ...action("event_rsvp", "paid-rsvp"), action_label: "View event" },
      { ...action("event_consent", "consent"), action_label: "View details" },
      action("event_checklist", "preparation"),
    ], "student")).toEqual({ events: 1 });
  });
});
