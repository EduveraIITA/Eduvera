import { describe, expect, it } from "vitest";
import { communicationHoursOpen, DEFAULT_CHAT_POLICY, directMessagingAllowed, evaluateChatWritePolicy, type ChatPolicy } from "../src/chat/chat-policy.js";

const policy = (changes: Partial<ChatPolicy> = {}): ChatPolicy => ({ ...DEFAULT_CHAT_POLICY, school_id: "test", timezone: "Asia/Kolkata", ...changes });

describe("campus messaging policy", () => {
  it("uses local campus time, inclusive start and exclusive end", () => {
    const value = policy({ enforce_communication_hours: true, communication_start: "09:00", communication_end: "17:00" });
    expect(communicationHoursOpen(value, new Date("2026-10-27T03:29:59Z"))).toBe(false);
    expect(communicationHoursOpen(value, new Date("2026-10-27T03:30:00Z"))).toBe(true);
    expect(communicationHoursOpen(value, new Date("2026-10-27T11:29:59Z"))).toBe(true);
    expect(communicationHoursOpen(value, new Date("2026-10-27T11:30:00Z"))).toBe(false);
  });

  it("supports overnight ranges and equal times as all day", () => {
    const value = policy({ enforce_communication_hours: true, communication_start: "21:00", communication_end: "06:00" });
    expect(communicationHoursOpen(value, new Date("2026-10-27T16:00:00Z"))).toBe(true);
    expect(communicationHoursOpen(value, new Date("2026-10-27T23:00:00Z"))).toBe(true);
    expect(communicationHoursOpen(value, new Date("2026-10-28T00:30:00Z"))).toBe(false);
    expect(communicationHoursOpen({ ...value, communication_start: "06:00" }, new Date("2026-10-27T06:30:00Z"))).toBe(true);
  });

  it("uses the campus DST offset rather than the process timezone", () => {
    const value = policy({ timezone: "America/New_York", enforce_communication_hours: true, communication_start: "09:00", communication_end: "10:00" });
    expect(communicationHoursOpen(value, new Date("2026-07-01T13:00:00Z"))).toBe(true);
    expect(communicationHoursOpen(value, new Date("2026-12-01T13:00:00Z"))).toBe(false);
    expect(communicationHoursOpen(value, new Date("2026-12-01T14:00:00Z"))).toBe(true);
  });

  it("keeps direct restrictions symmetric and never promotes an additional admin role", () => {
    const value = policy({ student_teacher_direct_enabled: false, guardian_teacher_direct_enabled: false });
    for (const learner of [["student"], ["guardian"], ["student", "admin"]] as const) {
      expect(directMessagingAllowed(value, learner, ["staff"])).toBe(false);
      expect(directMessagingAllowed(value, ["staff"], learner)).toBe(false);
    }
    expect(directMessagingAllowed(value, ["staff"], ["staff"])).toBe(true);
    // The saved switches explicitly target teaching-staff pairs, not every
    // institution contact. All ordinary authority checks still apply.
    expect(directMessagingAllowed(value, ["student"], ["admin"])).toBe(true);
  });

  it("enforces student and guardian group roles but preserves actual moderator authority", () => {
    const value = policy({ student_group_replies: false, guardian_group_replies: false });
    expect(evaluateChatWritePolicy({ policy: value, kind: "group", senderRoles: ["student"] }).code).toBe("GROUP_REPLIES_DISABLED");
    expect(evaluateChatWritePolicy({ policy: value, kind: "group", senderRoles: ["guardian", "admin"] }).code).toBe("GROUP_REPLIES_DISABLED");
    expect(evaluateChatWritePolicy({ policy: value, kind: "group", senderRoles: ["student"], moderator: true }).allowed).toBe(true);
    expect(evaluateChatWritePolicy({ policy: value, kind: "group", senderRoles: ["staff"] }).allowed).toBe(true);
  });

  it("blocks attachments without blocking text and keeps hours effective for moderators", () => {
    const value = policy({ attachments_enabled: false });
    expect(evaluateChatWritePolicy({ policy: value, kind: "direct", senderRoles: ["staff"] }).allowed).toBe(true);
    expect(evaluateChatWritePolicy({ policy: value, kind: "direct", senderRoles: ["staff"], hasAttachment: true }).code).toBe("ATTACHMENTS_DISABLED");
    expect(evaluateChatWritePolicy({ policy: { ...value, enforce_communication_hours: true }, kind: "group", senderRoles: ["admin"], moderator: true, now: new Date("2026-10-27T18:00:00Z") }).code).toBe("COMMUNICATION_HOURS");
  });

  it("fails closed on invalid enforced hours and institution timezone", () => {
    expect(() => communicationHoursOpen(policy({ enforce_communication_hours: true, communication_start: "25:00" }))).toThrow();
    expect(() => communicationHoursOpen(policy({ enforce_communication_hours: true, timezone: "Not/AZone" }))).toThrow();
  });
});
