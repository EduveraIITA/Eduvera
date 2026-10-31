import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { Database } from "../database/types.js";

export interface ProgressiveWorkspaceAccount {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

@Injectable()
export class ProgressiveWorkspaceProvisioner {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  async createForAccount(db: Transaction<Database>, account: ProgressiveWorkspaceAccount, timezone: string) {
    const id = randomUUID();
    const internalCode = `workspace-${id.replaceAll("-", "").slice(0, 22)}`;
    const created = (await sql<{ id: string }>`INSERT INTO schools(
        id,name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id)
      VALUES(${id}::uuid,'Your campus',${internalCode},${timezone},'unspecified','progressive_private',
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
      school_id,owner_user_id,provisioned_for_account_id)
      VALUES(${created.id}::uuid,${account.id}::uuid,${account.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
    await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
      VALUES(${workspace.id}::uuid,${account.id}::uuid,'workspace_provisioned',1,
        ${JSON.stringify({ private: true, institution_claim: false })}::jsonb)`.execute(db);
    return created.id;
  }
}
