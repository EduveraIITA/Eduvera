import {randomUUID} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Pool,types} from 'pg';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {DatabaseService} from '../src/database/database.service.js';
import type {Database} from '../src/database/types.js';
import {createResourceLoanFixture,resourceLoanRequest} from './resource-loans.test-support.js';
import {createAccommodationFixture} from './accommodation.test-support.js';
import {addResourceCustodian} from './resource-custody.test-support.js';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const url=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/resource_custody_unused_test';
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:4})})}) as DatabaseService;
beforeAll(()=>{process.env.INVITATION_EMAIL_ENABLED='false';});afterAll(()=>db.destroy());
const command=(revision:number)=>({command_id:randomUUID(),expected_revision:revision});
const after=(at:string)=>new Date(Date.parse(at)+86_400_000).toISOString();
const issue=(f:Awaited<ReturnType<typeof createResourceLoanFixture>>,now:string)=>({...command(0),holding_id:f.holdingId,borrower_person_id:f.borrowerPersonId,due_at:after(now),custody_confirmed:true,custody_purpose:'Fictional continuity equipment',components:[{label:'Charger',quantity:1}]});
describe.skipIf(!enabled)('Resource exact custody continuity',()=>{
 it('hands over outstanding parts and older open question work, retaining source history and safe original-signer receipts',async()=>{
  const f=await createResourceLoanFixture(db),next=await addResourceCustodian(f);
  await next.run(async()=>{
   let loan=await f.resources.issue(f.user,f.schoolId,issue(f,next.now));
   loan=await f.resources.ask(f.borrower,f.schoolId,loan.id,{...command(loan.revision),kind:'question',note:'Private question stays with the exact loan'});
   const question=loan.questions[0]!,oldWork=(await f.resources.work(f.user,f.schoolId)).needs_me[0]!;
   const camera=loan.parts.find(part=>part.kind==='item')!;
   loan=await f.resources.recordReturn(f.user,f.schoolId,loan.id,{...command(loan.revision),observed_at:next.now,parts:[{part_id:camera.id,quantity:1,condition:'usable'}]});
   const returnReceipt=loan.history[0]!,before=loan.revision;
   await expect(f.resources.changeCustodian(next.user,f.schoolId,loan.id,{...command(before),custodian_person_id:next.personId,reason:'Unrelated manager cannot seize active custody'})).rejects.toMatchObject({status:403});
   await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(before-1),custodian_person_id:next.personId,reason:'Stale handover review'})).rejects.toMatchObject({status:409});
   const input={...command(before),custodian_person_id:next.personId,reason:'Library desk responsibility passed to Farah'};
   const supersede=vi.spyOn(f.core,'supersedeDomainMessage');
   loan=await f.resources.changeCustodian(f.user,f.schoolId,loan.id,input);
   const supersession=supersede.mock.calls[0]![1];supersede.mockRestore();
   expect(loan).toMatchObject({revision:before+1,outstanding_count:1,custodian:{id:next.personId},can_record_return:false,can_change_custodian:false,questions:[]});
   expect(loan.history.find(row=>row.id===returnReceipt.id)).toMatchObject(returnReceipt);
   expect(loan.history[0]).toMatchObject({action:'custody_changed',previous_custodian:{id:f.custodianPersonId},custodian:{id:next.personId},custody_basis:'named_custodian'});
   expect(await f.resources.changeCustodian(f.user,f.schoolId,loan.id,input)).toMatchObject({revision:before+1});
   expect(await f.resources.confirmation(f.user,f.schoolId,loan.id,input.command_id)).toMatchObject({state:'accepted',result:{id:loan.id,revision:before+1}});
   expect(await f.resources.confirmation(next.user,f.schoolId,loan.id,input.command_id)).toEqual({state:'not_found'});
   await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...input,reason:'Changed retained payload'})).rejects.toMatchObject({status:409});
   const newWork=(await f.resources.work(next.user,f.schoolId)).needs_me[0]!;
   expect(newWork).toMatchObject({question_id:question.id,revision:before+1,reviewer:{user_id:next.user.id}});expect(newWork.message_id).not.toBe(oldWork.message_id);
   expect(await f.resources.work(f.user,f.schoolId)).toEqual({needs_me:[],waiting:[]});
   expect((await f.resources.work(f.borrower,f.schoolId)).waiting[0]).toMatchObject({message_id:newWork.message_id,reviewer:{user_id:next.user.id}});
   expect(await db.selectFrom('campus_model_operational_messages').select('state').where('id','=',oldWork.message_id!).executeTakeFirstOrThrow()).toEqual({state:'cancelled'});
   expect(await db.transaction().execute(tx=>f.core.supersedeDomainMessage(tx,supersession))).toMatchObject({state:'cancelled',replayed:true});
   await expect(db.transaction().execute(tx=>f.core.supersedeDomainMessage(tx,{...supersession,idempotency_key:`forged-new-effect:${randomUUID()}`}))).rejects.toThrow('freshly authorized');
   await expect(f.resources.recordReturn(f.user,f.schoolId,loan.id,{...command(loan.revision),observed_at:next.now,parts:[{part_id:loan.parts.find(part=>part.kind==='component')!.id,quantity:1,condition:'usable'}]})).rejects.toMatchObject({status:403});
   const owned=await f.resources.detail(next.user,f.schoolId,loan.id);expect(owned.questions[0]?.note).toBe(question.note);
   const closed=await f.resources.answer(next.user,f.schoolId,loan.id,question.id,{...command(owned.revision),note:'Successor reviewed this exact retained question'},true);
   expect(closed.questions[0]!.state).toBe('resolved');expect(closed.outstanding_count).toBe(1);
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
   await expect(f.resources.confirmation(f.user,f.schoolId,loan.id,input.command_id)).rejects.toMatchObject({status:403});
   await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,input)).rejects.toMatchObject({status:403});
  });
 },60_000);
 it('allows only bounded orphan recovery with an active eligible successor and never turns handover into a return',async()=>{
  const f=await createResourceLoanFixture(db),next=await addResourceCustodian(f),foreign=await createResourceLoanFixture(db);
  await next.run(async()=>{
   let loan=await f.resources.issue(f.user,f.schoolId,issue(f,next.now));
   await expect(f.resources.changeCustodian(f.borrower,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Borrower has no Resources authority'})).rejects.toMatchObject({status:403});
   await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:f.borrowerPersonId,reason:'Passive Member is not eligible'})).rejects.toThrow();
   await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:foreign.custodianPersonId,reason:'Cross campus recipient rejected'})).rejects.toThrow();
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
   expect(await f.resources.detail(next.user,f.schoolId,loan.id)).toMatchObject({can_change_custodian:true,custody_recovery:true,questions:[]});
   loan=await f.resources.changeCustodian(next.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Previous custodian left; Farah takes over handling'});
   expect(loan).toMatchObject({revision:2,outstanding_count:2,can_record_return:true});expect(loan.history[0]).toMatchObject({action:'custody_changed',custody_basis:'orphan_recovery'});
   expect(await db.selectFrom('resource_loan_receipts').select('id').where('loan_id','=',loan.id).where('action','in',['return_recorded','return_corrected']).execute()).toEqual([]);
  });
 },60_000);
 it('rejects an otherwise shaped custody receipt with no authority basis at the native constraint floor',async()=>{
  const f=await createResourceLoanFixture(db),next=await addResourceCustodian(f);
  await next.run(async()=>{
   const loan=await f.resources.issue(f.user,f.schoolId,issue(f,next.now));
   await expect(db.insertInto('resource_loan_receipts').values({id:randomUUID(),school_id:f.schoolId,loan_id:loan.id,revision:loan.revision+1,command_id:randomUUID(),action:'custody_changed',actor_person_id:next.personId,actor_user_id:next.user.id,observed_at:null,recorded_at:new Date(next.now),due_at:null,previous_due_at:null,supersedes_receipt_id:null,question_id:null,previous_custodian_person_id:next.personId,custodian_person_id:f.custodianPersonId,custody_basis:null,previous_question_message_id:null,reason:'Missing basis must fail before deferred accepted-event checks'}).execute()).rejects.toMatchObject({code:'23514',constraint:'resource_custody_basis_required'});
  });
 },60_000);
 it('rolls back a transfer if exact prior work cannot be superseded and rejects forged older/unrelated source lineage',async()=>{
  const f=await createResourceLoanFixture(db),next=await addResourceCustodian(f);
  await next.run(async()=>{
   let loan=await f.resources.issue(f.user,f.schoolId,issue(f,next.now));
   loan=await f.resources.ask(f.borrower,f.schoolId,loan.id,{...command(loan.revision),kind:'question',note:'Question requiring exact lineage'});
   const original=f.core.supersedeDomainMessage.bind(f.core);
   const spy=vi.spyOn(f.core,'supersedeDomainMessage').mockImplementation((tx,input)=>original(tx,{...input,previous_source_revision:input.previous_source_revision!+1}));
   try{await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Injected mismatched predecessor'})).rejects.toMatchObject({status:409});}finally{spy.mockRestore();}
   expect(await f.resources.detail(f.user,f.schoolId,loan.id)).toMatchObject({revision:loan.revision,custodian:{id:f.custodianPersonId}});
   const unrelated=vi.spyOn(f.core,'supersedeDomainMessage').mockImplementation((tx,input)=>original(tx,{...input,previous_event_id:randomUUID()}));
   try{await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Injected unrelated older event'})).rejects.toMatchObject({status:409});}finally{unrelated.mockRestore();}
   const future=vi.spyOn(f.core,'supersedeDomainMessage').mockImplementation((tx,input)=>original(tx,{...input,previous_source_revision:loan.revision+1}));
   try{await expect(f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Injected future source revision'})).rejects.toMatchObject({status:409});}finally{future.mockRestore();}
   expect(await db.selectFrom('resource_loan_receipts').select('id').where('loan_id','=',loan.id).where('action','=','custody_changed').execute()).toEqual([]);
   expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_operational_messages WHERE school_id=${f.schoolId}::uuid AND state IN('queued','delivered','acknowledged')`.execute(db)).rows[0]!.count).toBe(1);
  });
 },60_000);
 it('lets a successor receive the remaining temporary access item before a linked stay can close',async()=>{
  const f=await createAccommodationFixture(db),next=await addResourceCustodian(f);
  await next.run(async()=>{
   const space=await f.topology.createSpace(f.user,f.schoolId,{campus_id:f.campusId,name:'Fictional continuity room',code:`ROOM-${randomUUID().slice(0,8)}`,kind:'residential_room',is_bookable:false},resourceLoanRequest(f.user));
   const type=await f.accommodation.saveRoomType(f.user,f.schoolId,{...command(0),name:'Single continuity room',default_capacity:1,allocation_mode:'whole_room'});
   const room=await f.accommodation.saveRoom(f.user,f.schoolId,{...command(0),space_id:space.id,room_type_id:type.id,sleeping_capacity:1,allocation_mode:'whole_room'});
   let stay=await f.accommodation.offer(f.user,f.schoolId,{...command(0),resident_person_id:f.borrowerPersonId,coordinator_person_id:f.custodianPersonId,recorder_person_id:f.custodianPersonId,room_id:room.id,starts_at:next.now,ends_at:after(next.now),access_mode:'tracked_required'});
   // Preserve explicit resident response for this existing offer path.
   if('state' in stay&&stay.state==='offered')stay=await f.accommodation.act(f.borrower,f.schoolId,stay.id,{...command(stay.revision),action:'accept'});
   stay=await f.accommodation.act(f.user,f.schoolId,stay.id,{...command(stay.revision),action:'move_in',observed_at:next.now,method:'in_person'});
   let loan=await f.resources.issue(f.user,f.schoolId,issue(f,next.now));
   stay=await f.accommodation.linkAccess(f.user,f.schoolId,stay.id,{...command(stay.revision),loan_id:loan.id,return_required:true});
   stay=await f.accommodation.act(f.user,f.schoolId,stay.id,{...command(stay.revision),action:'move_out',observed_at:next.now,destination_note:'Original room'});
   const item=loan.parts.find(part=>part.kind==='item')!;loan=await f.resources.recordReturn(f.user,f.schoolId,loan.id,{...command(loan.revision),observed_at:next.now,parts:[{part_id:item.id,quantity:1,condition:'usable'}]});
   loan=await f.resources.changeCustodian(f.user,f.schoolId,loan.id,{...command(loan.revision),custodian_person_id:next.personId,reason:'Key desk successor takes remaining access custody'});
   await expect(f.accommodation.act(f.user,f.schoolId,stay.id,{...command(stay.revision),action:'close'})).rejects.toThrow('temporary access');
   const remaining=loan.parts.find(part=>part.outstanding_quantity>0)!;
   await f.resources.recordReturn(next.user,f.schoolId,loan.id,{...command(loan.revision),observed_at:next.now,parts:[{part_id:remaining.id,quantity:1,condition:'usable'}]});
   expect(await f.accommodation.act(f.user,f.schoolId,stay.id,{...command(stay.revision),action:'close'})).toMatchObject({state:'closed',access_settled:true});
  });
 },60_000);
});
