import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import {
  HUMAN_AGENT_IDENTITY_PORT,
  type HumanAgentIdentityPort,
} from "../campus-model-core/human-agent-identity.port.js";
import {
  executionNow,
  executionEnvironmentStorage,
} from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
@Injectable()
export class DiningAccess {
  constructor(
    @Inject(HUMAN_AGENT_IDENTITY_PORT)
    readonly identities: HumanAgentIdentityPort,
  ) {}
  async campus(tx: Transaction<Database>, user: AuthUser, school: string) {
    if (
      !user.is_active ||
      user.active_school_id !== school ||
      (executionEnvironmentStorage.getStore()?.institution_id &&
        executionEnvironmentStorage.getStore()!.institution_id !== school)
    )
      throw new ForbiddenException("Choose this campus and its current world.");
    const actor = await this.identities.resolveAccountEndpoint(tx, {
      school_id: school,
      user_id: user.id,
      at: executionNow().toISOString(),
    });
    if (!actor.acting)
      throw new ForbiddenException("Current campus app access is required.");
    return actor;
  }
  async manages(tx: Transaction<Database>, user: AuthUser, school: string) {
    try {
      await institutionSchoolPermission(
        tx,
        user,
        school,
        "dining.manage",
        true,
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  async manager(tx: Transaction<Database>, user: AuthUser, school: string) {
    const actor = await this.campus(tx, user, school);
    await institutionSchoolPermission(tx, user, school, "dining.manage", true);
    return actor;
  }
}
