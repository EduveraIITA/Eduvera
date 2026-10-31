import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSimulationPgDumpVersion, simulationPgDumpExecutable, simulationPgDumpVersion,
  simulationSchemaDump, SimulationCaptureDependencyError } from "../src/database/simulation-pg-dump.js";

const temporaryDirectories: string[] = [];
async function executable(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "thatcampus-pg-dump-test-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "pg_dump");
  await writeFile(file, `#!${process.execPath}\n${body}\n`);
  await chmod(file, 0o700);
  return file;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("Simulation snapshot executable preflight", () => {
  it("sends the explicit source socket, database and snapshot to the actual child without inheriting another context", async () => {
    for (const [key, value] of Object.entries({ PGHOST: "other-world", PGHOSTADDR: "203.0.113.1", PGSERVICE: "other-context",
      PGSERVICEFILE: "/private/other-context", PGDATABASE: "simulation_world", PGSSLMODE: "disable", PGSSLROOTCERT: "/private/other-cert", PGOPTIONS: "-c search_path=other" })) vi.stubEnv(key, value);
    const file = await executable('console.log(JSON.stringify({args:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith("PG")))}));');
    const result = JSON.parse(await simulationSchemaDump("postgresql://dt_role:fixture@localhost/thatcampus_dt?host=%2Fcloudsql%2Feduera-511111%3Aasia-south1%3Aeduera-db", "exact-source-snapshot", file));
    expect(result.args).toEqual(["--schema-only", "--schema=public", "--no-owner", "--no-privileges", "--no-comments", "--snapshot=exact-source-snapshot"]);
    expect(result.env).toEqual({ PGHOST: "/cloudsql/eduera-511111:asia-south1:eduera-db", PGPORT: "5432", PGUSER: "dt_role",
      PGPASSWORD: "fixture", PGDATABASE: "thatcampus_dt", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable" });
    expect(result.args.join(" ")).not.toContain("fixture");
  });

  it("preserves remote TLS in the child and returns no connection diagnostics on failure", async () => {
    const file = await executable('console.log(JSON.stringify({host:process.env.PGHOST,tls:process.env.PGSSLMODE,root:process.env.PGSSLROOTCERT}));');
    expect(JSON.parse(await simulationSchemaDump("postgresql://role:fixture@db.example.com/dt?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem", "snapshot", file)))
      .toEqual({ host: "db.example.com", tls: "verify-full", root: "/certs/root.pem" });
    const failed = await executable('console.error("private connection credentials"); process.exit(1);');
    await expect(simulationSchemaDump("postgresql://role:fixture@localhost/local_test", "snapshot", failed))
      .rejects.toThrow("The Simulation schema snapshot could not be captured.");
  });

  it("keeps PATH lookup as the default but accepts only explicit absolute overrides", () => {
    expect(simulationPgDumpExecutable()).toBe("pg_dump");
    expect(simulationPgDumpExecutable("/opt/postgres/bin/pg_dump")).toBe("/opt/postgres/bin/pg_dump");
    expect(simulationPgDumpExecutable("/some path/pg_dump")).toBe("/some path/pg_dump");
    for (const value of ["", "pg_dump", "./pg_dump", " pg_dump", "/bin/pg_dump\n", "/bin/pg_dump\0"]) {
      expect(() => simulationPgDumpExecutable(value)).toThrow(SimulationCaptureDependencyError);
    }
  });

  it("works with an absolute executable under a restricted launchd-like PATH", async () => {
    const file = await executable('console.log("pg_dump (PostgreSQL) 17.11 (Homebrew)");');
    const version = await simulationPgDumpVersion(file, { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } });
    expect(assertSimulationPgDumpVersion(version, 170011)).toBe(17);
  });

  it("rejects old or unrecognized clients and servers instead of discovering the mismatch after admission", () => {
    expect(assertSimulationPgDumpVersion("pg_dump (PostgreSQL) 18.2", 170011)).toBe(18);
    for (const [output, server] of [["pg_dump (PostgreSQL) 14.22", 170011],
      ["pg_dump (PostgreSQL) 17.11", 180001], ["not pg_dump 17", 170011],
      ["pg_dump (PostgreSQL) 17.11", 160011], ["pg_dump (PostgreSQL) 17.11", NaN]] as const) {
      expect(() => assertSimulationPgDumpVersion(output, server)).toThrow(/snapshot tool needs updating/u);
    }
  });

  it("returns safe errors for missing, failed, excessive and timed-out executables", async () => {
    const missing = "/definitely-unavailable-thatcampus/pg_dump";
    await expect(simulationPgDumpVersion(missing)).rejects.toThrow(/snapshot tool is unavailable/u);
    await expect(simulationPgDumpVersion(missing)).rejects.not.toThrow(/ENOENT|definitely-unavailable/u);
    const failed = await executable('console.error("private connection credentials"); process.exit(1);');
    await expect(simulationPgDumpVersion(failed)).rejects.toThrow(/snapshot tool is unavailable/u);
    const excessive = await executable('console.log("x".repeat(5000));');
    await expect(simulationPgDumpVersion(excessive)).rejects.toThrow(/snapshot tool is unavailable/u);
    const hung = await executable('setInterval(() => {}, 1000);');
    await expect(simulationPgDumpVersion(hung, { timeoutMs: 30 })).rejects.toThrow(/snapshot tool is unavailable/u);
  });
});
