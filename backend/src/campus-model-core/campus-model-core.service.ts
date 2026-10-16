import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import type { CampusModelActivity, CampusModelChangeReceipt, CampusModelCorePort } from "./campus-model-core.port.js";
import type { ObservationIngressPort } from "./observation-ingress.port.js";
import type {
  CampusTemporalAssertion,
  PlanReconciliationReceipt,
  ScheduleProjectionReceipt,
  TemporalContextPort,
} from "./temporal-context.port.js";
import {
  acceptedCampusModelChangeSchema,
  campusModelObservationSchema,
  campusModelObservationTransitionSchema,
  campusTemporalContextQuerySchema,
  calendarClosureProjectionSchema,
  publishedDayPlanProjectionSchema,
  publishedScheduleProjectionSchema,
  type AcceptedCampusModelChange,
  type CampusModelEntitySnapshot,
  type CampusModelObservation,
  type CampusModelObservationTransition,
  type CampusTemporalContextQuery,
  type CalendarClosureProjection,
  type PublishedDayPlanProjection,
  type PublishedScheduleProjection,
} from "./contracts.js";

interface EntityRow { id: string; domain: string; domain_id: string }
interface AgentRow { id: string }
interface RelationshipRow { id: string; target_entity_id: string; effective_from: Date | string }
interface CommandRow { id: string; command_type: string; target_entity_id: string | null; actor_agent_id: string }
interface ObservationRow { id: string; request_hash: string }
interface ResolvedObservationRow {
  assertion_id: string;
  kind: string;
  state: "pending" | "accepted" | "quarantined";
  payload: unknown;
  observed_at: Date | string;
  received_at: Date | string;
  source_type: string;
  source_ref: string | null;
  source_record_id: string;
  captured_by_agent_id: string;
  captured_by_kind: "human" | "team" | "device" | "integration" | "software";
  captured_by_label: string;
  subject_entity_id: string;
  subject_label: string;
  subject_kind: string;
  context_entity_id: string | null;
  context_label: string | null;
  context_kind: string | null;
}
interface EventRow { id: string; request_hash: string }
interface TemporalAssertionRow {
  assertion_id: string;
  occurrence_id: string;
  schedule_version_id: string;
  class_entity_id: string;
  class_label: string;
  subject_entity_id: string | null;
  subject_label: string | null;
  space_entity_id: string | null;
  space_label: string | null;
  title: string;
  slot_type: "class" | "break" | "activity";
  starts_at: Date | string;
  ends_at: Date | string;
  recorded_at: Date | string;
  event_id: string;
  source_record_id: string;
  source_revision: number;
  event_type: "timetable.schedule_published" | "timetable.day_plan_published";
  source_domain: "timetable" | "day_plan";
  queried_subject_id: string;
  queried_subject_label: string;
  current: boolean;
}

@Injectable()
export class CampusModelCoreService implements CampusModelCorePort, ObservationIngressPort, TemporalContextPort {
  constructor(private readonly db: DatabaseService) {}

