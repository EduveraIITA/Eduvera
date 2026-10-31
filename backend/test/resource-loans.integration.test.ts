import { randomUUID } from 'node:crypto';
import { acceptWithRecipientProof } from "./invitation-recipient-proof.test-support.js";
import { Kysely,PostgresDialect,sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { readResourceLoansReadiness } from '../src/resource-loans/resource-loan-readiness.js';
import { StaffOperationsService } from '../src/staff-operations/staff-operations.service.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import { academicScaffoldingCounts } from './learning-offerings.test-support.js';
import { createResourceLoanFixture,resourceLoanRequest } from './resource-loans.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const url=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/resource_loans_unused_test';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:5})})}) as DatabaseService;
beforeAll(()=>{process.env.INVITATION_EMAIL_ENABLED='false';});
afterAll(()=>db.destroy());
type Fixture=Awaited<ReturnType<typeof createResourceLoanFixture>>;
const issueInput=(f:Fixture,extra:Record<string,unknown>={})=>({command_id:randomUUID(),expected_revision:0,holding_id:f.holdingId,borrower_person_id:f.borrowerPersonId,
 due_at:new Date(Date.parse(f.now)+86_400_000).toISOString(),custody_confirmed:true,custody_purpose:'Fictional project equipment',...extra});
const command=(revision:number)=>({command_id:randomUUID(),expected_revision:revision});
const receive=(f:Fixture,revision:number,parts:Array<{part_id:string;quantity:number;condition:string}>,extra:Record<string,unknown>={})=>({...command(revision),observed_at:f.now,parts,...extra});
const at=<T>(f:Fixture,now:string,fn:()=>Promise<T>)=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}}),fn);

