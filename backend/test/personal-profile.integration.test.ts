import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PersonalProfileService } from '../src/auth/personal-profile.service.js';
import { AccountPhoneDelivery } from '../src/auth/account-phone-delivery.js';
import type { AuthenticatedRequest } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const enabled=process.env.PERSONAL_PROFILE_TEST_ISOLATED==='true';
class FakeDelivery extends AccountPhoneDelivery { enabled=false;failed=false;sent:Array<{phone:string;code:string;expiresAt:Date;challengeId:string}>=[];override configured(){return this.enabled;}override async send(input:{phone:string;code:string;expiresAt:Date;challengeId:string}){this.sent.push(input);if(this.failed)throw Error('Synthetic provider response lost');} }
let pool:Pool,db:Kysely<Database>,service:PersonalProfileService;const delivery=new FakeDelivery();
const actor=randomUUID(),other=randomUUID(),session='profile-own-session',otherSession='profile-other-session';
async function request(id=actor,body:unknown={},selected:'live'|'simulation'='live',hash=id===actor?session:otherSession){const user=(await pool.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];return{authUser:user,sessionHash:hash,body,ip:'127.0.0.1',requestId:randomUUID(),executionEnvironmentView:{mode:selected}} as AuthenticatedRequest;}
async function change(id=actor,extra:Record<string,unknown>={}){const req=await request(id),p=await service.read(req);return service.update(await request(id,{expected_revision:p.revision,client_request_id:randomUUID(),name:`${p.first_name} ${p.last_name}`.trim(),expected_first_name:p.first_name,expected_last_name:p.last_name,contact_phone:p.contact_phone,education_background:p.education_background,...extra}));}
describe.runIf(enabled)('private account profile and phone proof on isolated PostgreSQL17',()=>{
 beforeAll(async()=>{const target=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);if(new URL(target).pathname!=='/thatcampus_profile_test_20261030')throw Error('Exact owned profile database required');pool=new Pool({connectionString:target,max:4});db=new Kysely<Database>({dialect:new PostgresDialect({pool})});const version=(await pool.query("SELECT current_setting('server_version_num')::int v")).rows[0].v;expect(version).toBeGreaterThanOrEqual(170000);expect(version).toBeLessThan(180000);
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,username text,email text,first_name text,last_name text,is_active boolean DEFAULT true,role text DEFAULT 'member',password_hash text DEFAULT 'unchanged',email_verified_at timestamptz,updated_at timestamptz DEFAULT now());CREATE TABLE auth_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES users,is_public_demo boolean DEFAULT false,expires_at timestamptz);CREATE TABLE audit_events(id uuid DEFAULT gen_random_uuid(),action text,actor_id uuid,school_id uuid,target_type text,target_id uuid,request_id text,ip_hash text,metadata jsonb);`);
  await pool.query(await readFile(new URL('../migrations/279_account_personal_profile.sql',import.meta.url),'utf8'));
  await pool.query("INSERT INTO users(id,username,email,first_name,last_name)VALUES($1,'synthetic-own','own@example.test','Mira','Sen'),($2,'synthetic-other','other@example.test','Other','Person')",[actor,other]);
  await pool.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at)VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[session,actor,otherSession,other]);
  service=new PersonalProfileService(db as DatabaseService,delivery);
 });
 afterAll(async()=>{await db?.destroy();});
 it('stores own photo/contact/background and name atomically while leaving credentials and other accounts alone',async()=>{
  const before=(await pool.query('SELECT password_hash,email,role,is_active FROM users WHERE id=$1',[actor])).rows[0];const photo=await sharp({create:{width:20,height:20,channels:3,background:'#739b9a'}}).png().toBuffer();
  const saved=await change(actor,{name:'Mira Raman',contact_phone:'+91 98765 43210',education_background:'MSc · self reported',photo_data_url:'data:image/png;base64,'+photo.toString('base64')});expect(saved.contact_phone).toBe('+919876543210');expect(saved.phone_verified).toBe(false);expect(saved.first_name).toBe('Mira Raman');expect(saved.photo_data_url).toMatch(/^data:image\/jpeg/);expect(saved.visibility).toBe('private');
  expect((await pool.query('SELECT password_hash,email,role,is_active FROM users WHERE id=$1',[actor])).rows[0]).toEqual(before);const second=await service.read(await request(other));expect(second.contact_phone).toBe('');expect(second.photo_data_url).toBeNull();
  const audit=(await pool.query('SELECT metadata::text value FROM audit_events')).rows.map(r=>r.value).join('');expect(audit).not.toContain('98765');expect(audit).not.toContain('MSc');expect(audit).not.toContain('base64');
 });
 it('serializes concurrent edits and rejects session/actor/demo/world substitution',async()=>{
  const current=await service.read(await request());const body={expected_revision:current.revision,client_request_id:randomUUID(),name:'Mira Raman',expected_first_name:current.first_name,expected_last_name:current.last_name,contact_phone:current.contact_phone,education_background:'Concurrent edit'};
  const outcomes=await Promise.allSettled([service.update(await request(actor,body)),service.update(await request(actor,{...body,client_request_id:randomUUID(),education_background:'Other edit'}))]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
  await expect(service.update(await request(actor,body,'live',otherSession))).rejects.toThrow(/expired/);
  await expect(service.update({...await request(actor,body),publicDemo:true})).rejects.toThrow(/own signed-in/);
  await expect(executionEnvironmentStorage.run({kind:'simulation'} as never,()=>service.read({authUser:{id:actor}} as AuthenticatedRequest))).rejects.toThrow(/control plane/);
 });
 it('with no provider, no challenge is dispatched and no number becomes verified',async()=>{delivery.enabled=false;const p=await service.read(await request());await expect(service.requestCode(await request(actor,{expected_revision:p.revision}))).rejects.toThrow(/not connected/);expect(delivery.sent).toHaveLength(0);expect((await service.read(await request())).phone_verified).toBe(false);});
 it('binds a short-lived single-use proof to account, session and unchanged saved phone',async()=>{
  delivery.enabled=true;let p=await service.read(await request());const start=await service.requestCode(await request(actor,{expected_revision:p.revision}));expect(JSON.stringify(start)).not.toContain(delivery.sent.at(-1)!.code);expect(JSON.stringify(start)).not.toContain(p.contact_phone);const proof={challenge_id:start.challenge_id,code:delivery.sent.at(-1)!.code};
  await expect(service.confirmCode(await request(other,proof))).rejects.toThrow(/expired/);await expect(service.confirmCode(await request(actor,proof,'live',otherSession))).rejects.toThrow(/expired/);
  await expect(service.confirmCode(await request(actor,{...proof,code:'000000'}))).rejects.toThrow(/incorrect/);expect((await pool.query('SELECT attempts FROM auth_phone_challenges WHERE id=$1',[proof.challenge_id])).rows[0].attempts).toBe(1);
  p=await service.confirmCode(await request(actor,proof));expect(p.phone_verified).toBe(true);await expect(service.confirmCode(await request(actor,proof))).rejects.toThrow(/expired/);
  p=await change(actor,{contact_phone:'+15555550102'});expect(p.phone_verified).toBe(false);
 });
 it('caps failed attempts, cancels proofs when the phone changes, and never sends from Simulation',async()=>{
  await pool.query("UPDATE auth_phone_challenges SET created_at=now()-interval '2 minutes' WHERE user_id=$1",[actor]);let p=await service.read(await request());const first=await service.requestCode(await request(actor,{expected_revision:p.revision}));const proof={challenge_id:first.challenge_id,code:delivery.sent.at(-1)!.code};
  for(let i=0;i<5;i++)await expect(service.confirmCode(await request(actor,{...proof,code:'000000'}))).rejects.toThrow(/incorrect/);await expect(service.confirmCode(await request(actor,proof))).rejects.toThrow(/expired/);
  p=await change(actor,{contact_phone:'+15555550103'});await expect(service.confirmCode(await request(actor,proof))).rejects.toThrow(/expired/);const count=delivery.sent.length;await expect(service.requestCode(await request(actor,{expected_revision:p.revision},'simulation'))).rejects.toThrow(/Live only/);expect(delivery.sent).toHaveLength(count);
 });
 it('contains unknown provider delivery, cooldown and explicit photo removal',async()=>{
  await pool.query("UPDATE auth_phone_challenges SET created_at=now()-interval '2 minutes' WHERE user_id=$1",[actor]);delivery.failed=true;const p=await service.read(await request());await expect(service.requestCode(await request(actor,{expected_revision:p.revision}))).rejects.toThrow(/could not be confirmed/);const count=delivery.sent.length;await expect(service.requestCode(await request(actor,{expected_revision:p.revision}))).rejects.toThrow(/Too many/);expect(delivery.sent).toHaveLength(count);expect((await service.read(await request())).phone_verified).toBe(false);const removed=await change(actor,{photo_data_url:null});expect(removed.photo_override).toBe(true);expect(removed.photo_data_url).toBeNull();
 });
});
