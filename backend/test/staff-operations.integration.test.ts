import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;

suite("staff onboarding and leave against disposable PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const port = 8031;
  const base = `http://127.0.0.1:${port}`;
  const suffix = randomUUID();
  const password = "Str0ng!RiverPebbles2026";
  const adminEmail = `staff.admin.${suffix}@example.test`;
  const teacherEmail = `teacher.${suffix}@example.test`;
  const replacementEmail = `replacement.${suffix}@example.test`;
  const adminCookies = new Map<string, string>();
  const teacherCookies = new Map<string, string>();
  const replacementCookies = new Map<string, string>();
  let server: ChildProcess;
  let schoolId: string;
  let adminId: string;
  let teacherId: string;
  let sectionId: string;
  let profileId: string;
  let replacementProfileId: string;
  let policyId: string;
  let requestId: string;

  async function request(cookies: Map<string, string>, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookies.get("csrftoken")) headers["X-CSRFToken"] = cookies.get("csrftoken")!;
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!; const at = pair.indexOf("="); cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, data: await response.json() as any };
  }
  const staffPath = (path: string) => `schools/${schoolId}/staff/${path}/`;

  beforeAll(async () => {
    const admin = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Meera','Kapoor','admin') RETURNING id", [`admin.${suffix}`, adminEmail, await hashPassword(password)]);
    adminId=admin.rows[0].id;
    const teacher = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kavita','Mehta','staff') RETURNING id", [`teacher.${suffix}`, teacherEmail, await hashPassword(password)]);
    const replacement = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Rohan','Sen','staff') RETURNING id", [`replacement.${suffix}`, replacementEmail, await hashPassword(password)]);
    teacherId = teacher.rows[0].id;
    const school = await pool.query("INSERT INTO schools(name,code) VALUES('Staff Test School',$1) RETURNING id", [`staff-${suffix.slice(0, 12)}`]);
    schoolId = school.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$4,'admin'),($2,$4,'staff'),($3,$4,'staff')", [admin.rows[0].id, teacherId, replacement.rows[0].id, schoolId]);
    const term = await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,is_active) VALUES($1,'2030-31','Term 1','2030-04-01','2031-03-31',true) RETURNING id", [schoolId]);
    const section = await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2030-31','7','A') RETURNING id", [schoolId]); sectionId=section.rows[0].id;
    const subject = await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'MAT','Mathematics','Maths') RETURNING id", [schoolId]);
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,teacher_user_id) VALUES($1,$2,$3,1,1,'09:00','09:45',$4)", [section.rows[0].id, term.rows[0].id, subject.rows[0].id, teacherId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "staff-test-cookie-secret-at-least-32-characters", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    expect(ready).toBe(true);
    await request(adminCookies, "auth/csrf/");
    expect((await request(adminCookies, "auth/login/", { identifier: adminEmail, password })).status).toBe(200);
  });

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("onboards an existing teacher without creating a second account", async () => {
    const created = await request(adminCookies, staffPath("profiles"), { first_name: "Kavita", last_name: "Mehta", email: teacherEmail, phone: "+91 9000000000", staff_code: "T-001", staff_kind: "teaching", designation: "Mathematics teacher", department: "Secondary", employment_type: "full_time", joined_on: "2030-04-01" });
    expect(created.status).toBe(201);
    expect(created.data.invitation).toBeNull();
    expect(created.data.profile.user_id).toBe(teacherId);
    profileId = created.data.profile.id;
    const replacement = await request(adminCookies, staffPath("profiles"), { first_name: "Rohan", last_name: "Sen", email: replacementEmail, phone: "+91 9000000001", staff_code: "T-002", staff_kind: "teaching", designation: "Science teacher", department: "Secondary", employment_type: "full_time", joined_on: "2030-04-01" });
    expect(replacement.status).toBe(201);
    replacementProfileId = replacement.data.profile.id;
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id IN ($1,$2)", [profileId, replacementProfileId]);
    const workspace = await request(adminCookies, staffPath("workspace"));
    expect(workspace.data.profiles).toContainEqual(expect.objectContaining({ id: profileId, onboarding_total: 5, onboarding_complete: 1 }));
  });

  it("configures school leave policy and enforces role boundaries", async () => {
    const policy = await request(adminCookies, staffPath("leave-policies"), { academic_year: "2030-31", code: "CASUAL", name: "Casual leave", annual_allowance: 12, carry_forward_limit: 0, requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true });
    expect(policy.status).toBe(201); policyId = policy.data.id;
    await request(teacherCookies, "auth/csrf/");
    expect((await request(teacherCookies, "auth/login/", { identifier: teacherEmail, password })).status).toBe(200);
    await request(replacementCookies, "auth/csrf/");
    expect((await request(replacementCookies, "auth/login/", { identifier: replacementEmail, password })).status).toBe(200);
    expect((await request(teacherCookies, staffPath("profiles"), { first_name: "No" })).status).toBe(403);
    const workspace = await request(teacherCookies, staffPath("workspace"));
    expect(workspace.status).toBe(200);
    expect(workspace.data).toMatchObject({ mode: "staff", profile: { id: profileId } });
  });

  it("projects the actual date and pending acceptance for each separately scheduled trip", async () => {
    const route = await pool.query(`INSERT INTO transport_routes(school_id,code,name,created_by,updated_by)
      VALUES($1,'SOUTH','South Bengaluru',$2,$2) RETURNING id`, [schoolId,adminId]);
    const tripIds: string[] = [];
    for (const date of ["2030-10-07", "2030-10-08"]) {
      const trip = await pool.query(`INSERT INTO transport_trips(school_id,route_id,service_date,direction,
        assigned_collector_user_id,scheduled_departure_time,collector_assignment_status,created_by)
        VALUES($1,$2,$3,'from_institution',$4,'15:30','pending',$5) RETURNING id`,
      [schoolId,route.rows[0].id,date,teacherId,adminId]);
      tripIds.push(trip.rows[0].id);
    }
    const workspace = await request(adminCookies, staffPath("workspace"));
    expect(workspace.status).toBe(200);
    const trips = workspace.data.role_assignments.filter((item: { source_id: string }) => tripIds.includes(item.source_id));
    expect(trips).toHaveLength(2);
    expect(trips.map((item: { source_id: string }) => item.source_id)).toEqual(expect.arrayContaining(tripIds));
    expect(trips.map((item: { trip_service_date: string }) => item.trip_service_date).sort()).toEqual(["2030-10-07","2030-10-08"]);
    for (const trip of trips) expect(trip).toMatchObject({
      scope_label: "South Bengaluru", trip_departure_time: "15:30:00",
      trip_direction: "from_institution", trip_state: "planned", trip_assignment_status: "pending", trip_is_backup: false,
    });
  });

  it("submits, exposes timetable impact, approves and updates the balance", async () => {
    const leave = await request(teacherCookies, staffPath("leave-requests"), { policy_id: policyId, starts_on: "2030-04-08", ends_on: "2030-04-08", portion: "full_day", reason: "Family medical appointment", handover_note: "Period 1 needs cover" });
    expect(leave.status).toBe(201); requestId = leave.data.id;
    const adminView = await request(adminCookies, staffPath("workspace"));
    expect(adminView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "submitted", affected_periods: 1 }));
    const queued = adminView.data.requests.find((item: { id: string }) => item.id === requestId);
    const approved = await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), { decision: "approved", note: "Cover arranged", expected_revision: queued.revision });
    expect(approved.status).toBe(201);
    expect(approved.data).toMatchObject({ status: "approved", affected_periods: 1 });
    const teacherView = await request(teacherCookies, staffPath("workspace"));
    expect(teacherView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "approved" }));
    expect(Number(teacherView.data.balances.find((item: { policy_id: string }) => item.policy_id === policyId).used)).toBe(1);
    expect(teacherView.data.coverage_tasks).toContainEqual(expect.objectContaining({ leave_request_id: requestId, status: "open" }));
    expect((await request(teacherCookies, staffPath(`leave-requests/${requestId}/withdraw`), { expected_revision: approved.data.revision })).status).toBe(409);
  });

  it("offers scoped responsibilities and closes the leave coverage loop", async () => {
    const adminView = await request(adminCookies, staffPath("workspace"));
    const type = adminView.data.responsibility_types.find((item: { code: string }) => item.code === "school_duty");
    const assignment = await request(adminCookies, staffPath("responsibilities"), { responsibility_type_id: type.id, staff_profile_id: profileId, class_section_id: null, subject_id: null, event_id: null, scope_label: "Morning arrival gate", location: "Main gate", starts_on: "2030-04-10", ends_on: "2030-04-10", starts_at: "08:00", ends_at: "08:30", notes: "Coordinate arrival and escalate exceptions.", backup_staff_profile_id: null });
    expect(assignment.status).toBe(201);
    expect(assignment.data.status).toBe("offered");
    const teacherView = await request(teacherCookies, staffPath("workspace"));
    const offer = teacherView.data.assignments.find((item: { id: string }) => item.id === assignment.data.id);
    expect(offer).toMatchObject({ type_code: "school_duty", scope_label: "Morning arrival gate", status: "offered" });
    const accepted = await request(teacherCookies, staffPath(`responsibilities/${offer.id}/response`), { decision: "accepted", note: "Confirmed", expected_revision: offer.revision });
    expect(accepted.data.status).toBe("active");

    const task = adminView.data.coverage_tasks.find((item: { leave_request_id: string }) => item.leave_request_id === requestId);
    const offered = await request(adminCookies, staffPath(`coverage-tasks/${task.id}/assign`), { replacement_staff_profile_id: replacementProfileId, note: "Please cover period 1.", expected_revision: task.revision });
    expect(offered.data.status).toBe("offered");
    const replacementView = await request(replacementCookies, staffPath("workspace"));
    const coverOffer = replacementView.data.coverage_tasks.find((item: { id: string }) => item.id === task.id);
    expect(coverOffer).toMatchObject({ status: "offered", title: "Mathematics" });
    const coverAccepted = await request(replacementCookies, staffPath(`coverage-tasks/${task.id}/response`), { decision: "accepted", note: "I have reviewed the handover.", expected_revision: coverOffer.revision });
    expect(coverAccepted.data.status).toBe("accepted");
  });

  it("writes leave state transitions to audit and the outbox", async () => {
    const audit = await pool.query("SELECT action FROM staff_leave_request_audits WHERE request_id=$1 ORDER BY created_at", [requestId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["submitted", "approved"]);
    const outbox = await pool.query("SELECT event_type,payload FROM event_outbox WHERE aggregate_id=$1 ORDER BY created_at", [requestId]);
    expect(outbox.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["staff.leave.submitted", "staff.leave.approved"]));
    expect(outbox.rows.find((row) => row.event_type === "staff.leave.approved").payload).toMatchObject({ affected_periods: 1 });
  });

  it("creates a genuine custom role, grants scoped access and updates/revokes it", async () => {
    const workspace = await request(adminCookies, staffPath("workspace"));
    const base = workspace.data.access_roles.find((item: { code: string }) => item.code === "class_teacher");
    expect((await request(adminCookies,staffPath("work-types"),{})).status).toBe(410);
    const payload={name:"Primary class mentor",description:"Own daily coordination for one primary class.",context_kind:"class",template_id:base.id,permissions:["attendance.view","reports.comment"]};
    const created = await request(adminCookies, staffPath("access-roles"), payload);
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ name: "Primary class mentor", source_kind: "institute", scope_kind: "class_section",permissions:["attendance.view","reports.comment"] });
    await expect(pool.query("UPDATE staff_responsibility_types SET capability_permissions=ARRAY['fees.manage']::text[] WHERE id=$1", [created.data.id])).rejects.toThrow(/unsupported actions/i);
    await expect(pool.query(`INSERT INTO staff_responsibility_types(
      school_id,code,name,category,scope_kind,workflow_family,source_kind,description,access_summary,capability_permissions
    ) VALUES($1,$2,'Unsafe type','academic','class_section','class_teacher','institute','Unsafe','Unsafe',ARRAY['fees.manage']::text[])`, [schoolId, `unsafe_${suffix.slice(0, 8)}`])).rejects.toThrow(/unsupported actions/i);
    const startsOn = new Date().toISOString().slice(0, 10);
    const endsOn = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id=$1",[profileId]);
    const assignmentInput={role_id:created.data.id,staff_profile_id:profileId,scope_id:sectionId,subject_id:null,starts_on:startsOn,ends_on:endsOn};
    const result = await request(adminCookies, staffPath("role-assignments"), assignmentInput);
    expect(result.status).toBe(201);
    expect(result.data.status).toBe("active");
    expect((await request(adminCookies,staffPath("role-assignments"),assignmentInput)).status).toBe(409);
    expect((await request(teacherCookies,staffPath("role-assignments"),assignmentInput)).status).toBe(403);
    const effective = await request(teacherCookies, `schools/${schoolId}/roles/effective/`);
    expect(effective.data.permissions).toEqual(expect.arrayContaining(["attendance.view", "reports.comment"]));
    expect(effective.data.permissions).not.toContain("attendance.record");
    const allowed=await pool.query("SELECT staff_has_resource_permission($1,$2,'reports.comment','class',$3) AS yes,staff_has_resource_permission($1,$2,'attendance.record','class',$3) AS no",[schoolId,teacherId,sectionId]);
    expect(allowed.rows[0]).toEqual({yes:true,no:false});
    const other=await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2030-31','8','B') RETURNING id",[schoolId]);
    expect((await pool.query("SELECT staff_has_resource_permission($1,$2,'reports.comment','class',$3) AS allowed",[schoolId,teacherId,other.rows[0].id])).rows[0].allowed).toBe(false);
    const changes={...payload,permissions:["attendance.record"],expected_revision:created.data.revision,expected_assignment_count:1};
    expect((await request(adminCookies,staffPath(`access-roles/${created.data.id}`),{...changes,expected_assignment_count:0},"PATCH")).status).toBe(409);
    const updated=await request(adminCookies,staffPath(`access-roles/${created.data.id}`),changes,"PATCH");
    expect(updated.status).toBe(200);
    expect(updated.data.permissions).toEqual(["attendance.record","attendance.view"]);
    expect((await request(adminCookies,staffPath(`access-roles/${created.data.id}`),changes,"PATCH")).status).toBe(409);
    const changed=await request(teacherCookies,`schools/${schoolId}/roles/effective/`);
    expect(changed.data.permissions).toContain("attendance.record");
    expect(changed.data.permissions).not.toContain("reports.comment");
    const ended = await request(adminCookies, staffPath(`responsibilities/${result.data.id}/revoke`), { reason: "Class ownership changed.", expected_revision: result.data.revision });
    expect(ended.status).toBe(201);
    const after = await request(teacherCookies, `schools/${schoolId}/roles/effective/`);
    expect(after.data.permissions).not.toContain("attendance.record");
    expect((await request(adminCookies,staffPath("access-roles"),{...payload,name:"Unsafe finance role",permissions:["fees.manage"]})).status).toBe(400);
    expect((await request(adminCookies,staffPath("access-roles"),{...payload,name:"Self reviewer",context_kind:"assessment",template_id:null,permissions:["assessments.mark","assessments.moderate"]})).status).toBe(400);
  });

  it("changes native assignment access without a second eligibility record and prevents stale edits or timetable resurrection",async()=>{
    const viewer=await request(adminCookies,staffPath("access-roles"),{name:"Register reviewer",context_kind:"class",permissions:["attendance.view"]});
    expect(viewer.status).toBe(201);
    const native=(await pool.query(`INSERT INTO class_section_staff_assignments(school_id,class_section_id,user_id,role,valid_from,assigned_by)
      VALUES($1,$2,$3,'class_teacher',current_date,$4) RETURNING id`,[schoolId,sectionId,teacherId,adminId])).rows[0];
    const workspace=await request(adminCookies,staffPath("workspace"));
    const binding=workspace.data.role_assignments.find((item:{source_id:string;source_kind:string})=>item.source_id===native.id && item.source_kind==="class_assignment");
    expect(binding).toMatchObject({scope_id:sectionId,context_kind:"class",revision:1});
    const input={source_kind:binding.source_kind,source_id:binding.source_id,user_id:teacherId,role_id:viewer.data.id,expected_role_id:binding.role_id,expected_revision:binding.revision};
    expect((await request(adminCookies,staffPath("role-assignments/change-role"),input)).status).toBe(201);
    expect((await request(adminCookies,staffPath("role-assignments/change-role"),input)).status).toBe(409);
    expect((await pool.query("SELECT staff_has_class_permission($1,$2,'attendance.view',$3) AS read,staff_has_class_permission($1,$2,'attendance.record',$3,'2030-04-08') AS write",[schoolId,teacherId,sectionId])).rows[0]).toEqual({read:true,write:false});
    expect((await request(adminCookies,staffPath("role-assignments/end-class"),{source_id:native.id,expected_revision:2,reason:"Class assignment ended."})).status).toBe(201);
    expect((await pool.query("SELECT staff_has_class_permission($1,$2,'attendance.record',$3,'2030-04-08') AS allowed",[schoolId,teacherId,sectionId])).rows[0].allowed).toBe(false);
    expect((await request(adminCookies,staffPath("role-assignments/end-class"),{source_id:native.id,expected_revision:2,reason:"Retry stale request."})).status).toBe(409);
    const foreignSchool=randomUUID();
    await pool.query("INSERT INTO schools(id,name,code) VALUES($1,'Other institution',$2)",[foreignSchool,`foreign-${suffix.slice(0,8)}`]);
    const foreignRole=(await pool.query("SELECT id FROM staff_responsibility_types WHERE school_id=$1 AND code='class_teacher'",[foreignSchool])).rows[0];
    expect((await request(adminCookies,staffPath("role-assignments"),{role_id:foreignRole.id,staff_profile_id:profileId,scope_id:sectionId,starts_on:new Date().toISOString().slice(0,10)})).status).toBe(400);
    expect((await pool.query("SELECT action FROM school_operations_audit WHERE target_id=$1",[native.id])).rows.map((r)=>r.action)).toEqual(expect.arrayContaining(["staff.assignment.role_changed","staff.assignment.ended"]));
  });
});
