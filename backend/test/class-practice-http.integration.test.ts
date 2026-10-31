import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.CLASS_PRACTICE_HTTP_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 3 }) }) });
const app = new IsolatedAppHttp();
type Diary = { id: string; body: string; completed: boolean; notes: Array<{ body: string }> };
type Progress = { progress: { total: number; completed: number }; thread?: Array<{ body: string }> };

describe.runIf(enabled)("class practice across real authenticated teacher/learner/guardian HTTP", () => {
  beforeAll(() => app.start(sourceUrl), 30_000);
  afterAll(async () => { await app.stop(); await database.destroy(); }, 10_000);
  it("publishes, reports completion, asks privately, replies and reopens without Attendance authority", async () => {
    // Explicit fictional identity/role configuration; not signup/invitation acceptance.
    // Every operational action and read below uses the ordinary guarded HTTP APIs.
    const password = `Practice-${randomUUID()}!`, passwordHash = await hashPassword(password);
    const f = await createClassPracticeFixture(database as DatabaseService, { passwordHash });
    const teacher = app.session(), learner = app.session(), guardian = app.session(), otherLearner = app.session(), otherTeacher = app.session(), owner = app.session();
    for (const [session, actor] of [[teacher, f.teacher], [learner, f.learner.actor], [guardian, f.guardian],
      [otherLearner, f.secondLearner.actor], [otherTeacher, f.otherTeacher], [owner, f.owner]] as const) await session.login(actor.email, password, f.schoolId);
    const listPath = `/api/v1/learning/practice/?class_section_id=${f.classId}`;
    expect((await app.session().request(listPath)).status).toBe(401);
    expect((await teacher.json<{ can_publish: boolean }>(listPath)).can_publish).toBe(true);
    for (const session of [owner, otherTeacher, learner]) expect((await session.request(listPath)).status).toBe(403);
    const input = f.input();
    expect((await teacher.request("/api/v1/learning/practice/", "POST", input, false)).status).toBe(403);
    const published = await teacher.json<{ id: string; replayed: boolean }>("/api/v1/learning/practice/", "POST", input);
    expect(published).toMatchObject({ id: input.practice_id, replayed: false });
    expect(await teacher.json("/api/v1/learning/practice/", "POST", input)).toMatchObject({ id: input.practice_id, replayed: true });
    const detailPath = `/api/v1/learning/practice/${published.id}/?class_section_id=${f.classId}`;
    const diaryPath = `/api/v1/diary/${published.id}/?student_id=${f.learner.id}`;
    expect(await learner.json<Diary>(diaryPath)).toMatchObject({ id: published.id, completed: false, body: input.body });
    const completion = { student_id: f.learner.id, command: { command_id: randomUUID() } };
    await learner.json(`/api/v1/homework/${published.id}/complete/`, "POST", completion);
    await learner.json(`/api/v1/homework/${published.id}/complete/`, "POST", completion);
    expect(await guardian.json<Diary>(diaryPath)).toMatchObject({ completed: true });
    expect(await teacher.json<Progress>(detailPath)).toMatchObject({ progress: { total: 2, completed: 1 } });
    const question = { student_id: f.learner.id, body: "Can I use another sorting algorithm?",
      command: { command_id: randomUUID(), note_id: randomUUID() } };
    await learner.json(`/api/v1/diary/${published.id}/notes/`, "POST", question);
    await learner.json(`/api/v1/diary/${published.id}/notes/`, "POST", question);
    const threadPath = `${detailPath}&student_id=${f.learner.id}`;
    expect((await teacher.json<Progress>(threadPath)).thread).toEqual([expect.objectContaining({ body: question.body })]);
    const reply = { command_id: randomUUID(), note_id: randomUUID(), student_id: f.learner.id,
      body: "Yes—explain your choice and its complexity." };
    await teacher.json(`/api/v1/learning/practice/${published.id}/notes/`, "POST", reply);
    const returned = await guardian.json<Diary>(diaryPath);
    expect(returned.notes.map(note => note.body)).toEqual([question.body, reply.body]);
    for (const session of [owner, otherTeacher]) expect((await session.request(threadPath)).status).toBe(403);
    expect([403, 404]).toContain((await otherLearner.request(diaryPath)).status);
    expect([403, 404]).toContain((await otherLearner.request(`/api/v1/homework/${published.id}/complete/`, "POST", {
      student_id: f.learner.id, command: { command_id: randomUUID() } })).status);
    await guardian.json(`/api/v1/homework/${published.id}/complete/?student_id=${f.learner.id}`, "DELETE", { command: { command_id: randomUUID() } });
    expect(await learner.json<Diary>(diaryPath)).toMatchObject({ completed: false });
    expect(await teacher.json<Progress>(detailPath)).toMatchObject({ progress: { total: 2, completed: 0 } });
    expect(await database.selectFrom("attendance_registers").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
  }, 90_000);
});
