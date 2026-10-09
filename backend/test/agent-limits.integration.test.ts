import { randomUUID } from 'node:crypto';
import { Kysely,PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
import { reserveModelCall,assertAgentEnabled } from '../src/agent/limits.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)});
const db=new Kysely<any>({dialect:new PostgresDialect({pool})}) as DatabaseService;
const thread=randomUUID();const run=randomUUID();
beforeAll(async()=>{
 const account=(await pool.query("SELECT m.user_id,m.school_id FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE u.username='meera.principal' AND m.is_active LIMIT 1")).rows[0];
 await pool.query("INSERT INTO agent_threads(id,owner_id,school_id,portal) VALUES($1,$2,$3,'principal')",[thread,account.user_id,account.school_id]);
 await pool.query("INSERT INTO agent_runs(id,thread_id,client_id,question,status,provider,model) VALUES($1,$2,$3,'Budget test','running','vertex','gemini-3.1-flash-lite')",[run,thread,randomUUID()]);
});
afterEach(async()=>{vi.unstubAllEnvs();await pool.query('DELETE FROM agent_model_usage WHERE run_id=$1',[run]);});
afterAll(async()=>{await pool.query('DELETE FROM agent_threads WHERE id=$1',[thread]);await db.destroy();});
describe('durable AI allowance',()=>{
 it('serializes racing requests before either can exceed the shared daily cap',async()=>{
  vi.stubEnv('AGENT_DAILY_BUDGET_MICROS','20000');
  const result=await Promise.allSettled([reserveModelCall(db,run,1000,2048),reserveModelCall(db,run,1000,2048)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const usage=await pool.query('SELECT reserved_micros FROM agent_model_usage WHERE run_id=$1',[run]);
  expect(usage.rows).toEqual([{reserved_micros:11852}]);
 });
 it('stops at the monthly allowance independently of the daily allowance',async()=>{
  vi.stubEnv('AGENT_MONTHLY_BUDGET_MICROS','10000');
  await expect(reserveModelCall(db,run,1000,2048)).rejects.toThrow(/allowance/);
 });
 it('fails closed for large prompts, unavailable usage storage, expiry and the kill switch',async()=>{
  await expect(reserveModelCall(db,run,24001,2048)).rejects.toThrow(/too large/);
  await expect(reserveModelCall({transaction:()=>{throw Error('Database unavailable');}} as never,run,10,2048)).rejects.toThrow(/Database/);
  vi.stubEnv('AGENT_ENABLED','false');expect(()=>assertAgentEnabled()).toThrow(/switched off/);
  vi.stubEnv('AGENT_ENABLED','true');vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL','2020-01-01');
  expect(()=>assertAgentEnabled()).toThrow(/paused/);
 });
 it('does not reserve for cancelled or unknown runs',async()=>{
  await expect(reserveModelCall(db,randomUUID(),10,2048)).rejects.toThrow(/no longer active/);
 });
});
