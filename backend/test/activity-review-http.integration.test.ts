import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.ACTIVITY_REVIEW_HTTP_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const pool = new Pool({ connectionString: sourceUrl, max: 3 });
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
let server: ChildProcess | undefined, base = "", diagnostics = "";

// Real AppModule, guards, cookies and execution interceptor. Only the explicit
// background lifecycle allowlist is disabled: starting ordinary main.js would
// process other retained test campuses. This proves HTTP composition, not workers.
const bootstrap = `
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory, ModulesContainer } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "./dist/app.module.js";
import { ApiExceptionFilter } from "./dist/common/errors.js";
const app = await NestFactory.create(AppModule, new FastifyAdapter({logger:{level:"error",redact:["req.headers.cookie","req.headers.authorization","res.headers.set-cookie"]},routerOptions:{ignoreTrailingSlash:true}}), {logger:false});
const background = new Set(["MarketingNotificationWorker","AgentChannelService","InvitationEmailWorker",
  "TransportRetentionService","AgentMemoryService","SimulationWorkerService","PeopleImportService",
  "PaymentEmailService","SchoolEventService","StaffOperationsService"]);
// The former only registers an inert callback with the disabled event worker;
// Razorpay's hook starts nothing with the explicitly false provider setting.
const safeHooks = new Set(["ActivityAttendanceLifecycleBridge","RazorpayService"]);
const disabled = new Set();
for (const module of app.get(ModulesContainer).values()) for (const provider of module.providers.values()) {
  const instance = provider.instance;
  if (!instance) continue;
  const name = instance.constructor?.name;
  const hasHook = ["onModuleInit","onApplicationBootstrap"].some(hook=>typeof instance[hook]==="function");
  if (hasHook && !background.has(name) && !safeHooks.has(name)) throw new Error("Unreviewed lifecycle hook; refuse HTTP test startup.");
  if (!background.has(name)) continue;
  for (const hook of ["onModuleInit","onApplicationBootstrap"]) if (typeof instance[hook] === "function") {
    instance[hook] = () => undefined; disabled.add(instance.constructor.name);
  }
}
if (disabled.size !== background.size) throw new Error("Background worker allowlist drift; refuse HTTP test startup.");
await app.register(cookie, {secret:process.env.COOKIE_SECRET,hook:"onRequest"});
app.getHttpAdapter().getInstance().addHook("onRequest", async request => { request.requestId=randomUUID(); });
app.useGlobalFilters(new ApiExceptionFilter());
await app.init();
await app.listen({host:"127.0.0.1",port:0});
const address=app.getHttpAdapter().getInstance().server.address();
process.stdout.write("REVIEW_HTTP_READY:"+address.port+"\\n");
for (const signal of ["SIGTERM","SIGINT"]) process.once(signal, async()=>{ await app.close(); process.exit(0); });
`;

