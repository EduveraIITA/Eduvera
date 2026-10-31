import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import type { CampusOperatingDayOccurrence } from '../src/campus-model-core/temporal-context.port.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import type { AuthUser,AuthenticatedRequest } from '../src/common/request.js';
import { DatabaseService } from '../src/database/database.service.js';
import { OperatingDayRepository } from '../src/operating-day/operating-day.repository.js';
import { academicParticipationTestServices,rollbackAcademicFixture } from './academic-participation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const isolated=process.env.TEST_DATABASE_ISOLATED==='true'&&Boolean(process.env.DATABASE_URL);
const databaseUrl=isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused';

describe.skipIf(!isolated)('operating-day repository integration',()=>{
  const pool=new Pool({connectionString:databaseUrl,max:1});
  let database:DatabaseService;
  beforeAll(()=>{database=new DatabaseService();});
  afterAll(async()=>{await database?.destroy();await pool.end();});

  it('reads daily and subject-session attendance at their configured grains',async()=>{
    const context=(await pool.query<{school_id:string;class_section_id:string;term_id:string;subject_id:string;
      schedule_slot_id:string;period_number:number;starts_at:string;ends_at:string;student_id:string;session_date:string}>(`
      SELECT school.id AS school_id,section.id AS class_section_id,term.id AS term_id,subject.id AS subject_id,
        period.id AS schedule_slot_id,period.period_number,period.starts_at::text,period.ends_at::text,enrollment.student_id,
        available.date::text AS session_date
      FROM schools school JOIN academic_terms term ON term.school_id=school.id AND term.is_active
      JOIN class_sections section ON section.school_id=school.id
      JOIN timetable_slots period ON period.class_section_id=section.id AND period.term_id=term.id AND period.slot_type='class'
      JOIN subjects subject ON subject.id=period.subject_id
      JOIN enrollments enrollment ON enrollment.class_section_id=section.id AND enrollment.is_active
      JOIN LATERAL (SELECT day::date AS date FROM generate_series(term.starts_on,
        LEAST(term.ends_on,(now() AT TIME ZONE school.timezone)::date-1),'1 day') day
        WHERE extract(isodow FROM day)=period.weekday AND day::date>=enrollment.enrolled_on
          AND NOT EXISTS(SELECT 1 FROM attendance_session_registers retained
            WHERE retained.school_id=school.id AND retained.schedule_slot_id=period.id AND retained.session_date=day::date)
        ORDER BY day DESC LIMIT 1) available ON true
      WHERE school.code='cis' ORDER BY section.grade,section.section,period.period_number LIMIT 1`)).rows[0]!;
    expect(context).toBeTruthy();
    const account=(await pool.query<AuthUser>(`SELECT account.* FROM users account JOIN school_memberships membership
      ON membership.user_id=account.id WHERE membership.school_id=$1 AND membership.role='admin' AND membership.is_active
        AND account.is_active ORDER BY account.username LIMIT 1`,[context.school_id])).rows[0]!;
    const actor={...account,active_school_id:context.school_id},now=new Date();
    await executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:context.school_id,clock:{now:()=>now,nowIso:()=>now.toISOString()}}),
      ()=>rollbackAcademicFixture(database,async(transactional,tx)=>{
        await sql`UPDATE institution_operating_rules SET attendance_academic_mode='scheduled_session'
          WHERE school_id=${context.school_id}::uuid`.execute(tx);
        const shared=academicParticipationTestServices(transactional);
        const workspace=await shared.sessions.workspace(actor,context.session_date);
        const session=workspace.registers.find(row=>row.class_section_id===context.class_section_id&&row.period_number===context.period_number)!;
        expect(session).toBeTruthy();
        const prepared=await shared.bridge.prepareSessionInTransaction(tx,actor,context.school_id,session.session_id as string,true);
        const person=(await sql<{person_id:string}>`SELECT person_id FROM activity_attendance_academic_roster
          WHERE register_id=${prepared.register_id}::uuid AND student_id=${context.student_id}::uuid`.execute(tx)).rows[0]!;
        const detail=await shared.kernel.detail(actor,context.school_id,prepared.register_id,tx);
        await shared.kernel.marksInTransaction(tx,actor,context.school_id,prepared.register_id,{expected_revision:detail.register.revision,
          records:[{person_id:person.person_id,status:'present'}]},
          {authUser:actor,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}} as unknown as AuthenticatedRequest);
        const occurrence:CampusOperatingDayOccurrence={id:randomUUID(),occurrence_id:randomUUID(),occurrence_date:context.session_date,
          period_number:context.period_number,period_domain_id:context.schedule_slot_id,class_entity_id:randomUUID(),
          class_domain_id:context.class_section_id,class_label:'Class',subject_entity_id:null,subject_label:'Subject',
          space_entity_id:null,space_label:null,responsible_agent_id:null,responsible_agent_label:null,title:'Subject',slot_type:'class',
          starts_at:`${context.session_date}T03:30:00.000Z`,ends_at:`${context.session_date}T04:15:00.000Z`,source_domain:'timetable',
          source_record_id:context.schedule_slot_id,source_revision:1,change_kind:'published'};
        const repository=new OperatingDayRepository(transactional);
        const sessions=await repository.attendance(context.school_id,context.session_date,'scheduled_session',[occurrence]);
        expect(sessions).toHaveLength(1);
        // Incomplete decisions are a draft, never a fabricated submitted register.
        expect(sessions[0]).toMatchObject({scope_key:occurrence.id,state:'draft',revision:1,marked_count:1});
        expect(sessions[0]!.expected_count).toBeGreaterThan(0);
        const daily=await repository.attendance(context.school_id,context.session_date,'daily_class',[occurrence]);
        expect(daily).toHaveLength(1);
        expect(daily[0]).toMatchObject({scope_key:context.class_section_id,class_section_id:context.class_section_id});
        expect(await repository.attendance(context.school_id,context.session_date,'none',[occurrence])).toEqual([]);
      }));
  },60000);
});
