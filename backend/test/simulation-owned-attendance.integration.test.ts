import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import type { InvigilationInvitationPolicyView } from '../src/assessments/invigilation-invitation-policy.contracts.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.SIMULATION_OWNED_ATTENDANCE_TEST_ISOLATED === 'true';
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_OWNED_ATTENDANCE_SOURCE_URL)
  : 'postgresql://invalid.invalid/owned_attendance_source_test';
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_OWNED_ATTENDANCE_TARGET_URL)
  : 'postgresql://invalid.invalid/owned_attendance_target_test';
const base = 'http://127.0.0.1:8078';

async function resetWorldStore(value: string) {
  const parsed = new URL(value), name = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/iu.test(name) || !/(?:^|_)test(?:_|$)/iu.test(name)) {
    throw new Error('Only a dedicated, explicitly named test store may be reset.');
  }
  const adminUrl = new URL(parsed); adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally { await admin.end(); }
}

class Session {
  private readonly cookies = new Map<string, string>();
  constructor(private readonly diagnostics: () => string = () => '') {}
  async request(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    if (method !== 'GET') {
      requestHeaders.set('Content-Type', 'application/json');
      requestHeaders.set('X-CSRFToken', this.cookies.get('csrftoken') ?? '');
    }
    const response = await fetch(base + path, { method, headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]!, separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  async json<T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
    const response = await this.request(path, method, body, headers), text = await response.text();
    expect(response.ok, `${method} ${path}: ${response.status} ${text}\n${this.diagnostics().slice(-4_000)}`).toBe(true);
    return JSON.parse(text) as T;
  }
}

type EventScreen = { id: string; revision: number; sessions: Array<{ id: string; revision: number }> };
type EventRoster = { session: { revision: number; state: string }; rows: Array<{ attendance_status: string }>; counts: Record<string, number> };
type ExamScreen = { sitting: { id: string; revision: number; state: string }; candidates: Array<{ attendance_status: string; attendance_revision: number }>;
  invigilators: Array<{ id: string; user_id: string; revision: number; status: string;
    invitation_status?: { state: string; can_respond: boolean } }> };
type CommonScreen = { register: { revision: number; state: string }; roster: Array<{ person_id: string; status: string }>;
  capabilities: { can_record: boolean } };
type CommonHistory = { total: number; history: Array<{ id: string; status: string | null; recorded_at: string }> };

describe.runIf(enabled)('event and examination attendance in selected Simulation worlds over HTTP', () => {
  const source = new Pool({ connectionString: sourceUrl, max: 3, application_name: 'owned_attendance_source_test' });
  const target = new Pool({ connectionString: targetUrl, max: 2, application_name: 'owned_attendance_world_test' });
  const fixtureDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: source }) });
  let server: ChildProcess | undefined, output = '';

  beforeAll(async () => {
    if (new URL(sourceUrl).pathname === new URL(targetUrl).pathname) throw new Error('Live and world stores must differ.');
    await resetWorldStore(targetUrl);
    await source.query(`INSERT INTO event_delivery_cursor(singleton,last_sequence,replay_floor)
      VALUES(true,0,0) ON CONFLICT(singleton) DO NOTHING`);
    await source.query(`INSERT INTO progressive_onboarding_goal_catalog(goal_key,label,description,destination,setup_capability,sort_order,is_active)
      VALUES('attendance','Attendance','Know who is here.','/principal/get-started?task=attendance','attendance',10,true)
      ON CONFLICT(goal_key) DO NOTHING`);
    server = spawn(process.execPath, [process.env.SIMULATION_OWNED_ATTENDANCE_API_ENTRY ?? 'dist/main.js'], { cwd: process.cwd(), env: { ...process.env,
      DATABASE_URL: sourceUrl, EVENT_DATABASE_URL: sourceUrl, CAMPUS_SIMULATION_DATABASE_URL: targetUrl,
      NODE_ENV: 'test', RATE_LIMIT_STORE: 'memory', HOST: '127.0.0.1', PORT: '8078',
      COOKIE_SECRET: 'owned-attendance-http-isolated-2026', AI_PROVIDER: 'mock',
      SPA_DIST_DIR: join(process.cwd(), 'no-spa'), LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) {
      stream?.setEncoding('utf8'); stream?.on('data', (chunk: string) => { output = `${output}${chunk}`.slice(-12_000); });
    }
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Owned attendance API exited: ${output}`);
      try { if ((await fetch(`${base}/readyz`)).ok) return; } catch { /* Not listening yet. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Owned attendance API did not become ready: ${output}`);
  }, 30_000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    if (server?.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5_000); server!.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await Promise.all([source.end(), target.end()]);
    await resetWorldStore(targetUrl);
  }, 30_000);

  it('inherits truthful history, accepts owning-domain corrections only, and leaves Live and its sibling unchanged', async () => {
    const browser = new Session(() => output);
    await browser.json('/api/v1/auth/csrf/');
    const account = await browser.json<{ user: { id: string; active_school_id: string } }>('/api/v1/auth/register/', 'POST', {
      email: `owned.world.${randomUUID()}@example.test`, password: 'Str0ng!OwnedWorldRiver2026' });
    const userId = account.user.id, schoolId = account.user.active_school_id;
    await browser.json('/api/v1/onboarding/goals/', 'PUT', { goals: ['attendance'], primary: 'attendance' });
    const setup = await browser.json<{ resources: { class_section_id: string; term_id: string; student_ids: string[] } }>(
      `/api/v1/schools/${schoolId}/get-started/attendance/`, 'POST', { group_name: 'Owned Cohort',
        participant_names: ['Isolated Candidate'], existing_student_ids: [],
        responsible: { kind: 'current_user', self_teaches: true, display_name: 'World Owner' },
        session: { starts_at: '00:00', ends_at: '00:01', weekdays: [1, 2, 3, 4, 5, 6, 7] } });
    const studentId = setup.resources.student_ids[0]!;
    const school = (await source.query<{ timezone: string }>('SELECT timezone FROM schools WHERE id=$1', [schoolId])).rows[0]!;
    const times = { starts: new Date(Date.now() + 10 * 60_000).toISOString(), ends: new Date(Date.now() + 20 * 60_000).toISOString() };
    const examinationStart = new Date(Date.now() + 30 * 60_000).toISOString();
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: school.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(examinationStart));
    // The independent person, subject and space are configuration fixtures,
    // never accepted attendance or consent. Invitation approval, publication,
    // duty response and attendance all use authenticated owning APIs below.
    const moderator = (await source.query<{ id: string }>(`INSERT INTO users(username,email,password_hash,first_name,last_name,role)
      VALUES($1,$2,'unused-fixture-endpoint','Independent','Reviewer','admin') RETURNING id`,
    [`world-reviewer-${randomUUID()}`, `world-reviewer-${randomUUID()}@example.test`])).rows[0]!;
    await source.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')", [schoolId, moderator.id]);
    const moderatorPerson = (await source.query<{ id: string }>(`INSERT INTO school_people(school_id,first_name,last_name)
      VALUES($1,'Independent','Reviewer') RETURNING id`, [schoolId])).rows[0]!;
    const moderatorProfile = (await source.query<{ id: string }>(`INSERT INTO staff_profiles(school_id,person_id,user_id,staff_code,
      staff_kind,designation,employment_type,joined_on,status,created_by,updated_by)
      SELECT $1,$2,account.id,'WORLD-REVIEW','non_teaching','Independent reviewer',
        'contract',$4::date,'active',$5,$5 FROM users account WHERE account.id=$3 RETURNING id`,
    [schoolId, moderatorPerson.id, moderator.id, localDate, userId])).rows[0]!;
    const core = new CampusModelCoreService(fixtureDb as DatabaseService);
    await fixtureDb.transaction().execute(tx => core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: moderatorPerson.id,
      user_id: moderator.id, actor_user_id: userId, effective_from: new Date().toISOString(), effective_until: null,
      source_domain: 'staff', source_record_id: moderatorProfile.id, source_revision: 1, metadata: { fixture: 'isolated_selected_world_test' } }));
    const subject = (await source.query<{ id: string }>(`INSERT INTO subjects(school_id,code,name,short_name)
      VALUES($1,'WORLD','World examination','World') RETURNING id`, [schoolId])).rows[0]!;
    const campus = (await source.query<{ id: string }>(`INSERT INTO institution_campuses(school_id,name,code,created_by,updated_by)
      VALUES($1,'Isolated exam site','WORLD',$2,$2) RETURNING id`, [schoolId, userId])).rows[0]!;
    const space = (await source.query<{ id: string }>(`INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by)
      VALUES($1,$2,'Isolated exam hall','WORLD','classroom',30,$3,$3) RETURNING id`, [schoolId, campus.id, userId])).rows[0]!;

    const event = await browser.json<EventScreen>('/api/v1/campus-events', 'POST', { school_id: schoolId, idempotency_key: randomUUID(),
      event_type: 'workshop', title: 'Captured event attendance', starts_at: times.starts, ends_at: times.ends,
      audience: { mode: 'students', student_ids: [studentId] }, participation_requirement: 'mandatory',
      requires_rsvp: false, requires_guardian_consent: false, payment_required: false,
      sessions: [{ title: 'Captured workshop check-in', session_type: 'activity', starts_at: times.starts, ends_at: times.ends, attendance_mode: 'check_in' }] });
    const published = await browser.json<EventScreen>(`/api/v1/campus-events/${event.id}/publish`, 'POST', {
      school_id: schoolId, idempotency_key: randomUUID(), expected_revision: event.revision });
    const eventSessionId = published.sessions[0]!.id;
    const eventBase = `/api/v1/campus-events/${event.id}/sessions/${eventSessionId}`;
    const eventLive = await browser.json<EventRoster>(`${eventBase}/attendance`, 'POST', { school_id: schoolId,
      idempotency_key: randomUUID(), expected_revision: published.sessions[0]!.revision,
      records: [{ student_id: studentId, status: 'present', observed_at: new Date().toISOString(), note: 'Observed in Live before capture', readiness_contradiction_note: null }] });

    const assessmentBase = `/api/v1/schools/${schoolId}/assessments`;
    const policy = await browser.json<{ revision: number }>(`${assessmentBase}/exam-policy/`);
    await browser.json(`${assessmentBase}/exam-policy/`, 'POST', { expected_revision: policy.revision,
      readiness_minutes_before: 60, attendance_close_after_minutes: 60, minimum_invigilators: 1,
      require_all_candidate_attendance: true, post_completion_marking_mode: 'manual' });
    const cycle = await browser.json<{ id: string }>(`${assessmentBase}/cycles/`, 'POST', { term_id: setup.resources.term_id,
      name: 'Captured examination cycle', code: 'WORLD', starts_on: localDate, ends_on: localDate, result_label: 'Result' });
    const examInput = { cycle_id: cycle.id,
      class_section_id: setup.resources.class_section_id, subject_id: subject.id, title: 'Captured examination attendance',
      assessment_kind: 'exam', maximum_marks: 100, scheduled_at: examinationStart, duration_minutes: 30,
      examiner_user_id: userId, moderator_user_id: moderator.id, space_id: space.id, invigilator_user_ids: [userId, moderator.id] };
    const invitationUrl = `${assessmentBase}/invigilation-invitations/`;
    const unconfigured = await browser.json<InvigilationInvitationPolicyView>(invitationUrl);
    expect(unconfigured.policy).toMatchObject({ state: 'unconfigured', revision: 0, enabled: false });
    expect(unconfigured.readiness.can_create_invitations).toBe(false);
    const blocked = await browser.request(assessmentBase, 'POST', examInput);
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain('No approved invigilation Offer behaviour');
    expect((await source.query('SELECT 1 FROM assessments WHERE school_id=$1 AND title=$2', [schoolId, examInput.title])).rowCount).toBe(0);
    const recipient = unconfigured.eligible_recipients.find(person => person.user_id === userId)!;
    const approveInput = { expected_revision: 0, enabled: true, recipient_person_ids: [recipient.person_id, moderatorPerson.id],
      response_due_minutes: 720, expires_after_minutes: 2880, approval_note: 'Approve exact invitations to the selected active operator; never accept on their behalf.',
      idempotency_key: randomUUID() };
    let livePolicy = await browser.json<InvigilationInvitationPolicyView>(invitationUrl, 'POST', approveInput);
    expect(livePolicy.policy).toMatchObject({ state: 'enabled', revision: 1, recipient_person_ids: [...approveInput.recipient_person_ids].sort() });
    expect(livePolicy.readiness.can_create_invitations).toBe(true);
    expect(await browser.json<InvigilationInvitationPolicyView>(invitationUrl, 'POST', approveInput)).toEqual(livePolicy);
    const exam = await browser.json<{ id: string; revision: number }>(assessmentBase, 'POST', examInput);
    const examBase = `${assessmentBase}/${exam.id}`;
    const planning = await browser.json<ExamScreen>(`${examBase}/sitting/`), assignment = planning.invigilators.find(row => row.user_id === userId)!;
    // Reapproval neither silently preserves stale invitations nor accepts a duty.
    // The still-selected person can be reissued via unchanged arrangements; the
    // deselected person must be removed/replaced, with the old message retained.
    livePolicy = await browser.json<InvigilationInvitationPolicyView>(invitationUrl, 'POST', { ...approveInput,
      expected_revision: 1, recipient_person_ids: [recipient.person_id], approval_note: 'Only the named current operator remains eligible after this review.', idempotency_key: randomUUID() });
    const stalePlanning = await browser.json<ExamScreen>(`${examBase}/sitting/`);
    expect(stalePlanning.invigilators.find(row => row.user_id === userId)!.invitation_status).toMatchObject({ state: 'needs_reissue', can_respond: false });
    expect(stalePlanning.invigilators.find(row => row.user_id === moderator.id)!.invitation_status).toMatchObject({ state: 'recipient_ineligible', can_respond: false });
    const oldResponse = await browser.request(`${examBase}/sitting/invigilators/${assignment.id}/response/`, 'POST', {
      command_id: randomUUID(), expected_revision: assignment.revision, decision: 'accepted', note: 'This stale invitation must not be accepted.' });
    expect(oldResponse.status).toBe(409);
    expect(await oldResponse.text()).toContain('Edit arrangements');
    const arrangements = { expected_assessment_revision: exam.revision, expected_sitting_revision: planning.sitting.revision,
      scheduled_at: examinationStart, duration_minutes: 30, space_id: space.id, invigilator_user_ids: [userId, moderator.id] };
    expect((await browser.request(`${examBase}/sitting/arrangements/`, 'POST', arrangements)).status).toBe(409);
    const reissued = await browser.json<{ assessment: { revision: number } }>(`${examBase}/sitting/arrangements/`, 'POST', { ...arrangements, invigilator_user_ids: [userId] });
    const updatedPlanning = await browser.json<ExamScreen>(`${examBase}/sitting/`);
    const currentAssignment = updatedPlanning.invigilators.find(row => row.user_id === userId)!;
    expect(currentAssignment).toMatchObject({ revision: assignment.revision + 1, status: 'offered', invitation_status: { state: 'current', can_respond: true } });
    expect(updatedPlanning.invigilators.find(row => row.user_id === moderator.id)!.status).toBe('revoked');
    const invitationHistory = (await source.query<{ status: string; message_id: string }>(`SELECT status,message_id FROM assessment_invigilation_offer_bindings
      WHERE school_id=$1 AND assignment_id=$2 ORDER BY source_assignment_revision`, [schoolId, assignment.id])).rows;
    expect(invitationHistory.map(row => row.status)).toEqual(['cancelled', 'offered']);
    expect(new Set(invitationHistory.map(row => row.message_id)).size).toBe(2);
    await browser.json(`${examBase}/sitting/invigilators/${assignment.id}/response/`, 'POST', {
      command_id: randomUUID(), expected_revision: currentAssignment.revision, decision: 'accepted', note: 'Accepted this exact explicitly reissued duty.' });
    await browser.json(`${examBase}/actions/schedule/`, 'POST', { expected_revision: reissued.assessment.revision, note: 'Readiness checked through the owning workflow.' });
    const ready = await browser.json<ExamScreen>(`${examBase}/sitting/`);
    const started = await browser.json<{ sitting: { revision: number } }>(`${examBase}/sitting/actions/start/`, 'POST', { expected_revision: ready.sitting.revision });
    const examLive = await browser.json<{ sitting_revision: number; records: Array<{ revision: number; status: string }> }>(`${examBase}/sitting/attendance/`, 'POST', {
      expected_revision: started.sitting.revision, records: [{ student_id: studentId, status: 'present', expected_revision: 1,
        observed_at: new Date().toISOString(), note: 'Observed in Live before capture' }] });
    const links = (await source.query<{ source_kind: string; register_id: string }>(`SELECT source_kind,register_id
      FROM activity_attendance_source_contexts WHERE school_id=$1 AND source_kind IN ('event','examination') AND state='active'`, [schoolId])).rows;
    const eventRegister = links.find(row => row.source_kind === 'event')!.register_id;
    const examRegister = links.find(row => row.source_kind === 'examination')!.register_id;
    const common = (id: string) => `/api/v1/schools/${schoolId}/activities/registers/${id}`;
    const originalEventHistory = await browser.json<CommonHistory>(`${common(eventRegister)}/history`);
    const originalExamHistory = await browser.json<CommonHistory>(`${common(examRegister)}/history`);
    expect(originalEventHistory.history.filter(row => row.status === 'present')).toHaveLength(1);
    expect(originalExamHistory.history.filter(row => row.status === 'present')).toHaveLength(1);

    const captured = await browser.json<{ run: { id: string; can_open: boolean } }>(`/api/v1/schools/${schoolId}/simulation/runs`, 'POST', {
      kind: 'scenario', name: 'Owned attendance changed world', speed: 20, idempotency_key: randomUUID() });
    expect(captured.run.can_open).toBe(true);
    const sibling = await browser.json<{ run: { id: string; can_open: boolean } }>(`/api/v1/schools/${schoolId}/simulation/runs/${captured.run.id}/duplicate`, 'POST', {
      kind: 'scenario', name: 'Owned attendance unchanged sibling', speed: 20, idempotency_key: randomUUID() });
    expect(sibling.run.can_open).toBe(true);
    const select = (runId: string) => browser.json('/api/v1/auth/execution-environment/', 'POST', { mode: 'simulation', run_id: runId });
    await select(captured.run.id);
    expect(await browser.json<CommonHistory>(`${common(eventRegister)}/history`)).toEqual(originalEventHistory);
    expect(await browser.json<CommonHistory>(`${common(examRegister)}/history`)).toEqual(originalExamHistory);
    const beforeEvent = await browser.json<CommonScreen>(common(eventRegister));
    const beforeExam = await browser.json<CommonScreen>(common(examRegister));
    expect(beforeEvent.capabilities.can_record).toBe(false);
    expect(beforeExam.capabilities.can_record).toBe(false);
    expect(beforeExam.roster).toHaveLength(1); // The accepted invigilator is not an examination candidate.
    const denied = await browser.request(`${common(eventRegister)}/marks`, 'PUT', { expected_revision: beforeEvent.register.revision,
      records: [{ person_id: beforeEvent.roster[0]!.person_id, status: 'absent' }] }, { 'Idempotency-Key': randomUUID() });
    expect(denied.status).toBe(403);
    // Use the real virtual clock, not a future fabricated observation. Advance
    // this world into the event, then pause it for the operator's corrections.
    const runBase = `/api/v1/schools/${schoolId}/simulation/runs/${captured.run.id}`;
    await browser.json(`${runBase}/start`, 'POST', { speed: 100 });
    let elapsed = 0;
    for (let attempt = 0; attempt < 80 && elapsed < 12 * 60_000; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const progress = await browser.json<{ run: { clock: { simulated_elapsed_ms: number } } }>(runBase);
      elapsed = progress.run.clock.simulated_elapsed_ms;
    }
    expect(elapsed).toBeGreaterThanOrEqual(12 * 60_000);
    let pause: Response | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      pause = await browser.request(`${runBase}/pause`, 'POST', {});
      if (pause.ok) break;
      expect(pause.status).toBe(409);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(pause?.ok).toBe(true);
    const paused = await pause!.json() as { run: { clock: { virtual_now: string } } };
    const observationTime = new Date(Date.parse(paused.run.clock.virtual_now) - 1_000).toISOString();
    const branchPolicy = await browser.json<InvigilationInvitationPolicyView>(invitationUrl, 'POST', { ...approveInput,
      expected_revision: 2, recipient_person_ids: [recipient.person_id], response_due_minutes: 30, expires_after_minutes: 120,
      approval_note: 'Approve the scenario-only invitation timing, with the same named recipient.', idempotency_key: randomUUID() });
    expect(branchPolicy.policy).toMatchObject({ revision: 3, response_due_minutes: 30 });
    const branchExam = await browser.json<{ id: string; revision: number }>(assessmentBase, 'POST', { ...examInput,
      title: 'Scenario-only invitation proof', invigilator_user_ids: [userId], scheduled_at: new Date(Date.parse(paused.run.clock.virtual_now) + 90 * 60_000).toISOString() });
    const branchExamBase = `${assessmentBase}/${branchExam.id}`;
    const branchPlanning = await browser.json<ExamScreen>(`${branchExamBase}/sitting/`);
    const branchOffer = branchPlanning.invigilators.find(row => row.user_id === userId)!;
    expect(branchOffer.status).toBe('offered'); // Approval did not accept this duty.
    const branchResponse = { command_id: randomUUID(), expected_revision: branchOffer.revision, decision: 'accepted', note: 'Accepted this exact scenario-only invitation.' };
    const accepted = await browser.json<{ status: string }>(`${branchExamBase}/sitting/invigilators/${branchOffer.id}/response/`, 'POST', branchResponse);
    expect(accepted.status).toBe('accepted');
    expect(await browser.json(`${branchExamBase}/sitting/invigilators/${branchOffer.id}/response/`, 'POST', branchResponse)).toEqual(accepted);
    const eventChange = { school_id: schoolId, idempotency_key: randomUUID(), expected_revision: eventLive.session.revision,
      reason: 'Scenario reconciles a delayed arrival with the original attendance source.', records: [{ student_id: studentId,
        status: 'late', observed_at: observationTime, note: 'Scenario-only delayed arrival', readiness_contradiction_note: null }] };
    const changedEvent = await browser.json<EventRoster>(`${eventBase}/attendance`, 'POST', eventChange);
    expect(changedEvent.rows[0]!.attendance_status).toBe('late');
    expect(await browser.json<EventRoster>(`${eventBase}/attendance`, 'POST', eventChange)).toEqual(changedEvent);
    const changedExam = await browser.json<{ sitting_revision: number; records: Array<{ status: string }> }>(`${examBase}/sitting/attendance/`, 'POST', {
      expected_revision: examLive.sitting_revision, reason: 'Scenario records an authorized early departure instead of the captured baseline.',
      records: [{ student_id: studentId, status: 'left_early', expected_revision: examLive.records[0]!.revision,
        observed_at: observationTime, note: 'Scenario-only authorized medical departure' }] });
    expect(changedExam.records[0]!.status).toBe('left_early');
    const stale = await browser.request(`${examBase}/sitting/attendance/`, 'POST', { expected_revision: examLive.sitting_revision,
      records: [{ student_id: studentId, status: 'absent', expected_revision: examLive.records[0]!.revision }] });
    expect(stale.status).toBe(409);
    const eventHistory = await browser.json<CommonHistory>(`${common(eventRegister)}/history`);
    const examHistory = await browser.json<CommonHistory>(`${common(examRegister)}/history`);
    expect(eventHistory.history).toEqual(expect.arrayContaining(originalEventHistory.history));
    expect(examHistory.history).toEqual(expect.arrayContaining(originalExamHistory.history));
    expect(eventHistory.history.filter(row => row.status === 'late')).toHaveLength(1);
    expect(examHistory.history.filter(row => row.status === 'left_early')).toHaveLength(1);
    const completed = await browser.json<{ sitting: { state: string } }>(`${examBase}/sitting/actions/complete/`, 'POST', { expected_revision: changedExam.sitting_revision });
    expect(completed.sitting.state).toBe('completed');
    expect((await browser.json<CommonScreen>(common(examRegister))).register.state).toBe('locked');

    const world = (await target.query<{ schema_name: string }>('SELECT schema_name FROM dt_simulation.worlds WHERE run_id=$1', [captured.run.id])).rows[0]!;
    expect(world.schema_name).toMatch(/^dt_run_[0-9a-f]{32}$/u);
    const branchFacts = (await target.query<{ event_archives: number; exam_archives: number; observed: number; candidate_rows: number }>(`SELECT
      (SELECT count(*)::int FROM "${world.schema_name}".campus_event_attendance_records_legacy_source WHERE school_id=$1) AS event_archives,
      (SELECT count(*)::int FROM "${world.schema_name}".assessment_candidate_attendance_legacy_source WHERE school_id=$1) AS exam_archives,
      (SELECT count(*)::int FROM "${world.schema_name}".campus_model_observations WHERE school_id=$1 AND kind='attendance.participation_observed') AS observed,
      (SELECT count(*)::int FROM "${world.schema_name}".activity_attendance_roster WHERE register_id=$2) AS candidate_rows`, [schoolId, examRegister])).rows[0]!;
    expect(branchFacts).toEqual({ event_archives: 0, exam_archives: 0, observed: 4, candidate_rows: 1 });
    await select(sibling.run.id);
    expect((await browser.json<InvigilationInvitationPolicyView>(invitationUrl)).policy).toEqual(livePolicy.policy);
    expect((await browser.json<CommonScreen>(common(eventRegister))).roster[0]!.status).toBe('present');
    expect((await browser.json<CommonScreen>(common(examRegister))).roster[0]!.status).toBe('present');
    expect((await browser.json<ExamScreen>(`${examBase}/sitting/`)).sitting.state).toBe('in_progress');
    expect(await browser.json<CommonHistory>(`${common(eventRegister)}/history`)).toEqual(originalEventHistory);
    expect(await browser.json<CommonHistory>(`${common(examRegister)}/history`)).toEqual(originalExamHistory);
    await browser.json('/api/v1/auth/execution-environment/', 'POST', { mode: 'live' });
    expect((await browser.json<InvigilationInvitationPolicyView>(invitationUrl)).policy).toEqual(livePolicy.policy);
    expect((await source.query('SELECT 1 FROM assessments WHERE school_id=$1 AND id=$2', [schoolId, branchExam.id])).rowCount).toBe(0);
    expect((await browser.json<CommonScreen>(common(eventRegister))).roster[0]!.status).toBe('present');
    expect((await browser.json<CommonScreen>(common(examRegister))).roster[0]!.status).toBe('present');
    expect((await browser.json<ExamScreen>(`${examBase}/sitting/`)).sitting.state).toBe('in_progress');
    expect(await browser.json<CommonHistory>(`${common(eventRegister)}/history`)).toEqual(originalEventHistory);
    expect(await browser.json<CommonHistory>(`${common(examRegister)}/history`)).toEqual(originalExamHistory);
    const liveFacts = (await source.query<{ event_archives: number; exam_archives: number; observed: number }>(`SELECT
      (SELECT count(*)::int FROM campus_event_attendance_records_legacy_source WHERE school_id=$1) AS event_archives,
      (SELECT count(*)::int FROM assessment_candidate_attendance_legacy_source WHERE school_id=$1) AS exam_archives,
      (SELECT count(*)::int FROM campus_model_observations WHERE school_id=$1 AND kind='attendance.participation_observed') AS observed`, [schoolId])).rows[0]!;
    expect(liveFacts).toEqual({ event_archives: 0, exam_archives: 0, observed: 2 });
    const outsider = new Session(); await outsider.json('/api/v1/auth/csrf/');
    await outsider.json('/api/v1/auth/register/', 'POST', { email: `world.outsider.${randomUUID()}@example.test`, password: 'Str0ng!UnrelatedRiver2026' });
    // The session boundary deliberately conceals worlds owned by another user.
    expect((await outsider.request('/api/v1/auth/execution-environment/', 'POST', { mode: 'simulation', run_id: captured.run.id })).status).toBe(410);
  }, 120_000);
});
