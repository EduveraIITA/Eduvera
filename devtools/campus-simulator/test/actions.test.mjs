import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentActionRunner, deterministicUuid } from "../src/actions.mjs";
import { createRoutineSchedule, loadBehaviorFixture } from "../src/model.mjs";

const legacyOffsets = new Map([
  ["teacher-attendance", 600],
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

test("the assigned teacher submits the same scheduled subject register shown to operators", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const action = behavior.actions.find((item) => item.id === "teacher-attendance");
  const adminCalls = [];
  const actorCalls = [];
  const actorRequestCalls = [];
  const student = { id: "11111111-1111-4111-8111-111111111111", status: null };
  const admin = {
    async request(path) {
      adminCalls.push(path);
      if (adminCalls.length > 1) return {
        mode: "scheduled_session",
        registers: [{
          session_id: "22222222-2222-4222-8222-222222222222",
          submission_status: "submitted",
          marked_count: 1,
          student_count: 1,
        }],
      };
      return {
        mode: "scheduled_session",
        registers: [{
          attendance_scope: "scheduled_session",
          session_id: "22222222-2222-4222-8222-222222222222",
          schedule_slot_id: "period-2026-10-16",
          scheduled_teacher_id: "33333333-3333-4333-8333-333333333333",
          scheduled_teacher_username: "priya.iyer",
          assigned_teachers: ["Priya Iyer"],
          period_number: 1,
          submission_status: "not_started",
          can_mark: true,
        }],
      };
    },
  };
  const actorSession = async (identity) => {
    actorCalls.push(identity);
    return {
      async request(path, options) {
        actorRequestCalls.push({ path, options });
        if (!options) return {
          availability: { can_mark: true },
          class: { id: "class-6a", name: "Class 6A" },
          session: { subject_name: "English" },
          register: { state: "draft", revision: 0, finalization_source: null },
          roster: [student],
        };
        return { register: { state: "submitted", revision: 1 } };
      },
    };
  };
  const runner = new DevelopmentActionRunner({
    sessions: { admin },
    setup: { school: { id: "school-1" } },
    behavior,
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    actorSession,
    onActivity: () => undefined,
  });

  const result = await runner.execute(action);

  assert.deepEqual(adminCalls, [
    "/api/v1/attendance-model/workspace?date=2026-10-16",
    "/api/v1/attendance-model/workspace?date=2026-10-16",
  ]);
  assert.deepEqual(actorCalls, [{ username: "priya.iyer", userId: "33333333-3333-4333-8333-333333333333", schoolId: "school-1" }]);
  assert.deepEqual(actorRequestCalls.at(-1), {
    path: "/api/v1/attendance-model/sessions/22222222-2222-4222-8222-222222222222/submit",
    options: {
      method: "POST",
      headers: { "idempotency-key": "campus-lab-session-2026-10-16-22222222-2222-4222-8222-222222222222" },
      body: {
        expected_revision: 0,
        reason: "Development-only Cambridge fixture rehearsal.",
        records: [{ student_id: student.id, status: "present", remarks: "" }],
      },
    },
  });
  assert.equal(result.title, "Priya Iyer submitted Class 6A · English attendance");
  assert.equal(result.target_path, "/principal/attendance?session_id=22222222-2222-4222-8222-222222222222&date=2026-10-16");
});

test("attendance rehearsal follows daily-class and disabled operating-rule modes", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const action = behavior.actions.find((item) => item.id === "teacher-attendance");
  const dailyCalls = [];
  let dailySubmitted = false;
  const dailyRunner = new DevelopmentActionRunner({
    sessions: {
      admin: { request: async () => ({ mode: "daily_class", registers: [] }) },
      staff: { request: async (path, options) => {
        dailyCalls.push({ path, options });
        if (path.includes("/home/")) return { classes: [{ class_section_id: "class-6a", submission_status: "not_started", can_mark: true }] };
        if (path.includes("/attendance/?")) return {
          availability: { can_mark: true },
          class: { id: "class-6a", name: "Class 6A" },
          register: { state: dailySubmitted ? "submitted" : "draft", revision: dailySubmitted ? 1 : 0, finalization_source: null },
          roster: [{ id: "11111111-1111-4111-8111-111111111111", status: dailySubmitted ? "present" : null }],
        };
        dailySubmitted = true;
        return { register: { state: "submitted" } };
      } },
    },
    setup: { school: { id: "school-1" } },
    behavior,
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    onActivity: () => undefined,
  });
  const dailyResult = await dailyRunner.execute(action);
  assert.equal(dailyCalls.some((call) => call.path === "/api/v1/teacher/attendance/bulk/"), true);
  assert.match(dailyCalls.at(-1).path, /screens\/teacher\/attendance/);
  assert.match(dailyResult.title, /daily attendance/);

  const disabledRunner = new DevelopmentActionRunner({
    sessions: { admin: { request: async () => ({ mode: "none", registers: [] }) } },
    setup: { school: { id: "school-1" } },
    behavior,
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    onActivity: () => undefined,
  });
  const disabledResult = await disabledRunner.execute(action);
  assert.equal(disabledResult.state, "expected");
  assert.match(disabledResult.title, /skipped by configuration/i);
});

