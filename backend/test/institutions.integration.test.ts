import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { importDirectory } from "../src/institutions/import-directory.js";
import type { DirectoryResult } from "../src/institutions/schemas.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL institution integration tests");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const base = "http://127.0.0.1:8024";
const operatorId = randomUUID(), outsiderId = randomUUID();
const run = randomUUID().slice(0, 8);
const password = "Testing!Directory2026";
const directoryIds: string[] = [], schoolIds: string[] = [];
let server: ChildProcess;
let serverErrors = "";

class Browser {
  cookies = new Map<string, string>();
  async request(path: string, payload?: unknown, csrf = true) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (payload) { headers["Content-Type"] = "application/json"; if (csrf) headers["X-CSRFToken"] = this.cookies.get("csrftoken") ?? ""; }
    const response = await fetch(`${base}/api/v1/institutions${path}`, { headers, ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}) });
    return response;
  }
  async login(email: string) {
    const remember = (response: Response) => { for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!; const index = pair.indexOf("="); this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    } };
    remember(await fetch(`${base}/api/v1/auth/csrf/`));
    const response = await fetch(`${base}/api/v1/auth/login/`, { method: "POST", headers: {
      "Content-Type": "application/json", Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "X-CSRFToken": this.cookies.get("csrftoken")!,
    }, body: JSON.stringify({ identifier: email, password }) });
    expect(response.status).toBe(200); remember(response);
  }
}
const operator = new Browser(), outsider = new Browser();
async function record(name: string, type = "school", state = "Chhattisgarh", source = "UDISE") {
  const id = randomUUID(); directoryIds.push(id);
  const code = source === "UDISE" ? String(10000000000 + Math.floor(Math.random() * 80000000000)) : `C-${Math.floor(Math.random() * 10000000)}`;
  await pool.query(`INSERT INTO institution_directory(id,name,institution_type,source,source_code,state,city,district,address,is_verified)
    VALUES ($1,$2,$3,$4,$5,$6,'Raipur','Raipur','Test address',true)`, [id, name, type, source, code, state]);
  return { id, code };
}
async function create(directoryId: string) {
  const response = await operator.request("/", { directory_id: directoryId });
  expect(response.status).toBe(201);
  const body = await response.json() as DirectoryResult; schoolIds.push(body.eduera_institution_id!); return body;
}
async function search(q: string, suffix = "") {
  const response = await fetch(`${base}/api/v1/institutions/search/?q=${encodeURIComponent(q)}${suffix}`);
  expect(response.status).toBe(200);
  return (await response.json() as { results: DirectoryResult[] }).results;
}

beforeAll(async () => {
  for (const [id, label] of [[operatorId, "operator"], [outsiderId, "outsider"]]) {
    await pool.query(`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES ($1,$2,$3,$4,'Directory','Test','admin')`,
      [id, `${label}-${run}`, `${label}-${run}@example.test`, await hashPassword(password)]);
  }
  await pool.query("INSERT INTO company_operators(user_id) VALUES ($1)", [operatorId]);
  // A separate test server must not consume the existing API suite's shared IP/login bucket.
  server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: "8024", HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "institution-integration-secret-at-least-32-chars", DEMO_MODE: "false", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "silent" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr?.on("data", (data: Buffer) => { serverErrors += data.toString(); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`Institution test server failed: ${serverErrors}`);
  await operator.login(`operator-${run}@example.test`); await outsider.login(`outsider-${run}@example.test`);
});

afterAll(async () => {
  server?.kill("SIGTERM");
  await pool.query("DELETE FROM institution_admin_invitations WHERE created_by=$1", [operatorId]);
  await pool.query("DELETE FROM schools WHERE id=ANY($1::uuid[])", [schoolIds]);
  await pool.query("DELETE FROM institution_directory WHERE id=ANY($1::uuid[])", [directoryIds]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[operatorId, outsiderId]]);
  await pool.end();
});

