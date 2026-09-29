import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { assertPostgreSqlConnectionPolicy, postgresClientConnectionConfig } from "../src/database/connection-policy.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("PostgreSQL connection policy", () => {
  it("allows transaction pooling for application queries", () => {
    expect(() => assertPostgreSqlConnectionPolicy(
      "postgresql://app:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
      { name: "DATABASE_URL", purpose: "application", requireRemoteTls: true },
    )).not.toThrow();
  });

  it("rejects transaction pooling for events and migrations", () => {
    const url = "postgresql://app:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require";
    expect(() => assertPostgreSqlConnectionPolicy(url, {
      name: "EVENT_DATABASE_URL",
      purpose: "events",
      requireRemoteTls: true,
    })).toThrow(/persistent session/);
    expect(() => assertPostgreSqlConnectionPolicy(url, {
      name: "MIGRATION_DATABASE_URL",
      purpose: "migrations",
      requireRemoteTls: true,
    })).toThrow(/persistent session/);
  });

  it("maps sslmode=require to encrypted node-postgres TLS without certificate verification", () => {
    const value = "postgresql://events:secret@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require";
    const clientConfig = postgresClientConnectionConfig(value, {
      name: "EVENT_DATABASE_URL",
      purpose: "events",
      requireRemoteTls: true,
    });
    expect(clientConfig.ssl).toEqual({ rejectUnauthorized: false });
    expect(clientConfig.connectionString).not.toContain("sslmode");
  });

  it("leaves certificate-verifying SSL modes under node-postgres control", () => {
    const value = "postgresql://events:secret@db.example.com:5432/postgres?sslmode=verify-full";
    const clientConfig = postgresClientConnectionConfig(value, {
      name: "EVENT_DATABASE_URL",
      purpose: "events",
      requireRemoteTls: true,
    });
    expect(clientConfig).toEqual({ connectionString: value });
  });

  it("requires TLS for remote managed connections but not loopback development", () => {
    expect(() => assertPostgreSqlConnectionPolicy(
      "postgresql://app:secret@db.example.com:5432/postgres",
      { name: "DATABASE_URL", purpose: "application", requireRemoteTls: true },
    )).toThrow(/sslmode/);
    expect(() => assertPostgreSqlConnectionPolicy(
      "postgresql://app:secret@127.0.0.1:5432/omnischool",
      { name: "DATABASE_URL", purpose: "application", requireRemoteTls: false },
    )).not.toThrow();
  });
});

describe("managed deployment configuration", () => {
  function setProductionEnvironment(): void {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DEPLOYMENT_ENVIRONMENT: "production",
      DATABASE_URL: "postgresql://app:secret@pool.example.com:6543/postgres?sslmode=require",
      EVENT_DATABASE_URL: "postgresql://events:secret@db.example.com:5432/postgres?sslmode=verify-full",
      DATABASE_POOL_MAX: "8",
      COOKIE_SECRET: "unit-test-cookie-key-that-is-long-enough",
      COOKIE_SECURE: "true",
      ALLOWED_ORIGINS: "https://school.example",
      PUBLIC_URL: "https://school.example",
      RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
      METRICS_TOKEN: "unit-test-metrics-key-that-is-long-enough",
      DEMO_MODE: "false",
      RATE_LIMIT_STORE: "postgres",
    });
  }

  it("accepts explicit, secure production settings", () => {
    setProductionEnvironment();
    process.env.EVENT_BROKER_CONNECT_TIMEOUT_MS = "7000";
    process.env.EVENT_CLEANUP_BATCH_SIZE = "250";
    expect(loadConfig()).toMatchObject({
      DATABASE_POOL_MAX: 8,
      EVENT_BROKER_CONNECT_TIMEOUT_MS: 7000,
      EVENT_CLEANUP_BATCH_SIZE: 250,
    });
  });

  it("requires a persistent event URL and secure cookies", () => {
    setProductionEnvironment();
    delete process.env.EVENT_DATABASE_URL;
    expect(() => loadConfig()).toThrow(/EVENT_DATABASE_URL/);

    setProductionEnvironment();
    process.env.COOKIE_SECURE = "false";
    expect(() => loadConfig()).toThrow(/COOKIE_SECURE/);

    setProductionEnvironment();
    delete process.env.METRICS_TOKEN;
    expect(() => loadConfig()).toThrow(/METRICS_TOKEN/);
  });

  it("rejects unsafe production modes and unbounded pools", () => {
    setProductionEnvironment();
    process.env.DEMO_MODE = "true";
    expect(() => loadConfig()).toThrow(/DEMO_MODE/);

    setProductionEnvironment();
    process.env.DATABASE_POOL_MAX = "51";
    expect(() => loadConfig()).toThrow();

    setProductionEnvironment();
    process.env.EVENT_BROKER_CONNECT_TIMEOUT_MS = "0";
    expect(() => loadConfig()).toThrow();

    setProductionEnvironment();
    process.env.EVENT_CLEANUP_BATCH_SIZE = "10001";
    expect(() => loadConfig()).toThrow();
  });

  it("does not expose passwordless demo impersonation in stage", () => {
    setProductionEnvironment();
    process.env.DEPLOYMENT_ENVIRONMENT = "stage";
    process.env.DEMO_MODE = "true";
    expect(() => loadConfig()).toThrow(/DEMO_MODE.*stage/);
  });

  it("rejects ambiguous or reused managed secrets", () => {
    setProductionEnvironment();
    process.env.COOKIE_SECRET = "unit-test-cookie-secret with whitespace";
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET.*whitespace/);

    setProductionEnvironment();
    process.env.METRICS_TOKEN = process.env.COOKIE_SECRET;
    expect(() => loadConfig()).toThrow(/must be different/);
  });
});