class Session {
  private readonly cookies = new Map<string, string>();
  async request(path: string, method = "GET", body?: unknown, csrf = true) {
    const headers = new Headers({ Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") });
    if (method !== "GET") {
      headers.set("Content-Type", "application/json");
      if (csrf) headers.set("X-CSRFToken", this.cookies.get("csrftoken") ?? "");
      headers.set("Idempotency-Key", randomUUID());
    }
    const response = await fetch(base + path, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!, divider = pair.indexOf("=");
      if (divider > 0) this.cookies.set(pair.slice(0, divider), pair.slice(divider + 1));
    }
    return response;
  }
  async json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.request(path, method, body), content = await response.text();
    expect(response.ok, `${method} ${path}: ${response.status} ${content}\n${diagnostics.slice(-2000)}`).toBe(true);
    return JSON.parse(content) as T;
  }
  async login(identifier: string, password: string, schoolId: string) {
    await this.json("/api/v1/auth/csrf/");
    await this.json("/api/v1/auth/login/", "POST", { identifier, password });
    await this.json("/api/v1/auth/active-school/", "POST", { school_id: schoolId });
  }
}
type WorkItem = { id: string; title: string; href: string; action_label: string; status_label: string };
type Manifest = { context: { institution_id: string }; work: { total: number; items: WorkItem[] };
  today: { attention: { total: number }; now: Array<{ href?: string }> } };
type Register = { register: { id: string; state: string; revision: number }; capabilities: { can_finalize: boolean } };

describe.runIf(enabled)("appointed activity reviewer over authenticated HTTP", () => {
  beforeAll(async () => {
    // No inherited provider credentials, reset/migration/seed script, fixed port
    // or connection to the ordinary development runtime.
    server = spawn(process.execPath, ["--input-type=module", "--eval", bootstrap], { cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test", DEPLOYMENT_ENVIRONMENT: "test",
        DATABASE_URL: sourceUrl, EVENT_DATABASE_URL: sourceUrl, PGUSER: new URL(sourceUrl).username || userInfo().username,
        DATABASE_POOL_MAX: "5", RATE_LIMIT_STORE: "memory",
        COOKIE_SECRET: "isolated-review-http-cookie-secret-20261021", COOKIE_SECURE: "false", AI_PROVIDER: "mock",
        RAZORPAY_ENABLED: "false", INVITATION_EMAIL_ENABLED: "false", TELEGRAM_BOT_ENABLED: "false",
        HOSTED_CAMPUS_SIMULATOR_ENABLED: "false", DEMO_MODE: "false", SIMULATION_GC_ENABLED: "false",
        SPA_DIST_DIR: "/nonexistent-review-http-test-spa", LOG_LEVEL: "error" }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream?.on("data", (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString()}`.slice(-12_000);
      const match = diagnostics.match(/REVIEW_HTTP_READY:(\d+)/u);
      if (match) base = `http://127.0.0.1:${match[1]}`;
    });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (base) return;
      if (server.exitCode !== null) throw new Error(`Isolated reviewer API exited: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Isolated reviewer API did not become ready: ${diagnostics}`);
  }, 30_000);

  afterAll(async () => {
    if (server?.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { if (server?.exitCode === null) server.kill("SIGKILL"); resolve(); }, 5000);
        server!.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    await database.destroy();
  }, 10_000);

  it("hands submitted work only to its appointed reviewer, then clears it after finalization", async () => {
    // Identity/appointment fixtures are explicit configuration, not signup or
    // ordinary invitation/onboarding acceptance. All operational actions below
    // use normal authenticated HTTP with the real guards and selected Live world.
    const suffix = randomUUID(), password = `QA-${randomUUID()}!River`;
    const passwordHash = await hashPassword(password);
    const account = async (name: string, role: "admin" | "staff") => database.insertInto("users").values({
      username: `review-http-${name}-${suffix}`, email: `review-http-${name}-${suffix}@example.test`, password_hash: passwordHash,
      first_name: name, last_name: "Synthetic", role, email_verified_at: new Date() })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const owner = await account("Recorder", "admin"), reviewer = await account("Reviewer", "admin"), unrelated = await account("Unrelated", "admin");
    const connection = database as DatabaseService, core = new CampusModelCoreService(connection);
    const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, owner, "UTC"));
    for (const person of [reviewer, unrelated]) {
      await database.insertInto("school_memberships").values({ school_id: schoolId, user_id: person.id, role: "admin", is_active: true }).execute();
      await linkFixtureStaffIdentity(connection, { school_id: schoolId, user_id: person.id, owner_user_id: owner.id });
    }
    const identity = (id: string) => database.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: id, at: new Date().toISOString() }));
    const recorderIdentity = await identity(owner.id), reviewerIdentity = await identity(reviewer.id);
    expect(recorderIdentity.acting && reviewerIdentity.acting).toBe(true);
    const participant = await database.insertInto("school_people").values({ school_id: schoolId, first_name: "Passive", last_name: "Participant" }).returning("id").executeTakeFirstOrThrow();
    const recorderSession = new Session(), reviewerSession = new Session(), unrelatedSession = new Session();
    for (const [session, person] of [[recorderSession, owner], [reviewerSession, reviewer], [unrelatedSession, unrelated]] as const) await session.login(person.email, password, schoolId);
    expect((await new Session().request("/api/v1/workspace/")).status).toBe(401);
    const day = new Date().toISOString().slice(0, 10), activityBase = `/api/v1/schools/${schoolId}/activities`;
    const plan = await recorderSession.json<{ id: string; revision: number }>(`${activityBase}/plans`, "POST", {
      idempotency_key: randomUUID(), title: "HTTP independent review", purpose: "training", timezone: "UTC", starts_on: day,
      recurrence: "once", starts_at: "00:00", ends_at: "23:59", person_ids: [participant.id], attendance_mode: "roll_call",
      recorder_person_id: recorderIdentity.person_id, reviewer_person_id: reviewerIdentity.person_id });
    await recorderSession.json(`${activityBase}/plans/${plan.id}/publish`, "POST", { idempotency_key: randomUUID(), expected_revision: plan.revision });
    const occurrences = await recorderSession.json<{ items: Array<{ id: string; plan_version_id: string }> }>(`${activityBase}/occurrences?from=${day}&until=${day}`);
    const occurrence = occurrences.items.find(item => item.plan_version_id === plan.id)!;
    expect(occurrence).toBeDefined();
    const register = await recorderSession.json<Register>(`${activityBase}/registers/for-occurrence/${occurrence.id}`);
    const registerBase = `${activityBase}/registers/${register.register.id}`, workId = `activity-attendance-review:${register.register.id}`;
    const manifest = (session: Session) => session.json<Manifest>("/api/v1/workspace/");
    const hasReview = (value: Manifest) => value.work.items.some(item => item.id === workId);
    for (const session of [recorderSession, reviewerSession, unrelatedSession]) expect(hasReview(await manifest(session))).toBe(false);
    const submit = { expected_revision: register.register.revision, records: [{ person_id: participant.id, status: "present" }] };
    expect((await recorderSession.request(`${registerBase}/submit`, "POST", submit, false)).status).toBe(403);
    await recorderSession.json(`${registerBase}/submit`, "POST", submit);
    const assigned = await manifest(reviewerSession), owned = assigned.work.items.find(item => item.id === workId)!;
    expect(owned).toMatchObject({ title: "Review attendance · HTTP independent review", action_label: "Review register", status_label: "Awaiting review",
      href: `/areas/attendance/registers?date=${day}&register_id=${register.register.id}` });
    expect(assigned.context.institution_id).toBe(schoolId);
    expect(assigned.today.attention.total).toBeGreaterThanOrEqual(1);
    expect(hasReview(await manifest(recorderSession))).toBe(false);
    expect(hasReview(await manifest(unrelatedSession))).toBe(false);
    const selected = await reviewerSession.json<Register>(registerBase);
    expect(selected).toMatchObject({ register: { state: "submitted" }, capabilities: { can_finalize: true } });
    expect((await unrelatedSession.request(`${registerBase}/finalize`, "POST", { expected_revision: selected.register.revision })).status).toBe(403);
    await reviewerSession.json(`${registerBase}/finalize`, "POST", { expected_revision: selected.register.revision });
    expect((await reviewerSession.json<Register>(registerBase)).register.state).toBe("locked");
    for (const session of [recorderSession, reviewerSession, unrelatedSession]) expect(hasReview(await manifest(session))).toBe(false);
    const settled = await manifest(reviewerSession);
    expect(settled.work.total).toBe(0);
    expect(settled.today.attention.total).toBe(0);
  }, 60_000);
});
