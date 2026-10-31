import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  NATIVE_GOOGLE_GRANT_TTL_MS, NATIVE_GOOGLE_REDIRECT_URI, NATIVE_GOOGLE_REQUEST_TTL_MS,
  NativeGoogleEnvelope, nativeGoogleContext, nativeGoogleDigest, nativeGoogleExchangeSchema,
  nativeGooglePkceMatches, nativeGoogleProof, nativeGoogleProofSchema, nativeGoogleStartSchema,
  type NativeGoogleContext, type NativeGooglePayloads,
} from "../src/auth/native-google-policy.js";

const context: NativeGoogleContext = { origin: "https://campus.example.test", clientId: "configured-client.apps.googleusercontent.com",
  secret: "isolated-native-google-policy-test-secret-32-bytes", secureCookie: true };
const settings = { PUBLIC_URL: context.origin, GOOGLE_CLIENT_ID: context.clientId, ALLOWED_ORIGINS: context.origin,
  COOKIE_SECRET: context.secret, COOKIE_SECURE: false, DEPLOYMENT_ENVIRONMENT: "production", NODE_ENV: "production" };
const now = 1_800_000_000_000;
const verifier = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const proof = "a".repeat(43);
const start = { redirect_uri: NATIVE_GOOGLE_REDIRECT_URI, state: proof, code_challenge: challenge, code_challenge_method: "S256" };
const request: NativeGooglePayloads["request"] = { v: 1, phase: "request", origin: context.origin, client_id: context.clientId,
  issued_at: now, expires_at: now + NATIVE_GOOGLE_REQUEST_TTL_MS, nonce: proof, state: proof, code_challenge: challenge, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI };
const browser: NativeGooglePayloads["browser"] = { v: 1, phase: "browser", origin: context.origin, client_id: context.clientId,
  issued_at: now, expires_at: now + NATIVE_GOOGLE_REQUEST_TTL_MS, request_hash: nativeGoogleDigest("opaque-request"), nonce: proof, csrf: proof };
const grant: NativeGooglePayloads["grant"] = { v: 1, phase: "grant", origin: context.origin, client_id: context.clientId,
  issued_at: now, expires_at: now + NATIVE_GOOGLE_GRANT_TTL_MS, nonce: proof, state: proof, code_challenge: challenge,
  redirect_uri: NATIVE_GOOGLE_REDIRECT_URI, user_id: "00000000-0000-4000-8000-000000000001", active_school_id: null, mfa_challenge: null };

