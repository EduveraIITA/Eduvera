import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createResourceLoanFixture, resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/availability_unused_test";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) }) as DatabaseService;
afterAll(() => db.destroy());

describe.skipIf(!enabled)("shared non-reserving plan context", () => {
  it("preserves exclusive defaults and rejects participant or claim-kind forgery in native storage", async () => {
    process.env.INVITATION_EMAIL_ENABLED = "false";
    const f = await createResourceLoanFixture(db);
    await f.run(async () => {
      const hall = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
        name: "Fictional availability hall", code: "AVAIL-HALL", kind: "other" }, resourceLoanRequest(f.user));
      if (typeof hall.id !== "string") throw new Error("Canonical place is missing.");
      const entity = (kind: string, domain: string, id: string) => ({ kind, domain, domain_id: id,
        label: "Fictional plan context", lifecycle_state: "active" as const, source_revision: 1, metadata: {} });
      const place = { ...entity("space", "campus_topology", hall.id), metadata: { space_kind: "other" } };
      const planId = randomUUID(), occurrenceId = randomUUID();
      const input = { school_id: f.schoolId, actor_user_id: f.user.id, plan: entity("schedule", "timetable", planId),
        source_revision: 1, event_type: "timetable.plan_published", occurred_at: f.now, correlation_id: planId,
        causation_event_id: null, horizon: { from: f.now, until: new Date(Date.parse(f.now) + 3_600_000).toISOString() },
        occurrences: [{ occurrence_key: occurrenceId, occurrence: entity("schedule_occurrence", "timetable", occurrenceId),
          local_date: f.now.slice(0, 10), starts_at: f.now, ends_at: new Date(Date.parse(f.now) + 3_600_000).toISOString(),
          time_zone: "UTC", claim_kind: "availability" as const, context: place, resources: [place], participants: [], state: "expected" as const }] };
      const receipt = await db.transaction().execute(tx => f.core.recordPlanOccurrences(tx, input));
      expect(await db.transaction().execute(tx => f.core.recordPlanOccurrences(tx, input))).toMatchObject({ event_id: receipt.event_id, replayed: true });
      const occurrence = await db.selectFrom("campus_model_schedule_occurrences").selectAll()
        .where("school_id", "=", f.schoolId).where("claim_kind", "=", "availability").executeTakeFirstOrThrow();
      expect(occurrence).toMatchObject({ class_entity_id: null, responsible_agent_id: null, subject_entity_id: null });
      const person = await db.selectFrom("campus_model_entities").select("id").where("school_id", "=", f.schoolId)
        .where("domain", "=", "people").where("kind", "=", "person").where("domain_id", "=", f.borrowerPersonId).executeTakeFirstOrThrow();
      await expect(db.transaction().execute(tx => sql`INSERT INTO campus_model_occurrence_participants(
        school_id,realm_id,environment_namespace_id,occurrence_id,participant_entity_id,role,required,source_ref,source_revision)
        VALUES(${f.schoolId}::uuid,${occurrence.realm_id}::uuid,${occurrence.environment_namespace_id},${occurrence.id}::uuid,
          ${person.id}::uuid,'operator',false,'not-an-assignment',1)`.execute(tx))).rejects.toThrow(/Availability cannot assign people or attendance/);
      await expect(db.transaction().execute(tx => f.core.recordPlanOccurrences(tx, { ...input, source_revision: 2,
        plan: { ...input.plan, source_revision: 2 }, occurrences: [{ ...input.occurrences[0]!, claim_kind: "exclusive" as const }] })))
        .rejects.toThrow(/different claims/);
      const exclusiveId = randomUUID(), exclusiveOccurrence = randomUUID();
      const legacy = { ...input, plan: entity("schedule", "timetable", exclusiveId), correlation_id: exclusiveId,
        occurrences: [{ ...input.occurrences[0]!, occurrence_key: exclusiveOccurrence,
          occurrence: entity("schedule_occurrence", "timetable", exclusiveOccurrence), claim_kind: undefined }] };
      await db.transaction().execute(tx => f.core.recordPlanOccurrences(tx, legacy));
      expect(await db.selectFrom("campus_model_schedule_occurrences").select("id").where("school_id", "=", f.schoolId)
        .where("claim_kind", "=", "exclusive").execute()).toHaveLength(1);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_occurrence_participants
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      expect(await f.core.listOperatingDay({ school_id: f.schoolId, date: f.now.slice(0, 10), recorded_as_of: f.now })).toHaveLength(0);
    });
  });
});
