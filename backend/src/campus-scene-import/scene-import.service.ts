import { BadRequestException, ConflictException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { AuthUser } from '../common/request.js';
import { CampusScenesService } from '../campus-scenes/campus-scenes.service.js';
import { sceneDocumentSchema, type SceneDocument } from '../campus-scenes/campus-scenes.contracts.js';
import { assertAgentEnabled, AgentLimitError } from '../agent/limits.js';
import { captureSimulationProviderEffect, selectedSimulationResources } from '../common/simulation-resources.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { sceneImportSchema, sceneLookupSchema, type FloorPlanTarget } from './scene-import.contracts.js';
import { sceneFromGeoJson } from './scene-import.geometry.js';
import { CampusSceneImportProvider, imageSceneBounds } from './scene-import.provider.js';

type ImportRun = {id:string;school_id:string;campus_id:string;actor_user_id:string;kind:string;request_hash:string;status:'running'|'completed'|'failed';result:unknown;error_message:string|null;created_at:Date};
type Admission<T> = {kind:'cached';result:T}|{kind:'new'}|{kind:'expired';message:string};
const failedAttempt = (id:string,message:string) => ({code:'campus_import_failed',detail:message,message,attempt_id:id,retry_requires_new_key:true});
// Provider requests time out after at most 55 seconds. Keep a wider recovery
// interval so an ordinary in-flight request is never admitted a second time.
const INTERRUPTED_AFTER_MS = 120_000;
@Injectable()
export class CampusSceneImportService {
  constructor(private readonly db: DatabaseService, private readonly scenes: CampusScenesService, private readonly provider: CampusSceneImportProvider) {}

  async capabilities(user:AuthUser,school:string,campus:string) { await this.scenes.requireAdmin(user,school,campus); return this.provider.capabilities(); }

  /** Explicit current identities, resolved through the selected-world database. */
  private async floorPlanTarget(user:AuthUser,school:string,campus:string,target:FloorPlanTarget) {
    const workspace=await this.scenes.workspace(user,school,campus);
    const document=workspace.scene?.draft ?? workspace.scene?.published?.document;
    if(!document?.elements.some(element=>element.kind==='building' && element.space_id===target.building_id))
      throw new BadRequestException('Choose a building already linked in the saved campus layout. Save its layout first, then add the floor plan.');
    const places=await this.db.selectFrom('campus_spaces').select(['id','kind','parent_space_id','revision'])
      .where('school_id','=',school).where('campus_id','=',campus).where('status','=','active').execute();
    const byId=new Map(places.map(place=>[place.id,place]));
    const building=byId.get(target.building_id);
    if(!building)throw new BadRequestException('Choose an active building in this campus and current world.');
    if(building.revision!==target.expected_building_revision)throw new ConflictException('This building changed. Refresh the campus places before importing its floor plan.');
    if(!target.floor_id)return;
    const floor=byId.get(target.floor_id);
    if(floor?.kind!=='floor')throw new BadRequestException('Choose an active floor in this campus and current world.');
    if(floor.revision!==target.expected_floor_revision)throw new ConflictException('This floor changed. Refresh the campus places before importing its floor plan.');
    let ancestor:typeof floor|undefined=floor;
    const visited=new Set<string>();
    while(ancestor && ancestor.id!==building.id && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);ancestor=ancestor.parent_space_id?byId.get(ancestor.parent_space_id):undefined;
    }
    if(ancestor?.id!==building.id)throw new BadRequestException('Choose a floor belonging to the selected building.');
  }

  private async proposal<T>(user:AuthUser,school:string,campus:string,id:string,kind:string,input:unknown,operation:()=>Promise<T>):Promise<T> {
    await this.scenes.requireAdmin(user,school,campus);
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const at = executionNow();
    const cached:Admission<T> = await this.db.transaction().execute(async tx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('campus_scene_import_admission'))`.execute(tx);
      // A provider may be completing this receipt while a client retries. Lock
      // the row so recovery observes that completion before deciding to expire it.
      const previous = (await sql<ImportRun>`SELECT * FROM campus_scene_import_runs WHERE id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if (previous) {
        if (previous.school_id!==school || previous.campus_id!==campus || previous.actor_user_id!==user.id || previous.request_hash!==digest) throw new ConflictException('This import request key was already used. Start a new request.');
        if (previous.status==='completed') return {kind:'cached',result:previous.result as T};
        if (previous.status==='failed') throw new BadRequestException(failedAttempt(id,previous.error_message ?? 'This import failed. Start a new request or trace your plan.'));
        const cutoff = new Date(at.getTime()-INTERRUPTED_AFTER_MS);
        if(previous.created_at.getTime()<cutoff.getTime()) {
          const message='This import was interrupted. Start a new attempt; its reserved AI allowance is retained.';
          const expired=await sql`UPDATE campus_scene_import_runs SET status='failed',error_message=${message},finished_at=${at}
            WHERE id=${id}::uuid AND status='running' AND created_at<${cutoff} RETURNING id`.execute(tx);
          if(expired.rows.length)return {kind:'expired',message};
        }
        throw new ConflictException('This import is still running. Wait for it to finish.');
      }
      const reusable=(await sql<ImportRun>`SELECT * FROM campus_scene_import_runs WHERE school_id=${school}::uuid AND campus_id=${campus}::uuid AND actor_user_id=${user.id}::uuid
        AND request_hash=${digest} AND status='completed' AND (kind='image' OR created_at>${new Date(at.getTime()-86400000)}) ORDER BY created_at DESC LIMIT 1`.execute(tx)).rows[0];
      if(reusable) return {kind:'cached',result:reusable.result as T};
      const recent=(await sql<{own:number;global:number}>`SELECT count(*) FILTER(WHERE actor_user_id=${user.id}::uuid)::int AS own,count(*) FILTER(WHERE created_at>${new Date(at.getTime()-60000)} AND kind IN('lookup','location'))::int AS global
        FROM campus_scene_import_runs WHERE created_at>${new Date(at.getTime()-3600000)}`.execute(tx)).rows[0]!;
      if (recent.own>=20 || ['lookup','location'].includes(kind) && recent.global>=5) throw new HttpException('The campus import allowance has been reached. Wait a little or continue editing your draft.',429);
      await sql`INSERT INTO campus_scene_import_runs(id,school_id,campus_id,actor_user_id,kind,request_hash,status,created_at)
        VALUES(${id}::uuid,${school}::uuid,${campus}::uuid,${user.id}::uuid,${kind},${digest},'running',${at})`.execute(tx);
      return {kind:'new'};
    });
    if(cached.kind==='cached') return cached.result;
    // Throw after the transaction commits, so the definitive failure survives
    // retries and its nonrefundable reservation cannot be released accidentally.
    if(cached.kind==='expired')throw new BadRequestException(failedAttempt(id,cached.message));
    try {
      const result=await operation();
      await this.scenes.requireAdmin(user,school,campus);
      await sql`UPDATE campus_scene_import_runs SET status='completed',result=${JSON.stringify(result)}::jsonb,finished_at=${executionNow()} WHERE id=${id}::uuid AND status='running'`.execute(this.db);
      return result;
    } catch(error) {
      const response=error instanceof HttpException ? error.getResponse() : null;
      const message=error instanceof HttpException ? (typeof response==='string' ? response : error.message).slice(0,500) : 'This source could not be imported. Check the file or trace your campus plan.';
      await sql`UPDATE campus_scene_import_runs SET status='failed',error_message=${message},finished_at=${executionNow()} WHERE id=${id}::uuid AND status='running'`.execute(this.db);
      throw new HttpException(failedAttempt(id,message),error instanceof HttpException ? error.getStatus() : 400);
    }
  }

  async lookup(user:AuthUser,school:string,campus:string,raw:unknown) {
    const parsed=sceneLookupSchema.safeParse(raw);
    if(!parsed.success)throw new BadRequestException('Enter the full campus name, between 4 and 120 characters.');
    const {idempotency_key,...input}=parsed.data;
    return this.proposal(user,school,campus,idempotency_key,'lookup',{kind:'lookup',...input},async()=>{
      if(selectedSimulationResources()) {
        await captureSimulationProviderEffect({kind:'connector_call',provider:'campus_scene',operation:'lookup',logicalKey:idempotency_key,idempotencyKey:`campus-scene:${idempotency_key}`,payload:{provider_contacted:false,mode:'captured_or_manual'}});
        throw new ServiceUnavailableException('This Simulation has no captured match for that search. Use a captured draft, upload GeoJSON, or trace a plan.');
      }
      return {locations:await this.provider.lookup(input.query)};
    });
  }

  private async reserve(id:string,userId:string,inputTokens:number,outputTokens:number) {
    const limits=assertAgentEnabled();
    if(!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens>24000||outputTokens!==6144)throw new AgentLimitError('This image is too large for the AI allowance. Try a smaller plan.');
    const reserve=Math.ceil(inputTokens*1.1)+512+outputTokens*5;
    await this.db.transaction().execute(async tx=>{
      await sql`SELECT pg_advisory_xact_lock(hashtext('agent_cloud_budget'))`.execute(tx);
      const active=(await sql`SELECT id FROM campus_scene_import_runs WHERE id=${id}::uuid AND actor_user_id=${userId}::uuid AND status='running' AND reserved_micros=0 FOR UPDATE`.execute(tx)).rows;
      if(!active.length)throw new AgentLimitError('This image analysis is no longer active.');
      const usage=(await sql<{day:number;month:number}>`SELECT
        coalesce(sum(reserved_micros) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS day,
        coalesce(sum(reserved_micros),0)::bigint AS month FROM
        (SELECT reserved_micros,created_at FROM agent_model_usage UNION ALL SELECT reserved_micros,created_at FROM campus_scene_import_runs) usage
        WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(tx)).rows[0]!;
      const counts=(await sql<{hour:number;day:number}>`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day FROM
        (SELECT run.created_at FROM agent_runs run JOIN agent_threads thread ON thread.id=run.thread_id WHERE thread.owner_id=${userId}::uuid
         UNION ALL SELECT created_at FROM campus_scene_import_runs WHERE actor_user_id=${userId}::uuid AND reserved_micros>0) usage WHERE created_at>now()-interval '24 hours'`.execute(tx)).rows[0]!;
      if(Number(usage.day)+reserve>limits.dailyMicros||Number(usage.month)+reserve>limits.monthlyMicros||counts.hour>=limits.hourly||counts.day>=limits.daily)throw new AgentLimitError();
      await sql`UPDATE campus_scene_import_runs SET input_tokens=${inputTokens},max_output_tokens=${outputTokens},reserved_micros=${reserve} WHERE id=${id}::uuid`.execute(tx);
    });
  }

  async import(user:AuthUser,school:string,campus:string,raw:unknown):Promise<{document:SceneDocument}> {
    const parsed=sceneImportSchema.safeParse(raw);
    if(!parsed.success)throw new BadRequestException('Check the campus source details and confirm your file rights.');
    const {idempotency_key,...input}=parsed.data;
    // Validate even a cached result: a retained proposal cannot revive an inactive
    // building or silently reuse a floor after its current revision changed.
    if(input.kind==='image' && input.purpose==='floor_plan')await this.floorPlanTarget(user,school,campus,input.target!);
    return this.proposal(user,school,campus,idempotency_key,input.kind,input,async()=>{
      if(input.kind==='geojson') {
        let source:unknown;
        try{source=JSON.parse(input.text);}catch{throw new BadRequestException('Choose a valid GeoJSON FeatureCollection file.');}
        return {document:sceneFromGeoJson(source,input.label,{kind:'open_map',label:input.label,attribution:input.attribution})};
      }
      if(input.kind==='location') {
        if(selectedSimulationResources()) {
          await captureSimulationProviderEffect({kind:'connector_call',provider:'campus_scene',operation:'map_import',logicalKey:idempotency_key,idempotencyKey:`campus-scene:${idempotency_key}`,payload:{provider_contacted:false,mode:'captured_or_manual'}});
          throw new ServiceUnavailableException('This Simulation has no captured geometry for that campus. Upload GeoJSON or trace a plan.');
        }
        return {document:await this.provider.location(input.location,input.radius_metres)};
      }
      const image=await this.scenes.readImage(user,school,campus,input.image_asset_id);
      if(selectedSimulationResources()) {
        await captureSimulationProviderEffect({kind:'external_compute_call',provider:'campus_scene',operation:'image_trace',logicalKey:idempotency_key,idempotencyKey:`campus-scene:${idempotency_key}`,payload:{provider_contacted:false,image_ref:image.sha256,mode:'manual_trace',size_bytes:image.bytes.length,...(input.purpose==='floor_plan'?{purpose:'floor_plan'}:{})}});
        return {document:sceneDocumentSchema.parse({schema_version:1,name:input.label,bounds:imageSceneBounds(image.width,image.height),
          source:{kind:input.source_kind,label:input.label,image_asset_id:image.id,notes:input.purpose==='floor_plan'?'Simulation floor-plan tracing source. No external image analysis was performed. Draw and review this floor; image coordinates carry no surveyed scale.':'Simulation tracing source. No external image analysis was performed. Draw and review the visible campus layout.'},elements:[]})};
      }
      const document=await this.provider.image({bytes:image.bytes,mimeType:image.mime_type,imageId:image.id,width:image.width,height:image.height,label:input.label,sourceKind:input.source_kind,instructions:input.instructions,...(input.purpose?{purpose:input.purpose}:{})},
        (tokens,output)=>this.reserve(idempotency_key,user.id,tokens,output));
      if(input.purpose==='floor_plan')await this.floorPlanTarget(user,school,campus,input.target!);
      return {document};
    });
  }
}
