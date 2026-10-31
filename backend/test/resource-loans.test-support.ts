import "reflect-metadata";
import { acceptWithRecipientProof } from "./invitation-recipient-proof.test-support.js";
import { randomUUID } from "node:crypto";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { InstitutionSetupService } from "../src/institution-setup/institution-setup.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { PersonAccountInvitationsService } from "../src/operations/person-account-invitations.service.js";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { ResourceLoansAccess } from "../src/resource-loans/resource-loans.access.js";
import { ResourceLoansModel } from "../src/resource-loans/resource-loans.model.js";
import { ResourceLoansService } from "../src/resource-loans/resource-loans.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

export const resourceLoanRequest = (user: AuthUser) => ({
  authUser: user, requestId: randomUUID(), ip: "127.0.0.1", headers: {},
}) as AuthenticatedRequest;
const fixturePassword = "R1ver!Resource-Loan-Fixture2026";

/** The ordinary owning services, without workers, transport servers or a Live fallback. */
export function resourceLoanServices(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope());
  const events = new SchoolEventService(db, core);
  const topology = new InstitutionSetupService(db, new AuditService(db), core, core, core, core, core);
  const access = new ResourceLoansAccess(core);
  const model = new ResourceLoansModel(core, core, core, new CoordinationConfigurationService(core), core);
  const resources = new ResourceLoansService(db, access, model, topology);
  const people = new ParticipationPeopleService(db, events, core, core, core, core);
  const invitations = new PersonAccountInvitationsService(db, core, core, core);
  const operations = new OperationsService(db, {} as never, invitations);
  return { db, txDB: db, core, events, topology, access, model, resources, people, invitations, operations };
}

/**
 * A synthetic founder explicitly creates one campus and exact copy. The
 * borrower accepts a normal, person-bound neutral Member invitation in Live
 * before capture. No academic profile, copied acceptance or fabricated grant.
 */
export async function createResourceLoanFixture(db: DatabaseService, options: { passwordHash?: string } = {}) {
  const services = resourceLoanServices(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({
    username: `resource-owner-${suffix}`, email: `resource-owner-${suffix}@example.test`,
    password_hash: options.passwordHash ?? "isolated-fixture-founder-only",
    first_name: "Resource", last_name: "Custodian", role: "admin", email_verified_at: new Date(),
  }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx =>
    new ProgressiveWorkspaceProvisioner(services.core).createForAccount(tx, account, "UTC"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  // Setup uses a current clock so every newly accepted account endpoint is
  // effective before the fixed clock returned for deterministic world tests.
  await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() } }), async () => {
    const person = await services.people.create(resourceLoanRequest(user), schoolId, {
      first_name: "Sana", last_name: "Borrower", idempotency_key: randomUUID(),
    });
    const email = `resource-borrower-${suffix}@example.test`;
    const invitation = await services.operations.invite(user, schoolId, {
      role: "member", person_id: person.id, email, idempotency_key: randomUUID(),
    });
    if (invitation.delivery !== "manual" || !invitation.token)
      throw new Error("Resource fixtures require disabled invitation delivery and an ordinary manual acceptance.");
    await acceptWithRecipientProof(services.operations, { email, token: invitation.token, password: fixturePassword,
      first_name: "Accepted", last_name: "Borrower" });
  });
  const borrowerAccount = await db.selectFrom("users")
    .select(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
    .where("email", "=", `resource-borrower-${suffix}@example.test`).executeTakeFirstOrThrow();
  const borrower: AuthUser = { ...borrowerAccount, active_school_id: schoolId };
  const campus = await services.topology.createCampus(user, schoolId, {
    name: "Resources room", code: `RES-${suffix.slice(0, 8)}`, campus_type: "main", is_primary: true, timezone: "UTC",
  }, resourceLoanRequest(user));
  const holding = await services.resources.createItem(user, schoolId, {
    command_id: randomUUID(), campus_id: campus.id, name: "Camera kit", asset_tag: `CAM-${suffix.slice(0, 8)}`,
  }, resourceLoanRequest(user));
  const now = new Date().toISOString();
  const run = <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({
    institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now },
  }), fn);
  const [ownerIdentity, borrowerIdentity] = await run(() => db.transaction().execute(tx => Promise.all([
    services.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: now }),
    services.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: borrower.id, at: now }),
  ])));
  if (!ownerIdentity.acting || !borrowerIdentity.acting)
    throw new Error("Resource fixtures require both normally accepted, current canonical endpoints.");
  return { ...services, schoolId, user, owner: user, borrower, custodianPersonId: ownerIdentity.person_id,
    borrowerPersonId: borrowerIdentity.person_id, campusId: campus.id, holdingId: holding.id, now, run };
}