test("a simulated teacher message is visible in the normal conversation timeline before success", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const action = behavior.actions.find((item) => item.id === "staff-guardian-message");
  const body = "Development rehearsal: today's Cambridge class update is ready for Demo Guardian.";
  const staff = { async request(path, options) {
    if (path === "/api/v1/chat/recipients/") return { results: [{ id: "guardian-1", role: "parent", student_id: "student-1", name: "Demo Guardian" }] };
    if (path === "/api/v1/chat/conversations/" && options?.method === "POST") return { id: "conversation-1" };
    if (path.endsWith("/messages/") && options?.method === "POST") return { id: "message-1" };
    if (path.endsWith("/messages/") && !options) return { results: [{ id: "message-1", body, is_mine: true }] };
    throw new Error(`Unexpected request: ${path}`);
  } };
  const runner = new DevelopmentActionRunner({
    sessions: { staff }, setup: { school: { id: "school-1" } }, behavior,
    startedAt: new Date("2026-10-16T00:00:00.000Z"), routine, onActivity: () => undefined,
  });

  const result = await runner.execute(action);
  assert.equal(result.kind, "message");
  assert.equal(result.state, "recorded");
});

test("notice publish and family acknowledgement converge in the principal workspace", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const publish = behavior.actions.find((item) => item.id === "publish-acknowledgement");
  const acknowledge = behavior.actions.find((item) => item.id === "guardian-acknowledgement");
  let responded = false;
  const admin = { async request(path, options) {
    if (path === "/api/v1/notices" && options?.method === "POST") return { id: "notice-1", revision: 0, status: "draft" };
    if (path === "/api/v1/notices/notice-1/publish") return { id: "notice-1", revision: 1, status: "published", recipient_count: 3 };
    if (path === "/api/v1/notices/notice-1?portal=principal") return {
      id: "notice-1", status: "published", metrics: { recipients: 3, responded: responded ? 1 : 0 },
      recipients: responded ? [{ id: "recipient-1", responded_at: "2026-10-16T04:00:00.000Z" }] : [],
    };
    throw new Error(`Unexpected admin request: ${path}`);
  } };
  const parent = { async request(path, options) {
    if (path === "/api/v1/notices?portal=parent") return { results: [{
      id: "notice-1", title: "Development rehearsal · Campus update · 2026-10-16", student_id: "student-1",
      recipient_id: "recipient-1", responded_at: responded ? "2026-10-16T04:00:00.000Z" : null,
    }] };
    if (path === "/api/v1/notices/notice-1/open") return { revision: 1 };
    if (path === "/api/v1/notices/notice-1/respond") {
      responded = true;
      return { recipient_id: "recipient-1", recipient_revision: 2 };
    }
    throw new Error(`Unexpected parent request: ${path}`);
  } };
  const runner = new DevelopmentActionRunner({
    sessions: { admin, parent }, setup: { school: { id: "school-1" } }, behavior,
    startedAt: new Date("2026-10-16T00:00:00.000Z"), routine, onActivity: () => undefined,
  });

  const published = await runner.execute(publish);
  const acknowledged = await runner.execute(acknowledge);
  const repeated = await runner.execute(acknowledge);
  assert.equal(published.kind, "notice");
  assert.equal(acknowledged.kind, "notice");
  assert.equal(repeated.state, "expected");
  assert.match(repeated.title, /already recorded/);
  assert.equal(responded, true);
});

