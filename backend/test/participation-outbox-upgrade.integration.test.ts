import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ownedParticipationTestServices } from './owned-participation.test-support.js';
import { simulationFunctionDefinition, type SimulationBranch } from '../src/database/simulation-branch.driver.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
types.setTypeParser(1082,value=>value);
const pool=new Pool({connectionString:enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused',max:3});
const db=new Kysely<Database>({dialect:new PostgresDialect({pool})}),applicationDb=db as DatabaseService;
afterAll(()=>db.destroy());
const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;

async function fixture(){
  const suffix=randomUUID();
  const account=await db.insertInto('users').values({username:`outbox-upgrade-${suffix}`,email:`outbox-upgrade-${suffix}@example.test`,
    password_hash:'isolated-only',first_name:'Upgrade',last_name:'Operator',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const shared=ownedParticipationTestServices(applicationDb);
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx,account,'UTC'));
  const user:AuthUser={...account,active_school_id:schoolId};
  const identity=await db.transaction().execute(tx=>shared.core.resolveAccountEndpoint(tx,{school_id:schoolId,user_id:user.id,at:new Date().toISOString()}));
  if(!identity.acting)throw new Error('Fixture founder must have a real acting campus identity.');
  const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const plan=await shared.planning.create(request(user),schoolId,{idempotency_key:randomUUID(),title:'Outbox source test',purpose:'training',
    timezone:'UTC',starts_on:day,recurrence:'once',starts_at:'09:00',ends_at:'10:00',person_ids:[identity.person_id],
    recorder_person_id:identity.person_id,reviewer_person_id:identity.person_id,attendance_mode:'roll_call'});
  await shared.planning.publish(request(user),schoolId,plan.id,{idempotency_key:randomUUID(),expected_revision:1});
  const occurrence=(await shared.planning.ensureOccurrences(schoolId,day,day)).find(item=>item.plan_version_id===plan.id)!;
  const registerId=await shared.kernel.ensureRegister(schoolId,occurrence.id);
  return {schoolId,user,occurrenceId:occurrence.id,registerId,payload:{register_id:registerId,occurrence_id:occurrence.id,refresh:['attendance','activities','workspace','today']}};
}

describe.skipIf(!enabled)('immutable participation envelopes and pre-migration outbox delivery',()=>{
  it('claims valid neighbors without relabeling or delivering a retained malformed source',async()=>{
    const f=await fixture(),events=new SchoolEventService(applicationDb);
    const validId=randomUUID(),legacyId=randomUUID();
    await sql`INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,
      available_at,notification_user_ids,notification_payload)
      VALUES(${validId}::uuid,${f.schoolId}::uuid,'attendance.participation.updated','attendance_register',${f.registerId}::uuid,
        ${[f.user.id]}::uuid[],${JSON.stringify(f.payload)}::jsonb,${`valid-upgrade-${validId}`},'2000-01-01',${[f.user.id]}::uuid[],
        ${JSON.stringify({kind:'general',title:'Valid register changed',body:'Authoritative source fixture.'})}::jsonb)`.execute(db);
    // A single historical transport-envelope fixture, not an accepted domain
    // decision. Transaction-local replica mode models data written before170;
    // the ordinary application never disables its source-integrity guard.
    await db.transaction().execute(async tx=>{
      await sql`SELECT set_config('session_replication_role','replica',true)`.execute(tx);
      await sql`INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,
        available_at,notification_user_ids,notification_payload)
        VALUES(${legacyId}::uuid,${f.schoolId}::uuid,'attendance.participation.updated','class_section',${f.registerId}::uuid,
          ${[f.user.id]}::uuid[],${JSON.stringify(f.payload)}::jsonb,${`legacy-upgrade-${legacyId}`},'1999-01-01',${[f.user.id]}::uuid[],
          ${JSON.stringify({kind:'general',title:'Must never deliver',body:'Retained malformed source fixture.'})}::jsonb)`.execute(tx);
      await sql`SELECT set_config('session_replication_role','origin',true)`.execute(tx);
    });
    const integrity=(await sql<{valid:boolean;legacy:boolean;recipient:boolean}>`SELECT
      event_source_is_valid(${f.schoolId}::uuid,'attendance.participation.updated','attendance_register',${f.registerId}::uuid,${JSON.stringify(f.payload)}::jsonb) AS valid,
      event_source_is_valid(${f.schoolId}::uuid,'attendance.participation.updated','class_section',${f.registerId}::uuid,${JSON.stringify(f.payload)}::jsonb) AS legacy,
      event_user_is_authorized(${f.schoolId}::uuid,'attendance.participation.updated',${JSON.stringify(f.payload)}::jsonb,${f.user.id}::uuid) AS recipient`.execute(db)).rows[0]!;
    expect(integrity).toEqual({valid:true,legacy:false,recipient:true});
    await sql`UPDATE event_outbox SET attempts=attempts+1,last_attempt_at=clock_timestamp(),claim_expires_at=NULL
      WHERE id=${legacyId}::uuid`.execute(db); // Old invalid source cannot poison transport bookkeeping.
    await expect(sql`UPDATE event_outbox SET aggregate_type='attendance_register' WHERE id=${legacyId}::uuid`.execute(db)).rejects.toThrow('immutable');
    await expect(sql`UPDATE event_outbox SET payload=${JSON.stringify({...f.payload,occurrence_id:randomUUID()})}::jsonb
      WHERE id=${validId}::uuid`.execute(db)).rejects.toThrow('immutable');
    await expect(sql`UPDATE event_outbox SET audience_user_ids=${[randomUUID()]}::uuid[] WHERE id=${validId}::uuid`.execute(db)).rejects.toThrow('immutable');
    await expect(sql`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
      VALUES(${f.schoolId}::uuid,'attendance.participation.updated','class_section',${f.registerId}::uuid,
        ${[f.user.id]}::uuid[],${JSON.stringify(f.payload)}::jsonb,${`malformed-new-${randomUUID()}`})`.execute(db)).rejects.toThrow('authoritative register');
    const transport=events as unknown as {claimPendingEvents(limit:number):Promise<string[]>;publishClaimedEvents(ids:string[]):Promise<number>;workerId:string};
    expect(await transport.claimPendingEvents(1)).toEqual([validId]);
    // Even a preexisting claim or replay audience is not evidence of a valid
    // source. The publication boundary independently refuses the malformed row.
    await sql`UPDATE event_outbox SET published_by=${transport.workerId},claim_expires_at=clock_timestamp()+interval '30 seconds'
      WHERE id=${legacyId}::uuid`.execute(db);
    expect(await transport.publishClaimedEvents([validId,legacyId])).toBe(1);
    const state=(await sql<{id:string;published:boolean;notifications:number}>`SELECT id,(published_at IS NOT NULL) AS published,
      (SELECT count(*)::int FROM notifications WHERE dedupe_key='event:'||event_outbox.id::text) AS notifications
      FROM event_outbox WHERE id=ANY(${[validId,legacyId]}::uuid[]) ORDER BY id`.execute(db)).rows;
    expect(state.find(row=>row.id===validId)).toEqual({id:validId,published:true,notifications:1});
    expect(state.find(row=>row.id===legacyId)).toEqual({id:legacyId,published:false,notifications:0});
    await sql`UPDATE event_outbox SET dead_lettered_at=clock_timestamp(),claim_expires_at=NULL,
      last_error='Retained participation source fixture quarantined without changing its envelope.' WHERE id=${legacyId}::uuid`.execute(db);
  },60000);

  it('binds source integrity to the selected store and rejects a foreign institution rather than borrowing Live',async()=>{
    const f=await fixture(),client=await pool.connect(),schema=`dt_event_source_test_${randomUUID().replaceAll('-','')}`;
    try{
      await client.query('BEGIN');await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".activity_attendance_registers AS SELECT * FROM public.activity_attendance_registers WHERE id=$1`,[f.registerId]);
      // The current public entry point delegates to the retained participation
      // predicate. Bind both functions as real branches do; copying only the
      // wrapper would test its fallback to the untouched public dependency.
      const retained=(await client.query<{definition:string}>("SELECT pg_get_functiondef('public.event_source_is_valid_before_teaching_sessions'::regproc) AS definition")).rows[0]!.definition;
      await client.query(simulationFunctionDefinition(retained,{schema_name:schema} as SimulationBranch));
      const source=(await client.query<{definition:string}>("SELECT pg_get_functiondef('public.event_source_is_valid'::regproc) AS definition")).rows[0]!.definition;
      await client.query(simulationFunctionDefinition(source,{schema_name:schema} as SimulationBranch));
      const valid=async(school=f.schoolId)=>(await client.query<{valid:boolean}>(`SELECT "${schema}".event_source_is_valid($1,'attendance.participation.updated','attendance_register',$2,$3::jsonb) AS valid`,
        [school,f.registerId,JSON.stringify(f.payload)])).rows[0]!.valid;
      expect(await valid()).toBe(true);expect(await valid(randomUUID())).toBe(false);
      await client.query(`DELETE FROM "${schema}".activity_attendance_registers WHERE id=$1`,[f.registerId]);
      expect(await valid()).toBe(false);
      expect((await client.query<{valid:boolean}>("SELECT public.event_source_is_valid($1,'attendance.participation.updated','attendance_register',$2,$3::jsonb) AS valid",
        [f.schoolId,f.registerId,JSON.stringify(f.payload)])).rows[0]!.valid).toBe(true);
    }finally{await client.query('ROLLBACK');client.release();}
  },60000);
});
