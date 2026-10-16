import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import type { CampusModelActivity, CampusModelChangeReceipt, CampusModelCorePort, CampusOperationalSignal } from "./campus-model-core.port.js";
import type {
  CoordinationExceptionCode,
  CoordinationPublishReceipt,
  CoordinationRuntimePort,
  OperationalMessageOutcomeReceipt,
} from "./coordination-runtime.port.js";
import type { ObservationIngressPort } from "./observation-ingress.port.js";
import type { ObservationCapability, ObservationSource, ObservationSourceRegistryPort, RegisterObservationSource } from "./observation-source-registry.port.js";
import type {
  HumanAgentEndpointLinkReceipt,
  HumanAgentEndpointCloseReceipt,
  HumanAgentEndpointReplaceReceipt,
  HumanAgentIdentityPort,
  HumanAgentIdentityResolution,
  NonActingHumanAgentReason,
} from "./human-agent-identity.port.js";
import type {
  CampusTemporalAssertion,
  PlanReconciliationReceipt,
  ScheduleProjectionReceipt,
  TemporalContextPort,
} from "./temporal-context.port.js";
import {
  acceptedCampusModelChangeSchema,
  acceptedCoordinationEventSchema,
  campusModelObservationSchema,
  campusModelObservationTransitionSchema,
  campusTemporalContextQuerySchema,
  calendarClosureProjectionSchema,
  publishedDayPlanProjectionSchema,
  publishedScheduleProjectionSchema,
  coordinationRecipientAgentRefSchema,
  coordinationRecipientSelectorConfigSchema,
  humanAgentAccountEndpointLinkSchema,
  humanAgentAccountEndpointCloseSchema,
  humanAgentAccountEndpointReplaceSchema,
  humanAgentAccountResolutionSchema,
  humanAgentPersonResolutionSchema,
  operationalMessageOutcomeSchema,
  recipientOperationalMessageResponseSchema,
  type AcceptedCoordinationEvent,
  type AcceptedCampusModelChange,
  type CampusModelEntitySnapshot,
  type CampusModelObservation,
  type CampusModelObservationTransition,
  type CampusTemporalContextQuery,
  type CalendarClosureProjection,
  type CoordinationRecipientAgentRef,
  type HumanAgentAccountEndpointLink,
  type HumanAgentAccountEndpointClose,
  type HumanAgentAccountEndpointReplace,
  type HumanAgentAccountResolution,
  type HumanAgentPersonResolution,
  type PublishedDayPlanProjection,
  type PublishedScheduleProjection,
  type OperationalMessageOutcome,
  type RecipientOperationalMessageResponse,
} from "./contracts.js";

const uuid = z.string().uuid();

interface EntityRow { id: string; domain: string; domain_id: string }
interface AgentRow { id: string }
interface HumanAgentEndpointRow {
  agent_id: string;
  school_id: string;
  person_id: string;
  label: string;
  endpoint_id: string;
  user_id: string;
  effective_from: Date | string;
  effective_until: Date | string | null;
}
interface HumanAgentEndpointDiagnosticRow {
  agent_id: string;
  person_id: string;
  user_id: string;
  endpoint_active: boolean;
  account_active: boolean;
  membership_active: boolean;
  profile_linked: boolean;
}
interface ExistingHumanAgentEndpointRow {
  id: string;
  agent_id: string;
  person_id: string;
  status: "active" | "suspended" | "revoked";
  same_effective_from: boolean;
  same_effective_until: boolean;
  same_source: boolean;
  same_metadata: boolean;
}
interface HumanAgentEndpointTransitionTargetRow {
  endpoint_id: string;
  agent_id: string;
  person_id: string;
  user_id: string;
  status: "active" | "suspended" | "revoked";
  effective_from: Date | string;
  effective_until: Date | string | null;
  revision: number;
}
interface HumanAgentEndpointTransitionRow {
  id: string;
  endpoint_id: string;
  agent_id: string;
  transition_kind: "ended" | "revoked";
  next_status: "active" | "suspended" | "revoked";
  effective_at: Date | string;
  resulting_endpoint_revision: number;
  request_hash: string;
}
interface HumanAgentBootstrapAccountRow {
  is_active: boolean;
  active_member: boolean;
}
interface ExplicitPersonCandidateRow {
  person_id: string;
  source_kinds: string[];
}
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
interface OutboxEventRow {
  id: string;
  event_type: string;
  aggregate_id: string;
}
interface CoordinationSubscriptionRow {
  behaviour_version_id: string;
  behaviour_key: string;
  behaviour_version: number;
  behaviour_configuration: unknown;
  configuration_schema_version: number;
  subscription_id: string;
  subscription_key: string;
  reaction_kind: string;
  message_kind: "request" | "task" | "offer" | "update";
  message_schema_version: number;
  recipient_selector: unknown;
  response_due_after_seconds: number | null;
  expires_after_seconds: number | null;
  max_attempts: number;
  retry_after_seconds: number | null;
  priority: number;
}
interface AuthorizedRecipientRow {
  id: string;
  user_id: string | null;
  agent_kind: "human" | "team" | "device" | "integration" | "software";
  external_ref: string | null;
}
interface ReactionRow {
  id: string;
  request_hash: string;
}
interface OperationalMessageRow {
  id: string;
  reaction_id: string;
  state: "queued" | "delivered" | "acknowledged" | "responded" | "expired" | "cancelled" | "dead_letter";
  recipient_agent_id: string;
  sender_agent_id: string;
  correlation_id: string;
  recipient_agent_kind: "human" | "team" | "device" | "integration" | "software";
  selector_snapshot: unknown;
}
interface OperationalMessageOutcomeRow {
  id: string;
  message_id: string;
  state: "delivered" | "acknowledged" | "responded" | "expired" | "cancelled" | "dead_letter";
  request_hash: string;
}
interface CoordinationExceptionRow {
  id: string;
  exception_code: CoordinationExceptionCode;
}
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
export class CampusModelCoreService implements CampusModelCorePort, ObservationIngressPort, ObservationSourceRegistryPort, TemporalContextPort, CoordinationRuntimePort, HumanAgentIdentityPort {
  constructor(private readonly db: DatabaseService) {}

  async resolveAccountEndpoint(
    transaction: Transaction<Database>,
    rawInput: HumanAgentAccountResolution,
  ): Promise<HumanAgentIdentityResolution> {
    const input = humanAgentAccountResolutionSchema.parse(rawInput);
    return this.resolveAccountEndpointIn(transaction, input.school_id, input.user_id, input.at);
  }

  async resolvePersonAgent(
    transaction: Transaction<Database>,
    rawInput: HumanAgentPersonResolution,
  ): Promise<HumanAgentIdentityResolution> {
    const input = humanAgentPersonResolutionSchema.parse(rawInput);
    const person = (await sql<{ id: string }>`SELECT id FROM school_people
      WHERE school_id=${input.school_id}::uuid AND id=${input.person_id}::uuid
      FOR SHARE`.execute(transaction)).rows[0];
    if (!person) return this.nonActing(input.school_id, null, null, null, "person_not_found");

    const agent = (await sql<{ id: string }>`SELECT id FROM campus_model_agents
      WHERE school_id=${input.school_id}::uuid AND agent_kind='human' AND person_id=${input.person_id}::uuid
      FOR SHARE`.execute(transaction)).rows[0];
    if (!agent) return this.nonActing(input.school_id, input.person_id, null, null, "agent_not_registered");

    const endpoint = (await sql<{ user_id: string }>`SELECT user_id FROM campus_model_agent_endpoints
      WHERE school_id=${input.school_id}::uuid AND agent_id=${agent.id}::uuid
        AND endpoint_kind='account' AND user_id IS NOT NULL
        AND effective_from<=${input.at}::timestamptz
        AND (effective_until IS NULL OR effective_until>${input.at}::timestamptz)
      ORDER BY status='active' DESC,effective_from DESC,id DESC LIMIT 1
      FOR SHARE`.execute(transaction)).rows[0];
    if (!endpoint) {
      const hasHistory = (await sql<{ found: boolean }>`SELECT EXISTS(
        SELECT 1 FROM campus_model_agent_endpoints
        WHERE school_id=${input.school_id}::uuid AND agent_id=${agent.id}::uuid
          AND endpoint_kind='account'
      ) AS found`.execute(transaction)).rows[0]!.found;
      return this.nonActing(
        input.school_id,
        input.person_id,
        null,
        agent.id,
        hasHistory ? "endpoint_inactive" : "account_not_linked",
      );
    }
    return this.resolveAccountEndpointIn(transaction, input.school_id, endpoint.user_id, input.at);
  }

