import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import { executionEnvironmentStorage, executionNow } from './execution-time.runtime.js';
import { resolveOperationalRealmScope } from './operational-realm.js';
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from './human-agent-identity.port.js';
import { coordinationConfigurationHash, coordinationRouteConfigurationSchema, type CoordinationConfigurationPort, type CoordinationRouteConfiguration,
  type CoordinationConfigurationReceipt, type CoordinationConfigurationReadPort } from './coordination-configuration.port.js';
import { z } from 'zod';

@Injectable()
export class CoordinationConfigurationService implements CoordinationConfigurationPort, CoordinationConfigurationReadPort {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  async latestRevision(tx: Transaction<Database>, input: { school_id: string; source_domain: string; configuration_key: string }): Promise<number> {
    const data = z.object({ school_id: z.uuid(), source_domain: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
      configuration_key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/) }).strict().parse(input);
    await resolveOperationalRealmScope(tx, data.school_id, executionEnvironmentStorage.getStore());
    const latest = (await sql<{ source_revision: number }>`SELECT source_revision FROM campus_model_coordination_configurations
      WHERE school_id=${data.school_id}::uuid AND source_domain=${data.source_domain} AND configuration_key=${data.configuration_key}
      ORDER BY source_revision DESC LIMIT 1`.execute(tx)).rows[0];
    return latest?.source_revision ?? 0;
  }

  async configureRoute(tx: Transaction<Database>, raw: CoordinationRouteConfiguration): Promise<CoordinationConfigurationReceipt> {
    const input = coordinationRouteConfigurationSchema.parse(raw), now = input.effective_from;
    if (coordinationConfigurationHash(input) !== input.configuration_hash) throw new ForbiddenException('The approved hash does not bind this exact route and recipient snapshot.');
    if (Date.parse(now) > executionNow().getTime()) throw new ConflictException('Configuration cannot activate before its approval instant.');
    const scope = await resolveOperationalRealmScope(tx, input.school_id, executionEnvironmentStorage.getStore());
    const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: input.school_id, user_id: input.actor_user_id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException('A current attributed person is required to activate coordination.');
    const commands = (await sql<{ id: string; state: string; command_type: string; actor_agent_id: string; realm_id: string;
      environment_namespace_id: string; source_domain: string; safe_context: Record<string, unknown>; operating_rule_version_ref: string | null;
      causation_id: string | null; handler_key: string; requested_at: Date }>`
      SELECT command.id,command.state,command.command_type,command.actor_agent_id,command.realm_id,command.environment_namespace_id,
        command.source_domain,command.safe_context,command.operating_rule_version_ref,command.causation_id,command.handler_key,command.requested_at
      FROM campus_model_commands command JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
        AND authority.actor_agent_id=command.actor_agent_id AND authority.realm_id=command.realm_id
        AND authority.environment_namespace_id=command.environment_namespace_id AND authority.decision='allowed'
        AND (authority.valid_until IS NULL OR authority.valid_until>${executionNow()}::timestamptz)
      WHERE command.school_id=${input.school_id}::uuid
        AND command.id=ANY(${[input.approval_command_id,input.activation_command_id]}::uuid[]) FOR SHARE OF command,authority`.execute(tx)).rows;
    const approval = commands.find(command => command.id === input.approval_command_id), activation = commands.find(command => command.id === input.activation_command_id);
    if (!approval || !activation || approval.state !== 'accepted' || activation.state !== 'pending'
      || approval.command_type !== `${input.source_domain}.coordination.configure.approve`
      || activation.command_type !== `${input.source_domain}.coordination.configure.activate`
      || activation.causation_id !== approval.id
      || approval.realm_id !== activation.realm_id || approval.environment_namespace_id !== activation.environment_namespace_id
      || approval.realm_id !== scope.realm_id || approval.environment_namespace_id !== scope.environment_namespace_id
      || commands.some(command => command.actor_agent_id !== actor.agent_id || command.source_domain !== input.source_domain
        || command.handler_key !== `${input.source_domain}.coordination.configure`
        || new Date(command.requested_at).toISOString() !== input.effective_from
        || command.operating_rule_version_ref !== input.operating_rule_ref || command.safe_context.configuration_hash !== input.configuration_hash
        || command.safe_context.source_record_id !== input.source_record_id || command.safe_context.source_revision !== input.source_revision
        || command.safe_context.configuration_key !== input.configuration_key)) {
      throw new ForbiddenException('Matching current approval and activation commands are required for this exact configuration.');
    }
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coordination-route:${input.school_id}:${input.source_domain}:${input.subscription.event_type}:${input.subscription.selector_key}`},0))`.execute(tx);
    const prior = (await sql<CoordinationConfigurationReceipt>`SELECT id,behaviour_version_id,subscription_id,configuration_hash
      FROM campus_model_coordination_configurations WHERE school_id=${input.school_id}::uuid AND source_domain=${input.source_domain}
        AND configuration_key=${input.configuration_key} AND source_revision=${input.source_revision}`.execute(tx)).rows[0];
    if (prior) {
      if (prior.configuration_hash !== input.configuration_hash) throw new ConflictException('This configuration version already has different approved contents.');
      return prior;
    }
    const recipients = (await sql<{ agent_id: string; person_id: string; user_id: string }>`SELECT agent.id AS agent_id,selected.person_id,selected.user_id
      FROM jsonb_to_recordset(${JSON.stringify(input.recipients)}::jsonb) selected(person_id uuid,user_id uuid)
      JOIN campus_model_agents agent ON agent.school_id=${input.school_id}::uuid AND agent.person_id=selected.person_id
        AND agent.agent_kind='human' AND agent.status='active'
      WHERE campus_model_account_person_is_active(${input.school_id}::uuid,selected.user_id,selected.person_id,${executionNow()}::timestamptz)`.execute(tx)).rows;
    if (recipients.length !== input.recipients.length) throw new ForbiddenException('Every selected recipient needs the same current person and active account.');
    // Supersession changes lifecycle only; never rewrites an activated snapshot.
    await sql`UPDATE campus_model_behaviour_versions behaviour SET status='retired',retired_at=${now}::timestamptz,
      effective_until=GREATEST(${now}::timestamptz,behaviour.effective_from+interval '1 microsecond')
      WHERE behaviour.school_id=${input.school_id}::uuid AND behaviour.status='approved' AND EXISTS(
        SELECT 1 FROM campus_model_event_subscriptions subscription WHERE subscription.behaviour_version_id=behaviour.id
          AND subscription.school_id=behaviour.school_id AND subscription.source_domain=${input.source_domain}
          AND subscription.event_type=${input.subscription.event_type} AND subscription.recipient_selector->>'selector_key'=${input.subscription.selector_key})`.execute(tx);
    await sql`UPDATE campus_model_agent_authorities authority SET revoked_at=${now}::timestamptz,revoked_by=${input.actor_user_id}::uuid
      WHERE authority.school_id=${input.school_id}::uuid AND authority.revoked_at IS NULL
        AND authority.grant_source='approved_coordination_policy' AND authority.grant_reference_id IN (
          SELECT id::text FROM campus_model_coordination_configurations WHERE school_id=${input.school_id}::uuid
            AND source_domain=${input.source_domain} AND configuration_key=${input.configuration_key})`.execute(tx);
    let behaviourId: string | null = null, subscriptionId: string | null = null;
    if (input.enabled) {
      const version = (await sql<{ value: number }>`SELECT COALESCE(max(version),0)::int+1 AS value FROM campus_model_behaviour_versions
        WHERE school_id=${input.school_id}::uuid AND behaviour_key=${input.behaviour_key}`.execute(tx)).rows[0]!.value;
      behaviourId = (await sql<{ id: string }>`INSERT INTO campus_model_behaviour_versions(school_id,behaviour_key,version,status,
        effective_from,configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
        VALUES(${input.school_id}::uuid,${input.behaviour_key},${version},'approved',${now}::timestamptz,
          ${JSON.stringify(input.behaviour_configuration)}::jsonb,${input.behaviour_schema_version},${actor.agent_id}::uuid,${actor.agent_id}::uuid,${now}::timestamptz) RETURNING id`.execute(tx)).rows[0]!.id;
      subscriptionId = (await sql<{ id: string }>`INSERT INTO campus_model_event_subscriptions(school_id,behaviour_version_id,
        subscription_key,source_domain,event_type,reaction_kind,message_kind,message_schema_version,recipient_selector,
        response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority)
        VALUES(${input.school_id}::uuid,${behaviourId}::uuid,${input.configuration_key},${input.source_domain},${input.subscription.event_type},
          ${input.subscription.reaction_kind},${input.subscription.message_kind},${input.subscription.message_schema_version},${JSON.stringify({ mode: 'explicit_authorized_agents',
            selector_key: input.subscription.selector_key, required_capability: input.subscription.required_capability,
            scope_mode: input.subscription.scope_mode, min_recipients: input.subscription.min_recipients, max_recipients: input.subscription.max_recipients })}::jsonb,
          ${input.subscription.response_due_after_seconds},${input.subscription.expires_after_seconds},${input.subscription.max_attempts},
          ${input.subscription.retry_after_seconds},${input.subscription.priority}) RETURNING id`.execute(tx)).rows[0]!.id;
    }
    const result = (await sql<CoordinationConfigurationReceipt>`INSERT INTO campus_model_coordination_configurations(school_id,realm_id,
      environment_namespace_id,configuration_key,source_domain,source_record_id,source_revision,configuration_hash,operating_rule_ref,
      approval_command_id,activation_command_id,approved_by_agent_id,effective_from,enabled,behaviour_version_id,subscription_id,snapshot)
      VALUES(${input.school_id}::uuid,${approval.realm_id}::uuid,${approval.environment_namespace_id},${input.configuration_key},${input.source_domain},
        ${input.source_record_id},${input.source_revision},${input.configuration_hash},${input.operating_rule_ref},${input.approval_command_id}::uuid,
        ${input.activation_command_id}::uuid,${actor.agent_id}::uuid,${now}::timestamptz,${input.enabled},${behaviourId}::uuid,${subscriptionId}::uuid,
        ${JSON.stringify({ ...input, recipients })}::jsonb) RETURNING id,behaviour_version_id,subscription_id,configuration_hash`.execute(tx)).rows[0]!;
    if (input.enabled) for (const recipient of recipients) await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,
      effective_from,grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints)
      VALUES(${input.school_id}::uuid,${recipient.agent_id}::uuid,${input.subscription.required_capability},${now}::timestamptz,
        'approved_coordination_policy',${result.id},${input.actor_user_id}::uuid,${input.operating_rule_ref},
        ${JSON.stringify({ source_domain: input.source_domain, source_record_id: input.source_record_id,
          configuration_hash: input.configuration_hash, person_id: recipient.person_id, user_id: recipient.user_id,
          permitted_effect: 'respond_to_explicit_invitation_only' })}::jsonb)`.execute(tx);
    return result;
  }
}
