import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// This separate opt-in starts the compiled application. Source-imported identity
// regressions run independently before the owning build is refreshed.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true"
  && process.env.PROGRESSIVE_GATE_API_TEST_ISOLATED === "true";
const databaseUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
const simulationUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_TEST_TARGET_DATABASE_URL)
  : "postgresql://invalid.invalid/unused_simulation";

describe.skipIf(!enabled)("compiled Gate-first application handoff in Live and Simulation", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const simulationPool = new Pool({ connectionString: simulationUrl, max: 2 });
  let server: ChildProcess | undefined;
  let base = "";
  let runId: string | undefined;
  let siblingRunId: string | undefined;
  let schoolId: string | undefined;
  class Session {
    private readonly cookies = new Map<string, string>();
    async call(path: string, body?: unknown) {
      const response = await fetch(`${base}/api/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRFToken": this.cookies.get("csrftoken") ?? "" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0]!; const split = pair.indexOf("=");
        this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const data = response.status === 204 ? null : await response.json();
      return { status: response.status, data: data as any };
    }
  }
  const owner = new Session();
  const outsider = new Session();

  async function assertBoundedVisitors(database: Pool, prefix: string, institutionId: string, operatorId: string) {
    if (prefix && !/^"dt_run_[0-9a-f]{32}"\.$/u.test(prefix)) throw new Error("Unexpected isolated branch schema.");
    const existingClosed = Number((await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${prefix}gate_visitors WHERE school_id=$1 AND state='out'`,
      [institutionId],
    )).rows[0]?.count ?? 0);
    if (existingClosed > 120) throw new Error("Pagination fixture already contains too many closed visitors.");
    // Deliberately seed catalogue overflow, not physical observations, in the
    // opted-in test database. Real movement confirmation is exercised below.
    await database.query(`INSERT INTO ${prefix}gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,
      created_at,expires_at,checked_in_at,checked_out_at)
      SELECT $1,'Closed '||n,'9999999999','Isolated pagination fixture',$2,$2,'out',
        clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour',clock_timestamp()
      FROM generate_series(1,$3::int) n`, [institutionId, operatorId, 120 - existingClosed]);
    await database.query(`INSERT INTO ${prefix}gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,
      created_at,expires_at,checked_in_at)
      SELECT $1,'Inside '||n,'9999999999','Active overflow fixture',$2,$2,'inside',
        clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp()-interval '2 days'
      FROM generate_series(1,31) n`, [institutionId, operatorId]);
    await database.query(`INSERT INTO ${prefix}gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,created_at,expires_at)
      SELECT $1,state,'9999999999','Active approval fixture',$2,$2,state,clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 hour'
      FROM unnest(ARRAY['pending','approved']) state`, [institutionId, operatorId]);
    const historical = (await database.query<{ id: string }>(`INSERT INTO ${prefix}gate_visitors(school_id,name,phone,purpose,
      host_user_id,recorded_by,state,created_at,expires_at,checked_in_at,checked_out_at)
      VALUES($1,'Historical deep link','9999999999','Historical fixture',$2,$2,'out',clock_timestamp()-interval '3 days',
        clock_timestamp()-interval '2 days',clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days') RETURNING id`,
    [institutionId, operatorId])).rows[0]!.id;
    const endpoint = `gate/schools/${institutionId}/workspace/`;
    const first = await owner.call(endpoint);
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    expect(first.data.visitor_counts).toEqual({ all: 153, active: 33, inside: 31, approved: 1, pending: 1, closed: 120 });
    expect(first.data.pending).toBe(1);
    expect(first.data.visitors).toHaveLength(25);
    expect(first.data.visitors.every((visitor: { state: string }) => visitor.state === "inside")).toBe(true);
    expect(first.data.visitor_pagination).toMatchObject({ page: 1, page_size: 25, total: 153, total_pages: 7, has_next: true });
    const ids = new Set<string>();
    for (const page of [1, 2]) {
      const next = await owner.call(`${endpoint}?visitor_filter=inside&visitor_page=${page}&visitor_id=${historical}`);
      expect(next.status, JSON.stringify(next.data)).toBe(200);
      expect(next.data.visitor_pagination).toMatchObject({ page, total: 31, total_pages: 2, filter: "inside" });
      expect(next.data.visitors).toHaveLength(page === 1 ? 25 : 6);
      expect(next.data.focused_visitor).toMatchObject({ id: historical, state: "out" });
      next.data.visitors.forEach((visitor: { id: string }) => ids.add(visitor.id));
    }
    expect(ids.size).toBe(31);
    expect((await owner.call(`${endpoint}?visitor_filter=approved`)).data.visitors).toEqual([
      expect.objectContaining({ state: "approved" }),
    ]);
    expect((await owner.call(`${endpoint}?visitor_filter=closed&visitor_page=999`)).data.visitor_pagination)
      .toMatchObject({ page: 5, total: 120, total_pages: 5, has_next: false });
    expect((await owner.call(`${endpoint}?visitor_page=0`)).status).toBe(400);
  }

  beforeAll(async () => {
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("No local test port available.");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env,
      DATABASE_URL: databaseUrl, EVENT_DATABASE_URL: databaseUrl, CAMPUS_SIMULATION_DATABASE_URL: simulationUrl,
      HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", DEPLOYMENT_ENVIRONMENT: "test",
      COOKIE_SECRET: "progressive-gate-api-isolated-regression-2026", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "error",
      INVITATION_EMAIL_ENABLED: "false", GOOGLE_CLIENT_ID: "", RAZORPAY_ENABLED: "false", SIMULATION_GC_ENABLED: "false",
    }, stdio: ["ignore", "ignore", "inherit"] });
    for (let attempt = 0; attempt < 160; attempt++) {
      try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* local startup */ }
      if (server.exitCode !== null) throw new Error(`The isolated API exited with ${server.exitCode}.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The isolated compiled API did not start.");
  }, 30_000);

  afterAll(async () => {
    if (runId && schoolId) {
      await owner.call("auth/execution-environment/", { mode: "live" }).catch(() => undefined);
      for (const retained of [runId, siblingRunId].filter(Boolean)) {
        await owner.call(`schools/${schoolId}/simulation/runs/${retained}/stop`, {}).catch(() => undefined);
      }
    }
    if (server?.exitCode === null) {
      const exited = new Promise<void>(resolve => server!.once("exit", () => resolve()));
      server.kill("SIGTERM");
      await exited;
    }
    await Promise.all([pool.end(), simulationPool.end()]);
  });

  it("creates exact operator work from explicit confirmation and preserves the Live boundary", async () => {
    const password = "Str0ng!GateRegressionRiver2026";
    const email = `gate-api-${randomUUID()}@example.test`;
    for (const [session, address] of [[owner, email], [outsider, `gate-outsider-${randomUUID()}@example.test`]] as const) {
      await session.call("auth/csrf/");
      const registered = await session.call("auth/register/", { email: address, password });
      expect(registered.status, JSON.stringify(registered.data)).toBe(201);
    }
    const me = await owner.call("auth/me/");
    schoolId = me.data.user.active_school_id;
    const userId = me.data.user.id as string;
    const initial = await owner.call("workspace/");
    expect(initial.status).toBe(200);
    expect(initial.data.areas.find((area: { key: string }) => area.key === "in-out")).toBeUndefined();
    const person = (await pool.query<{ person_id: string }>(`SELECT agent.person_id::text FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=$1 AND endpoint.user_id=$2 AND endpoint.status='active'`, [schoolId, userId])).rows[0]!.person_id;

    const captured = await owner.call(`schools/${schoolId}/simulation/runs`, {
      kind: "scenario", name: "Gate-first isolated regression", speed: 20, idempotency_key: randomUUID(),
    });
    expect(captured.status, JSON.stringify(captured.data)).toBe(201);
    runId = captured.data.run.id;
    const sibling = await owner.call(`schools/${schoolId}/simulation/runs/${runId}/duplicate`, {
      kind: "scenario", name: "Gate-first untouched sibling", idempotency_key: randomUUID(),
    });
    expect(sibling.status, JSON.stringify(sibling.data)).toBe(201);
    siblingRunId = sibling.data.run.id;
    expect((await owner.call("auth/execution-environment/", { mode: "simulation", run_id: runId })).status).toBe(200);
    const simulated = await owner.call(`schools/${schoolId}/get-started/gate/`, {
      gate_name: "Scenario reception", operator: { kind: "current_user", confirm: true },
    });
    expect(simulated.status, JSON.stringify(simulated.data)).toBe(201);
    const branch = (await simulationPool.query<{ schema_name: string }>(
      "SELECT schema_name FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2", [runId, schoolId],
    )).rows[0]!;
    const branchSeed = await owner.call(`gate/schools/${schoolId}/visitors/`, {
      name: "Scenario pagination seed", phone: "9999999999", purpose: "Materialize the isolated visitor ledger",
      host_user_id: null, category: "guest", request_id: randomUUID(),
    });
    expect(branchSeed.status, JSON.stringify(branchSeed.data)).toBe(201);
    expect((await owner.call(`gate/schools/${schoolId}/visitors/${branchSeed.data.id}/out/`, { expected_revision: 1 })).status).toBe(201);
    await assertBoundedVisitors(simulationPool, `"${branch.schema_name}".`, schoolId!, userId);
    const simulatedManifest = await owner.call("workspace/");
    expect(simulatedManifest.status, JSON.stringify(simulatedManifest.data)).toBe(200);
    expect(simulatedManifest.data.areas.find((area: { key: string }) => area.key === "in-out")?.surfaces, JSON.stringify(simulatedManifest.data))
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "operate", href: "/areas/in-out/operate" })]));
    expect((await owner.call(`gate/schools/${schoolId}/workspace/`)).status).toBe(200);
    expect((await owner.call("auth/execution-environment/", { mode: "simulation", run_id: siblingRunId })).status).toBe(200);
    expect((await owner.call("workspace/")).data.areas.find((area: { key: string }) => area.key === "in-out")).toBeUndefined();
    expect((await owner.call(`schools/${schoolId}/get-started/`)).data.options.gates).toEqual([]);
    expect((await owner.call("auth/execution-environment/", { mode: "live" })).status).toBe(200);
    expect((await owner.call("workspace/")).data.areas.find((area: { key: string }) => area.key === "in-out")).toBeUndefined();
    expect((await pool.query(`SELECT
      (SELECT count(*)::int FROM campus_spaces WHERE school_id=$1) gates,
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=$1) profiles,
      (SELECT count(*)::int FROM gate_visitors WHERE school_id=$1) visitors`, [schoolId])).rows[0])
      .toEqual({ gates: 0, profiles: 0, visitors: 0 });

    const gate = await owner.call(`schools/${schoolId}/get-started/gate/`, {
      gate_name: "Live reception", operator: { kind: "current_user", confirm: true },
    });
    expect(gate.status, JSON.stringify(gate.data)).toBe(201);
    await assertBoundedVisitors(pool, "", schoolId!, userId);
    const manifest = await owner.call("workspace/");
    expect(manifest.status, JSON.stringify(manifest.data)).toBe(200);
    expect(manifest.data.areas.find((area: { key: string }) => area.key === "in-out")?.surfaces, JSON.stringify(manifest.data))
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "operate", href: gate.data.destination })]));
    expect((await owner.call(`gate/schools/${schoolId}/workspace/`)).status).toBe(200);
    expect((await pool.query(`SELECT person_id::text,employment_type,joined_on FROM staff_profiles
      WHERE school_id=$1 AND user_id=$2`, [schoolId, userId])).rows)
      .toEqual([{ person_id: person, employment_type: "unspecified", joined_on: null }]);
    const repeat = await owner.call(`schools/${schoolId}/get-started/gate/`, {
      existing_gate_id: gate.data.resources.gate_space_id, operator: { kind: "current_user", confirm: true },
    });
    expect(repeat.data).toMatchObject({ resources: { operator_assignment_id: gate.data.resources.operator_assignment_id },
      created: { gate: false, operator_authority: false } });
    expect((await outsider.call(`gate/schools/${schoolId}/workspace/`)).status).toBe(403);
    expect((await outsider.call(`schools/${schoolId}/get-started/gate/`, {
      gate_name: "Foreign gate", operator: { kind: "current_user", confirm: true },
    })).status).toBe(403);
    const visitor = await owner.call(`gate/schools/${schoolId}/visitors/`, {
      name: "Gate regression visitor", phone: "9999999999", purpose: "Isolated local test",
      host_user_id: null, category: "guest", request_id: randomUUID(),
    });
    expect(visitor.status, JSON.stringify(visitor.data)).toBe(201);
    expect(visitor.data).toMatchObject({ state: "inside", revision: 1 });
    expect((await owner.call(`gate/schools/${schoolId}/visitors/${visitor.data.id}/out/`, { expected_revision: 1 })).data.visitor)
      .toMatchObject({ state: "out", revision: 2 });
    expect((await owner.call("auth/logout/", {})).status).toBe(204);
    await owner.call("auth/csrf/");
    expect((await owner.call("auth/login/", { identifier: email, password })).status).toBe(200);
    expect((await owner.call("workspace/")).data.areas.find((area: { key: string }) => area.key === "in-out")).toBeDefined();
  }, 60_000);
});
