import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { academicOfferingServices, createAcademicOfferingFixture, publishAcademicOfferingAssessment } from "./academic-offering-cycle.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const target=process.env.ACADEMIC_OFFERING_SIMULATION_TEST_TARGET_URL;
const enabled=process.env.TEST_DATABASE_ISOLATED==="true"&&Boolean(target);
const source=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/academic_offering_world_unused_test";
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:source,max:3})})}) as DatabaseService;
afterAll(()=>db.destroy());

describe.runIf(enabled)("canonical academic offerings in captured COW worlds",()=>{
  it("publishes real person-based multi-course results and reports only in the selected world, preserving Live and sibling authority/history",async()=>{
    const f=await createAcademicOfferingFixture(db),now=f.now,store=new SimulationSnapshotStore(source,requireIsolatedTestDatabaseUrl(target),2),opened:DatabaseService[]=[];
    const counts=async(connection:DatabaseService)=>(await sql<{assessments:number;results:number;publications:number;reports:number;events:number;commands:number}>`SELECT
      (SELECT count(*)::int FROM assessments WHERE school_id=${f.schoolId}::uuid) AS assessments,
      (SELECT count(*)::int FROM assessment_results WHERE school_id=${f.schoolId}::uuid) AS results,
      (SELECT count(*)::int FROM assessment_publications WHERE school_id=${f.schoolId}::uuid) AS publications,
      (SELECT count(*)::int FROM grading_report_batches WHERE school_id=${f.schoolId}::uuid) AS reports,
      (SELECT count(*)::int FROM event_outbox WHERE school_id=${f.schoolId}::uuid) AS events,
      (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid) AS commands`.execute(connection)).rows[0]!;
    try{
      const before=await counts(db),snapshot=await store.capture(f.schoolId,now);
      const open=async()=>{
        const run=randomUUID(),scenario=randomUUID(),namespace=`scenario:${scenario}:run:${run}` as const;
        const branch=await createSimulationBranch(store.pool,snapshot,{run_id:run,school_id:f.schoolId,scenario_id:scenario,namespace_id:namespace});
        const driver=new SimulationBranchDriver(store.pool,branch,snapshot),compiler=new PostgresDialect({pool:store.pool});
        const connection=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:connection=>compiler.createIntrospector(connection)}}) as DatabaseService;
        opened.push(connection);
        const selected=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenario,run_id:run,virtual_now:now,source_snapshot_ref:`sha256:${snapshot.content_hash}`,manifest_ref:"academic-offering-cycle-world-test",checked_at:now});
        return{connection,namespace,...academicOfferingServices(connection),run:<T>(work:()=>Promise<T>)=>executionEnvironmentStorage.run(selected,work)};
      };
      const branch=await open(),sibling=await open();
      await branch.run(async()=>{
        expect(await branch.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:false,can_plan_course:true});
        const first=await publishAcademicOfferingAssessment(branch.connection,f,f.source.id,{marks:80,services:branch}),second=await publishAcademicOfferingAssessment(branch.connection,f,f.parallel.id,{marks:90,services:branch});
        expect(await branch.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:true,can_plan_course:true});
        expect((await branch.assessments.ownResults(f.learner.actor,f.schoolId,f.learner.id)).results).toHaveLength(2);
        expect((await branch.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1",f.learner.id)).items).toHaveLength(2);
        let scheme=await branch.reports.createScheme(f.owner,f.schoolId,{context_kind:"learning_offering",offering_ids:[f.source.id,f.parallel.id],term_id:f.termId,
          name:"Selected world semester report",code:"BRANCH-SEM1",review_mode:"owner_review",idempotency_key:randomUUID(),bands:[{code:"F",label:"Needs support",minimum_percentage:0,maximum_percentage:49.99},{code:"P",label:"Pass",minimum_percentage:50,maximum_percentage:100}]});
        for(const [offering,assessment] of [[f.source,first],[f.parallel,second]] as const){
          const context=f.courses.find(row=>row.id===offering.id)!;
          scheme=await branch.reports.saveSubjectPlan(f.owner,f.schoolId,scheme.id,{offering_id:offering.id,subject_id:context.subject_id,course_code:context.course_code,credits:Number(context.credits),expected_revision:scheme.revision,
            idempotency_key:randomUUID(),components:[{code:"PORT",name:"Portfolio",weight_percentage:100,assessment_ids:[assessment.id]}]});
        }
        const active=await branch.reports.activateScheme(f.owner,f.schoolId,scheme.id,{expected_revision:scheme.revision,idempotency_key:randomUUID()});
        const input={expected_revision:active.revision,idempotency_key:randomUUID()},batch=await branch.reports.generateReport(f.owner,f.schoolId,scheme.id,input);
        expect(await branch.reports.generateReport(f.owner,f.schoolId,scheme.id,input)).toMatchObject({id:batch.id});
        const reviewed=await branch.reports.batchAction(f.owner,f.schoolId,batch.id,"review",{expected_revision:batch.revision,note:"Reviewed selected-world canonical learner results.",idempotency_key:randomUUID()});
        await branch.reports.batchAction(f.owner,f.schoolId,batch.id,"publish",{expected_revision:reviewed.revision,note:"Publish only in this isolated world.",idempotency_key:randomUUID()});
        expect((await branch.reports.ownReports(f.learner.actor,f.schoolId,f.learner.id)).reports).toHaveLength(1);
        await expect(branch.reports.ownReports(f.learner.actor,f.schoolId,f.secondLearner.id)).rejects.toThrow();
        expect((await branch.connection.selectFrom("grading_report_students").select(["student_id","learner_id","person_id"]).where("batch_id","=",batch.id).execute()).every(row=>row.student_id===null&&row.person_id===row.learner_id)).toBe(true);
        const commands=await branch.connection.selectFrom("campus_model_commands").select(["state","environment_namespace_id"]).where("school_id","=",f.schoolId).where("source_domain","in",["assessments","academic_reports"]).execute();
        expect(commands.length).toBeGreaterThan(10);expect(commands.every(row=>row.state==="accepted"&&row.environment_namespace_id===branch.namespace)).toBe(true);
      });
      expect(await counts(db)).toEqual(before);expect(await sibling.run(()=>counts(sibling.connection))).toEqual(before);
      expect(await f.run(()=>f.assessments.discovery(f.instructor.actor,f.schoolId))).toEqual({has_assigned:false,can_plan_course:true});
      expect(await sibling.run(()=>sibling.assessments.discovery(f.instructor.actor,f.schoolId))).toEqual({has_assigned:false,can_plan_course:true});
      await sibling.run(async()=>{expect((await sibling.assessments.ownResults(f.learner.actor,f.schoolId,f.learner.id)).results).toEqual([]);expect((await sibling.reports.ownReports(f.learner.actor,f.schoolId,f.learner.id)).reports).toEqual([]);expect((await sibling.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1",f.learner.id)).items).toEqual([]);});
    }finally{await Promise.all(opened.map(connection=>connection.destroy()));await store.pool.end();}
  },120000);
});
