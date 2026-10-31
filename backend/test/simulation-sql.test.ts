import { describe, expect, it } from "vitest";
import {
  assertDistinctSimulationDatabase,
  privacySafeSimulationRow,
} from "../src/database/simulation-snapshot-store.js";
import {
  bindSimulationSql,
  quoteSimulationIdentifier,
  writtenSimulationTables,
} from "../src/database/simulation-sql.js";

describe("Simulation database boundary", () => {
  it("refuses aliases of the Live database while allowing a distinct store", () => {
    expect(() => assertDistinctSimulationDatabase(
      "postgresql://live:secret@localhost:5432/thatcampus",
      "postgresql://other:different@127.0.0.1/thatcampus",
    )).toThrow(/separate from Live/i);

    expect(() => assertDistinctSimulationDatabase(
      "postgresql://live:secret@127.0.0.1/thatcampus",
      "postgresql://simulation:secret@127.0.0.1/thatcampus_simulation",
    )).not.toThrow();
  });

  it("redacts credential-shaped fields recursively without discarding safe lineage", () => {
    expect(privacySafeSimulationRow({
      id: "person-1",
      password_hash: "hash",
      nested: {
        refresh_token: "token",
        count: 3,
        values: [{ api_key: "key", source_revision: "revision-4" }],
      },
    })).toEqual({
      id: "person-1",
      password_hash: "simulation-disabled",
      nested: {
        refresh_token: "simulation-disabled",
        count: 3,
        values: [{ api_key: "simulation-disabled", source_revision: "revision-4" }],
      },
    });
  });

  it("removes Live token digests while preserving native unique/hash-width constraints", () => {
    const source = [{ token_hash: "a".repeat(64), token_hint: "abc123" }, { token_hash: "b".repeat(64), token_hint: "def456" }];
    const redacted = privacySafeSimulationRow(source) as typeof source;
    expect(redacted[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(redacted[0]!.token_hash).not.toBe(source[0]!.token_hash);
    expect(redacted[0]!.token_hash).not.toBe(redacted[1]!.token_hash);
    expect(redacted[0]!.token_hint).toBe("hidden");
    expect((privacySafeSimulationRow(source) as typeof source)[0]!.token_hash).not.toBe(redacted[0]!.token_hash);
  });
});

describe("Simulation SQL binding", () => {
  it("accepts only server-generated schema identifiers", () => {
    expect(quoteSimulationIdentifier("dt_run_0123abcd")).toBe('"dt_run_0123abcd"');
    expect(() => quoteSimulationIdentifier("public; DROP TABLE schools"))
      .toThrow(/invalid/i);
  });

  it("routes public objects and domain time into the run schema", () => {
    expect(bindSimulationSql(
      "UPDATE public.attendance_registers SET updated_at=now(), effective_on=CURRENT_DATE WHERE id=$1 RETURNING CURRENT_TIMESTAMP",
      "dt_run_0123abcd",
    )).toBe(
      'UPDATE "dt_run_0123abcd".attendance_registers SET updated_at="dt_run_0123abcd".simulation_now(), effective_on="dt_run_0123abcd".simulation_now()::date WHERE id=$1 RETURNING "dt_run_0123abcd".simulation_now()',
    );
  });

  it("does not rewrite time-shaped text inside strings or comments", () => {
    const source = "SELECT 'now() public.users', current_timestamp -- now() public.users\n/* current_date */";
    expect(bindSimulationSql(source, "dt_run_0123abcd")).toBe(
      "SELECT 'now() public.users', \"dt_run_0123abcd\".simulation_now() -- now() public.users\n/* current_date */",
    );
  });

  it("binds explicitly qualified system clocks without an invalid double qualifier", () => {
    expect(bindSimulationSql("SELECT pg_catalog.now(),pg_catalog.clock_timestamp()", "dt_run_0123abcd"))
      .toBe('SELECT "dt_run_0123abcd".simulation_now(),"dt_run_0123abcd".simulation_now()');
  });

  it("detects every table requiring lazy copy-on-write materialization", () => {
    const tables = new Set(["people", "school_memberships", "attendance_registers"]);
    expect(writtenSimulationTables(
      "WITH member AS (UPDATE public.school_memberships SET is_active=false RETURNING *) INSERT INTO people(id) VALUES($1)",
      tables,
    )).toEqual(["people", "school_memberships"]);
    expect(writtenSimulationTables(
      "SELECT * FROM attendance_registers FOR UPDATE",
      tables,
    )).toEqual(["attendance_registers"]);
  });
});
