import { describe, expect, it } from "vitest";
import { diningTodayRecords } from "../src/workspace/dining-workspace.projection.js";

type Availability = Parameters<typeof diningTodayRecords>[0]["items"][number];
const at = new Date("2026-10-25T06:45:00Z");
const row = {
  id: "date-1", service_id: "service-1", service_name: "Community kitchen", source_kind: "plan_date", source_id: "version-1",
  source_revision: 2, session_id: null, plan_id: "series-1", local_date: "2026-10-25", label: "Lunch", menu_text: "Rice and vegetables",
  starts_at: "2026-10-25T06:30:00Z", ends_at: "2026-10-25T08:30:00Z", timezone: "Asia/Kolkata", space_id: "canteen",
  space_label: "Canteen", state: "planned", changed_for_date: false, updated_at: "2026-10-24T10:00:00Z",
  href: "/areas/dining?series_id=series-1&date=2026-10-25", availability_only: true, venue_reserved: false,
} as Availability;

describe("Dining availability in the current responsible person's Today", () => {
  it("retains source links and labels an interval as planned, not physically open or a duty", () => {
    const result = diningTodayRecords({ items: [row], warnings: [] }, at);
    expect(result.now).toEqual([expect.objectContaining({
      id: "dining-availability:date-1", href: row.href, status_label: "Planned hours", detail: "Community kitchen · Canteen · Planned hours",
      source_at: row.updated_at, action_label: "Open dining", source_label: expect.stringContaining("not a venue booking or proof of service"),
      starts_at: row.starts_at, ends_at: row.ends_at, local_date: row.local_date,
    })]);
    expect(result.next).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/attendance|entitlement|count_total|operator_person_id/);
  });
  it("uses the supplied selected clock, half-open intervals and actual source cancellation/end state", () => {
    expect(diningTodayRecords({ items: [row], warnings: [] }, new Date("2026-10-25T06:29:00Z"))).toMatchObject({ now: [], next: [expect.objectContaining({ title: "Lunch" })] });
    expect(diningTodayRecords({ items: [row], warnings: [] }, new Date(row.ends_at))).toEqual({ now: [], next: [] });
    expect(diningTodayRecords({ items: [{ ...row, state: "cancelled" }, { ...row, id: "ended", state: "ended" }], warnings: [] }, at)).toEqual({ now: [], next: [] });
  });
  it("orders complete owned input before limiting the home projection and preserves date exceptions", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ ...row, id: `date-${index}`, label: `Meal ${index}`,
      starts_at: new Date(Date.parse("2026-10-25T09:00:00Z") + index * 60000).toISOString(), ends_at: "2026-10-25T13:00:00Z" }));
    expect(diningTodayRecords({ items: items.reverse(), warnings: [] }, at).next.map(item => item.title)).toEqual(["Meal 0", "Meal 1", "Meal 2", "Meal 3", "Meal 4"]);
    expect(diningTodayRecords({ items: [{ ...row, changed_for_date: true, state: "paused" }], warnings: [] }, at).now[0])
      .toMatchObject({ detail: "Community kitchen · Canteen · Paused · Changed for this date", tone: "attention" });
  });
  it("keeps an exact-owned clock-change warning visible without fabricating an instant or work count", () => {
    const warning = { plan_id: "series-1", plan_version_id: "version-1", local_date: "2026-10-25", weekday: 7,
      reason: "ambiguous_time" as const, href: row.href };
    const result = diningTodayRecords({ items: [], warnings: [warning] }, at);
    expect(result.now).toEqual([]);
    expect(result.next).toEqual([expect.objectContaining({ title: "Dining time needs review", status_label: "Time unresolved", href: row.href })]);
    expect(result.next[0]).not.toHaveProperty("time_label");
    expect(result.next[0]).toHaveProperty("local_date", warning.local_date);
    expect(result.next[0]).not.toHaveProperty("starts_at");
    expect(result.next[0]).not.toHaveProperty("ends_at");
    expect(diningTodayRecords({ items: [], warnings: [{ ...warning, reason: "cancelled_for_date" }] }, at)).toEqual({ now: [], next: [] });
  });
});
