import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { demoId, seedOperations } from "../src/database/seed-operations.js";

it("does not connect or write outside demo mode", async () => {
  const pool = new Pool({ connectionString: "postgres://unused:unused@127.0.0.1:1/unused" });
  try {
    expect(await seedOperations(pool, false)).toMatchObject({ invoices: 0, payments: 0, skipped: "Demo mode is disabled" });
  } finally { await pool.end(); }
});

describe.skipIf(process.env.TEST_DATABASE_ISOLATED !== "true")("operations demo fixtures", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(async () => { await pool.end(); });
  it("seeds only known demo students, is concurrency-safe and preserves posted records", async () => {
    await Promise.all([seedOperations(pool, true), seedOperations(pool, true)]);
    const read = async () => (await pool.query(`SELECT i.id,i.student_id,i.amount_paise,i.due_on,
      COALESCE(sum(p.amount_paise),0)::int AS paid
      FROM fee_invoices i LEFT JOIN fee_payments p ON p.invoice_id=i.id
      WHERE i.school_id=$1 AND i.reference LIKE 'DEMO-V1-%' GROUP BY i.id ORDER BY i.id`, [demoId("school-cis")])).rows;
    const before = await read();
    expect(before).toHaveLength(16);
    expect(before.filter(i => i.paid === i.amount_paise)).toHaveLength(4);
    expect(before.filter(i => i.paid > 0 && i.paid < i.amount_paise)).toHaveLength(4);
    expect(before.filter(i => i.paid === 0)).toHaveLength(8);
    expect(new Set(before.map(i => i.student_id))).toEqual(new Set(["aarav", "ananya", "rohan", "kavya"].map(n => demoId(`student-${n}`))));
    expect(await seedOperations(pool, true)).toMatchObject({ invoices: 0, payments: 0 });
    expect(await read()).toEqual(before);
    const receipts = await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE school_id=$1 AND reference LIKE 'DEMO-V1-%'", [demoId("school-cis")]);
    expect(receipts.rows[0].count).toBe(8);
    const audit = await pool.query("SELECT count(*)::int AS count FROM school_operations_audit WHERE school_id=$1 AND action='demo.fee_examples_seeded'", [demoId("school-cis")]);
    expect(audit.rows[0].count).toBe(1);
  });
});
