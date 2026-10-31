import { guardianFeeReviewServices } from "./fee-review.test-support.js";
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  type CompiledQuery, type DatabaseConnection, type QueryResult } from "kysely";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthUser } from "../src/common/request.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { effectiveSchoolAccess } from "../src/roles/authorization.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";

const school = "10000000-0000-4000-8000-000000000001", actor = "20000000-0000-4000-8000-000000000001";
const student = "30000000-0000-4000-8000-000000000001", person = "40000000-0000-4000-8000-000000000001";
const user: AuthUser = { id: actor, active_school_id: school, role: "staff", is_active: true, username: "audit",
  first_name: "Audit", last_name: "Actor", email: "audit@example.test" };
function fixture(mode: "resource" | "family" | "admin" = "resource") {
  const queries: CompiledQuery[] = [];
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
        queries.push(query); let rows: unknown[] = [];
        if (query.sql.includes("FROM school_memberships membership")) rows = [{ role: mode === "admin" ? "admin" : "staff" }];
        else if (query.sql.includes("access_sources AS")) rows = [{ permission: query.parameters.includes("sis.manage") ? "sis.manage" : query.parameters.includes("members.invite") ? "members.invite" : "fees.manage", source_type: "exception", source_id: person,
          source_name: "Restricted resource access", scope_label: "Assigned resources only", scope_kind: "assigned_resources", starts_on: "2026-01-01", ends_on: "2027-01-01" }];
        else if (query.sql.startsWith('select * from "students"')) rows = [{ id: student, person_id: person, school_id: school, user_id: null }];
        else if (query.sql.includes('from "school_people"')) rows = [{ first_name: "Canonical campus name", last_name: "" }];
        else if (query.sql.includes("SELECT 1 FROM students s") && mode === "family") rows = [{}];
        else if (query.sql.includes("SELECT timezone,(")) rows = [{ timezone: "Asia/Kolkata", today: "2026-10-24" }];
        return Promise.resolve({ rows: rows as R[] });
      }, streamQuery: () => { throw new Error("No streaming in a pure regression"); } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
    createIntrospector: value => new PostgresIntrospector(value), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const operations = new OperationsService(db as DatabaseService, {} as never);
  return { db, operations, queries };
}
describe("Finance scope and retained student writer boundaries", () => {
  it("denies resource-only staff across retained reads, directory, workspace, charge and payment paths", async () => {
    const { db, operations, queries } = fixture();
    try {
      const reviews = guardianFeeReviewServices(db as DatabaseService, operations).service;
      const calls = [() => operations.fees(user, school, student), () => operations.feeStudents(user, school),
        () => reviews.workspace(user, school, student),
        () => operations.invoice(user, school, { student_id: student, reference: "SCOPE", description: "Scope", amount_paise: 100, due_on: "2026-10-24" }),
        () => operations.payment(user, school, person, { amount_paise: 100, method: "cash", reference: "SCOPE", idempotency_key: person })];
      for (const call of calls) await expect(call()).rejects.toThrow(/institution-scoped Finance/);
      expect(queries.some(query => query.sql.includes("FROM fee_payments p"))).toBe(false);
      expect(queries.some(query => query.sql.startsWith('insert into "fee_'))).toBe(false);
    } finally { await db.destroy(); }
  });
  it("retains exact linked-family reading without granting charge issue authority", async () => {
    const { db, operations } = fixture("family");
    try { expect((await operations.fees(user, school, student)).can_issue).toBe(false); }
    finally { await db.destroy(); }
  });
  it("rejects a legacy passive-student name correction without touching global or campus names", async () => {
    const { db, operations, queries } = fixture("admin");
    try {
      await expect(operations.student({ ...user, role: "admin" }, school, { first_name: "Changed account name", last_name: "",
        admission_number: "A-1", date_of_birth: null }, student)).rejects.toThrow(/People profile.*revision.*reason/);
      expect(queries.some(query => /^update "(?:users|school_people)"/.test(query.sql))).toBe(false);
    } finally { await db.destroy(); }
  });
  it("evaluates generic effective sources using the selected instant and campus timezone", async () => {
    const { db, queries } = fixture();
    try {
      await effectiveSchoolAccess(db, actor, school, "fees.manage");
      const query = queries.find(item => item.sql.includes("access_sources AS"))!;
      expect(query.sql).toContain("AT TIME ZONE timezone");
      expect(query.sql).toContain("campus.today BETWEEN exception.valid_from");
      expect(query.sql).not.toMatch(/current_date/i);
      expect(query.parameters.some(value => value instanceof Date)).toBe(true);
    } finally { await db.destroy(); }
  });
  it("does not promote resource-only SIS access to campus setup or readiness", async () => {
    const { db, queries } = fixture();
    try {
      const setup = new ProgressiveSetupService(db as DatabaseService, {} as never, {} as never, {} as never);
      await expect(setup.workspace(user, school)).rejects.toThrow(/Institution-scoped school permission sis.manage/);
      await expect(setup.setup(user, school, "fees", {}, {} as never)).rejects.toThrow(/Institution-scoped school permission sis.manage/);
      expect(queries.some(query => query.sql.includes("pg_advisory_xact_lock") || query.sql.includes("schedule_activity_occurrences"))).toBe(false);
      expect(queries.some(query => /^(?:insert|update|delete) /i.test(query.sql))).toBe(false);
    } finally { await db.destroy(); }
  });
  it("requires institution scope for retained campus-wide SIS and invitation commands", async () => {
    const { db, operations } = fixture();
    try {
      await expect(operations.authorize(user, school, "sis.manage")).rejects.toThrow(/Institution-scoped school permission sis.manage/);
      await expect(operations.authorize(user, school, "members.invite")).rejects.toThrow(/Institution-scoped school permission members.invite/);
    } finally { await db.destroy(); }
  });
});
