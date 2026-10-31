import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { PeopleService } from "../src/people/people.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { academicParticipationTestServices } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import type { Database } from "../src/database/types.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
if (enabled) requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const db = new DatabaseService();
afterAll(() => db.destroy());
const request = (user: AuthUser) => ({ authUser: user,requestId: randomUUID(),headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;

async function fixture() {
  const shared = academicParticipationTestServices(db),suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `roster-owner-${suffix}`,email: `roster-owner-${suffix}@example.test`,
    password_hash: "isolated-test-only",first_name: "Roster",last_name: "Owner",role: "admin" })
    .returning(["id","username","email","first_name","last_name","role","is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx,account,"UTC"));
  const user: AuthUser = { ...account,active_school_id: schoolId };
  const configured = await new ProgressiveSetupService(db,shared.core,shared.core,shared.core).setupAttendance(user,schoolId,
    { group_name: "Roster fixture",participant_names: ["Original learner"],responsible: { kind: "current_user",self_teaches: true,display_name: "Roster Owner" },
      session: { starts_at: "00:01",ends_at: "23:59",weekdays: [1,2,3,4,5,6,7] } },request(user));
  const date = (await sql<{ date: string }>`SELECT campus_permission_date(${schoolId}::uuid)::text AS date`.execute(db)).rows[0]!.date;
  const classId = configured.resources.class_section_id;
  const prepared = await shared.bridge.prepareDaily(user,schoolId,classId,date,true);
  const original = (await sql<{ person_id: string; student_id: string }>`SELECT person_id,student_id FROM activity_attendance_academic_roster
    WHERE school_id=${schoolId}::uuid AND register_id=${prepared.register_id}::uuid`.execute(db)).rows[0]!;
  await shared.kernel.submitRecords(user,schoolId,prepared.register_id,{ expected_revision: 0,records: [{person_id: original.person_id,status: "present"}] },request(user));
  const people = new PeopleService(db,shared.events,shared.core,shared.core,shared.core,shared.bridge);
  const input = () => ({ school_id: schoolId,first_name: "New learner",last_name: "",admission_number: `ROSTER-${randomUUID().slice(0,8)}`,
    class_section_id: classId,term_id: prepared.context.term_id,roll_number: 2,enrolled_on: date,guardian: null });
  return { ...shared,people,user,schoolId,date,classId,registerId: prepared.register_id,original,input };
}

describe.runIf(enabled)("reviewed enrollment converges canonical attendance expectations",() => {
  it("captures the old expectation, preserves accepted marks, adds an unrecorded learner and replays once",async () => {
    const f = await fixture(),req = request(f.user);
    const before = (await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid`.execute(db)).rows;
    const review = await f.people.preview(req,f.input()),accepted = await f.people.commit(req,review.id);
    expect(await f.people.commit(req,review.id)).toEqual(accepted);
    const detail = await f.kernel.detail(f.user,f.schoolId,f.registerId);
    expect(detail.register).toMatchObject({ state: "draft",revision: 2,submitted_at: null });
    expect(detail.counts).toMatchObject({ participants: 2,recorded: 1,unrecorded: 1,present: 1 });
    expect((await sql`SELECT * FROM activity_attendance_entries WHERE register_id=${f.registerId}::uuid`.execute(db)).rows).toEqual(before);
    const audit = (await sql<{ source_refs: Array<{ kind: string; previous_roster?: unknown[]; next_roster?: unknown[] }> }>`SELECT source_refs FROM activity_attendance_audits
      WHERE register_id=${f.registerId}::uuid AND action='roster_change'`.execute(db)).rows;
    expect(audit).toHaveLength(1);
    const snapshot = audit[0]!.source_refs.find(item => item.kind === "academic_roster_revision")!;
    expect(snapshot.previous_roster).toHaveLength(1);expect(snapshot.next_roster).toHaveLength(2);
    const trace = (await sql<{ state: string; status: string; source_command: string; parent_state: string }>`SELECT command.state,outcome.status,
        event.payload->'decision_source'->>'source_command_id' AS source_command,parent.state AS parent_state
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id
      JOIN campus_model_commands parent ON parent.id=(event.payload->'decision_source'->>'source_command_id')::uuid
      WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='attendance.participation.roster_change'`.execute(db)).rows;
    expect(trace).toHaveLength(1);expect(trace[0]).toMatchObject({state:"accepted",status:"accepted",parent_state:"accepted"});
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_observations
      WHERE school_id=${f.schoolId}::uuid AND source_type='attendance.participation'`.execute(db)).rows[0]!.count).toBe(1);
    const person = await db.selectFrom("students").select("person_id").where("id","=",accepted.student_id).executeTakeFirstOrThrow();
    expect(detail.roster.find(row => row.person_id===person.person_id)).toMatchObject({status:null});
  },30_000);

  it("blocks a newly finalized context before any reviewed intake or expectation effect commits",async () => {
    const f = await fixture(),req = request(f.user),input = f.input(),review = await f.people.preview(req,input);
    await f.kernel.transition(f.user,f.schoolId,f.registerId,"finalize",{expected_revision:1},request(f.user));
    await expect(f.people.commit(req,review.id)).rejects.toThrow("locked");
    expect(await db.selectFrom("students").select("id").where("school_id","=",f.schoolId).where("admission_number","=",input.admission_number).execute()).toHaveLength(0);
    expect((await f.kernel.detail(f.user,f.schoolId,f.registerId)).register).toMatchObject({state:"locked",revision:2});
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_commands
      WHERE school_id=${f.schoolId}::uuid AND operation='roster_change'`.execute(db)).rows[0]!.count).toBe(0);
  },30_000);

  it("rolls enrollment, old/new expectations and the exact command chain back if journalling fails",async () => {
    const f = await fixture(),req = request(f.user),input = f.input(),review = await f.people.preview(req,input);
    const original = f.core.recordAcceptedEvent.bind(f.core);
    const reject = vi.spyOn(f.core,"recordAcceptedEvent").mockImplementation((tx,event) => {
      if (event.payload.operation === "roster_change") return Promise.reject(new Error("Isolated roster journal refusal"));
      return original(tx,event);
    });
    try {await expect(f.people.commit(req,review.id)).rejects.toThrow("Isolated roster journal refusal");}
    finally {reject.mockRestore();}
    expect(await db.selectFrom("students").select("id").where("school_id","=",f.schoolId).where("admission_number","=",input.admission_number).execute()).toHaveLength(0);
    expect((await f.kernel.detail(f.user,f.schoolId,f.registerId)).register).toMatchObject({state:"submitted",revision:1});
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_roster
      WHERE register_id=${f.registerId}::uuid`.execute(db)).rows[0]!.count).toBe(1);
    expect(await db.selectFrom("campus_model_commands").select("id").where("school_id","=",f.schoolId).where("idempotency_key","=",`person-enrollment:${review.id}`).execute()).toHaveLength(0);
    expect(await f.people.commit(req,review.id)).toHaveProperty("student_id");
  },30_000);

  it("serializes direct canonical marks and enrollment before either projection lock can invert",async () => {
    const f = await fixture(),req = request(f.user),review = await f.people.preview(req,f.input()),tag=`roster-race-${randomUUID()}`;
    const tagged = new Proxy(db,{get(target,property){
      if(property==='transaction')return()=>({execute:(action:(tx:Transaction<Database>)=>Promise<unknown>)=>target.transaction().execute(async tx=>{
        await sql`SELECT set_config('application_name',${tag},true)`.execute(tx);return action(tx);
      })});
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }});
    const enrollment = new PeopleService(tagged,f.events,f.core,f.core,f.core,f.bridge);
    let entered!:()=>void,release!:()=>void;
    const held = new Promise<void>(resolve=>{entered=resolve;}),resume = new Promise<void>(resolve=>{release=resolve;});
    const original = f.core.prepareDomainCommand.bind(f.core);
    const gate = vi.spyOn(f.core,'prepareDomainCommand').mockImplementation(async(tx,input)=>{
      if(input.command_type==='attendance.participation.marks'){entered();await resume;}
      return original(tx,input);
    });
    const mark = f.kernel.marks(f.user,f.schoolId,f.registerId,{expected_revision:1,reason:'Concurrent explicit fixture correction',
      records:[{person_id:f.original.person_id,status:'late'}]},request(f.user));
    await held;
    const commit = enrollment.commit(req,review.id);
    try{
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt++){
        waiting=(await sql<{waiting:boolean}>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND application_name=${tag} AND wait_event_type='Lock' AND wait_event='advisory') AS waiting`.execute(db)).rows[0]!.waiting;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
    }finally{release();gate.mockRestore();}
    await Promise.all([mark,commit]);
    const final = await f.kernel.detail(f.user,f.schoolId,f.registerId);
    expect(final.register).toMatchObject({state:'draft',revision:3});
    expect(final.counts).toMatchObject({participants:2,recorded:1,unrecorded:1,late:1});
  },10_000);
});
