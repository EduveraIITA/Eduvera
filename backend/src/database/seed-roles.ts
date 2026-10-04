import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../auth/password.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";
export async function seedRolesDemo(pool: Pool, demoMode: boolean) {
  if(!demoMode) return {skipped:true};
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const school=(await client.query("SELECT s.id FROM schools s JOIN school_memberships m ON m.school_id=s.id JOIN users u ON u.id=m.user_id WHERE s.code='cis' AND u.username='meera.principal' AND u.email='meera.kapoor@example.test' AND m.role='admin' AND m.is_active AND u.is_active")).rows[0];
    if(!school){await client.query('ROLLBACK');return {skipped:true};}
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[school.id]);
    let admin=(await client.query("SELECT id FROM users WHERE username='arjun.admin' AND email='arjun.rao@example.test' AND role='admin'")).rows[0];
    if(!admin) admin=(await client.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES('arjun.admin','arjun.rao@example.test',$1,'Arjun','Rao','admin') ON CONFLICT DO NOTHING RETURNING id",[await hashPassword(randomBytes(32).toString('base64url'))])).rows[0];
    if(!admin) throw new Error('Demo admin identity collision; refusing to reuse unrelated account.');
    await client.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING",[school.id,admin.id]);
    const activationTables=(await client.query("SELECT to_regclass('public.institution_activation_states') IS NOT NULL AS ready")).rows[0]?.ready;
    if(activationTables){
      const principal=(await client.query("SELECT id FROM users WHERE username='meera.principal' AND is_active")).rows[0];
      await client.query(`UPDATE institution_activation_states state SET
          status='active',readiness_snapshot=jsonb_build_object('source','cambridge_demo_seed','reviewed_at',now()),
          reviewed_by=$2,reviewed_at=COALESCE(state.reviewed_at,now()),activated_by=$2,activated_at=COALESCE(state.activated_at,now())
        WHERE state.school_id=$1 AND EXISTS(SELECT 1 FROM academic_terms term WHERE term.school_id=$1 AND term.is_active)
          AND EXISTS(SELECT 1 FROM class_sections section WHERE section.school_id=$1)
          AND EXISTS(SELECT 1 FROM subjects subject WHERE subject.school_id=$1)
          AND EXISTS(SELECT 1 FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id WHERE student.school_id=$1 AND enrollment.is_active)
          AND EXISTS(SELECT 1 FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id WHERE section.school_id=$1)`,[school.id,principal.id]);
    }
    for(const role of [{name:'Accountant',description:'Fee ledger and offline receipts',permissions:['fees.manage']},{name:'Class Teacher',description:'Assigned classroom and family coordination',permissions:['attendance.view','attendance.record','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','events.view','events.attendance']},{name:'Teaching Observer',description:'Read assigned registers and schedules',permissions:['attendance.view','timetable.view','events.view']}]) {
      await client.query(`INSERT INTO school_custom_roles(school_id,name,description,permissions,created_by)
        SELECT $1::uuid,$2::varchar,$3::text,$4::text[],$5::uuid WHERE NOT EXISTS (
          SELECT 1 FROM school_custom_roles WHERE school_id=$1::uuid AND lower(name)=lower($2::text)
        )`,[school.id,role.name,role.description,role.permissions,admin.id]);
    }
    await client.query("UPDATE school_custom_roles SET permissions=(SELECT array_agg(DISTINCT permission ORDER BY permission) FROM unnest(permissions||ARRAY['assessments.view','assessments.mark']::text[]) permission) WHERE school_id=$1 AND lower(name)='class teacher'",[school.id]);
    await client.query("UPDATE school_custom_roles SET permissions=(SELECT array_agg(DISTINCT permission ORDER BY permission) FROM unnest(permissions||ARRAY['assessments.view']::text[]) permission) WHERE school_id=$1 AND lower(name)='teaching observer'",[school.id]);
    const assessmentTables=(await client.query("SELECT to_regclass('public.assessments') IS NOT NULL AS ready")).rows[0]?.ready;
    if(assessmentTables){
      const context=(await client.query(`SELECT term.id AS term_id,term.starts_on,term.ends_on,section.id AS class_id,subject.id AS subject_id,
          examiner.id AS examiner_id,moderator.id AS moderator_id
        FROM academic_terms term JOIN class_sections section ON section.school_id=term.school_id AND section.academic_year=term.academic_year AND section.grade='7' AND section.section='A'
        JOIN subjects subject ON subject.school_id=term.school_id AND subject.code='ENG'
        JOIN users examiner ON examiner.username='kavita.staff' JOIN users moderator ON moderator.username='meera.principal'
        WHERE term.school_id=$1 AND term.is_active ORDER BY term.starts_on DESC LIMIT 1`,[school.id])).rows[0];
      if(context){
        const cycle=(await client.query(`INSERT INTO assessment_cycles(school_id,term_id,name,code,starts_on,ends_on,status,result_label,created_by,updated_by)
          VALUES($1,$2,'Term 1 assessments','TERM1',GREATEST($3::date,'2026-09-01'::date),LEAST($4::date,'2026-10-31'::date),'active','Term result',$5,$5)
          ON CONFLICT(school_id,term_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,context.term_id,context.starts_on,context.ends_on,context.moderator_id])).rows[0];
        let assessment=(await client.query("SELECT id FROM assessments WHERE school_id=$1 AND cycle_id=$2 AND class_section_id=$3 AND subject_id=$4 AND title='English language mid-term'",[school.id,cycle.id,context.class_id,context.subject_id])).rows[0];
        if(!assessment) assessment=(await client.query(`INSERT INTO assessments(school_id,cycle_id,class_section_id,subject_id,title,assessment_kind,maximum_marks,weight_percent,scheduled_at,duration_minutes,venue,instructions,evidence_requirement,status,created_by,updated_by)
          VALUES($1,$2,$3,$4,'English language mid-term','exam',80,30,'2026-10-12T09:00:00+05:30',120,'Examination hall','Offline written paper. Record one truthful outcome for every learner.','optional','marking',$5,$5) RETURNING id`,[school.id,cycle.id,context.class_id,context.subject_id,context.moderator_id])).rows[0];
        await client.query(`INSERT INTO assessment_staff_assignments(school_id,assessment_id,user_id,role,assigned_by) VALUES
          ($1,$2,$3,'examiner',$4),($1,$2,$4,'moderator',$4)
          ON CONFLICT(assessment_id,role) DO UPDATE SET user_id=EXCLUDED.user_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,[school.id,assessment.id,context.examiner_id,context.moderator_id]);
        await client.query(`INSERT INTO assessment_results(school_id,assessment_id,student_id)
          SELECT $1,$2,enrollment.student_id FROM enrollments enrollment WHERE enrollment.class_section_id=$3 AND enrollment.term_id=$4 AND enrollment.is_active
          ON CONFLICT(assessment_id,student_id) DO NOTHING`,[school.id,assessment.id,context.class_id,context.term_id]);
      }
    }
    let operator=(await client.query("SELECT id FROM users WHERE username='company.demo' AND email='company.operator@example.test' AND role='admin'")).rows[0];
    if(!operator) operator=(await client.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES('company.demo','company.operator@example.test',$1,'Eduera','Company','admin') ON CONFLICT DO NOTHING RETURNING id",[await hashPassword(randomBytes(32).toString('base64url'))])).rows[0];
    if(!operator)throw new Error('Company demo identity collision.');
    if(process.env.DEPLOYMENT_ENVIRONMENT==='production')throw new Error('Company demo is limited to non-production environments.');
    await client.query('INSERT INTO company_operators(user_id) VALUES($1) ON CONFLICT DO NOTHING',[operator.id]);
    await client.query('COMMIT');return {admin:true,company_demo:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
if(import.meta.url===new URL(process.argv[1] ?? '', 'file:').href) {
  if(process.env.DEMO_MODE!=='true') throw new Error('Demo seeding requires DEMO_MODE=true');
  const url=process.env.DATABASE_URL;if(!url) throw new Error('DATABASE_URL is required');
  const pool=new Pool({...postgresClientConnectionConfig(url,{name:'DATABASE_URL',purpose:'migrations',requireRemoteTls:process.env.DEPLOYMENT_ENVIRONMENT==='stage' || process.env.DEPLOYMENT_ENVIRONMENT==='production'}),max:1});
  try{process.stdout.write(JSON.stringify(await seedRolesDemo(pool,true))+'\n');}finally{await pool.end();}
}
