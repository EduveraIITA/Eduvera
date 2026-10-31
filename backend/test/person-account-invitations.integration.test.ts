import "reflect-metadata";
import { acceptWithRecipientProof, invitationRecipientProof } from "./invitation-recipient-proof.test-support.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { hashPassword } from "../src/auth/password.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { HumanAgentIdentityPort } from "../src/campus-model-core/human-agent-identity.port.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { AuditService } from "../src/common/audit.service.js";
import * as invitationCodes from "../src/common/invitation-code.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import * as appConfig from "../src/config.js";
import { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ScopedExecutionClock, SystemWallClock } from "../src/database/execution-clock.runtime.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { LegacyPeopleModelService } from "../src/operations/legacy-people-model.service.js";
import { PersonAccountInvitationsService } from "../src/operations/person-account-invitations.service.js";
import { PeopleService } from "../src/people/people.service.js";
import { AcademicParticipationBridge } from "../src/attendance/academic-participation-bridge.service.js";
import { CampusScenesService } from "../src/campus-scenes/campus-scenes.service.js";
import { CampusScenesModel } from "../src/campus-scenes/campus-scenes.model.js";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { effectiveSchoolAccess, schoolPermissionForUser } from "../src/roles/authorization.js";
import { RolesService } from "../src/roles/roles.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ActivityWorkspaceProjection } from "../src/workspace/activity-workspace.projection.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import { WorkspaceService } from "../src/workspace/workspace.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const password = "F0rest!Lamps-And-Rivers2026";
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), ip: "127.0.0.1", headers: {} }) as AuthenticatedRequest;
const acceptance = (email: string, token: string) => ({ email, token, password, first_name: "Accepted", last_name: "Person" });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.runIf(isolated)("person-bound neutral app invitations against isolated PostgreSQL", () => {
  let db: DatabaseService;
  let core: CampusModelCoreService;
  let people: ParticipationPeopleService;
  let helper: PersonAccountInvitationsService;
  let operations: OperationsService;
  let auth: AuthService;
  let repository: WorkspaceRepository;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.INVITATION_EMAIL_ENABLED = "false";
    db = new DatabaseService();
    core = new CampusModelCoreService(db);
    helper = new PersonAccountInvitationsService(db, core, core, core);
    operations = new OperationsService(db, {} as never, helper, new LegacyPeopleModelService(core, core, core));
    people = new ParticipationPeopleService(db, new SchoolEventService(db, core), core, core, core, core);
    const provisioner = new ProgressiveWorkspaceProvisioner(core);
    auth = new AuthService(db, new AuditService(db), new RolesService(db), provisioner);
    repository = new WorkspaceRepository(db, new ResponsibilityProjectionService(core));
  });
  afterAll(async () => { await db?.destroy(); });

  async function founder() {
    const suffix = randomUUID();
    const account = await db.insertInto("users").values({ username: `invite-owner-${suffix}`,
      email: `owner-${suffix}@example.test`, password_hash: await hashPassword(password),
      first_name: "Invitation", last_name: "Owner", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "Asia/Kolkata"));
    const user: AuthUser = { ...account, active_school_id: schoolId };
    const identity = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, {
      school_id: schoolId, user_id: user.id, at: new Date().toISOString(),
    }));
    if (!identity.acting) throw new Error("The isolated institution owner must retain a canonical identity.");
    return { schoolId, user, ownerPersonId: identity.person_id, ownerIdentity: identity };
  }

  async function fixture() {
    const owner = await founder();
    const person = await people.create(request(owner.user), owner.schoolId, {
      first_name: "Existing", last_name: "Participant", affiliation: "worker", idempotency_key: randomUUID(),
    });
    const email = `recipient-${randomUUID()}@example.test`;
    const input = { role: "member" as const, person_id: person.id, email, idempotency_key: randomUUID() };
    return { ...owner, person, email, input };
  }

  async function accountByEmail(email: string) {
    return db.selectFrom("users").select(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
      .where("email", "=", email).executeTakeFirst();
  }

  async function explicitlyCreateLearner(owner: Awaited<ReturnType<typeof founder>>, email: string) {
    const term = await db.insertInto("academic_terms").values({ school_id: owner.schoolId, academic_year: "2026-27", name: "Explicit learner setup",
      starts_on: "2026-01-01", ends_on: "2027-12-31", attendance_threshold: "75", is_active: true, updated_by: owner.user.id })
      .returning("id").executeTakeFirstOrThrow();
    const section = await db.insertInto("class_sections").values({ school_id: owner.schoolId, academic_year: "2026-27", grade: "Explicit", section: "A", updated_by: owner.user.id })
      .returning("id").executeTakeFirstOrThrow();
    return operations.student(owner.user, owner.schoolId, { email, first_name: "Explicit", last_name: "Learner",
      admission_number: `CLAIM-${randomUUID()}`, class_section_id: section.id, term_id: term.id, roll_number: 1 });
  }

  async function passiveLearner() {
    const owner = await founder(), day = new Date().toISOString().slice(0, 10);
    const person = await people.create(request(owner.user), owner.schoolId, {
      first_name: "Synthetic MTech", last_name: "Learner", affiliation: "learner", idempotency_key: randomUUID(),
    });
    const term = await db.insertInto("academic_terms").values({ school_id: owner.schoolId, academic_year: "2026-27", name: "Synthetic PG semester",
      starts_on: day, ends_on: "2027-12-31", attendance_threshold: "75", is_active: true, updated_by: owner.user.id }).returning("id").executeTakeFirstOrThrow();
    const section = await db.insertInto("class_sections").values({ school_id: owner.schoolId, academic_year: "2026-27", grade: "Synthetic MTech", section: "Demo", updated_by: owner.user.id })
      .returning("id").executeTakeFirstOrThrow();
    const intake = new PeopleService(db, new SchoolEventService(db, core), core, core, core,
      new AcademicParticipationBridge(db, new ActivityAttendanceService(db, core, core, core, core, core, undefined, core)));
    const review = await intake.preview(request(owner.user), { school_id: owner.schoolId, person: { id: person.id, expected_revision: 1 },
      admission_number: `SYNTH-${randomUUID()}`, date_of_birth: null, class_section_id: section.id, term_id: term.id, roll_number: 1,
      enrolled_on: day, guardian: null, can_authorize_leave: false });
    const attached = await intake.commit(request(owner.user), review.id), email = `student-${randomUUID()}@example.test`;
    const invite = () => operations.invite(owner.user, owner.schoolId, { role: "student", student_id: attached.student_id, email });
    return { ...owner, person, studentId: attached.student_id, email, invite };
  }

  async function studentIdentity(f: Awaited<ReturnType<typeof passiveLearner>>, userId: string) {
    return db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: userId, at: new Date().toISOString() }));
  }

  async function legacyStudent() {
    const f = await passiveLearner(), original = await f.invite();
    // Reproduce historical acceptance while omitting only its missing endpoint ceremony.
    const old = vi.spyOn(helper, "linkAcceptedStudentEndpointInTransaction").mockResolvedValueOnce();
    await acceptWithRecipientProof(operations, acceptance(f.email, original.token)); old.mockRestore();
    return { ...f, original, account: (await accountByEmail(f.email))! };
  }

  async function assertUnaccepted(f: Awaited<ReturnType<typeof fixture>>, id: string) {
    expect(await accountByEmail(f.email)).toBeUndefined();
    expect(await db.selectFrom("school_invitations").select(["accepted_at", "accepted_by_user_id"])
      .where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ accepted_at: null, accepted_by_user_id: null });
    expect((await db.selectFrom("school_people").select("account_user_id").where("id", "=", f.person.id)
      .executeTakeFirstOrThrow()).account_user_id).toBeNull();
  }

  it("student invitation links its exact passive enrolled person and opens campus access without staff authority", async () => {
    const f = await passiveLearner(), invitation = await f.invite();
    const before = await db.selectFrom("school_people").selectAll().where("id", "=", f.person.id).executeTakeFirstOrThrow();
    expect(await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).toMatchObject({ accepted: true, role: "student" });
    const account = (await accountByEmail(f.email))!;
    expect(await studentIdentity(f, account.id)).toMatchObject({ acting: true, person_id: f.person.id, user_id: account.id });
    expect(await db.selectFrom("students").select(["person_id", "user_id"]).where("id", "=", f.studentId).executeTakeFirstOrThrow()).toEqual({ person_id: f.person.id, user_id: account.id });
    expect(await db.selectFrom("school_people").selectAll().where("id", "=", f.person.id).executeTakeFirstOrThrow()).toEqual(before);
    expect(await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId).where("user_id", "=", account.id).execute()).toEqual([{ role: "student" }]);
    expect((await sql`SELECT role_id FROM school_custom_role_assignments WHERE school_id=${f.schoolId}::uuid AND user_id=${account.id}::uuid`.execute(db)).rows).toEqual([]);
    await expect(db.transaction().execute(tx => schoolPermissionForUser(tx, account.id, f.schoolId, "members.invite"))).rejects.toThrow();
    const scene = new CampusScenesService(db, new CampusScenesModel(core, core, core), core);
    expect(await scene.directory({ ...account, active_school_id: f.schoolId }, f.schoolId)).toMatchObject({ can_edit: false });
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("already used");
  }, 30_000);

  it("student fresh exact re-invitation completes an accepted legacy account without duplicate person or agent", async () => {
    const f = await legacyStudent();
    expect(await studentIdentity(f, f.account.id)).toMatchObject({ acting: false, reason: "account_not_linked" });
    const before = await db.selectFrom("school_people").selectAll().where("id", "=", f.person.id).executeTakeFirstOrThrow();
    const credentials = await db.selectFrom("users").select(["id", "password_hash"]).where("id", "=", f.account.id).executeTakeFirstOrThrow();
    const invitation = await f.invite(); expect(invitation.id).not.toBe(f.original.id);
    await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token));
    expect(await studentIdentity(f, f.account.id)).toMatchObject({ acting: true, person_id: f.person.id });
    expect(await db.selectFrom("users").select(["id", "password_hash"]).where("id", "=", f.account.id).executeTakeFirstOrThrow()).toEqual(credentials);
    expect(await db.selectFrom("school_people").selectAll().where("id", "=", f.person.id).executeTakeFirstOrThrow()).toEqual(before);
    await db.transaction().execute(tx => helper.linkAcceptedStudentEndpointInTransaction(tx, { school_id: f.schoolId, student_id: f.studentId, user_id: f.account.id, invitation_id: invitation.id }));
    expect((await sql<{ n: number }>`SELECT count(*)::int n FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid AND person_id=${f.person.id}::uuid AND agent_kind='human'`.execute(db)).rows[0]?.n).toBe(1);
    expect((await sql<{ n: number }>`SELECT count(*)::int n FROM campus_model_agent_endpoints WHERE school_id=${f.schoolId}::uuid AND user_id=${f.account.id}::uuid`.execute(db)).rows[0]?.n).toBe(1);
    expect(await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId).where("user_id", "=", f.account.id).execute()).toEqual([{ role: "student" }]);
  }, 30_000);

  it("student acceptance refuses another person's account atomically and preserves its invitation", async () => {
    const f = await passiveLearner(), other = await people.create(request(f.user), f.schoolId, { first_name: "Other", last_name: "Person", idempotency_key: randomUUID() });
    const member = await operations.invite(f.user, f.schoolId, { role: "member", person_id: other.id, email: f.email, idempotency_key: randomUUID() });
    await acceptWithRecipientProof(operations, acceptance(f.email, member.token));
    const account = (await accountByEmail(f.email))!, invitation = await f.invite();
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow(/different|conflicting|retained/);
    expect(await studentIdentity(f, account.id)).toMatchObject({ acting: true, person_id: other.id });
    expect((await db.selectFrom("students").select("user_id").where("id", "=", f.studentId).executeTakeFirstOrThrow()).user_id).toBeNull();
    expect((await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", invitation.id).executeTakeFirstOrThrow()).accepted_at).toBeNull();
    expect(await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId).where("user_id", "=", account.id).execute()).toEqual([{ role: "member" }]);
  }, 30_000);

  it("student endpoint ceremony requires exact accepted school/student/account source and current inviter", async () => {
    const f = await legacyStudent(), foreign = await passiveLearner();
    const exact = { school_id: f.schoolId, student_id: f.studentId, user_id: f.account.id, invitation_id: f.original.id };
    const link = vi.spyOn(core, "linkAccountEndpoint");
    for (const wrong of [{ school_id: foreign.schoolId }, { student_id: foreign.studentId }, { user_id: foreign.user.id }, { invitation_id: randomUUID() }])
      await expect(db.transaction().execute(tx => helper.linkAcceptedStudentEndpointInTransaction(tx, { ...exact, ...wrong }))).rejects.toThrow("exact accepted invitation");
    await db.updateTable("school_invitations").set({ revoked_at: new Date() }).where("id", "=", f.original.id).execute();
    await expect(db.transaction().execute(tx => helper.linkAcceptedStudentEndpointInTransaction(tx, exact))).rejects.toThrow("exact accepted invitation");
    await db.updateTable("school_invitations").set({ revoked_at: null, accepted_at: null }).where("id", "=", f.original.id).execute();
    await expect(db.transaction().execute(tx => helper.linkAcceptedStudentEndpointInTransaction(tx, exact))).rejects.toThrow("exact accepted invitation");
    await db.updateTable("school_invitations").set({ accepted_at: new Date() }).where("id", "=", f.original.id).execute();
    await db.transaction().execute(tx => core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: f.ownerIdentity.endpoint_id,
      actor_user_id: f.user.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "revoked", reason: "Synthetic inviter access revoked",
      source_domain: "auth", source_record_id: randomUUID(), source_revision: 1, idempotency_key: randomUUID() }));
    await expect(db.transaction().execute(tx => helper.linkAcceptedStudentEndpointInTransaction(tx, exact))).rejects.toThrow("campus app access is no longer active");
    expect(link).not.toHaveBeenCalled();
  }, 30_000);

  it("student re-invitation cannot restore a revoked endpoint while membership and exact learner profile remain", async () => {
    const f = await passiveLearner(), first = await f.invite(); await acceptWithRecipientProof(operations, acceptance(f.email, first.token));
    const account = (await accountByEmail(f.email))!, identity = await studentIdentity(f, account.id);
    if (!identity.acting) throw new Error("Fixture acceptance must link its student endpoint.");
    await db.transaction().execute(tx => core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: identity.endpoint_id,
      actor_user_id: f.user.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "revoked", reason: "Synthetic student access revoked",
      source_domain: "auth", source_record_id: randomUUID(), source_revision: 1, idempotency_key: randomUUID() }));
    const invitation = await f.invite();
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("cannot replace or restore");
    expect(await studentIdentity(f, account.id)).toMatchObject({ acting: false, reason: "endpoint_inactive" });
    expect((await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", invitation.id).executeTakeFirstOrThrow()).accepted_at).toBeNull();
  }, 30_000);

  it("student acceptance rolls back account/membership/profile/invitation on Core refusal and permits the same safe retry", async () => {
    const f = await passiveLearner(), invitation = await f.invite();
    const refusal = vi.spyOn(core, "linkAccountEndpoint").mockRejectedValueOnce(new Error("Synthetic concurrent identity refusal"));
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("Synthetic concurrent identity refusal");
    expect(refusal).toHaveBeenCalledOnce(); refusal.mockRestore();
    expect(await accountByEmail(f.email)).toBeUndefined();
    expect((await db.selectFrom("students").select("user_id").where("id", "=", f.studentId).executeTakeFirstOrThrow()).user_id).toBeNull();
    expect((await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", invitation.id).executeTakeFirstOrThrow()).accepted_at).toBeNull();
    await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token));
    expect(await studentIdentity(f, (await accountByEmail(f.email))!.id)).toMatchObject({ acting: true, person_id: f.person.id });
  }, 30_000);

  it("does not promote a resource-only invitation exception into campus app-access management", async () => {
    const f = await fixture(), suffix = randomUUID();
    const account = await db.insertInto("users").values({ username: `scoped-inviter-${suffix}`, email: `scoped-inviter-${suffix}@example.test`,
      password_hash: "isolated-test-only", first_name: "Scoped", last_name: "Inviter", role: "staff" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: account.id, role: "staff", is_active: true }).execute();
    await linkFixtureStaffIdentity(db, { school_id: f.schoolId, user_id: account.id, owner_user_id: f.user.id });
    const user: AuthUser = { ...account, active_school_id: f.schoolId };
    const exception = (await sql<{ id: string }>`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,
        valid_from,valid_until,review_due_on,created_by) SELECT ${f.schoolId}::uuid,${user.id}::uuid,'members.invite','Isolated scope regression',
        'manual','assigned_resources',(now() AT TIME ZONE timezone)::date,(now() AT TIME ZONE timezone)::date+2,
        (now() AT TIME ZONE timezone)::date+1,${f.user.id}::uuid FROM schools WHERE id=${f.schoolId}::uuid RETURNING id`.execute(db)).rows[0]!;
    await expect(helper.create(user, f.schoolId, f.input)).rejects.toThrow("Institution-scoped school permission");
    expect(await db.selectFrom("school_invitations").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    await sql`UPDATE school_access_exceptions SET scope_kind='institution',revision=revision+1 WHERE id=${exception.id}::uuid`.execute(db);
    const invitation = await helper.create(user, f.schoolId, f.input);
    expect(await helper.detail(user, f.schoolId, invitation.id)).toMatchObject({ id: invitation.id });
    await sql`UPDATE school_access_exceptions SET scope_kind='assigned_resources',revision=revision+1 WHERE id=${exception.id}::uuid`.execute(db);
    await expect(helper.detail(user, f.schoolId, invitation.id)).rejects.toThrow("Institution-scoped school permission");
    const retained = await db.selectFrom("school_invitations").select(["school_id", "created_by", "person_id", "email"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow();
    await expect(db.transaction().execute(tx => helper.assertResendable(tx, retained))).rejects.toThrow("can no longer invite");
  }, 30000);

  it("creates one reviewed invitation under concurrent exact retries, rejects changed input, and keeps secrets out of the model trace", async () => {
    const f = await fixture();
    const issued = await Promise.all([operations.invite(f.user, f.schoolId, f.input), operations.invite(f.user, f.schoolId, f.input)]);
    expect(issued[0].id).toBe(issued[1].id);
    expect(issued.filter(item => item.token.match(/^\d{6}$/))).toHaveLength(1);
    const first = issued.find(item => item.token)!;
    const retry = await operations.invite(f.user, f.schoolId, f.input);
    expect(retry).toMatchObject({ id: first.id, replayed: true, token: "" });
    await expect(operations.invite(f.user, f.schoolId, { ...f.input, email: `changed-${randomUUID()}@example.test` }))
      .rejects.toThrow(/different|another|changed/i);
    expect((await db.selectFrom("school_invitations").select("id").where("school_id", "=", f.schoolId)
      .where("person_id", "=", f.person.id).execute())).toEqual([{ id: first.id }]);
    const commands = (await sql<{ id: string; state: string; safe_context: unknown; request_hash: string }>`SELECT id,state,safe_context,request_hash
      FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='people.account.invite'`.execute(db)).rows;
    expect(commands).toHaveLength(1);
    expect(commands[0]?.state).toBe("accepted");
    const events = (await sql<{ payload: unknown; correlation_id: string }>`SELECT payload,correlation_id FROM campus_model_events
      WHERE school_id=${f.schoolId}::uuid AND source_record_id=${first.id}`.execute(db)).rows;
    expect(events).toHaveLength(1);
    const audits = (await sql`SELECT metadata FROM school_operations_audit WHERE school_id=${f.schoolId}::uuid AND target_id=${first.id}::uuid`.execute(db)).rows;
    const retained = JSON.stringify({ commands, events, audits });
    expect(retained).not.toContain(first.token);
    expect(retained).not.toContain(f.email);
    expect(retained).not.toContain(password);
    expect((await sql`SELECT id FROM invitation_email_jobs WHERE invitation_id=${first.id}::uuid`.execute(db)).rows).toEqual([]);
  }, 30_000);

  it("replays the original request after a later resend and revocation without rotating another code or re-accepting a command", async () => {
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const later = new Date(Date.now() + 120_000);
    const environment = createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => later, nowIso: () => later.toISOString() } });
    await executionEnvironmentStorage.run(environment, async () => {
      const resent = await operations.resendInvitation(f.user, f.schoolId, invitation.id);
      expect(resent.id).toBe(invitation.id);
      const afterResend = await db.selectFrom("school_invitations").select(["token_hash", "expires_at"]).where("id", "=", invitation.id).executeTakeFirstOrThrow();
      const repeated = await operations.invite(f.user, f.schoolId, f.input);
      expect(repeated).toMatchObject({ id: invitation.id, token: "", replayed: true, expires_at: afterResend.expires_at });
      expect(await operations.revokeInvitation(f.user, f.schoolId, invitation.id)).toEqual({ revoked: true });
      expect(await operations.invite(f.user, f.schoolId, f.input)).toMatchObject({ id: invitation.id, token: "", replayed: true });
      expect((await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "revoked_at"]).where("id", "=", invitation.id).executeTakeFirstOrThrow()))
        .toMatchObject({ token_hash: afterResend.token_hash, expires_at: afterResend.expires_at, revoked_at: expect.any(Date) });
      expect((await sql<{ commands: number; outcomes: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='people.account.invite') commands,
        (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands command ON command.id=outcome.command_id
          WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='people.account.invite') outcomes`.execute(db)).rows[0])
        .toEqual({ commands: 1, outcomes: 1 });
    });
  }, 30_000);

  it("accepts onto the same person, signs in as a neutral member, and creates no operational profile or authority", async () => {
    const f = await fixture();
    const personBefore = await people.detail(f.user, f.schoolId, f.person.id);
    const planning = new ActivityPlanningService(db, new SchoolEventService(db, core), core, core, core,
      new ResponsibilityProjectionService(core));
    const day = (await sql<{ day: string }>`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date+1)::text AS day`.execute(db)).rows[0]!.day;
    const plan = await planning.create(request(f.user), f.schoolId, { idempotency_key: randomUUID(), title: "Already scheduled participation",
      purpose: "duty", timezone: "Asia/Kolkata", recurrence: "once", starts_on: day, starts_at: "11:00", ends_at: "12:00",
      person_ids: [f.person.id], attendance_mode: "none", location_kind: "unspecified" });
    await planning.publish(request(f.user), f.schoolId, plan.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    const originalOccurrence = (await planning.listOccurrences(f.user, f.schoolId, { from: day, until: day })).items[0]!;
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    expect(await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).toMatchObject({ accepted: true, role: "member", school_id: f.schoolId });
    const account = (await accountByEmail(f.email))!;
    expect(account.role).toBe("member");
    const storedPerson = await db.selectFrom("school_people").select(["id", "first_name", "last_name", "revision", "account_user_id"])
      .where("id", "=", f.person.id).executeTakeFirstOrThrow();
    expect(storedPerson).toMatchObject({ id: f.person.id, first_name: "Existing", last_name: "Participant", account_user_id: account.id,
      revision: personBefore.revision + 1 });
    expect(await db.selectFrom("school_invitations").select(["person_id", "accepted_by_user_id"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow()).toEqual({ person_id: f.person.id, accepted_by_user_id: account.id });
    const actor = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: account.id, at: new Date().toISOString() }));
    expect(actor).toMatchObject({ acting: true, person_id: f.person.id, user_id: account.id });
    if (!actor.acting) throw new Error("The accepted account must act only as the invited canonical person.");
    expect((await db.transaction().execute(tx => core.resolvePersonAgent(tx, { school_id: f.schoolId, person_id: f.person.id,
      at: new Date().toISOString() })))).toMatchObject({ acting: true, agent_id: actor.agent_id, user_id: account.id });
    expect((await sql<{ agents: number; people: number; staff: number; learners: number; guardians: number; enrollments: number }>`SELECT
      (SELECT count(*)::int FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid AND person_id=${f.person.id}::uuid) agents,
      (SELECT count(*)::int FROM school_people WHERE school_id=${f.schoolId}::uuid) people,
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${f.schoolId}::uuid AND user_id=${account.id}::uuid) staff,
      (SELECT count(*)::int FROM students WHERE school_id=${f.schoolId}::uuid AND user_id=${account.id}::uuid) learners,
      (SELECT count(*)::int FROM parents WHERE user_id=${account.id}::uuid) guardians,
      (SELECT count(*)::int FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
        WHERE student.school_id=${f.schoolId}::uuid AND student.user_id=${account.id}::uuid) enrollments`.execute(db)).rows[0])
      .toEqual({ agents: 1, people: 2, staff: 0, learners: 0, guardians: 0, enrollments: 0 });
    expect(await effectiveSchoolAccess(db, account.id, f.schoolId)).toEqual({ role: "member", sources: [] });
    for (const permission of ["sis.manage", "members.invite", "attendance.record", "attendance.review"]) {
      await expect(schoolPermissionForUser(db, account.id, f.schoolId, permission)).rejects.toThrow("permission");
    }
    const login = await auth.login({ identifier: f.email, password }, request({ ...account, active_school_id: null }));
    const session = await auth.createSession(login.user, request(login.user));
    const resolved = await auth.resolveSession(session.rawToken);
    expect(resolved?.user).toMatchObject({ id: account.id, role: "member", active_school_id: f.schoolId });
    const me = await auth.me(resolved!.user);
    expect(me).toMatchObject({ user: { role: "member" }, memberships: [expect.objectContaining({ school_id: f.schoolId, role: "member" })],
      students: [], institution_setup_required: false, onboarding: { status: "ready" } });
    expect(me.school_permissions).toEqual([expect.objectContaining({ role: "member", permissions: [] })]);
    const snapshot = await repository.load({ user_id: account.id, school_id: f.schoolId, at: new Date(), execution_environment: null });
    expect(snapshot).toMatchObject({ membership_roles: ["member"], acting_agent_id: actor.agent_id, relationships: [], assignments: [] });
    const ownCalendar = await planning.listOccurrences(resolved!.user, f.schoolId, { from: day, until: day });
    expect(ownCalendar.items).toEqual([expect.objectContaining({ id: originalOccurrence.id, participants: originalOccurrence.participants })]);
    expect(ownCalendar.can_manage).toBe(false);
    await expect(planning.listPlans(resolved!.user, f.schoolId, { from: day, until: day })).rejects.toThrow();
    const workspace = await new WorkspaceService(repository, new ScopedExecutionClock(new ExecutionDataPlaneScope(), new SystemWallClock()),
      undefined, undefined, new ActivityWorkspaceProjection(db, planning, new ActivityAttendanceService(db, core, core, core, core, core), core))
      .manifest(resolved!.user, null, { mode: "live", institution_id: f.schoolId, namespace_id: `live:${f.schoolId}` });
    expect(workspace.areas.map(area => area.key).sort()).toEqual(["calendar", "timetable"]);
    expect(workspace.areas.every(area => area.capabilities.length === 1 && area.capabilities[0] === "timetable.view")).toBe(true);
    expect(workspace.today.next).toEqual([expect.objectContaining({ title: "Already scheduled participation", action_label: "Open timetable" })]);
    expect(workspace.more.setup).toEqual([]);
    const created = (await sql<{ correlation_id: string }>`SELECT correlation_id FROM campus_model_events
      WHERE school_id=${f.schoolId}::uuid AND correlation_id=${invitation.id}::uuid`.execute(db)).rows;
    expect(created).toHaveLength(2);
    expect(new Set(created.map(event => event.correlation_id))).toEqual(new Set([invitation.id]));
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow(/already used|invalid/i);
  }, 30_000);

  it("serializes competing claims for one person or one recipient and rolls back the losing prepared command", async () => {
    const personClaim = await fixture();
    const personResults = await Promise.allSettled([
      operations.invite(personClaim.user, personClaim.schoolId, personClaim.input),
      operations.invite(personClaim.user, personClaim.schoolId, { ...personClaim.input,
        email: `competing-${randomUUID()}@example.test`, idempotency_key: randomUUID() }),
    ]);
    expect(personResults.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await db.selectFrom("school_invitations").select("id").where("school_id", "=", personClaim.schoolId)
      .where("person_id", "=", personClaim.person.id).execute())).toHaveLength(1);
    const otherPerson = await people.create(request(personClaim.user), personClaim.schoolId, {
      first_name: "Other", last_name: "Participant", idempotency_key: randomUUID(),
    });
    const recipient = `one-recipient-${randomUUID()}@example.test`;
    const thirdPerson = await people.create(request(personClaim.user), personClaim.schoolId, {
      first_name: "Third", last_name: "Participant", idempotency_key: randomUUID(),
    });
    const emailResults = await Promise.allSettled([
      operations.invite(personClaim.user, personClaim.schoolId, { role: "member", person_id: otherPerson.id, email: recipient, idempotency_key: randomUUID() }),
      operations.invite(personClaim.user, personClaim.schoolId, { role: "member", person_id: thirdPerson.id, email: recipient, idempotency_key: randomUUID() }),
    ]);
    expect(emailResults.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await db.selectFrom("school_invitations").select("id").where("school_id", "=", personClaim.schoolId)
      .where("email", "=", recipient).execute())).toHaveLength(1);
    expect((await sql<{ state: string }>`SELECT state FROM campus_model_commands WHERE school_id=${personClaim.schoolId}::uuid
      AND command_type='people.account.invite'`.execute(db)).rows).toEqual([{ state: "accepted" }, { state: "accepted" }]);
  }, 30_000);

  it("keeps an existing other-campus administrator neutral here and verifies their existing password", async () => {
    const f = await fixture(), outside = await founder();
    const input = { ...f.input, email: outside.user.email };
    const invitation = await operations.invite(f.user, f.schoolId, input);
    await expect(acceptWithRecipientProof(operations, { ...acceptance(outside.user.email, invitation.token), password: "Wr0ng!Existing-Password2026" }))
      .rejects.toThrow("existing account password");
    await acceptWithRecipientProof(operations, acceptance(outside.user.email, invitation.token));
    expect((await accountByEmail(outside.user.email))?.role).toBe("admin");
    expect(await effectiveSchoolAccess(db, outside.user.id, f.schoolId)).toEqual({ role: "member", sources: [] });
    expect((await effectiveSchoolAccess(db, outside.user.id, outside.schoolId)).role).toBe("admin");
    const snapshot = await repository.load({ user_id: outside.user.id, school_id: f.schoolId, at: new Date(), execution_environment: null });
    expect(snapshot).toMatchObject({ membership_roles: ["member"], relationships: [], assignments: [] });
    expect(await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: outside.user.id,
      at: new Date().toISOString() }))).toMatchObject({ acting: true, person_id: f.person.id });
    expect(await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: outside.schoolId, user_id: outside.user.id,
      at: new Date().toISOString() }))).toMatchObject({ acting: true, person_id: outside.ownerPersonId });
  }, 30_000);

  it("rejects wrong-tenant people, linked owners and unauthorized invitation detail readers", async () => {
    const f = await fixture(), outside = await fixture();
    await expect(operations.invite(f.user, f.schoolId, { ...f.input, person_id: outside.person.id })).rejects.toThrow("existing person from this institution");
    await expect(operations.invite(f.user, f.schoolId, { ...f.input, person_id: f.ownerPersonId })).rejects.toThrow("already has an app account");
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    expect(await operations.invitationDetail(f.user, f.schoolId, invitation.id)).toMatchObject({ id: invitation.id, person_id: f.person.id, role: "member" });
    await expect(operations.invitationDetail(outside.user, f.schoolId, invitation.id)).rejects.toThrow("Select this institution");
    await expect(operations.invitationDetail({ ...outside.user, active_school_id: f.schoolId }, f.schoolId, invitation.id)).rejects.toThrow("permission");
    await expect(operations.invitationDetail(outside.user, outside.schoolId, invitation.id)).rejects.toThrow("not found");
    await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token));
    const account = (await accountByEmail(f.email))!;
    await expect(operations.invitationDetail({ ...account, active_school_id: f.schoolId }, f.schoolId, invitation.id)).rejects.toThrow("permission");
    await expect(operations.invite({ ...account, active_school_id: f.schoolId }, f.schoolId, { ...outside.input, person_id: f.person.id }))
      .rejects.toThrow("permission");
  }, 30_000);

  it("rechecks current inviter authority before replay and acceptance without leaving a new account behind", async () => {
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const currentAdministrator = await founder();
    const managerPerson = await people.create(request(f.user), f.schoolId, { first_name: "Current", last_name: "Administrator", idempotency_key: randomUUID() });
    const managerInvitation = await operations.invite(f.user, f.schoolId, { role: "member", person_id: managerPerson.id,
      email: currentAdministrator.user.email, idempotency_key: randomUUID() });
    await acceptWithRecipientProof(operations, acceptance(currentAdministrator.user.email, managerInvitation.token));
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: currentAdministrator.user.id, role: "admin" }).execute();
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
    await expect(operations.invite(f.user, f.schoolId, f.input)).rejects.toThrow("permission");
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("inviter no longer");
    await assertUnaccepted(f, invitation.id);
    const before = await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "created_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow();
    await expect(operations.resendInvitation({ ...currentAdministrator.user, active_school_id: f.schoolId }, f.schoolId, invitation.id))
      .rejects.toThrow("original inviter");
    expect(await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "created_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow()).toEqual(before);
  }, 30_000);

  it("rejects creation, replay, resend and acceptance after the original sender's endpoint is revoked while membership stays active", async () => {
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    await db.transaction().execute(tx => core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: f.ownerIdentity.endpoint_id,
      actor_user_id: f.user.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "revoked",
      reason: "Administrator app endpoint explicitly revoked", source_domain: "auth", source_record_id: randomUUID(),
      source_revision: 1, idempotency_key: randomUUID() }));
    expect((await db.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId)
      .where("user_id", "=", f.user.id).executeTakeFirstOrThrow()).is_active).toBe(true);
    const before = await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "created_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow();
    await expect(operations.invite(f.user, f.schoolId, f.input)).rejects.toThrow("campus app access is no longer active");
    await expect(operations.invite(f.user, f.schoolId, { ...f.input, idempotency_key: randomUUID() })).rejects.toThrow("campus app access is no longer active");
    await expect(operations.resendInvitation(f.user, f.schoolId, invitation.id)).rejects.toThrow("campus app access is no longer active");
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("campus app access is no longer active");
    expect(await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "created_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow()).toEqual(before);
    await assertUnaccepted(f, invitation.id);
  }, 30_000);

  it("denies a currently revoked resender or revoker even when the original sender and both memberships remain valid", async () => {
    const f = await fixture(), outside = await founder();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const managerPerson = await people.create(request(f.user), f.schoolId, { first_name: "Explicit", last_name: "Administrator", idempotency_key: randomUUID() });
    const managerInvite = await operations.invite(f.user, f.schoolId, { role: "member", person_id: managerPerson.id,
      email: outside.user.email, idempotency_key: randomUUID() });
    await acceptWithRecipientProof(operations, acceptance(outside.user.email, managerInvite.token));
    // An explicit fixture authority assignment, not an inferred effect of joining.
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: outside.user.id, role: "admin" }).execute();
    const manager = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: f.schoolId,
      user_id: outside.user.id, at: new Date().toISOString() }));
    if (!manager.acting) throw new Error("The explicitly appointed fixture manager must first have an active endpoint.");
    await db.transaction().execute(tx => core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: manager.endpoint_id,
      actor_user_id: f.user.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "revoked",
      reason: "Fixture manager's campus endpoint was revoked", source_domain: "auth", source_record_id: randomUUID(),
      source_revision: 1, idempotency_key: randomUUID() }));
    const actor = { ...outside.user, active_school_id: f.schoolId };
    const before = await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "revoked_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow();
    await expect(operations.resendInvitation(actor, f.schoolId, invitation.id)).rejects.toThrow("campus app access is no longer active");
    await expect(operations.revokeInvitation(actor, f.schoolId, invitation.id)).rejects.toThrow("campus app access is no longer active");
    expect(await db.selectFrom("school_invitations").select(["token_hash", "expires_at", "revoked_at"])
      .where("id", "=", invitation.id).executeTakeFirstOrThrow()).toEqual(before);
    expect((await db.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId)
      .where("user_id", "=", outside.user.id).where("role", "=", "admin").executeTakeFirstOrThrow()).is_active).toBe(true);
  }, 30_000);

  it("does not take over an account explicitly linked to a different campus person after invitation issuance", async () => {
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const student = await explicitlyCreateLearner(f, f.email);
    const account = (await accountByEmail(f.email))!;
    const before = (await sql<{ password_hash: string; onboarding_pending: boolean; email_verified_at: Date | null }>`SELECT password_hash,onboarding_pending,email_verified_at
      FROM users WHERE id=${account.id}::uuid`.execute(db)).rows[0]!;
    await expect(operations.acceptInvite(acceptance(f.email, invitation.token))).rejects.toThrow("Finish or recover the original account");
    expect((await sql`SELECT password_hash,onboarding_pending,email_verified_at FROM users WHERE id=${account.id}::uuid`.execute(db)).rows[0]).toEqual(before);
    expect(await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId).where("user_id", "=", account.id).execute())
      .toEqual([{ role: "student" }]);
    expect((await db.selectFrom("school_people").select("account_user_id").where("id", "=", f.person.id).executeTakeFirstOrThrow()).account_user_id).toBeNull();
    expect((await db.selectFrom("students").select("person_id").where("id", "=", student.id).executeTakeFirstOrThrow()).person_id).not.toBe(f.person.id);
    expect(await db.selectFrom("school_invitations").select(["accepted_at", "accepted_by_user_id"]).where("id", "=", invitation.id).executeTakeFirstOrThrow())
      .toEqual({ accepted_at: null, accepted_by_user_id: null });
  }, 30_000);

  it("refuses a newly provisional recipient on resend and acceptance without resetting their existing credentials", async () => {
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const outside = await founder();
    await explicitlyCreateLearner(outside, f.email);
    const account = (await accountByEmail(f.email))!;
    const before = (await sql`SELECT password_hash,onboarding_pending,email_verified_at FROM users WHERE id=${account.id}::uuid`.execute(db)).rows[0];
    await expect(operations.resendInvitation(f.user, f.schoolId, invitation.id)).rejects.toThrow("finish or recover");
    await expect(operations.acceptInvite(acceptance(f.email, invitation.token))).rejects.toThrow("Finish or recover the original account");
    expect((await sql`SELECT password_hash,onboarding_pending,email_verified_at FROM users WHERE id=${account.id}::uuid`.execute(db)).rows[0]).toEqual(before);
    expect(await db.selectFrom("school_memberships").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", account.id).execute()).toEqual([]);
    expect((await db.selectFrom("school_people").select("account_user_id").where("id", "=", f.person.id).executeTakeFirstOrThrow()).account_user_id).toBeNull();
    expect((await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", invitation.id).executeTakeFirstOrThrow()).accepted_at).toBeNull();
  }, 30_000);

  it("does not resend or accept an invitation after its existing global recipient becomes inactive", async () => {
    const f = await fixture(), outside = await founder();
    const invitation = await operations.invite(f.user, f.schoolId, { ...f.input, email: outside.user.email });
    await db.updateTable("users").set({ is_active: false }).where("id", "=", outside.user.id).execute();
    const before = await db.selectFrom("school_invitations").select(["token_hash", "created_at", "expires_at"]).where("id", "=", invitation.id).executeTakeFirstOrThrow();
    await expect(operations.resendInvitation(f.user, f.schoolId, invitation.id)).rejects.toThrow("finish or recover");
    await expect(operations.acceptInvite(acceptance(outside.user.email, invitation.token))).rejects.toThrow("inactive");
    expect(await db.selectFrom("school_invitations").select(["token_hash", "created_at", "expires_at"]).where("id", "=", invitation.id).executeTakeFirstOrThrow()).toEqual(before);
    expect(await db.selectFrom("school_memberships").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", outside.user.id).execute()).toEqual([]);
    expect((await db.selectFrom("school_people").select("account_user_id").where("id", "=", f.person.id).executeTakeFirstOrThrow()).account_user_id).toBeNull();
  }, 30_000);

  it("rolls back acceptance when the person changes and when Core refuses linkage, then permits a safe retry", async () => {
    const retired = await fixture();
    const retiredInvitation = await operations.invite(retired.user, retired.schoolId, retired.input);
    const retiredProof = await invitationRecipientProof(operations, { email: retired.email, token: retiredInvitation.token });
    await sql`UPDATE school_people SET retired_at=now() WHERE id=${retired.person.id}::uuid`.execute(db);
    await expect(operations.acceptInvite({ ...acceptance(retired.email, retiredInvitation.token), recipient_proof: retiredProof })).rejects.toThrow("linkage changed");
    await assertUnaccepted(retired, retiredInvitation.id);
    const f = await fixture();
    const invitation = await operations.invite(f.user, f.schoolId, f.input);
    const failLink = vi.spyOn(core, "linkAccountEndpoint").mockRejectedValueOnce(new Error("Concurrent identity link refusal"));
    await expect(acceptWithRecipientProof(operations, acceptance(f.email, invitation.token))).rejects.toThrow("Concurrent identity link refusal");
    expect(failLink).toHaveBeenCalledOnce();
    await assertUnaccepted(f, invitation.id);
    failLink.mockRestore();
    await acceptWithRecipientProof(operations, acceptance(f.email, invitation.token));
    expect((await accountByEmail(f.email))?.role).toBe("member");
    expect((await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", invitation.id).executeTakeFirstOrThrow()).accepted_at).not.toBeNull();
  }, 30_000);
});

describe("app invitation Live control-plane safety", () => {
  it("rejects Simulation before parsing credentials, querying, generating codes, reading configuration or creating external effects", async () => {
    const unused = vi.fn(() => { throw new Error("No Live database access is allowed."); });
    const database = { transaction: unused, executeQuery: unused, selectFrom: unused } as unknown as DatabaseService;
    const identity = {} as HumanAgentIdentityPort;
    const helper = new PersonAccountInvitationsService(database, identity, {} as never, {} as never);
    const operations = new OperationsService(database, {} as never, helper);
    const environment = simulationRequestEnvironment({ institution_id: randomUUID(), scenario_id: randomUUID(), run_id: randomUUID(),
      virtual_now: "2026-10-20T12:00:00.000Z", source_snapshot_ref: "isolated-invite-test", manifest_ref: "boundary-test",
      checked_at: "2026-10-20T12:00:00.000Z" });
    const user: AuthUser = { id: randomUUID(), username: "sim-owner", email: "never-delivered@example.test", first_name: "Sim",
      last_name: "Owner", role: "admin", is_active: true, active_school_id: environment.institution_id };
    const code = vi.spyOn(invitationCodes, "issueInvitationCode");
    const configuration = vi.spyOn(appConfig, "config").mockImplementation(() => { throw new Error("No Live credential configuration is allowed."); });
    const fetch = vi.fn(() => { throw new Error("No external delivery is allowed."); });
    vi.stubGlobal("fetch", fetch);
    await executionEnvironmentStorage.run(environment, async () => {
      await expect(operations.invite(user, environment.institution_id, { role: "member" })).rejects.toThrow("managed in Live");
      await expect(operations.acceptInvite({})).rejects.toThrow("managed in Live");
      await expect(helper.confirmCompanyAdministratorInTransaction({} as never,
        { id: randomUUID(), school_id: environment.institution_id, source: "company", role: "admin" }, user.id,
        { confirmed: true, first_name: "Never", last_name: "Written" })).rejects.toThrow("managed in Live");
      await expect(operations.invitationDetail(user, environment.institution_id, randomUUID())).rejects.toThrow("managed in Live");
      await expect(helper.linkAcceptedStudentEndpointInTransaction({} as never, { school_id: environment.institution_id,
        student_id: randomUUID(), user_id: user.id, invitation_id: randomUUID() })).rejects.toThrow("managed in Live");
    });
    expect(unused).not.toHaveBeenCalled();
    expect(code).not.toHaveBeenCalled();
    expect(configuration).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
