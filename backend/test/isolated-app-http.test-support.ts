import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir, userInfo } from "node:os";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from 'node:url';
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Real compiled AppModule with authentication/execution guards. Starting ordinary
// main.js would run workers for every retained test campus, so only this explicit
// background lifecycle allowlist is disabled. Unknown hooks fail closed.
const bootstrap = `
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { NestFactory, ModulesContainer } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "./dist/app.module.js";
import { ApiExceptionFilter } from "./dist/common/errors.js";
// Keep startup failures as rejected exceptions. Nest's default abortOnError
// exits silently when its logger is disabled and hides the failing DI token.
const app = await NestFactory.create(AppModule, new FastifyAdapter({logger:{level:"error",redact:["req.headers.cookie","req.headers.authorization","res.headers.set-cookie"]},routerOptions:{ignoreTrailingSlash:true}}), {logger:false,abortOnError:false});
const background = new Set(["MarketingNotificationWorker","AgentChannelService","InvitationEmailWorker",
  "TransportRetentionService","AgentMemoryService","SimulationWorkerService","PeopleImportService",
  "PaymentEmailService","SchoolEventService","StaffOperationsService"]);
// Keep the database's required PG17 version check enabled; it is not a worker.
const safeHooks = new Set(["DatabaseService","ActivityAttendanceLifecycleBridge","RazorpayService"]), disabled = new Set();
for (const module of app.get(ModulesContainer).values()) for (const provider of module.providers.values()) {
  const instance = provider.instance;
  if (!instance) continue;
  const name = instance.constructor?.name;
  const hasHook = ["onModuleInit","onApplicationBootstrap"].some(hook=>typeof instance[hook]==="function");
  if (hasHook && !background.has(name) && !safeHooks.has(name)) throw new Error("Unreviewed lifecycle hook on "+name+"; refuse HTTP test startup.");
  if (!background.has(name)) continue;
  for (const hook of ["onModuleInit","onApplicationBootstrap"]) if (typeof instance[hook] === "function") {
    instance[hook] = () => undefined; disabled.add(instance.constructor.name);
  }
}
if (disabled.size !== background.size) throw new Error("Background worker allowlist drift; refuse HTTP test startup.");
await app.register(cookie, {secret:process.env.COOKIE_SECRET,hook:"onRequest"});
await app.register(multipart, {limits:{files:1,fileSize:24*1024*1024,fields:20,parts:21}});
app.getHttpAdapter().getInstance().addHook("onRequest", async request => { request.requestId=randomUUID(); });
app.useGlobalFilters(new ApiExceptionFilter());
await app.init();
await app.listen({host:"127.0.0.1",port:0});
const address=app.getHttpAdapter().getInstance().server.address();
process.stdout.write("ISOLATED_HTTP_READY:"+address.port+"\\n");
for (const signal of ["SIGTERM","SIGINT"]) process.once(signal, async()=>{ await app.close(); process.exit(0); });
`;

export class IsolatedAppHttp {
  private server?: ChildProcess;
  private diagnostics = "";
  private artifactsDir: string | undefined;
  base = "";
  async start(sourceUrl: string, options: { compiledRoot?: string; publicUrl?: string } = {}) {
    requireIsolatedTestDatabaseUrl(sourceUrl);
    let selectedBootstrap = bootstrap;
    if (options.compiledRoot) {
      const compiled = await realpath(options.compiledRoot), temporaryRoot = await realpath(tmpdir());
      if (!compiled.startsWith(temporaryRoot + '/') || basename(compiled) !== 'dist'
        || !/^thatcampus-visit-onboarding-build-[A-Za-z0-9]+$/.test(basename(dirname(compiled))))
        throw new Error('Only the explicitly owned temporary visitor HTTP build may replace the default test build.');
      selectedBootstrap = bootstrap.replace('"./dist/app.module.js"', JSON.stringify(pathToFileURL(join(compiled, 'app.module.js')).href))
        .replace('"./dist/common/errors.js"', JSON.stringify(pathToFileURL(join(compiled, 'common/errors.js')).href));
    }
    this.artifactsDir = await mkdtemp(join(tmpdir(), "thatcampus-isolated-http-"));
    this.server = spawn(process.execPath, ["--input-type=module", "--eval", selectedBootstrap], { cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test", DEPLOYMENT_ENVIRONMENT: "test",
        DATABASE_URL: sourceUrl, EVENT_DATABASE_URL: sourceUrl, PGUSER: new URL(sourceUrl).username || userInfo().username,
        DATABASE_POOL_MAX: "5", RATE_LIMIT_STORE: "memory", COOKIE_SECRET: "isolated-app-http-cookie-secret-20261023",
        COOKIE_SECURE: "false", AI_PROVIDER: "mock", RAZORPAY_ENABLED: "false", INVITATION_EMAIL_ENABLED: "false",
        TELEGRAM_BOT_ENABLED: "false", HOSTED_CAMPUS_SIMULATOR_ENABLED: "false", DEMO_MODE: "false", SIMULATION_GC_ENABLED: "false",
        ...(options.publicUrl ? { PUBLIC_URL: options.publicUrl } : {}),
        SPA_DIST_DIR: "/nonexistent-isolated-http-test-spa", UPLOAD_DIR: this.artifactsDir, LOG_LEVEL: "error" }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [this.server.stdout, this.server.stderr]) stream?.on("data", (chunk: Buffer) => {
      this.diagnostics = `${this.diagnostics}${chunk.toString()}`.slice(-12_000);
      const match = this.diagnostics.match(/ISOLATED_HTTP_READY:(\d+)/u);
      if (match) this.base = `http://127.0.0.1:${match[1]}`;
    });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (this.base) return;
      if (this.server.exitCode !== null) throw new Error(`Isolated API exited: ${this.diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Isolated API did not become ready: ${this.diagnostics}`);
  }
  async stop() {
    const server = this.server;
    if (server?.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { if (server.exitCode === null) server.kill("SIGKILL"); resolve(); }, 5000);
        server.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    if (this.artifactsDir) { await rm(this.artifactsDir, { recursive: true, force: true }); this.artifactsDir = undefined; }
  }
  failureDiagnostics() { return this.diagnostics.slice(-4000); }
  session() { return new IsolatedHttpSession(this); }
}

export class IsolatedHttpSession {
  private readonly cookies = new Map<string, string>();
  constructor(private readonly app: IsolatedAppHttp) {}
  async request(path: string, method = "GET", body?: unknown, csrf = true) {
    const headers = new Headers({ Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") });
    if (method !== "GET") {
      if (!(body instanceof FormData)) headers.set("Content-Type", "application/json");
      if (csrf) headers.set("X-CSRFToken", this.cookies.get("csrftoken") ?? "");
      headers.set("Idempotency-Key", randomUUID());
    }
    const response = await fetch(this.app.base + path, { method, headers,
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!, divider = pair.indexOf("=");
      if (divider > 0) this.cookies.set(pair.slice(0, divider), pair.slice(divider + 1));
    }
    return response;
  }
  async json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.request(path, method, body), content = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${content.slice(0, 2000)}${response.status>=500 ? `\n${this.app.failureDiagnostics()}` : ""}`);
    return JSON.parse(content) as T;
  }
  async login(identifier: string, password: string, schoolId: string) {
    await this.json("/api/v1/auth/csrf/");
    await this.json("/api/v1/auth/login/", "POST", { identifier, password });
    await this.json("/api/v1/auth/active-school/", "POST", { school_id: schoolId });
  }
}
