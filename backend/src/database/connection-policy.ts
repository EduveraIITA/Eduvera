export type PostgreSqlConnectionPurpose = "application" | "events" | "migrations" | "simulation";

export function assertSupportedPostgreSqlVersion(version:number):void {
  if(!Number.isSafeInteger(version)||version<170000)throw new Error('PostgreSQL17 or newer is required. Use the PostgreSQL17 server and matching client tools.');
}

export interface PostgreSqlConnectionPolicyOptions {
  name: string;
  purpose: PostgreSqlConnectionPurpose;
  requireRemoteTls: boolean;
}

const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

/** Fail before connecting when a disposable test runner inherits a Live migrator URL. */
export function assertIsolatedMigrationBinding(migrationUrl: string, applicationUrl: string | undefined): void {
  if (!applicationUrl) throw new Error("Isolated migrations require DATABASE_URL and MIGRATION_DATABASE_URL bound to the same test database.");
  const migration = assertPostgreSqlConnectionPolicy(migrationUrl, {
    name: "MIGRATION_DATABASE_URL", purpose: "migrations", requireRemoteTls: false,
  });
  const application = assertPostgreSqlConnectionPolicy(applicationUrl, {
    name: "DATABASE_URL", purpose: "application", requireRemoteTls: false,
  });
  const testName = /(?:^|[_-])(?:test|ci)(?:[_-]|$)/i;
  const sharedName = /(?:^|[_-])(?:live|prod|production|stage|staging|shared|supabase)(?:[_-]|$)/i;
  for (const target of [migration, application]) {
    const name = decodeURIComponent(target.pathname).replace(/^\/+|\/+$/g, "");
    if (!isLoopback(target.hostname) || !testName.test(name) || sharedName.test(name)
      || ["host", "hostaddr", "service", "port", "dbname", "database"].some(key => target.searchParams.has(key))) {
      throw new Error("Isolated migrations refuse a Live, shared, remote or overridden database target.");
    }
  }
  if (migration.hostname !== application.hostname || (migration.port || "5432") !== (application.port || "5432")
    || decodeURIComponent(migration.pathname) !== decodeURIComponent(application.pathname)) {
    throw new Error("Isolated migrations require DATABASE_URL and MIGRATION_DATABASE_URL bound to the same test database.");
  }
}

function isTransactionPooler(url: URL): boolean {
  return url.port === "6543" || url.searchParams.get("pgbouncer")?.toLowerCase() === "true";
}

function connectionSocketHost(url: URL, name: string): string | undefined {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw new Error(`${name} must not repeat connection query parameters`);
  if (keys.some(key => ["hostaddr", "service", "servicefile", "port", "dbname", "database", "user", "password"].includes(key))) {
    throw new Error(`${name} must not override its connection identity through query parameters`);
  }
  const host = url.searchParams.get("host");
  if (host === null) return undefined;
  // Cloud Run's attached Cloud SQL connector owns this local socket and its
  // encrypted upstream. A generic query-host override could bypass TLS/target
  // checks by disguising a remote connection behind a loopback URL authority.
  if (!isLoopback(url.hostname) || url.port && url.port !== "5432"
    || !/^\/cloudsql\/[a-z][a-z0-9-]{4,61}[a-z0-9]:[a-z][a-z0-9-]{0,62}:[a-z][a-z0-9-]{0,97}$/u.test(host)) {
    throw new Error(`${name} refuses host overrides except one Cloud SQL connector socket on a loopback URL`);
  }
  return host;
}

export function assertPostgreSqlConnectionPolicy(
  value: string,
  options: PostgreSqlConnectionPolicyOptions,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${options.name} must be a valid PostgreSQL URL`);
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error(`${options.name} must be a valid PostgreSQL URL`);
  }
  connectionSocketHost(url, options.name);

  if (options.purpose !== "application" && isTransactionPooler(url)) {
    const requirement = options.purpose === "events"
      ? "LISTEN requires a persistent session"
      : options.purpose === "simulation"
        ? "Simulation snapshot provisioning and advisory locks require a persistent session"
        : "migrations require a persistent session";
    throw new Error(`${options.name} cannot use transaction pooling because ${requirement}`);
  }

  if (options.requireRemoteTls && !isLoopback(url.hostname)) {
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (!sslMode || !TLS_MODES.has(sslMode)) {
      throw new Error(`${options.name} must set sslmode=require, verify-ca, or verify-full for a remote database`);
    }
  }

  return url;
}

/**
 * Convert an already-validated PostgreSQL URL into node-postgres options.
 *
 * libpq's sslmode=require promises encryption but does not require certificate
 * verification. node-postgres otherwise inherits Node TLS verification and can
 * reject managed poolers with provider-managed/self-signed chains. Remove
 * sslmode from the URI before supplying the explicit ssl object because
 * node-postgres documents that URI SSL parameters overwrite object settings.
 * Stronger verify-ca/verify-full modes remain untouched.
 */
export function postgresClientConnectionConfig(
  value: string,
  options: PostgreSqlConnectionPolicyOptions,
): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const url = assertPostgreSqlConnectionPolicy(value, options);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();

  if (options.requireRemoteTls && !isLoopback(url.hostname) && sslMode === "require") {
    const normalized = new URL(url.toString());
    normalized.searchParams.delete("sslmode");
    return {
      connectionString: normalized.toString(),
      ssl: { rejectUnauthorized: false },
    };
  }

  return { connectionString: value };
}

/** Match node-postgres's reviewed target when invoking a libpq client. Values
 * are subprocess configuration, never log/receipt content or command arguments. */
export function postgresLibpqConnectionEnvironment(value: string, options: PostgreSqlConnectionPolicyOptions): Record<string, string> {
  const url = assertPostgreSqlConnectionPolicy(value, options);
  return {
    PGHOST: connectionSocketHost(url, options.name) ?? url.hostname.replace(/^\[|\]$/gu, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: "5",
    PGSSLMODE: url.searchParams.get("sslmode") ?? "disable",
    ...Object.fromEntries(["sslrootcert", "sslcert", "sslkey", "sslcrl"].flatMap(key => {
      const configured = url.searchParams.get(key);
      return configured === null ? [] : [[`PG${key.toUpperCase()}`, configured]];
    })),
  };
}
