import assert from "node:assert/strict";
import test from "node:test";
import { runtimeInternals } from "../src/runtime.mjs";

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
