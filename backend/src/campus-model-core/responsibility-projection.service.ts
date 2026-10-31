import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { z } from "zod";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "./human-agent-identity.port.js";
import { resolveOperationalRealmScope } from "./operational-realm.js";
import type {
  EffectiveAgentWorkProjection, EffectiveResponsibilityRecord, OwnedOperationalMessageRecord,
  ResponsibilityProjectionPort,
} from "./responsibility-projection.port.js";

@Injectable()
export class ResponsibilityProjectionService implements ResponsibilityProjectionPort {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Optional() private readonly executionScope?: ExecutionDataPlaneScope) {}

  async listPlanningTeams(transaction: Transaction<Database>, input: { school_id: string; at: string }) {
    z.string().uuid().parse(input.school_id); z.string().datetime({ offset: true }).parse(input.at);
    const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
    return (await sql<{ id: string; label: string }>`SELECT DISTINCT team.id,team.label
      FROM campus_model_agents team JOIN campus_responsibility_team_memberships membership
        ON membership.team_agent_id=team.id AND membership.school_id=team.school_id
      WHERE team.school_id=${input.school_id}::uuid AND team.agent_kind='team' AND team.status='active'
        AND membership.realm_id=${realm.realm_id}::uuid AND membership.environment_namespace_id=${realm.environment_namespace_id}
        AND membership.status='active' AND membership.effective_from<=${input.at}::timestamptz
        AND (membership.effective_until IS NULL OR membership.effective_until>${input.at}::timestamptz)
      ORDER BY team.label,team.id`.execute(transaction)).rows;
  }

  async listPlanningTeamPeople(transaction: Transaction<Database>, input: { school_id: string; team_id: string; at: string }) {
    z.string().uuid().parse(input.school_id); z.string().uuid().parse(input.team_id); z.string().datetime({ offset: true }).parse(input.at);
    const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
    return (await sql<{ person_id: string; source_ref: string; source_revision: number }>`SELECT DISTINCT ON(member.person_id)
      member.person_id,membership.id::text AS source_ref,membership.source_revision
      FROM campus_responsibility_team_memberships membership
      JOIN campus_model_agents team ON team.id=membership.team_agent_id AND team.school_id=membership.school_id AND team.status='active' AND team.agent_kind='team'
      JOIN campus_model_agents member ON member.id=membership.member_agent_id AND member.school_id=membership.school_id AND member.status='active' AND member.person_id IS NOT NULL
      WHERE membership.school_id=${input.school_id}::uuid AND membership.team_agent_id=${input.team_id}::uuid
        AND membership.realm_id=${realm.realm_id}::uuid AND membership.environment_namespace_id=${realm.environment_namespace_id}
        AND membership.status='active' AND membership.effective_from<=${input.at}::timestamptz
        AND (membership.effective_until IS NULL OR membership.effective_until>${input.at}::timestamptz)
      ORDER BY member.person_id,membership.effective_from DESC,membership.id`.execute(transaction)).rows;
  }

  async snapshotPlanningTeamPeople(transaction: Transaction<Database>, input: { school_id: string; team_id: string; from: string; until: string | null }) {
    z.object({ school_id: z.string().uuid(), team_id: z.string().uuid(), from: z.string().datetime({ offset: true }),
      until: z.string().datetime({ offset: true }).nullable() }).strict().refine(value => value.until === null
        || Date.parse(value.until) > Date.parse(value.from), "The team snapshot interval must have positive duration.").parse(input);
    const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
    return (await sql<{ person_id: string; source_ref: string; source_revision: number; effective_from: string; effective_until: string | null }>`
      SELECT member.person_id,membership.id::text AS source_ref,membership.source_revision,
        to_char(membership.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
        CASE WHEN membership.effective_until IS NULL THEN NULL ELSE
          to_char(membership.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS effective_until
      FROM campus_responsibility_team_memberships membership
      JOIN campus_model_agents team ON team.id=membership.team_agent_id AND team.school_id=membership.school_id
        AND team.status='active' AND team.agent_kind='team'
      JOIN campus_model_agents member ON member.id=membership.member_agent_id AND member.school_id=membership.school_id
        AND member.status='active' AND member.person_id IS NOT NULL
      WHERE membership.school_id=${input.school_id}::uuid AND membership.team_agent_id=${input.team_id}::uuid
        AND membership.realm_id=${realm.realm_id}::uuid AND membership.environment_namespace_id=${realm.environment_namespace_id}
        AND membership.status='active'
        AND (membership.effective_until IS NULL OR membership.effective_until>${input.from}::timestamptz)
        AND (${input.until}::timestamptz IS NULL OR membership.effective_from<${input.until}::timestamptz)
      ORDER BY member.person_id,membership.effective_from,membership.id
    `.execute(transaction)).rows;
  }

  async loadEffectiveAgentWork(
    transaction: Transaction<Database>,
    input: Parameters<ResponsibilityProjectionPort["loadEffectiveAgentWork"]>[1],
  ): Promise<EffectiveAgentWorkProjection> {
    const realm = await resolveOperationalRealmScope(transaction, input.school_id, input.execution_environment ?? undefined);
    const acting = await this.identities.resolveAccountEndpoint(transaction, {
      school_id: input.school_id, user_id: input.user_id, at: input.at.toISOString(),
    });
    if (!acting.acting) return { ...realm, acting_agent_id: null, owner_agent_ids: [], assignments: [], messages: [] };
    const teamIds = (await sql<{ team_agent_id: string }>`SELECT membership.team_agent_id::text
      FROM campus_responsibility_team_memberships membership
      JOIN campus_model_agents team ON team.id=membership.team_agent_id
        AND team.school_id=membership.school_id AND team.agent_kind='team' AND team.status='active'
      WHERE membership.realm_id=${realm.realm_id}::uuid
        AND membership.environment_namespace_id=${realm.environment_namespace_id}
        AND membership.member_agent_id=${acting.agent_id}::uuid
        AND membership.status='active' AND membership.effective_from<=${input.at}::timestamptz
        AND (membership.effective_until IS NULL OR membership.effective_until>${input.at}::timestamptz)
      ORDER BY membership.team_agent_id`.execute(transaction)).rows.map((row) => row.team_agent_id);
    const owners = [acting.agent_id, ...teamIds];
    const assignments = (await sql<EffectiveResponsibilityRecord>`SELECT responsibility.id::text,responsibility.owner_agent_id::text,
        responsibility.capability_key,responsibility.action_key,scope.kind AS scope_kind,
        scope.domain AS scope_domain,scope.domain_id AS scope_domain_id,scope.label AS scope_label,
        responsibility.effective_from,responsibility.effective_until,responsibility.effective_schedule,
        responsibility.authority_source_kind,responsibility.authority_source_ref,
        responsibility.fallback_agent_id::text,responsibility.source_domain,
        responsibility.source_record_id,responsibility.source_revision,responsibility.revision
      FROM campus_responsibility_assignments responsibility
      JOIN campus_model_entities scope ON scope.id=responsibility.scope_entity_id
        AND scope.realm_id=responsibility.realm_id
        AND scope.environment_namespace_id=responsibility.environment_namespace_id
      WHERE responsibility.realm_id=${realm.realm_id}::uuid
        AND responsibility.environment_namespace_id=${realm.environment_namespace_id}
        AND responsibility.owner_agent_id=ANY(${sql.val(owners)}::uuid[])
        AND responsibility.status='active'
        AND responsibility.effective_from<=${input.at}::timestamptz
        AND (responsibility.effective_until IS NULL OR responsibility.effective_until>${input.at}::timestamptz)
      ORDER BY responsibility.effective_from,responsibility.id`.execute(transaction)).rows;
    const messages = (await sql<OwnedOperationalMessageRecord>`SELECT message.id::text,message.message_kind,
        message.state,message.subject,message.summary,message.payload,subscription.reaction_kind,
        subscription.source_domain,message.response_due_at,message.expires_at,message.queued_at,message.updated_at
      FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
        AND reaction.realm_id=message.realm_id
        AND reaction.environment_namespace_id=message.environment_namespace_id
      JOIN campus_model_event_subscriptions subscription ON subscription.id=reaction.subscription_id
        AND subscription.school_id=message.school_id
      WHERE message.school_id=${input.school_id}::uuid
        AND message.realm_id=${realm.realm_id}::uuid
        AND message.environment_namespace_id=${realm.environment_namespace_id}
        AND message.owner_agent_id=ANY(${sql.val(owners)}::uuid[])
        AND message.message_kind IN ('request','task','offer')
        AND message.state IN ('queued','delivered','acknowledged')
      ORDER BY COALESCE(message.response_due_at,message.expires_at) NULLS LAST,message.queued_at DESC,message.id`.execute(transaction)).rows;
    return { ...realm, acting_agent_id: acting.agent_id, owner_agent_ids: owners, assignments, messages };
  }
}
