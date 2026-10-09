import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const N = 32768;
const R = 8;
const P = 1;

// Public fixture credentials are never acceptable outside explicit local demos.
export function isPublishedDemoPassword(password: string): boolean {
  return password.toLowerCase() === "omnidemo@2026";
}

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export function validatePassword(password: string, identity?: { email?: string; firstName?: string; lastName?: string }): string[] {
  const errors: string[] = [];
  if (isPublishedDemoPassword(password)) errors.push("This password is publicly known. Choose a private password.");
  if (password.length < 12) errors.push("Password must contain at least 12 characters.");
  if (password.length > 128) errors.push("Password must not exceed 128 characters.");
  if (!/[a-z]/.test(password)) errors.push("Password must include a lowercase letter.");
  if (!/[A-Z]/.test(password)) errors.push("Password must include an uppercase letter.");
  if (!/\d/.test(password)) errors.push("Password must include a number.");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must include a symbol.");
  const normalized = password.toLowerCase();
  const personal = [identity?.email?.split("@")[0], identity?.firstName, identity?.lastName]
    .filter((value): value is string => Boolean(value && value.length >= 3));
  if (personal.some((value) => normalized.includes(value.toLowerCase()))) {
    errors.push("Password must not contain your name or email identifier.");
  }
  const digest = createHash("sha256").update(normalized).digest("hex");
  const common = new Set([
    createHash("sha256").update("password123!").digest("hex"),
    createHash("sha256").update("qwerty123456!").digest("hex"),
  ]);
  if (common.has(digest)) errors.push("Choose a less common password.");
  return errors;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24);
  const derived = await scrypt(password, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const derived = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