  async recordAcceptedChange(
    transaction: Transaction<Database>,
    rawInput: AcceptedCampusModelChange,
  ): Promise<CampusModelChangeReceipt> {
    const input = acceptedCampusModelChangeSchema.parse(rawInput);
    const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
    const entities = new Map<string, string>();

    for (const snapshot of input.entities) {
      const entity = await this.upsertEntity(transaction, input.school_id, snapshot);
      entities.set(this.key(entity), entity.id);
    }

    const relationshipIds: string[] = [];
    for (const snapshot of input.relationships) {
      const sourceId = this.resolve(entities, snapshot.source);
      const targetId = snapshot.target ? this.resolve(entities, snapshot.target) : null;
      const current = snapshot.replace_current
        ? (await sql<RelationshipRow>`SELECT id,target_entity_id,effective_from
            FROM campus_model_relationships
            WHERE school_id=${input.school_id}::uuid AND relation_type=${snapshot.relation_type}
              AND source_entity_id=${sourceId}::uuid AND effective_until IS NULL
            ORDER BY effective_from DESC FOR UPDATE`.execute(transaction)).rows[0]
        : undefined;

      if (snapshot.operation === "set" && targetId && current?.target_entity_id === targetId) {
        await sql`UPDATE campus_model_relationships SET
            source_domain=${snapshot.source_domain},source_record_id=${snapshot.source_record_id},
            source_revision=${snapshot.source_revision},metadata=${JSON.stringify(snapshot.metadata)}::jsonb,
            updated_at=now()
          WHERE id=${current.id}::uuid`.execute(transaction);
        relationshipIds.push(current.id);
        continue;
      }

      if (current) {
        if (new Date(current.effective_from).getTime() >= Date.parse(snapshot.effective_from)) {
          throw new ConflictException("The connected campus relationship changed at the same or a later time. Refresh and try again.");
        }
        await sql`UPDATE campus_model_relationships SET effective_until=${snapshot.effective_from}::timestamptz,updated_at=now()
          WHERE id=${current.id}::uuid`.execute(transaction);
        relationshipIds.push(current.id);
      }

      if (snapshot.operation === "clear") continue;
      if (!targetId) throw new ConflictException("The connected campus relationship target is missing.");

      const inserted = (await sql<{ id: string }>`INSERT INTO campus_model_relationships(
          school_id,relation_type,source_entity_id,target_entity_id,effective_from,effective_until,
          source_domain,source_record_id,source_revision,metadata
        ) VALUES (
          ${input.school_id}::uuid,${snapshot.relation_type},${sourceId}::uuid,${targetId}::uuid,
          ${snapshot.effective_from}::timestamptz,${snapshot.effective_until}::timestamptz,
          ${snapshot.source_domain},${snapshot.source_record_id},${snapshot.source_revision},
          ${JSON.stringify(snapshot.metadata)}::jsonb
        )
        ON CONFLICT(school_id,relation_type,source_entity_id,target_entity_id,effective_from)
        DO UPDATE SET effective_until=EXCLUDED.effective_until,source_domain=EXCLUDED.source_domain,
          source_record_id=EXCLUDED.source_record_id,source_revision=EXCLUDED.source_revision,
          metadata=EXCLUDED.metadata,updated_at=now()
        RETURNING id`.execute(transaction)).rows[0];
      if (!inserted) throw new ConflictException("The connected campus relationship could not be recorded.");
      relationshipIds.push(inserted.id);
    }

    const targetEntityId = this.resolve(entities, input.target);
    const command = await this.recordCommand(transaction, input, actor.id, targetEntityId);
    await sql`INSERT INTO campus_model_command_outcomes(
        command_id,sequence,status,code,explanation,resulting_entity_id,resulting_revision,domain_event_id,metadata
      ) VALUES (
        ${command.id}::uuid,1,'accepted',${input.outcome.code},${input.outcome.explanation},
        ${targetEntityId}::uuid,${input.outcome.resulting_revision},${input.domain_event_id}::uuid,
        ${JSON.stringify(input.outcome.metadata)}::jsonb
      ) ON CONFLICT(command_id,sequence) DO NOTHING`.execute(transaction);

    return { command_id: command.id, target_entity_id: targetEntityId, actor_agent_id: actor.id, relationship_ids: relationshipIds };
  }

  async recordObservations(
    transaction: Transaction<Database>,
    rawObservations: CampusModelObservation[],
  ): Promise<string[]> {
    const observations = rawObservations.map((item) => campusModelObservationSchema.parse(item));
    const ids: string[] = [];
    for (const observation of observations) {
      const actor = observation.captured_by
        ? observation.captured_by.kind === "human"
          ? await this.ensureHumanAgent(transaction, observation.school_id, observation.captured_by.user_id)
          : await this.ensureExternalAgent(transaction, observation.school_id, observation.captured_by)
        : await this.ensureHumanAgent(transaction, observation.school_id, observation.actor_user_id!);
      const subject = await this.upsertEntity(transaction, observation.school_id, observation.subject);
      const context = observation.context
        ? await this.upsertEntity(transaction, observation.school_id, observation.context)
        : null;
      const requestHash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
      const inserted = (await sql<ObservationRow>`INSERT INTO campus_model_observations(
          school_id,kind,subject_entity_id,context_entity_id,captured_by_agent_id,source_type,
          source_ref,source_record_id,observed_at,received_at,evidence_refs,payload,schema_version,
          state,idempotency_key,request_hash,domain_event_id
        ) VALUES (
          ${observation.school_id}::uuid,${observation.kind},${subject.id}::uuid,${context?.id ?? null}::uuid,
          ${actor.id}::uuid,${observation.source_type},${observation.source_ref},${observation.source_record_id},
          ${observation.observed_at}::timestamptz,${observation.received_at}::timestamptz,
          ${observation.evidence_refs}::text[],${JSON.stringify(observation.payload)}::jsonb,
          ${observation.schema_version},${observation.state},${observation.idempotency_key},${requestHash},
          ${observation.domain_event_id}::uuid
        ) ON CONFLICT(school_id,idempotency_key) DO NOTHING
        RETURNING id,request_hash`.execute(transaction)).rows[0];
      if (inserted) {
        ids.push(inserted.id);
        continue;
      }
      const existing = (await sql<ObservationRow>`SELECT id,request_hash FROM campus_model_observations
        WHERE school_id=${observation.school_id}::uuid AND idempotency_key=${observation.idempotency_key}
        FOR UPDATE`.execute(transaction)).rows[0];
      if (!existing || existing.request_hash !== requestHash) {
        throw new ConflictException("This observation key was already used for different evidence.");
      }
      ids.push(existing.id);
    }
    return ids;
  }

