import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/auth/password.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { CampusDatesModel } from "../src/campus-dates/campus-dates.model.js";
import { CampusDatesService } from "../src/campus-dates/campus-dates.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

/** Disposable institute-neutral fixture. Direct writes below prepare fictional
 * accounts only; every published/corrected/cancelled date uses its native owner. */
export async function createCampusDatesFixture(db: DatabaseService) {
  const suffix = randomUUID(), scope = new ExecutionDataPlaneScope();
  const account = async (name: string, role: "admin" | "staff" | "member") => db.insertInto("users").values({ username: `date-${name}-${suffix}`, email: `date-${name}-${suffix}@example.test`,
    password_hash: await hashPassword("SyntheticDates!2026Only"), first_name: name, last_name: "Fictional", role }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const ownerAccount = await account("Publisher", "admin"), core = new CampusModelCoreService(db, scope);
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, ownerAccount, "Asia/Kolkata"));
  const owner: AuthUser = { ...ownerAccount, active_school_id: schoolId }, memberAccount = await account("Member", "member"), staffAccount = await account("Staff", "staff");
  await db.insertInto("school_memberships").values([{ school_id: schoolId, user_id: memberAccount.id, role: "member" }, { school_id: schoolId, user_id: staffAccount.id, role: "staff" }]).execute();
  await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: staffAccount.id, owner_user_id: owner.id });
  const member: AuthUser = { ...memberAccount, active_school_id: schoolId }, staff: AuthUser = { ...staffAccount, active_school_id: schoolId };
  const now = new Date().toISOString(), environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(work: () => Promise<T>) => scope.run(environment, () => executionEnvironmentStorage.run(environment, work));
  const services = (store: DatabaseService) => { const kernel = new CampusModelCoreService(store, scope); return { kernel, service: new CampusDatesService(store, new CampusDatesModel(kernel, kernel, kernel), kernel) }; };
  const { service } = services(db);
  const input = (extra: Record<string, unknown> = {}) => ({ idempotency_key: randomUUID(), title: "Registration and programme welcome", description: "Fictional published planning date; not an observation of completed registration or attendance.",
    starts_on: "2026-07-27", ends_on: "2026-07-31", category_label: "Academic", academic_term_id: null, provenance: { fixture_key: "campus-dates-native-tests" }, ...extra });
  return { db, scope, schoolId, owner, member, staff, now, environment, run, services, service, input };
}
