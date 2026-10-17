import assert from "node:assert/strict";
import test from "node:test";
import {
  actionDueAt,
  buildStatusSnapshot,
  createRoutineSchedule,
  loadBehaviorFixture,
  phaseAt,
  simulatedAt,
} from "../src/model.mjs";

const processStartedAt = new Date("2026-10-16T00:00:00.000Z");

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

function slot(id, classId, period, startsAt, endsAt, type = "class", extra = {}) {
  return {
    id,
    weekday: 5,
    period_number: period,
    starts_at: startsAt,
    ends_at: endsAt,
    slot_type: type,
    class_section_id: classId,
    class_name: classId === "class-6a" ? "Class 6A" : "Class 6B",
    ...extra,
  };
}

function effectiveSlots() {
  const windows = [
    [1, "09:00", "09:45", "class"],
    [2, "09:50", "10:35", "class"],
    [3, "10:40", "11:25", "class"],
    [4, "11:30", "12:05", "break"],
    [5, "12:15", "13:00", "class"],
    [6, "13:05", "13:50", "class"],
  ];
  return windows.flatMap(([period, startsAt, endsAt, type]) => [
    slot(`slot-a-${period}`, "class-6a", period, startsAt, endsAt, type, {
      display_title: type === "break" ? "Lunch Break" : `Class 6A subject ${period}`,
      teacher_name: type === "break" ? null : "Kavita Mehta",
    }),
    slot(`slot-b-${period}`, "class-6b", period, startsAt, endsAt, type, {
      display_title: type === "break" ? "Lunch Break" : `Class 6B subject ${period}`,
      teacher_name: type === "break" ? null : "Arjun Sen",
    }),
  ]);
}

function schoolDay({ date = "2026-10-16", isInstructional = null, label = null, schedule = effectiveSlots() } = {}) {
  return {
    school_date: date,
    context: {
      today: date,
      local_time: "09:00",
      timezone: "Asia/Kolkata",
      is_instructional: isInstructional,
      label,
    },
    schedule,
    classes: [
      { id: "class-6a", name: "Class 6A" },
      { id: "class-6b", name: "Class 6B" },
    ],
    subjects: [],
  };
}

test("replays the real published Cambridge day through one configured one-hour clock", async () => {
  const behavior = await loadBehaviorFixture();
  const startedAt = new Date("2026-10-16T10:00:00.000Z");
  const routine = createRoutineSchedule({ startedAt, now: startedAt, behavior, timetable: schoolDay() });

  assert.equal(routine.source, "effective_school_schedule");
  assert.equal(routine.clock.mode, "compressed_school_day");
  assert.equal(routine.clock.duration_seconds, 3600);
  assert.equal(routine.clock.started_at, "2026-10-16T10:00:00.000Z");
  assert.equal(routine.clock.ends_at, "2026-10-16T11:00:00.000Z");
  assert.equal(phaseAt(startedAt, routine).period_number, 1);
  assert.equal(simulatedAt(new Date("2026-10-16T10:06:00.000Z"), routine), "2026-10-16T09:29:00+05:30");
  assert.equal(phaseAt(new Date("2026-10-16T10:12:00.000Z"), routine).period_number, 2);
  assert.equal(phaseAt(new Date("2026-10-16T11:00:00.000Z"), routine).id, "after-school-hours");

  const attendance = behavior.actions.find((action) => action.id === "teacher-daily-attendance");
  const dueAt = new Date(actionDueAt(attendance, routine)).getTime();
  assert.ok(dueAt > startedAt.getTime());
  assert.ok(dueAt < new Date(routine.phases[0].wall_ends_at).getTime());
});

