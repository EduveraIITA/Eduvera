import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

suite("progressive capability first use against PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_ISOLATED === "true"
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 2 });
  const base = "http://127.0.0.1:8074/api/v1/";
  const suffix = randomUUID();
  const jars = { owner: new Map<string, string>(), outsider: new Map<string, string>() };
  let server: ChildProcess;

  async function request(
    actor: keyof typeof jars,
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    extraHeaders: Record<string, string> = {},
  ) {
    const jar = jars[actor];
    const headers: Record<string, string> = {
      Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      ...extraHeaders,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (jar.get("csrftoken")) headers["X-CSRFToken"] = jar.get("csrftoken")!;
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const split = pair.indexOf("=");
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data: data as any };
  }

  beforeAll(async () => {
    server = spawn(process.execPath, ["dist/main.js"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "8074",
        COOKIE_SECRET: "progressive-setup-integration-secret-2026",
        NODE_ENV: "test",
        RATE_LIMIT_STORE: "memory",
        LOG_LEVEL: "error",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { if ((await fetch("http://127.0.0.1:8074/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
  }, 30_000);

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("starts with gate only, adds a reusable attendance register, and preserves tenant boundaries", async () => {
    for (const actor of ["owner", "outsider"] as const) {
      await request(actor, "auth/csrf/");
      const registered = await request(actor, "auth/register/", {
        email: `progressive.${actor}.${suffix}@example.test`,
        password: "Str0ng!ProgressiveRiver2026",
      });
      expect(registered.status, JSON.stringify(registered.data)).toBe(201);
    }
    const owner = await request("owner", "auth/me/");
    const outsider = await request("outsider", "auth/me/");
    const schoolId = owner.data.user.active_school_id as string;
    const outsiderSchoolId = outsider.data.user.active_school_id as string;
    expect(schoolId).not.toBe(outsiderSchoolId);

    const selectedGate = await request("owner", "onboarding/goals/", {
      goals: ["gate"], primary: "gate",
    }, "PUT");
    expect(selectedGate.status, JSON.stringify(selectedGate.data)).toBe(200);

    const empty = await request("owner", `schools/${schoolId}/get-started/`);
    expect(empty.data.options).toMatchObject({ classes: [], students: [], gates: [] });

    const gate = await request("owner", `schools/${schoolId}/get-started/gate/`, {
      gate_name: "Front desk", operator: { kind: "current_user", confirm: true },
    });
    expect(gate.status, JSON.stringify(gate.data)).toBe(201);
    expect(gate.data).toMatchObject({ status: "working", destination: "/areas/in-out/operate", readiness: { destination: "/areas/in-out/operate" }, created: { gate: true } });
    const gateResume = (await pool.query(`SELECT workspace.owner_user_id::text,workspace.resume_step,
        workspace.resume_goal_key,workspace.resume_path,workspace.revision
      FROM progressive_onboarding_workspaces workspace WHERE workspace.school_id=$1`, [schoolId])).rows[0];
    expect(gateResume).toMatchObject({
      owner_user_id: owner.data.user.id,
      resume_step: "operating",
      resume_goal_key: "gate",
      resume_path: "/areas/in-out/operate",
    });
    expect((await pool.query(`SELECT metadata FROM progressive_onboarding_audits audit
      JOIN progressive_onboarding_workspaces workspace ON workspace.id=audit.workspace_id
      WHERE workspace.school_id=$1 AND audit.action='resume_updated'
        AND audit.metadata->>'goal'='gate' ORDER BY audit.created_at DESC LIMIT 1`, [schoolId])).rows[0].metadata)
      .toMatchObject({ step: "operating", goal: "gate", path: "/areas/in-out/operate", source: "accepted_capability_setup" });
    expect((await pool.query("SELECT count(*)::int n FROM academic_terms WHERE school_id=$1", [schoolId])).rows[0].n).toBe(0);
    const repeatedGate = await request("owner", `schools/${schoolId}/get-started/gate/`, {
      existing_gate_id: gate.data.resources.gate_space_id, operator: { kind: "current_user", confirm: true },
    });
    expect(repeatedGate.data).toMatchObject({ created: { gate: false }, reused: { gate: true } });

    const attendance = await request("owner", `schools/${schoolId}/get-started/attendance/`, {
      group_name: "Batch A",
      participant_names: ["Learner One", "Learner Two"],
      existing_student_ids: [],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Test Owner" },
      session: { starts_at: "09:00", ends_at: "09:30", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    expect(attendance.status, JSON.stringify(attendance.data)).toBe(201);
    expect(attendance.data).toMatchObject({
      status: "working",
      created: { group: true, participants: 2, assignment: true, sessions: 7 },
      readiness: { status: "working", counts: { groups: 1, participants: 2, rostered: 2, sessions: 7 } },
    });
    const classId = attendance.data.resources.class_section_id as string;
    const studentIds = attendance.data.resources.student_ids as string[];
    const identityBridge = (await pool.query(`SELECT profile.person_id::text,agent.person_id::text AS agent_person_id,
        profile.employment_type,profile.joined_on,
        (SELECT count(*)::int FROM staff_profiles p WHERE p.school_id=profile.school_id AND p.user_id=profile.user_id) profile_count,
        (SELECT count(*)::int FROM school_people p WHERE p.school_id=profile.school_id) person_count
      FROM staff_profiles profile JOIN campus_model_agent_endpoints endpoint
        ON endpoint.school_id=profile.school_id AND endpoint.user_id=profile.user_id AND endpoint.status='active'
      JOIN campus_model_agents agent ON agent.school_id=endpoint.school_id AND agent.id=endpoint.agent_id
      WHERE profile.school_id=$1 AND profile.user_id=$2`, [schoolId, owner.data.user.id])).rows[0];
    expect(identityBridge).toMatchObject({ employment_type: "unspecified", joined_on: null, profile_count: 1, person_count: 3 });
    expect(identityBridge.person_id).toBe(identityBridge.agent_person_id);
    // Canonical navigation must open the real register; the legacy Attendance API
    // accepting the domain assignment alone did not catch the original release bug.
    const manifest = await request("owner", "workspace/");
    expect(manifest.status, JSON.stringify(manifest.data)).toBe(200);
    expect(manifest.data.areas.find((area: { key: string }) => area.key === "attendance").surfaces)
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "registers" })]));
    expect((await pool.query(`SELECT action_key FROM campus_responsibility_assignments
      WHERE school_id=$1 AND owner_agent_id=(SELECT agent_id FROM campus_model_agent_endpoints
        WHERE school_id=$1 AND user_id=$2 AND status='active' LIMIT 1) AND status='active'
        AND provenance->>'source_kind'='class_assignment'`, [schoolId, owner.data.user.id])).rows.map((row) => row.action_key))
      .toEqual(expect.arrayContaining(["attendance.view", "attendance.record", "timetable.view"]));
    const date = new URL(attendance.data.destination, "http://thatcampus.local").searchParams.get("date")!;
    const rediscovered = await request("owner", "attendance/workspace?surface=registers");
    expect(rediscovered.status, JSON.stringify(rediscovered.data)).toBe(200);
    expect(rediscovered.data.mode).toBe("daily_class");
    expect(rediscovered.data.registers).toEqual([expect.objectContaining({ class_section_id: classId, can_mark: true })]);
    const resumeAfterUnselectedAttendance = (await pool.query(`SELECT resume_step,resume_goal_key,resume_path
      FROM progressive_onboarding_workspaces WHERE school_id=$1`, [schoolId])).rows[0];
    expect(resumeAfterUnselectedAttendance).toEqual({ resume_step: "operating", resume_goal_key: "gate", resume_path: "/areas/in-out/operate" });
    const afterAttendance = await request("owner", `schools/${schoolId}/get-started/`);
    const workingAttendance = afterAttendance.data.working_now.find((item: { capability: string }) => item.capability === "attendance");
    expect(workingAttendance.destination).toBe(`/areas/attendance/registers?class_section_id=${classId}&date=${date}`);
    const register = await request("owner", `screens/teacher/attendance/?class_section_id=${classId}&date=${date}`);
    expect(register.status).toBe(200);
    expect(register.data).toMatchObject({ availability: { can_mark: true }, roster: [{ name: "Learner One" }, { name: "Learner Two" }] });
    const submitted = await request("owner", "teacher/attendance/bulk/", {
      class_section_id: classId, date, expected_revision: 0,
      records: studentIds.map((student_id, index) => ({ student_id, status: index ? "absent" : "present", remarks: index ? "Integration test" : "" })),
    }, "POST", { "Idempotency-Key": `progressive-${suffix}` });
    expect(submitted.status, JSON.stringify(submitted.data)).toBe(200);
    expect(submitted.data.register).toMatchObject({ state: "submitted", revision: 1 });
    const afterSubmission = await request("owner", "attendance/workspace?surface=registers");
    expect(afterSubmission.data.registers).toEqual([expect.objectContaining({ class_section_id: classId, submission_status: "submitted", marked_count: 2 })]);

    const selectedAttendance = await request("owner", "onboarding/goals/", {
      goals: ["attendance", "gate"], primary: "attendance",
    }, "PUT");
    expect(selectedAttendance.status, JSON.stringify(selectedAttendance.data)).toBe(200);

    const repeatedAttendance = await request("owner", `schools/${schoolId}/get-started/attendance/`, {
      existing_class_id: classId, participant_names: [], existing_student_ids: studentIds,
      responsible: { kind: "current_user", self_teaches: true },
      session: { starts_at: "09:00", ends_at: "09:30", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    expect(repeatedAttendance.data).toMatchObject({
      created: { group: false, participants: 0, assignment: false, sessions: 0 },
      reused: { group: true, participants: 2, sessions: 7 },
    });
    expect((await pool.query("SELECT count(*)::int n FROM staff_profiles WHERE school_id=$1 AND user_id=$2", [schoolId, owner.data.user.id])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM school_people WHERE school_id=$1", [schoolId])).rows[0].n).toBe(3);
    const attendanceResume = (await pool.query(`SELECT resume_step,resume_goal_key,resume_path
      FROM progressive_onboarding_workspaces WHERE school_id=$1`, [schoolId])).rows[0];
    expect(attendanceResume).toEqual({
      resume_step: "operating",
      resume_goal_key: "attendance",
      resume_path: repeatedAttendance.data.destination,
    });
    expect((await pool.query(`SELECT metadata FROM progressive_onboarding_audits audit
      JOIN progressive_onboarding_workspaces workspace ON workspace.id=audit.workspace_id
      WHERE workspace.school_id=$1 AND audit.action='resume_updated'
        AND audit.metadata->>'goal'='attendance' ORDER BY audit.created_at DESC LIMIT 1`, [schoolId])).rows[0].metadata)
      .toMatchObject({ step: "operating", goal: "attendance", path: repeatedAttendance.data.destination, source: "accepted_capability_setup" });
    expect((await pool.query(`SELECT
      (SELECT count(*)::int FROM class_sections WHERE school_id=$1) classes,
      (SELECT count(*)::int FROM students WHERE school_id=$1) students,
      (SELECT count(*)::int FROM enrollments enrollment JOIN class_sections section ON section.id=enrollment.class_section_id WHERE section.school_id=$1 AND enrollment.is_active) enrollments,
      (SELECT count(*)::int FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id WHERE section.school_id=$1) sessions,
      (SELECT count(*)::int FROM class_section_staff_assignments assignment WHERE assignment.school_id=$1 AND assignment.class_section_id=$2 AND assignment.ended_at IS NULL) responsibilities,
      (SELECT count(*)::int FROM campus_spaces WHERE school_id=$1 AND kind='gate') gates`, [schoolId, classId])).rows[0]).toEqual({ classes: 1, students: 2, enrollments: 2, sessions: 7, responsibilities: 1, gates: 1 });

    const retained = (await pool.query(`SELECT command.command_type,command.handler_key,command.state,outcome.code
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      WHERE command.school_id=$1 AND command.command_type IN ('progressive.gate.configure','progressive.attendance.configure')`, [schoolId])).rows;
    expect(retained).toEqual(expect.arrayContaining([
      expect.objectContaining({ command_type: "progressive.gate.configure", handler_key: "institution_activation.gate_configure", state: "accepted", code: "gate_ready" }),
      expect.objectContaining({ command_type: "progressive.attendance.configure", handler_key: "institution_activation.attendance_configure", state: "accepted", code: "attendance_ready" }),
    ]));
    expect((await pool.query(`SELECT concat_ws(' ',person.first_name,person.last_name) name
      FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id
      JOIN school_people person ON person.id=agent.person_id
      WHERE agent.school_id=$1 AND endpoint.user_id=$2 AND endpoint.status='active'`, [schoolId, owner.data.user.id])).rows[0].name).toBe("Test Owner");

    const visitor = await request("owner", `gate/schools/${schoolId}/visitors/`, {
      name: "Test Visitor", phone: "9999999999", purpose: "Capability verification",
      host_user_id: null, category: "guest", request_id: randomUUID(),
    });
    expect(visitor.status).toBe(201);
    expect(visitor.data).toMatchObject({ state: "inside", revision: 1 });
    const departed = await request("owner", `gate/schools/${schoolId}/visitors/${visitor.data.id}/out/`, { expected_revision: 1 });
    expect(departed.data.visitor).toMatchObject({ state: "out", revision: 2 });

    expect((await request("outsider", `schools/${schoolId}/get-started/`)).status).toBe(403);
    expect((await request("outsider", `schools/${schoolId}/get-started/gate/`, {
      gate_name: "Wrong tenant gate", operator: { kind: "current_user", confirm: true },
    })).status).toBe(403);
    expect((await pool.query("SELECT count(*)::int n FROM campus_spaces WHERE school_id=$1", [outsiderSchoolId])).rows[0].n).toBe(0);
  }, 30_000);
});
