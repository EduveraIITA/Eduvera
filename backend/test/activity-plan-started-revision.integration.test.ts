import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test", max: 3,
}) }) });
const connection = db as DatabaseService;
const core = new CampusModelCoreService(connection);
const planning = new ActivityPlanningService(connection, new SchoolEventService(connection, core), core, core, core, new ResponsibilityProjectionService(core));
const attendance = new ActivityAttendanceService(connection, core, core, core, core, core);
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;
afterAll(() => db.destroy());

async function fixture(starts = "09:00", ends = "10:00") {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `started-${suffix}`, email: `started-${suffix}@example.test`,
    first_name: "Revision", last_name: "Owner", role: "admin", password_hash: "isolated-test-only" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "UTC"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let now = new Date(`${day}T08:30:00.000Z`);
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
  const run = <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(environment, work);
  const actor = await run(() => db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: now.toISOString() })));
  if (!actor.acting) throw new Error("An acting founder is required by this isolated fixture.");
  const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Retained participant" }).returning("id").executeTakeFirstOrThrow();
  const input = { title: "Recurring attendance", purpose: "duty", timezone: "UTC", starts_on: day, recurrence: "weekly",
    weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: starts, ends_at: ends, person_ids: [person.id], attendance_mode: "roll_call",
    recorder_person_id: actor.person_id, reviewer_person_id: actor.person_id };
  const source = await run(async () => {
    const draft = await planning.create(request(user), schoolId, { ...input, idempotency_key: randomUUID() });
    return planning.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
  });
  const occurrence = (await run(() => planning.ensureOccurrences(schoolId, day, day))).find(item => item.plan_version_id === source.id)!;
  const retained = () => sql<{ state: string; revision: number }>`SELECT state,revision FROM schedule_activity_occurrences WHERE id=${occurrence.id}::uuid`.execute(db);
  return { schoolId, user, personId: person.id, day, input, source, occurrence, run, retained,
    setNow: (time: string) => { now = new Date(`${day}T${time}:00.000Z`); } };
}

describe.runIf(enabled)("dated activity changes cannot rewrite started recurring expectations", () => {
  it("refuses a same-day change after an earlier occurrence starts and preserves accepted attendance and its source", async () => {
    const f = await fixture();
    await f.run(async () => {
      f.setNow("09:30");
      const register = await attendance.ensureRegister(f.schoolId, f.occurrence.id);
      await attendance.submitRecords(f.user, f.schoolId, register, { expected_revision: 0, records: [{ person_id: f.personId, status: "present" }] }, request(f.user));
      f.setNow("11:00");
      const before = await attendance.detail(f.user, f.schoolId, register);
      const sourceBefore = await f.retained();
      const coreHistory = () => sql`SELECT * FROM campus_model_schedule_occurrences WHERE school_id=${f.schoolId}::uuid AND period_entity_id IN
        (SELECT id FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid AND domain='timetable' AND domain_id=${f.occurrence.id} AND kind='schedule_occurrence') ORDER BY recorded_from,id`.execute(db);
      const coreBefore = (await coreHistory()).rows;
      expect(coreBefore).toHaveLength(1);
      const change = { idempotency_key: randomUUID(), expected_revision: 2, starts_on: f.day, reason: "Change only future recurring work" };
      await expect(planning.revise(request(f.user), f.schoolId, f.source.id, change)).rejects.toThrow("Choose tomorrow");
      await expect(planning.revise(request(f.user), f.schoolId, f.source.id, change)).rejects.toThrow("Choose tomorrow");
      expect((await f.retained()).rows[0]?.state).toBe("expected");
      expect(await f.retained()).toEqual(sourceBefore);
      expect((await coreHistory()).rows).toEqual(coreBefore);
      expect(await attendance.detail(f.user, f.schoolId, register)).toEqual(before);
      const tomorrow = new Date(Date.parse(f.day) + 86400000).toISOString().slice(0, 10);
      const replacement = await planning.revise(request(f.user), f.schoolId, f.source.id, { ...change, idempotency_key: randomUUID(), starts_on: tomorrow });
      await planning.publish(request(f.user), f.schoolId, replacement.id, { idempotency_key: randomUUID(), expected_revision: 1 });
      expect(await f.retained()).toEqual(sourceBefore);
      expect((await coreHistory()).rows).toEqual(coreBefore);
      expect(await attendance.detail(f.user, f.schoolId, register)).toEqual(before);
    });
  });

  it("rechecks at publication when the source starts after a draft change was prepared", async () => {
    const f = await fixture();
    await f.run(async () => {
      const replacement = await planning.revise(request(f.user), f.schoolId, f.source.id, { idempotency_key: randomUUID(), expected_revision: 2,
        starts_on: f.day, reason: "Reviewed before the original start" });
      const edited = await planning.update(request(f.user), f.schoolId, replacement.id, { ...f.input, idempotency_key: randomUUID(),
        expected_revision: 1, starts_at: "14:00", ends_at: "15:00" });
      f.setNow("09:15");
      const before = await f.retained();
      await expect(planning.publish(request(f.user), f.schoolId, edited.id, { idempotency_key: randomUUID(), expected_revision: edited.revision })).rejects.toThrow("Choose tomorrow");
      expect(await f.retained()).toEqual(before);
      expect((await planning.getPlan(f.user, f.schoolId, edited.id)).state).toBe("draft");
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_plan_supersessions WHERE previous_version_id=${f.source.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    });
  });

  it("rejects a retroactive replacement but keeps valid later-today changes and first-use creation", async () => {
    const f = await fixture("15:00", "16:00");
    await f.run(async () => {
      f.setNow("11:00");
      const replacement = await planning.revise(request(f.user), f.schoolId, f.source.id, { idempotency_key: randomUUID(), expected_revision: 2,
        starts_on: f.day, reason: "Only future commitments may change" });
      const retroactive = await planning.update(request(f.user), f.schoolId, replacement.id, { ...f.input, idempotency_key: randomUUID(),
        expected_revision: 1, starts_at: "10:00", ends_at: "11:00" });
      await expect(planning.publish(request(f.user), f.schoolId, retroactive.id, { idempotency_key: randomUUID(), expected_revision: retroactive.revision })).rejects.toThrow("later time today or start tomorrow");
      const later = await planning.update(request(f.user), f.schoolId, replacement.id, { ...f.input, idempotency_key: randomUUID(),
        expected_revision: retroactive.revision, starts_at: "14:00", ends_at: "15:00" });
      expect((await planning.publish(request(f.user), f.schoolId, later.id, { idempotency_key: randomUUID(), expected_revision: later.revision })).state).toBe("published");
      const firstUse = await planning.create(request(f.user), f.schoolId, { ...f.input, idempotency_key: randomUUID(), recurrence: "once", weekdays: [],
        title: "First use starts now", starts_at: "11:00", ends_at: "12:00" });
      expect((await planning.publish(request(f.user), f.schoolId, firstUse.id, { idempotency_key: randomUUID(), expected_revision: 1 })).state).toBe("published");
    });
  });
});
