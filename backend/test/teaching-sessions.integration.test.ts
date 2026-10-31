import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createAcceptedTeachingCover, createTeachingSessionFixture, teachingDay, teachingSessionServices } from "./teaching-sessions.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { learningAssignmentServices } from "./learning-assignments.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/teaching_unused_test", max: 3,
}) }) }) as DatabaseService;
afterAll(() => db.destroy());

describe.skipIf(!enabled).sequential("dated teaching-session owning-domain acceptance", () => {
  let f: Awaited<ReturnType<typeof createTeachingSessionFixture>>;
  let service: ReturnType<typeof teachingSessionServices>;
  let campusGrantId: string;
  let nativeId: string;
  beforeAll(async () => { f = await createTeachingSessionFixture(db); service = teachingSessionServices(db, f.core); });

  const source = async (date = f.date, kind: "academic" | "activity" = "academic") => {
    const found = (await service.context.sources(db, f.teacher, date)).sources.find(item => item.source_kind === kind);
    if (!found) throw new Error(`Expected the exact fictional ${kind} session.`);
    return found;
  };
  const reportClock = <T>(operation: () => Promise<T>) => {
    const now = new Date(`${f.date}T16:00:00Z`);
    return executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => now, nowIso: () => now.toISOString() } }), operation);
  };

  it("requires an explicit lesson grant rather than administrator status or being the scheduled teacher", async () => {
    const exact = await source();
    for (const actor of [f.owner, f.teacher, f.otherTeacher, f.guardian])
      await expect(service.sessions.detail(actor, exact.id, f.date)).rejects.toThrow();
    expect(await service.sessions.detail(f.learner.actor, exact.id, f.date)).toMatchObject({
      lesson: { state: "empty" }, capabilities: { can_manage: false, can_read_preparation: false },
    });
    await expect(service.sessions.save(f.teacher, exact.id, f.date, { command_id: randomUUID(), expected_revision: 0,
      source_fingerprint: exact.source_fingerprint, state: "prepared", preparation: "Not yet authorized", topic: "", learner_notes: "" })).rejects.toThrow();
    expect(await db.selectFrom("teaching_sessions").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    await f.allowClass();
    expect(await service.sessions.detail(f.teacher, exact.id, f.date)).toMatchObject({ capabilities: { can_manage: true, can_read_preparation: true } });
  });

  it("retains one academic lesson across a real room-change publication, safe retries and attributed corrections", async () => {
    const exact = await source(), privatePreparation = "PRIVATE preparation: explain the loop using an unpublished staff example.";
    const preparation = { command_id: randomUUID(), expected_revision: 0, source_fingerprint: exact.source_fingerprint,
      state: "prepared", preparation: privatePreparation, topic: "", learner_notes: "" };
    expect(await service.sessions.save(f.teacher, exact.id, f.date, preparation)).toMatchObject({ revision: 1, replayed: false });
    expect(await service.sessions.save(f.teacher, exact.id, f.date, preparation)).toMatchObject({ revision: 1, replayed: true });
    await expect(service.sessions.save(f.teacher, exact.id, f.date, { ...preparation, preparation: "Changed payload" })).rejects.toThrow("different teaching work");
    const sharedId = randomUUID(), staffId = randomUUID();
    await service.materials.add(f.teacher, exact.id, f.date, { command_id: randomUUID(), expected_revision: 1, source_fingerprint: exact.source_fingerprint,
      material_id: sharedId, title: "Loop example", kind: "text", body: "for (let i = 0; i < 3; i++) print(i)", shared: true });
    await service.materials.add(f.teacher, exact.id, f.date, { command_id: randomUUID(), expected_revision: 2, source_fingerprint: exact.source_fingerprint,
      material_id: staffId, title: "PRIVATE staff answer", kind: "text", body: "PRIVATE unpublished answer", shared: false });
    const participant = await service.sessions.detail(f.learner.actor, exact.id, f.date);
    expect(participant.materials.map(item => item.id)).toEqual([sharedId]);
    expect(JSON.stringify(participant)).not.toContain(privatePreparation);
    expect(JSON.stringify(participant)).not.toContain("PRIVATE");
    await f.changeRoom();
    const moved = await source();
    expect(moved.id).toBe(exact.id); expect(moved.source_fingerprint).not.toBe(exact.source_fingerprint);
    expect(moved.place_label).toBe("Replacement practice room");
    expect(await service.sessions.save(f.teacher, exact.id, f.date, preparation)).toMatchObject({ revision: 1, replayed: true });
    await expect(service.sessions.save(f.teacher, exact.id, f.date, { ...preparation, command_id: randomUUID(), expected_revision: 3 }))
      .rejects.toThrow("schedule changed");
    const report = { command_id: randomUUID(), expected_revision: 3, source_fingerprint: moved.source_fingerprint,
      state: "reported", preparation: privatePreparation, topic: "Programming loops", learner_notes: "Practice the three-iteration example.", reason: "" };
    await expect(service.sessions.save(f.teacher, moved.id, f.date, report)).rejects.toThrow();
    expect(await reportClock(() => service.sessions.save(f.teacher, moved.id, f.date, report))).toMatchObject({ revision: 4, replayed: false });
    expect(await reportClock(() => service.sessions.save(f.teacher, moved.id, f.date, report))).toMatchObject({ revision: 4, replayed: true });
    await expect(reportClock(() => service.sessions.save(f.teacher, moved.id, f.date, { ...report,
      command_id: randomUUID(), expected_revision: 4, topic: "Loops and stopping conditions" }))).rejects.toThrow();
    const corrected = { ...report, command_id: randomUUID(), expected_revision: 4, topic: "Loops and stopping conditions",
      reason: "Correct the topic to include the stopping condition actually covered." };
    expect(await reportClock(() => service.sessions.save(f.teacher, moved.id, f.date, corrected))).toMatchObject({ revision: 5 });
    const detail = await service.sessions.detail(f.teacher, moved.id, f.date);
    expect(detail.lesson).toMatchObject({ state: "reported", revision: 5, topic: corrected.topic, preparation: privatePreparation });
    expect(detail.history.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 4, topic: report.topic }), expect.objectContaining({ revision: 5, topic: corrected.topic, reason: corrected.reason }),
    ]));
    expect((await service.sessions.detail(f.learner.actor, moved.id, f.date)).lesson).not.toHaveProperty("preparation");
    await expect(sql`UPDATE teaching_session_revisions SET topic='overwrite' WHERE school_id=${f.schoolId}::uuid AND session_id=${moved.id}::uuid`.execute(db)).rejects.toThrow(/append-only|immutable/);
    const stale = { ...corrected, command_id: randomUUID(), expected_revision: 3 };
    await expect(reportClock(() => service.sessions.save(f.teacher, moved.id, f.date, stale))).rejects.toThrow("lesson record changed");
    const safe = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId)
      .where("source_domain", "=", "teaching_sessions").execute();
    expect(JSON.stringify(safe)).not.toContain(privatePreparation); expect(JSON.stringify(safe)).not.toContain(report.learner_notes);
    expect(JSON.stringify(safe)).not.toContain("PRIVATE staff answer");
    const refresh = await db.selectFrom("event_outbox").select("payload").where("school_id", "=", f.schoolId).where("aggregate_type", "=", "teaching_session").execute();
    expect(JSON.stringify(refresh)).not.toContain(privatePreparation); expect(JSON.stringify(refresh)).not.toContain(report.learner_notes);
    expect(JSON.stringify(refresh)).not.toContain("PRIVATE staff answer");
    expect(await db.selectFrom("teaching_sessions").select("id").where("school_id", "=", f.schoolId).where("id", "=", moved.id).execute()).toHaveLength(1);
  }, 60_000);

  it("supports a native teaching activity without fabricating enrollment and keeps shared resources separate from staff preparation", async () => {
    const planned = await f.native(), exact = await source(f.date, "activity"); nativeId = exact.id;
    expect(exact.occurrence_id).toBe(planned.occurrence.id); expect(exact.class_section_id).toBeNull();
    await expect(service.sessions.detail(f.teacher, exact.id, f.date)).rejects.toThrow();
    const grant = await f.allowCampus(); campusGrantId = grant.id;
    await f.allowCampus(f.otherTeacher);
    await expect(service.sessions.detail(f.otherTeacher, exact.id, f.date)).rejects.toThrow();
    const payload = { command_id: randomUUID(), expected_revision: 0, source_fingerprint: exact.source_fingerprint,
      state: "prepared", preparation: "PRIVATE robotics demonstration", topic: "", learner_notes: "" };
    expect(await service.sessions.save(f.teacher, exact.id, f.date, payload)).toMatchObject({ revision: 1 });
    const own = await service.sessions.detail(f.learner.actor, exact.id, f.date);
    expect(own.capabilities).toMatchObject({ can_manage: false, can_read_preparation: false });
    expect(JSON.stringify(own)).not.toContain(payload.preparation);
    await expect(service.sessions.save(f.learner.actor, exact.id, f.date, { ...payload, command_id: randomUUID(), expected_revision: 1 })).rejects.toThrow();
    await expect(service.materials.add(f.learner.actor, exact.id, f.date, { command_id: randomUUID(), expected_revision: 1,
      source_fingerprint: exact.source_fingerprint, material_id: randomUUID(), title: "Unauthorized learner upload", kind: "text", body: "Not an instructor", shared: true })).rejects.toThrow();
    expect(await service.sessions.detail(f.teacher, exact.id, f.date)).toMatchObject({ related: { practice: null, assignments: null } });
    expect(await db.selectFrom("enrollments").select("id").where("class_section_id", "=", f.classId).execute()).toHaveLength(2);
  }, 60_000);

  it("rolls back native records, audit and outcomes together, then replays only the exact accepted retry", async () => {
    const date = teachingDay(f.date, 7), exact = await source(date), payload = { command_id: randomUUID(), expected_revision: 0,
      source_fingerprint: exact.source_fingerprint, state: "prepared", preparation: "Retained exact draft after a lost response", topic: "", learner_notes: "" };
    const failure = vi.spyOn(service.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected teaching outcome failure"));
    await expect(service.sessions.save(f.teacher, exact.id, date, payload)).rejects.toThrow("Injected teaching outcome failure"); failure.mockRestore();
    expect(await db.selectFrom("teaching_sessions").select("id").where("id", "=", exact.id).execute()).toEqual([]);
    expect(await db.selectFrom("campus_model_commands").select("id").where("correlation_id", "=", payload.command_id).execute()).toEqual([]);
    expect(await db.selectFrom("audit_events").select("id").where("target_id", "=", exact.id).execute()).toEqual([]);
    expect(await db.selectFrom("event_outbox").select("id").where("aggregate_id", "=", exact.id).execute()).toEqual([]);
    expect(await service.sessions.save(f.teacher, exact.id, date, payload)).toMatchObject({ revision: 1, replayed: false });
    expect(await service.sessions.save(f.teacher, exact.id, date, payload)).toMatchObject({ revision: 1, replayed: true });
    const detail = await service.sessions.detail(f.teacher, exact.id, date);
    expect(detail.previous_lesson).toMatchObject({ id: (await source()).id, topic: "Loops and stopping conditions" });
    const trace = await db.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("correlation_id", "=", payload.command_id).execute();
    expect(trace).toEqual([{ state: "accepted", environment_namespace_id: `live:${f.schoolId}` }]);
  });

  it("associates only independently authorized published work and gives learners their own exact source link without private drafts", async () => {
    const date = teachingDay(f.date, 21), exact = await source(date);
    expect(await service.work.options(f.teacher, exact.id, date)).toMatchObject({ supported: true, items: [] });
    const permissions = ["learning.sessions.manage", "learning.work.publish", "learning.assignments.manage"];
    await db.updateTable("staff_responsibility_types").set({ capability_permissions: permissions }).where("id", "=", f.roleId).execute();
    const practice = await f.practice.publish(f.teacher, f.input({ date, title: "Practice carried by this exact session" }));
    const assignments = learningAssignmentServices(db).assignments, assignment = { command_id: randomUUID(), expected_revision: 0,
      assignment_id: randomUUID(), class_section_id: f.classId, term_id: f.termId, subject_id: null, reviewer_id: f.teacher.id,
      title: "Explain the session example", instructions: "Submit your own stopping-condition explanation.", due_at: null, cutoff_at: null,
      submission_mode: "text", max_attempts: null, policy_version: 1, resubmission_mode: "on_request" };
    const draft = await assignments.save(f.teacher, assignment), preview = await assignments.detail(f.teacher, assignment.assignment_id);
    if (preview.context !== "class" || !preview.publication_preview) throw new Error("Expected the existing assignment owner's reviewed publication audience.");
    await assignments.publish(f.teacher, assignment.assignment_id, { command_id: randomUUID(), expected_revision: draft.revision,
      audience_hash: preview.publication_preview.audience_hash });
    await assignments.saveWork(f.learner.actor, assignment.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0,
      body: "PRIVATE learner assignment draft must not enter the session page" });
    const options = await service.work.options(f.teacher, exact.id, date);
    expect(options.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ work_kind: "practice", work_id: practice.id }), expect.objectContaining({ work_kind: "assignment", work_id: assignment.assignment_id }),
    ]));
    const link = { command_id: randomUUID(), expected_revision: 0, source_fingerprint: exact.source_fingerprint, work_kind: "practice", work_id: practice.id };
    expect(await service.work.link(f.teacher, exact.id, date, link)).toMatchObject({ revision: 1, work_id: practice.id, replayed: false });
    expect(await service.work.link(f.teacher, exact.id, date, link)).toMatchObject({ revision: 1, replayed: true });
    await expect(service.work.link(f.teacher, exact.id, date, { ...link, command_id: randomUUID(), expected_revision: 1 })).rejects.toThrow("already linked");
    await service.work.link(f.teacher, exact.id, date, { ...link, command_id: randomUUID(), expected_revision: 1, work_kind: "assignment", work_id: assignment.assignment_id });
    await expect(service.work.link(f.learner.actor, exact.id, date, { ...link, command_id: randomUUID(), expected_revision: 2 })).rejects.toThrow();
    const learner = await service.sessions.detail(f.learner.actor, exact.id, date);
    expect(learner.associated_work).toHaveLength(2);
    expect(learner.associated_work.every(item => item.href.includes(`student_id=${f.learner.id}`))).toBe(true);
    expect(JSON.stringify(learner)).not.toContain("PRIVATE learner assignment draft");
    const wrongSubject = await db.insertInto("subjects").values({ school_id: f.schoolId, code: `TS-${randomUUID().slice(0, 8)}`,
      name: "A different fictional subject", short_name: "Different" }).returning("id").executeTakeFirstOrThrow();
    const unrelated = await f.practice.publish(f.teacher, f.input({ date, subject_id: wrongSubject.id, title: "Different-subject practice" }));
    await expect(service.work.link(f.teacher, exact.id, date, { ...link, command_id: randomUUID(), expected_revision: 2, work_id: unrelated.id })).rejects.toThrow("exact class, term and subject");
    await db.updateTable("staff_responsibility_types").set({ capability_permissions: ["learning.sessions.manage"] }).where("id", "=", f.roleId).execute();
    await expect(service.work.link(f.teacher, exact.id, date, link)).rejects.toThrow("current learning authority");
    expect((await service.sessions.detail(f.teacher, exact.id, date)).associated_work).toEqual([]);
    expect((await service.sessions.detail(f.learner.actor, exact.id, date)).associated_work).toHaveLength(2);
  }, 60_000);

  it("retains an exact source-change refusal even when a place label returns to its reviewed value", async () => {
    const campus = await db.insertInto("institution_campuses").values({ school_id: f.schoolId, parent_campus_id: null,
      name: "Fictional teaching campus", code: `TS-${randomUUID().slice(0, 8)}`, campus_type: "learning_centre", created_by: f.owner.id, updated_by: f.owner.id })
      .returning("id").executeTakeFirstOrThrow();
    const place = await db.insertInto("campus_spaces").values({ school_id: f.schoolId, campus_id: campus.id, parent_space_id: null,
      name: "Fictional room A", code: `TS-${randomUUID().slice(0, 8)}`, kind: "classroom", capacity: 12, attributes: {},
      created_by: f.owner.id, updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    await db.updateTable("timetable_slots").set({ space_id: place.id }).where("id", "=", f.slotId).execute();
    const date = teachingDay(f.date, 14), reviewed = await source(date), command = { command_id: randomUUID(), expected_revision: 0,
      source_fingerprint: reviewed.source_fingerprint, state: "prepared", preparation: "Keep this draft while the room changes.", topic: "", learner_notes: "" };
    await db.updateTable("campus_spaces").set({ name: "Fictional room B" }).where("id", "=", place.id).execute();
    expect((await source(date)).source_fingerprint).not.toBe(reviewed.source_fingerprint);
    const refusal = async () => {
      try { await service.sessions.save(f.teacher, reviewed.id, date, command); throw new Error("Expected a retained source-change refusal."); }
      catch (cause) { expect(cause).toHaveProperty("getResponse"); return (cause as { getResponse: () => unknown }).getResponse(); }
    };
    const first = await refusal();
    expect(first).toMatchObject({ code: "learning.session_source_changed", fields: { lesson_obsolete: {
      receipt_state: "conflicted", confirmation: "permanently_inapplicable", reviewed_source_fingerprint: reviewed.source_fingerprint,
    } } });
    await db.updateTable("campus_spaces").set({ name: "Fictional room A" }).where("id", "=", place.id).execute();
    expect((await source(date)).source_fingerprint).toBe(reviewed.source_fingerprint);
    expect(await refusal()).toEqual(first);
    expect(await db.selectFrom("teaching_sessions").select("id").where("id", "=", reviewed.id).execute()).toEqual([]);
    expect(await db.selectFrom("campus_model_commands").select("state").where("correlation_id", "=", command.command_id).execute()).toEqual([{ state: "conflicted" }]);
  });

  it("rechecks wrong actor, tenant, current scope and revoked authority even for already accepted command receipts", async () => {
    const exact = await source(), payload = { command_id: randomUUID(), expected_revision: 5, source_fingerprint: exact.source_fingerprint,
      state: "reported", preparation: "PRIVATE final preparation", topic: "Loops and stopping conditions", learner_notes: "Practice the example.",
      reason: "Clarify the practice instruction." };
    await reportClock(() => service.sessions.save(f.teacher, exact.id, f.date, payload));
    await expect(service.sessions.detail({ ...f.teacher, active_school_id: randomUUID() }, exact.id, f.date)).rejects.toThrow();
    await expect(service.sessions.save(f.otherTeacher, exact.id, f.date, payload)).rejects.toThrow();
    const event = (await sql<{ id: string; payload: Record<string, unknown> }>`SELECT id,payload FROM event_outbox WHERE school_id=${f.schoolId}::uuid
      AND event_type='diary.updated' AND aggregate_type='teaching_session' AND aggregate_id=${exact.id}::uuid
      AND payload->>'revision'='6'`.execute(db)).rows[0];
    if (!event) throw new Error("Expected the real accepted lesson correction's neutral refresh event.");
    const allowed = async (userId: string, value = event.payload) => (await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'diary.updated',
      ${JSON.stringify(value)}::jsonb,${userId}::uuid) AS allowed`.execute(db)).rows[0]!.allowed;
    expect((await sql<{ valid: boolean }>`SELECT event_source_is_valid(${f.schoolId}::uuid,'diary.updated','teaching_session',${exact.id}::uuid,
      ${JSON.stringify(event.payload)}::jsonb) AS valid`.execute(db)).rows[0]!.valid).toBe(true);
    await expect(sql`UPDATE event_outbox SET payload=payload||'{"extra":"forged private content"}'::jsonb
      WHERE id=${event.id}::uuid`.execute(db)).rejects.toHaveProperty("code", "23514");
    expect((await db.selectFrom("event_outbox").select("payload").where("id", "=", event.id).executeTakeFirstOrThrow()).payload).toEqual(event.payload);
    expect(await allowed(f.teacher.id)).toBe(true); expect(await allowed(f.learner.actor.id)).toBe(true);
    expect(await allowed(f.owner.id)).toBe(false); expect(await allowed(f.otherTeacher.id)).toBe(false);
    expect(await allowed(f.teacher.id, { ...event.payload, session_id: randomUUID() })).toBe(false);
    const wrong = createLiveExecutionEnvironment({ institution_id: randomUUID(), clock: { now: () => new Date(), nowIso: () => new Date().toISOString() } });
    await expect(executionEnvironmentStorage.run(wrong, () => service.sessions.detail(f.teacher, exact.id, f.date))).rejects.toThrow("selected world");
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "in", [f.assignmentId, campusGrantId]).execute();
    await expect(service.sessions.detail(f.teacher, exact.id, f.date)).rejects.toThrow();
    await expect(reportClock(() => service.sessions.save(f.teacher, exact.id, f.date, payload))).rejects.toThrow();
    expect(await allowed(f.teacher.id)).toBe(false); expect(await allowed(f.learner.actor.id)).toBe(true);
    await expect(service.sessions.detail(f.teacher, nativeId, f.date)).rejects.toThrow();
    expect((await service.sessions.detail(f.learner.actor, exact.id, f.date)).lesson).toMatchObject({ state: "reported", topic: payload.topic });
  });

  it("limits an explicitly authorized replacement to the exact accepted cover session and preserves the original instructor's read history", async () => {
    await f.allowCampus();
    const before = await source();
    await expect(service.sessions.detail(f.otherTeacher, before.id, f.date)).rejects.toThrow();
    await createAcceptedTeachingCover(db, f);
    const covered = (await service.context.sources(db, f.otherTeacher, f.date)).sources.find(item => item.id === before.id);
    expect(covered).toMatchObject({ id: before.id, is_cover: true, scheduled_teacher_id: f.otherTeacher.id, original_teacher_id: f.teacher.id });
    if (!covered) throw new Error("Expected the original logical lesson under exact accepted cover.");
    expect(await service.sessions.detail(f.otherTeacher, covered.id, f.date)).toMatchObject({ capabilities: { can_manage: true } });
    expect(await service.sessions.detail(f.teacher, covered.id, f.date)).toMatchObject({ lesson: { state: "reported" }, capabilities: { can_manage: false, can_read_preparation: true } });
    const otherDate = teachingDay(f.date, 7), other = await source(otherDate);
    await expect(service.sessions.detail(f.otherTeacher, other.id, otherDate)).rejects.toThrow();
    await expect(service.sessions.detail(f.otherTeacher, nativeId, f.date)).rejects.toThrow();
    const lesson = await service.sessions.detail(f.otherTeacher, covered.id, f.date), input = { command_id: randomUUID(),
      expected_revision: lesson.lesson.revision, source_fingerprint: covered.source_fingerprint, state: "reported",
      preparation: "Cover teacher's own preparation", topic: "Loops and stopping conditions", learner_notes: "Continue the practice exercise.",
      reason: "Record the replacement instructor's continuation instruction." };
    await expect(reportClock(() => service.sessions.save(f.teacher, covered.id, f.date, input))).rejects.toThrow();
    await reportClock(() => service.sessions.save(f.otherTeacher, covered.id, f.date, input));
    expect((await service.sessions.detail(f.teacher, covered.id, f.date)).history.items[0]?.actor_name).toBe("OtherTeacher Practice Fixture");
    await db.transaction().execute(async tx => {
      const identity = await f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.otherTeacher.id, at: new Date().toISOString() });
      if (!identity.acting) throw new Error("Expected the current fictional cover-teacher endpoint.");
      await f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: identity.endpoint_id, actor_user_id: f.owner.id,
        expected_revision: 1, effective_at: new Date().toISOString(), disposition: "ended", reason: "Fictional identity-revocation acceptance test",
        source_domain: "staff_operations", source_record_id: f.otherTeacherProfile.id, source_revision: 1, idempotency_key: `teaching-endpoint:${randomUUID()}` });
    });
    await expect(service.sessions.detail(f.otherTeacher, covered.id, f.date)).rejects.toThrow("account link");
    await expect(reportClock(() => service.sessions.save(f.otherTeacher, covered.id, f.date, input))).rejects.toThrow("account link");
  }, 60_000);
});
