import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { hashPassword } from "../auth/password.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";

type DemoAssessmentContext = { schoolId:string; termId:string; classId:string; examinerId:string; moderatorId:string };
type DemoAssessmentSpec = { cycleId:string; subjectId:string; title:string; kind:"exam"|"class_test"; maximumMarks:number; weightPercent:number; scheduledAt:string; scoreFloor:number; feedback:string };

async function seedPublishedAssessment(client:PoolClient,context:DemoAssessmentContext,spec:DemoAssessmentSpec){
  let assessment=(await client.query("SELECT id FROM assessments WHERE school_id=$1 AND cycle_id=$2 AND class_section_id=$3 AND subject_id=$4 AND title=$5",[context.schoolId,spec.cycleId,context.classId,spec.subjectId,spec.title])).rows[0];
  if(!assessment)assessment=(await client.query(`INSERT INTO assessments(school_id,cycle_id,class_section_id,subject_id,title,assessment_kind,maximum_marks,weight_percent,scheduled_at,duration_minutes,venue,instructions,evidence_requirement,status,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,45,'Classroom','Offline assessment recorded for the demo result gallery.','none','published',$10,$10) RETURNING id`,[context.schoolId,spec.cycleId,context.classId,spec.subjectId,spec.title,spec.kind,spec.maximumMarks,spec.weightPercent,spec.scheduledAt,context.moderatorId])).rows[0];
  await client.query(`INSERT INTO assessment_staff_assignments(school_id,assessment_id,user_id,role,assigned_by) VALUES
    ($1,$2,$3,'examiner',$4),($1,$2,$4,'moderator',$4)
    ON CONFLICT(assessment_id,role) DO UPDATE SET user_id=EXCLUDED.user_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,[context.schoolId,assessment.id,context.examinerId,context.moderatorId]);
  await client.query(`INSERT INTO assessment_results(school_id,assessment_id,student_id)
    SELECT $1,$2,enrollment.student_id FROM enrollments enrollment WHERE enrollment.class_section_id=$3 AND enrollment.term_id=$4 AND enrollment.is_active
    ON CONFLICT(assessment_id,student_id) DO NOTHING`,[context.schoolId,assessment.id,context.classId,context.termId]);
  await client.query(`UPDATE assessment_results result SET outcome='scored',
    marks=round(($4::numeric*($5::int+(abs(hashtext(result.student_id::text||$2::text))%(96-$5::int)))/100),2),grade='',feedback=$6,
    revision=GREATEST(result.revision,2),recorded_by=$3,recorded_at=COALESCE(result.recorded_at,now()),updated_at=now()
    WHERE result.school_id=$1 AND result.assessment_id=$2 AND result.outcome='unrecorded'`,[context.schoolId,assessment.id,context.examinerId,spec.maximumMarks,spec.scoreFloor,spec.feedback]);
  await client.query("UPDATE assessments SET status='published',revision=GREATEST(revision,4),submitted_by=COALESCE(submitted_by,$3),submitted_at=COALESCE(submitted_at,now()),moderated_by=COALESCE(moderated_by,$4),moderated_at=COALESCE(moderated_at,now()),moderation_note='Demo register reviewed',updated_by=$4,updated_at=now() WHERE school_id=$1 AND id=$2",[context.schoolId,assessment.id,context.examinerId,context.moderatorId]);
  const publication=(await client.query(`INSERT INTO assessment_publications(school_id,assessment_id,sequence,source_revision,reason,published_by)
    VALUES($1,$2,1,4,'Demo moderated release',$3) ON CONFLICT(assessment_id,sequence) DO UPDATE SET reason=assessment_publications.reason RETURNING id`,[context.schoolId,assessment.id,context.moderatorId])).rows[0];
  await client.query(`INSERT INTO assessment_publication_results(school_id,publication_id,assessment_id,student_id,source_result_id,source_result_revision,outcome,marks,grade,feedback)
    SELECT result.school_id,$3,result.assessment_id,result.student_id,result.id,result.revision,result.outcome,result.marks,result.grade,result.feedback FROM assessment_results result
    WHERE result.school_id=$1 AND result.assessment_id=$2 ON CONFLICT(publication_id,student_id) DO NOTHING`,[context.schoolId,assessment.id,publication.id]);
  return {assessmentId:String(assessment.id),publicationId:String(publication.id),subjectId:spec.subjectId};
}

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
    for(const role of [{name:'Accountant',description:'Fee ledger and offline receipts',permissions:['fees.manage']},{name:'Class Teacher',description:'Assigned classroom and family coordination',permissions:['attendance.view','attendance.record','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','events.view','events.attendance','departure.collect']},{name:'Teaching Observer',description:'Read assigned registers and schedules',permissions:['attendance.view','timetable.view','events.view']}]) {
      await client.query(`INSERT INTO school_custom_roles(school_id,name,description,permissions,created_by)
        SELECT $1::uuid,$2::varchar,$3::text,$4::text[],$5::uuid WHERE NOT EXISTS (
          SELECT 1 FROM school_custom_roles WHERE school_id=$1::uuid AND lower(name)=lower($2::text)
        )`,[school.id,role.name,role.description,role.permissions,admin.id]);
    }
    await client.query("UPDATE school_custom_roles SET permissions=(SELECT array_agg(DISTINCT permission ORDER BY permission) FROM unnest(permissions||ARRAY['assessments.view','assessments.mark','reports.comment','departure.collect']::text[]) permission) WHERE school_id=$1 AND lower(name)='class teacher'",[school.id]);
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
        await client.query(`UPDATE assessment_results result SET outcome='scored',marks=(48+(abs(hashtext(result.student_id::text))%25))::numeric,grade='',feedback='Published demo result',
          revision=GREATEST(result.revision,2),recorded_by=$3,recorded_at=COALESCE(result.recorded_at,now()),updated_at=now()
          WHERE result.school_id=$1 AND result.assessment_id=$2 AND result.outcome='unrecorded'`,[school.id,assessment.id,context.examiner_id]);
        await client.query("UPDATE assessments SET status='published',revision=GREATEST(revision,4),submitted_by=$3,submitted_at=COALESCE(submitted_at,now()),moderated_by=$4,moderated_at=COALESCE(moderated_at,now()),moderation_note='Demo register reviewed',updated_by=$4,updated_at=now() WHERE school_id=$1 AND id=$2",[school.id,assessment.id,context.examiner_id,context.moderator_id]);
        const publication=(await client.query(`INSERT INTO assessment_publications(school_id,assessment_id,sequence,source_revision,reason,published_by)
          VALUES($1,$2,1,4,'Demo moderated release',$3) ON CONFLICT(assessment_id,sequence) DO UPDATE SET reason=assessment_publications.reason RETURNING id`,[school.id,assessment.id,context.moderator_id])).rows[0];
        await client.query(`INSERT INTO assessment_publication_results(school_id,publication_id,assessment_id,student_id,source_result_id,source_result_revision,outcome,marks,grade,feedback)
          SELECT result.school_id,$3,result.assessment_id,result.student_id,result.id,result.revision,result.outcome,result.marks,result.grade,result.feedback FROM assessment_results result
          WHERE result.school_id=$1 AND result.assessment_id=$2 ON CONFLICT(publication_id,student_id) DO NOTHING`,[school.id,assessment.id,publication.id]);
        const gradingTables=(await client.query("SELECT to_regclass('public.grading_schemes') IS NOT NULL AS ready")).rows[0]?.ready;
        if(gradingTables){
          const scheme=(await client.query(`INSERT INTO grading_schemes(school_id,term_id,class_section_id,name,code,status,absence_treatment,review_mode,revision,created_by,updated_by,activated_by,activated_at)
            VALUES($1,$2,$3,'Term 1 report','TERM1-REPORT','active','incomplete','owner_review',2,$4,$4,$4,now())
            ON CONFLICT(school_id,term_id,class_section_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,context.term_id,context.class_id,context.moderator_id])).rows[0];
          const bands=[['A+','Outstanding',90,100],['A','Excellent',80,89.99],['B','Good',70,79.99],['C','Satisfactory',60,69.99],['D','Developing',50,59.99],['E','Emerging',40,49.99],['F','Needs support',0,39.99]];
          for(const [index,band] of bands.entries()) await client.query(`INSERT INTO grading_scheme_bands(school_id,scheme_id,code,label,minimum_percentage,maximum_percentage,display_order)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(scheme_id,code) DO NOTHING`,[school.id,scheme.id,band[0],band[1],band[2],band[3],index+1]);
          const plan=(await client.query(`INSERT INTO grading_scheme_subjects(school_id,scheme_id,subject_id,pass_percentage,display_order) VALUES($1,$2,$3,40,1)
            ON CONFLICT(scheme_id,subject_id) DO UPDATE SET pass_percentage=EXCLUDED.pass_percentage RETURNING id`,[school.id,scheme.id,context.subject_id])).rows[0];
          const component=(await client.query(`INSERT INTO grading_components(school_id,scheme_subject_id,code,name,weight_percentage,display_order) VALUES($1,$2,'TERM','Term assessment',100,1)
            ON CONFLICT(scheme_subject_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,plan.id])).rows[0];
          await client.query("INSERT INTO grading_component_assessments(school_id,component_id,assessment_id) VALUES($1,$2,$3) ON CONFLICT(component_id,assessment_id) DO NOTHING",[school.id,component.id,assessment.id]);
          const fingerprint=createHash('sha256').update(`demo:${scheme.id}:${publication.id}`).digest('hex');
          const batch=(await client.query(`INSERT INTO grading_report_batches(school_id,scheme_id,sequence,status,revision,source_scheme_revision,source_fingerprint,generated_by,reviewed_by,reviewed_at,review_note,published_by,published_at,publication_note)
            VALUES($1,$2,1,'published',3,2,$3,$4,$4,now(),'Demo review',$4,now(),'Demo publication') ON CONFLICT(scheme_id,sequence) DO UPDATE SET publication_note=grading_report_batches.publication_note RETURNING id`,[school.id,scheme.id,fingerprint,context.moderator_id])).rows[0];
          await client.query(`INSERT INTO grading_report_students(school_id,batch_id,student_id,outcome,overall_percentage,overall_grade,class_teacher_comment,principal_comment)
            SELECT $1,$2,published.student_id,'complete',round((published.marks/assessment.maximum_marks)*100,2),
              CASE WHEN (published.marks/assessment.maximum_marks)*100>=90 THEN 'A+' WHEN (published.marks/assessment.maximum_marks)*100>=80 THEN 'A' WHEN (published.marks/assessment.maximum_marks)*100>=70 THEN 'B' WHEN (published.marks/assessment.maximum_marks)*100>=60 THEN 'C' WHEN (published.marks/assessment.maximum_marks)*100>=50 THEN 'D' WHEN (published.marks/assessment.maximum_marks)*100>=40 THEN 'E' ELSE 'F' END,
              'Steady progress this term.','Keep building on the published feedback.'
            FROM assessment_publication_results published JOIN assessments assessment ON assessment.id=published.assessment_id WHERE published.publication_id=$3
            ON CONFLICT(batch_id,student_id) DO NOTHING`,[school.id,batch.id,publication.id]);
          await client.query(`INSERT INTO grading_report_subjects(school_id,batch_id,report_student_id,scheme_subject_id,subject_id,outcome,percentage,grade,pass_percentage,passed)
            SELECT $1,$2,report.id,$3,$4,'complete',report.overall_percentage,report.overall_grade,40,report.overall_percentage>=40 FROM grading_report_students report WHERE report.batch_id=$2
            ON CONFLICT(batch_id,report_student_id,subject_id) DO NOTHING`,[school.id,batch.id,plan.id,context.subject_id]);
          await client.query(`INSERT INTO grading_report_components(school_id,batch_id,report_subject_id,component_id,component_name,weight_percentage,outcome,percentage,weighted_points,source_assessment_count)
            SELECT $1,$2,subject.id,$3,'Term assessment',100,'complete',subject.percentage,subject.percentage,1 FROM grading_report_subjects subject WHERE subject.batch_id=$2
            ON CONFLICT(report_subject_id,component_id) DO NOTHING`,[school.id,batch.id,component.id]);
          await client.query(`INSERT INTO grading_report_assessment_sources(school_id,batch_id,report_component_id,assessment_id,publication_id,student_id,outcome,marks,maximum_marks,normalized_percentage)
            SELECT $1,$2,component_result.id,$3,$4,student_report.student_id,published.outcome,published.marks,assessment.maximum_marks,round((published.marks/assessment.maximum_marks)*100,2)
            FROM grading_report_components component_result JOIN grading_report_subjects subject_result ON subject_result.id=component_result.report_subject_id
            JOIN grading_report_students student_report ON student_report.id=subject_result.report_student_id
            JOIN assessment_publication_results published ON published.publication_id=$4 AND published.student_id=student_report.student_id JOIN assessments assessment ON assessment.id=$3
            WHERE component_result.batch_id=$2 ON CONFLICT(report_component_id,assessment_id) DO NOTHING`,[school.id,batch.id,assessment.id,publication.id]);

          const termSubjects=(await client.query(`SELECT DISTINCT subject.id,subject.name FROM timetable_slots slot JOIN subjects subject ON subject.id=slot.subject_id
            WHERE slot.class_section_id=$1 AND slot.term_id=$2 AND slot.slot_type='class' ORDER BY subject.name LIMIT 6`,[context.class_id,context.term_id])).rows as Array<{id:string;name:string}>;
          if(!termSubjects.some((subject)=>subject.id===context.subject_id)){
            const english=(await client.query("SELECT id,name FROM subjects WHERE id=$1",[context.subject_id])).rows[0];
            if(english)termSubjects.unshift(english);
          }
          const demoContext:DemoAssessmentContext={schoolId:school.id,termId:context.term_id,classId:context.class_id,examinerId:context.examiner_id,moderatorId:context.moderator_id};
          const classTestCycle=(await client.query(`INSERT INTO assessment_cycles(school_id,term_id,name,code,starts_on,ends_on,status,result_label,created_by,updated_by)
            VALUES($1,$2,'Class tests','CLASS-TEST-DEMO',GREATEST($3::date,'2026-09-01'::date),LEAST($4::date,'2026-10-31'::date),'active','Class test result',$5,$5)
            ON CONFLICT(school_id,term_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,context.term_id,context.starts_on,context.ends_on,context.moderator_id])).rows[0];
          for(const [index,subject] of termSubjects.slice(0,3).entries())await seedPublishedAssessment(client,demoContext,{
            cycleId:classTestCycle.id,subjectId:subject.id,title:`${subject.name} class test ${index+1}`,kind:'class_test',maximumMarks:25,weightPercent:10,
            scheduledAt:`2026-09-${String(8+index*3).padStart(2,'0')}T09:00:00+05:30`,scoreFloor:60+index*3,feedback:index===0?'Good concepts; revise written presentation.':index===1?'Accurate work with clear method.':'Consistent class-test performance.'
          });

          const annualCycle=(await client.query(`INSERT INTO assessment_cycles(school_id,term_id,name,code,starts_on,ends_on,status,result_label,created_by,updated_by)
            VALUES($1,$2,'Annual examinations','ANNUAL-DEMO',GREATEST($3::date,'2026-09-01'::date),LEAST($4::date,'2026-10-31'::date),'completed','Annual result',$5,$5)
            ON CONFLICT(school_id,term_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,context.term_id,context.starts_on,context.ends_on,context.moderator_id])).rows[0];
          const annualSources=[] as Array<{assessmentId:string;publicationId:string;subjectId:string}>;
          for(const [index,subject] of termSubjects.entries())annualSources.push(await seedPublishedAssessment(client,demoContext,{
            cycleId:annualCycle.id,subjectId:subject.id,title:`${subject.name} annual examination`,kind:'exam',maximumMarks:100,weightPercent:60,
            scheduledAt:`2026-09-${String(20+index).padStart(2,'0')}T09:00:00+05:30`,scoreFloor:62+(index%4)*4,feedback:'Annual examination result verified and published.'
          }));
          if(annualSources.length){
            const annualScheme=(await client.query(`INSERT INTO grading_schemes(school_id,term_id,class_section_id,name,code,status,absence_treatment,review_mode,revision,created_by,updated_by,activated_by,activated_at)
              VALUES($1,$2,$3,'Annual examination report','ANNUAL-REPORT','active','incomplete','owner_review',2,$4,$4,$4,now())
              ON CONFLICT(school_id,term_id,class_section_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,context.term_id,context.class_id,context.moderator_id])).rows[0];
            for(const [index,band] of bands.entries())await client.query(`INSERT INTO grading_scheme_bands(school_id,scheme_id,code,label,minimum_percentage,maximum_percentage,display_order)
              VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(scheme_id,code) DO NOTHING`,[school.id,annualScheme.id,band[0],band[1],band[2],band[3],index+1]);
            const annualPlans=[] as Array<{planId:string;componentId:string;assessmentId:string;publicationId:string;subjectId:string}>;
            for(const [index,source] of annualSources.entries()){
              const annualPlan=(await client.query(`INSERT INTO grading_scheme_subjects(school_id,scheme_id,subject_id,pass_percentage,display_order) VALUES($1,$2,$3,40,$4)
                ON CONFLICT(scheme_id,subject_id) DO UPDATE SET pass_percentage=EXCLUDED.pass_percentage RETURNING id`,[school.id,annualScheme.id,source.subjectId,index+1])).rows[0];
              const annualComponent=(await client.query(`INSERT INTO grading_components(school_id,scheme_subject_id,code,name,weight_percentage,display_order) VALUES($1,$2,'ANNUAL','Annual examination',100,1)
                ON CONFLICT(scheme_subject_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[school.id,annualPlan.id])).rows[0];
              await client.query("INSERT INTO grading_component_assessments(school_id,component_id,assessment_id) VALUES($1,$2,$3) ON CONFLICT(component_id,assessment_id) DO NOTHING",[school.id,annualComponent.id,source.assessmentId]);
              annualPlans.push({planId:String(annualPlan.id),componentId:String(annualComponent.id),...source});
            }
            const annualFingerprint=createHash('sha256').update(`annual-demo:${annualScheme.id}:${annualSources.map((source)=>source.publicationId).join(':')}`).digest('hex');
            const annualBatch=(await client.query(`INSERT INTO grading_report_batches(school_id,scheme_id,sequence,status,revision,source_scheme_revision,source_fingerprint,generated_by,reviewed_by,reviewed_at,review_note,published_by,published_at,publication_note)
              VALUES($1,$2,1,'published',3,2,$3,$4,$4,now(),'Annual results reviewed',$4,now(),'Annual report published')
              ON CONFLICT(scheme_id,sequence) DO UPDATE SET publication_note=EXCLUDED.publication_note RETURNING id`,[school.id,annualScheme.id,annualFingerprint,context.moderator_id])).rows[0];
            const annualPublicationIds=annualSources.map((source)=>source.publicationId);
            await client.query(`WITH averages AS (
                SELECT published.student_id,round(avg((published.marks/assessment.maximum_marks)*100),2) AS percentage
                FROM assessment_publication_results published JOIN assessments assessment ON assessment.id=published.assessment_id
                WHERE published.publication_id=ANY($3::uuid[]) AND published.outcome='scored' GROUP BY published.student_id
              ) INSERT INTO grading_report_students(school_id,batch_id,student_id,outcome,overall_percentage,overall_grade,class_teacher_comment,principal_comment)
              SELECT $1,$2,average.student_id,'complete',average.percentage,
                CASE WHEN average.percentage>=90 THEN 'A+' WHEN average.percentage>=80 THEN 'A' WHEN average.percentage>=70 THEN 'B' WHEN average.percentage>=60 THEN 'C' WHEN average.percentage>=50 THEN 'D' WHEN average.percentage>=40 THEN 'E' ELSE 'F' END,
                'A balanced performance across the annual examinations.','Continue building subject depth and consistency.' FROM averages average
              ON CONFLICT(batch_id,student_id) DO UPDATE SET outcome=EXCLUDED.outcome,overall_percentage=EXCLUDED.overall_percentage,overall_grade=EXCLUDED.overall_grade`,[school.id,annualBatch.id,annualPublicationIds]);
            for(const plan of annualPlans){
              await client.query(`INSERT INTO grading_report_subjects(school_id,batch_id,report_student_id,scheme_subject_id,subject_id,outcome,percentage,grade,pass_percentage,passed)
                SELECT $1,$2,report.id,$3,$4,'complete',round((published.marks/assessment.maximum_marks)*100,2),
                  CASE WHEN (published.marks/assessment.maximum_marks)*100>=90 THEN 'A+' WHEN (published.marks/assessment.maximum_marks)*100>=80 THEN 'A' WHEN (published.marks/assessment.maximum_marks)*100>=70 THEN 'B' WHEN (published.marks/assessment.maximum_marks)*100>=60 THEN 'C' WHEN (published.marks/assessment.maximum_marks)*100>=50 THEN 'D' WHEN (published.marks/assessment.maximum_marks)*100>=40 THEN 'E' ELSE 'F' END,
                  40,(published.marks/assessment.maximum_marks)*100>=40
                FROM grading_report_students report JOIN assessment_publication_results published ON published.publication_id=$5 AND published.student_id=report.student_id
                JOIN assessments assessment ON assessment.id=$6 WHERE report.batch_id=$2
                ON CONFLICT(batch_id,report_student_id,subject_id) DO UPDATE SET percentage=EXCLUDED.percentage,grade=EXCLUDED.grade,passed=EXCLUDED.passed`,[school.id,annualBatch.id,plan.planId,plan.subjectId,plan.publicationId,plan.assessmentId]);
              await client.query(`INSERT INTO grading_report_components(school_id,batch_id,report_subject_id,component_id,component_name,weight_percentage,outcome,percentage,weighted_points,source_assessment_count)
                SELECT $1,$2,subject.id,$3,'Annual examination',100,'complete',subject.percentage,subject.percentage,1 FROM grading_report_subjects subject
                WHERE subject.batch_id=$2 AND subject.subject_id=$4 ON CONFLICT(report_subject_id,component_id) DO UPDATE SET percentage=EXCLUDED.percentage,weighted_points=EXCLUDED.weighted_points`,[school.id,annualBatch.id,plan.componentId,plan.subjectId]);
              await client.query(`INSERT INTO grading_report_assessment_sources(school_id,batch_id,report_component_id,assessment_id,publication_id,student_id,outcome,marks,maximum_marks,normalized_percentage)
                SELECT $1,$2,component.id,$3,$4,student.student_id,published.outcome,published.marks,assessment.maximum_marks,round((published.marks/assessment.maximum_marks)*100,2)
                FROM grading_report_components component JOIN grading_report_subjects subject ON subject.id=component.report_subject_id
                JOIN grading_report_students student ON student.id=subject.report_student_id
                JOIN assessment_publication_results published ON published.publication_id=$4 AND published.student_id=student.student_id JOIN assessments assessment ON assessment.id=$3
                WHERE component.batch_id=$2 AND component.component_id=$5 ON CONFLICT(report_component_id,assessment_id) DO NOTHING`,[school.id,annualBatch.id,plan.assessmentId,plan.publicationId,plan.componentId]);
            }
          }
        }
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
