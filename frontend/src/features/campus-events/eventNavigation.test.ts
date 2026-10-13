import { describe, expect, it } from "vitest";
import { eventDetailHref, eventDetailSuffix, eventListHref } from "./eventNavigation";

describe("event navigation context", () => {
  it("restores the operations list filter without carrying attention targets", () => {
    const search = "list_view=past&view=finance&focus=refunds&attention_notification_id=notice-1";
    expect(eventListHref("/principal", search)).toBe("/principal/events?view=past");
    expect(eventDetailHref("/principal", "event-1", search)).toBe("/principal/events/event-1?list_view=past&view=finance");
  });

  it("omits default list and detail views", () => {
    expect(eventListHref("/teacher", "")).toBe("/teacher/events");
    expect(eventDetailSuffix("view=sessions")).toBe("");
  });
});
