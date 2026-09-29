export type PostgreSqlConnectionPurpose = "application" | "events" | "migrations";

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
  options: {
    name: string;
    purpose: PostgreSqlConnectionPurpose;
    requireRemoteTls: boolean;
  },
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
