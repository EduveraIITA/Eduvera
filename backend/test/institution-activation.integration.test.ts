import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string) {
  let bits = "";
  for (const character of value) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function currentTotp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const binary = ((digest[offset]! & 127) << 24) | ((digest[offset + 1]! & 255) << 16)
    | ((digest[offset + 2]! & 255) << 8) | (digest[offset + 3]! & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

suite("institution activation and account trust against PostgreSQL 17", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const base = "http://127.0.0.1:8072/api/v1/";
  const suffix = randomUUID();
  const email = `owner.${suffix}@example.test`;
  const username = `owner.${suffix}`;
  const password = "Str0ng!FirstDayRiver2026";
  const newPassword = "Str0ng!RecoveredMaple2026";
  const cookies = new Map<string, string>();
  let server: ChildProcess;
  let userId = "";
  let recoveryCodes: string[] = [];

  async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookies.get("csrftoken")) headers["X-CSRFToken"] = cookies.get("csrftoken")!;
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const split = pair.indexOf("=");
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data: data as any };
  }

  beforeAll(async () => {
    userId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kiran','Owner','admin') RETURNING id",
      [username, email, await hashPassword(password)],
    )).rows[0].id;
    server = spawn(process.execPath, ["dist/main.js"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "8072",
        COOKIE_SECRET: "activation-integration-cookie-secret-2026",
        NODE_ENV: "test",
        DEMO_MODE: "true",
        INVITATION_EMAIL_ENABLED: "false",
        RATE_LIMIT_STORE: "memory",
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { if ((await fetch("http://127.0.0.1:8072/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: username, password })).status).toBe(200);
  }, 30_000);

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("provisions a neutral private workspace without making verification a setup gate", async () => {
    const created = await request("onboarding/workspace/", {
      timezone: "Asia/Kolkata", goals: ["attendance"],
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    expect(created.data.workspace).toMatchObject({ profile_named: false, display_name: "Your campus" });
    const issued = await request("auth/email-verification/request/", {});
    expect(issued.status).toBe(201);
    expect(issued.data.development_token).toHaveLength(43);
    expect((await request("auth/email-verification/confirm/", { token: issued.data.development_token })).status).toBe(200);
    expect((await pool.query("SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id=$1", [userId])).rows[0].verified).toBe(true);
  });

  it("protects the workspace owner account with authenticator MFA", async () => {
    const enrollment = await request("auth/mfa/enroll/", {});
    expect(enrollment.status).toBe(201);
    const confirmed = await request("auth/mfa/confirm/", { code: currentTotp(enrollment.data.secret) });
    expect(confirmed.status).toBe(200);
    recoveryCodes = confirmed.data.recovery_codes;
    expect(recoveryCodes).toHaveLength(8);

  });

  it("requires MFA on the next login and supports single-use recovery", async () => {
    expect((await request("auth/logout/", {})).status).toBe(204);
    await request("auth/csrf/");
    const challenged = await request("auth/login/", { identifier: username, password });
    expect(challenged.status).toBe(202);
    const completed = await request("auth/mfa/login/", { challenge_token: challenged.data.challenge_token, code: recoveryCodes[0] });
    expect(completed.status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM auth_mfa_recovery_codes WHERE user_id=$1 AND used_at IS NOT NULL", [userId])).rows[0].count).toBe(1);
  });

  it("resets the password, revokes sessions and preserves MFA", async () => {
    const issued = await request("auth/password-reset/request/", { email });
    expect(issued.status).toBe(202);
    expect(issued.data.development_token).toHaveLength(43);
    expect((await request("auth/password-reset/confirm/", { token: issued.data.development_token, password: newPassword })).status).toBe(200);
    expect((await request("auth/me/")).status).toBe(401);
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: username, password })).status).toBe(401);
    const challenged = await request("auth/login/", { identifier: username, password: newPassword });
    expect(challenged.status).toBe(202);
    expect((await request("auth/mfa/login/", { challenge_token: challenged.data.challenge_token, code: recoveryCodes[1] })).status).toBe(200);
  });
});
