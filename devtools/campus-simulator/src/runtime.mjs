import { ApiSession } from "./http-session.mjs";
import { DevelopmentActionRunner } from "./actions.mjs";
import { buildStatusSnapshot, createRoutineSchedule } from "./model.mjs";
import { assertCambridgeFixture, verifyApplicationApi } from "./safety.mjs";

const CLOCK_MODES = new Map([["1m", 60], ["15m", 900], ["60m", 3_600]]);

function durationLabel(durationSeconds) {
  if (durationSeconds === 60) return "One-minute Cambridge school day";
  if (durationSeconds === 900) return "15-minute Cambridge school day";
  if (durationSeconds === 3_600) return "One-hour Cambridge school day";
  throw new Error("Campus Lab duration must be 1 minute, 15 minutes or 1 hour.");
}

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
    control: { enabled: false, clock_mode: "60m", duration_seconds: 3_600, changed_at: new Date(startedAt).toISOString(), changed_by: "startup" },
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

function dateInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function currentSchoolDay(session, schoolId, { date, timezone }) {
  if (!date || !timezone) throw new Error("The effective school day requires a school-local date and timezone.");
  let day = await session.request(`/api/v1/day-plans/options?${new URLSearchParams({ school_id: schoolId, date })}`);
  if (day?.context?.today && day.context.today !== date) {
    date = day.context.today;
    day = await session.request(`/api/v1/day-plans/options?${new URLSearchParams({ school_id: schoolId, date })}`);
  }
  if (!day?.context?.timezone) throw new Error("The effective school day did not provide a campus timezone.");
  return { ...day, school_date: date };
}

async function schoolDayForDate(session, schoolId, date) {
  const day = await session.request(`/api/v1/day-plans/options?${new URLSearchParams({ school_id: schoolId, date })}`);
  if (!day?.context?.timezone) throw new Error("The effective school day did not provide a campus timezone.");
  return { ...day, school_date: date };
}

