import { describe, expect, it } from "vitest";
import {
  decodeSchoolEventChannelMessage,
  SCHOOL_EVENT_CHANNEL_VERSION,
  schoolEventChannelName,
  schoolEventLockName,
} from "./schoolEventChannel";

function eventMessage(overrides: Record<string, unknown> = {}) {
  return {
    version: SCHOOL_EVENT_CHANNEL_VERSION,
    senderTabId: "tab-leader",
    userId: "user-1",
    kind: "event",
    eventType: "attendance.updated",
    envelope: {
      id: "attendance-1",
      type: "attendance.updated",
      created_at: "2026-09-12T06:00:00.000Z",
      payload: {
        student_id: "student-1",
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: ["student.attendance", "principal.attendance"],
      },
    },
    ...overrides,
  };
}

describe("school event cross-tab channel", () => {
  it("accepts a typed, allowlisted event envelope", () => {
    expect(decodeSchoolEventChannelMessage(eventMessage())).toEqual(eventMessage());
  });

  it("relays an authorized domain event from the leader tab", () => {
    const message = eventMessage({
      eventType: "governance.policy.published",
      envelope: {
        id: "policy-event-1",
        type: "governance.policy.published",
        created_at: "2026-10-13T08:00:00.000Z",
        payload: {},
      },
    });
    expect(decodeSchoolEventChannelMessage(message)).toEqual(message);
  });

  it.each([
    eventMessage({ version: 2 }),
    eventMessage({ eventType: "school.secret.updated" }),
    eventMessage({ envelope: { ...eventMessage().envelope, type: "leave.updated" } }),
    eventMessage({ envelope: { ...eventMessage().envelope, payload: { refresh: ["untrusted.cache"] } } }),
    { version: SCHOOL_EVENT_CHANNEL_VERSION, senderTabId: "tab-1", userId: "user-1", kind: "status", status: "failed" },
  ])("rejects malformed or non-allowlisted cross-tab input", (message) => {
    expect(decodeSchoolEventChannelMessage(message)).toBeNull();
  });

  it("isolates both the lock and channel by authenticated user", () => {
    expect(schoolEventChannelName("user-1")).toBe("omnischool:school-events:user-1");
    expect(schoolEventLockName("user-1")).toBe("omnischool:school-events:leader:user-1");
    expect(schoolEventChannelName("user-1")).not.toBe(schoolEventChannelName("user-2"));
  });
});
