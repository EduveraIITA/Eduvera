import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { IsolatedAppHttp, type IsolatedHttpSession } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/facilities_http_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
interface Repair { id: string; revision: number; state: string; photos: Array<{ id: string; href: string }>;
  latest_progress: { action: string; note: string } | null; allowed_actions: { accept: boolean; verify: boolean }; history: Array<{ action: string }> }
interface Manifest { areas: Array<{ key: string }>; work: { items: Array<{ direction: string; href: string; source?: { kind: string; id: string }; core_trace?: { message_ids: string[] }; due_at?: string | null }> } }
const nativeWork = async (session: IsolatedHttpSession, repairId: string) => (await session.json<Manifest>("/api/v1/workspace/"))
  .work.items.filter(item => item.source?.kind === "facility_repair" && item.source.id === repairId);

describe.runIf(enabled)("Repairs through the ordinary authenticated app", () => {
  beforeAll(() => app.start(source), 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); }, 10_000);

  it("starts without academic/catalogue setup, keeps private photos, and checks completion with the real reporter", async () => {
    process.env.INVITATION_EMAIL_ENABLED = "false";
    // This fixture creates ordinary People/account links only; it does not create
    // an offering, room, class, resource or timetable for the repair.
    const f = await createLearningOfferingFixture(db), password = `Fictional-Repairs-${randomUUID()}!`;
    await db.updateTable("users").set({ password_hash: await hashPassword(password) })
      .where("id", "in", [f.owner.id, f.learner.actor.id, f.secondLearner.actor.id]).execute();
    const owner = app.session(), reporter = app.session(), other = app.session();
    for (const [session, actor] of [[owner, f.owner], [reporter, f.learner.actor], [other, f.secondLearner.actor]] as const)
      await session.login(actor.email, password, f.schoolId);
    const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, {
      school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString(),
    }));
    await owner.json("/api/v1/onboarding/goals/", "PUT", { goals: ["facilities"] });
    const base = `/api/v1/schools/${f.schoolId}/facilities`;
    expect((await app.session().request(`${base}/workspace`)).status).toBe(401);
    const report = { command_id: randomUUID(), expected_revision: 0, location_note: "Fictional west hostel, room 12",
      problem: "PRIVATE fictional water leak beside the window", urgent: false };
    expect((await reporter.request(`${base}/repairs`, "POST", report)).status).toBe(422);
    const settings = { command_id: randomUUID(), expected_revision: 0, handler_person_id: identity.person_id,
      verifier_mode: "reporter", emergency_contact: "Fictional campus duty desk" };
    expect((await reporter.request(`${base}/settings`, "POST", settings)).status).toBe(403);
    await owner.json(`${base}/settings`, "POST", settings);
    expect((await owner.json<Manifest>("/api/v1/workspace/")).areas).toContainEqual(expect.objectContaining({ key: "facilities" }));
    expect((await reporter.request(`${base}/repairs`, "POST", report, false)).status).toBe(403);
    let repair = await reporter.json<Repair>(`${base}/repairs`, "POST", report);
    expect(repair).toMatchObject({ id: report.command_id, revision: 1, state: "reported" });
    expect(await reporter.json(`${base}/repairs`, "POST", report)).toMatchObject({ id: repair.id, revision: 1 });
    expect((await reporter.request(`${base}/repairs`, "POST", { ...report, problem: "A different problem" })).status).toBe(409);
    const path = `${base}/repairs/${repair.id}`, destination = `/areas/facilities?repair_id=${repair.id}`;
    expect(await reporter.json(`${path}/confirmation?command_id=${report.command_id}`)).toMatchObject({ state: "accepted", result: { id: repair.id, revision: 1 } });
    expect((await other.request(path)).status).toBe(403);
    expect(await nativeWork(owner, repair.id)).toMatchObject([{ direction: "needs_me", href: destination }]);
    expect(await nativeWork(reporter, repair.id)).toMatchObject([{ direction: "waiting", href: destination }]);
    expect(JSON.stringify(await nativeWork(owner, repair.id))).not.toContain(report.problem);

    const photoCommand = randomUUID(), image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7Z0AAAAASUVORK5CYII=", "base64");
    const photoForm = (type = "image/png", bytes = image) => {
      const body = new FormData(); body.set("command_id", photoCommand); body.set("expected_revision", String(repair.revision));
      body.set("file", new Blob([new Uint8Array(bytes)], { type }), "fictional-leak.png"); return body;
    };
    expect((await reporter.request(`${path}/photos`, "POST", photoForm("text/html", Buffer.from("<html>unsafe</html>")))).status).toBe(400);
    const upload = photoForm();
    repair = await reporter.json<Repair>(`${path}/photos`, "POST", upload);
    expect(repair.state).toBe("reported"); expect(repair.photos).toHaveLength(1); expect(repair.allowed_actions.accept).toBe(false);
    expect(await reporter.json(`${path}/photos`, "POST", upload)).toMatchObject({ revision: repair.revision, photos: repair.photos });
    const file = await reporter.request(repair.photos[0]!.href);
    expect(file.status).toBe(200); expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("x-thatcampus-source-content-omitted")).toBe("false");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(image);
    expect((await other.request(repair.photos[0]!.href)).status).toBe(403);
    expect((await app.session().request(repair.photos[0]!.href)).status).toBe(401);

    const act = async (session: IsolatedHttpSession, action: string, extra: Record<string, unknown> = {}) => {
      repair = await session.json<Repair>(`${path}/actions`, "POST", { command_id: randomUUID(), expected_revision: repair.revision, action, ...extra });
    };
    expect((await reporter.request(`${path}/actions`, "POST", { command_id: randomUUID(), expected_revision: repair.revision, action: "accept" })).status).toBe(403);
    await act(owner, "accept");
    await act(owner, "update", { status: "waiting", wait_reason: "parts", note: "Replacement pipe ordered; inspection still needed",
      expected_finish_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(repair.state).toBe("waiting");
    expect((await reporter.json<Repair>(path)).latest_progress).toMatchObject({ action: "updated", note: "Replacement pipe ordered; inspection still needed" });
    await act(owner, "complete", { note: "Plumber reports pipe replaced; please check" });
    expect(repair.state).toBe("awaiting_verification"); expect(repair.allowed_actions.verify).toBe(false);
    expect(await nativeWork(reporter, repair.id)).toMatchObject([{ direction: "needs_me" }]);
    expect((await owner.request(`${path}/actions`, "POST", { command_id: randomUUID(), expected_revision: repair.revision, action: "verify" })).status).toBe(403);
    await act(reporter, "reopen", { note: "Still dripping near the window after the repair" });
    expect(repair.state).toBe("reported");
    await act(owner, "accept"); await act(owner, "complete", { note: "Second joint sealed and tested; please inspect" });
    await act(reporter, "verify", { note: "Checked room; leak stopped" });
    expect(repair.state).toBe("closed");
    expect(await nativeWork(owner, repair.id)).toEqual([]); expect(await nativeWork(reporter, repair.id)).toEqual([]);
    const history = await reporter.json<Repair>(`${path}?history_page=1`);
    expect(history.history.map(row => row.action)).toEqual(expect.arrayContaining(["reported", "photo_added", "completed", "reopened", "verified"]));
    expect((await owner.json<{ pagination: { total: number } }>(`${base}/workspace?view=all&state=closed`)).pagination.total).toBe(1);
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
    expect(await db.selectFrom("campus_spaces").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    expect(await db.selectFrom("campus_resource_holdings").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    // A technician receives one explicit repair, not the ability to configure
    // the campus or read unrelated private repairs. The accountable coordinator
    // retains oversight rather than losing the job when delegating its handling.
    const second = await reporter.json<Repair>(`${base}/repairs`, "POST", { ...report, command_id: randomUUID(), problem: "Second fictional loose tap" });
    const secondPath = `${base}/repairs/${second.id}`, transferCommand = randomUUID();
    const transfer = await owner.json<Repair & { access_transferred: boolean }>(`${secondPath}/actions`, "POST", {
      command_id: transferCommand, expected_revision: second.revision, action: "assign", handler_person_id: f.secondLearner.id,
      note: "Assign this exact tap repair to the campus technician",
    });
    expect(transfer).toMatchObject({ state: "reported", revision: 2, access_transferred: false });
    expect(await owner.json(`${secondPath}/confirmation?command_id=${transferCommand}`)).toMatchObject({ state: "accepted", result: { id: second.id, revision: 2 } });
    expect((await owner.request(secondPath)).status).toBe(200);
    expect(await nativeWork(owner, second.id)).toMatchObject([{direction:"waiting"}]);
    expect((await other.request(path)).status).toBe(403);
    expect((await other.request(`${base}/settings`, "POST", { ...settings, command_id: randomUUID(), expected_revision: 1 })).status).toBe(403);
    let assigned = await other.json<Repair>(`${secondPath}/actions`, "POST", { command_id: randomUUID(), expected_revision: 2, action: "accept" });
    assigned = await other.json<Repair>(`${secondPath}/actions`, "POST", { command_id: randomUUID(), expected_revision: assigned.revision, action: "complete", note: "Tap tightened; reporter should check" });
    expect(assigned.state).toBe("awaiting_verification");
    assigned = await reporter.json<Repair>(`${secondPath}/actions`, "POST", { command_id: randomUUID(), expected_revision: assigned.revision, action: "verify" });
    expect(assigned.state).toBe("closed");
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.learner.actor.id).execute();
    expect((await reporter.request(path)).status).toBe(403);
    expect((await reporter.request(repair.photos[0]!.href)).status).toBe(403);
  }, 120_000);
});
