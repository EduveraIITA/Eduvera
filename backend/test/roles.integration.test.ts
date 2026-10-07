import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";

const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite("work-profile calculated access against disposable PostgreSQL",()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  const base="http://127.0.0.1:8059/api/v1"; const jars:Record<string,Map<string,string>>={admin:new Map(),staff:new Map(),parent:new Map()};
  let server:ChildProcess,school:string,otherSchool:string,admin:string,staff:string,classDuty:string,transportDuty:string,profile:string,staffProfile:string,section:string;
  const suffix=randomUUID();const password="R0les!TestPebble2026";
  async function request(actor:string,path:string,body?:unknown,method=body===undefined?"GET":"POST",csrf=true){const jar=jars[actor]!;const headers:Record<string,string>={Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; ")};if(body!==undefined)headers["Content-Type"]="application/json";if(csrf&&jar.get("csrftoken"))headers["X-CSRFToken"]=jar.get("csrftoken")!;const res=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});for(const cookie of res.headers.getSetCookie()){const pair=cookie.split(";")[0]!;const at=pair.indexOf("=");jar.set(pair.slice(0,at),pair.slice(at+1));}return {status:res.status,data:await res.json() as any};}
  const path=(tail:string)=>`/schools/${school}/roles/${tail}`;
  beforeAll(async()=>{
    school=(await pool.query("INSERT INTO schools(name,code) VALUES('Profile Test',$1) RETURNING id",[`profile-${suffix.slice(0,12)}`])).rows[0].id;
    otherSchool=(await pool.query("INSERT INTO schools(name,code) VALUES('Other Profile Test',$1) RETURNING id",[`other-${suffix.slice(0,12)}`])).rows[0].id;
    for(const [actor,accountRole,memberRole] of [["admin","admin","admin"],["staff","staff","staff"],["parent","parent","guardian"]]){const id=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,'Profile Test',$5) RETURNING id",[`${actor}.${suffix}`,`${actor}.${suffix}@example.test`,await hashPassword(password),actor,accountRole])).rows[0].id;if(actor==="admin")admin=id;if(actor==="staff")staff=id;await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)",[school,id,memberRole]);}
    classDuty=(await pool.query("SELECT id FROM staff_responsibility_types WHERE school_id=$1 AND code='class_teacher'",[school])).rows[0].id;
    transportDuty=(await pool.query("SELECT id FROM staff_responsibility_types WHERE school_id=$1 AND code='transport_attendant'",[school])).rows[0].id;
    staffProfile=(await pool.query(`INSERT INTO staff_profiles(school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by)
      VALUES($1,$2,'T-PROFILE','Work','Profile',$3,'teaching','Teacher','full_time',current_date,'active',$4,$4) RETURNING id`,[school,staff,`staff.${suffix}@example.test`,admin])).rows[0].id;
    section=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','6','A') RETURNING id",[school])).rows[0].id;
    server=spawn(process.execPath,["dist/main.js"],{env:{...process.env,HOST:"127.0.0.1",PORT:"8059",COOKIE_SECRET:"roles-test-cookie-secret-at-least-32",NODE_ENV:"test",RATE_LIMIT_STORE:"memory",LOG_LEVEL:"silent"},stdio:["ignore","ignore","inherit"]});
    let ready=false;for(let index=0;index<150;index++){try{if((await fetch("http://127.0.0.1:8059/healthz")).ok){ready=true;break;}}catch{/* startup */}await new Promise(resolve=>setTimeout(resolve,50));}expect(ready).toBe(true);
    for(const actor of Object.keys(jars)){await request(actor,"/auth/csrf/");expect((await request(actor,"/auth/login/",{identifier:`${actor}.${suffix}`,password})).status).toBe(200);}
  },30000);
  afterAll(async()=>{server?.kill("SIGTERM");await pool.end();});

  it("keeps work-profile administration with institution administrators",async()=>{
    expect((await request("admin",path("workspace/"))).status).toBe(200);
    expect((await request("staff",path("workspace/"))).status).toBe(403);
    expect((await request("parent",path("workspace/"))).status).toBe(403);
    expect((await request("admin",`/schools/${otherSchool}/roles/workspace/`)).status).toBe(403);
  });

  it("creates eligibility profiles without accepting raw permissions",async()=>{
    expect((await request("admin",path(""),{name:"Invalid",duty_ids:[classDuty],permissions:["fees.manage"]})).status).toBe(400);
    const created=await request("admin",path(""),{name:"Teaching staff",description:"Class responsibilities",duty_ids:[classDuty],template_key:"teaching"});
    expect(created.status).toBe(201);profile=created.data.id;
    expect((await request("admin",path(""),{name:"teaching staff",description:"Duplicate",duty_ids:[classDuty]})).status).toBe(409);
  });

  it("requires both profile eligibility and an active assignment",async()=>{
    expect((await request("admin",path(`members/${staff}/assignment/`),{profile_ids:[profile],primary_profile_id:profile,expected_profile_ids:[]})).status).toBe(201);
    let effective=await request("staff",path("effective/"));expect(effective.data.permissions).toEqual([]);
    await pool.query(`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      VALUES($1,$2,$3,$4,current_date,'active',$5)`,[school,classDuty,staffProfile,section,admin]);
    effective=await request("staff",path("effective/"));
    expect(effective.data.permissions).toEqual(expect.arrayContaining(["attendance.view","attendance.record","timetable.view"]));
    expect(effective.data.access_explanations).toContainEqual(expect.objectContaining({source_type:"assignment",source_name:"Class teacher"}));
  });

  it("keeps one role per staff member and protects active responsibilities",async()=>{
    const created=await request("admin",path(""),{name:"Transport staff",description:"Trips",duty_ids:[transportDuty],template_key:"transport"});
    expect(created.status).toBe(201);
    expect((await request("admin",path(`members/${staff}/assignment/`),{profile_ids:[profile,created.data.id],primary_profile_id:created.data.id,expected_profile_ids:[profile]})).status).toBe(400);
    const blocked=await request("admin",path(`members/${staff}/assignment/`),{profile_ids:[created.data.id],primary_profile_id:created.data.id,expected_profile_ids:[profile]});
    expect(blocked.status).toBe(409);expect(JSON.stringify(blocked.data)).toMatch(/class teacher/i);
    await pool.query("UPDATE staff_responsibility_assignments SET status='revoked',revoked_at=now(),revocation_reason='Role change test' WHERE school_id=$1 AND staff_profile_id=$2",[school,staffProfile]);
    expect((await request("admin",path(`members/${staff}/assignment/`),{profile_ids:[created.data.id],primary_profile_id:created.data.id,expected_profile_ids:[profile]})).status).toBe(201);
    const workspace=await request("admin",path("workspace/"));const member=workspace.data.members.find((item:{user_id:string})=>item.user_id===staff);
    expect(member.profile_ids).toEqual([created.data.id]);expect(member.primary_profile_id).toBe(created.data.id);
  });

  it("adds explainable dated exceptions and revokes them immediately",async()=>{
    const added=await request("admin",path(`members/${staff}/exceptions/`),{permission:"fees.manage",reason:"Temporary month-end reconciliation cover",scope_kind:"institution",valid_from:"2026-10-06",valid_until:"2026-11-05"});
    expect(added.status).toBe(201);
    const duplicate=await request("admin",path(`members/${staff}/exceptions/`),{permission:"fees.manage",reason:"A second request for the same reconciliation period",scope_kind:"institution",valid_from:"2026-10-20",valid_until:"2026-11-20"});
    expect(duplicate.status).toBe(409);
    let effective=await request("staff",path("effective/"));expect(effective.data.permissions).toContain("fees.manage");
    const detail=await request("admin",path(`members/${staff}/access/`));const exceptionRow=detail.data.exceptions.find((item:{id:string})=>item.id===added.data.id);expect(exceptionRow.reason).toContain("month-end");
    expect((await request("admin",path(`exceptions/${exceptionRow.id}/revoke/`),{expected_revision:exceptionRow.revision,reason:"Month-end cover completed and access is no longer required"})).status).toBe(201);
    effective=await request("staff",path("effective/"));expect(effective.data.permissions).not.toContain("fees.manage");
  });

  it("protects administrators and uses optimistic assignment checks",async()=>{
    expect((await request("admin",path(`members/${admin}/assignment/`),{profile_ids:[profile],primary_profile_id:profile,expected_profile_ids:[]})).status).toBe(403);
    expect((await request("admin",path(`members/${staff}/assignment/`),{profile_ids:[],primary_profile_id:null,expected_profile_ids:[]})).status).toBe(409);
  });
});