function addCalendarDays(date, days) {
  const [year, month, day] = String(date).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
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
    this.advancing = false;
    this.bootPromise = null;
    this.actorSessions = new Map();
    this.runId = null;
    this.control = {
      enabled: false,
      clock_mode: "60m",
      duration_seconds: Number(this.behavior.clock.duration_seconds),
      changed_at: this.startedAt.toISOString(),
      changed_by: "startup",
    };
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
      startedAt: this.runStartedAt,
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
    if (this.status.schedule && this.control.clock_mode !== "realtime") {
      this.status.schedule.cycle = {
        start_date: this.simulationStartDate,
        end_date: this.simulationEndDate,
        rotation: "repeat",
      };
    }
    this.status.control = this.control;
  }

  async syncSimulationClock() {
    const virtualNow = this.status?.schedule?.simulated_at;
    if (!virtualNow || !this.sessions?.admin) return;
    await this.sessions.admin.enterCampusLabSimulation(virtualNow);
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
    await session.enterCampusLabSimulation();
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
    await Promise.all(Object.values(sessions).map((session) => session.enterCampusLabSimulation()));
    const schoolId = sessions.admin.user?.active_school_id;
    if (!schoolId) throw new Error("The Cambridge administrator has no active dummy school.");
    const identities = Object.entries(sessions);
    const wrongSchool = identities.find(([, session]) => session.user?.active_school_id !== schoolId);
    if (wrongSchool) throw new Error(`The ${wrongSchool[0]} demo identity is not connected to the Cambridge dummy school.`);
    const [setup, students] = await Promise.all([
      sessions.admin.request(`/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`),
      allStudents(sessions.admin, schoolId),
    ]);
    const timezone = setup.school?.timezone ?? this.behavior.timezone;
    const timetable = await currentSchoolDay(sessions.admin, schoolId, {
      date: dateInZone(new Date(), timezone),
      timezone,
    });
    assertCambridgeFixture(setup, this.behavior);
    if (!(setup.spaces ?? []).some((space) => space.status === "active")) throw new Error("The Cambridge fixture has no active campus spaces.");
    this.sessions = sessions;
    this.data = { setup, timetable, students };
    this.simulationStartDate = timetable.school_date;
    this.simulationEndDate = addCalendarDays(this.simulationStartDate, 29);
    this.errors = [];
    this.resetRun(this.runStartedAt, false);
    this.render();
    await this.syncSimulationClock();
  }

  resetRun(startedAt = new Date(), clearActivity = true) {
    if (!this.data || !this.sessions) return;
    this.runStartedAt = new Date(startedAt);
    if (clearActivity) this.actionActivity = [];
    this.routine = createRoutineSchedule({
      startedAt: this.runStartedAt,
      now: new Date(),
      behavior: this.behavior,
      timetable: this.data.timetable,
    });
    this.actionRunner = new DevelopmentActionRunner({
      sessions: this.sessions,
      setup: this.data.setup,
      behavior: this.behavior,
      startedAt: this.runStartedAt,
      routine: this.routine,
      actorSession: (identity) => this.fixtureActorSession(identity),
      onActivity: (item) => this.addActivity(item),
      runId: this.runId,
    });
  }

  async advanceCalendar(now = new Date()) {
    if (this.advancing || this.refreshing || !this.data || !this.sessions || !this.control.enabled) return;
    if (this.routine?.clock?.mode !== "compressed_school_day") return;
    if (new Date(now).getTime() < new Date(this.routine.clock.ends_at).getTime()) return;
    this.advancing = true;
    try {
      let nextDate = addCalendarDays(this.data.timetable.school_date, 1);
      if (nextDate > this.simulationEndDate) nextDate = this.simulationStartDate;
      const schoolId = this.data.setup.school.id;
      let timetable = await schoolDayForDate(this.sessions.admin, schoolId, nextDate);
      const checkedDates = new Set([nextDate]);
      while (!(timetable.schedule ?? []).length || timetable.context?.is_instructional === false) {
        nextDate = addCalendarDays(nextDate, 1);
        if (nextDate > this.simulationEndDate) nextDate = this.simulationStartDate;
        if (checkedDates.has(nextDate)) {
          throw new Error("The configured 30-day Campus Lab window has no effective school day to simulate.");
        }
        checkedDates.add(nextDate);
        timetable = await schoolDayForDate(this.sessions.admin, schoolId, nextDate);
      }
      this.data = { ...this.data, timetable };
      this.resetRun(new Date(), false);
      this.errors = [];
      this.render();
      await this.syncSimulationClock?.();
    } catch (error) {
      this.errors = [errorMessage(error)];
      this.render();
    } finally {
      this.advancing = false;
    }
  }

  async refresh() {
    if (this.refreshing || this.advancing || !this.sessions || !this.data) return;
    this.refreshing = true;
    try {
      const schoolId = this.data.setup.school.id;
      const setup = await this.sessions.admin.request(`/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`);
      const timezone = setup.school?.timezone ?? this.behavior.timezone;
      const activeDate = this.control.clock_mode === "realtime"
        ? dateInZone(new Date(), timezone)
        : this.data.timetable.school_date ?? dateInZone(new Date(), timezone);
      const timetable = this.control.clock_mode === "realtime"
        ? await currentSchoolDay(this.sessions.admin, schoolId, { date: activeDate, timezone })
        : await schoolDayForDate(this.sessions.admin, schoolId, activeDate);
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
      await this.syncSimulationClock().catch((error) => {
        this.errors = [errorMessage(error)];
        this.render();
      });
    }
  }

  startIntervals() {
    if (this.intervals.length) return;
    const renderTimer = setInterval(() => this.render(), Number(this.behavior.status_tick_seconds) * 1_000);
    const refreshTimer = setInterval(() => void this.refresh(), Number(this.behavior.refresh_interval_seconds) * 1_000);
    const actionTimer = setInterval(
      () => {
        const now = new Date();
        void this.advanceCalendar(now)
          .then(() => this.syncSimulationClock())
          .then(() => this.actionRunner?.tick(now));
      },
      Number(this.behavior.action_poll_seconds) * 1_000,
    );
    for (const timer of [renderTimer, refreshTimer, actionTimer]) timer.unref?.();
    this.intervals.push(renderTimer, refreshTimer, actionTimer);
  }

  stop() {
    for (const timer of this.intervals) clearInterval(timer);
    this.intervals = [];
  }

  async setControl({ enabled, clock_mode: requestedClockMode, duration_seconds: legacyDuration, run_id: runId } = {}) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled && !runId && !this.runId) {
      throw new Error("Campus Lab can start only after the application creates an isolated Simulation run.");
    }
    if (runId) this.runId = runId;
    const legacyMode = legacyDuration === undefined ? null
      : [...CLOCK_MODES].find(([, duration]) => duration === Number(legacyDuration))?.[0];
    const nextClockMode = requestedClockMode ?? legacyMode ?? this.control.clock_mode;
    if (nextClockMode !== "realtime" && !CLOCK_MODES.has(nextClockMode)) {
      throw new Error("Campus Lab clock mode must be realtime, 1m, 15m or 60m.");
    }
    const nextDuration = nextClockMode === "realtime" ? null : CLOCK_MODES.get(nextClockMode);
    const enabledChanged = this.control.enabled !== nextEnabled;
    const clockModeChanged = this.control.clock_mode !== nextClockMode;
    if (!enabledChanged && !clockModeChanged) {
      if (nextEnabled) await this.actionRunner?.tick(new Date());
      this.render();
      return this.snapshot();
    }
    this.behavior = { ...this.behavior, clock: nextClockMode === "realtime"
      ? { mode: "wall_clock", label: "Real campus time" }
      : { ...this.behavior.clock, mode: "compressed_school_day", duration_seconds: nextDuration, label: durationLabel(nextDuration) } };
    this.control = {
      enabled: nextEnabled,
      clock_mode: nextClockMode,
      duration_seconds: nextDuration,
      changed_at: new Date().toISOString(),
      changed_by: "administrator",
    };
    if (!nextEnabled) {
      this.stop();
      this.sessions = null;
      this.data = null;
      this.actionRunner = null;
      this.actorSessions.clear();
      this.runId = null;
      this.render();
      return this.snapshot();
    }
    if (!this.data) {
      this.errors = [];
      this.render();
      void this.bootWithRetry();
      return this.snapshot();
    }
    if (enabledChanged || clockModeChanged) {
      const timezone = this.data.setup.school?.timezone ?? this.behavior.timezone;
      const startDate = dateInZone(new Date(), timezone);
      this.data.timetable = await schoolDayForDate(this.sessions.admin, this.data.setup.school.id, startDate);
      this.simulationStartDate = startDate;
      this.simulationEndDate = addCalendarDays(startDate, 29);
    }
    this.resetRun(new Date(), true);
    void this.refresh().then(() => this.actionRunner?.tick(new Date()));
    this.startIntervals();
    this.render();
    return this.snapshot();
  }

  setEnabled(enabled) {
    return this.setControl({ enabled, clock_mode: this.control.clock_mode });
  }

  bootWithRetry({ retryMs = 15_000 } = {}) {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = (async () => {
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
    })().finally(() => {
      this.bootPromise = null;
    });
    return this.bootPromise;
  }
}

export const runtimeInternals = { addCalendarDays, allStudents, currentSchoolDay, schoolDayForDate, dateInZone, emptyStatus, errorMessage };
