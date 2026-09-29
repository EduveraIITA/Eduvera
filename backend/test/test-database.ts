const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const TEST_DATABASE_NAME = /(?:^|[_-])(?:test|ci)(?:[_-]|$)/i;
const SHARED_DATABASE_NAME = /(?:^|[_-])(?:prod|production|stage|staging|shared|supabase)(?:[_-]|$)/i;

function normalizeDatabaseName(value: string): string {
  return decodeURIComponent(value).replace(/^\/+|\/+$/g, "");
}

export function assertIsolatedTestDatabaseName(databaseName: string): void {
  const normalized = normalizeDatabaseName(databaseName);
  if (!normalized || !TEST_DATABASE_NAME.test(normalized) || SHARED_DATABASE_NAME.test(normalized)) {
    throw new Error(
      `Integration tests require an isolated database whose name contains a standalone "test" or "ci" segment; received "${normalized || "<empty>"}".`,
    );
  }
}

export function requireIsolatedTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("DATABASE_URL is required for integration tests");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for integration tests");
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("Integration tests require a PostgreSQL DATABASE_URL");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Integration tests refuse remote or shared database hosts; use an isolated PostgreSQL instance on loopback instead of "${host || "<empty>"}".`,
    );
  }
  if (["host", "hostaddr", "service"].some((key) => parsed.searchParams.has(key))) {
    throw new Error("Integration tests refuse DATABASE_URL query parameters that can override the loopback host");
  }

  assertIsolatedTestDatabaseName(parsed.pathname);
  return value;
}

export function requireManagedTestApiBaseUrl(value: string | undefined, fallback: string): string {
  if (value) {
    throw new Error("Integration tests manage their own loopback API; API_BASE_URL overrides are refused");
  }
  return fallback;
}
