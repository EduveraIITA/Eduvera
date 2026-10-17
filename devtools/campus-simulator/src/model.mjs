import { readFile } from "node:fs/promises";

const FIXTURE_URL = new URL("../fixtures/cambridge.behavior.v1.json", import.meta.url);

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number.`);
  return number;
}

export function validateBehaviorFixture(input) {
  if (!input || input.schema_version !== 6 || input.version !== "cambridge.behavior.v6") {
    throw new Error("Unsupported Cambridge behavior fixture version.");
  }
  if (input.school_code !== "cis" || input.timezone !== "Asia/Kolkata") {
    throw new Error("The behavior fixture must target the Cambridge 'cis' school in Asia/Kolkata.");
  }
  if (input.clock?.mode !== "compressed_school_day"
    || !Number.isInteger(input.clock?.duration_seconds)
    || input.clock.duration_seconds < 60
    || input.clock.duration_seconds > 3_600
    || typeof input.clock?.label !== "string"
    || input.clock.label.trim().length < 3) {
    throw new Error("The Cambridge fixture must configure a labelled 1-60 minute compressed school day.");
  }
  const ratios = input.attendance_ratios ?? {};
  const ratioTotal = ["present", "late", "absent", "excused"].reduce((sum, key) => sum + Number(ratios[key] ?? 0), 0);
  if (Math.abs(ratioTotal - 1) > 0.00001) throw new Error("Attendance ratios must total exactly 1.");
  if (!Array.isArray(input.actions)) throw new Error("Behavior actions must be an array.");
  const actionIds = new Set();
  for (const action of input.actions) {
    if (!action?.id || actionIds.has(action.id) || !action?.type
      || !Number.isFinite(Number(action.offset_ratio))
      || Number(action.offset_ratio) < 0
      || Number(action.offset_ratio) >= 1) {
      throw new Error("Every behavior action needs a unique id, type and a phase offset ratio from 0 up to 1.");
    }
    actionIds.add(action.id);
    if (!["lesson", "break", "activity"].includes(action.phase_mode)) {
      throw new Error(`Unsupported action phase mode for ${action.id}.`);
    }
    const selectsEachLesson = action.period_selector === "each_lesson";
    if (selectsEachLesson && (action.type !== "teacher_submit_attendance" || action.phase_mode !== "lesson")) {
      throw new Error(`${action.id} may use each_lesson only for lesson attendance.`);
    }
    if (!selectsEachLesson && (!Number.isInteger(action.period_number) || action.period_number < 1)) {
      throw new Error(`${action.id} must select a positive published period number or each_lesson.`);
    }
  }
  if (!Array.isArray(input.reactions)) throw new Error("Behavior reactions must be an array.");
  const reactionIds = new Set();
  for (const reaction of input.reactions) {
    if (!reaction?.id || reactionIds.has(reaction.id) || reaction.type !== "staff_accept_exam_invigilation") {
      throw new Error("Every behavior reaction needs a unique id and supported type.");
    }
    reactionIds.add(reaction.id);
    if (reaction.event_type !== "assessment.invigilation.offered") {
      throw new Error(`${reaction.id} must name its typed assessment offer event.`);
    }
    if (reaction.decision !== "accepted" || Number(reaction.delay_seconds) < 0) {
      throw new Error(`${reaction.id} must configure a non-negative bounded acceptance reaction.`);
    }
    if (!Number.isInteger(reaction.scan_limit) || reaction.scan_limit < 1 || reaction.scan_limit > 100) {
      throw new Error(`${reaction.id} must configure a bounded assessment scan limit.`);
    }
    if (typeof reaction.note !== "string" || reaction.note.trim().length < 3) {
      throw new Error(`${reaction.id} must include an auditable response note.`);
    }
  }
  const receiptModes = input.phase_receipts?.include_modes;
  if (!Array.isArray(receiptModes) || !receiptModes.length || receiptModes.some((mode) => !["lesson", "break", "activity", "transition"].includes(mode))) {
    throw new Error("Phase receipts must declare at least one supported schedule mode.");
  }
  if (!Number.isInteger(input.phase_receipts?.history_limit) || input.phase_receipts.history_limit < 1 || input.phase_receipts.history_limit > 30) {
    throw new Error("Phase receipt history must be between 1 and 30 items.");
  }
  if (!Array.isArray(input.staff_expectations)) throw new Error("Staff expectations must be an array.");
  const expectedDesignations = new Set();
  for (const expectation of input.staff_expectations) {
    const designation = String(expectation?.designation ?? "").trim();
    const normalizedDesignation = normalizedName(designation);
    if (!designation || expectedDesignations.has(normalizedDesignation)) {
      throw new Error("Every staff expectation needs a unique designation.");
    }
    expectedDesignations.add(normalizedDesignation);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(String(expectation.space_code ?? ""))) {
      throw new Error(`${designation} needs a valid configured campus space code.`);
    }
    if (typeof expectation.activity !== "string" || expectation.activity.trim().length < 3) {
      throw new Error(`${designation} needs a readable expected activity.`);
    }
    if (!Array.isArray(expectation.phase_modes) || !expectation.phase_modes.length
      || expectation.phase_modes.some((mode) => !["lesson", "break", "activity", "transition"].includes(mode))) {
      throw new Error(`${designation} must declare supported school-day phases.`);
    }
  }
  const adminExpectation = input.admin_expectation;
  if (!adminExpectation || !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(String(adminExpectation.space_code ?? ""))) {
    throw new Error("The administrator expectation needs a valid configured campus space code.");
  }
  if (typeof adminExpectation.activity !== "string" || adminExpectation.activity.trim().length < 3) {
    throw new Error("The administrator expectation needs a readable expected activity.");
  }
  if (!Array.isArray(adminExpectation.phase_modes) || !adminExpectation.phase_modes.length
    || adminExpectation.phase_modes.some((mode) => !["lesson", "break", "activity", "transition"].includes(mode))) {
    throw new Error("The administrator expectation must declare supported school-day phases.");
  }
  positiveNumber(input.refresh_interval_seconds, "Refresh interval");
  positiveNumber(input.status_tick_seconds, "Status tick");
  positiveNumber(input.action_poll_seconds, "Action poll interval");
  positiveNumber(input.reaction_poll_seconds, "Reaction poll interval");
  return input;
}

export async function loadBehaviorFixture(url = FIXTURE_URL) {
  const parsed = JSON.parse(await readFile(url, "utf8"));
  return validateBehaviorFixture(parsed);
}

function dayNumber(date, timeZone) {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[short];
}

function dateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3_600 + minutes * 60 + seconds;
}

function formatTime(totalSeconds) {
  const value = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(value / 3_600) % 24;
  const minutes = Math.floor((value % 3_600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
}

function zonedParts(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
}

function instantInZone(date, totalSeconds, timeZone) {
  const [year, month, day] = String(date).split("-").map(Number);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const target = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), timeZone);
    const rendered = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const correction = target - rendered;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant);
}

function zonedIso(value, timeZone) {
  const date = new Date(value);
  const parts = zonedParts(date, timeZone);
  const rendered = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMinutes = Math.round((rendered - Math.floor(date.getTime() / 1_000) * 1_000) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function phaseCopy(phase) {
  return {
    id: phase.id,
    label: phase.label,
    description: phase.description,
    mode: phase.mode,
    period_number: phase.period_number,
    active_slot_ids: phase.active_slot_ids,
    school_starts_at: phase.school_starts_at,
    school_ends_at: phase.school_ends_at,
    started_at: phase.wall_starts_at,
    next_change_at: phase.wall_ends_at,
  };
}

function phaseDetails(mode, periodNumber, slots) {
  if (mode === "lesson") return {
    label: periodNumber ? `Period ${periodNumber}` : "Teaching period",
    description: "Classes and teachers follow the published timetable for this full teaching period.",
  };
  if (mode === "break") return {
    label: slots.find((slot) => slot.display_title || slot.title)?.display_title
      ?? slots.find((slot) => slot.title)?.title ?? "School break",
    description: "The published timetable has a break; no teaching activity is inferred during it.",
  };
  return {
    label: slots.find((slot) => slot.display_title || slot.title)?.display_title
      ?? slots.find((slot) => slot.title)?.title ?? "Scheduled activity",
    description: "The campus follows this published non-class timetable activity.",
  };
}

function closedPhase({ id, label, description, startedAt, nextChangeAt = null, schoolStartsAt = null, schoolEndsAt = null }) {
  return {
    id,
    label,
    description,
    mode: "closed",
    period_number: null,
    active_slot_ids: [],
    school_starts_at: schoolStartsAt,
    school_ends_at: schoolEndsAt,
    wall_starts_at: startedAt,
    wall_ends_at: nextChangeAt,
  };
}

export function createRoutineSchedule({ startedAt: startedAtValue, now: nowValue, behavior, timetable }) {
  const now = new Date(nowValue ?? startedAtValue ?? new Date());
  const context = timetable?.context ?? {};
  const timeZone = context.timezone || behavior.timezone;
  // `context.today` is the service's real wall-clock date. Accelerated runs ask
  // the same domain API for another effective date, which is retained as
  // `school_date`; that requested date must drive the rehearsal projection.
  const referenceDate = timetable?.school_date || context.today || dateInZone(now, timeZone);
  const referenceInstant = instantInZone(referenceDate, 12 * 3_600, timeZone);
  const referenceWeekday = dayNumber(referenceInstant, timeZone);
  const classes = new Map((timetable?.classes ?? []).map((item) => [String(item.id), item]));
  const subjects = new Map((timetable?.subjects ?? []).map((item) => [String(item.id), item]));
  const effectiveSchedule = Array.isArray(timetable?.schedule);
  const allSlots = effectiveSchedule ? timetable.schedule : (Array.isArray(timetable?.slots) ? timetable.slots : []);
  const slots = allSlots
    .filter((slot) => slot.cancelled !== true)
    .filter((slot) => effectiveSchedule || Number(slot.weekday) === referenceWeekday)
    .map((slot) => {
      const classItem = classes.get(String(slot.class_section_id));
      const subject = subjects.get(String(slot.subject_id));
      return {
        ...slot,
        class_name: slot.class_name || classItem?.name,
        subject_name: slot.subject_name || subject?.name,
        display_title: slot.display_title || slot.title || subject?.name,
        start_seconds: parseTime(slot.starts_at),
        end_seconds: parseTime(slot.ends_at),
      };
    })
    .filter((slot) => slot.start_seconds !== null && slot.end_seconds !== null && slot.end_seconds > slot.start_seconds)
    .sort((left, right) => left.start_seconds - right.start_seconds || left.end_seconds - right.end_seconds || String(left.id).localeCompare(String(right.id)));
  if (context.is_instructional === false || !slots.length) {
    const label = context.label || "No school today";
    const description = context.is_instructional === false
      ? `${label} is marked as a non-instructional day in the school calendar.`
      : "No effective published schedule is available for the current school-local date.";
    const closed = closedPhase({
      id: context.is_instructional === false ? "non-instructional-day" : "no-school-schedule",
      label,
      description,
      startedAt: instantInZone(referenceDate, 0, timeZone).toISOString(),
    });
    return {
      reference_weekday: referenceWeekday,
      reference_date: referenceDate,
      timezone: timeZone,
      source: "effective_school_schedule",
      is_operating_day: false,
      calendar_label: context.label ?? null,
      day_start_seconds: null,
      day_end_seconds: null,
      slots: [],
      phases: [],
      before_phase: closed,
      after_phase: closed,
      closed_phase: closed,
    };
  }

  const firstStart = Math.min(...slots.map((slot) => slot.start_seconds));
  const lastEnd = Math.max(...slots.map((slot) => slot.end_seconds));
  const compressed = behavior.clock?.mode === "compressed_school_day";
  const cycleStartedAt = new Date(startedAtValue ?? now);
  const cycleDurationMs = Number(behavior.clock?.duration_seconds ?? 0) * 1_000;
  const sourceDuration = lastEnd - firstStart;
  const wallInstant = (schoolSeconds) => compressed
    ? new Date(cycleStartedAt.getTime() + ((schoolSeconds - firstStart) / sourceDuration) * cycleDurationMs).toISOString()
    : instantInZone(referenceDate, schoolSeconds, timeZone).toISOString();
  const boundaries = [...new Set(slots.flatMap((slot) => [slot.start_seconds, slot.end_seconds]))].sort((a, b) => a - b);
  const planned = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const starts = boundaries[index];
    const ends = boundaries[index + 1];
    if (ends <= starts) continue;
    const active = slots.filter((slot) => slot.start_seconds < ends && slot.end_seconds > starts);
    if (!active.length) {
      planned.push({
        id: `transition-${formatTime(starts).replaceAll(":", "")}`,
        label: "Class change", description: "The published gap is kept as real transition time between activities.",
        mode: "transition", period_number: null, active_slot_ids: [], school_start_seconds: starts, school_end_seconds: ends,
      });
      continue;
    }
    const types = new Set(active.map((slot) => slot.slot_type));
    const mode = types.size === 1 && types.has("break") ? "break" : types.size === 1 && types.has("activity") ? "activity" : "lesson";
    const periodNumbers = [...new Set(active.map((slot) => Number(slot.period_number)).filter(Number.isFinite))];
    const periodNumber = periodNumbers.length === 1 ? periodNumbers[0] : null;
    const detail = phaseDetails(mode, periodNumber, active);
    planned.push({
      id: `${mode}-${periodNumber ?? "mixed"}-${formatTime(starts).replaceAll(":", "")}`,
      ...detail, mode, period_number: periodNumber, active_slot_ids: active.map((slot) => String(slot.id)),
      school_start_seconds: starts, school_end_seconds: ends,
    });
  }
  const phases = planned.map((phase) => ({
    ...phase,
    school_starts_at: formatTime(phase.school_start_seconds),
    school_ends_at: formatTime(phase.school_end_seconds),
    wall_starts_at: wallInstant(phase.school_start_seconds),
    wall_ends_at: wallInstant(phase.school_end_seconds),
  }));
  const beforePhase = closedPhase({
    id: "before-school-hours",
    label: "School day has not started",
    description: "The simulator is paused until the first effective timetable period begins.",
    startedAt: compressed ? cycleStartedAt.toISOString() : instantInZone(referenceDate, 0, timeZone).toISOString(),
    nextChangeAt: wallInstant(firstStart),
    schoolEndsAt: formatTime(firstStart),
  });
  const afterPhase = closedPhase({
    id: "after-school-hours",
    label: "School day complete",
    description: "The simulator is paused because the final effective timetable period has ended.",
    startedAt: wallInstant(lastEnd),
    schoolStartsAt: formatTime(lastEnd),
  });
  return {
    reference_weekday: referenceWeekday,
    reference_date: referenceDate,
    timezone: timeZone,
    source: "effective_school_schedule",
    clock: compressed ? {
      mode: "compressed_school_day",
      label: behavior.clock.label,
      duration_seconds: behavior.clock.duration_seconds,
      scale: sourceDuration / Number(behavior.clock.duration_seconds),
      started_at: cycleStartedAt.toISOString(),
      ends_at: new Date(cycleStartedAt.getTime() + cycleDurationMs).toISOString(),
    } : { mode: "wall_clock" },
    is_operating_day: true,
    calendar_label: context.label ?? null,
    day_start_seconds: firstStart,
    day_end_seconds: lastEnd,
    slots,
    phases,
    before_phase: beforePhase,
    after_phase: afterPhase,
    closed_phase: null,
  };
}

export function phaseAt(nowValue, routine) {
  const now = new Date(nowValue).getTime();
  if (!routine.is_operating_day || !routine.phases.length) return phaseCopy(routine.closed_phase ?? routine.after_phase);
  const firstStart = new Date(routine.phases[0].wall_starts_at).getTime();
  const lastEnd = new Date(routine.phases.at(-1).wall_ends_at).getTime();
  if (now < firstStart) return phaseCopy(routine.before_phase);
  if (now >= lastEnd) return phaseCopy(routine.after_phase);
  const phase = routine.phases.find((candidate) => (
    now >= new Date(candidate.wall_starts_at).getTime()
    && now < new Date(candidate.wall_ends_at).getTime()
  ));
  return phaseCopy(phase ?? routine.after_phase);
}

export function simulatedAt(nowValue, routine) {
  if (routine.clock?.mode === "compressed_school_day") {
    const startedAt = new Date(routine.clock.started_at).getTime();
    const elapsed = Math.min(
      Math.max(new Date(nowValue).getTime() - startedAt, 0),
      Number(routine.clock.duration_seconds) * 1_000,
    );
    const schoolSeconds = routine.day_start_seconds
      + (elapsed / (Number(routine.clock.duration_seconds) * 1_000)) * (routine.day_end_seconds - routine.day_start_seconds);
    return zonedIso(instantInZone(routine.reference_date, schoolSeconds, routine.timezone), routine.timezone);
  }
  return zonedIso(nowValue, routine.timezone);
}

export function actionDueAt(action, routine) {
  const phase = routine.phases.find((candidate) => candidate.mode === action.phase_mode && candidate.period_number === action.period_number);
  if (!phase || phase.wall_ends_at === null) return null;
  const duration = new Date(phase.wall_ends_at).getTime() - new Date(phase.wall_starts_at).getTime();
  const due = new Date(phase.wall_starts_at).getTime()
    + (Number.isFinite(Number(action.offset_ratio))
      ? duration * Number(action.offset_ratio)
      : Number(action.offset_seconds) * 1_000);
  return due < new Date(phase.wall_ends_at).getTime() ? new Date(due).toISOString() : null;
}

function normalizedName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

function className(item) {
  return item?.name ?? (item ? `Class ${item.grade}${item.section}` : null);
}

function phaseActivity(phase, role, subject) {
  if (phase.mode === "lesson") return role === "student" ? `Learning in ${subject}` : `Teaching ${subject}`;
  if (phase.mode === "break") return role === "student" ? "Taking the published break" : "On an unscheduled break interval";
  if (phase.mode === "activity") return role === "student" ? `Participating in ${subject}` : `Supporting ${subject}`;
  if (phase.mode === "transition") return role === "student" ? "Changing lessons" : "Between scheduled duties";
  return "No campus presence expected after the school day";
}

function activeSchedule(timetable, phase, routine) {
  const selected = new Set(phase.active_slot_ids ?? []);
  return {
    slots: routine.slots.filter((slot) => selected.has(String(slot.id))),
    selectedDay: routine.reference_weekday,
    period: phase.period_number,
  };
}

function targetForClass(targetClass, schedule, zones) {
  const requested = schedule?.space_id || targetClass?.home_space_id;
  return (requested && zones.has(requested)) ? requested : null;
}

function actor(input) {
  return {
    id: String(input.id),
    name: String(input.name || "Unnamed person"),
    role: input.role,
    ...(input.avatar_url ? { avatar_url: input.avatar_url } : {}),
    activity: input.activity || "Campus activity",
    ...(input.class_name ? { class_name: input.class_name } : {}),
    state: "expected",
    basis: "expected_from_fixture",
    ...input.marker_context,
  };
}

function configuredStaffExpectation(person, phase, behavior, zoneMap) {
  const expectation = (behavior.staff_expectations ?? []).find((item) => (
    normalizedName(item.designation) === normalizedName(person.designation)
    && item.phase_modes.includes(phase.mode)
  ));
  if (!expectation) return null;
  const zone = [...zoneMap.values()].find((item) => item.code === expectation.space_code);
  return {
    activity: expectation.activity,
    designation: expectation.designation,
    space_code: expectation.space_code,
    zone_id: zone?.space_id ?? null,
  };
}

function configuredAdminExpectation(phase, behavior, zoneMap) {
  const expectation = behavior.admin_expectation;
  if (!expectation?.phase_modes?.includes(phase.mode)) return null;
  const zone = [...zoneMap.values()].find((item) => item.code === expectation.space_code);
  return {
    activity: expectation.activity,
    space_code: expectation.space_code,
    zone_id: zone?.space_id ?? null,
  };
}

function plannedActivity(input) {
  return {
    ...input,
    state: "expected",
    evidence_scope: "planned_rehearsal_only",
    spatial_evidence: false,
  };
}

function phaseReceiptTitle(phase) {
  if (phase.mode === "transition") return `${phase.label} · simulated`;
  if (phase.mode === "break") return `${phase.label} started · simulated`;
  return `${phase.label} started · simulated`;
}

function phaseReceipts(now, routine, behavior) {
  const allowed = new Set(behavior.phase_receipts.include_modes);
  const instant = new Date(now).getTime();
  return routine.phases
    .filter((phase) => allowed.has(phase.mode) && new Date(phase.wall_starts_at).getTime() <= instant)
    .slice(-Number(behavior.phase_receipts.history_limit))
    .map((phase) => plannedActivity({
      id: `phase:${routine.reference_date}:${phase.id}`,
      occurred_at: phase.wall_starts_at,
      kind: phase.mode === "transition" ? "movement" : "system",
      title: phaseReceiptTitle(phase),
      detail: `${phase.description} This timeline receipt is derived from ${behavior.source_label}; it is not a gate check-in, sensor observation or physical room-presence claim.`,
      target_path: "/principal/timetable",
    }));
}

export function buildStatusSnapshot({
  now = new Date(), startedAt, behavior, setup, timetable, students = [], adminUser = null,
  actionActivity = [], errors = [], status = "running", routine: providedRoutine = null,
}) {
  const generatedAt = new Date(now);
  const routine = providedRoutine ?? createRoutineSchedule({ startedAt, behavior, timetable });
  const phase = phaseAt(generatedAt, routine);
  const markerContext = {
    source: "cambridge_development_routine",
    source_label: behavior.source_label,
    source_version: behavior.version,
    valid_from: phase.started_at,
    valid_until: phase.next_change_at,
    generated_at: generatedAt.toISOString(),
  };
  const spaces = (setup?.spaces ?? []).filter((space) => space.status === "active");
  const zoneMap = new Map(spaces.map((space) => [space.id, {
    id: `space:${space.id}`,
    space_id: space.id,
    label: space.name,
    code: space.code,
    kind: space.kind,
    activity: phase.label,
    actors: [],
    state: "expected",
    basis: "expected_from_fixture",
    ...markerContext,
  }]));
  const classes = setup?.classes ?? [];
  const classById = new Map(classes.map((item) => [item.id, item]));
  const schedule = activeSchedule(timetable, phase, routine);
  const slotByClass = new Map(schedule.slots.map((slot) => [slot.class_section_id, slot]));
  const slotByTeacher = new Map(schedule.slots.filter((slot) => slot.teacher_name).map((slot) => [normalizedName(slot.teacher_name), slot]));
  const unplaced = [];
  const campusOpen = phase.mode !== "closed";

  const addActor = (zoneId, value, reason) => {
    const zone = zoneId ? zoneMap.get(zoneId) : null;
    if (zone) zone.actors.push(value);
    else unplaced.push({ ...value, unplaced_reason: reason });
  };

  const staff = setup?.staff ?? [];
  if (campusOpen) {
    for (const student of students) {
      const targetClass = classById.get(student.class_section_id);
      const slot = slotByClass.get(student.class_section_id);
      const subject = slot?.display_title || slot?.subject_name || "class work";
      const zoneId = targetForClass(targetClass, slot, zoneMap);
      addActor(zoneId, actor({
        id: `student:${student.id}`,
        name: student.name,
        role: "student",
        avatar_url: student.avatar_url,
        activity: phaseActivity(phase, "student", subject),
        class_name: student.class_name || className(targetClass),
        marker_context: markerContext,
      }), "This student has no active scheduled space or configured class home space.");
    }

    staff.forEach((person) => {
      const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
      const slot = slotByTeacher.get(normalizedName(name));
      const targetClass = slot ? classById.get(slot.class_section_id) : null;
      const configuredExpectation = slot ? null : configuredStaffExpectation(person, phase, behavior, zoneMap);
      const zoneId = slot
        ? targetForClass(targetClass, slot, zoneMap)
        : configuredExpectation?.zone_id ?? null;
      const subject = slot?.display_title || slot?.subject_name || configuredExpectation?.activity || "campus work";
      if (configuredExpectation?.zone_id) {
        const expectedZone = zoneMap.get(configuredExpectation.zone_id);
        if (expectedZone) expectedZone.activity = configuredExpectation.activity;
      }
      addActor(zoneId, actor({
        id: `staff:${person.id}`,
        name,
        role: "staff",
        activity: slot
          ? phaseActivity(phase, "staff", subject)
          : configuredExpectation?.activity || phaseActivity(phase, "staff", subject),
        class_name: slot?.class_name || configuredExpectation?.designation || null,
        marker_context: markerContext,
      }), configuredExpectation && !configuredExpectation.zone_id
        ? `The configured expected space ${configuredExpectation.space_code} is not present in this campus fixture.`
        : "No published lesson or configured staff expectation identifies this person's location.");
    });

    if (adminUser) {
      const configuredExpectation = configuredAdminExpectation(phase, behavior, zoneMap);
      addActor(configuredExpectation?.zone_id ?? null, actor({
        id: `admin:${adminUser.id}`,
        name: adminUser.display_name || `${adminUser.first_name ?? ""} ${adminUser.last_name ?? ""}`.trim(),
        role: "admin",
        avatar_url: adminUser.avatar_url,
        activity: configuredExpectation?.activity || "No configured rehearsal duty",
        marker_context: markerContext,
      }), configuredExpectation
        ? `The configured expected space ${configuredExpectation.space_code} is not present in this campus fixture.`
        : "No configured administrator expectation identifies this person's location for the current phase.");
    }
  }

  for (const slot of schedule.slots) {
    const targetClass = classById.get(slot.class_section_id);
    const zoneId = targetForClass(targetClass, slot, zoneMap);
    const zone = zoneId ? zoneMap.get(zoneId) : null;
    if (!zone) continue;
    zone.activity = slot.display_title || slot.subject_name || phase.label;
    zone.subject = slot.display_title || slot.subject_name || undefined;
    zone.class_name = slot.class_name || className(targetClass) || undefined;
  }

  const expectedActivity = campusOpen ? [...phaseReceipts(generatedAt, routine, behavior), ...schedule.slots.slice(0, 8).map((slot) => {
    const targetClass = classById.get(slot.class_section_id);
    const zoneId = targetForClass(targetClass, slot, zoneMap);
    const zone = zoneId ? zoneMap.get(zoneId) : null;
    return plannedActivity({
      id: `movement:${routine.reference_date}:${phase.id}:${slot.id}`,
      occurred_at: phase.started_at,
      kind: "movement",
      title: `${slot.class_name || className(targetClass)} started ${slot.display_title || slot.subject_name || "scheduled activity"} · simulated`,
      detail: `${slot.teacher_name ? `${slot.teacher_name} is expected with this class` : "The class is expected here"} in ${zone?.label || "its configured home space"}. Timetable projection only; no physical presence is asserted.`,
      target_path: "/principal/timetable",
    });
  })] : [];

  const zones = [...zoneMap.values()];
  const actors = zones.reduce((sum, zone) => sum + zone.actors.length, 0) + unplaced.length;
  const activity = [...actionActivity, ...expectedActivity]
    .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())
    .slice(0, Number(behavior.activity_history_limit ?? 30));
  return {
    status: errors.length && status === "running" ? "degraded" : (status === "running" && !campusOpen ? "paused" : status),
    generated_at: generatedAt.toISOString(),
    started_at: new Date(startedAt).toISOString(),
    school: {
      id: setup?.school?.id ?? "",
      name: setup?.school?.name ?? "Cambridge International School",
      code: setup?.school?.code ?? "cis",
    },
    fixture: { version: behavior.version, source_label: behavior.source_label, state_dimension: "expected" },
    phase: {
      id: phase.id,
      label: phase.label,
      description: phase.description,
      started_at: phase.started_at,
      next_change_at: phase.next_change_at,
      mode: phase.mode,
      period_number: phase.period_number,
      school_starts_at: phase.school_starts_at,
      school_ends_at: phase.school_ends_at,
    },
    schedule: {
      reference_weekday: routine.reference_weekday,
      reference_date: routine.reference_date,
      timezone: routine.timezone,
      simulated_at: simulatedAt(generatedAt, routine),
      source: routine.source,
      active_slot_ids: phase.active_slot_ids,
      clock: routine.clock,
    },
    summary: {
      actors,
      students: students.length,
      staff: staff.length + (adminUser ? 1 : 0),
      zones: zones.length,
      unplaced: unplaced.length,
    },
    zones,
    unplaced,
    activity,
    ...(errors.length ? { errors: errors.slice(-8) } : {}),
  };
}

export const modelInternals = {
  activeSchedule,
  dateInZone,
  dayNumber,
  formatTime,
  instantInZone,
  normalizedName,
  parseTime,
  phaseActivity,
  zonedIso,
};
