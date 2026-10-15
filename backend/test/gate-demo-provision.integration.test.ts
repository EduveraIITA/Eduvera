import { Pool } from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite('bounded new gate demo database operation',()=>{
 let pool:Pool;
 afterAll(async()=>{await pool?.end();});
 it('creates a separate non-teaching user and a real Gatekeeper role without changing Kavita',async()=>{
  pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:1});
  const moduleUrl=pathToFileURL(resolve('../deploy/gcp/provision-demo-gatekeeper.mjs')).href;
  const {credentialHash,createInsideContainer}=await import(moduleUrl);
  const before=await pool.query("SELECT to_jsonb(u) account,(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.source_id,b.source_kind) FROM staff_role_bindings b WHERE b.user_id=u.id) bindings FROM users u WHERE u.username='kavita.staff'");
  const password='Synthetic!GatekeeperTest123';
  const hash=credentialHash(password);
  const result=await createInsideContainer(hash,'d5c9b749-157b-4257-9e45-4031a4cbb862',pool);
  expect(result).toMatchObject({username:'gate.demo',permissions:['gate.manage']});
  const account=(await pool.query("SELECT * FROM users WHERE username='gate.demo'")).rows[0];
  expect(await verifyPassword(password,account.password_hash)).toBe(true);
  expect(account).toMatchObject({role:'staff',is_active:true});expect(account.email_verified_at).toBeTruthy();
  expect((await pool.query('SELECT staff_kind,status FROM staff_profiles WHERE user_id=$1',[account.id])).rows).toEqual([{staff_kind:'non_teaching',status:'active'}]);
  expect((await pool.query('SELECT permissions FROM staff_role_bindings WHERE user_id=$1',[account.id])).rows).toEqual([{permissions:['gate.manage']}]);
  await expect(createInsideContainer(credentialHash('Another!SyntheticPassword123'),'d5c9b749-157b-4257-9e45-4031a4cbb862',pool)).rejects.toThrow(/already exists/);
  expect((await pool.query('SELECT password_hash FROM users WHERE id=$1',[account.id])).rows[0].password_hash).toBe(hash);
  const after=await pool.query("SELECT to_jsonb(u) account,(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.source_id,b.source_kind) FROM staff_role_bindings b WHERE b.user_id=u.id) bindings FROM users u WHERE u.username='kavita.staff'");
  expect(after.rows).toEqual(before.rows);
  expect((await pool.query("SELECT count(*)::int total FROM event_outbox WHERE idempotency_key='gate-demo:d5c9b749-157b-4257-9e45-4031a4cbb862'")).rows[0].total).toBe(1);
 });
});
