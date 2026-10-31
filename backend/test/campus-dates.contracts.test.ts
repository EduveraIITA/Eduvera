import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campusDateRangeInput, correctCampusDateInput, publishCampusDateInput } from "../src/campus-dates/campus-dates.contracts.js";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { rolePermissions } from "../src/roles/scoped-role-policy.js";
describe("important-date publication contract", () => {
  const input = () => ({ idempotency_key: randomUUID(), title: "Registration window", starts_on: "2026-07-27", ends_on: "2026-07-31" });
  it("uses inclusive date-only source values without institution-type or historical-time assumptions", () => {
    expect(publishCampusDateInput.parse(input())).toMatchObject({ description: "", category_label: "Campus date", academic_term_id: null, provenance: null });
    expect(campusDateRangeInput.parse({ from: "2027-01-01", until: "2027-01-31" }).page).toBe(1);
    expect(() => campusDateRangeInput.parse({ from: "2027-01-01", until: "2027-02-01" })).toThrow();
    expect(() => publishCampusDateInput.parse({ ...input(), starts_on: "2026-02-30" })).toThrow();
  });
  it("does not accept arbitrary provenance, audience, operational effects or implicit authority", () => {
    for (const extra of [{ audience: "all" }, { closes_campus: true }, { provenance: { secret: "no" } }, { provenance: { source_note: "x".repeat(1001) } }])
      expect(() => publishCampusDateInput.parse({ ...input(), ...extra })).toThrow();
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("calendar.manage");
    expect(rolePermissions("institution", ["calendar.manage"])).toEqual(["calendar.manage"]);
    for (const scope of ["class", "event", "assessment", "trip"]) expect(() => rolePermissions(scope, ["calendar.manage"])).toThrow();
    expect(correctCampusDateInput.parse({ ...input(), expected_revision: 1, reason: "Revised published dates" })).not.toHaveProperty("academic_term_id");
  });
});
