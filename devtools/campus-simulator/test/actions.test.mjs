import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentActionRunner, deterministicUuid } from "../src/actions.mjs";
import { createRoutineSchedule, loadBehaviorFixture } from "../src/model.mjs";

const legacyOffsets = new Map([
  ["teacher-daily-attendance", 600],
  ["staff-guardian-message", 1200],
  ["publish-acknowledgement", 300],
  ["guardian-acknowledgement", 900],
]);

async function wallClockBehavior() {
  const behavior = await loadBehaviorFixture();
  return {
    ...behavior,
    clock: { mode: "wall_clock" },
    actions: behavior.actions.map(({ offset_ratio: _offsetRatio, ...action }) => ({
      ...action,
      offset_seconds: legacyOffsets.get(action.id) ?? 0,
    })),
  };
}

function timetable(date, schedule = [{
  id: `period-${date}`,
  class_section_id: "class-1",
  period_number: 1,
  starts_at: "09:00",
  ends_at: "09:45",
  slot_type: "class",
  title: "Mathematics",
  cancelled: false,
}]) {
  return {
    context: { today: date, timezone: "Asia/Kolkata", is_instructional: null, label: null },
    schedule,
    classes: [{ id: "class-1", name: "Class 6A" }],
    subjects: [],
  };
}

function runnerFor(behavior, routine, startedAt = new Date("2026-10-16T00:00:00.000Z")) {
  const activity = [];
  const runner = new DevelopmentActionRunner({
    sessions: {},
    setup: { school: { id: "school-1" } },
    behavior: { ...behavior, actions: [behavior.actions[0]], reactions: [] },
    startedAt,
    routine,
    onActivity: (item) => activity.push(item),
  });
  return { runner, activity };
}

test("never catches up a missed action after its live school phase", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const { runner } = runnerFor(behavior, routine);
  let executions = 0;
  runner.execute = async () => { executions += 1; return null; };

  await runner.tick(new Date("2026-10-16T04:16:00.000Z"));
  await runner.tick(new Date("2026-10-16T08:30:00.000Z"));
  assert.equal(executions, 0);
});

test("executes a configured action only inside its current live phase", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const { runner } = runnerFor(behavior, routine);
  let executions = 0;
  runner.execute = async () => { executions += 1; return null; };

  await runner.tick(new Date("2026-10-16T03:39:59.000Z"));
  assert.equal(executions, 0);
  await runner.tick(new Date("2026-10-16T03:40:00.000Z"));
  await runner.tick(new Date("2026-10-16T03:41:00.000Z"));
  assert.equal(executions, 1);
});

test("does not replay an action whose due instant passed before a midday restart", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T03:50:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const { runner } = runnerFor(behavior, routine, new Date("2026-10-16T03:50:00.000Z"));
  let executions = 0;
  runner.execute = async () => { executions += 1; return null; };

  await runner.tick(new Date("2026-10-16T03:50:01.000Z"));
  assert.equal(executions, 0);
});

test("resets the action scope when the authoritative school date changes", async () => {
  const behavior = await wallClockBehavior();
  const firstRoutine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const { runner } = runnerFor(behavior, firstRoutine);
  let executions = 0;
  runner.execute = async () => { executions += 1; return null; };

  await runner.tick(new Date("2026-10-16T03:40:00.000Z"));
  const nextRoutine = createRoutineSchedule({ now: new Date("2026-10-17T00:00:00.000Z"), behavior, timetable: timetable("2026-10-17") });
  runner.updateRoutine(nextRoutine, new Date("2026-10-17T00:00:00.000Z"));
  await runner.tick(new Date("2026-10-17T03:40:00.000Z"));

  assert.equal(runner.date, "2026-10-17");
  assert.equal(executions, 2);
});

test("performs no action on a non-instructional day", async () => {
  const behavior = await wallClockBehavior();
  const closed = timetable("2026-10-16");
  closed.context.is_instructional = false;
  closed.context.label = "School holiday";
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: closed });
  const { runner } = runnerFor(behavior, routine);
  let executions = 0;
  runner.execute = async () => { executions += 1; return null; };

  await runner.tick(new Date("2026-10-16T03:40:00.000Z"));
  assert.equal(executions, 0);
});

test("an offered synthetic invigilator accepts through the real response command during school hours", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const assignment = { id: "assignment-1", user_id: "staff-1", username: "manish.tiwari", name: "Manish Tiwari", status: "offered", revision: 3 };
  const actorCalls = [];
  const actorRequestCalls = [];
  const admin = {
    async request(path) {
      if (path.endsWith("/assessments/workspace/")) return { assessments: [{ id: "assessment-1", status: "draft", assessment_kind: "exam" }] };
      if (path.endsWith("/assessments/assessment-1/")) return { exam_operation: { sitting: { state: "planning" }, invigilators: [assignment] } };
      throw new Error(`Unexpected admin request: ${path}`);
    },
  };
  const actorSession = async (identity) => {
    actorCalls.push(identity);
    return {
      async request(path, options) {
        actorRequestCalls.push({ path, options });
        if (path === "/api/v1/requests/?portal=teacher") return { items: [{ kind: "assessment_invigilation", source_id: "assignment-1" }] };
        if (path.endsWith("/assessments/assessment-1/")) return { exam_operation: { viewer_assignment: assignment } };
        if (path.endsWith("/sitting/invigilators/assignment-1/response/")) return { ...assignment, status: "accepted", revision: 4 };
        throw new Error(`Unexpected actor request: ${path}`);
      },
    };
  };
  const activity = [];
  const runner = new DevelopmentActionRunner({
    sessions: { admin },
    setup: { school: { id: "school-1" } },
    behavior: { ...behavior, actions: [] },
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    actorSession,
    onActivity: (item) => activity.push(item),
  });

  await runner.tick(new Date("2026-10-16T03:30:00.000Z"));
  assert.equal(actorCalls.length, 0);
  await runner.tick(new Date("2026-10-16T03:30:10.000Z"));

  assert.deepEqual(actorCalls, [{ username: "manish.tiwari", userId: "staff-1", schoolId: "school-1" }]);
  assert.deepEqual(actorRequestCalls.at(-1), {
    path: "/api/v1/schools/school-1/assessments/assessment-1/sitting/invigilators/assignment-1/response/",
    options: {
      method: "POST",
      body: {
        command_id: deterministicUuid("school-1:accept-exam-invigilation:assignment-1:3:accepted"),
        expected_revision: 3,
        decision: "accepted",
        note: "Accepted by the local Cambridge development fixture.",
      },
    },
  });
  assert.equal(activity.at(-1)?.kind, "assessment");
  assert.equal(activity.at(-1)?.state, "recorded");
  assert.equal(activity.at(-1)?.evidence_scope, "domain_record_only");
  assert.equal(activity.at(-1)?.spatial_evidence, false);
});

test("does not inspect or answer exam offers outside the effective school day", async () => {
  const behavior = await wallClockBehavior();
  const closed = timetable("2026-10-16");
  closed.context.is_instructional = false;
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: closed });
  let requests = 0;
  const runner = new DevelopmentActionRunner({
    sessions: { admin: { request: async () => { requests += 1; return {}; } } },
    setup: { school: { id: "school-1" } },
    behavior: { ...behavior, actions: [] },
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    actorSession: async () => { throw new Error("Actor session must not be created."); },
    onActivity: () => undefined,
  });

  await runner.tick(new Date("2026-10-16T03:30:10.000Z"));
  assert.equal(requests, 0);
});
