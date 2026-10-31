import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { moduleHref } from "../src/attention/attention.service.js";

const migration = await readFile(
  new URL("../migrations/147_canonical_calendar_links.sql", import.meta.url),
  "utf8",
);

describe("canonical responsibility-composed calendar links", () => {
  it("keeps relationship and responsibility context explicit", () => {
    expect(moduleHref("parent", "calendar", "student/1"))
      .toBe("/areas/calendar?scope=dependent&student_id=student%2F1");
    expect(moduleHref("teacher", "calendar"))
      .toBe("/areas/calendar?surface=assigned");
    expect(moduleHref("principal", "calendar"))
      .toBe("/areas/calendar?surface=manage");
  });

  it("repairs retained links without rewriting published delivery evidence", () => {
    expect(migration).toContain("UPDATE notifications");
    expect(migration).toContain("event.published_at IS NULL");
    expect(migration).toContain("UPDATE campus_model_operational_messages");
    expect(migration).toContain("/areas/timetable/calendar?scope=dependent");
    expect(migration).toContain("/areas/timetable/calendar?scope=self");
    expect(migration).toContain("/areas/timetable/calendar?surface=assigned");
    expect(migration).toContain("/areas/timetable/calendar?surface=manage");
  });
});
