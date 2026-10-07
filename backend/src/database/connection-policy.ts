export type PostgreSqlConnectionPurpose = "application" | "events" | "migrations";

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

function isTransactionPooler(url: URL): boolean {
  return url.port === "6543" || url.searchParams.get("pgbouncer")?.toLowerCase() === "true";
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

  if (options.purpose !== "application" && isTransactionPooler(url)) {
    const requirement = options.purpose === "events" ? "LISTEN requires a persistent session" : "migrations require a persistent session";
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