  async transitionObservations(
    transaction: Transaction<Database>,
    rawInput: CampusModelObservationTransition,
  ): Promise<number> {
    const input = campusModelObservationTransitionSchema.parse(rawInput);
    const result = await transaction.updateTable("campus_model_observations")
      .set({ state: input.state })
      .where("school_id", "=", input.school_id)
      .where("source_type", "=", input.source_type)
      .where("source_ref", "=", input.source_ref)
      .where("state", "!=", "superseded")
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async recentActivity(schoolId: string, limit = 12): Promise<CampusModelActivity[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    return (await sql<CampusModelActivity>`
      SELECT * FROM (
        SELECT command.id::text AS id,'setup'::text AS kind,command.command_type AS action,
          target.label AS subject_label,1::int AS item_count,command.state,
          command.requested_at AS occurred_at,actor.label AS actor_label
        FROM campus_model_commands command
        LEFT JOIN campus_model_entities target ON target.id=command.target_entity_id
        JOIN campus_model_agents actor ON actor.id=command.actor_agent_id
        WHERE command.school_id=${schoolId}::uuid AND command.source_domain='campus_topology'
        UNION ALL
        SELECT observation.source_ref AS id,'attendance'::text AS kind,
          'attendance.capture'::text AS action,context.label AS subject_label,
          count(*)::int AS item_count,observation.state,max(observation.received_at) AS occurred_at,
          actor.label AS actor_label
        FROM campus_model_observations observation
        LEFT JOIN campus_model_entities context ON context.id=observation.context_entity_id
        JOIN campus_model_agents actor ON actor.id=observation.captured_by_agent_id
        WHERE observation.school_id=${schoolId}::uuid
          AND observation.source_type='attendance.capture'
        GROUP BY observation.source_ref,context.label,observation.state,actor.label
      ) connected_activity
      ORDER BY occurred_at DESC,id DESC
      LIMIT ${safeLimit}
    `.execute(this.db)).rows;
  }

  async recordPublishedSchedule(
    transaction: Transaction<Database>,
    rawInput: PublishedScheduleProjection,
  ): Promise<ScheduleProjectionReceipt> {
    const input = publishedScheduleProjectionSchema.parse(rawInput);
    const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
    const schedule = await this.upsertEntity(transaction, input.school_id, {
      kind: "schedule",
      domain: "timetable",
      domain_id: input.schedule_version_id,
      label: `${input.class_section.label} timetable`,
      lifecycle_state: "active",
      source_revision: input.schedule_revision,
      metadata: { starts_on: input.starts_on, ends_on: input.ends_on, timezone: input.timezone },
    });
    const classEntity = await this.upsertEntity(transaction, input.school_id, input.class_section);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const idempotencyKey = `timetable.schedule-published:${input.schedule_version_id}:${input.schedule_revision}`;
    const inserted = (await sql<EventRow>`INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,actor_agent_id,source_domain,
        source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,causation_event_id,provenance,payload,schema_version,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,'plan','timetable.schedule_published',${schedule.id}::uuid,${actor.id}::uuid,
        'timetable',${input.schedule_version_id},${input.schedule_revision},${input.published_at}::timestamptz,
        (${input.starts_on}::date::timestamp AT TIME ZONE ${input.timezone}),
        ((${input.ends_on}::date+1)::timestamp AT TIME ZONE ${input.timezone}),
        ${input.correlation_id}::uuid,${input.causation_event_id}::uuid,
        ${JSON.stringify({ source: "schedule_versions", captured_by: "schedule-planning" })}::jsonb,
        ${JSON.stringify({ starts_on: input.starts_on, ends_on: input.ends_on, timezone: input.timezone, period_count: input.periods.length })}::jsonb,
        1,${idempotencyKey},${requestHash}
      ) ON CONFLICT(school_id,idempotency_key) DO NOTHING RETURNING id,request_hash`.execute(transaction)).rows[0];

    const event = inserted ?? (await sql<EventRow>`SELECT id,request_hash FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
    if (!event || event.request_hash !== requestHash) {
      throw new ConflictException("This timetable publication key was already used for different plan evidence.");
    }
    if (!inserted) {
      const existing = (await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM campus_model_schedule_occurrences WHERE school_id=${input.school_id}::uuid
          AND source_event_id=${event.id}::uuid AND state='expected'`.execute(transaction)).rows[0]?.count ?? 0;
      return { event_id: event.id, schedule_entity_id: schedule.id, occurrence_count: existing, replayed: true };
    }

    let occurrenceCount = 0;
    for (const period of input.periods) {
      const periodEntity = await this.upsertEntity(transaction, input.school_id, {
        kind: "schedule_period",
        domain: "timetable",
        domain_id: period.period_id,
        label: period.title,
        lifecycle_state: "active",
        source_revision: input.schedule_revision,
        metadata: { weekday: period.weekday, period_number: period.period_number, slot_type: period.slot_type },
      });
      const subjectEntity = period.subject
        ? await this.upsertEntity(transaction, input.school_id, period.subject)
        : null;
      const spaceEntity = period.space
        ? await this.upsertEntity(transaction, input.school_id, period.space)
        : null;
      const responsibleAgent = period.teacher_user_id
        ? await this.ensureHumanAgent(transaction, input.school_id, period.teacher_user_id)
        : null;
      const result = await sql<{ id: string }>`INSERT INTO campus_model_schedule_occurrences(
          school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
          subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
          title,slot_type,room_snapshot,state,source_revision
        )
        SELECT ${input.school_id}::uuid,${event.id}::uuid,${schedule.id}::uuid,${periodEntity.id}::uuid,
          ${classEntity.id}::uuid,${subjectEntity?.id ?? null}::uuid,${responsibleAgent?.id ?? null}::uuid,
          ${spaceEntity?.id ?? null}::uuid,day::date,
          ((day::date+${period.starts_at}::time) AT TIME ZONE ${input.timezone}),
          ((day::date+${period.ends_at}::time) AT TIME ZONE ${input.timezone}),
          ${period.title},${period.slot_type},${period.room_snapshot},'expected',${input.schedule_revision}
        FROM generate_series(${input.starts_on}::date,${input.ends_on}::date,'1 day') day
        WHERE extract(isodow FROM day)=${period.weekday}
          AND NOT EXISTS(
            SELECT 1 FROM school_calendar_days closure
            WHERE closure.school_id=${input.school_id}::uuid AND closure.date=day::date AND NOT closure.is_instructional
          )
          AND NOT EXISTS(
            SELECT 1 FROM day_plans plan
            WHERE plan.school_id=${input.school_id}::uuid AND plan.class_section_id=${input.class_section.domain_id}::uuid
              AND plan.date=day::date AND plan.published_version IS NOT NULL
          )
        ON CONFLICT(school_id,period_entity_id,occurrence_date,source_revision) DO NOTHING
        RETURNING id`.execute(transaction);
      occurrenceCount += result.rows.length;
    }

    return { event_id: event.id, schedule_entity_id: schedule.id, occurrence_count: occurrenceCount, replayed: false };
  }

