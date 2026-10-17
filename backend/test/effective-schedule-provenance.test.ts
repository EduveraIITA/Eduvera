import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleRow } from "../src/day-plans/schedule.js";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/112_effective_schedule_provenance.sql"),
  "utf8",
);
const helper = readFileSync(
  resolve(process.cwd(), "src/day-plans/schedule.ts"),
  "utf8",
);

type Provenance = Pick<
  ScheduleRow,
  | "occurrence_key"
  | "source_kind"
  | "source_record_id"
  | "source_revision"
  | "source_version"
>;

const typedProvenance: Provenance = {
  occurrence_key: "stable-occurrence",
  source_kind: "daily_plan",
  source_record_id: "11111111-1111-4111-8111-111111111111",
  source_revision: 2,
  source_version: 1,
};

describe("effective schedule provenance contract", () => {
  it("keeps the existing effective resolver as the sole precedence authority", () => {
    expect(migration).toContain(
      "FROM public.effective_school_schedule(p_school,p_date) schedule",
    );
    expect(migration).toContain(
      "SELECT DISTINCT ON(version.class_section_id,version.term_id)",
    );
    expect(migration).toContain("version.baseline ASC");
    expect(migration).toContain("version.starts_on DESC");
  });

  it("identifies daily plans, published timetables and the legacy fallback", () => {
    for (const source of [
      "daily_plan",
      "published_timetable",
      "legacy_timetable",
    ]) {
      expect(migration).toContain(`'${source}'`);
    }
    expect(migration).toContain(
      "WHEN effective.day_plan_id IS NOT NULL THEN plan.revision",
    );
    expect(migration).toContain(
      "WHEN effective.day_plan_id IS NOT NULL THEN effective.plan_version",
    );
    expect(migration).toContain(
      "WHEN published.id IS NOT NULL THEN published.revision",
    );
  });

  it("derives occurrence identity only from school, class, date and period", () => {
    expect(migration).toMatch(
      /digest\(concat_ws\(':'[\s\S]*p_school::text[\s\S]*effective\.class_section_id::text[\s\S]*p_date::text[\s\S]*effective\.period_number::text[\s\S]*\),'sha256'\)/,
    );
    const occurrenceExpression = migration.slice(
      migration.indexOf("encode(digest"),
      migration.indexOf("AS occurrence_key") + "AS occurrence_key".length,
    );
    expect(occurrenceExpression).not.toMatch(/source_|term_id|effective\.id/);
  });

  it("keeps v2 as the source contract while consumers use the additive coverage-aware v3 view", () => {
    expect(helper).toContain("sql<ScheduleRow>");
    expect(migration).toContain("effective_school_schedule_v2");
    expect(helper).toContain("effective_school_schedule_v3");
    expect(typedProvenance.source_kind).toBe("daily_plan");
    expect(typedProvenance.source_version).toBe(1);
  });

  it("does not expose the database function directly to browser roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.effective_school_schedule_v2(uuid,date) FROM PUBLIC",
    );
    expect(migration).toContain("ARRAY['anon','authenticated']");
    expect(migration).not.toMatch(/SECURITY DEFINER|GRANT\s+/i);
  });
});
