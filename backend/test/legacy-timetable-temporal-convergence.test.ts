import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyTimetableSlotChangeProjectionSchema } from "../src/campus-model-core/contracts.js";

const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);
const school = readFileSync(
  resolve(process.cwd(), "src/school/school.service.ts"),
  "utf8",
);
const activation = readFileSync(
  resolve(process.cwd(), "src/institution-activation/institution-activation.service.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(process.cwd(), "migrations/115_legacy_timetable_temporal_convergence.sql"),
  "utf8",
);

function between(contents: string, start: string, end: string) {
  const from = contents.indexOf(start);
  const to = contents.indexOf(end, from + start.length);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return contents.slice(from, to);
}

function expectOrdered(operation: string, markers: string[]) {
  let prior = -1;
  for (const marker of markers) {
    const at = operation.indexOf(marker);
    expect(at, `missing ${marker}`).toBeGreaterThan(prior);
    prior = at;
  }
}

const ids = {
  school: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  source: "10000000-0000-4000-8000-000000000003",
  term: "10000000-0000-4000-8000-000000000004",
  section: "10000000-0000-4000-8000-000000000005",
  teacher: "10000000-0000-4000-8000-000000000006",
  correlation: "10000000-0000-4000-8000-000000000007",
};

function projectionInput(action: "created" | "updated" | "deleted") {
  const revision = action === "created" ? 1 : 2;
  return {
    school_id: ids.school,
    actor_user_id: ids.actor,
    action,
    source_record_id: ids.source,
    source_revision: revision,
    previous_source_revision: action === "created" ? null : revision - 1,
    term_id: ids.term,
    starts_on: "2026-04-01",
    ends_on: "2027-03-31",
    timezone: "Asia/Kolkata",
    occurred_at: "2026-10-16T09:00:00+05:30",
    class_section: {
      kind: "class",
      domain: "academic_structure",
      domain_id: ids.section,
      label: "Class 6A",
      lifecycle_state: "active",
      source_revision: 1,
      metadata: {},
    },
    slot: {
      weekday: 1,
      period_number: 1,
      starts_at: "09:00:00",
      ends_at: "09:45:00",
      title: "Mathematics",
      slot_type: "class",
      teacher_user_id: ids.teacher,
      subject: null,
      space: null,
      room_snapshot: "Room 201",
    },
    correlation_id: ids.correlation,
  } as const;
}

describe("legacy timetable temporal convergence", () => {
  it("requires a monotonic source revision for every mutable-slot action", () => {
    expect(legacyTimetableSlotChangeProjectionSchema.parse(projectionInput("created")))
      .toMatchObject({ source_revision: 1, previous_source_revision: null });
    expect(legacyTimetableSlotChangeProjectionSchema.parse(projectionInput("updated")))
      .toMatchObject({ source_revision: 2, previous_source_revision: 1 });
    expect(legacyTimetableSlotChangeProjectionSchema.parse(projectionInput("deleted")))
      .toMatchObject({ source_revision: 2, previous_source_revision: 1 });
    expect(() => legacyTimetableSlotChangeProjectionSchema.parse({
      ...projectionInput("updated"),
      previous_source_revision: null,
    })).toThrow(/immediately preceding revision/i);
  });

  it("versions the legacy domain source and exposes its real revision to the precedence resolver", () => {
    expect(migration).toContain("ADD COLUMN revision integer NOT NULL DEFAULT 1");
    expect(migration).toContain("NEW.revision := OLD.revision + 1");
    expect(migration).toContain("CREATE TRIGGER timetable_slots_revision_guard");
    expect(migration).toContain("ELSE legacy_slot.revision");
    expect(migration).not.toMatch(/ELSE\s+1\s+END AS source_revision/);
  });

  it("backfills retained slots as idempotent provenance without recreating person agents", () => {
    expect(migration).toContain("'timetable.legacy_slot_imported'");
    expect(migration).toContain("'timetable.legacy-slot-imported:'||slot.id::text||':'||slot.revision::text");
    expect(migration).toContain("ON CONFLICT(school_id,idempotency_key) DO NOTHING");
    expect(migration).toContain("campus_model_agent_endpoints endpoint");
    expect(migration).not.toContain("INSERT INTO public.campus_model_agents");
    expect(migration).toContain("WHEN candidate.closed THEN 'closure_cancelled' ELSE 'projection_backfill'");
    expect(migration).toContain("plan.published_version IS NOT NULL");
    expect(migration).toContain("version.state='published'");
  });

  it("recovers accepted cover hidden by a closure from exact retained source evidence", () => {
    expect(migration).toContain("WITH retained_closed_cover AS MATERIALIZED");
    expect(migration).toContain("AND NOT closure.is_instructional");
    for (const source of ["daily_plan", "published_timetable", "legacy_timetable"]) {
      expect(migration).toContain(`'${source}'`);
    }
    expect(migration).toContain("period.id=task.source_schedule_id");
    expect(migration).toContain("slot.id=task.source_schedule_id");
    expect(migration).toContain("audit.action='accepted'");
    expect(migration).toContain("audit.actor_id=replacement.user_id");
    expect(migration).toContain("ON CONFLICT(school_id,coverage_task_id) DO NOTHING");
  });

  it("projects each mutation as an append-only plan event and occurrence revision", () => {
    const projection = between(
      core,
      "  async recordLegacyTimetableSlotChange(",
      "  async recordCalendarClosure(",
    );
    for (const action of ["created", "updated", "deleted"]) {
      expect(projection).toContain(`legacy_slot_\${input.action}`);
      expect(projectionInput(action as "created" | "updated" | "deleted").action)
        .toBe(action);
    }
    expect(projection).toContain("source_record_id=${input.source_record_id}");
    expect(projection).toContain("slot.revision=${input.source_revision}");
    expect(projection).toContain("recorded_until=GREATEST");
    expect(projection).toContain("'source_removed' ELSE 'source_changed'");
    expect(projection).toContain("supersedes_occurrence_id,change_kind");
    expect(projection).not.toContain("DELETE FROM campus_model_schedule_occurrences");
  });

  it("leaves published schedules and dated plans above the mutable fallback", () => {
    const projection = between(
      core,
      "  async recordLegacyTimetableSlotChange(",
      "  async recordCalendarClosure(",
    );
    expect(projection.match(/FROM day_plans plan/g)?.length).toBeGreaterThanOrEqual(2);
    expect(projection.match(/FROM schedule_versions version/g)?.length).toBeGreaterThanOrEqual(2);
    expect(projection).toContain("plan.published_version IS NOT NULL");
    expect(projection).toContain("version.state='published'");
    expect(projection).toContain("candidates.closure_event_id");
  });

  it("orders create, update and delete around accepted-cover preparation and reconciliation", () => {
    expectOrdered(between(
      school,
      "  async createTimetableSlot(",
      "  async updateTimetableSlot(",
    ), [
      "prepareLegacyTimetableSubstitutions",
      'insertInto("timetable_slots")',
      "projectLegacyTimetableSlotChange",
      "reconcileLegacyTimetableSubstitutions",
    ]);
    expectOrdered(between(
      school,
      "  async updateTimetableSlot(",
      "  async deleteTimetableSlot(",
    ), [
      "prepareLegacyTimetableSubstitutions",
      'updateTable("timetable_slots")',
      "projectLegacyTimetableSlotChange",
      "reconcileLegacyTimetableSubstitutions",
    ]);
    expectOrdered(between(
      school,
      "  async deleteTimetableSlot(",
      "  async copyTimetableDay(",
    ), [
      "prepareLegacyTimetableSubstitutions",
      'deleteFrom("timetable_slots")',
      "projectLegacyTimetableSlotChange",
      "reconcileLegacyTimetableSubstitutions",
    ]);
  });

  it("locks and verifies the exact retained revision before update or delete", () => {
    const update = between(
      school,
      "  async updateTimetableSlot(",
      "  async deleteTimetableSlot(",
    );
    const remove = between(
      school,
      "  async deleteTimetableSlot(",
      "  async copyTimetableDay(",
    );
    for (const operation of [update, remove]) {
      expect(operation).toContain(".forUpdate().executeTakeFirst()");
      expect(operation).toContain("lockedCurrent.revision !== current.revision");
      expect(operation.indexOf("lockedCurrent.revision !== current.revision"))
        .toBeLessThan(operation.indexOf("prepareLegacyTimetableSubstitutions"));
    }
  });

  it("validates subject ownership and keeps retained subject joins tenant-scoped", () => {
    const create = between(
      school,
      "  async createTimetableSlot(",
      "  async updateTimetableSlot(",
    );
    const update = between(
      school,
      "  async updateTimetableSlot(",
      "  async deleteTimetableSlot(",
    );
    for (const operation of [create, update]) {
      expect(operation).toContain('.selectFrom("subjects")');
      expect(operation).toContain('.where("school_id", "=", membership.school_id)');
      expect(operation).toContain("Selected subject does not belong to this school.");
    }
    expect(migration.match(/subject\.school_id=section\.school_id/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it("prepares a copied day once, then projects every removed and created source before reconciliation", () => {
    const operation = school.slice(school.indexOf("  async copyTimetableDay("));
    expectOrdered(operation, [
      "prepareLegacyTimetableSubstitutions",
      'deleteFrom("timetable_slots")',
      'insertInto("timetable_slots")',
      "for (const removed",
      "for (const created",
      "reconcileLegacyTimetableSubstitutions",
    ]);
    expect(operation).toContain('"deleted",removed,removed.revision + 1');
    expect(operation).toContain('"created",created');
  });

  it("projects the activation quick-start timetable instead of bypassing the Core", () => {
    const operation = between(
      activation,
      "  async quickStart(",
      "  async review(",
    );
    expectOrdered(operation, [
      "prepareEffectiveCoverageProjection",
      "INSERT INTO timetable_slots",
      "recordLegacyTimetableSlotChange",
      "reconcileEffectiveCoverage",
    ]);
    expect(operation).toContain("previous_source_revision: null");
    expect(operation).toContain("coverage_projection_preparation: coveragePreparation");
    expect(operation).toContain("temporal_projection: temporalProjection");
    expect(operation).toContain("coverage_reconciliation: coverageReconciliation");
  });
});
