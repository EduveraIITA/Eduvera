import assert from "node:assert/strict";
import test from "node:test";
import { CampusSimulatorRuntime, runtimeInternals } from "../src/runtime.mjs";

test("resolves the effective schedule for the current school-local date", async () => {
  const calls = [];
  const session = {
    async request(path) {
      calls.push(path);
      return {
        context: {
          today: "2026-10-16",
          local_time: "09:10",
          timezone: "Asia/Kolkata",
          is_instructional: null,
          label: null,
        },
        schedule: [{ id: "period-1" }],
      };
    },
  };
  const result = await runtimeInternals.currentSchoolDay(session, "school-1", { date: "2026-10-16", timezone: "Asia/Kolkata" });
  assert.equal(result.school_date, "2026-10-16");
  assert.deepEqual(result.schedule, [{ id: "period-1" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /day-plans\/options\?/);
  assert.match(calls[0], /school_id=school-1/);
  assert.match(calls[0], /date=2026-10-16/);
});

test("re-resolves after a midnight race instead of running yesterday's schedule", async () => {
  const calls = [];
  const session = {
    async request(path) {
      calls.push(path);
      if (calls.length === 1) return {
        context: { today: "2026-10-17", timezone: "Asia/Kolkata" },
        schedule: [{ id: "stale-period" }],
      };
      return {
        context: { today: "2026-10-17", timezone: "Asia/Kolkata" },
        schedule: [{ id: "current-period" }],
      };
    },
  };
  const result = await runtimeInternals.currentSchoolDay(session, "school-1", { date: "2026-10-16", timezone: "Asia/Kolkata" });
  assert.equal(result.school_date, "2026-10-17");
  assert.deepEqual(result.schedule, [{ id: "current-period" }]);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /date=2026-10-17/);
});

test("formats the boot date in the institution timezone", () => {
  assert.equal(
    runtimeInternals.dateInZone(new Date("2026-10-16T19:15:00.000Z"), "Asia/Kolkata"),
    "2026-10-17",
  );
});

test("advances an accelerated run to the next effective school day", async () => {
  const runtime = {
    advancing: false,
    refreshing: false,
    control: { enabled: true, clock_mode: "1m" },
    routine: { clock: { mode: "compressed_school_day", ends_at: "2026-10-17T10:00:00.000Z" } },
    simulationStartDate: "2026-10-17",
    simulationEndDate: "2026-11-15",
    data: { setup: { school: { id: "school-1" } }, timetable: { school_date: "2026-10-17" } },
    sessions: { admin: { request: async (path) => ({
      context: { timezone: "Asia/Kolkata", is_instructional: null },
      schedule: path.includes("date=2026-10-18") ? [] : [{ id: "monday-period" }],
    }) } },
    resetRun() { this.didReset = true; },
    render() { this.didRender = true; },
    errors: ["old"],
  };
  await CampusSimulatorRuntime.prototype.advanceCalendar.call(runtime, new Date("2026-10-17T10:00:01.000Z"));
  assert.equal(runtime.data.timetable.school_date, "2026-10-19");
  assert.equal(runtime.didReset, true);
  assert.deepEqual(runtime.errors, []);
});

test("rotates an accelerated month back to its configured window start", async () => {
  const runtime = {
    advancing: false,
    refreshing: false,
    control: { enabled: true, clock_mode: "15m" },
    routine: { clock: { mode: "compressed_school_day", ends_at: "2026-11-15T10:00:00.000Z" } },
    simulationStartDate: "2026-10-17",
    simulationEndDate: "2026-11-15",
    data: { setup: { school: { id: "school-1" } }, timetable: { school_date: "2026-11-15" } },
    sessions: { admin: { request: async () => ({
      context: { timezone: "Asia/Kolkata", is_instructional: null }, schedule: [{ id: "rotated-period" }],
    }) } },
    resetRun() {}, render() {}, errors: [],
  };
  await CampusSimulatorRuntime.prototype.advanceCalendar.call(runtime, new Date("2026-11-15T10:00:01.000Z"));
  assert.equal(runtime.data.timetable.school_date, "2026-10-17");
});

test("fails safely when a complete simulation window has no effective school day", async () => {
  const runtime = {
    advancing: false,
    refreshing: false,
    control: { enabled: true, clock_mode: "60m" },
    routine: { clock: { mode: "compressed_school_day", ends_at: "2026-10-17T10:00:00.000Z" } },
    simulationStartDate: "2026-10-17",
    simulationEndDate: "2026-10-18",
    data: { setup: { school: { id: "school-1" } }, timetable: { school_date: "2026-10-17" } },
    sessions: { admin: { request: async () => ({
      context: { timezone: "Asia/Kolkata", is_instructional: false }, schedule: [],
    }) } },
    resetRun() { throw new Error("A closed window must not reset the run."); },
    render() { this.didRender = true; },
    errors: [],
  };

  await CampusSimulatorRuntime.prototype.advanceCalendar.call(runtime, new Date("2026-10-17T10:00:01.000Z"));

  assert.match(runtime.errors[0], /no effective school day/);
  assert.equal(runtime.data.timetable.school_date, "2026-10-17");
  assert.equal(runtime.didRender, true);
});
