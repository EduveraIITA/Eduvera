import { Pool } from 'pg';
import { assertSupportedPostgreSqlVersion,postgresClientConnectionConfig } from './connection-policy.js';
import { SCHEMA_CATALOGUE_AUDIT_SQL,schemaCatalogueProblems,type SchemaCatalogueAudit } from './schema-catalogue-audit.js';

const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must explicitly select the ThatCampus database to inspect.');
const connection=postgresClientConnectionConfig(url,{
  name:'DATABASE_URL',purpose:'application',requireRemoteTls:true,
});
const pool=new Pool({...connection,max:1,application_name:'thatcampus_schema_audit'});
const client=await pool.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SET LOCAL lock_timeout='1s'");
  const version=(await client.query<{version:number}>("SELECT current_setting('server_version_num')::int AS version")).rows[0]!.version;
  assertSupportedPostgreSqlVersion(version);
  const audit=(await client.query<{audit:SchemaCatalogueAudit}>(SCHEMA_CATALOGUE_AUDIT_SQL)).rows[0]!.audit;
  const problems=schemaCatalogueProblems(audit);
  await client.query('COMMIT');
  process.stdout.write(JSON.stringify({status:problems.length?'needs_review':'catalogue_checks_passed',...audit,problems,
    limitation:'Metadata checks only; table necessity, authority ownership, history, workload and Simulation require separate acceptance.'},null,2)+'\n');
  if(problems.length) process.exitCode=1;
} finally {
  await client.query('ROLLBACK').catch(()=>undefined);
  client.release();
  await pool.end();
}
