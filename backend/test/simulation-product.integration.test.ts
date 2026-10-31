import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.SIMULATION_PRODUCT_DATABASE_TEST_ISOLATED === "true";
const sourceUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_PRODUCT_TEST_SOURCE_DATABASE_URL)
  : "postgresql://invalid.invalid/simulation_product_source_test";
const targetUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_PRODUCT_TEST_TARGET_DATABASE_URL)
  : "postgresql://invalid.invalid/simulation_product_target_test";
const port = 8079;
const base = `http://127.0.0.1:${port}`;

interface ProductWorkspace {
  context: { environment: { kind: "live" | "simulation"; namespace_id: string } };
  areas: Array<{ key: string; surfaces: Array<{ href: string; capabilities: string[] }> }>;
  work: { total: number; items: Array<{ id: string; kind: string; href: string; title: string }> };
}

async function resetSimulationStoreDatabase(value: string): Promise<void> {
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/iu.test(databaseName)
    || !/(?:^|_)test(?:_|$)/iu.test(databaseName)) {
    throw new Error("Refusing to reset a Simulation database without an isolated test name.");
  }
  const adminUrl = new URL(parsed);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const quoted = `"${databaseName.replaceAll('"', '""')}"`;
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await admin.end();
  }
}

class BrowserSession {
  private readonly cookies = new Map<string, string>();

  async request(path: string, init: RequestInit = {}, csrf = false): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (cookie) headers.set("Cookie", cookie);
    if (csrf) {
      const token = this.cookies.get("csrftoken");
      if (token) headers.set("X-CSRFToken", token);
    }
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response:Response;
    try { response=await fetch(base+path,{...init,headers,signal:init.signal??AbortSignal.timeout(30_000)}); }
    catch(error) { throw new Error(`Simulation product request failed: ${init.method??'GET'} ${path}`,{cause:error}); }
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0]!;
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async csrf(): Promise<void> {
    expect((await this.request("/api/v1/auth/csrf/")).status).toBe(200);
  }
}

async function json<T>(response: Response, diagnostics = ""): Promise<T> {
  const text = await response.text();
  expect(response.ok, `${response.status} ${text}${diagnostics ? `\n${diagnostics.slice(-4_000)}` : ""}`).toBe(true);
  return JSON.parse(text) as T;
}

async function waitForServer(server: ChildProcess, stderr: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Simulation product API exited during startup: ${stderr().slice(-2_000)}`);
    try {
      if ((await fetch(`${base}/readyz`)).ok) return;
    } catch {
      // The child has not bound its loopback listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Simulation product API did not become ready: ${stderr().slice(-2_000)}`);
}

