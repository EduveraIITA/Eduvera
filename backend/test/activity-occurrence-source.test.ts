import "reflect-metadata";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database/types.js";
import { ActivityOccurrenceEngine } from "../src/schedule-planning/activity-occurrence.engine.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import type { ActivityOccurrence } from "../src/schedule-planning/activity.contracts.js";

function sourceDatabase(rows: Record<string, unknown>[][]) {
  const queries: string[] = [];
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => new DummyDriver(), createAdapter: () => new PostgresAdapter(),
    createIntrospector: database => new PostgresIntrospector(database), createQueryCompiler: () => new PostgresQueryCompiler(),
  }, log: event => { queries.push(event.query.sql); } }).withPlugin({
    transformQuery: ({ node }) => node,
    transformResult: ({ result }) => Promise.resolve({ ...result, rows: rows.shift() ?? [] }),
  });
  return { db, queries };
}

const participant = { person_id: "person", label: "Fictional person", participation_role: "participant" as const,
  source_kind: "person" as const, source_ref: "person", source_revision: 1, requirement: "required" as const };
const raw = (source: ActivityOccurrence["source"]): Record<string, unknown> => ({
  source, school_id: "school", activity_id: `${source}-activity`, plan_version_id: "plan", period_id: "period",
  source_ref: `${source}-ref`, source_revision: 1, title: `Fictional ${source}`, purpose: "teaching",
  local_date: "2026-10-26", starts_at: "2026-10-26T08:00:00.000Z", ends_at: "2026-10-26T09:00:00.000Z",
  timezone: "UTC", space_id: null, attendance_mode: "none", context_kind: "academic_class", context_ref: "class",
  term_id: "term", subject_id: null, scheduled_teacher_id: "teacher", period_number: 1, state: "expected", revision: 1,
  recorder_person_id: null, reviewer_person_id: null, location_kind: "unspecified", location_label: "", location_url: "", gap: false,
});

describe("canonical occurrence source scoping", () => {
  it("short-circuits academic SQL and never reads academic or owned event/exam rosters for the activity-only contribution", async () => {
    const { db, queries } = sourceDatabase([[raw("activity")]]);
    const engine = new ActivityOccurrenceEngine({} as never, {} as never);
    const activityPeople = vi.spyOn(engine, "activityPeople").mockResolvedValue([participant]);
    const academicPeople = vi.spyOn(engine, "academicPeople").mockResolvedValue([participant]);
    try {
      const result = await engine.expand(db as never, "school", "2026-10-25", "2026-11-02", undefined, { source: "activity" });
      expect(result.map(item => item.source)).toEqual(["activity"]);
      expect(result[0]?.participants).toEqual([participant]);
      expect(activityPeople).toHaveBeenCalledOnce();
      expect(academicPeople).not.toHaveBeenCalled();
      expect(queries).toHaveLength(1);
      // The academic CTE has a literal planner-visible false gate and is not
      // referenced by the result union, so its lateral function cannot run.
      expect(queries[0]).toContain("WHERE false AND school.id=");
      expect(queries[0]).not.toContain("gap FROM academic");
      expect(queries.some(query => query.includes("occurrence.source IN ('event','examination')"))).toBe(false);
    } finally { await db.destroy(); }
  });

  it("keeps academic, activity, event and exam expansion available by default", async () => {
    const { db, queries } = sourceDatabase([
      [raw("activity"), raw("academic")],
      [{ ...raw("event"), id: "event-id" }, { ...raw("examination"), id: "exam-id" }],
      [participant], [participant],
    ]);
    const engine = new ActivityOccurrenceEngine({} as never, {} as never);
    const activityPeople = vi.spyOn(engine, "activityPeople").mockResolvedValue([participant]);
    const academicPeople = vi.spyOn(engine, "academicPeople").mockResolvedValue([participant]);
    try {
      const result = await engine.expand(db as never, "school", "2026-10-25", "2026-11-02");
      expect(result.map(item => item.source).sort()).toEqual(["academic", "activity", "event", "examination"]);
      expect(activityPeople).toHaveBeenCalledOnce();
      expect(academicPeople).toHaveBeenCalledWith(db, "school", "class", "term", "2026-10-26", "teacher", "2026-10-26T08:00:00.000Z");
      expect(queries).toHaveLength(4);
      expect(queries[0]).toContain("WHERE true AND school.id=");
      expect(queries[0]).toContain("gap FROM academic");
      expect(queries[1]).toContain("occurrence.source IN ('event','examination')");
      expect(result.every(item => item.participants.length === 1)).toBe(true);
    } finally { await db.destroy(); }
  });

  it.each([undefined, { source: "activity" as const }])("forwards the optional source through the same retain/project service path (%j)", async query => {
    const { db } = sourceDatabase([]);
    const service = new ActivityPlanningService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const engine = (service as unknown as { engine: ActivityOccurrenceEngine }).engine;
    const expand = vi.spyOn(engine, "expand").mockResolvedValue([]);
    const retain = vi.spyOn(engine, "retain").mockResolvedValue(undefined);
    try {
      expect(await service.ensureOccurrences("school", "2026-10-25", "2026-11-02", db as never, query)).toEqual([]);
      expect(expand).toHaveBeenCalledWith(db, "school", "2026-10-25", "2026-11-02", undefined, query ?? {});
      expect(retain).toHaveBeenCalledWith(db, []);
    } finally { await db.destroy(); }
  });
});
