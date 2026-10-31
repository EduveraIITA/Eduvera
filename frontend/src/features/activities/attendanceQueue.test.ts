import { describe, expect, it } from "vitest";
import { registerCategory, registerKindLabel, registerListParams } from "./attendanceQueue";

describe("dated attendance list context", () => {
  it("preserves every filter and page on register open and Back", () => {
    const original = new URLSearchParams("date=2026-10-20&page=4&attendance_view=needs_recording&activity_kind=duty&search=North");
    const opened = registerListParams(original, { register_id: "register-4" });
    expect(opened.get("page")).toBe("4");
    expect(registerListParams(opened, { register_id: "", occurrence_id: "" }).toString()).toBe(original.toString());
    expect(registerListParams(original, { search: "South" }).has("page")).toBe(false);
    expect(registerListParams(original, { page: "5" }).get("search")).toBe("North");
  });
  it("uses purpose-neutral views and useful labels, not student/staff portals", () => {
    expect(registerCategory("students")).toBe("all");
    expect(registerCategory("cancelled")).toBe("cancelled");
    expect(registerKindLabel("duty")).toBe("Duties");
    expect(registerKindLabel("future_context")).toBe("future context");
  });
});
