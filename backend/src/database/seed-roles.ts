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
    const count=(await client.query('SELECT count(*)::int AS n FROM school_custom_roles WHERE school_id=$1',[school.id])).rows[0].n;
    if(!count) {
      for(const role of [{name:'Accountant',description:'Fee ledger and offline receipts',permissions:['fees.manage']},{name:'Class Teacher',description:'Assigned classroom and family coordination',permissions:['attendance.view','attendance.record','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','events.view','events.attendance']},{name:'Teaching Observer',description:'Read assigned registers and schedules',permissions:['attendance.view','timetable.view','events.view']}]) await client.query('INSERT INTO school_custom_roles(school_id,name,description,permissions,created_by) VALUES($1,$2,$3,$4,$5)',[school.id,role.name,role.description,role.permissions,admin.id]);
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
