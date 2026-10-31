import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/auth/password.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { RestrictedCareModel } from "../src/restricted-care/restricted-care.model.js";
import { RestrictedCareService } from "../src/restricted-care/restricted-care.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

/** Synthetic only; owning provisioning/identity/care services prepare UI+API QA. */
export async function createRestrictedCareContinuityFixture(database: DatabaseService) {
  const suffix = randomUUID(), password = "SyntheticCare!2026Only", scope = new ExecutionDataPlaneScope();
  const account = async (name: string, role: "admin" | "staff") => database.insertInto("users").values({ username: `care-${name}-${suffix}`, email: `care-${name}-${suffix}@example.test`,
    password_hash: await hashPassword(password), first_name: name, last_name: "Synthetic", role }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const ownerAccount = await account("Owner", "admin"), core = new CampusModelCoreService(database, scope);
  const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, ownerAccount, "Asia/Kolkata"));
  const owner: AuthUser = { ...ownerAccount, active_school_id: schoolId }, others: AuthUser[] = [];
  for (const [name, role] of [["Reporter", "staff"], ["Successor", "staff"], ["Alternate", "staff"], ["RoutingAdmin", "admin"]] as const) {
    const actor = await account(name, role);
    await database.insertInto("school_memberships").values({ school_id: schoolId, user_id: actor.id, role }).execute();
    await linkFixtureStaffIdentity(database, { school_id: schoolId, user_id: actor.id, owner_user_id: owner.id });
    others.push({ ...actor, active_school_id: schoolId });
  }
  const [reporter, successor, alternate, admin] = others as [AuthUser, AuthUser, AuthUser, AuthUser];
  const now = new Date().toISOString(), environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(work: () => Promise<T>) => scope.run(environment, () => executionEnvironmentStorage.run(environment, work));
  const services = (db: DatabaseService) => { const kernel = new CampusModelCoreService(db, scope); const model = new RestrictedCareModel(kernel, kernel, kernel); return { service: new RestrictedCareService(db, model), model, kernel }; };
  const { service, model } = services(database);
  await run(() => service.assignTeamMember(owner, schoolId, { user_id: owner.id, role_kind: "designated_lead", route_kind: "primary", valid_from: now.slice(0, 10), valid_until: null }));
  for (const [actor, route] of [[successor, "primary"], [alternate, "alternate"]] as const) await run(() => service.assignTeamMember(owner, schoolId, { user_id: actor.id, role_kind: "deputy_lead", route_kind: route, valid_from: now.slice(0, 10), valid_until: null }));
  const intake = (extra = {}) => ({ command_id: randomUUID(), student_id: null, intake_route: "primary", source_kind: "staff_observation", urgency: "priority", concern_category: "emotional_wellbeing",
    safety_state: "unknown", ordinary_handler_involved: false, observed_at: null, details: "Synthetic protected intake narrative; not a real child, person, observation or care concern.", ...extra });
  return { schoolId, owner, reporter, successor, alternate, admin, password, now, run, services, service, model, scope, intake };
}
