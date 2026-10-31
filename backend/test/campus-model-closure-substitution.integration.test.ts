import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Transaction } from "kysely";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);

let database: DatabaseService;
let core: CampusModelCoreService;

beforeAll(() => {
  database = new DatabaseService();
  core = new CampusModelCoreService(database);
});

afterAll(async () => {
  await database.destroy();
});

class RollbackFixture extends Error {}

interface FixtureIdentity {
  school_id: string;
  realm_id: string;
  environment_namespace_id: string;
  timezone: string;
  actor_user_id: string;
  actor_agent_id: string;
  original_agent_id: string;
  replacement_agent_id: string;
  institution_id: string;
  institution_label: string;
  institution_revision: number;
  institution_metadata: Record<string, unknown>;
}

async function fixtureIdentity(tx: Transaction<Database>): Promise<FixtureIdentity> {
  const row = (await sql<FixtureIdentity>`SELECT school.id AS school_id,school.timezone,
      institution.realm_id,institution.environment_namespace_id,
      administrator.user_id AS actor_user_id,administrator.agent_id AS actor_agent_id,
      original.id AS original_agent_id,replacement.id AS replacement_agent_id,
      institution.id AS institution_id,institution.label AS institution_label,
      institution.source_revision AS institution_revision,
      institution.metadata AS institution_metadata
    FROM schools school
    JOIN campus_model_entities institution
      ON institution.school_id=school.id AND institution.domain='institutions'
      AND institution.domain_id=school.id::text
    JOIN LATERAL (
      SELECT membership.user_id,endpoint.agent_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN campus_model_agent_endpoints endpoint
        ON endpoint.school_id=membership.school_id
        AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
        AND endpoint.user_id=membership.user_id AND endpoint.status='active'
        AND endpoint.effective_until IS NULL
      WHERE membership.school_id=school.id AND membership.role='admin'
        AND membership.is_active
      ORDER BY membership.created_at,membership.id LIMIT 1
    ) administrator ON true
    JOIN LATERAL (
      SELECT agent.id
      FROM campus_model_agents agent
      WHERE agent.school_id=school.id AND agent.agent_kind='human'
      ORDER BY agent.id LIMIT 1
    ) original ON true
    JOIN LATERAL (
      SELECT agent.id
      FROM campus_model_agents agent
      WHERE agent.school_id=school.id AND agent.agent_kind='human'
        AND agent.id<>original.id
      ORDER BY agent.id LIMIT 1
    ) replacement ON true
    WHERE school.code='cis'
    LIMIT 1`.execute(tx)).rows[0];
  if (!row) throw new Error("The isolated test seed needs an admin and two retained human agents.");
  return row;
}

async function entity(
  tx: Transaction<Database>,
  identity: FixtureIdentity,
  kind: string,
  suffix: string,
) {
  return (await sql<{ id: string }>`INSERT INTO campus_model_entities(
      school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
    ) VALUES(
      ${identity.school_id}::uuid,${identity.realm_id}::uuid,${identity.environment_namespace_id},
      ${kind},'temporal_test',${suffix},${suffix},'active',1,'{}'::jsonb
    ) RETURNING id`.execute(tx)).rows[0]!.id;
}

async function planEvent(
  tx: Transaction<Database>,
  identity: FixtureIdentity,
  input: {
    subjectEntityId: string;
    contextEntityId: string;
    sourceRecordId: string;
    startsAt: string;
    endsAt: string;
  },
) {
  const key = randomUUID();
  return (await sql<{ id: string; recorded_at: string }>`INSERT INTO campus_model_events(
      school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
      source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
      correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
    ) VALUES(
      ${identity.school_id}::uuid,'plan','timetable.schedule_published',
      ${input.subjectEntityId}::uuid,${input.contextEntityId}::uuid,
      ${identity.actor_agent_id}::uuid,'timetable',${input.sourceRecordId},1,
      clock_timestamp(),${input.startsAt}::timestamptz,${input.endsAt}::timestamptz,
      ${randomUUID()}::uuid,'{}'::jsonb,'{}'::jsonb,1,${`test-plan:${key}`},
      ${createHash("sha256").update(key).digest("hex")}
    ) RETURNING id,recorded_at`.execute(tx)).rows[0]!;
}