test("an offered synthetic invigilator accepts through the real response command during school hours", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const assignment = { id: "assignment-1", user_id: "staff-1", username: "manish.tiwari", name: "Manish Tiwari", status: "offered", revision: 3 };
  let accepted = false;
  const actorCalls = [];
  const actorRequestCalls = [];
  const admin = {
    async request(path) {
      if (path.endsWith("/assessments/workspace/")) return { assessments: [{ id: "assessment-1", status: "draft", assessment_kind: "exam" }] };
      if (path.endsWith("/assessments/assessment-1/")) return {
        exam_operation: {
          sitting: { state: "planning" },
          invigilators: [{ ...assignment, status: accepted ? "accepted" : "offered", revision: accepted ? 4 : 3 }],
        },
      };
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
        if (path.endsWith("/sitting/invigilators/assignment-1/response/")) {
          accepted = true;
          return { ...assignment, status: "accepted", revision: 4 };
        }
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

test("a stale invigilation offer is reported once and does not block a later valid offer", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: new Date("2026-10-16T00:00:00.000Z"), behavior, timetable: timetable("2026-10-16") });
  const reaction = { ...behavior.reactions[0], delay_seconds: 0 };
  const stale = { id: "stale-assignment", user_id: "staff-1", username: "stale.staff", name: "Stale Staff", status: "offered", revision: 1 };
  const valid = { id: "valid-assignment", user_id: "staff-2", username: "valid.staff", name: "Valid Staff", status: "offered", revision: 2 };
  let validAccepted = false;
  const admin = {
    async request(path) {
      if (path.endsWith("/assessments/workspace/")) return { assessments: [
        { id: "stale-exam", status: "draft", assessment_kind: "exam" },
        { id: "valid-exam", status: "draft", assessment_kind: "exam" },
      ] };
      if (path.endsWith("/assessments/stale-exam/")) return { exam_operation: { sitting: { state: "planning" }, invigilators: [stale] } };
      if (path.endsWith("/assessments/valid-exam/")) return { exam_operation: {
        sitting: { state: "planning" },
        invigilators: [{ ...valid, status: validAccepted ? "accepted" : "offered", revision: validAccepted ? 3 : 2 }],
      } };
      throw new Error(`Unexpected admin request: ${path}`);
    },
  };
  const actorSession = async ({ username }) => ({
    async request(path, options) {
      const assignment = username === "stale.staff" ? stale : valid;
      if (path === "/api/v1/requests/?portal=teacher") return { items: [{ kind: "assessment_invigilation", source_id: assignment.id }] };
      if (!options && path.includes("/assessments/")) return { exam_operation: { viewer_assignment: assignment } };
      if (assignment.id === stale.id) {
        const error = new Error("This invigilation Offer is not connected to current coordination evidence.");
        error.status = 409;
        throw error;
      }
      validAccepted = true;
      return { ...valid, status: "accepted", revision: 3 };
    },
  });
  const activity = [];
  const runner = new DevelopmentActionRunner({
    sessions: { admin },
    setup: { school: { id: "school-1" } },
    behavior: { ...behavior, actions: [], reactions: [reaction] },
    startedAt: new Date("2026-10-16T00:00:00.000Z"),
    routine,
    actorSession,
    onActivity: (item) => activity.push(item),
  });

  const result = await runner.staffAcceptExamInvigilation(reaction, new Date("2026-10-16T03:30:10.000Z"));

  assert.equal(validAccepted, true);
  assert.match(activity[0]?.title ?? "", /Stale Staff.*needs reissue/);
  assert.equal(activity[0]?.state, "issue");
  assert.match(result?.title ?? "", /Valid Staff accepted/);
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