test("uses the real school-local window and never translates it to process start", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior, timetable: schoolDay() });

  assert.equal(routine.reference_weekday, 5);
  assert.equal(routine.reference_date, "2026-10-16");
  assert.equal(routine.source, "effective_school_schedule");
  assert.equal(routine.day_start_seconds, 9 * 3_600);
  assert.equal(routine.day_end_seconds, 13 * 3_600 + 50 * 60);

  const before = phaseAt(new Date("2026-10-16T03:29:59.000Z"), routine);
  assert.equal(before.mode, "closed");
  assert.equal(before.id, "before-school-hours");
  assert.equal(before.next_change_at, "2026-10-16T03:30:00.000Z");

  const firstLesson = phaseAt(new Date("2026-10-16T03:30:00.000Z"), routine);
  assert.equal(firstLesson.mode, "lesson");
  assert.equal(firstLesson.period_number, 1);
  assert.deepEqual(firstLesson.active_slot_ids.sort(), ["slot-a-1", "slot-b-1"]);
  assert.equal(firstLesson.school_starts_at, "09:00:00");
  assert.equal(firstLesson.school_ends_at, "09:45:00");

  const change = phaseAt(new Date("2026-10-16T04:16:00.000Z"), routine);
  assert.equal(change.mode, "transition");
  assert.equal(change.school_starts_at, "09:45:00");
  assert.equal(change.school_ends_at, "09:50:00");

  const lunch = phaseAt(new Date("2026-10-16T06:00:00.000Z"), routine);
  assert.equal(lunch.mode, "break");
  assert.equal(lunch.period_number, 4);
  assert.deepEqual(lunch.active_slot_ids.sort(), ["slot-a-4", "slot-b-4"]);

  const after = phaseAt(new Date("2026-10-16T08:20:00.000Z"), routine);
  assert.equal(after.mode, "closed");
  assert.equal(after.id, "after-school-hours");
  assert.equal(after.next_change_at, null);
});

test("reports actual campus-local time and phase-relative action windows", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior, timetable: schoolDay() });

  assert.equal(simulatedAt(new Date("2026-10-16T03:30:00.000Z"), routine), "2026-10-16T09:00:00+05:30");
  assert.equal(simulatedAt(new Date("2026-10-16T10:00:00.000Z"), routine), "2026-10-16T15:30:00+05:30");

  const attendance = behavior.actions.find((action) => action.id === "teacher-daily-attendance");
  const notice = behavior.actions.find((action) => action.id === "publish-acknowledgement");
  const invigilation = behavior.reactions.find((reaction) => reaction.id === "accept-exam-invigilation");
  assert.equal(behavior.version, "cambridge.behavior.v5");
  assert.equal(invigilation.event_type, "assessment.invigilation.offered");
  assert.equal(invigilation.decision, "accepted");
  assert.equal(actionDueAt(attendance, routine), "2026-10-16T03:40:00.000Z");
  assert.equal(actionDueAt(notice, routine), "2026-10-16T06:05:00.000Z");
  assert.equal(actionDueAt({ ...attendance, offset_seconds: 45 * 60 }, routine), null);
});

test("projects scheduled people only while the effective school day is open", async () => {
  const behavior = await wallClockBehavior();
  const timetable = schoolDay();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior, timetable });
  const setup = {
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    spaces: [
      { id: "room-201", name: "Classroom 201", kind: "classroom", status: "active" },
      { id: "room-202", name: "Classroom 202", kind: "classroom", status: "active" },
      { id: "office", code: "PRINCIPAL-OFFICE", name: "Principal's Office", kind: "office", status: "active" },
    ],
    classes: [
      { id: "class-6a", grade: "6", section: "A", home_space_id: "room-201" },
      { id: "class-6b", grade: "6", section: "B", home_space_id: "room-202" },
    ],
    staff: [
      { id: "staff-kavita", first_name: "Kavita", last_name: "Mehta" },
      { id: "staff-arjun", first_name: "Arjun", last_name: "Sen" },
      { id: "staff-unscheduled", first_name: "Nina", last_name: "Rao" },
    ],
  };
  const students = [
    { id: "student-a", name: "Aarav Sharma", class_section_id: "class-6a", class_name: "Class 6A", avatar_url: "/aarav.png" },
    { id: "student-b", name: "Aisha Sinha", class_section_id: "class-6b", class_name: "Class 6B", avatar_url: "/aisha.png" },
  ];
  const common = {
    startedAt: processStartedAt,
    behavior,
    routine,
    setup,
    timetable,
    students,
    adminUser: { id: "admin-1", display_name: "Meera Kapoor" },
  };

  const open = buildStatusSnapshot({ ...common, now: new Date("2026-10-16T03:30:00.000Z") });
  assert.equal(open.status, "running");
  assert.deepEqual(open.summary, { actors: 6, students: 2, staff: 4, zones: 3, unplaced: 1 });
  assert.equal(open.phase.mode, "lesson");
  assert.equal(open.schedule.source, "effective_school_schedule");
  const room201 = open.zones.find((zone) => zone.space_id === "room-201");
  assert.ok(room201.actors.some((person) => person.name === "Aarav Sharma"));
  assert.ok(room201.actors.some((person) => person.name === "Kavita Mehta"));
  const administrator = open.zones.find((zone) => zone.space_id === "office").actors.find((person) => person.role === "admin");
  assert.equal(administrator.activity, "Coordinating campus operations");
  assert.equal(administrator.source, "cambridge_development_routine");
  assert.equal(administrator.source_version, "cambridge.behavior.v5");
  assert.equal(administrator.valid_from, "2026-10-16T03:30:00.000Z");
  assert.equal(administrator.valid_until, "2026-10-16T04:15:00.000Z");
  assert.equal(open.unplaced[0].name, "Nina Rao");
  const phaseReceipt = open.activity.find((item) => item.id.startsWith("phase:"));
  assert.equal(phaseReceipt.title, "Period 1 started · simulated");
  assert.equal(phaseReceipt.state, "expected");
  assert.equal(phaseReceipt.evidence_scope, "planned_rehearsal_only");
  assert.equal(phaseReceipt.spatial_evidence, false);
  assert.match(phaseReceipt.detail, /not a gate check-in, sensor observation or physical room-presence claim/i);
  const lessonReceipt = open.activity.find((item) => item.id.startsWith("movement:"));
  assert.match(lessonReceipt.title, /started Class 6A subject 1 · simulated/);
  assert.match(lessonReceipt.detail, /Kavita Mehta is expected/);

  const before = buildStatusSnapshot({ ...common, now: new Date("2026-10-16T03:29:59.000Z") });
  assert.equal(before.status, "paused");
  assert.equal(before.phase.id, "before-school-hours");
  assert.equal(before.summary.actors, 0);
  assert.deepEqual(before.activity, []);

  const closed = buildStatusSnapshot({ ...common, now: new Date("2026-10-16T08:20:00.000Z") });
  assert.equal(closed.status, "paused");
  assert.equal(closed.phase.id, "after-school-hours");
  assert.equal(closed.summary.actors, 0);
  assert.equal(closed.summary.unplaced, 0);
  assert.equal(closed.zones.flatMap((zone) => zone.actors).length, 0);
  assert.deepEqual(closed.unplaced, []);
  assert.deepEqual(closed.activity, []);
});

