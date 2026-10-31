import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { DomainCommandGatewayPort } from "../src/campus-model-core/domain-command-gateway.port.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Unique synthetic tenant; no reset/migration/global seed/providers. Nonphysical
// assessment deliberately avoids an invigilation/physical-sitting bridge stub.
const enabled=process.env.TEST_DATABASE_ISOLATED==="true"&&Boolean(process.env.SIMULATION_CORRECTION_TEST_TARGET_URL);
const sourceUrl=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused_test";
const targetUrl=enabled?requireIsolatedTestDatabaseUrl(process.env.SIMULATION_CORRECTION_TEST_TARGET_URL):"postgresql://invalid.invalid/unused_world_test";
types.setTypeParser(1082,value=>value);
const database=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:sourceUrl,max:4})})}) as DatabaseService;
afterAll(()=>database.destroy());
const addDays=(value:string,days:number)=>new Date(Date.parse(value)+days*86_400_000).toISOString().slice(0,10);

describe.runIf(enabled)("published result correction through the owning service and real Core worlds",()=>{
  it("preserves the prior release through correction/return/moderation, rejects self-review and atomically replays republication without changing Live/sibling",async()=>{
    const suffix=randomUUID(),scope=new ExecutionDataPlaneScope(),core=new CampusModelCoreService(database,scope);
    const account=async(name:string,role:"admin"|"student")=>database.insertInto("users").values({username:`correction-${name}-${suffix}`,email:`correction-${name}-${suffix}@example.test`,
      password_hash:"isolated-test-only",first_name:name,last_name:"Synthetic",role}).returning(["id","username","email","first_name","last_name","role","is_active"]).executeTakeFirstOrThrow();
    const ownerAccount=await account("Examiner","admin"),schoolId=await database.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(core).createForAccount(tx,ownerAccount,"UTC"));
    const examiner:AuthUser={...ownerAccount,active_school_id:schoolId},moderatorAccount=await account("Moderator","admin"),learnerAccount=await account("Sana","student");
    for(const row of [moderatorAccount,learnerAccount])await database.insertInto("school_memberships").values({school_id:schoolId,user_id:row.id,role:row.role==="admin"?"admin":"student",is_active:true}).execute();
    // Explicit fixture staff contexts exercise personally assigned Work while
    // retaining the administrator/examiner self-moderation safety case.
    for(const actor of[examiner,moderatorAccount])await database.insertInto("school_memberships").values({school_id:schoolId,user_id:actor.id,role:"staff",is_active:true}).execute();
    const moderator:AuthUser={...moderatorAccount,active_school_id:schoolId},learner:AuthUser={...learnerAccount,active_school_id:schoolId};
    await linkFixtureStaffIdentity(database,{school_id:schoolId,user_id:moderator.id,owner_user_id:examiner.id});
    const today=addDays(new Date().toISOString().slice(0,10),1),now=`${today}T12:00:00.000Z`;
    const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}});
    const run=<T>(work:()=>Promise<T>)=>scope.run(environment,()=>executionEnvironmentStorage.run(environment,work));
    const term=await database.insertInto("academic_terms").values({school_id:schoolId,academic_year:"QA2026",name:"Correction term",starts_on:today,ends_on:addDays(today,30),attendance_threshold:"75"}).returning("id").executeTakeFirstOrThrow();
    const section=await database.insertInto("class_sections").values({school_id:schoolId,academic_year:"QA2026",grade:"BCA",section:"QA"}).returning("id").executeTakeFirstOrThrow();
    const subject=await database.insertInto("subjects").values({school_id:schoolId,code:"QA-CORRECTION",name:"Published correction",short_name:"Correction"}).returning("id").executeTakeFirstOrThrow();
    const students:string[]=[];
    for(const [index,name]of["Sana","Asha"].entries()){
      const person=await database.insertInto("school_people").values({school_id:schoolId,first_name:name,last_name:"Synthetic"}).returning("id").executeTakeFirstOrThrow();
      const student=await database.insertInto("students").values({school_id:schoolId,person_id:person.id,user_id:index===0?learner.id:null,admission_number:`QA-C-${index+1}`}).returning("id").executeTakeFirstOrThrow();
      students.push(student.id);await database.insertInto("enrollments").values({student_id:student.id,class_section_id:section.id,term_id:term.id,roll_number:index+1,enrolled_on:today}).execute();
    }
    const observations:Array<{action:string;status:string;revision:number;marks:string|null}>=[];
    const services=(db:DatabaseService)=>{
      const real=new CampusModelCoreService(db,scope);
      // Instrument the real gateway, never replace authority or Core persistence.
      const gateway:DomainCommandGatewayPort={prepareDomainCommand:async(tx,input)=>{
        const source=await tx.selectFrom("assessments").select(["status","revision"]).where("id","=",input.target.domain_id).executeTakeFirstOrThrow();
        const result=await tx.selectFrom("assessment_results").select("marks").where("assessment_id","=",input.target.domain_id).where("student_id","=",students[0]!).executeTakeFirst();
        observations.push({action:input.command_type,status:source.status,revision:source.revision,marks:result?.marks??null});
        return real.prepareDomainCommand(tx,input);
      },completeDomainCommand:(tx,input)=>real.completeDomainCommand(tx,input)};
      return new AssessmentsService(db,new SchoolEventService(db,real),undefined,gateway,real);
    };
    const live=services(database);
    const assessmentId=await run(async()=>{
      const cycle=await live.createCycle(examiner,schoolId,{term_id:term.id,name:"Correction cycle",code:"QA-CORRECTION",starts_on:today,ends_on:addDays(today,30)});
      let state=await live.createAssessment(examiner,schoolId,{cycle_id:cycle.id,class_section_id:section.id,subject_id:subject.id,title:"Programming assignment",assessment_kind:"assignment",maximum_marks:20,
        scheduled_at:`${today}T09:00:00.000Z`,evidence_requirement:"none",examiner_user_id:examiner.id,moderator_user_id:moderator.id});
      state=await live.action(examiner,schoolId,state.id,"schedule",{expected_revision:state.revision}) as typeof state;
      state=await live.action(examiner,schoolId,state.id,"open-marking",{expected_revision:state.revision}) as typeof state;
      const rows=await database.selectFrom("assessment_results").selectAll().where("assessment_id","=",state.id).orderBy("student_id").execute();
      state=await live.recordResults(examiner,schoolId,state.id,{expected_assessment_revision:state.revision,results:rows.map(row=>({result_id:row.id,outcome:"scored",marks:row.student_id===students[0]?16:0,expected_revision:row.revision,reason:"Initial verified result"}))});
      state=await live.action(examiner,schoolId,state.id,"submit",{expected_revision:state.revision}) as typeof state;
      await expect(live.action(examiner,schoolId,state.id,"approve",{expected_revision:state.revision,note:"Examiner is also administrator"})).rejects.toThrow(/cannot moderate their own/i);
      state=await live.action(moderator,schoolId,state.id,"approve",{expected_revision:state.revision,note:"Independently checked"}) as typeof state;
      state=await live.action(examiner,schoolId,state.id,"publish",{expected_revision:state.revision,note:"First moderated release"}) as typeof state;
      return state.id;
    });
    const sourceRows=(db:Kysely<Database>)=>db.selectFrom("assessment_results").select(["id","student_id","marks","outcome","revision"]).where("assessment_id","=",assessmentId).orderBy("student_id").execute();
    const publications=(db:Kysely<Database>)=>db.selectFrom("assessment_publications").select(["id","sequence","source_revision","reason"]).where("assessment_id","=",assessmentId).orderBy("sequence").execute();
    const captured=await sourceRows(database),release=await publications(database);
    const personalWork=(db:DatabaseService,actor:AuthUser,namespace=`live:${schoolId}`)=>new RequestsService(db,undefined,scope).workspaceItems(actor,{
      school_id:schoolId,school_name:"Synthetic correction campus",timezone:"UTC",environment_namespace_id:namespace,recorded_at:now,
      membership_roles:["staff"],relationships:[],assignments:[{action_key:actor.id===moderator.id?"assessments.moderate":"assessments.mark",capability_key:"assessments",scope:{kind:"assessment",id:assessmentId}}],
    });
    const principalWork=(db:DatabaseService,actor:AuthUser)=>new RequestsService(db,undefined,scope).inbox(actor,{portal:"principal"});
    const findAssessmentItem=(items:Awaited<ReturnType<typeof personalWork>>,kind:string)=>items.find(item=>item.source_id===assessmentId&&item.kind===kind);
    const assertNoInventedDeadline=(item:ReturnType<typeof findAssessmentItem>,kind:string,surface:"assigned"|"manage",sourceTime:Date|string|null)=>{
      expect(item).toMatchObject({kind,source_id:assessmentId,due_at:null,priority:"normal",href:`/areas/assessments/${surface}?assessment=${assessmentId}`});
      expect(item?.created_at).toBeTruthy();expect(item?.occurs_at).toBeTruthy();
      expect(Date.parse(item!.occurs_at!)).toBe(new Date(sourceTime!).getTime());
    };
    const store=new SimulationSnapshotStore(sourceUrl,targetUrl,4),opened:Kysely<Database>[]=[];
    try{
      const snapshot=await store.capture(schoolId,now);
      const open=async()=>{
        const runId=randomUUID(),scenarioId=randomUUID(),namespace=`scenario:${scenarioId}:run:${runId}`;
        const branch=await createSimulationBranch(store.pool,snapshot,{run_id:runId,school_id:schoolId,scenario_id:scenarioId,namespace_id:namespace});
        const driver=new SimulationBranchDriver(store.pool,branch,snapshot),compiler=new PostgresDialect({pool:store.pool});
        const db=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:value=>compiler.createIntrospector(value)}}) as DatabaseService;
        opened.push(db);
        return{db,service:services(db),namespace,run:<T>(work:()=>Promise<T>,virtualNow=now)=>{
          const selected=simulationRequestEnvironment({institution_id:schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:virtualNow,source_snapshot_ref:`sha256:${snapshot.content_hash}`,manifest_ref:"assessment-correction-test",checked_at:now});
          return scope.run(selected,()=>executionEnvironmentStorage.run(selected,work));
        }};
      };
      const branch=await open(),sibling=await open();
      await branch.run(async()=>{
        const readAssessment=()=>branch.db.selectFrom("assessments").selectAll().where("id","=",assessmentId).executeTakeFirstOrThrow();
        let state=await readAssessment();const beforeRevision=state.revision;
        const correction=(marks:number)=>({expected_assessment_revision:beforeRevision,results:captured.map(row=>({result_id:row.id,outcome:"scored",marks:row.student_id===students[0]?marks:0,expected_revision:row.revision,reason:"Verified missing component after recount"}))});
        // First row may be updated before the second row refuses. No partial
        // marks/revisions/audit/event may survive the prepared-command savepoint.
        const invalid=correction(17.5);invalid.results[1]!.marks=21;
        await expect(branch.service.recordResults(examiner,schoolId,assessmentId,invalid)).rejects.toThrow(/Marks must be between/);
        expect(await sourceRows(branch.db)).toEqual(captured);expect((await readAssessment()).revision).toBe(beforeRevision);
        const valid=correction(17.5);
        await expect(branch.service.recordResults(moderator,schoolId,assessmentId,valid)).rejects.toThrow(/assigned moderator cannot record/i);
        const observedBefore=observations.length;
        state=await branch.service.recordResults(examiner,schoolId,assessmentId,valid);
        expect(observations[observedBefore]).toMatchObject({action:"assessment.results.record",status:"published",revision:beforeRevision,marks:"16.00"});
        expect(state.status).toBe("marking");
        expect(new Date(state.scheduled_at!).getTime()).toBeLessThan(Date.parse(now));
        const examinerAssignment=await branch.db.selectFrom("assessment_staff_assignments").select("assigned_at").where("assessment_id","=",assessmentId).where("user_id","=",examiner.id).executeTakeFirstOrThrow();
        assertNoInventedDeadline(findAssessmentItem(await personalWork(branch.db,examiner,branch.namespace),"assessment_work"),"assessment_work","assigned",examinerAssignment.assigned_at);
        await expect(branch.service.action(moderator,schoolId,assessmentId,"submit",{expected_revision:state.revision})).rejects.toThrow(/assigned moderator cannot submit/i);
        expect((await branch.service.recordResults(examiner,schoolId,assessmentId,valid)).revision).toBe(state.revision);
        await expect(branch.service.recordResults(examiner,schoolId,assessmentId,correction(18))).rejects.toThrow(/changed/i);
        expect((await branch.service.familyResults(learner,schoolId,students[0]!)).results[0]).toMatchObject({sequence:1,marks:"16.00"});
        state=await branch.service.action(examiner,schoolId,assessmentId,"submit",{expected_revision:state.revision}) as typeof state;
        const reviewerAssignment=await branch.db.selectFrom("assessment_staff_assignments").select("assigned_at").where("assessment_id","=",assessmentId).where("user_id","=",moderator.id).executeTakeFirstOrThrow();
        assertNoInventedDeadline(findAssessmentItem(await personalWork(branch.db,moderator,branch.namespace),"assessment_work"),"assessment_work","assigned",reviewerAssignment.assigned_at);
        assertNoInventedDeadline(findAssessmentItem((await principalWork(branch.db,moderator)).items,"assessment_moderation"),"assessment_moderation","manage",state.submitted_at);
        await expect(branch.service.action(examiner,schoolId,assessmentId,"approve",{expected_revision:state.revision,note:"I have admin authority"})).rejects.toThrow(/cannot moderate their own/i);
        state=await branch.service.action(moderator,schoolId,assessmentId,"return",{expected_revision:state.revision,note:"Please verify feedback wording"}) as typeof state;
        expect((await branch.service.familyResults(learner,schoolId,students[0]!)).results[0]).toMatchObject({sequence:1,marks:"16.00"});
        state=await branch.service.action(examiner,schoolId,assessmentId,"submit",{expected_revision:state.revision}) as typeof state;
        state=await branch.service.action(moderator,schoolId,assessmentId,"approve",{expected_revision:state.revision,note:"Correction independently verified"}) as typeof state;
        assertNoInventedDeadline(findAssessmentItem((await principalWork(branch.db,examiner)).items,"assessment_publish"),"assessment_publish","manage",state.moderated_at);
        const publish={expected_revision:state.revision,note:"Corrected independently moderated release",idempotency_key:randomUUID()};
        state=await branch.service.action(examiner,schoolId,assessmentId,"publish",publish) as typeof state;
        expect((await branch.service.action(examiner,schoolId,assessmentId,"publish",publish)).revision).toBe(state.revision);
        await expect(branch.service.action(examiner,schoolId,assessmentId,"publish",{...publish,note:"Changed retry"})).rejects.toThrow(/different/i);
        expect((await branch.service.familyResults(learner,schoolId,students[0]!)).results[0]).toMatchObject({sequence:2,marks:"17.50"});
        expect(findAssessmentItem(await personalWork(branch.db,moderator,branch.namespace),"assessment_work")).toBeUndefined();
        expect(findAssessmentItem((await principalWork(branch.db,examiner)).items,"assessment_publish")).toBeUndefined();
        expect(await publications(branch.db)).toHaveLength(2);
        expect((await publications(branch.db))[0]).toEqual(release[0]);
        const old=(await sql<{marks:string}>`SELECT marks FROM assessment_publication_results WHERE publication_id=${release[0]!.id}::uuid AND student_id=${students[0]}::uuid`.execute(branch.db)).rows[0];
        expect(old?.marks).toBe("16.00");
        const outcomes=(await sql<{command_type:string;state:string;environment_namespace_id:string;domain_event_id:string|null}>`SELECT command.command_type,command.state,command.environment_namespace_id,outcome.domain_event_id
          FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
          WHERE command.school_id=${schoolId}::uuid AND command.command_type LIKE 'assessment.results.%' AND command.environment_namespace_id=${branch.namespace}`.execute(branch.db)).rows;
        expect(outcomes).toEqual(expect.arrayContaining([expect.objectContaining({state:"rejected",domain_event_id:null})]));
        for(const action of["record","submit","return","approve","publish"])expect(outcomes.some(row=>row.command_type===`assessment.results.${action}`&&row.state==="accepted"&&row.domain_event_id)).toBe(true);
        const beforeEndpointEnd={rows:await sourceRows(branch.db),publications:await publications(branch.db),revision:(await readAssessment()).revision};
        const identityCore=new CampusModelCoreService(branch.db,scope),endsAt=new Date(Date.parse(now)+3_600_000).toISOString();
        await branch.db.transaction().execute(async tx=>{
          const identity=await identityCore.resolveAccountEndpoint(tx,{school_id:schoolId,user_id:examiner.id,at:now});
          if(!identity.acting)throw new Error("The synthetic examiner must be acting before its endpoint ends.");
          const endpoint=await tx.selectFrom("campus_model_agent_endpoints").select("revision").where("id","=",identity.endpoint_id).executeTakeFirstOrThrow();
          await identityCore.closeAccountEndpoint(tx,{school_id:schoolId,endpoint_id:identity.endpoint_id,actor_user_id:examiner.id,
            expected_revision:endpoint.revision,effective_at:endsAt,disposition:"ended",reason:"Synthetic result replay identity regression",
            source_domain:"assessment_correction_test",source_record_id:assessmentId,source_revision:state.revision,idempotency_key:randomUUID()});
        });
        await branch.run(async()=>{
          // Membership/account/profile remain active; a once-valid domain
          // receipt must not bypass the current endpoint or selected clock.
          expect(await branch.db.selectFrom("school_memberships").select("is_active").where("school_id","=",schoolId).where("user_id","=",examiner.id).executeTakeFirstOrThrow()).toMatchObject({is_active:true});
          expect(await branch.db.selectFrom("users").select("is_active").where("id","=",examiner.id).executeTakeFirstOrThrow()).toMatchObject({is_active:true});
          const beforeCommands=await branch.db.selectFrom("campus_model_commands").select("id").where("school_id","=",schoolId).execute();
          await expect(branch.service.recordResults(examiner,schoolId,assessmentId,valid)).rejects.toThrow(/not currently linked to an active person/i);
          await expect(branch.service.action(examiner,schoolId,assessmentId,"publish",publish)).rejects.toThrow(/not currently linked to an active person/i);
          expect({rows:await sourceRows(branch.db),publications:await publications(branch.db),revision:(await readAssessment()).revision}).toEqual(beforeEndpointEnd);
          expect(await branch.db.selectFrom("campus_model_commands").select("id").where("school_id","=",schoolId).execute()).toEqual(beforeCommands);
        },new Date(Date.parse(endsAt)+1_000).toISOString());
      });
      expect(await sourceRows(database)).toEqual(captured);expect(await sourceRows(sibling.db)).toEqual(captured);
      expect(await publications(database)).toEqual(release);expect(await publications(sibling.db)).toEqual(release);
      expect((await run(()=>live.familyResults(learner,schoolId,students[0]!))).results[0]).toMatchObject({sequence:1,marks:"16.00"});
      expect((await sibling.run(()=>sibling.service.familyResults(learner,schoolId,students[0]!))).results[0]).toMatchObject({sequence:1,marks:"16.00"});
      expect(findAssessmentItem(await run(()=>personalWork(database,moderator)),"assessment_work")).toBeUndefined();
      expect(findAssessmentItem(await sibling.run(()=>personalWork(sibling.db,moderator,sibling.namespace)),"assessment_work")).toBeUndefined();
    }finally{await Promise.all(opened.map(db=>db.destroy()));await store.pool.end();}
  },120_000);
});