describe("Institution directory API and PostgreSQL invariants", () => {
  it("public search supports partial names, case-insensitivity, city/district and official code", async () => {
    const entry = await record(`Academy ${run} Delhi Public School`);
    for (const q of [run, `${run.toUpperCase()} DELHI`, entry.code, entry.code.slice(2, 9)]) {
      expect((await search(q)).some((r) => r.id === entry.id)).toBe(true);
    }
    expect((await search("raIPur", "&limit=50")).some((r) => r.id === entry.id)).toBe(true);
    const result = (await search(entry.code))[0]!;
    expect(result).toMatchObject({ is_onboarded: false, eduera_institution_id: null, onboarding_status: "not_onboarded", action: "create", source: "UDISE", is_verified: true });
    expect(result).not.toHaveProperty("metadata");
    expect(result).not.toHaveProperty("email");
  });

  it("validates minimum length and limits; applies state/type filters", async () => {
    await record(`Filter ${run} school`); await record(`Filter ${run} college`, "college", "Maharashtra", "AISHE");
    expect(await search(`Filter ${run}`, "&state=maHARashtra&type=college")).toHaveLength(1);
    expect(await search(`Filter ${run}`, "&state=maHARashtra&type=school")).toHaveLength(0);
    expect(await search(`Filter ${run}`, "&limit=1")).toHaveLength(1);
    for (const query of ["q=a", "q=ab&limit=0", "q=ab&limit=51", "q=ab&limit=wat", "q=ab&type=invalid"]) {
      expect((await fetch(`${base}/api/v1/institutions/search/?${query}`)).status).toBe(400);
    }
    expect(await search(`${run} missing`)).toEqual([]);
  });

  it("ranks exact names, then name prefixes, codes and partial matches with verified tie-breaks", async () => {
    const query = `Rank ${run}`;
    const exact = await record(query), prefix = await record(`${query} Academy`), partial = await record(`The ${query} School`);
    expect((await search(query)).map((r) => r.id)).toEqual([exact.id, prefix.id, partial.id]);
    const unverified = await record(`${query} Academy`);
    await pool.query("UPDATE institution_directory SET is_verified=false WHERE id=$1", [unverified.id]);
    expect((await search(query)).map((r) => r.id)).toEqual([exact.id, prefix.id, unverified.id, partial.id]);
  });

  it("requires company authority and CSRF; school admin cannot create or inspect tenants", async () => {
    const entry = await record(`Access ${run}`);
    expect((await fetch(`${base}/api/v1/institutions/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directory_id: entry.id }) })).status).toBe(401);
    expect((await outsider.request("/", { directory_id: entry.id })).status).toBe(403);
    expect((await operator.request("/", { directory_id: entry.id }, false)).status).toBe(403);
    const created = await create(entry.id);
    expect((await outsider.request(`/${created.eduera_institution_id}/`)).status).toBe(403);
  });

  it("selects available records, returns Continue setup, and prevents active and suspended duplicates", async () => {
    const entry = await record(`Setup ${run}`); const created = await create(entry.id);
    expect((await search(entry.code))[0]).toMatchObject({ is_onboarded: true, eduera_institution_id: created.eduera_institution_id, onboarding_status: "setup_in_progress", action: "continue_setup" });
    for (const status of ["setup_in_progress", "active", "suspended"]) {
      await pool.query("UPDATE institution_onboarding SET status=$1 WHERE directory_id=$2", [status, entry.id]);
      const response = await operator.request("/", { directory_id: entry.id });
      expect(response.status).toBe(409);
      expect((await response.json() as { error: { fields: { existing: DirectoryResult } } }).error.fields.existing.eduera_institution_id).toBe(created.eduera_institution_id);
      if (status !== "setup_in_progress") expect((await search(entry.code))[0]?.action).toBe("view");
    }
  });

  it("enforces source/code uniqueness and canonical codes directly in PostgreSQL", async () => {
    const entry = await record(`Unique ${run}`, "college", "Delhi", "AISHE");
    await expect(pool.query("INSERT INTO institution_directory(name,institution_type,source,source_code) VALUES ('Duplicate','college','AISHE',$1)", [entry.code])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query("INSERT INTO institution_directory(name,institution_type,source,source_code) VALUES ('Duplicate','college','AISHE',$1)", [entry.code.toLowerCase()])).rejects.toMatchObject({ code: "23514" });
  });

  it("concurrent requests create one tenant and one conflict, with no orphan school", async () => {
    const entry = await record(`Concurrent ${run}`);
    const responses = await Promise.all([operator.request("/", { directory_id: entry.id }), operator.request("/", { directory_id: entry.id })]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const success = await responses.find((r) => r.status === 201)!.json() as DirectoryResult;
    schoolIds.push(success.eduera_institution_id!);
    expect((await pool.query("SELECT count(*) FROM schools WHERE name=$1", [`Concurrent ${run}`])).rows[0].count).toBe("1");
    // The DB constraint also protects callers outside this API.
    const extraId = randomUUID(); schoolIds.push(extraId);
    await pool.query("INSERT INTO schools(id,name,code) VALUES ($1,'Other tenant',$2)", [extraId, `test-${extraId.slice(0, 12)}`]);
    await expect(pool.query("INSERT INTO institution_onboarding(school_id,directory_id) VALUES ($1,$2)", [extraId, entry.id])).rejects.toMatchObject({ code: "23505" });
  });

  it("manual duplicates require reviewed acknowledgement; no-results manual creation is unverified", async () => {
    const manual = { name: `Manual ${run} Academy`, institution_type: "college", state: "Delhi", city: "Delhi", address: "Campus Road" };
    const first = await operator.request("/", { manual }); expect(first.status).toBe(201);
    const institution = await first.json() as DirectoryResult; directoryIds.push(institution.id); schoolIds.push(institution.eduera_institution_id!);
    expect(institution).toMatchObject({ source: "MANUAL", source_code: null, is_verified: false });
    const duplicate = await operator.request("/", { manual: { ...manual, name: `Manual ${run} Academi` } });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json() as { error: { fields: { duplicates: DirectoryResult[] } } }).error.fields.duplicates[0]?.eduera_institution_id).toBe(institution.eduera_institution_id);
    const acknowledged = await operator.request("/", { manual, acknowledged_duplicate_ids: [institution.eduera_institution_id] });
    expect(acknowledged.status).toBe(201);
    const another = await acknowledged.json() as DirectoryResult; directoryIds.push(another.id); schoolIds.push(another.eduera_institution_id!);
  });

  it("upserts official CSV records without changing ID and rolls back invalid imports", async () => {
    const entry = await record(`Import ${run}`);
    const client = await pool.connect();
    const header = "name,institution_type,source,source_code,state,district,city,address,is_verified,metadata\n";
    const csv = `${header}Updated ${run},school,UDISE,${entry.code},Delhi,Delhi,Delhi,Campus,true,{}\n`;
    try {
      expect(await importDirectory(client, Readable.from([csv]))).toBe(1);
      expect(await importDirectory(client, Readable.from([csv]))).toBe(1);
      expect((await search(entry.code))[0]).toMatchObject({ id: entry.id, name: `Updated ${run}`, state: "Delhi" });
      await expect(importDirectory(client, Readable.from([csv.replace("Updated", "Rollback") + "Broken,school,UDISE,INVALID,Delhi,Delhi,Delhi,Campus,true,{}\n"]))).rejects.toThrow();
      expect((await search(entry.code))[0]?.name).toBe(`Updated ${run}`);
    } finally { client.release(); }
  });

  it("explicit official mapping links a legacy tenant without name-based matching", async () => {
    const entry = await record(`Mapping ${run}`);
    const manualResponse = await operator.request("/", { manual: { name: `Legacy ${run}`, institution_type: "school", state: "Delhi", city: "Delhi", address: "Road" } });
    const legacy = await manualResponse.json() as DirectoryResult; directoryIds.push(legacy.id); schoolIds.push(legacy.eduera_institution_id!);
    const client = await pool.connect();
    try {
      await importDirectory(client, Readable.from([`name,institution_type,source,source_code,state,district,city,address,existing_school_id\nMapped ${run},school,UDISE,${entry.code},Delhi,Delhi,Delhi,Road,${legacy.eduera_institution_id}\n`]));
      expect((await search(entry.code))[0]).toMatchObject({ id: entry.id, eduera_institution_id: legacy.eduera_institution_id, onboarding_status: "setup_in_progress" });
      expect((await pool.query("SELECT 1 FROM institution_directory WHERE id=$1", [legacy.id])).rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it("invitation acceptance is email-bound, single-use, and activates the existing tenant", async () => {
    const entry = await record(`Invite ${run}`); const institution = await create(entry.id);
    const response = await operator.request(`/${institution.eduera_institution_id}/admin-invitations/`, { email: `outsider-${run}@example.test` });
    expect(response.status).toBe(201); const { token } = await response.json() as { token: string };
    expect((await operator.request("/accept-invitation/", { token })).status).toBe(403);
    expect((await outsider.request("/accept-invitation/", { token })).status).toBe(201);
    expect((await outsider.request("/accept-invitation/", { token })).status).toBe(404);
    expect((await search(entry.code))[0]?.onboarding_status).toBe("active");
    expect((await pool.query("SELECT role FROM school_memberships WHERE school_id=$1 AND user_id=$2", [institution.eduera_institution_id, outsiderId])).rows[0].role).toBe("admin");
  });
});
