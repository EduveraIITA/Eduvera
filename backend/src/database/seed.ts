import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const connection = postgresClientConnectionConfig(connectionString, {
  name: "DATABASE_URL",
  purpose: "migrations",
  requireRemoteTls: deploymentEnvironment === "stage" || deploymentEnvironment === "production",
});

const seedPath = resolve(process.argv[2] ?? process.env.SEED_SQL_PATH ?? "generated/medium-school.sql");
const sql = await readFile(seedPath, "utf8");
const pool = new Pool({ ...connection, max: 1, application_name: "omnischool_sql_seeder" });

try {
  await pool.query(sql);
  const result = await pool.query<{
    students: string;
    guardians: string;
    participation_records: string;
    timetable_slots: string;
    campus_events: string;
    event_sessions: string;
    event_participants: string;
    event_session_participants: string;
    event_fee_invoices: string;
    event_fee_payments: string;
  }>(`
    SELECT
      (SELECT count(*) FROM students st JOIN schools sc ON sc.id=st.school_id WHERE sc.code='cis')::text AS students,
      (SELECT count(*) FROM guardian_relationships gr JOIN students st ON st.id=gr.student_id JOIN schools sc ON sc.id=st.school_id WHERE sc.code='cis')::text AS guardians,
      (SELECT count(*) FROM activity_attendance_entries ar JOIN schools sc ON sc.id=ar.school_id WHERE sc.code='cis')::text AS participation_records,
      (SELECT count(*) FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id JOIN schools sc ON sc.id=cs.school_id WHERE sc.code='cis')::text AS timetable_slots,
      (SELECT count(*) FROM campus_events event JOIN schools sc ON sc.id=event.school_id WHERE sc.code='cis')::text AS campus_events,
      (SELECT count(*) FROM campus_event_sessions session JOIN schools sc ON sc.id=session.school_id WHERE sc.code='cis')::text AS event_sessions,
      (SELECT count(*) FROM campus_event_participants participant JOIN schools sc ON sc.id=participant.school_id WHERE sc.code='cis')::text AS event_participants,
      (SELECT count(*) FROM campus_event_session_participants participant JOIN schools sc ON sc.id=participant.school_id WHERE sc.code='cis')::text AS event_session_participants,
      (SELECT count(*) FROM fee_invoices invoice JOIN schools sc ON sc.id=invoice.school_id WHERE sc.code='cis' AND invoice.reference LIKE 'EVT-PICNIC-7A-%')::text AS event_fee_invoices,
      (SELECT count(*) FROM fee_payments payment JOIN fee_invoices invoice ON invoice.id=payment.invoice_id JOIN schools sc ON sc.id=invoice.school_id WHERE sc.code='cis' AND invoice.reference LIKE 'EVT-PICNIC-7A-%')::text AS event_fee_payments
  `);
  const counts = result.rows[0];
  process.stdout.write(
    `Loaded medium-school seed: ${counts?.students ?? "0"} students, ` +
    `${counts?.guardians ?? "0"} guardian links, ${counts?.participation_records ?? "0"} canonical participation records, ` +
    `${counts?.timetable_slots ?? "0"} timetable slots, ${counts?.campus_events ?? "0"} campus events, ` +
    `${counts?.event_sessions ?? "0"} event sessions, ${counts?.event_participants ?? "0"} event participants, ` +
    `${counts?.event_session_participants ?? "0"} event-session roster rows, ` +
    `${counts?.event_fee_invoices ?? "0"} event fee invoices (${counts?.event_fee_payments ?? "0"} paid). ` +
    `Bootstrap does not fabricate attendance history; use the owning Attendance services.\n`,
  );
} finally {
  await pool.end();
}
