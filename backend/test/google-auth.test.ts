import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthService, validateGoogleIdentity } from "../src/auth/google-auth.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuditService } from "../src/common/audit.service.js";
import type { FastifyRequest } from "fastify";
vi.mock("../src/config.js", () => ({ config: () => ({ GOOGLE_CLIENT_ID: "test-client" }) }));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const payload = { iss: "https://accounts.google.com", aud: "test-client", sub: "google-subject", email: "teacher@gmail.com", email_verified: true, nonce: "browser-nonce", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
function token(overrides = {}, key = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, ...overrides })).toString("base64url");
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}
afterEach(() => vi.restoreAllMocks());
describe("Google identity proof", () => {
  it("accepts authoritative Gmail and Workspace identities", () => {
    expect(validateGoogleIdentity(payload, "browser-nonce").email).toBe("teacher@gmail.com");
    expect(validateGoogleIdentity({ ...payload, email: "teacher@school.edu", hd: "school.edu" }, "browser-nonce").email).toBe("teacher@school.edu");
  });
  it.each([{ email_verified: false }, { email: "teacher@thirdparty.example" }, { nonce: "other-browser" }, { sub: "" }])("rejects unsafe identity claims %j", change => {
    expect(() => validateGoogleIdentity({ ...payload, ...change }, "browser-nonce")).toThrow();
  });
  it.each([{ aud: "attacker-client" }, { iss: "https://attacker.example" }, { exp: 1 }, { nonce: "other-browser" }])("rejects signed invalid claims before account access %j", async change => {
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({ certs: { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() } } as never);
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new GoogleAuthService({} as DatabaseService, audit as unknown as AuditService);
    await expect(service.login({ credential: token(change) }, "browser-nonce", { ip: "127.0.0.1" } as FastifyRequest)).rejects.toThrow(/verified/);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.google.failed" }));
  });
  it("rejects forged signatures and missing browser cookies", async () => {
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({ certs: { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() } } as never);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const service = new GoogleAuthService({} as DatabaseService, { record: vi.fn() } as unknown as AuditService);
    await expect(service.login({ credential: token({}, other.privateKey) }, "browser-nonce", {} as FastifyRequest)).rejects.toThrow(/verified/);
    await expect(service.login({ credential: token() }, undefined, {} as FastifyRequest)).rejects.toThrow(/expired/);
  });
});