test("places configured non-teaching staff only as expected simulation state", async () => {
  const behavior = await wallClockBehavior();
  const timetable = schoolDay();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior, timetable });
  const setup = {
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    spaces: [
      { id: "room-201", code: "ROOM-201", name: "Classroom 201", kind: "classroom", status: "active" },
      { id: "main-gate", code: "MAIN-GATE", name: "Main gate", kind: "gate", status: "active" },
    ],
    classes: [{ id: "class-6a", grade: "6", section: "A", home_space_id: "room-201" }],
    staff: [{ id: "security-1", first_name: "Rakesh", last_name: "Kumar", designation: "Security Supervisor" }],
  };

  const open = buildStatusSnapshot({
    now: new Date("2026-10-16T03:30:00.000Z"),
    startedAt: processStartedAt,
    behavior,
    routine,
    setup,
    timetable,
  });
  const gate = open.zones.find((zone) => zone.space_id === "main-gate");
  assert.equal(gate.activity, "Covering the scheduled main-gate duty");
  assert.deepEqual(gate.actors[0], {
    id: "staff:security-1",
    name: "Rakesh Kumar",
    role: "staff",
    activity: "Covering the scheduled main-gate duty",
    class_name: "Security Supervisor",
    state: "expected",
    basis: "expected_from_fixture",
    source: "cambridge_development_routine",
    source_label: "Cambridge development fixture v5",
    source_version: "cambridge.behavior.v5",
    valid_from: "2026-10-16T03:30:00.000Z",
    valid_until: "2026-10-16T04:15:00.000Z",
    generated_at: "2026-10-16T03:30:00.000Z",
  });
  assert.equal(gate.source, "cambridge_development_routine");
  assert.equal(gate.source_version, "cambridge.behavior.v5");
  assert.equal(gate.valid_from, "2026-10-16T03:30:00.000Z");
  assert.equal(gate.valid_until, "2026-10-16T04:15:00.000Z");
  assert.equal(open.activity.some((item) => item.state !== "expected"), false);
});