// Test a correctly authenticated but malformed plaintext separately from ciphertext
// tampering: schema/context validation must also run when opening an envelope.
function authenticatedFixture(payload: unknown): string {
  const key = createHmac("sha256", context.secret).update(`thatcampus/native-google/envelope/v1\0${context.origin}\0${context.clientId}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("thatcampus/native-google/envelope/v1"));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `ng1.${iv.toString("base64url")}.${bytes.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

describe("native Google deployment context", () => {
  it("requires the exact configured and allowed HTTPS origin and always secures its cookie", () => {
    expect(nativeGoogleContext(settings)).toEqual(context);
    expect(nativeGoogleContext({ ...settings, ALLOWED_ORIGINS: `https://other.example.test, ${context.origin} ` })).toEqual(context);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("does not advertise HTTP %s to a native client in any environment", host => {
    const origin = `http://${host}:8000`;
    for (const environment of ["development", "test", "production", "stage"]) {
      expect(nativeGoogleContext({ ...settings, PUBLIC_URL: origin, ALLOWED_ORIGINS: origin, DEPLOYMENT_ENVIRONMENT: environment, NODE_ENV: "test" })).toBeNull();
    }
  });

  it("still refuses HTTP loopback without a deployment environment or with secure-cookie configuration", () => {
    const { DEPLOYMENT_ENVIRONMENT: _environment, ...withoutDeployment } = settings;
    expect(nativeGoogleContext({ ...withoutDeployment, NODE_ENV: "development", PUBLIC_URL: "http://localhost:8000", ALLOWED_ORIGINS: "http://localhost:8000", COOKIE_SECURE: true }))
      .toBeNull();
  });

  it("disables the ceremony when the public origin is absent", () => {
    const { PUBLIC_URL: _origin, ...withoutOrigin } = settings;
    expect(nativeGoogleContext(withoutOrigin)).toBeNull();
  });

  it.each([
    { PUBLIC_URL: "" }, { GOOGLE_CLIENT_ID: " " }, { COOKIE_SECRET: "too-short" },
    { PUBLIC_URL: `${context.origin}/` }, { PUBLIC_URL: `${context.origin}/login` }, { PUBLIC_URL: `${context.origin}?query=1` },
    { PUBLIC_URL: `${context.origin}#fragment` }, { PUBLIC_URL: "https://user@campus.example.test" },
    { PUBLIC_URL: "https://campus.example.test:443" }, { PUBLIC_URL: "https://CAMPUS.example.test" },
    { PUBLIC_URL: "not-a-url" }, { PUBLIC_URL: "javascript:alert(1)" },
    { ALLOWED_ORIGINS: "*" }, { ALLOWED_ORIGINS: `${context.origin}.attacker.test` }, { ALLOWED_ORIGINS: `${context.origin}/*` },
    { PUBLIC_URL: "http://remote.example.test", ALLOWED_ORIGINS: "http://remote.example.test", DEPLOYMENT_ENVIRONMENT: "test" },
    { PUBLIC_URL: "http://localhost.attacker.test", ALLOWED_ORIGINS: "http://localhost.attacker.test", DEPLOYMENT_ENVIRONMENT: "development" },
  ])("disables the ceremony for invalid context %j", change => {
    expect(nativeGoogleContext({ ...settings, ...change })).toBeNull();
  });
});

describe("native Google request schemas and PKCE", () => {
  it("accepts the fixed app callback, full-length state and S256 challenge", () => {
    expect(NATIVE_GOOGLE_REDIRECT_URI).toBe("thatcampus://auth/google");
    expect(nativeGoogleStartSchema.parse(start)).toEqual(start);
    expect(nativeGoogleProofSchema.parse({ request: "e".repeat(32), credential: "id-token", csrf: proof }))
      .toEqual({ request: "e".repeat(32), credential: "id-token", csrf: proof });
    expect(nativeGoogleExchangeSchema.parse({ code: "e".repeat(32), code_verifier: verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }).code_verifier).toBe(verifier);
  });

  it.each([
    { redirect_uri: "thatcampus://auth/google/" }, { redirect_uri: "thatcampus://auth/google?next=/today" },
    { redirect_uri: "https://campus.example.test/auth/google" }, { state: "a".repeat(42) }, { state: "a".repeat(44) },
    { state: "a".repeat(42) + "+" }, { code_challenge: "a".repeat(42) }, { code_challenge_method: "plain" },
    { code_verifier: verifier }, { next: "/today" },
  ])("refuses changed callback, state, PKCE method or extra start fields %j", change => {
    expect(nativeGoogleStartSchema.safeParse({ ...start, ...change }).success).toBe(false);
  });

  it.each(["", "x".repeat(42), "x".repeat(129), "x".repeat(42) + "+", "x".repeat(42) + "/", "x".repeat(42) + "=", "x".repeat(42) + "\n"])("refuses invalid PKCE verifier %j", code_verifier => {
    expect(nativeGoogleExchangeSchema.safeParse({ code: "e".repeat(32), code_verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }).success).toBe(false);
  });

  it("accepts RFC7636 verifier characters and both boundary lengths, without trimming or case folding proof", () => {
    for (const code_verifier of ["a".repeat(43), ".-~_".repeat(32)]) {
      expect(nativeGoogleExchangeSchema.safeParse({ code: "e".repeat(32), code_verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }).success).toBe(true);
    }
    expect(nativeGooglePkceMatches(verifier, challenge)).toBe(true);
    expect(nativeGooglePkceMatches(verifier.toLowerCase(), challenge)).toBe(false);
    expect(nativeGooglePkceMatches(` ${verifier}`, challenge)).toBe(false);
    expect(nativeGooglePkceMatches(verifier, `${challenge}=`)).toBe(false);
    expect(nativeGooglePkceMatches(verifier, "wrong-length")).toBe(false);
  });

  it.each([
    { code: "e".repeat(31) }, { code: "e".repeat(16_385) }, { redirect_uri: `${NATIVE_GOOGLE_REDIRECT_URI}?state=s` },
    { credential: "id-token" }, { state: proof }, { transport: "cookie" },
  ])("refuses malformed or augmented exchange body %j", change => {
    expect(nativeGoogleExchangeSchema.safeParse({ code: "e".repeat(32), code_verifier: verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI, ...change }).success).toBe(false);
  });

  it("bounds Google credential/envelope/CSRF bodies and refuses extra proof fields", () => {
    const valid = { request: "e".repeat(32), credential: "id-token", csrf: proof };
    for (const change of [{ request: "short" }, { credential: "" }, { credential: "e".repeat(16_385) }, { csrf: "wrong" }, { redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }]) {
      expect(nativeGoogleProofSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });

  it("generates bounded URL-safe random proofs and deterministic lowercase SHA256 digests", () => {
    const first = nativeGoogleProof(), second = nativeGoogleProof();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(nativeGoogleDigest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("native Google confidential envelopes", () => {
  it("round-trips all exact phases across instances without exposing plaintext or mutating payloads", () => {
    const writer = new NativeGoogleEnvelope(context, () => now);
    const reader = new NativeGoogleEnvelope({ ...context }, () => now);
    for (const payload of [request, browser, grant]) {
      const before = structuredClone(payload);
      const token = writer.seal(payload);
      expect(token).toMatch(/^ng1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u);
      expect(token).not.toContain(payload.origin);
      expect(token).not.toContain(payload.client_id);
      expect(reader.open(token, payload.phase)).toEqual(before);
      expect(payload).toEqual(before);
      expect(writer.seal(payload)).not.toBe(token);
    }
    const mfaGrant = { ...grant, active_school_id: "00000000-0000-4000-8000-000000000002", mfa_challenge: proof };
    expect(reader.open(writer.seal(mfaGrant), "grant")).toEqual(mfaGrant);
  });

  it.each([1, 2, 3])("rejects tampering with envelope component %s", index => {
    const envelopes = new NativeGoogleEnvelope(context, () => now);
    const parts = envelopes.seal(request).split(".");
    const part = parts[index]!;
    parts[index] = (part[0] === "A" ? "B" : "A") + part.slice(1);
    expect(() => envelopes.open(parts.join("."), "request")).toThrow();
  });

  it.each([{ secret: `${context.secret}-rotated` }, { origin: "https://other.example.test" }, { clientId: "another-client" }])("rejects key/context substitution %j", change => {
    const token = new NativeGoogleEnvelope(context, () => now).seal(request);
    expect(() => new NativeGoogleEnvelope({ ...context, ...change }, () => now).open(token, "request")).toThrow();
  });

  it("cannot reinterpret any phase as another ceremony phase", () => {
    const envelope = new NativeGoogleEnvelope(context, () => now);
    for (const payload of [request, browser, grant]) {
      const token = envelope.seal(payload);
      for (const phase of ["request", "browser", "grant"] as const) {
        if (phase !== payload.phase) expect(() => envelope.open(token, phase)).toThrow();
      }
    }
  });

  it("expires exactly at the deadline and permits only the bounded future clock tolerance", () => {
    let clock = now;
    const envelope = new NativeGoogleEnvelope(context, () => clock);
    for (const payload of [request, browser, grant]) {
      clock = now;
      const token = envelope.seal(payload);
      clock = payload.expires_at - 1;
      expect(envelope.open(token, payload.phase)).toEqual(payload);
      clock += 1;
      expect(() => envelope.open(token, payload.phase)).toThrow(/expired/u);
    }
    clock = now;
    const future = { ...request, issued_at: now + 30_000, expires_at: now + 30_001 };
    expect(envelope.open(envelope.seal(future), "request")).toEqual(future);
    expect(() => envelope.seal({ ...future, issued_at: now + 30_001 })).toThrow();
  });

  it("enforces the shorter grant TTL separately from request/browser TTL on seal and open", () => {
    const envelope = new NativeGoogleEnvelope(context, () => now);
    for (const payload of [request, browser, grant]) {
      const excessive = { ...payload, expires_at: payload.expires_at + 1 };
      expect(() => envelope.seal(excessive)).toThrow(/expired/u);
      expect(() => envelope.open(authenticatedFixture(excessive), payload.phase)).toThrow(/expired/u);
      const zeroWindow = { ...payload, expires_at: payload.issued_at };
      expect(() => envelope.open(authenticatedFixture(zeroWindow), payload.phase)).toThrow(/expired/u);
    }
  });

  it.each([
    { v: 2 }, { origin: "https://other.example.test" }, { client_id: "other-client" }, { state: "short" },
    { nonce: "short" }, { redirect_uri: `${NATIVE_GOOGLE_REDIRECT_URI}/` }, { extra: "unowned-field" },
    { issued_at: now + 30_001 }, { issued_at: -1 }, { expires_at: now }, { expires_at: now + 0.5 },
  ])("validates authenticated request plaintext and exact context %j", change => {
    const envelope = new NativeGoogleEnvelope(context, () => now);
    const changed = { ...request, ...change };
    expect(() => envelope.seal(changed as NativeGooglePayloads["request"])).toThrow();
    expect(() => envelope.open(authenticatedFixture(changed), "request")).toThrow();
  });

  it("validates phase-specific browser and grant fields even with a valid authentication tag", () => {
    const envelope = new NativeGoogleEnvelope(context, () => now);
    for (const changed of [{ ...browser, request_hash: "g".repeat(64) }, { ...browser, csrf: "short" }, { ...browser, state: proof }]) {
      expect(() => envelope.open(authenticatedFixture(changed), "browser")).toThrow();
    }
    for (const changed of [{ ...grant, user_id: "not-a-uuid" }, { ...grant, active_school_id: "not-a-uuid" }, { ...grant, mfa_challenge: "short" }, { ...grant, csrf: proof }]) {
      expect(() => envelope.open(authenticatedFixture(changed), "grant")).toThrow();
    }
  });

  it.each(["", "ng2.a.b.c", "ng1.a.b.c", "ng1." + "a".repeat(16) + ".a." + "a".repeat(22), "x".repeat(16_385)])("refuses malformed, truncated or oversized envelope %j", token => {
    expect(() => new NativeGoogleEnvelope(context, () => now).open(token, "request")).toThrow();
  });
});
