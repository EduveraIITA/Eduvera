import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/111_campus_model_temporal_schedule_lineage.sql"),
  "utf8",
);
const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);
const schedulePlanning = readFileSync(
  resolve(process.cwd(), "src/schedule-planning/schedule-planning.service.ts"),
  "utf8",
);

describe("campus model temporal schedule lineage", () => {
  it("adds a stable journal cursor and append-only occurrence revisions", () => {
    expect(migration).toContain(
      "journal_sequence bigint GENERATED ALWAYS AS IDENTITY",
    );
    expect(migration).toContain(
      "ALTER COLUMN recorded_at SET DEFAULT clock_timestamp()",
    );
    expect(migration).toContain("logical_occurrence_key char(64)");
    expect(migration).toContain("basis_event_id uuid");
    expect(migration).toContain("change_event_id uuid");
    expect(migration).toContain("condition_event_id uuid");
    expect(migration).toContain("recorded_from timestamptz");
    expect(migration).toContain("recorded_until timestamptz");
    expect(migration).toContain("supersedes_occurrence_id uuid");
    expect(migration).toContain("campus_model_occurrence_current_key");
    expect(migration).toContain("campus_model_occurrence_single_successor");
    expect(migration).toContain("WHERE recorded_until IS NULL");
  });

  it("keeps plan basis and later changes as separate tenant-bound evidence", () => {
    expect(migration).toContain(
      "FOREIGN KEY(basis_event_id,school_id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY(change_event_id,school_id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY(condition_event_id,school_id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY(supersedes_occurrence_id,school_id)",
    );
    expect(migration).toContain("'closure_cancelled'");
    expect(migration).toContain("'closure_restored'");
    expect(migration).toContain("'day_plan_cancelled'");
    expect(migration).toContain("'substituted'");
    expect(migration).toContain("'calendar.closure_created'");
    expect(migration).toContain("'captured_by','migration-111'");
  });

  it("guards history against in-place semantic edits", () => {
    expect(migration).toContain(
      "Recorded schedule occurrence history is append-only",
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain(
      "Recorded schedule occurrence history is immutable",
    );
    expect(migration).toContain(
      "Close a schedule occurrence revision; append its replacement separately",
    );
    expect(migration).toContain(
      "to_jsonb(NEW)-ARRAY['recorded_until','projected_at']::text[]",
    );
  });

  it("resolves valid time and recorded time independently", () => {
    expect(core).toContain(
      "occurrence.recorded_from<=${recordedAsOf}::timestamptz",
    );
    expect(core).toContain(
      "occurrence.recorded_until IS NULL OR occurrence.recorded_until>${recordedAsOf}::timestamptz",
    );
    expect(core).toContain("event.id=occurrence.basis_event_id");
    expect(core).toContain("change_event.id=occurrence.change_event_id");
    expect(core).toContain("condition_event.id=occurrence.condition_event_id");
    expect(core).toContain("basis_event_id,change_event_id,condition_event_id");
    expect(core).toContain("occurrence.logical_occurrence_key::text AS occurrence_id");
    expect(core).toContain("occurrence.id::text AS occurrence_revision_id");
    expect(core).not.toContain(
      "now()>=occurrence.starts_at AND now()<occurrence.ends_at AS current",
    );
  });

  it("keeps replay receipts stable after a later plan supersedes the event", () => {
    const originalEffectQueries = core.match(
      /basis_event_id=\$\{event\.id\}::uuid\s+AND change_event_id=\$\{event\.id\}::uuid/g,
    );
    expect(originalEffectQueries).toHaveLength(2);
  });

  it("projects the frozen term baseline before its dated replacement", () => {
    const baselineProjection = schedulePlanning.indexOf(
      "if(frozenBaselineId)await this.projectPublishedSchedule",
    );
    const datedProjection = schedulePlanning.indexOf(
      "await this.projectPublishedSchedule(db,req,id,publishedRevision)",
    );
    expect(baselineProjection).toBeGreaterThan(-1);
    expect(datedProjection).toBeGreaterThan(baselineProjection);
    expect(schedulePlanning).toContain(
      "if(Number(copied.numAffectedRows ?? 0)>0)frozenBaselineId=frozen.id",
    );
  });
});
