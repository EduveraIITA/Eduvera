import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { quoteSimulationIdentifier } from "../src/database/simulation-sql.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 1 });
afterAll(async () => pool.end());

describe.skipIf(!enabled)("checkpoint attendance source accounting", () => {
  it("executes the production checkpoint SQL and counts each active/uncutover register once, excluding inactive import copies", async () => {
    const source = await readFile(new URL("../src/database/simulation-world.service.ts", import.meta.url), "utf8");
    const countsSource = source.slice(source.indexOf("const counts = (await client.query<"));
    const counts = /\}>\(`(SELECT[\s\S]*?)`,\s*\[input.virtual_from/u.exec(countsSource)?.[1];
    const next = /client.query<\{ next_at: Date \| null \}>\(`(SELECT min\(due\)[\s\S]*?)`, \[input.virtual_to\]/u.exec(countsSource)?.[1];
    expect(counts).toBeDefined(); expect(next).toBeDefined();
    const client = await pool.connect(), schema = quoteSimulationIdentifier(`dt_metric_reference_test_${randomUUID().replaceAll("-", "")}`);
    const school = randomUUID(), classId = randomUUID(), termId = randomUUID(), date = "2026-10-20";
    const commonDaily = randomUUID(), commonSession = randomUUID(), commonImported = randomUUID(), ordinary = randomUUID();
    const sessionId = randomUUID();
    try {
      await client.query("BEGIN"); await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`CREATE TABLE ${schema}.campus_model_events(event_at timestamptz);
        CREATE TABLE ${schema}.campus_model_operational_messages(state text,response_due_at timestamptz);
        CREATE TABLE ${schema}.students(id uuid);
        CREATE TABLE ${schema}.attendance_registers(id uuid,school_id uuid,class_section_id uuid,term_id uuid,date date,state text,submitted_at timestamptz,locked_at timestamptz,auto_finalize_at timestamptz);
        CREATE TABLE ${schema}.attendance_session_registers(id uuid,school_id uuid,state text,submitted_at timestamptz,locked_at timestamptz,auto_finalize_at timestamptz);
        CREATE TABLE ${schema}.activity_attendance_registers(id uuid,school_id uuid,state text,submitted_at timestamptz,locked_at timestamptz,auto_finalize_at timestamptz);
        CREATE TABLE ${schema}.activity_attendance_source_contexts(school_id uuid,register_id uuid,source_kind text,source_id text,state text);`);
      await client.query(`INSERT INTO ${schema}.attendance_registers VALUES($1,$2,$3,$4,$5,'locked','2026-10-20T08:00Z','2026-10-20T09:00Z',NULL),
        ($6,$2,$3,$4,'2026-10-19','submitted','2026-10-20T08:00Z',NULL,'2026-10-20T12:00Z')`, [randomUUID(), school, classId, termId, date, randomUUID()]);
      await client.query(`INSERT INTO ${schema}.attendance_session_registers VALUES($1,$2,'locked','2026-10-20T08:00Z','2026-10-20T09:00Z',NULL),
        ($3,$2,'locked','2026-10-20T08:00Z','2026-10-20T09:00Z',NULL)`, [sessionId, school, randomUUID()]);
      await client.query(`INSERT INTO ${schema}.activity_attendance_registers VALUES($1,$5,'locked','2026-10-20T08:00Z','2026-10-20T09:00Z',NULL),
        ($2,$5,'locked','2026-10-20T08:00Z','2026-10-20T09:00Z',NULL),
        ($3,$5,'submitted','2026-10-20T08:00Z',NULL,'2026-10-20T11:30Z'),
        ($4,$5,'submitted','2026-10-20T08:00Z',NULL,'2026-10-20T13:00Z')`, [commonDaily, commonSession, commonImported, ordinary, school]);
      await client.query(`INSERT INTO ${schema}.activity_attendance_source_contexts VALUES($1,$2,'daily_class',$3,'active'),
        ($1,$4,'scheduled_session',$5,'active'),($1,$6,'daily_class',$7,'imported')`,
      [school, commonDaily, `${classId}:${termId}:${date}`, commonSession, sessionId, commonImported, `${classId}:${termId}:2026-10-19`]);
      const result = (await client.query(counts!.replaceAll("${schema}", schema), ["2026-10-20T06:00Z", "2026-10-20T11:00Z", "2026-10-20T00:00Z"])).rows[0];
      expect(Number(result.submitted)).toBe(5); expect(Number(result.finalized)).toBe(3);
      const due = (await client.query<{ next_at: Date }>(next!.replaceAll("${schema}", schema), ["2026-10-20T11:00Z"])).rows[0]!.next_at;
      expect(due.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