  async linkAccountEndpoint(
    transaction: Transaction<Database>,
    rawInput: HumanAgentAccountEndpointLink,
  ): Promise<HumanAgentEndpointLinkReceipt> {
    const input = humanAgentAccountEndpointLinkSchema.parse(rawInput);
    const actorAccess = (await sql<{ active_member: boolean; active_admin: boolean }>`SELECT
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.is_active AND actor.is_active
      ) AS active_member,
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.role='admin' AND membership.is_active AND actor.is_active
      ) AS active_admin`.execute(transaction)).rows[0]!;
    if (!actorAccess.active_member) {
      throw new ConflictException("The identity-linking operator is not active in this institution.");
    }
    if (input.actor_user_id !== input.user_id && !actorAccess.active_admin) {
      throw new ConflictException("Only the account owner or an active institution administrator can link this identity.");
    }

    const target = (await sql<{ label: string; linked: boolean }>`WITH explicit_person AS (
        SELECT student.person_id FROM students student
        WHERE student.school_id=${input.school_id}::uuid AND student.user_id=${input.user_id}::uuid
        UNION
        SELECT profile.person_id FROM parents parent
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
        WHERE profile.school_id=${input.school_id}::uuid AND parent.user_id=${input.user_id}::uuid
        UNION
        SELECT profile.person_id FROM staff_profiles profile
        WHERE profile.school_id=${input.school_id}::uuid AND profile.user_id=${input.user_id}::uuid
        UNION
        SELECT appointment.person_id FROM institution_governance_appointments appointment
        WHERE appointment.school_id=${input.school_id}::uuid
          AND appointment.linked_user_id=${input.user_id}::uuid
      ) SELECT
        COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),'Campus person') AS label,
        account.is_active
        AND EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id=person.id)
        AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>person.id)
        AND EXISTS(
          SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=person.school_id AND membership.user_id=account.id AND membership.is_active
            AND (
              membership.role='admin'
              OR (membership.role='staff' AND EXISTS(
                SELECT 1 FROM staff_profiles profile WHERE profile.school_id=person.school_id
                  AND profile.user_id=account.id AND profile.person_id=person.id AND profile.status='active'
              ))
              OR (membership.role='student' AND EXISTS(
                SELECT 1 FROM students student WHERE student.school_id=person.school_id
                  AND student.user_id=account.id AND student.person_id=person.id
              ))
              OR (membership.role='guardian' AND EXISTS(
                SELECT 1 FROM parents parent
                JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
                WHERE profile.school_id=person.school_id AND parent.user_id=account.id
                  AND profile.person_id=person.id
              ))
            )
        ) AS linked
      FROM school_people person CROSS JOIN users account
      WHERE person.school_id=${input.school_id}::uuid AND person.id=${input.person_id}::uuid
        AND account.id=${input.user_id}::uuid
      FOR SHARE OF person,account`.execute(transaction)).rows[0];
    if (!target) throw new ConflictException("The selected person or account does not exist.");
    if (!target.linked) {
      throw new ConflictException("The account needs an active institution membership linked to this person profile.");
    }

    const existing = (await sql<ExistingHumanAgentEndpointRow>`SELECT endpoint.id,endpoint.agent_id,
        agent.person_id,endpoint.status,
        endpoint.effective_from=${input.effective_from}::timestamptz AS same_effective_from,
        endpoint.effective_until IS NOT DISTINCT FROM ${input.effective_until}::timestamptz AS same_effective_until,
        (endpoint.source_domain=${input.source_domain} AND endpoint.source_record_id=${input.source_record_id}
          AND endpoint.source_revision=${input.source_revision}) AS same_source,
        endpoint.metadata=${JSON.stringify(input.metadata)}::jsonb AS same_metadata
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=${input.school_id}::uuid AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.user_id=${input.user_id}::uuid
        AND (
          (endpoint.source_domain=${input.source_domain}
            AND endpoint.source_record_id=${input.source_record_id}
            AND endpoint.source_revision=${input.source_revision})
          OR (
            endpoint.effective_from<=${input.effective_from}::timestamptz
            AND (endpoint.effective_until IS NULL OR endpoint.effective_until>${input.effective_from}::timestamptz)
          )
        )
      ORDER BY
        (endpoint.source_domain=${input.source_domain}
          AND endpoint.source_record_id=${input.source_record_id}
          AND endpoint.source_revision=${input.source_revision}) DESC,
        endpoint.effective_from DESC,endpoint.id DESC
      LIMIT 1 FOR UPDATE OF endpoint,agent`.execute(transaction)).rows[0];
    if (existing && existing.person_id !== input.person_id) {
      throw new ConflictException("This campus account is already linked to a different person.");
    }
    if (existing) {
      if (!existing.same_effective_from || !existing.same_effective_until
        || !existing.same_source || !existing.same_metadata) {
        throw new ConflictException("The account endpoint already exists with different identity evidence or dates.");
      }
      if (existing.status !== "active") {
        throw new ConflictException("A suspended or revoked account endpoint cannot be reactivated by replaying its link.");
      }
      const resolved = await this.resolveAccountEndpointIn(
        transaction,
        input.school_id,
        input.user_id,
        input.effective_from,
      );
      if (!resolved.acting) throw new ConflictException("The existing account endpoint is not currently able to act.");
      return { ...resolved, replayed: true };
    }

    const agent = (await sql<{ id: string }>`INSERT INTO campus_model_agents(
        school_id,agent_kind,person_id,label,status
      ) VALUES (${input.school_id}::uuid,'human',${input.person_id}::uuid,${target.label},'active')
      ON CONFLICT(school_id,person_id) WHERE agent_kind='human' DO UPDATE SET
        label=EXCLUDED.label,
        revision=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
        updated_at=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          THEN now() ELSE campus_model_agents.updated_at END
      RETURNING id`.execute(transaction)).rows[0];
    if (!agent) throw new ConflictException("The human agent identity could not be retained.");

    const inserted = (await sql<{ id: string }>`INSERT INTO campus_model_agent_endpoints(
        school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,effective_until,
        source_domain,source_record_id,source_revision,linked_by_user_id,metadata
      ) VALUES (
        ${input.school_id}::uuid,${agent.id}::uuid,'account','thatcampus',${input.user_id}::uuid,'active',
        ${input.effective_from}::timestamptz,${input.effective_until}::timestamptz,
        ${input.source_domain},${input.source_record_id},${input.source_revision},
        ${input.actor_user_id}::uuid,${JSON.stringify(input.metadata)}::jsonb
      ) RETURNING id`.execute(transaction)).rows[0];
    if (!inserted) throw new ConflictException("The account endpoint could not be linked.");
    const resolved = await this.resolveAccountEndpointIn(
      transaction,
      input.school_id,
      input.user_id,
      input.effective_from,
    );
    if (!resolved.acting) throw new ConflictException("The linked account endpoint is not able to act.");
    return { ...resolved, replayed: false };
  }

  async closeAccountEndpoint(
    transaction: Transaction<Database>,
    rawInput: HumanAgentAccountEndpointClose,
  ): Promise<HumanAgentEndpointCloseReceipt> {
    const input = humanAgentAccountEndpointCloseSchema.parse(rawInput);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await sql`SELECT pg_advisory_xact_lock(hashtext(
      'campus-human-endpoint-transition:'||${input.school_id}::text||':'||${input.idempotency_key}
    ))`.execute(transaction);

    const replay = (await sql<HumanAgentEndpointTransitionRow & { person_id: string; user_id: string }>`SELECT
        transition.id,transition.endpoint_id,transition.agent_id,transition.transition_kind,
        transition.next_status,transition.effective_at,transition.resulting_endpoint_revision,
        transition.request_hash,agent.person_id,endpoint.user_id
      FROM campus_model_agent_endpoint_transitions transition
      JOIN campus_model_agent_endpoints endpoint
        ON endpoint.id=transition.endpoint_id AND endpoint.school_id=transition.school_id
      JOIN campus_model_agents agent
        ON agent.id=transition.agent_id AND agent.school_id=transition.school_id
      WHERE transition.school_id=${input.school_id}::uuid
        AND transition.idempotency_key=${input.idempotency_key}
      FOR SHARE OF transition,endpoint,agent`.execute(transaction)).rows[0];
    if (replay) {
      if (replay.request_hash !== requestHash || replay.endpoint_id !== input.endpoint_id
        || replay.transition_kind !== input.disposition) {
        throw new ConflictException("This endpoint transition key was already used for different work.");
      }
      return {
        endpoint_id: replay.endpoint_id,
        agent_id: replay.agent_id,
        person_id: replay.person_id,
        user_id: replay.user_id,
        status: replay.next_status,
        effective_until: replay.effective_at,
        revision: replay.resulting_endpoint_revision,
        transition_id: replay.id,
        disposition: replay.transition_kind,
        replayed: true,
      };
    }

    const actorAccess = (await sql<{ active_member: boolean; active_admin: boolean }>`SELECT
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid
          AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.is_active AND actor.is_active
      ) AS active_member,
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid
          AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.role='admin' AND membership.is_active AND actor.is_active
      ) AS active_admin`.execute(transaction)).rows[0]!;
    if (!actorAccess.active_member) {
      throw new ConflictException("The identity-linking operator is not active in this institution.");
    }

    const target = (await sql<HumanAgentEndpointTransitionTargetRow>`SELECT
        endpoint.id AS endpoint_id,endpoint.agent_id,agent.person_id,endpoint.user_id,
        endpoint.status,endpoint.effective_from,endpoint.effective_until,endpoint.revision
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=${input.school_id}::uuid AND endpoint.id=${input.endpoint_id}::uuid
        AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
        AND endpoint.user_id IS NOT NULL AND agent.agent_kind='human'
      FOR UPDATE OF endpoint,agent`.execute(transaction)).rows[0];
    if (!target) throw new ConflictException("The account endpoint was not found in this institution.");
    if (target.user_id !== input.actor_user_id && !actorAccess.active_admin) {
      throw new ConflictException("Only the account owner or an active institution administrator can close this identity endpoint.");
    }
    if (target.revision !== input.expected_revision) {
      throw new ConflictException("This account endpoint changed. Refresh before continuing.");
    }
    if (target.status === "revoked") {
      throw new ConflictException("A revoked account endpoint cannot be changed.");
    }
    const effectiveAt = Date.parse(input.effective_at);
    if (effectiveAt <= new Date(target.effective_from).getTime()) {
      throw new ConflictException("The account endpoint must end after it became effective.");
    }
    if (target.effective_until && effectiveAt > new Date(target.effective_until).getTime()) {
      throw new ConflictException("The account endpoint already ends before this transition.");
    }
    if (input.disposition === "revoked" && effectiveAt > Date.now()) {
      throw new ConflictException("Schedule a normal endpoint end for a future account replacement; revocation is immediate.");
    }

    const nextStatus = input.disposition === "revoked" ? "revoked" : target.status;
    const updated = (await sql<{ revision: number }>`UPDATE campus_model_agent_endpoints SET
        status=${nextStatus},effective_until=${input.effective_at}::timestamptz,
        revision=revision+1,updated_at=now()
      WHERE school_id=${input.school_id}::uuid AND id=${input.endpoint_id}::uuid
        AND revision=${input.expected_revision}
      RETURNING revision`.execute(transaction)).rows[0];
    if (!updated) throw new ConflictException("This account endpoint changed. Refresh before continuing.");

    const transition = (await sql<{ id: string }>`INSERT INTO campus_model_agent_endpoint_transitions(
        school_id,endpoint_id,agent_id,transition_kind,previous_status,next_status,
        previous_effective_until,effective_at,resulting_endpoint_revision,reason,
        source_domain,source_record_id,source_revision,actor_user_id,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,${target.endpoint_id}::uuid,${target.agent_id}::uuid,
        ${input.disposition},${target.status},${nextStatus},${target.effective_until}::timestamptz,
        ${input.effective_at}::timestamptz,${updated.revision},${input.reason},${input.source_domain},
        ${input.source_record_id},${input.source_revision},${input.actor_user_id}::uuid,
        ${input.idempotency_key},${requestHash}
      ) RETURNING id`.execute(transaction)).rows[0];
    if (!transition) throw new ConflictException("The account endpoint transition could not be retained.");
    return {
      endpoint_id: target.endpoint_id,
      agent_id: target.agent_id,
      person_id: target.person_id,
      user_id: target.user_id,
      status: nextStatus,
      effective_until: input.effective_at,
      revision: updated.revision,
      transition_id: transition.id,
      disposition: input.disposition,
      replayed: false,
    };
  }

