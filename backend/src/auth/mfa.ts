import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(input: Buffer): string {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    output += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 value");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", config().COOKIE_SECRET, "eduera-auth-mfa", "mfa-secret-v1", 32));
}

export function encryptMfaSecret(secret: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("eduera:mfa:v1"));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { encrypted, iv, tag: cipher.getAuthTag() };
}

export function decryptMfaSecret(encrypted: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from("eduera:mfa:v1"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function hotp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function matchingTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  const supplied = Buffer.from(code);
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

export function createMfaSecret(): string {
  return base32Encode(randomBytes(20));
}

export function createRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(6).toString("hex").toUpperCase().replace(/(.{4})(?=.)/g, "$1-"));
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-F0-9]/g, "");
}
