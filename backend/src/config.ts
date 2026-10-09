import { resolve } from "node:path";
import { z } from "zod";
import { assertPostgreSqlConnectionPolicy } from "./database/connection-policy.js";

const booleanString = (defaultValue: "true" | "false") => z
  .string()
  .default(defaultValue)
  .transform((value) => ["1", "true", "yes", "on"].includes(value.toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEPLOYMENT_ENVIRONMENT: z.enum(["development", "test", "stage", "production"]).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  EVENT_DATABASE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  EVENT_BROKER_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  EVENT_WORKER_INTERVAL_MS: z.coerce.number().int().min(100).max(30000).default(500),
  EVENT_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  EVENT_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(10).max(10000).default(1000),
  EVENT_REPLAY_LIMIT: z.coerce.number().int().min(10).max(1000).default(250),
  SSE_MAX_CONNECTIONS: z.coerce.number().int().min(10).max(100000).default(10000),
  SSE_MAX_CONNECTIONS_PER_SESSION: z.coerce.number().int().min(1).max(10).default(1),
  SESSION_COOKIE_NAME: z.string().default("omnischool_session"),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(28800),
  COOKIE_SECRET: z.string().min(32).default("development-only-cookie-secret-change-me-now"),
  RESTRICTED_CASE_ENCRYPTION_KEY: z.string().min(32).optional(),
  COOKIE_SECURE: booleanString("false"),
  TRUST_PROXY: booleanString("true"),
  ALLOWED_ORIGINS: z.string().default("http://127.0.0.1:8000,http://localhost:8000"),
  DEMO_MODE: booleanString("false"),
  DEMO_PROFILE_SWITCHER_ENABLED: booleanString("false"),
  SPA_DIST_DIR: z.string().default("../frontend/dist"),
  STAFF_DIST_DIR: z.string().default("../frontend-desktop/dist"),
  PUBLIC_URL: z.string().optional(),
  INVITATION_EMAIL_ENABLED: booleanString("false"),
  INVITATION_EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  RESEND_API_KEY: z.string().min(1).optional(),
  INVITATION_EMAIL_FROM: z.email().optional(),
  SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().pipe(z.union([z.literal(465), z.literal(587)])).default(465),
  SMTP_USER: z.email().optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  RELEASE_SHA: z.string().min(7).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(),
  METRICS_TOKEN: z.string().min(32).optional(),
  UPLOAD_DIR: z.string().default("./storage/leave-documents"),
  AI_PROVIDER: z.enum(["mock", "ollama", "openai-compatible"]).default("mock"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:8b"),
  OPENAI_COMPATIBLE_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  RAZORPAY_ENABLED: booleanString("false"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  PHOTO_ATTENDANCE_ENABLED: booleanString("false"),
  PHOTO_ATTENDANCE_BASE_URL: z.string().url().default("http://127.0.0.1:8100/api"),
  PHOTO_ATTENDANCE_API_TOKEN: z.string().default(""),
  PHOTO_ATTENDANCE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  LOG_LEVEL: z.string().default("info"),
  // "postgres" shares buckets across API instances; "memory" costs nothing per request.
  RATE_LIMIT_STORE: z.enum(["postgres", "memory"]).optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  // Temporary Razorpay Stage sandbox credentials, explicitly requested by the account owner.
  // Remove after rotation; environment variables always take precedence.
  // Payment sandbox mode never grants demo login access.
  const stageSandbox = process.env.DEPLOYMENT_ENVIRONMENT === "stage";
  const value = schema.parse(stageSandbox ? {
    ...process.env,
    // Temporary Razorpay test defaults requested for Stage sandbox payments only.
    RAZORPAY_ENABLED: process.env.RAZORPAY_ENABLED ?? "true",
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? "rzp_test_TlmHlao5mqz2zj",
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? "SdEBCytWR6MESwdilWCISzBb",
  } : process.env);
  if (value.RAZORPAY_ENABLED && ((value.DEPLOYMENT_ENVIRONMENT ?? value.NODE_ENV) === "production" || !value.RAZORPAY_KEY_ID.startsWith("rzp_test_") || !value.RAZORPAY_KEY_SECRET)) {
    throw new Error("Razorpay sandbox requires a non-production environment, a test key ID and a server-side key secret.");
  }
  if (value.INVITATION_EMAIL_ENABLED) {
    if (!value.PUBLIC_URL) throw new Error("PUBLIC_URL is required for invitation email");
    if (value.INVITATION_EMAIL_PROVIDER === "resend") {
      if (!value.RESEND_API_KEY || !value.INVITATION_EMAIL_FROM) throw new Error("RESEND_API_KEY and INVITATION_EMAIL_FROM are required for Resend invitation email");
    } else if (!value.SMTP_USER || !value.SMTP_PASSWORD) throw new Error("SMTP_USER and SMTP_PASSWORD are required for SMTP invitation email");
    const origin = new URL(value.PUBLIC_URL);
    if (origin.protocol !== "https:" || origin.origin !== value.PUBLIC_URL || isLocalHostname(origin.hostname)) throw new Error("Invitation email requires an exact non-local HTTPS PUBLIC_URL origin");
  }
  const deploymentEnvironment = value.DEPLOYMENT_ENVIRONMENT ?? value.NODE_ENV;
  const managedDeployment = deploymentEnvironment === "stage" || deploymentEnvironment === "production";
  const allowedOrigins = value.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  const rateLimitStore = value.RATE_LIMIT_STORE ?? (value.NODE_ENV === "development" ? "memory" : "postgres");

  assertPostgreSqlConnectionPolicy(value.DATABASE_URL, {
    name: "DATABASE_URL",
    purpose: "application",
    requireRemoteTls: managedDeployment,
  });

  if (managedDeployment) {
    if (!value.EVENT_DATABASE_URL) throw new Error("EVENT_DATABASE_URL is required for stage and production deployments");
    assertPostgreSqlConnectionPolicy(value.EVENT_DATABASE_URL, {
      name: "EVENT_DATABASE_URL",
      purpose: "events",
      requireRemoteTls: true,
    });

    const normalizedSecret = value.COOKIE_SECRET.toLowerCase();
    const unsafeSecretMarkers = ["development-only", "change-me", "replace-with", "generate-a", "compose-demo", "omnidemo"];
    if (/\s/.test(value.COOKIE_SECRET)) throw new Error("COOKIE_SECRET must not contain whitespace");
    if (unsafeSecretMarkers.some((marker) => normalizedSecret.includes(marker))) {
      throw new Error("COOKIE_SECRET must be a unique random secret in managed deployments");
    }
    if (!value.RESTRICTED_CASE_ENCRYPTION_KEY) {
      throw new Error("RESTRICTED_CASE_ENCRYPTION_KEY is required for restricted care in managed deployments");
    }
    if (value.RESTRICTED_CASE_ENCRYPTION_KEY === value.COOKIE_SECRET) {
      throw new Error("RESTRICTED_CASE_ENCRYPTION_KEY and COOKIE_SECRET must be different values");
    }
    if (!value.COOKIE_SECURE) throw new Error("COOKIE_SECURE must be true in managed deployments");
    if (rateLimitStore !== "postgres") throw new Error("RATE_LIMIT_STORE must be postgres in managed deployments");
    if (!value.RELEASE_SHA) throw new Error("RELEASE_SHA is required in managed deployments");
    if (!value.PUBLIC_URL) throw new Error("PUBLIC_URL is required in managed deployments");
    const metricsToken = value.METRICS_TOKEN;
    if (!metricsToken) throw new Error("METRICS_TOKEN is required in managed deployments");
    if (/\s/.test(metricsToken)) throw new Error("METRICS_TOKEN must not contain whitespace");
    if (metricsToken === value.COOKIE_SECRET) throw new Error("METRICS_TOKEN and COOKIE_SECRET must be different values");
    if (unsafeSecretMarkers.some((marker) => metricsToken.toLowerCase().includes(marker))) {
      throw new Error("METRICS_TOKEN must be a unique random secret in managed deployments");
    }

    for (const origin of allowedOrigins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
      }
      if (parsed.protocol !== "https:" || parsed.origin !== origin || isLocalHostname(parsed.hostname)) {
        throw new Error(`ALLOWED_ORIGINS must contain exact non-local HTTPS origins in managed deployments: ${origin}`);
      }
    }
    if (!allowedOrigins.length) throw new Error("ALLOWED_ORIGINS must not be empty in managed deployments");

    const publicUrl = new URL(value.PUBLIC_URL);
    if (publicUrl.protocol !== "https:" || publicUrl.origin !== value.PUBLIC_URL || !allowedOrigins.includes(publicUrl.origin)) {
      throw new Error("PUBLIC_URL must be an exact HTTPS origin included in ALLOWED_ORIGINS");
    }
    if (value.DEMO_MODE) {
      throw new Error("DEMO_MODE must be false in managed deployments");
    }
  }
  if (value.PHOTO_ATTENDANCE_ENABLED && value.PHOTO_ATTENDANCE_API_TOKEN.length < 24) {
    throw new Error("PHOTO_ATTENDANCE_API_TOKEN must contain at least 24 characters when photo attendance is enabled");
  }
  return {
    ...value,
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    rateLimitStore,
    allowedOrigins,
    spaDistDir: resolve(process.cwd(), value.SPA_DIST_DIR),
    staffDistDir: resolve(process.cwd(), value.STAFF_DIST_DIR),
    uploadDir: resolve(process.cwd(), value.UPLOAD_DIR),
    restrictedCaseEncryptionKey: value.RESTRICTED_CASE_ENCRYPTION_KEY ?? value.COOKIE_SECRET,
  };
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

let cached: AppConfig | undefined;
export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
