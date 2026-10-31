import { describe, expect, it } from "vitest";
import {
  eventDetailHref,
  eventDetailSuffix,
  eventListHref,
  eventRelationshipParams,
  eventWorkspaceDetailHref,
  eventWorkspaceListHref,
} from "./eventNavigation";

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

  it("keeps canonical Events navigation neutral and restores its list filter", () => {
    expect(eventWorkspaceListHref("/areas/events/manage", "list_view=draft")).toBe("/areas/events/manage?view=draft");
    expect(eventWorkspaceDetailHref("/areas/events/assigned", "event 1", "list_view=past&view=participants"))
      .toBe("/areas/events/assigned/event%201?list_view=past&view=participants");
    const timetable = "/areas/timetable/planning?date=2026-10-18&view=month";
    expect(eventWorkspaceListHref("/areas/events/manage", new URLSearchParams({ return_to: timetable }))).toBe(timetable);
  });

  it("retains explicit relationship scope without carrying an attention target", () => {
    expect(eventRelationshipParams("view=past&focus=consent", "dependent", "student-1").toString())
      .toBe("scope=dependent&student_id=student-1&view=past");
  });
});
