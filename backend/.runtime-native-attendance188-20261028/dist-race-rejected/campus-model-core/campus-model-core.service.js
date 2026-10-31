var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { executionEnvironmentStorage, executionNow } from "./execution-time.runtime.js";
import { acceptedChangeProjectionHash, acceptedChangeScopeHash } from "./accepted-change-command.binding.js";
import { planOccurrenceProjectionSchema, planOccurrenceExtensionSchema } from "./plan-occurrence.port.js";
import { configuredSoftwareActorSchema } from "./configured-command.port.js";
import { peopleRelationshipProjectionSchema } from "./people-relationship-projection.port.js";
import { ConflictException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { acceptedScheduleSubstitutionOutboxEvidence, acceptedScheduleSubstitutionProjectionSchema, acceptedCampusModelChangeSchema, acceptedCoordinationEventSchema, acceptedDomainEventSchema, campusModelEntitySchema, campusModelObservationSchema, campusModelObservationTransitionSchema, campusTemporalContextQuerySchema, calendarClosureProjectionSchema, cancelledScheduleSubstitutionOutboxEvidence, cancelledScheduleSubstitutionProjectionSchema, cancelledScheduleSubstitutionSuccessorAssignment, publishedDayPlanProjectionSchema, publishedScheduleProjectionSchema, coordinationRecipientAgentRefSchema, coordinationRecipientSelectorConfigSchema, humanAgentAccountEndpointLinkSchema, humanAgentAccountEndpointCloseSchema, humanAgentAccountEndpointReplaceSchema, humanAgentAccountResolutionSchema, humanAgentPersonResolutionSchema, importedAcceptedScheduleSubstitutionOutboxEvidence, importedAcceptedScheduleSubstitutionProjectionSchema, legacyTimetableSlotChangeProjectionSchema, operationalMessageOutcomeSchema, recipientOperationalMessageResponseSchema, } from "./contracts.js";
import { executionNamespaceForSchool, modelAddressSchema, resolveOperationalRealmScope } from "./operational-realm.js";
const uuid = z.string().uuid();
const coordinationRouteResolutionInputSchema = z.object({
    school_id: z.string().uuid(),
    source_domain: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    event_type: z.string().trim().min(3).max(120),
    selector_key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    occurred_at: z.string().datetime({ offset: true }),
}).strict();
const coordinationCandidateAuthorizationInputSchema = z.object({
    school_id: z.string().uuid(),
    behaviour_version_id: z.string().uuid(),
    subscription_id: z.string().uuid(),
    occurred_at: z.string().datetime({ offset: true }),
    recipients: z.array(coordinationRecipientAgentRefSchema).max(500),
    scope: campusModelEntitySchema.nullable(),
}).strict();
const coordinationTraceQuerySchema = z.object({
    school_id: z.string().uuid(),
    source_domain: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    source_record_id: z.string().trim().min(1).max(240),
    event_type: z.string().trim().min(3).max(120),
    source_revision: z.number().int().positive(),
    message_id: z.string().uuid().optional(),
}).strict();
const sourceEventLookupSchema = z.object({
    school_id: z.string().uuid(),
    source_outbox_event_id: z.string().uuid(),
}).strict();
const domainMessageSupersessionSchema = z.object({
    school_id: uuid,
    command_id: uuid,
    message_id: uuid,
    previous_event_id: uuid,
    previous_source_revision: z.number().int().positive().optional(),
    resulting_event_id: uuid,
    required_capability: z.string().trim().min(3).max(120),
    occurred_at: z.string().datetime({ offset: true }),
    idempotency_key: z.string().trim().min(8).max(240),
}).strict();
const operationalMessageWorkQuerySchema = z.object({
    workflow: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    states: z.array(z.enum(["queued", "delivered", "acknowledged"])).min(1).max(3),
    limit: z.number().int().positive().max(500),
    claim: z.boolean().optional(),
}).strict();
const prepareDomainCommandSchema = z.object({
    school_id: z.string().uuid(),
    actor_user_id: z.string().uuid(),
    command_type: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
    handler_key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
    handler_version: z.number().int().positive(),
    source_domain: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    target: campusModelEntitySchema,
    current_revision: z.number().int().nonnegative(),
    expected_revision: z.number().int().nonnegative(),
    capability: z.string().trim().min(3).max(120),
    purpose: z.string().trim().min(3).max(120),
    requested_at: z.string().datetime({ offset: true }),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().nullable(),
    idempotency_key: z.string().trim().min(8).max(240),
    operating_rule_version_ref: z.string().trim().min(1).max(240).nullable(),
    configuration_refs: z.array(z.object({
        kind: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
        ref: z.string().trim().min(1).max(240),
        version: z.string().trim().min(1).max(120),
    }).strict()).max(100),
    authority_attestation: z.object({
        evaluator_domain: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
        decision: z.enum(["allowed", "denied"]),
        reason_codes: z.array(z.string().trim().min(1).max(120)).max(50),
        authority_source_refs: z.array(z.unknown()).max(100),
        operating_rule_refs: z.array(z.unknown()).max(100),
        valid_until: z.string().datetime({ offset: true }).nullable(),
    }).strict().nullable(),
    safe_context: z.record(z.string(), z.unknown()),
}).strict();
const domainCommandTerminalStateSchema = z.enum([
    "accepted", "rejected", "conflicted", "review_required", "failed", "uncertain", "cancelled", "expired",
]);
const prepareSoftwareCommandSchema = prepareDomainCommandSchema.omit({ actor_user_id: true }).extend({
    actor_agent_id: z.string().uuid(), behaviour_version_id: z.string().uuid(),
}).strict();
const softwareDomainEventSchema = z.object(acceptedDomainEventSchema.shape).omit({ actor_user_id: true }).extend({
    actor_agent_id: z.string().uuid(), behaviour_version_id: z.string().uuid(),
}).strict().superRefine((value, context) => {
    if (value.effective_until && Date.parse(value.effective_until) <= Date.parse(value.effective_from)) {
        context.addIssue({ code: "custom", path: ["effective_until"], message: "Event end must follow its start." });
    }
    if (new Set(value.audience_user_ids).size !== value.audience_user_ids.length) {
        context.addIssue({ code: "custom", path: ["audience_user_ids"], message: "Audience members must be unique." });
    }
});
const completeDomainCommandSchema = z.object({
    school_id: z.string().uuid(),
    command_id: z.string().uuid(),
    terminal_state: domainCommandTerminalStateSchema,
    code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
    explanation: z.string().trim().min(1).max(500),
    resulting_revision: z.number().int().nonnegative().nullable(),
    domain_event_id: z.string().uuid().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    completed_at: z.string().datetime({ offset: true }),
}).strict();
const authorityEvaluationInputSchema = z.object({
    school_id: z.string().uuid(),
    actor_agent_id: z.string().uuid(),
    capability: z.string().trim().min(3).max(120),
    purpose: z.string().trim().min(3).max(120),
    scope_entity_id: z.string().uuid().nullable(),
    evaluated_at: z.string().datetime({ offset: true }),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().nullable(),
    idempotency_key: z.string().trim().min(8).max(240),
}).strict();
const checkpointConsumerSchema = z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,99}$/);
function canonicalJson(value) {
    if (Array.isArray(value))
        return value.map(canonicalJson);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalJson(item)]));
    }
    return value;
}
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const executionSnapshotInputSchema = z.object({
    school_id: z.string().uuid(),
    snapshot_kind: z.enum(["live_activation", "simulation_fork", "rehearsal"]),
    source_snapshot_ref: z.string().trim().min(3).max(240),
    core_contract_version: z.string().trim().min(1).max(40),
    source_recorded_at: z.string().datetime({ offset: true }),
    sealed_at: z.string().datetime({ offset: true }),
    sealed_by_authority: z.string().trim().min(3).max(160),
    metadata: z.record(z.string(), z.unknown()),
    items: z.array(z.object({
        item_kind: z.enum(["operating_rule", "behaviour", "domain_configuration", "semantic_contract", "protocol_contract", "capability_manifest", "terminology"]),
        item_key: z.string().trim().min(3).max(241),
        version_ref: z.string().trim().min(1).max(200),
        content_hash: sha256Schema,
        effective_from: z.string().datetime({ offset: true }),
        effective_until: z.string().datetime({ offset: true }).nullable(),
        source_ref: z.string().trim().min(1).max(500),
        metadata: z.record(z.string(), z.unknown()),
    }).strict()).min(1).max(2_000),
    actors: z.array(z.object({
        source_agent_id: z.string().uuid(),
        binding_key: z.string().trim().min(3).max(160),
        actor_mode: z.enum(["live_agent", "simulation_counterpart", "delegate"]),
        behaviour_policy_version_ref: z.string().trim().min(1).max(240).nullable(),
        authority_snapshot_ref: z.string().trim().min(1).max(240).nullable(),
        effective_from: z.string().datetime({ offset: true }),
        effective_until: z.string().datetime({ offset: true }).nullable(),
    }).strict()).min(1).max(10_000),
    authority_grants: z.array(z.object({
        source_authority_id: z.string().uuid(),
        agent_id: z.string().uuid(),
        capability: z.string().trim().min(3).max(120),
        scope_entity_id: z.string().uuid().nullable(),
        effective_from: z.string().datetime({ offset: true }),
        effective_until: z.string().datetime({ offset: true }).nullable(),
        operating_rule_version_ref: z.string().trim().min(1).max(240).nullable(),
        constraints: z.record(z.string(), z.unknown()),
        content_hash: sha256Schema,
    }).strict()).max(50_000),
}).strict().superRefine((value, context) => {
    const itemKeys = value.items.map((item) => `${item.item_kind}:${item.item_key}`);
    const bindingKeys = value.actors.map((actor) => actor.binding_key);
    const grantKeys = value.authority_grants.map((grant) => grant.source_authority_id);
    for (const [path, keys] of [["items", itemKeys], ["actors", bindingKeys], ["authority_grants", grantKeys]]) {
        if (new Set(keys).size !== keys.length)
            context.addIssue({ code: "custom", path: [path], message: `${path} must use unique stable keys.` });
    }
    if (Date.parse(value.sealed_at) < Date.parse(value.source_recorded_at)) {
        context.addIssue({ code: "custom", path: ["sealed_at"], message: "A snapshot cannot be sealed before its source was recorded." });
    }
});
export function assertSimulationDomainAttestationBinding(binding, expectedSourceSnapshotRef) {
    if (!binding
        || binding.actor_mode !== "simulation_counterpart"
        || binding.source_snapshot_ref !== expectedSourceSnapshotRef
        || binding.authority_snapshot_ref !== expectedSourceSnapshotRef) {
        throw new ForbiddenException("The Simulation domain attestation has no active counterpart bound to its sealed source snapshot.");
    }
    return binding;
}
let CampusModelCoreService = class CampusModelCoreService {
    db;
    executionScope;
    // Opaque gateway evidence for same-transaction first effects. Unlike a stored
    // pending receipt, this cannot survive a transaction boundary or be inherited
    // by a captured world. Weak keys retain no completed transaction indefinitely.
    freshlyPreparedDomainCommands = new WeakMap();
    constructor(db, executionScope) {
        this.db = db;
        this.executionScope = executionScope;
    }
    async resolveAccountEndpoint(transaction, rawInput) {
        const input = humanAgentAccountResolutionSchema.parse(rawInput);
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore();
        const namespace = executionNamespaceForSchool(input.school_id, environment);
        const executor = (await sql `SELECT current_setting('thatcampus.namespace_id',true) AS namespace`.execute(transaction)).rows[0];
        if (environment?.kind === "simulation" ? executor?.namespace !== namespace : Boolean(executor?.namespace && executor.namespace !== namespace)) {
            throw new ForbiddenException("Account identity requires the selected execution data plane.");
        }
        return this.resolveAccountEndpointIn(transaction, input.school_id, input.user_id, input.at);
    }
    async listActingPeople(transaction, input) {
        uuid.parse(input.school_id);
        z.string().datetime({ offset: true }).parse(input.at);
        return (await sql `SELECT DISTINCT ON(person_id) person_id,user_id,label
      FROM campus_model_current_account_endpoints(${input.school_id}::uuid,NULL,${input.at}::timestamptz)
      ORDER BY person_id,effective_from DESC,endpoint_id`.execute(transaction)).rows;
    }
    async listPersonAccountStates(transaction, rawInput) {
        const input = z.object({ school_id: uuid, person_ids: z.array(uuid).max(25), at: z.string().datetime({ offset: true }),
            viewer_user_id: uuid.optional() }).strict().parse(rawInput);
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore();
        const namespace = executionNamespaceForSchool(input.school_id, environment);
        const executor = (await sql `SELECT current_setting('thatcampus.namespace_id',true) AS namespace`.execute(transaction)).rows[0];
        if (environment?.kind === 'simulation' ? executor?.namespace !== namespace
            : Boolean(executor?.namespace && executor.namespace !== namespace)) {
            throw new ForbiddenException('People account state requires the selected execution data plane.');
        }
        return (await sql `
      WITH requested AS (
        SELECT id,account_user_id FROM school_people WHERE school_id=${input.school_id}::uuid
          AND id=ANY(${input.person_ids}::uuid[]) AND retired_at IS NULL
      ), linked AS (
        SELECT id AS person_id,account_user_id AS user_id FROM requested WHERE account_user_id IS NOT NULL
        UNION SELECT person.id,endpoint.user_id FROM requested person
          JOIN campus_model_agents agent ON agent.person_id=person.id AND agent.school_id=${input.school_id}::uuid AND agent.agent_kind='human'
          JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id
            AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus' AND endpoint.user_id IS NOT NULL
        UNION SELECT person.id,student.user_id FROM requested person JOIN students student ON student.person_id=person.id
          AND student.school_id=${input.school_id}::uuid AND student.user_id IS NOT NULL
        UNION SELECT person.id,profile.user_id FROM requested person JOIN staff_profiles profile ON profile.person_id=person.id
          AND profile.school_id=${input.school_id}::uuid AND profile.user_id IS NOT NULL
        UNION SELECT person.id,parent.user_id FROM requested person JOIN guardian_school_profiles profile ON profile.person_id=person.id
          AND profile.school_id=${input.school_id}::uuid JOIN parents parent ON parent.id=profile.guardian_id AND parent.user_id IS NOT NULL
        UNION SELECT person.id,appointment.linked_user_id FROM requested person JOIN institution_governance_appointments appointment
          ON appointment.person_id=person.id AND appointment.school_id=${input.school_id}::uuid AND appointment.linked_user_id IS NOT NULL
      ), access AS (
        SELECT linked.*,campus_model_account_person_is_active(${input.school_id}::uuid,linked.user_id,linked.person_id,${input.at}::timestamptz) AS active
        FROM linked
      ) SELECT person.id AS person_id,count(access.user_id)>0 AS has_account,
        CASE WHEN COALESCE(bool_or(access.active),false) THEN 'active' WHEN count(access.user_id)>0 THEN 'inactive' ELSE 'not_linked' END AS account_state,
        COALESCE(bool_or(access.user_id=${input.viewer_user_id ?? null}::uuid AND access.active),false) AS is_you
      FROM requested person LEFT JOIN access ON access.person_id=person.id GROUP BY person.id ORDER BY person.id`.execute(transaction)).rows;
    }
    async resolvePersonAgent(transaction, rawInput) {
        const input = humanAgentPersonResolutionSchema.parse(rawInput);
        const person = (await sql `SELECT id FROM school_people
      WHERE school_id=${input.school_id}::uuid AND id=${input.person_id}::uuid
      FOR SHARE`.execute(transaction)).rows[0];
        if (!person)
            return this.nonActing(input.school_id, null, null, null, "person_not_found");
        const agent = (await sql `SELECT id FROM campus_model_agents
      WHERE school_id=${input.school_id}::uuid AND agent_kind='human' AND person_id=${input.person_id}::uuid
      FOR SHARE`.execute(transaction)).rows[0];
        if (!agent)
            return this.nonActing(input.school_id, input.person_id, null, null, "agent_not_registered");
        const endpoint = (await sql `SELECT user_id FROM campus_model_agent_endpoints
      WHERE school_id=${input.school_id}::uuid AND agent_id=${agent.id}::uuid
        AND endpoint_kind='account' AND user_id IS NOT NULL
        AND effective_from<=${input.at}::timestamptz
        AND (effective_until IS NULL OR effective_until>${input.at}::timestamptz)
      ORDER BY status='active' DESC,effective_from DESC,id DESC LIMIT 1
      FOR SHARE`.execute(transaction)).rows[0];
        if (!endpoint) {
            const hasHistory = (await sql `SELECT EXISTS(
        SELECT 1 FROM campus_model_agent_endpoints
        WHERE school_id=${input.school_id}::uuid AND agent_id=${agent.id}::uuid
          AND endpoint_kind='account'
      ) AS found`.execute(transaction)).rows[0].found;
            return this.nonActing(input.school_id, input.person_id, null, agent.id, hasHistory ? "endpoint_inactive" : "account_not_linked");
        }
        return this.resolveAccountEndpointIn(transaction, input.school_id, endpoint.user_id, input.at);
    }
    async linkAccountEndpoint(transaction, rawInput) {
        const input = humanAgentAccountEndpointLinkSchema.parse(rawInput);
        const actorAccess = (await sql `SELECT
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.is_active AND actor.is_active
      ) AS active_member,
      EXISTS(
        SELECT 1 FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
        WHERE membership.school_id=${input.school_id}::uuid AND membership.user_id=${input.actor_user_id}::uuid
          AND membership.role='admin' AND membership.is_active AND actor.is_active
      ) AS active_admin`.execute(transaction)).rows[0];
        if (!actorAccess.active_member) {
            throw new ConflictException("The identity-linking operator is not active in this institution.");
        }
        if (input.actor_user_id !== input.user_id && !actorAccess.active_admin) {
            throw new ConflictException("Only the account owner or an active institution administrator can link this identity.");
        }
        const target = (await sql `WITH explicit_person AS (
        SELECT id AS person_id FROM school_people WHERE school_id=${input.school_id}::uuid AND account_user_id=${input.user_id}::uuid
        UNION
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
        AND (
          EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id=person.id)
          OR (
            ${input.source_domain}='institution_onboarding'
            AND ${input.source_record_id}=${input.school_id}
            AND ${input.actor_user_id}::uuid=${input.user_id}::uuid
            AND EXISTS(
              SELECT 1 FROM schools institution
              WHERE institution.id=person.school_id
                AND institution.created_by_user_id=account.id
            )
          )
        )
        AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>person.id)
        AND EXISTS(
          SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=person.school_id AND membership.user_id=account.id AND membership.is_active
            AND (
              membership.role='admin'
              OR (membership.role='member' AND person.account_user_id=account.id)
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
      WHERE person.school_id=${input.school_id}::uuid AND person.id=${input.person_id}::uuid AND person.retired_at IS NULL
        AND account.id=${input.user_id}::uuid
      FOR SHARE OF person,account`.execute(transaction)).rows[0];
        if (!target)
            throw new ConflictException("The selected person or account does not exist.");
        if (!target.linked) {
            throw new ConflictException("The account needs an active institution membership linked to this person profile.");
        }
        const existing = (await sql `SELECT endpoint.id,endpoint.agent_id,
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
            const resolved = await this.resolveAccountEndpointIn(transaction, input.school_id, input.user_id, input.effective_from);
            if (!resolved.acting)
                throw new ConflictException("The existing account endpoint is not currently able to act.");
            return { ...resolved, replayed: true };
        }
        const agent = (await sql `INSERT INTO campus_model_agents(
        school_id,agent_kind,person_id,label,status
      ) VALUES (${input.school_id}::uuid,'human',${input.person_id}::uuid,${target.label},'active')
      ON CONFLICT(school_id,person_id) WHERE agent_kind='human' DO UPDATE SET
        label=EXCLUDED.label,
        revision=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
        updated_at=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          THEN now() ELSE campus_model_agents.updated_at END
      RETURNING id`.execute(transaction)).rows[0];
        if (!agent)
            throw new ConflictException("The human agent identity could not be retained.");
        const inserted = (await sql `INSERT INTO campus_model_agent_endpoints(
        school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,effective_until,
        source_domain,source_record_id,source_revision,linked_by_user_id,metadata
      ) VALUES (
        ${input.school_id}::uuid,${agent.id}::uuid,'account','thatcampus',${input.user_id}::uuid,'active',
        ${input.effective_from}::timestamptz,${input.effective_until}::timestamptz,
        ${input.source_domain},${input.source_record_id},${input.source_revision},
        ${input.actor_user_id}::uuid,${JSON.stringify(input.metadata)}::jsonb
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!inserted)
            throw new ConflictException("The account endpoint could not be linked.");
        const resolved = await this.resolveAccountEndpointIn(transaction, input.school_id, input.user_id, input.effective_from);
        if (!resolved.acting)
            throw new ConflictException("The linked account endpoint is not able to act.");
        return { ...resolved, replayed: false };
    }
    async closeAccountEndpoint(transaction, rawInput) {
        const input = humanAgentAccountEndpointCloseSchema.parse(rawInput);
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        await sql `SELECT pg_advisory_xact_lock(hashtext(
      'campus-human-endpoint-transition:'||${input.school_id}::text||':'||${input.idempotency_key}
    ))`.execute(transaction);
        const replay = (await sql `SELECT
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
        const actorAccess = (await sql `SELECT
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
      ) AS active_admin`.execute(transaction)).rows[0];
        if (!actorAccess.active_member) {
            throw new ConflictException("The identity-linking operator is not active in this institution.");
        }
        const target = (await sql `SELECT
        endpoint.id AS endpoint_id,endpoint.agent_id,agent.person_id,endpoint.user_id,
        endpoint.status,endpoint.effective_from,endpoint.effective_until,endpoint.revision
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=${input.school_id}::uuid AND endpoint.id=${input.endpoint_id}::uuid
        AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
        AND endpoint.user_id IS NOT NULL AND agent.agent_kind='human'
      FOR UPDATE OF endpoint,agent`.execute(transaction)).rows[0];
        if (!target)
            throw new ConflictException("The account endpoint was not found in this institution.");
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
        if (input.disposition === "revoked" && effectiveAt > executionNow().getTime()) {
            throw new ConflictException("Schedule a normal endpoint end for a future account replacement; revocation is immediate.");
        }
        const nextStatus = input.disposition === "revoked" ? "revoked" : target.status;
        const updated = (await sql `UPDATE campus_model_agent_endpoints SET
        status=${nextStatus},effective_until=${input.effective_at}::timestamptz,
        revision=revision+1,updated_at=now()
      WHERE school_id=${input.school_id}::uuid AND id=${input.endpoint_id}::uuid
        AND revision=${input.expected_revision}
      RETURNING revision`.execute(transaction)).rows[0];
        if (!updated)
            throw new ConflictException("This account endpoint changed. Refresh before continuing.");
        const transition = (await sql `INSERT INTO campus_model_agent_endpoint_transitions(
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
        if (!transition)
            throw new ConflictException("The account endpoint transition could not be retained.");
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
    async replaceAccountEndpoint(transaction, rawInput) {
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
    async projectPeopleRelationships(transaction, raw) {
        const input = peopleRelationshipProjectionSchema.parse(raw);
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore();
        const namespace = executionNamespaceForSchool(input.school_id, environment);
        const executor = (await sql `SELECT current_setting('thatcampus.namespace_id',true) AS namespace`.execute(transaction)).rows[0];
        if (environment?.kind === "simulation" ? executor?.namespace !== namespace : Boolean(executor?.namespace && executor.namespace !== namespace)) {
            throw new ForbiddenException("People relationships require the selected execution data plane.");
        }
        const scope = await this.resolveScope(transaction, input.school_id);
        const actor = await this.resolveAccountEndpointIn(transaction, input.school_id, input.actor_user_id, executionNow().toISOString());
        if (!actor.acting)
            throw new ForbiddenException("Current acting People management identity is required.");
        const command = (await sql `SELECT c.state,c.request_hash AS hash,
        entity.kind,entity.domain_id,(c.safe_context->>'target_revision')::integer AS revision
      FROM campus_model_commands c JOIN campus_model_entities entity ON entity.id=c.target_entity_id
        AND entity.realm_id=c.realm_id AND entity.environment_namespace_id=c.environment_namespace_id
      JOIN campus_model_authority_receipts authority ON authority.id=c.authority_receipt_id
        AND authority.realm_id=c.realm_id AND authority.environment_namespace_id=c.environment_namespace_id
      WHERE c.id=${input.command_id}::uuid AND c.school_id=${input.school_id}::uuid AND c.realm_id=${scope.realm_id}::uuid
        AND c.environment_namespace_id=${scope.environment_namespace_id} AND c.source_domain='people'
        AND c.handler_key='people.participation' AND c.actor_agent_id=${actor.agent_id}::uuid
        AND c.command_type=${`people.${input.subject.kind}.save`} AND entity.domain='people'
        AND authority.actor_agent_id=c.actor_agent_id AND authority.scope_entity_id=c.target_entity_id
        AND authority.decision='allowed' AND authority.correlation_id=c.correlation_id
        AND (authority.valid_until IS NULL OR authority.valid_until>${executionNow().toISOString()}::timestamptz)
      FOR UPDATE OF c`.execute(transaction)).rows[0];
        if (!command || command.hash !== input.prepared_request_hash || command.kind !== input.subject.kind
            || command.domain_id !== input.subject.domain_id || command.revision !== input.subject.source_revision) {
            throw new ConflictException("The People projection does not match its prepared actor, owner, revision or selected environment.");
        }
        const hash = createHash("sha256").update(JSON.stringify(canonicalJson(input))).digest("hex");
        const retained = (await sql `SELECT payload_hash,relationship_ids
      FROM campus_model_people_projection_receipts WHERE command_id=${input.command_id}::uuid
        AND school_id=${input.school_id}::uuid AND realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id}`.execute(transaction)).rows[0];
        if (retained) {
            if (retained.payload_hash !== hash)
                throw new ConflictException("This People projection already retained different facts.");
            return { relationship_ids: retained.relationship_ids, replayed: true };
        }
        if (command.state !== "pending")
            throw new ConflictException("A new People projection requires its pending owning command.");
        const definitions = (await sql `SELECT d.id,d.type_key,d.version
      FROM model_semantic_type_definitions d JOIN realm_model_contract_activations a ON a.contract_id=d.id AND a.contract_version=d.version
      WHERE a.realm_id=${scope.realm_id}::uuid AND a.contract_kind='semantic_type' AND a.status='active'
        AND a.effective_from<=${executionNow().toISOString()}::timestamptz
        AND (a.effective_until IS NULL OR a.effective_until>${executionNow().toISOString()}::timestamptz)
        AND d.namespace='thatcampus.people.relationships' AND d.definition_kind='relationship'
        AND d.owning_domain='people' AND d.status IN ('active','approved','deprecated')`.execute(transaction)).rows;
        const semantic = new Map(definitions.map(item => [item.type_key, item]));
        const entities = [...new Map(input.edges.flatMap(edge => [edge.source, edge.target]).map(entity => [entity.domain_id, entity])).values()];
        // One bounded batch, not one SQL round-trip per member.
        const entityRows = entities.length ? (await sql `INSERT INTO campus_model_entities(
        school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
      SELECT ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},item.kind,'people',item.domain_id,
        item.label,item.lifecycle_state,item.source_revision,item.metadata
      FROM jsonb_to_recordset(${JSON.stringify(entities)}::jsonb) AS item(kind text,domain_id text,label text,lifecycle_state text,source_revision integer,metadata jsonb)
      ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO UPDATE SET
        label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,source_revision=EXCLUDED.source_revision,
        metadata=EXCLUDED.metadata,revision=CASE WHEN campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
          OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
          OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision OR campus_model_entities.metadata IS DISTINCT FROM EXCLUDED.metadata
          THEN campus_model_entities.revision+1 ELSE campus_model_entities.revision END,updated_at=now()
      WHERE campus_model_entities.kind=EXCLUDED.kind AND campus_model_entities.source_revision<=EXCLUDED.source_revision
      RETURNING id,domain_id`.execute(transaction)).rows : [];
        if (entityRows.length !== entities.length)
            throw new ConflictException("A referenced person or group changed. Refresh and retry this People change.");
        const ids = new Map(entityRows.map(item => [item.domain_id, item.id]));
        const relationshipIds = [];
        const currentRows = input.edges.length ? (await sql `SELECT id,source_record_id,relation_type,source_revision,
        source_entity_id,target_entity_id,effective_from,effective_until,semantic_type_definition_id,metadata FROM campus_model_relationships
      WHERE school_id=${input.school_id}::uuid AND realm_id=${scope.realm_id}::uuid AND environment_namespace_id=${scope.environment_namespace_id}
        AND source_domain='people' AND source_record_id=ANY(${input.edges.map(edge => edge.source_record_id)}::text[])
      FOR UPDATE`.execute(transaction)).rows : [];
        const existing = new Map();
        for (const row of currentRows) {
            const key = `${row.relation_type}:${row.source_record_id}`;
            if (existing.has(key))
                throw new ConflictException("The owning People relationship has ambiguous retained lineage.");
            existing.set(key, row);
        }
        const updates = [];
        const inserts = [];
        for (const edge of input.edges) {
            const definition = semantic.get(edge.relation_type);
            if (!definition)
                throw new ConflictException("The institution has not activated this reviewed People relationship contract.");
            const prior = existing.get(`${edge.relation_type}:${edge.source_record_id}`);
            if (prior) {
                const sameUntil = (prior.effective_until?.toISOString() ?? null) === (edge.effective_until ? new Date(edge.effective_until).toISOString() : null);
                if (prior.source_entity_id !== ids.get(edge.source.domain_id) || prior.target_entity_id !== ids.get(edge.target.domain_id)
                    || prior.effective_from.toISOString() !== new Date(edge.effective_from).toISOString()
                    || prior.semantic_type_definition_id !== definition.id || prior.metadata.owner_subject_id !== input.subject.domain_id || edge.source_revision < prior.source_revision
                    || (edge.source_revision === prior.source_revision && !sameUntil)
                    || (prior.effective_until && (!edge.effective_until || Date.parse(edge.effective_until) > prior.effective_until.getTime()))) {
                    throw new ConflictException("A People projection cannot rewrite another owner or expand a retained relationship.");
                }
                updates.push({ id: prior.id, effective_until: edge.effective_until, source_revision: edge.source_revision });
                relationshipIds.push(prior.id);
            }
            else {
                inserts.push({ relation_type: edge.relation_type, source_entity_id: ids.get(edge.source.domain_id), target_entity_id: ids.get(edge.target.domain_id),
                    effective_from: edge.effective_from, effective_until: edge.effective_until, source_record_id: edge.source_record_id,
                    source_revision: edge.source_revision, semantic_type_definition_id: definition.id, semantic_type_version: definition.version });
            }
        }
        if (updates.length)
            await sql `UPDATE campus_model_relationships relationship SET effective_until=item.effective_until,
      source_revision=item.source_revision,updated_at=now() FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
      AS item(id uuid,effective_until timestamptz,source_revision integer) WHERE relationship.id=item.id
        AND relationship.realm_id=${scope.realm_id}::uuid AND relationship.environment_namespace_id=${scope.environment_namespace_id}`.execute(transaction);
        if (inserts.length) {
            const added = (await sql `INSERT INTO campus_model_relationships(school_id,realm_id,environment_namespace_id,
        relation_type,source_entity_id,target_entity_id,effective_from,effective_until,source_domain,source_record_id,source_revision,
        semantic_type_definition_id,semantic_type_version,metadata)
        SELECT ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},item.relation_type,item.source_entity_id,item.target_entity_id,
          item.effective_from,item.effective_until,'people',item.source_record_id,item.source_revision,item.semantic_type_definition_id,item.semantic_type_version,
          ${JSON.stringify({ authority: false, owner_subject_id: input.subject.domain_id, prepared_command_id: input.command_id })}::jsonb
        FROM jsonb_to_recordset(${JSON.stringify(inserts)}::jsonb) AS item(relation_type text,source_entity_id uuid,target_entity_id uuid,
          effective_from timestamptz,effective_until timestamptz,source_record_id text,source_revision integer,semantic_type_definition_id uuid,semantic_type_version integer)
        RETURNING id`.execute(transaction)).rows;
            relationshipIds.push(...added.map(row => row.id));
        }
        await sql `INSERT INTO campus_model_people_projection_receipts(command_id,school_id,realm_id,environment_namespace_id,payload_hash,relationship_ids,recorded_at)
      VALUES(${input.command_id}::uuid,${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},${hash},${relationshipIds}::uuid[],${executionNow().toISOString()}::timestamptz)`.execute(transaction);
        return { relationship_ids: relationshipIds, replayed: false };
    }
    async recordAcceptedChange(transaction, rawInput) {
        const input = acceptedCampusModelChangeSchema.parse(rawInput);
        const modelScope = await this.resolveScope(transaction, input.school_id);
        const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        const projectionHash = input.prepared_command_id ? acceptedChangeProjectionHash(input) : null;
        if (input.prepared_command_id) {
            const prepared = (await sql `SELECT command.id,command.state,command.actor_agent_id,command.command_type,command.source_domain,
          target.domain AS target_domain,target.domain_id AS target_domain_id,target.kind AS target_kind,
          command.expected_revision,command.correlation_id,command.causation_id,command.idempotency_key,
          command.operating_rule_version_ref,command.safe_context,command.request_hash,command.target_entity_id,
          authority.actor_agent_id AS authority_actor_id,authority.scope_entity_id AS authority_scope_id,
          authority.decision AS authority_decision,authority.correlation_id AS authority_correlation_id,
          (authority.valid_until IS NULL OR authority.valid_until>${executionNow().toISOString()}::timestamptz) AS authority_valid
        FROM campus_model_commands command
        JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.realm_id=command.realm_id
          AND target.environment_namespace_id=command.environment_namespace_id
        JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
          AND authority.realm_id=command.realm_id AND authority.environment_namespace_id=command.environment_namespace_id
        WHERE command.id=${input.prepared_command_id}::uuid AND command.school_id=${input.school_id}::uuid
          AND command.realm_id=${modelScope.realm_id}::uuid AND command.environment_namespace_id=${modelScope.environment_namespace_id}
        FOR UPDATE OF command`.execute(transaction)).rows[0];
            const target = input.entities.find(entity => entity.domain === input.target.domain && entity.domain_id === input.target.domain_id);
            if (!prepared || prepared.actor_agent_id !== actor.id || prepared.command_type !== input.command_type
                || prepared.source_domain !== input.source_domain || prepared.target_domain !== target.domain
                || prepared.target_domain_id !== target.domain_id || prepared.target_kind !== target.kind
                || prepared.expected_revision !== input.expected_revision || prepared.correlation_id !== input.correlation_id
                || prepared.causation_id !== input.causation_id || prepared.idempotency_key !== input.idempotency_key
                || prepared.operating_rule_version_ref !== input.operating_rule_version_ref
                || prepared.safe_context.accepted_change_hash !== projectionHash
                || prepared.safe_context.accepted_change_scope_hash !== acceptedChangeScopeHash(projectionHash, modelScope.realm_id, modelScope.environment_namespace_id)
                || prepared.request_hash !== input.prepared_request_hash
                || prepared.authority_actor_id !== actor.id || prepared.authority_scope_id !== prepared.target_entity_id
                || prepared.authority_decision !== "allowed" || prepared.authority_correlation_id !== input.correlation_id
                || !prepared.authority_valid || !["pending", "accepted"].includes(prepared.state)) {
                throw new ConflictException("The prepared campus change does not match this actor, environment, authority or exact projection.");
            }
            if (prepared.state === "accepted") {
                const prior = (await sql `SELECT status,code,explanation,resulting_revision,domain_event_id,metadata
          FROM campus_model_command_outcomes WHERE command_id=${prepared.id}::uuid ORDER BY sequence DESC LIMIT 1`.execute(transaction)).rows[0];
                const binding = prior?.metadata._prepared_change_projection;
                if (!prior || prior.status !== "accepted" || prior.code !== input.outcome.code || prior.explanation !== input.outcome.explanation
                    || prior.resulting_revision !== input.outcome.resulting_revision || prior.domain_event_id !== input.domain_event_id
                    || binding?.hash !== projectionHash || !Array.isArray(binding.relationship_ids)
                    || binding.relationship_ids.some(id => typeof id !== "string")) {
                    throw new ConflictException("The prepared campus change already has a different outcome.");
                }
                return { command_id: prepared.id, target_entity_id: prepared.target_entity_id, actor_agent_id: actor.id,
                    relationship_ids: binding.relationship_ids };
            }
        }
        const entities = new Map();
        for (const snapshot of input.entities) {
            const entity = await this.upsertEntity(transaction, input.school_id, snapshot, modelScope);
            entities.set(this.key(entity), entity.id);
        }
        const relationshipIds = [];
        for (const snapshot of input.relationships) {
            const sourceId = this.resolve(entities, snapshot.source);
            const targetId = snapshot.target ? this.resolve(entities, snapshot.target) : null;
            const current = snapshot.replace_current
                ? (await sql `SELECT id,target_entity_id,effective_from
            FROM campus_model_relationships
            WHERE realm_id=${modelScope.realm_id}::uuid
              AND environment_namespace_id=${modelScope.environment_namespace_id}
              AND relation_type=${snapshot.relation_type}
              AND source_entity_id=${sourceId}::uuid AND effective_until IS NULL
            ORDER BY effective_from DESC FOR UPDATE`.execute(transaction)).rows[0]
                : undefined;
            if (snapshot.operation === "set" && targetId && current?.target_entity_id === targetId) {
                await sql `UPDATE campus_model_relationships SET
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
                await sql `UPDATE campus_model_relationships SET effective_until=${snapshot.effective_from}::timestamptz,updated_at=now()
          WHERE id=${current.id}::uuid`.execute(transaction);
                relationshipIds.push(current.id);
            }
            if (snapshot.operation === "clear")
                continue;
            if (!targetId)
                throw new ConflictException("The connected campus relationship target is missing.");
            const inserted = (await sql `INSERT INTO campus_model_relationships(
          school_id,realm_id,environment_namespace_id,relation_type,
          source_entity_id,target_entity_id,effective_from,effective_until,
          source_domain,source_record_id,source_revision,metadata
        ) VALUES (
          ${input.school_id}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
          ${snapshot.relation_type},${sourceId}::uuid,${targetId}::uuid,
          ${snapshot.effective_from}::timestamptz,${snapshot.effective_until}::timestamptz,
          ${snapshot.source_domain},${snapshot.source_record_id},${snapshot.source_revision},
          ${JSON.stringify(snapshot.metadata)}::jsonb
        )
        ON CONFLICT(realm_id,environment_namespace_id,relation_type,source_entity_id,target_entity_id,effective_from)
        DO UPDATE SET effective_until=EXCLUDED.effective_until,source_domain=EXCLUDED.source_domain,
          source_record_id=EXCLUDED.source_record_id,source_revision=EXCLUDED.source_revision,
          metadata=EXCLUDED.metadata,updated_at=now()
        RETURNING id`.execute(transaction)).rows[0];
            if (!inserted)
                throw new ConflictException("The connected campus relationship could not be recorded.");
            relationshipIds.push(inserted.id);
        }
        const targetEntityId = this.resolve(entities, input.target);
        if (input.prepared_command_id) {
            await this.completeDomainCommand(transaction, { school_id: input.school_id, command_id: input.prepared_command_id,
                terminal_state: "accepted", code: input.outcome.code, explanation: input.outcome.explanation,
                resulting_revision: input.outcome.resulting_revision, domain_event_id: input.domain_event_id,
                metadata: { ...input.outcome.metadata, _prepared_change_projection: { hash: projectionHash, relationship_ids: relationshipIds } },
                completed_at: executionNow().toISOString() });
            return { command_id: input.prepared_command_id, target_entity_id: targetEntityId, actor_agent_id: actor.id, relationship_ids: relationshipIds };
        }
        const command = await this.recordCommand(transaction, input, actor.id, targetEntityId, modelScope);
        await sql `INSERT INTO campus_model_command_outcomes(
        command_id,realm_id,environment_namespace_id,sequence,status,code,explanation,
        resulting_entity_id,resulting_revision,domain_event_id,metadata
      ) VALUES (
        ${command.id}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
        1,'accepted',${input.outcome.code},${input.outcome.explanation},
        ${targetEntityId}::uuid,${input.outcome.resulting_revision},${input.domain_event_id}::uuid,
        ${JSON.stringify(input.outcome.metadata)}::jsonb
      ) ON CONFLICT(command_id,sequence) DO NOTHING`.execute(transaction);
        return { command_id: command.id, target_entity_id: targetEntityId, actor_agent_id: actor.id, relationship_ids: relationshipIds };
    }
    async recordObservations(transaction, rawObservations) {
        const observations = rawObservations.map((item) => campusModelObservationSchema.parse(item));
        const ids = [];
        for (const observation of observations) {
            const modelScope = await this.resolveScope(transaction, observation.school_id);
            const contracts = observation.contract_refs
                ? await this.resolveObservationContracts(transaction, modelScope, observation.contract_refs)
                : null;
            if (observation.captured_by && !["human", "configured_software"].includes(observation.captured_by.kind) && observation.state === "accepted") {
                throw new ConflictException("Device and integration evidence must be reviewed by its owning workflow before acceptance.");
            }
            const software = observation.captured_by?.kind === "configured_software" ? observation.captured_by : null;
            if (software) {
                const accepted = (await sql `SELECT 1 FROM campus_model_commands command
          JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
          JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
          WHERE command.school_id=${observation.school_id}::uuid AND command.realm_id=${modelScope.realm_id}::uuid
            AND command.environment_namespace_id=${modelScope.environment_namespace_id}
            AND command.id=${software.command_id}::uuid AND command.actor_agent_id=${software.agent_id}::uuid
            AND command.state='accepted' AND outcome.domain_event_id=${observation.domain_event_id}::uuid
            AND target.domain=${observation.context?.domain ?? null} AND target.domain_id=${observation.context?.domain_id ?? null}
          FOR SHARE OF command`.execute(transaction)).rows[0];
                if (!accepted || observation.state !== "accepted")
                    throw new ForbiddenException("Software observations require their exact accepted command and context in this environment.");
            }
            const actor = observation.captured_by
                ? observation.captured_by.kind === "human"
                    ? await this.ensureHumanAgent(transaction, observation.school_id, observation.captured_by.user_id)
                    : observation.captured_by.kind === "configured_software"
                        ? await this.requireConfiguredSoftwareActor(transaction, observation.school_id, observation.captured_by.agent_id, observation.captured_by.behaviour_version_id, observation.captured_by.source_domain, observation.received_at)
                        : await this.requireAuthorizedExternalAgent(transaction, observation.school_id, observation.captured_by, observation.source_type, observation.context)
                : await this.ensureHumanAgent(transaction, observation.school_id, observation.actor_user_id);
            const subject = await this.upsertEntity(transaction, observation.school_id, observation.subject, modelScope, contracts?.subject_type);
            const context = observation.context
                ? await this.upsertEntity(transaction, observation.school_id, observation.context, modelScope, contracts?.context_type ?? undefined)
                : null;
            const requestHash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
            const inserted = (await sql `INSERT INTO campus_model_observations(
          school_id,realm_id,environment_namespace_id,kind,subject_entity_id,context_entity_id,captured_by_agent_id,source_type,
          source_ref,source_record_id,observed_at,received_at,evidence_refs,payload,schema_version,
          state,state_recorded_at,idempotency_key,request_hash,domain_event_id,
          protocol_schema_definition_id,protocol_schema_version,
          capability_manifest_id,capability_manifest_version
        ) VALUES (
          ${observation.school_id}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
          ${observation.kind},${subject.id}::uuid,${context?.id ?? null}::uuid,
          ${actor.id}::uuid,${observation.source_type},${observation.source_ref},${observation.source_record_id},
          ${observation.observed_at}::timestamptz,${observation.received_at}::timestamptz,
          ${observation.evidence_refs}::text[],${JSON.stringify(observation.payload)}::jsonb,
          ${observation.schema_version},${observation.state},${observation.received_at}::timestamptz,${observation.idempotency_key},${requestHash},
          ${observation.domain_event_id}::uuid,
          ${contracts?.observation_schema.id ?? null}::uuid,${contracts?.observation_schema.version ?? null},
          ${contracts?.capability_manifest.id ?? null}::uuid,${contracts?.capability_manifest.version ?? null}
        ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
        RETURNING id,request_hash`.execute(transaction)).rows[0];
            if (inserted) {
                ids.push(inserted.id);
                continue;
            }
            const existing = (await sql `SELECT id,request_hash FROM campus_model_observations
        WHERE realm_id=${modelScope.realm_id}::uuid
          AND environment_namespace_id=${modelScope.environment_namespace_id}
          AND idempotency_key=${observation.idempotency_key}
        FOR UPDATE`.execute(transaction)).rows[0];
            if (!existing || existing.request_hash !== requestHash) {
                throw new ConflictException("This observation key was already used for different evidence.");
            }
            ids.push(existing.id);
        }
        return ids;
    }
    async listObservationSources(schoolId) {
        return this.listObservationSourcesIn(this.db, schoolId);
    }
    async listObservationSourcesIn(executor, schoolId) {
        return (await sql `SELECT agent.id,agent.agent_kind AS kind,agent.external_ref,agent.label,
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
    async registerObservationSource(transaction, input) {
        const scope = input.scope ? (await sql `SELECT id,domain,domain_id,label FROM campus_model_entities
      WHERE school_id=${input.school_id}::uuid AND domain=${input.scope.domain} AND domain_id=${input.scope.domain_id}
      FOR UPDATE`.execute(transaction)).rows[0] : null;
        if (input.scope && !scope)
            throw new ConflictException("The selected campus scope is not connected yet.");
        const existing = (await sql `SELECT id FROM campus_model_agents WHERE school_id=${input.school_id}::uuid
      AND agent_kind=${input.kind} AND external_ref=${input.external_ref} FOR UPDATE`.execute(transaction)).rows[0];
        if (existing)
            throw new ConflictException("This source ID is already registered.");
        const agent = (await sql `INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status,metadata)
      VALUES(${input.school_id}::uuid,${input.kind},${input.external_ref},${input.label},'active','{}'::jsonb)
      RETURNING id`.execute(transaction)).rows[0];
        if (!agent)
            throw new ConflictException("The source could not be registered.");
        for (const capability of input.capabilities) {
            await sql `INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,scope_entity_id,effective_from,
        grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints)
        VALUES(${input.school_id}::uuid,${agent.id}::uuid,${capability},${scope?.id ?? null}::uuid,now(),
          'institution_setup',${`observation-source:${agent.id}`},${input.actor_user_id}::uuid,
          ${input.operating_rule_version_ref},'{}'::jsonb)`.execute(transaction);
        }
        return (await this.listObservationSourcesIn(transaction, input.school_id)).find((item) => item.id === agent.id);
    }
    async setObservationSourceStatus(transaction, input) {
        const current = (await sql `SELECT status FROM campus_model_agents WHERE id=${input.source_id}::uuid
      AND school_id=${input.school_id}::uuid AND agent_kind IN ('device','integration') FOR UPDATE`.execute(transaction)).rows[0];
        if (!current)
            throw new ConflictException("The device or connection was not found.");
        if (current.status === "revoked" && input.status !== "revoked")
            throw new ConflictException("A revoked source cannot be reactivated. Register it again with a new source ID.");
        const updated = (await sql `UPDATE campus_model_agents SET status=${input.status},revision=revision+1,updated_at=now()
      WHERE id=${input.source_id}::uuid AND school_id=${input.school_id}::uuid AND revision=${input.expected_revision}
      RETURNING id`.execute(transaction)).rows[0];
        if (!updated)
            throw new ConflictException("This source changed. Refresh and review its latest state.");
        if (input.status === "revoked")
            await sql `UPDATE campus_model_agent_authorities SET revoked_at=now(),revoked_by=${input.actor_user_id}::uuid
      WHERE school_id=${input.school_id}::uuid AND agent_id=${input.source_id}::uuid AND revoked_at IS NULL`.execute(transaction);
        return (await this.listObservationSourcesIn(transaction, input.school_id)).find((item) => item.id === input.source_id);
    }
    async transitionObservations(transaction, rawInput) {
        const input = campusModelObservationTransitionSchema.parse(rawInput);
        const result = await transaction.updateTable("campus_model_observations")
            .set({ state: input.state, state_recorded_at: executionNow() })
            .where("school_id", "=", input.school_id)
            .where("source_type", "=", input.source_type)
            .where("source_ref", "=", input.source_ref)
            .where("environment_namespace_id", "=", executionNamespaceForSchool(input.school_id, this.executionScope?.current()))
            .$if(input.source_record_id !== undefined, query => query.where("source_record_id", "=", input.source_record_id))
            .where("state", "!=", "superseded")
            .where("state", "!=", input.state)
            .executeTakeFirst();
        return Number(result.numUpdatedRows ?? 0);
    }
    async findExactTrace(transaction, rawInput) {
        const input = coordinationTraceQuerySchema.parse(rawInput);
        const rows = (await sql `SELECT event.id AS event_id,
        event.correlation_id,message.id AS message_id,message.state AS message_state,
        (message.state IN ('queued','delivered','acknowledged')
          AND (message.expires_at IS NULL OR message.expires_at>${executionNow()}::timestamptz)) AS message_open
      FROM campus_model_events event
      JOIN campus_model_reactions reaction ON reaction.school_id=event.school_id
        AND reaction.trigger_event_id=event.id
      JOIN campus_model_operational_messages message ON message.school_id=reaction.school_id
        AND message.reaction_id=reaction.id
      WHERE event.school_id=${input.school_id}::uuid
        AND event.source_domain=${input.source_domain}
        AND event.source_record_id=${input.source_record_id}
        AND event.event_type=${input.event_type}
        AND event.source_revision=${input.source_revision}
        ${input.message_id ? sql `AND message.id=${input.message_id}::uuid` : sql ``}
        AND event.environment_namespace_id=${executionNamespaceForSchool(input.school_id, this.executionScope?.current())}
        AND reaction.environment_namespace_id=event.environment_namespace_id
        AND message.environment_namespace_id=event.environment_namespace_id
      ORDER BY event.recorded_at,event.id,message.id
      FOR SHARE OF event,reaction,message`.execute(transaction)).rows;
        return rows.length === 1 ? rows[0] : null;
    }
    async hasAcceptedSourceEvent(transaction, rawInput) {
        const input = sourceEventLookupSchema.parse(rawInput);
        const row = (await sql `SELECT EXISTS(
        SELECT 1 FROM campus_model_events event
        WHERE event.school_id=${input.school_id}::uuid
          AND event.source_outbox_event_id=${input.source_outbox_event_id}::uuid
      ) AS present`.execute(transaction)).rows[0];
        return row?.present ?? false;
    }
    async listOperationalMessageWork(transaction, rawInput) {
        const input = operationalMessageWorkQuerySchema.parse(rawInput);
        const states = sql.join(input.states.map((state) => sql `${state}`));
        const lock = input.claim ? sql `FOR UPDATE OF message SKIP LOCKED` : sql ``;
        return (await sql `SELECT message.id AS message_id,
        message.school_id,message.state,message.payload
      FROM campus_model_operational_messages message
      WHERE message.state IN (${states})
        AND message.payload->>'workflow'=${input.workflow}
      ORDER BY message.queued_at,message.id
      LIMIT ${input.limit}
      ${lock}`.execute(transaction)).rows;
    }
    async resolveEventRoute(transaction, rawInput) {
        const input = coordinationRouteResolutionInputSchema.parse(rawInput);
        const matches = (await sql `SELECT
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
        AND subscription.recipient_selector->>'selector_key'=${input.selector_key}
      FOR SHARE OF behaviour,subscription`.execute(transaction)).rows;
        if (matches.length === 0) {
            return {
                status: "unmatched",
                exception_code: "configuration_missing",
                explanation: "No approved Operating-rule behaviour is active for this campus event.",
                matching_behaviour_version_ids: [],
            };
        }
        if (matches.length !== 1) {
            return {
                status: "unmatched",
                exception_code: "configuration_invalid",
                explanation: "More than one approved Operating-rule behaviour matches this campus event.",
                matching_behaviour_version_ids: matches.map((item) => item.behaviour_version_id),
            };
        }
        const match = matches[0];
        const parsedSelector = coordinationRecipientSelectorConfigSchema.safeParse(match.recipient_selector);
        if (!parsedSelector.success || parsedSelector.data.selector_key !== input.selector_key) {
            return {
                status: "unmatched",
                exception_code: "configuration_invalid",
                explanation: "The approved behaviour has an invalid recipient selector.",
                matching_behaviour_version_ids: [match.behaviour_version_id],
            };
        }
        if (match.response_due_after_seconds !== null && match.expires_after_seconds !== null
            && match.response_due_after_seconds > match.expires_after_seconds) {
            return {
                status: "unmatched",
                exception_code: "configuration_invalid",
                explanation: "The approved behaviour has a response deadline after its expiry.",
                matching_behaviour_version_ids: [match.behaviour_version_id],
            };
        }
        return {
            status: "matched",
            behaviour_version_id: match.behaviour_version_id,
            behaviour_key: match.behaviour_key,
            behaviour_version: match.behaviour_version,
            behaviour_configuration: match.behaviour_configuration,
            configuration_schema_version: match.configuration_schema_version,
            subscription_id: match.subscription_id,
            subscription_key: match.subscription_key,
            reaction_kind: match.reaction_kind,
            message_kind: match.message_kind,
            message_schema_version: match.message_schema_version,
            selector: parsedSelector.data,
            response_due_after_seconds: match.response_due_after_seconds,
            expires_after_seconds: match.expires_after_seconds,
            max_attempts: match.max_attempts,
            retry_after_seconds: match.retry_after_seconds,
            priority: match.priority,
        };
    }
    async authorizeCandidateRecipients(transaction, rawInput) {
        const input = coordinationCandidateAuthorizationInputSchema.parse(rawInput);
        const recipientKeys = input.recipients.map((recipient) => recipient.agent_kind === "human"
            ? `human:${recipient.user_id}`
            : `${recipient.agent_kind}:${recipient.external_ref}`);
        if (new Set(recipientKeys).size !== recipientKeys.length) {
            throw new ConflictException("Candidate recipient references must be unique.");
        }
        const match = (await sql `SELECT
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
      WHERE behaviour.school_id=${input.school_id}::uuid
        AND behaviour.id=${input.behaviour_version_id}::uuid
        AND subscription.id=${input.subscription_id}::uuid
        AND behaviour.status='approved'
        AND behaviour.effective_from<=${input.occurred_at}::timestamptz
        AND (behaviour.effective_until IS NULL OR behaviour.effective_until>${input.occurred_at}::timestamptz)
      FOR SHARE OF behaviour,subscription`.execute(transaction)).rows[0];
        if (!match) {
            throw new ConflictException("The selected coordination route is no longer active.");
        }
        const parsedSelector = coordinationRecipientSelectorConfigSchema.safeParse(match.recipient_selector);
        if (!parsedSelector.success) {
            throw new ConflictException("The selected coordination route has an invalid recipient selector.");
        }
        const selector = parsedSelector.data;
        if (selector.scope_mode === "event_scope" && !input.scope) {
            throw new ConflictException("This coordination route requires an explicit campus scope.");
        }
        if (selector.scope_mode === "institution" && input.scope) {
            throw new ConflictException("This coordination route is institution-scoped.");
        }
        const scope = input.scope
            ? await this.upsertEntity(transaction, input.school_id, input.scope)
            : null;
        const authorised = [];
        const unresolved = [];
        const unauthorized = [];
        for (const recipientRef of input.recipients) {
            const recipient = await this.resolveAgentReference(transaction, input.school_id, recipientRef);
            if (!recipient) {
                unresolved.push(recipientRef);
                continue;
            }
            const grant = (await sql `SELECT authority.id
        FROM campus_model_agent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid
          AND authority.agent_id=${recipient.id}::uuid
          AND authority.capability=${selector.required_capability}
          AND authority.revoked_at IS NULL
          AND authority.effective_from<=${input.occurred_at}::timestamptz
          AND (authority.effective_until IS NULL OR authority.effective_until>${input.occurred_at}::timestamptz)
          AND (
            (${selector.scope_mode}='institution' AND authority.scope_entity_id IS NULL)
            OR (${selector.scope_mode}='event_scope' AND (
              authority.scope_entity_id IS NULL OR authority.scope_entity_id=${scope?.id ?? null}::uuid
            ))
          )
        LIMIT 1
        FOR SHARE OF authority`.execute(transaction)).rows[0];
            if (grant)
                authorised.push(recipientRef);
            else
                unauthorized.push(recipientRef);
        }
        return { authorised, unresolved, unauthorized };
    }
    async publishAcceptedEvent(transaction, rawInput) {
        const input = acceptedCoordinationEventSchema.parse(rawInput);
        const sourceOutbox = (await sql `SELECT id,event_type,aggregate_id::text AS aggregate_id
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
        const insertedEvent = (await sql `INSERT INTO campus_model_events(
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
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash`.execute(transaction)).rows[0];
        const event = insertedEvent ?? (await sql `SELECT id,request_hash FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${subject.id}::uuid
        AND idempotency_key=${input.idempotency_key}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This coordination event key was already used for different work.");
        }
        if (!insertedEvent) {
            const existing = (await sql `SELECT reaction.id AS reaction_id,message.id AS message_id,
          reaction.behaviour_version_id,reaction.subscription_id,
          reaction.recipient_agent_id,reaction.selector_snapshot,
          message.message_kind,message.schema_version AS message_schema_version,
          message.response_due_at,message.expires_at
        FROM campus_model_reactions reaction
        JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        WHERE reaction.school_id=${input.school_id}::uuid AND reaction.trigger_event_id=${event.id}::uuid
        ORDER BY reaction.created_at,reaction.id`.execute(transaction)).rows;
            if (existing.length > 0) {
                return {
                    status: "matched",
                    event_id: event.id,
                    behaviour_version_id: existing[0].behaviour_version_id,
                    subscription_id: existing[0].subscription_id,
                    reaction_ids: existing.map((item) => item.reaction_id),
                    message_ids: existing.map((item) => item.message_id),
                    deliveries: existing.map((item) => {
                        const snapshot = item.selector_snapshot;
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
                    route_snapshot: {
                        message_kind: existing[0].message_kind,
                        message_schema_version: existing[0].message_schema_version,
                        response_due_at: existing[0].response_due_at
                            ? new Date(existing[0].response_due_at).toISOString()
                            : null,
                        expires_at: existing[0].expires_at
                            ? new Date(existing[0].expires_at).toISOString()
                            : null,
                    },
                    replayed: true,
                };
            }
            const existingException = (await sql `SELECT id,exception_code
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
        const matches = (await sql `SELECT
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
            return this.recordCoordinationException(transaction, input, event.id, "configuration_missing", "No approved Operating-rule behaviour is active for this campus event.", { source_domain: input.source_domain, event_type: input.event_type, selector_key: input.selector_input.selector_key });
        }
        if (matches.length !== 1) {
            return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid", "More than one Operating-rule behaviour matches this campus event. Retire the overlap before replaying it.", { matching_behaviour_version_ids: matches.map((item) => item.behaviour_version_id) });
        }
        const match = matches[0];
        if (input.expected_route && (input.expected_route.behaviour_version_id !== match.behaviour_version_id
            || input.expected_route.subscription_id !== match.subscription_id)) {
            return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid", "The approved coordination route changed after the domain selected its recipient.", {
                expected_behaviour_version_id: input.expected_route.behaviour_version_id,
                expected_subscription_id: input.expected_route.subscription_id,
                actual_behaviour_version_id: match.behaviour_version_id,
                actual_subscription_id: match.subscription_id,
            });
        }
        const parsedSelector = coordinationRecipientSelectorConfigSchema.safeParse(match.recipient_selector);
        if (!parsedSelector.success) {
            return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid", "The approved behaviour has an invalid recipient selector.", { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
        }
        const selector = parsedSelector.data;
        if (selector.selector_key !== input.selector_input.selector_key) {
            return this.recordCoordinationException(transaction, input, event.id, "selector_invalid", "The supplied recipient selector does not match the approved behaviour.", { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
        }
        if (input.selector_input.recipient_agents.length < selector.min_recipients
            || input.selector_input.recipient_agents.length > selector.max_recipients) {
            return this.recordCoordinationException(transaction, input, event.id, "selector_invalid", "The selected recipient count is outside the approved behaviour.", { minimum: selector.min_recipients, maximum: selector.max_recipients, selected: input.selector_input.recipient_agents.length });
        }
        if (selector.scope_mode === "event_scope" && !input.selector_input.scope) {
            return this.recordCoordinationException(transaction, input, event.id, "selector_invalid", "This approved behaviour requires an explicit campus scope.", { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
        }
        if (selector.scope_mode === "institution" && input.selector_input.scope) {
            return this.recordCoordinationException(transaction, input, event.id, "selector_invalid", "This approved behaviour is institution-scoped and cannot accept a narrower selector scope.", { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
        }
        const scope = input.selector_input.scope
            ? await this.upsertEntity(transaction, input.school_id, input.selector_input.scope)
            : null;
        const resolvedRecipients = [];
        for (const recipientRef of input.selector_input.recipient_agents) {
            const recipient = await this.resolveAgentReference(transaction, input.school_id, recipientRef);
            if (!recipient) {
                return this.recordCoordinationException(transaction, input, event.id, "recipient_unresolved", "An explicitly selected recipient does not resolve to an active campus agent.", { recipient: recipientRef });
            }
            resolvedRecipients.push(recipient);
        }
        const resolvedRecipientIds = resolvedRecipients.map((recipient) => recipient.id);
        const recipients = (await sql `SELECT agent.id,NULL::uuid AS user_id,agent.agent_kind,agent.external_ref
      FROM campus_model_agents agent
      WHERE agent.school_id=${input.school_id}::uuid
        AND agent.id=ANY(${resolvedRecipientIds}::uuid[])
        AND agent.status='active' AND EXISTS (
          SELECT 1 FROM campus_model_agent_authorities authority
          WHERE authority.agent_id=agent.id AND authority.school_id=agent.school_id
            AND authority.capability=${selector.required_capability}
            AND authority.revoked_at IS NULL
            AND authority.effective_from<=${input.occurred_at}::timestamptz
            AND (authority.effective_until IS NULL OR authority.effective_until>${input.occurred_at}::timestamptz)
            AND (
              (${selector.scope_mode}='institution' AND authority.scope_entity_id IS NULL)
              OR (${selector.scope_mode}='event_scope' AND (authority.scope_entity_id IS NULL OR authority.scope_entity_id=${scope?.id ?? null}::uuid))
            )
        )
      ORDER BY agent.id
      FOR SHARE OF agent`.execute(transaction)).rows;
        if (recipients.length !== resolvedRecipientIds.length) {
            return this.recordCoordinationException(transaction, input, event.id, "recipient_unauthorized", "Every selected recipient must be active and authorized by the approved behaviour scope.", { required_capability: selector.required_capability, scope_entity_id: scope?.id ?? null });
        }
        const queuedAt = executionNow().toISOString();
        const responseDueAt = match.response_due_after_seconds === null
            ? null
            : new Date(Date.parse(queuedAt) + match.response_due_after_seconds * 1_000).toISOString();
        const expiresAt = match.expires_after_seconds === null
            ? null
            : new Date(Date.parse(queuedAt) + match.expires_after_seconds * 1_000).toISOString();
        if (responseDueAt && expiresAt && Date.parse(responseDueAt) > Date.parse(expiresAt)) {
            return this.recordCoordinationException(transaction, input, event.id, "configuration_invalid", "The approved behaviour has a response deadline after its expiry.", { behaviour_version_id: match.behaviour_version_id, subscription_id: match.subscription_id });
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
        const recipientRefs = new Map(resolvedRecipients.map((recipient, index) => [recipient.id, input.selector_input.recipient_agents[index]]));
        const reactionIds = [];
        const messageIds = [];
        const deliveries = [];
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
            const insertedReaction = (await sql `INSERT INTO campus_model_reactions(
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
        ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
        RETURNING id,request_hash`.execute(transaction)).rows[0];
            const reaction = insertedReaction ?? (await sql `SELECT id,request_hash
        FROM campus_model_reactions
        WHERE school_id=${input.school_id}::uuid AND trigger_event_id=${event.id}::uuid
          AND idempotency_key=${reactionIdempotencyKey}
        FOR UPDATE`.execute(transaction)).rows[0];
            if (!reaction || reaction.request_hash !== reactionRequestHash) {
                throw new ConflictException("This reaction key was already used for different work.");
            }
            const insertedMessage = (await sql `INSERT INTO campus_model_operational_messages(
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
            const message = insertedMessage ?? (await sql `SELECT id
        FROM campus_model_operational_messages WHERE reaction_id=${reaction.id}::uuid
        FOR UPDATE`.execute(transaction)).rows[0];
            if (!message)
                throw new ConflictException("The operational message could not be queued.");
            const dispatchKey = `campus-model:message:${message.id}:queued`;
            const dispatchAudience = recipientUsers.get(recipientAgentId)
                ? [recipientUsers.get(recipientAgentId)]
                : [];
            const dispatchPayload = {
                message_id: message.id,
                reaction_id: reaction.id,
                message_kind: match.message_kind,
                state: "queued",
                correlation_id: input.correlation_id,
                source_outbox_event_id: input.source_outbox_event_id,
            };
            const dispatch = (await sql `INSERT INTO event_outbox(
          school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key
        ) VALUES (
          ${input.school_id}::uuid,'campus.coordination.message_queued','campus_operational_message',
          ${message.id}::uuid,${dispatchAudience}::uuid[],${JSON.stringify(dispatchPayload)}::jsonb,${dispatchKey}
        ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0]
                ?? (await sql `SELECT id FROM event_outbox
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
            if (!dispatch)
                throw new ConflictException("The operational message dispatch could not be retained.");
            await sql `UPDATE campus_model_operational_messages
        SET dispatch_outbox_event_id=${dispatch.id}::uuid,updated_at=now()
        WHERE id=${message.id}::uuid AND school_id=${input.school_id}::uuid
          AND (dispatch_outbox_event_id IS NULL OR dispatch_outbox_event_id=${dispatch.id}::uuid)`.execute(transaction);
            reactionIds.push(reaction.id);
            messageIds.push(message.id);
            deliveries.push({ reaction_id: reaction.id, message_id: message.id, recipient: recipientRefs.get(recipientAgentId) });
        }
        return {
            status: "matched",
            event_id: event.id,
            behaviour_version_id: match.behaviour_version_id,
            subscription_id: match.subscription_id,
            reaction_ids: reactionIds,
            message_ids: messageIds,
            deliveries,
            route_snapshot: {
                message_kind: match.message_kind,
                message_schema_version: match.message_schema_version,
                response_due_at: responseDueAt,
                expires_at: expiresAt,
            },
            replayed: false,
        };
    }
    async recordAcceptedEvent(transaction, rawInput) {
        const input = acceptedDomainEventSchema.parse(rawInput);
        return this.recordDomainEventForActor(transaction, input);
    }
    async recordSoftwareEvent(transaction, rawInput) {
        return this.recordDomainEventForActor(transaction, softwareDomainEventSchema.parse(rawInput));
    }
    async recordDomainEventForActor(transaction, input) {
        const sourceOutbox = (await sql `SELECT id,event_type,aggregate_id::text AS aggregate_id
      FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
      FOR KEY SHARE`.execute(transaction)).rows[0];
        if (!sourceOutbox || sourceOutbox.event_type !== input.event_type || sourceOutbox.aggregate_id !== input.source_record_id) {
            throw new ConflictException("The accepted domain event does not match its source outbox record.");
        }
        const modelScope = await this.resolveScope(transaction, input.school_id);
        const actor = "actor_agent_id" in input
            ? await this.requireConfiguredSoftwareActor(transaction, input.school_id, input.actor_agent_id, input.behaviour_version_id, input.source_domain, input.occurred_at)
            : await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        const subject = await this.upsertEntity(transaction, input.school_id, input.subject, modelScope);
        const context = input.context
            ? await this.upsertEntity(transaction, input.school_id, input.context, modelScope)
            : null;
        const audience = [];
        for (const userId of input.audience_user_ids) {
            audience.push(await this.ensureHumanAgent(transaction, input.school_id, userId));
        }
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const inserted = (await sql `INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,causation_event_id,provenance,payload,schema_version,idempotency_key,
        request_hash,source_outbox_event_id
      ) VALUES (
        ${input.school_id}::uuid,'domain_event',${input.event_type},${subject.id}::uuid,
        ${context?.id ?? null}::uuid,${actor.id}::uuid,${input.source_domain},${input.source_record_id},
        ${input.source_revision},${input.occurred_at}::timestamptz,${input.effective_from}::timestamptz,
        ${input.effective_until}::timestamptz,${input.correlation_id}::uuid,${input.causation_event_id}::uuid,
        ${JSON.stringify({ source: "event_outbox", source_outbox_event_id: input.source_outbox_event_id })}::jsonb,
        ${JSON.stringify(input.payload)}::jsonb,1,${input.idempotency_key},${requestHash},
        ${input.source_outbox_event_id}::uuid
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash FROM campus_model_events
      WHERE realm_id=${modelScope.realm_id}::uuid
        AND environment_namespace_id=${modelScope.environment_namespace_id}
        AND idempotency_key=${input.idempotency_key}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This domain event key was already used for different work.");
        }
        for (const recipient of audience) {
            await sql `INSERT INTO campus_model_event_agent_participants(
          school_id,realm_id,environment_namespace_id,event_id,agent_id,participation_kind
        ) VALUES (
          ${input.school_id}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
          ${event.id}::uuid,${recipient.id}::uuid,'audience'
        ) ON CONFLICT(realm_id,environment_namespace_id,event_id,agent_id,participation_kind) DO NOTHING`
                .execute(transaction);
        }
        return {
            event_id: event.id,
            actor_agent_id: actor.id,
            audience_agent_ids: audience.map((item) => item.id),
            replayed: !inserted,
        };
    }
    async recordRecipientResponse(transaction, rawInput) {
        const input = recipientOperationalMessageResponseSchema.parse(rawInput);
        const recipient = await this.resolveAgentReference(transaction, input.school_id, input.recipient);
        if (!recipient)
            throw new ConflictException("The assigned recipient is not active in this institution.");
        const replay = (await sql `SELECT message.id AS message_id
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
        const message = (await sql `SELECT
        message.id AS message_id,message.state,event.source_record_id,event.source_revision,
        reaction.selector_snapshot,
        message.response_due_at IS NULL OR ${input.occurred_at}::timestamptz<=message.response_due_at AS before_response_due,
        message.expires_at IS NULL OR ${input.occurred_at}::timestamptz<message.expires_at AS before_expiry
      FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
      JOIN campus_model_events event ON event.id=reaction.trigger_event_id AND event.school_id=reaction.school_id
      WHERE message.school_id=${input.school_id}::uuid AND message.id=${input.message_id}::uuid
        AND message.correlation_id=${input.correlation_id}::uuid
        AND message.recipient_agent_id=${recipient.id}::uuid
        AND message.state IN ('queued','delivered','acknowledged')
      FOR UPDATE OF message`.execute(transaction)).rows[0];
        if (!message)
            throw new ConflictException("No open operational request matches this message, recipient and correlation.");
        if (message.source_record_id !== input.expected_source_record_id) {
            throw new ConflictException("The operational request does not belong to this source record.");
        }
        if (message.source_revision !== input.expected_source_revision) {
            throw new ConflictException("The source record changed. Refresh before responding to this request.");
        }
        if (!message.before_response_due) {
            throw new ConflictException("The response deadline for this operational request has passed.");
        }
        if (!message.before_expiry) {
            throw new ConflictException("This operational request has expired.");
        }
        const selectorSnapshot = message.selector_snapshot;
        const selector = coordinationRecipientSelectorConfigSchema.safeParse(selectorSnapshot.config);
        if (!selector.success) {
            throw new ConflictException("The operational request has invalid authority evidence.");
        }
        const scopeEntityId = selectorSnapshot.input?.scope_entity_id;
        if (scopeEntityId !== null && scopeEntityId !== undefined
            && (typeof scopeEntityId !== "string" || !uuid.safeParse(scopeEntityId).success)) {
            throw new ConflictException("The operational request has invalid scope evidence.");
        }
        const currentAuthorityGrants = (await sql `SELECT authority.id
      FROM campus_model_agent_authorities authority
      WHERE authority.school_id=${input.school_id}::uuid
        AND authority.agent_id=${recipient.id}::uuid
        AND authority.capability=${selector.data.required_capability}
        AND authority.revoked_at IS NULL
        AND authority.effective_from<=${input.occurred_at}::timestamptz
        AND (authority.effective_until IS NULL OR authority.effective_until>${input.occurred_at}::timestamptz)
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
    async supersedeDomainMessage(transaction, rawInput) {
        const input = domainMessageSupersessionSchema.parse(rawInput);
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore();
        const namespace = executionNamespaceForSchool(input.school_id, environment);
        const executor = (await sql `SELECT current_setting('thatcampus.namespace_id',true) AS namespace`.execute(transaction)).rows[0];
        if (environment?.kind === "simulation" ? executor?.namespace !== namespace : Boolean(executor?.namespace && executor.namespace !== namespace)) {
            throw new ForbiddenException("Domain message supersession requires the selected execution data plane.");
        }
        const scope = await resolveOperationalRealmScope(transaction, input.school_id, environment);
        const now = executionNow().toISOString();
        const requestHash = createHash("sha256").update(JSON.stringify(canonicalJson(input))).digest("hex");
        // This is deliberately separate from recipient/sender protocol authority.
        // An owning-domain command may retire only the invitation for its exact
        // previous source revision after journalling the next accepted source fact.
        const message = (await sql `SELECT message.id,message.reaction_id,message.state,message.recipient_agent_id,
        message.sender_agent_id,message.correlation_id,recipient.agent_kind AS recipient_agent_kind,
        reaction.selector_snapshot,command.actor_agent_id,resulting.source_outbox_event_id,
        resulting.source_revision,target.source_revision AS current_revision,command.state AS command_state
      FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
        AND reaction.school_id=message.school_id AND reaction.realm_id=message.realm_id
        AND reaction.environment_namespace_id=message.environment_namespace_id
      JOIN campus_model_agents recipient ON recipient.id=message.recipient_agent_id AND recipient.school_id=message.school_id
      JOIN campus_model_events previous ON previous.id=reaction.trigger_event_id
        AND previous.school_id=message.school_id AND previous.realm_id=message.realm_id
        AND previous.environment_namespace_id=message.environment_namespace_id
      JOIN campus_model_commands command ON command.id=${input.command_id}::uuid
        AND command.school_id=message.school_id AND command.realm_id=message.realm_id
        AND command.environment_namespace_id=message.environment_namespace_id
        AND command.source_domain=previous.source_domain AND command.target_entity_id=previous.subject_entity_id
        AND previous.source_revision=coalesce(${input.previous_source_revision ?? null}::integer,command.expected_revision)
        AND previous.source_revision<=command.expected_revision AND command.causation_id=previous.id
        AND command.correlation_id=previous.correlation_id AND command.correlation_id=message.correlation_id
      JOIN campus_model_entities target ON target.id=command.target_entity_id
        AND target.school_id=command.school_id AND target.realm_id=command.realm_id
        AND target.environment_namespace_id=command.environment_namespace_id
        AND target.domain=command.source_domain AND target.domain_id=previous.source_record_id
      JOIN campus_model_events resulting ON resulting.id=${input.resulting_event_id}::uuid
        AND resulting.school_id=command.school_id AND resulting.realm_id=command.realm_id
        AND resulting.environment_namespace_id=command.environment_namespace_id
        AND resulting.event_kind='domain_event' AND resulting.source_domain=command.source_domain
        AND resulting.subject_entity_id=command.target_entity_id AND resulting.source_record_id=previous.source_record_id
        AND resulting.source_revision=command.expected_revision+1 AND resulting.actor_agent_id=command.actor_agent_id
        AND resulting.correlation_id=command.correlation_id AND resulting.causation_event_id=previous.id
        AND resulting.payload->>'source_command_id'=command.id::text
        AND resulting.event_at=${input.occurred_at}::timestamptz
      JOIN event_outbox source ON source.id=resulting.source_outbox_event_id AND source.school_id=resulting.school_id
        AND source.event_type=resulting.event_type AND source.aggregate_id::text=resulting.source_record_id
      JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
        AND authority.school_id=command.school_id AND authority.realm_id=command.realm_id
        AND authority.environment_namespace_id=command.environment_namespace_id
        AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id
        AND authority.correlation_id=command.correlation_id AND authority.decision='allowed'
        AND authority.capability=${input.required_capability} AND authority.evaluated_at=command.requested_at
        AND authority.evaluated_at<=${input.occurred_at}::timestamptz
        AND (authority.valid_until IS NULL OR authority.valid_until>${now}::timestamptz)
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(authority.authority_source_refs) evidence
          WHERE evidence->>'evaluator_domain'=command.source_domain)
      WHERE message.id=${input.message_id}::uuid AND message.school_id=${input.school_id}::uuid
        AND message.realm_id=${scope.realm_id}::uuid AND message.environment_namespace_id=${scope.environment_namespace_id}
        AND previous.id=${input.previous_event_id}::uuid AND previous.event_kind='domain_event'
        AND ${input.occurred_at}::timestamptz<=${now}::timestamptz
        AND EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(${input.school_id}::uuid,NULL,${now}::timestamptz) endpoint
          WHERE endpoint.agent_id=command.actor_agent_id)
        AND (command.state='pending' OR (command.state='accepted' AND EXISTS(
          SELECT 1 FROM campus_model_command_outcomes outcome WHERE outcome.command_id=command.id
            AND outcome.realm_id=command.realm_id AND outcome.environment_namespace_id=command.environment_namespace_id
            AND outcome.status='accepted' AND outcome.resulting_revision=resulting.source_revision
            AND outcome.domain_event_id=resulting.source_outbox_event_id)))
        AND (${environment?.kind !== "simulation"} OR EXISTS(
          SELECT 1 FROM campus_model_execution_actor_bindings binding
          JOIN campus_model_execution_snapshots snapshot ON snapshot.id=binding.snapshot_id
            AND snapshot.realm_id=binding.realm_id AND snapshot.environment_namespace_id=binding.environment_namespace_id
          WHERE binding.execution_actor_id=authority.execution_actor_id AND binding.source_agent_id=command.actor_agent_id
            AND binding.school_id=command.school_id AND binding.realm_id=command.realm_id
            AND binding.environment_namespace_id=command.environment_namespace_id
            AND binding.actor_mode='simulation_counterpart' AND binding.status='active'
            AND binding.effective_from<=${now}::timestamptz AND (binding.effective_until IS NULL OR binding.effective_until>${now}::timestamptz)
            AND snapshot.source_snapshot_ref=${environment?.source_snapshot_ref ?? null}
            AND binding.authority_snapshot_ref=snapshot.source_snapshot_ref))
      FOR UPDATE OF message,command FOR SHARE OF target`.execute(transaction)).rows[0];
        if (!message)
            throw new ConflictException("The owning-domain supersession lacks a current actor, matching authority, command, or exact accepted source transition in this execution environment.");
        const existing = (await sql `SELECT id,message_id,state,request_hash
      FROM campus_model_operational_message_outcomes WHERE school_id=${input.school_id}::uuid
        AND realm_id=${scope.realm_id}::uuid AND environment_namespace_id=${scope.environment_namespace_id}
        AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
        if (existing) {
            if (existing.message_id !== input.message_id || existing.state !== "cancelled" || existing.request_hash !== requestHash) {
                throw new ConflictException("This message supersession key was already used for a different source transition.");
            }
            return { message_id: input.message_id, reaction_id: message.reaction_id, state: "cancelled", outcome_id: existing.id, replayed: true };
        }
        if (message.command_state !== "pending" || !this.freshlyPreparedDomainCommands.get(transaction)?.has(input.command_id)) {
            throw new ConflictException("A new message supersession requires a freshly authorized command prepared in this owning transaction.");
        }
        if (!["queued", "delivered", "acknowledged"].includes(message.state) || message.current_revision !== message.source_revision) {
            throw new ConflictException("Only open work for the currently accepted source transition may be superseded.");
        }
        return this.retainMessageOutcome(transaction, {
            school_id: input.school_id, message_id: input.message_id, state: "cancelled", actor: null,
            source_outbox_event_id: message.source_outbox_event_id, code: "owning_domain_source_superseded",
            // Structured lineage remains outcome -> resulting typed outbox/event ->
            // source_command_id and message -> reaction -> previous event. Cancellation
            // never occupies the response field reserved for recipient evidence.
            explanation: `Owning-domain command ${input.command_id} superseded event ${input.previous_event_id} with event ${input.resulting_event_id}; no recipient response is implied.`,
            response: null,
            occurred_at: input.occurred_at, idempotency_key: input.idempotency_key,
        }, message, message.actor_agent_id, requestHash);
    }
    async recordMessageOutcome(transaction, rawInput) {
        const input = operationalMessageOutcomeSchema.parse(rawInput);
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const existingOutcome = (await sql `SELECT id,message_id,state,request_hash
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND message_id=${input.message_id}::uuid
        AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
        if (existingOutcome) {
            if (existingOutcome.message_id !== input.message_id || existingOutcome.state !== input.state || existingOutcome.request_hash !== requestHash) {
                throw new ConflictException("This message outcome key was already used for a different result.");
            }
            const reaction = (await sql `SELECT reaction_id FROM campus_model_operational_messages
        WHERE id=${input.message_id}::uuid AND school_id=${input.school_id}::uuid`.execute(transaction)).rows[0];
            if (!reaction)
                throw new ConflictException("The operational message was not found.");
            return {
                message_id: input.message_id,
                reaction_id: reaction.reaction_id,
                state: input.state,
                outcome_id: existingOutcome.id,
                replayed: true,
            };
        }
        const message = (await sql `SELECT message.id,message.reaction_id,message.state,
        message.recipient_agent_id,message.sender_agent_id,message.correlation_id,
        recipient.agent_kind AS recipient_agent_kind,reaction.selector_snapshot
      FROM campus_model_operational_messages message
      JOIN campus_model_agents recipient ON recipient.id=message.recipient_agent_id AND recipient.school_id=message.school_id
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
      WHERE message.id=${input.message_id}::uuid AND message.school_id=${input.school_id}::uuid
      FOR UPDATE OF message`.execute(transaction)).rows[0];
        if (!message)
            throw new ConflictException("The operational message was not found.");
        const concurrentOutcome = (await sql `SELECT id,message_id,state,request_hash
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND message_id=${input.message_id}::uuid
        AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
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
        const allowed = {
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
        let actorAgent = null;
        if (input.actor) {
            actorAgent = await this.resolveAgentReference(transaction, input.school_id, input.actor) ?? null;
            if (!actorAgent)
                throw new ConflictException("The responding agent is not active in this institution.");
            const senderMayCancel = input.state === "cancelled" && actorAgent.id === message.sender_agent_id;
            if (actorAgent.id !== message.recipient_agent_id && !senderMayCancel) {
                throw new ConflictException("Only the assigned recipient may act on this work, except that its original sender may cancel it.");
            }
        }
        if (input.source_outbox_event_id) {
            const source = (await sql `SELECT id FROM event_outbox
        WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
        FOR KEY SHARE`.execute(transaction)).rows[0];
            if (!source)
                throw new ConflictException("The message outcome source event does not belong to this institution.");
        }
        return this.retainMessageOutcome(transaction, input, message, actorAgent?.id ?? null, requestHash);
    }
    async retainMessageOutcome(transaction, input, message, actorAgentId, requestHash) {
        const sequence = (await sql `SELECT COALESCE(max(sequence),0)::int+1 AS sequence
      FROM campus_model_operational_message_outcomes
      WHERE school_id=${input.school_id}::uuid AND message_id=${input.message_id}::uuid`.execute(transaction)).rows[0].sequence;
        const outcome = (await sql `INSERT INTO campus_model_operational_message_outcomes(
        school_id,message_id,sequence,state,actor_agent_id,source_outbox_event_id,code,
        explanation,response,occurred_at,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,${input.message_id}::uuid,${sequence},${input.state},
        ${actorAgentId}::uuid,${input.source_outbox_event_id}::uuid,${input.code},
        ${input.explanation},${input.response ? JSON.stringify(input.response) : null}::jsonb,
        ${input.occurred_at}::timestamptz,${input.idempotency_key},${requestHash}
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!outcome)
            throw new ConflictException("The operational message outcome could not be retained.");
        await sql `UPDATE campus_model_operational_messages SET
        state=${input.state},updated_at=now(),
        delivered_at=CASE WHEN ${input.state}='delivered' THEN ${input.occurred_at}::timestamptz ELSE delivered_at END,
        acknowledged_at=CASE WHEN ${input.state}='acknowledged' THEN ${input.occurred_at}::timestamptz ELSE acknowledged_at END,
        responded_at=CASE WHEN ${input.state}='responded' THEN ${input.occurred_at}::timestamptz ELSE responded_at END,
        expired_at=CASE WHEN ${input.state}='expired' THEN ${input.occurred_at}::timestamptz ELSE expired_at END,
        cancelled_at=CASE WHEN ${input.state}='cancelled' THEN ${input.occurred_at}::timestamptz ELSE cancelled_at END,
        dead_lettered_at=CASE WHEN ${input.state}='dead_letter' THEN ${input.occurred_at}::timestamptz ELSE dead_lettered_at END
      WHERE id=${input.message_id}::uuid AND school_id=${input.school_id}::uuid`.execute(transaction);
        const reactionState = input.state === "responded" ? "completed" : input.state;
        await sql `UPDATE campus_model_reactions SET state=${reactionState},updated_at=now(),
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
    async recentActivity(schoolId, limit = 12) {
        const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
        const environmentNamespaceId = executionNamespaceForSchool(schoolId, this.executionScope?.current());
        return (await sql `
      SELECT * FROM (
        SELECT command.id::text AS id,'setup'::text AS kind,command.command_type AS action,
          target.label AS subject_label,1::int AS item_count,command.state,
          command.requested_at AS occurred_at,actor.label AS actor_label
        FROM campus_model_commands command
        LEFT JOIN campus_model_entities target ON target.id=command.target_entity_id
        JOIN campus_model_agents actor ON actor.id=command.actor_agent_id
        WHERE command.school_id=${schoolId}::uuid
          AND command.environment_namespace_id=${environmentNamespaceId}
          AND command.source_domain='campus_topology'
        UNION ALL
        SELECT observation.source_ref AS id,'attendance'::text AS kind,
          observation.source_type AS action,context.label AS subject_label,
          count(*)::int AS item_count,observation.state,max(observation.received_at) AS occurred_at,
          actor.label AS actor_label
        FROM campus_model_observations observation
        LEFT JOIN campus_model_entities context ON context.id=observation.context_entity_id
        JOIN campus_model_agents actor ON actor.id=observation.captured_by_agent_id
        WHERE observation.school_id=${schoolId}::uuid
          AND observation.environment_namespace_id=${environmentNamespaceId}
          AND observation.source_type IN ('attendance.capture','attendance.daily','attendance.session','attendance.self_check_in')
          AND observation.state IN ('accepted','pending')
        GROUP BY observation.source_ref,observation.source_type,context.label,observation.state,actor.label
        UNION ALL
        SELECT command.id::text AS id,'examination'::text AS kind,command.command_type AS action,
          target.label AS subject_label,1::int AS item_count,command.state,
          command.requested_at AS occurred_at,actor.label AS actor_label
        FROM campus_model_commands command
        LEFT JOIN campus_model_entities target ON target.id=command.target_entity_id
        JOIN campus_model_agents actor ON actor.id=command.actor_agent_id
        WHERE command.school_id=${schoolId}::uuid
          AND command.environment_namespace_id=${environmentNamespaceId}
          AND command.source_domain='assessments'
      ) connected_activity
      ORDER BY occurred_at DESC,id DESC
      LIMIT ${safeLimit}
    `.execute(this.db)).rows;
    }
    async operationalSignals(schoolId, at = executionNow().toISOString(), limit = 20) {
        const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
        const environmentNamespaceId = executionNamespaceForSchool(schoolId, this.executionScope?.current());
        const atInstant = new Date(at);
        if (Number.isNaN(atInstant.getTime()))
            throw new ConflictException("Use a valid instant for campus signals.");
        return (await sql `
      WITH school_clock AS (
        SELECT timezone FROM schools WHERE id=${schoolId}::uuid
      ), accepted_observations AS NOT MATERIALIZED (
        SELECT observation.* FROM campus_model_observations observation
        JOIN LATERAL (
          SELECT history.state FROM campus_model_observation_states history
          WHERE history.observation_id=observation.id AND history.realm_id=observation.realm_id
            AND history.environment_namespace_id=observation.environment_namespace_id
            AND history.recorded_at<=${atInstant.toISOString()}::timestamptz
          ORDER BY history.recorded_at DESC,history.sequence DESC LIMIT 1
        ) history ON history.state='accepted'
        WHERE observation.school_id=${schoolId}::uuid AND observation.environment_namespace_id=${environmentNamespaceId}
          AND observation.observed_at<=${atInstant.toISOString()}::timestamptz
          AND observation.received_at<=${atInstant.toISOString()}::timestamptz
      ), gate_people AS (
        SELECT observation.*,COALESCE(person.id,legacy.person_id) AS person_id
        FROM accepted_observations observation
        JOIN campus_model_entities subject ON subject.id=observation.subject_entity_id
          AND subject.realm_id=observation.realm_id AND subject.environment_namespace_id=observation.environment_namespace_id
        LEFT JOIN school_people person ON subject.domain='people' AND subject.kind='person'
          AND subject.domain_id=person.id::text AND person.school_id=observation.school_id
        LEFT JOIN students legacy ON subject.domain='people' AND subject.kind='student'
          AND subject.domain_id=legacy.id::text AND legacy.school_id=observation.school_id
        WHERE observation.kind='movement.gate_observed' AND COALESCE(person.id,legacy.person_id) IS NOT NULL
      ), latest_gate AS (
        SELECT DISTINCT ON (observation.person_id)
          observation.id,observation.person_id,observation.observed_at,
          observation.payload->>'direction' AS direction,
          COALESCE(NULLIF(observation.payload->>'gate',''),'Campus gate') AS gate_label
        FROM gate_people observation CROSS JOIN school_clock
        WHERE (observation.observed_at AT TIME ZONE school_clock.timezone)::date=
              (${atInstant.toISOString()}::timestamptz AT TIME ZONE school_clock.timezone)::date
        ORDER BY observation.person_id,observation.observed_at DESC,observation.received_at DESC,observation.id DESC
      )
      SELECT concat(occurrence.id::text,':',student.id::text,':',gate.id::text) AS id,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'attendance_after_exit' ELSE 'expected_after_exit' END AS kind,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'important' ELSE 'review' END AS severity,
        CASE WHEN attendance.observation_id IS NOT NULL THEN 'attendance' ELSE 'gate' END AS owner,
        student.id::text AS student_id,trim(concat_ws(' ',person.first_name,person.last_name)) AS person_label,
        class_entity.label AS class_label,occurrence.title AS activity_label,
        gate.gate_label,gate.observed_at AS gate_observed_at,
        occurrence.starts_at AS expected_from,occurrence.ends_at AS expected_until,
        attendance.attendance_status
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
        AND class_entity.realm_id=occurrence.realm_id AND class_entity.environment_namespace_id=occurrence.environment_namespace_id
      JOIN campus_model_entities period ON period.id=occurrence.period_entity_id
        AND period.realm_id=occurrence.realm_id AND period.environment_namespace_id=occurrence.environment_namespace_id
      JOIN enrollments enrollment ON enrollment.class_section_id::text=class_entity.domain_id
        AND enrollment.enrolled_on<=occurrence.occurrence_date
        AND (enrollment.inactive_from>occurrence.occurrence_date OR (enrollment.inactive_from IS NULL AND enrollment.is_active))
      JOIN academic_terms term ON term.id=enrollment.term_id AND occurrence.occurrence_date BETWEEN term.starts_on AND term.ends_on
      JOIN students student ON student.id=enrollment.student_id AND student.school_id=occurrence.school_id
      JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
      JOIN latest_gate gate ON gate.person_id=person.id AND gate.direction='out'
      LEFT JOIN LATERAL (
        SELECT observation.id AS observation_id,observation.payload->>'attendance_status' AS attendance_status
        FROM accepted_observations observation
        JOIN campus_model_entities observed_person ON observed_person.id=observation.subject_entity_id
          AND observed_person.realm_id=observation.realm_id AND observed_person.environment_namespace_id=observation.environment_namespace_id
        WHERE observation.school_id=occurrence.school_id
          AND observation.environment_namespace_id=occurrence.environment_namespace_id
          AND (
            (observation.kind='attendance.participation_observed' AND observed_person.kind='person'
              AND observed_person.domain='people' AND observed_person.domain_id=person.id::text AND EXISTS (
                SELECT 1 FROM activity_attendance_registers register
                JOIN schedule_activity_occurrences academic ON academic.id=register.occurrence_id AND academic.school_id=register.school_id
                JOIN activity_attendance_source_contexts link ON link.register_id=register.id AND link.school_id=register.school_id
                JOIN activity_attendance_academic_roster retained ON retained.register_id=register.id AND retained.school_id=register.school_id
                  AND retained.person_id=person.id AND retained.student_id=student.id
                JOIN campus_model_entities context ON context.id=observation.context_entity_id
                  AND context.realm_id=observation.realm_id AND context.environment_namespace_id=observation.environment_namespace_id
                  AND context.domain='attendance' AND context.kind='attendance_register' AND context.domain_id=register.id::text
                WHERE register.school_id=occurrence.school_id AND link.state='active' AND academic.source='academic'
                  AND academic.context_ref::text=class_entity.domain_id AND academic.term_id=enrollment.term_id
                  AND academic.local_date=occurrence.occurrence_date
                  AND observation.payload->>'register_id'=register.id::text AND observation.payload->>'occurrence_id'=academic.id::text
                  AND ((link.source_kind='daily_class' AND academic.period_id IS NULL)
                    OR (link.source_kind='scheduled_session' AND academic.period_id::text=period.domain_id
                      AND academic.starts_at=occurrence.starts_at AND academic.ends_at=occurrence.ends_at))
              ))
            -- Retained pre-cutover observations keep their original student and
            -- class identifiers. Match their explicit grain, never rewrite them.
            OR (observation.kind='attendance.status_observed' AND observed_person.kind='student'
              AND observed_person.domain='people' AND observed_person.domain_id=student.id::text
              AND observation.context_entity_id=occurrence.class_entity_id
              AND observation.payload->>'attendance_date'=occurrence.occurrence_date::text
              AND ((observation.source_type IN ('attendance.daily','attendance.capture') AND observation.payload->>'session_id' IS NULL)
                OR (observation.source_type IN ('attendance.session','attendance.self_check_in','attendance.capture') AND EXISTS (
                  SELECT 1 FROM attendance_session_registers session WHERE session.school_id=occurrence.school_id
                    AND session.id::text=observation.payload->>'session_id' AND session.class_section_id::text=class_entity.domain_id
                    AND session.term_id=enrollment.term_id AND session.session_date=occurrence.occurrence_date
                    AND session.schedule_slot_id::text=period.domain_id
                ))))
          )
          AND observation.observed_at>=gate.observed_at
          AND observation.observed_at<=${atInstant.toISOString()}::timestamptz
          AND observation.received_at<=${atInstant.toISOString()}::timestamptz
          AND observation.observed_at<occurrence.ends_at
          AND observation.payload->>'attendance_status' IN ('present','late')
        ORDER BY observation.observed_at DESC,observation.received_at DESC LIMIT 1
      ) attendance ON true
      WHERE occurrence.school_id=${schoolId}::uuid
        AND occurrence.environment_namespace_id=${environmentNamespaceId}
        AND occurrence.state='expected'
        AND occurrence.recorded_from<=${atInstant.toISOString()}::timestamptz
        AND occurrence.claim_kind='exclusive'
        AND (occurrence.recorded_until IS NULL OR occurrence.recorded_until>${atInstant.toISOString()}::timestamptz)
        AND occurrence.starts_at<=${atInstant.toISOString()}::timestamptz
        AND occurrence.ends_at>${atInstant.toISOString()}::timestamptz
      ORDER BY CASE WHEN attendance.observation_id IS NOT NULL THEN 0 ELSE 1 END,
        occurrence.starts_at,person.first_name,person.last_name,student.id
      LIMIT ${safeLimit}
    `.execute(this.db)).rows;
    }
    async recordPlanOccurrences(transaction, rawInput) {
        const input = planOccurrenceProjectionSchema.parse(rawInput);
        return this.projectPlanOccurrences(transaction, input);
    }
    async extendPlanOccurrences(transaction, rawInput) {
        return this.projectPlanOccurrences(transaction, planOccurrenceExtensionSchema.parse(rawInput));
    }
    async projectPlanOccurrences(transaction, input) {
        const scope = await this.resolveScope(transaction, input.school_id);
        const basisEventId = "basis_event_id" in input ? input.basis_event_id : null;
        if (basisEventId) {
            const basis = (await sql `SELECT id FROM campus_model_events
        WHERE id=${basisEventId}::uuid AND school_id=${input.school_id}::uuid
          AND realm_id=${scope.realm_id}::uuid AND environment_namespace_id=${scope.environment_namespace_id}
          AND source_domain=${input.plan.domain} AND source_record_id=${input.plan.domain_id}
          AND source_revision=${input.source_revision} AND event_kind='plan' AND actor_agent_id IS NOT NULL
          AND provenance->>'adapter'='neutral-plan-occurrence' AND event_type LIKE '%published'
        FOR SHARE`.execute(transaction)).rows[0];
            if (!basis)
                throw new ConflictException("Materialization requires the exact accepted publication in this environment.");
        }
        const semanticInput = { ...input, correlation_id: undefined, causation_event_id: undefined };
        const requestHash = createHash("sha256").update(JSON.stringify(semanticInput)).digest("hex");
        const identity = [input.plan.domain, input.plan.domain_id, input.source_revision,
            input.event_type, input.horizon.from, input.horizon.until].join(":");
        const idempotencyKey = `plan-occurrences:${createHash("sha256").update(identity).digest("hex")}`;
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(
      ${`neutral-plan:${scope.realm_id}:${scope.environment_namespace_id}:${input.plan.domain}:${input.plan.domain_id}`},0))`.execute(transaction);
        const actor = "actor_user_id" in input ? await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id) : null;
        const plan = await this.upsertEntity(transaction, input.school_id, input.plan, scope);
        const inserted = (await sql `INSERT INTO campus_model_events(
      school_id,realm_id,environment_namespace_id,event_kind,event_type,subject_entity_id,actor_agent_id,
      source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
      correlation_id,causation_event_id,provenance,payload,schema_version,idempotency_key,request_hash
    ) VALUES (
      ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},'plan',${input.event_type},
      ${plan.id}::uuid,${actor?.id ?? null}::uuid,${input.plan.domain},${input.plan.domain_id},${input.source_revision},
      ${input.occurred_at}::timestamptz,${input.horizon.from}::timestamptz,${input.horizon.until}::timestamptz,
      ${input.correlation_id}::uuid,${basisEventId ?? input.causation_event_id}::uuid,
      ${JSON.stringify({ adapter: "neutral-plan-occurrence", version: 1, source_revision: input.source_revision,
            ...(basisEventId ? { basis_event_id: basisEventId, authority_provenance: "accepted_publication", materialization_only: true } : {}) })}::jsonb,
      ${JSON.stringify({ occurrence_count: input.occurrences.length, horizon: input.horizon })}::jsonb,
      1,${idempotencyKey},${requestHash}
    ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence
      FROM campus_model_events WHERE realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id} AND idempotency_key=${idempotencyKey}`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash)
            throw new ConflictException("This plan projection key already records different source evidence.");
        if (!inserted)
            return { event_id: event.id, schedule_entity_id: plan.id, occurrence_count: input.occurrences.length, replayed: true };
        const entityCache = new Map();
        const resolveEntity = async (snapshot) => {
            const key = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
            const cached = entityCache.get(key);
            if (cached)
                return cached;
            const entity = await this.upsertEntity(transaction, input.school_id, snapshot, scope);
            entityCache.set(key, entity);
            return entity;
        };
        let occurrenceCount = 0;
        for (const occurrence of input.occurrences) {
            const logicalKey = createHash("sha256").update(`${input.school_id}:${input.plan.domain}:${occurrence.occurrence_key}`).digest("hex");
            const projectionHash = createHash("sha256").update(JSON.stringify({ ...occurrence,
                plan: { domain: input.plan.domain, domain_id: input.plan.domain_id }, source_revision: input.source_revision })).digest("hex");
            const previous = (await sql `
        SELECT occurrence.id,occurrence.projection_hash,occurrence.source_revision,occurrence.recorded_from,
          occurrence.schedule_entity_id,occurrence.basis_event_id,plan.domain AS plan_domain,plan.domain_id AS plan_domain_id,occurrence.claim_kind
        FROM campus_model_schedule_occurrences occurrence JOIN campus_model_entities plan ON plan.id=occurrence.schedule_entity_id
          AND plan.realm_id=occurrence.realm_id AND plan.environment_namespace_id=occurrence.environment_namespace_id
        WHERE occurrence.realm_id=${scope.realm_id}::uuid AND occurrence.environment_namespace_id=${scope.environment_namespace_id}
          AND occurrence.logical_occurrence_key=${logicalKey} AND occurrence.recorded_until IS NULL FOR UPDATE OF occurrence`.execute(transaction)).rows[0];
            if (previous?.projection_hash === projectionHash)
                continue;
            if (previous && previous.claim_kind !== (occurrence.claim_kind ?? "exclusive")) {
                throw new ConflictException("Availability and exclusive scheduling are different claims; one cannot silently replace the other.");
            }
            if (previous && basisEventId)
                throw new ConflictException("Materialization cannot replace an existing occurrence; publish a dated plan change.");
            const changingPlan = previous && previous.schedule_entity_id !== plan.id;
            if (previous && (changingPlan
                ? !input.supersedes_plan || input.supersedes_plan.domain !== previous.plan_domain
                    || input.supersedes_plan.domain_id !== previous.plan_domain_id || input.supersedes_plan.source_revision !== previous.source_revision
                : previous.source_revision >= input.source_revision)) {
                throw new ConflictException("An occurrence requires a later source revision or an exact declared plan supersession.");
            }
            const occurrenceEntity = await resolveEntity(occurrence.occurrence);
            const context = occurrence.context ? await resolveEntity(occurrence.context) : null;
            const resources = [];
            for (const resource of occurrence.resources)
                resources.push(await resolveEntity(resource));
            const transitionAt = previous
                ? new Date(Math.max(new Date(event.recorded_at).getTime(), new Date(previous.recorded_from).getTime() + 1)).toISOString()
                : new Date(event.recorded_at).toISOString();
            if (previous)
                await sql `UPDATE campus_model_schedule_occurrences
        SET recorded_until=${transitionAt}::timestamptz,projected_at=${transitionAt}::timestamptz
        WHERE id=${previous.id}::uuid AND realm_id=${scope.realm_id}::uuid
          AND environment_namespace_id=${scope.environment_namespace_id} AND recorded_until IS NULL`.execute(transaction);
            const projected = (await sql `INSERT INTO campus_model_schedule_occurrences(
        school_id,realm_id,environment_namespace_id,source_event_id,schedule_entity_id,period_entity_id,
        class_entity_id,subject_entity_id,responsible_agent_id,space_entity_id,context_entity_id,time_zone,
        occurrence_date,starts_at,ends_at,title,slot_type,room_snapshot,state,source_revision,
        logical_occurrence_key,period_number,basis_event_id,change_event_id,recorded_from,claim_kind,
        supersedes_occurrence_id,change_kind,projection_hash
      ) VALUES (
        ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},${event.id}::uuid,
        ${plan.id}::uuid,${occurrenceEntity.id}::uuid,NULL,NULL,NULL,${resources[0]?.id ?? null}::uuid,
        ${context?.id ?? null}::uuid,${occurrence.time_zone},${occurrence.local_date}::date,
        ${occurrence.starts_at}::timestamptz,${occurrence.ends_at}::timestamptz,${occurrence.occurrence.label.slice(0, 120)},
        'activity','',${occurrence.state},${input.source_revision},${logicalKey},NULL,
        ${basisEventId ?? previous?.basis_event_id ?? event.id}::uuid,${event.id}::uuid,${transitionAt}::timestamptz,${occurrence.claim_kind ?? "exclusive"},${previous?.id ?? null}::uuid,
        ${previous ? "source_changed" : "published"},${projectionHash}
      ) RETURNING id`.execute(transaction)).rows[0];
            const participants = [];
            for (const participant of occurrence.participants)
                participants.push({
                    participant_entity_id: (await resolveEntity(participant.person)).id, role: participant.role,
                    required: participant.required, source_ref: participant.source_ref, source_revision: participant.source_revision,
                });
            if (participants.length)
                await sql `INSERT INTO campus_model_occurrence_participants(
          school_id,realm_id,environment_namespace_id,occurrence_id,participant_entity_id,role,required,source_ref,source_revision
        ) SELECT ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
          ${projected.id}::uuid,participant.participant_entity_id,participant.role,participant.required,participant.source_ref,participant.source_revision
        FROM jsonb_to_recordset(${JSON.stringify(participants)}::jsonb) participant(
          participant_entity_id uuid,role text,required boolean,source_ref text,source_revision integer)`.execute(transaction);
            if (resources.length)
                await sql `INSERT INTO campus_model_occurrence_resources(
        school_id,realm_id,environment_namespace_id,occurrence_id,resource_entity_id
      ) SELECT ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},${projected.id}::uuid,resource.id
        FROM unnest(${resources.map(resource => resource.id)}::uuid[]) resource(id)
        ON CONFLICT DO NOTHING`.execute(transaction);
            occurrenceCount++;
        }
        return { event_id: event.id, schedule_entity_id: plan.id, occurrence_count: occurrenceCount, replayed: false };
    }
    async recordPublishedSchedule(transaction, rawInput) {
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
        const inserted = (await sql `INSERT INTO campus_model_events(
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
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${schedule.id}::uuid
        AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This timetable publication key was already used for different plan evidence.");
        }
        if (!inserted) {
            const existing = (await sql `SELECT count(*)::int AS count
        FROM campus_model_schedule_occurrences WHERE school_id=${input.school_id}::uuid
          AND basis_event_id=${event.id}::uuid
          AND change_event_id=${event.id}::uuid`.execute(transaction)).rows[0]?.count ?? 0;
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
            const result = await sql `WITH candidates AS MATERIALIZED (
          SELECT day::date AS occurrence_date,
            encode(digest(concat_ws(':',${input.school_id}::text,${input.class_section.domain_id}::text,
              day::date::text,${period.period_number}::text),'sha256'),'hex') AS occurrence_key,
            EXISTS(SELECT 1 FROM school_calendar_days closure
              WHERE closure.school_id=${input.school_id}::uuid AND closure.date=day::date
                AND NOT closure.is_instructional) AS closed,
            (SELECT closure_event.id
              FROM campus_model_events closure_event
              WHERE closure_event.school_id=${input.school_id}::uuid
                AND closure_event.event_type='calendar.closure_created'
                AND closure_event.payload->'dates' ? day::date::text
              ORDER BY closure_event.recorded_at DESC,closure_event.journal_sequence DESC
              LIMIT 1) AS closure_event_id
          FROM generate_series(${input.starts_on}::date,${input.ends_on}::date,'1 day') day
          WHERE extract(isodow FROM day)=${period.weekday}
            AND NOT EXISTS(
              SELECT 1 FROM day_plans plan
              WHERE plan.school_id=${input.school_id}::uuid
                AND plan.class_section_id=${input.class_section.domain_id}::uuid
                AND plan.date=day::date AND plan.published_version IS NOT NULL
            )
        ), closed AS (
          UPDATE campus_model_schedule_occurrences occurrence SET
            recorded_until=GREATEST(${event.recorded_at}::timestamptz,
              occurrence.recorded_from+interval '1 microsecond'),
            projected_at=GREATEST(${event.recorded_at}::timestamptz,
              occurrence.recorded_from+interval '1 microsecond')
          FROM candidates
          WHERE occurrence.school_id=${input.school_id}::uuid
            AND occurrence.logical_occurrence_key=candidates.occurrence_key
            AND occurrence.recorded_until IS NULL
          RETURNING occurrence.id,occurrence.logical_occurrence_key,
            occurrence.recorded_until AS transition_at
        )
        INSERT INTO campus_model_schedule_occurrences(
          school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
          subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
          title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
          basis_event_id,change_event_id,condition_event_id,recorded_from,
          supersedes_occurrence_id,change_kind
        )
        SELECT ${input.school_id}::uuid,${event.id}::uuid,${schedule.id}::uuid,${periodEntity.id}::uuid,
          ${classEntity.id}::uuid,${subjectEntity?.id ?? null}::uuid,${responsibleAgent?.id ?? null}::uuid,
          ${spaceEntity?.id ?? null}::uuid,candidates.occurrence_date,
          ((candidates.occurrence_date+${period.starts_at}::time) AT TIME ZONE ${input.timezone}),
          ((candidates.occurrence_date+${period.ends_at}::time) AT TIME ZONE ${input.timezone}),
          ${period.title},${period.slot_type},${period.room_snapshot},
          CASE WHEN candidates.closed THEN 'cancelled' ELSE 'expected' END,
          ${input.schedule_revision},candidates.occurrence_key,${period.period_number},
          ${event.id}::uuid,${event.id}::uuid,
          CASE WHEN candidates.closed THEN candidates.closure_event_id ELSE NULL::uuid END,
          COALESCE(closed.transition_at,${event.recorded_at}::timestamptz),closed.id,
          CASE WHEN candidates.closed THEN 'closure_cancelled' ELSE 'published' END
        FROM candidates
        LEFT JOIN closed ON closed.logical_occurrence_key=candidates.occurrence_key
        ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
        RETURNING id`.execute(transaction);
            occurrenceCount += result.rows.length;
        }
        return { event_id: event.id, schedule_entity_id: schedule.id, occurrence_count: occurrenceCount, replayed: false };
    }
    async recordLegacyTimetableSlotChange(transaction, rawInput) {
        const input = legacyTimetableSlotChangeProjectionSchema.parse(rawInput);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(
      'campus-schedule-occurrence:'||${input.school_id}::text,0
    ))`.execute(transaction);
        const retainedSlot = (await sql `SELECT EXISTS(
        SELECT 1
        FROM timetable_slots slot
        JOIN class_sections section ON section.id=slot.class_section_id
        JOIN academic_terms term ON term.id=slot.term_id
        LEFT JOIN subjects subject
          ON subject.id=slot.subject_id AND subject.school_id=section.school_id
        WHERE slot.id=${input.source_record_id}::uuid
          AND section.school_id=${input.school_id}::uuid
          AND term.school_id=${input.school_id}::uuid
          AND slot.revision=${input.source_revision}
          AND slot.term_id=${input.term_id}::uuid
          AND slot.class_section_id=${input.class_section.domain_id}::uuid
          AND slot.weekday=${input.slot.weekday}
          AND slot.period_number=${input.slot.period_number}
          AND slot.starts_at=${input.slot.starts_at}::time
          AND slot.ends_at=${input.slot.ends_at}::time
          AND slot.slot_type=${input.slot.slot_type}
          AND COALESCE(subject.name,NULLIF(trim(slot.title),''),'Period')=${input.slot.title}
          AND slot.room=${input.slot.room_snapshot}
          AND slot.teacher_user_id IS NOT DISTINCT FROM ${input.slot.teacher_user_id}::uuid
          AND slot.subject_id IS NOT DISTINCT FROM ${input.slot.subject?.domain_id ?? null}::uuid
          AND slot.space_id IS NOT DISTINCT FROM ${input.slot.space?.domain_id ?? null}::uuid
          AND term.starts_on=${input.starts_on}::date
          AND term.ends_on=${input.ends_on}::date
      ) AS exact`.execute(transaction)).rows[0]?.exact ?? false;
        if (input.action === "deleted" ? retainedSlot : !retainedSlot) {
            throw new ConflictException(input.action === "deleted"
                ? "The deleted legacy timetable source still exists."
                : "The legacy timetable projection does not match its authoritative source revision.");
        }
        const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        const schedule = await this.upsertEntity(transaction, input.school_id, {
            kind: "schedule",
            domain: "timetable",
            domain_id: `legacy:${input.source_record_id}`,
            label: `${input.class_section.label} recurring ${input.slot.title}`,
            lifecycle_state: input.action === "deleted" ? "retired" : "active",
            source_revision: input.source_revision,
            metadata: {
                term_id: input.term_id,
                starts_on: input.starts_on,
                ends_on: input.ends_on,
                timezone: input.timezone,
                source_kind: "legacy_timetable",
            },
        });
        const classEntity = await this.upsertEntity(transaction, input.school_id, input.class_section);
        const period = await this.upsertEntity(transaction, input.school_id, {
            kind: "schedule_period",
            domain: "timetable",
            domain_id: input.source_record_id,
            label: input.slot.title,
            lifecycle_state: input.action === "deleted" ? "retired" : "active",
            source_revision: input.source_revision,
            metadata: {
                weekday: input.slot.weekday,
                period_number: input.slot.period_number,
                slot_type: input.slot.slot_type,
                source_kind: "legacy_timetable",
            },
        });
        const subject = input.slot.subject
            ? await this.upsertEntity(transaction, input.school_id, input.slot.subject)
            : null;
        const space = input.slot.space
            ? await this.upsertEntity(transaction, input.school_id, input.slot.space)
            : null;
        const teacher = input.action !== "deleted" && input.slot.teacher_user_id
            ? await this.ensureHumanAgent(transaction, input.school_id, input.slot.teacher_user_id)
            : null;
        const eventType = `timetable.legacy_slot_${input.action}`;
        const idempotencyKey = `${eventType}:${input.source_record_id}:${input.source_revision}`;
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const inserted = (await sql `INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
      ) VALUES(
        ${input.school_id}::uuid,'plan',${eventType},${schedule.id}::uuid,${classEntity.id}::uuid,
        ${actor.id}::uuid,'timetable',${input.source_record_id},${input.source_revision},
        ${input.occurred_at}::timestamptz,
        (${input.starts_on}::date::timestamp AT TIME ZONE ${input.timezone}),
        ((${input.ends_on}::date+1)::timestamp AT TIME ZONE ${input.timezone}),
        ${input.correlation_id}::uuid,
        ${JSON.stringify({ source: "timetable_slots", captured_by: "school-timetable" })}::jsonb,
        ${JSON.stringify({
            action: input.action,
            term_id: input.term_id,
            class_section_id: input.class_section.domain_id,
            previous_source_revision: input.previous_source_revision,
            slot: input.slot,
        })}::jsonb,
        1,${idempotencyKey},${requestHash}
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT
        id,request_hash,recorded_at,journal_sequence
      FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${schedule.id}::uuid
        AND idempotency_key=${idempotencyKey}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This legacy timetable source revision was already projected with different evidence.");
        }
        if (!inserted) {
            const existing = (await sql `SELECT count(*)::int AS count
        FROM campus_model_schedule_occurrences
        WHERE school_id=${input.school_id}::uuid AND change_event_id=${event.id}::uuid`
                .execute(transaction)).rows[0]?.count ?? 0;
            return {
                event_id: event.id,
                affected_occurrence_count: existing,
                replacement_occurrence_count: existing,
                replayed: true,
            };
        }
        const retired = await sql `WITH candidates AS MATERIALIZED (
        SELECT day::date AS occurrence_date,
          encode(digest(concat_ws(':',${input.school_id}::text,
            ${input.class_section.domain_id}::text,day::date::text,
            ${input.slot.period_number}::int::text),'sha256'),'hex') AS occurrence_key
        FROM generate_series(${input.starts_on}::date,${input.ends_on}::date,'1 day') day
        WHERE ${input.action}::text<>'deleted'
          AND extract(isodow FROM day)=${input.slot.weekday}::int
          AND NOT EXISTS(
            SELECT 1 FROM day_plans plan
            WHERE plan.school_id=${input.school_id}::uuid
              AND plan.class_section_id=${input.class_section.domain_id}::uuid
              AND plan.date=day::date AND plan.published_version IS NOT NULL
          )
          AND NOT EXISTS(
            SELECT 1 FROM schedule_versions version
            WHERE version.school_id=${input.school_id}::uuid
              AND version.class_section_id=${input.class_section.domain_id}::uuid
              AND version.term_id=${input.term_id}::uuid
              AND version.state='published'
              AND day::date BETWEEN version.starts_on AND version.ends_on
          )
      ), closed AS (
        UPDATE campus_model_schedule_occurrences occurrence SET
          recorded_until=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond'),
          projected_at=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond')
        FROM campus_model_events basis
        WHERE occurrence.school_id=${input.school_id}::uuid
          AND occurrence.recorded_until IS NULL
          AND basis.id=occurrence.basis_event_id
          AND basis.school_id=occurrence.school_id
          AND basis.source_domain='timetable'
          AND basis.source_record_id=${input.source_record_id}
          AND NOT EXISTS(
            SELECT 1 FROM candidates
            WHERE candidates.occurrence_key=occurrence.logical_occurrence_key
          )
        RETURNING occurrence.*
      )
      INSERT INTO campus_model_schedule_occurrences(
        school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
        subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
        title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
        basis_event_id,change_event_id,condition_event_id,recorded_from,
        supersedes_occurrence_id,change_kind
      ) SELECT
        closed.school_id,closed.source_event_id,closed.schedule_entity_id,closed.period_entity_id,
        closed.class_entity_id,closed.subject_entity_id,closed.responsible_agent_id,
        closed.space_entity_id,closed.occurrence_date,closed.starts_at,closed.ends_at,
        closed.title,closed.slot_type,closed.room_snapshot,'cancelled',closed.source_revision,
        closed.logical_occurrence_key,closed.period_number,closed.basis_event_id,${event.id}::uuid,
        closed.condition_event_id,closed.recorded_until,closed.id,
        CASE WHEN ${input.action}::text='deleted' THEN 'source_removed' ELSE 'source_changed' END
      FROM closed
      ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
      RETURNING id`.execute(transaction);
        let projectedCount = 0;
        if (input.action !== "deleted") {
            const projected = await sql `WITH candidates AS MATERIALIZED (
          SELECT day::date AS occurrence_date,
            encode(digest(concat_ws(':',${input.school_id}::text,
              ${input.class_section.domain_id}::text,day::date::text,
              ${input.slot.period_number}::int::text),'sha256'),'hex') AS occurrence_key,
            EXISTS(
              SELECT 1 FROM school_calendar_days closure
              WHERE closure.school_id=${input.school_id}::uuid
                AND closure.date=day::date AND NOT closure.is_instructional
            ) AS closed,
            (
              SELECT closure_event.id
              FROM campus_model_events closure_event
              WHERE closure_event.school_id=${input.school_id}::uuid
                AND closure_event.event_type='calendar.closure_created'
                AND closure_event.payload->'dates' ? day::date::text
              ORDER BY closure_event.recorded_at DESC,closure_event.journal_sequence DESC
              LIMIT 1
            ) AS closure_event_id
          FROM generate_series(${input.starts_on}::date,${input.ends_on}::date,'1 day') day
          WHERE extract(isodow FROM day)=${input.slot.weekday}::int
            AND NOT EXISTS(
              SELECT 1 FROM day_plans plan
              WHERE plan.school_id=${input.school_id}::uuid
                AND plan.class_section_id=${input.class_section.domain_id}::uuid
                AND plan.date=day::date AND plan.published_version IS NOT NULL
            )
            AND NOT EXISTS(
              SELECT 1 FROM schedule_versions version
              WHERE version.school_id=${input.school_id}::uuid
                AND version.class_section_id=${input.class_section.domain_id}::uuid
                AND version.term_id=${input.term_id}::uuid
                AND version.state='published'
                AND day::date BETWEEN version.starts_on AND version.ends_on
            )
        ), closed AS (
          UPDATE campus_model_schedule_occurrences occurrence SET
            recorded_until=GREATEST(${event.recorded_at}::timestamptz,
              occurrence.recorded_from+interval '1 microsecond'),
            projected_at=GREATEST(${event.recorded_at}::timestamptz,
              occurrence.recorded_from+interval '1 microsecond')
          FROM candidates
          WHERE occurrence.school_id=${input.school_id}::uuid
            AND occurrence.logical_occurrence_key=candidates.occurrence_key
            AND occurrence.recorded_until IS NULL
          RETURNING occurrence.id,occurrence.logical_occurrence_key,
            occurrence.recorded_until AS transition_at
        )
        INSERT INTO campus_model_schedule_occurrences(
          school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
          subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
          title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
          basis_event_id,change_event_id,condition_event_id,recorded_from,
          supersedes_occurrence_id,change_kind
        ) SELECT
          ${input.school_id}::uuid,${event.id}::uuid,${schedule.id}::uuid,${period.id}::uuid,
          ${classEntity.id}::uuid,${subject?.id ?? null}::uuid,${teacher?.id ?? null}::uuid,
          ${space?.id ?? null}::uuid,candidates.occurrence_date,
          ((candidates.occurrence_date+${input.slot.starts_at}::time) AT TIME ZONE ${input.timezone}),
          ((candidates.occurrence_date+${input.slot.ends_at}::time) AT TIME ZONE ${input.timezone}),
          ${input.slot.title},${input.slot.slot_type},${input.slot.room_snapshot},
          CASE WHEN candidates.closed THEN 'cancelled' ELSE 'expected' END,
          ${input.source_revision},candidates.occurrence_key,${input.slot.period_number},
          ${event.id}::uuid,${event.id}::uuid,
          CASE WHEN candidates.closed THEN candidates.closure_event_id ELSE NULL::uuid END,
          COALESCE(closed.transition_at,${event.recorded_at}::timestamptz),closed.id,
          CASE
            WHEN candidates.closed THEN 'closure_cancelled'
            WHEN ${input.action}='created' THEN 'published'
            ELSE 'source_changed'
          END
        FROM candidates
        LEFT JOIN closed ON closed.logical_occurrence_key=candidates.occurrence_key
        ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
        RETURNING id`.execute(transaction);
            projectedCount = projected.rows.length;
        }
        return {
            event_id: event.id,
            affected_occurrence_count: retired.rows.length + projectedCount,
            replacement_occurrence_count: retired.rows.length + projectedCount,
            replayed: false,
        };
    }
    async recordCalendarClosure(transaction, rawInput) {
        const input = calendarClosureProjectionSchema.parse(rawInput);
        const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        const institution = await this.upsertEntity(transaction, input.school_id, input.institution);
        const eventType = input.action === "created" ? "calendar.closure_created" : "calendar.closure_removed";
        const idempotencyKey = `${eventType}:${input.source_record_id}:${input.source_revision}`;
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const firstDate = [...input.dates].sort()[0];
        const lastDate = [...input.dates].sort().at(-1);
        const inserted = (await sql `INSERT INTO campus_model_events(
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
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${institution.id}::uuid
        AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This calendar event key was already used for different plan evidence.");
        }
        if (!inserted) {
            const existing = (await sql `SELECT count(*)::int AS count
        FROM campus_model_schedule_occurrences
        WHERE school_id=${input.school_id}::uuid AND change_event_id=${event.id}::uuid`.execute(transaction)).rows[0]?.count ?? 0;
            return { event_id: event.id, affected_occurrence_count: existing, replacement_occurrence_count: existing, replayed: true };
        }
        const nextState = input.action === "created" ? "cancelled" : "expected";
        const nextChange = input.action === "created" ? "closure_cancelled" : "closure_restored";
        const priorState = input.action === "created" ? "expected" : "cancelled";
        const update = await sql `WITH closed AS (
        UPDATE campus_model_schedule_occurrences occurrence SET
          recorded_until=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond'),
          projected_at=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond')
        WHERE occurrence.school_id=${input.school_id}::uuid
          AND occurrence.occurrence_date=ANY(${input.dates}::date[])
          AND occurrence.recorded_until IS NULL AND occurrence.state=${priorState}
          AND (${input.action}='created' OR occurrence.change_kind='closure_cancelled')
          AND (${input.action}='created' OR NOT EXISTS(
            SELECT 1 FROM school_calendar_days closure
            WHERE closure.school_id=occurrence.school_id
              AND closure.date=occurrence.occurrence_date AND NOT closure.is_instructional
          ))
        RETURNING occurrence.*
      )
      INSERT INTO campus_model_schedule_occurrences(
        school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
        subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
        title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
        basis_event_id,change_event_id,condition_event_id,recorded_from,
        supersedes_occurrence_id,change_kind
      )
      SELECT closed.school_id,closed.source_event_id,closed.schedule_entity_id,closed.period_entity_id,
        closed.class_entity_id,closed.subject_entity_id,
        CASE
          WHEN ${input.action}='removed'
            AND cancellation.id IS NOT NULL
            AND cancellation.payload->>'successor_assignment'='original_teacher'
          THEN (accepted_change.payload->>'original_teacher_agent_id')::uuid
          WHEN ${input.action}='removed' AND cancellation.id IS NOT NULL
          THEN NULL::uuid
          WHEN ${input.action}='removed' AND accepted_change.id IS NOT NULL
          THEN (accepted_change.payload->>'replacement_teacher_agent_id')::uuid
          ELSE closed.responsible_agent_id
        END,
        closed.space_entity_id,
        closed.occurrence_date,closed.starts_at,closed.ends_at,closed.title,closed.slot_type,
        closed.room_snapshot,${nextState},closed.source_revision,closed.logical_occurrence_key,
        closed.period_number,closed.basis_event_id,${event.id}::uuid,
        CASE WHEN ${input.action}='created' THEN ${event.id}::uuid ELSE NULL::uuid END,
        closed.recorded_until,
        closed.id,${nextChange}
      FROM closed
      LEFT JOIN campus_model_events basis_change
        ON basis_change.school_id=closed.school_id
        AND basis_change.id=closed.basis_event_id
      LEFT JOIN LATERAL (
        SELECT accepted.*
        FROM campus_model_events accepted
        WHERE ${input.action}='removed'
          AND accepted.school_id=closed.school_id
          AND accepted.event_type='timetable.substitution_effective'
          AND accepted.journal_sequence>basis_change.journal_sequence
          AND accepted.journal_sequence<=${event.journal_sequence}::bigint
          AND accepted.payload->>'occurrence_key'=closed.logical_occurrence_key
          AND accepted.payload->>'source_record_id'=basis_change.source_record_id
          AND accepted.payload->>'source_revision'=basis_change.source_revision::text
          AND accepted.effective_from=closed.starts_at
          AND accepted.effective_until=closed.ends_at
        ORDER BY accepted.journal_sequence DESC
        LIMIT 1
      ) accepted_change ON basis_change.id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT cancelled.id,cancelled.payload
        FROM campus_model_events cancelled
        WHERE ${input.action}='removed'
          AND cancelled.school_id=closed.school_id
          AND cancelled.event_type='timetable.substitution_cancelled'
          AND cancelled.causation_event_id=accepted_change.id
          AND cancelled.journal_sequence>accepted_change.journal_sequence
          AND cancelled.journal_sequence<=${event.journal_sequence}::bigint
        ORDER BY cancelled.journal_sequence DESC
        LIMIT 1
      ) cancellation ON accepted_change.id IS NOT NULL
      ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
      RETURNING id`.execute(transaction);
        return {
            event_id: event.id,
            affected_occurrence_count: update.rows.length,
            replacement_occurrence_count: update.rows.length,
            replayed: false,
        };
    }
    async recordPublishedDayPlan(transaction, rawInput) {
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
        const inserted = (await sql `INSERT INTO campus_model_events(
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
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${planEntity.id}::uuid
        AND idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This daily-plan event key was already used for different plan evidence.");
        }
        if (!inserted) {
            const existing = (await sql `SELECT count(*)::int AS count FROM campus_model_schedule_occurrences
        WHERE school_id=${input.school_id}::uuid AND basis_event_id=${event.id}::uuid
          AND change_event_id=${event.id}::uuid`.execute(transaction)).rows[0]?.count ?? 0;
            return { event_id: event.id, affected_occurrence_count: 0, replacement_occurrence_count: existing, replayed: true };
        }
        const superseded = await sql `UPDATE campus_model_schedule_occurrences occurrence SET
        recorded_until=GREATEST(${event.recorded_at}::timestamptz,
          occurrence.recorded_from+interval '1 microsecond'),
        projected_at=GREATEST(${event.recorded_at}::timestamptz,
          occurrence.recorded_from+interval '1 microsecond')
      WHERE school_id=${input.school_id}::uuid AND class_entity_id=${classEntity.id}::uuid
        AND occurrence_date=${input.date}::date AND recorded_until IS NULL
      RETURNING id,logical_occurrence_key,recorded_until`.execute(transaction);
        const supersededByKey = new Map(superseded.rows.map((row) => [row.logical_occurrence_key, row]));
        const closure = (await sql `SELECT
        EXISTS(SELECT 1 FROM school_calendar_days closure
          WHERE closure.school_id=${input.school_id}::uuid AND closure.date=${input.date}::date
            AND NOT closure.is_instructional) AS closed,
        (SELECT closure_event.id::text
          FROM campus_model_events closure_event
          WHERE closure_event.school_id=${input.school_id}::uuid
            AND closure_event.event_type='calendar.closure_created'
            AND closure_event.payload->'dates' ? ${input.date}
          ORDER BY closure_event.recorded_at DESC,closure_event.journal_sequence DESC
          LIMIT 1) AS event_id`.execute(transaction)).rows[0] ?? { closed: false, event_id: null };
        const closureExists = closure.closed;
        let replacements = 0;
        for (const period of input.periods) {
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
            const logicalOccurrenceKey = createHash("sha256").update([
                input.school_id,
                input.class_section.domain_id,
                input.date,
                String(period.period_number),
            ].join(":")).digest("hex");
            const previous = supersededByKey.get(logicalOccurrenceKey);
            const state = period.cancelled || closureExists ? "cancelled" : "expected";
            const changeKind = period.cancelled
                ? "day_plan_cancelled"
                : closureExists
                    ? "closure_cancelled"
                    : "overridden";
            const result = await sql `INSERT INTO campus_model_schedule_occurrences(
          school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
          subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
          title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
          basis_event_id,change_event_id,condition_event_id,recorded_from,
          supersedes_occurrence_id,change_kind
        ) VALUES (
          ${input.school_id}::uuid,${event.id}::uuid,${planEntity.id}::uuid,${periodEntity.id}::uuid,
          ${classEntity.id}::uuid,${subjectEntity?.id ?? null}::uuid,${responsibleAgent?.id ?? null}::uuid,
          ${spaceEntity?.id ?? null}::uuid,${input.date}::date,
          ((${input.date}::date+${period.starts_at}::time) AT TIME ZONE ${input.timezone}),
          ((${input.date}::date+${period.ends_at}::time) AT TIME ZONE ${input.timezone}),
          ${period.title},${period.slot_type},${period.room_snapshot},${state},${input.plan_revision},
          ${logicalOccurrenceKey},${period.period_number},${event.id}::uuid,${event.id}::uuid,
          ${closureExists ? closure.event_id : null}::uuid,
          ${previous?.recorded_until ?? event.recorded_at}::timestamptz,${previous?.id ?? null}::uuid,
          ${changeKind}
        ) ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING RETURNING id`.execute(transaction);
            replacements += result.rows.length;
        }
        return {
            event_id: event.id,
            affected_occurrence_count: superseded.rows.length,
            replacement_occurrence_count: replacements,
            replayed: false,
        };
    }
    async recordAcceptedScheduleSubstitution(transaction, rawInput) {
        const input = acceptedScheduleSubstitutionProjectionSchema.parse(rawInput);
        this.assertAcceptedSubstitutionOccurrenceKey(input);
        const authoritativeOutboxEvidence = acceptedScheduleSubstitutionOutboxEvidence(input);
        const outbox = (await sql `SELECT id FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
        AND event_type='staff.coverage.accepted'
        AND aggregate_type='staff_coverage_task'
        AND aggregate_id=${input.coverage_task_id}::uuid
        AND payload @> ${JSON.stringify(authoritativeOutboxEvidence)}::jsonb
      FOR SHARE`.execute(transaction)).rows[0];
        if (!outbox) {
            throw new ConflictException("The accepted cover does not match its authoritative domain event.");
        }
        const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        const originalTeacher = await this.ensureHumanAgent(transaction, input.school_id, input.original_teacher_user_id);
        const replacementTeacher = await this.ensureHumanAgent(transaction, input.school_id, input.replacement_teacher_user_id);
        return this.projectAcceptedScheduleSubstitution(transaction, input, {
            actor,
            originalTeacher,
            replacementTeacher,
            provenance: {
                source: "staff_timetable_substitutions",
                captured_by: "staff-operations",
            },
        });
    }
    async recordImportedAcceptedScheduleSubstitution(transaction, rawInput) {
        const importedInput = importedAcceptedScheduleSubstitutionProjectionSchema.parse(rawInput);
        const { imported_by_user_id: importedByUserId, imported_at: importedAt, import_reason: importReason, ...acceptedInput } = importedInput;
        const input = acceptedScheduleSubstitutionProjectionSchema.parse(acceptedInput);
        this.assertAcceptedSubstitutionOccurrenceKey(input);
        // The importer authorises this repair now. The accepter and both teachers
        // are historical identity evidence only and are never granted current
        // authority by this lookup.
        const importer = await this.ensureHumanAgent(transaction, input.school_id, importedByUserId);
        const actor = await this.requireRetainedHumanAgent(transaction, input.school_id, input.actor_user_id);
        const originalTeacher = await this.requireRetainedHumanAgent(transaction, input.school_id, input.original_teacher_user_id);
        const replacementTeacher = await this.requireRetainedHumanAgent(transaction, input.school_id, input.replacement_teacher_user_id);
        if (actor.id !== replacementTeacher.id) {
            throw new ConflictException("The retained accepter identity does not match the retained replacement teacher.");
        }
        // Reconciliation may encounter a substitution already projected by the
        // live acceptance path. Its exact Core decision is authoritative and needs
        // neither a second outbox record nor rewritten import provenance.
        const replay = await this.replayAcceptedScheduleSubstitutionIfPresent(transaction, input, { actor, originalTeacher, replacementTeacher });
        if (replay)
            return replay;
        const authoritativeOutboxEvidence = importedAcceptedScheduleSubstitutionOutboxEvidence(importedInput);
        const importIdempotencyKey = [
            "staff.coverage.accepted-import",
            input.substitution_id,
            String(input.coverage_task_revision),
        ].join(":");
        const outbox = (await sql `SELECT id FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
        AND event_type='staff.coverage.accepted'
        AND aggregate_type='staff_coverage_task'
        AND aggregate_id=${input.coverage_task_id}::uuid
        AND idempotency_key=${importIdempotencyKey}
        AND payload=${JSON.stringify(authoritativeOutboxEvidence)}::jsonb
        AND audience_user_ids=ARRAY[]::uuid[]
        AND notification_user_ids=ARRAY[]::uuid[]
        AND notification_payload IS NULL
      FOR SHARE`.execute(transaction)).rows[0];
        if (!outbox) {
            throw new ConflictException("The imported accepted cover does not match its canonical non-notifying domain event.");
        }
        return this.projectAcceptedScheduleSubstitution(transaction, input, {
            actor,
            originalTeacher,
            replacementTeacher,
            provenance: {
                source: "staff_timetable_substitutions",
                captured_by: "staff-coverage-reconciliation",
                projection_mode: "historical_import",
                import_reason: importReason,
                imported_at: importedAt,
                imported_by_agent_id: importer.id,
                accepted_by_agent_id: actor.id,
            },
        });
    }
    async replayAcceptedScheduleSubstitutionIfPresent(transaction, input, identities) {
        const school = (await sql `SELECT timezone FROM schools
      WHERE id=${input.school_id}::uuid FOR SHARE`.execute(transaction)).rows[0];
        if (!school) {
            throw new ConflictException("The institution for this timetable change no longer exists.");
        }
        const authoritativeIdentity = {
            ...acceptedScheduleSubstitutionOutboxEvidence(input),
            coverage_task_id: input.coverage_task_id,
            original_teacher_agent_id: identities.originalTeacher.id,
            replacement_teacher_agent_id: identities.replacementTeacher.id,
        };
        const idempotencyKey = `timetable.substitution-effective:${input.substitution_id}:${input.coverage_task_revision}`;
        const basisDomain = input.source_kind === "daily_plan" ? "day_plan" : "timetable";
        const existing = (await sql `SELECT event.id,
        (event.event_kind='decision'
          AND event.event_type='timetable.substitution_effective'
          AND event.actor_agent_id=${identities.actor.id}::uuid
          AND event.source_domain='staff_coverage'
          AND event.source_record_id=${input.substitution_id}
          AND event.source_revision=${input.coverage_task_revision}
          AND event.event_at=${input.accepted_at}::timestamptz
          AND event.effective_from=((${input.duty_date}::date+${input.starts_at}::time)
            AT TIME ZONE ${school.timezone})
          AND event.effective_until=((${input.duty_date}::date+${input.ends_at}::time)
            AT TIME ZONE ${school.timezone})
          AND event.subject_entity_id=(SELECT entity.id FROM campus_model_entities entity
            WHERE entity.school_id=${input.school_id}::uuid
              AND entity.domain='staff_coverage' AND entity.domain_id=${input.substitution_id})
          AND event.context_entity_id=(SELECT entity.id FROM campus_model_entities entity
            WHERE entity.school_id=${input.school_id}::uuid
              AND entity.domain=${input.class_section.domain}
              AND entity.domain_id=${input.class_section.domain_id})
          AND event.payload @> ${JSON.stringify(authoritativeIdentity)}::jsonb
        ) AS decision_matches,
        (SELECT count(*)::int FROM campus_model_schedule_occurrences occurrence
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}
            AND occurrence.change_event_id=event.id) AS replacement_count,
        EXISTS(SELECT 1 FROM campus_model_schedule_occurrences occurrence
          JOIN campus_model_events basis
            ON basis.id=occurrence.basis_event_id AND basis.school_id=occurrence.school_id
          JOIN campus_model_entities schedule_entity
            ON schedule_entity.id=occurrence.schedule_entity_id
              AND schedule_entity.school_id=occurrence.school_id
          JOIN campus_model_entities period_entity
            ON period_entity.id=occurrence.period_entity_id
              AND period_entity.school_id=occurrence.school_id
          JOIN campus_model_entities class_entity
            ON class_entity.id=occurrence.class_entity_id
              AND class_entity.school_id=occurrence.school_id
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}
            AND occurrence.change_event_id=event.id
            AND occurrence.change_kind='substituted'
            AND occurrence.state='expected'
            AND occurrence.responsible_agent_id=${identities.replacementTeacher.id}::uuid
            AND occurrence.occurrence_date=${input.duty_date}::date
            AND occurrence.period_number=${input.period_number}
            AND occurrence.starts_at=((${input.duty_date}::date+${input.starts_at}::time)
              AT TIME ZONE ${school.timezone})
            AND occurrence.ends_at=((${input.duty_date}::date+${input.ends_at}::time)
              AT TIME ZONE ${school.timezone})
            AND occurrence.title=${input.title} AND occurrence.slot_type=${input.slot_type}
            AND occurrence.room_snapshot=${input.room_snapshot}
            AND occurrence.source_revision=${input.source_revision}
            AND basis.source_domain=${basisDomain}
            AND basis.source_record_id=${input.source_record_id}
            AND basis.source_revision=${input.source_revision}
            AND schedule_entity.domain=${input.schedule.domain}
            AND schedule_entity.domain_id=${input.schedule.domain_id}
            AND period_entity.domain=${input.period.domain}
            AND period_entity.domain_id=${input.period.domain_id}
            AND class_entity.domain=${input.class_section.domain}
            AND class_entity.domain_id=${input.class_section.domain_id}
            AND occurrence.subject_entity_id IS NOT DISTINCT FROM (
              SELECT entity.id FROM campus_model_entities entity
              WHERE entity.school_id=${input.school_id}::uuid
                AND entity.domain=${input.subject?.domain ?? null}
                AND entity.domain_id=${input.subject?.domain_id ?? null}
            )
            AND occurrence.space_entity_id IS NOT DISTINCT FROM (
              SELECT entity.id FROM campus_model_entities entity
              WHERE entity.school_id=${input.school_id}::uuid
                AND entity.domain=${input.space?.domain ?? null}
                AND entity.domain_id=${input.space?.domain_id ?? null}
            )
        ) AS replacement_matches,
        EXISTS(SELECT 1 FROM campus_model_schedule_occurrences occurrence
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}) AS source_history,
        EXISTS(SELECT 1 FROM campus_model_schedule_occurrences occurrence
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}
            AND occurrence.recorded_until IS NULL) AS current_exists,
        EXISTS(SELECT 1 FROM campus_model_schedule_occurrences occurrence
          JOIN campus_model_events basis
            ON basis.id=occurrence.basis_event_id AND basis.school_id=occurrence.school_id
          JOIN campus_model_entities schedule_entity
            ON schedule_entity.id=occurrence.schedule_entity_id
              AND schedule_entity.school_id=occurrence.school_id
          JOIN campus_model_entities period_entity
            ON period_entity.id=occurrence.period_entity_id
              AND period_entity.school_id=occurrence.school_id
          JOIN campus_model_entities class_entity
            ON class_entity.id=occurrence.class_entity_id
              AND class_entity.school_id=occurrence.school_id
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}
            AND occurrence.recorded_until IS NULL
            AND (
              occurrence.state='expected'
              OR (
                occurrence.state='cancelled'
                AND occurrence.change_kind='closure_cancelled'
                AND occurrence.condition_event_id IS NOT NULL
              )
            )
            AND occurrence.responsible_agent_id=${identities.originalTeacher.id}::uuid
            AND occurrence.occurrence_date=${input.duty_date}::date
            AND occurrence.period_number=${input.period_number}
            AND occurrence.starts_at=((${input.duty_date}::date+${input.starts_at}::time)
              AT TIME ZONE ${school.timezone})
            AND occurrence.ends_at=((${input.duty_date}::date+${input.ends_at}::time)
              AT TIME ZONE ${school.timezone})
            AND occurrence.title=${input.title} AND occurrence.slot_type=${input.slot_type}
            AND occurrence.room_snapshot=${input.room_snapshot}
            AND occurrence.source_revision=${input.source_revision}
            AND basis.source_domain=${basisDomain}
            AND basis.source_record_id=${input.source_record_id}
            AND basis.source_revision=${input.source_revision}
            AND schedule_entity.domain=${input.schedule.domain}
            AND schedule_entity.domain_id=${input.schedule.domain_id}
            AND period_entity.domain=${input.period.domain}
            AND period_entity.domain_id=${input.period.domain_id}
            AND class_entity.domain=${input.class_section.domain}
            AND class_entity.domain_id=${input.class_section.domain_id}
            AND occurrence.subject_entity_id IS NOT DISTINCT FROM (
              SELECT entity.id FROM campus_model_entities entity
              WHERE entity.school_id=${input.school_id}::uuid
                AND entity.domain=${input.subject?.domain ?? null}
                AND entity.domain_id=${input.subject?.domain_id ?? null}
            )
            AND occurrence.space_entity_id IS NOT DISTINCT FROM (
              SELECT entity.id FROM campus_model_entities entity
              WHERE entity.school_id=${input.school_id}::uuid
                AND entity.domain=${input.space?.domain ?? null}
                AND entity.domain_id=${input.space?.domain_id ?? null}
            )
        ) AS current_source_matches,
        EXISTS(SELECT 1 FROM campus_model_schedule_occurrences occurrence
          WHERE occurrence.school_id=event.school_id
            AND occurrence.logical_occurrence_key=${input.occurrence_key}
            AND occurrence.recorded_until IS NULL
            AND occurrence.state='cancelled'
            AND occurrence.change_kind='closure_cancelled'
            AND occurrence.condition_event_id IS NOT NULL
        ) AS current_source_closed
      FROM campus_model_events event
      WHERE event.school_id=${input.school_id}::uuid
        AND event.idempotency_key=${idempotencyKey}
      FOR SHARE OF event`.execute(transaction)).rows[0];
        if (!existing)
            return null;
        if (!existing.decision_matches
            || existing.replacement_count > 1
            || (existing.replacement_count === 1 && !existing.replacement_matches)) {
            throw new ConflictException("The retained accepted-cover decision contains different timetable evidence.");
        }
        if (existing.replacement_count === 1) {
            return {
                event_id: existing.id,
                affected_occurrence_count: 1,
                replacement_occurrence_count: 1,
                projection_status: "applied",
                replayed: true,
            };
        }
        if (existing.current_exists && !existing.current_source_matches) {
            return {
                event_id: existing.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_mismatch",
                replayed: true,
            };
        }
        if (existing.current_source_closed) {
            return {
                event_id: existing.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_closed",
                replayed: true,
            };
        }
        return {
            event_id: existing.id,
            affected_occurrence_count: 0,
            replacement_occurrence_count: 0,
            projection_status: existing.source_history
                ? "source_closed"
                : "awaiting_source_projection",
            replayed: true,
        };
    }
    async projectAcceptedScheduleSubstitution(transaction, input, identities) {
        const { actor, originalTeacher, replacementTeacher, provenance } = identities;
        const authoritativeOutboxEvidence = acceptedScheduleSubstitutionOutboxEvidence(input);
        const school = (await sql `SELECT timezone FROM schools
      WHERE id=${input.school_id}::uuid FOR SHARE`.execute(transaction)).rows[0];
        if (!school)
            throw new ConflictException("The institution for this timetable change no longer exists.");
        const schedule = await this.upsertEntity(transaction, input.school_id, input.schedule);
        const period = await this.upsertEntity(transaction, input.school_id, input.period);
        const classEntity = await this.upsertEntity(transaction, input.school_id, input.class_section);
        const subject = input.subject
            ? await this.upsertEntity(transaction, input.school_id, input.subject)
            : null;
        const space = input.space
            ? await this.upsertEntity(transaction, input.school_id, input.space)
            : null;
        const substitution = await this.upsertEntity(transaction, input.school_id, {
            kind: "schedule_change",
            domain: "staff_coverage",
            domain_id: input.substitution_id,
            label: `${input.class_section.label} cover on ${input.duty_date}, period ${input.period_number}`,
            lifecycle_state: "active",
            source_revision: input.coverage_task_revision,
            metadata: {
                coverage_task_id: input.coverage_task_id,
                occurrence_key: input.occurrence_key,
            },
        });
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(
      'campus-schedule-occurrence:'||${input.school_id}::text||':'||${input.occurrence_key},0
    ))`.execute(transaction);
        const findCurrent = async () => (await sql `
      SELECT occurrence.*,basis.source_domain AS basis_source_domain,
        basis.source_record_id AS basis_source_record_id,
        basis.source_revision AS basis_source_revision,
        occurrence.state='expected'
          AND occurrence.schedule_entity_id=${schedule.id}::uuid
          AND occurrence.period_entity_id=${period.id}::uuid
          AND occurrence.class_entity_id=${classEntity.id}::uuid
          AND occurrence.subject_entity_id IS NOT DISTINCT FROM ${subject?.id ?? null}::uuid
          AND occurrence.space_entity_id IS NOT DISTINCT FROM ${space?.id ?? null}::uuid
          AND occurrence.responsible_agent_id=${originalTeacher.id}::uuid
          AND occurrence.occurrence_date=${input.duty_date}::date
          AND occurrence.period_number=${input.period_number}
          AND occurrence.starts_at=((${input.duty_date}::date+${input.starts_at}::time) AT TIME ZONE ${school.timezone})
          AND occurrence.ends_at=((${input.duty_date}::date+${input.ends_at}::time) AT TIME ZONE ${school.timezone})
          AND occurrence.title=${input.title}
          AND occurrence.slot_type=${input.slot_type}
          AND occurrence.room_snapshot=${input.room_snapshot}
          AND occurrence.source_revision=${input.source_revision}
          AND basis.source_domain=${input.source_kind === "daily_plan" ? "day_plan" : "timetable"}
          AND basis.source_record_id=${input.source_record_id}
          AND basis.source_revision=${input.source_revision} AS source_matches,
        occurrence.state='cancelled'
          AND occurrence.change_kind='closure_cancelled'
          AND occurrence.condition_event_id IS NOT NULL
          AND occurrence.schedule_entity_id=${schedule.id}::uuid
          AND occurrence.period_entity_id=${period.id}::uuid
          AND occurrence.class_entity_id=${classEntity.id}::uuid
          AND occurrence.subject_entity_id IS NOT DISTINCT FROM ${subject?.id ?? null}::uuid
          AND occurrence.space_entity_id IS NOT DISTINCT FROM ${space?.id ?? null}::uuid
          AND occurrence.responsible_agent_id=${originalTeacher.id}::uuid
          AND occurrence.occurrence_date=${input.duty_date}::date
          AND occurrence.period_number=${input.period_number}
          AND occurrence.starts_at=((${input.duty_date}::date+${input.starts_at}::time) AT TIME ZONE ${school.timezone})
          AND occurrence.ends_at=((${input.duty_date}::date+${input.ends_at}::time) AT TIME ZONE ${school.timezone})
          AND occurrence.title=${input.title}
          AND occurrence.slot_type=${input.slot_type}
          AND occurrence.room_snapshot=${input.room_snapshot}
          AND occurrence.source_revision=${input.source_revision}
          AND basis.source_domain=${input.source_kind === "daily_plan" ? "day_plan" : "timetable"}
          AND basis.source_record_id=${input.source_record_id}
          AND basis.source_revision=${input.source_revision} AS closed_source_matches
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_events basis
        ON basis.id=occurrence.basis_event_id AND basis.school_id=occurrence.school_id
      WHERE occurrence.school_id=${input.school_id}::uuid
        AND occurrence.logical_occurrence_key=${input.occurrence_key}
        AND occurrence.recorded_until IS NULL
      FOR UPDATE OF occurrence`.execute(transaction)).rows[0];
        let current = await findCurrent();
        let sourceHasHistory = false;
        if (!current) {
            sourceHasHistory = (await sql `SELECT EXISTS(
          SELECT 1 FROM campus_model_schedule_occurrences
          WHERE school_id=${input.school_id}::uuid
            AND logical_occurrence_key=${input.occurrence_key}
        ) AS found`.execute(transaction)).rows[0]?.found ?? false;
            if (!sourceHasHistory) {
                const basisDomain = input.source_kind === "daily_plan" ? "day_plan" : "timetable";
                const basisType = input.source_kind === "daily_plan"
                    ? "timetable.day_plan_published"
                    : "timetable.schedule_published";
                let basis = (await sql `SELECT id,request_hash,recorded_at,journal_sequence
          FROM campus_model_events
          WHERE school_id=${input.school_id}::uuid AND source_domain=${basisDomain}
            AND source_record_id=${input.source_record_id}
            AND source_revision=${input.source_revision}
            AND event_type=${basisType}
          ORDER BY recorded_at DESC,journal_sequence DESC LIMIT 1
          FOR SHARE`.execute(transaction)).rows[0];
                if (!basis) {
                    const basisInput = {
                        source_kind: input.source_kind,
                        source_record_id: input.source_record_id,
                        source_revision: input.source_revision,
                        source_version: input.source_version,
                        occurrence_key: input.occurrence_key,
                        schedule: input.schedule,
                        period: input.period,
                        class_section: input.class_section,
                        subject: input.subject,
                        space: input.space,
                        duty_date: input.duty_date,
                        period_number: input.period_number,
                        starts_at: input.starts_at,
                        ends_at: input.ends_at,
                        title: input.title,
                        slot_type: input.slot_type,
                        room_snapshot: input.room_snapshot,
                        original_teacher_agent_id: originalTeacher.id,
                    };
                    const basisRequestHash = createHash("sha256")
                        .update(JSON.stringify(basisInput))
                        .digest("hex");
                    const basisIdempotencyKey = [
                        "timetable.schedule-projection-backfilled",
                        input.source_kind,
                        input.source_record_id,
                        String(input.source_revision),
                        input.occurrence_key,
                    ].join(":");
                    const insertedBasis = (await sql `INSERT INTO campus_model_events(
              school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
              source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
              correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
            ) VALUES(
              ${input.school_id}::uuid,'plan','timetable.schedule_projection_backfilled',
              ${schedule.id}::uuid,${classEntity.id}::uuid,${actor.id}::uuid,
              ${basisDomain},${input.source_record_id},${input.source_revision},
              ${input.accepted_at}::timestamptz,
              ((${input.duty_date}::date+${input.starts_at}::time) AT TIME ZONE ${school.timezone}),
              ((${input.duty_date}::date+${input.ends_at}::time) AT TIME ZONE ${school.timezone}),
              ${input.correlation_id}::uuid,
              ${JSON.stringify({ source: "effective_school_schedule_v3", captured_by: "staff-coverage", import_reason: "missing_temporal_occurrence" })}::jsonb,
              ${JSON.stringify(basisInput)}::jsonb,1,${basisIdempotencyKey},${basisRequestHash}
            ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
            RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
                    basis = insertedBasis ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence
            FROM campus_model_events
            WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${schedule.id}::uuid
              AND idempotency_key=${basisIdempotencyKey}
            FOR UPDATE`.execute(transaction)).rows[0];
                    if (!basis || basis.request_hash !== basisRequestHash) {
                        throw new ConflictException("The source occurrence backfill key belongs to different schedule evidence.");
                    }
                }
                await sql `INSERT INTO campus_model_schedule_occurrences(
            school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
            subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
            title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
            basis_event_id,change_event_id,condition_event_id,recorded_from,
            supersedes_occurrence_id,change_kind
          ) VALUES(
            ${input.school_id}::uuid,${basis.id}::uuid,${schedule.id}::uuid,${period.id}::uuid,
            ${classEntity.id}::uuid,${subject?.id ?? null}::uuid,${originalTeacher.id}::uuid,
            ${space?.id ?? null}::uuid,${input.duty_date}::date,
            ((${input.duty_date}::date+${input.starts_at}::time) AT TIME ZONE ${school.timezone}),
            ((${input.duty_date}::date+${input.ends_at}::time) AT TIME ZONE ${school.timezone}),
            ${input.title},${input.slot_type},${input.room_snapshot},'expected',${input.source_revision},
            ${input.occurrence_key},${input.period_number},${basis.id}::uuid,${basis.id}::uuid,NULL,
            GREATEST(${basis.recorded_at}::timestamptz,clock_timestamp()),NULL,'projection_backfill'
          ) ON CONFLICT DO NOTHING`.execute(transaction);
                current = await findCurrent();
            }
        }
        const idempotencyKey = `timetable.substitution-effective:${input.substitution_id}:${input.coverage_task_revision}`;
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const inserted = (await sql `INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,provenance,payload,schema_version,idempotency_key,request_hash,
        source_outbox_event_id
      ) VALUES(
        ${input.school_id}::uuid,'decision','timetable.substitution_effective',
        ${substitution.id}::uuid,${classEntity.id}::uuid,${actor.id}::uuid,
        'staff_coverage',${input.substitution_id},${input.coverage_task_revision},
        ${input.accepted_at}::timestamptz,
        ((${input.duty_date}::date+${input.starts_at}::time) AT TIME ZONE ${school.timezone}),
        ((${input.duty_date}::date+${input.ends_at}::time) AT TIME ZONE ${school.timezone}),
        ${input.correlation_id}::uuid,
        ${JSON.stringify(provenance)}::jsonb,
        ${JSON.stringify({
            ...authoritativeOutboxEvidence,
            coverage_task_id: input.coverage_task_id,
            original_teacher_agent_id: originalTeacher.id,
            replacement_teacher_agent_id: replacementTeacher.id,
        })}::jsonb,1,${idempotencyKey},${requestHash},${input.source_outbox_event_id}::uuid
      ) ON CONFLICT DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT id,request_hash,recorded_at,journal_sequence
      FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${substitution.id}::uuid
        AND idempotency_key=${idempotencyKey}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This accepted-cover key was already used for different timetable evidence.");
        }
        const priorReplacement = (await sql `SELECT id FROM campus_model_schedule_occurrences
      WHERE school_id=${input.school_id}::uuid AND logical_occurrence_key=${input.occurrence_key}
        AND change_event_id=${event.id}::uuid
      LIMIT 1`.execute(transaction)).rows[0];
        if (priorReplacement) {
            return {
                event_id: event.id,
                affected_occurrence_count: 1,
                replacement_occurrence_count: 1,
                projection_status: "applied",
                replayed: !inserted,
            };
        }
        if (!current) {
            return {
                event_id: event.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: sourceHasHistory ? "source_closed" : "awaiting_source_projection",
                replayed: !inserted,
            };
        }
        if (current.closed_source_matches) {
            return {
                event_id: event.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_closed",
                replayed: !inserted,
            };
        }
        if (!current.source_matches) {
            return {
                event_id: event.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_mismatch",
                replayed: !inserted,
            };
        }
        const replacement = await sql `WITH closed AS (
        UPDATE campus_model_schedule_occurrences occurrence SET
          recorded_until=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond'),
          projected_at=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond')
        WHERE occurrence.school_id=${input.school_id}::uuid
          AND occurrence.id=${current.id}::uuid AND occurrence.recorded_until IS NULL
        RETURNING occurrence.*
      )
      INSERT INTO campus_model_schedule_occurrences(
        school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
        subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
        title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
        basis_event_id,change_event_id,condition_event_id,recorded_from,
        supersedes_occurrence_id,change_kind
      ) SELECT
        closed.school_id,closed.source_event_id,closed.schedule_entity_id,closed.period_entity_id,
        closed.class_entity_id,closed.subject_entity_id,${replacementTeacher.id}::uuid,
        closed.space_entity_id,closed.occurrence_date,closed.starts_at,closed.ends_at,
        closed.title,closed.slot_type,closed.room_snapshot,'expected',closed.source_revision,
        closed.logical_occurrence_key,closed.period_number,closed.basis_event_id,${event.id}::uuid,
        closed.condition_event_id,closed.recorded_until,closed.id,'substituted'
      FROM closed
      ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
      RETURNING id`.execute(transaction);
        return {
            event_id: event.id,
            affected_occurrence_count: replacement.rows.length,
            replacement_occurrence_count: replacement.rows.length,
            projection_status: replacement.rows.length ? "applied" : "awaiting_source_projection",
            replayed: !inserted,
        };
    }
    async recordCancelledScheduleSubstitution(transaction, rawInput) {
        const input = cancelledScheduleSubstitutionProjectionSchema.parse(rawInput);
        const authoritativeOutboxEvidence = cancelledScheduleSubstitutionOutboxEvidence(input);
        const successorAssignment = cancelledScheduleSubstitutionSuccessorAssignment(input.reason);
        const outbox = (await sql `SELECT id FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
        AND event_type='staff.coverage.cancelled'
        AND aggregate_type='staff_coverage_task'
        AND aggregate_id=${input.coverage_task_id}::uuid
        AND payload @> ${JSON.stringify(authoritativeOutboxEvidence)}::jsonb
      FOR SHARE`.execute(transaction)).rows[0];
        if (!outbox) {
            throw new ConflictException("The cancelled cover does not match its authoritative domain event.");
        }
        const actor = await this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(
      'campus-schedule-occurrence:'||${input.school_id}::text||':'||${input.occurrence_key},0
    ))`.execute(transaction);
        const acceptedIdentity = {
            school_id: input.school_id,
            status: "accepted",
            substitution_id: input.substitution_id,
            effective_timetable: true,
            occurrence_key: input.occurrence_key,
            source_kind: input.source_kind,
            source_record_id: input.source_record_id,
            source_revision: input.source_revision,
            source_version: input.source_version,
            original_teacher_user_id: input.original_teacher_user_id,
            replacement_teacher_user_id: input.replacement_teacher_user_id,
            coverage_task_id: input.coverage_task_id,
        };
        const accepted = (await sql `SELECT
        accepted_event.id,accepted_event.request_hash,accepted_event.recorded_at,
        accepted_event.journal_sequence,accepted_event.subject_entity_id,
        accepted_event.context_entity_id,accepted_event.effective_from,
        accepted_event.effective_until,accepted_event.source_revision,
        original_agent.id AS original_teacher_agent_id,
        replacement_agent.id AS replacement_teacher_agent_id
      FROM campus_model_events accepted_event
      JOIN campus_model_agents original_agent
        ON original_agent.school_id=accepted_event.school_id
        AND original_agent.id=(accepted_event.payload->>'original_teacher_agent_id')::uuid
        AND original_agent.agent_kind='human'
      JOIN campus_model_agents replacement_agent
        ON replacement_agent.school_id=accepted_event.school_id
        AND replacement_agent.id=(accepted_event.payload->>'replacement_teacher_agent_id')::uuid
        AND replacement_agent.agent_kind='human'
      WHERE accepted_event.school_id=${input.school_id}::uuid
        AND accepted_event.event_kind='decision'
        AND accepted_event.event_type='timetable.substitution_effective'
        AND accepted_event.source_domain='staff_coverage'
        AND accepted_event.source_record_id=${input.substitution_id}
        AND accepted_event.source_revision<${input.coverage_task_revision}
        AND accepted_event.payload @> ${JSON.stringify(acceptedIdentity)}::jsonb
      ORDER BY accepted_event.source_revision DESC,accepted_event.recorded_at DESC,
        accepted_event.journal_sequence DESC
      LIMIT 1 FOR SHARE`.execute(transaction)).rows[0];
        if (!accepted) {
            throw new ConflictException("The cancellation does not identify a projected accepted substitution.");
        }
        const idempotencyKey = [
            "timetable.substitution-cancelled",
            input.substitution_id,
            String(input.coverage_task_revision),
        ].join(":");
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const inserted = (await sql `INSERT INTO campus_model_events(
        school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
        source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
        correlation_id,causation_event_id,provenance,payload,schema_version,idempotency_key,
        request_hash,source_outbox_event_id
      ) VALUES(
        ${input.school_id}::uuid,'decision','timetable.substitution_cancelled',
        ${accepted.subject_entity_id}::uuid,${accepted.context_entity_id}::uuid,${actor.id}::uuid,
        'staff_coverage',${input.substitution_id},${input.coverage_task_revision},
        ${input.cancelled_at}::timestamptz,${accepted.effective_from}::timestamptz,
        ${accepted.effective_until}::timestamptz,${input.correlation_id}::uuid,
        ${accepted.id}::uuid,
        ${JSON.stringify({ source: "staff_timetable_substitutions", captured_by: "staff-operations" })}::jsonb,
        ${JSON.stringify({
            ...authoritativeOutboxEvidence,
            coverage_task_id: input.coverage_task_id,
            accepted_event_id: accepted.id,
            accepted_coverage_task_revision: accepted.source_revision,
            successor_assignment: successorAssignment,
        })}::jsonb,1,${idempotencyKey},${requestHash},${input.source_outbox_event_id}::uuid
      ) ON CONFLICT DO NOTHING
      RETURNING id,request_hash,recorded_at,journal_sequence`.execute(transaction)).rows[0];
        const event = inserted ?? (await sql `SELECT
        id,request_hash,recorded_at,journal_sequence
      FROM campus_model_events
      WHERE school_id=${input.school_id}::uuid AND subject_entity_id=${accepted.subject_entity_id}::uuid
        AND idempotency_key=${idempotencyKey}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!event || event.request_hash !== requestHash) {
            throw new ConflictException("This cover-cancellation key was already used for different timetable evidence.");
        }
        const expectedSuccessorAgentId = successorAssignment === "original_teacher"
            ? accepted.original_teacher_agent_id
            : null;
        const appliedReceipt = (count, replayed) => {
            if (expectedSuccessorAgentId) {
                return {
                    event_id: event.id,
                    affected_occurrence_count: count,
                    replacement_occurrence_count: count,
                    projection_status: "applied_original_teacher",
                    successor_assignment: "original_teacher",
                    replayed,
                };
            }
            return {
                event_id: event.id,
                affected_occurrence_count: count,
                replacement_occurrence_count: count,
                projection_status: "applied_unassigned",
                successor_assignment: "unassigned",
                replayed,
            };
        };
        const priorSuccessor = (await sql `SELECT
        id,responsible_agent_id
      FROM campus_model_schedule_occurrences
      WHERE school_id=${input.school_id}::uuid
        AND logical_occurrence_key=${input.occurrence_key}
        AND change_event_id=${event.id}::uuid
        AND change_kind='substitution_cancelled'
      LIMIT 1`.execute(transaction)).rows[0];
        if (priorSuccessor) {
            if (priorSuccessor.responsible_agent_id !== expectedSuccessorAgentId) {
                return {
                    event_id: event.id,
                    affected_occurrence_count: 0,
                    replacement_occurrence_count: 0,
                    projection_status: "source_mismatch",
                    successor_assignment: null,
                    replayed: !inserted,
                };
            }
            return appliedReceipt(1, !inserted);
        }
        const current = (await sql `SELECT occurrence.*,
        basis.source_domain AS basis_source_domain,
        basis.source_record_id AS basis_source_record_id,
        basis.source_revision AS basis_source_revision
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_events basis
        ON basis.id=occurrence.basis_event_id AND basis.school_id=occurrence.school_id
      WHERE occurrence.school_id=${input.school_id}::uuid
        AND occurrence.logical_occurrence_key=${input.occurrence_key}
        AND occurrence.recorded_until IS NULL
      FOR UPDATE OF occurrence`.execute(transaction)).rows[0];
        if (!current || current.change_event_id !== accepted.id) {
            return {
                event_id: event.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_replaced",
                successor_assignment: "unchanged_later_source",
                replayed: !inserted,
            };
        }
        if (successorAssignment === "unchanged_later_source"
            || current.state !== "expected"
            || current.responsible_agent_id !== accepted.replacement_teacher_agent_id
            || current.basis_source_domain !== (input.source_kind === "daily_plan" ? "day_plan" : "timetable")
            || current.basis_source_record_id !== input.source_record_id
            || current.basis_source_revision !== input.source_revision) {
            return {
                event_id: event.id,
                affected_occurrence_count: 0,
                replacement_occurrence_count: 0,
                projection_status: "source_mismatch",
                successor_assignment: null,
                replayed: !inserted,
            };
        }
        const successor = await sql `WITH closed AS (
        UPDATE campus_model_schedule_occurrences occurrence SET
          recorded_until=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond'),
          projected_at=GREATEST(${event.recorded_at}::timestamptz,
            occurrence.recorded_from+interval '1 microsecond')
        WHERE occurrence.school_id=${input.school_id}::uuid
          AND occurrence.id=${current.id}::uuid
          AND occurrence.change_event_id=${accepted.id}::uuid
          AND occurrence.recorded_until IS NULL
        RETURNING occurrence.*
      )
      INSERT INTO campus_model_schedule_occurrences(
        school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
        subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
        title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
        basis_event_id,change_event_id,condition_event_id,recorded_from,
        supersedes_occurrence_id,change_kind
      ) SELECT
        closed.school_id,closed.source_event_id,closed.schedule_entity_id,closed.period_entity_id,
        closed.class_entity_id,closed.subject_entity_id,${expectedSuccessorAgentId}::uuid,
        closed.space_entity_id,
        closed.occurrence_date,closed.starts_at,closed.ends_at,closed.title,closed.slot_type,
        closed.room_snapshot,'expected',closed.source_revision,closed.logical_occurrence_key,
        closed.period_number,closed.basis_event_id,${event.id}::uuid,closed.condition_event_id,
        closed.recorded_until,closed.id,'substitution_cancelled'
      FROM closed
      ON CONFLICT(school_id,change_event_id,logical_occurrence_key) DO NOTHING
      RETURNING id`.execute(transaction);
        if (successor.rows.length)
            return appliedReceipt(successor.rows.length, !inserted);
        return {
            event_id: event.id,
            affected_occurrence_count: 0,
            replacement_occurrence_count: 0,
            projection_status: "source_replaced",
            successor_assignment: "unchanged_later_source",
            replayed: !inserted,
        };
    }
    async resolveAt(rawInput) {
        const input = campusTemporalContextQuerySchema.parse(rawInput);
        const environmentNamespaceId = executionNamespaceForSchool(input.school_id, this.executionScope?.current());
        const recordedAsOf = input.recorded_as_of ?? executionNow().toISOString();
        const entityDomain = input.subject.type === "entity" ? input.subject.domain : null;
        const entityDomainId = input.subject.type === "entity" ? input.subject.domain_id : null;
        const humanUserId = input.subject.type === "human_agent" ? input.subject.user_id : null;
        const rows = (await sql `
      SELECT occurrence.id::text AS assertion_id,
        occurrence.logical_occurrence_key::text AS occurrence_id,
        occurrence.id::text AS occurrence_revision_id,
        schedule.domain_id AS schedule_version_id,occurrence.period_number,
        class_entity.id::text AS class_entity_id,
        class_entity.label AS class_label,subject_entity.id::text AS subject_entity_id,
        subject_entity.label AS subject_label,space_entity.id::text AS space_entity_id,
        space_entity.label AS space_label,occurrence.title,occurrence.slot_type,
        occurrence.starts_at,occurrence.ends_at,occurrence.recorded_from AS recorded_at,
        event.id::text AS event_id,event.journal_sequence::text AS journal_sequence,
        event.source_record_id,event.source_revision,event.event_type,event.source_domain,
        change_event.id::text AS change_event_id,change_event.event_type AS change_event_type,
        change_event.source_domain AS change_source_domain,
        change_event.source_record_id AS change_source_record_id,
        change_event.source_revision AS change_source_revision,
        change_event.journal_sequence::text AS change_journal_sequence,
        occurrence.change_kind,
        condition_event.id::text AS condition_event_id,
        condition_event.event_type AS condition_event_type,
        condition_event.source_domain AS condition_source_domain,
        condition_event.source_record_id AS condition_source_record_id,
        condition_event.source_revision AS condition_source_revision,
        condition_event.journal_sequence::text AS condition_journal_sequence,
        CASE WHEN ${humanUserId}::uuid IS NOT NULL THEN agent.id::text ELSE queried_entity.id::text END AS queried_subject_id,
        CASE WHEN ${humanUserId}::uuid IS NOT NULL THEN agent.label ELSE queried_entity.label END AS queried_subject_label,
        ${input.at}::timestamptz>=occurrence.starts_at
          AND ${input.at}::timestamptz<occurrence.ends_at AS current
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_events event
        ON event.id=occurrence.basis_event_id AND event.school_id=occurrence.school_id
      JOIN campus_model_events change_event
        ON change_event.id=occurrence.change_event_id AND change_event.school_id=occurrence.school_id
      LEFT JOIN campus_model_events condition_event
        ON condition_event.id=occurrence.condition_event_id
        AND condition_event.school_id=occurrence.school_id
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
        AND queried_entity.environment_namespace_id=occurrence.environment_namespace_id
        AND queried_entity.domain=${entityDomain} AND queried_entity.domain_id=${entityDomainId}
      WHERE occurrence.school_id=${input.school_id}::uuid
        AND occurrence.environment_namespace_id=${environmentNamespaceId}
        AND occurrence.state='expected'
        AND occurrence.starts_at<=${input.at}::timestamptz AND occurrence.ends_at>${input.at}::timestamptz
        AND occurrence.claim_kind='exclusive'
        AND occurrence.recorded_from<=${recordedAsOf}::timestamptz
        AND (occurrence.recorded_until IS NULL OR occurrence.recorded_until>${recordedAsOf}::timestamptz)
        AND (
          (${humanUserId}::uuid IS NOT NULL AND agent.id IS NOT NULL)
          OR (${humanUserId}::uuid IS NULL AND queried_entity.id IS NOT NULL AND queried_entity.id IN (
            occurrence.class_entity_id,occurrence.subject_entity_id,occurrence.space_entity_id,occurrence.schedule_entity_id
          ))
        )
      ORDER BY occurrence.starts_at,occurrence.period_number,occurrence.id
    `.execute(this.db)).rows;
        const expected = rows.map((row) => ({
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
                occurrence_revision_id: row.occurrence_revision_id,
                schedule_version_id: row.schedule_version_id,
                period_number: row.period_number,
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
                journal_sequence: row.journal_sequence,
                change: {
                    event_id: row.change_event_id,
                    event_type: row.change_event_type,
                    source_domain: row.change_source_domain,
                    source_record_id: row.change_source_record_id,
                    source_revision: row.change_source_revision,
                    journal_sequence: row.change_journal_sequence,
                    change_kind: row.change_kind,
                },
                condition: row.condition_event_id ? {
                    event_id: row.condition_event_id,
                    event_type: row.condition_event_type,
                    source_domain: row.condition_source_domain,
                    source_record_id: row.condition_source_record_id,
                    source_revision: row.condition_source_revision,
                    journal_sequence: row.condition_journal_sequence,
                } : null,
            },
            certainty: "planned",
            freshness: row.current ? "current" : "historical",
            contradictions: [],
        }));
        if (input.subject.type !== "entity")
            return expected;
        const observed = (await sql `
      SELECT DISTINCT ON (observation.subject_entity_id,observation.kind)
        observation.id::text AS assertion_id,observation.kind,COALESCE(history.state,'unknown') AS state,observation.payload,
        history.recorded_at AS state_recorded_at,COALESCE(history.basis,'history_unavailable') AS state_basis,
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
      LEFT JOIN LATERAL (
        SELECT state,recorded_at,basis FROM campus_model_observation_states history
        WHERE history.observation_id=observation.id AND history.realm_id=observation.realm_id
          AND history.environment_namespace_id=observation.environment_namespace_id
          AND history.recorded_at<=${recordedAsOf}::timestamptz
        ORDER BY history.recorded_at DESC,history.sequence DESC LIMIT 1
      ) history ON true
      WHERE queried.school_id=${input.school_id}::uuid
        AND queried.environment_namespace_id=${environmentNamespaceId}
        AND observation.environment_namespace_id=${environmentNamespaceId}
        AND queried.domain=${input.subject.domain}
        AND queried.domain_id=${input.subject.domain_id}
        AND observation.observed_at<=${input.at}::timestamptz
        AND observation.received_at<=${recordedAsOf}::timestamptz
        AND (history.state IS NULL OR history.state IN ('pending','accepted','quarantined'))
      ORDER BY observation.subject_entity_id,observation.kind,observation.observed_at DESC,observation.received_at DESC,observation.id DESC
    `.execute(this.db)).rows;
        return expected.concat(observed.map((row) => ({
            assertion_id: row.assertion_id,
            dimension: row.state === "accepted" ? "accepted" : "observed",
            assertion_type: "direct_observation",
            subject: { type: "entity", id: row.subject_entity_id, label: row.subject_label, kind: row.subject_kind },
            context: row.context_entity_id ? {
                entity_id: row.context_entity_id,
                label: row.context_label,
                kind: row.context_kind,
            } : null,
            observation: { kind: row.kind, state: row.state, payload: row.payload,
                state_recorded_at: row.state_recorded_at, state_basis: row.state_basis },
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
    async listOperatingDay(rawInput) {
        const input = z.object({
            school_id: z.string().uuid(),
            date: z.string().date(),
            recorded_as_of: z.string().datetime({ offset: true }),
            responsible_agent_id: z.string().uuid().optional(),
            class_section_ids: z.array(z.string().uuid()).max(100).optional(),
        }).strict().parse(rawInput);
        const environmentNamespaceId = executionNamespaceForSchool(input.school_id, this.executionScope?.current());
        return (await sql `
      SELECT occurrence.id::text,occurrence.logical_occurrence_key::text AS occurrence_id,
        occurrence.occurrence_date::text,occurrence.period_number,period_entity.domain_id AS period_domain_id,
        class_entity.id::text AS class_entity_id,class_entity.domain_id AS class_domain_id,
        class_entity.label AS class_label,subject_entity.id::text AS subject_entity_id,
        subject_entity.label AS subject_label,space_entity.id::text AS space_entity_id,
        space_entity.label AS space_label,space_entity.domain_id AS space_domain_id,occurrence.responsible_agent_id::text,
        responsible.label AS responsible_agent_label,occurrence.title,occurrence.slot_type,
        occurrence.starts_at,occurrence.ends_at,basis.source_domain,basis.source_record_id,
        basis.source_revision,occurrence.change_kind
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_events basis ON basis.id=occurrence.basis_event_id
        AND basis.school_id=occurrence.school_id
        AND basis.realm_id=occurrence.realm_id
        AND basis.environment_namespace_id=occurrence.environment_namespace_id
      JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
        AND class_entity.realm_id=occurrence.realm_id
        AND class_entity.environment_namespace_id=occurrence.environment_namespace_id
      JOIN campus_model_entities period_entity ON period_entity.id=occurrence.period_entity_id
        AND period_entity.realm_id=occurrence.realm_id
        AND period_entity.environment_namespace_id=occurrence.environment_namespace_id
      LEFT JOIN campus_model_entities subject_entity ON subject_entity.id=occurrence.subject_entity_id
        AND subject_entity.realm_id=occurrence.realm_id
        AND subject_entity.environment_namespace_id=occurrence.environment_namespace_id
      LEFT JOIN campus_model_entities space_entity ON space_entity.id=occurrence.space_entity_id
        AND space_entity.realm_id=occurrence.realm_id
        AND space_entity.environment_namespace_id=occurrence.environment_namespace_id
      LEFT JOIN campus_model_agents responsible ON responsible.id=occurrence.responsible_agent_id
        AND responsible.school_id=occurrence.school_id AND responsible.status='active'
      WHERE occurrence.school_id=${input.school_id}::uuid
        AND occurrence.environment_namespace_id=${environmentNamespaceId}
        AND occurrence.occurrence_date=${input.date}::date
        AND occurrence.state='expected'
        AND occurrence.claim_kind='exclusive'
        AND occurrence.recorded_from<=${input.recorded_as_of}::timestamptz
        AND (occurrence.recorded_until IS NULL OR occurrence.recorded_until>${input.recorded_as_of}::timestamptz)
        AND (${input.responsible_agent_id ?? null}::uuid IS NULL
          OR occurrence.responsible_agent_id=${input.responsible_agent_id ?? null}::uuid)
        AND (${input.class_section_ids === undefined} OR class_entity.domain_id=ANY(${sql.val(input.class_section_ids ?? [])}::text[]))
      ORDER BY occurrence.starts_at,occurrence.period_number,class_entity.label,occurrence.id
      LIMIT 500
    `.execute(this.db)).rows;
    }
    async recordCoordinationException(transaction, input, triggerEventId, exceptionCode, explanation, details) {
        const inserted = (await sql `INSERT INTO campus_model_coordination_exceptions(
        school_id,trigger_event_id,source_outbox_event_id,exception_code,status,selector_key,
        explanation,details,correlation_id
      ) VALUES (
        ${input.school_id}::uuid,${triggerEventId}::uuid,${input.source_outbox_event_id}::uuid,
        ${exceptionCode},'open',${input.selector_input.selector_key},${explanation},
        ${JSON.stringify(details)}::jsonb,${input.correlation_id}::uuid
      ) ON CONFLICT(trigger_event_id) DO NOTHING RETURNING id,exception_code`.execute(transaction)).rows[0];
        const retained = inserted ?? (await sql `SELECT id,exception_code
      FROM campus_model_coordination_exceptions
      WHERE school_id=${input.school_id}::uuid AND trigger_event_id=${triggerEventId}::uuid
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!retained)
            throw new ConflictException("The coordination exception could not be retained.");
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
    async resolveAgentReference(transaction, schoolId, reference) {
        if (reference.agent_kind === "human") {
            const resolved = await this.resolveOrProvisionHumanAgent(transaction, schoolId, reference.user_id);
            return resolved.acting
                ? { id: resolved.agent_id, user_id: resolved.user_id, agent_kind: "human", external_ref: null }
                : undefined;
        }
        return (await sql `SELECT id,NULL::uuid AS user_id,agent_kind,external_ref
      FROM campus_model_agents
      WHERE school_id=${schoolId}::uuid AND agent_kind=${reference.agent_kind}
        AND external_ref=${reference.external_ref} AND status='active'
      FOR SHARE`.execute(transaction)).rows[0];
    }
    async upsertEntity(transaction, schoolId, snapshot, providedScope, semanticType) {
        const modelScope = providedScope ?? await this.resolveScope(transaction, schoolId);
        const result = await sql `
      INSERT INTO campus_model_entities(
        school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata,
        semantic_type_definition_id,semantic_type_version
      ) VALUES (
        ${schoolId}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
        ${snapshot.kind},${snapshot.domain},${snapshot.domain_id},
        ${snapshot.label},${snapshot.lifecycle_state},${snapshot.source_revision},
        ${JSON.stringify(snapshot.metadata)}::jsonb,
        ${semanticType?.id ?? null}::uuid,${semanticType?.version ?? null}
      )
      ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO UPDATE SET
        kind=EXCLUDED.kind,label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
        source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,
        semantic_type_definition_id=COALESCE(EXCLUDED.semantic_type_definition_id,campus_model_entities.semantic_type_definition_id),
        semantic_type_version=COALESCE(EXCLUDED.semantic_type_version,campus_model_entities.semantic_type_version),
        revision=CASE
          WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
            OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
            OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
            OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
            OR campus_model_entities.metadata IS DISTINCT FROM EXCLUDED.metadata
            OR (EXCLUDED.semantic_type_definition_id IS NOT NULL AND campus_model_entities.semantic_type_definition_id IS DISTINCT FROM EXCLUDED.semantic_type_definition_id)
            OR (EXCLUDED.semantic_type_version IS NOT NULL AND campus_model_entities.semantic_type_version IS DISTINCT FROM EXCLUDED.semantic_type_version)
          THEN campus_model_entities.revision+1 ELSE campus_model_entities.revision END,
        updated_at=CASE
          WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
            OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
            OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
            OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
            OR campus_model_entities.metadata IS DISTINCT FROM EXCLUDED.metadata
            OR (EXCLUDED.semantic_type_definition_id IS NOT NULL AND campus_model_entities.semantic_type_definition_id IS DISTINCT FROM EXCLUDED.semantic_type_definition_id)
            OR (EXCLUDED.semantic_type_version IS NOT NULL AND campus_model_entities.semantic_type_version IS DISTINCT FROM EXCLUDED.semantic_type_version)
          THEN now() ELSE campus_model_entities.updated_at END
      RETURNING id,domain,domain_id`.execute(transaction);
        const entity = result.rows[0];
        if (!entity)
            throw new ConflictException("The campus model could not register this domain record.");
        return entity;
    }
    async sealExecutionSnapshot(transaction, rawInput) {
        const input = executionSnapshotInputSchema.parse(rawInput);
        const scope = await this.resolveScope(transaction, input.school_id);
        const environment = this.executionScope?.current();
        const isSimulation = environment?.kind === "simulation";
        if (isSimulation) {
            if (input.snapshot_kind !== "simulation_fork"
                || input.source_snapshot_ref !== environment.source_snapshot_ref) {
                throw new ConflictException("A Simulation run must seal its exact server-selected source snapshot.");
            }
            if (input.actors.some((actor) => actor.actor_mode === "live_agent")) {
                throw new ConflictException("A Live human agent cannot be installed as the actor inside Simulation.");
            }
        }
        else {
            if (input.snapshot_kind === "simulation_fork") {
                throw new ConflictException("A Simulation fork can be sealed only inside its isolated execution environment.");
            }
            if (input.actors.some((actor) => actor.actor_mode !== "live_agent")) {
                throw new ConflictException("Live execution may bind only the stable Live agent identity.");
            }
            if (input.authority_grants.length > 0) {
                throw new ConflictException("Live authority stays effective-dated and cannot be replaced by a frozen Simulation grant set.");
            }
        }
        const normalizedConfiguration = {
            snapshot_kind: input.snapshot_kind,
            source_snapshot_ref: input.source_snapshot_ref,
            core_contract_version: input.core_contract_version,
            source_recorded_at: input.source_recorded_at,
            items: [...input.items].sort((left, right) => `${left.item_kind}:${left.item_key}`.localeCompare(`${right.item_kind}:${right.item_key}`)),
            actors: [...input.actors].sort((left, right) => left.binding_key.localeCompare(right.binding_key)),
            authority_grants: [...input.authority_grants].sort((left, right) => left.source_authority_id.localeCompare(right.source_authority_id)),
        };
        const configurationHash = createHash("sha256")
            .update(JSON.stringify(canonicalJson(normalizedConfiguration)))
            .digest("hex");
        const existing = (await sql `SELECT id,configuration_hash
      FROM campus_model_execution_snapshots
      WHERE realm_id=${scope.realm_id}::uuid AND environment_namespace_id=${scope.environment_namespace_id}
        AND source_snapshot_ref=${input.source_snapshot_ref}
      FOR SHARE`.execute(transaction)).rows[0];
        if (existing) {
            if (existing.configuration_hash !== configurationHash) {
                throw new ConflictException("This source snapshot reference was already sealed with different execution configuration.");
            }
            const counts = (await sql `SELECT
          (SELECT count(*)::int FROM campus_model_execution_snapshot_items WHERE snapshot_id=${existing.id}::uuid) AS item_count,
          (SELECT count(*)::int FROM campus_model_execution_actor_bindings WHERE snapshot_id=${existing.id}::uuid) AS actor_count,
          (SELECT count(*)::int FROM campus_model_authority_snapshot_grants WHERE snapshot_id=${existing.id}::uuid) AS grant_count`
                .execute(transaction)).rows[0];
            return {
                snapshot_id: existing.id,
                realm_id: scope.realm_id,
                environment_namespace_id: scope.environment_namespace_id,
                configuration_hash: configurationHash,
                item_count: counts?.item_count ?? 0,
                actor_count: counts?.actor_count ?? 0,
                authority_grant_count: counts?.grant_count ?? 0,
                replayed: true,
            };
        }
        const snapshot = (await sql `INSERT INTO campus_model_execution_snapshots(
        school_id,realm_id,environment_namespace_id,snapshot_kind,source_snapshot_ref,
        core_contract_version,configuration_hash,source_recorded_at,sealed_at,sealed_by_authority,metadata
      ) VALUES (
        ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},${input.snapshot_kind},
        ${input.source_snapshot_ref},${input.core_contract_version},${configurationHash},
        ${input.source_recorded_at}::timestamptz,${input.sealed_at}::timestamptz,
        ${input.sealed_by_authority},${JSON.stringify(input.metadata)}::jsonb
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!snapshot)
            throw new ConflictException("The execution snapshot could not be sealed.");
        for (const item of input.items) {
            await sql `INSERT INTO campus_model_execution_snapshot_items(
          snapshot_id,realm_id,environment_namespace_id,item_kind,item_key,version_ref,
          content_hash,effective_from,effective_until,source_ref,metadata
        ) VALUES (
          ${snapshot.id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
          ${item.item_kind},${item.item_key},${item.version_ref},${item.content_hash},
          ${item.effective_from}::timestamptz,${item.effective_until}::timestamptz,
          ${item.source_ref},${JSON.stringify(item.metadata)}::jsonb
        )`.execute(transaction);
        }
        for (const actor of input.actors) {
            await sql `INSERT INTO campus_model_execution_actor_bindings(
          school_id,realm_id,environment_namespace_id,source_agent_id,actor_mode,binding_key,
          snapshot_id,behaviour_policy_version_ref,authority_snapshot_ref,status,effective_from,effective_until
        ) VALUES (
          ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
          ${actor.source_agent_id}::uuid,${actor.actor_mode},${actor.binding_key},
          ${isSimulation ? snapshot.id : null}::uuid,${actor.behaviour_policy_version_ref},
          ${actor.authority_snapshot_ref},'active',${actor.effective_from}::timestamptz,
          ${actor.effective_until}::timestamptz
        )`.execute(transaction);
        }
        for (const grant of input.authority_grants) {
            await sql `INSERT INTO campus_model_authority_snapshot_grants(
          snapshot_id,school_id,realm_id,environment_namespace_id,source_authority_id,agent_id,
          capability,scope_entity_id,effective_from,effective_until,operating_rule_version_ref,
          constraints,content_hash
        ) VALUES (
          ${snapshot.id}::uuid,${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
          ${grant.source_authority_id}::uuid,${grant.agent_id}::uuid,${grant.capability},
          ${grant.scope_entity_id}::uuid,${grant.effective_from}::timestamptz,
          ${grant.effective_until}::timestamptz,${grant.operating_rule_version_ref},
          ${JSON.stringify(grant.constraints)}::jsonb,${grant.content_hash}
        )`.execute(transaction);
        }
        return {
            snapshot_id: snapshot.id,
            realm_id: scope.realm_id,
            environment_namespace_id: scope.environment_namespace_id,
            configuration_hash: configurationHash,
            item_count: input.items.length,
            actor_count: input.actors.length,
            authority_grant_count: input.authority_grants.length,
            replayed: false,
        };
    }
    async evaluateAuthority(transaction, rawInput) {
        const input = authorityEvaluationInputSchema.parse(rawInput);
        const scope = await this.resolveScope(transaction, input.school_id);
        const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const existing = (await sql `SELECT id,request_hash,decision,reason_codes,
        authority_source_refs,operating_rule_refs,evaluated_at,valid_until,execution_actor_id
      FROM campus_model_authority_receipts
      WHERE realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id}
        AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
        if (existing) {
            if (existing.request_hash !== requestHash) {
                throw new ConflictException("This authority evaluation key was already used for another decision.");
            }
            return {
                receipt_id: existing.id, realm_id: scope.realm_id,
                environment_namespace_id: scope.environment_namespace_id,
                actor_agent_id: input.actor_agent_id, capability: input.capability, purpose: input.purpose,
                scope_entity_id: input.scope_entity_id, decision: existing.decision,
                reason_codes: existing.reason_codes, authority_source_refs: existing.authority_source_refs,
                operating_rule_refs: existing.operating_rule_refs, evaluated_at: existing.evaluated_at,
                valid_until: existing.valid_until, replayed: true,
            };
        }
        const actor = (await sql `SELECT EXISTS(SELECT 1 FROM campus_model_agents
      WHERE id=${input.actor_agent_id}::uuid AND school_id=${input.school_id}::uuid AND status='active') AS active`
            .execute(transaction)).rows[0]?.active ?? false;
        const selectedEnvironment = this.executionScope?.current();
        let executionActorId = null;
        let snapshotMissing = false;
        let grants = [];
        if (selectedEnvironment?.kind === "simulation") {
            const binding = (await sql `SELECT
          binding.execution_actor_id,binding.snapshot_id
        FROM campus_model_execution_actor_bindings binding
        JOIN campus_model_execution_snapshots snapshot
          ON snapshot.id=binding.snapshot_id AND snapshot.realm_id=binding.realm_id
          AND snapshot.environment_namespace_id=binding.environment_namespace_id
        WHERE binding.realm_id=${scope.realm_id}::uuid
          AND binding.environment_namespace_id=${scope.environment_namespace_id}
          AND snapshot.source_snapshot_ref=${selectedEnvironment.source_snapshot_ref}
          AND binding.source_agent_id=${input.actor_agent_id}::uuid AND binding.status='active'
          AND effective_from<=${input.evaluated_at}::timestamptz
          AND (effective_until IS NULL OR effective_until>${input.evaluated_at}::timestamptz)
        ORDER BY actor_mode='simulation_counterpart' DESC,effective_from DESC LIMIT 1 FOR SHARE`
                .execute(transaction)).rows[0];
            executionActorId = binding?.execution_actor_id ?? null;
            snapshotMissing = !binding;
            if (binding) {
                grants = (await sql `SELECT source_authority_id,operating_rule_version_ref,effective_until
          FROM campus_model_authority_snapshot_grants
          WHERE snapshot_id=${binding.snapshot_id}::uuid AND agent_id=${input.actor_agent_id}::uuid
            AND capability=${input.capability}
            AND effective_from<=${input.evaluated_at}::timestamptz
            AND (effective_until IS NULL OR effective_until>${input.evaluated_at}::timestamptz)
            AND (scope_entity_id IS NULL OR scope_entity_id=${input.scope_entity_id}::uuid)
          ORDER BY scope_entity_id IS NOT NULL DESC,effective_until NULLS LAST,source_authority_id`
                    .execute(transaction)).rows;
            }
        }
        else {
            grants = (await sql `SELECT authority.id AS source_authority_id,
          authority.operating_rule_version_ref,authority.effective_until
        FROM campus_model_agent_authorities authority
        WHERE authority.school_id=${input.school_id}::uuid AND authority.agent_id=${input.actor_agent_id}::uuid
          AND authority.capability=${input.capability} AND authority.revoked_at IS NULL
          AND authority.effective_from<=${input.evaluated_at}::timestamptz
          AND (authority.effective_until IS NULL OR authority.effective_until>${input.evaluated_at}::timestamptz)
          AND (authority.scope_entity_id IS NULL OR authority.scope_entity_id=${input.scope_entity_id}::uuid)
        ORDER BY authority.scope_entity_id IS NOT NULL DESC,authority.effective_until NULLS LAST,authority.id`
                .execute(transaction)).rows;
        }
        const reasons = !actor ? ["actor_inactive"]
            : snapshotMissing ? ["execution_snapshot_or_actor_binding_missing"]
                : grants.length === 0 ? ["capability_not_granted"] : ["effective_grant_found"];
        const decision = actor && !snapshotMissing && grants.length > 0 ? "allowed" : "denied";
        const authoritySources = grants.map((grant) => ({ source_authority_id: grant.source_authority_id }));
        const operatingRules = grants.flatMap((grant) => grant.operating_rule_version_ref
            ? [{ version_ref: grant.operating_rule_version_ref }] : []);
        const expiryValues = grants.flatMap((grant) => grant.effective_until ? [new Date(grant.effective_until)] : []);
        const validUntil = expiryValues.length > 0
            ? new Date(Math.min(...expiryValues.map((value) => value.getTime()))).toISOString()
            : null;
        const inserted = (await sql `INSERT INTO campus_model_authority_receipts(
        school_id,realm_id,environment_namespace_id,actor_agent_id,execution_actor_id,
        capability,purpose,scope_entity_id,decision,reason_codes,authority_source_refs,
        operating_rule_refs,evaluated_at,valid_until,correlation_id,causation_id,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.actor_agent_id}::uuid,${executionActorId}::uuid,${input.capability},${input.purpose},
        ${input.scope_entity_id}::uuid,${decision},${reasons}::text[],${JSON.stringify(authoritySources)}::jsonb,
        ${JSON.stringify(operatingRules)}::jsonb,${input.evaluated_at}::timestamptz,${validUntil}::timestamptz,
        ${input.correlation_id}::uuid,${input.causation_id}::uuid,${input.idempotency_key},${requestHash}
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!inserted)
            throw new ConflictException("The authority evaluation could not be retained.");
        return {
            receipt_id: inserted.id, realm_id: scope.realm_id,
            environment_namespace_id: scope.environment_namespace_id,
            actor_agent_id: input.actor_agent_id, capability: input.capability, purpose: input.purpose,
            scope_entity_id: input.scope_entity_id, decision, reason_codes: reasons,
            authority_source_refs: authoritySources, operating_rule_refs: operatingRules,
            evaluated_at: input.evaluated_at, valid_until: validUntil, replayed: false,
        };
    }
    async readCheckpoint(transaction, schoolId, consumer) {
        const safeConsumer = checkpointConsumerSchema.parse(consumer);
        const scope = await this.resolveScope(transaction, schoolId);
        const row = (await sql `INSERT INTO campus_model_environment_projection_checkpoints(
        realm_id,environment_namespace_id,consumer
      ) VALUES(${scope.realm_id}::uuid,${scope.environment_namespace_id},${safeConsumer})
      ON CONFLICT(realm_id,environment_namespace_id,consumer) DO UPDATE SET consumer=EXCLUDED.consumer
      RETURNING realm_id,environment_namespace_id,consumer,last_delivery_sequence,last_event_id,state,updated_at`
            .execute(transaction)).rows[0];
        if (!row)
            throw new ConflictException("The projection checkpoint could not be resolved.");
        return row;
    }
    async advanceCheckpoint(transaction, schoolId, consumer, deliverySequence, eventId) {
        if (!Number.isSafeInteger(deliverySequence) || deliverySequence < 0) {
            throw new ConflictException("Projection sequence must be a non-negative safe integer.");
        }
        const current = await this.readCheckpoint(transaction, schoolId, consumer);
        if (deliverySequence < current.last_delivery_sequence) {
            throw new ConflictException("A projection checkpoint cannot move backwards.");
        }
        const row = (await sql `UPDATE campus_model_environment_projection_checkpoints SET
        last_delivery_sequence=${deliverySequence},last_event_id=${eventId}::uuid,state='active',
        last_error_code=NULL,updated_at=now()
      WHERE realm_id=${current.realm_id}::uuid
        AND environment_namespace_id=${current.environment_namespace_id}
        AND consumer=${current.consumer}
      RETURNING realm_id,environment_namespace_id,consumer,last_delivery_sequence,last_event_id,state,updated_at`
            .execute(transaction)).rows[0];
        if (!row)
            throw new ConflictException("The projection checkpoint could not be advanced.");
        return row;
    }
    resolveScope(transaction, schoolId) {
        return resolveOperationalRealmScope(transaction, schoolId, this.executionScope?.current());
    }
    async resolveEntityAddress(transaction, schoolId, reference) {
        const scope = await this.resolveScope(transaction, schoolId);
        const entity = (await sql `SELECT id FROM campus_model_entities
      WHERE realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id}
        AND domain=${reference.domain} AND domain_id=${reference.domain_id}
      FOR SHARE`.execute(transaction)).rows[0];
        return entity ? modelAddressSchema.parse({
            realm_id: scope.realm_id,
            environment_namespace_id: scope.environment_namespace_id,
            model_id: entity.id,
        }) : null;
    }
    async resolveObservationContracts(transaction, scope, refs) {
        const result = (await sql `SELECT
      (SELECT definition.id FROM model_semantic_type_definitions definition
        JOIN realm_model_contract_activations activation
          ON activation.realm_id=${scope.realm_id}::uuid
          AND activation.contract_kind='semantic_type'
          AND activation.contract_id=definition.id
          AND activation.contract_version=definition.version
          AND activation.status='active' AND activation.effective_from<=now()
          AND (activation.effective_until IS NULL OR activation.effective_until>now())
        WHERE definition.namespace=${refs.subject_type.namespace}
          AND definition.type_key=${refs.subject_type.type_key}
          AND definition.definition_kind='entity' AND definition.version=${refs.subject_type.version}
          AND definition.status='active' LIMIT 1) AS subject_definition_id,
      ${refs.context_type ? sql `(SELECT definition.id FROM model_semantic_type_definitions definition
        JOIN realm_model_contract_activations activation
          ON activation.realm_id=${scope.realm_id}::uuid
          AND activation.contract_kind='semantic_type'
          AND activation.contract_id=definition.id
          AND activation.contract_version=definition.version
          AND activation.status='active' AND activation.effective_from<=now()
          AND (activation.effective_until IS NULL OR activation.effective_until>now())
        WHERE definition.namespace=${refs.context_type.namespace}
          AND definition.type_key=${refs.context_type.type_key}
          AND definition.definition_kind='entity' AND definition.version=${refs.context_type.version}
          AND definition.status='active' LIMIT 1)` : sql `NULL::uuid`} AS context_definition_id,
      (SELECT definition.id FROM model_protocol_schema_definitions definition
        JOIN realm_model_contract_activations activation
          ON activation.realm_id=${scope.realm_id}::uuid
          AND activation.contract_kind='protocol_schema'
          AND activation.contract_id=definition.id
          AND activation.contract_version=definition.version
          AND activation.status='active' AND activation.effective_from<=now()
          AND (activation.effective_until IS NULL OR activation.effective_until>now())
        WHERE definition.namespace=${refs.observation_schema.namespace}
          AND definition.schema_key=${refs.observation_schema.schema_key}
          AND definition.protocol_kind='observation' AND definition.version=${refs.observation_schema.version}
          AND definition.status='active' LIMIT 1) AS protocol_definition_id,
      (SELECT manifest.id FROM model_capability_manifests manifest
        JOIN realm_model_contract_activations activation
          ON activation.realm_id=${scope.realm_id}::uuid
          AND activation.contract_kind='capability_manifest'
          AND activation.contract_id=manifest.id
          AND activation.contract_version=manifest.version
          AND activation.status='active' AND activation.effective_from<=now()
          AND (activation.effective_until IS NULL OR activation.effective_until>now())
        WHERE manifest.namespace=${refs.capability_manifest.namespace}
          AND manifest.capability_key=${refs.capability_manifest.capability_key}
          AND manifest.version=${refs.capability_manifest.version}
          AND manifest.status='active' LIMIT 1) AS capability_manifest_id`.execute(transaction)).rows[0];
        if (!result?.subject_definition_id
            || (refs.context_type && !result.context_definition_id)
            || !result?.protocol_definition_id
            || !result?.capability_manifest_id) {
            throw new ConflictException("The observation adapter contract is not activated for this operational realm.");
        }
        return {
            subject_type: { id: result.subject_definition_id, ...refs.subject_type },
            context_type: refs.context_type && result.context_definition_id
                ? { id: result.context_definition_id, ...refs.context_type }
                : null,
            observation_schema: { id: result.protocol_definition_id, ...refs.observation_schema },
            capability_manifest: { id: result.capability_manifest_id, ...refs.capability_manifest },
        };
    }
    key(reference) {
        return `${reference.domain}:${reference.domain_id}`;
    }
    resolve(entities, reference) {
        const id = entities.get(this.key(reference));
        if (!id)
            throw new ConflictException("The connected campus reference is missing from this command.");
        return id;
    }
    assertAcceptedSubstitutionOccurrenceKey(input) {
        const expectedOccurrenceKey = createHash("sha256").update([
            input.school_id,
            input.class_section.domain_id,
            input.duty_date,
            String(input.period_number),
        ].join(":")).digest("hex");
        if (input.occurrence_key !== expectedOccurrenceKey) {
            throw new ConflictException("The accepted cover does not identify this class occurrence.");
        }
    }
    async requireRetainedHumanAgent(transaction, schoolId, userId) {
        const retained = (await sql `SELECT agent.id
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent
        ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      JOIN school_people person
        ON person.id=agent.person_id AND person.school_id=agent.school_id
      WHERE endpoint.school_id=${schoolId}::uuid
        AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus'
        AND endpoint.user_id=${userId}::uuid
        AND agent.agent_kind='human'
      ORDER BY endpoint.effective_from DESC,endpoint.id DESC
      FOR SHARE OF endpoint,agent,person`.execute(transaction)).rows;
        const agentIds = [...new Set(retained.map((row) => row.id))];
        if (agentIds.length === 0) {
            throw new ConflictException("The historical campus account is not linked to a retained person agent.");
        }
        if (agentIds.length > 1) {
            throw new ConflictException("The historical campus account resolves to more than one retained person agent.");
        }
        return { id: agentIds[0] };
    }
    async ensureHumanAgent(transaction, schoolId, userId) {
        const resolved = await this.resolveOrProvisionHumanAgent(transaction, schoolId, userId);
        if (!resolved.acting) {
            throw new ConflictException(this.humanAgentResolutionMessage(resolved.reason));
        }
        return { id: resolved.agent_id };
    }
    async resolveOrProvisionHumanAgent(transaction, schoolId, userId) {
        const now = executionNow().toISOString();
        let resolved = await this.resolveAccountEndpointIn(transaction, schoolId, userId, now);
        if (resolved.acting || resolved.reason !== "account_not_linked")
            return resolved;
        await sql `SELECT pg_advisory_xact_lock(hashtext(
      'campus-human-agent:'||${schoolId}::text||':'||${userId}::text
    ))`.execute(transaction);
        resolved = await this.resolveAccountEndpointIn(transaction, schoolId, userId, now);
        if (resolved.acting || resolved.reason !== "account_not_linked")
            return resolved;
        const account = (await sql `SELECT
        account.is_active,
        EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=account.id
            AND membership.is_active) AS active_member
      FROM users account WHERE account.id=${userId}::uuid FOR SHARE`.execute(transaction)).rows[0];
        if (!account)
            return this.nonActing(schoolId, null, userId, null, "account_not_linked");
        if (!account.is_active)
            return this.nonActing(schoolId, null, userId, null, "account_inactive");
        if (!account.active_member)
            return this.nonActing(schoolId, null, userId, null, "membership_inactive");
        const candidates = (await sql `SELECT person_id,
        array_agg(source_kind ORDER BY source_kind)::text[] AS source_kinds
      FROM (
        SELECT id AS person_id,'person_account'::text AS source_kind FROM school_people
        WHERE school_id=${schoolId}::uuid AND account_user_id=${userId}::uuid
        UNION ALL
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
        const mayAct = (await sql `SELECT EXISTS(
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid
        AND membership.is_active AND (
          membership.role='admin'
          OR (membership.role='member' AND EXISTS(SELECT 1 FROM school_people person
            WHERE person.school_id=membership.school_id AND person.id=${personId}::uuid AND person.account_user_id=membership.user_id AND person.retired_at IS NULL))
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
    ) AS found`.execute(transaction)).rows[0].found;
        if (!mayAct)
            return this.nonActing(schoolId, personId, userId, null, "profile_unlinked");
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
            metadata: { bootstrap: "explicit_identity", identity_sources: candidates[0].source_kinds },
        });
        return linked;
    }
    async resolveAccountEndpointIn(transaction, schoolId, userId, at) {
        const resolved = (await sql `SELECT eligible.*
      FROM campus_model_current_account_endpoints(${schoolId}::uuid,${userId}::uuid,${at}::timestamptz) eligible
      JOIN campus_model_agent_endpoints endpoint ON endpoint.id=eligible.endpoint_id AND endpoint.school_id=eligible.school_id
      JOIN campus_model_agents agent ON agent.id=eligible.agent_id AND agent.school_id=eligible.school_id
      JOIN users account ON account.id=eligible.user_id
      JOIN school_people person ON person.id=eligible.person_id AND person.school_id=eligible.school_id
      ORDER BY eligible.effective_from DESC,eligible.endpoint_id DESC LIMIT 1
      FOR SHARE OF endpoint,agent,account,person`.execute(transaction)).rows[0];
        if (resolved)
            return { acting: true, ...resolved };
        const diagnostic = (await sql `WITH explicit_person AS (
        SELECT id AS person_id FROM school_people WHERE school_id=${schoolId}::uuid AND account_user_id=${userId}::uuid
        UNION
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
              OR (membership.role='member' AND EXISTS(SELECT 1 FROM school_people person WHERE person.school_id=endpoint.school_id
                AND person.id=agent.person_id AND person.account_user_id=endpoint.user_id AND person.retired_at IS NULL))
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
        if (!diagnostic)
            return this.nonActing(schoolId, null, userId, null, "account_not_linked");
        let reason;
        if (!diagnostic.account_active)
            reason = "account_inactive";
        else if (!diagnostic.membership_active)
            reason = "membership_inactive";
        else if (!diagnostic.profile_linked)
            reason = "profile_unlinked";
        else
            reason = "endpoint_inactive";
        return this.nonActing(schoolId, diagnostic.person_id, userId, diagnostic.agent_id, reason);
    }
    nonActing(schoolId, personId, userId, agentId, reason) {
        return { acting: false, school_id: schoolId, person_id: personId, user_id: userId, agent_id: agentId, reason };
    }
    humanAgentResolutionMessage(reason) {
        const messages = {
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
    async requireAuthorizedExternalAgent(transaction, schoolId, source, sourceType, context) {
        if (!["attendance.capture", "gate.movement"].includes(sourceType)) {
            throw new ConflictException("This observation type is not enabled for registered sources.");
        }
        const modelScope = await this.resolveScope(transaction, schoolId);
        const contextEntity = context ? (await sql `SELECT id FROM campus_model_entities
      WHERE realm_id=${modelScope.realm_id}::uuid
        AND environment_namespace_id=${modelScope.environment_namespace_id}
        AND domain=${context.domain} AND domain_id=${context.domain_id}`.execute(transaction)).rows[0] : null;
        const capability = `observe:${sourceType}`;
        const agent = (await sql `WITH RECURSIVE context_scope AS (
        SELECT ${contextEntity?.id ?? null}::uuid AS id
        UNION
        SELECT relationship.target_entity_id FROM campus_model_relationships relationship
        JOIN context_scope child ON child.id=relationship.source_entity_id
        WHERE relationship.realm_id=${modelScope.realm_id}::uuid
          AND relationship.environment_namespace_id=${modelScope.environment_namespace_id}
          AND relationship.relation_type IN ('part_of','located_in','home_space')
          AND relationship.effective_from<=now() AND relationship.effective_until IS NULL
      )
      SELECT agent.id FROM campus_model_agents agent
      JOIN campus_model_agent_authorities authority ON authority.agent_id=agent.id AND authority.school_id=agent.school_id
      WHERE agent.school_id=${schoolId}::uuid AND agent.agent_kind=${source.kind} AND agent.external_ref=${source.external_ref}
        AND agent.status='active' AND authority.capability=${capability} AND authority.revoked_at IS NULL
        AND authority.effective_from<=now() AND (authority.effective_until IS NULL OR authority.effective_until>now())
        AND (authority.scope_entity_id IS NULL OR authority.scope_entity_id IN (SELECT id FROM context_scope))
      LIMIT 1 FOR UPDATE OF agent`.execute(transaction)).rows[0];
        if (!agent)
            throw new ConflictException("This device or connection is not active or is outside its approved scope.");
        return agent;
    }
    async listRecordedSoftwareActors(transaction, rawInput) {
        const input = z.object({ school_id: uuid, agent_ids: z.array(uuid).max(2000) }).strict().parse(rawInput);
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore();
        const namespace = executionNamespaceForSchool(input.school_id, environment);
        const executor = (await sql `SELECT current_setting('thatcampus.namespace_id',true) AS namespace`.execute(transaction)).rows[0];
        if (environment?.kind === 'simulation' ? executor?.namespace !== namespace
            : Boolean(executor?.namespace && executor.namespace !== namespace)) {
            throw new ForbiddenException('Historical actor attribution requires the selected execution data plane.');
        }
        if (!input.agent_ids.length)
            return [];
        // An inactive actor can still have signed an accepted historical command.
        // Do not turn this read into a current authority or behaviour evaluation.
        return (await sql `SELECT actor.id AS agent_id FROM campus_model_agents actor
      JOIN operational_realms realm ON realm.legacy_school_id=actor.school_id
      JOIN execution_environment_namespaces namespace ON namespace.realm_id=realm.id AND namespace.namespace_id=${namespace}
      WHERE actor.school_id=${input.school_id}::uuid AND actor.id=ANY(${input.agent_ids}::uuid[]) AND actor.agent_kind='software'
        AND EXISTS(SELECT 1 FROM campus_model_commands command WHERE command.school_id=actor.school_id
          AND command.actor_agent_id=actor.id AND command.realm_id=realm.id
          AND command.environment_namespace_id=namespace.namespace_id AND command.state='accepted')
      ORDER BY actor.id`.execute(transaction)).rows;
    }
    async configureSoftwareActor(transaction, rawInput) {
        const input = configuredSoftwareActorSchema.parse(rawInput);
        const approver = await this.ensureHumanAgent(transaction, input.school_id, input.approved_by_user_id);
        const configuration = {
            schema_version: 1, profile: "configured_domain_command", source_domain: input.source_domain,
            source_record_id: input.source_record_id, source_revision: input.source_revision,
            configuration_hash: input.configuration_hash, operating_rule_ref: input.operating_rule_ref,
            allowed_commands: [...input.allowed_commands].sort(),
        };
        const hash = createHash("sha256").update(JSON.stringify(canonicalJson(configuration))).digest("hex");
        const externalRef = `configured:${input.source_domain}:${hash}`;
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`${input.school_id}:${externalRef}`},0))`.execute(transaction);
        const actor = (await sql `INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status,metadata)
      VALUES(${input.school_id}::uuid,'software',${externalRef},${input.label},'active',
        ${JSON.stringify({ configuration_source: input.source_domain, policy_ref: input.operating_rule_ref, configuration_hash: hash })}::jsonb)
      ON CONFLICT(school_id,agent_kind,external_ref) WHERE external_ref IS NOT NULL DO NOTHING RETURNING id`.execute(transaction)).rows[0]
            ?? (await sql `SELECT id FROM campus_model_agents WHERE school_id=${input.school_id}::uuid
        AND agent_kind='software' AND external_ref=${externalRef} AND status='active'`.execute(transaction)).rows[0];
        if (!actor)
            throw new ForbiddenException("The configured software actor has been suspended or revoked.");
        const config = { ...configuration, agent_external_ref: externalRef };
        const key = `configured_command_${hash.slice(0, 32)}`;
        const behavior = (await sql `INSERT INTO campus_model_behaviour_versions(
      school_id,behaviour_key,version,status,effective_from,configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
      VALUES(${input.school_id}::uuid,${key},1,'approved',${input.effective_from}::timestamptz,${JSON.stringify(config)}::jsonb,
        1,${approver.id}::uuid,${approver.id}::uuid,${input.approved_at}::timestamptz)
      ON CONFLICT(school_id,behaviour_key,version) DO NOTHING RETURNING id`.execute(transaction)).rows[0]
            ?? (await sql `SELECT id FROM campus_model_behaviour_versions WHERE school_id=${input.school_id}::uuid
        AND behaviour_key=${key} AND version=1 AND status='approved'`.execute(transaction)).rows[0];
        if (!behavior)
            throw new ForbiddenException("The configured software behavior is not active.");
        return { agent_id: actor.id, behaviour_version_id: behavior.id };
    }
    async requireConfiguredSoftwareActor(transaction, schoolId, agentId, behaviorId, sourceDomain, at, command, operatingRule) {
        const actor = (await sql `SELECT actor.id FROM campus_model_agents actor
      JOIN campus_model_behaviour_versions behavior ON behavior.school_id=actor.school_id AND behavior.id=${behaviorId}::uuid
      WHERE actor.school_id=${schoolId}::uuid AND actor.id=${agentId}::uuid AND actor.agent_kind='software' AND actor.status='active'
        AND behavior.status='approved' AND behavior.approved_by_agent_id IS NOT NULL AND behavior.approved_at IS NOT NULL
        AND behavior.effective_from<=${at}::timestamptz AND (behavior.effective_until IS NULL OR behavior.effective_until>${at}::timestamptz)
        AND behavior.configuration->>'profile'='configured_domain_command'
        AND behavior.configuration->>'source_domain'=${sourceDomain}
        AND behavior.configuration->>'agent_external_ref'=actor.external_ref
        AND (${command ?? null}::text IS NULL OR (behavior.configuration->'allowed_commands') ? ${command ?? ""})
        AND (${operatingRule ?? null}::text IS NULL OR behavior.configuration->>'operating_rule_ref'=${operatingRule ?? null})
      FOR SHARE OF actor,behavior`.execute(transaction)).rows[0];
        if (!actor)
            throw new ForbiddenException("This software command has no matching active approved behavior and Operating rule.");
        return actor;
    }
    async readDomainCommandReceipt(transaction, rawInput) {
        const input = z.object({
            school_id: z.uuid(), actor_user_id: z.uuid(),
            source_domain: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
            handler_key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
            handler_version: z.number().int().positive(),
            idempotency_key: z.string().trim().min(8).max(240),
        }).strict().parse(rawInput);
        const scope = await this.resolveScope(transaction, input.school_id);
        const actor = await this.resolveAccountEndpoint(transaction, {
            school_id: input.school_id, user_id: input.actor_user_id, at: executionNow().toISOString(),
        });
        if (!actor.acting)
            throw new ForbiddenException(this.humanAgentResolutionMessage(actor.reason));
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`domain-command:${scope.realm_id}:${scope.environment_namespace_id}:${input.idempotency_key}`},0))`.execute(transaction);
        const row = (await sql `SELECT command.id,command.command_type,command.state,command.actor_agent_id,target.kind,target.domain,target.domain_id,
      command.expected_revision,command.safe_context,outcome.status,outcome.code,outcome.explanation,
      outcome.resulting_revision,outcome.domain_event_id,outcome.metadata
      FROM campus_model_commands command JOIN campus_model_entities target ON target.id=command.target_entity_id
        AND target.school_id=command.school_id AND target.realm_id=command.realm_id
        AND target.environment_namespace_id=command.environment_namespace_id
      LEFT JOIN LATERAL(SELECT retained.status,retained.code,retained.explanation,retained.resulting_revision,retained.domain_event_id,retained.metadata
        FROM campus_model_command_outcomes retained WHERE retained.command_id=command.id ORDER BY retained.sequence DESC LIMIT 1) outcome ON true
      WHERE command.school_id=${input.school_id}::uuid AND command.realm_id=${scope.realm_id}::uuid
        AND command.environment_namespace_id=${scope.environment_namespace_id} AND command.actor_agent_id=${actor.agent_id}::uuid
        AND command.source_domain=${input.source_domain} AND command.handler_key=${input.handler_key}
        AND command.handler_version=${input.handler_version} AND command.idempotency_key=${input.idempotency_key}
      FOR UPDATE OF command`.execute(transaction)).rows[0];
        if (!row)
            return null;
        const retained = {
            command_type: row.command_type, actor_agent_id: row.actor_agent_id,
            target: { kind: row.kind, domain: row.domain, domain_id: row.domain_id },
            expected_revision: Number(row.expected_revision), safe_context: row.safe_context,
        };
        if (row.state === "pending")
            return { ...retained, state: "pending", receipt: null };
        if (!row.status || !row.code || !row.explanation) {
            throw new ConflictException("The retained command outcome is unavailable. Review its source before retrying.");
        }
        return {
            ...retained, state: "completed", receipt: {
                status: "completed", command_id: row.id, terminal_state: row.status, code: row.code,
                explanation: row.explanation, resulting_revision: row.resulting_revision,
                domain_event_id: row.domain_event_id, metadata: row.metadata ?? {}, replayed: true,
            },
        };
    }
    async prepareDomainCommand(transaction, rawInput) {
        const input = prepareDomainCommandSchema.parse(rawInput);
        return this.prepareDomainCommandForActor(transaction, input);
    }
    async prepareSoftwareCommand(transaction, rawInput) {
        const input = prepareSoftwareCommandSchema.parse(rawInput);
        if (!input.operating_rule_version_ref || !input.authority_attestation
            || input.authority_attestation.evaluator_domain !== input.source_domain) {
            throw new ForbiddenException("An automated command requires a current owning-domain authority and explicit Operating-rule reference.");
        }
        return this.prepareDomainCommandForActor(transaction, input);
    }
    async verifyPreparedDomainCommand(transaction, rawInput) {
        const input = z.object({ school_id: uuid, actor_user_id: uuid, command_id: uuid, correlation_id: uuid,
            source_domain: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), required_capability: z.string().trim().min(3).max(120),
            allowed_command_types: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/)).min(1).max(32),
        }).strict().parse(rawInput);
        if (!this.freshlyPreparedDomainCommands.get(transaction)?.has(input.command_id)) {
            throw new ConflictException("This domain effect requires a freshly authorized command prepared in the same owning transaction.");
        }
        const environment = this.executionScope?.current() ?? executionEnvironmentStorage.getStore(), now = executionNow().toISOString();
        const actor = await this.resolveAccountEndpoint(transaction, { school_id: input.school_id, user_id: input.actor_user_id, at: now });
        if (!actor.acting)
            throw new ForbiddenException("A current campus identity is required to verify this domain command.");
        const scope = await resolveOperationalRealmScope(transaction, input.school_id, environment);
        const command = (await sql `SELECT command.command_type,command.expected_revision,command.safe_context
      FROM campus_model_commands command JOIN campus_model_entities target ON target.id=command.target_entity_id
        AND target.school_id=command.school_id AND target.realm_id=command.realm_id
        AND target.environment_namespace_id=command.environment_namespace_id AND target.domain=command.source_domain
      JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
        AND authority.school_id=command.school_id AND authority.realm_id=command.realm_id
        AND authority.environment_namespace_id=command.environment_namespace_id
        AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id
        AND authority.correlation_id=command.correlation_id AND authority.decision='allowed'
        AND authority.capability=${input.required_capability} AND authority.evaluated_at=command.requested_at
        AND authority.evaluated_at<=${now}::timestamptz AND (authority.valid_until IS NULL OR authority.valid_until>${now}::timestamptz)
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(authority.authority_source_refs) evidence
          WHERE evidence->>'evaluator_domain'=command.source_domain)
      WHERE command.id=${input.command_id}::uuid AND command.school_id=${input.school_id}::uuid
        AND command.realm_id=${scope.realm_id}::uuid AND command.environment_namespace_id=${scope.environment_namespace_id}
        AND command.state='pending' AND command.actor_agent_id=${actor.agent_id}::uuid
        AND command.correlation_id=${input.correlation_id}::uuid AND command.source_domain=${input.source_domain}
        AND command.command_type=ANY(${input.allowed_command_types}::text[])
        AND (${environment?.kind !== "simulation"} OR EXISTS(
          SELECT 1 FROM campus_model_execution_actor_bindings binding
          JOIN campus_model_execution_snapshots snapshot ON snapshot.id=binding.snapshot_id
            AND snapshot.realm_id=binding.realm_id AND snapshot.environment_namespace_id=binding.environment_namespace_id
          WHERE binding.execution_actor_id=authority.execution_actor_id AND binding.source_agent_id=command.actor_agent_id
            AND binding.school_id=command.school_id AND binding.realm_id=command.realm_id
            AND binding.environment_namespace_id=command.environment_namespace_id
            AND binding.actor_mode='simulation_counterpart' AND binding.status='active'
            AND binding.effective_from<=${now}::timestamptz AND (binding.effective_until IS NULL OR binding.effective_until>${now}::timestamptz)
            AND snapshot.source_snapshot_ref=${environment?.source_snapshot_ref ?? null}
            AND binding.authority_snapshot_ref=snapshot.source_snapshot_ref))
      FOR UPDATE OF command`.execute(transaction)).rows[0];
        if (!command)
            throw new ConflictException("The domain command, actor, current authority, source or selected execution environment does not match this effect.");
        return command;
    }
    async prepareDomainCommandForActor(transaction, input) {
        if (input.current_revision !== input.expected_revision) {
            throw new ConflictException("The command target changed. Refresh before continuing.");
        }
        const scope = await this.resolveScope(transaction, input.school_id);
        const requestHash = createHash("sha256")
            .update(JSON.stringify(canonicalJson(input)))
            .digest("hex");
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(
      ${`domain-command:${scope.realm_id}:${scope.environment_namespace_id}:${input.idempotency_key}`},0
    ))`.execute(transaction);
        const existing = (await sql `SELECT command.id,command.request_hash,command.state,command.target_entity_id,
        command.actor_agent_id,command.authority_receipt_id,outcome.status,outcome.code,
        outcome.explanation,outcome.resulting_revision,outcome.domain_event_id,outcome.metadata
      FROM campus_model_commands command
      LEFT JOIN LATERAL (
        SELECT retained.status,retained.code,retained.explanation,retained.resulting_revision,
          retained.domain_event_id,retained.metadata
        FROM campus_model_command_outcomes retained
        WHERE retained.command_id=command.id ORDER BY retained.sequence DESC LIMIT 1
      ) outcome ON true
      WHERE command.realm_id=${scope.realm_id}::uuid
        AND command.environment_namespace_id=${scope.environment_namespace_id}
        AND command.idempotency_key=${input.idempotency_key}
      FOR UPDATE OF command`.execute(transaction)).rows[0];
        if (existing) {
            if (existing.request_hash !== requestHash) {
                throw new ConflictException("This command key was already used for different work.");
            }
            if (existing.state === "pending") {
                return {
                    status: "ready", command_id: existing.id, realm_id: scope.realm_id,
                    environment_namespace_id: scope.environment_namespace_id,
                    target_entity_id: existing.target_entity_id, actor_agent_id: existing.actor_agent_id,
                    authority_receipt_id: existing.authority_receipt_id, request_hash: requestHash, replayed: true,
                };
            }
            if (!existing.status || !existing.code || !existing.explanation) {
                throw new ConflictException("The retained command is terminal but its outcome is unavailable.");
            }
            return {
                status: "completed", command_id: existing.id, terminal_state: existing.status,
                code: existing.code, explanation: existing.explanation,
                resulting_revision: existing.resulting_revision, domain_event_id: existing.domain_event_id,
                metadata: existing.metadata ?? {}, replayed: true,
            };
        }
        const software = "actor_agent_id" in input
            ? await this.requireConfiguredSoftwareActor(transaction, input.school_id, input.actor_agent_id, input.behaviour_version_id, input.source_domain, input.requested_at, input.command_type, input.operating_rule_version_ref)
            : null;
        const actor = software ? { acting: true, agent_id: software.id }
            : await this.resolveAccountEndpointIn(transaction, input.school_id, input.actor_user_id, input.requested_at);
        if (!actor.acting) {
            throw new ForbiddenException(this.humanAgentResolutionMessage(actor.reason));
        }
        const target = await this.upsertEntity(transaction, input.school_id, input.target, scope);
        const authority = input.authority_attestation
            ? await this.retainDomainAuthorityAttestation(transaction, {
                school_id: input.school_id,
                realm_id: scope.realm_id,
                environment_namespace_id: scope.environment_namespace_id,
                actor_agent_id: actor.agent_id,
                scope_entity_id: target.id,
                capability: input.capability,
                purpose: input.purpose,
                evaluated_at: input.requested_at,
                correlation_id: input.correlation_id,
                causation_id: input.causation_id,
                idempotency_key: `${input.idempotency_key}:authority`,
                attestation: input.authority_attestation,
            })
            : await this.evaluateAuthority(transaction, {
                school_id: input.school_id,
                actor_agent_id: actor.agent_id,
                capability: input.capability,
                purpose: input.purpose,
                scope_entity_id: target.id,
                evaluated_at: input.requested_at,
                correlation_id: input.correlation_id,
                causation_id: input.causation_id,
                idempotency_key: `${input.idempotency_key}:authority`,
            });
        if (authority.decision !== "allowed") {
            throw new ForbiddenException("The current campus authority does not allow this action.");
        }
        const inserted = (await sql `INSERT INTO campus_model_commands(
        school_id,realm_id,environment_namespace_id,command_type,target_entity_id,actor_agent_id,
        state,requested_at,effective_at,expected_revision,authority_evidence,authority_receipt_id,
        operating_rule_version_ref,correlation_id,causation_id,idempotency_key,source_domain,
        safe_context,request_hash,handler_key,handler_version,configuration_refs,execution_started_at
      ) VALUES (
        ${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.command_type},${target.id}::uuid,${actor.agent_id}::uuid,'pending',
        ${input.requested_at}::timestamptz,${input.requested_at}::timestamptz,${input.expected_revision},
        ${authority.authority_source_refs.map((ref) => JSON.stringify(ref))}::text[],
        ${authority.receipt_id}::uuid,${input.operating_rule_version_ref},${input.correlation_id}::uuid,
        ${input.causation_id}::uuid,${input.idempotency_key},${input.source_domain},
        ${JSON.stringify({ ...input.safe_context, ...(typeof input.safe_context.accepted_change_hash === "string"
                // COW rebases address columns, not this Core-issued receipt commitment.
                // An inherited pending Live command cannot authorize a new world's projection.
                ? { accepted_change_scope_hash: acceptedChangeScopeHash(input.safe_context.accepted_change_hash, scope.realm_id, scope.environment_namespace_id) } : {}) })}::jsonb,${requestHash},${input.handler_key},
        ${input.handler_version},${JSON.stringify(input.configuration_refs)}::jsonb,
        ${input.requested_at}::timestamptz
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!inserted)
            throw new ConflictException("The domain command could not be retained.");
        const freshlyPrepared = this.freshlyPreparedDomainCommands.get(transaction) ?? new Set();
        freshlyPrepared.add(inserted.id);
        this.freshlyPreparedDomainCommands.set(transaction, freshlyPrepared);
        return {
            status: "ready", command_id: inserted.id, realm_id: scope.realm_id,
            environment_namespace_id: scope.environment_namespace_id,
            target_entity_id: target.id, actor_agent_id: actor.agent_id,
            authority_receipt_id: authority.receipt_id, request_hash: requestHash, replayed: false,
        };
    }
    async completeDomainCommand(transaction, rawInput) {
        const input = completeDomainCommandSchema.parse(rawInput);
        const scope = await this.resolveScope(transaction, input.school_id);
        const command = (await sql `SELECT state,target_entity_id
      FROM campus_model_commands WHERE id=${input.command_id}::uuid
        AND school_id=${input.school_id}::uuid AND realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!command)
            throw new ConflictException("The prepared domain command was not found in this execution environment.");
        const prior = (await sql `SELECT id,status,code,explanation,resulting_revision,domain_event_id,metadata
      FROM campus_model_command_outcomes WHERE command_id=${input.command_id}::uuid
      ORDER BY sequence DESC LIMIT 1`.execute(transaction)).rows[0];
        if (command.state !== "pending") {
            if (!prior || prior.status !== input.terminal_state || prior.code !== input.code
                || prior.resulting_revision !== input.resulting_revision || prior.domain_event_id !== input.domain_event_id
                || JSON.stringify(canonicalJson(prior.metadata)) !== JSON.stringify(canonicalJson(input.metadata))) {
                throw new ConflictException("The command already has a different terminal outcome.");
            }
            return { ...input, outcome_id: prior.id, replayed: true };
        }
        await sql `UPDATE campus_model_commands SET state=${input.terminal_state},completed_at=${input.completed_at}::timestamptz,
        updated_at=${input.completed_at}::timestamptz
      WHERE id=${input.command_id}::uuid`.execute(transaction);
        const outcome = (await sql `INSERT INTO campus_model_command_outcomes(
        command_id,realm_id,environment_namespace_id,sequence,status,code,explanation,
        resulting_entity_id,resulting_revision,domain_event_id,metadata,recorded_at
      ) VALUES (
        ${input.command_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},1,
        ${input.terminal_state},${input.code},${input.explanation},${command.target_entity_id}::uuid,
        ${input.resulting_revision},${input.domain_event_id}::uuid,${JSON.stringify(input.metadata)}::jsonb,
        ${input.completed_at}::timestamptz
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!outcome)
            throw new ConflictException("The domain command outcome could not be retained.");
        return { ...input, outcome_id: outcome.id, replayed: false };
    }
    async retainDomainAuthorityAttestation(transaction, input) {
        const selectedEnvironment = this.executionScope?.current();
        let executionActorId = null;
        const simulationProvenance = [];
        if (selectedEnvironment?.kind === "simulation") {
            if (selectedEnvironment.namespace_id !== input.environment_namespace_id
                || selectedEnvironment.institution_id !== input.school_id) {
                throw new ForbiddenException("The Simulation domain attestation does not belong to this execution environment.");
            }
            const binding = (await sql `SELECT
          binding.execution_actor_id,binding.snapshot_id,binding.actor_mode,
          binding.authority_snapshot_ref,snapshot.source_snapshot_ref
        FROM campus_model_execution_actor_bindings binding
        JOIN campus_model_execution_snapshots snapshot
          ON snapshot.id=binding.snapshot_id AND snapshot.realm_id=binding.realm_id
          AND snapshot.environment_namespace_id=binding.environment_namespace_id
        WHERE binding.realm_id=${input.realm_id}::uuid
          AND binding.environment_namespace_id=${input.environment_namespace_id}
          AND binding.school_id=${input.school_id}::uuid
          AND binding.source_agent_id=${input.actor_agent_id}::uuid
          AND binding.actor_mode='simulation_counterpart' AND binding.status='active'
          AND snapshot.snapshot_kind='simulation_fork'
          AND snapshot.source_snapshot_ref=${selectedEnvironment.source_snapshot_ref}
          AND binding.authority_snapshot_ref=${selectedEnvironment.source_snapshot_ref}
          AND binding.effective_from<=${input.evaluated_at}::timestamptz
          AND (binding.effective_until IS NULL OR binding.effective_until>${input.evaluated_at}::timestamptz)
        ORDER BY binding.effective_from DESC LIMIT 1 FOR SHARE OF binding,snapshot`
                .execute(transaction)).rows[0];
            const verified = assertSimulationDomainAttestationBinding(binding, selectedEnvironment.source_snapshot_ref);
            executionActorId = verified.execution_actor_id;
            simulationProvenance.push({
                evidence_kind: "simulation_domain_attestation",
                run_id: selectedEnvironment.run_id,
                execution_actor_id: verified.execution_actor_id,
                execution_snapshot_id: verified.snapshot_id,
                source_snapshot_ref: verified.source_snapshot_ref,
            });
        }
        const authoritySourceRefs = [
            { evaluator_domain: input.attestation.evaluator_domain },
            ...input.attestation.authority_source_refs,
            ...simulationProvenance,
        ];
        const retainedRequest = executionActorId
            ? { ...input, execution_actor_id: executionActorId }
            : input;
        const requestHash = createHash("sha256")
            .update(JSON.stringify(canonicalJson(retainedRequest)))
            .digest("hex");
        const existing = (await sql `SELECT id,request_hash,decision,reason_codes,
        authority_source_refs,operating_rule_refs,evaluated_at,valid_until,execution_actor_id
      FROM campus_model_authority_receipts
      WHERE realm_id=${input.realm_id}::uuid
        AND environment_namespace_id=${input.environment_namespace_id}
        AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
        if (existing) {
            if (existing.request_hash !== requestHash) {
                throw new ConflictException("This authority-attestation key was already used for another decision.");
            }
            return {
                receipt_id: existing.id, realm_id: input.realm_id,
                environment_namespace_id: input.environment_namespace_id,
                actor_agent_id: input.actor_agent_id, capability: input.capability, purpose: input.purpose,
                scope_entity_id: input.scope_entity_id, decision: existing.decision,
                reason_codes: existing.reason_codes, authority_source_refs: existing.authority_source_refs,
                operating_rule_refs: existing.operating_rule_refs, evaluated_at: existing.evaluated_at,
                valid_until: existing.valid_until, replayed: true,
            };
        }
        const retained = (await sql `INSERT INTO campus_model_authority_receipts(
        school_id,realm_id,environment_namespace_id,actor_agent_id,execution_actor_id,capability,
        purpose,scope_entity_id,decision,reason_codes,authority_source_refs,operating_rule_refs,
        evaluated_at,valid_until,correlation_id,causation_id,idempotency_key,request_hash
      ) VALUES (
        ${input.school_id}::uuid,${input.realm_id}::uuid,${input.environment_namespace_id},
        ${input.actor_agent_id}::uuid,${executionActorId}::uuid,${input.capability},${input.purpose},${input.scope_entity_id}::uuid,
        ${input.attestation.decision},${input.attestation.reason_codes}::text[],
        ${JSON.stringify(authoritySourceRefs)}::jsonb,
        ${JSON.stringify(input.attestation.operating_rule_refs)}::jsonb,${input.evaluated_at}::timestamptz,
        ${input.attestation.valid_until}::timestamptz,${input.correlation_id}::uuid,
        ${input.causation_id}::uuid,${input.idempotency_key},${requestHash}
      ) RETURNING id`.execute(transaction)).rows[0];
        if (!retained)
            throw new ConflictException("The domain authority attestation could not be retained.");
        return {
            receipt_id: retained.id, realm_id: input.realm_id,
            environment_namespace_id: input.environment_namespace_id,
            actor_agent_id: input.actor_agent_id, capability: input.capability, purpose: input.purpose,
            scope_entity_id: input.scope_entity_id, decision: input.attestation.decision,
            reason_codes: input.attestation.reason_codes,
            authority_source_refs: authoritySourceRefs,
            operating_rule_refs: input.attestation.operating_rule_refs,
            evaluated_at: input.evaluated_at, valid_until: input.attestation.valid_until, replayed: false,
        };
    }
    async recordCommand(transaction, input, actorAgentId, targetEntityId, modelScope) {
        const requestHash = createHash("sha256")
            .update(JSON.stringify(canonicalJson(input)))
            .digest("hex");
        if (input.authority_receipt_id) {
            const receipt = (await sql `SELECT actor_agent_id,decision,correlation_id,
          (valid_until IS NULL OR valid_until>CURRENT_TIMESTAMP) AS valid
        FROM campus_model_authority_receipts
        WHERE id=${input.authority_receipt_id}::uuid AND realm_id=${modelScope.realm_id}::uuid
          AND environment_namespace_id=${modelScope.environment_namespace_id}
        FOR SHARE`.execute(transaction)).rows[0];
            if (!receipt || receipt.actor_agent_id !== actorAgentId || receipt.decision !== "allowed"
                || receipt.correlation_id !== input.correlation_id || !receipt.valid) {
                throw new ConflictException("The command authority receipt is missing, expired, denied, or belongs to another actor or trace.");
            }
        }
        const inserted = (await sql `INSERT INTO campus_model_commands(
        school_id,realm_id,environment_namespace_id,command_type,target_entity_id,actor_agent_id,state,effective_at,expected_revision,
        authority_evidence,authority_receipt_id,operating_rule_version_ref,correlation_id,causation_id,idempotency_key,
        source_domain,safe_context,request_hash,handler_key,handler_version,configuration_refs,
        execution_started_at,completed_at
      ) VALUES (
        ${input.school_id}::uuid,${modelScope.realm_id}::uuid,${modelScope.environment_namespace_id},
        ${input.command_type},${targetEntityId}::uuid,${actorAgentId}::uuid,'accepted',
        now(),${input.expected_revision},${input.authority_evidence}::text[],${input.authority_receipt_id ?? null}::uuid,${input.operating_rule_version_ref},
        ${input.correlation_id}::uuid,${input.causation_id}::uuid,${input.idempotency_key},
        ${input.source_domain},${JSON.stringify(input.safe_context)}::jsonb,${requestHash},
        ${`legacy.${input.source_domain}`},1,'[]'::jsonb,now(),now()
      ) ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING
      RETURNING id,command_type,target_entity_id,actor_agent_id,request_hash`.execute(transaction)).rows[0];
        if (inserted)
            return inserted;
        const existing = (await sql `SELECT id,command_type,target_entity_id,actor_agent_id,request_hash
      FROM campus_model_commands WHERE realm_id=${modelScope.realm_id}::uuid
        AND environment_namespace_id=${modelScope.environment_namespace_id}
        AND idempotency_key=${input.idempotency_key}
      FOR UPDATE`.execute(transaction)).rows[0];
        if (!existing || existing.command_type !== input.command_type || existing.target_entity_id !== targetEntityId
            || existing.actor_agent_id !== actorAgentId || existing.request_hash !== requestHash) {
            throw new ConflictException("This campus command key was already used for different work.");
        }
        return existing;
    }
};
CampusModelCoreService = __decorate([
    Injectable(),
    __param(1, Optional()),
    __metadata("design:paramtypes", [DatabaseService,
        ExecutionDataPlaneScope])
], CampusModelCoreService);
export { CampusModelCoreService };
//# sourceMappingURL=campus-model-core.service.js.map