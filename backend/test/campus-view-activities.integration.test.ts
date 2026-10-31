import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { CampusViewRepository } from "../src/campus-view/campus-view.repository.js";
import { CampusViewService } from "../src/campus-view/campus-view.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { createCampusSceneFixture } from "./campus-scenes.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/campus_view_unused_test",
  max: 3,
}) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());

describe.skipIf(!enabled)("Virtual campus activity projection through owning services", () => {
  it("projects a published canonical-place activity without an academic class and removes its current expectation after cancellation", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const place = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Reading room", code: "READ", kind: "library" }, resourceLoanRequest(f.user));
      const planning = new ActivityPlanningService(db, f.events, f.core, f.core, f.core, new ResponsibilityProjectionService(f.core));
      const view = new CampusViewService(new CampusViewRepository(db), f.core, f.core);
      const day = new Date(Date.parse(f.now) + 86_400_000).toISOString().slice(0, 10);
      const draft = await planning.create(resourceLoanRequest(f.user), f.schoolId, {
        idempotency_key: randomUUID(), title: "Reading circle", purpose: "other", timezone: "UTC",
        starts_on: day, ends_on: day, recurrence: "once", starts_at: "10:00", ends_at: "11:00",
        person_ids: [f.borrowerPersonId], lead_person_id: f.borrowerPersonId, space_id: String(place.id), attendance_mode: "none", location_kind: "on_campus",
      });
      await planning.publish(resourceLoanRequest(f.user), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
      const read = () => view.view(f.user, f.schoolId, { campus_id: f.campusId, at: `${day}T10:30:00.000Z` });
      const result = await read();
      expect(result.spaces.find(space => space.id === place.id)?.expected_now).toEqual([expect.objectContaining({
        title: "Reading circle", class_label: null, expected_count: 1, teacher: null, state: "in_progress",
        dimension: "expected", spatial_claim: "expected_context_only",
        source: expect.objectContaining({ label: "Published activity", record_id: draft.id, target_path: `/areas/timetable/planning?plan=${draft.id}&plan_revision=2` }),
      })]);
      expect(result.day_activity.find(item => item.title === "Reading circle")).toMatchObject({ detail: "Reading room", target_path: `/areas/timetable/planning?plan=${draft.id}&plan_revision=2` });
      expect(result.operations).toMatchObject({ current_expected_sessions: 1, expected_teachers: 0 });
      expect(result.motion).toMatchObject({ school_id: f.schoolId, campus_id: f.campusId, as_of: `${day}T10:30:00.000Z`,
        subjects: [{ kind: "person", claims: [{ space_id: place.id, expected_count: 1,
          starts_at: `${day}T10:00:00.000Z`, ends_at: `${day}T11:00:00.000Z`,
          spatial_claim: "expected_context_only", source: { domain: "timetable", record_id: draft.id, revision: 2 } }] }] });
      expect(JSON.stringify(result.motion)).not.toContain(f.borrowerPersonId);
      expect(JSON.stringify(result.motion)).not.toMatch(/person_id|label|email|phone/);
      await expect(view.view(f.borrower, f.schoolId, { campus_id: f.campusId })).rejects.toThrow("administrator");
      await planning.cancel(resourceLoanRequest(f.user), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 2, reason: "Reading circle rescheduled" });
      const cancelled = await read();
      expect(cancelled.spaces.find(space => space.id === place.id)?.expected_now).toEqual([]);
      expect(cancelled.day_activity.some(item => item.title === "Reading circle")).toBe(false);
      expect(cancelled.motion.subjects).toEqual([]);
    });
  }, 30_000);

  it("includes the after-midnight portion of an overnight reservation without inventing participants or showing it on another campus", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const place = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Night workshop", code: "NIGHT", kind: "workshop" }, resourceLoanRequest(f.user));
      const other = await f.topology.createCampus(f.user, f.schoolId, { name: "Other campus", code: "OTHER", campus_type: "branch", timezone: "UTC" }, resourceLoanRequest(f.user));
      const planning = new ActivityPlanningService(db, f.events, f.core, f.core, f.core, new ResponsibilityProjectionService(f.core));
      const repository = new CampusViewRepository(db);
      const day = new Date(Date.parse(f.now) + 86_400_000).toISOString().slice(0, 10);
      const next = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
      const draft = await planning.create(resourceLoanRequest(f.user), f.schoolId, {
        idempotency_key: randomUUID(), title: "Overnight room reservation", purpose: "other", timezone: "UTC", starts_on: day, ends_on: day,
        recurrence: "once", starts_at: "22:00", ends_at: "02:00", end_day_offset: 1, person_ids: [], space_id: String(place.id), attendance_mode: "none", location_kind: "on_campus",
      });
      await planning.publish(resourceLoanRequest(f.user), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
      expect(await repository.dayOccurrences(f.schoolId, f.campusId, `${next}T01:00:00.000Z`, "UTC")).toEqual([expect.objectContaining({
        title: "Overnight room reservation", expected_count: 0, class_label: null, planning_origin: "activity",
      })]);
      expect(await repository.dayOccurrences(f.schoolId, String(other.id), `${next}T01:00:00.000Z`, "UTC")).toEqual([]);
      const view = new CampusViewService(repository, f.core, f.core);
      expect((await view.view(f.user, f.schoolId, { campus_id: f.campusId, at: `${next}T01:00:00.000Z` })).motion.subjects).toEqual([]);
    });
  }, 30_000);
});
