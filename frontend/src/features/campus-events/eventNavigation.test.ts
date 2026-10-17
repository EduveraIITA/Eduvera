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

  it("returns planner-created events to the planner without allowing arbitrary redirects", () => {
    const returnTo = "/principal/planner?date=2026-10-14&view=week";
    const search = new URLSearchParams({ return_to: returnTo });
    expect(eventListHref("/principal", search)).toBe(returnTo);
    expect(eventDetailHref("/principal", "event-1", search)).toBe(`/principal/events/event-1?return_to=${encodeURIComponent(returnTo)}`);
    expect(eventListHref("/principal", "return_to=https%3A%2F%2Fevil.example")).toBe("/principal/events");
  });

  it("returns newly created events to the canonical timetable", () => {
    const returnTo = "/principal/timetable?date=2026-10-14&view=month";
    const search = new URLSearchParams({ return_to: returnTo });
    expect(eventListHref("/principal", search)).toBe(returnTo);
  });
});