  async recordCalendarClosure(
    transaction: Transaction<Database>,
    rawInput: CalendarClosureProjection,
  ): Promise<PlanReconciliationReceipt> {
    const input = calendarClosureProjectionSchema.parse(rawInput);
    const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
    const institution = await this.upsertEntity(transaction, input.school_id, input.institution);
    const eventType = input.action === "created" ? "calendar.closure_created" : "calendar.closure_removed";
    const idempotencyKey = `${eventType}:${input.source_record_id}:${input.source_revision}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const firstDate = [...input.dates].sort()[0]!;
    const lastDate = [...input.dates].sort().at(-1)!;
    const inserted = (await sql<EventRow>`INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,actor_agent_id,source_domain,
        source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,'plan',${eventType},${institution.id}::uuid,${actor.id}::uuid,'calendar',
        ${input.source_record_id},${input.source_revision},${input.occurred_at}::timestamptz,
        (${firstDate}::date::timestamp AT TIME ZONE ${input.timezone}),
        ((${lastDate}::date+1)::timestamp AT TIME ZONE ${input.timezone}),
        ${input.correlation_id}::uuid,${JSON.stringify({ source: "school_calendar_days", captured_by: "school-calendar" })}::jsonb,
        ${JSON.stringify({ action: input.action, dates: input.dates, label: input.label, closure_kind: input.closure_kind })}::jsonb,
        1,${idempotencyKey},${requestHash}
      ) ON CONFLICT(school_id,idempotency_key) DO NOTHING RETURNING id,request_hash`.execute(transaction)).rows[0];
    const event = inserted ?? (await sql<EventRow>`SELECT id,request_hash FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
    if (!event || event.request_hash !== requestHash) {
      throw new ConflictException("This calendar event key was already used for different plan evidence.");
    }
    if (!inserted) return { event_id: event.id, affected_occurrence_count: 0, replacement_occurrence_count: 0, replayed: true };

