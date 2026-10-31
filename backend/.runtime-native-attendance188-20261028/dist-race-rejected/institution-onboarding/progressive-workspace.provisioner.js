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
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
let ProgressiveWorkspaceProvisioner = class ProgressiveWorkspaceProvisioner {
    identities;
    constructor(identities) {
        this.identities = identities;
    }
    async createForAccount(db, account, timezone) {
        const id = randomUUID();
        const internalCode = `workspace-${id.replaceAll("-", "").slice(0, 22)}`;
        const created = (await sql `INSERT INTO schools(
        id,name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id)
      VALUES(${id}::uuid,'Your campus',${internalCode},${timezone},'unspecified','progressive_private',
        'not_verified',${account.id}::uuid) RETURNING id`.execute(db)).rows[0];
        await sql `UPDATE institution_regulatory_profiles SET institution_kind='unspecified',
      education_levels=ARRAY[]::text[],capability_packs=ARRAY[]::text[],updated_at=now()
      WHERE school_id=${created.id}::uuid`.execute(db);
        await sql `INSERT INTO school_memberships(user_id,school_id,role)
      VALUES(${account.id}::uuid,${created.id}::uuid,'admin')`.execute(db);
        const person = (await sql `INSERT INTO school_people(school_id,first_name,last_name,contact_email)
      VALUES(${created.id}::uuid,${account.first_name || "Account owner"},${account.last_name || ""},${account.email}) RETURNING id`.execute(db)).rows[0];
        await this.identities.linkAccountEndpoint(db, {
            school_id: created.id, person_id: person.id, user_id: account.id, actor_user_id: account.id,
            effective_from: executionNow().toISOString(), effective_until: null, source_domain: "institution_onboarding",
            source_record_id: created.id, source_revision: 1,
            metadata: { relationship: "private_workspace_owner", provisional: true },
        });
        const workspace = (await sql `INSERT INTO progressive_onboarding_workspaces(
      school_id,owner_user_id,provisioned_for_account_id)
      VALUES(${created.id}::uuid,${account.id}::uuid,${account.id}::uuid) RETURNING id`.execute(db)).rows[0];
        await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
      VALUES(${workspace.id}::uuid,${account.id}::uuid,'workspace_provisioned',1,
        ${JSON.stringify({ private: true, institution_claim: false })}::jsonb)`.execute(db);
        return created.id;
    }
};
ProgressiveWorkspaceProvisioner = __decorate([
    Injectable(),
    __param(0, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [Object])
], ProgressiveWorkspaceProvisioner);
export { ProgressiveWorkspaceProvisioner };
//# sourceMappingURL=progressive-workspace.provisioner.js.map