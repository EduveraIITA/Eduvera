import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Client } from "pg";
import { assertPostgreSqlConnectionPolicy, postgresClientConnectionConfig, postgresLibpqConnectionEnvironment } from "../src/database/connection-policy.js";
import { assertDistinctSimulationDatabase } from "../src/database/simulation-snapshot-store.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("PostgreSQL connection policy", () => {
  it("binds node-postgres and libpq to the same explicit Cloud SQL connector socket", () => {
    const value = "postgresql://dt_role:p%40ss%3A%2F@localhost/thatcampus_dt?host=%2Fcloudsql%2Feduera-511111%3Aasia-south1%3Aeduera-db";
    for (const purpose of ["application", "events", "migrations", "simulation"] as const) {
      const options = { name: "DATABASE_URL", purpose, requireRemoteTls: true };
      const client = new Client(postgresClientConnectionConfig(value, options)); // Parse only; never connect.
      const environment = postgresLibpqConnectionEnvironment(value, options);
      expect(environment).toMatchObject({ PGHOST: client.host, PGPORT: String(client.port),
        PGUSER: client.user, PGDATABASE: client.database, PGPASSWORD: "p@ss:/", PGSSLMODE: "disable" });
      expect(environment.PGHOST).toBe("/cloudsql/eduera-511111:asia-south1:eduera-db");
    }
  });

  it.each([
    "host=db.example.com", "host=%2Ftmp%2Fpostgres", "host=%2Fcloudsql%2F..%2Fprivate",
    "host=%2Fcloudsql%2Feduera-511111%3Aasia-south1%3Aeduera-db&host=elsewhere",
    "hostaddr=203.0.113.1", "service=production", "servicefile=%2Fprivate%2Fservice",
    "port=6543", "dbname=other", "database=other", "user=other", "password=other",
    "sslmode=require&sslmode=disable",
  ])("rejects a hidden connection-target/identity override: %s", query => {
    expect(() => assertPostgreSqlConnectionPolicy(`postgresql://role:fixture@localhost/dt?${query}`,
      { name: "DATABASE_URL", purpose: "application", requireRemoteTls: true })).toThrow(/override|repeat/);
  });

  it("keeps Cloud SQL sockets loopback-only and identifies same-store aliases without conflating separate databases", () => {
    const host = "host=%2Fcloudsql%2Feduera-511111%3Aasia-south1%3Aeduera-db";
    for (const authority of ["db.example.com", "localhost:6543"]) expect(() => assertPostgreSqlConnectionPolicy(
      `postgresql://role:fixture@${authority}/dt?${host}`, { name: "DATABASE_URL", purpose: "simulation", requireRemoteTls: true },
    )).toThrow(/Cloud SQL connector socket/);
    expect(() => assertDistinctSimulationDatabase(`postgresql://live:fixture@localhost/dt?${host}`,
      `postgresql://worlds:other@127.0.0.1:5432/dt?${host}`)).toThrow(/separate from Live/);
    expect(() => assertDistinctSimulationDatabase(`postgresql://live:fixture@localhost/thatcampus_dt?${host}`,
      `postgresql://worlds:other@localhost/thatcampus_dt_simulation?${host}`)).not.toThrow();
  });

  it("retains explicit loopback targets and remote certificate-verifying TLS for libpq", () => {
    const options = { name: "DATABASE_URL", purpose: "application" as const, requireRemoteTls: true };
    expect(postgresLibpqConnectionEnvironment("postgresql://role:fixture@[::1]:5433/local_test", options))
      .toMatchObject({ PGHOST: "::1", PGPORT: "5433", PGDATABASE: "local_test", PGSSLMODE: "disable" });
    expect(postgresLibpqConnectionEnvironment("postgresql://role:fixture@db.example.com/dt?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem", options))
      .toMatchObject({ PGHOST: "db.example.com", PGSSLMODE: "verify-full", PGSSLROOTCERT: "/certs/root.pem" });
    expect(() => postgresLibpqConnectionEnvironment("postgresql://role:fixture@db.example.com/dt", options)).toThrow(/sslmode/);
  });

  it("allows transaction pooling for application queries", () => {
    expect(() => assertPostgreSqlConnectionPolicy(
      "postgresql://app:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
      { name: "DATABASE_URL", purpose: "application", requireRemoteTls: true },
    )).not.toThrow();
  });

  it("rejects transaction pooling for events, migrations, and Simulation", () => {
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
    expect(() => assertPostgreSqlConnectionPolicy(url, {
      name: "CAMPUS_SIMULATION_DATABASE_URL",
      purpose: "simulation",
      requireRemoteTls: true,
    })).toThrow(/Simulation snapshot provisioning and advisory locks require a persistent session/);
    expect(() => assertPostgreSqlConnectionPolicy(
      "postgresql://simulation:secret@db.example.com:5432/postgres?sslmode=require&pgbouncer=true",
      {
        name: "CAMPUS_SIMULATION_DATABASE_URL",
        purpose: "simulation",
        requireRemoteTls: true,
      },
    )).toThrow(/cannot use transaction pooling/);
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
      RESTRICTED_CASE_ENCRYPTION_KEY: "unit-test-restricted-care-key-that-is-separate-and-long",
      COOKIE_SECURE: "true",
      ALLOWED_ORIGINS: "https://school.example",
      PUBLIC_URL: "https://school.example",
      RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
      METRICS_TOKEN: "unit-test-metrics-key-that-is-long-enough",
      DEMO_MODE: "false",
      RATE_LIMIT_STORE: "postgres",
    });
  }

  it("never supplies embedded SMTP credentials and honors explicit runtime settings", () => {
    setProductionEnvironment();
    process.env.DEPLOYMENT_ENVIRONMENT = "stage";
    process.env.DEMO_MODE = "false";
    delete process.env.INVITATION_EMAIL_ENABLED;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    expect(loadConfig()).toMatchObject({INVITATION_EMAIL_ENABLED: false});
    expect(loadConfig().SMTP_PASSWORD).toBeUndefined();
    expect(loadConfig().SMTP_USER).toBeUndefined();
    process.env.SMTP_USER = "override@example.test";
    process.env.SMTP_PASSWORD = "unit-test-smtp-override";
    expect(loadConfig()).toMatchObject({SMTP_USER: "override@example.test", SMTP_PASSWORD: "unit-test-smtp-override"});
    process.env.INVITATION_EMAIL_ENABLED = "false";
    expect(loadConfig().INVITATION_EMAIL_ENABLED).toBe(false);
  });

  it("validates HTTPS invitation credentials without requiring SMTP credentials", () => {
    setProductionEnvironment();
    process.env.INVITATION_EMAIL_ENABLED = "true";
    process.env.INVITATION_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-only-api-key";
    process.env.INVITATION_EMAIL_FROM = "invitations@example.test";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    expect(loadConfig().INVITATION_EMAIL_PROVIDER).toBe("resend");
    delete process.env.RESEND_API_KEY;
    expect(() => loadConfig()).toThrow(/RESEND_API_KEY/);
  });

  it("does not supply demo SMTP credentials in production or non-demo Stage", () => {
    setProductionEnvironment();
    delete process.env.INVITATION_EMAIL_ENABLED;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    expect(loadConfig().SMTP_PASSWORD).toBeUndefined();
    process.env.DEPLOYMENT_ENVIRONMENT = "stage";
    expect(loadConfig().SMTP_PASSWORD).toBeUndefined();
  });

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

  it("requires persistent-session Simulation storage", () => {
    setProductionEnvironment();
    process.env.CAMPUS_SIMULATION_DATABASE_URL =
      "postgresql://simulation:secret@pool.example.com:6543/simulation?sslmode=require";
    expect(() => loadConfig()).toThrow(
      /CAMPUS_SIMULATION_DATABASE_URL cannot use transaction pooling.*persistent session/,
    );

    process.env.CAMPUS_SIMULATION_DATABASE_URL =
      "postgresql://simulation:secret@db.example.com:5432/simulation?sslmode=verify-full";
    expect(loadConfig().CAMPUS_SIMULATION_DATABASE_URL).toBe(process.env.CAMPUS_SIMULATION_DATABASE_URL);
  });

  it("accepts an explicit absolute snapshot tool, not a relative command or shell fragment", () => {
    setProductionEnvironment();
    process.env.SIMULATION_PG_DUMP_PATH = "/opt/postgresql17/bin/pg_dump";
    expect(loadConfig().SIMULATION_PG_DUMP_PATH).toBe(process.env.SIMULATION_PG_DUMP_PATH);
    process.env.SIMULATION_PG_DUMP_PATH = "pg_dump --schema-only";
    expect(() => loadConfig()).toThrow(/absolute executable path/u);
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

    setProductionEnvironment();
    delete process.env.RESTRICTED_CASE_ENCRYPTION_KEY;
    expect(() => loadConfig()).toThrow(/RESTRICTED_CASE_ENCRYPTION_KEY/);
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

  it("rejects public demo access in Stage as well as production", () => {
    setProductionEnvironment();
    process.env.DEPLOYMENT_ENVIRONMENT = "stage";
    process.env.DEMO_MODE = "true";
    expect(() => loadConfig()).toThrow(/DEMO_MODE/);
  });

  it("rejects ambiguous or reused managed secrets", () => {
    setProductionEnvironment();
    process.env.COOKIE_SECRET = "unit-test-cookie-secret with whitespace";
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET.*whitespace/);

    setProductionEnvironment();
    process.env.METRICS_TOKEN = process.env.COOKIE_SECRET;
    expect(() => loadConfig()).toThrow(/must be different/);

    setProductionEnvironment();
    process.env.RESTRICTED_CASE_ENCRYPTION_KEY = process.env.COOKIE_SECRET;
    expect(() => loadConfig()).toThrow(/RESTRICTED_CASE_ENCRYPTION_KEY.*different/);
  });
});
