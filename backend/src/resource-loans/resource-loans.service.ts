import { ConflictException,ForbiddenException,Injectable,NotFoundException,UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql,type Selectable,type Transaction } from 'kysely';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import type { AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { institutionSchoolPermission,institutionSchoolPermissionForUser } from '../roles/authorization.js';
import { retainOperatingDestination } from '../institution-onboarding/operating-resume.js';
import { InstitutionSetupService } from '../institution-setup/institution-setup.service.js';
import { ResourceLoansAccess } from './resource-loans.access.js';
import { ResourceLoansModel } from './resource-loans.model.js';
import { resourceLoanIssue,resourceLoanReturn,resourceLoanDue,resourceLoanCustody,resourceLoanCustodianOptions,resourceLoanQuestion,resourceLoanReply,resourceLoanList,resourceLoanItem,resourceLoanOptions,resourceLoanHref,type ResourceLoanWorkRecord } from './resource-loans.contracts.js';
import type { ResourceLoanTable,ResourceLoanAction,ResourceLoanReceiptTable } from './resource-loans.types.js';
type Tx=Transaction<Database>;type Loan=Selectable<ResourceLoanTable>;
type Balance={id:string;kind:string;label:string;quantity:number;returned_quantity:number;outstanding_quantity:number;condition:'usable'|'damaged'|'held'};
const iso=(value:Date|string|null)=>value===null?null:new Date(value).toISOString();
const label=(first:string,last:string)=>`${first} ${last}`.trim();
@Injectable()
export class ResourceLoansService {
 constructor(private readonly db:DatabaseService,private readonly access:ResourceLoansAccess,private readonly model:ResourceLoansModel,private readonly topology:InstitutionSetupService) {}
 /** Read-only composition port. Accommodation never writes custody or reads
  * borrower questions, and its assignment does not grant Resources authority. */
 async accommodationCustody(tx:Tx,user:AuthUser,schoolId:string,stayId:string,loanId:string){
  const actor=await this.access.campus(tx,user,schoolId),stay=await tx.selectFrom('accommodation_stays').select(['resident_person_id','coordinator_person_id','recorder_person_id']).where('school_id','=',schoolId).where('id','=',stayId).executeTakeFirst();
  if(!stay||![stay.resident_person_id,stay.coordinator_person_id,stay.recorder_person_id].includes(actor.person_id))throw new ForbiddenException('This stay’s custody summary is private to its current participants.');
  const loan=await tx.selectFrom('resource_loans').selectAll().where('school_id','=',schoolId).where('id','=',loanId).where('borrower_person_id','=',stay.resident_person_id).executeTakeFirst();
  if(!loan)throw new NotFoundException('Choose an existing loan issued to this resident in this campus.');
  const parts=await this.balances(tx,schoolId,loanId),manager=await this.access.manages(tx,user,schoolId),isCustodian=actor.person_id===loan.custodian_person_id;
  return {loan_id:loan.id,item:{id:loan.holding_id,label:loan.item_name},outstanding:parts.reduce((sum,part)=>sum+part.outstanding_quantity,0),href:resourceLoanHref(loan.id),can_open:manager||isCustodian||actor.person_id===loan.borrower_person_id,can_return:manager&&isCustodian,revision:loan.revision,issued_at:iso(loan.issued_at)!};
 }
 private async loan(tx:Tx,schoolId:string,id:string,lock=false) {
  const found=await tx.selectFrom('resource_loans').selectAll().where('school_id','=',schoolId).where('id','=',id).executeTakeFirst();
  if(!found)throw new NotFoundException('This loan is unavailable in the selected campus.');
  if(!lock)return found;
  await tx.selectFrom('campus_resource_holdings').select('id').where('school_id','=',schoolId).where('id','=',found.holding_id).forUpdate().executeTakeFirstOrThrow();
  return tx.selectFrom('resource_loans').selectAll().where('school_id','=',schoolId).where('id','=',id).forUpdate().executeTakeFirstOrThrow();
 }
 private async balances(tx:Tx,schoolId:string,loanId:string) {
  return (await sql<Balance>`SELECT id,kind,label,quantity,returned_quantity,outstanding_quantity,condition FROM resource_loan_balances
   WHERE school_id=${schoolId}::uuid AND loan_id=${loanId}::uuid ORDER BY kind DESC,id`.execute(tx)).rows;
 }
 private async readable(tx:Tx,user:AuthUser,loan:Loan) {
  const actor=await this.access.campus(tx,user,loan.school_id),manager=await this.access.manages(tx,user,loan.school_id);
  if(actor.person_id!==loan.borrower_person_id&&actor.person_id!==loan.custodian_person_id&&!manager)throw new ForbiddenException('This borrowing record is private to its borrower and authorized Resources work.');
  return {actor,manager,privateAudience:actor.person_id===loan.borrower_person_id||actor.person_id===loan.custodian_person_id};
 }
 private async recipient(tx:Tx,loan:Pick<Loan,'school_id'|'custodian_person_id'>) {
  const endpoint=await this.access.identities.resolvePersonAgent(tx,{school_id:loan.school_id,person_id:loan.custodian_person_id,at:executionNow().toISOString()});
  if(!endpoint.acting||endpoint.person_id!==loan.custodian_person_id)throw new ConflictException('The named custodian’s app access needs review. No replacement recipient was invented.');
  await institutionSchoolPermissionForUser(tx,endpoint.user_id,loan.school_id,'resources.manage',true);
  return {person_id:endpoint.person_id,user_id:endpoint.user_id};
 }
 private async audience(tx:Tx,loan:Loan) {
  const borrower=await this.access.identities.resolvePersonAgent(tx,{school_id:loan.school_id,person_id:loan.borrower_person_id,at:executionNow().toISOString()});
  let custodianUserId:string|null=null;
  try{custodianUserId=(await this.recipient(tx,loan)).user_id;}catch(error){if(!(error instanceof ConflictException||error instanceof ForbiddenException))throw error;}
  return [...(borrower.acting?[borrower.user_id]:[]),...(custodianUserId?[custodianUserId]:[])];
 }
 private async custodianAvailable(tx:Tx,loan:Pick<Loan,'school_id'|'custodian_person_id'>) {
  try {await this.recipient(tx,loan);return true;}
  catch(error){if(error instanceof ConflictException||error instanceof ForbiddenException)return false;throw error;}
 }
 private async custodyAuthority(tx:Tx,user:AuthUser,loan:Loan) {
  const actor=await this.access.operator(tx,user,loan.school_id);
  if(actor.person_id===loan.custodian_person_id)return {actor,basis:'named_custodian' as const};
  if(await this.custodianAvailable(tx,loan))throw new ForbiddenException('Only the current named custodian can hand over this loan while their access is active.');
  return {actor,basis:'orphan_recovery' as const};
 }
 private state(parts:Balance[],dueAt:Date) {
  const count=parts.reduce((sum,part)=>sum+part.outstanding_quantity,0),held=parts.some(part=>part.condition!=='usable');
  return {outstanding_count:count,state:count>0?dueAt.getTime()<executionNow().getTime()?'overdue' as const:'outstanding' as const:held?'held' as const:'returned' as const};
 }
 private async summary(tx:Tx,loan:Loan) {
  const people=await tx.selectFrom('school_people').select(['id','first_name','last_name']).where('school_id','=',loan.school_id).where('id','in',[loan.borrower_person_id,loan.custodian_person_id]).execute();
  const person=(id:string)=>({id,label:people.find(row=>row.id===id)?label(people.find(row=>row.id===id)!.first_name,people.find(row=>row.id===id)!.last_name):'Campus person'});
  const questions=await tx.selectFrom('resource_loan_questions').select(({fn})=>fn.countAll<number>().as('count')).where('school_id','=',loan.school_id).where('loan_id','=',loan.id).where('state','=','open').executeTakeFirstOrThrow();
  return {id:loan.id,title:loan.item_name,asset_tag:loan.asset_tag,borrower:person(loan.borrower_person_id),custodian:person(loan.custodian_person_id),issued_at:iso(loan.issued_at)!,due_at:iso(loan.due_at)!,revision:loan.revision,...this.state(await this.balances(tx,loan.school_id,loan.id),loan.due_at),question_count:Number(questions.count)};
 }
 private async detailIn(tx:Tx,user:AuthUser,loan:Loan) {
  const permitted=await this.readable(tx,user,loan),summary=await this.summary(tx,loan),parts=await this.balances(tx,loan.school_id,loan.id);
  const custodyRecovery=permitted.manager&&permitted.actor.person_id!==loan.custodian_person_id&&!await this.custodianAvailable(tx,loan);
  const receipts=await tx.selectFrom('resource_loan_receipts as receipt').innerJoin('school_people as actor','actor.id','receipt.actor_person_id')
   .leftJoin('school_people as previous','previous.id','receipt.previous_custodian_person_id').leftJoin('school_people as successor','successor.id','receipt.custodian_person_id')
   .selectAll('receipt').select(['actor.first_name','actor.last_name','previous.first_name as previous_first','previous.last_name as previous_last','successor.first_name as next_first','successor.last_name as next_last']).where('receipt.school_id','=',loan.school_id).where('receipt.loan_id','=',loan.id).orderBy('receipt.revision','desc').limit(200).execute();
  const visible=receipts.filter(receipt=>permitted.privateAudience||!['question_asked','replied','resolved'].includes(receipt.action));
  const received=visible.length?await tx.selectFrom('resource_loan_receipt_parts').selectAll().where('school_id','=',loan.school_id).where('loan_id','=',loan.id).where('receipt_id','in',visible.map(receipt=>receipt.id)).execute():[];
  const questions=permitted.privateAudience?await tx.selectFrom('resource_loan_questions as question').innerJoin('school_people as reporter','reporter.id','question.reporter_person_id')
   .selectAll('question').select(['reporter.first_name','reporter.last_name']).where('question.school_id','=',loan.school_id).where('question.loan_id','=',loan.id).orderBy('question.created_at','desc').limit(50).execute():[];
  return {...summary,holding_id:loan.holding_id,parts,history:visible.map(receipt=>({id:receipt.id,action:receipt.action,actor_label:label(receipt.first_name,receipt.last_name),observed_at:iso(receipt.observed_at),recorded_at:iso(receipt.recorded_at),reason:receipt.reason,note:permitted.privateAudience?receipt.note:'',due_at:iso(receipt.due_at),previous_due_at:iso(receipt.previous_due_at),supersedes_receipt_id:receipt.supersedes_receipt_id,question_id:permitted.privateAudience?receipt.question_id:null,
   previous_custodian:receipt.previous_custodian_person_id?{id:receipt.previous_custodian_person_id,label:label(receipt.previous_first??'',receipt.previous_last??'')}:null,custodian:receipt.custodian_person_id?{id:receipt.custodian_person_id,label:label(receipt.next_first??'',receipt.next_last??'')}:null,custody_basis:receipt.custody_basis,
   parts:received.filter(part=>part.receipt_id===receipt.id).map(part=>({part_id:part.part_id,quantity:part.quantity,condition:part.condition}))})),
   history_has_more:receipts.length===200,questions:questions.map(question=>({id:question.id,kind:question.kind,note:question.note,state:question.state,revision:question.revision,claimed_return_at:iso(question.claimed_return_at),reporter:{id:question.reporter_person_id,label:label(question.first_name,question.last_name)},created_at:iso(question.created_at),resolved_at:iso(question.resolved_at),replies:visible.filter(receipt=>receipt.question_id===question.id&&['replied','resolved'].includes(receipt.action)).map(receipt=>({id:receipt.id,note:receipt.note,actor_label:label(receipt.first_name,receipt.last_name),recorded_at:iso(receipt.recorded_at),action:receipt.action}))})),
   can_record_return:permitted.manager&&permitted.actor.person_id===loan.custodian_person_id,can_change_due:permitted.manager&&permitted.actor.person_id===loan.custodian_person_id,
   can_change_custodian:permitted.manager&&(permitted.actor.person_id===loan.custodian_person_id||custodyRecovery),custody_recovery:custodyRecovery,
   can_question:permitted.actor.person_id===loan.borrower_person_id&&!questions.some(question=>question.state==='open'),
   can_reply:questions.some(question=>question.state==='open')&&(permitted.actor.person_id===loan.borrower_person_id||permitted.manager&&permitted.actor.person_id===loan.custodian_person_id),
   can_resolve:questions.some(question=>question.state==='open')&&permitted.manager&&permitted.actor.person_id===loan.custodian_person_id};
 }
 detail(user:AuthUser,schoolId:string,id:string){return this.db.transaction().execute(async tx=>{await this.access.campus(tx,user,schoolId);return this.detailIn(tx,user,await this.loan(tx,schoolId,id));});}
 private async item(tx:Tx,schoolId:string,id:string,lock=false) {
  if(lock)await tx.selectFrom('campus_resource_holdings').select('id').where('school_id','=',schoolId).where('id','=',id).forUpdate().executeTakeFirstOrThrow();
  const row=(await sql<{id:string;name:string;asset_tag:string|null;campus_id:string;campus_name:string;revision:number;tracking_mode:string;state:string;parent_active:boolean;type_active:boolean;active_loan_id:string|null;held:boolean}>`
   SELECT holding.id,holding.name,holding.asset_tag,holding.campus_id,campus.name AS campus_name,holding.revision,type.tracking_mode,holding.state,
    campus.status='active' AND (space.id IS NULL OR space.status='active') AS parent_active,type.is_active AS type_active,
    (SELECT loan.id FROM resource_loans loan JOIN resource_loan_status balance ON balance.id=loan.id AND balance.school_id=loan.school_id WHERE loan.school_id=holding.school_id AND loan.holding_id=holding.id AND balance.outstanding_count>0 ORDER BY loan.issue_order DESC LIMIT 1) AS active_loan_id,
    EXISTS(SELECT 1 FROM resource_loans loan JOIN resource_loan_status balance ON balance.id=loan.id AND balance.school_id=loan.school_id WHERE loan.school_id=holding.school_id AND loan.holding_id=holding.id AND balance.held) AS held
   FROM campus_resource_holdings holding JOIN campus_resource_types type ON type.id=holding.resource_type_id AND type.school_id=holding.school_id
   JOIN institution_campuses campus ON campus.id=holding.campus_id AND campus.school_id=holding.school_id
   LEFT JOIN campus_spaces space ON space.id=holding.space_id AND space.school_id=holding.school_id
   WHERE holding.id=${id}::uuid AND holding.school_id=${schoolId}::uuid ${lock?sql`FOR SHARE OF campus,type`:sql``}`.execute(tx)).rows[0];
  if(!row)throw new NotFoundException('Choose an existing resource from this campus.');
  if(lock)await sql`SELECT space.id FROM campus_spaces space JOIN campus_resource_holdings holding ON holding.space_id=space.id AND holding.school_id=space.school_id WHERE holding.school_id=${schoolId}::uuid AND holding.id=${id}::uuid FOR SHARE OF space`.execute(tx);
  const reason=row.tracking_mode!=='individual'?'Pooled quantities are not exact copies; lending is unavailable in this version.':!row.asset_tag?.trim()?'This copy needs an exact asset tag before issue.':row.state!=='available'?`Resource is ${row.state}.`:!row.parent_active?'Its campus or location is inactive.':!row.type_active?'Its resource type is inactive.':row.active_loan_id?'An issued kit still has outstanding parts.':row.held?'A received part is damaged or held.':null;
  return {id:row.id,name:row.name,asset_tag:row.asset_tag,campus_id:row.campus_id,campus_name:row.campus_name,revision:row.revision,tracking_mode:row.tracking_mode,state:row.state,available:reason===null,unavailable_reason:reason,active_loan_id:row.active_loan_id};
 }
 options(user:AuthUser,schoolId:string,raw:unknown={}){const input=resourceLoanOptions.parse(raw);return this.db.transaction().execute(async tx=>{
  const actor=await this.access.campus(tx,user,schoolId),canManage=await this.access.manages(tx,user,schoolId);
  let canAddPeople=false;if(canManage){try{await institutionSchoolPermission(tx,user,schoolId,'sis.manage',true);canAddPeople=true;}catch(error){if(!(error instanceof ForbiddenException))throw error;}}
  const campuses=canManage?await tx.selectFrom('institution_campuses').select(['id','name']).where('school_id','=',schoolId).where('status','=','active').orderBy('is_primary','desc').execute():[];
  const pattern=`%${input.search.replace(/[\\%_]/g,'\\$&')}%`,offset=(input.page-1)*25;
  const people=canManage?(await sql<{id:string;first_name:string;last_name:string;revision:number}>`SELECT id,first_name,last_name,revision FROM school_people
   WHERE school_id=${schoolId}::uuid AND retired_at IS NULL AND concat_ws(' ',first_name,last_name) ILIKE ${pattern} ORDER BY first_name,last_name,id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows:[];
  const holdings=canManage?(await sql<{id:string}>`SELECT id FROM campus_resource_holdings WHERE school_id=${schoolId}::uuid AND (name ILIKE ${pattern} OR asset_tag ILIKE ${pattern}) ORDER BY name,asset_tag,id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows:[];
  const counts=canManage?(await sql<{people:number;holdings:number}>`SELECT
   (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid AND retired_at IS NULL AND concat_ws(' ',first_name,last_name) ILIKE ${pattern}) AS people,
   (SELECT count(*)::int FROM campus_resource_holdings WHERE school_id=${schoolId}::uuid AND (name ILIKE ${pattern} OR asset_tag ILIKE ${pattern})) AS holdings`.execute(tx)).rows[0]!:{people:0,holdings:0};
  if(canManage&&input.holding_id&&!holdings.some(row=>row.id===input.holding_id))holdings.push({id:input.holding_id});
  if(canManage&&input.person_id&&!people.some(row=>row.id===input.person_id)){
   const selected=(await sql<{id:string;first_name:string;last_name:string;revision:number}>`SELECT id,first_name,last_name,revision FROM school_people WHERE school_id=${schoolId}::uuid AND retired_at IS NULL AND id=${input.person_id}::uuid`.execute(tx)).rows[0];if(selected)people.push(selected);
  }
  return {campuses,people:people.map(person=>({id:person.id,label:label(person.first_name,person.last_name),revision:person.revision})),holdings:await Promise.all(holdings.map(row=>this.item(tx,schoolId,row.id))),pagination:{page:input.page,page_size:25,people_total:counts.people,holdings_total:counts.holdings},actor:{person_id:actor.person_id,label:actor.label},can_manage:canManage,can_add_people:canAddPeople};
 });}
 async createItem(user:AuthUser,schoolId:string,body:unknown,request:unknown) {
  const input=resourceLoanItem.parse(body);
  const {resource_type_id:resourceTypeId,...required}=input;
  const result=await this.topology.createLendingItem(user,schoolId,{...required,...(resourceTypeId?{resource_type_id:resourceTypeId}:{})},request as never);
  return this.db.transaction().execute(async tx=>{
   const created_items=await Promise.all(result.created_items.map(row=>this.item(tx,schoolId,row.id)));
   return {...created_items[0]!,quantity:result.quantity,created_items};
  });
 }
 async workspace(user:AuthUser,schoolId:string,raw:unknown) {
  const input=resourceLoanList.parse(raw);
  return this.db.transaction().execute(async tx=>{
   const actor=await this.access.campus(tx,user,schoolId),manager=await this.access.manages(tx,user,schoolId);
   const scope=manager&&input.view!=='mine'?sql`true`:sql`loan.borrower_person_id=${actor.person_id}::uuid OR loan.custodian_person_id=${actor.person_id}::uuid`;
   const filter=input.state==='outstanding'?sql`state.outstanding_count>0`:input.state==='overdue'?sql`state.outstanding_count>0 AND loan.due_at<${executionNow()}`:input.state==='returned'?sql`state.outstanding_count=0`:input.state==='questions'?sql`EXISTS(SELECT 1 FROM resource_loan_questions question WHERE question.school_id=loan.school_id AND question.loan_id=loan.id AND question.state='open')`:sql`true`;
   const pattern=`%${input.search.replace(/[\\%_]/g,'\\$&')}%`;
   const search=sql`loan.item_name ILIKE ${pattern} OR loan.asset_tag ILIKE ${pattern} OR EXISTS(SELECT 1 FROM school_people borrower WHERE borrower.school_id=loan.school_id AND borrower.id=loan.borrower_person_id AND concat_ws(' ',borrower.first_name,borrower.last_name) ILIKE ${pattern})`;
   const total=(await sql<{total:number}>`SELECT count(*)::int AS total FROM resource_loans loan JOIN resource_loan_status state ON state.id=loan.id AND state.school_id=loan.school_id
    WHERE loan.school_id=${schoolId}::uuid AND (${scope}) AND (${filter}) AND (${search})`.execute(tx)).rows[0]!.total;
   const rows=(await sql<Loan>`SELECT loan.* FROM resource_loans loan JOIN resource_loan_status state ON state.id=loan.id AND state.school_id=loan.school_id
    WHERE loan.school_id=${schoolId}::uuid AND (${scope}) AND (${filter}) AND (${search}) ORDER BY loan.issue_order DESC LIMIT 10 OFFSET ${(input.page-1)*10}`.execute(tx)).rows;
   const totals=(await sql<{outstanding:number;overdue:number;questions:number}>`SELECT count(*) FILTER(WHERE state.outstanding_count>0)::int AS outstanding,
    count(*) FILTER(WHERE state.outstanding_count>0 AND loan.due_at<${executionNow()})::int AS overdue,
    (SELECT count(*)::int FROM resource_loan_questions question JOIN resource_loans linked ON linked.id=question.loan_id AND linked.school_id=question.school_id
     WHERE question.school_id=${schoolId}::uuid AND question.state='open' AND (${manager} OR linked.borrower_person_id=${actor.person_id}::uuid OR linked.custodian_person_id=${actor.person_id}::uuid)) AS questions
    FROM resource_loans loan JOIN resource_loan_status state ON state.id=loan.id AND state.school_id=loan.school_id WHERE loan.school_id=${schoolId}::uuid AND (${scope})`.execute(tx)).rows[0]!;
   let items:Awaited<ReturnType<ResourceLoansService['item']>>[]=[];let itemTotal=0;
   if(input.view==='items'&&manager){const itemRows=await tx.selectFrom('campus_resource_holdings').select('id').where('school_id','=',schoolId).where('name','ilike',pattern).orderBy('name').orderBy('asset_tag').orderBy('id').limit(10).offset((input.page-1)*10).execute();items=await Promise.all(itemRows.map(row=>this.item(tx,schoolId,row.id)));itemTotal=Number((await tx.selectFrom('campus_resource_holdings').select(({fn})=>fn.countAll().as('count')).where('school_id','=',schoolId).where('name','ilike',pattern).executeTakeFirstOrThrow()).count);}
   return {view:input.view,can_manage:manager,can_issue:manager,loans:input.view==='items'?[]:await Promise.all(rows.map(row=>this.summary(tx,row))),items,totals,pagination:{page:input.page,page_size:10,total:input.view==='items'?itemTotal:total}};
  });
 }
 async issue(user:AuthUser,schoolId:string,body:unknown) {
  const input=resourceLoanIssue.parse(body);
  return this.db.transaction().execute(async tx=>{
   const actor=await this.access.operator(tx,user,schoolId),item=await this.item(tx,schoolId,input.holding_id,true);
   const existing=await tx.selectFrom('resource_loans').selectAll().where('id','=',input.command_id).where('school_id','=',schoolId).executeTakeFirst();
   if(existing&&existing.custodian_person_id!==actor.person_id)throw new ForbiddenException('This issue belongs to another custodian.');
   const prepared=await this.model.prepare(tx,user,actor,{id:input.command_id,school_id:schoolId,item_name:item.name},'issued',input,existing?.revision??0,{permission:'resources.manage',custody_confirmed:true,custody_purpose:input.custody_purpose,custodian_person_id:actor.person_id});
   if(prepared.replay)return this.detailIn(tx,user,existing!);
   if(!item.available)throw new UnprocessableEntityException(item.unavailable_reason!);
   if(new Date(input.due_at).getTime()<=executionNow().getTime())throw new UnprocessableEntityException('Choose a due time after this physical issue.');
   const borrower=(await sql<{id:string}>`SELECT id FROM school_people WHERE school_id=${schoolId}::uuid AND id=${input.borrower_person_id}::uuid AND retired_at IS NULL FOR SHARE`.execute(tx)).rows[0];
   if(!borrower)throw new UnprocessableEntityException('Choose the exact current borrower from People.');
   const loan=await tx.insertInto('resource_loans').values({id:input.command_id,school_id:schoolId,holding_id:item.id,borrower_person_id:borrower.id,custodian_person_id:actor.person_id,issued_by_user_id:user.id,item_name:item.name,asset_tag:item.asset_tag!,issued_at:executionNow(),due_at:new Date(input.due_at),custody_purpose:input.custody_purpose,created_at:executionNow()}).returningAll().executeTakeFirstOrThrow();
   await tx.insertInto('resource_loan_parts').values([{id:randomUUID(),school_id:schoolId,loan_id:loan.id,kind:'item' as const,label:item.name,quantity:1},...input.components.map(part=>({id:randomUUID(),school_id:schoolId,loan_id:loan.id,kind:'component' as const,...part}))]).execute();
   const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,'issued',{observed_at:executionNow()});
   await this.model.finish(tx,user,loan,receipt,prepared.prepared,await this.audience(tx,loan));
   await retainOperatingDestination(tx,user,schoolId,'resources',resourceLoanHref(loan.id),{source:'accepted_resource_issue',onlyPending:true});
   return this.detailIn(tx,user,loan);
  });
 }
 private receipt(tx:Tx,user:AuthUser,loan:Loan,personId:string,commandId:string,action:ResourceLoanAction,extra:Partial<Selectable<ResourceLoanReceiptTable>>={}) {
  return tx.insertInto('resource_loan_receipts').values({id:randomUUID(),school_id:loan.school_id,loan_id:loan.id,revision:loan.revision,command_id:commandId,action,actor_person_id:personId,actor_user_id:user.id,observed_at:null,recorded_at:executionNow(),due_at:null,previous_due_at:null,supersedes_receipt_id:null,question_id:null,...extra}).returningAll().executeTakeFirstOrThrow();
 }
 private advance(tx:Tx,loan:Loan,dueAt=loan.due_at){return tx.updateTable('resource_loans').set({revision:loan.revision+1,due_at:dueAt}).where('school_id','=',loan.school_id).where('id','=',loan.id).where('revision','=',loan.revision).returningAll().executeTakeFirstOrThrow();}
 async recordReturn(user:AuthUser,schoolId:string,id:string,body:unknown) {
  const input=resourceLoanReturn.parse(body);
  return this.db.transaction().execute(async tx=>{
   await this.access.campus(tx,user,schoolId);let loan=await this.loan(tx,schoolId,id,true);
   const actor=await this.access.operator(tx,user,schoolId,loan.custodian_person_id),action=input.correction?'return_corrected':'return_recorded';
   const prepared=await this.model.prepare(tx,user,actor,loan,action,input,loan.revision,{custodian_person_id:loan.custodian_person_id,permission:'resources.manage'});
   if(prepared.replay)return this.detailIn(tx,user,loan);
   const observed=new Date(input.observed_at);if(observed<loan.issued_at||observed>executionNow())throw new UnprocessableEntityException('Reported receipt time must be between physical issue and the current selected-world time.');
   if(input.supersedes_receipt_id){const original=await tx.selectFrom('resource_loan_receipts').selectAll().where('school_id','=',schoolId).where('loan_id','=',id).where('id','=',input.supersedes_receipt_id).forUpdate().executeTakeFirst();
    if(!original||!['return_recorded','return_corrected'].includes(original.action)||await tx.selectFrom('resource_loan_receipts').select('id').where('school_id','=',schoolId).where('supersedes_receipt_id','=',original.id).executeTakeFirst())throw new UnprocessableEntityException('Choose the current exact return receipt to correct.');}
   const parts=await this.balances(tx,schoolId,id);if(input.parts.some(part=>!parts.some(issued=>issued.id===part.part_id)))throw new UnprocessableEntityException('A received part does not belong to this loan.');
   loan=await this.advance(tx,loan);
   const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,action,{observed_at:observed,reason:input.reason,supersedes_receipt_id:input.supersedes_receipt_id??null});
   if(input.parts.length)await tx.insertInto('resource_loan_receipt_parts').values(input.parts.map(part=>({school_id:schoolId,loan_id:id,receipt_id:receipt.id,...part}))).execute();
   const current=await this.balances(tx,schoolId,id);if(current.some(part=>part.outstanding_quantity<0))throw new UnprocessableEntityException('Received quantities cannot exceed the parts actually issued.');
   if(input.correction&&current.some(part=>part.outstanding_quantity>0||part.condition!=='usable')&&(await sql`SELECT 1 FROM resource_loans WHERE school_id=${schoolId}::uuid AND holding_id=${loan.holding_id}::uuid AND issue_order>${loan.issue_order}::bigint LIMIT 1`.execute(tx)).rows.length)
    throw new UnprocessableEntityException('This resource was issued again. A historical correction cannot reopen or hold somebody else’s custody. Review the current loan.');
   await this.model.finish(tx,user,loan,receipt,prepared.prepared,await this.audience(tx,loan));return this.detailIn(tx,user,loan);
  });
 }
 async changeDue(user:AuthUser,schoolId:string,id:string,body:unknown) {
  const input=resourceLoanDue.parse(body);return this.db.transaction().execute(async tx=>{
   await this.access.campus(tx,user,schoolId);let loan=await this.loan(tx,schoolId,id,true);const actor=await this.access.operator(tx,user,schoolId,loan.custodian_person_id);
   const prepared=await this.model.prepare(tx,user,actor,loan,'due_changed',input,loan.revision,{custodian_person_id:loan.custodian_person_id,permission:'resources.manage'});if(prepared.replay)return this.detailIn(tx,user,loan);
   const due=new Date(input.due_at);if(due<=loan.issued_at||due.getTime()===loan.due_at.getTime())throw new UnprocessableEntityException('Choose a changed due time after issue.');
   if((await this.balances(tx,schoolId,id)).every(part=>part.outstanding_quantity===0))throw new UnprocessableEntityException('A fully received loan has no due date to extend.');
   const prior=loan.due_at;loan=await this.advance(tx,loan,due);const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,'due_changed',{due_at:due,previous_due_at:prior,reason:input.reason});
   await this.model.finish(tx,user,loan,receipt,prepared.prepared,await this.audience(tx,loan));return this.detailIn(tx,user,loan);
  });
 }
 async custodianOptions(user:AuthUser,schoolId:string,id:string,raw:unknown={}) {
  const input=resourceLoanCustodianOptions.parse(raw);
  return this.db.transaction().execute(async tx=>{
   await this.access.campus(tx,user,schoolId);const loan=await this.loan(tx,schoolId,id);
   const authority=await this.custodyAuthority(tx,user,loan),pattern=`%${input.search.replace(/[\\%_]/g,'\\$&')}%`;
   const endpoints=await this.access.identities.listCurrentAccountEndpoints(tx,{school_id:schoolId,at:executionNow().toISOString()});
   const candidates=sql`FROM jsonb_to_recordset(${JSON.stringify(endpoints)}::jsonb) AS endpoint(person_id uuid,user_id uuid)
    JOIN school_people person ON person.id=endpoint.person_id AND person.school_id=${schoolId}::uuid
    WHERE person.retired_at IS NULL AND person.id<>${loan.custodian_person_id}::uuid
      AND institution_resource_actor_can_manage(${schoolId}::uuid,endpoint.user_id)
      AND concat_ws(' ',person.first_name,person.last_name) ILIKE ${pattern}`;
   const people=(await sql<{id:string;label:string}>`SELECT DISTINCT person.id,concat_ws(' ',person.first_name,person.last_name) AS label ${candidates}
     ORDER BY label,person.id LIMIT 10 OFFSET ${(input.page-1)*10}`.execute(tx)).rows;
   const total=(await sql<{total:number}>`SELECT count(DISTINCT person.id)::int AS total ${candidates}`.execute(tx)).rows[0]!.total;
   return {people,recovery:authority.basis==='orphan_recovery',pagination:{page:input.page,page_size:10,total}};
  });
 }
 async changeCustodian(user:AuthUser,schoolId:string,id:string,body:unknown) {
  const input=resourceLoanCustody.parse(body);
  return this.db.transaction().execute(async tx=>{
   const actor=await this.access.operator(tx,user,schoolId);let loan=await this.loan(tx,schoolId,id,true);
   const retained=await this.model.retained(tx,user,schoolId,input.command_id);
   const accepted=retained?.state==='completed'&&await tx.selectFrom('resource_loan_receipts').selectAll().where('school_id','=',schoolId).where('loan_id','=',id).where('command_id','=',retained.receipt.command_id).where('action','=','custody_changed').executeTakeFirst();
   const authority=accepted&&accepted.actor_person_id===actor.person_id&&accepted.custodian_person_id===input.custodian_person_id
    ?{actor,basis:accepted.custody_basis!}:await this.custodyAuthority(tx,user,loan);
   const questions=await tx.selectFrom('resource_loan_questions').selectAll().where('school_id','=',schoolId).where('loan_id','=',id).where('state','=','open').forUpdate().execute();
   if(questions.length>1)throw new ConflictException('More than one open question needs source review before responsibility can change.');
   const question=questions[0],previousTrace=!retained&&question?await this.model.questionTrace(tx,loan,question):null;
   if(previousTrace&&!previousTrace.message_open)throw new ConflictException('The open question’s current work is no longer active. Review its route before changing responsibility.');
   const prepared=await this.model.prepare(tx,user,actor,loan,'custody_changed',input,loan.revision,{permission:'resources.manage',custodian_person_id:loan.custodian_person_id,custody_basis:authority.basis},previousTrace);
   if(prepared.replay)return this.detailIn(tx,user,loan);
   if(input.custodian_person_id===loan.custodian_person_id)throw new UnprocessableEntityException('Choose a different person to take responsibility.');
   const next=await this.recipient(tx,{school_id:schoolId,custodian_person_id:input.custodian_person_id});
   const previous=loan.custodian_person_id;
   const previousRoute=question?.coordination_receipt as {message_ids?:string[]}|undefined;
   if(question&&previousRoute?.message_ids?.length!==1)throw new ConflictException('The open question’s exact work receipt is unavailable. No responsibility was changed.');
   loan=await tx.updateTable('resource_loans').set({custodian_person_id:next.person_id,revision:loan.revision+1}).where('school_id','=',schoolId).where('id','=',id).where('revision','=',loan.revision).returningAll().executeTakeFirstOrThrow();
   const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,'custody_changed',{previous_custodian_person_id:previous,custodian_person_id:next.person_id,custody_basis:authority.basis,reason:input.reason,question_id:question?.id??null,previous_question_message_id:previousRoute?.message_ids?.[0]??null});
   const route=question?await this.model.configureQuestion(tx,user,loan,question.id,input.command_id,next,'custody_changed'):undefined;
   const result=await this.model.finish(tx,user,loan,receipt,prepared.prepared,await this.audience(tx,loan),route,previousTrace);
   if(question)await tx.updateTable('resource_loan_questions').set({coordination_receipt:result.route}).where('school_id','=',schoolId).where('id','=',question.id).execute();
   return this.detailIn(tx,user,loan);
  });
 }
 async ask(user:AuthUser,schoolId:string,id:string,body:unknown) {
  const input=resourceLoanQuestion.parse(body);return this.db.transaction().execute(async tx=>{
   const actor=await this.access.campus(tx,user,schoolId);let loan=await this.loan(tx,schoolId,id,true);
   if(actor.person_id!==loan.borrower_person_id)throw new ForbiddenException('Only this exact borrower can submit its private question or return claim.');
   const prepared=await this.model.prepare(tx,user,actor,loan,'question_asked',input,loan.revision,{borrower_person_id:loan.borrower_person_id});if(prepared.replay)return this.detailIn(tx,user,loan);
   if(await tx.selectFrom('resource_loan_questions').select('id').where('school_id','=',schoolId).where('loan_id','=',id).where('state','=','open').executeTakeFirst())throw new UnprocessableEntityException('Continue the open question instead of sending another one.');
   const claimed=input.claimed_return_at?new Date(input.claimed_return_at):null;
   if(claimed&&(claimed<loan.issued_at||claimed>executionNow()))throw new UnprocessableEntityException('A reported return claim must be between issue and the current selected-world time.');
   let recipient:{person_id:string;user_id:string};
   try{recipient=await this.recipient(tx,loan);}catch(error){if(error instanceof ConflictException||error instanceof ForbiddenException)throw new UnprocessableEntityException('The named custodian cannot currently receive this question. No question was sent; ask the campus to restore the exact custodian’s access.');throw error;}
   loan=await this.advance(tx,loan);
   const question=await tx.insertInto('resource_loan_questions').values({id:randomUUID(),school_id:schoolId,loan_id:id,reporter_person_id:actor.person_id,kind:input.kind,note:input.note,revision:loan.revision,created_at:executionNow(),resolved_at:null,claimed_return_at:claimed}).returningAll().executeTakeFirstOrThrow();
   const route=await this.model.configureQuestion(tx,user,loan,question.id,input.command_id,recipient);
   const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,'question_asked',{question_id:question.id,note:input.note,recorded_at:question.created_at});
   const result=await this.model.finish(tx,user,loan,receipt,prepared.prepared,[user.id,recipient.user_id],route);
   await tx.updateTable('resource_loan_questions').set({coordination_receipt:result.route}).where('id','=',question.id).execute();return this.detailIn(tx,user,loan);
  });
 }
 async answer(user:AuthUser,schoolId:string,id:string,questionId:string,body:unknown,resolve=false) {
  const input=resourceLoanReply.parse(body);return this.db.transaction().execute(async tx=>{
   const current=await this.access.campus(tx,user,schoolId);let loan=await this.loan(tx,schoolId,id,true);
   const borrowerReply=!resolve&&current.person_id===loan.borrower_person_id;
   const actor=borrowerReply?current:await this.access.operator(tx,user,schoolId,loan.custodian_person_id),action=resolve?'resolved':'replied';
   const authority=borrowerReply?{borrower_person_id:loan.borrower_person_id}:{custodian_person_id:loan.custodian_person_id,permission:'resources.manage'};
   const prepared=await this.model.prepare(tx,user,actor,loan,action,{...input,question_id:questionId},loan.revision,authority);if(prepared.replay)return this.detailIn(tx,user,loan);
   const question=await tx.selectFrom('resource_loan_questions').selectAll().where('school_id','=',schoolId).where('loan_id','=',id).where('id','=',questionId).forUpdate().executeTakeFirst();
   if(!question||question.state!=='open')throw new UnprocessableEntityException('This exact question is no longer open.');
   loan=await this.advance(tx,loan);const receipt=await this.receipt(tx,user,loan,actor.person_id,prepared.prepared.command_id,action,{question_id:question.id,note:input.note});
   if(resolve)await tx.updateTable('resource_loan_questions').set({state:'resolved',resolved_at:receipt.recorded_at}).where('school_id','=',schoolId).where('id','=',questionId).execute();
   const result=await this.model.finish(tx,user,loan,receipt,prepared.prepared,await this.audience(tx,loan));
   if(resolve)await this.model.resolveQuestion(tx,user,loan,question,result.outbox_id,prepared.prepared.command_id);
   return this.detailIn(tx,user,loan);
  });
 }
 async confirmation(user:AuthUser,schoolId:string,id:string,commandId:string) {
  return this.db.transaction().execute(async tx=>{
   const actor=await this.access.campus(tx,user,schoolId),receipt=await this.model.retained(tx,user,schoolId,commandId);
   const loan=await tx.selectFrom('resource_loans').selectAll().where('school_id','=',schoolId).where('id','=',id).executeTakeFirst();
   if(loan)await this.readable(tx,user,loan);else await this.access.operator(tx,user,schoolId);
   if(!receipt)return {state:'not_found' as const};if(receipt.actor_agent_id!==actor.agent_id||receipt.target.domain!=='resource_loans'||receipt.target.domain_id!==id)throw new ConflictException('This confirmation belongs to another loan or actor.');
   if(loan){if(receipt.command_type==='resource_loans.question.ask'||receipt.command_type==='resource_loans.question.reply'&&actor.person_id===loan.borrower_person_id){if(actor.person_id!==loan.borrower_person_id)throw new ForbiddenException('Only the current exact borrower can confirm this question.');}
    else if(receipt.command_type==='resource_loans.custody.change'&&receipt.state==='completed'&&receipt.receipt.terminal_state==='accepted'){
     await this.access.operator(tx,user,schoolId);
     if(!await tx.selectFrom('resource_loan_receipts').select('id').where('school_id','=',schoolId).where('loan_id','=',id).where('command_id','=',receipt.receipt.command_id).where('action','=','custody_changed').where('actor_person_id','=',actor.person_id).executeTakeFirst())throw new ForbiddenException('Only the currently authorized original signer can confirm this handover.');
    }else await this.access.operator(tx,user,schoolId,loan.custodian_person_id);}
   return receipt.state==='pending'?{state:'pending' as const}:receipt.receipt.terminal_state!=='accepted'?{state:'not_accepted' as const}:{state:'accepted' as const,result:receipt.receipt.metadata};
  });
 }
 async discovery(user:AuthUser,schoolId:string) {
  try {return await this.db.transaction().execute(async tx=>{const actor=await this.access.campus(tx,user,schoolId),manager=await this.access.manages(tx,user,schoolId);
   const own=await tx.selectFrom('resource_loans').select('id').where('school_id','=',schoolId).where('borrower_person_id','=',actor.person_id).executeTakeFirst();return {can_manage:manager,can_issue:manager,borrower:Boolean(own),has_loans:Boolean(own)};});}
  catch(error){if(error instanceof ForbiddenException)return {can_manage:false,can_issue:false,borrower:false,has_loans:false};throw error;}
 }
 async work(user:AuthUser,schoolId:string):Promise<{needs_me:ResourceLoanWorkRecord[];waiting:ResourceLoanWorkRecord[]}> {
  try {return await this.db.transaction().execute(async tx=>{
   const actor=await this.access.campus(tx,user,schoolId),manager=await this.access.manages(tx,user,schoolId);
   const rows=await tx.selectFrom('resource_loan_questions as question').innerJoin('resource_loans as loan','loan.id','question.loan_id').innerJoin('school_people as custodian','custodian.id','loan.custodian_person_id')
    .select(['question.id','question.loan_id','question.revision','question.created_at','question.coordination_receipt','loan.item_name','loan.borrower_person_id','loan.custodian_person_id','custodian.first_name','custodian.last_name'])
    .where('question.school_id','=',schoolId).where('question.state','=','open').where(eb=>eb.or([eb('loan.borrower_person_id','=',actor.person_id),eb('loan.custodian_person_id','=',actor.person_id)])).orderBy('question.created_at').execute();
   const needs_me:ResourceLoanWorkRecord[]=[],waiting:ResourceLoanWorkRecord[]=[];
   const recipients=new Map<string,Promise<{person_id:string;user_id:string}|null>>();
   const currentRecipient=(personId:string)=>{
    if(personId===actor.person_id)return Promise.resolve(manager?{person_id:actor.person_id,user_id:user.id}:null);
    let pending=recipients.get(personId);
    if(!pending){pending=this.recipient(tx,{school_id:schoolId,custodian_person_id:personId}).catch((error:unknown)=>{
     if(error instanceof ConflictException||error instanceof ForbiddenException)return null;throw error;
    });recipients.set(personId,pending);}return pending;
   };
   for(const row of rows){const receipt=row.coordination_receipt as {message_ids?:string[];source_revision?:number};let reviewer:{user_id:string|null;label:string}={user_id:null,label:label(row.first_name,row.last_name)};let ready=true;
    const recipient=await currentRecipient(row.custodian_person_id);ready=recipient!==null;reviewer={...reviewer,user_id:recipient?.user_id??null};
    const record:ResourceLoanWorkRecord={id:`resource-question:${row.id}`,loan_id:row.loan_id,question_id:row.id,revision:receipt.source_revision??row.revision,title:`Borrowing question · ${row.item_name}`,state:ready?'review_needed':'needs_reassignment',href:`${resourceLoanHref(row.loan_id)}&question_id=${encodeURIComponent(row.id)}`,created_at:iso(row.created_at)!,due_at:null,message_id:receipt.message_ids?.[0]??null,reviewer};
    if(row.custodian_person_id===actor.person_id&&manager&&ready)needs_me.push(record);
    if(row.borrower_person_id===actor.person_id)waiting.push({...record,state:ready?'waiting_for_review':'needs_reassignment'});
   }return {needs_me,waiting};
  });}catch(error){if(error instanceof ForbiddenException)return {needs_me:[],waiting:[]};throw error;}
 }
}
