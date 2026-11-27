import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { Database } from "../database/types.js";

export const ACCOUNT_CAMPUS_LIMIT = 10;

export interface ProgressiveWorkspaceAccount {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

@Injectable()
export class ProgressiveWorkspaceProvisioner {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  async createForAccount(db: Transaction<Database>, account: ProgressiveWorkspaceAccount, timezone: string,
    intent?: { requestId: string; name: string }) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-workspace:${account.id}`},0))`.execute(db);
    if (intent) {
      const prior = (await sql<{ school_id: string; provision_request_name: string }>`SELECT school_id,provision_request_name FROM progressive_onboarding_workspaces
        WHERE provisioned_for_account_id=${account.id}::uuid AND provision_request_id=${intent.requestId}::uuid`.execute(db)).rows[0];
      if (prior) {
        if (prior.provision_request_name !== intent.name) throw new ConflictException("This request already created a campus with a different name.");
        return prior.school_id;
      }
    }
    const available = (await sql<{ slot: number }>`SELECT candidate.slot FROM generate_series(1,${ACCOUNT_CAMPUS_LIMIT}::int) AS candidate(slot)
      WHERE NOT EXISTS (SELECT 1 FROM progressive_onboarding_workspaces
        WHERE provisioned_for_account_id=${account.id}::uuid AND provisioned_account_slot=candidate.slot)
      ORDER BY candidate.slot LIMIT 1`.execute(db)).rows[0];
    if (!available) throw new ConflictException(`This account has reached its limit of ${ACCOUNT_CAMPUS_LIMIT} campus workspaces.`);
    const id = randomUUID();
    const internalCode = `workspace-${id.replaceAll("-", "").slice(0, 22)}`;
    const created = (await sql<{ id: string }>`INSERT INTO schools(
        id,name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id)
      VALUES(${id}::uuid,${intent?.name ?? 'Your campus'},${internalCode},${timezone},'unspecified','progressive_private',
        'not_verified',${account.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
    await sql`UPDATE institution_regulatory_profiles SET institution_kind='unspecified',
      education_levels=ARRAY[]::text[],capability_packs=ARRAY[]::text[],updated_at=now()
      WHERE school_id=${created.id}::uuid`.execute(db);
    await sql`INSERT INTO school_memberships(user_id,school_id,role)
      VALUES(${account.id}::uuid,${created.id}::uuid,'admin')`.execute(db);
    const person = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name,contact_email)
      VALUES(${created.id}::uuid,${account.first_name || "Account owner"},${account.last_name || ""},${account.email}) RETURNING id`.execute(db)).rows[0]!;
    await this.identities.linkAccountEndpoint(db, {
      school_id: created.id, person_id: person.id, user_id: account.id, actor_user_id: account.id,
      effective_from: executionNow().toISOString(), effective_until: null, source_domain: "institution_onboarding",
      source_record_id: created.id, source_revision: 1,
      metadata: { relationship: "private_workspace_owner", provisional: true },
    });
    const workspace = (await sql<{ id: string }>`INSERT INTO progressive_onboarding_workspaces(
      school_id,owner_user_id,provisioned_for_account_id,provisioned_account_slot,provision_request_id,provision_request_name,profile_named)
      VALUES(${created.id}::uuid,${account.id}::uuid,${account.id}::uuid,${available.slot},${intent?.requestId ?? null}::uuid,${intent?.name ?? null},${!!intent}) RETURNING id`.execute(db)).rows[0]!;
    await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
      VALUES(${workspace.id}::uuid,${account.id}::uuid,'workspace_provisioned',1,
        ${JSON.stringify({ private: true, institution_claim: false })}::jsonb)`.execute(db);
    return created.id;
  }
}
