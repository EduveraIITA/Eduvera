import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/fee_index_unused_test";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }) });
afterAll(() => db.destroy());
describe.skipIf(!enabled)("Finance duplicate identity index consolidation", () => {
  it("executes the real consolidation block without changing FK validation, deferrability or actions", async () => {
    const namespace = `audit_fee_index_${randomUUID().replaceAll("-", "")}`;
    const migration = readFileSync(new URL("../migrations/200_fee_reads_and_duplicate_index_consolidation.sql", import.meta.url), "utf8");
    const block = migration.slice(migration.indexOf("DO $$"))
      .replaceAll("public.students_school_identity_idx", `${namespace}.student_old`)
      .replaceAll("public.students_school_identity_unique", `${namespace}.student_kept`)
      .replaceAll("public.students", `${namespace}.student`)
      .replaceAll("public.staff_role_school_id", `${namespace}.staff_old`)
      .replaceAll("public.staff_responsibility_types_school_id_id_key", `${namespace}.staff_kept`)
      .replaceAll("public.staff_responsibility_types", `${namespace}.staff`);
    const rollback = new Error("Rollback synthetic index fixtures");
    try {
      await db.transaction().execute(async tx => {
        // Synthetic object names contain only a fixed prefix and UUID hex. The
        // transaction is deliberately rolled back; no live identities are used.
        await sql.raw(`CREATE SCHEMA ${namespace};
          CREATE TABLE ${namespace}.student(school_id uuid NOT NULL,id uuid NOT NULL,
            CONSTRAINT student_old UNIQUE(school_id,id));
          ALTER TABLE ${namespace}.student ADD CONSTRAINT student_kept UNIQUE(school_id,id);
          CREATE TABLE ${namespace}.staff(school_id uuid NOT NULL,id uuid NOT NULL,
            CONSTRAINT staff_old UNIQUE(school_id,id));
          ALTER TABLE ${namespace}.staff ADD CONSTRAINT staff_kept UNIQUE(school_id,id);
          CREATE TABLE ${namespace}.child(school_id uuid,student_id uuid,staff_id uuid);
          ALTER TABLE ${namespace}.child ADD CONSTRAINT student_link FOREIGN KEY(school_id,student_id)
            REFERENCES ${namespace}.student(school_id,id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED NOT VALID;
          ALTER TABLE ${namespace}.child ADD CONSTRAINT staff_link FOREIGN KEY(school_id,staff_id)
            REFERENCES ${namespace}.staff(school_id,id) ON UPDATE RESTRICT ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID;`).execute(tx);
        const before = (await sql<{ name: string; definition: string; validated: boolean; deferrable: boolean; deferred: boolean; referenced_index: string }>`
          SELECT conname AS name,pg_get_constraintdef(oid) AS definition,convalidated AS validated,condeferrable AS deferrable,
            condeferred AS deferred,conindid::regclass::text AS referenced_index
          FROM pg_constraint WHERE conrelid=${`${namespace}.child`}::regclass ORDER BY conname`.execute(tx)).rows;
        expect(before.map(row => row.referenced_index)).toEqual([`${namespace}.staff_old`, `${namespace}.student_old`]);
        await sql.raw(block).execute(tx);
        const after = (await sql<{ name: string; definition: string; validated: boolean; deferrable: boolean; deferred: boolean; referenced_index: string }>`
          SELECT conname AS name,pg_get_constraintdef(oid) AS definition,convalidated AS validated,condeferrable AS deferrable,
            condeferred AS deferred,conindid::regclass::text AS referenced_index
          FROM pg_constraint WHERE conrelid=${`${namespace}.child`}::regclass ORDER BY conname`.execute(tx)).rows;
        expect(after.map(row => row.referenced_index)).toEqual([`${namespace}.staff_kept`, `${namespace}.student_kept`]);
        const metadata = (rows: typeof before) => rows.map(({ name, definition, validated, deferrable, deferred }) => ({ name, definition, validated, deferrable, deferred }));
        expect(metadata(after)).toEqual(metadata(before));
        expect((await sql<{ missing: boolean }>`SELECT to_regclass(${`${namespace}.student_old`}) IS NULL
          AND to_regclass(${`${namespace}.staff_old`}) IS NULL AS missing`.execute(tx)).rows[0]?.missing).toBe(true);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
});
