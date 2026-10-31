import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const NATIVE_GOOGLE_REDIRECT_URI = "thatcampus://auth/google";
export const NATIVE_GOOGLE_ROOT = "/api/v1/auth/native/google";
export const NATIVE_GOOGLE_COOKIE = "native_google_browser";
export const NATIVE_GOOGLE_REQUEST_TTL_MS = 600_000;
export const NATIVE_GOOGLE_GRANT_TTL_MS = 60_000;
const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const opaque = z.string().min(32).max(16_384);
export const nativeGoogleStartSchema = z.object({ redirect_uri: z.literal(NATIVE_GOOGLE_REDIRECT_URI), state: proof, code_challenge: proof, code_challenge_method: z.literal("S256") }).strict();
export const nativeGoogleProofSchema = z.object({ request: opaque, credential: z.string().min(1).max(16_384), csrf: proof }).strict();
export const nativeGoogleAuthorizeSchema = z.object({ request: opaque }).strict();
export const nativeGoogleExchangeSchema = z.object({ code: opaque, code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u), redirect_uri: z.literal(NATIVE_GOOGLE_REDIRECT_URI) }).strict();
const base = { v: z.literal(1), origin: z.string().url(), client_id: z.string().min(1).max(1024), issued_at: z.number().int().nonnegative(), expires_at: z.number().int().positive() };
const flow = { state: proof, code_challenge: proof, redirect_uri: z.literal(NATIVE_GOOGLE_REDIRECT_URI) };
const schemas = {
  request: z.object({ ...base, ...flow, phase: z.literal("request"), nonce: proof }).strict(),
  browser: z.object({ ...base, phase: z.literal("browser"), request_hash: z.string().regex(/^[a-f0-9]{64}$/u), nonce: proof, csrf: proof }).strict(),
  grant: z.object({ ...base, ...flow, phase: z.literal("grant"), nonce: proof, user_id: z.string().uuid(), active_school_id: z.string().uuid().nullable(), mfa_challenge: proof.nullable() }).strict(),
};
export type NativeGooglePayloads = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> };
export type NativeGoogleContext = { origin: string; clientId: string; secret: string; secureCookie: boolean };
export function nativeGoogleContext(settings: { PUBLIC_URL?: string | undefined; GOOGLE_CLIENT_ID: string; ALLOWED_ORIGINS: string; COOKIE_SECRET: string; COOKIE_SECURE: boolean; DEPLOYMENT_ENVIRONMENT?: string | undefined; NODE_ENV: string }): NativeGoogleContext | null {
  try {
    if (!settings.PUBLIC_URL || !settings.GOOGLE_CLIENT_ID.trim() || settings.COOKIE_SECRET.length < 32) return null;
    const url = new URL(settings.PUBLIC_URL);
    if (url.origin !== settings.PUBLIC_URL || url.username || url.password || !settings.ALLOWED_ORIGINS.split(",").map(value => value.trim()).includes(url.origin)) return null;
    if (url.protocol !== "https:") return null;
    return { origin: url.origin, clientId: settings.GOOGLE_CLIENT_ID, secret: settings.COOKIE_SECRET, secureCookie: true };
  } catch { return null; }
}
export const nativeGoogleDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export const nativeGoogleProof = () => randomBytes(32).toString("base64url");
export function nativeGooglePkceMatches(verifier: string, challenge: string) {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  return actual.length === challenge.length && timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}
/** Stateless confidential envelope; durable one-use ownership remains in the
 * existing hashed auth nonce repository, shared across processes/restarts. */
export class NativeGoogleEnvelope {
  private readonly key: Buffer;
  constructor(private readonly context: NativeGoogleContext, private readonly now: () => number = Date.now) {
    this.key = createHmac("sha256", context.secret).update(`thatcampus/native-google/envelope/v1\0${context.origin}\0${context.clientId}`).digest();
  }
  seal<K extends keyof NativeGooglePayloads>(payload: NativeGooglePayloads[K]): string {
    const checked = this.check(payload, payload.phase), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("thatcampus/native-google/envelope/v1"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(checked), "utf8"), cipher.final()]);
    return `ng1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  }
  open<K extends keyof NativeGooglePayloads>(token: string, phase: K): NativeGooglePayloads[K] {
    if (token.length > 16_384 || !/^ng1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u.test(token)) throw new Error("Invalid native Google envelope.");
    const [, rawIv, rawCiphertext, rawTag] = token.split("."), decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(rawIv!, "base64url"));
    decipher.setAAD(Buffer.from("thatcampus/native-google/envelope/v1")); decipher.setAuthTag(Buffer.from(rawTag!, "base64url"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(rawCiphertext!, "base64url")), decipher.final()]).toString("utf8");
    return this.check(JSON.parse(decoded), phase);
  }
  private check<K extends keyof NativeGooglePayloads>(payload: unknown, phase: K): NativeGooglePayloads[K] {
    const value = schemas[phase].parse(payload), now = this.now(), ttl = phase === "grant" ? NATIVE_GOOGLE_GRANT_TTL_MS : NATIVE_GOOGLE_REQUEST_TTL_MS;
    if (value.origin !== this.context.origin || value.client_id !== this.context.clientId || value.issued_at > now + 30_000 || value.expires_at <= now || value.expires_at <= value.issued_at || value.expires_at - value.issued_at > ttl) throw new Error("Native Google sign-in expired or changed.");
    return value as NativeGooglePayloads[K];
  }
}
