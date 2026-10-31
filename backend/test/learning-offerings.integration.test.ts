import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import type { AuthenticatedRequest } from "../src/common/request.js";
import { createLearningAssignmentFixture } from "./learning-assignments.test-support.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/learning_offerings_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
async function rejectedResponse(operation: () => Promise<unknown>) {
  try { await operation(); } catch (cause) {
    if (typeof cause === "object" && cause !== null && "getResponse" in cause && typeof cause.getResponse === "function")
      return cause.getResponse() as unknown;
    throw cause;
  }
  throw new Error("Expected a rejected command.");
}

describe.skipIf(!enabled)("canonical-person learning offerings", () => {
  it("starts one offering from ordinary invited members, then completes private drafts, revision and review with no academic scaffolding", async () => {
    const f = await createLearningOfferingFixture(db);
    const empty = { students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 };
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual(empty);
    for (const actor of [f.instructor, f.learner, f.secondLearner]) {
      expect(actor.actor.role).toBe("member");
      expect(await db.selectFrom("school_memberships").select("role").where("school_id", "=", f.schoolId).where("user_id", "=", actor.actor.id).execute())
        .toEqual([{ role: "member" }]);
      expect(await db.selectFrom("school_invitations").select(["person_id", "accepted_by_user_id"]).where("id", "=", actor.invitationId).executeTakeFirstOrThrow())
        .toEqual({ person_id: actor.id, accepted_by_user_id: actor.actor.id });
    }
    const passive = await f.passive("Passive learner without an app account");
    const offering = await f.create({ participants: [f.reference(f.learner.person), f.reference(f.secondLearner.person), f.reference(passive)] });
    expect(await f.offerings.create(f.owner, offering.input)).toMatchObject({ replayed: true });
    await expect(f.offerings.create(f.owner, { ...offering.input, name: "Changed retry input" })).rejects.toThrow();
    expect(await rejectedResponse(() => f.offerings.create(f.owner, { ...offering.input, instructor: { id: f.instructor.id, expected_revision: 1 } })))
      .not.toHaveProperty("fields.offering_obsolete");
    expect(await rejectedResponse(() => f.offerings.create(f.owner, { ...offering.input, offering_id: randomUUID(), instructor: { id: f.instructor.id, expected_revision: 1 } })))
      .not.toHaveProperty("fields.offering_obsolete");
    expect(await f.offerings.confirmation(f.owner, offering.id, offering.input.command_id, "create")).toMatchObject({ handler: "learning.offerings", source_id: offering.id,
      command_id: offering.input.command_id, action: "create", state: "accepted", result: { id: offering.id, revision: 1 } });
    await expect(f.offerings.confirmation(f.owner, randomUUID(), offering.input.command_id, "create")).rejects.toThrow();
    await expect(f.offerings.confirmation(f.owner, offering.id, offering.input.command_id, "enroll")).rejects.toThrow();
    await expect(f.offerings.confirmation(f.instructor.actor, offering.id, offering.input.command_id, "create")).rejects.toThrow();
    const absent = await f.offerings.confirmation(f.owner, offering.id, randomUUID(), "create");
    expect(absent).toMatchObject({ handler: "learning.offerings", source_id: offering.id, action: "create", state: "not_found" });
    expect(absent).not.toHaveProperty("result"); expect(absent).not.toHaveProperty("receipt_state");
    const memberships = (await sql<{ total: number }>`SELECT count(*)::int AS total FROM learning_offering_enrollments
      WHERE school_id=${f.schoolId}::uuid AND offering_id=${offering.id}::uuid`.execute(db)).rows[0]!;
    expect(memberships.total).toBe(3);
    expect(await f.offerings.detail(f.owner, offering.id)).toBeDefined();
    const source = await f.publish(offering.id), id = source.assignment_id;
    expect((await sql<{ person_id: string }>`SELECT person_id FROM learning_assignment_audience WHERE assignment_id=${id}::uuid AND person_id=${passive.id}::uuid`.execute(db)).rows)
      .toEqual([{ person_id: passive.id }]);
    expect(await db.selectFrom("school_people").select("account_user_id").where("id", "=", passive.id).executeTakeFirstOrThrow()).toEqual({ account_user_id: null });
    await expect(f.assignments.save(f.owner, f.input(offering.id))).rejects.toThrow();
    expect(await f.assignments.list(f.instructor.actor, { offering_id: offering.id })).toMatchObject({ can_create: true, items: [{ id }] });
    expect(await f.assignments.list(f.learner.actor, { person_id: f.learner.id })).toMatchObject({ can_create: false, items: [{ id }] });
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "submit" }));
    const learnerWork = (await f.assignments.projectWork(f.learner.actor)).find(item => item.assignment_id === id)!;
    expect(learnerWork.href).toContain(`person_id=${f.learner.id}`); expect(learnerWork.href).not.toContain("student_id=");
    const save = { command_id: randomUUID(), expected_revision: 0, body: "for (let i = 0; i < 10; i++) print(i)" };
    expect(await f.assignments.saveWork(f.learner.actor, id, f.learner.id, save)).toMatchObject({ revision: 1, replayed: false });
    expect(await f.assignments.saveWork(f.learner.actor, id, f.learner.id, save)).toMatchObject({ revision: 1, replayed: true });
    expect(await f.assignments.detail(f.instructor.actor, id, f.learner.id)).toMatchObject({ draft: null, files: [], attempts: [] });
    await expect(f.assignments.detail(f.secondLearner.actor, id, f.learner.id)).rejects.toThrow();
    const submit = { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() };
    const receipt = await f.assignments.submit(f.learner.actor, id, f.learner.id, submit);
    expect(await f.assignments.submit(f.learner.actor, id, f.learner.id, submit)).toMatchObject({ ...receipt, replayed: true });
    expect(await f.assignments.projectWork(f.instructor.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "review", attempt_id: receipt.attempt_id,
      student_label: "Sana Offering Learner", reviewer_label: "Meera Offering Instructor" }));
    expect((await f.assignments.projectWork(f.instructor.actor)).find(item => item.assignment_id === id)!.href).toContain(`offering_id=${offering.id}`);
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, stream: "waiting", state: "waiting_for_review" }));
    const changes = { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: receipt.attempt_id,
      decision: "request_changes", feedback: "Explain why the loop stops, then submit again." };
    await f.assignments.review(f.instructor.actor, id, f.learner.id, changes);
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "revise", stream: "needs_me" }));
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, body: "The loop stops when i reaches 10." });
    const second = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 3, attempt_id: randomUUID() });
    await f.assignments.review(f.instructor.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, review_id: randomUUID(), attempt_id: second.attempt_id,
      decision: "reviewed", feedback: "Clear explanation." });
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "reviewed", can_write: false,
      attempts: [{ attempt_number: 2, review: { decision: "reviewed" } }, { id: receipt.attempt_id, body: save.body, review: { decision: "request_changes" } }] });
    expect((await f.assignments.projectWork(f.instructor.actor)).filter(item => item.assignment_id === id)).toEqual([]);
    expect((await f.assignments.projectWork(f.learner.actor)).filter(item => item.assignment_id === id)).toEqual([]);
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual(empty);
    const safe = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify(safe)).not.toContain(save.body); expect(JSON.stringify(safe)).not.toContain(changes.feedback);
    expect((await sql`SELECT id FROM invitation_email_jobs
      WHERE invitation_id=ANY(${[f.instructor.invitationId, f.learner.invitationId, f.secondLearner.invitationId]}::uuid[])`.execute(db)).rows).toEqual([]);
    await f.people.correctName({ authUser: f.owner, requestId: randomUUID() } as AuthenticatedRequest, f.schoolId, f.instructor.id,
      { first_name: "Meera Updated Offering Instructor", expected_revision: f.instructor.person.revision, reason: "Explicit synthetic display-name correction", idempotency_key: randomUUID() });
    // The accepted exact receipt wins over a subsequently changed People selection.
    expect(await f.offerings.create(f.owner, offering.input)).toMatchObject({ replayed: true, id: offering.id });
  }, 60_000);

  it("keeps simultaneous offerings and source-specific review handoffs independent for the same canonical people", async () => {
    const f = await createLearningOfferingFixture(db), first = await f.create(), other = await f.create({ name: "Evening robotics" });
    const a = await f.publish(first.id), b = await f.publish(other.id);
    const attempts = [];
    for (const source of [a, b]) {
      await f.assignments.saveWork(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: `Work for ${source.title}` });
      attempts.push(await f.assignments.submit(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() }));
    }
    expect((await f.assignments.projectWork(f.instructor.actor)).filter(item => item.action === "review")).toHaveLength(2);
    const routes = (await sql<{ assignment_id: string; review_message_id: string }>`SELECT assignment_id,review_message_id FROM learning_assignment_attempts
      WHERE school_id=${f.schoolId}::uuid ORDER BY assignment_id`.execute(db)).rows;
    expect(new Set(routes.map(row => row.review_message_id)).size).toBe(2);
    await expect(f.assignments.review(f.instructor.actor, a.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(),
      attempt_id: attempts[1]!.attempt_id, decision: "reviewed", feedback: "Wrong source attempt must not be consumed." })).rejects.toThrow();
    await f.assignments.review(f.instructor.actor, a.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(),
      attempt_id: attempts[0]!.attempt_id, decision: "reviewed", feedback: "First offering complete." });
    expect(await f.assignments.detail(f.learner.actor, b.assignment_id, f.learner.id)).toMatchObject({ state: "submitted", attempts: [{ review: null }] });
    expect((await f.assignments.projectWork(f.instructor.actor)).filter(item => item.action === "review")).toEqual([expect.objectContaining({ assignment_id: b.assignment_id })]);
    expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM school_people WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.total).toBe(4);
  }, 60_000);

  it("explicitly appoints the founder through their canonical endpoint without inventing a staff profile or rewriting the person account cache", async () => {
    const f = await createLearningOfferingFixture(db);
    const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString() }));
    if (!identity.acting) throw new Error("Expected the ordinary founder account endpoint.");
    const person = await f.people.detail(f.owner, f.schoolId, identity.person_id);
    expect(await db.selectFrom("school_people").select("account_user_id").where("id", "=", person.id).executeTakeFirstOrThrow()).toEqual({ account_user_id: null });
    const offering = await f.create({ instructor: f.reference(person) });
    expect(await f.assignments.list(f.owner, { offering_id: offering.id })).toMatchObject({ can_create: true,
      reviewers: [expect.objectContaining({ id: f.owner.id, person_id: person.id, name: "Offering Owner" })] });
    const data = f.input(offering.id, { reviewer_id: f.owner.id });
    const saved = await f.assignments.save(f.owner, data), preview = await f.assignments.detail(f.owner, data.assignment_id);
    if (preview.context !== "offering" || !preview.publication_preview) throw new Error("Expected founder's explicitly appointed offering preview.");
    expect(await f.assignments.publish(f.owner, data.assignment_id, { command_id: randomUUID(), expected_revision: saved.revision,
      audience_hash: preview.publication_preview.audience_hash })).toMatchObject({ audience_count: 2 });
    expect(await db.selectFrom("school_people").select("account_user_id").where("id", "=", person.id).executeTakeFirstOrThrow()).toEqual({ account_user_id: null });
    const learning = await f.create({ name: "Owner learning a different offering", participants: [f.reference(person)] }), task = await f.publish(learning.id);
    expect(await f.assignments.projectWork(f.owner)).toContainEqual(expect.objectContaining({ assignment_id: task.assignment_id, action: "submit", stream: "needs_me" }));
    await f.assignments.saveWork(f.owner, task.assignment_id, person.id, { command_id: randomUUID(), expected_revision: 0, body: "A founder can be an explicitly enrolled learner too." });
    const receipt = await f.assignments.submit(f.owner, task.assignment_id, person.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    await f.assignments.review(f.instructor.actor, task.assignment_id, person.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: receipt.attempt_id,
      decision: "request_changes", feedback: "Keep this request attached to the founder's canonical learner identity." });
    expect(await f.assignments.projectWork(f.owner)).toContainEqual(expect.objectContaining({ assignment_id: task.assignment_id, action: "revise", stream: "needs_me" }));
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
  }, 60_000);

  it("freezes exact registrations, rejects stale publication review and does not restore old write rights after rejoining", async () => {
    const f = await createLearningOfferingFixture(db), offering = await f.create();
    const draft = f.input(offering.id), saved = await f.assignments.save(f.instructor.actor, draft), preview = await f.assignments.detail(f.instructor.actor, draft.assignment_id);
    if (preview.context !== "offering" || !preview.publication_preview) throw new Error("Expected publication preview.");
    const late = await f.member("Late joining learner");
    await f.offerings.enroll(f.owner, offering.id, { command_id: randomUUID(), expected_revision: 1, participants: [f.reference(late.person)], starts_on: f.today });
    await expect(f.assignments.publish(f.instructor.actor, draft.assignment_id, { command_id: randomUUID(), expected_revision: saved.revision,
      audience_hash: preview.publication_preview.audience_hash })).rejects.toThrow(/audience changed/i);
    const source = await f.publish(offering.id);
    await f.assignments.saveWork(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Retained after withdrawal" });
    const receipt = await f.assignments.submit(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const enrollment = (await sql<{ id: string; revision: number }>`SELECT id,revision FROM learning_offering_enrollments
      WHERE school_id=${f.schoolId}::uuid AND offering_id=${offering.id}::uuid AND person_id=${f.learner.id}::uuid ORDER BY created_at LIMIT 1`.execute(db)).rows[0]!;
    const end = { command_id: randomUUID(), expected_revision: enrollment.revision, reason: "Learner withdrew from this offering." };
    await f.offerings.endEnrollment(f.owner, offering.id, enrollment.id, end);
    expect(await f.assignments.detail(f.learner.actor, source.assignment_id, f.learner.id)).toMatchObject({ can_write: false, attempts: [{ id: receipt.attempt_id, body: "Retained after withdrawal" }] });
    const revision = (await sql<{ revision: number }>`SELECT revision FROM learning_offerings WHERE id=${offering.id}::uuid`.execute(db)).rows[0]!.revision;
    const person = await f.people.detail(f.owner, f.schoolId, f.learner.id);
    await f.offerings.enroll(f.owner, offering.id, { command_id: randomUUID(), expected_revision: revision, participants: [f.reference(person)], starts_on: f.today });
    expect(await f.offerings.endEnrollment(f.owner, offering.id, enrollment.id, end)).toMatchObject({ replayed: true });
    expect((await sql<{ open: number }>`SELECT count(*)::int AS open FROM learning_offering_enrollments WHERE school_id=${f.schoolId}::uuid
      AND offering_id=${offering.id}::uuid AND person_id=${f.learner.id}::uuid AND ends_on IS NULL`.execute(db)).rows[0]!.open).toBe(1);
    expect(await f.assignments.detail(f.learner.actor, source.assignment_id, f.learner.id)).toMatchObject({ can_write: false });
    await expect(f.assignments.review(f.instructor.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: receipt.attempt_id,
      decision: "request_changes", feedback: "A retained prior assignment, not a new enrollment entitlement." })).rejects.toThrow();
    await expect(f.assignments.saveWork(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, body: "Must not revive old rights" })).rejects.toThrow();
    await f.assignments.review(f.instructor.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: receipt.attempt_id,
      decision: "reviewed", feedback: "Retained prior work reviewed without reopening enrollment." });
    expect(await f.assignments.detail(f.learner.actor, source.assignment_id, f.learner.id)).toMatchObject({ can_write: false, attempts: [{ id: receipt.attempt_id }] });
    const fresh = await f.publish(offering.id);
    expect(await f.assignments.saveWork(f.learner.actor, fresh.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "New offering registration work" }))
      .toMatchObject({ revision: 1 });
    const audience = (await sql<{ offering_enrollment_id: string }>`SELECT offering_enrollment_id FROM learning_assignment_audience
      WHERE assignment_id=${source.assignment_id}::uuid AND person_id=${f.learner.id}::uuid`.execute(db)).rows[0]!;
    expect(audience.offering_enrollment_id).toBe(enrollment.id);
  }, 60_000);

  it("rechecks exact teaching appointments, source-aware SSE and current endpoints instead of inheriting administrator authority", async () => {
    const f = await createLearningOfferingFixture(db), offering = await f.create(), source = await f.publish(offering.id), id = source.assignment_id;
    const draft = { command_id: randomUUID(), expected_revision: 0, body: "Only this person's work." };
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, draft);
    const attempt = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const payload = { assignment_id: id, person_id: f.learner.id, attempt_id: attempt.attempt_id };
    const allowed = async (userId: string, eventType = "diary.updated", value: unknown = payload) =>
      (await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,${eventType},${JSON.stringify(value)}::jsonb,${userId}::uuid) AS allowed`.execute(db)).rows[0]!.allowed;
    expect(await allowed(f.instructor.actor.id)).toBe(true); expect(await allowed(f.learner.actor.id)).toBe(true);
    expect(await allowed(f.owner.id)).toBe(false); expect(await allowed(f.secondLearner.actor.id)).toBe(false);
    expect(await allowed(f.owner.id, "diary.updated", { ...payload, offering_id: offering.id })).toBe(false);
    expect(await allowed(f.secondLearner.actor.id, "diary.updated", { ...payload, offering_id: offering.id })).toBe(false);
    expect(await allowed(f.owner.id, "learning.offering.unknown", { offering_id: offering.id })).toBe(false);
    const emitted = (await sql<{ payload: Record<string, unknown> }>`SELECT payload FROM event_outbox
      WHERE school_id=${f.schoolId}::uuid AND event_type='diary.updated' AND aggregate_id=${id}::uuid
        AND payload->>'attempt_id'=${attempt.attempt_id} ORDER BY id DESC LIMIT 1`.execute(db)).rows[0]!.payload;
    expect(emitted).toMatchObject(payload); expect(emitted).not.toHaveProperty("student_id");
    expect(await allowed(f.owner.id, "diary.updated", emitted)).toBe(false);
    expect(await allowed(f.secondLearner.actor.id, "diary.updated", emitted)).toBe(false);
    expect(await allowed(f.instructor.actor.id, "learning.assignment.unknown")).toBe(false);
    expect(await allowed(f.instructor.actor.id, "diary.updated", { ...payload, person_id: f.secondLearner.id })).toBe(false);
    const appointment = (await sql<{ id: string; revision: number }>`SELECT id,revision FROM learning_offering_teaching_assignments
      WHERE school_id=${f.schoolId}::uuid AND offering_id=${offering.id}::uuid AND person_id=${f.instructor.id}::uuid`.execute(db)).rows[0]!;
    await f.offerings.endInstructor(f.owner, offering.id, appointment.id, { command_id: randomUUID(), expected_revision: appointment.revision, reason: "Instructor responsibility ended." });
    await expect(f.assignments.detail(f.instructor.actor, id, f.learner.id)).rejects.toThrow();
    await expect(f.assignments.review(f.instructor.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: attempt.attempt_id,
      decision: "reviewed", feedback: "No longer authorized" })).rejects.toThrow();
    expect(await allowed(f.instructor.actor.id)).toBe(false); expect(await allowed(f.learner.actor.id)).toBe(true);
    expect(await f.assignments.projectWork(f.instructor.actor)).toEqual([]);
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, state: "needs_reassignment", stream: "waiting" }));
    const replacementActor = await f.member("Replacement Offering Instructor");
    const appoint = { command_id: randomUUID(), expected_revision: 2, instructor: f.reference(replacementActor.person), starts_on: f.today };
    const replacement = await f.offerings.appointInstructor(f.owner, offering.id, appoint);
    expect(replacement.teaching_assignment_id).not.toBe(appointment.id);
    expect(await f.offerings.appointInstructor(f.owner, offering.id, appoint)).toMatchObject({ ...replacement, replayed: true });
    await expect(f.assignments.detail(replacementActor.actor, id, f.learner.id)).rejects.toThrow();
    expect(await allowed(replacementActor.actor.id)).toBe(false);
    expect(await f.assignments.list(replacementActor.actor, { offering_id: offering.id })).toMatchObject({ can_create: true, items: [] });
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, state: "needs_reassignment", stream: "waiting" }));
    const newWork = f.input(offering.id, { reviewer_id: replacementActor.actor.id, title: "New appointment, new assignment" });
    const saved = await f.assignments.save(replacementActor.actor, newWork), preview = await f.assignments.detail(replacementActor.actor, newWork.assignment_id);
    if (preview.context !== "offering" || !preview.publication_preview) throw new Error("Expected the replacement instructor's new publication preview.");
    await f.assignments.publish(replacementActor.actor, newWork.assignment_id, { command_id: randomUUID(), expected_revision: saved.revision, audience_hash: preview.publication_preview.audience_hash });
    await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: f.learner.endpoint.endpoint_id, actor_user_id: f.owner.id,
      expected_revision: 1, effective_at: new Date().toISOString(), disposition: "ended", reason: "Synthetic endpoint revocation",
      source_domain: "people", source_record_id: f.learner.id, source_revision: 2, idempotency_key: `offering-end:${randomUUID()}` }));
    await expect(f.assignments.saveWork(f.learner.actor, id, f.learner.id, draft)).rejects.toThrow();
    expect(await allowed(f.learner.actor.id)).toBe(false);
    await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: "diary.updated", aggregate_type: "learning_assignment",
      aggregate_id: randomUUID(), audience_user_ids: [f.instructor.actor.id], payload, idempotency_key: randomUUID() }).execute()).rejects.toThrow();
  }, 60_000);

  it("rolls back native setup when Core outcome fails and rejects stale or foreign People references without partial setup", async () => {
    const f = await createLearningOfferingFixture(db), failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected offering outcome failure"));
    await expect(f.create()).rejects.toThrow("Injected offering outcome failure"); failure.mockRestore();
    expect((await sql`SELECT id FROM learning_offerings WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    expect((await sql`SELECT id FROM learning_offering_enrollments WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    const stale = { command_id: randomUUID(), offering_id: randomUUID(), name: "Stale reviewed instructor", instructor: { id: f.instructor.id, expected_revision: 1 },
      participants: [f.reference(f.learner.person)], starts_on: f.today };
    expect(await rejectedResponse(() => f.offerings.create(f.owner, stale))).toMatchObject({ code: "learning.offering_selection_obsolete", fields: { offering_obsolete: {
      code: "learning.offering_selection_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.offerings", source_id: stale.offering_id,
      command_id: stale.command_id, expected_revision: 0, current_revision: 0, person_id: f.instructor.id, selected_revision: 1, current_person_revision: f.instructor.person.revision } } });
    expect(await f.offerings.confirmation(f.owner, stale.offering_id, stale.command_id, "create")).toMatchObject({ state: "not_found" });
    const foreign = await createLearningOfferingFixture(db);
    const foreignResult = await rejectedResponse(() => f.create({ participants: [{ id: foreign.learner.id, expected_revision: 1 }] }));
    expect(foreignResult).not.toHaveProperty("fields.offering_obsolete");
    await expect(f.offerings.create(f.instructor.actor, { command_id: randomUUID(), offering_id: randomUUID(), name: "Not my setup authority", participants: [f.reference(f.learner.person)],
      instructor: f.reference(f.instructor.person), starts_on: f.today })).rejects.toThrow();
    expect((await sql`SELECT id FROM learning_offerings WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
  }, 90_000);

  it("rejects instructor/learner overlap at creation, enrollment and new appointment without committing partial authority", async () => {
    const f = await createLearningOfferingFixture(db);
    expect(await rejectedResponse(() => f.create({ participants: [f.reference(f.instructor.person)] }))).toMatchObject({ statusCode: 400 });
    expect((await sql`SELECT id FROM learning_offerings WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    const offering = await f.create();
    expect(await rejectedResponse(() => f.offerings.enroll(f.owner, offering.id, { command_id: randomUUID(), expected_revision: 1,
      participants: [f.reference(f.instructor.person)], starts_on: f.today }))).toMatchObject({ statusCode: 400 });
    expect((await sql<{ revision: number }>`SELECT revision FROM learning_offerings WHERE id=${offering.id}::uuid`.execute(db)).rows).toEqual([{ revision: 1 }]);
    const appointment = (await sql<{ id: string }>`SELECT id FROM learning_offering_teaching_assignments WHERE offering_id=${offering.id}::uuid`.execute(db)).rows[0]!;
    await f.offerings.endInstructor(f.owner, offering.id, appointment.id, { command_id: randomUUID(), expected_revision: 1, reason: "Prepare an explicit new appointment." });
    expect(await rejectedResponse(() => f.offerings.appointInstructor(f.owner, offering.id, { command_id: randomUUID(), expected_revision: 2,
      instructor: f.reference(f.learner.person), starts_on: f.today }))).toMatchObject({ statusCode: 400 });
    expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM learning_offering_teaching_assignments WHERE offering_id=${offering.id}::uuid`.execute(db)).rows[0]!.total).toBe(1);
    expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM learning_offering_enrollments WHERE offering_id=${offering.id}::uuid`.execute(db)).rows[0]!.total).toBe(2);
    expect((await sql<{ revision: number }>`SELECT revision FROM learning_offerings WHERE id=${offering.id}::uuid`.execute(db)).rows).toEqual([{ revision: 2 }]);
  }, 60_000);

  it("preserves the existing class adapter's immutable identities, submitted content and reviews while a new offering operates", async () => {
    const legacy = await createLearningAssignmentFixture(db), source = await legacy.publish(), id = source.assignment_id;
    await legacy.assignments.saveWork(legacy.learner.actor, id, legacy.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Existing class work remains exact." });
    const attempt = await legacy.assignments.submit(legacy.learner.actor, id, legacy.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    await legacy.assignments.review(legacy.teacher, id, legacy.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: attempt.attempt_id,
      decision: "reviewed", feedback: "Retained class review." });
    const read = () => sql`SELECT row_to_json(attempt) AS attempt,row_to_json(review) AS review FROM learning_assignment_attempts attempt
      JOIN learning_assignment_reviews review ON review.attempt_id=attempt.id WHERE attempt.id=${attempt.attempt_id}::uuid`.execute(db);
    const before = (await read()).rows;
    const f = await createLearningOfferingFixture(db), offering = await f.create(), fresh = await f.publish(offering.id);
    await f.assignments.saveWork(f.learner.actor, fresh.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Independent offering work." });
    await f.assignments.submit(f.learner.actor, fresh.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    expect((await read()).rows).toEqual(before);
    expect(await legacy.assignments.detail(legacy.learner.actor, id, legacy.learner.id)).toMatchObject({ state: "reviewed", attempts: [{ id: attempt.attempt_id, manifest_hash: attempt.manifest_hash,
      body: "Existing class work remains exact.", review: { decision: "reviewed", feedback: "Retained class review." } }] });
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
  }, 60_000);
});
