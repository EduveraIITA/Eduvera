import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely,PostgresDialect,sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createFacilitiesFixture } from './facilities.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { academicScaffoldingCounts } from './learning-offerings.test-support.js';
const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const url=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/facilities_unused_test';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:4})})}) as DatabaseService;
let directory:string|undefined;
beforeAll(async()=>{if(!enabled)return;process.env.INVITATION_EMAIL_ENABLED='false';directory=await mkdtemp(join(tmpdir(),'thatcampus-facilities-native-'));process.env.UPLOAD_DIR=directory;});
afterAll(async()=>{await db.destroy();if(directory)await rm(directory,{recursive:true,force:true});});
type Fixture=Awaited<ReturnType<typeof createFacilitiesFixture>>;
const command=(revision:number)=>({command_id:randomUUID(),expected_revision:revision});
const setup=(f:Fixture,extra:Record<string,unknown>={})=>f.facilities.saveSettings(f.user,f.schoolId,{...command(0),handler_person_id:f.custodianPersonId,verifier_mode:'reporter',...extra});
const report=(f:Fixture,extra:Record<string,unknown>={})=>({...command(0),problem:'Fictional water leak by window',location_note:'Fictional hostel room seventeen',...extra});
const act=(f:Fixture,id:string,revision:number,action:string,extra:Record<string,unknown>={})=>f.facilities.act(f.user,f.schoolId,id,{...command(revision),action,...extra});
describe.skipIf(!enabled)('Facilities native DT repairs',()=>{
 it('starts with one explicit handler and canonical People without academic scaffolding, with exact retry and command outcomes',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   expect(await f.facilities.settings(f.user,f.schoolId)).toMatchObject({configured:false,revision:0});
   await expect(f.facilities.report(f.borrower,f.schoolId,report(f))).rejects.toThrow('responsible repair handler');
   const settingsInput={...command(0),handler_person_id:f.custodianPersonId,verifier_mode:'reporter'};
   expect(await f.facilities.saveSettings(f.user,f.schoolId,settingsInput)).toMatchObject({configured:true,revision:1});
   expect(await f.facilities.saveSettings(f.user,f.schoolId,settingsInput)).toMatchObject({revision:1});
   expect(await f.facilities.confirmation(f.user,f.schoolId,f.schoolId,settingsInput.command_id,true)).toMatchObject({state:'accepted',result:{revision:1}});
   const input=report(f),repair=await f.facilities.report(f.borrower,f.schoolId,input);
   expect(repair).toMatchObject({id:input.command_id,state:'reported',revision:1,reporter:{id:f.borrowerPersonId},recorder:{id:f.borrowerPersonId},handler:{id:f.custodianPersonId},verifier:{id:f.borrowerPersonId}});
   expect(repair.latest_progress).toBeNull();
   expect(await f.facilities.report(f.borrower,f.schoolId,input)).toMatchObject({id:repair.id,revision:1});
   await expect(f.facilities.report(f.borrower,f.schoolId,{...input,problem:'Changed commitment'})).rejects.toThrow('different repair work');
   expect(await f.facilities.confirmation(f.borrower,f.schoolId,repair.id,input.command_id)).toMatchObject({state:'accepted',result:{id:repair.id,revision:1}});
   expect(await academicScaffoldingCounts(db,f.schoolId)).toEqual({students:0,staff:0,classes:0,terms:0,enrollments:0,guardians:0,roles:0,schedules:0});
   const incoming=await f.facilities.work(f.user,f.schoolId),waiting=await f.facilities.work(f.borrower,f.schoolId);
   expect(incoming.needs_me).toMatchObject([{repair_id:repair.id,action:'accept',href:`/areas/facilities?repair_id=${repair.id}`,due_at:null}]);
   expect(waiting.waiting[0]?.message_id).toBe(incoming.needs_me[0]?.message_id);
   const native=await db.selectFrom('facilities_repair_receipts').selectAll().where('repair_id','=',repair.id).executeTakeFirstOrThrow();
   expect(await db.selectFrom('campus_model_commands').select(['state','command_type','expected_revision']).where('id','=',native.command_id).executeTakeFirstOrThrow()).toEqual({state:'accepted',command_type:'facilities.reported',expected_revision:0});
  });
 },60_000);
 it('preserves accepted work, concrete delays, estimates, worker completion, failed verification and checked closure as different facts',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let repair=await f.facilities.report(f.borrower,f.schoolId,report(f,{holding_id:f.holdingId,urgent:true}));
   await expect(f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(1),action:'accept'})).rejects.toThrow('exact responsible');
   await expect(act(f,repair.id,1,'complete',{note:'Work done without acceptance'})).rejects.toThrow('Accept the repair');
   repair=await act(f,repair.id,1,'accept');expect(repair).toMatchObject({state:'accepted',revision:2});
   const estimate=new Date(Date.parse(f.now)+86_400_000).toISOString(),delay={...command(2),action:'update',status:'waiting',wait_reason:'parts',expected_finish_at:estimate,note:'Seal replacement ordered; delivery expected tomorrow.'};
   repair=await f.facilities.act(f.user,f.schoolId,repair.id,delay);expect(repair).toMatchObject({state:'waiting',wait_reason:'parts',expected_finish_at:estimate,revision:3});
   expect(repair.latest_progress).toMatchObject({action:'updated',revision:3,note:delay.note,wait_reason:'parts',expected_finish_at:estimate,actor_label:'Resource Custodian'});
   expect(await f.facilities.act(f.user,f.schoolId,repair.id,delay)).toMatchObject({revision:3});
   expect((await f.facilities.work(f.borrower,f.schoolId)).waiting[0]?.due_at).toBeNull();
   await expect(act(f,repair.id,2,'update',{status:'in_progress',note:'Stale update'})).rejects.toMatchObject({response:{code:'facilities_obsolete'}});
   repair=await act(f,repair.id,3,'update',{status:'in_progress',note:'Replacement fitted; checking water flow.'});
   repair=await act(f,repair.id,4,'complete',{note:'Plumber reports the seal replaced; resident should check.'});expect(repair).toMatchObject({state:'awaiting_verification',revision:5});
   expect((await f.facilities.detail(f.borrower,f.schoolId,repair.id)).latest_progress).toMatchObject({action:'completed',revision:5,note:'Plumber reports the seal replaced; resident should check.'});
   expect((await f.facilities.work(f.borrower,f.schoolId)).needs_me).toMatchObject([{repair_id:repair.id,action:'verify'}]);
   await expect(act(f,repair.id,5,'verify')).rejects.toThrow('exact responsible');
   repair=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(5),action:'reopen',note:'Water is still dripping near the window.'});expect(repair).toMatchObject({state:'reported',revision:6});
   expect(repair.latest_progress).toMatchObject({action:'reopened',revision:6,note:'Water is still dripping near the window.',actor_label:'Sana Borrower'});
   repair=await act(f,repair.id,6,'accept');repair=await act(f,repair.id,7,'complete',{note:'Second seal replaced; tested under running water.'});
   repair=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(8),action:'verify',note:'Checked the window; no water is dripping.'});expect(repair).toMatchObject({state:'closed',revision:9});
   expect(await f.facilities.work(f.user,f.schoolId)).toEqual({needs_me:[],waiting:[]});
   expect(await f.facilities.work(f.borrower,f.schoolId)).toEqual({needs_me:[],waiting:[]});
   expect(repair.history.map(item=>item.action)).toEqual(['verified','completed','accepted','reopened','completed','updated','updated','accepted','reported']);
   const holding=await db.selectFrom('campus_resource_holdings').select(['state','revision']).where('id','=',f.holdingId).executeTakeFirstOrThrow();expect(holding.state).toBe('available');
   const events=await db.selectFrom('event_outbox').select('payload').where('school_id','=',f.schoolId).where('event_type','=','facilities.updated').execute();expect(JSON.stringify(events)).not.toContain('window');
  });
 },60_000);
 it('supports a passive reporter through assisted intake and named custodian verification without inventing app acceptance',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   const person=await f.people.create({authUser:f.user,requestId:randomUUID(),headers:{},ip:'127.0.0.1'} as never,f.schoolId,{first_name:'Passive Resident',last_name:'',idempotency_key:randomUUID()});
   await setup(f,{verifier_mode:'handler'});
   const repair=await f.facilities.report(f.user,f.schoolId,report(f,{reporter_person_id:person.id}));
   expect(repair).toMatchObject({reporter:{id:person.id},recorder:{id:f.custodianPersonId},verifier:{id:f.custodianPersonId},state:'reported'});
   expect(await db.selectFrom('users').select('id').where('first_name','=','Passive Resident').execute()).toEqual([]);
   await expect(f.facilities.report(f.borrower,f.schoolId,report(f,{reporter_person_id:person.id}))).rejects.toThrow();
   await f.facilities.saveSettings(f.user,f.schoolId,{...command(1),handler_person_id:f.custodianPersonId,verifier_mode:'reporter'});
   let passive=await f.facilities.report(f.user,f.schoolId,report(f,{reporter_person_id:person.id}));
   expect(passive).toMatchObject({state:'reported',verification_route_unavailable:true,verifier:{id:person.id}});
   passive=await act(f,passive.id,passive.revision,'accept');passive=await act(f,passive.id,passive.revision,'complete',{note:'Caretaker reports repair completed; verification remains separate.'});
   expect(passive).toMatchObject({state:'awaiting_verification',route_unavailable:true,allowed_actions:{verify:false,assign_verifier:true}});
   passive=await act(f,passive.id,passive.revision,'assign',{verifier_person_id:f.custodianPersonId,note:'Campus custodian will inspect for the passive resident.'});
   expect(passive).toMatchObject({state:'awaiting_verification',route_unavailable:false});expect(passive.history[0]).toMatchObject({assignment_target:'verifier',previous_verifier_label:'Passive Resident',verifier_label:'Resource Custodian'});
   expect(await act(f,passive.id,passive.revision,'verify')).toMatchObject({state:'closed'});
   expect((await f.facilities.detail(f.user,f.schoolId,repair.id)).verifier.id).toBe(f.custodianPersonId);
  });
 },60_000);
 it('delegates only one repair to a normally accepted member and retains safe transfer confirmation without institution-wide authority',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let repair=await f.facilities.report(f.borrower,f.schoolId,report(f));const transfer={...command(1),action:'assign',handler_person_id:f.borrowerPersonId,note:'Named technician will handle this exact leak.'};
   repair=await f.facilities.act(f.user,f.schoolId,repair.id,transfer);
   expect(repair).toMatchObject({state:'reported',revision:2,handler:{id:f.borrowerPersonId}});
   expect(await f.facilities.confirmation(f.user,f.schoolId,repair.id,transfer.command_id)).toMatchObject({state:'accepted',result:{id:repair.id,revision:2}});
   const memberView=await f.facilities.detail(f.borrower,f.schoolId,repair.id);expect(memberView.allowed_actions).toMatchObject({accept:true,assign:false,assign_verifier:false});
   await expect(f.facilities.saveSettings(f.borrower,f.schoolId,{...command(1),handler_person_id:f.borrowerPersonId,verifier_mode:'handler'})).rejects.toThrow();
   repair=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(2),action:'accept'});expect(repair).toMatchObject({state:'accepted',revision:3});
   const native=await db.selectFrom('facilities_repair_receipts').select('command_id').where('repair_id','=',repair.id).where('revision','=',3).executeTakeFirstOrThrow();
   const receipt=(await sql<{capability:string}>`SELECT authority.capability FROM campus_model_commands command JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id WHERE command.id=${native.command_id}::uuid`.execute(db)).rows[0];expect(receipt).toEqual({capability:'facilities.handle'});
   expect((await f.facilities.workspace(f.borrower,f.schoolId,{view:'all'})).repairs).toHaveLength(1);
  });
 },60_000);
 it('offers minimal orphan recovery but never grants broad managers private healthy repair details or photos',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f,{verifier_mode:'handler'});let repair=await f.facilities.report(f.user,f.schoolId,report(f,{problem:'Private fictional room defect'}));
   repair=await act(f,repair.id,1,'accept');repair=await act(f,repair.id,2,'update',{status:'in_progress',note:'Private fictional repair explanation for participants only.'});
   // Synthetic fixture explicitly changes membership authority; no repair role is inferred.
   await db.updateTable('school_memberships').set({role:'admin'}).where('school_id','=',f.schoolId).where('user_id','=',f.borrower.id).execute();
   await expect(f.facilities.detail(f.borrower,f.schoolId,repair.id)).rejects.toThrow('exact participants');
   expect((await f.facilities.workspace(f.borrower,f.schoolId,{view:'all'})).repairs).toEqual([]);
   expect(await f.facilities.work(f.borrower,f.schoolId)).toEqual({needs_me:[],waiting:[]});
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
   const recovery=await f.facilities.detail(f.borrower,f.schoolId,repair.id);expect(recovery).toMatchObject({recovery_only:true,latest_progress:null,history:[],photos:[],place:null,location_note:'',allowed_actions:{assign:true}});expect(JSON.stringify(recovery)).not.toContain('Private fictional');
   expect((await f.facilities.work(f.borrower,f.schoolId)).needs_me).toMatchObject([{repair_id:repair.id,action:'recover'}]);
   expect((await f.facilities.workspace(f.borrower,f.schoolId,{view:'all',search:'Private fictional'})).repairs).toEqual([]);
   const recovered=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(3),action:'assign',handler_person_id:f.borrowerPersonId,note:'Previous handler left; explicitly taking responsibility.'});expect(recovered).toMatchObject({state:'reported',revision:4,recovery_only:false});
   await expect(f.facilities.act(f.user,f.schoolId,repair.id,{...command(4),action:'accept'})).rejects.toThrow();
   const accepted=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(4),action:'accept'});expect(accepted.revision).toBe(5);
  });
 },60_000);
 it('retains the accountable coordinator after worker delegation and supports exact nonmanager coordination without widening campus access',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let repair=await f.facilities.report(f.borrower,f.schoolId,report(f));
   repair=await act(f,repair.id,1,'assign',{handler_person_id:f.borrowerPersonId,note:'Named member will repair this one problem.'});
   expect(repair).toMatchObject({coordinator:{id:f.custodianPersonId},handler:{id:f.borrowerPersonId},allowed_actions:{assign:true,accept:false}});
   expect((await f.facilities.work(f.user,f.schoolId)).waiting).toMatchObject([{repair_id:repair.id,owner:{user_id:f.borrower.id}}]);
   repair=await act(f,repair.id,2,'assign',{coordinator_person_id:f.borrowerPersonId,note:'Handing this repair coordination to the named member.'});
   expect(repair).toMatchObject({access_transferred:true,history:[],photos:[]});
   const transfer=await f.facilities.detail(f.borrower,f.schoolId,repair.id);expect(transfer.history[0]).toMatchObject({assignment_target:'coordinator',previous_coordinator_label:'Resource Custodian',coordinator_label:'Sana Borrower'});
   expect((await f.facilities.options(f.borrower,f.schoolId,{})).people).toEqual([]);
   expect((await f.facilities.options(f.borrower,f.schoolId,{repair_id:repair.id})).people.length).toBeGreaterThan(0);
   await expect(f.facilities.saveSettings(f.borrower,f.schoolId,{...command(1),handler_person_id:f.borrowerPersonId,verifier_mode:'handler'})).rejects.toThrow();
   repair=await f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(3),action:'assign',handler_person_id:f.custodianPersonId,note:'Coordinator explicitly assigns another exact worker.'});
   expect(repair).toMatchObject({handler:{id:f.custodianPersonId},coordinator:{id:f.borrowerPersonId},allowed_actions:{assign:true,accept:false}});
   const native=await db.selectFrom('facilities_repair_receipts').select('command_id').where('repair_id','=',repair.id).where('revision','=',4).executeTakeFirstOrThrow();
   expect((await sql<{capability:string}>`SELECT authority.capability FROM campus_model_commands command JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id WHERE command.id=${native.command_id}::uuid`.execute(db)).rows[0]).toEqual({capability:'facilities.coordinate'});
   expect((await f.facilities.detail(f.user,f.schoolId,repair.id)).allowed_actions).toMatchObject({assign:false,accept:true});
  });
 },60_000);
 it('recovers a revoked coordinator explicitly even while the assigned worker remains active',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let repair=await f.facilities.report(f.user,f.schoolId,report(f));
   repair=await act(f,repair.id,1,'assign',{coordinator_person_id:f.borrowerPersonId,note:'Explicit coordinator handover before leave.'});
   expect(repair.coordinator.id).toBe(f.borrowerPersonId);
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.borrower.id).execute();
   const orphan=await f.facilities.detail(f.user,f.schoolId,repair.id);expect(orphan).toMatchObject({coordinator_unavailable:true,route_unavailable:false,allowed_actions:{assign_coordinator:true,accept:true}});
   const recovered=await act(f,repair.id,2,'assign',{coordinator_person_id:f.custodianPersonId,note:'Authorized recovery after previous coordinator app access ended.'});
   expect(recovered).toMatchObject({coordinator:{id:f.custodianPersonId},state:'reported',revision:3,coordinator_unavailable:false});
   await expect(f.facilities.act(f.borrower,f.schoolId,repair.id,{...command(3),action:'assign',handler_person_id:f.borrowerPersonId,note:'Revoked coordinator cannot assign'})).rejects.toThrow();
   const completion=await act(f,repair.id,3,'accept');const pending=await act(f,repair.id,completion.revision,'complete',{note:'Repair performed; actual verifier checks next.'});const closed=await act(f,repair.id,pending.revision,'verify');
   expect(closed.state).toBe('closed');
   const active=(await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_agent_authorities authority JOIN campus_model_coordination_configurations configuration ON configuration.id::text=authority.grant_reference_id AND configuration.school_id=authority.school_id WHERE authority.school_id=${f.schoolId}::uuid AND authority.revoked_at IS NULL AND configuration.source_domain='facilities' AND configuration.source_record_id=${repair.id}`.execute(db)).rows[0]!.count;expect(active).toBe(0);
  });
 },60_000);
 it('pages native lists/history while retaining complete Work and batches repeated handler resolution',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let first='';for(let index=0;index<12;index++){const repair=await f.facilities.report(f.borrower,f.schoolId,report(f,{problem:`Fictional repeated fixture ${String(index).padStart(2,'0')}`}));first ||= repair.id;}
   const one=await f.facilities.workspace(f.borrower,f.schoolId,{page:1}),two=await f.facilities.workspace(f.borrower,f.schoolId,{page:2});expect(one.pagination).toEqual({page:1,page_size:10,total:12});expect(one.repairs).toHaveLength(10);expect(two.repairs).toHaveLength(2);
   const identities=vi.spyOn(f.facilities.access.identities,'resolvePersonAgent');expect((await f.facilities.work(f.user,f.schoolId)).needs_me).toHaveLength(12);expect(identities).toHaveBeenCalledTimes(1);identities.mockRestore();
   let repair=await act(f,first,1,'accept');for(let index=0;index<11;index++)repair=await act(f,first,repair.revision,'update',{status:'in_progress',note:`Fictional visit progress ${index}`});
   const initial=await f.facilities.detail(f.user,f.schoolId,first),older=await f.facilities.detail(f.user,f.schoolId,first,{history_page:2});expect(initial.history).toHaveLength(10);expect(initial.history_pagination.total).toBe(13);expect(initial.history_has_more).toBe(true);expect(older.history).toHaveLength(3);expect(older.history.at(-1)?.action).toBe('reported');
   expect(initial.latest_progress).toMatchObject({revision:13,action:'updated',note:'Fictional visit progress 10'});expect(older.latest_progress).toEqual(initial.latest_progress);
   const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7Z0AAAAASUVORK5CYII=','base64');
   const withPhoto=await f.facilities.addPhoto(f.borrower,f.schoolId,first,command(13),{filename:'synthetic-check.png',mimetype:'image/png',data:image});
   expect(withPhoto).toMatchObject({revision:14,latest_progress:initial.latest_progress});
  });
 },60_000);
 it('reissues the same restored handler only by an explicit assignment, never by a photo or healthy no-op',async()=>{
  const f=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);let repair=await f.facilities.report(f.borrower,f.schoolId,report(f));
   await expect(act(f,repair.id,1,'assign',{handler_person_id:f.custodianPersonId,note:'Healthy same person is not a new assignment.'})).rejects.toThrow('different responsible person');
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
   const data=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('Fictional recovery photo')]);
   repair=await f.facilities.addPhoto(f.borrower,f.schoolId,repair.id,command(1),{filename:'waiting.png',mimetype:'image/png',data});
   expect(repair).toMatchObject({state:'reported',revision:2,route_unavailable:true});
   await db.updateTable('school_memberships').set({is_active:true}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
   expect(await f.facilities.detail(f.user,f.schoolId,repair.id)).toMatchObject({revision:2,route_unavailable:true,allowed_actions:{accept:false}});
   repair=await f.facilities.addPhoto(f.borrower,f.schoolId,repair.id,command(2),{filename:'still-waiting.png',mimetype:'image/png',data});
   expect(repair).toMatchObject({revision:3,route_unavailable:true,allowed_actions:{accept:false}});
   const reissue={...command(3),action:'assign',handler_person_id:f.custodianPersonId,note:'Explicitly reissuing the same handler after access was restored.'};
   repair=await f.facilities.act(f.user,f.schoolId,repair.id,reissue);expect(repair).toMatchObject({revision:4,state:'reported',route_unavailable:false,allowed_actions:{accept:true}});
   expect(await f.facilities.act(f.user,f.schoolId,repair.id,reissue)).toMatchObject({revision:4});
   await expect(act(f,repair.id,4,'assign',{handler_person_id:f.custodianPersonId,note:'A healthy route remains a rejected no-op.'})).rejects.toThrow('different responsible person');
   expect((await f.facilities.work(f.user,f.schoolId)).needs_me).toMatchObject([{repair_id:repair.id,action:'accept'}]);
  });
 },60_000);
 it('protects private photos, immutable metadata and exact retries without leaking private source into shared events',async()=>{
  const f=await createFacilitiesFixture(db),foreign=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);const repair=await f.facilities.report(f.borrower,f.schoolId,report(f)),key=command(1),data=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('Fictional image evidence')]);
   const updated=await f.facilities.addPhoto(f.borrower,f.schoolId,repair.id,key,{filename:'../private-leak.png',mimetype:'image/png',data});expect(updated).toMatchObject({revision:2,photos:[{id:key.command_id,file_name:'private-leak.png'}]});
   expect(await f.facilities.addPhoto(f.borrower,f.schoolId,repair.id,key,{filename:'../private-leak.png',mimetype:'image/png',data})).toMatchObject({revision:2});
   const file=await f.facilities.photo(f.user,f.schoolId,repair.id,key.command_id),parts=[];for await(const part of file.stream)parts.push(Buffer.from(part));expect(Buffer.concat(parts)).toEqual(data);
   await expect(f.facilities.photo({...foreign.user,active_school_id:f.schoolId},f.schoolId,repair.id,key.command_id)).rejects.toThrow();
   await expect(f.facilities.addPhoto(f.borrower,f.schoolId,repair.id,command(2),{filename:'bad.png',mimetype:'image/png',data:Buffer.from('not-image')})).rejects.toThrow('matching file contents');
   await expect(db.updateTable('facilities_repair_photos').set({file_name:'replace.png'}).where('id','=',key.command_id).execute()).rejects.toThrow('append-only');
   expect((await f.facilities.work(f.user,f.schoolId)).needs_me).toHaveLength(1);
   const envelopes=await db.selectFrom('event_outbox').select('payload').where('school_id','=',f.schoolId).where('event_type','=','facilities.updated').execute();expect(JSON.stringify(envelopes)).not.toContain('private-leak');
  });
 },60_000);
 it('rolls native/Core/outbox state back together and rejects forged orphan advances or cross-campus references',async()=>{
  const f=await createFacilitiesFixture(db),foreign=await createFacilitiesFixture(db);await f.run(async()=>{
   await setup(f);const failed=report(f),finish=vi.spyOn(f.model,'finish').mockRejectedValueOnce(new Error('Injected repair journal failure'));
   await expect(f.facilities.report(f.borrower,f.schoolId,failed)).rejects.toThrow('Injected repair journal failure');finish.mockRestore();
   expect(await db.selectFrom('facilities_repairs').select('id').where('id','=',failed.command_id).execute()).toEqual([]);
   const repair=await f.facilities.report(f.borrower,f.schoolId,report(f));
   await expect(db.updateTable('facilities_repair_receipts').set({note:'Erase old evidence'}).where('repair_id','=',repair.id).execute()).rejects.toThrow('append-only');
   await expect(db.updateTable('facilities_repairs').set({revision:2,state:'closed'}).where('id','=',repair.id).execute()).rejects.toThrow('exact immutable native');
   await expect(f.facilities.report(f.borrower,f.schoolId,report(f,{holding_id:foreign.holdingId}))).rejects.toThrow('current resource');
   const receipt=await db.selectFrom('facilities_repair_receipts').selectAll().where('repair_id','=',repair.id).executeTakeFirstOrThrow();
   await expect(db.insertInto('event_outbox').values({school_id:f.schoolId,event_type:'facilities.updated',aggregate_type:'facility_repair',aggregate_id:repair.id,audience_user_ids:[f.borrower.id],payload:{repair_id:repair.id,revision:1,action:'reported',source_command_id:receipt.command_id,refresh:['facilities','workspace','attention'],private_note:'forged'},idempotency_key:randomUUID()}).execute()).rejects.toThrow();
   const count=(await sql<{count:number}>`SELECT count(*)::int AS count FROM facilities_repairs WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count;expect(count).toBe(1);
  });
 },60_000);
});