    const update = input.action === "created"
      ? await sql`UPDATE campus_model_schedule_occurrences SET state='cancelled',projected_at=now()
          WHERE school_id=${input.school_id}::uuid AND occurrence_date=ANY(${input.dates}::date[]) AND state='expected'`.execute(transaction)
      : await sql`UPDATE campus_model_schedule_occurrences occurrence SET state='expected',projected_at=now()
          WHERE occurrence.school_id=${input.school_id}::uuid AND occurrence.occurrence_date=ANY(${input.dates}::date[])
            AND occurrence.state='cancelled'
            AND NOT EXISTS(SELECT 1 FROM school_calendar_days closure
              WHERE closure.school_id=occurrence.school_id AND closure.date=occurrence.occurrence_date AND NOT closure.is_instructional)`.execute(transaction);
    return {
      event_id: event.id,
      affected_occurrence_count: Number(update.numAffectedRows ?? 0),
      replacement_occurrence_count: 0,
      replayed: false,
    };
  }

  async recordPublishedDayPlan(
    transaction: Transaction<Database>,
    rawInput: PublishedDayPlanProjection,
  ): Promise<PlanReconciliationReceipt> {
    const input = publishedDayPlanProjectionSchema.parse(rawInput);
    const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
    const planEntity = await this.upsertEntity(transaction, input.school_id, {
      kind: "schedule",
      domain: "day_plan",
      domain_id: `${input.plan_id}:${input.plan_version}`,
      label: `${input.class_section.label} plan for ${input.date}`,
      lifecycle_state: "active",
      source_revision: input.plan_revision,
      metadata: { plan_id: input.plan_id, version: input.plan_version, date: input.date, timezone: input.timezone },
    });
    const classEntity = await this.upsertEntity(transaction, input.school_id, input.class_section);
    const idempotencyKey = `timetable.day-plan-published:${input.plan_id}:${input.plan_version}:${input.plan_revision}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const inserted = (await sql<EventRow>`INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,'plan','timetable.day_plan_published',${planEntity.id}::uuid,${classEntity.id}::uuid,
        ${actor.id}::uuid,'day_plan',${input.plan_id},${input.plan_revision},${input.published_at}::timestamptz,
        (${input.date}::date::timestamp AT TIME ZONE ${input.timezone}),
        ((${input.date}::date+1)::timestamp AT TIME ZONE ${input.timezone}),
        ${input.correlation_id}::uuid,${JSON.stringify({ source: "day_plan_versions", captured_by: "day-plans" })}::jsonb,
        ${JSON.stringify({ date: input.date, version: input.plan_version, cancelled_period_ids: input.periods.filter((period) => period.cancelled).map((period) => period.period_id) })}::jsonb,
        1,${idempotencyKey},${requestHash}
      ) ON CONFLICT(school_id,idempotency_key) DO NOTHING RETURNING id,request_hash`.execute(transaction)).rows[0];
    const event = inserted ?? (await sql<EventRow>`SELECT id,request_hash FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
    if (!event || event.request_hash !== requestHash) {
      throw new ConflictException("This daily-plan event key was already used for different plan evidence.");
    }
    if (!inserted) {
      const existing = (await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_schedule_occurrences
        WHERE school_id=${input.school_id}::uuid AND source_event_id=${event.id}::uuid AND state='expected'`.execute(transaction)).rows[0]?.count ?? 0;
      return { event_id: event.id, affected_occurrence_count: 0, replacement_occurrence_count: existing, replayed: true };
    }

    const superseded = await sql`UPDATE campus_model_schedule_occurrences SET state='superseded',projected_at=now()
      WHERE school_id=${input.school_id}::uuid AND class_entity_id=${classEntity.id}::uuid
        AND occurrence_date=${input.date}::date AND state IN ('expected','cancelled')`.execute(transaction);
    let replacements = 0;
    for (const period of input.periods.filter((item) => !item.cancelled)) {
      const periodEntity = await this.upsertEntity(transaction, input.school_id, {
        kind: "schedule_period", domain: "day_plan", domain_id: `${period.period_id}:${input.plan_version}`,
        label: period.title, lifecycle_state: "active", source_revision: input.plan_revision,
        metadata: { period_number: period.period_number, slot_type: period.slot_type, date: input.date },
      });
      const subjectEntity = period.subject ? await this.upsertEntity(transaction, input.school_id, period.subject) : null;
      const spaceEntity = period.space ? await this.upsertEntity(transaction, input.school_id, period.space) : null;
      const responsibleAgent = period.teacher_user_id
        ? await this.ensureHumanAgent(transaction, input.school_id, period.teacher_user_id)
        : null;
      const result = await sql<{ id: string }>`INSERT INTO campus_model_schedule_occurrences(
          school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
          subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
          title,slot_type,room_snapshot,state,source_revision
        ) VALUES (
          ${input.school_id}::uuid,${event.id}::uuid,${planEntity.id}::uuid,${periodEntity.id}::uuid,
          ${classEntity.id}::uuid,${subjectEntity?.id ?? null}::uuid,${responsibleAgent?.id ?? null}::uuid,
          ${spaceEntity?.id ?? null}::uuid,${input.date}::date,
          ((${input.date}::date+${period.starts_at}::time) AT TIME ZONE ${input.timezone}),
          ((${input.date}::date+${period.ends_at}::time) AT TIME ZONE ${input.timezone}),
          ${period.title},${period.slot_type},${period.room_snapshot},'expected',${input.plan_revision}
        ) ON CONFLICT(school_id,period_entity_id,occurrence_date,source_revision) DO NOTHING RETURNING id`.execute(transaction);
      replacements += result.rows.length;
    }
    return {
      event_id: event.id,
      affected_occurrence_count: Number(superseded.numAffectedRows ?? 0),
      replacement_occurrence_count: replacements,
      replayed: false,
    };
  }

  async resolveAt(rawInput: CampusTemporalContextQuery): Promise<CampusTemporalAssertion[]> {
    const input = campusTemporalContextQuerySchema.parse(rawInput);
    const recordedAsOf = input.recorded_as_of ?? new Date().toISOString();
    const entityDomain = input.subject.type === "entity" ? input.subject.domain : null;
    const entityDomainId = input.subject.type === "entity" ? input.subject.domain_id : null;
    const humanUserId = input.subject.type === "human_agent" ? input.subject.user_id : null;
    const rows = (await sql<TemporalAssertionRow>`
      SELECT occurrence.id::text AS assertion_id,occurrence.id::text AS occurrence_id,
        schedule.domain_id AS schedule_version_id,class_entity.id::text AS class_entity_id,
        class_entity.label AS class_label,subject_entity.id::text AS subject_entity_id,
        subject_entity.label AS subject_label,space_entity.id::text AS space_entity_id,
        space_entity.label AS space_label,occurrence.title,occurrence.slot_type,
        occurrence.starts_at,occurrence.ends_at,event.recorded_at,event.id::text AS event_id,
        event.source_record_id,event.source_revision,event.event_type,event.source_domain,
        CASE WHEN ${humanUserId}::uuid IS NOT NULL THEN agent.id::text ELSE queried_entity.id::text END AS queried_subject_id,
        CASE WHEN ${humanUserId}::uuid IS NOT NULL THEN agent.label ELSE queried_entity.label END AS queried_subject_label,
        now()>=occurrence.starts_at AND now()<occurrence.ends_at AS current
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_events event ON event.id=occurrence.source_event_id AND event.school_id=occurrence.school_id
      JOIN campus_model_entities schedule ON schedule.id=occurrence.schedule_entity_id
      JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
      LEFT JOIN campus_model_entities subject_entity ON subject_entity.id=occurrence.subject_entity_id
      LEFT JOIN campus_model_entities space_entity ON space_entity.id=occurrence.space_entity_id
      LEFT JOIN campus_model_agents agent ON agent.id=occurrence.responsible_agent_id
        AND agent.user_id=${humanUserId}::uuid
      LEFT JOIN campus_model_entities queried_entity ON queried_entity.school_id=occurrence.school_id
        AND queried_entity.domain=${entityDomain} AND queried_entity.domain_id=${entityDomainId}
      WHERE occurrence.school_id=${input.school_id}::uuid AND occurrence.state='expected'
        AND occurrence.starts_at<=${input.at}::timestamptz AND occurrence.ends_at>${input.at}::timestamptz
        AND event.recorded_at<=${recordedAsOf}::timestamptz
        AND (
          (${humanUserId}::uuid IS NOT NULL AND agent.id IS NOT NULL)
          OR (${humanUserId}::uuid IS NULL AND queried_entity.id IS NOT NULL AND queried_entity.id IN (
            occurrence.class_entity_id,occurrence.subject_entity_id,occurrence.space_entity_id,occurrence.schedule_entity_id
          ))
        )
      ORDER BY occurrence.starts_at,occurrence.period_entity_id
    `.execute(this.db)).rows;

    const expected: CampusTemporalAssertion[] = rows.map((row) => ({
      assertion_id: row.assertion_id,
      dimension: "expected",
      assertion_type: "scheduled_context",
      subject: {
        type: input.subject.type,
        id: row.queried_subject_id,
        label: row.queried_subject_label,
      },
      context: {
        occurrence_id: row.occurrence_id,
        schedule_version_id: row.schedule_version_id,
        class_entity_id: row.class_entity_id,
        class_label: row.class_label,
        subject_entity_id: row.subject_entity_id,
        subject_label: row.subject_label,
        space_entity_id: row.space_entity_id,
        space_label: row.space_label,
        title: row.title,
        slot_type: row.slot_type,
      },
      valid_from: row.starts_at,
      valid_until: row.ends_at,
      recorded_at: row.recorded_at,
      source: {
        event_id: row.event_id,
        event_type: row.event_type,
        source_domain: row.source_domain,
        source_record_id: row.source_record_id,
        source_revision: row.source_revision,
      },
      certainty: "planned",
      freshness: row.current ? "current" : "historical",
      contradictions: [],
    }));

    if (input.subject.type !== "entity") return expected;
    const observed = (await sql<ResolvedObservationRow>`
      SELECT DISTINCT ON (observation.subject_entity_id,observation.kind)
        observation.id::text AS assertion_id,observation.kind,observation.state,observation.payload,
        observation.observed_at,observation.received_at,observation.source_type,observation.source_ref,
        observation.source_record_id,agent.id::text AS captured_by_agent_id,
        agent.agent_kind AS captured_by_kind,agent.label AS captured_by_label,
        subject.id::text AS subject_entity_id,subject.label AS subject_label,subject.kind AS subject_kind,
        context.id::text AS context_entity_id,context.label AS context_label,context.kind AS context_kind
      FROM campus_model_entities queried
      JOIN campus_model_observations observation ON observation.school_id=queried.school_id
        AND (observation.subject_entity_id=queried.id OR observation.context_entity_id=queried.id)
      JOIN campus_model_entities subject ON subject.id=observation.subject_entity_id
      LEFT JOIN campus_model_entities context ON context.id=observation.context_entity_id
      JOIN campus_model_agents agent ON agent.id=observation.captured_by_agent_id
      WHERE queried.school_id=${input.school_id}::uuid AND queried.domain=${input.subject.domain}
        AND queried.domain_id=${input.subject.domain_id}
        AND observation.observed_at<=${input.at}::timestamptz
        AND observation.received_at<=${recordedAsOf}::timestamptz
        AND observation.state IN ('pending','accepted','quarantined')
      ORDER BY observation.subject_entity_id,observation.kind,observation.observed_at DESC,observation.received_at DESC,observation.id DESC
    `.execute(this.db)).rows;

    return expected.concat(observed.map((row): CampusTemporalAssertion => ({
      assertion_id: row.assertion_id,
      dimension: row.state === "accepted" ? "accepted" : "observed",
      assertion_type: "direct_observation",
      subject: { type: "entity", id: row.subject_entity_id, label: row.subject_label, kind: row.subject_kind },
      context: row.context_entity_id ? {
        entity_id: row.context_entity_id,
        label: row.context_label!,
        kind: row.context_kind!,
      } : null,
      observation: { kind: row.kind, state: row.state, payload: row.payload },
      observed_at: row.observed_at,
      recorded_at: row.received_at,
      source: {
        observation_id: row.assertion_id,
        source_type: row.source_type,
        source_ref: row.source_ref,
        source_record_id: row.source_record_id,
        captured_by_agent_id: row.captured_by_agent_id,
        captured_by_kind: row.captured_by_kind,
        captured_by_label: row.captured_by_label,
      },
      certainty: row.state === "accepted" ? "accepted" : row.state === "pending" ? "observed" : "unverified",
      freshness: "point_in_time",
      contradictions: [],
    })));
  }

  private async upsertEntity(
    transaction: Transaction<Database>,
    schoolId: string,
    snapshot: CampusModelEntitySnapshot,
  ): Promise<EntityRow> {
    const result = await sql<EntityRow>`
      INSERT INTO campus_model_entities(
        school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
      ) VALUES (
        ${schoolId}::uuid,${snapshot.kind},${snapshot.domain},${snapshot.domain_id},
        ${snapshot.label},${snapshot.lifecycle_state},${snapshot.source_revision},
        ${JSON.stringify(snapshot.metadata)}::jsonb
      )
      ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
        kind=EXCLUDED.kind,label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
        source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,
        revision=CASE
          WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
            OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
            OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
            OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
            OR campus_model_entities.metadata IS DISTINCT FROM EXCLUDED.metadata
          THEN campus_model_entities.revision+1 ELSE campus_model_entities.revision END,
        updated_at=CASE
          WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
            OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
            OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
            OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
            OR campus_model_entities.metadata IS DISTINCT FROM EXCLUDED.metadata
          THEN now() ELSE campus_model_entities.updated_at END
      RETURNING id,domain,domain_id`.execute(transaction);
    const entity = result.rows[0];
    if (!entity) throw new ConflictException("The campus model could not register this domain record.");
    return entity;
  }

  private key(reference: { domain: string; domain_id: string }): string {
    return `${reference.domain}:${reference.domain_id}`;
  }

  private resolve(entities: Map<string, string>, reference: { domain: string; domain_id: string }): string {
    const id = entities.get(this.key(reference));
    if (!id) throw new ConflictException("The connected campus reference is missing from this command.");
    return id;
  }

  private async ensureHumanAgent(
    transaction: Transaction<Database>,
    schoolId: string,
    userId: string,
  ): Promise<AgentRow> {
    const result = await sql<AgentRow>`
      INSERT INTO campus_model_agents(school_id,agent_kind,user_id,label,status)
      SELECT ${schoolId}::uuid,'human',actor.id,
        COALESCE(NULLIF(trim(concat_ws(' ',actor.first_name,actor.last_name)),''),actor.username),
        CASE WHEN actor.is_active THEN 'active' ELSE 'revoked' END
      FROM users actor WHERE actor.id=${userId}::uuid
      ON CONFLICT(school_id,user_id) WHERE agent_kind='human' DO UPDATE SET
        label=EXCLUDED.label,status=EXCLUDED.status,
        revision=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          OR campus_model_agents.status IS DISTINCT FROM EXCLUDED.status
          THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
        updated_at=now()
      RETURNING id`.execute(transaction);
    const agent = result.rows[0];
    if (!agent) throw new ConflictException("The acting user could not be registered as a campus agent.");
    return agent;
  }

  private async ensureExternalAgent(
    transaction: Transaction<Database>,
    schoolId: string,
    source: { kind: "device" | "integration"; external_ref: string; label: string; metadata: Record<string, unknown> },
  ): Promise<AgentRow> {
    const result = await sql<AgentRow>`
      INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status,metadata)
      VALUES (${schoolId}::uuid,${source.kind},${source.external_ref},${source.label},'active',${JSON.stringify(source.metadata)}::jsonb)
      ON CONFLICT(school_id,agent_kind,external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET
        label=EXCLUDED.label,metadata=EXCLUDED.metadata,
        revision=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          OR campus_model_agents.metadata IS DISTINCT FROM EXCLUDED.metadata
          THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
        updated_at=now()
      RETURNING id`.execute(transaction);
    const agent = result.rows[0];
    if (!agent) throw new ConflictException("The observation source could not be registered as a campus agent.");
    return agent;
  }

  private async recordCommand(
    transaction: Transaction<Database>,
    input: AcceptedCampusModelChange,
    actorAgentId: string,
    targetEntityId: string,
  ): Promise<CommandRow> {
    const inserted = (await sql<CommandRow>`INSERT INTO campus_model_commands(
        school_id,command_type,target_entity_id,actor_agent_id,state,effective_at,expected_revision,
        authority_evidence,operating_rule_version_ref,correlation_id,causation_id,idempotency_key,
        source_domain,safe_context
      ) VALUES (
        ${input.school_id}::uuid,${input.command_type},${targetEntityId}::uuid,${actorAgentId}::uuid,'accepted',
        now(),${input.expected_revision},${input.authority_evidence}::text[],${input.operating_rule_version_ref},
        ${input.correlation_id}::uuid,${input.causation_id}::uuid,${input.idempotency_key},
        ${input.source_domain},${JSON.stringify(input.safe_context)}::jsonb
      ) ON CONFLICT(school_id,idempotency_key) DO NOTHING
      RETURNING id,command_type,target_entity_id,actor_agent_id`.execute(transaction)).rows[0];
    if (inserted) return inserted;

    const existing = (await sql<CommandRow>`SELECT id,command_type,target_entity_id,actor_agent_id
      FROM campus_model_commands WHERE school_id=${input.school_id}::uuid AND idempotency_key=${input.idempotency_key}
      FOR UPDATE`.execute(transaction)).rows[0];
    if (!existing || existing.command_type !== input.command_type || existing.target_entity_id !== targetEntityId || existing.actor_agent_id !== actorAgentId) {
      throw new ConflictException("This campus command key was already used for different work.");
    }
    return existing;
  }
}
