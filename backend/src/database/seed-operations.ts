import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";

// Same identifiers as generate_school_data.py. Never select arbitrary school users.
export function demoId(name: string) {
  const h = createHash("sha256").update(`omnischool:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function seedOperations(pool: Pool, demoMode: boolean) {
  if (!demoMode) return { invoices: 0, payments: 0, skipped: "Demo mode is disabled" };
  const client = await pool.connect();
  const school = demoId("school-cis");
  const admin = demoId("user-meera-principal");
  let invoices = 0;
  let payments = 0;
  try {
    await client.query("BEGIN");
    // Match the school's financial write lock, including simultaneous startup.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [school]);
    const scope = await client.query(`SELECT sc.id FROM schools sc
      JOIN school_memberships sm ON sm.school_id=sc.id
      JOIN users u ON u.id=sm.user_id
      WHERE sc.id=$1 AND sc.code='cis' AND u.id=$2 AND u.username='meera.principal'
        AND u.email='meera.kapoor@example.test' AND u.is_active AND sm.is_active AND sm.role='admin'`, [school, admin]);
    if (!scope.rowCount) {
      await client.query("COMMIT");
      return { invoices, payments, skipped: "Existing Cambridge demo school/account not found" };
    }
    const scenarios = [
      { key: "paid", label: "Tuition — paid example", amount: 1200000, received: 1200000, days: -14, method: "bank_transfer" },
      { key: "partial", label: "Tuition — partial payment example", amount: 1200000, received: 600000, days: -7, method: "cash" },
      { key: "overdue", label: "Activity fee — overdue example", amount: 250000, received: 0, days: -3, method: "cash" },
      { key: "upcoming", label: "Learning materials — upcoming example", amount: 300000, received: 0, days: 21, method: "cash" },
    ];
    for (const name of ["aarav", "ananya", "rohan", "kavya"]) {
      const student = demoId(`student-${name}`);
      const exists = await client.query(`SELECT s.id FROM students s JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 AND s.school_id=$2 AND u.id=$3 AND u.email LIKE '%@example.test'`,
      [student, school, demoId(`user-${name}`)]);
      if (!exists.rowCount) continue;
      for (const scenario of scenarios) {
        const key = `demo-operations-v1-${name}-${scenario.key}`;
        const invoiceId = demoId(key);
        const reference = `DEMO-V1-${name.toUpperCase()}-${scenario.key.toUpperCase()}`;
        const inserted = await client.query(`INSERT INTO fee_invoices
          (id,school_id,student_id,reference,description,amount_paise,due_on,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Kolkata')::date+$7::int,$8)
          ON CONFLICT DO NOTHING RETURNING id`,
        [invoiceId, school, student, reference, `DEMO ONLY · ${scenario.label}`, scenario.amount, scenario.days, admin]);
        // Do not top up or change an invoice that someone has already worked with.
        if (!inserted.rowCount) continue;
        invoices++;
        if (scenario.received) {
          await client.query(`INSERT INTO fee_payments
            (id,school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [demoId(`${key}-payment`), school, invoiceId, scenario.received, scenario.method,
            `${reference}-RECEIPT`, demoId(`${key}-retry`), admin]);
          payments++;
        }
      }
    }
    if (invoices) await client.query(`INSERT INTO school_operations_audit(school_id,actor_id,action)
      VALUES ($1,$2,'demo.fee_examples_seeded')`, [school, admin]);
    await client.query("COMMIT");
    return { invoices, payments, skipped: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.DEMO_MODE !== "true") {
    process.stdout.write("Operations demo seed skipped: DEMO_MODE is not true.\n");
  } else {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
    const connection = postgresClientConnectionConfig(process.env.DATABASE_URL, {
      name: "DATABASE_URL",
      purpose: "migrations",
      requireRemoteTls: deploymentEnvironment === "stage" || deploymentEnvironment === "production",
    });
    const pool = new Pool({ ...connection, max: 1, application_name: "eduera_operations_demo" });
    try {
      process.stdout.write(`Operations demo seed: ${JSON.stringify(await seedOperations(pool, true))}\n`);
    } finally {
      await pool.end();
    }
  }
}