  async replaceAccountEndpoint(
    transaction: Transaction<Database>,
    rawInput: HumanAgentAccountEndpointReplace,
  ): Promise<HumanAgentEndpointReplaceReceipt> {
    const input = humanAgentAccountEndpointReplaceSchema.parse(rawInput);
    const closed = await this.closeAccountEndpoint(transaction, {
      school_id: input.school_id,
      endpoint_id: input.current_endpoint_id,
      actor_user_id: input.actor_user_id,
      expected_revision: input.current_expected_revision,
      effective_at: input.effective_at,
      disposition: input.current_disposition,
      reason: input.reason,
      source_domain: input.source_domain,
      source_record_id: input.source_record_id,
      source_revision: input.source_revision,
      idempotency_key: `${input.idempotency_key}:close`,
    });
    const linked = await this.linkAccountEndpoint(transaction, {
      school_id: input.school_id,
      person_id: closed.person_id,
      user_id: input.replacement_user_id,
      actor_user_id: input.actor_user_id,
      effective_from: input.effective_at,
      effective_until: null,
      source_domain: input.source_domain,
      source_record_id: input.source_record_id,
      source_revision: input.source_revision,
      metadata: {
        ...input.metadata,
        replacement_for_endpoint_id: input.current_endpoint_id,
        replacement_reason: input.reason,
      },
    });
    return { closed, linked, replayed: closed.replayed && linked.replayed };
  }

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
      if (observation.captured_by && observation.captured_by.kind !== "human" && observation.state === "accepted") {
        throw new ConflictException("Device and integration evidence must be reviewed by its owning workflow before acceptance.");
      }
      const actor = observation.captured_by
        ? observation.captured_by.kind === "human"
          ? await this.ensureHumanAgent(transaction, observation.school_id, observation.captured_by.user_id)
          : await this.requireAuthorizedExternalAgent(transaction, observation.school_id, observation.captured_by, observation.source_type, observation.context)
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

  async listObservationSources(schoolId: string): Promise<ObservationSource[]> {
    return this.listObservationSourcesIn(this.db, schoolId);
  }

  private async listObservationSourcesIn(executor: DatabaseService | Transaction<Database>, schoolId: string): Promise<ObservationSource[]> {
    return (await sql<ObservationSource>`SELECT agent.id,agent.agent_kind AS kind,agent.external_ref,agent.label,
        agent.status,agent.revision,agent.updated_at,scope.id AS scope_entity_id,scope.domain AS scope_domain,
        scope.domain_id AS scope_domain_id,scope.label AS scope_label,
        COALESCE(array_agg(authority.capability ORDER BY authority.capability)
          FILTER (WHERE authority.id IS NOT NULL AND authority.revoked_at IS NULL),ARRAY[]::varchar[]) AS capabilities
      FROM campus_model_agents agent
      LEFT JOIN campus_model_agent_authorities authority ON authority.agent_id=agent.id
        AND authority.school_id=agent.school_id AND authority.revoked_at IS NULL
        AND authority.effective_from<=now() AND (authority.effective_until IS NULL OR authority.effective_until>now())
      LEFT JOIN campus_model_entities scope ON scope.id=authority.scope_entity_id AND scope.school_id=agent.school_id
      WHERE agent.school_id=${schoolId}::uuid AND agent.agent_kind IN ('device','integration')
      GROUP BY agent.id,scope.id,scope.domain,scope.domain_id,scope.label
      HAVING count(authority.id)>0
      ORDER BY agent.status='active' DESC,agent.label`.execute(executor)).rows;
  }

