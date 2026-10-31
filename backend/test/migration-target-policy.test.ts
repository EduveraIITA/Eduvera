import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertIsolatedMigrationBinding } from "../src/database/connection-policy.js";

const source = "postgresql://app:fictional@127.0.0.1:5432/thatcampus_accommodation_test";

describe("disposable migration target binding", () => {
  it("allows distinct credentials only on the same explicit isolated endpoint", () => {
    expect(() => assertIsolatedMigrationBinding(source.replace("app:", "migrator:"), source)).not.toThrow();
    expect(() => assertIsolatedMigrationBinding(source.replace(":5432/", "/"), source)).not.toThrow();
  });

  it("rejects missing, inherited Live, mismatched, remote and host-override bindings", () => {
    expect(() => assertIsolatedMigrationBinding(source, undefined)).toThrow("same test database");
    expect(() => assertIsolatedMigrationBinding(source.replace("accommodation_test", "live"), source)).toThrow("refuse");
    expect(() => assertIsolatedMigrationBinding(source, source.replace("accommodation_test", "other_test"))).toThrow("same test database");
    expect(() => assertIsolatedMigrationBinding(source.replace("127.0.0.1", "db.example.test"), source)).toThrow("refuse");
    expect(() => assertIsolatedMigrationBinding(`${source}?host=remote.example.test`, source)).toThrow("refuse");
    expect(() => assertIsolatedMigrationBinding(source.replace("accommodation_test", "live_test"), source)).toThrow("refuse");
  });

  it("the normal migrator fails before opening a connection for an inherited Live URL", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "src/database/migrate.ts"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, TEST_DATABASE_ISOLATED: "true", DATABASE_URL: source,
        MIGRATION_DATABASE_URL: source.replace("accommodation_test", "live") },
    });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("Isolated migrations refuse");
    expect(child.stdout).not.toContain("Applied");
  });
});
