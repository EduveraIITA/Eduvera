import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)});
afterAll(async()=>{await pool.end();});

it('keeps agent storage behind backend ownership and denies browser-role access',async()=>{
  const result=await pool.query(`SELECT relname,relrowsecurity,relowner=(SELECT relowner FROM pg_class WHERE oid='public.students'::regclass) AS app_owned,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(relacl,acldefault('r',relowner))) WHERE grantee=0) AS no_public_grant,
    NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') AND
      (has_table_privilege(r.oid,c.oid,'SELECT') OR has_table_privilege(r.oid,c.oid,'INSERT') OR
       has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE'))) AS no_browser_grant
    FROM pg_class c WHERE c.oid IN ('public.agent_threads'::regclass,'public.agent_runs'::regclass,
      'public.agent_tool_steps'::regclass,'public.agent_actions'::regclass,'public.agent_user_memories'::regclass)`);
  expect(result.rows).toHaveLength(5);
  for(const row of result.rows)expect(row).toMatchObject({relrowsecurity:true,app_owned:true,no_public_grant:true,no_browser_grant:true});
});
