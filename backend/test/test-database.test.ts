import { describe, expect, it } from "vitest";
import {
  assertIsolatedTestDatabaseName,
  requireIsolatedTestDatabaseUrl,
  requireManagedTestApiBaseUrl,
} from "./test-database.js";

describe("integration database safety guard", () => {
  it.each([
    "postgresql://runner:password@127.0.0.1:5432/omnischool_test",
    "postgres://runner:password@localhost:5432/branch-ci",
    "postgresql://runner:password@[::1]:5432/test_omnischool",
  ])("accepts isolated loopback test databases", (url) => {
    expect(requireIsolatedTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    [undefined, "DATABASE_URL is required"],
    ["not-a-url", "valid PostgreSQL URL"],
    ["mysql://runner:password@127.0.0.1/omnischool_test", "PostgreSQL"],
    ["postgresql://runner:password@db.example.test/omnischool_test", "remote or shared"],
    ["postgresql://runner:password@aws-0-region.pooler.supabase.com/postgres", "remote or shared"],
    ["postgresql://runner:password@127.0.0.1/omnischool_test?host=stage.example.test", "override the loopback host"],
    ["postgresql://runner:password@127.0.0.1/omnischool", "isolated database"],
    ["postgresql://runner:password@127.0.0.1/stage_test", "isolated database"],
  ])("rejects unsafe integration target %s", (url, message) => {
    expect(() => requireIsolatedTestDatabaseUrl(url)).toThrow(message);
  });

  it("re-checks the connected database name before destructive setup", () => {
    expect(() => assertIsolatedTestDatabaseName("postgres")).toThrow("isolated database");
    expect(() => assertIsolatedTestDatabaseName("omnischool_test")).not.toThrow();
  });

  it("refuses every external API override so the guarded database cannot be bypassed", () => {
    expect(requireManagedTestApiBaseUrl(undefined, "http://127.0.0.1:8022")).toBe("http://127.0.0.1:8022");
    expect(() => requireManagedTestApiBaseUrl("http://localhost:8022", "unused")).toThrow("API_BASE_URL overrides");
    expect(() => requireManagedTestApiBaseUrl("https://stage.example.test", "unused")).toThrow("API_BASE_URL overrides");
  });
});
