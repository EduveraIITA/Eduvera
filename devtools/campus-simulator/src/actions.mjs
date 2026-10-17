import { createHash } from "node:crypto";
import { actionDueAt, phaseAt } from "./model.mjs";

export function deterministicUuid(value) {
  const bytes = Buffer.from(createHash("sha256").update(String(value)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function schoolDate(value, timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function acknowledgementDeadline(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 12, 30, 0)).toISOString();
}

function activity({ action, kind, title, detail, state = "recorded", target_path }) {
  return {
    id: `action:${action.id}:${Date.now()}`,
    occurred_at: new Date().toISOString(),
    kind,
    title,
    detail,
    state,
    evidence_scope: state === "recorded" ? "domain_record_only" : "planned_rehearsal_only",
    spatial_evidence: false,
    ...(target_path ? { target_path } : {}),
  };
}

function safeMessage(error) {
  if (typeof error?.message === "string") return error.message.slice(0, 300);
  return "The application rejected the development action.";
}

function attendanceStatus(studentId, ratios) {
  const hash = createHash("sha256").update(studentId).digest().readUInt32BE(0) / 0xffffffff;
  let boundary = 0;
  for (const status of ["present", "late", "absent", "excused"]) {
    boundary += Number(ratios[status] ?? 0);
    if (hash <= boundary) return status;
  }
  return "present";
}

export class DevelopmentActionRunner {
  constructor({ sessions, setup, behavior, startedAt, routine, actorSession, onActivity, runId = "development" }) {
    this.sessions = sessions;
    this.setup = setup;
    this.behavior = behavior;
    this.startedAt = new Date(startedAt);
    this.onActivity = onActivity;
    this.actorSession = actorSession;
    this.completed = new Set();
    this.reactionFirstSeen = new Map();
    this.reactionFailureReported = new Set();
    this.reactionRejected = new Set();
    this.lastReactionPollAt = 0;
    this.inFlight = false;
    this.noticeId = null;
    this.runId = runId;
    this.date = null;
    this.scope = null;
    this.updateRoutine(routine, this.startedAt);
  }

  updateRoutine(routine, scopeStartedAt = new Date()) {
    const nextDate = routine.reference_date || schoolDate(new Date(), this.behavior.timezone);
    const startsNewDate = this.date !== nextDate;
    if (this.date && startsNewDate) {
      this.completed.clear();
      this.noticeId = null;
      this.reactionFirstSeen.clear();
      this.reactionFailureReported.clear();
      this.reactionRejected.clear();
      this.lastReactionPollAt = 0;
    }
    this.date = nextDate;
    this.scope = `${this.behavior.version}:${this.setup.school.id}:${this.runId}:${this.date}`;
    this.routine = routine;
    const expandedActions = this.behavior.actions.flatMap((action) => {
      if (action.period_selector !== "each_lesson") return [action];
      const periods = [...new Set(routine.phases
        .filter((phase) => phase.mode === "lesson" && Number.isInteger(phase.period_number))
        .map((phase) => phase.period_number))];
      return periods.map((periodNumber) => ({
        ...action,
        id: `${action.id}:period-${periodNumber}`,
        period_number: periodNumber,
      }));
    });
    this.scheduledActions = expandedActions.map((action) => ({
      action,
      due_at: actionDueAt(action, routine),
    }));
    if (startsNewDate) {
      const lowerBound = new Date(scopeStartedAt).getTime();
      this.scheduledActions.forEach(({ action, due_at: dueAt }) => {
        if (dueAt && new Date(dueAt).getTime() < lowerBound) this.completed.add(action.id);
      });
    }
  }

  async tick(now = new Date()) {
    if (this.inFlight) return;
    const activePhase = phaseAt(now, this.routine);
    if (activePhase.mode === "closed" || !activePhase.next_change_at) return;
    const currentTime = new Date(now).getTime();
    const dueEntry = this.scheduledActions.find(({ action, due_at: dueAt }) => (
      dueAt
      && !this.completed.has(action.id)
      && action.phase_mode === activePhase.mode
      && action.period_number === activePhase.period_number
      && currentTime >= new Date(dueAt).getTime()
      && currentTime < new Date(activePhase.next_change_at).getTime()
    ));
    const reactionPollMs = Number(this.behavior.reaction_poll_seconds) * 1_000;
    const shouldPollReactions = Boolean(this.behavior.reactions?.length)
      && currentTime - this.lastReactionPollAt >= reactionPollMs;
    if (!dueEntry && !shouldPollReactions) return;
    this.inFlight = true;
    try {
      if (dueEntry) {
        const due = dueEntry.action;
        this.completed.add(due.id);
        try {
          const result = await this.execute(due);
          if (result) this.onActivity(result);
        } catch (error) {
          this.onActivity(activity({
            action: due,
            kind: "issue",
            title: `${due.id.replaceAll("-", " ")} could not run`,
            detail: `${safeMessage(error)} The harness continued without bypassing application policy.`,
            state: "issue",
          }));
        }
      }
      if (shouldPollReactions) {
        this.lastReactionPollAt = currentTime;
        await this.pollReactions(now);
      }
    } finally {
      this.inFlight = false;
    }
  }

  async pollReactions(now) {
    for (const reaction of this.behavior.reactions ?? []) {
      try {
        const result = reaction.type === "staff_accept_exam_invigilation"
          ? await this.staffAcceptExamInvigilation(reaction, now)
          : null;
        if (result) this.onActivity(result);
      } catch (error) {
        const failureKey = `${reaction.id}:${safeMessage(error)}`;
        if (this.reactionFailureReported.has(failureKey)) continue;
        this.reactionFailureReported.add(failureKey);
        this.onActivity(activity({
          action: reaction,
          kind: "issue",
          title: `${reaction.id.replaceAll("-", " ")} could not react`,
          detail: `${safeMessage(error)} The offer remains unchanged for a human to review.`,
          state: "issue",
        }));
      }
    }
  }

  async staffAcceptExamInvigilation(reaction, now) {
    if (typeof this.actorSession !== "function") throw new Error("No fixture actor session factory is configured.");
    const schoolId = this.setup.school.id;
    const workspace = await this.sessions.admin.request(`/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/workspace/`);
    const assessments = (workspace?.assessments ?? [])
      .filter((item) => item.status === "draft" && ["exam", "practical", "viva"].includes(item.assessment_kind))
      .slice(0, Number(reaction.scan_limit));
    for (const assessment of assessments) {
      const detailPath = `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/${encodeURIComponent(assessment.id)}/`;
      const detail = await this.sessions.admin.request(detailPath);
      if (detail?.exam_operation?.sitting?.state !== "planning") continue;
      for (const assignment of detail.exam_operation.invigilators ?? []) {
        if (assignment.status !== "offered") continue;
        const key = `${reaction.id}:${assignment.id}:${assignment.revision}`;
        if (this.reactionRejected.has(key)) continue;
        const firstSeenAt = this.reactionFirstSeen.get(key) ?? new Date(now).getTime();
        this.reactionFirstSeen.set(key, firstSeenAt);
        if (new Date(now).getTime() - firstSeenAt < Number(reaction.delay_seconds) * 1_000) continue;
        if (!assignment.username) throw new Error(`The offered fixture staff identity ${assignment.name} has no application username.`);
        const session = await this.actorSession({
          username: assignment.username,
          userId: assignment.user_id,
          schoolId,
        });
        const inbox = await session.request("/api/v1/requests/?portal=teacher");
        const routedOffer = (inbox?.items ?? []).find((item) => (
          item.kind === "assessment_invigilation" && item.source_id === assignment.id
        ));
        if (!routedOffer) continue;
        const actorDetail = await session.request(detailPath);
        const current = actorDetail?.exam_operation?.viewer_assignment;
        if (!current || current.id !== assignment.id || current.status !== "offered") continue;
        try {
          await session.request(`${detailPath}sitting/invigilators/${encodeURIComponent(current.id)}/response/`, {
            method: "POST",
            body: {
              command_id: deterministicUuid(`${schoolId}:${reaction.id}:${current.id}:${current.revision}:${reaction.decision}`),
              expected_revision: current.revision,
              decision: reaction.decision,
              note: reaction.note,
            },
          });
        } catch (error) {
          const status = Number(error?.status ?? 0);
          if (status < 400 || status >= 500) throw error;
          this.reactionRejected.add(key);
          const failureKey = `${key}:${safeMessage(error)}`;
          if (!this.reactionFailureReported.has(failureKey)) {
            this.reactionFailureReported.add(failureKey);
            this.onActivity(activity({
              action: reaction,
              kind: "issue",
              title: `${assignment.name}'s invigilation offer needs reissue`,
              detail: `${safeMessage(error)} The stale offer was left unchanged and does not block later valid offers.`,
              state: "issue",
              target_path: `/principal/assessments?assessment=${encodeURIComponent(assessment.id)}`,
            }));
          }
          continue;
        }
        const reflectedDetail = await this.sessions.admin.request(detailPath);
        const reflected = (reflectedDetail?.exam_operation?.invigilators ?? [])
          .find((item) => item.id === current.id);
        if (!reflected || reflected.status !== reaction.decision) {
          throw new Error("The invigilation response did not converge in the administrator's assessment workspace.");
        }
        return activity({
          action: reaction,
          kind: "assessment",
          title: `${assignment.name} accepted the invigilation duty`,
          detail: "The synthetic staff agent received the routed Requests item and responded through the same assessment command and authority checks used by a real staff member.",
          target_path: `/teacher/assessments?assessment=${encodeURIComponent(assessment.id)}`,
        });
      }
    }
    return null;
  }

  execute(actionDefinition) {
    switch (actionDefinition.type) {
      case "staff_guardian_message": return this.staffGuardianMessage(actionDefinition);
      case "admin_publish_notice": return this.adminPublishNotice(actionDefinition);
      case "parent_acknowledge_notice": return this.parentAcknowledgeNotice(actionDefinition);
      case "teacher_submit_attendance": return this.teacherSubmitConfiguredAttendance(actionDefinition);
      default: throw new Error(`Unknown configured development action: ${actionDefinition.type}`);
    }
  }

  async staffGuardianMessage(actionDefinition) {
    const response = await this.sessions.staff.request("/api/v1/chat/recipients/");
    const recipient = response?.results?.find((item) => item.role === "parent" && item.student_id)
      ?? response?.results?.find((item) => item.role === "parent");
    if (!recipient) throw new Error("No guardian recipient is available to the demo teacher.");
    const conversation = await this.sessions.staff.request("/api/v1/chat/conversations/", {
      method: "POST",
      body: {
        school_id: this.setup.school.id,
        recipient_id: recipient.id,
        ...(recipient.student_id ? { student_id: recipient.student_id } : {}),
      },
    });
    const body = `Development rehearsal: today's Cambridge class update is ready for ${recipient.name}.`;
    const sent = await this.sessions.staff.request(`/api/v1/chat/conversations/${encodeURIComponent(conversation.id)}/messages/`, {
      method: "POST",
      body: {
        body,
        client_id: deterministicUuid(`${this.scope}:${actionDefinition.id}:message`),
      },
    });
    const reflected = await this.sessions.staff.request(`/api/v1/chat/conversations/${encodeURIComponent(conversation.id)}/messages/`);
    const reflectedMessage = (reflected?.results ?? []).find((item) => item.id === sent?.id);
    if (!reflectedMessage || reflectedMessage.body !== body || reflectedMessage.is_mine !== true) {
      throw new Error("The message command did not converge in the teacher's conversation timeline.");
    }
    return activity({
      action: actionDefinition,
      kind: "message",
      title: `Demo teacher messaged ${recipient.name}`,
      detail: "Recorded through the normal school conversation API; the regular chat screen receives its live event.",
      target_path: `/teacher/messages?conversation=${encodeURIComponent(conversation.id)}`,
    });
  }

  async adminPublishNotice(actionDefinition) {
    const title = `Development rehearsal · Campus update · ${this.date}`;
    const created = await this.sessions.admin.request("/api/v1/notices", {
      method: "POST",
      body: {
        school_id: this.setup.school.id,
        title,
        body: "This acknowledgement is generated only by the local Cambridge development fixture so the notice workflow can be reviewed end to end.",
        response_mode: "acknowledgement",
        response_options: [],
        priority: "normal",
        due_at: acknowledgementDeadline(this.date),
        audiences: [{ kind: "school_guardians" }],
        idempotency_key: deterministicUuid(`${this.scope}:${actionDefinition.id}:create`),
      },
    });
    const published = await this.sessions.admin.request(`/api/v1/notices/${encodeURIComponent(created.id)}/publish`, {
      method: "POST",
      body: {
        expected_revision: created.revision,
        idempotency_key: deterministicUuid(`${this.scope}:${actionDefinition.id}:publish`),
      },
    });
    const reflected = await this.sessions.admin.request(`/api/v1/notices/${encodeURIComponent(published.id)}?portal=principal`);
    if (
      reflected?.status !== "published"
      || Number(reflected?.metrics?.recipients) !== Number(published.recipient_count)
    ) {
      throw new Error("The published notice did not converge in the principal's notice workspace.");
    }
    this.noticeId = published.id;
    return activity({
      action: actionDefinition,
      kind: "notice",
      title: "Demo principal published an acknowledgement",
      detail: `${published.recipient_count ?? 0} fixture recipients were resolved by the real notice domain.`,
      target_path: `/principal/notices/${published.id}`,
    });
  }

  async parentAcknowledgeNotice(actionDefinition) {
    const list = await this.sessions.parent.request("/api/v1/notices?portal=parent");
    const expectedTitle = `Development rehearsal · Campus update · ${this.date}`;
    const notice = list?.results?.find((item) => item.id === this.noticeId)
      ?? list?.results?.find((item) => item.title === expectedTitle);
    if (!notice) throw new Error("The demo guardian has no matching acknowledgement notice.");
    if (notice.responded_at) {
      const reflected = await this.sessions.admin.request(`/api/v1/notices/${encodeURIComponent(notice.id)}?portal=principal`);
      const recipient = (reflected?.recipients ?? []).find((item) => item.id === notice.recipient_id);
      if (!recipient?.responded_at || Number(reflected?.metrics?.responded) < 1) {
        throw new Error("The retained family response did not converge in the principal's notice workspace.");
      }
      return activity({
        action: actionDefinition,
        kind: "notice",
        title: "Demo family acknowledgement already recorded",
        detail: "The existing fixture response remains visible in the principal notice screen; no duplicate response was created.",
        state: "expected",
        target_path: `/principal/notices/${notice.id}`,
      });
    }
    const opened = await this.sessions.parent.request(`/api/v1/notices/${encodeURIComponent(notice.id)}/open`, {
      method: "POST",
      body: { ...(notice.student_id ? { student_id: notice.student_id } : {}) },
    });
    const response = await this.sessions.parent.request(`/api/v1/notices/${encodeURIComponent(notice.id)}/respond`, {
      method: "POST",
      body: {
        expected_revision: opened.revision,
        response_note: "Acknowledged by the local Cambridge development fixture.",
        idempotency_key: deterministicUuid(`${this.scope}:${actionDefinition.id}:respond`),
        ...(notice.student_id ? { student_id: notice.student_id } : {}),
      },
    });
    const reflected = await this.sessions.admin.request(`/api/v1/notices/${encodeURIComponent(notice.id)}?portal=principal`);
    const recipient = (reflected?.recipients ?? []).find((item) => item.id === response?.recipient_id);
    if (!recipient?.responded_at || Number(reflected?.metrics?.responded) < 1) {
      throw new Error("The family response did not converge in the principal's notice workspace.");
    }
    return activity({
      action: actionDefinition,
      kind: "notice",
      title: "Demo family acknowledged the campus update",
      detail: "The principal notice screen now reflects a response recorded through the normal family workflow.",
      target_path: `/principal/notices/${notice.id}`,
    });
  }

  async teacherSubmitConfiguredAttendance(actionDefinition) {
    const today = this.date;
    const workspace = await this.sessions.admin.request(`/api/v1/attendance-model/workspace?date=${encodeURIComponent(today)}`);
    if (workspace?.mode === "scheduled_session") return this.teacherSubmitSessionAttendance(actionDefinition, workspace);
    if (workspace?.mode === "daily_class") return this.teacherSubmitDailyAttendance(actionDefinition);
    return activity({
      action: actionDefinition,
      kind: "attendance",
      title: "Attendance rehearsal skipped by configuration",
      detail: "Academic attendance is disabled in the institution's effective Operating rule.",
      state: "expected",
      target_path: `/principal/attendance?date=${today}`,
    });
  }

  async teacherSubmitSessionAttendance(actionDefinition, workspace) {
    const today = this.date;
    if (typeof this.actorSession !== "function") throw new Error("No fixture actor session factory is configured.");
    const activeSlotIds = new Set(
      (this.routine?.phases ?? [])
        .filter((phase) => phase.mode === actionDefinition.phase_mode && phase.period_number === actionDefinition.period_number)
        .flatMap((phase) => phase.active_slot_ids ?? []),
    );
    const candidates = (workspace?.registers ?? []).filter((item) => (
      item.attendance_scope === "scheduled_session"
      && item.period_number === actionDefinition.period_number
      && activeSlotIds.has(item.schedule_slot_id)
      && item.can_mark !== false
      && !["submitted", "locked"].includes(item.submission_status)
      && item.scheduled_teacher_id
      && item.scheduled_teacher_username
    ));
    if (!candidates.length) {
      return activity({
        action: actionDefinition,
        kind: "attendance",
        title: "Attendance rehearsal skipped safely",
        detail: "No open scheduled subject register with an identified assigned teacher exists in this active timetable period.",
        state: "expected",
        target_path: `/principal/attendance?date=${today}`,
      });
    }
    const submitted = [];
    const failures = [];
    for (const candidate of candidates) {
      try {
        const actor = await this.actorSession({
          username: candidate.scheduled_teacher_username,
          userId: candidate.scheduled_teacher_id,
          schoolId: this.setup.school.id,
        });
        const screen = await actor.request(`/api/v1/attendance-model/sessions/${encodeURIComponent(candidate.session_id)}`);
        const untouched = (screen?.roster ?? []).every((student) => !student.status);
        if (
          screen?.availability?.can_mark !== true
          || screen?.register?.state !== "draft"
          || screen?.register?.finalization_source === "manual"
          || !untouched
          || !screen.roster.length
        ) continue;
        const records = screen.roster.map((student) => ({
          student_id: student.id,
          status: attendanceStatus(student.id, this.behavior.attendance_ratios),
          remarks: "",
        }));
        await actor.request(`/api/v1/attendance-model/sessions/${encodeURIComponent(candidate.session_id)}/submit`, {
          method: "POST",
          headers: { "idempotency-key": `campus-lab-session-${today}-${candidate.session_id}` },
          body: {
            expected_revision: Number(screen.register.revision ?? 0),
            reason: "Development-only Cambridge fixture rehearsal.",
            records,
          },
        });
        submitted.push({ candidate, screen, records });
      } catch (error) {
        failures.push(`${candidate.assigned_teachers?.[0] ?? "Assigned teacher"}: ${safeMessage(error)}`);
      }
    }
    if (!submitted.length && failures.length) throw new Error(failures.join("; "));
    if (!submitted.length) {
      return activity({
        action: actionDefinition,
        kind: "attendance",
        title: "Attendance rehearsal left existing work unchanged",
        detail: "Scheduled subject registers were closed, already contained decisions, or required a human workflow.",
        state: "expected",
        target_path: `/principal/attendance?date=${today}`,
      });
    }
    const reflectedWorkspace = await this.sessions.admin.request(`/api/v1/attendance-model/workspace?date=${encodeURIComponent(today)}`);
    for (const result of submitted) {
      const reflected = (reflectedWorkspace?.registers ?? []).find((item) => item.session_id === result.candidate.session_id);
      if (
        !reflected
        || !["submitted", "locked"].includes(reflected.submission_status)
        || Number(reflected.marked_count) !== result.records.length
        || Number(reflected.student_count) !== result.records.length
      ) {
        throw new Error("A scheduled attendance command did not converge in the operator's authoritative register workspace.");
      }
    }
    const first = submitted[0];
    const totalRecords = submitted.reduce((sum, result) => sum + result.records.length, 0);
    const partial = failures.length > 0;
    return activity({
      action: actionDefinition,
      kind: "attendance",
      title: submitted.length === 1
        ? `${first.candidate.assigned_teachers?.[0] ?? "Assigned teacher"} submitted ${first.screen.class.name} · ${first.screen.session.subject_name} attendance`
        : `${submitted.length} assigned teachers submitted Period ${actionDefinition.period_number} attendance`,
      detail: `${totalRecords} dummy student decisions were recorded across ${submitted.length} scheduled subject register${submitted.length === 1 ? "" : "s"}.${partial ? ` ${failures.length} register${failures.length === 1 ? "" : "s"} still need review.` : ""}`,
      state: partial ? "issue" : "recorded",
      target_path: submitted.length === 1
        ? `/principal/attendance?session_id=${first.candidate.session_id}&date=${today}`
        : `/principal/attendance?date=${today}`,
    });
  }

  async teacherSubmitDailyAttendance(actionDefinition) {
    const today = this.date;
    const home = await this.sessions.staff.request(`/api/v1/screens/teacher/home/?date=${encodeURIComponent(today)}`);
    const candidates = (home?.classes ?? []).filter((item) => item.can_mark !== false && !["submitted", "locked"].includes(item.submission_status));
    if (!candidates.length) {
      return activity({
        action: actionDefinition,
        kind: "attendance",
        title: "Attendance rehearsal skipped safely",
        detail: "No current-day unsubmitted daily register is assigned and open for the configured demo teacher.",
        state: "expected",
        target_path: `/principal/attendance?date=${today}`,
      });
    }
    let screen = null;
    for (const candidate of candidates) {
      const current = await this.sessions.staff.request(`/api/v1/screens/teacher/attendance/?class_section_id=${encodeURIComponent(candidate.class_section_id)}&date=${encodeURIComponent(today)}`);
      const untouched = (current?.roster ?? []).every((student) => !student.status);
      if (
        current?.availability?.can_mark === true
        && ["draft", "in_progress"].includes(current?.register?.state)
        && current?.register?.finalization_source !== "manual"
        && untouched
        && current.roster.length
      ) {
        screen = current;
        break;
      }
    }
    if (!screen) {
      return activity({
        action: actionDefinition,
        kind: "attendance",
        title: "Attendance rehearsal left existing work unchanged",
        detail: "Daily registers were closed, already contained decisions, or required a human workflow.",
        state: "expected",
        target_path: `/principal/attendance?date=${today}`,
      });
    }
    const records = screen.roster.map((student) => ({
      student_id: student.id,
      status: attendanceStatus(student.id, this.behavior.attendance_ratios),
      remarks: "",
    }));
    await this.sessions.staff.request("/api/v1/teacher/attendance/bulk/", {
      method: "POST",
      headers: { "idempotency-key": `campus-lab-daily-${today}-${screen.class.id}` },
      body: {
        class_section_id: screen.class.id,
        date: today,
        expected_revision: Number(screen.register.revision ?? 0),
        reason: "Development-only Cambridge fixture rehearsal.",
        records,
      },
    });
    const reflected = await this.sessions.staff.request(`/api/v1/screens/teacher/attendance/?class_section_id=${encodeURIComponent(screen.class.id)}&date=${encodeURIComponent(today)}`);
    if (
      !["submitted", "locked"].includes(reflected?.register?.state)
      || (reflected?.roster ?? []).filter((student) => student.status).length !== records.length
    ) {
      throw new Error("The daily attendance command did not converge in the teacher's authoritative register screen.");
    }
    return activity({
      action: actionDefinition,
      kind: "attendance",
      title: `Demo teacher submitted ${screen.class.name} daily attendance`,
      detail: `${records.length} dummy student decisions were recorded in the configured daily class register.`,
      target_path: `/principal/attendance?class_section_id=${screen.class.id}&date=${today}`,
    });
  }
}

export const actionInternals = { acknowledgementDeadline, attendanceStatus, safeMessage };
