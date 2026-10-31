import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.FINANCE_REVIEW_UPGRADE_TEST === "true";
describe.skipIf(!enabled)("Finance215 nonempty upgrade from213", () => {
  it("preserves exact guardian records and receipt linkage without fabricating past identity or Core evidence", async () => {
    const pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let f = (await client.query(`SELECT s.school_id,s.id AS student_id,s.user_id,i.created_by AS actor_id
        FROM students s JOIN fee_invoices i ON i.school_id=s.school_id AND i.student_id=s.id LIMIT 1`)).rows[0]
        ?? (await client.query(`SELECT s.school_id,s.id AS student_id,s.user_id,m.user_id AS actor_id FROM students s
          JOIN school_memberships m ON m.school_id=s.school_id AND m.role='admin' AND m.is_active LIMIT 1`)).rows[0];
      if (!f) {
        const admin = randomUUID(), learner = randomUUID(), school = randomUUID();
        for (const [id, role] of [[admin, "admin"], [learner, "student"]]) await client.query(`INSERT INTO users(id,username,email,password_hash,first_name,role)
          VALUES($1,$2,$3,'isolated-upgrade-fixture','Upgrade fixture',$4)`, [id, `upgrade-${id}`, `upgrade-${id}@example.test`, role]);
        await client.query("INSERT INTO schools(id,name,code) VALUES($1,'Isolated Finance upgrade',$2)", [school, `upgrade-${school.slice(0, 12)}`]);
        await client.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'student')", [school, admin, learner]);
        const student = (await client.query("INSERT INTO students(school_id,user_id,admission_number) VALUES($1,$2,$3) RETURNING id", [school, learner, randomUUID()])).rows[0].id;
        f = { school_id: school, student_id: student, user_id: learner, actor_id: admin };
      }
      const invoice = randomUUID(), request = randomUUID(), pending = randomUUID(), decision = randomUUID(), payment = randomUUID(), key = randomUUID(), hash = "a".repeat(64);
      const recordedAt = "2026-09-01T12:00:00.000Z";
      await client.query(`INSERT INTO fee_invoices(id,school_id,student_id,reference,description,amount_paise,due_on,created_by)
        VALUES($1,$2,$3,$4,'Historic upgrade fixture',10000,'2026-10-24',$5)`, [invoice, f.school_id, f.student_id, randomUUID(), f.actor_id]);
      await client.query(`INSERT INTO fee_review_requests(id,school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,idempotency_key,request_hash,created_at)
        VALUES($1,$2,$3,'payment',4000,'cash',$4,'Original private explanation',$5,$6,$7,$8)`, [request, f.school_id, invoice, key, f.user_id, key, hash, recordedAt]);
      await client.query(`INSERT INTO fee_payments(id,school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
        VALUES($1,$2,$3,4000,'cash',$4,$5,$6)`, [payment, f.school_id, invoice, key, request, f.actor_id]);
      await client.query(`INSERT INTO fee_review_decisions(id,school_id,request_id,outcome,response,payment_id,reviewed_by,created_at)
        VALUES($1,$2,$3,'verified','Original bank verification',$4,$5,$6)`, [decision, f.school_id, request, payment, f.actor_id, recordedAt]);
      await client.query(`INSERT INTO fee_review_requests(id,school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,idempotency_key,request_hash,created_at)
        VALUES($1,$2,$3,'payment',4000,'cash',$4,'Original unresolved claim',$5,$6,$7,'2026-09-02T12:00:00Z')`, [pending, f.school_id, invoice, randomUUID(), f.user_id, randomUUID(), hash]);
      const before = (await client.query("SELECT count(*)::int AS count FROM campus_model_commands")).rows[0].count;
      const source = await readFile(new URL("../migrations/215_finance_review_storage_convergence.sql", import.meta.url), "utf8");
      await client.query(source);
      expect((await client.query("SELECT to_regclass('fee_review_requests') AS requests,to_regclass('fee_review_decisions') AS decisions")).rows[0]).toEqual({ requests: null, decisions: null });
      const imported = (await client.query("SELECT * FROM fee_native_review_requests WHERE id=$1", [request])).rows[0];
      expect(imported).toMatchObject({ id: request, invoice_id: invoice, request_hash: hash, idempotency_key: key,
        note: "Original private explanation", correction_watermark: null, route_kind: "guardian_queue", submitter_person_id: null,
        command_id: null, reviewer_person_id: null, reviewer_user_id: null, ledger_basis: null,
        import_provenance: { source_table: "fee_review_requests", migration: 215, identity_evidence: "not_retained" } });
      expect(imported.created_at.toISOString()).toBe(recordedAt);
      expect((await client.query("SELECT id,review_id,payment_id,command_id,authority_receipt,import_provenance FROM fee_native_review_decisions WHERE id=$1", [decision])).rows[0])
        .toEqual({ id: decision, review_id: request, payment_id: payment, command_id: null, authority_receipt: null,
          import_provenance: { source_table: "fee_review_decisions", migration: 215, authority_evidence: "not_retained" } });
      expect((await client.query("SELECT count(*)::int AS count FROM campus_model_commands")).rows[0].count).toBe(before);
      await client.query("SAVEPOINT unknown_claimant");
      await expect(client.query(`INSERT INTO fee_native_review_decisions(id,school_id,invoice_id,review_id,outcome,response,payment_id,reviewed_by,reviewer_person_id,
        authority_receipt,stream_revision,command_id,created_at) SELECT gen_random_uuid(),$1,$2,$3,'verified','Unsafe new verification',$4,$5,
          (SELECT person_id FROM students WHERE id=$6),'{}'::jsonb,999,gen_random_uuid(),now()`, [f.school_id, invoice, pending, payment, f.actor_id, f.student_id]))
        .rejects.toThrow("unknown canonical claimant");
      await client.query("ROLLBACK TO SAVEPOINT unknown_claimant");
      expect((await client.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [invoice])).rows[0].count).toBe(1);
      expect((await client.query(`SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f' AND(p.prosrc ~ 'FROM fee_review_(requests|decisions)' OR p.prosrc ~ 'JOIN fee_review_(requests|decisions)')`)).rows[0].count).toBe(0);
      await client.query("ROLLBACK");
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
});