async function acceptedEvent(
  tx: Transaction<Database>,
  identity: FixtureIdentity,
  input: {
    subjectEntityId: string;
    contextEntityId: string;
    sourceRecordId: string;
    occurrenceKey: string;
    startsAt: string;
    endsAt: string;
  },
) {
  const key = randomUUID();
  const payload = {
    occurrence_key: input.occurrenceKey,
    source_record_id: input.sourceRecordId,
    source_revision: 1,
    original_teacher_agent_id: identity.original_agent_id,
    replacement_teacher_agent_id: identity.replacement_agent_id,
  };
  return (await sql<{ id: string; recorded_at: string }>`INSERT INTO campus_model_events(
      school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
      source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
      correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
    ) VALUES(
      ${identity.school_id}::uuid,'decision','timetable.substitution_effective',
      ${input.subjectEntityId}::uuid,${input.contextEntityId}::uuid,
      ${identity.replacement_agent_id}::uuid,'staff_coverage',${randomUUID()},1,
      clock_timestamp(),${input.startsAt}::timestamptz,${input.endsAt}::timestamptz,
      ${randomUUID()}::uuid,'{}'::jsonb,${JSON.stringify(payload)}::jsonb,1,
      ${`test-accepted:${key}`},${createHash("sha256").update(key).digest("hex")}
    ) RETURNING id,recorded_at`.execute(tx)).rows[0]!;
}

