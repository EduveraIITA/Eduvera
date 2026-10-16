import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import type { CampusModelActivity, CampusModelChangeReceipt, CampusModelCorePort } from "./campus-model-core.port.js";
import type { ObservationIngressPort } from "./observation-ingress.port.js";
import {
  acceptedCampusModelChangeSchema,
  campusModelObservationSchema,
  campusModelObservationTransitionSchema,
  type AcceptedCampusModelChange,
  type CampusModelEntitySnapshot,
  type CampusModelObservation,
  type CampusModelObservationTransition,
} from "./contracts.js";

interface EntityRow { id: string; domain: string; domain_id: string }
interface AgentRow { id: string }
interface RelationshipRow { id: string; target_entity_id: string; effective_from: Date | string }
interface CommandRow { id: string; command_type: string; target_entity_id: string | null; actor_agent_id: string }
interface ObservationRow { id: string; request_hash: string }

@Injectable()
export class CampusModelCoreService implements CampusModelCorePort, ObservationIngressPort {
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
      const actor = await this.ensureHumanAgent(transaction, observation.school_id, observation.actor_user_id);
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
