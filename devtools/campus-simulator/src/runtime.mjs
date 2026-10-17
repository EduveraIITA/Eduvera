import { ApiSession } from "./http-session.mjs";
import { DevelopmentActionRunner } from "./actions.mjs";
import { buildStatusSnapshot, createRoutineSchedule } from "./model.mjs";
import { assertCambridgeFixture, verifyApplicationApi } from "./safety.mjs";

function errorMessage(error) {
  return typeof error?.message === "string" ? error.message.slice(0, 400) : "Unknown Campus Lab runtime error.";
}

function emptyStatus(startedAt, message = null) {
  return {
    status: message ? "degraded" : "booting",
    generated_at: new Date().toISOString(),
    started_at: new Date(startedAt).toISOString(),
    school: { id: "", name: "Cambridge International School", code: "cis" },
    phase: {
      id: message ? "unavailable" : "starting",
      label: message ? "Development rehearsal unavailable" : "Starting development rehearsal",
      description: message ?? "Connecting to the local Cambridge dummy school through normal application APIs.",
      started_at: new Date(startedAt).toISOString(),
      next_change_at: new Date(Date.now() + 5_000).toISOString(),
      mode: "closed",
      period_number: null,
      school_starts_at: null,
      school_ends_at: null,
    },
    schedule: { reference_weekday: null, reference_date: null, simulated_at: null, source: "effective_school_schedule", active_slot_ids: [] },
    summary: { actors: 0, students: 0, staff: 0, zones: 0, unplaced: 0 },
    zones: [],
    unplaced: [],
    activity: [],
    control: { enabled: true, changed_at: new Date(startedAt).toISOString(), changed_by: "startup" },
    ...(message ? { errors: [message] } : {}),
  };
}

function stoppedStatus(runtime) {
  const base = emptyStatus(runtime.startedAt);
  return {
    ...base,
    status: "paused",
    generated_at: new Date().toISOString(),
    school: runtime.data?.setup?.school ?? base.school,
    phase: {
      ...base.phase,
      id: "operator_stopped",
      label: "Simulation stopped",
      description: "An administrator stopped the Cambridge development actors. No simulated actions will run until they are activated again.",
      next_change_at: null,
    },
    control: runtime.control,
  };
}

async function allStudents(session, schoolId) {
  const results = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < 50; page += 1) {
    const parameters = new URLSearchParams({ school_id: schoolId, search: "" });
    if (cursor) parameters.set("cursor", cursor);
    const response = await session.request(`/api/v1/people/students?${parameters}`);
    for (const student of response?.results ?? []) {
      if (!seen.has(student.id)) {
        seen.add(student.id);
        results.push(student);
      }
    }
    if (!response?.next_cursor || response.next_cursor === cursor) break;
    cursor = response.next_cursor;
  }
  return results;
}

async function currentSchoolDay(session, schoolId, principalTimetable = null) {
  const principal = principalTimetable ?? await session.request("/api/v1/screens/principal/timetable/");
  let date = principal.school_date;
  if (!date) throw new Error("The principal timetable did not provide the current school-local date.");
  let day = await session.request(`/api/v1/day-plans/options?${new URLSearchParams({ school_id: schoolId, date })}`);
  if (day?.context?.today && day.context.today !== date) {
    date = day.context.today;
    day = await session.request(`/api/v1/day-plans/options?${new URLSearchParams({ school_id: schoolId, date })}`);
  }
  if (!day?.context?.timezone) throw new Error("The effective school day did not provide a campus timezone.");
  return { ...day, school_date: date };
}

export class CampusSimulatorRuntime {
  constructor({ apiOrigin, behavior, demoPassword, hosted = false, serviceToken = "", startedAt = new Date(), fetchImpl = fetch }) {
    this.apiOrigin = apiOrigin;
    this.behavior = behavior;
    this.demoPassword = demoPassword;
    this.hosted = hosted;
    this.serviceToken = serviceToken;
    this.startedAt = new Date(startedAt);
    this.runStartedAt = new Date(startedAt);
    this.fetchImpl = fetchImpl;
    this.status = emptyStatus(this.startedAt);
    this.actionActivity = [];
    this.errors = [];
    this.data = null;
    this.sessions = null;
    this.actionRunner = null;
    this.routine = null;
    this.intervals = [];
    this.refreshing = false;
    this.actorSessions = new Map();
    this.control = { enabled: true, changed_at: this.startedAt.toISOString(), changed_by: "startup" };
  }

  snapshot() {
    return this.status;
  }

  addActivity(item) {
    this.actionActivity.unshift(item);
    this.actionActivity = this.actionActivity.slice(0, Number(this.behavior.activity_history_limit ?? 30));
    this.render();
  }

  render() {
    if (!this.control.enabled) {
      this.status = stoppedStatus(this);
      return;
    }
    if (!this.data) {
      this.status = emptyStatus(this.startedAt, this.errors.at(-1) ?? null);
      this.status.control = this.control;
      return;
    }
    this.status = buildStatusSnapshot({
      now: new Date(),
      startedAt: this.startedAt,
      behavior: this.behavior,
      setup: this.data.setup,
      timetable: this.data.timetable,
      students: this.data.students,
      adminUser: this.sessions?.admin?.user,
      actionActivity: this.actionActivity,
      errors: this.errors,
      status: "running",
      routine: this.routine,
    });
    this.status.control = this.control;
  }

  createSessions() {
    const create = (persona) => new ApiSession(this.apiOrigin, {
      fetchImpl: this.fetchImpl,
      ...(this.hosted ? { serviceToken: this.serviceToken, serviceUsername: this.behavior.personas?.[persona] } : {}),
    });
    return {
      admin: create("admin"),
      staff: create("staff"),
      parent: create("parent"),
      student: create("student"),
    };
  }

