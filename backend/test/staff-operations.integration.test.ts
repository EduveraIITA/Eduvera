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
  const otherAdminEmail = `staff.other-admin.${suffix}@example.test`;
  const teacherEmail = `teacher.${suffix}@example.test`;
  const replacementEmail = `replacement.${suffix}@example.test`;
  const adminCookies = new Map<string, string>();
  const otherAdminCookies = new Map<string, string>();
  const teacherCookies = new Map<string, string>();
  const replacementCookies = new Map<string, string>();
  let server: ChildProcess;
  let schoolId: string;
  let adminId: string;
  let otherAdminId: string;
  let teacherId: string;
  let principalAgentId: string;
  let authorityRuleId: string;
  let behaviourId: string;
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
    const otherAdmin = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Arun','Office','admin') RETURNING id", [`other-admin.${suffix}`, otherAdminEmail, await hashPassword(password)]);
    otherAdminId=otherAdmin.rows[0].id;
    const teacher = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kavita','Mehta','staff') RETURNING id", [`teacher.${suffix}`, teacherEmail, await hashPassword(password)]);
    const replacement = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Rohan','Sen','staff') RETURNING id", [`replacement.${suffix}`, replacementEmail, await hashPassword(password)]);
    teacherId = teacher.rows[0].id;
    const school = await pool.query("INSERT INTO schools(name,code) VALUES('Staff Test School',$1) RETURNING id", [`staff-${suffix.slice(0, 12)}`]);
    schoolId = school.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'staff'),($3,$5,'staff'),($4,$5,'admin')", [admin.rows[0].id, teacherId, replacement.rows[0].id, otherAdminId, schoolId]);

    const authority = (await pool.query(`WITH person AS (
        INSERT INTO school_people(school_id,first_name,last_name,contact_email)
        VALUES($1,'Meera','Kapoor',$3) RETURNING id
      ), source AS (
        INSERT INTO institution_authority_sources(
          school_id,code,title,source_kind,reference,provision,evidence_reference,
          verification_state,effective_from,verified_by,verified_at,created_by
        ) VALUES($1,'staff_leave_test_authority','Staff leave test authority','appointment_order',
          'TEST-PRINCIPAL','Staff leave decisions','test:principal','verified',current_date,$2,now(),$2)
        RETURNING id
      ), office AS (
        INSERT INTO institution_governance_offices(
          school_id,code,title,purpose,authority_source_id,status,created_by
        ) SELECT $1,'principal','Principal','Decide staff leave requests.',source.id,'active',$2
          FROM source RETURNING id,authority_source_id
      ), appointment AS (
        INSERT INTO institution_governance_appointments(
          school_id,office_id,person_id,linked_user_id,appointment_kind,starts_on,status,
          authority_source_id,evidence_reference,created_by
        ) SELECT $1,office.id,person.id,$2,'appointed',current_date,'active',source.id,
          'test:principal',$2 FROM office,person,source RETURNING id,person_id
      ), decision_rule AS (
        INSERT INTO institution_decision_matter_rules(
          school_id,code,title,category,decision_summary,execution_summary,decision_mode,
          decision_office_id,authority_source_ids,conditions_summary,material_fields,
          status,effective_from,created_by
        ) SELECT $1,'staff_leave_decision','Staff leave decision','people',
          'The current Principal decides.','Staff Operations records the decision.',
          'individual',office.id,ARRAY[source.id]::uuid[],'Current officeholder only.',
          ARRAY['staff_profile','starts_on','ends_on']::text[],'confirmed',current_date,$2
          FROM office,source RETURNING id
      ) SELECT person.id AS person_id,source.id AS source_id,office.id AS office_id,
          appointment.id AS appointment_id,decision_rule.id AS rule_id
        FROM person,source,office,appointment,decision_rule`, [schoolId, adminId, adminEmail])).rows[0];
    const principalAgent = (await pool.query(`INSERT INTO campus_model_agents(
        school_id,agent_kind,person_id,label,status
      ) VALUES($1,'human',$2,'Meera Kapoor','active') RETURNING id`, [schoolId, authority.person_id])).rows[0];
    principalAgentId = principalAgent.id;
    authorityRuleId = authority.rule_id;
    await pool.query(`INSERT INTO campus_model_agent_endpoints(
        school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,
        source_domain,source_record_id,source_revision,linked_by_user_id
      ) VALUES($1,$2,'account','thatcampus',$3,'active',now()-interval '1 minute',
        'governance',$4,1,$3)`, [schoolId, principalAgent.id, adminId, authority.appointment_id]);
    await pool.query(`INSERT INTO campus_model_agent_authorities(
        school_id,agent_id,capability,effective_from,grant_source,grant_reference_id,
        approved_by,operating_rule_version_ref
      ) VALUES($1,$2,'staff_leave:decide',now()-interval '1 minute',
        'governance_decision_rule',$3,$4,'staff_leave_decision:test')`, [schoolId, principalAgent.id, authority.rule_id, adminId]);
    const behaviour = (await pool.query(`INSERT INTO campus_model_behaviour_versions(
        school_id,behaviour_key,version,status,effective_from,configuration,
        configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at
      ) VALUES($1,'staff_leave_decision_routing',1,'approved',now()-interval '1 minute',
        $2::jsonb,1,$3,$3,now()-interval '1 minute') RETURNING id`, [
      schoolId,
      JSON.stringify({ matter_code: "staff_leave_decision", selector_key: "leave_decision_owner" }),
      principalAgent.id,
    ])).rows[0];
    behaviourId = behaviour.id;
    await pool.query(`INSERT INTO campus_model_event_subscriptions(
        school_id,behaviour_version_id,subscription_key,source_domain,event_type,
        reaction_kind,message_kind,message_schema_version,recipient_selector,
        response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority
      ) VALUES($1,$2,'staff_leave_submitted_to_decision_owner','staff_operations',
        'staff.leave.submitted','staff_leave_decision_review','request',1,$3::jsonb,
        172800,604800,3,3600,7)`, [schoolId, behaviour.id, JSON.stringify({
      mode: "explicit_authorized_agents",
      selector_key: "leave_decision_owner",
      required_capability: "staff_leave:decide",
      scope_mode: "institution",
      min_recipients: 1,
      max_recipients: 1,
    })]);
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
    await request(otherAdminCookies, "auth/csrf/");
    expect((await request(otherAdminCookies, "auth/login/", { identifier: otherAdminEmail, password })).status).toBe(200);
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
    const profileEvents = await pool.query(
      "SELECT aggregate_id,event_type,payload,notification_payload FROM event_outbox WHERE aggregate_id=ANY($1::uuid[]) ORDER BY created_at",
      [[profileId, replacementProfileId]],
    );
    expect(profileEvents.rows).toHaveLength(2);
    expect(profileEvents.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        aggregate_id: profileId,
        event_type: "staff.access.updated",
        notification_payload: null,
        payload: expect.objectContaining({ action: "profile_created", refresh: expect.arrayContaining(["staff-operations", "principal.home"]) }),
      }),
    ]));
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id IN ($1,$2)", [profileId, replacementProfileId]);
    const workspace = await request(adminCookies, staffPath("workspace"));
    expect(workspace.data.profiles).toContainEqual(expect.objectContaining({ id: profileId, onboarding_total: 5, onboarding_complete: 1 }));
  });

  it("configures school leave policy and enforces role boundaries", async () => {
    const policy = await request(adminCookies, staffPath("leave-policies"), { academic_year: "2030-31", code: "CASUAL", name: "Casual leave", annual_allowance: 12, carry_forward_limit: 0, requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true });
    expect(policy.status).toBe(201); policyId = policy.data.id;
    const policyEvent = (await pool.query("SELECT event_type,payload,notification_payload FROM event_outbox WHERE aggregate_id=$1", [policyId])).rows[0];
    expect(policyEvent).toMatchObject({
      event_type: "administration.updated",
      notification_payload: null,
      payload: { action: "leave_policy_created", refresh: ["staff-operations"] },
    });
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

  it("rolls back leave submission when the configured coordination route is unavailable", async () => {
    await pool.query("UPDATE campus_model_behaviour_versions SET status='retired',retired_at=now() WHERE id=$1", [behaviourId]);
    const commandId = randomUUID();
    const reason = `Route rollback ${commandId}`;
    try {
      const blocked = await request(teacherCookies, staffPath("leave-requests"), {
        policy_id: policyId,
        starts_on: "2030-04-10",
        ends_on: "2030-04-10",
        portion: "full_day",
        reason,
        handover_note: "This private note must roll back with the request.",
        command_id: commandId,
      });
      expect(blocked.status).toBe(409);
      expect((await pool.query("SELECT count(*)::int total FROM staff_leave_requests WHERE school_id=$1 AND reason=$2", [schoolId, reason])).rows[0].total).toBe(0);
      expect((await pool.query("SELECT count(*)::int total FROM staff_leave_commands WHERE school_id=$1 AND command_id=$2", [schoolId, commandId])).rows[0].total).toBe(0);
    } finally {
      await pool.query("UPDATE campus_model_behaviour_versions SET status='approved',retired_at=NULL WHERE id=$1", [behaviourId]);
    }
  });

  it("submits, exposes timetable impact, approves and updates the balance", async () => {
    const submitCommandId = randomUUID();
    const leaveInput = { policy_id: policyId, starts_on: "2030-04-08", ends_on: "2030-04-08", portion: "full_day", reason: "Family medical appointment", handover_note: "Period 1 needs cover", command_id: submitCommandId };
    const leave = await request(teacherCookies, staffPath("leave-requests"), leaveInput);
    expect(leave.status).toBe(201); requestId = leave.data.id;
    const replayedLeave = await request(teacherCookies, staffPath("leave-requests"), leaveInput);
    expect(replayedLeave.status).toBe(201);
    expect(replayedLeave.data).toMatchObject({ id: requestId, status: "submitted", revision: leave.data.revision });
    const sameCorrelationLeave = await request(replacementCookies, staffPath("leave-requests"), {
      ...leaveInput,
      starts_on: "2030-04-11",
      ends_on: "2030-04-11",
      reason: "Second requester using the same client command UUID",
      handover_note: "Private second requester handover",
    });
    expect(sameCorrelationLeave.status).toBe(201);
    expect(sameCorrelationLeave.data.id).not.toBe(requestId);
    expect((await request(teacherCookies, staffPath("leave-requests"), { ...leaveInput, reason: "A different family medical appointment" })).status).toBe(409);
    expect((await pool.query("SELECT count(*)::int total FROM staff_leave_commands WHERE school_id=$1 AND actor_id=$2 AND command_id=$3", [schoolId, teacherId, submitCommandId])).rows[0].total).toBe(1);
    expect((await pool.query("SELECT count(*)::int total FROM event_outbox WHERE aggregate_id=$1 AND event_type='staff.leave.submitted'", [requestId])).rows[0].total).toBe(1);
    const modelTrace = (await pool.query(`SELECT event.correlation_id,event.payload,message.payload AS message_payload,
        endpoint.user_id AS recipient_user_id
      FROM campus_model_events event
      JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id
      JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
      JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=message.recipient_agent_id
        AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
        AND endpoint.status='active' AND endpoint.effective_from<=now()
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>now())
      WHERE event.school_id=$1 AND event.source_record_id=$2`, [schoolId, requestId])).rows[0];
    expect(modelTrace).toMatchObject({ correlation_id: submitCommandId, recipient_user_id: adminId });
    expect(JSON.stringify(modelTrace)).not.toMatch(/Family medical appointment|Period 1 needs cover|reason|handover/i);
    const otherAdminView = await request(otherAdminCookies, staffPath("workspace"));
    expect(otherAdminView.status).toBe(200);
    expect(otherAdminView.data.requests).not.toContainEqual(expect.objectContaining({ id: requestId }));
    const otherAdminRequests = await request(otherAdminCookies, "requests/?portal=principal");
    expect(otherAdminRequests.status).toBe(200);
    expect(otherAdminRequests.data.items).not.toContainEqual(expect.objectContaining({
      kind: "staff_leave_review",
      source_id: requestId,
    }));
    expect(JSON.stringify(otherAdminRequests.data)).not.toContain("Family medical appointment");
    expect((await request(otherAdminCookies, staffPath(`leave-requests/${requestId}/decision`), {
      decision: "approved", note: "Attempted by a technical administrator",
      expected_revision: leave.data.revision, command_id: randomUUID(),
    })).status).toBe(403);
    const adminView = await request(adminCookies, staffPath("workspace"));
    expect(adminView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "submitted", affected_periods: 1 }));
    const queued = adminView.data.requests.find((item: { id: string }) => item.id === requestId);
    const decisionCommandId = randomUUID();
    const decisionInput = { decision: "approved", note: "Cover arranged", expected_revision: queued.revision, command_id: decisionCommandId };
    await pool.query(`UPDATE campus_model_agent_authorities SET revoked_at=now(),revoked_by=$2
      WHERE school_id=$1 AND agent_id=$3 AND capability='staff_leave:decide' AND revoked_at IS NULL`,
    [schoolId, adminId, principalAgentId]);
    const blockedByRevocation = await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), {
      ...decisionInput,
      command_id: randomUUID(),
    });
    expect(blockedByRevocation.status).toBe(409);
    expect((await pool.query("SELECT status,revision FROM staff_leave_requests WHERE id=$1", [requestId])).rows[0])
      .toMatchObject({ status: "submitted", revision: leave.data.revision });
    await pool.query(`INSERT INTO campus_model_agent_authorities(
        school_id,agent_id,capability,effective_from,grant_source,grant_reference_id,
        approved_by,operating_rule_version_ref
      ) VALUES($1,$2,'staff_leave:decide',now(),
        'governance_decision_rule',$3,$4,'staff_leave_decision:test:replacement')`,
    [schoolId, principalAgentId, authorityRuleId, adminId]);
    const approved = await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), decisionInput);
    expect(approved.status).toBe(201);
    expect(approved.data).toMatchObject({ status: "approved", affected_periods: 1 });
    const otherAdminAfterDecision = await request(otherAdminCookies, staffPath("workspace"));
    expect(otherAdminAfterDecision.data.requests).not.toContainEqual(expect.objectContaining({ id: requestId }));
    expect(otherAdminAfterDecision.data.coverage_tasks.find((item: { leave_request_id: string }) => item.leave_request_id === requestId))
      .toMatchObject({ leave_reason: null, handover_note: "" });
    const operationalMessage = (await pool.query(`SELECT message.state,outcome.state AS outcome_state,
        outcome.response FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
      JOIN campus_model_events event ON event.id=reaction.trigger_event_id
      LEFT JOIN campus_model_operational_message_outcomes outcome ON outcome.message_id=message.id
        AND outcome.state='responded'
      WHERE event.school_id=$1 AND event.source_record_id=$2`, [schoolId, requestId])).rows[0];
    expect(operationalMessage).toMatchObject({ state: "responded", outcome_state: "responded" });
    expect(operationalMessage.response).toMatchObject({ decision: "approved", resulting_revision: approved.data.revision });
    const replayedDecision = await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), decisionInput);
    expect(replayedDecision.status).toBe(201);
    expect(replayedDecision.data).toMatchObject({ id: requestId, status: "approved", affected_periods: 1, revision: approved.data.revision });
    expect((await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), { ...decisionInput, note: "Different decision details" })).status).toBe(409);
    const secondWithdrawal = await request(
      replacementCookies,
      staffPath(`leave-requests/${sameCorrelationLeave.data.id}/withdraw`),
      { expected_revision: sameCorrelationLeave.data.revision, command_id: randomUUID() },
    );
    expect(secondWithdrawal.data).toMatchObject({ id: sameCorrelationLeave.data.id, status: "withdrawn" });
    const teacherView = await request(teacherCookies, staffPath("workspace"));
    expect(teacherView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "approved" }));
    expect(Number(teacherView.data.balances.find((item: { policy_id: string }) => item.policy_id === policyId).used)).toBe(1);
    expect(teacherView.data.coverage_tasks).toContainEqual(expect.objectContaining({ leave_request_id: requestId, status: "open" }));
    expect((await request(teacherCookies, staffPath(`leave-requests/${requestId}/withdraw`), { expected_revision: approved.data.revision, command_id: randomUUID() })).status).toBe(409);

    const withdrawable = await request(teacherCookies, staffPath("leave-requests"), {
      policy_id: policyId, starts_on: "2030-04-09", ends_on: "2030-04-09", portion: "full_day",
      reason: "Family follow-up appointment", handover_note: "No scheduled class", command_id: randomUUID(),
    });
    expect(withdrawable.status).toBe(201);
    const withdrawCommandId = randomUUID();
    const withdrawInput = { expected_revision: withdrawable.data.revision, command_id: withdrawCommandId };
    await pool.query("UPDATE institution_decision_matter_rules SET status='retired' WHERE id=$1", [authorityRuleId]);
    let withdrawn: { status: number; data: any };
    try {
      withdrawn = await request(teacherCookies, staffPath(`leave-requests/${withdrawable.data.id}/withdraw`), withdrawInput);
    } finally {
      await pool.query("UPDATE institution_decision_matter_rules SET status='confirmed' WHERE id=$1", [authorityRuleId]);
    }
    expect(withdrawn.data).toMatchObject({ id: withdrawable.data.id, status: "withdrawn" });
    const cancelledMessage = (await pool.query(`SELECT message.state,outcome.state AS outcome_state,
        actor_endpoint.user_id AS actor_user_id
      FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
      JOIN campus_model_events event ON event.id=reaction.trigger_event_id
      LEFT JOIN campus_model_operational_message_outcomes outcome ON outcome.message_id=message.id
        AND outcome.state='cancelled'
      LEFT JOIN campus_model_agent_endpoints actor_endpoint ON actor_endpoint.agent_id=outcome.actor_agent_id
        AND actor_endpoint.endpoint_kind='account' AND actor_endpoint.provider='thatcampus'
      WHERE event.school_id=$1 AND event.source_record_id=$2`, [schoolId, withdrawable.data.id])).rows[0];
    expect(cancelledMessage).toMatchObject({
      state: "cancelled",
      outcome_state: "cancelled",
      actor_user_id: teacherId,
    });
    const replayedWithdrawal = await request(teacherCookies, staffPath(`leave-requests/${withdrawable.data.id}/withdraw`), withdrawInput);
    expect(replayedWithdrawal.data).toMatchObject({ id: withdrawable.data.id, status: "withdrawn", revision: withdrawn.data.revision });
    expect((await request(teacherCookies, staffPath(`leave-requests/${withdrawable.data.id}/withdraw`), { ...withdrawInput, expected_revision: withdrawn.data.revision })).status).toBe(409);
  });

  it("records the configured fallback decision without claiming classroom delivery", async () => {
    await pool.query("UPDATE schools SET timezone='UTC' WHERE id=$1",[schoolId]);
    const tomorrow=new Date(Date.now()+86_400_000);
    const dutyDate=tomorrow.toISOString().slice(0,10);
    const startsAt="00:01:00";
    const endsAt="00:45:00";
    const historical=(await pool.query(`INSERT INTO staff_coverage_tasks(
      school_id,leave_request_id,absent_staff_profile_id,duty_date,starts_at,ends_at,title,status
    ) VALUES($1,$2,$3,current_date-1,'09:00','09:45','Historical mathematics','open') RETURNING id`,
    [schoolId,requestId,profileId])).rows[0];
    const upcoming=(await pool.query(`INSERT INTO staff_coverage_tasks(
      school_id,leave_request_id,absent_staff_profile_id,duty_date,starts_at,ends_at,title,status
    ) VALUES($1,$2,$3,$4,$5,$6,'Upcoming mathematics','open') RETURNING id`,
    [schoolId,requestId,profileId,dutyDate,startsAt,endsAt])).rows[0];

    const saved=await request(adminCookies,staffPath("coverage-policy"),{
      enabled:true,deadline_minutes_before:1440,fallback_kind:"physical_activity",fallback_label:"Games period",
      supervisor_staff_profile_id:replacementProfileId,expected_revision:0,
    },"PATCH");
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({enabled:true,fallback_kind:"physical_activity",fallback_label:"Games period",revision:1});
    const policyEvent=(await pool.query("SELECT event_type,payload,notification_payload FROM event_outbox WHERE aggregate_id=$1 AND aggregate_type='staff_coverage_policy'",[schoolId])).rows[0];
    expect(policyEvent).toMatchObject({event_type:"administration.updated",notification_payload:null,payload:{action:"coverage_policy_updated",refresh:["staff-operations"]}});

    const workspace=await request(adminCookies,staffPath("workspace"));
    expect(workspace.data.coverage_policy).toMatchObject({enabled:true,deadline_minutes_before:1440,supervisor_staff_profile_id:replacementProfileId});
    expect(workspace.data.coverage_tasks).toContainEqual(expect.objectContaining({
      id:historical.id,status:"fallback_applied",fallback_kind:"physical_activity",fallback_label:"Games period",
      fallback_supervisor_staff_profile_id:replacementProfileId,
    }));
    expect(workspace.data.coverage_tasks).toContainEqual(expect.objectContaining({
      id:upcoming.id,status:"fallback_applied",fallback_kind:"physical_activity",fallback_label:"Games period",
      fallback_supervisor_staff_profile_id:replacementProfileId,
    }));
    const audits=await pool.query("SELECT task_id,action,automated FROM staff_coverage_task_audits WHERE task_id=ANY($1::uuid[])",[ [historical.id,upcoming.id] ]);
    expect(audits.rows).toEqual(expect.arrayContaining([
      {task_id:historical.id,action:"fallback_applied",automated:true},
      {task_id:upcoming.id,action:"fallback_applied",automated:true},
    ]));
    const decidedRequest=workspace.data.requests.find((item: {id:string})=>item.id===requestId);
    expect(decidedRequest).toMatchObject({coverage_open:1,coverage_fallback:2,coverage_fallback_labels:"Games period"});
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

    const task = adminView.data.coverage_tasks.find((item: { leave_request_id: string; status:string }) => item.leave_request_id === requestId && item.status === "open");
    const offered = await request(adminCookies, staffPath(`coverage-tasks/${task.id}/assign`), { replacement_staff_profile_id: replacementProfileId, note: "Please cover period 1.", expected_revision: task.revision });
    expect(offered.data.status).toBe("offered");
    const replacementView = await request(replacementCookies, staffPath("workspace"));
    const coverOffer = replacementView.data.coverage_tasks.find((item: { id: string }) => item.id === task.id);
    expect(coverOffer).toMatchObject({ status: "offered", title: "Mathematics" });
    const coverCommandId = randomUUID();
    const coverResponse = { decision: "accepted", note: "I have reviewed the handover.", expected_revision: coverOffer.revision, command_id: coverCommandId };
    const coverAccepted = await request(replacementCookies, staffPath(`coverage-tasks/${task.id}/response`), coverResponse);
    expect(coverAccepted.data.status).toBe("accepted");
    expect(coverAccepted.data.effective_substitution).toMatchObject({
      effective_timetable: true,
      source_kind: "legacy_timetable",
      original_teacher_user_id: teacherId,
      replacement_teacher_user_id: expect.any(String),
    });
    const replayedCover = await request(replacementCookies, staffPath(`coverage-tasks/${task.id}/response`), coverResponse);
    expect(replayedCover.status).toBe(201);
    expect(replayedCover.data).toEqual(coverAccepted.data);
    expect((await request(replacementCookies, staffPath(`coverage-tasks/${task.id}/response`), {
      ...coverResponse,
      note: "Different response details",
    })).status).toBe(409);
    const effective = (await pool.query(`SELECT teacher_user_id,coverage_status,coverage_record_id,
        coverage_task_id,coverage_task_revision,original_teacher_user_id,
        replacement_staff_profile_id,source_kind,source_record_id,source_revision
      FROM effective_school_schedule_v3($1,'2030-04-08')
      WHERE class_section_id=$2 AND period_number=1`, [schoolId,sectionId])).rows[0];
    expect(effective).toMatchObject({
      teacher_user_id: coverAccepted.data.effective_substitution.replacement_teacher_user_id,
      coverage_status: "accepted",
      coverage_record_id: coverAccepted.data.effective_substitution.id,
      coverage_task_id: task.id,
      coverage_task_revision: coverAccepted.data.revision,
      original_teacher_user_id: teacherId,
      replacement_staff_profile_id: replacementProfileId,
      source_kind: "legacy_timetable",
    });
    const evidence = (await pool.query(`SELECT command_id,decision,source_task_revision,
        resulting_task_revision,substitution_id,authority_receipt,schedule_provenance
      FROM staff_coverage_commands WHERE school_id=$1 AND target_task_id=$2`, [schoolId,task.id])).rows;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      command_id: coverCommandId,
      decision: "accepted",
      source_task_revision: coverOffer.revision,
      resulting_task_revision: coverAccepted.data.revision,
      substitution_id: coverAccepted.data.effective_substitution.id,
      authority_receipt: {
        authority_kind: "exact_manual_coverage_task_recipient",
        recipient_user_id: coverAccepted.data.effective_substitution.replacement_teacher_user_id,
      },
      schedule_provenance: {
        effective_timetable: true,
        occurrence_key: coverAccepted.data.effective_substitution.occurrence_key,
      },
    });

    // Cancellation retains the first decision as history but must release the
    // planned occurrence for a new linked obligation. The database also owns
    // the invariant that only the offered replacement can accept that cover.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE staff_timetable_substitutions SET state='cancelled',superseded_at=now() WHERE id=$1",
        [coverAccepted.data.effective_substitution.id],
      );
      await client.query("UPDATE staff_coverage_tasks SET status='cancelled' WHERE id=$1", [task.id]);
      const linkedTask = (await client.query(`INSERT INTO staff_coverage_tasks(
          school_id,leave_request_id,absent_staff_profile_id,replacement_staff_profile_id,
          source_schedule_id,class_section_id,subject_id,duty_date,period_number,
          starts_at,ends_at,title,location,status,handover_note,assigned_by,
          offered_at,responded_at,response_note
        ) SELECT school_id,leave_request_id,absent_staff_profile_id,replacement_staff_profile_id,
          source_schedule_id,class_section_id,subject_id,duty_date,period_number,
          starts_at,ends_at,title,location,'accepted',handover_note,assigned_by,
          now(),now(),'Replacement decision after cancellation'
        FROM staff_coverage_tasks WHERE id=$1 RETURNING id,revision`, [task.id])).rows[0];
      expect(linkedTask.id).toEqual(expect.any(String));

      await client.query("SAVEPOINT wrong_accepting_actor");
      await expect(client.query(`INSERT INTO staff_timetable_substitutions(
          school_id,coverage_task_id,class_section_id,subject_id,duty_date,
          period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
          source_kind,source_record_id,source_revision,source_version,
          original_teacher_user_id,replacement_staff_profile_id,
          replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at
        ) SELECT school_id,$2,class_section_id,subject_id,duty_date,
          period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
          source_kind,source_record_id,source_revision,source_version,
          original_teacher_user_id,replacement_staff_profile_id,
          replacement_teacher_user_id,$3,$4,now()
        FROM staff_timetable_substitutions WHERE id=$1`, [
        coverAccepted.data.effective_substitution.id,
        linkedTask.id,
        linkedTask.revision,
        adminId,
      ])).rejects.toThrow(/active offered staff account/i);
      await client.query("ROLLBACK TO SAVEPOINT wrong_accepting_actor");

      const linkedSubstitution = (await client.query(`INSERT INTO staff_timetable_substitutions(
          school_id,coverage_task_id,class_section_id,subject_id,duty_date,
          period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
          source_kind,source_record_id,source_revision,source_version,
          original_teacher_user_id,replacement_staff_profile_id,
          replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at
        ) SELECT school_id,$2,class_section_id,subject_id,duty_date,
          period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
          source_kind,source_record_id,source_revision,source_version,
          original_teacher_user_id,replacement_staff_profile_id,
          replacement_teacher_user_id,$3,replacement_teacher_user_id,now()
        FROM staff_timetable_substitutions WHERE id=$1 RETURNING id`, [
        coverAccepted.data.effective_substitution.id,
        linkedTask.id,
        linkedTask.revision,
      ])).rows[0];
      expect(linkedSubstitution.id).toEqual(expect.any(String));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("preserves accepted cover through a temporary closure and after task completion", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accepted = (await client.query(`SELECT substitution.id AS substitution_id,
          substitution.coverage_task_id,substitution.duty_date::text,
          substitution.replacement_teacher_user_id
        FROM staff_timetable_substitutions substitution
        JOIN staff_coverage_tasks task ON task.id=substitution.coverage_task_id
          AND task.school_id=substitution.school_id
        WHERE substitution.school_id=$1 AND substitution.state='effective'
          AND task.status='accepted'
        ORDER BY substitution.created_at DESC LIMIT 1`, [schoolId])).rows[0];
      expect(accepted).toBeTruthy();

      await client.query(`INSERT INTO school_calendar_days(
          school_id,date,is_instructional,label
        ) VALUES($1,$2,false,'Temporary weather closure')`, [schoolId, accepted.duty_date]);
      expect((await client.query(
        "SELECT * FROM reconcile_staff_timetable_substitution_details($1,$2,$2,NULL)",
        [schoolId, accepted.duty_date],
      )).rows).toEqual([]);
      expect((await client.query(
        "SELECT state FROM staff_timetable_substitutions WHERE id=$1",
        [accepted.substitution_id],
      )).rows[0].state).toBe("effective");

      await client.query(
        "DELETE FROM school_calendar_days WHERE school_id=$1 AND date=$2",
        [schoolId, accepted.duty_date],
      );
      const restored = (await client.query(`SELECT teacher_user_id,coverage_status
        FROM effective_school_schedule_v3($1,$2)
        WHERE coverage_task_id=$3`, [
        schoolId, accepted.duty_date, accepted.coverage_task_id,
      ])).rows[0];
      expect(restored).toMatchObject({
        teacher_user_id: accepted.replacement_teacher_user_id,
        coverage_status: "accepted",
      });

      await client.query(
        "UPDATE staff_coverage_tasks SET status='completed' WHERE id=$1",
        [accepted.coverage_task_id],
      );
      await client.query(
        "UPDATE staff_profiles SET status='onboarding' WHERE id=$1",
        [replacementProfileId],
      );
      expect((await client.query(
        "SELECT * FROM reconcile_staff_timetable_substitution_details($1,$2,$2,NULL)",
        [schoolId, accepted.duty_date],
      )).rows).toEqual([]);
      expect((await client.query(
        "SELECT state FROM staff_timetable_substitutions WHERE id=$1",
        [accepted.substitution_id],
      )).rows[0].state).toBe("effective");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("retains elapsed accepted cover when the replacement later becomes inactive", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const acceptedTask = (await client.query(`SELECT task.*,request.policy_id,
          absent.user_id AS absent_user_id,replacement.user_id AS replacement_user_id,
          slot.weekday,slot.term_id,school.timezone
        FROM staff_coverage_tasks task
        JOIN staff_leave_requests request ON request.id=task.leave_request_id
        JOIN staff_profiles absent ON absent.id=task.absent_staff_profile_id
        JOIN staff_profiles replacement ON replacement.id=task.replacement_staff_profile_id
        JOIN timetable_slots slot ON slot.id=task.source_schedule_id
        JOIN schools school ON school.id=task.school_id
        WHERE task.school_id=$1 AND task.status='accepted' AND task.source_schedule_id IS NOT NULL
        ORDER BY task.created_at LIMIT 1`, [schoolId])).rows[0];
      const pastDate = (await client.query(`SELECT (
          (now() AT TIME ZONE $1)::date
          - ((((extract(isodow FROM now() AT TIME ZONE $1)::int-$2::int)+7)%7)+7)
        )::date AS duty_date`, [acceptedTask.timezone, acceptedTask.weekday])).rows[0].duty_date;
      // The fixture's academic term is intentionally future-dated. Extend it
      // only inside this rolled-back transaction so the same recurring source
      // row can represent an elapsed school date.
      await client.query(`UPDATE academic_terms
        SET starts_on=LEAST(starts_on,$2::date),ends_on=GREATEST(ends_on,$2::date)
        WHERE id=$1`, [acceptedTask.term_id, pastDate]);
      const planned = (await client.query(`SELECT * FROM planned_school_schedule_v2($1,$2)
        WHERE id=$3 AND class_section_id=$4 AND period_number=$5`, [
        schoolId, pastDate, acceptedTask.source_schedule_id,
        acceptedTask.class_section_id, acceptedTask.period_number,
      ])).rows[0];
      expect(planned.teacher_user_id).toBe(acceptedTask.absent_user_id);

      const historicalLeave = (await client.query(`INSERT INTO staff_leave_requests(
          school_id,staff_profile_id,policy_id,starts_on,ends_on,portion,
          requested_days,reason,handover_note,status,revision,submitted_at,
          decided_by,decided_at,decision_note
        ) VALUES($1,$2,$3,$4,$4,'full_day',1,'Historical cover validation',
          'Validate elapsed timetable truth','approved',2,now(),$5,now(),'Approved')
        RETURNING id`, [
        schoolId, acceptedTask.absent_staff_profile_id, acceptedTask.policy_id,
        pastDate, adminId,
      ])).rows[0];
      const historicalTask = (await client.query(`INSERT INTO staff_coverage_tasks(
          school_id,leave_request_id,absent_staff_profile_id,replacement_staff_profile_id,
          source_schedule_id,class_section_id,subject_id,duty_date,period_number,
          starts_at,ends_at,title,location,status,handover_note,assigned_by,
          offered_at,responded_at,response_note
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'accepted',
          'Historical cover validation',$14,now(),now(),'Accepted')
        RETURNING id,revision`, [
        schoolId, historicalLeave.id, acceptedTask.absent_staff_profile_id,
        replacementProfileId, planned.id, planned.class_section_id, planned.subject_id,
        pastDate, planned.period_number, planned.starts_at, planned.ends_at,
        planned.title, planned.room ?? "", adminId,
      ])).rows[0];
      await client.query(`INSERT INTO staff_coverage_task_audits(
          school_id,task_id,actor_id,action,from_status,to_status,note
        ) VALUES($1,$2,$3,'accepted','offered','accepted','Accepted')`, [
        schoolId, historicalTask.id, acceptedTask.replacement_user_id,
      ]);
      const historicalSubstitution = (await client.query(`INSERT INTO staff_timetable_substitutions(
          school_id,coverage_task_id,class_section_id,subject_id,duty_date,
          period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
          source_kind,source_record_id,source_revision,source_version,
          original_teacher_user_id,replacement_staff_profile_id,
          replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          $15,$16,$17,$18,$17,now()) RETURNING id`, [
        schoolId, historicalTask.id, planned.class_section_id, planned.subject_id,
        pastDate, planned.period_number, planned.starts_at, planned.ends_at,
        planned.id, planned.occurrence_key, planned.source_kind,
        planned.source_record_id, planned.source_revision, planned.source_version,
        acceptedTask.absent_user_id, replacementProfileId,
        acceptedTask.replacement_user_id, historicalTask.revision,
      ])).rows[0];

      await client.query("UPDATE staff_profiles SET status='inactive' WHERE id=$1", [replacementProfileId]);
      await client.query("UPDATE users SET is_active=false WHERE id=$1", [acceptedTask.replacement_user_id]);
      await client.query(`UPDATE school_memberships SET is_active=false
        WHERE school_id=$1 AND user_id=$2 AND role='staff'`, [
        schoolId, acceptedTask.replacement_user_id,
      ]);
      const historicalEffective = (await client.query(`SELECT teacher_user_id,
          coverage_status,coverage_record_id,coverage_task_id
        FROM effective_school_schedule_v3($1,$2)
        WHERE id=$3 AND class_section_id=$4 AND period_number=$5`, [
        schoolId, pastDate, planned.id, planned.class_section_id, planned.period_number,
      ])).rows[0];
      expect(historicalEffective).toMatchObject({
        teacher_user_id: acceptedTask.replacement_user_id,
        coverage_status: "accepted",
        coverage_record_id: historicalSubstitution.id,
        coverage_task_id: historicalTask.id,
      });
      const reconciled = await client.query(
        "SELECT * FROM reconcile_staff_timetable_substitution_details($1,$2,$2,$3)",
        [schoolId, pastDate, planned.class_section_id],
      );
      expect(reconciled.rows).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("withdraws offers when a linked profile leaves active service and preserves an exact revocation outcome", async () => {
    const adminView = await request(adminCookies, staffPath("workspace"));
    const type = adminView.data.responsibility_types.find((item: { code: string }) => item.code === "school_duty");
    const created = await request(adminCookies, staffPath("responsibilities"), {
      responsibility_type_id: type.id, staff_profile_id: profileId, class_section_id: null,
      subject_id: null, event_id: null, scope_label: "Temporary gate review", location: "North gate",
      starts_on: "2030-04-20", ends_on: "2030-04-20", starts_at: "08:00", ends_at: "08:30",
      notes: "Transition-state authorization test.", backup_staff_profile_id: null,
    });
    expect(created.status).toBe(201);
    const cover = (await pool.query(`INSERT INTO staff_coverage_tasks(
      school_id,leave_request_id,absent_staff_profile_id,replacement_staff_profile_id,
      duty_date,title,status,assigned_by,offered_at
    ) VALUES($1,$2,$3,$4,'2030-04-20','Transition cover','offered',$5,now()) RETURNING id,revision`,
    [schoolId,requestId,profileId,replacementProfileId,adminId])).rows[0];

    const replacementProfile = adminView.data.profiles.find(
      (profile: { id: string }) => profile.id === replacementProfileId,
    );
    const replacementOnboardingItem = adminView.data.onboarding_items.find(
      (item: { staff_profile_id: string; completed_at: string | null }) =>
        item.staff_profile_id === replacementProfileId && item.completed_at === null,
    );
    const eligibilityChanged = await request(
      adminCookies,
      staffPath(`profiles/${replacementProfileId}/onboarding`),
      {
        item_id: replacementOnboardingItem.id,
        completed: false,
        note: "Return to onboarding while eligibility is reviewed.",
        expected_revision: replacementProfile.revision,
      },
      "PATCH",
    );
    expect(eligibilityChanged.status).toBe(200);
    expect(eligibilityChanged.data).toMatchObject({
      status: "onboarding",
      coverage_reconciliation: {
        superseded_substitution_ids: [expect.any(String)],
        cancelled_task_ids: [expect.any(String)],
        reopened_task_ids: [expect.any(String)],
        model_event_ids: [expect.any(String)],
      },
    });
    const onboardingAudit = (await pool.query(`SELECT metadata
      FROM school_operations_audit
      WHERE school_id=$1 AND target_id=$2 AND action='staff.onboarding.updated'
      ORDER BY created_at DESC LIMIT 1`, [schoolId, replacementProfileId])).rows[0];
    expect(onboardingAudit.metadata).toMatchObject({
      previous_status: "active",
      status: "onboarding",
      correlation_id: expect.any(String),
      coverage_preparation: { model_event_ids: expect.any(Array) },
      coverage_reconciliation: {
        superseded_substitution_ids: eligibilityChanged.data.coverage_reconciliation.superseded_substitution_ids,
      },
    });
    await pool.query("UPDATE staff_profiles SET status='onboarding' WHERE id=$1",[profileId]);
    const teacherWorkspace = await request(teacherCookies, staffPath("workspace"));
    expect(teacherWorkspace.data.assignments.some((item:{id:string})=>item.id===created.data.id)).toBe(false);
    const replacementWorkspace = await request(replacementCookies, staffPath("workspace"));
    expect(replacementWorkspace.data.coverage_tasks.some((item:{id:string})=>item.id===cover.id)).toBe(false);
    const teacherRequests = await request(teacherCookies, "requests/?portal=teacher");
    expect(teacherRequests.data.items.some((item:{kind:string;source_id:string})=>item.kind==="responsibility_offer"&&item.source_id===created.data.id)).toBe(false);
    const replacementRequests = await request(replacementCookies, "requests/?portal=teacher");
    expect(replacementRequests.data.items.some((item:{kind:string;source_id:string})=>item.kind==="coverage_offer"&&item.source_id===cover.id)).toBe(false);
    expect((await request(teacherCookies, staffPath(`responsibilities/${created.data.id}/response`), { decision:"accepted", note:"Confirmed", expected_revision:created.data.revision })).status).toBe(404);
    expect((await request(replacementCookies, staffPath(`coverage-tasks/${cover.id}/response`), { decision:"accepted", note:"Confirmed cover", expected_revision:cover.revision, command_id:randomUUID() })).status).toBe(404);

    const revoked = await request(adminCookies, staffPath(`responsibilities/${created.data.id}/revoke`), { reason:"Profile moved back to onboarding.", expected_revision:created.data.revision });
    expect(revoked.status).toBe(201);
    const afterRevocation = await request(teacherCookies, staffPath("workspace"));
    expect(afterRevocation.data.assignments).toContainEqual(expect.objectContaining({ id:created.data.id, status:"revoked", revocation_reason:"Profile moved back to onboarding." }));
    const event = await pool.query("SELECT notification_payload FROM event_outbox WHERE aggregate_id=$1 AND event_type='staff.access.updated' ORDER BY created_at DESC LIMIT 1",[created.data.id]);
    expect(event.rows[0]?.notification_payload).toMatchObject({
      attention_source_kind:"responsibility_revocation", attention_source_revision:revoked.data.revision,
      staff_link:`/teacher/responsibilities?assignment=${created.data.id}&assignment_revision=${revoked.data.revision}`,
    });

    const futureEffective = (await pool.query(`SELECT teacher_user_id,coverage_status,
        coverage_record_id,coverage_task_id
      FROM effective_school_schedule_v3($1,'2030-04-08')
      WHERE class_section_id=$2 AND period_number=1`, [schoolId, sectionId])).rows[0];
    expect(futureEffective).toMatchObject({
      teacher_user_id: null,
      coverage_status: "unassigned",
      coverage_record_id: null,
      coverage_task_id: null,
    });
    const stale = (await pool.query(`SELECT *
      FROM reconcile_staff_timetable_substitution_details($1,'2030-04-08','2030-04-08',$2)`, [
      schoolId, sectionId,
    ])).rows;
    expect(stale).toEqual([]);
    expect((await pool.query(`SELECT state FROM staff_timetable_substitutions
      WHERE id=ANY($1::uuid[])`, [
      eligibilityChanged.data.coverage_reconciliation.superseded_substitution_ids,
    ])).rows.every((row) => row.state === "superseded")).toBe(true);

    await pool.query("UPDATE staff_profiles SET status='active' WHERE id IN ($1,$2)",[profileId,replacementProfileId]);
    await pool.query("UPDATE staff_coverage_tasks SET status='cancelled' WHERE id=$1",[cover.id]);
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

  it("exposes, saves and assigns gate access to an existing staff member with immediate revocation",async()=>{
    const workspace=await request(adminCookies,staffPath("workspace"));
    expect(workspace.data.role_options.contexts.find((item:{code:string})=>item.code==="institution").permissions).toContain("gate.manage");
    const gatePath=`gate/schools/${schoolId}/workspace/`;
    expect((await request(teacherCookies,gatePath)).status).toBe(403);
    const usersBefore=(await pool.query("SELECT count(*)::int total FROM users")).rows[0].total;
    const payload={name:"Gate desk operator",context_kind:"institution",permissions:["gate.manage"]};
    expect((await request(teacherCookies,staffPath("access-roles"),payload)).status).toBe(403);
    expect((await request(adminCookies,staffPath("access-roles"),{...payload,name:"Wrong gate scope",context_kind:"class"})).status).toBe(400);
    const role=await request(adminCookies,staffPath("access-roles"),payload);
    expect(role.status).toBe(201);
    expect(role.data.permissions).toEqual(["gate.manage"]);
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id=$1",[profileId]);
    const assignment=await request(adminCookies,staffPath("role-assignments"),{role_id:role.data.id,staff_profile_id:profileId,starts_on:new Date().toISOString().slice(0,10)});
    expect(assignment.status).toBe(201);
    expect((await request(teacherCookies,gatePath)).status).toBe(200);
    const effective=await request(teacherCookies,`schools/${schoolId}/roles/effective/`);
    expect(effective.data.permissions).toContain("gate.manage");
    expect(effective.data.permissions).not.toContain("departure.manage");
    expect((await pool.query("SELECT count(*)::int total FROM users")).rows[0].total).toBe(usersBefore);
    expect((await pool.query("SELECT action FROM school_operations_audit WHERE target_id=$1",[assignment.data.id])).rows).toContainEqual({action:"staff.role.assigned"});
    expect((await request(adminCookies,staffPath(`responsibilities/${assignment.data.id}/revoke`),{reason:"Gate cover completed.",expected_revision:assignment.data.revision})).status).toBe(201);
    expect((await request(teacherCookies,gatePath)).status).toBe(403);
  });

  it("publishes onboarding and balance changes only to affected staff projections", async () => {
    const workspace = await request(adminCookies, staffPath("workspace"));
    const profile = workspace.data.profiles.find((item: { id: string }) => item.id === profileId);
    const onboardingItem = workspace.data.onboarding_items.find((item: { staff_profile_id: string }) => item.staff_profile_id === profileId);
    const onboarding = await request(adminCookies, staffPath(`profiles/${profileId}/onboarding`), {
      item_id: onboardingItem.id,
      completed: true,
      note: "Checked in the test workflow.",
      expected_revision: profile.revision,
    }, "PATCH");
    expect(onboarding.status).toBe(200);
    const onboardingEvent = (await pool.query(
      "SELECT event_type,payload,notification_payload FROM event_outbox WHERE aggregate_id=$1 AND idempotency_key LIKE 'staff.onboarding_updated:%' ORDER BY created_at DESC LIMIT 1",
      [profileId],
    )).rows[0];
    expect(onboardingEvent).toMatchObject({
      event_type: "staff.access.updated",
      notification_payload: null,
      payload: { action: "onboarding_updated", refresh: expect.arrayContaining(["staff.access", "staff-operations", "teacher.home", "principal.home"]) },
    });

    const adjustment = await request(adminCookies, staffPath("balance-adjustments"), {
      staff_profile_id: profileId,
      policy_id: policyId,
      days: 1,
      reason: "Opening balance correction for test evidence.",
    });
    expect(adjustment.status).toBe(201);
    const balanceEvent = (await pool.query("SELECT event_type,payload,notification_payload,audience_user_ids FROM event_outbox WHERE aggregate_id=$1", [adjustment.data.id])).rows[0];
    expect(balanceEvent).toMatchObject({
      event_type: "administration.updated",
      notification_payload: null,
      payload: { action: "leave_balance_adjusted", staff_profile_id: profileId, policy_id: policyId, refresh: ["staff-operations"] },
    });
    expect(balanceEvent.audience_user_ids).toEqual(expect.arrayContaining([adminId, otherAdminId, teacherId]));
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id=$1", [profileId]);
  });
});