test("does not guess a duty location from a staff home space when fixture configuration is missing", async () => {
  const behavior = await wallClockBehavior();
  const configured = structuredClone(behavior);
  configured.staff_expectations.find((item) => item.designation === "Security Supervisor").space_code = "MISSING-GATE";
  const timetable = schoolDay();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior: configured, timetable });
  const setup = {
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    spaces: [
      { id: "room-201", code: "ROOM-201", name: "Classroom 201", kind: "classroom", status: "active" },
      { id: "office", code: "SCHOOL-OFFICE", name: "School Office", kind: "office", status: "active" },
    ],
    classes: [{ id: "class-6a", grade: "6", section: "A", home_space_id: "room-201" }],
    staff: [{
      id: "security-1",
      first_name: "Rakesh",
      last_name: "Kumar",
      designation: "Security Supervisor",
      home_space_id: "office",
    }],
  };

  const open = buildStatusSnapshot({
    now: new Date("2026-10-16T03:30:00.000Z"),
    startedAt: processStartedAt,
    behavior: configured,
    routine,
    setup,
    timetable,
  });

  assert.equal(open.zones.find((zone) => zone.space_id === "office").actors.length, 0);
  assert.equal(open.unplaced.length, 1);
  assert.equal(open.unplaced[0].name, "Rakesh Kumar");
  assert.match(open.unplaced[0].unplaced_reason, /MISSING-GATE/);
});

test("keeps the demo administrator unplaced when its configured duty space is missing", async () => {
  const behavior = await wallClockBehavior();
  const timetable = schoolDay();
  const routine = createRoutineSchedule({ now: processStartedAt, behavior, timetable });
  const setup = {
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    spaces: [{ id: "office", code: "SCHOOL-OFFICE", name: "School Office", kind: "office", status: "active" }],
    classes: [],
    staff: [],
  };

  const open = buildStatusSnapshot({
    now: new Date("2026-10-16T03:30:00.000Z"),
    startedAt: processStartedAt,
    behavior,
    routine,
    setup,
    timetable,
    adminUser: { id: "admin-1", display_name: "Meera Kapoor" },
  });

  assert.equal(open.zones[0].actors.length, 0);
  assert.equal(open.unplaced.length, 1);
  assert.equal(open.unplaced[0].name, "Meera Kapoor");
  assert.match(open.unplaced[0].unplaced_reason, /PRINCIPAL-OFFICE/);
  assert.equal(open.unplaced[0].source, "cambridge_development_routine");
  assert.equal(open.unplaced[0].valid_until, "2026-10-16T04:15:00.000Z");
});

test("calendar closures override any supplied slots", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({
    now: new Date("2026-10-02T04:00:00.000Z"),
    behavior,
    timetable: schoolDay({ date: "2026-10-02", isInstructional: false, label: "Gandhi Jayanti" }),
  });
  assert.equal(routine.is_operating_day, false);
  assert.equal(routine.slots.length, 0);
  const phase = phaseAt(new Date("2026-10-02T04:00:00.000Z"), routine);
  assert.equal(phase.id, "non-instructional-day");
  assert.equal(phase.label, "Gandhi Jayanti");
});

test("does not open the simulator when every effective slot is cancelled", async () => {
  const behavior = await wallClockBehavior();
  const cancelled = effectiveSlots().map((item) => ({ ...item, cancelled: true }));
  const routine = createRoutineSchedule({
    now: new Date("2026-10-16T04:00:00.000Z"),
    behavior,
    timetable: schoolDay({ schedule: cancelled }),
  });
  assert.equal(routine.is_operating_day, false);
  assert.equal(routine.slots.length, 0);
  assert.equal(phaseAt(new Date("2026-10-16T04:00:00.000Z"), routine).mode, "closed");
});

test("does not borrow a future weekday when today has no effective schedule", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({
    now: new Date("2026-10-18T04:00:00.000Z"),
    behavior,
    timetable: {
      school_date: "2026-10-18",
      context: { today: "2026-10-18", timezone: "Asia/Kolkata", is_instructional: null, label: null },
      slots: effectiveSlots(),
    },
  });
  assert.equal(routine.reference_weekday, 7);
  assert.equal(routine.is_operating_day, false);
  assert.equal(phaseAt(new Date("2026-10-18T04:00:00.000Z"), routine).id, "no-school-schedule");
});

test("runs a configured Saturday because school days come from the effective schedule", async () => {
  const behavior = await wallClockBehavior();
  const routine = createRoutineSchedule({
    now: new Date("2026-10-17T03:30:00.000Z"),
    behavior,
    timetable: schoolDay({ date: "2026-10-17" }),
  });
  assert.equal(routine.reference_weekday, 6);
  assert.equal(routine.is_operating_day, true);
  assert.equal(phaseAt(new Date("2026-10-17T03:30:00.000Z"), routine).mode, "lesson");
});
