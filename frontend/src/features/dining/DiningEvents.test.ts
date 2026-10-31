import { describe, expect, it } from "vitest";
import { FULL_SYNC_INVALIDATIONS, resolveSchoolEvent } from "../school/schoolEventProtocol";
describe("Dining scoped realtime reconciliation", () => {
  const event = (type: string, refresh?: string[]) => JSON.stringify({ id: "event-1", type, created_at: "2026-10-24T06:30:00Z", payload: refresh ? { refresh } : {} });
  it("refreshes the selected-world Dining namespace plus ordinary Work", () => { const result = resolveSchoolEvent(event("dining.updated"), "dining.updated", "actor"); expect(result.usedFallback).toBe(false); expect(result.invalidations).toEqual(expect.arrayContaining([{ queryKey: ["dining"], environmentScoped: true }, { queryKey: ["responsibility-workspace"] }, { queryKey: ["attention"] }])); expect(result.invalidations).not.toContainEqual({ queryKey: ["dining"] }); });
  it.each(["people.updated", "staff.access.updated", "institution.setup.updated"] as const)("rechecks candidate authority/topology for %s even with an explicit producer hint", type => { expect(resolveSchoolEvent(event(type, ["workspace"]), type, "actor").invalidations).toContainEqual({ queryKey: ["dining"], environmentScoped: true }); });
  it("includes Dining in fail-closed full reconciliation", () => { expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["dining"], environmentScoped: true }); });
});
