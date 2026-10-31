import "reflect-metadata";
import { acceptWithRecipientProof } from "./invitation-recipient-proof.test-support.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { LearningOfferingsService } from "../src/learning/learning-offerings.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { PersonAccountInvitationsService } from "../src/operations/person-account-invitations.service.js";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { learningAssignmentServices } from "./learning-assignments.test-support.js";

const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as AuthenticatedRequest;
const fixturePassword = "F0rest!Lamps-And-Rivers2026";

export function learningOfferingServices(db: DatabaseService) {
  const services = learningAssignmentServices(db);
  const offerings = new LearningOfferingsService(db, services.context, services.model);
  const people = new ParticipationPeopleService(db, services.events, services.core, services.core, services.core, services.core);
  const invitations = new PersonAccountInvitationsService(db, services.core, services.core, services.core);
  const operations = new OperationsService(db, {} as never, invitations);
  return { ...services, offerings, people, operations };
}

/** A synthetic founder starts a fresh private workspace. Invited actors use ordinary People/app-access services. No seed or reset. */
export async function createLearningOfferingFixture(db: DatabaseService) {
  const services = learningOfferingServices(db), suffix = randomUUID(), today = new Date().toISOString().slice(0, 10);
  const account = await db.insertInto("users").values({ username: `offering-owner-${suffix}`, email: `offering-owner-${suffix}@example.test`,
    password_hash: "isolated-fixture-founder-only", first_name: "Offering", last_name: "Owner", role: "admin", email_verified_at: new Date() })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(services.core).createForAccount(tx, account, "UTC"));
  const owner: AuthUser = { ...account, active_school_id: schoolId };
  const passive = async (name: string) => {
    const created = await services.people.create(request(owner), schoolId, { first_name: name, idempotency_key: randomUUID() });
    return services.people.detail(owner, schoolId, created.id);
  };
  const member = async (name: string) => {
    const created = await passive(name);
    const email = `offering-member-${randomUUID()}@example.test`;
    const invitation = await services.operations.invite(owner, schoolId, { role: "member", person_id: created.id, email, idempotency_key: randomUUID() });
    if (invitation.delivery !== "manual") throw new Error("Offering tests require disabled invitation delivery.");
    await acceptWithRecipientProof(services.operations, { email, token: invitation.token, password: fixturePassword, first_name: "Account label", last_name: "Fixture" });
    const user = await db.selectFrom("users").select(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
      .where("email", "=", email).executeTakeFirstOrThrow();
    const person = await services.people.detail(owner, schoolId, created.id);
    const actor: AuthUser = { ...user, active_school_id: schoolId };
    const endpoint = await db.transaction().execute(tx => services.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: actor.id, at: new Date().toISOString() }));
    if (!endpoint.acting || endpoint.person_id !== created.id) throw new Error("Invitation did not retain the selected canonical person.");
    return { id: person.id, person, actor, endpoint, invitationId: invitation.id };
  };
  const instructor = await member("Meera Offering Instructor"), learner = await member("Sana Offering Learner"), secondLearner = await member("Asha Offering Learner");
  const reference = (person: { id: string; revision: number }) => ({ id: person.id, expected_revision: person.revision });
  const create = async (overrides: Record<string, unknown> = {}) => {
    const id = randomUUID();
    const input = { command_id: randomUUID(), offering_id: id, name: "Saturday programming group", participants: [reference(learner.person), reference(secondLearner.person)],
      instructor: reference(instructor.person), starts_on: today, ...overrides };
    const receipt = await services.offerings.create(owner, input);
    return { id, input, receipt };
  };
  const input = (offeringId: string, overrides: Record<string, unknown> = {}) => ({ command_id: randomUUID(), expected_revision: 0,
    assignment_id: randomUUID(), context_kind: "learning_offering", offering_id: offeringId, reviewer_id: instructor.actor.id,
    title: "Explain a programming loop", instructions: "Submit your program and explain when the loop stops.", due_at: null, cutoff_at: null,
    submission_mode: "either", max_attempts: null, policy_version: 1, resubmission_mode: "on_request", ...overrides });
  const publish = async (offeringId: string, overrides: Record<string, unknown> = {}) => {
    const data = input(offeringId, overrides), saved = await services.assignments.save(instructor.actor, data);
    const preview = await services.assignments.detail(instructor.actor, data.assignment_id);
    if (preview.context !== "offering" || !preview.publication_preview) throw new Error("Expected instructor publication preview.");
    await services.assignments.publish(instructor.actor, data.assignment_id, { command_id: randomUUID(), expected_revision: saved.revision,
      audience_hash: preview.publication_preview.audience_hash });
    return data;
  };
  return { ...services, db, schoolId, today, owner, instructor, learner, secondLearner, member, passive, reference, create, input, publish };
}

export async function academicScaffoldingCounts(db: DatabaseService, schoolId: string) {
  return (await sql<{ students: number; staff: number; classes: number; terms: number; enrollments: number; guardians: number; roles: number; schedules: number }>`SELECT
    (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) AS students,
    (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) AS staff,
    (SELECT count(*)::int FROM class_sections WHERE school_id=${schoolId}::uuid) AS classes,
    (SELECT count(*)::int FROM academic_terms WHERE school_id=${schoolId}::uuid) AS terms,
    (SELECT count(*)::int FROM enrollments e JOIN students s ON s.id=e.student_id WHERE s.school_id=${schoolId}::uuid) AS enrollments,
    (SELECT count(*)::int FROM guardian_school_profiles WHERE school_id=${schoolId}::uuid) AS guardians,
    (SELECT count(*)::int FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid) AS roles,
    (SELECT count(*)::int FROM schedule_versions WHERE school_id=${schoolId}::uuid) AS schedules`.execute(db)).rows[0]!;
}
