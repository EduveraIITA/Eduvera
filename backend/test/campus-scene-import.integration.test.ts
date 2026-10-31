import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { CampusSceneImportProvider } from '../src/campus-scene-import/scene-import.provider.js';
import { CampusSceneImportService } from '../src/campus-scene-import/scene-import.service.js';
import { sceneImportSchema } from '../src/campus-scene-import/scene-import.contracts.js';
import { reserveModelCall } from '../src/agent/limits.js';
import { campusSceneDocument, campusScenePng, createCampusSceneFixture } from './campus-scenes.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/campus_import_unused_test',max:4})})}) as DatabaseService;
afterAll(()=>db.destroy());
afterEach(()=>vi.unstubAllEnvs());
const geojson=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{building:'yes',name:'Surveyed building'},geometry:{type:'Polygon',coordinates:[[[77,12],[77.001,12],[77.001,12.001],[77,12.001],[77,12]]]}}]});
describe.skipIf(!enabled)('Campus source proposals and durable cloud allowance',()=>{
  it('replays exact proposals, rejects key changes and tenant access, and leaves the scene unsaved',async()=>{
    const f=await createCampusSceneFixture(db),provider=new CampusSceneImportProvider(),service=new CampusSceneImportService(db,f.scenes,provider);
    await f.run(async()=>{
      const input={kind:'geojson',idempotency_key:randomUUID(),text:geojson,label:'Campus survey',attribution:'Institution survey',rights_confirmed:true};
      const result=await service.import(f.user,f.schoolId,f.campusId,input);
      expect(result.document.elements).toHaveLength(1);
      expect(result.document.elements[0]!.review_state).toBe('needs_review');
      expect(await service.import(f.user,f.schoolId,f.campusId,input)).toEqual(result);
      await expect(service.import(f.user,f.schoolId,f.campusId,{...input,label:'Changed request'})).rejects.toThrow(/already used/);
      await expect(service.import(f.borrower,f.schoolId,f.campusId,{...input,idempotency_key:randomUUID()})).rejects.toThrow(/administrator/);
      expect((await f.scenes.workspace(f.user,f.schoolId,f.campusId)).scene).toBeNull();
      const runs=await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_scene_import_runs WHERE campus_id=${f.campusId}::uuid`.execute(db);
      expect(runs.rows[0]!.count).toBe(1);
    });
  });
  it('serializes image reservations with the Assistant budget and retains failed-call allowance',async()=>{
    const f=await createCampusSceneFixture(db),provider=new CampusSceneImportProvider(),service=new CampusSceneImportService(db,f.scenes,provider);
    vi.stubEnv('AGENT_ENABLED','true');vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL','2099-01-01T00:00:00Z');
    await f.run(async()=>{
      const image=await f.scenes.uploadImage(f.user,f.schoolId,f.campusId,{idempotency_key:randomUUID(),rights_confirmed:true,data_url:campusScenePng});
      const usage=(await sql<{day:number;month:number}>`SELECT coalesce(sum(reserved_micros) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS day,coalesce(sum(reserved_micros),0)::bigint AS month FROM
        (SELECT reserved_micros,created_at FROM agent_model_usage UNION ALL SELECT reserved_micros,created_at FROM campus_scene_import_runs) usage
        WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(db)).rows[0]!;
      const reservation=Math.ceil(100*1.1)+512+6144*5;
      vi.stubEnv('AGENT_DAILY_BUDGET_MICROS',String(Number(usage.day)+reservation+100));
      vi.stubEnv('AGENT_MONTHLY_BUDGET_MICROS',String(Number(usage.month)+reservation+100));
      const generate=vi.spyOn(provider,'image').mockImplementation(async(_input,reserve)=>{await reserve(100,6144);throw new Error('Synthetic provider failure');});
      const input={kind:'image',idempotency_key:randomUUID(),image_asset_id:image.image.id,label:'Synthetic plan',source_kind:'site_plan'};
      await expect(service.import(f.user,f.schoolId,f.campusId,input)).rejects.toThrow(/could not be imported/);
      const retained=(await sql<{status:string;reserved_micros:string}>`SELECT status,reserved_micros FROM campus_scene_import_runs WHERE id=${input.idempotency_key}::uuid`.execute(db)).rows[0]!;
      expect(retained.status).toBe('failed');expect(Number(retained.reserved_micros)).toBe(reservation);
      await expect(service.import(f.user,f.schoolId,f.campusId,input)).rejects.toThrow();expect(generate).toHaveBeenCalledTimes(1);
      const thread=randomUUID(),run=randomUUID();
      await sql`INSERT INTO agent_threads(id,owner_id,school_id,portal) VALUES(${thread}::uuid,${f.user.id}::uuid,${f.schoolId}::uuid,'principal')`.execute(db);
      await sql`INSERT INTO agent_runs(id,thread_id,client_id,question,status,provider,model,lease_expires_at) VALUES(${run}::uuid,${thread}::uuid,${randomUUID()}::uuid,'Synthetic allowance test','running','vertex','gemini-3.1-flash-lite',now()+interval '2 minutes')`.execute(db);
      await expect(reserveModelCall(db,run,100,2048)).rejects.toThrow(/allowance/);
      generate.mockResolvedValue(campusSceneDocument());
      // A successful provider must reserve through the supplied seam; the actual
      // provider is separately tested. No external generation occurs in this test.
    });
  });
  it('commits an expired attempt as a definitive failure without refunding its reservation or expiring active work',async()=>{
    const f=await createCampusSceneFixture(db),provider=new CampusSceneImportProvider(),service=new CampusSceneImportService(db,f.scenes,provider);
    vi.stubEnv('AGENT_ENABLED','true');vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL','2099-01-01T00:00:00Z');
    vi.stubEnv('AGENT_DAILY_BUDGET_MICROS','2000000');vi.stubEnv('AGENT_MONTHLY_BUDGET_MICROS','20000000');
    await f.run(async()=>{
      const image=await f.scenes.uploadImage(f.user,f.schoolId,f.campusId,{idempotency_key:randomUUID(),rights_confirmed:true,data_url:campusScenePng});
      const input={kind:'image',idempotency_key:randomUUID(),image_asset_id:image.image.id,label:'Interrupted image',source_kind:'site_plan'};
      const reservation=Math.ceil(100*1.1)+512+6144*5;
      const seedRunning=async(raw:typeof input,age:number)=>{
        const {idempotency_key,...payload}=sceneImportSchema.parse(raw);
        const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        await sql`INSERT INTO campus_scene_import_runs(id,school_id,campus_id,actor_user_id,kind,request_hash,status,input_tokens,max_output_tokens,reserved_micros,created_at)
          VALUES(${idempotency_key}::uuid,${f.schoolId}::uuid,${f.campusId}::uuid,${f.user.id}::uuid,'image',${digest},'running',100,6144,${reservation},${new Date(Date.parse(f.now)-age)})`.execute(db);
      };
      await seedRunning(input,121000);
      const generate=vi.spyOn(provider,'image').mockImplementation(async(_image,reserve)=>{await reserve(100,6144);return campusSceneDocument();});
      let failure:unknown;
      try{await service.import(f.user,f.schoolId,f.campusId,input);}catch(error){failure=error;}
      expect(failure).toBeInstanceOf(HttpException);
      expect((failure as HttpException).getStatus()).toBe(400);
      const envelope=(failure as HttpException).getResponse();
      expect(envelope).toMatchObject({code:'campus_import_failed',detail:expect.stringMatching(/interrupted.*allowance is retained/),message:expect.any(String),attempt_id:input.idempotency_key,retry_requires_new_key:true});
      const retained=(await sql<{status:string;reserved_micros:string;input_tokens:number;max_output_tokens:number;finished_at:Date;error_message:string}>`SELECT status,reserved_micros,input_tokens,max_output_tokens,finished_at,error_message FROM campus_scene_import_runs WHERE id=${input.idempotency_key}::uuid`.execute(db)).rows[0]!;
      expect(retained).toMatchObject({status:'failed',input_tokens:100,max_output_tokens:6144,error_message:expect.stringMatching(/allowance is retained/)});
      expect(Number(retained.reserved_micros)).toBe(reservation);expect(retained.finished_at.toISOString()).toBe(f.now);
      await expect(service.import(f.user,f.schoolId,f.campusId,input)).rejects.toMatchObject({response:envelope});
      expect(generate).not.toHaveBeenCalled();

      const active={...input,idempotency_key:randomUUID(),label:'Still active image'};
      await seedRunning(active,60000);
      await expect(service.import(f.user,f.schoolId,f.campusId,active)).rejects.toMatchObject({status:409});
      expect((await sql<{status:string}>`SELECT status FROM campus_scene_import_runs WHERE id=${active.idempotency_key}::uuid`.execute(db)).rows[0]?.status).toBe('running');
      expect(generate).not.toHaveBeenCalled();

      const next={...input,idempotency_key:randomUUID()};
      expect(await service.import(f.user,f.schoolId,f.campusId,next)).toEqual({document:campusSceneDocument()});
      expect(generate).toHaveBeenCalledTimes(1);
      const admitted=(await sql<{status:string;reserved_micros:string}>`SELECT status,reserved_micros FROM campus_scene_import_runs WHERE id=${next.idempotency_key}::uuid`.execute(db)).rows[0]!;
      expect(admitted.status).toBe('completed');expect(Number(admitted.reserved_micros)).toBe(reservation);
    });
  });
});
