export function assertSupportedPostgreSqlVersion(version) {
    if (!Number.isSafeInteger(version) || version < 170000)
        throw new Error('PostgreSQL17 or newer is required. Use the PostgreSQL17 server and matching client tools.');
}
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);
function isLoopback(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
/** Fail before connecting when a disposable test runner inherits a Live migrator URL. */
export function assertIsolatedMigrationBinding(migrationUrl, applicationUrl) {
    if (!applicationUrl)
        throw new Error("Isolated migrations require DATABASE_URL and MIGRATION_DATABASE_URL bound to the same test database.");
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
function isTransactionPooler(url) {
    return url.port === "6543" || url.searchParams.get("pgbouncer")?.toLowerCase() === "true";
}
export function assertPostgreSqlConnectionPolicy(value, options) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error(`${options.name} must be a valid PostgreSQL URL`);
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
        throw new Error(`${options.name} must be a valid PostgreSQL URL`);
    }
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
export function postgresClientConnectionConfig(value, options) {
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
//# sourceMappingURL=connection-policy.js.map