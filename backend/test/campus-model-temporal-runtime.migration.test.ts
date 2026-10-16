import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "migrations/104_campus_model_temporal_runtime.sql"), "utf8");

describe("campus model temporal runtime migration", () => {
  it("stores immutable event evidence separately from rebuildable occurrences", () => {
    expect(migration).toContain("CREATE TABLE campus_model_events");
    expect(migration).toContain("CREATE TABLE campus_model_schedule_occurrences");
    expect(migration).toContain("event_at timestamptz NOT NULL");
    expect(migration).toContain("effective_from timestamptz NOT NULL");
    expect(migration).toContain("recorded_at timestamptz NOT NULL");
    expect(migration).toContain("UNIQUE(school_id,idempotency_key)");
  });

  it("retains tenant boundaries and denies direct browser access", () => {
    expect(migration).toContain("FOREIGN KEY(source_event_id,school_id)");
    expect(migration).toContain("FOREIGN KEY(responsible_agent_id,school_id)");
    expect(migration).toContain("FOREIGN KEY(causation_event_id,school_id)");
    expect(migration).toContain("FOREIGN KEY(supersedes_event_id,school_id)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FROM PUBLIC");
    expect(migration).toContain("ARRAY['anon','authenticated']");
    expect(migration).toContain("FROM %I");
  });

  it("does not encode observed presence into timetable occurrences", () => {
    expect(migration).toContain("state IN ('expected','cancelled','superseded')");
    expect(migration).not.toMatch(/confirmed_present|known_location|attendance_status/);
  });
});