describe("calendar closure and accepted-cover temporal convergence", () => {
  it("restores the configured successor and never resurrects a cancelled replacement", async () => {
    const rollback = new RollbackFixture();
    try {
      await database.transaction().execute(async (tx) => {
        const identity = await fixtureIdentity(tx);
        const institution = {
          kind: "institution",
          domain: "institutions",
          domain_id: identity.school_id,
          label: identity.institution_label,
          lifecycle_state: "active" as const,
          source_revision: identity.institution_revision,
          metadata: identity.institution_metadata,
        };

        const run = async (input: {
          date: string;
          acceptedAfterClosure?: boolean;
          successor?: "original_teacher" | "unassigned";
        }) => {
          const schedule = await entity(tx, identity, "schedule", `schedule-${randomUUID()}`);
          const period = await entity(tx, identity, "schedule_period", `period-${randomUUID()}`);
          const classEntity = await entity(tx, identity, "class", `class-${randomUUID()}`);
          const sourceRecordId = randomUUID();
          const occurrenceKey = createHash("sha256").update(randomUUID()).digest("hex");
          const startsAt = `${input.date}T03:30:00.000Z`;
          const endsAt = `${input.date}T04:15:00.000Z`;
          const basis = await planEvent(tx, identity, {
            subjectEntityId: schedule,
            contextEntityId: classEntity,
            sourceRecordId,
            startsAt,
            endsAt,
          });
          const accepted = input.acceptedAfterClosure ? null : await acceptedEvent(tx, identity, {
            subjectEntityId: schedule,
            contextEntityId: classEntity,
            sourceRecordId,
            occurrenceKey,
            startsAt,
            endsAt,
          });
          await sql`INSERT INTO campus_model_schedule_occurrences(
              school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
              responsible_agent_id,occurrence_date,starts_at,ends_at,title,slot_type,
              room_snapshot,state,source_revision,logical_occurrence_key,period_number,
              basis_event_id,change_event_id,recorded_from,change_kind
            ) VALUES(
              ${identity.school_id}::uuid,${basis.id}::uuid,${schedule}::uuid,${period}::uuid,
              ${classEntity}::uuid,
              ${accepted ? identity.replacement_agent_id : identity.original_agent_id}::uuid,
              ${input.date}::date,${startsAt}::timestamptz,${endsAt}::timestamptz,
              'Mathematics','class','Room 201','expected',1,${occurrenceKey},1,
              ${basis.id}::uuid,${accepted?.id ?? basis.id}::uuid,
              ${accepted?.recorded_at ?? basis.recorded_at}::timestamptz,
              ${accepted ? "substituted" : "published"}
            )`.execute(tx);

          const closureId = randomUUID();
          await sql`INSERT INTO school_calendar_days(
              id,school_id,date,is_instructional,label,kind,reason,revision,created_by,updated_by
            ) VALUES(
              ${closureId}::uuid,${identity.school_id}::uuid,${input.date}::date,false,
              'Test closure','emergency_closure','Temporal regression',1,
              ${identity.actor_user_id}::uuid,${identity.actor_user_id}::uuid
            )`.execute(tx);
          await core.recordCalendarClosure(tx, {
            school_id: identity.school_id,
            actor_user_id: identity.actor_user_id,
            institution,
            action: "created",
            source_record_id: closureId,
            source_revision: 1,
            dates: [input.date],
            timezone: identity.timezone,
            label: "Test closure",
            closure_kind: "emergency_closure",
            occurred_at: new Date().toISOString(),
            correlation_id: randomUUID(),
          });

          const acceptedChange = accepted ?? await acceptedEvent(tx, identity, {
            subjectEntityId: schedule,
            contextEntityId: classEntity,
            sourceRecordId,
            occurrenceKey,
            startsAt,
            endsAt,
          });
          if (input.successor) {
            const cancellationId = randomUUID();
            await sql`INSERT INTO campus_model_events(
                school_id,event_kind,event_type,subject_entity_id,context_entity_id,
                actor_agent_id,source_domain,source_record_id,source_revision,event_at,
                effective_from,effective_until,correlation_id,causation_event_id,
                provenance,payload,schema_version,idempotency_key,request_hash
              ) VALUES(
                ${identity.school_id}::uuid,'decision','timetable.substitution_cancelled',
                ${schedule}::uuid,${classEntity}::uuid,${identity.actor_agent_id}::uuid,
                'staff_coverage',${randomUUID()},2,clock_timestamp(),
                ${startsAt}::timestamptz,${endsAt}::timestamptz,${randomUUID()}::uuid,
                ${acceptedChange.id}::uuid,'{}'::jsonb,
                ${JSON.stringify({ successor_assignment: input.successor })}::jsonb,1,
                ${`test-cancelled:${cancellationId}`},
                ${createHash("sha256").update(cancellationId).digest("hex")}
              )`.execute(tx);
          }

          await tx.deleteFrom("school_calendar_days").where("id", "=", closureId).execute();
          await core.recordCalendarClosure(tx, {
            school_id: identity.school_id,
            actor_user_id: identity.actor_user_id,
            institution,
            action: "removed",
            source_record_id: closureId,
            source_revision: 2,
            dates: [input.date],
            timezone: identity.timezone,
            label: "Test closure",
            closure_kind: "emergency_closure",
            occurred_at: new Date().toISOString(),
            correlation_id: randomUUID(),
          });
          return (await sql<{ responsible_agent_id: string | null; change_kind: string }>`SELECT
              responsible_agent_id,change_kind
            FROM campus_model_schedule_occurrences
            WHERE school_id=${identity.school_id}::uuid
              AND logical_occurrence_key=${occurrenceKey} AND recorded_until IS NULL`.execute(tx)).rows[0]!;
        };

        expect(await run({ date: "2099-01-05", successor: "unassigned" })).toEqual({
          responsible_agent_id: null,
          change_kind: "closure_restored",
        });
        expect(await run({ date: "2099-01-06", successor: "original_teacher" })).toEqual({
          responsible_agent_id: identity.original_agent_id,
          change_kind: "closure_restored",
        });
        expect(await run({ date: "2099-01-07", acceptedAfterClosure: true })).toEqual({
          responsible_agent_id: identity.replacement_agent_id,
          change_kind: "closure_restored",
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
