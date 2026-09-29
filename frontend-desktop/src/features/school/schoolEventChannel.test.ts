import { describe, expect, it } from "vitest";
import {
  decodeSchoolEventChannelMessage,
  SCHOOL_EVENT_CHANNEL_VERSION,
  schoolEventChannelName,
  schoolEventLockName,
} from "./schoolEventChannel";

const validEvent = {
  version: SCHOOL_EVENT_CHANNEL_VERSION,
  senderTabId: "tab-main",
  userId: "user-1",
  kind: "event",
  eventType: "attendance.updated",
  envelope: {
    id: "event-1",
    type: "attendance.updated",
    created_at: "2026-09-13T06:00:00.000Z",
    payload: { class_section_id: "class-7a", refresh: ["teacher.attendance"] },
  },
};

describe("desktop cross-bundle event channel", () => {
  it("accepts the main app's versioned, allowlisted message contract", () => {
    expect(decodeSchoolEventChannelMessage(validEvent)).toEqual(validEvent);
  });

  it("rejects a different version, event type, or refresh target", () => {
    expect(decodeSchoolEventChannelMessage({ ...validEvent, version: 2 })).toBeNull();
    expect(decodeSchoolEventChannelMessage({ ...validEvent, eventType: "school.secret.updated" })).toBeNull();
    expect(decodeSchoolEventChannelMessage({
      ...validEvent,
      envelope: { ...validEvent.envelope, payload: { refresh: ["untrusted.cache"] } },
    })).toBeNull();
  });

  it("uses the same user-scoped channel and lock names as the main app", () => {
    expect(schoolEventChannelName("user-1")).toBe("omnischool:school-events:user-1");
    expect(schoolEventLockName("user-1")).toBe("omnischool:school-events:leader:user-1");
  });
});
