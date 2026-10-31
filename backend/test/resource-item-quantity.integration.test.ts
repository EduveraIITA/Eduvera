import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Kysely,PostgresDialect,sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { createResourceLoanFixture,resourceLoanRequest,resourceLoanServices } from './resource-loans.test-support.js';
import { academicScaffoldingCounts } from './learning-offerings.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true',url=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/resource_quantity_unused_test';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:4})})}) as DatabaseService;
beforeAll(()=>{process.env.INVITATION_EMAIL_ENABLED='false';});afterAll(()=>db.destroy());
const input=(campusId:string,quantity:number,assetTag?:string)=>({command_id:randomUUID(),campus_id:campusId,name:'Camera',quantity,...(assetTag?{asset_tag:assetTag}:{})});
async function emptyCatalogue(){
 const services=resourceLoanServices(db),suffix=randomUUID(),account=await db.insertInto('users').values({username:`quantity-${suffix}`,email:`quantity-${suffix}@example.test`,password_hash:'isolated-fixture-only',first_name:'Synthetic',last_name:'Custodian',role:'admin'}).returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
 const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(services.core).createForAccount(tx,account,'UTC')),user:AuthUser={...account,active_school_id:schoolId};
 const campus=await services.topology.createCampus(user,schoolId,{name:'Resource room',code:'RES',campus_type:'main',is_primary:true,timezone:'UTC'},resourceLoanRequest(user));
 return {...services,schoolId,user,campusId:campus.id};
}
const counts=async(schoolId:string)=>(await sql<{holdings:number;types:number;commands:number;events:number;outbox:number}>`SELECT
 (SELECT count(*)::int FROM campus_resource_holdings WHERE school_id=${schoolId}::uuid) AS holdings,
 (SELECT count(*)::int FROM campus_resource_types WHERE school_id=${schoolId}::uuid) AS types,
 (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid) AS commands,
 (SELECT count(*)::int FROM campus_model_events WHERE school_id=${schoolId}::uuid) AS events,
 (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS outbox`.execute(db)).rows[0]!;

