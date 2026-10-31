import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthUser } from "../src/common/request.js";
import { FeeReviewService } from "../src/operations/fee-review.service.js";
import { NativeFeeReviewsModel } from "../src/operations/native-fee-reviews.model.js";
import type { OperationsService } from "../src/operations/operations.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

export function guardianFeeReviewServices(db: DatabaseService, operations: OperationsService, core = new CampusModelCoreService(db, new ExecutionDataPlaneScope())) {
  const model = new NativeFeeReviewsModel(core, core, new CoordinationConfigurationService(core), core, core);
  return { core, model, service: new FeeReviewService(db, operations, model, core) };
}

/** Explicit fictional setup, not a runtime identity inference or production grant. */
export async function linkGuardianFeeFixtureActor(db: DatabaseService, core: CampusModelCoreService, schoolId: string, actor: AuthUser, ownerId: string) {
  actor.active_school_id = schoolId;
  if (actor.role === "staff" || actor.role === "admin") return linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: actor.id, owner_user_id: ownerId });
  return db.transaction().execute(async tx => {
    const guardian = (await sql<{ id: string; person_id: string | null }>`SELECT parent.id,profile.person_id FROM parents parent
      LEFT JOIN guardian_school_profiles profile ON profile.school_id=${schoolId}::uuid AND profile.guardian_id=parent.id
      WHERE parent.user_id=${actor.id}::uuid`.execute(tx)).rows[0];
    const student = await tx.selectFrom("students").select("person_id").where("school_id", "=", schoolId).where("user_id", "=", actor.id).executeTakeFirst();
    const personId = guardian?.person_id ?? student?.person_id ?? (await tx.insertInto("school_people").values({ school_id: schoolId,
      first_name: actor.first_name, last_name: actor.last_name }).returning("id").executeTakeFirstOrThrow()).id;
    if (guardian && !guardian.person_id) await tx.insertInto("guardian_school_profiles").values({ school_id: schoolId, guardian_id: guardian.id, person_id: personId }).execute();
    await core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: personId, user_id: actor.id, actor_user_id: ownerId,
      effective_from: new Date(Date.now() - 86_400_000).toISOString(), effective_until: null, source_domain: "people", source_record_id: randomUUID(),
      source_revision: 1, metadata: { fixture: "guardian_fee_review" } });
  });
}
