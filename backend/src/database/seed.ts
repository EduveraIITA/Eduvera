import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertPostgreSqlConnectionPolicy } from "./connection-policy.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
assertPostgreSqlConnectionPolicy(connectionString, {
  name: "DATABASE_URL",
  purpose: "migrations",
  requireRemoteTls: deploymentEnvironment === "stage" || deploymentEnvironment === "production",
});

const seedPath = resolve(process.argv[2] ?? process.env.SEED_SQL_PATH ?? "generated/medium-school.sql");
const sql = await readFile(seedPath, "utf8");
const pool = new Pool({ connectionString, max: 1, application_name: "omnischool_sql_seeder" });

try {
  await pool.query(sql);
  const result = await pool.query<{
    students: string;
    guardians: string;
    attendance_records: string;
    timetable_slots: string;
  }>(`
    SELECT
      (SELECT count(*) FROM students st JOIN schools sc ON sc.id=st.school_id WHERE sc.code='cis')::text AS students,
      (SELECT count(*) FROM guardian_relationships gr JOIN students st ON st.id=gr.student_id JOIN schools sc ON sc.id=st.school_id WHERE sc.code='cis')::text AS guardians,
      (SELECT count(*) FROM attendance_records ar JOIN students st ON st.id=ar.student_id JOIN schools sc ON sc.id=st.school_id WHERE sc.code='cis')::text AS attendance_records,
      (SELECT count(*) FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id JOIN schools sc ON sc.id=cs.school_id WHERE sc.code='cis')::text AS timetable_slots
  `);
  const counts = result.rows[0];
  process.stdout.write(
    `Loaded medium-school seed: ${counts?.students ?? "0"} students, ` +
    `${counts?.guardians ?? "0"} guardian links, ${counts?.attendance_records ?? "0"} attendance rows, ` +
    `${counts?.timetable_slots ?? "0"} timetable slots.\n`,
  );
} finally {
  await pool.end();
}
