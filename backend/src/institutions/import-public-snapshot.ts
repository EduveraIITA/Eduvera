import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { csvRows, importSchema } from './import-directory.js';
import { postgresClientConnectionConfig } from '../database/connection-policy.js';

/** Initial public snapshots never replace reviewed records or alter tenant links. */
export async function importPublicSnapshot(client: PoolClient, stream: AsyncIterable<string | Buffer>) {
  await client.query('BEGIN');
  try {
    const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(78234110) AS acquired');
    if (!lock.rows[0]?.acquired) throw new Error('Another public directory import is running.');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query(`CREATE TEMP TABLE directory_snapshot_stage (
      name varchar(180) NOT NULL,institution_type text NOT NULL,source text NOT NULL,source_code text NOT NULL,
      state text NOT NULL,district text NOT NULL,city text NOT NULL,address text NOT NULL,
      is_verified boolean NOT NULL,metadata jsonb NOT NULL,UNIQUE(source,source_code)
    ) ON COMMIT DROP`);
    let headers: string[] | undefined;
    let batch: Record<string, unknown>[] = [];
    let staged = 0;
    async function flush() {
      if (!batch.length) return;
      await client.query(`INSERT INTO directory_snapshot_stage SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS r(name varchar(180),institution_type text,source text,source_code text,state text,district text,
          city text,address text,is_verified boolean,metadata jsonb)`, [JSON.stringify(batch)]);
      staged += batch.length; batch = [];
      if (staged % 50000 === 0) console.log(`Validated and staged ${staged} public directory records.`);
    }
    for await (const cells of csvRows(stream)) {
      if (cells.every(cell => !cell)) continue;
      if (!headers) { headers = cells; continue; }
      if (cells.length !== headers.length) throw new Error('Invalid public snapshot CSV row.');
      const row = importSchema.parse(Object.fromEntries(headers.map((key, i) => [key, cells[i]])));
      if (row.is_verified !== 'false' || row.existing_school_id) throw new Error('Public snapshots cannot verify records or link tenants.');
      const metadata: unknown = JSON.parse(row.metadata);
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid snapshot provenance.');
      batch.push({ name: row.name, institution_type: row.institution_type, source: row.source,
        source_code: row.source_code, state: row.state, district: row.district, city: row.city,
        address: row.address, is_verified: false, metadata });
      if (batch.length === 1000) await flush();
    }
    await flush();
    if (!staged) throw new Error('Public snapshot has no valid records.');
    console.log(`Importing ${staged} validated records; existing official identities are preserved.`);
    const inserted = await client.query<{ source: string; count: string }>(`WITH imported AS (
      INSERT INTO institution_directory(name,institution_type,source,source_code,state,district,city,address,is_verified,metadata)
      SELECT name,institution_type,source,source_code,state,district,city,address,is_verified,metadata FROM directory_snapshot_stage
      ON CONFLICT(source,source_code) DO NOTHING RETURNING source
    ) SELECT source,count(*) FROM imported GROUP BY source ORDER BY source`);
    await client.query('COMMIT');
    await client.query('ANALYZE institution_directory');
    return { staged, inserted: inserted.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.DEPLOYMENT_ENVIRONMENT !== 'stage') throw new Error('This public snapshot import is restricted to Stage.');
  const connection = process.env.EVENT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connection || !process.argv[2]) throw new Error('Stage database and normalized CSV path are required.');
  const pool = new Pool({ ...postgresClientConnectionConfig(connection, {
    name: 'Directory import database', purpose: 'migrations', requireRemoteTls: true,
  }), max: 1, application_name: 'eduera-public-directory-import' });
  const client = await pool.connect();
  try {
    const before = await client.query<{ bytes: string }>('SELECT pg_database_size(current_database()) AS bytes');
    console.log(`Database bytes before import: ${before.rows[0]?.bytes}`);
    console.log(JSON.stringify(await importPublicSnapshot(client, createReadStream(process.argv[2], { encoding: 'utf8' }))));
    const totals = await client.query('SELECT source,institution_type,count(*) FROM institution_directory GROUP BY source,institution_type ORDER BY source,institution_type');
    console.log(JSON.stringify({ directory_totals: totals.rows }));
  } finally { client.release(); await pool.end(); }
}