function localDateAndTime(value: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function nearFutureAttendanceSlot(now: Date, timeZone: string): {
  starts_at: string;
  ends_at: string;
  submission_delay_minutes: number;
  speed: number;
} {
  const target = new Date(now.getTime() + 90_000);
  const end = new Date(target.getTime() + 30 * 60_000);
  const localTarget = localDateAndTime(target, timeZone);
  const localEnd = localDateAndTime(end, timeZone);
  if (localTarget.date === localEnd.date) {
    return {
      starts_at: localTarget.time,
      ends_at: localEnd.time,
      submission_delay_minutes: 0,
      speed: 20,
    };
  }
  // Keep a valid same-day slot near midnight; its synthetic submission becomes
  // due just after midnight and 100x keeps this edge-case test bounded.
  return { starts_at: "23:58", ends_at: "23:59", submission_delay_minutes: 2, speed: 100 };
}

describe.runIf(enabled)("Simulation product journey against isolated PostgreSQL", () => {
  const source = new Pool({ connectionString: sourceUrl, max: 3, application_name: "simulation_product_test" });
  const target = new Pool({ connectionString: targetUrl, max: 2, application_name: "simulation_product_world_test" });
  const email = `simulation.owner.${randomUUID()}@example.test`;
  let server: ChildProcess | undefined;
  let serverError = "";
  let schoolId: string | undefined;
  let userId: string | undefined;

  beforeAll(async () => {
    if (new URL(sourceUrl).pathname === new URL(targetUrl).pathname) {
      throw new Error("Simulation product tests require separate Live and Simulation databases.");
    }
    await resetSimulationStoreDatabase(targetUrl);
    await source.query("DELETE FROM api_rate_limit_buckets");
    await source.query(`INSERT INTO event_delivery_cursor(singleton,last_sequence,replay_floor)
      VALUES(true,0,0) ON CONFLICT(singleton) DO NOTHING`);
    await source.query(`INSERT INTO progressive_onboarding_goal_catalog(
      goal_key,label,description,destination,setup_capability,sort_order,is_active)
      VALUES('attendance','Attendance','Know who is here, without the paperwork.',
        '/principal/get-started?task=attendance','attendance',10,true)
      ON CONFLICT(goal_key) DO NOTHING`);
    server = spawn(process.execPath, ["dist/main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: sourceUrl,
        EVENT_DATABASE_URL: sourceUrl,
        CAMPUS_SIMULATION_DATABASE_URL: targetUrl,
        NODE_ENV: "test",
        RATE_LIMIT_STORE: "memory",
        HOST: "127.0.0.1",
        PORT: String(port),
        COOKIE_SECRET: "simulation-product-integration-cookie-secret-2026",
        AI_PROVIDER: "mock",
        SPA_DIST_DIR: join(process.cwd(), "no-spa"),
        LOG_LEVEL: "error",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => { serverError = `${serverError}${chunk}`.slice(-8_000); });
    server.stderr?.setEncoding("utf8");
    server.stderr?.on("data", (chunk: string) => { serverError = `${serverError}${chunk}`.slice(-8_000); });
    await waitForServer(server, () => serverError);
  }, 30_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    if (server?.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        server!.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    if (schoolId) await source.query("DELETE FROM schools WHERE id=$1", [schoolId]).catch(() => undefined);
    if (userId) await source.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([source.end(), target.end()]);
    await resetSimulationStoreDatabase(targetUrl);
  }, 30_000);

  it("keeps a new attendance-first administrator's scenario and synthetic activity out of Live", async () => {
    const browser = new BrowserSession();
    await browser.csrf();
    const registration = await json<{ user: { id: string; active_school_id: string }; onboarding: { status: string } }>(
      await browser.request("/api/v1/auth/register/", {
        method: "POST",
        body: JSON.stringify({ email, password: "Str0ng!SimulationRiver2026" }),
      }, true),
    );
    userId = registration.user.id;
    schoolId = registration.user.active_school_id;
    expect(registration.onboarding.status).toBe("purpose_required");

    const goals = await json<{ goals: { primary: string; selected: string[] } }>(
      await browser.request("/api/v1/onboarding/goals/", {
        method: "PUT",
        body: JSON.stringify({ goals: ["attendance"], primary: "attendance" }),
      }, true),
    );
    expect(goals.goals).toMatchObject({ primary: "attendance", selected: ["attendance"] });

    const school = (await source.query<{ timezone: string }>(
      "SELECT timezone FROM schools WHERE id=$1",
      [schoolId],
    )).rows[0]!;
    const slot = nearFutureAttendanceSlot(new Date(), school.timezone);
    const setup = await json<{
      destination: string;
      resources: { class_section_id: string; term_id: string; student_ids: string[]; timetable_slot_ids: string[] };
      readiness: { status: string };
    }>(await browser.request(`/api/v1/schools/${schoolId}/get-started/attendance/`, {
      method: "POST",
      body: JSON.stringify({
        group_name: "Simulation A",
        participant_names: ["Ada Scenario", "Ben Baseline"],
        existing_student_ids: [],
        responsible: { kind: "current_user", self_teaches: true, display_name: "Simulation Owner" },
        session: { starts_at: slot.starts_at, ends_at: slot.ends_at, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      }),
    }, true));
    expect(setup.readiness.status).toBe("working");
    expect(setup.resources.student_ids).toHaveLength(2);
    const date = new URL(setup.destination, "http://thatcampus.local").searchParams.get("date")!;

    // Setup must establish real teaching authority before its success screen
    // hands the new administrator into the normal register workspace.
    const freshWorkspace = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(freshWorkspace.context.environment.kind).toBe("live");
    expect(freshWorkspace.areas.find((area) => area.key === "attendance")?.surfaces).toEqual(
      expect.arrayContaining([expect.objectContaining({
        href: "/areas/attendance/registers",
        capabilities: expect.arrayContaining(["attendance.record"]),
      })]),
    );
    const firstRegister = await json<{ register: { state: string }; roster: Array<{ id: string }> }>(
      await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${setup.resources.class_section_id}&date=${date}`),
    );
    expect(firstRegister.register.state).toBe("draft");
    expect(firstRegister.roster.map((student) => student.id).sort()).toEqual([...setup.resources.student_ids].sort());

    // The same product foundation covers mixed, no-login participants. This
    // published activity is captured alongside the academic adapter, not seeded
    // by an alternative Simulation-only planner.
    const participationPeople = [] as Array<{ id: string }>;
    for (const firstName of ["Ari", "Dev"]) participationPeople.push(await json<{ id: string }>(
      await browser.request(`/api/v1/schools/${schoolId}/people/participants`, { method: "POST",
        body: JSON.stringify({ first_name: firstName, last_name: "Workshop", affiliation: firstName === "Ari" ? "worker" : "visitor", idempotency_key: randomUUID() }) }, true)));
    const catalogue = await json<{ recorders: Array<{ id: string }> }>(await browser.request(`/api/v1/schools/${schoolId}/activities/catalogue`));
    const recorderPerson = catalogue.recorders[0]!.id;
    const activityInput = { title: "Shared campus workshop", purpose: "training", timezone: school.timezone, starts_on: date,
      recurrence: "once", starts_at: slot.starts_at, ends_at: slot.ends_at, person_ids: participationPeople.map(person => person.id),
      attendance_mode: "roll_call", recorder_person_id: recorderPerson, reviewer_person_id: recorderPerson };
    const activityDraft = await json<{ id: string; revision: number }>(await browser.request(`/api/v1/schools/${schoolId}/activities/plans`, {
      method: "POST", body: JSON.stringify({ ...activityInput, idempotency_key: randomUUID() }),
    }, true));
    const liveActivity = await json<{ id: string; revision: number }>(await browser.request(`/api/v1/schools/${schoolId}/activities/plans/${activityDraft.id}/publish`, {
      method: "POST", body: JSON.stringify({ expected_revision: activityDraft.revision, idempotency_key: randomUUID() }),
    }, true));

    const staffProfile = (await source.query<{ id: string }>(
      "SELECT id FROM staff_profiles WHERE school_id=$1 AND user_id=$2 AND status='active'", [schoolId, userId],
    )).rows[0]!;
    expect(staffProfile?.id).toBeDefined();
    // A finite fixture configures a consent-bearing duty; creation and response
    // still use the owning domain's authenticated commands and revision checks.
    const offerType = (await source.query<{ id: string }>(`INSERT INTO staff_responsibility_types(
      school_id,code,name,category,scope_kind,context_kind,workflow_family,source_kind,
      capability_permissions,requires_acceptance)
      VALUES($1,'simulation_readiness_offer','Review library readiness','operations','school',
        'institution','simulation_readiness_offer','institute','{}'::text[],true) RETURNING id`, [schoolId])).rows[0]!;
    const dutyOffer = await json<{ id: string; status: string; revision: number }>(
      await browser.request(`/api/v1/schools/${schoolId}/staff/responsibilities/`, {
        method: "POST",
        body: JSON.stringify({ responsibility_type_id: offerType.id, staff_profile_id: staffProfile.id,
          starts_on: date, scope_label: "Library readiness review", notes: "Respond to the specific offered duty." }),
      }, true),
    );
    expect(dutyOffer.status).toBe("offered");
    const offeredHref = `/areas/responsibilities/mine?assignment=${dutyOffer.id}`;
    const liveOfferedWork = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(liveOfferedWork.work.items).toContainEqual(expect.objectContaining({ kind: "offer", href: offeredHref }));

    const liveBefore = (await source.query<{ campuses: number; registers: number; submitted: number }>(`SELECT
      (SELECT count(*)::int FROM institution_campuses WHERE school_id=$1) AS campuses,
      (SELECT count(*)::int FROM attendance_registers WHERE school_id=$1 AND date=$2::date) AS registers,
      (SELECT count(*)::int FROM attendance_registers WHERE school_id=$1 AND date=$2::date AND state IN ('submitted','locked')) AS submitted`,
    [schoolId, date])).rows[0]!;

    const createResponse = await browser.request(`/api/v1/schools/${schoolId}/simulation/runs`, {
      method: "POST",
      body: JSON.stringify({
        kind: "scenario",
        name: "Attendance capacity scenario",
        speed: slot.speed,
        idempotency_key: `simulation-product-${randomUUID()}`,
      }),
    }, true);
    const failure = createResponse.ok ? "" : JSON.stringify((await source.query(
      "SELECT status,failure_reason FROM simulation_runs WHERE school_id=$1 ORDER BY created_at DESC LIMIT 1",
      [schoolId],
    )).rows[0] ?? {});
    const created = await json<{ run: { id: string; status: string; can_open: boolean; speed: number } }>(
      createResponse,
      `${failure}\n${serverError}`,
    );
    expect(created.run).toMatchObject({ status: "draft", can_open: true, speed: slot.speed });
    const runId = created.run.id;

    const entered = await json<{ execution_environment: { mode: string; run_id: string } }>(
      await browser.request("/api/v1/auth/execution-environment/", {
        method: "POST",
        body: JSON.stringify({ mode: "simulation", run_id: runId }),
      }, true),
    );
    expect(entered.execution_environment).toMatchObject({ mode: "simulation", run_id: runId });
    const scenarioPerson=await json<{id:string}>(await browser.request(`/api/v1/schools/${schoolId}/people/participants`,{
      method:"POST",body:JSON.stringify({first_name:"Scenario-only",last_name:"Participant",affiliation:"visitor",idempotency_key:randomUUID()}),
    },true));
    expect((await source.query("SELECT 1 FROM school_people WHERE id=$1",[scenarioPerson.id])).rowCount).toBe(0);
    const participantPath = `/api/v1/schools/${schoolId}/people/participants/${participationPeople[0]!.id}`;
    const capturedPerson = await json<{ first_name: string; last_name: string; revision: number }>(await browser.request(participantPath));
    expect(capturedPerson.first_name).toBe("Ari");
    const renamedPerson = await json<{ first_name: string; revision: number }>(await browser.request(participantPath, {
      method: "PATCH", body: JSON.stringify({ first_name: "Alternative Ari", last_name: capturedPerson.last_name,
        expected_revision: capturedPerson.revision, reason: "Explore a scenario-only person name correction", idempotency_key: randomUUID() }),
    }, true));
    expect(renamedPerson).toMatchObject({ first_name: "Alternative Ari", revision: capturedPerson.revision + 1 });
    expect((await source.query<{ first_name: string }>("SELECT first_name FROM school_people WHERE id=$1", [participationPeople[0]!.id])).rows[0]?.first_name).toBe("Ari");

    const activityRevision = await json<{ id: string; revision: number }>(await browser.request(`/api/v1/schools/${schoolId}/activities/plans/${liveActivity.id}/revise`, {
      method: "POST", body: JSON.stringify({ starts_on: date, reason: "Explore a smaller mixed workshop", expected_revision: liveActivity.revision, idempotency_key: randomUUID() }),
    }, true));
    const alternativeDraft = await json<{ id: string; revision: number }>(await browser.request(`/api/v1/schools/${schoolId}/activities/plans/${activityRevision.id}`, {
      method: "PUT", body: JSON.stringify({ ...activityInput, title: "Alternative mixed workshop", person_ids: [participationPeople[0]!.id],
        expected_revision: activityRevision.revision, idempotency_key: randomUUID() }),
    }, true));
    await json(await browser.request(`/api/v1/schools/${schoolId}/activities/plans/${alternativeDraft.id}/publish`, {
      method: "POST", body: JSON.stringify({ expected_revision: alternativeDraft.revision, idempotency_key: randomUUID() }),
    }, true));
    expect((await source.query(`SELECT state,revision,(SELECT effective_from FROM schedule_plan_supersessions
      WHERE previous_version_id=version.id) AS superseded_on FROM schedule_versions version WHERE id=$1`, [liveActivity.id])).rows[0])
      .toMatchObject({ state: "published", revision: liveActivity.revision, superseded_on: null });

    // Rediscovery through the ordinary Registers catalogue must retain the
    // captured daily-class grain, not require the onboarding class deep link.
    const simulatedRegisters = await json<{ mode: string; registers: Array<{ class_section_id: string }> }>(
      await browser.request("/api/v1/attendance/workspace?surface=registers"),
    );
    expect(simulatedRegisters.mode).toBe("daily_class");
    expect(simulatedRegisters.registers).toContainEqual(expect.objectContaining({
      class_section_id: setup.resources.class_section_id,
    }));

    const simulatedWork = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(simulatedWork.context.environment.kind).toBe("simulation");
    expect(simulatedWork.work.items).toContainEqual(expect.objectContaining({
      id: expect.stringMatching(/^domain:/u), kind: "offer", href: offeredHref,
    }));
    const acceptedDuty = await json<{ status: string; revision: number }>(
      await browser.request(`/api/v1/schools/${schoolId}/staff/responsibilities/${dutyOffer.id}/response/`, {
        method: "POST", body: JSON.stringify({ decision: "accepted", expected_revision: dutyOffer.revision, note: "Accepted only inside this scenario." }),
      }, true),
    );
    expect(acceptedDuty).toMatchObject({ status: "active", revision: dutyOffer.revision + 1 });
    const simulatedWorkAfter = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(simulatedWorkAfter.work.items.some((item) => item.href === offeredHref)).toBe(false);
    expect((await source.query("SELECT status,revision FROM staff_responsibility_assignments WHERE id=$1", [dutyOffer.id])).rows[0])
      .toMatchObject({ status: "offered", revision: dutyOffer.revision });

    const calendar = await json<{ id: string; evidence_mode: string; external_subscription: boolean; feed_url: string }>(
      await browser.request('/api/v1/calendar-connections/subscriptions', { method: 'POST', body: JSON.stringify({ portal: 'principal' }) }, true));
    expect(calendar).toMatchObject({ evidence_mode: 'simulation', external_subscription: false });
    expect(calendar.feed_url).toBe(`/api/v1/calendar-connections/subscriptions/${calendar.id}/preview.ics`);
    const preview = await browser.request(calendar.feed_url);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('X-Evidence-Mode')).toBe('simulation');
    expect(await preview.text()).toContain('Simulation');
    expect((await source.query('SELECT 1 FROM calendar_subscriptions WHERE id=$1', [calendar.id])).rowCount).toBe(0);
    const resources = await json<{ counts: { effects: { connector_call: number } }; effects: { results: unknown[] } }>(
      await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/resources?page=1&page_size=5`));
    expect(resources.counts.effects.connector_call).toBeGreaterThan(0);
    expect(resources.effects.results.length).toBeLessThanOrEqual(5);

    const preflightAttendance = await json<{ register: { revision: number }; roster: Array<{ id: string }> }>(
      await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${setup.resources.class_section_id}&date=${date}`),
    );
    const forgedAuthority = await browser.request("/api/v1/teacher/attendance/bulk/", {
      method: "POST",
      headers: { "Idempotency-Key": `client-authority-${randomUUID()}` },
      body: JSON.stringify({
        class_section_id: setup.resources.class_section_id,
        date,
        expected_revision: preflightAttendance.register.revision,
        reason: "Client attempt",
        records: preflightAttendance.roster.map((student) => ({
          student_id: student.id,
          status: "present",
          remarks: "",
        })),
        authority_attestation: {
          evaluator_domain: "client-forged",
          decision: "allowed",
          reason_codes: ["client_claim"],
          authority_source_refs: [{ source: "browser" }],
          operating_rule_refs: [],
          valid_until: null,
        },
      }),
    }, true);
    expect(forgedAuthority.status).toBe(400);

    const editedSlot = await json<{ id: string; title: string }>(
      await browser.request(`/api/v1/principal/timetable/slots/${setup.resources.timetable_slot_ids[0]}/`, {
        method: "PATCH",
        body: JSON.stringify({
          term_id: setup.resources.term_id,
          class_section_id: setup.resources.class_section_id,
          subject_id: null,
          weekday: 1,
          period_number: 1,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          slot_type: "activity",
          title: "Scenario attendance",
          room: "",
          teacher_user_id: userId,
          teacher_designation: "Responsible person",
        }),
      }, true),
    );
    expect(editedSlot).toMatchObject({ id: setup.resources.timetable_slot_ids[0], title: "Scenario attendance" });
    expect((await source.query<{ title: string }>(
      "SELECT title FROM timetable_slots WHERE id=$1",
      [setup.resources.timetable_slot_ids[0]],
    )).rows[0]?.title).toBe("Daily attendance");

    const scenarioCampus = await json<{ id: string; name: string }>(
      await browser.request(`/api/v1/schools/${schoolId}/institution-setup/campuses/`, {
        method: "POST",
        body: JSON.stringify({
          parent_campus_id: null,
          name: "Scenario Campus",
          code: "SCENARIO",
          campus_type: "main",
          status: "active",
          is_primary: true,
          address_line: "",
          city: "",
          state: "",
          postal_code: "",
          timezone: "UTC",
        }),
      }, true),
    );
    expect(scenarioCampus.name).toBe("Scenario Campus");
    const scenarioWorkspace = await json<{ campuses: Array<{ id: string }> }>(
      await browser.request(`/api/v1/schools/${schoolId}/institution-setup/`),
    );
    expect(scenarioWorkspace.campuses.map((campus) => campus.id)).toContain(scenarioCampus.id);
    expect((await source.query("SELECT 1 FROM institution_campuses WHERE id=$1", [scenarioCampus.id])).rowCount).toBe(0);

    const configured = await json<{ run: { behaviour: { attendance: { enabled: boolean } }; draft_changes: Array<{ domain: string }> } }>(
      await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/behaviour`, {
        method: "PUT",
        body: JSON.stringify({
          schema_version: 1,
          attendance: {
            enabled: true,
            present: 1,
            late: 0,
            absent: 0,
            excused: 0,
            submission_delay_minutes: slot.submission_delay_minutes,
          },
        }),
      }, true),
    );
    expect(configured.run.behaviour.attendance.enabled).toBe(true);
    expect(configured.run.draft_changes.map((change) => change.domain)).toContain("campus_setup");

    const started = await json<{ run: { status: string } }>(
      await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/start`, {
        method: "POST",
        body: JSON.stringify({ speed: slot.speed }),
      }, true),
    );
    expect(started.run.status).toBe("running");

    let simulatedState = "draft";
    let checkpointCount = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const run = await json<{ run: { status: string; progress: { checkpoint_count: number } } }>(
        await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}`),
      );
      checkpointCount = run.run.progress.checkpoint_count;
      const attendance = await json<{ register: { state: string } }>(
        await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${setup.resources.class_section_id}&date=${date}`),
      );
      simulatedState = attendance.register.state;
      if (checkpointCount > 0 && ["submitted", "locked"].includes(simulatedState)) break;
    }
    expect(checkpointCount).toBeGreaterThan(0);
    let activityDiagnostics = "";
    if (!["submitted", "locked"].includes(simulatedState)) {
      const control = (await source.query(
        `SELECT status,virtual_started_at,virtual_now,failure_count,failure_reason,checkpoint_count
        FROM simulation_runs WHERE id=$1`,
        [runId],
      )).rows[0];
      const world = (await target.query<{ schema_name: string; virtual_now: Date }>(
        "SELECT schema_name,virtual_now FROM dt_simulation.worlds WHERE run_id=$1",
        [runId],
      )).rows[0];
      let branch: unknown = null;
      if (world && /^dt_run_[0-9a-f]{32}$/u.test(world.schema_name)) {
        const schema = `"${world.schema_name}"`;
        branch = {
          world_virtual_now: world.virtual_now,
          behaviours: (await target.query(`SELECT behaviour_key,status,effective_from,effective_until,configuration
            FROM ${schema}.campus_model_behaviour_versions WHERE school_id=$1`, [schoolId])).rows,
          refusals: (await target.query(`SELECT action,metadata FROM ${schema}.audit_events
            WHERE action='simulation.actor.domain_refused' ORDER BY created_at DESC LIMIT 10`)).rows,
          registers: (await target.query(`SELECT date,state,revision,submitted_at FROM ${schema}.attendance_registers
            WHERE school_id=$1 ORDER BY date DESC LIMIT 10`, [schoolId])).rows,
          slots: (await target.query(`SELECT id,class_section_id,teacher_user_id,starts_at,slot_type,cancelled
            FROM ${schema}.effective_school_schedule_v4($1::uuid,$2::date)`, [schoolId, date])).rows,
        };
      }
      activityDiagnostics = JSON.stringify({ school_timezone: school.timezone, date, slot, control, branch });
    }
    expect(["submitted", "locked"], activityDiagnostics).toContain(simulatedState);

    const world = (await target.query<{ schema_name: string }>(
      "SELECT schema_name FROM dt_simulation.worlds WHERE run_id=$1",
      [runId],
    )).rows[0];
    expect(world?.schema_name).toMatch(/^dt_run_[0-9a-f]{32}$/u);
    const branchSchema = `"${world!.schema_name}"`;
    const receipt = (await target.query<{
      decision: string;
      reason_codes: string[];
      authority_source_refs: unknown;
      execution_actor_id: string | null;
    }>(`SELECT decision,reason_codes,authority_source_refs,execution_actor_id
      FROM ${branchSchema}.campus_model_authority_receipts
      WHERE capability='attendance:record' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(receipt).toMatchObject({ decision: "allowed" });
    expect(receipt?.execution_actor_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(receipt)).not.toContain("client-forged");
    expect((await target.query<{ count: string }>(`SELECT count(*)::text AS count
      FROM ${branchSchema}.attendance_records WHERE class_section_id=$1 AND date=$2::date AND status='present'`,
    [setup.resources.class_section_id, date])).rows[0]?.count).toBe("2");
    const participation = await json<{ registers: Array<{ id: string; title: string; state: string; participant_count: number }> }>(
      await browser.request(`/api/v1/schools/${schoolId}/activities/registers?date=${date}`));
    const alternateRegister = participation.registers.find(register => register.title === "Alternative mixed workshop");
    expect(alternateRegister).toMatchObject({ state: "submitted", participant_count: 1 });
    const alternateDetail = await json<{ roster: Array<{ person_id: string; status: string }> }>(
      await browser.request(`/api/v1/schools/${schoolId}/activities/registers/${alternateRegister!.id}`));
    expect(alternateDetail.roster).toEqual([expect.objectContaining({ person_id: participationPeople[0]!.id, status: "present" })]);
    expect((await source.query<{ count: number }>(`SELECT count(*)::int AS count FROM activity_attendance_entries WHERE school_id=$1`, [schoolId])).rows[0]!.count).toBe(0);
    expect((await target.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${branchSchema}.campus_model_commands
      WHERE school_id=$1 AND command_type='attendance.participation.submit' AND actor_agent_id IS NOT NULL
        AND target_entity_id IN (SELECT id FROM ${branchSchema}.campus_model_entities WHERE school_id=$1
          AND domain='attendance' AND domain_id=$2)`, [schoolId,alternateRegister!.id])).rows[0]!.count).toBe(1);

    // Event deadlines may create partial checkpoints. Comparison requires a
    // common completed duration, not merely any second checkpoint in each run.
    let originalElapsed = 0;
    for (let attempt = 0; attempt < 60 && originalElapsed < 300_000; attempt += 1) {
      originalElapsed = (await json<{ run: { clock: { simulated_elapsed_ms: number } } }>(
        await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}`))).run.clock.simulated_elapsed_ms;
      if (originalElapsed < 300_000) await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(originalElapsed).toBeGreaterThanOrEqual(300_000);

    await source.query(`UPDATE simulation_runs
      SET next_wake_at=now()+interval '1 day',lease_owner='expired-test-worker',
        lease_token=$2::uuid,lease_until=now()-interval '1 minute'
      WHERE id=$1::uuid`, [runId, randomUUID()]);
    const fencedStop = await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    }, true);
    expect(fencedStop.status).toBe(409);
    await source.query(`UPDATE simulation_runs
      SET lease_owner=NULL,lease_token=NULL,lease_until=NULL
      WHERE id=$1::uuid`, [runId]);

    await json(await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    }, true));

    await json(await browser.request("/api/v1/auth/execution-environment/", {
      method: "POST", body: JSON.stringify({ mode: "live" }),
    }, true));
    const reopened = await json<{ execution_environment: { mode: string; run_id: string } }>(
      await browser.request("/api/v1/auth/execution-environment/", {
        method: "POST", body: JSON.stringify({ mode: "simulation", run_id: runId }),
      }, true),
    );
    expect(reopened.execution_environment).toMatchObject({ mode: "simulation", run_id: runId });
    const frozenWorkspace = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(frozenWorkspace.context.environment.kind).toBe("simulation");
    expect(frozenWorkspace.work.items.some((item) => item.href === offeredHref)).toBe(false);
    const frozenAttendance = await json<{ register: { state: string } }>(
      await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${setup.resources.class_section_id}&date=${date}`),
    );
    expect(["submitted", "locked"]).toContain(frozenAttendance.register.state);

    const duplicated = await json<{ run: { id: string; status: string; behaviour: unknown } }>(
      await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${runId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          kind: "scenario",
          name: "Attendance controlled comparison",
          speed: slot.speed,
          idempotency_key: `simulation-duplicate-${randomUUID()}`,
        }),
      }, true),
    );
    expect(duplicated.run).toMatchObject({ status: "draft", behaviour: null });
    const duplicateRunId = duplicated.run.id;
    const duplicateSchema = (await target.query<{ schema_name: string }>("SELECT schema_name FROM dt_simulation.worlds WHERE run_id=$1", [duplicateRunId])).rows[0]?.schema_name;
    expect(duplicateSchema).toMatch(/^dt_run_[0-9a-f]{32}$/u);
    expect((await target.query<{ first_name: string }>(`SELECT first_name FROM "${duplicateSchema!}".school_people WHERE id=$1`, [participationPeople[0]!.id])).rows[0]?.first_name).toBe("Ari");
    await json(await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${duplicateRunId}/behaviour`, {
      method: "PUT",
      body: JSON.stringify({
        schema_version: 1,
        attendance: {
          enabled: true,
          present: 1,
          late: 0,
          absent: 0,
          excused: 0,
          submission_delay_minutes: slot.submission_delay_minutes,
        },
      }),
    }, true));
    await json(await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${duplicateRunId}/start`, {
      method: "POST",
      body: JSON.stringify({ speed: slot.speed }),
    }, true));
    let duplicateCheckpointCount = 1;
    let duplicateElapsed = 0;
    for (let attempt = 0; attempt < 60 && duplicateElapsed < 300_000; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const duplicate = await json<{ run: { progress: { checkpoint_count: number }; clock: { simulated_elapsed_ms: number } } }>(
        await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${duplicateRunId}`),
      );
      duplicateCheckpointCount = duplicate.run.progress.checkpoint_count;
      duplicateElapsed = duplicate.run.clock.simulated_elapsed_ms;
    }
    expect(duplicateCheckpointCount).toBeGreaterThanOrEqual(2);
    expect(duplicateElapsed).toBeGreaterThanOrEqual(300_000);
    let duplicateStop: Response | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      duplicateStop = await browser.request(`/api/v1/schools/${schoolId}/simulation/runs/${duplicateRunId}/stop`, {
        method: "POST",
        body: JSON.stringify({}),
      }, true);
      if (duplicateStop.ok) break;
      expect(duplicateStop.status).toBe(409);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await json(duplicateStop!);
    const comparison = await json<{
      comparison: { duration_ms: number; controlled_snapshot: boolean; runs: Array<{ actual_duration_ms: number }> };
    }>(await browser.request(`/api/v1/schools/${schoolId}/simulation/compare`, {
      method: "POST",
      body: JSON.stringify({ run_ids: [runId, duplicateRunId] }),
    }, true));
    expect(comparison.comparison.controlled_snapshot).toBe(true);
    const checkpointDiagnostics = (await source.query(`SELECT run_id,sequence,simulated_elapsed_ms,virtual_from,virtual_to
      FROM simulation_run_checkpoints WHERE run_id=ANY($1::uuid[]) ORDER BY run_id,sequence`, [[runId, duplicateRunId]])).rows;
    expect(comparison.comparison.duration_ms, JSON.stringify(checkpointDiagnostics)).toBeGreaterThan(0);
    expect(comparison.comparison.runs.map((run) => run.actual_duration_ms)).toEqual([
      comparison.comparison.duration_ms,
      comparison.comparison.duration_ms,
    ]);

    const returned = await json<{ execution_environment: { mode: string } }>(
      await browser.request("/api/v1/auth/execution-environment/", {
        method: "POST",
        body: JSON.stringify({ mode: "live" }),
      }, true),
    );
    expect(returned.execution_environment.mode).toBe("live");

    const liveWorkAfter = await json<ProductWorkspace>(await browser.request("/api/v1/workspace"));
    expect(liveWorkAfter.context.environment.kind).toBe("live");
    expect(liveWorkAfter.work.items).toContainEqual(expect.objectContaining({ kind: "offer", href: offeredHref }));
    expect((await source.query("SELECT status,revision FROM staff_responsibility_assignments WHERE id=$1", [dutyOffer.id])).rows[0])
      .toMatchObject({ status: "offered", revision: dutyOffer.revision });

    const liveWorkspace = await json<{ campuses: Array<{ id: string }> }>(
      await browser.request(`/api/v1/schools/${schoolId}/institution-setup/`),
    );
    expect(liveWorkspace.campuses.map((campus) => campus.id)).not.toContain(scenarioCampus.id);
    const liveAfter = (await source.query<{ campuses: number; registers: number; submitted: number }>(`SELECT
      (SELECT count(*)::int FROM institution_campuses WHERE school_id=$1) AS campuses,
      (SELECT count(*)::int FROM attendance_registers WHERE school_id=$1 AND date=$2::date) AS registers,
      (SELECT count(*)::int FROM attendance_registers WHERE school_id=$1 AND date=$2::date AND state IN ('submitted','locked')) AS submitted`,
    [schoolId, date])).rows[0]!;
    expect(liveAfter).toEqual(liveBefore);
    const liveParticipation = await json<{ registers: Array<{ title: string; state: string; participant_count: number; recorded_count: number }> }>(
      await browser.request(`/api/v1/schools/${schoolId}/activities/registers?date=${date}`));
    expect(liveParticipation.registers.find(register => register.title === activityInput.title))
      .toMatchObject({ state: "draft", participant_count: 2, recorded_count: 0 });
    expect(liveParticipation.registers.some(register => register.title === "Alternative mixed workshop")).toBe(false);
    expect((await source.query("SELECT 1 FROM school_people WHERE id=$1",[scenarioPerson.id])).rowCount).toBe(0);
    expect(await json(await browser.request(participantPath))).toMatchObject({ first_name: "Ari", revision: capturedPerson.revision });
  }, 120_000);
});
