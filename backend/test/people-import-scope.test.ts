import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection } from "kysely";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthenticatedRequest } from "../src/common/request.js";
import { PeopleImportService } from "../src/people/people-import.service.js";

const school = randomUUID(), actor = randomUUID(), job = randomUUID();
const req = { authUser: { id: actor }, requestId: randomUUID() } as AuthenticatedRequest;
function fixture(scope: "institution" | "assigned_resources", role = "staff") {
  const queries: string[] = [];
  class ScopeDriver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery<R>(query: CompiledQuery) {
        queries.push(query.sql);
        const rows = query.sql.includes("FROM school_memberships membership") ? [{ role }]
          : query.sql.includes("WITH campus AS") ? [{ permission: "sis.manage", source_type: "exception", source_id: randomUUID(),
            source_name: "Approved access exception", scope_label: scope, scope_kind: scope, starts_on: "2026-01-01", ends_on: null }] : [];
        return Promise.resolve({ rows: rows as R[] });
      }, async *streamQuery() { yield await Promise.resolve({ rows: [] }); } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createDriver: () => new ScopeDriver(), createAdapter: () => new PostgresAdapter(),
    createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: d => new PostgresIntrospector(d) } });
  return { db, queries, service: new PeopleImportService(db as DatabaseService, {} as never) };
}

describe("People import institution authority", () => {
  it.each(["detail", "stage", "commit"] as const)("rejects resource-only sis.manage before %s can read or mutate campus-wide import data", async action => {
    const f = fixture("assigned_resources");
    try {
      const result = action === "detail" ? f.service.detail(req.authUser, job, school)
        : action === "stage" ? f.service.stage(req, { school_id: school, term_id: randomUUID(), filename: "learners.csv", csv: "not parsed before authorization", idempotency_key: randomUUID() })
          : f.service.commit(req, job, { school_id: school, expected_revision: 1, validation_token: "a".repeat(64), verified: true });
      await expect(result).rejects.toThrow("Institution-scoped school permission sis.manage is required");
      expect(f.queries.some(query => /\bpeople_import(?:s|_rows)\b/u.test(query))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it.each(["administrator", "institution_exception"])("retains the authorized %s path", async authority => {
    const f = fixture("institution", authority === "administrator" ? "admin" : "staff");
    try { await expect(f.service.template(req.authUser, school)).resolves.toContain("admission_number"); }
    finally { await f.db.destroy(); }
  });
});
