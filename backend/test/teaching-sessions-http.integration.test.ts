import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createTeachingSessionFixture } from "./teaching-sessions.test-support.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEACHING_SESSIONS_HTTP_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/teaching_http_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
interface Detail {
  session: { id: string; date: string; source_fingerprint: string; lesson_state: string };
  lesson: { revision: number; state: string; preparation?: string; topic: string };
  capabilities: { can_manage: boolean; can_read_preparation: boolean; can_link_work: boolean };
  materials: Array<{ id: string; title: string; body: string; shared: boolean }>;
  related: { attendance: unknown; practice: unknown; assignments: unknown };
}
interface Manifest { areas: Array<{ key: string; surfaces: Array<{ key: string; href: string }> }> }

describe.runIf(enabled)("teaching through the compiled authenticated ordinary application", () => {
  beforeAll(() => app.start(sourceUrl), 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); }, 10_000);
  it("opens one exact session, saves preparation and a shared code resource, then enforces privacy, CSRF and revocation", async () => {
    // Fictional identity setup only. Every lesson action below uses normal
    // authenticated cookies, CSRF and server-selected Live environment guards.
    const password = `Teaching-${randomUUID()}!`, f = await createTeachingSessionFixture(db, { passwordHash: await hashPassword(password) });
    await f.allowClass();
    const teacher = app.session(), learner = app.session(), owner = app.session(), other = app.session();
    for (const [session, actor] of [[teacher, f.teacher], [learner, f.learner.actor], [owner, f.owner], [other, f.otherTeacher]] as const)
      await session.login(actor.email, password, f.schoolId);
    const root = "/api/v1/learning/sessions", list = `${root}?date=${f.date}`;
    expect((await app.session().request(list)).status).toBe(401);
    const manifest = await teacher.json<Manifest>("/api/v1/workspace/");
    expect(manifest.areas.find(area => area.key === "timetable")?.surfaces)
      .toContainEqual(expect.objectContaining({ key: "sessions", href: "/areas/timetable/session" }));
    expect(manifest.areas.some(area => area.key === "attendance")).toBe(false);
    const records = await teacher.json<{ items: Array<{ id: string; date: string }> }>(list);
    expect(records.items).toHaveLength(1); expect(records.items[0]?.date).toBe(f.date);
    const opened = await teacher.json<Detail>(`${root}/open?date=${f.date}&class_section_id=${f.classId}&period_number=1`);
    expect(opened.session.id).toBe(records.items[0]?.id);
    expect(opened.capabilities).toEqual({ can_manage: true, can_read_preparation: true, can_link_work: false });
    expect(opened.related).toMatchObject({ attendance: null, practice: null, assignments: null });
    const detail = `${root}/${opened.session.id}?date=${f.date}`, lesson = `${root}/${opened.session.id}/lesson?date=${f.date}`;
    const prepared = { command_id: randomUUID(), expected_revision: 0, source_fingerprint: opened.session.source_fingerprint,
      state: "prepared", preparation: "PRIVATE teacher preparation never exposed to participants.", topic: "", learner_notes: "" };
    expect((await teacher.request(lesson, "PUT", prepared, false)).status).toBe(403);
    expect(await teacher.json(lesson, "PUT", prepared)).toMatchObject({ revision: 1, state: "prepared", replayed: false });
    expect(await teacher.json(lesson, "PUT", prepared)).toMatchObject({ revision: 1, state: "prepared", replayed: true });
    const material = { command_id: randomUUID(), expected_revision: 1, source_fingerprint: opened.session.source_fingerprint,
      material_id: randomUUID(), title: "Loop practice code", kind: "text", body: "for (let i = 0; i < 3; i++) console.log(i)", shared: true };
    const materials = `${root}/${opened.session.id}/materials?date=${f.date}`;
    expect(await teacher.json(materials, "POST", material)).toMatchObject({ revision: 2, material_id: material.material_id, replayed: false });
    expect(await teacher.json(materials, "POST", material)).toMatchObject({ revision: 2, material_id: material.material_id, replayed: true });
    expect((await teacher.request(lesson, "PUT", { ...prepared, command_id: randomUUID(), expected_revision: 2,
      state: "reported", topic: "Cannot report a future class as taught" })).status).toBe(400);
    const shared = await learner.json<Detail>(detail);
    expect(shared.capabilities).toEqual({ can_manage: false, can_read_preparation: false, can_link_work: false });
    expect(shared.lesson).toMatchObject({ state: "empty" }); expect(shared.lesson).not.toHaveProperty("preparation");
    expect(JSON.stringify(shared)).not.toContain(prepared.preparation);
    expect(shared.materials).toEqual([expect.objectContaining({ id: material.material_id, body: material.body, shared: true })]);
    expect((await learner.request(lesson, "PUT", { ...prepared, command_id: randomUUID(), expected_revision: 2 })).status).toBe(403);
    for (const unrelated of [owner, other]) expect((await unrelated.request(detail)).status).toBe(403);
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    expect((await teacher.request(detail)).status).toBe(403);
    expect((await teacher.request(lesson, "PUT", prepared)).status).toBe(403);
    expect((await learner.json<Detail>(detail)).materials).toHaveLength(1);
    expect(await db.selectFrom("attendance_registers").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    expect(await db.selectFrom("learning_assignments").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
  }, 90_000);
});
