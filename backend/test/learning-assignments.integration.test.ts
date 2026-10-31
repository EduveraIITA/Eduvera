import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createLearningAssignmentFixture } from "./learning-assignments.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/assignment_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
describe.skipIf(!enabled)("individual assignment owning-domain lifecycle", () => {
  it("saves a durable private draft, submits exactly once, returns changes and closes a second immutable attempt", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "submit", stream: "needs_me", due_at: null }));
    const save = { command_id: randomUUID(), expected_revision: 0, body: "for (let i = 0; i < 10; i++) print(i)" };
    expect(await f.assignments.saveWork(f.learner.actor, id, f.learner.id, save)).toMatchObject({ revision: 1, replayed: false });
    expect(await f.assignments.saveWork(f.learner.actor, id, f.learner.id, save)).toMatchObject({ revision: 1, replayed: true });
    const guardianDraft = await f.assignments.detail(f.guardian, id, f.learner.id);
    expect(guardianDraft).toMatchObject({ draft: null, files: [], attempts: [], can_write: false });
    expect(await f.assignments.detail(f.teacher, id, f.learner.id)).toMatchObject({ draft: null, files: [], attempts: [] });
    const submit = { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() };
    const receipt = await f.assignments.submit(f.learner.actor, id, f.learner.id, submit);
    expect(receipt).toMatchObject({ attempt_number: 1, replayed: false });
    expect(await f.assignments.submit(f.learner.actor, id, f.learner.id, submit)).toMatchObject({ ...receipt, replayed: true });
    expect(await f.assignments.projectWork(f.teacher)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "review", message_id: expect.any(String), due_at: null }));
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, stream: "waiting", state: "waiting_for_review", due_at: null }));
    await expect(f.assignments.saveWork(f.learner.actor, id, f.learner.id, { ...save, command_id: randomUUID(), expected_revision: 1 })).rejects.toThrow("saved version changed");
    const changes = { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submit.attempt_id,
      decision: "request_changes", feedback: "Explain why the loop stops at ten, then submit again." };
    await f.assignments.review(f.teacher, id, f.learner.id, changes);
    expect(await f.assignments.projectWork(f.teacher)).toEqual([]);
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "revise", stream: "needs_me" }));
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, body: "The loop stops when i reaches 10." });
    const second = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 3, attempt_id: randomUUID() });
    await f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, review_id: randomUUID(), attempt_id: second.attempt_id,
      decision: "reviewed", feedback: "The stopping condition is now clear." });
    expect(await f.assignments.projectWork(f.teacher)).toEqual([]);
    const own = await f.assignments.detail(f.learner.actor, id, f.learner.id);
    expect(own).toMatchObject({ state: "reviewed", can_write: false, attempts: [{ attempt_number: 2, review: { decision: "reviewed" } }, { attempt_number: 1, body: save.body, review: { decision: "request_changes" } }] });
    expect((await f.assignments.projectWork(f.learner.actor)).filter(item => item.assignment_id === id)).toEqual([]);
    // Earlier replay cannot create a new attempt or resurrect a closed obligation.
    await f.assignments.submit(f.learner.actor, id, f.learner.id, submit);
    expect(await db.selectFrom("learning_assignment_attempts").select("id").where("assignment_id", "=", id).execute()).toHaveLength(2);
    const commands = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify(commands)).not.toContain(save.body); expect(JSON.stringify(commands)).not.toContain(changes.feedback);
    await expect(sql`UPDATE learning_assignment_attempts SET body='changed' WHERE id=${submit.attempt_id}::uuid`.execute(db)).rejects.toThrow("immutable");
  });

  it("keeps due separate from cutoff and enforces mode, attempt limit, frozen audience and stale/changed commands", async () => {
    const f = await createLearningAssignmentFixture(db), due = new Date(Date.now() - 60000).toISOString();
    const source = await f.publish({ due_at: due, submission_mode: "text", max_attempts: 1 }), id = source.assignment_id;
    const save = { command_id: randomUUID(), expected_revision: 0, body: "My answer" };
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, save);
    await expect(f.assignments.saveWork(f.learner.actor, id, f.learner.id, { ...save, body: "Changed" })).rejects.toThrow("different assignment");
    await expect(f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Stale" })).rejects.toThrow();
    const submit = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ attempts: [{ late: true }] });
    await expect(f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submit.attempt_id,
      decision: "request_changes", feedback: "Another attempt" })).rejects.toThrow("attempt limit");
    // A new learner enrolled after publication does not acquire this historical source.
    await db.updateTable("enrollments").set({ is_active: false, inactive_from: f.date, exit_kind: "withdrawn", exit_reason: "Synthetic audience test", ended_at: new Date(), ended_by: f.owner.id }).where("student_id", "=", f.secondLearner.id).execute();
    const later = await f.publish();
    await db.insertInto("enrollments").values({ student_id: f.secondLearner.id, class_section_id: f.classId, term_id: f.termId, roll_number: 2, enrolled_on: f.date }).execute();
    await expect(f.assignments.detail(f.secondLearner.actor, later.assignment_id, f.secondLearner.id)).rejects.toThrow("published work");
    const cutoffAt = new Date(Date.now() + 60000).toISOString();
    const cutoffSource = await f.publish({ cutoff_at: cutoffAt });
    await f.assignments.saveWork(f.learner.actor, cutoffSource.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Saved before cutoff" });
    const world = createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(Date.parse(cutoffAt) + 1000), nowIso: () => new Date(Date.parse(cutoffAt) + 1000).toISOString() } });
    await executionEnvironmentStorage.run(world, async () => {
      await expect(f.assignments.submit(f.learner.actor, cutoffSource.assignment_id, f.learner.id,
        { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() })).rejects.toThrow("cutoff has passed");
      expect(await f.assignments.detail(f.learner.actor, cutoffSource.assignment_id, f.learner.id)).toMatchObject({ draft: { body: "Saved before cutoff" }, attempts: [] });
    });
  });

  it("denies unrelated/admin/guardian writers, revoked reviewers and ended current endpoints without erasing history", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    for (const actor of [f.owner, f.otherTeacher, f.guardian]) await expect(f.assignments.save(actor, f.input())).rejects.toThrow();
    for (const actor of [f.owner, f.otherTeacher, f.secondLearner.actor]) await expect(f.assignments.detail(actor, id, f.learner.id)).rejects.toThrow();
    await expect(f.assignments.saveWork(f.guardian, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Not my submission" })).rejects.toThrow("Only the learner");
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Retain my submission" });
    const submit = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    await expect(f.assignments.detail(f.teacher, id, f.learner.id)).rejects.toThrow("authority");
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ attempt_id: submit.attempt_id, state: "needs_reassignment" }));
    expect(await f.assignments.projectWork(f.teacher)).toEqual([]);
    await db.updateTable("enrollments").set({ is_active: false, inactive_from: f.date, exit_kind: "withdrawn", exit_reason: "Synthetic history test", ended_at: new Date(), ended_by: f.owner.id }).where("student_id", "=", f.learner.id).execute();
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ attempts: [{ body: "Retain my submission" }], can_write: false });
    await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: f.learner.endpoint.endpoint_id,
      actor_user_id: f.owner.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "ended", reason: "Synthetic identity revocation",
      source_domain: "people", source_record_id: f.learner.personId, source_revision: 1, idempotency_key: `assignment-end:${randomUUID()}` }));
    await expect(f.assignments.detail(f.learner.actor, id, f.learner.id)).rejects.toThrow("account link");
  });

  it("rolls back source and handoff when outcome fails and rejects audience changes after publication review", async () => {
    const f = await createLearningAssignmentFixture(db), data = f.input();
    const failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected outcome failure"));
    await expect(f.assignments.save(f.teacher, data)).rejects.toThrow("Injected outcome failure"); failure.mockRestore();
    expect(await db.selectFrom("learning_assignments").select("id").where("id", "=", data.assignment_id).executeTakeFirst()).toBeUndefined();
    await f.assignments.save(f.teacher, data);
    const preview = await f.assignments.detail(f.teacher, data.assignment_id);
    if (preview.context !== "class") throw new Error("Expected class preview");
    await db.updateTable("enrollments").set({ revision: 2 }).where("student_id", "=", f.learner.id).execute();
    await expect(f.assignments.publish(f.teacher, data.assignment_id, { command_id: randomUUID(), expected_revision: 1, audience_hash: preview.publication_preview!.audience_hash })).rejects.toThrow("audience changed");
    expect(await db.selectFrom("learning_assignment_audience").select("student_id").where("assignment_id", "=", data.assignment_id).execute()).toEqual([]);
  });

  it("returns exact obsolete proof only after receipt lookup and prevents a delayed old draft from applying after changes", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    const original = { command_id: randomUUID(), expected_revision: 0, body: "Accepted draft" };
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, original);
    const delayed = { command_id: randomUUID(), expected_revision: 1, body: "Never accepted stale edit" };
    const submit = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    // Exact accepted receipt wins despite the later submission/draft revision.
    expect(await f.assignments.saveWork(f.learner.actor, id, f.learner.id, original)).toMatchObject({ revision: 1, replayed: true });
    const obsolete = async () => {
      try { await f.assignments.saveWork(f.learner.actor, id, f.learner.id, delayed); throw new Error("Expected obsolete command"); }
      catch (cause) { expect(cause).toHaveProperty("getResponse"); return (cause as { getResponse: () => unknown }).getResponse(); }
    };
    expect(await obsolete()).toMatchObject({ code: "assignment_revision_obsolete", fields: { assignment_obsolete: {
      receipt_state: "absent", source_id: id, command_id: delayed.command_id, expected_revision: 1, current_revision: 2,
    } } });
    await f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submit.attempt_id,
      decision: "request_changes", feedback: "Add the explanation." });
    expect(await obsolete()).toMatchObject({ code: "assignment_revision_obsolete" });
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ draft: { body: original.body, revision: 2 } });
  });

  it("retains unavailable protocol work as Waiting and never offers actionable closed review/revision", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Response" });
    const submit = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const attempt = await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", submit.attempt_id).executeTakeFirstOrThrow();
    await db.updateTable("campus_model_operational_messages").set({ state: "cancelled" }).where("id", "=", attempt.review_message_id!).execute();
    expect(await f.assignments.projectWork(f.teacher)).toEqual([]);
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, stream: "waiting", state: "route_unavailable" }));
    expect(await f.assignments.detail(f.teacher, id, f.learner.id)).toMatchObject({ can_review: false });
    await expect(f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submit.attempt_id,
      decision: "reviewed", feedback: "Must not accept a cancelled handoff" })).rejects.toThrow("handoff is unavailable");
    // Synthetic protocol recovery for the test only; no production reopen operation is implied.
    await db.updateTable("campus_model_operational_messages").set({ state: "queued" }).where("id", "=", attempt.review_message_id!).execute();
    await f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: submit.attempt_id,
      decision: "request_changes", feedback: "Explain the condition." });
    const updated = await db.selectFrom("learning_assignment_attempts").select("revision_message_id").where("id", "=", submit.attempt_id).executeTakeFirstOrThrow();
    await db.updateTable("campus_model_operational_messages").set({ state: "dead_letter" }).where("id", "=", updated.revision_message_id!).execute();
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ action: "revise", stream: "waiting", state: "route_unavailable", owner_user_id: f.teacher.id, reviewer_label: "Meera Practice Fixture" }));
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ can_write: true, can_submit: false });
    await expect(f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, attempt_id: randomUUID() })).rejects.toThrow("revision handoff is unavailable");
    expect(await f.assignments.projectWork(f.otherTeacher)).toEqual([]); expect(await f.assignments.projectWork(f.owner)).toEqual([]);
  });

  it("rechecks source-aware refresh/replay access after reviewer or guardian authority changes and rejects forged events", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Private accepted work" });
    const submit = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const payload = { assignment_id: id, student_id: f.learner.id, attempt_id: submit.attempt_id };
    const allowed = async (userId: string, name = "diary.updated", value: unknown = payload) => (await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,${name},${JSON.stringify(value)}::jsonb,${userId}::uuid) AS allowed`.execute(db)).rows[0]!.allowed;
    expect(await allowed(f.teacher.id)).toBe(true); expect(await allowed(f.learner.actor.id)).toBe(true); expect(await allowed(f.guardian.id)).toBe(true);
    expect(await allowed(f.owner.id)).toBe(false); expect(await allowed(f.otherTeacher.id)).toBe(false); expect(await allowed(f.secondLearner.actor.id)).toBe(false);
    expect(await allowed(f.teacher.id, "learning.assignment.unknown")).toBe(false);
    expect(await allowed(f.teacher.id, "diary.updated", { ...payload, student_id: f.secondLearner.id })).toBe(false);
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    expect(await allowed(f.teacher.id)).toBe(false);
    await db.deleteFrom("guardian_relationships").where("school_id", "=", f.schoolId).where("student_id", "=", f.learner.id).execute();
    expect(await allowed(f.guardian.id)).toBe(false); expect(await allowed(f.learner.actor.id)).toBe(true);
    await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: "diary.updated", aggregate_type: "learning_assignment", aggregate_id: randomUUID(),
      audience_user_ids: [f.teacher.id], payload, idempotency_key: randomUUID() }).execute()).rejects.toThrow("does not match");
    await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: "learning.assignment.unknown", aggregate_type: "learning_assignment", aggregate_id: id,
      audience_user_ids: [], payload, idempotency_key: randomUUID() }).execute()).rejects.toThrow("Unknown assignment event schema");
  });
});
