import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { AgentService } from '../src/agent/agent.service.js';
import { stableHash,type AgentGateway } from '../src/agent/gateway.js';
import type { AgentMemoryService } from '../src/agent/long-term-memory.js';
import { DatabaseService } from '../src/database/database.service.js';
import { RolesService } from '../src/roles/roles.service.js';
import { createClassPracticeFixture } from './class-practice.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
if(enabled)requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
describe.skipIf(!enabled)('current owning-domain privacy before external assistant delivery',()=>{
  let db:DatabaseService;
  beforeAll(()=>{db=new DatabaseService();});
  afterAll(async()=>{await db?.destroy();});
  it('withholds a retained class answer after only that class assignment is revoked',async()=>{
    const f=await createClassPracticeFixture(db);
    await sql`UPDATE users SET pro_features_enabled=true WHERE id=${f.teacher.id}::uuid`.execute(db);
    await sql`UPDATE staff_responsibility_types SET capability_permissions=ARRAY['attendance.view'],revision=revision+1
      WHERE id=${f.roleId}::uuid`.execute(db);
    await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
      VALUES(${f.schoolId}::uuid,${f.teacher.id}::uuid,'ai.use','Isolated assistant privacy test','manual','institution',
        ${f.date}::date,${f.date}::date+2,${f.date}::date+1,${f.owner.id}::uuid)`.execute(db);
    const otherClass=await db.insertInto('class_sections').values({school_id:f.schoolId,academic_year:'2026-27',grade:'7',section:'B'})
      .returning('id').executeTakeFirstOrThrow();
    await sql`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      SELECT school_id,responsibility_type_id,staff_profile_id,${otherClass.id}::uuid,starts_on,'active',assigned_by
      FROM staff_responsibility_assignments WHERE id=${f.assignmentId}::uuid`.execute(db);
    const input={class_section_id:f.classId,date:f.date};
    const original=await f.school.teacherAttendanceScreen(f.teacher,f.classId,f.date);
    const thread=(await sql<{id:string}>`INSERT INTO agent_threads(owner_id,school_id,portal,student_id)
      VALUES(${f.teacher.id}::uuid,${f.schoolId}::uuid,'teacher',NULL) RETURNING id`.execute(db)).rows[0]!;
    const run=(await sql<{id:string}>`INSERT INTO agent_runs(thread_id,client_id,question,status,answer,progress,provider,model,evidence)
      VALUES(${thread.id}::uuid,${randomUUID()}::uuid,'Read my Class A register','completed','Private Class A learner answer','Complete',
        'fictional','fictional','[]'::jsonb) RETURNING id`.execute(db)).rows[0]!;
    await sql`INSERT INTO agent_tool_steps(run_id,capability,kind,input,result,snapshot_hash)
      VALUES(${run.id}::uuid,'attendance_register','read',${JSON.stringify(input)}::jsonb,${JSON.stringify(original)}::jsonb,
        ${stableHash(original)})`.execute(db);
    const roles=new RolesService(db);
    const gateway={dispatch:async(capability:{name:string},arguments_:typeof input)=>{
      if(capability.name!=='attendance_register')throw new Error('Unexpected fixture capability');
      return f.school.teacherAttendanceScreen(f.teacher,arguments_.class_section_id,arguments_.date);
    }} as unknown as AgentGateway;
    const agent=new AgentService(db,roles,f.school,gateway,{} as AgentMemoryService);
    expect(await agent.channelRun(f.teacher,randomUUID(),thread.id,run.id)).toMatchObject({answer:'Private Class A learner answer'});
    await sql`UPDATE staff_responsibility_assignments SET status='revoked',revoked_by=${f.owner.id}::uuid,revoked_at=now(),
      revocation_reason='Isolated class reassignment',revision=revision+1 WHERE id=${f.assignmentId}::uuid`.execute(db);
    expect((await roles.effective(f.teacher,f.schoolId)).permissions).toEqual(expect.arrayContaining(['ai.use','attendance.view']));
    await expect(f.school.teacherAttendanceScreen(f.teacher,f.classId,f.date)).rejects.toThrow('not assigned');
    const reply=await agent.channelRun(f.teacher,randomUUID(),thread.id,run.id);
    expect(reply).toMatchObject({progress:'Access changed',action:null});
    expect(reply.answer).not.toContain('Private Class A learner answer');
  },30000);
});
