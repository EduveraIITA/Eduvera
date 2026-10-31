import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { RequestsService } from "../src/requests/requests.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { classPracticeServices, createClassPracticeFixture } from "./class-practice.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/practice_unused_test";
const targetUrl = process.env.CLASS_PRACTICE_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
describe.skipIf(!enabled)("class practice native publication and reported completion", () => {
  it("publishes immutable text once, opens an older exact source and completes/reopens without acknowledgement", async () => {
    const f = await createClassPracticeFixture(db), input = f.input({ date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) });
    const accepted = await f.practice.publish(f.teacher, input);
    expect(await f.practice.publish(f.teacher, input)).toEqual({ ...accepted, replayed: true });
    await expect(f.practice.publish(f.teacher, { ...input, title: "Changed payload" })).rejects.toThrow("different work");
    expect((await f.school.exactDiaryItem(f.learner.actor, accepted.id, f.learner.id))).toMatchObject({ title: input.title, completed: false, acknowledged: false });
    const complete = { command_id: randomUUID() };
    await f.school.setHomeworkCompleted(f.learner.actor, accepted.id, f.learner.id, true, complete);
    expect((await f.practice.detail(f.teacher, accepted.id, f.classId)).progress).toMatchObject({ total: 2, completed: 1 });
    await expect(f.practice.detail(f.teacher,accepted.id,f.classId,"2")).rejects.toThrow("first page");
    await f.school.setHomeworkCompleted(f.guardian, accepted.id, f.learner.id, false, { command_id: randomUUID() });
    // Replaying the first accepted command is a receipt read, not a new completion.
    await f.school.setHomeworkCompleted(f.learner.actor, accepted.id, f.learner.id, true, complete);
    expect(await f.school.exactDiaryItem(f.learner.actor, accepted.id, f.learner.id)).toMatchObject({ completed: false, acknowledged: false });
    expect((await db.selectFrom("diary_items").select("id").where("school_id", "=", f.schoolId).execute())).toHaveLength(1);
    const events = await db.selectFrom("event_outbox").select(["payload"]).where("school_id", "=", f.schoolId).where("aggregate_type", "=", "homework_completion").orderBy("sequence").execute();
    expect(events.map(row => (row.payload as { action: string }).action)).toEqual(["completed", "reopened"]);
    const requests = new RequestsService(db);
    const scope = { school_id: f.schoolId, school_name: "Practice", timezone: "UTC", student_id: f.learner.id, student_name: "Sana" };
    const work = await Reflect.get(requests, "homeworkWorkspaceItems").call(requests, f.learner.actor, scope, "self") as Array<{ id:string;href:string;occurs_at:string|null }>;
    expect(work).toContainEqual(expect.objectContaining({ id: `homework_completion:${f.learner.id}:${accepted.id}`, href: expect.stringContaining(`diary_item=${accepted.id}`) }));
    expect(work.find(item => item.id === `homework_completion:${f.learner.id}:${accepted.id}`)).toMatchObject({ occurs_at: null,
      href: expect.stringContaining(`date=${input.date}`) });
  });
  it("keeps each learner thread private, retains teacher replies and never copies private text into Core or events", async () => {
    const f = await createClassPracticeFixture(db), item = await f.practice.publish(f.teacher, f.input());
    const secret = `PRIVATE-${randomUUID()}`, note = { command_id: randomUUID(), note_id: randomUUID() };
    await f.school.addDiaryNote(f.learner.actor, item.id, f.learner.id, secret, note);
    await f.school.addDiaryNote(f.learner.actor, item.id, f.learner.id, secret, note);
    const detail = await f.practice.detail(f.teacher, item.id, f.classId, undefined, f.learner.id);
    expect(detail.thread).toHaveLength(1);
    const reply = { command_id: randomUUID(), note_id: randomUUID(), student_id: f.learner.id, body: "Use the second example." };
    await f.practice.note(f.teacher, item.id, reply, true);
    expect(await f.practice.note(f.teacher, item.id, reply, true)).toMatchObject({ replayed: true });
    expect((await f.school.exactDiaryItem(f.guardian, item.id, f.learner.id)).notes).toHaveLength(2);
    expect((await f.school.exactDiaryItem(f.secondLearner.actor, item.id, f.secondLearner.id)).notes).toEqual([]);
    for (const actor of [f.owner, f.otherTeacher, f.secondLearner.actor]) await expect(f.practice.detail(actor, item.id, f.classId, undefined, f.learner.id)).rejects.toThrow();
    await expect(f.practice.note(f.otherTeacher, item.id, { ...reply, command_id: randomUUID(), note_id: randomUUID() }, true)).rejects.toThrow();
    const commands = await db.selectFrom("campus_model_commands").select(["safe_context", "authority_evidence"]).where("school_id", "=", f.schoolId).execute();
    const events = await db.selectFrom("event_outbox").select("payload").where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify(commands)).not.toContain(secret);expect(JSON.stringify(events)).not.toContain(secret);
  });
  it("denies titles, another campus/class/term, revoked assignment and ended acting endpoints", async () => {
    const f = await createClassPracticeFixture(db), foreign = await createClassPracticeFixture(db);
    for (const actor of [f.owner, f.otherTeacher, f.learner.actor, f.guardian]) await expect(f.practice.publish(actor, f.input())).rejects.toThrow();
    await expect(f.practice.publish(f.teacher, f.input({ class_section_id: foreign.classId }))).rejects.toThrow();
    await expect(f.practice.publish(f.teacher, f.input({ term_id: foreign.termId }))).rejects.toThrow();
    const accepted = await f.practice.publish(f.teacher, f.input());
    await expect(f.school.setHomeworkCompleted(f.teacher, accepted.id, f.learner.id, true)).rejects.toThrow();
    await expect(f.school.setHomeworkCompleted(f.guardian, accepted.id, f.secondLearner.id, true)).rejects.toThrow();
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
    await expect(f.practice.detail(f.teacher, accepted.id, f.classId)).rejects.toThrow("assignment");
    await expect(f.practice.publish(f.teacher, f.input())).rejects.toThrow("assignment");
    const g = await createClassPracticeFixture(db);
    await db.transaction().execute(tx=>g.core.closeAccountEndpoint(tx,{school_id:g.schoolId,endpoint_id:g.teacherEndpoint.endpoint_id,
      actor_user_id:g.owner.id,expected_revision:1,effective_at:new Date().toISOString(),disposition:"ended",reason:"Synthetic ended endpoint test",
      source_domain:"staff_operations",source_record_id:g.teacherEndpoint.person_id,source_revision:1,idempotency_key:`practice-endpoint:${randomUUID()}`}));
    expect(await db.selectFrom("users").select("is_active").where("id","=",g.teacher.id).executeTakeFirstOrThrow()).toMatchObject({is_active:true});
    await expect(g.practice.publish(g.teacher,g.input())).rejects.toThrow("account link");
  });
  it("rolls back native publication if the typed outcome or event fails, and retries cleanly", async () => {
    const f = await createClassPracticeFixture(db), input = f.input();
    const failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected outcome failure"));
    await expect(f.practice.publish(f.teacher, input)).rejects.toThrow("Injected outcome failure");
    expect(await db.selectFrom("diary_items").select("id").where("id", "=", input.practice_id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("event_outbox").select("id").where("school_id", "=", f.schoolId).where("aggregate_type", "=", "class_practice").execute()).toEqual([]);
    failure.mockRestore();
    expect(await f.practice.publish(f.teacher, input)).toMatchObject({ id: input.practice_id, replayed: false });
  });
  it("denies exact progress/private reads after an acting endpoint ends while account, profile and assignment remain active",async()=>{
    const f=await createClassPracticeFixture(db),item=await f.practice.publish(f.teacher,f.input());
    await f.school.addDiaryNote(f.learner.actor,item.id,f.learner.id,"Retained private question",{command_id:randomUUID(),note_id:randomUUID()});
    expect(await f.practice.detail(f.teacher,item.id,f.classId,undefined,f.learner.id)).toMatchObject({thread:[{body:"Retained private question"}]});
    const close=async(userId:string)=>db.transaction().execute(async tx=>{
      const endpoint=await f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:userId,at:new Date().toISOString()});
      if(!endpoint.acting)throw new Error("Expected an active fixture endpoint");
      await f.core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:endpoint.endpoint_id,actor_user_id:f.owner.id,expected_revision:1,
        effective_at:new Date().toISOString(),disposition:"ended",reason:"Synthetic ended-read endpoint",source_domain:"people",
        source_record_id:endpoint.person_id,source_revision:1,idempotency_key:`practice-read-endpoint:${randomUUID()}`});
    });
    await close(f.teacher.id);
    expect(await db.selectFrom("users").select("is_active").where("id","=",f.teacher.id).executeTakeFirstOrThrow()).toEqual({is_active:true});
    expect(await db.selectFrom("school_memberships").select("is_active").where("school_id","=",f.schoolId).where("user_id","=",f.teacher.id).executeTakeFirstOrThrow()).toEqual({is_active:true});
    expect(await db.selectFrom("staff_profiles").select("status").where("school_id","=",f.schoolId).where("user_id","=",f.teacher.id).executeTakeFirstOrThrow()).toEqual({status:"active"});
    expect(await db.selectFrom("staff_responsibility_assignments").select("status").where("id","=",f.assignmentId).executeTakeFirstOrThrow()).toEqual({status:"active"});
    await expect(f.practice.list(f.teacher,f.classId)).rejects.toThrow("account link");
    await expect(f.practice.detail(f.teacher,item.id,f.classId)).rejects.toThrow("account link");
    await expect(f.practice.detail(f.teacher,item.id,f.classId,undefined,f.learner.id)).rejects.toThrow("account link");
    for(const actor of [f.learner.actor,f.guardian]){
      expect(await f.school.exactDiaryItem(actor,item.id,f.learner.id)).toMatchObject({notes:[{body:"Retained private question"}]});
      await close(actor.id);
      expect(await db.selectFrom("school_memberships").select("is_active").where("school_id","=",f.schoolId).where("user_id","=",actor.id).executeTakeFirstOrThrow()).toEqual({is_active:true});
      await expect(f.school.exactDiaryItem(actor,item.id,f.learner.id)).rejects.toThrow("account link");
    }
  });
  it("replays an accepted publication after its due time passes but rejects a new already-overdue publication",async()=>{
    const f=await createClassPracticeFixture(db);let now=`${f.date}T08:00:00.000Z`;
    const world=createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}});
    await executionEnvironmentStorage.run(world,async()=>{
      const input=f.input({due_at:`${f.date}T09:00:00.000Z`}),accepted=await f.practice.publish(f.teacher,input);
      now=`${f.date}T10:00:00.000Z`;
      expect(await f.practice.publish(f.teacher,input)).toMatchObject({id:accepted.id,replayed:true});
      await expect(f.practice.publish(f.teacher,f.input({due_at:`${f.date}T09:00:00.000Z`}))).rejects.toThrow("future due");
    });
  });
  it("keeps subject-scoped messaging independent from learning authority",async()=>{
    const f=await createClassPracticeFixture(db);
    const subjects=await db.insertInto("subjects").values([{school_id:f.schoolId,code:"MATH",name:"Math",short_name:"Math"},{school_id:f.schoolId,code:"ENG",name:"English",short_name:"Eng"}]).returning(["id","code"]).execute();
    const math=subjects.find(subject=>subject.code==="MATH")!.id,english=subjects.find(subject=>subject.code==="ENG")!.id;
    await db.updateTable("staff_responsibility_types").set({capability_permissions:["learning.work.publish"]}).where("id","=",f.roleId).execute();
    const assignment=await db.updateTable("staff_responsibility_assignments").set({subject_id:math}).where("id","=",f.assignmentId).returningAll().executeTakeFirstOrThrow();
    const role=await db.insertInto("staff_responsibility_types").values({school_id:f.schoolId,code:`message_${randomUUID().slice(0,8)}`,name:"English messages",category:"academic",scope_kind:"class_section",context_kind:"class",workflow_family:"class_messages",source_kind:"institute",cloned_from_type_id:null,capability_permissions:["messages.view","messages.send"],requires_acceptance:false,updated_by:f.owner.id}).returning("id").executeTakeFirstOrThrow();
    const messaging=await db.insertInto("staff_responsibility_assignments").values({school_id:f.schoolId,responsibility_type_id:role.id,staff_profile_id:assignment.staff_profile_id,class_section_id:f.classId,subject_id:english,event_id:null,starts_on:assignment.starts_on,ends_on:null,starts_at:null,ends_at:null,status:"active",assigned_by:f.owner.id,revoked_by:null,revoked_at:null,backup_staff_profile_id:null}).returning("id").executeTakeFirstOrThrow();
    expect(await f.practice.list(f.teacher,f.classId)).toMatchObject({can_publish_general:false,subjects:[{id:math,name:"Math"}]});
    const item=await f.practice.publish(f.teacher,f.input({subject_id:math}));
    await f.school.addDiaryNote(f.learner.actor,item.id,f.learner.id,"Math question",{command_id:randomUUID(),note_id:randomUUID()});
    const questionEvent=await db.selectFrom("event_outbox").select("audience_user_ids").where("aggregate_id","=",item.id).orderBy("sequence","desc").executeTakeFirstOrThrow();
    expect(questionEvent.audience_user_ids).not.toContain(f.teacher.id);
    expect(await f.practice.detail(f.teacher,item.id,f.classId)).toMatchObject({can_reply:false});
    const reply={command_id:randomUUID(),note_id:randomUUID(),student_id:f.learner.id,body:"Math response"};
    await expect(f.practice.note(f.teacher,item.id,reply,true)).rejects.toThrow("messaging assignment");
    await db.updateTable("staff_responsibility_assignments").set({subject_id:null}).where("id","=",messaging.id).execute();
    expect(await f.practice.note(f.teacher,item.id,reply,true)).toMatchObject({replayed:false});
    const replyEvent=await db.selectFrom("event_outbox").select("audience_user_ids").where("aggregate_id","=",item.id).orderBy("sequence","desc").executeTakeFirstOrThrow();
    expect(replyEvent.audience_user_ids).toContain(f.teacher.id);
  });
  it("uses effective learner/guardian audiences and shows the latest finite private thread",async()=>{
    const f=await createClassPracticeFixture(db),tomorrow=new Date(Date.now()+86_400_000).toISOString().slice(0,10);
    await db.updateTable("enrollments").set({enrolled_on:tomorrow}).where("student_id","=",f.secondLearner.id).execute();
    const item=await f.practice.publish(f.teacher,f.input());
    const published=await db.selectFrom("event_outbox").select("audience_user_ids").where("aggregate_id","=",item.id).where("aggregate_type","=","class_practice").executeTakeFirstOrThrow();
    expect(published.audience_user_ids).not.toContain(f.secondLearner.actor.id);
    await db.updateTable("school_memberships").set({role:"member"}).where("school_id","=",f.schoolId).where("user_id","=",f.guardian.id).execute();
    await expect(f.school.exactDiaryItem(f.guardian,item.id,f.learner.id)).rejects.toThrow();
    await f.school.addDiaryNote(f.learner.actor,item.id,f.learner.id,"Only current guardians",{command_id:randomUUID(),note_id:randomUUID()});
    const lastEvent=await db.selectFrom("event_outbox").select("audience_user_ids").where("aggregate_id","=",item.id).orderBy("sequence","desc").executeTakeFirstOrThrow();
    expect(lastEvent.audience_user_ids).not.toContain(f.guardian.id);
    await db.insertInto("diary_notes").values(Array.from({length:101},(_,index)=>({id:randomUUID(),item_id:item.id,student_id:f.learner.id,author_id:f.learner.actor.id,body:`Thread entry ${index}`,created_at:new Date(Date.now()+index+10)}))).execute();
    const thread=(await f.practice.detail(f.teacher,item.id,f.classId,undefined,f.learner.id)).thread as Array<{body:string}>;
    expect(thread).toHaveLength(100);expect(thread.at(-1)?.body).toBe("Thread entry 100");expect(thread.some(note=>note.body==="Thread entry 0")).toBe(false);
  });
  it.runIf(Boolean(targetUrl))("runs publication, private replies and paused-time replay in COW without changing Live or sibling", async () => {
    const f=await createClassPracticeFixture(db);
    const liveItem=await f.practice.publish(f.teacher,f.input({title:"Live practice retained"}));
    const now=new Date().toISOString();
    const store=new SimulationSnapshotStore(url,requireIsolatedTestDatabaseUrl(targetUrl),2),opened:Kysely<Database>[]=[];
    try{
      const captured=await store.capture(f.schoolId,now);
      const open=async()=>{
        const runId=randomUUID(),scenarioId=randomUUID(),namespace=`scenario:${scenarioId}:run:${runId}` as const;
        const branch=await createSimulationBranch(store.pool,captured,{run_id:runId,school_id:f.schoolId,scenario_id:scenarioId,namespace_id:namespace});
        const driver=new SimulationBranchDriver(store.pool,branch,captured),compiler=new PostgresDialect({pool:store.pool});
        const database=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:connection=>compiler.createIntrospector(connection)}}) as DatabaseService;
        opened.push(database);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:now,source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:"class-practice-test",checked_at:now});
        return{...classPracticeServices(database),database,namespace,run:<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action)};
      };
      const world=await open(),sibling=await open(),input=f.input({title:"Scenario practice only"});
      await world.run(async()=>{
        expect((await sql<{ok:boolean}>`SELECT 'learning.work.publish'=ANY(staff_role_allowed_permissions('class')) AS ok`.execute(world.database)).rows[0]?.ok).toBe(true);
        const item=await world.practice.publish(f.teacher,input);
        expect(await world.practice.publish(f.teacher,input)).toMatchObject({id:item.id,replayed:true});
        const complete={command_id:randomUUID()};
        await world.school.setHomeworkCompleted(f.learner.actor,item.id,f.learner.id,true,complete);
        await world.school.addDiaryNote(f.learner.actor,item.id,f.learner.id,"Private scenario question",{command_id:randomUUID(),note_id:randomUUID()});
        await world.practice.note(f.teacher,item.id,{command_id:randomUUID(),note_id:randomUUID(),student_id:f.learner.id,body:"Scenario reply"},true);
        await world.school.setHomeworkCompleted(f.guardian,item.id,f.learner.id,false,{command_id:randomUUID()});
        await world.school.setHomeworkCompleted(f.learner.actor,item.id,f.learner.id,true,complete);
        expect(await world.school.exactDiaryItem(f.learner.actor,item.id,f.learner.id)).toMatchObject({completed:false,notes:expect.arrayContaining([expect.objectContaining({body:"Scenario reply"})])});
        await world.school.setHomeworkCompleted(f.learner.actor,item.id,f.learner.id,true,{command_id:randomUUID()});
        expect((await world.practice.detail(f.teacher,item.id,f.classId)).progress).toMatchObject({total:2,completed:1});
        const commands=await world.database.selectFrom("campus_model_commands").select(["environment_namespace_id","state"]).where("source_domain","=","learning_diary").where("correlation_id","=",input.command_id).execute();
        expect(commands).toEqual([{environment_namespace_id:world.namespace,state:"accepted"}]);
        const outcomes=(await sql<{environment_namespace_id:string}>`SELECT outcome.environment_namespace_id FROM campus_model_command_outcomes outcome
          JOIN campus_model_commands command ON command.id=outcome.command_id WHERE command.correlation_id=${input.command_id}::uuid`.execute(world.database)).rows;
        expect(outcomes).toEqual([{environment_namespace_id:world.namespace}]);
        await world.database.transaction().execute(tx=>world.core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:f.teacherEndpoint.endpoint_id,
          actor_user_id:f.owner.id,expected_revision:1,effective_at:now,disposition:"ended",reason:"Scenario-only ended read identity",
          source_domain:"people",source_record_id:f.teacherEndpoint.person_id,source_revision:1,idempotency_key:`practice-world-endpoint:${randomUUID()}`}));
        await expect(world.practice.list(f.teacher,f.classId)).rejects.toThrow("account link");
        await expect(world.practice.detail(f.teacher,item.id,f.classId,undefined,f.learner.id)).rejects.toThrow("account link");
      });
      for(const selected of [f,{...sibling}]){
        const check=async()=>{
          expect((await selected.practice.list(f.teacher,f.classId)).items.map(item=>item.id)).toEqual([liveItem.id]);
          expect(await selected.school.exactDiaryItem(f.learner.actor,liveItem.id,f.learner.id)).toMatchObject({completed:false,notes:[]});
          await expect(selected.school.exactDiaryItem(f.learner.actor,input.practice_id,f.learner.id)).rejects.toThrow();
          const database="database" in selected?selected.database:db;
          expect(await database.selectFrom("diary_notes").select("id").where("item_id","=",input.practice_id).execute()).toEqual([]);
          expect(await database.selectFrom("event_outbox").select("id").where("aggregate_id","=",input.practice_id).execute()).toEqual([]);
        };
        if("run" in selected)await selected.run(check);else await check();
      }
      expect((await db.selectFrom("staff_responsibility_types").select("capability_permissions").where("id","=",f.roleId).executeTakeFirstOrThrow()).capability_permissions).toEqual(["learning.work.publish","messages.view","messages.send"]);
    }finally{await Promise.all(opened.map(database=>database.destroy()));await store.pool.end();}
  },120_000);
});
