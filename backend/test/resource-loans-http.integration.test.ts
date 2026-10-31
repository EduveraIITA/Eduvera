import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { academicScaffoldingCounts, createLearningOfferingFixture } from "./learning-offerings.test-support.js";
import { IsolatedAppHttp, type IsolatedHttpSession } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { createResourceLoanFixture } from "./resource-loans.test-support.js";
import { addResourceCustodian } from "./resource-custody.test-support.js";

const enabled=process.env.TEST_DATABASE_ISOLATED==="true" || process.env.RESOURCE_LOANS_HTTP_TEST_ISOLATED==="true";
const sourceUrl=enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/resources_http_unused_test";
types.setTypeParser(1082,value=>value);
const database=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:sourceUrl,max:3})})}) as DatabaseService;
const app=new IsolatedAppHttp();
interface Loan {
  id:string;revision:number;state:string;outstanding_count:number;
  parts:Array<{id:string;label:string;outstanding_quantity:number}>;
  questions:Array<{id:string;state:string;note:string}>;
  history:Array<{id:string;action:string;note:string;supersedes_receipt_id:string|null}>;
}
interface Manifest {areas:Array<{key:string}>;work:{items:Array<{direction:string;source?:{kind:string;id:string};core_trace?:{message_ids:string[]};href:string}>}}
const work=async(session:IsolatedHttpSession,id:string)=>(await session.json<Manifest>("/api/v1/workspace/"))
  .work.items.filter(item=>item.source?.kind==="resource_loan_question" && item.source.id===id);