describe.skipIf(!enabled)('Resources exact physical custody owner',()=>{
 it('starts from canonical People and topology alone, retains exact commands, and never invents a second catalogue',async()=>{
  const f=await createResourceLoanFixture(db),input=issueInput(f,{components:[{label:'Charger',quantity:1}]}),loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,input));
  expect(loan).toMatchObject({id:input.command_id,revision:1,outstanding_count:2,state:'outstanding',holding_id:f.holdingId});
  expect(await academicScaffoldingCounts(db,f.schoolId)).toEqual({students:0,staff:0,classes:0,terms:0,enrollments:0,guardians:0,roles:0,schedules:0});
  expect(await f.run(()=>f.resources.issue(f.user,f.schoolId,input))).toMatchObject({id:loan.id,revision:1});
  await expect(f.run(()=>f.resources.issue(f.user,f.schoolId,{...input,custody_purpose:'Changed command payload'}))).rejects.toThrow('different resource work');
  expect(await f.run(()=>f.resources.confirmation(f.user,f.schoolId,loan.id,input.command_id))).toMatchObject({state:'accepted',result:{id:loan.id,revision:1}});
  const missing=randomUUID();expect(await f.run(()=>f.resources.confirmation(f.user,f.schoolId,missing,missing))).toEqual({state:'not_found'});
  await expect(f.run(()=>f.resources.confirmation(f.user,f.schoolId,randomUUID(),input.command_id))).rejects.toThrow();
  expect((await f.run(()=>f.resources.options(f.user,f.schoolId,{holding_id:f.holdingId}))).holdings.find(item=>item.id===f.holdingId)).toMatchObject({available:false,active_loan_id:loan.id});
  const existingItem=await db.selectFrom('campus_resource_holdings').select(['name','asset_tag']).where('id','=',f.holdingId).executeTakeFirstOrThrow();
  await expect(f.run(()=>f.resources.createItem(f.user,f.schoolId,{command_id:randomUUID(),campus_id:f.campusId,name:existingItem.name,asset_tag:existingItem.asset_tag!},resourceLoanRequest(f.user)))).rejects.toMatchObject({status:422});
  expect((await db.selectFrom('resource_loan_receipts').selectAll().where('loan_id','=',loan.id).execute())).toHaveLength(1);
  const native=await db.selectFrom('resource_loan_receipts').selectAll().where('loan_id','=',loan.id).executeTakeFirstOrThrow();
  expect(native.command_id).not.toBe(input.command_id);
  expect(await db.selectFrom('campus_model_commands').select(['state','command_type','expected_revision']).where('id','=',native.command_id).executeTakeFirstOrThrow()).toEqual({state:'accepted',command_type:'resource_loans.issue',expected_revision:0});
  expect(await f.run(()=>f.resources.workspace(f.user,f.schoolId,{search:'Sana Borrower'}))).toMatchObject({loans:[{id:loan.id}]});
 },60_000);

 it('keeps a whole kit unavailable on partial or damaged receipt and appends exact corrections without rewriting evidence',async()=>{
  const f=await createResourceLoanFixture(db);let loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f,{components:[{label:'Charger',quantity:1}]})));
  const main=loan.parts.find(part=>part.kind==='item')!,charger=loan.parts.find(part=>part.kind==='component')!;
  const first=receive(f,loan.revision,[{part_id:main.id,quantity:1,condition:'usable'}]);
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,first));
  expect(loan).toMatchObject({revision:2,outstanding_count:1,state:'outstanding'});
  expect(await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,first))).toMatchObject({revision:2});
  await expect(f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:main.id,quantity:1,condition:'usable'}])))).rejects.toThrow('exceed');
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:charger.id,quantity:1,condition:'damaged'}])));
  expect(loan).toMatchObject({outstanding_count:0,state:'held'});
  const damaged=loan.history.find(receipt=>receipt.action==='return_recorded'&&receipt.parts.some(part=>part.part_id===charger.id))!;
  expect((await f.run(()=>f.resources.options(f.user,f.schoolId))).holdings[0]).toMatchObject({available:false});
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:charger.id,quantity:1,condition:'usable'}],{correction:true,supersedes_receipt_id:damaged.id,reason:'Inspected charger was recorded against wrong condition'})));
  expect(loan).toMatchObject({outstanding_count:0,state:'returned'});
  expect(loan.history.find(receipt=>receipt.id===damaged.id)?.parts[0]?.condition).toBe('damaged');
  expect(loan.history[0]).toMatchObject({action:'return_corrected',supersedes_receipt_id:damaged.id});
  expect((await f.run(()=>f.resources.options(f.user,f.schoolId))).holdings[0]).toMatchObject({available:true});
 },60_000);

 it('can withdraw an entire mistaken full receipt, but cannot reopen custody after another issue',async()=>{
  const f=await createResourceLoanFixture(db);let loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  const part=loan.parts[0]!;
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:part.id,quantity:1,condition:'usable'}])));
  const full=loan.history[0]!;
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[],{correction:true,supersedes_receipt_id:full.id,reason:'A different camera was returned'})));
  expect(loan).toMatchObject({outstanding_count:1,state:'outstanding'});
  loan=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:part.id,quantity:1,condition:'usable'}])));
  const latest=loan.history[0]!,stableRevision=loan.revision;
  const next=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  await expect(f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[],{correction:true,supersedes_receipt_id:latest.id,reason:'Historical wrong receipt discovered after reissue'})))).rejects.toThrow('issued again');
  expect(await f.run(()=>f.resources.detail(f.user,f.schoolId,loan.id))).toMatchObject({revision:stableRevision,outstanding_count:0});
  expect(await f.run(()=>f.resources.detail(f.user,f.schoolId,next.id))).toMatchObject({revision:1,outstanding_count:1});
 },60_000);

 it('keeps reported physical times, due-date history, private claims, current work and explicit resolution separate',async()=>{
  const f=await createResourceLoanFixture(db);let loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  const after=new Date(Date.parse(f.now)+3_600_000).toISOString(),note='Fictional private explanation: returned book earlier';
  const dueCommand={...command(loan.revision),due_at:new Date(Date.parse(f.now)+172_800_000).toISOString(),reason:'Agreed additional project day'};
  loan=await at(f,after,()=>f.resources.changeDue(f.user,f.schoolId,loan.id,dueCommand));
  expect(loan.history[0]).toMatchObject({action:'due_changed',previous_due_at:new Date(Date.parse(f.now)+86_400_000).toISOString(),due_at:dueCommand.due_at,recorded_at:after});
  loan=await at(f,after,()=>f.resources.ask(f.borrower,f.schoolId,loan.id,{...command(loan.revision),kind:'returned_claim',claimed_return_at:f.now,note}));
  const question=loan.questions[0]!;expect(question).toMatchObject({claimed_return_at:f.now,state:'open',note});expect(loan.outstanding_count).toBe(1);
  const incoming=await at(f,after,()=>f.resources.work(f.user,f.schoolId)),waiting=await at(f,after,()=>f.resources.work(f.borrower,f.schoolId));
  expect(incoming.needs_me).toMatchObject([{question_id:question.id,href:`/areas/resources?loan_id=${loan.id}&question_id=${question.id}`}]);
  expect(waiting.waiting[0]?.message_id).toBe(incoming.needs_me[0]?.message_id);expect(JSON.stringify(incoming)).not.toContain(note);
  loan=await at(f,after,()=>f.resources.answer(f.user,f.schoolId,loan.id,question.id,{...command(loan.revision),note:'Checking shelf before closing the claim'}));
  expect(loan.questions[0]?.state).toBe('open');expect(loan.outstanding_count).toBe(1);
  const followup={...command(loan.revision),note:'The camera was left beside the library return desk.'};
  const borrowerView=await at(f,after,()=>f.resources.detail(f.borrower,f.schoolId,loan.id));expect(borrowerView).toMatchObject({can_question:false,can_reply:true,can_resolve:false});
  await expect(at(f,after,()=>f.resources.answer(f.borrower,f.schoolId,loan.id,question.id,followup,true))).rejects.toThrow();
  loan=await at(f,after,()=>f.resources.answer(f.borrower,f.schoolId,loan.id,question.id,followup));
  expect(loan.questions).toHaveLength(1);expect(loan.questions[0]?.replies).toContainEqual(expect.objectContaining({note:followup.note,actor_label:'Sana Borrower',action:'replied'}));
  expect(await at(f,after,()=>f.resources.answer(f.borrower,f.schoolId,loan.id,question.id,followup))).toMatchObject({revision:loan.revision});
  expect(await at(f,after,()=>f.resources.confirmation(f.borrower,f.schoolId,loan.id,followup.command_id))).toMatchObject({state:'accepted'});
  const authority=(await sql<{capability:string;reason_codes:string[]}>`SELECT authority.capability,authority.reason_codes FROM resource_loan_receipts receipt JOIN campus_model_commands command ON command.id=receipt.command_id JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id WHERE receipt.loan_id=${loan.id}::uuid AND receipt.revision=${loan.revision}`.execute(db)).rows[0];
  expect(authority).toEqual({capability:'resource_loans.question.reply',reason_codes:['exact_canonical_borrower']});
  expect((await at(f,after,()=>f.resources.work(f.user,f.schoolId))).needs_me[0]?.message_id).toBe(incoming.needs_me[0]?.message_id);
  loan=await at(f,after,()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,{...command(loan.revision),observed_at:f.now,correction:true,reason:'Physical return found on shelf; missed receipt',parts:[{part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}]}));
  expect(loan.history[0]).toMatchObject({action:'return_corrected',observed_at:f.now,recorded_at:after});expect(loan.outstanding_count).toBe(0);
  expect((await at(f,after,()=>f.resources.work(f.user,f.schoolId))).needs_me).toHaveLength(1);
  loan=await at(f,after,()=>f.resources.answer(f.user,f.schoolId,loan.id,question.id,{...command(loan.revision),note:'Found the book and corrected the missed return'},true));
  expect(loan.questions[0]?.state).toBe('resolved');
  expect(await at(f,after,()=>f.resources.work(f.borrower,f.schoolId))).toEqual({needs_me:[],waiting:[]});
  expect(await at(f,after,()=>f.resources.work(f.user,f.schoolId))).toEqual({needs_me:[],waiting:[]});
  const safe=await db.selectFrom('campus_model_commands').select('safe_context').where('school_id','=',f.schoolId).execute();
  const envelopes=await db.selectFrom('event_outbox').select('payload').where('school_id','=',f.schoolId).where('event_type','like','resources.%').execute();
  expect(JSON.stringify([safe,envelopes])).not.toContain(note);
 },60_000);

 it('rechecks current exact custody and canonical identity before accepted replay; admin title does not replace a custodian',async()=>{
  const f=await createResourceLoanFixture(db),input=issueInput(f),loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,input));
  await expect(f.run(()=>f.resources.recordReturn(f.borrower,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}])))).rejects.toThrow();
  await db.updateTable('school_memberships').set({role:'admin'}).where('school_id','=',f.schoolId).where('user_id','=',f.borrower.id).execute();
  expect(await f.run(()=>f.resources.detail(f.borrower,f.schoolId,loan.id))).toMatchObject({can_record_return:false});
  await expect(f.run(()=>f.resources.changeDue(f.borrower,f.schoolId,loan.id,{...command(loan.revision),due_at:new Date(Date.parse(f.now)+172_800_000).toISOString(),reason:'Not the named custodian'}))).rejects.toThrow('named custodian');
  await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
  await expect(f.run(()=>f.resources.issue(f.user,f.schoolId,input))).rejects.toThrow();
  await expect(f.run(()=>f.resources.confirmation(f.user,f.schoolId,loan.id,input.command_id))).rejects.toThrow();
 },60_000);

 it('serializes concurrent issue, rolls all native/Core/outbox state back on journal failure, and preserves immutable typed boundaries',async()=>{
  const f=await createResourceLoanFixture(db);
  const failed=issueInput(f),finish=vi.spyOn(f.model,'finish').mockRejectedValueOnce(new Error('Injected journal failure'));
  await expect(f.run(()=>f.resources.issue(f.user,f.schoolId,failed))).rejects.toThrow('Injected journal failure');finish.mockRestore();
  expect(await db.selectFrom('resource_loans').select('id').where('id','=',failed.command_id).execute()).toEqual([]);
  expect(await db.selectFrom('campus_model_commands').select('id').where('school_id','=',f.schoolId).where('source_domain','=','resource_loans').execute()).toEqual([]);
  const outcomes=await f.run(()=>Promise.allSettled([f.resources.issue(f.user,f.schoolId,issueInput(f)),f.resources.issue(f.user,f.schoolId,issueInput(f))]));
  expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(outcome=>outcome.status==='rejected')).toHaveLength(1);
  const accepted=outcomes.find(outcome=>outcome.status==='fulfilled')!;if(accepted.status!=='fulfilled')throw new Error('No successful concurrent issue');const loan=accepted.value;
  await expect(db.insertInto('resource_loan_parts').values({id:randomUUID(),school_id:f.schoolId,loan_id:loan.id,kind:'component',label:'Unrecorded late accessory',quantity:1}).execute()).rejects.toThrow('fixed');
  await expect(db.updateTable('resource_loan_receipts').set({reason:'Rewrite'}).where('loan_id','=',loan.id).execute()).rejects.toThrow('append-only');
  await expect(db.deleteFrom('campus_resource_holdings').where('id','=',f.holdingId).execute()).rejects.toThrow();
  const returned=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}])));
  await expect(db.insertInto('resource_loan_receipt_parts').values({school_id:f.schoolId,loan_id:loan.id,receipt_id:returned.history[0]!.id,part_id:randomUUID(),quantity:1,condition:'usable'}).execute()).rejects.toThrow();
  expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM resource_loans WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]?.count).toBe(1);
 },60_000);

 it('returns bounded option pages and preserves an explicitly selected copy beyond the first page',async()=>{
  const f=await createResourceLoanFixture(db);let last=f.holdingId;
  for(let index=0;index<26;index++)last=(await f.run(()=>f.resources.createItem(f.user,f.schoolId,{command_id:randomUUID(),campus_id:f.campusId,name:`ZZZ camera ${String(index).padStart(2,'0')}`,asset_tag:`PAGE-${index}-${f.schoolId.slice(0,8)}`},resourceLoanRequest(f.user)))).id;
  const first=await f.run(()=>f.resources.options(f.user,f.schoolId,{}));expect(first.holdings).toHaveLength(25);expect(first.pagination.holdings_total).toBe(27);
  expect(first.holdings.some(item=>item.id===last)).toBe(false);
  const selected=await f.run(()=>f.resources.options(f.user,f.schoolId,{holding_id:last}));expect(selected.holdings).toHaveLength(26);expect(selected.holdings.some(item=>item.id===last)).toBe(true);
  const next=await f.run(()=>f.resources.options(f.user,f.schoolId,{page:2}));expect(next.holdings).toHaveLength(2);
  expect(await f.run(()=>f.resources.options(f.user,f.schoolId,{search:'ZZZ camera 25'}))).toMatchObject({holdings:[{id:last}],pagination:{holdings_total:1}});
 },90_000);

 it('refuses orphan native advances, forged refresh evidence, late return quantities and cross-campus source references',async()=>{
  const f=await createResourceLoanFixture(db),loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  const current=await db.selectFrom('resource_loan_receipts').selectAll().where('loan_id','=',loan.id).executeTakeFirstOrThrow();
  await expect(db.transaction().execute(async tx=>{
   await tx.updateTable('resource_loans').set({revision:2}).where('id','=',loan.id).execute();
   await tx.insertInto('resource_loan_receipts').values({id:randomUUID(),school_id:f.schoolId,loan_id:loan.id,revision:2,command_id:randomUUID(),action:'return_recorded',actor_person_id:f.custodianPersonId,actor_user_id:f.user.id,observed_at:new Date(f.now),recorded_at:new Date(f.now),due_at:null,previous_due_at:null,supersedes_receipt_id:null,question_id:null}).execute();
  })).rejects.toThrow('exact accepted');
  expect(await db.selectFrom('resource_loans').select('revision').where('id','=',loan.id).executeTakeFirstOrThrow()).toEqual({revision:1});
  await expect(db.insertInto('event_outbox').values({school_id:f.schoolId,event_type:'resources.updated',aggregate_type:'resource_loan',aggregate_id:loan.id,audience_user_ids:[f.user.id],payload:{loan_id:loan.id,revision:1,action:'issued',command_id:current.command_id,refresh:['resources','workspace','attention'],private_note:'forged'},idempotency_key:randomUUID()}).execute()).rejects.toThrow();
  const foreign=await createResourceLoanFixture(db);
  await expect(db.insertInto('event_outbox').values({school_id:f.schoolId,event_type:'resources.updated',aggregate_type:'resource_loan',aggregate_id:loan.id,audience_user_ids:[foreign.user.id],payload:{loan_id:loan.id,revision:1,action:'issued',command_id:current.command_id,refresh:['resources','workspace','attention']},idempotency_key:randomUUID()}).execute()).rejects.toThrow();
  await expect(f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f,{borrower_person_id:foreign.borrowerPersonId,holding_id:foreign.holdingId})))).rejects.toThrow();
  const returned=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,loan.revision,[{part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}])));
  await expect(db.insertInto('resource_loan_receipt_parts').values({school_id:f.schoolId,loan_id:loan.id,receipt_id:returned.history[0]!.id,part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}).execute()).rejects.toThrow('exact pending return receipt');
 },60_000);

 it('does not infer item availability from a closed claim or inactive topology, and hides private bodies from other resource managers',async()=>{
  const f=await createResourceLoanFixture(db),loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  const privateNote='Sensitive native borrower inquiry';
  const asked=await f.run(()=>f.resources.ask(f.borrower,f.schoolId,loan.id,{...command(loan.revision),kind:'question',note:privateNote}));
  await expect(db.updateTable('resource_loan_questions').set({state:'resolved',resolved_at:new Date(f.now)}).where('id','=',asked.questions[0]!.id).execute()).rejects.toThrow('exact immutable custodian receipt');
  await db.updateTable('school_memberships').set({role:'admin'}).where('school_id','=',f.schoolId).where('user_id','=',f.borrower.id).execute();
  const managerPerson=await f.people.create(resourceLoanRequest(f.user),f.schoolId,{first_name:'Other',last_name:'Resource manager',idempotency_key:randomUUID()});
  const email=`resource-manager-${randomUUID()}@example.test`,invitation=await f.operations.invite(f.user,f.schoolId,{role:'member',person_id:managerPerson.id,email,idempotency_key:randomUUID()});
  await acceptWithRecipientProof(f.operations, {email,token:invitation.token,password:'Fictional-Resource-Manager2026!',first_name:'Other',last_name:'Resource manager'});
  const account=await db.selectFrom('users').select(['id','username','email','first_name','last_name','role','is_active']).where('email','=',email).executeTakeFirstOrThrow();
  // A normally accepted canonical account is explicitly made an administrative
  // reader by this synthetic fixture; this is not a loan custodian handoff.
  await db.updateTable('school_memberships').set({role:'admin'}).where('school_id','=',f.schoolId).where('user_id','=',account.id).execute();
  const managerHere={...account,active_school_id:f.schoolId},later=new Date(Date.now()+1000).toISOString();
  const physical=await at(f,later,()=>f.resources.detail(managerHere,f.schoolId,loan.id));
  expect(physical.questions).toEqual([]);expect(JSON.stringify(physical)).not.toContain(privateNote);expect(physical.can_reply).toBe(false);
  await expect(at(f,later,()=>f.resources.answer(managerHere,f.schoolId,loan.id,asked.questions[0]!.id,{...command(asked.revision),note:'Not the custodian'},true))).rejects.toThrow('named custodian');
  await expect(at(f,later,()=>f.resources.answer(managerHere,f.schoolId,loan.id,asked.questions[0]!.id,{...command(asked.revision),note:'Not a participant'},false))).rejects.toThrow('named custodian');
  const resolved=await f.run(()=>f.resources.answer(f.user,f.schoolId,loan.id,asked.questions[0]!.id,{...command(asked.revision),note:'Inquiry answered without claiming physical receipt'},true));
  expect(resolved.outstanding_count).toBe(1);
  const received=await f.run(()=>f.resources.recordReturn(f.user,f.schoolId,loan.id,receive(f,resolved.revision,[{part_id:loan.parts[0]!.id,quantity:1,condition:'usable'}])));
  expect(received.state).toBe('returned');
  await db.updateTable('institution_campuses').set({status:'inactive'}).where('id','=',f.campusId).execute();
  const options=await f.run(()=>f.resources.options(f.user,f.schoolId,{holding_id:f.holdingId}));expect(options.holdings[0]).toMatchObject({available:false,unavailable_reason:'Its campus or location is inactive.'});
  await expect(f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)))).rejects.toThrow('inactive');
  await expect(f.run(()=>f.resources.createItem(f.user,f.schoolId,{command_id:randomUUID(),campus_id:f.campusId,name:'Rejected inactive campus item',asset_tag:`INACTIVE-${randomUUID()}`},resourceLoanRequest(f.user)))).rejects.toMatchObject({status:422});
 },60_000);

 it('projects every current question without per-question identity or redundant native loan lookup',async()=>{
  const f=await createResourceLoanFixture(db);
  for(let index=0;index<3;index++){
   const item=index===0?{id:f.holdingId}:await f.run(()=>f.resources.createItem(f.user,f.schoolId,{command_id:randomUUID(),campus_id:f.campusId,name:`Work camera ${index}`,asset_tag:`WORK-${index}-${randomUUID()}`},resourceLoanRequest(f.user)));
   const loan=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f,{holding_id:item.id})));
   await f.run(()=>f.resources.ask(f.borrower,f.schoolId,loan.id,{...command(loan.revision),kind:'question',note:`Native inquiry ${index}`}));
  }
  const identities=vi.spyOn(f.core,'resolvePersonAgent');
  try {
   expect((await f.run(()=>f.resources.work(f.user,f.schoolId))).needs_me).toHaveLength(3);expect(identities).not.toHaveBeenCalled();
   const waiting=await f.run(()=>f.resources.work(f.borrower,f.schoolId));expect(waiting.waiting).toHaveLength(3);expect(identities).toHaveBeenCalledTimes(1);
   expect(new Set(waiting.waiting.map(row=>row.question_id)).size).toBe(3);
  }finally{identities.mockRestore();}
 },60_000);

 it('lets a Resources-only custodian select exact canonical borrowers without granting SIS or academic profiles',async()=>{
  const f=await createResourceLoanFixture(db),day=f.now.slice(0,10),end=new Date(Date.parse(f.now)+86_400_000).toISOString().slice(0,10);
  // This test requires a real current Staff endpoint, not a Member wrapper
  // relabelled in SQL. Unused coverage collaborators are isolated doubles;
  // employment and invitation acceptance use their actual owning services.
  const staff=new StaffOperationsService(db,{} as never,{} as never,createStaffCoverageReconciliationTestDouble(),f.core,f.core,f.core,f.core);
  const email=`resources-only-${randomUUID()}@example.test`;
  const person=await f.people.create(resourceLoanRequest(f.user),f.schoolId,{first_name:'Resources-only',last_name:'Custodian',idempotency_key:randomUUID()});
  const personSource=await db.selectFrom('school_people').select(['id','revision']).where('id','=',person.id).where('school_id','=',f.schoolId).executeTakeFirstOrThrow();
  await staff.createProfile(f.user,f.schoolId,{person:{id:personSource.id,expected_revision:personSource.revision},idempotency_key:randomUUID(),staff_code:`RES-${randomUUID().slice(0,8)}`,staff_kind:'non_teaching',designation:'Resources custodian',employment_type:'unspecified',joined_on:null});
  const profileSource=await db.selectFrom('staff_profiles').select(['id','person_id']).where('school_id','=',f.schoolId).where('person_id','=',person.id).executeTakeFirstOrThrow();
  const profileId=profileSource.id,checks=await db.selectFrom('staff_onboarding_items').select('id').where('staff_profile_id','=',profileId).where('required','=',true).execute();
  for(const check of checks){const profile=await db.selectFrom('staff_profiles').select('revision').where('id','=',profileId).executeTakeFirstOrThrow();await staff.updateOnboarding(f.user,f.schoolId,profileId,{item_id:check.id,completed:true,expected_revision:profile.revision,note:'Synthetic owner-confirmed fixture onboarding check'});}
  const invitation=await f.operations.invite(f.user,f.schoolId,{email,role:'staff',person_id:person.id});
  await acceptWithRecipientProof(f.operations, {email,token:invitation.token,password:'Q4!mT9x#7zB2vL6p',first_name:'Resources-only',last_name:'Custodian'});
  const account=await db.selectFrom('users').select(['id','username','email','first_name','last_name','role','is_active']).where('email','=',email).executeTakeFirstOrThrow();
  const operator={...account,active_school_id:f.schoolId},now=new Date(Date.now()+1000).toISOString(),run=<T>(fn:()=>Promise<T>)=>at(f,now,fn);
  const identity=await run(()=>db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:operator.id,at:now})));
  if(!identity.acting)throw new Error(`Ordinary Staff fixture is not acting: ${JSON.stringify(identity)}`);
  await db.insertInto('school_access_exceptions').values({school_id:f.schoolId,user_id:operator.id,permission:'resources.manage',reason:'Synthetic explicit institution Resources-only custodian',source_kind:'manual',scope_kind:'institution',valid_from:day,valid_until:end,review_due_on:end,created_by:f.user.id}).execute();
  const options=await run(()=>f.resources.options(operator,f.schoolId,{person_id:f.custodianPersonId,search:'Resource Custodian'}));
  expect(options).toMatchObject({can_manage:true,can_add_people:false,people:[{id:f.custodianPersonId,label:'Resource Custodian',revision:1}]});
  expect(await run(()=>db.transaction().execute(tx=>readResourceLoansReadiness(tx,f.core,operator,f.schoolId)))).toMatchObject({operation:{state:'ready_to_issue',action:'issue'}});
  expect(Object.keys(options.people[0]!).sort()).toEqual(['id','label','revision']);
  await expect(run(()=>f.people.list(operator,f.schoolId,{}))).rejects.toThrow();
  await expect(run(()=>f.people.create(resourceLoanRequest(operator),f.schoolId,{first_name:'No broad SIS grant',idempotency_key:randomUUID()}))).rejects.toThrow();
  const loan=await run(()=>f.resources.issue(operator,f.schoolId,issueInput(f,{borrower_person_id:f.custodianPersonId})));
  expect(loan).toMatchObject({custodian:{id:profileSource.person_id},borrower:{id:f.custodianPersonId},outstanding_count:1});
  expect(await academicScaffoldingCounts(db,f.schoolId)).toEqual({students:0,staff:1,classes:0,terms:0,enrollments:0,guardians:0,roles:0,schedules:0});
 },60_000);

 it('retains an existing borrower follow-up without guessing a replacement when custodian permission is revoked',async()=>{
  const f=await createResourceLoanFixture(db),first=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f)));
  let loan=await f.run(()=>f.resources.ask(f.borrower,f.schoolId,first.id,{...command(first.revision),kind:'question',note:'Please review this borrowing record'}));
  const item=await f.run(()=>f.resources.createItem(f.user,f.schoolId,{command_id:randomUUID(),campus_id:f.campusId,name:'Other loan copy',asset_tag:`OTHER-${randomUUID()}`},resourceLoanRequest(f.user)));
  const unasked=await f.run(()=>f.resources.issue(f.user,f.schoolId,issueInput(f,{holding_id:item.id})));
  await db.updateTable('school_memberships').set({role:'member'}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
  loan=await f.run(()=>f.resources.answer(f.borrower,f.schoolId,loan.id,loan.questions[0]!.id,{...command(loan.revision),note:'Additional detail is retained while access is reviewed'}));
  expect(loan.questions[0]?.replies).toContainEqual(expect.objectContaining({note:'Additional detail is retained while access is reviewed'}));
  const waiting=await f.run(()=>f.resources.work(f.borrower,f.schoolId));expect(waiting.waiting).toMatchObject([{loan_id:loan.id,state:'needs_reassignment',reviewer:{user_id:null}}]);
  const last=await db.selectFrom('event_outbox').select('audience_user_ids').where('school_id','=',f.schoolId).where('event_type','=','resources.updated').where('aggregate_id','=',loan.id).orderBy('sequence','desc').executeTakeFirstOrThrow();
  expect(last.audience_user_ids).toEqual([f.borrower.id]);
  await expect(f.run(()=>f.resources.ask(f.borrower,f.schoolId,unasked.id,{...command(unasked.revision),kind:'question',note:'Fresh question has no authorized route'}))).rejects.toMatchObject({status:422});
  expect(await db.selectFrom('resource_loan_questions').select('id').where('loan_id','=',unasked.id).execute()).toEqual([]);
  expect(await db.selectFrom('resource_loans').select('revision').where('id','=',unasked.id).executeTakeFirstOrThrow()).toEqual({revision:unasked.revision});
 },60_000);
});
