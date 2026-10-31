import { Pool } from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
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
  const school=(await pool.query("SELECT id FROM schools WHERE code='cis'")).rows[0].id;
  const homonym=(await pool.query("INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) VALUES($1,$2,'Gatekeeper','Demo','existing-campus@example.test','+919000000301') RETURNING *",[randomUUID(),school])).rows[0];
  const before=await pool.query("SELECT to_jsonb(u) account,(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.source_id,b.source_kind) FROM staff_role_bindings b WHERE b.user_id=u.id) bindings FROM users u WHERE u.username='kavita.staff'");
  const password='Synthetic!GatekeeperTest123';
  const hash=credentialHash(password);
  const result=await createInsideContainer(hash,'d5c9b749-157b-4257-9e45-4031a4cbb862',pool);
  expect(result).toMatchObject({username:'gate.demo',permissions:['gate.manage']});
  const account=(await pool.query("SELECT * FROM users WHERE username='gate.demo'")).rows[0];
  expect(await verifyPassword(password,account.password_hash)).toBe(true);
  expect(account).toMatchObject({role:'staff',is_active:true});expect(account.email_verified_at).toBeTruthy();
  const profile=(await pool.query(`SELECT profile.staff_kind,profile.status,profile.person_id,person.school_id,person.first_name,person.last_name,person.contact_email,person.contact_phone
    FROM staff_profiles profile JOIN school_people person ON person.id=profile.person_id AND person.school_id=profile.school_id WHERE profile.user_id=$1`,[account.id])).rows[0];
  expect(profile).toMatchObject({staff_kind:'non_teaching',status:'active',school_id:school,first_name:'Gatekeeper',last_name:'Demo',contact_email:'',contact_phone:''});
  expect(profile.person_id).not.toBe(homonym.id);expect(profile.person_id).not.toBe(account.id);
  expect((await pool.query('SELECT * FROM school_people WHERE id=$1',[homonym.id])).rows).toEqual([homonym]);
  expect((await pool.query(`SELECT agent.agent_kind,agent.person_id,endpoint.provider,endpoint.status
    FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint
      ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id
    WHERE agent.school_id=$1 AND endpoint.user_id=$2 AND endpoint.effective_until IS NULL`,
    [result.school_id,account.id])).rows).toEqual([{agent_kind:'human',person_id:profile.person_id,provider:'thatcampus',status:'active'}]);
  expect((await pool.query('SELECT permissions FROM staff_role_bindings WHERE user_id=$1',[account.id])).rows).toEqual([{permissions:['gate.manage']}]);
  await expect(createInsideContainer(credentialHash('Another!SyntheticPassword123'),'d5c9b749-157b-4257-9e45-4031a4cbb862',pool)).rejects.toThrow(/already exists/);
  expect((await pool.query('SELECT password_hash FROM users WHERE id=$1',[account.id])).rows[0].password_hash).toBe(hash);
  const after=await pool.query("SELECT to_jsonb(u) account,(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.source_id,b.source_kind) FROM staff_role_bindings b WHERE b.user_id=u.id) bindings FROM users u WHERE u.username='kavita.staff'");
  expect(after.rows).toEqual(before.rows);
  expect((await pool.query("SELECT count(*)::int total FROM event_outbox WHERE idempotency_key='gate-demo:d5c9b749-157b-4257-9e45-4031a4cbb862'")).rows[0].total).toBe(1);
  expect((await pool.query("SELECT metadata FROM audit_events WHERE request_id='d5c9b749-157b-4257-9e45-4031a4cbb862' AND action='gate.direct_database_provision'")).rows)
    .toEqual([{metadata:expect.objectContaining({person_id:profile.person_id,provenance:'explicit_new_account_bootstrap_not_historical_command'})}]);
 });
});