  async registerObservationSource(transaction: Transaction<Database>, input: RegisterObservationSource): Promise<ObservationSource> {
    const scope = input.scope ? (await sql<EntityRow & { label: string }>`SELECT id,domain,domain_id,label FROM campus_model_entities
      WHERE school_id=${input.school_id}::uuid AND domain=${input.scope.domain} AND domain_id=${input.scope.domain_id}
      FOR UPDATE`.execute(transaction)).rows[0] : null;
    if (input.scope && !scope) throw new ConflictException("The selected campus scope is not connected yet.");
    const existing = (await sql<{ id: string }>`SELECT id FROM campus_model_agents WHERE school_id=${input.school_id}::uuid
      AND agent_kind=${input.kind} AND external_ref=${input.external_ref} FOR UPDATE`.execute(transaction)).rows[0];
    if (existing) throw new ConflictException("This source ID is already registered.");
    const agent = (await sql<{ id: string }>`INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status,metadata)
      VALUES(${input.school_id}::uuid,${input.kind},${input.external_ref},${input.label},'active','{}'::jsonb)
      RETURNING id`.execute(transaction)).rows[0];
    if (!agent) throw new ConflictException("The source could not be registered.");
    for (const capability of input.capabilities) {
      await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,scope_entity_id,effective_from,
        grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints)
        VALUES(${input.school_id}::uuid,${agent.id}::uuid,${capability},${scope?.id ?? null}::uuid,now(),
          'institution_setup',${`observation-source:${agent.id}`},${input.actor_user_id}::uuid,
          ${input.operating_rule_version_ref},'{}'::jsonb)`.execute(transaction);
    }
    return (await this.listObservationSourcesIn(transaction, input.school_id)).find((item) => item.id === agent.id)!;
  }

  async setObservationSourceStatus(transaction: Transaction<Database>, input: { school_id: string; actor_user_id: string; source_id: string; status: "active" | "suspended" | "revoked"; expected_revision: number }): Promise<ObservationSource> {
    const current = (await sql<{ status: string }>`SELECT status FROM campus_model_agents WHERE id=${input.source_id}::uuid
      AND school_id=${input.school_id}::uuid AND agent_kind IN ('device','integration') FOR UPDATE`.execute(transaction)).rows[0];
    if (!current) throw new ConflictException("The device or connection was not found.");
    if (current.status === "revoked" && input.status !== "revoked") throw new ConflictException("A revoked source cannot be reactivated. Register it again with a new source ID.");
    const updated = (await sql<{ id: string }>`UPDATE campus_model_agents SET status=${input.status},revision=revision+1,updated_at=now()
      WHERE id=${input.source_id}::uuid AND school_id=${input.school_id}::uuid AND revision=${input.expected_revision}
      RETURNING id`.execute(transaction)).rows[0];
    if (!updated) throw new ConflictException("This source changed. Refresh and review its latest state.");
    if (input.status === "revoked") await sql`UPDATE campus_model_agent_authorities SET revoked_at=now(),revoked_by=${input.actor_user_id}::uuid
      WHERE school_id=${input.school_id}::uuid AND agent_id=${input.source_id}::uuid AND revoked_at IS NULL`.execute(transaction);
    return (await this.listObservationSourcesIn(transaction, input.school_id)).find((item) => item.id === input.source_id)!;
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

  async publishAcceptedEvent(
    transaction: Transaction<Database>,
    rawInput: AcceptedCoordinationEvent,
  ): Promise<CoordinationPublishReceipt> {
    const input = acceptedCoordinationEventSchema.parse(rawInput);
    const sourceOutbox = (await sql<OutboxEventRow>`SELECT id,event_type,aggregate_id::text AS aggregate_id
      FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
      FOR KEY SHARE`.execute(transaction)).rows[0];
    if (!sourceOutbox || sourceOutbox.event_type !== input.event_type || sourceOutbox.aggregate_id !== input.source_record_id) {
      throw new ConflictException("The accepted domain event does not match its source outbox record.");
    }

    const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
    const subject = await this.upsertEntity(transaction, input.school_id, input.subject);
    const context = input.context ? await this.upsertEntity(transaction, input.school_id, input.context) : null;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const insertedEvent = (await sql<EventRow>`INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,causation_event_id,provenance,payload,schema_version,idempotency_key,
        request_hash,source_outbox_event_id
      ) VALUES (
        ${input.school_id}::uuid,${input.event_kind},${input.event_type},${subject.id}::uuid,
        ${context?.id ?? null}::uuid,${actor.id}::uuid,${input.source_domain},${input.source_record_id},
        ${input.source_revision},${input.occurred_at}::timestamptz,${input.effective_from}::timestamptz,
        ${input.effective_until}::timestamptz,${input.correlation_id}::uuid,
        ${input.causation_event_id}::uuid,
        ${JSON.stringify({ source: "event_outbox", source_outbox_event_id: input.source_outbox_event_id })}::jsonb,
        ${JSON.stringify(input.payload)}::jsonb,1,${input.idempotency_key},${requestHash},
        ${input.source_outbox_event_id}::uuid
      ) ON CONFLICT(school_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash`.execute(transaction)).rows[0];
    const event = insertedEvent ?? (await sql<EventRow>`SELECT id,request_hash FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${input.idempotency_key}
      FOR UPDATE`.execute(transaction)).rows[0];
    if (!event || event.request_hash !== requestHash) {
      throw new ConflictException("This coordination event key was already used for different work.");
    }

    if (!insertedEvent) {
      const existing = (await sql<{
        reaction_id: string;
        message_id: string;
        behaviour_version_id: string;
        subscription_id: string;
        recipient_agent_id: string;
        selector_snapshot: unknown;
      }>`SELECT reaction.id AS reaction_id,message.id AS message_id,
          reaction.behaviour_version_id,reaction.subscription_id,
          reaction.recipient_agent_id,reaction.selector_snapshot
        FROM campus_model_reactions reaction
        JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        WHERE reaction.school_id=${input.school_id}::uuid AND reaction.trigger_event_id=${event.id}::uuid
        ORDER BY reaction.created_at,reaction.id`.execute(transaction)).rows;
      if (existing.length > 0) {
        return {
          status: "matched",
          event_id: event.id,
          behaviour_version_id: existing[0]!.behaviour_version_id,
          subscription_id: existing[0]!.subscription_id,
          reaction_ids: existing.map((item) => item.reaction_id),
          message_ids: existing.map((item) => item.message_id),
          deliveries: existing.map((item) => {
            const snapshot = item.selector_snapshot as {
              input?: { recipient_agents?: unknown[]; resolved_recipient_agent_ids?: unknown[] };
            };
            const resolvedIds = snapshot.input?.resolved_recipient_agent_ids;
            const originalRecipients = snapshot.input?.recipient_agents;
            if (!Array.isArray(resolvedIds) || !Array.isArray(originalRecipients)) {
              throw new ConflictException("The retained reaction does not contain its original recipient evidence.");
            }
            const recipientIndex = resolvedIds.findIndex((agentId) => agentId === item.recipient_agent_id);
            if (recipientIndex < 0 || recipientIndex >= originalRecipients.length) {
              throw new ConflictException("The retained reaction recipient does not match its selector evidence.");
            }
            const recipient = coordinationRecipientAgentRefSchema.parse(originalRecipients[recipientIndex]);
            return { reaction_id: item.reaction_id, message_id: item.message_id, recipient };
          }),
          replayed: true,
        };
      }
      const existingException = (await sql<CoordinationExceptionRow>`SELECT id,exception_code
        FROM campus_model_coordination_exceptions
        WHERE school_id=${input.school_id}::uuid AND trigger_event_id=${event.id}::uuid`.execute(transaction)).rows[0];
      if (existingException) {
        return {
          status: "unmatched",
          event_id: event.id,
          exception_id: existingException.id,
          exception_code: existingException.exception_code,
          reaction_ids: [],
          message_ids: [],
          replayed: true,
        };
      }
    }

    const matches = (await sql<CoordinationSubscriptionRow>`SELECT
        behaviour.id AS behaviour_version_id,behaviour.behaviour_key,
        behaviour.version AS behaviour_version,behaviour.configuration AS behaviour_configuration,
        behaviour.configuration_schema_version,subscription.id AS subscription_id,
        subscription.subscription_key,subscription.reaction_kind,subscription.message_kind,
        subscription.message_schema_version,subscription.recipient_selector,
        subscription.response_due_after_seconds,subscription.expires_after_seconds,
        subscription.max_attempts,subscription.retry_after_seconds,subscription.priority
      FROM campus_model_behaviour_versions behaviour
      JOIN campus_model_event_subscriptions subscription
        ON subscription.behaviour_version_id=behaviour.id AND subscription.school_id=behaviour.school_id
      WHERE behaviour.school_id=${input.school_id}::uuid AND behaviour.status='approved'
        AND behaviour.effective_from<=${input.occurred_at}::timestamptz
        AND (behaviour.effective_until IS NULL OR behaviour.effective_until>${input.occurred_at}::timestamptz)
        AND subscription.source_domain=${input.source_domain}
        AND subscription.event_type=${input.event_type}
        AND subscription.recipient_selector->>'selector_key'=${input.selector_input.selector_key}
      FOR SHARE OF behaviour,subscription`.execute(transaction)).rows;
    if (matches.length === 0) {
      return this.recordCoordinationException(transaction, input, event.id, "configuration_missing",
        "No approved Operating-rule behaviour is active for this campus event.",
        { source_domain: input.source_domain, event_type: input.event_type, selector_key: input.selector_input.selector_key });
    }
    if (matches.length !== 1) {
      return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid",
        "More than one Operating-rule behaviour matches this campus event. Retire the overlap before replaying it.",
        { matching_behaviour_version_ids: matches.map((item) => item.behaviour_version_id) });
    }
    const match = matches[0]!;
    const parsedSelector = coordinationRecipientSelectorConfigSchema.safeParse(match.recipient_selector);
    if (!parsedSelector.success) {
      return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid",
        "The approved behaviour has an invalid recipient selector.",
        { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
    }
    const selector = parsedSelector.data;
    if (selector.selector_key !== input.selector_input.selector_key) {
      return this.recordCoordinationException(transaction, input, event.id, "selector_invalid",
        "The supplied recipient selector does not match the approved behaviour.",
        { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
    }
    if (input.selector_input.recipient_agents.length < selector.min_recipients
      || input.selector_input.recipient_agents.length > selector.max_recipients) {
      return this.recordCoordinationException(transaction, input, event.id, "selector_invalid",
        "The selected recipient count is outside the approved behaviour.",
        { minimum: selector.min_recipients, maximum: selector.max_recipients, selected: input.selector_input.recipient_agents.length });
    }
    if (selector.scope_mode === "event_scope" && !input.selector_input.scope) {
      return this.recordCoordinationException(transaction, input, event.id, "selector_invalid",
        "This approved behaviour requires an explicit campus scope.",
        { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
    }
    if (selector.scope_mode === "institution" && input.selector_input.scope) {
      return this.recordCoordinationException(transaction, input, event.id, "selector_invalid",
        "This approved behaviour is institution-scoped and cannot accept a narrower selector scope.",
        { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
    }
    const scope = input.selector_input.scope
      ? await this.upsertEntity(transaction, input.school_id, input.selector_input.scope)
      : null;

    const resolvedRecipients: AuthorizedRecipientRow[] = [];
    for (const recipientRef of input.selector_input.recipient_agents) {
      const recipient = await this.resolveAgentReference(transaction, input.school_id, recipientRef);
      if (!recipient) {
        return this.recordCoordinationException(transaction, input, event.id, "recipient_unresolved",
          "An explicitly selected recipient does not resolve to an active campus agent.",
          { recipient: recipientRef });
      }
      resolvedRecipients.push(recipient);
    }
    const resolvedRecipientIds = resolvedRecipients.map((recipient) => recipient.id);
    const recipients = (await sql<AuthorizedRecipientRow>`SELECT agent.id,NULL::uuid AS user_id,agent.agent_kind,agent.external_ref
      FROM campus_model_agents agent
      WHERE agent.school_id=${input.school_id}::uuid
        AND agent.id=ANY(${resolvedRecipientIds}::uuid[])
        AND agent.status='active' AND EXISTS (
          SELECT 1 FROM campus_model_agent_authorities authority
          WHERE authority.agent_id=agent.id AND authority.school_id=agent.school_id
            AND authority.capability=${selector.required_capability}
            AND authority.revoked_at IS NULL
            AND authority.effective_from<=CURRENT_TIMESTAMP
            AND (authority.effective_until IS NULL OR authority.effective_until>CURRENT_TIMESTAMP)
            AND (
              (${selector.scope_mode}='institution' AND authority.scope_entity_id IS NULL)
              OR (${selector.scope_mode}='event_scope' AND (authority.scope_entity_id IS NULL OR authority.scope_entity_id=${scope?.id ?? null}::uuid))
            )
        )
      ORDER BY agent.id
      FOR SHARE OF agent`.execute(transaction)).rows;
    if (recipients.length !== resolvedRecipientIds.length) {
      return this.recordCoordinationException(transaction, input, event.id, "recipient_unauthorized",
        "Every selected recipient must be active and authorized by the approved behaviour scope.",
        { required_capability: selector.required_capability, scope_entity_id: scope?.id ?? null });
    }

    const queuedAt = new Date().toISOString();
    const responseDueAt = match.response_due_after_seconds === null
      ? null
      : new Date(Date.parse(queuedAt) + match.response_due_after_seconds * 1_000).toISOString();
    const expiresAt = match.expires_after_seconds === null
      ? null
      : new Date(Date.parse(queuedAt) + match.expires_after_seconds * 1_000).toISOString();
    if (responseDueAt && expiresAt && Date.parse(responseDueAt) > Date.parse(expiresAt)) {
      return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid",
        "The approved behaviour has a response deadline after its expiry.",
        { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
    }
    const behaviourSnapshot = {
      behaviour_key: match.behaviour_key,
      version: match.behaviour_version,
      configuration_schema_version: match.configuration_schema_version,
      configuration: match.behaviour_configuration,
      subscription: {
        subscription_key: match.subscription_key,
        reaction_kind: match.reaction_kind,
        message_kind: match.message_kind,
        message_schema_version: match.message_schema_version,
        response_due_after_seconds: match.response_due_after_seconds,
        expires_after_seconds: match.expires_after_seconds,
        max_attempts: match.max_attempts,
        retry_after_seconds: match.retry_after_seconds,
        priority: match.priority,
      },
    };
    const selectorSnapshot = {
      config: selector,
      input: {
        selector_key: input.selector_input.selector_key,
        recipient_agents: input.selector_input.recipient_agents,
        resolved_recipient_agent_ids: resolvedRecipientIds,
        scope_entity_id: scope?.id ?? null,
      },
    };
    const recipientUsers = new Map(resolvedRecipients.map((recipient) => [recipient.id, recipient.user_id]));
    const recipientRefs = new Map(resolvedRecipients.map((recipient, index) => [recipient.id, input.selector_input.recipient_agents[index]!]));
    const reactionIds: string[] = [];
    const messageIds: string[] = [];
    const deliveries: Array<{
      reaction_id: string;
      message_id: string;
      recipient: (typeof input.selector_input.recipient_agents)[number];
    }> = [];

    for (const recipientAgentId of resolvedRecipientIds) {
      const reactionIdempotencyKey = `coordination-reaction:${event.id}:${match.subscription_id}:${recipientAgentId}`;
      const reactionRequestHash = createHash("sha256").update(JSON.stringify({
        event_id: event.id,
        behaviour_version_id: match.behaviour_version_id,
        subscription_id: match.subscription_id,
        recipient_agent_id: recipientAgentId,
        selector: selectorSnapshot,
        message: input.message,
      })).digest("hex");
      const insertedReaction = (await sql<ReactionRow>`INSERT INTO campus_model_reactions(
          school_id,trigger_event_id,source_outbox_event_id,behaviour_version_id,subscription_id,
          recipient_agent_id,reaction_kind,state,selector_snapshot,behaviour_snapshot,correlation_id,
          causation_event_id,attempt_count,max_attempts,next_attempt_at,response_due_at,expires_at,
          idempotency_key,request_hash
        ) VALUES (
          ${input.school_id}::uuid,${event.id}::uuid,${input.source_outbox_event_id}::uuid,
          ${match.behaviour_version_id}::uuid,${match.subscription_id}::uuid,${recipientAgentId}::uuid,
          ${match.reaction_kind},'queued',${JSON.stringify(selectorSnapshot)}::jsonb,
          ${JSON.stringify(behaviourSnapshot)}::jsonb,${input.correlation_id}::uuid,
          ${event.id}::uuid,0,${match.max_attempts},${queuedAt}::timestamptz,
          ${responseDueAt}::timestamptz,${expiresAt}::timestamptz,
          ${reactionIdempotencyKey},${reactionRequestHash}
        ) ON CONFLICT(school_id,idempotency_key) DO NOTHING
        RETURNING id,request_hash`.execute(transaction)).rows[0];
      const reaction = insertedReaction ?? (await sql<ReactionRow>`SELECT id,request_hash
        FROM campus_model_reactions
        WHERE school_id=${input.school_id}::uuid AND idempotency_key=${reactionIdempotencyKey}
        FOR UPDATE`.execute(transaction)).rows[0];
      if (!reaction || reaction.request_hash !== reactionRequestHash) {
        throw new ConflictException("This reaction key was already used for different work.");
      }

      const insertedMessage = (await sql<{ id: string }>`INSERT INTO campus_model_operational_messages(
          school_id,reaction_id,sender_agent_id,recipient_agent_id,owner_agent_id,message_kind,state,
          subject,summary,payload,schema_version,correlation_id,causation_event_id,
          source_outbox_event_id,response_due_at,expires_at,queued_at
        ) VALUES (
          ${input.school_id}::uuid,${reaction.id}::uuid,${actor.id}::uuid,${recipientAgentId}::uuid,
          ${recipientAgentId}::uuid,${match.message_kind},'queued',${input.message.subject},
          ${input.message.summary},${JSON.stringify(input.message.payload)}::jsonb,
          ${match.message_schema_version},${input.correlation_id}::uuid,${event.id}::uuid,
          ${input.source_outbox_event_id}::uuid,${responseDueAt}::timestamptz,
          ${expiresAt}::timestamptz,${queuedAt}::timestamptz
        ) ON CONFLICT(reaction_id) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
      const message = insertedMessage ?? (await sql<{ id: string }>`SELECT id
        FROM campus_model_operational_messages WHERE reaction_id=${reaction.id}::uuid
        FOR UPDATE`.execute(transaction)).rows[0];
      if (!message) throw new ConflictException("The operational message could not be queued.");

      const dispatchKey = `campus-model:message:${message.id}:queued`;
      const dispatchAudience = recipientUsers.get(recipientAgentId)
        ? [recipientUsers.get(recipientAgentId)!]
        : [];
      const dispatchPayload = {
        message_id: message.id,
        reaction_id: reaction.id,
        message_kind: match.message_kind,
        state: "queued",
        correlation_id: input.correlation_id,
        source_outbox_event_id: input.source_outbox_event_id,
      };
      const dispatch = (await sql<{ id: string }>`INSERT INTO event_outbox(
          school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key
        ) VALUES (
          ${input.school_id}::uuid,'campus.coordination.message_queued','campus_operational_message',
          ${message.id}::uuid,${dispatchAudience}::uuid[],${JSON.stringify(dispatchPayload)}::jsonb,${dispatchKey}
        ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0]
        ?? (await sql<{ id: string }>`SELECT id FROM event_outbox
          WHERE idempotency_key=${dispatchKey}
            AND school_id=${input.school_id}::uuid
            AND event_type='campus.coordination.message_queued'
            AND aggregate_type='campus_operational_message'
            AND aggregate_id=${message.id}::uuid
            AND audience_user_ids=${dispatchAudience}::uuid[]
            AND payload=${JSON.stringify(dispatchPayload)}::jsonb
            AND notification_user_ids='{}'::uuid[]
            AND notification_payload IS NULL
          FOR UPDATE`.execute(transaction)).rows[0];
      if (!dispatch) throw new ConflictException("The operational message dispatch could not be retained.");
      await sql`UPDATE campus_model_operational_messages
        SET dispatch_outbox_event_id=${dispatch.id}::uuid,updated_at=now()
        WHERE id=${message.id}::uuid AND school_id=${input.school_id}::uuid
          AND (dispatch_outbox_event_id IS NULL OR dispatch_outbox_event_id=${dispatch.id}::uuid)`.execute(transaction);
      reactionIds.push(reaction.id);
      messageIds.push(message.id);
      deliveries.push({ reaction_id: reaction.id, message_id: message.id, recipient: recipientRefs.get(recipientAgentId)! });
    }

    return {
      status: "matched",
      event_id: event.id,
      behaviour_version_id: match.behaviour_version_id,
      subscription_id: match.subscription_id,
      reaction_ids: reactionIds,
      message_ids: messageIds,
      deliveries,
      replayed: false,
    };
  }

  async recordRecipientResponse(
    transaction: Transaction<Database>,
    rawInput: RecipientOperationalMessageResponse,
  ): Promise<OperationalMessageOutcomeReceipt> {
    const input = recipientOperationalMessageResponseSchema.parse(rawInput);
    const recipient = await this.resolveAgentReference(transaction, input.school_id, input.recipient);
    if (!recipient) throw new ConflictException("The assigned recipient is not active in this institution.");

    const replay = (await sql<{ message_id: string }>`SELECT message.id AS message_id
      FROM campus_model_operational_message_outcomes outcome
      JOIN campus_model_operational_messages message
        ON message.id=outcome.message_id AND message.school_id=outcome.school_id
      JOIN campus_model_reactions reaction
        ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
      JOIN campus_model_events event
        ON event.id=reaction.trigger_event_id AND event.school_id=reaction.school_id
      WHERE outcome.school_id=${input.school_id}::uuid
        AND outcome.idempotency_key=${input.idempotency_key}
        AND outcome.state='responded' AND message.id=${input.message_id}::uuid
        AND message.correlation_id=${input.correlation_id}::uuid
        AND message.recipient_agent_id=${recipient.id}::uuid
        AND event.source_record_id=${input.expected_source_record_id}
        AND event.source_revision=${input.expected_source_revision}`.execute(transaction)).rows[0];
    if (replay) {
      return this.recordMessageOutcome(transaction, {
        school_id: input.school_id,
        message_id: replay.message_id,
        state: "responded",
        actor: input.actor,
        source_outbox_event_id: input.source_outbox_event_id,
        code: input.code,
        explanation: input.explanation,
        response: input.response,
        occurred_at: input.occurred_at,
        idempotency_key: input.idempotency_key,
      });
    }

    const message = (await sql<{
      message_id: string;
      state: OperationalMessageRow["state"];
      source_record_id: string;
      source_revision: number;
      selector_snapshot: unknown;
    }>`SELECT
        message.id AS message_id,message.state,event.source_record_id,event.source_revision,
        reaction.selector_snapshot
      FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
      JOIN campus_model_events event ON event.id=reaction.trigger_event_id AND event.school_id=reaction.school_id
      WHERE message.school_id=${input.school_id}::uuid AND message.id=${input.message_id}::uuid
        AND message.correlation_id=${input.correlation_id}::uuid
        AND message.recipient_agent_id=${recipient.id}::uuid
        AND message.state IN ('queued','delivered','acknowledged')
      FOR UPDATE OF message`.execute(transaction)).rows[0];
    if (!message) throw new ConflictException("No open operational request matches this message, recipient and correlation.");
    if (message.source_record_id !== input.expected_source_record_id) {
      throw new ConflictException("The operational request does not belong to this source record.");
    }
    if (message.source_revision !== input.expected_source_revision) {
      throw new ConflictException("The source record changed. Refresh before responding to this request.");
    }
    const selectorSnapshot = message.selector_snapshot as {
      config?: unknown;
      input?: { scope_entity_id?: unknown };
    };
    const selector = coordinationRecipientSelectorConfigSchema.safeParse(selectorSnapshot.config);
    if (!selector.success) {
      throw new ConflictException("The operational request has invalid authority evidence.");
    }
    const scopeEntityId = selectorSnapshot.input?.scope_entity_id;
    if (scopeEntityId !== null && scopeEntityId !== undefined
      && (typeof scopeEntityId !== "string" || !uuid.safeParse(scopeEntityId).success)) {
      throw new ConflictException("The operational request has invalid scope evidence.");
    }
    const currentAuthorityGrants = (await sql<{ id: string }>`SELECT authority.id
      FROM campus_model_agent_authorities authority
      WHERE authority.school_id=${input.school_id}::uuid
        AND authority.agent_id=${recipient.id}::uuid
        AND authority.capability=${selector.data.required_capability}
        AND authority.revoked_at IS NULL
        AND authority.effective_from<=CURRENT_TIMESTAMP
        AND (authority.effective_until IS NULL OR authority.effective_until>CURRENT_TIMESTAMP)
        AND (
          (${selector.data.scope_mode}='institution' AND authority.scope_entity_id IS NULL)
          OR (${selector.data.scope_mode}='event_scope' AND (
            authority.scope_entity_id IS NULL
            OR authority.scope_entity_id=${scopeEntityId ?? null}::uuid
          ))
        )
      FOR SHARE OF authority`.execute(transaction)).rows;
    if (currentAuthorityGrants.length === 0) {
      throw new ConflictException("The assigned recipient no longer has the capability required by this request.");
    }

    if (message.state === "queued") {
      await this.recordMessageOutcome(transaction, {
        school_id: input.school_id,
        message_id: message.message_id,
        state: "delivered",
        actor: null,
        source_outbox_event_id: null,
        code: "delivered_by_domain_response",
        explanation: "The assigned recipient responded through the authoritative domain workflow.",
        response: null,
        occurred_at: input.occurred_at,
        idempotency_key: `${input.idempotency_key}:delivery`,
      });
    }
    return this.recordMessageOutcome(transaction, {
      school_id: input.school_id,
      message_id: message.message_id,
      state: "responded",
      actor: input.actor,
      source_outbox_event_id: input.source_outbox_event_id,
      code: input.code,
      explanation: input.explanation,
      response: input.response,
      occurred_at: input.occurred_at,
      idempotency_key: input.idempotency_key,
    });
  }

  async recordMessageOutcome(
    transaction: Transaction<Database>,
    rawInput: OperationalMessageOutcome,
  ): Promise<OperationalMessageOutcomeReceipt> {
    const input = operationalMessageOutcomeSchema.parse(rawInput);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existingOutcome = (await sql<OperationalMessageOutcomeRow>`SELECT id,message_id,state,request_hash
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
    if (existingOutcome) {
      if (existingOutcome.message_id !== input.message_id || existingOutcome.state !== input.state || existingOutcome.request_hash !== requestHash) {
        throw new ConflictException("This message outcome key was already used for a different result.");
      }
      const reaction = (await sql<{ reaction_id: string }>`SELECT reaction_id FROM campus_model_operational_messages
        WHERE id=${input.message_id}::uuid AND school_id=${input.school_id}::uuid`.execute(transaction)).rows[0];
      if (!reaction) throw new ConflictException("The operational message was not found.");
      return {
        message_id: input.message_id,
        reaction_id: reaction.reaction_id,
        state: input.state,
        outcome_id: existingOutcome.id,
        replayed: true,
      };
    }

    const message = (await sql<OperationalMessageRow>`SELECT message.id,message.reaction_id,message.state,
        message.recipient_agent_id,message.sender_agent_id,message.correlation_id,
        recipient.agent_kind AS recipient_agent_kind,reaction.selector_snapshot
      FROM campus_model_operational_messages message
      JOIN campus_model_agents recipient ON recipient.id=message.recipient_agent_id AND recipient.school_id=message.school_id
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
      WHERE message.id=${input.message_id}::uuid AND message.school_id=${input.school_id}::uuid
      FOR UPDATE OF message`.execute(transaction)).rows[0];
    if (!message) throw new ConflictException("The operational message was not found.");
    const concurrentOutcome = (await sql<OperationalMessageOutcomeRow>`SELECT id,message_id,state,request_hash
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
    if (concurrentOutcome) {
      if (concurrentOutcome.message_id !== input.message_id || concurrentOutcome.state !== input.state || concurrentOutcome.request_hash !== requestHash) {
        throw new ConflictException("This message outcome key was already used for a different result.");
      }
      return {
        message_id: input.message_id,
        reaction_id: message.reaction_id,
        state: input.state,
        outcome_id: concurrentOutcome.id,
        replayed: true,
      };
    }
    const allowed: Record<OperationalMessageRow["state"], OperationalMessageOutcome["state"][]> = {
      queued: ["delivered", "expired", "cancelled", "dead_letter"],
      delivered: ["acknowledged", "responded", "expired", "cancelled", "dead_letter"],
      acknowledged: ["responded", "expired", "cancelled", "dead_letter"],
      responded: [],
      expired: [],
      cancelled: [],
      dead_letter: [],
    };
    if (!allowed[message.state].includes(input.state)) {
      throw new ConflictException(`A ${message.state} message cannot transition to ${input.state}.`);
    }

    let actorAgent: AuthorizedRecipientRow | null = null;
    if (input.actor) {
      actorAgent = await this.resolveAgentReference(transaction, input.school_id, input.actor) ?? null;
      if (!actorAgent) throw new ConflictException("The responding agent is not active in this institution.");
      const senderMayCancel = input.state === "cancelled" && actorAgent.id === message.sender_agent_id;
      if (actorAgent.id !== message.recipient_agent_id && !senderMayCancel) {
        throw new ConflictException("Only the assigned recipient may act on this work, except that its original sender may cancel it.");
      }
    }
    if (input.source_outbox_event_id) {
      const source = (await sql<{ id: string }>`SELECT id FROM event_outbox
        WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
        FOR KEY SHARE`.execute(transaction)).rows[0];
      if (!source) throw new ConflictException("The message outcome source event does not belong to this institution.");
    }

    const sequence = (await sql<{ sequence: number }>`SELECT COALESCE(max(sequence),0)::int+1 AS sequence
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND message_id=${input.message_id}::uuid`.execute(transaction)).rows[0]!.sequence;
    const outcome = (await sql<{ id: string }>`INSERT INTO campus_model_operational_message_outcomes(
        school_id,message_id,sequence,state,actor_agent_id,source_outbox_event_id,code,
        explanation,response,occurred_at,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,${input.message_id}::uuid,${sequence},${input.state},
        ${actorAgent?.id ?? null}::uuid,${input.source_outbox_event_id}::uuid,${input.code},
        ${input.explanation},${input.response ? JSON.stringify(input.response) : null}::jsonb,
        ${input.occurred_at}::timestamptz,${input.idempotency_key},${requestHash}
      ) RETURNING id`.execute(transaction)).rows[0];
    if (!outcome) throw new ConflictException("The operational message outcome could not be retained.");

    await sql`UPDATE campus_model_operational_messages SET
        state=${input.state},updated_at=now(),
        delivered_at=CASE WHEN ${input.state}='delivered' THEN ${input.occurred_at}::timestamptz ELSE delivered_at END,
        acknowledged_at=CASE WHEN ${input.state}='acknowledged' THEN ${input.occurred_at}::timestamptz ELSE acknowledged_at END,
        responded_at=CASE WHEN ${input.state}='responded' THEN ${input.occurred_at}::timestamptz ELSE responded_at END,
        expired_at=CASE WHEN ${input.state}='expired' THEN ${input.occurred_at}::timestamptz ELSE expired_at END,
        cancelled_at=CASE WHEN ${input.state}='cancelled' THEN ${input.occurred_at}::timestamptz ELSE cancelled_at END,
        dead_lettered_at=CASE WHEN ${input.state}='dead_letter' THEN ${input.occurred_at}::timestamptz ELSE dead_lettered_at END
      WHERE id=${input.message_id}::uuid AND school_id=${input.school_id}::uuid`.execute(transaction);
    const reactionState = input.state === "responded" ? "completed" : input.state;
    await sql`UPDATE campus_model_reactions SET state=${reactionState},updated_at=now(),
        completed_at=CASE WHEN ${input.state} IN ('responded','expired','cancelled','dead_letter')
          THEN ${input.occurred_at}::timestamptz ELSE completed_at END
      WHERE id=${message.reaction_id}::uuid AND school_id=${input.school_id}::uuid`.execute(transaction);

    return {
      message_id: input.message_id,
      reaction_id: message.reaction_id,
      state: input.state,
      outcome_id: outcome.id,
      replayed: false,
    };
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

  async operationalSignals(schoolId: string, at = new Date().toISOString(), limit = 20): Promise<CampusOperationalSignal[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const atInstant = new Date(at);
    if (Number.isNaN(atInstant.getTime())) throw new ConflictException("Use a valid instant for campus signals.");
    return (await sql<CampusOperationalSignal>`
      WITH school_clock AS (
        SELECT timezone FROM schools WHERE id=${schoolId}::uuid
      ), latest_gate AS (
        SELECT DISTINCT ON (observation.subject_entity_id)
          observation.id,observation.subject_entity_id,observation.observed_at,
          observation.payload->>'direction' AS direction,
          COALESCE(NULLIF(observation.payload->>'gate',''),'Campus gate') AS gate_label
        FROM campus_model_observations observation CROSS JOIN school_clock
        WHERE observation.school_id=${schoolId}::uuid
          AND observation.kind='movement.gate_observed' AND observation.state='accepted'
          AND observation.observed_at<=${atInstant.toISOString()}::timestamptz
          AND observation.received_at<=${atInstant.toISOString()}::timestamptz
          AND (observation.observed_at AT TIME ZONE school_clock.timezone)::date=
              (${atInstant.toISOString()}::timestamptz AT TIME ZONE school_clock.timezone)::date
        ORDER BY observation.subject_entity_id,observation.observed_at DESC,observation.received_at DESC,observation.id DESC
      )
      SELECT concat(occurrence.id::text,':',student.id::text,':',gate.id::text) AS id,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'attendance_after_exit' ELSE 'expected_after_exit' END AS kind,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'important' ELSE 'review' END AS severity,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'attendance' ELSE 'gate' END AS owner,
        student.id::text AS student_id,student_entity.label AS person_label,
        class_entity.label AS class_label,occurrence.title AS activity_label,
        gate.gate_label,gate.observed_at AS gate_observed_at,
        occurrence.starts_at AS expected_from,occurrence.ends_at AS expected_until,
        attendance.attendance_status
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
      JOIN enrollments enrollment ON enrollment.class_section_id=class_entity.domain_id::uuid AND enrollment.is_active
      JOIN students student ON student.id=enrollment.student_id AND student.school_id=occurrence.school_id
      JOIN campus_model_entities student_entity ON student_entity.school_id=student.school_id
        AND student_entity.domain='people' AND student_entity.domain_id=student.id::text
      JOIN latest_gate gate ON gate.subject_entity_id=student_entity.id AND gate.direction='out'
      LEFT JOIN LATERAL (
        SELECT observation.id AS observation_id,observation.payload->>'attendance_status' AS attendance_status
        FROM campus_model_observations observation
        WHERE observation.school_id=occurrence.school_id AND observation.subject_entity_id=student_entity.id
          AND observation.context_entity_id=occurrence.class_entity_id
          AND observation.kind='attendance.status_observed' AND observation.state='accepted'
          AND observation.observed_at>=gate.observed_at
          AND observation.observed_at<=${atInstant.toISOString()}::timestamptz
          AND observation.received_at<=${atInstant.toISOString()}::timestamptz
          AND observation.observed_at<occurrence.ends_at
          AND observation.payload->>'attendance_status' IN ('present','late')
        ORDER BY observation.observed_at DESC,observation.received_at DESC LIMIT 1
      ) attendance ON true
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.state='expected'
        AND occurrence.starts_at<=${atInstant.toISOString()}::timestamptz
        AND occurrence.ends_at>${atInstant.toISOString()}::timestamptz
      ORDER BY CASE WHEN attendance.observation_id IS NOT NULL THEN 0 ELSE 1 END,
        occurrence.starts_at,student_entity.label,student.id
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
      LEFT JOIN campus_model_agent_endpoints account_endpoint
        ON account_endpoint.school_id=occurrence.school_id
        AND account_endpoint.agent_id=occurrence.responsible_agent_id
        AND account_endpoint.endpoint_kind='account' AND account_endpoint.provider='thatcampus'
        AND account_endpoint.user_id=${humanUserId}::uuid
        AND account_endpoint.effective_from<=${input.at}::timestamptz
        AND (account_endpoint.effective_until IS NULL OR account_endpoint.effective_until>${input.at}::timestamptz)
      LEFT JOIN campus_model_agents agent ON agent.id=occurrence.responsible_agent_id
        AND agent.id=account_endpoint.agent_id
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

  private async recordCoordinationException(
    transaction: Transaction<Database>,
    input: AcceptedCoordinationEvent,
    triggerEventId: string,
    exceptionCode: CoordinationExceptionCode,
    explanation: string,
    details: Record<string, unknown>,
  ): Promise<CoordinationPublishReceipt> {
    const inserted = (await sql<CoordinationExceptionRow>`INSERT INTO campus_model_coordination_exceptions(
        school_id,trigger_event_id,source_outbox_event_id,exception_code,status,selector_key,
        explanation,details,correlation_id
      ) VALUES (
        ${input.school_id}::uuid,${triggerEventId}::uuid,${input.source_outbox_event_id}::uuid,
        ${exceptionCode},'open',${input.selector_input.selector_key},${explanation},
        ${JSON.stringify(details)}::jsonb,${input.correlation_id}::uuid
      ) ON CONFLICT(trigger_event_id) DO NOTHING RETURNING id,exception_code`.execute(transaction)).rows[0];
    const retained = inserted ?? (await sql<CoordinationExceptionRow>`SELECT id,exception_code
      FROM campus_model_coordination_exceptions
      WHERE school_id=${input.school_id}::uuid AND trigger_event_id=${triggerEventId}::uuid
      FOR UPDATE`.execute(transaction)).rows[0];
    if (!retained) throw new ConflictException("The coordination exception could not be retained.");
    return {
      status: "unmatched",
      event_id: triggerEventId,
      exception_id: retained.id,
      exception_code: retained.exception_code,
      reaction_ids: [],
      message_ids: [],
      replayed: !inserted,
    };
  }

  private async resolveAgentReference(
    transaction: Transaction<Database>,
    schoolId: string,
    reference: CoordinationRecipientAgentRef,
  ): Promise<AuthorizedRecipientRow | undefined> {
    if (reference.agent_kind === "human") {
      const resolved = await this.resolveOrProvisionHumanAgent(
        transaction,
        schoolId,
        reference.user_id,
      );
      return resolved.acting
        ? { id: resolved.agent_id, user_id: resolved.user_id, agent_kind: "human", external_ref: null }
        : undefined;
    }
    return (await sql<AuthorizedRecipientRow>`SELECT id,NULL::uuid AS user_id,agent_kind,external_ref
      FROM campus_model_agents
      WHERE school_id=${schoolId}::uuid AND agent_kind=${reference.agent_kind}
        AND external_ref=${reference.external_ref} AND status='active'
      FOR SHARE`.execute(transaction)).rows[0];
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
    const resolved = await this.resolveOrProvisionHumanAgent(transaction, schoolId, userId);
    if (!resolved.acting) {
      throw new ConflictException(this.humanAgentResolutionMessage(resolved.reason));
    }
    return { id: resolved.agent_id };
  }

  private async resolveOrProvisionHumanAgent(
    transaction: Transaction<Database>,
    schoolId: string,
    userId: string,
  ): Promise<HumanAgentIdentityResolution> {
    const now = new Date().toISOString();
    let resolved = await this.resolveAccountEndpointIn(transaction, schoolId, userId, now);
    if (resolved.acting || resolved.reason !== "account_not_linked") return resolved;

    await sql`SELECT pg_advisory_xact_lock(hashtext(
      'campus-human-agent:'||${schoolId}::text||':'||${userId}::text
    ))`.execute(transaction);
    resolved = await this.resolveAccountEndpointIn(transaction, schoolId, userId, now);
    if (resolved.acting || resolved.reason !== "account_not_linked") return resolved;

    const account = (await sql<HumanAgentBootstrapAccountRow>`SELECT
        account.is_active,
        EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=account.id
            AND membership.is_active) AS active_member
      FROM users account WHERE account.id=${userId}::uuid FOR SHARE`.execute(transaction)).rows[0];
    if (!account) return this.nonActing(schoolId, null, userId, null, "account_not_linked");
    if (!account.is_active) return this.nonActing(schoolId, null, userId, null, "account_inactive");
    if (!account.active_member) return this.nonActing(schoolId, null, userId, null, "membership_inactive");

    const candidates = (await sql<ExplicitPersonCandidateRow>`SELECT person_id,
        array_agg(source_kind ORDER BY source_kind)::text[] AS source_kinds
      FROM (
        SELECT student.person_id,'student_profile'::text AS source_kind FROM students student
        WHERE student.school_id=${schoolId}::uuid AND student.user_id=${userId}::uuid
        UNION ALL
        SELECT profile.person_id,'guardian_profile'::text FROM parents parent
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
        WHERE profile.school_id=${schoolId}::uuid AND parent.user_id=${userId}::uuid
        UNION ALL
        SELECT profile.person_id,'staff_profile'::text FROM staff_profiles profile
        WHERE profile.school_id=${schoolId}::uuid AND profile.user_id=${userId}::uuid
        UNION ALL
        SELECT appointment.person_id,'governance_appointment'::text
        FROM institution_governance_appointments appointment
        WHERE appointment.school_id=${schoolId}::uuid AND appointment.linked_user_id=${userId}::uuid
      ) candidate GROUP BY person_id ORDER BY person_id`.execute(transaction)).rows;
    if (candidates.length > 1) {
      throw new ConflictException("The campus account is explicitly linked to more than one person; review it before acting.");
    }

    const personId = candidates[0]?.person_id;
    if (!personId) {
      // The Model Core never manufactures People-domain identity. Auth/People must
      // establish an explicit account-to-person record before this account can act.
      return this.nonActing(schoolId, null, userId, null, "profile_unlinked");
    }

    const mayAct = (await sql<{ found: boolean }>`SELECT EXISTS(
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid
        AND membership.is_active AND (
          membership.role='admin'
          OR (membership.role='staff' AND EXISTS(
            SELECT 1 FROM staff_profiles profile
            WHERE profile.school_id=membership.school_id AND profile.user_id=membership.user_id
              AND profile.person_id=${personId}::uuid AND profile.status='active'
          ))
          OR (membership.role='student' AND EXISTS(
            SELECT 1 FROM students student
            WHERE student.school_id=membership.school_id AND student.user_id=membership.user_id
              AND student.person_id=${personId}::uuid
          ))
          OR (membership.role='guardian' AND EXISTS(
            SELECT 1 FROM parents parent
            JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
            WHERE profile.school_id=membership.school_id AND parent.user_id=membership.user_id
              AND profile.person_id=${personId}::uuid
          ))
        )
    ) AS found`.execute(transaction)).rows[0]!.found;
    if (!mayAct) return this.nonActing(schoolId, personId, userId, null, "profile_unlinked");

    const linked = await this.linkAccountEndpoint(transaction, {
      school_id: schoolId,
      person_id: personId,
      user_id: userId,
      actor_user_id: userId,
      effective_from: now,
      effective_until: null,
      source_domain: "auth",
      source_record_id: userId,
      source_revision: 1,
      metadata: { bootstrap: "explicit_identity", identity_sources: candidates[0]!.source_kinds },
    });
    return linked;
  }

  private async resolveAccountEndpointIn(
    transaction: Transaction<Database>,
    schoolId: string,
    userId: string,
    at: string,
  ): Promise<HumanAgentIdentityResolution> {
    const resolved = (await sql<HumanAgentEndpointRow>`WITH explicit_person AS (
        SELECT student.person_id FROM students student
        WHERE student.school_id=${schoolId}::uuid AND student.user_id=${userId}::uuid
        UNION
        SELECT profile.person_id FROM parents parent
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
        WHERE profile.school_id=${schoolId}::uuid AND parent.user_id=${userId}::uuid
        UNION
        SELECT profile.person_id FROM staff_profiles profile
        WHERE profile.school_id=${schoolId}::uuid AND profile.user_id=${userId}::uuid
        UNION
        SELECT appointment.person_id FROM institution_governance_appointments appointment
        WHERE appointment.school_id=${schoolId}::uuid AND appointment.linked_user_id=${userId}::uuid
      ) SELECT
        agent.id AS agent_id,agent.school_id,agent.person_id,agent.label,
        endpoint.id AS endpoint_id,endpoint.user_id,endpoint.effective_from,endpoint.effective_until
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      JOIN users account ON account.id=endpoint.user_id
      WHERE endpoint.school_id=${schoolId}::uuid AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.user_id=${userId}::uuid
        AND (
          endpoint.status='active'
          OR (endpoint.status='revoked' AND EXISTS(
            SELECT 1 FROM campus_model_agent_endpoint_transitions transition
            WHERE transition.school_id=endpoint.school_id AND transition.endpoint_id=endpoint.id
              AND transition.transition_kind='revoked' AND transition.effective_at>${at}::timestamptz
          ))
        )
        AND agent.agent_kind='human' AND agent.status='active'
        AND endpoint.effective_from<=${at}::timestamptz
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>${at}::timestamptz)
        AND account.is_active
        AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>agent.person_id)
        AND EXISTS (
          SELECT 1 FROM users member_account
          JOIN school_memberships membership ON membership.user_id=member_account.id
          WHERE member_account.id=endpoint.user_id
            AND membership.school_id=endpoint.school_id AND membership.user_id=endpoint.user_id
            AND membership.is_active
            AND (
              membership.role='admin'
              OR (membership.role='staff' AND EXISTS(
                SELECT 1 FROM staff_profiles profile
                WHERE profile.school_id=endpoint.school_id AND profile.user_id=endpoint.user_id
                  AND profile.person_id=agent.person_id AND profile.status='active'
              ))
              OR (membership.role='student' AND EXISTS(
                SELECT 1 FROM students student
                WHERE student.school_id=endpoint.school_id AND student.user_id=endpoint.user_id
                  AND student.person_id=agent.person_id
              ))
              OR (membership.role='guardian' AND EXISTS(
                SELECT 1 FROM parents parent
                JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
                WHERE profile.school_id=endpoint.school_id AND parent.user_id=endpoint.user_id
                  AND profile.person_id=agent.person_id
              ))
            )
        )
      ORDER BY endpoint.effective_from DESC,endpoint.id DESC LIMIT 1
      FOR SHARE OF endpoint,agent,account`.execute(transaction)).rows[0];
    if (resolved) return { acting: true, ...resolved };

    const diagnostic = (await sql<HumanAgentEndpointDiagnosticRow>`WITH explicit_person AS (
        SELECT student.person_id FROM students student
        WHERE student.school_id=${schoolId}::uuid AND student.user_id=${userId}::uuid
        UNION
        SELECT profile.person_id FROM parents parent
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
        WHERE profile.school_id=${schoolId}::uuid AND parent.user_id=${userId}::uuid
        UNION
        SELECT profile.person_id FROM staff_profiles profile
        WHERE profile.school_id=${schoolId}::uuid AND profile.user_id=${userId}::uuid
        UNION
        SELECT appointment.person_id FROM institution_governance_appointments appointment
        WHERE appointment.school_id=${schoolId}::uuid AND appointment.linked_user_id=${userId}::uuid
      ) SELECT
        agent.id AS agent_id,agent.person_id,endpoint.user_id,
        ((endpoint.status='active' OR (endpoint.status='revoked' AND EXISTS(
            SELECT 1 FROM campus_model_agent_endpoint_transitions transition
            WHERE transition.school_id=endpoint.school_id AND transition.endpoint_id=endpoint.id
              AND transition.transition_kind='revoked' AND transition.effective_at>${at}::timestamptz
          ))) AND agent.status='active'
          AND endpoint.effective_from<=${at}::timestamptz
          AND (endpoint.effective_until IS NULL OR endpoint.effective_until>${at}::timestamptz)) AS endpoint_active,
        account.is_active AS account_active,
        EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=endpoint.school_id AND membership.user_id=endpoint.user_id
            AND membership.is_active) AS membership_active,
        NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>agent.person_id)
        AND EXISTS(
          SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=endpoint.school_id AND membership.user_id=endpoint.user_id
            AND membership.is_active
            AND (
              membership.role='admin'
              OR (membership.role='staff' AND EXISTS(
                SELECT 1 FROM staff_profiles profile
                WHERE profile.school_id=endpoint.school_id AND profile.user_id=endpoint.user_id
                  AND profile.person_id=agent.person_id AND profile.status='active'
              ))
              OR (membership.role='student' AND EXISTS(
                SELECT 1 FROM students student
                WHERE student.school_id=endpoint.school_id AND student.user_id=endpoint.user_id
                  AND student.person_id=agent.person_id
              ))
              OR (membership.role='guardian' AND EXISTS(
                SELECT 1 FROM parents parent
                JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
                WHERE profile.school_id=endpoint.school_id AND parent.user_id=endpoint.user_id
                  AND profile.person_id=agent.person_id
              ))
            )
        ) AS profile_linked
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      JOIN users account ON account.id=endpoint.user_id
      WHERE endpoint.school_id=${schoolId}::uuid AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.user_id=${userId}::uuid
      ORDER BY endpoint.effective_from DESC,endpoint.id DESC LIMIT 1
      FOR SHARE OF endpoint,agent,account`.execute(transaction)).rows[0];
    if (!diagnostic) return this.nonActing(schoolId, null, userId, null, "account_not_linked");
    let reason: NonActingHumanAgentReason;
    if (!diagnostic.account_active) reason = "account_inactive";
    else if (!diagnostic.membership_active) reason = "membership_inactive";
    else if (!diagnostic.profile_linked) reason = "profile_unlinked";
    else reason = "endpoint_inactive";
    return this.nonActing(schoolId, diagnostic.person_id, userId, diagnostic.agent_id, reason);
  }

  private nonActing(
    schoolId: string,
    personId: string | null,
    userId: string | null,
    agentId: string | null,
    reason: NonActingHumanAgentReason,
  ): HumanAgentIdentityResolution {
    return { acting: false, school_id: schoolId, person_id: personId, user_id: userId, agent_id: agentId, reason };
  }

  private humanAgentResolutionMessage(reason: NonActingHumanAgentReason): string {
    const messages: Record<NonActingHumanAgentReason, string> = {
      person_not_found: "The campus person could not be found.",
      agent_not_registered: "This person is not registered as an acting campus agent.",
      account_not_linked: "The account is not linked to a campus person agent.",
      endpoint_inactive: "The account endpoint is not active at this time.",
      account_inactive: "The linked account is inactive.",
      membership_inactive: "The linked account has no active institution membership.",
      profile_unlinked: "The account membership is not linked to the required campus person profile.",
    };
    return messages[reason];
  }

  private async requireAuthorizedExternalAgent(
    transaction: Transaction<Database>,
    schoolId: string,
    source: { kind: "device" | "integration"; external_ref: string; label: string; metadata: Record<string, unknown> },
    sourceType: string,
    context: CampusModelEntitySnapshot | null,
  ): Promise<AgentRow> {
    if (!(["attendance.capture", "gate.movement"] as string[]).includes(sourceType)) {
      throw new ConflictException("This observation type is not enabled for registered sources.");
    }
    const contextEntity = context ? (await sql<{ id: string }>`SELECT id FROM campus_model_entities
      WHERE school_id=${schoolId}::uuid AND domain=${context.domain} AND domain_id=${context.domain_id}`.execute(transaction)).rows[0] : null;
    const capability = `observe:${sourceType}` as ObservationCapability;
    const agent = (await sql<AgentRow>`WITH RECURSIVE context_scope AS (
        SELECT ${contextEntity?.id ?? null}::uuid AS id
        UNION
        SELECT relationship.target_entity_id FROM campus_model_relationships relationship
        JOIN context_scope child ON child.id=relationship.source_entity_id
        WHERE relationship.school_id=${schoolId}::uuid AND relationship.relation_type IN ('part_of','located_in','home_space')
          AND relationship.effective_from<=now() AND relationship.effective_until IS NULL
      )
      SELECT agent.id FROM campus_model_agents agent
      JOIN campus_model_agent_authorities authority ON authority.agent_id=agent.id AND authority.school_id=agent.school_id
      WHERE agent.school_id=${schoolId}::uuid AND agent.agent_kind=${source.kind} AND agent.external_ref=${source.external_ref}
        AND agent.status='active' AND authority.capability=${capability} AND authority.revoked_at IS NULL
        AND authority.effective_from<=now() AND (authority.effective_until IS NULL OR authority.effective_until>now())
        AND (authority.scope_entity_id IS NULL OR authority.scope_entity_id IN (SELECT id FROM context_scope))
      LIMIT 1 FOR UPDATE OF agent`.execute(transaction)).rows[0];
    if (!agent) throw new ConflictException("This device or connection is not active or is outside its approved scope.");
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
