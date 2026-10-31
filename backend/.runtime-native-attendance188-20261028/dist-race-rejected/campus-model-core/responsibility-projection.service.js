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
import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { z } from "zod";
import { HUMAN_AGENT_IDENTITY_PORT } from "./human-agent-identity.port.js";
import { resolveOperationalRealmScope } from "./operational-realm.js";
let ResponsibilityProjectionService = class ResponsibilityProjectionService {
    identities;
    executionScope;
    constructor(identities, executionScope) {
        this.identities = identities;
        this.executionScope = executionScope;
    }
    async listPlanningTeams(transaction, input) {
        z.string().uuid().parse(input.school_id);
        z.string().datetime({ offset: true }).parse(input.at);
        const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
        return (await sql `SELECT DISTINCT team.id,team.label
      FROM campus_model_agents team JOIN campus_responsibility_team_memberships membership
        ON membership.team_agent_id=team.id AND membership.school_id=team.school_id
      WHERE team.school_id=${input.school_id}::uuid AND team.agent_kind='team' AND team.status='active'
        AND membership.realm_id=${realm.realm_id}::uuid AND membership.environment_namespace_id=${realm.environment_namespace_id}
        AND membership.status='active' AND membership.effective_from<=${input.at}::timestamptz
        AND (membership.effective_until IS NULL OR membership.effective_until>${input.at}::timestamptz)
      ORDER BY team.label,team.id`.execute(transaction)).rows;
    }
    async listPlanningTeamPeople(transaction, input) {
        z.string().uuid().parse(input.school_id);
        z.string().uuid().parse(input.team_id);
        z.string().datetime({ offset: true }).parse(input.at);
        const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
        return (await sql `SELECT DISTINCT ON(member.person_id)
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
    async snapshotPlanningTeamPeople(transaction, input) {
        z.object({ school_id: z.string().uuid(), team_id: z.string().uuid(), from: z.string().datetime({ offset: true }),
            until: z.string().datetime({ offset: true }).nullable() }).strict().refine(value => value.until === null
            || Date.parse(value.until) > Date.parse(value.from), "The team snapshot interval must have positive duration.").parse(input);
        const realm = await resolveOperationalRealmScope(transaction, input.school_id, this.executionScope?.current());
        return (await sql `
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
    async loadEffectiveAgentWork(transaction, input) {
        const realm = await resolveOperationalRealmScope(transaction, input.school_id, input.execution_environment ?? undefined);
        const acting = await this.identities.resolveAccountEndpoint(transaction, {
            school_id: input.school_id, user_id: input.user_id, at: input.at.toISOString(),
        });
        if (!acting.acting)
            return { ...realm, acting_agent_id: null, owner_agent_ids: [], assignments: [], messages: [] };
        const teamIds = (await sql `SELECT membership.team_agent_id::text
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
        const assignments = (await sql `SELECT responsibility.id::text,responsibility.owner_agent_id::text,
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
        const messages = (await sql `SELECT message.id::text,message.message_kind,
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
};
ResponsibilityProjectionService = __decorate([
    Injectable(),
    __param(0, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(1, Optional()),
    __metadata("design:paramtypes", [Object, ExecutionDataPlaneScope])
], ResponsibilityProjectionService);
export { ResponsibilityProjectionService };
//# sourceMappingURL=responsibility-projection.service.js.map