import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { PeopleService } from "../src/people/people.service.js";
import { PeopleImportService } from "../src/people/people-import.service.js";
import { IMPORT_COLUMNS } from "../src/people/import-csv.js";
import { academicParticipationTestServices, configureAcademicSubjectSessions } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true",targetUrl = process.env.SIMULATION_ENROLLMENT_ROSTER_TEST_TARGET_URL;
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/roster_unused_test";
types.setTypeParser(1082,value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({connectionString:sourceUrl,max:3}) }) });
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({authUser:user,requestId:randomUUID(),headers:{"idempotency-key":randomUUID()}}) as unknown as AuthenticatedRequest;

function services(connection: Kysely<Database>) {
  const database=connection as DatabaseService,shared=academicParticipationTestServices(database);
  return {...shared,people:new PeopleService(database,shared.events,shared.core,shared.core,shared.core,shared.bridge),
    imports:new PeopleImportService(database,shared.events,shared.core,shared.core,shared.core,shared.bridge)};
}

async function fixture() {
  const shared=services(db),suffix=randomUUID();
  const account=await db.insertInto("users").values({username:`world-roster-${suffix}`,email:`world-roster-${suffix}@example.test`,
    password_hash:"isolated-test-only",first_name:"World roster",last_name:"Owner",role:"admin"})
    .returning(["id","username","email","first_name","last_name","role","is_active"]).executeTakeFirstOrThrow();
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx,account,"UTC"));
  const user:AuthUser={...account,active_school_id:schoolId};
  const configured=await new ProgressiveSetupService(db as DatabaseService,shared.core,shared.core,shared.core).setupAttendance(user,schoolId,
    {group_name:"World roster",participant_names:["Recorded learner"],responsible:{kind:"current_user",self_teaches:true,display_name:"World roster owner"},
      session:{starts_at:"00:01",ends_at:"23:59",weekdays:[1,2,3,4,5,6,7]}},request(user));
  const day=(await sql<{day:string}>`SELECT campus_permission_date(${schoolId}::uuid)::text AS day`.execute(db)).rows[0]!.day;
  const classId=configured.resources.class_section_id;
  await configureAcademicSubjectSessions(db as DatabaseService,shared.core,user,schoolId,classId,configured.resources.term_id,"UTC");
  const prepared=await shared.bridge.prepareDaily(user,schoolId,classId,day,true);
  const original=(await shared.kernel.detail(user,schoolId,prepared.register_id)).roster[0]!;
  await shared.kernel.submitRecords(user,schoolId,prepared.register_id,{expected_revision:0,records:[{person_id:original.person_id,status:"present"}]},request(user));
  const workspace=await shared.sessions.workspace(user,day),sessionId=workspace.registers[0]!.session_id as string;
  const screen=await shared.sessions.screen(user,sessionId);
  await shared.sessions.save(user,sessionId,{expected_revision:0,records:screen.roster.map(row=>({student_id:row.id as string,status:"present"}))},request(user));
  const sessionRegister=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts
    WHERE school_id=${schoolId}::uuid AND source_kind='scheduled_session' AND context_snapshot->'context'->>'legacy_register_id'=${sessionId}`.execute(db)).rows[0]!.register_id;
  return {...shared,user,schoolId,day,classId,termId:prepared.context.term_id,registerId:prepared.register_id,sessionRegister,sessionId};
}

describe.runIf(enabled&&Boolean(targetUrl))("reviewed enrollment roster parity in captured worlds",()=>{
  it("runs intake and import through the actual prepared-command verifier and one kernel, retaining Live and sibling truth",async()=>{
    const f=await fixture(),now=new Date().toISOString(),store=new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(targetUrl),4);
    const opened:Kysely<Database>[]=[];
    const registerIds=[f.registerId,f.sessionRegister];
    const projection=async(connection:Kysely<Database>)=>({
      roster:(await sql`SELECT * FROM activity_attendance_roster WHERE register_id=ANY(${registerIds}::uuid[]) ORDER BY register_id,person_id`.execute(connection)).rows,
      entries:(await sql`SELECT * FROM activity_attendance_entries WHERE register_id=ANY(${registerIds}::uuid[]) ORDER BY register_id,person_id`.execute(connection)).rows,
      register:(await sql`SELECT * FROM activity_attendance_registers WHERE id=ANY(${registerIds}::uuid[]) ORDER BY id`.execute(connection)).rows,
      session:(await sql`SELECT * FROM attendance_session_registers WHERE id=${f.sessionId}::uuid`.execute(connection)).rows,
      enrollments:(await sql`SELECT enrollment.* FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
        WHERE student.school_id=${f.schoolId}::uuid ORDER BY enrollment.id`.execute(connection)).rows,
      observations:(await sql`SELECT id,state,observed_at,source_ref,payload FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation' ORDER BY id`.execute(connection)).rows,
    });
    try {
      const captured=await store.capture(f.schoolId,now),original=await projection(db);
      const open=async()=>{
        const scenarioId=randomUUID(),runId=randomUUID(),namespace=`scenario:${scenarioId}:run:${runId}`;
        const branch=await createSimulationBranch(store.pool,captured,{school_id:f.schoolId,scenario_id:scenarioId,run_id:runId,namespace_id:namespace});
        const driver=new SimulationBranchDriver(store.pool,branch,captured),compiler=new PostgresDialect({pool:store.pool});
        const connection=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),
          createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:db=>compiler.createIntrospector(db)}});
        opened.push(connection);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:now,
          source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:"enrollment-roster-test",checked_at:now});
        return {...services(connection),connection,namespace,run:<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action)};
      };
      const branch=await open(),sibling=await open();
      await branch.run(async()=>{
        const proof=vi.spyOn(branch.core,"verifyPreparedDomainCommand");
        try {
          const req=request(f.user),review=await branch.people.preview(req,{school_id:f.schoolId,first_name:"Captured intake",last_name:"",
            admission_number:`WORLD-${randomUUID().slice(0,8)}`,class_section_id:f.classId,term_id:f.termId,roll_number:2,enrolled_on:f.day,guardian:null});
          const accepted=await branch.people.commit(req,review.id);
          expect(await branch.people.commit(req,review.id)).toEqual(accepted);
          const values:Record<string,string>={admission_number:`WORLD-${randomUUID().slice(0,8)}`,first_name:"Captured import",last_name:"Learner",
            date_of_birth:"2014-04-12",class:"World roster",roll_number:"3",enrolled_on:f.day,guardian_key:"world-family",
            guardian_first_name:"Reported",guardian_last_name:"Guardian",guardian_phone:"9000012345",guardian_email:"",relationship:"guardian"};
          const staged=await branch.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.termId,filename:"captured-roster.csv",
            csv:[IMPORT_COLUMNS.join(","),IMPORT_COLUMNS.map(column=>`"${values[column]??""}"`).join(",")].join("\r\n"),idempotency_key:randomUUID()});
          const detail=await branch.imports.detail(f.user,staged.id,f.schoolId);
          expect(detail.review?.summary.errors).toBe(0);
          const imported=await branch.imports.commit(request(f.user),staged.id,{school_id:f.schoolId,expected_revision:detail.revision,
            validation_token:detail.review!.validation_token,verified:true});
          expect(imported?.students).toBe(1);
          for(const registerId of registerIds){
            const after=await branch.kernel.detail(f.user,f.schoolId,registerId);
            expect(after.register).toMatchObject({state:"draft",revision:3});
            expect(after.counts).toMatchObject({participants:3,recorded:1,unrecorded:2,present:1});
          }
          const changed=await projection(branch.connection);
          expect(changed.entries).toEqual(original.entries);
          expect(changed.observations).toEqual(original.observations);
          expect(proof).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({actor_user_id:f.user.id,source_domain:"people",
            required_capability:"people:manage",correlation_id:review.id}));
          expect(proof).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({actor_user_id:f.user.id,source_domain:"people",
            required_capability:"people:manage",correlation_id:staged.id}));
          const commands=(await sql<{environment_namespace_id:string;state:string}>`SELECT environment_namespace_id,state FROM campus_model_commands
            WHERE school_id=${f.schoolId}::uuid AND command_type='attendance.participation.roster_change'`.execute(branch.connection)).rows;
          expect(commands).toHaveLength(4);expect(commands.every(row=>row.environment_namespace_id===branch.namespace&&row.state==="accepted")).toBe(true);
          const sessionScreen=await branch.sessions.screen(f.user,f.sessionId);
          expect(sessionScreen.register).toMatchObject({state:"draft",revision:3});
          expect(sessionScreen.roster).toHaveLength(3);
          await branch.sessions.save(f.user,f.sessionId,{expected_revision:sessionScreen.register.revision,
            records:sessionScreen.roster.map(row=>({student_id:row.id as string,status:row.status??"absent"}))},request(f.user));
          const dailyScreen=await branch.school.teacherAttendanceScreen(f.user,f.classId,f.day);
          expect(dailyScreen.roster).toHaveLength(3);
          await branch.connection.transaction().execute(tx=>branch.bridge.saveDailyRecordsInTransaction(tx,f.user,f.schoolId,f.classId,f.day,
            {expected_revision:3,records:dailyScreen.roster.map(row=>({student_id:row.id,status:row.status??"absent"}))},request(f.user)));
          for(const registerId of registerIds)expect((await branch.kernel.detail(f.user,f.schoolId,registerId)).counts)
            .toMatchObject({participants:3,recorded:3,present:1,absent:2});
          const marked=await projection(branch.connection);
          expect(marked.entries).toEqual(expect.arrayContaining(original.entries));
          expect(marked.observations).toEqual(expect.arrayContaining(original.observations));
        } finally {proof.mockRestore();}
      });
      expect(await projection(db)).toEqual(original);
      expect(await sibling.run(()=>projection(sibling.connection))).toEqual(original);
    } finally {for(const connection of opened)await connection.destroy();await store.pool.end();}
  },60_000);
});