  async fixtureActorSession({ username, userId, schoolId }) {
    const existing = this.actorSessions.get(userId);
    if (existing) return existing;
    const session = new ApiSession(this.apiOrigin, {
      fetchImpl: this.fetchImpl,
      ...(this.hosted ? { serviceToken: this.serviceToken, serviceUsername: username } : {}),
    });
    if (this.hosted) await session.connectServiceIdentity();
    else await session.login(username, this.demoPassword);
    if (session.user?.id !== userId || session.user?.active_school_id !== schoolId) {
      throw new Error(`The fixture identity ${username} did not resolve to the offered Cambridge staff member.`);
    }
    this.actorSessions.set(userId, session);
    return session;
  }

  async connect() {
    await verifyApplicationApi(this.apiOrigin, { fetchImpl: this.fetchImpl, hosted: this.hosted });
    const sessions = this.createSessions();
    if (this.hosted) await Promise.all(Object.values(sessions).map((session) => session.connectServiceIdentity()));
    else await Promise.all([
      sessions.admin.loginDemo("admin"), sessions.staff.loginDemo("staff"),
      sessions.parent.loginDemo("parent"), sessions.student.loginDemo("student"),
    ]);
    const schoolId = sessions.admin.user?.active_school_id;
    if (!schoolId) throw new Error("The Cambridge administrator has no active dummy school.");
    const identities = Object.entries(sessions);
    const wrongSchool = identities.find(([, session]) => session.user?.active_school_id !== schoolId);
    if (wrongSchool) throw new Error(`The ${wrongSchool[0]} demo identity is not connected to the Cambridge dummy school.`);
    const [setup, principalTimetable, students] = await Promise.all([
      sessions.admin.request(`/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`),
      sessions.admin.request("/api/v1/screens/principal/timetable/"),
      allStudents(sessions.admin, schoolId),
    ]);
    const timetable = await currentSchoolDay(sessions.admin, schoolId, principalTimetable);
    assertCambridgeFixture(setup, this.behavior);
    if (!(setup.spaces ?? []).some((space) => space.status === "active")) throw new Error("The Cambridge fixture has no active campus spaces.");
    this.sessions = sessions;
    this.data = { setup, timetable, students };
    this.routine = createRoutineSchedule({ startedAt: this.runStartedAt, now: new Date(), behavior: this.behavior, timetable });
    this.errors = [];
    this.actionRunner = new DevelopmentActionRunner({
      sessions,
      setup,
      behavior: this.behavior,
      startedAt: this.startedAt,
      routine: this.routine,
      actorSession: (identity) => this.fixtureActorSession(identity),
      onActivity: (item) => this.addActivity(item),
    });
    this.render();
  }

  async refresh() {
    if (this.refreshing || !this.sessions || !this.data) return;
    this.refreshing = true;
    try {
      const schoolId = this.data.setup.school.id;
      const [setup, principalTimetable] = await Promise.all([
        this.sessions.admin.request(`/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`),
        this.sessions.admin.request("/api/v1/screens/principal/timetable/"),
      ]);
      const timetable = await currentSchoolDay(this.sessions.admin, schoolId, principalTimetable);
      assertCambridgeFixture(setup, this.behavior);
      this.data = { ...this.data, setup, timetable };
      this.routine = createRoutineSchedule({ startedAt: this.runStartedAt, now: new Date(), behavior: this.behavior, timetable });
      this.actionRunner?.updateRoutine(this.routine);
      this.errors = [];
    } catch (error) {
      this.errors = [errorMessage(error)];
    } finally {
      this.refreshing = false;
      this.render();
    }
  }

  startIntervals() {
    if (this.intervals.length) return;
    const renderTimer = setInterval(() => this.render(), Number(this.behavior.status_tick_seconds) * 1_000);
    const refreshTimer = setInterval(() => void this.refresh(), Number(this.behavior.refresh_interval_seconds) * 1_000);
    const actionTimer = setInterval(
      () => void this.actionRunner?.tick(new Date()),
      Number(this.behavior.action_poll_seconds) * 1_000,
    );
    for (const timer of [renderTimer, refreshTimer, actionTimer]) timer.unref?.();
    this.intervals.push(renderTimer, refreshTimer, actionTimer);
  }

  stop() {
    for (const timer of this.intervals) clearInterval(timer);
    this.intervals = [];
  }

  async setEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.control.enabled === next) {
      if (next) await this.actionRunner?.tick(new Date());
      this.render();
      return this.snapshot();
    }
    this.control = { enabled: next, changed_at: new Date().toISOString(), changed_by: "administrator" };
    if (!next) {
      this.stop();
      this.render();
      return this.snapshot();
    }
    this.runStartedAt = new Date();
    if (!this.data) await this.connect();
    else await this.refresh();
    this.startIntervals();
    this.render();
    await this.actionRunner?.tick(new Date());
    return this.snapshot();
  }

  async bootWithRetry({ retryMs = 5_000 } = {}) {
    while (!this.data && this.control.enabled) {
      try {
        await this.connect();
      } catch (error) {
        this.errors = [errorMessage(error)];
        this.render();
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, retryMs);
          timer.unref?.();
        });
      }
    }
    if (!this.control.enabled) {
      this.render();
      return;
    }
    this.startIntervals();
    await this.actionRunner?.tick(new Date());
  }
}

export const runtimeInternals = { allStudents, currentSchoolDay, emptyStatus, errorMessage };
