import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

/** Add-only demo: never overwrite an administrator's role or staffing changes. */
export async function seedAccessRolesDemo(pool:Pool,demoMode:boolean) {
  if(!demoMode)return {skipped:"Demo mode is disabled"};
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const school=(await client.query(`SELECT s.id,m.user_id AS admin_id FROM schools s JOIN school_memberships m ON m.school_id=s.id AND m.role='admin' AND m.is_active
      JOIN users u ON u.id=m.user_id AND u.username='meera.principal' AND u.email='meera.kapoor@example.test' WHERE s.code='cis'`)).rows[0];
    if(!school){await client.query("ROLLBACK");return {skipped:"Cambridge demo identities are unavailable"};}
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`roles:${school.id}`]);
    await client.query(`INSERT INTO staff_responsibility_types(id,school_id,code,name,category,scope_kind,context_kind,workflow_family,source_kind,
      description,capability_permissions,requires_acceptance,updated_by)
      VALUES($1,$2,'demo_attendance_reviewer','Attendance reviewer','academic','class_section','class','demo_attendance_reviewer','institute',
        'Read assigned class registers without changing attendance.',ARRAY['attendance.view'],false,$3)
      ON CONFLICT(school_id,code) DO NOTHING`,[demoId("access-role-attendance-reviewer"),school.id,school.admin_id]);
    const role=(await client.query("SELECT id FROM staff_responsibility_types WHERE school_id=$1 AND code='demo_attendance_reviewer'",[school.id])).rows[0];
    const assignmentId=demoId("access-assignment-attendance-reviewer");
    if(!(await client.query("SELECT 1 FROM staff_responsibility_assignments WHERE id=$1",[assignmentId])).rows.length) {
      const candidate=(await client.query(`SELECT p.id AS profile_id,c.id AS class_id,t.starts_on,t.ends_on,
        concat_ws(' ',p.first_name,p.last_name) AS staff_name,concat('Class ',c.grade,c.section) AS class_name
        FROM staff_profiles p JOIN users u ON u.id=p.user_id AND u.username='anil.sharma' AND u.is_active
        JOIN school_memberships m ON m.school_id=p.school_id AND m.user_id=p.user_id AND m.role='staff' AND m.is_active
        JOIN class_sections c ON c.school_id=p.school_id JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
        WHERE p.school_id=$1 AND p.status='active' AND current_date BETWEEN t.starts_on AND t.ends_on
          AND NOT EXISTS(SELECT 1 FROM staff_role_bindings b WHERE b.school_id=p.school_id AND b.user_id=p.user_id AND b.context_kind='class' AND b.scope_id=c.id)
          AND NOT EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=c.id AND slot.teacher_user_id=p.user_id)
        ORDER BY c.grade,c.section,t.starts_on LIMIT 1`,[school.id])).rows[0];
      if(candidate) {
        await client.query(`INSERT INTO staff_responsibility_assignments(id,school_id,responsibility_type_id,staff_profile_id,class_section_id,
          starts_on,ends_on,status,assigned_by,responded_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now(),'Demo read-only class access')`,
          [assignmentId,school.id,role.id,candidate.profile_id,candidate.class_id,candidate.starts_on,candidate.ends_on,school.admin_id]);
        await client.query(`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES($1,$2,'staff.role.demo_seeded',$3,$4::jsonb)`,
          [school.id,school.admin_id,assignmentId,JSON.stringify({role_id:role.id,scope_id:candidate.class_id})]);
      }
    }
    const binding=(await client.query(`SELECT b.role_name,b.scope_label,concat_ws(' ',p.first_name,p.last_name) AS staff_name
      FROM staff_role_bindings b JOIN staff_profiles p ON p.school_id=b.school_id AND p.user_id=b.user_id WHERE b.source_id=$1`,[assignmentId])).rows[0];
    await client.query("COMMIT");
    return {school_id:school.id,role_id:role.id,example:binding??null};
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.env.DEMO_MODE!=="true" || !process.env.DATABASE_URL)throw new Error("Demo mode and DATABASE_URL are required");
  const environment=process.env.DEPLOYMENT_ENVIRONMENT??process.env.NODE_ENV??"development";
  const connection=postgresClientConnectionConfig(process.env.DATABASE_URL,{name:"DATABASE_URL",purpose:"migrations",requireRemoteTls:environment==="stage"||environment==="production"});
  const pool=new Pool({...connection,max:1,application_name:"eduvera_access_role_demo"});
  try {console.log("Scoped role demo:",JSON.stringify(await seedAccessRolesDemo(pool,true)));} finally {await pool.end();}
}