describe.runIf(enabled)("Resources through the ordinary authenticated API",()=>{
  beforeAll(()=>app.start(sourceUrl),30_000);
  afterAll(async()=>{await app.stop();await database.destroy();},10_000);

  it("hands over exact custody and its open question through the ordinary named responsibility action",async()=>{
    process.env.INVITATION_EMAIL_ENABLED="false";
    const f=await createResourceLoanFixture(database),next=await addResourceCustodian(f),password=`Q4!${randomUUID()}#7zB2`;
    await database.updateTable("users").set({password_hash:await hashPassword(password)}).where("id","in",[f.user.id,f.borrower.id,next.user.id]).execute();
    const owner=app.session(),borrower=app.session(),successor=app.session();
    for(const [session,actor] of [[owner,f.user],[borrower,f.borrower],[successor,next.user]] as const)await session.login(actor.email,password,f.schoolId);
    const base=`/api/v1/schools/${f.schoolId}/resources`,input={command_id:randomUUID(),expected_revision:0,holding_id:f.holdingId,borrower_person_id:f.borrowerPersonId,due_at:new Date(Date.now()+86_400_000).toISOString(),custody_confirmed:true,custody_purpose:"Fictional HTTP responsibility handover"};
    let loan=await owner.json<Loan>(`${base}/loans`,"POST",input);const path=`${base}/loans/${loan.id}`;
    loan=await borrower.json<Loan>(`${path}/questions`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,kind:"question",note:"Please keep my existing question with this loan"});
    const options=await owner.json<{people:Array<{id:string;label:string}>}>(`${path}/custodians`);expect(options.people).toContainEqual({id:next.personId,label:"Farah Successor"});
    expect((await successor.request(`${path}/responsibility`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,custodian_person_id:next.personId,reason:"Unrelated manager cannot take active responsibility"})).status).toBe(403);
    const change={command_id:randomUUID(),expected_revision:loan.revision,custodian_person_id:next.personId,reason:"Farah takes over this lending desk"};
    const changed=await owner.json<Loan>(`${path}/responsibility`,"POST",change);expect(changed).toMatchObject({revision:loan.revision+1,outstanding_count:1});
    expect(await owner.json(`${path}/confirmation?command_id=${change.command_id}`)).toMatchObject({state:"accepted",result:{id:loan.id,revision:changed.revision}});
    expect(await owner.json(`${path}/responsibility`,"POST",change)).toMatchObject({revision:changed.revision});
    const opened=await successor.json<Loan>(path);expect(opened.questions[0]?.note).toBe(loan.questions[0]!.note);
    expect((await owner.json<Loan>(path)).questions).toEqual([]);
    expect((await owner.request(`${path}/returns`,"POST",{command_id:randomUUID(),expected_revision:changed.revision,observed_at:new Date().toISOString(),parts:[{part_id:opened.parts[0]!.id,quantity:1,condition:"usable"}]})).status).toBe(403);
    expect(await work(owner,loan.questions[0]!.id)).toEqual([]);expect(await work(successor,loan.questions[0]!.id)).toMatchObject([{direction:"needs_me"}]);
    loan=await successor.json<Loan>(`${path}/returns`,"POST",{command_id:randomUUID(),expected_revision:changed.revision,observed_at:new Date().toISOString(),parts:[{part_id:opened.parts[0]!.id,quantity:1,condition:"usable"}]});
    expect(loan).toMatchObject({outstanding_count:0,state:"returned"});
    loan=await successor.json<Loan>(`${path}/questions/${loan.questions[0]!.id}/resolve`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,note:"Successor has checked and settled this exact question"});expect(loan.questions[0]!.state).toBe("resolved");
  },60_000);

  it("starts with borrowing alone and resolves a private claimed return without inventing physical receipt",async()=>{
    process.env.INVITATION_EMAIL_ENABLED="false";
    // This helper only provisions a private founder and canonical invited people.
    // It does not create an offering, enrollment, timetable or academic adapter.
    const fixture=await createLearningOfferingFixture(database),password=`Fictional-Resources-${randomUUID()}!`;
    await database.updateTable("users").set({password_hash:await hashPassword(password)})
      .where("id","in",[fixture.owner.id,fixture.learner.actor.id,fixture.secondLearner.actor.id]).execute();
    const custodian=app.session(),borrower=app.session(),other=app.session();
    for(const [session,actor] of [[custodian,fixture.owner],[borrower,fixture.learner.actor],[other,fixture.secondLearner.actor]] as const)
      await session.login(actor.email,password,fixture.schoolId);
    await custodian.json("/api/v1/onboarding/goals/","PUT",{goals:["resources"]});
    const base=`/api/v1/schools/${fixture.schoolId}/resources`;
    expect((await app.session().request(`${base}/workspace`)).status).toBe(401);
    expect((await custodian.json<Manifest>("/api/v1/workspace/")).areas).toContainEqual(expect.objectContaining({key:"resources"}));
    const options=await custodian.json<{campuses:Array<{id:string}>}>(`${base}/options`);
    expect(options.campuses).toEqual([]);
    const campus=await custodian.json<{id:string}>(`/api/v1/schools/${fixture.schoolId}/institution-setup/campuses/`,"POST",{
      name:"Fictional lending room",code:"LEND",campus_type:"main",is_primary:true,status:"active",timezone:"UTC",
    });
    const itemInput={command_id:randomUUID(),name:"Fictional project camera",asset_tag:"QA-CAMERA",quantity:10,campus_id:campus.id};
    expect((await borrower.request(`${base}/items`,"POST",itemInput)).status).toBe(403);
    const item=await custodian.json<{id:string;quantity:number;created_items:Array<{id:string;asset_tag:string}>}>(`${base}/items`,"POST",itemInput);
    expect(item.id).toBe(itemInput.command_id);
    expect(item.quantity).toBe(10);
    expect(item.created_items).toHaveLength(10);
    expect(new Set(item.created_items.map(copy=>copy.id)).size).toBe(10);
    expect(new Set(item.created_items.map(copy=>copy.asset_tag)).size).toBe(10);
    expect(item.created_items.map(copy=>copy.asset_tag)).toEqual(Array.from({length:10},(_,index)=>`QA-CAMERA-${String(index+1).padStart(3,"0")}`));
    expect(await custodian.json(`${base}/items`,"POST",itemInput)).toMatchObject({id:item.id,quantity:10,created_items:item.created_items});
    expect((await custodian.request(`${base}/items`,"POST",{...itemInput,quantity:9})).status).toBe(409);
    const copies=await database.selectFrom("campus_resource_holdings").select(["id","quantity"])
      .where("school_id","=",fixture.schoolId).where("id","in",item.created_items.map(copy=>copy.id)).execute();
    expect(copies).toHaveLength(10);
    expect(copies.every(copy=>Number(copy.quantity)===1)).toBe(true);
    expect(await custodian.json("/api/v1/onboarding/workspace/")).toMatchObject({resume:{step:"first_use"}});
    const issue={command_id:randomUUID(),expected_revision:0,holding_id:item.id,borrower_person_id:fixture.learner.id,
      due_at:new Date(Date.now()+86_400_000).toISOString(),custody_confirmed:true,custody_purpose:"Fictional project work",
      components:[{label:"Charger",quantity:1}]};
    expect((await custodian.request(`${base}/loans`,"POST",issue,false)).status).toBe(403);
    expect((await borrower.request(`${base}/loans`,"POST",issue)).status).toBe(403);
    let loan=await custodian.json<Loan>(`${base}/loans`,"POST",issue);
    expect(loan).toMatchObject({id:issue.command_id,revision:1,state:"outstanding",outstanding_count:2});
    const copyOptions=await custodian.json<{holdings:Array<{id:string;available:boolean}>}>(`${base}/options`);
    expect(copyOptions.holdings.filter(copy=>copy.available && item.created_items.some(created=>created.id===copy.id))).toHaveLength(9);
    expect(await custodian.json(`${base}/loans`,"POST",issue)).toMatchObject({id:loan.id,revision:1});
    const path=`${base}/loans/${loan.id}`,destination=`/areas/resources?loan_id=${loan.id}`;
    expect(await custodian.json(`${path}/confirmation?command_id=${issue.command_id}`)).toMatchObject({state:"accepted",result:{id:loan.id,revision:1}});
    expect(await custodian.json("/api/v1/onboarding/workspace/")).toMatchObject({resume:{step:"operating",path:destination}});
    expect(await custodian.json("/api/v1/auth/me/")).toMatchObject({onboarding:{resume:{step:"operating",path:destination}}});
    await custodian.json("/api/v1/onboarding/resume/","PATCH",{step:"first_use",goal:"resources",path:"/more/setup/capabilities?task=resources"});
    expect(await custodian.json("/api/v1/onboarding/workspace/")).toMatchObject({resume:{step:"operating",path:destination}});
    expect((await borrower.json<Manifest>("/api/v1/workspace/")).areas).toContainEqual(expect.objectContaining({key:"resources"}));
    expect((await other.request(path)).status).toBe(403);
    const privateNote="Fictional borrower reports returning the camera; charger is still with them.";
    loan=await borrower.json<Loan>(`${path}/questions`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,
      kind:"returned_claim",claimed_return_at:new Date().toISOString(),note:privateNote});
    expect(loan.outstanding_count).toBe(2);
    const question=loan.questions[0]!;
    const incoming=await work(custodian,question.id),waiting=await work(borrower,question.id);
    expect(incoming).toMatchObject([{direction:"needs_me",href:`${destination}&question_id=${question.id}`}]);
    expect(waiting).toMatchObject([{direction:"waiting"}]);
    expect(incoming[0]?.core_trace?.message_ids).toEqual(waiting[0]?.core_trace?.message_ids);
    expect(JSON.stringify([incoming,waiting])).not.toContain(privateNote);
    const camera=loan.parts.find(part=>part.label===itemInput.name)!,charger=loan.parts.find(part=>part.label==="Charger")!;
    expect((await borrower.request(`${path}/returns`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,
      observed_at:new Date().toISOString(),parts:[{part_id:camera.id,quantity:1,condition:"usable"}]})).status).toBe(403);
    loan=await custodian.json<Loan>(`${path}/returns`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,
      observed_at:new Date().toISOString(),parts:[{part_id:camera.id,quantity:1,condition:"usable"}]});
    expect(loan).toMatchObject({state:"outstanding",outstanding_count:1});
    expect(loan.parts.find(part=>part.id===charger.id)?.outstanding_quantity).toBe(1);
    let checked=await custodian.json<Loan>(`${path}/questions/${question.id}/replies`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,
      note:"Camera checked in; please return its charger."});
    expect(await work(borrower,question.id)).toHaveLength(1);
    checked=await borrower.json<Loan>(`${path}/questions/${question.id}/replies`,"POST",{command_id:randomUUID(),expected_revision:checked.revision,
      note:"I left the charger at the same desk; please check beside the camera."});
    expect((await borrower.request(`${path}/questions/${question.id}/resolve`,"POST",{command_id:randomUUID(),expected_revision:checked.revision,
      note:"A borrower report cannot close a custodian review."})).status).toBe(403);
    loan=await custodian.json<Loan>(`${path}/returns`,"POST",{command_id:randomUUID(),expected_revision:checked.revision,
      observed_at:new Date().toISOString(),correction:true,reason:"A later charger receipt had not been recorded.",
      parts:[{part_id:charger.id,quantity:1,condition:"usable"}]});
    expect(loan).toMatchObject({state:"returned",outstanding_count:0});
    expect(await work(custodian,question.id)).toHaveLength(1); // Return is not a private question resolution.
    loan=await custodian.json<Loan>(`${path}/questions/${question.id}/resolve`,"POST",{command_id:randomUUID(),expected_revision:loan.revision,
      note:"Camera and charger checked; the loan is settled."});
    expect(loan.questions[0]?.state).toBe("resolved");
    expect(await work(custodian,question.id)).toEqual([]);
    expect(await work(borrower,question.id)).toEqual([]);
    expect(loan.history.map(receipt=>receipt.action)).toEqual(expect.arrayContaining(["issued","question_asked","return_recorded","replied","return_corrected","resolved"]));
    expect(await academicScaffoldingCounts(database,fixture.schoolId)).toEqual({students:0,staff:0,classes:0,terms:0,enrollments:0,guardians:0,roles:0,schedules:0});
  },90_000);
});
