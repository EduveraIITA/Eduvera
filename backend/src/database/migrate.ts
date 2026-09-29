import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertPostgreSqlConnectionPolicy } from "./connection-policy.js";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");
const deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
assertPostgreSqlConnectionPolicy(connectionString, {
  name: "MIGRATION_DATABASE_URL",
  purpose: "migrations",
  requireRemoteTls: deploymentEnvironment === "stage" || deploymentEnvironment === "production",
});
const pool = new Pool({ connectionString, max: 1, application_name: "omnischool_migrator" });
const migrationsDir = resolve(process.cwd(), "migrations");
const client = await pool.connect();
let locked = false;

try {
  await client.query("SELECT pg_advisory_lock(hashtext('omnischool_schema_migrations'))");
  locked = true;
  await client.query(`
    CREATE TABLE IF NOT EXISTS node_schema_migrations (
      name text PRIMARY KEY,
      checksum char(64),
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE node_schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)
  `);
  const applied = new Map(
    (await client.query<{ name: string; checksum: string | null }>("SELECT name, checksum FROM node_schema_migrations")).rows.map(
      (row) => [row.name, row.checksum],
    ),
  );
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const source = await readFile(resolve(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    if (applied.has(name)) {
      const stored = applied.get(name);
      if (stored && stored !== checksum) throw new Error(`Applied migration ${name} has changed (checksum mismatch).`);
      if (!stored) await client.query("UPDATE node_schema_migrations SET checksum=$2 WHERE name=$1", [name, checksum]);
      continue;
    }
    try {
      await client.query("BEGIN");
      await client.query(source);
      await client.query("INSERT INTO node_schema_migrations(name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('omnischool_schema_migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
