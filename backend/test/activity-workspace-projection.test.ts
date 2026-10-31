import "reflect-metadata";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import { ActivityWorkspaceProjection } from "../src/workspace/activity-workspace.projection.js";
import type { WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";

/** Only the source read results are substituted; no database or wall clock is used. */
function projection() {
  const sourceRows: Record<string, unknown>[][] = [[{ record: false, review: false, teach: false }], []];
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => new DummyDriver(), createAdapter: () => new PostgresAdapter(),
    createIntrospector: database => new PostgresIntrospector(database), createQueryCompiler: () => new PostgresQueryCompiler(),
  } }).withPlugin({ transformQuery: ({ node }) => node,
    transformResult: ({ result }) => Promise.resolve({ ...result, rows: sourceRows.shift() ?? [] }) });
  const occurrence = (id: string, starts_at: string, ends_at: string, local_date: string) => ({
    id, source: "activity", title: "Overnight residence duty", purpose: "duty", state: "expected", starts_at, ends_at, local_date,
    timezone: "Asia/Kolkata", attendance_mode: "none", recorder_person_id: null, reviewer_person_id: null,
    participants: [{ person_id: "person", participation_role: "participant" }],
  });
  const upcoming = [
    occurrence("late", "2027-01-07T16:30:00Z", "2027-01-08T00:30:00Z", "2027-01-07"),
    occurrence("current", "2026-12-31T16:30:00Z", "2027-01-01T00:30:00Z", "2026-12-31"),
    occurrence("soon", "2027-01-01T16:30:00Z", "2027-01-02T00:30:00Z", "2027-01-01"),
  ];
  const planning = { ensureOccurrences: vi.fn().mockResolvedValue(upcoming) };
  const attendance = { pendingActivityReviews: vi.fn().mockResolvedValue([]), ensureRegister: vi.fn() };
  const identities = { resolveAccountEndpoint: vi.fn().mockResolvedValue({ acting: true, person_id: "person", agent_id: "agent" }) };
  const instance = new ActivityWorkspaceProjection(db as never, planning as never, attendance as never, identities as never);
  return { instance, planning, attendance, db };
}

describe("activity schedule facts in the shared Today projection", () => {
  it("retains source dates, full overnight intervals and links while ordering a shuffled future input", async () => {
    const { instance, planning, attendance, db } = projection();
    const snapshot: WorkspaceRepositorySnapshot = {
      institution: { id: "school", name: "Aaranya", timezone: "Asia/Kolkata" }, membership_roles: ["member"],
      realm_id: "realm", environment_namespace_id: "scenario:scenario:run:run", acting_agent_id: "agent", owner_agent_ids: ["agent"],
      assignments: [], messages: [], relationships: [],
    };
    const at = new Date("2026-12-31T17:00:00Z");
    try {
      const result = await instance.load({ id: "user" } as AuthUser, snapshot, at, "2026-12-31");
      expect(planning.ensureOccurrences).toHaveBeenCalledWith("school", "2026-12-30", "2027-01-07", undefined, { source: "activity" });
      expect(result.now).toEqual([expect.objectContaining({ id: "activity-occurrence:current", status_label: "Now",
        starts_at: "2026-12-31T16:30:00Z", ends_at: "2027-01-01T00:30:00Z", local_date: "2026-12-31",
        time_label: "Thu, Dec 31, 2026, 10:00 PM", href: "/areas/timetable/schedule?date=2026-12-31",
      })]);
      expect(result.next.map(item => item.id)).toEqual(["activity-occurrence:soon", "activity-occurrence:late"]);
      expect(result.next.map(item => item.local_date)).toEqual(["2027-01-01", "2027-01-07"]);
      expect(result.next[0]).toMatchObject({ starts_at: "2027-01-01T16:30:00Z", ends_at: "2027-01-02T00:30:00Z",
        time_label: "Fri, Jan 1, 2027, 10:00 PM", href: "/areas/timetable/schedule?date=2027-01-01" });
      expect(result.next.every(item => item.status_label === "Next" && item.detail === "Scheduled activity · 1 scheduled person")).toBe(true);
      expect(result.work).toEqual([]);
      expect(attendance.ensureRegister).not.toHaveBeenCalled();
    } finally { await db.destroy(); }
  });
});