describe.skipIf(!enabled)('one atomic quantity decision creates exact independent resource copies',()=>{
 it('creates ten auto-tagged holdings, keeps one-copy authority and availability, and replays concurrent exact requests without duplicates',async()=>{
  const f=await createResourceLoanFixture(db),body=input(f.campusId,10),started=performance.now();
  const [a,b]=await f.run(()=>Promise.all([f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user)),f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))]));
  console.info(JSON.stringify({check:'resource_quantity_10',duration_ms:Number((performance.now()-started).toFixed(3)),production_capacity_claim:false}));
  expect(a.id).toBe(body.command_id);expect(a.quantity).toBe(10);expect(a.created_items).toHaveLength(10);
  expect(b.created_items.map(item=>item.id)).toEqual(a.created_items.map(item=>item.id));
  expect(new Set(a.created_items.map(item=>item.id)).size).toBe(10);expect(new Set(a.created_items.map(item=>item.asset_tag)).size).toBe(10);
  const ids=a.created_items.map(item=>item.id),native=await db.selectFrom('campus_resource_holdings').select(['id','quantity','asset_tag']).where('school_id','=',f.schoolId).where('id','in',ids).execute();
  expect(native).toHaveLength(10);expect(native.every(item=>item.quantity===1&&item.asset_tag)).toBe(true);
  const commands=(await sql<{state:string;domain_id:string}>`SELECT command.state,entity.domain_id FROM campus_model_commands command JOIN campus_model_entities entity ON entity.id=command.target_entity_id WHERE command.school_id=${f.schoolId}::uuid AND command.handler_key='campus_topology.lending_item' AND entity.domain_id=ANY(${ids}::text[])`.execute(db)).rows;
  expect(commands).toHaveLength(10);expect(commands.every(command=>command.state==='accepted')).toBe(true);
  await expect(f.run(()=>f.resources.createItem(f.user,f.schoolId,{...body,quantity:9},resourceLoanRequest(f.user)))).rejects.toThrow('different details');
  await f.run(()=>f.resources.issue(f.user,f.schoolId,{command_id:randomUUID(),expected_revision:0,holding_id:a.id,borrower_person_id:f.borrowerPersonId,due_at:new Date(Date.parse(f.now)+86_400_000).toISOString(),custody_confirmed:true,custody_purpose:'Fictional independent camera copy'}));
  const replay=await f.run(()=>f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user)));
  expect(replay.created_items[0]?.available).toBe(false);expect(replay.created_items.slice(1).every(item=>item.available)).toBe(true);
  expect(await academicScaffoldingCounts(db,f.schoolId)).toEqual({students:0,staff:0,classes:0,terms:0,enrollments:0,guardians:0,roles:0,schedules:0});
 },60_000);

 it('rolls the whole batch back when a custom tag collides in its middle',async()=>{
  const f=await createResourceLoanFixture(db),prefix=`CAM-${randomUUID()}`;
  await f.resources.createItem(f.user,f.schoolId,input(f.campusId,1,`${prefix}-005`),resourceLoanRequest(f.user));
  const before=await counts(f.schoolId),body=input(f.campusId,10,prefix);
  await expect(f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))).rejects.toMatchObject({status:422});
  expect(await counts(f.schoolId)).toEqual(before);
  expect(await db.selectFrom('campus_resource_holdings').select('id').where('school_id','=',f.schoolId).where('asset_tag','like',`${prefix}-%`).execute()).toHaveLength(1);
 },60_000);

 it('rolls type, prior copies, prepared commands, journals and outbox back on an injected middle-copy failure',async()=>{
  const f=await emptyCatalogue(),before=await counts(f.schoolId),original=f.core.recordAcceptedChange.bind(f.core);let accepted=0;
  const fail=vi.spyOn(f.core,'recordAcceptedChange').mockImplementation(async(...args)=>{if(++accepted===5)throw new Error('Injected fifth-copy journal failure');return original(...args);});
  const body=input(f.campusId,10);
  try{await expect(f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))).rejects.toThrow('fifth-copy');}finally{fail.mockRestore();}
  expect(accepted).toBe(5);expect(await counts(f.schoolId)).toEqual(before);expect(before.types).toBe(0);
  expect((await f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))).created_items).toHaveLength(10);
 },60_000);

 it('retains original single-copy request commitments and rechecks revoked permission before replay',async()=>{
  const f=await createResourceLoanFixture(db),body=input(f.campusId,1,`EXACT-${randomUUID()}`),{quantity,...oldBody}=body;void quantity;
  const item=await f.resources.createItem(f.user,f.schoolId,oldBody,resourceLoanRequest(f.user));
  expect(item).toMatchObject({id:body.command_id,quantity:1,asset_tag:body.asset_tag});expect(item.created_items).toHaveLength(1);
  const read=f.core.readDomainCommandReceipt.bind(f.core),legacy=vi.spyOn(f.core,'readDomainCommandReceipt').mockImplementation(async(...args)=>{const result=await read(...args);return result?.state==='completed'?{...result,receipt:{...result.receipt,metadata:{}}}:result;});
  try{expect((await f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))).created_items.map(copy=>copy.id)).toEqual([item.id]);}finally{legacy.mockRestore();}
  await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
  await expect(f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user))).rejects.toThrow();
 },60_000);

 it('keeps the maximum100-copy operation bounded under existing per-copy projections',async()=>{
  const f=await emptyCatalogue(),body=input(f.campusId,100,'QA-COPY'),started=performance.now();
  const result=await f.resources.createItem(f.user,f.schoolId,body,resourceLoanRequest(f.user));
  console.info(JSON.stringify({check:'resource_quantity_100',duration_ms:Number((performance.now()-started).toFixed(3)),production_capacity_claim:false}));
  expect(result.quantity).toBe(100);expect(result.created_items).toHaveLength(100);expect(result.created_items[0]?.asset_tag).toBe('QA-COPY-001');expect(result.created_items[99]?.asset_tag).toBe('QA-COPY-100');
  expect(new Set(result.created_items.map(item=>item.id)).size).toBe(100);expect((await counts(f.schoolId)).holdings).toBe(100);
  const first=await f.resources.workspace(f.user,f.schoolId,{view:'items',page:1}),second=await f.resources.workspace(f.user,f.schoolId,{view:'items',page:2});
  const tags=(start:number,count:number)=>Array.from({length:count},(_,index)=>`QA-COPY-${String(start+index).padStart(3,'0')}`);
  expect(first.items.map(item=>item.asset_tag)).toEqual(tags(1,10));expect(second.items.map(item=>item.asset_tag)).toEqual(tags(11,10));
  expect(second.items.some(item=>first.items.some(previous=>previous.id===item.id))).toBe(false);
  expect((await f.resources.workspace(f.user,f.schoolId,{view:'items',page:1})).items.map(item=>item.id)).toEqual(first.items.map(item=>item.id));
  expect((await f.resources.options(f.user,f.schoolId,{})).holdings.map(item=>item.asset_tag)).toEqual(tags(1,25));
 },90_000);
});
