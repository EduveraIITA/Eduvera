import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { LearningAssignmentHandoverService } from "../src/learning/learning-assignment-handover.service.js";
import { assignmentHandoverFixture } from "./learning-assignment-handover.test-support.js";
import { createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/assignment_handover_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
async function submitted(f: Awaited<ReturnType<typeof assignmentHandoverFixture>>) {
  const source = await f.publish();
  await f.assignments.saveWork(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Private immutable learner answer" });
  const attempt = await f.assignments.submit(f.learner.actor, source.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
  return { source, attempt };
}
async function command(f: Awaited<ReturnType<typeof assignmentHandoverFixture>>, id: string) {
  const preview = await f.handovers.detail(f.owner, id);
  return { command_id: randomUUID(), expected_revision: preview.revision, reviewer_id: f.otherTeacher.id, preview_hash: preview.preview_hash, reason: "The original reviewer has ended this teaching responsibility." };
}

describe.skipIf(!enabled)("explicit assignment reviewer handover", () => {
  it("repairs a revoked reviewer, reissues exact work and recovers the accepted command without exposing answers to setup", async () => {
    const f = await assignmentHandoverFixture(db), { source, attempt } = await submitted(f), id = source.assignment_id;
    const original = await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow();
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, state: "needs_reassignment" }));
    const preview = await f.handovers.detail(f.owner, id);
    expect(preview).toMatchObject({ pending_reviews: 1, reviewer: { current: false }, reviewers: [{ id: f.otherTeacher.id }] });
    expect(JSON.stringify(preview)).not.toContain("Private immutable learner answer");
    await expect(f.assignments.detail(f.owner, id, f.learner.id)).rejects.toThrow();
    const input = await command(f, id), accepted = await f.handovers.transfer(f.owner, id, input);
    expect(accepted).toMatchObject({ revision: 3, handover_id: input.command_id, reviews_reissued: 1, reviewer_id: f.otherTeacher.id, replayed: false });
    expect(await f.handovers.transfer(f.owner, id, input)).toMatchObject({ ...accepted, replayed: true });
    await expect(f.handovers.transfer(f.owner, id, { ...input, reason: "Changed replay intent" })).rejects.toThrow("different assignment");
    expect(await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow()).toEqual(original);
    const oldMessage = await db.selectFrom("campus_model_operational_messages").select("state").where("id", "=", original.review_message_id!).executeTakeFirstOrThrow();
    expect(oldMessage.state).toBe("cancelled");
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, state: "waiting_for_review", owner_user_id: f.otherTeacher.id }));
    expect(await f.assignments.projectWork(f.otherTeacher)).toContainEqual(expect.objectContaining({ assignment_id: id, attempt_id: attempt.attempt_id, action: "review", stream: "needs_me" }));
    await expect(f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: attempt.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "Old reviewer must not act" })).rejects.toThrow();
    await f.assignments.review(f.otherTeacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: attempt.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "Reviewed by the explicitly appointed successor." });
    expect(await f.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "reviewed", attempts: [{ id: attempt.attempt_id, body: original.body, review: { decision: "reviewed" } }] });
    expect(await db.selectFrom("learning_assignment_review_handovers").selectAll().where("assignment_id", "=", id).execute()).toHaveLength(1);
    await expect(sql`UPDATE learning_assignments SET instructions='rewrite' WHERE id=${id}::uuid`.execute(db)).rejects.toThrow("immutable");
    await expect(sql`DELETE FROM learning_assignment_review_handovers WHERE assignment_id=${id}::uuid`.execute(db)).rejects.toThrow("immutable");
    await db.updateTable("school_memberships").set({ role: "member" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
    await expect(f.handovers.transfer(f.owner, id, input)).rejects.toThrow();
  });

  it("preserves a prior request for changes while reissuing learner revision work at the new source revision", async () => {
    const f = await assignmentHandoverFixture(db), { source, attempt } = await submitted(f), id = source.assignment_id;
    await f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: attempt.attempt_id, review_id: randomUUID(), decision: "request_changes", feedback: "Explain your result before submitting again." });
    const before = await db.selectFrom("learning_assignment_reviews").selectAll().where("attempt_id", "=", attempt.attempt_id).executeTakeFirstOrThrow();
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    expect(await f.handovers.transfer(f.owner, id, await command(f, id))).toMatchObject({ revision: 3, reviews_reissued: 0 });
    expect(await f.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "revise", state: "action_required", stream: "needs_me" }));
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, body: "Revised answer retained under a new explicit reviewer." });
    const next = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 3, attempt_id: randomUUID() });
    await f.assignments.review(f.otherTeacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, attempt_id: next.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "Complete." });
    expect(await db.selectFrom("learning_assignment_reviews").selectAll().where("attempt_id", "=", attempt.attempt_id).executeTakeFirstOrThrow()).toEqual(before);
  });

  it("refuses a stale submitted-work preview and unrelated setup actors without retaining partial handovers", async () => {
    const f = await assignmentHandoverFixture(db), source = await f.publish(), id = source.assignment_id, input = await command(f, id);
    for (const actor of [f.teacher, f.otherTeacher, f.guardian, f.learner.actor]) await expect(f.handovers.transfer(actor, id, input)).rejects.toThrow("setup authority");
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Arrived after preview" });
    await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    await expect(f.handovers.transfer(f.owner, id, input)).rejects.toMatchObject({ response: { code: "assignment_handover_preview_obsolete" } });
    expect(await db.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
    const fresh = await command(f, id);
    await expect(f.handovers.transfer(f.owner, id, { ...fresh, reviewer_id: f.learner.actor.id })).rejects.toThrow("eligible reviewer");
  });

  it("rolls back the source, handover and protocol closures when a command outcome fails", async () => {
    const f = await assignmentHandoverFixture(db), { source, attempt } = await submitted(f), id = source.assignment_id, input = await command(f, id);
    const before = await db.selectFrom("learning_assignment_attempts").select("review_message_id").where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow();
    const original = f.core.completeDomainCommand.bind(f.core), failure = vi.spyOn(f.core, "completeDomainCommand").mockImplementation(async (tx, value) => {
      if (value.metadata.handover_id) throw new Error("Injected handover outcome loss before commit");
      return original(tx, value);
    });
    try { await expect(f.handovers.transfer(f.owner, id, input)).rejects.toThrow("Injected handover outcome loss"); } finally { failure.mockRestore(); }
    expect(await db.selectFrom("learning_assignments").select(["revision", "reviewer_id"]).where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ revision: 2, reviewer_id: f.teacher.id });
    expect(await db.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
    expect(await db.selectFrom("campus_model_operational_messages").select("state").where("id", "=", before.review_message_id!).executeTakeFirstOrThrow()).not.toEqual({ state: "cancelled" });
    expect(await f.handovers.transfer(f.owner, id, input)).toMatchObject({ replayed: false, revision: 3 });
  });

  it("rejects a false supersession subject or earlier source lineage before any handover commits", async () => {
    const f = await assignmentHandoverFixture(db), { source } = await submitted(f), input = await command(f, source.assignment_id);
    const original = f.core.supersedeDomainMessage.bind(f.core);
    for (const patch of [{ subject_record_id: randomUUID() }, { previous_event_id: randomUUID() }]) {
      const altered = vi.spyOn(f.core, "supersedeDomainMessage").mockImplementation((tx, value) => original(tx, { ...value, ...patch }));
      try { await expect(f.handovers.transfer(f.owner, source.assignment_id, input)).rejects.toThrow("supersession lacks"); } finally { altered.mockRestore(); }
      expect(await db.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", source.assignment_id).execute()).toEqual([]);
    }
    expect(await f.handovers.transfer(f.owner, source.assignment_id, input)).toMatchObject({ revision: 3 });
  });

  it("rejects an accepted command from a different selected namespace at deferred provenance validation", async () => {
    const f = await assignmentHandoverFixture(db), { source, attempt } = await submitted(f), id = source.assignment_id, input = await command(f, id);
    const originalAttempt = await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow();
    const complete = f.core.completeDomainCommand.bind(f.core);
    const altered = vi.spyOn(f.core, "completeDomainCommand").mockImplementation(async (tx, value) => {
      const receipt = await complete(tx, value);
      // The owning command/outcome are genuinely accepted in Live. A forged
      // transaction namespace must not let their proof authorize another world.
      if (value.metadata.id === id && value.metadata.handover_id === input.command_id) await sql`SELECT set_config('thatcampus.namespace_id', ${`simulation:${randomUUID()}`}, true)`.execute(tx);
      return receipt;
    });
    try {
      await expect(f.handovers.transfer(f.owner, id, input)).rejects.toThrow("requires its exact accepted owning command");
    } finally { altered.mockRestore(); }
    expect(await db.selectFrom("learning_assignments").select(["revision", "reviewer_id"]).where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ revision: 2, reviewer_id: f.teacher.id });
    expect(await db.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
    expect(await db.selectFrom("learning_assignment_handover_messages").select("message_id").where("assignment_id", "=", id).execute()).toEqual([]);
    expect(await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow()).toEqual(originalAttempt);
    expect(await db.selectFrom("campus_model_operational_messages").select("state").where("id", "=", originalAttempt.review_message_id!).executeTakeFirstOrThrow()).not.toEqual({ state: "cancelled" });
    expect(await f.handovers.transfer(f.owner, id, input)).toMatchObject({ revision: 3, replayed: false, reviews_reissued: 1 });
  });

  it("repeats A to B to A for two pending learners with exact task cardinality and immutable original attempts", async () => {
    const f = await assignmentHandoverFixture(db), { source, attempt } = await submitted(f), id = source.assignment_id;
    await f.assignments.saveWork(f.secondLearner.actor, id, f.secondLearner.id, { command_id: randomUUID(), expected_revision: 0, body: "Second learner's immutable answer" });
    const second = await f.assignments.submit(f.secondLearner.actor, id, f.secondLearner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const original = await db.selectFrom("learning_assignment_attempts").selectAll().where("assignment_id", "=", id).orderBy("id").execute();
    expect(original).toHaveLength(2);
    const firstInput = await command(f, id), firstReceipt = await f.handovers.transfer(f.owner, id, firstInput);
    expect(firstReceipt).toMatchObject({ revision: 3, reviews_reissued: 2, reviewer_id: f.otherTeacher.id });
    expect((await f.assignments.projectWork(f.otherTeacher)).filter(item => item.assignment_id === id && item.stream === "needs_me")).toHaveLength(2);
    expect((await f.assignments.projectWork(f.teacher)).filter(item => item.assignment_id === id)).toEqual([]);
    const between = await db.selectFrom("learning_assignment_handover_messages").selectAll().where("assignment_id", "=", id).execute();
    expect(between).toHaveLength(2); expect(new Set(between.map(item => item.message_id)).size).toBe(2);
    const preview = await f.handovers.detail(f.owner, id), secondInput = { command_id: randomUUID(), expected_revision: preview.revision, reviewer_id: f.teacher.id, preview_hash: preview.preview_hash, reason: "Review responsibility explicitly returns to the original eligible instructor." };
    expect(await f.handovers.transfer(f.owner, id, secondInput)).toMatchObject({ revision: 4, reviews_reissued: 2, reviewer_id: f.teacher.id });
    expect(await f.handovers.transfer(f.owner, id, secondInput)).toMatchObject({ revision: 4, replayed: true });
    const current = (await f.assignments.projectWork(f.teacher)).filter(item => item.assignment_id === id && item.stream === "needs_me");
    expect(current).toHaveLength(2); expect(new Set(current.map(item => item.message_id)).size).toBe(2);
    expect((await f.assignments.projectWork(f.otherTeacher)).filter(item => item.assignment_id === id)).toEqual([]);
    expect(await db.selectFrom("learning_assignment_attempts").selectAll().where("assignment_id", "=", id).orderBy("id").execute()).toEqual(original);
    const previousMessages = [...original.map(item => item.review_message_id!), ...between.map(item => item.message_id)];
    expect((await db.selectFrom("campus_model_operational_messages").select(["id", "state"]).where("id", "in", previousMessages).execute()).every(item => item.state === "cancelled")).toBe(true);
    const cancellations = await db.selectFrom("campus_model_operational_message_outcomes").select(["message_id", "state", "response"]).where("message_id", "in", previousMessages).execute();
    expect(cancellations).toHaveLength(4); expect(cancellations.every(item => item.state === "cancelled" && item.response === null)).toBe(true);
    expect(await db.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toHaveLength(2);
    expect(await db.selectFrom("learning_assignment_handover_messages").select("message_id").where("assignment_id", "=", id).execute()).toHaveLength(4);
    for (const [learner, submission] of [[f.learner, attempt], [f.secondLearner, second]] as const) {
      await f.assignments.review(f.teacher, id, learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: submission.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "The explicitly current reviewer completed this exact attempt." });
    }
    expect((await f.assignments.projectWork(f.teacher)).filter(item => item.assignment_id === id)).toEqual([]);
  });

  it("uses a current person-based offering appointment without inventing staff or inheriting historical private work", async () => {
    const f = await createLearningOfferingFixture(db), offering = await f.create(), source = await f.publish(offering.id), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Offering answer" });
    const attempt = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const next = await f.member("Replacement Instructor"), group = await f.offerings.detail(f.owner, offering.id);
    await f.offerings.endInstructor(f.owner, offering.id, group.current_instructor!.id, { command_id: randomUUID(), expected_revision: 1, reason: "The instructor is leaving." });
    const ended = await f.offerings.detail(f.owner, offering.id);
    await f.offerings.appointInstructor(f.owner, offering.id, { command_id: randomUUID(), expected_revision: ended.revision, instructor: f.reference(next.person), starts_on: f.today });
    await expect(f.assignments.detail(next.actor, id, f.learner.id)).rejects.toThrow();
    const handovers = new LearningAssignmentHandoverService(db, f.context, f.model), preview = await handovers.detail(f.owner, id);
    expect(preview.reviewers).toEqual([{ id: next.actor.id, name: "Replacement Instructor" }]);
    await handovers.transfer(f.owner, id, { command_id: randomUUID(), expected_revision: preview.revision, reviewer_id: next.actor.id, preview_hash: preview.preview_hash, reason: "Explicit transfer of retained assignment reviews." });
    expect(await f.assignments.projectWork(next.actor)).toContainEqual(expect.objectContaining({ attempt_id: attempt.attempt_id, action: "review" }));
    await f.assignments.review(next.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: attempt.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "New explicit reviewer completed this work." });
  });
});
