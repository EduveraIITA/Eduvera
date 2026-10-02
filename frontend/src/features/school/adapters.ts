import type {
  AttendanceCalendarStatus,
  ParentAttendanceData,
  ParentChildSummary,
  ParentDiaryData,
  ParentHomeData,
  ParentLeaveData,
} from "../../pages/parent/parentTypes";
import type { StudentEligibilityData } from "../../pages/student/StudentEligibilityPage";
import type { StudentDiaryData, StudentDiaryItem } from "../../pages/student/StudentDiaryPage";
import type { StudentHomeData, StudentHomePeriod } from "../../pages/student/StudentHomePage";
import {
  type LeaveStatusStep,
  type StudentLeaveStatusData,
} from "../../pages/student/StudentLeaveStatusPage";
import type {
  AttendanceSubjectGroup,
  StudentAttendanceData,
} from "../../pages/student/StudentAttendancePage";
import type { AttendanceRankingData } from "./AttendanceRankingDialog";
import {
  type SchoolDayKey,
  type TimetableDay,
  type TimetableTone,
  type WeekGridRow,
} from "../../pages/student/student-timetable-data";
import type {
  ApiAttendanceRecord,
  ApiAttendanceRanking,
  ApiDiaryItem,
  ApiLeaveRequest,
  ApiStudent,
  ApiTimetableSlot,
  ParentAttendanceResponse,
  ParentDiaryResponse,
  ParentHomeResponse,
  ParentLeaveRouteResponse,
  StudentAttendanceResponse,
  StudentEligibilityResponse,
  StudentHomeResponse,
  StudentDiaryResponse,
  StudentLeaveStatusResponse,
  StudentTimetableResponse,
} from "./api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
});

function adaptRanking(ranking?: ApiAttendanceRanking): AttendanceRankingData | undefined {
  if (!ranking?.published) return undefined;
  return {
    cohortSize: ranking.cohort_size,
    asOf: ranking.as_of ? formatShortDate(ranking.as_of) : undefined,
    students: (ranking.students ?? []).map((student) => ({
      rank: student.rank,
      name: student.name,
      avatarUrl: student.avatar_url,
      attended: student.attended,
      held: student.held,
      streak: student.streak,
      percent: student.percentage,
      current: student.is_current,
    })),
  };
}

function parseLocalDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function formatDate(value: string) {
  return dateFormatter.format(parseLocalDate(value));
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(parseLocalDate(value));
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const time = value.includes("T") ? new Date(value) : undefined;
  if (time && !Number.isNaN(time.getTime())) {
    return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(time);
  }
  const [hours = "0", minutes = "00"] = value.split(":");
  const numericHours = Number(hours);
  const suffix = numericHours >= 12 ? "PM" : "AM";
  const displayHours = numericHours % 12 || 12;
  return `${String(displayHours).padStart(2, "0")}:${minutes} ${suffix}`;
}

function relativeDueLabel(value?: string | null) {
  if (!value) return undefined;
  const due = value.includes("T") ? new Date(value) : parseLocalDate(value);
  if (Number.isNaN(due.getTime())) return undefined;
  const today = parseLocalDate(indiaDateToday());
  const dueDate = new Date(due);
  dueDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const delta = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  if (delta === 0) return `Due today ${formatTime(value)}`;
  if (delta === 1) return `Due tomorrow ${formatTime(value)}`;
  if (delta === -1) return "Due yesterday";
  if (delta < 0) return `Overdue by ${Math.abs(delta)} days`;
  return `Due ${formatShortDate(due.toISOString().slice(0, 10))}`;
}

function roomLabel(value?: string | null) {
  const room = value?.trim();
  if (!room) return "Campus";
  // Prefix room codes, not named spaces such as the Activity Studio or Library.
  return /^(?:[a-z]?\d+[a-z]?|[a-z])$/i.test(room) ? `Room ${room}` : room;
}

function isHomeroomContact(label: string) {
  return /teacher|advisor|homeroom/i.test(label);
}

function clockMinutes(value?: string | null) {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function indiaMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function indiaDateToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function classDetails(student: ApiStudent): ParentChildSummary {
  const enrollment = student.current_enrollment;
  return {
    id: student.id,
    name: student.user.display_name,
    grade: `Grade ${enrollment.grade}`,
    section: enrollment.section,
    board: enrollment.board,
    rollNumber: String(enrollment.roll_number).padStart(2, "0"),
    avatarUrl: student.avatar_url || undefined,
  };
}

export function adaptStudentSummary(student: ApiStudent): ParentChildSummary {
  return classDetails(student);
}

function safeBuffer(attended: number, held: number, threshold: number) {
  return threshold > 0 ? Math.max(0, Math.floor(attended / (threshold / 100) - held)) : 0;
}

function titleFromReason(reason: string) {
  const firstSentence = reason.split(/[.!?]/)[0]?.trim();
  return firstSentence || "Leave request";
}

function formatLeaveRange(item: ApiLeaveRequest) {
  return item.starts_on === item.ends_on
    ? formatDate(item.starts_on)
    : `${formatShortDate(item.starts_on)} - ${formatDate(item.ends_on)}`;
}

function slotTone(slot: ApiTimetableSlot): TimetableTone {
  const value = `${slot.subject?.code ?? ""} ${slot.display_title}`.toLowerCase();
  if (value.includes("math")) return "math";
  if (value.includes("sci") || value.includes("bio")) return "science";
  if (value.includes("eng")) return "english";
  if (value.includes("hin") || value.includes("sans") || value.includes("french")) return "language";
  if (value.includes("social") || value.includes("history") || value.includes("geo")) return "humanities";
  if (value.includes("computer") || value.includes("lab")) return "lab";
  if (value.includes("physical") || value.includes("sport") || value.includes("art")) return "activity";
  return "neutral";
}

function compactRequestTitle(item: ApiLeaveRequest) {
  return item.category === "medical" ? "Medical Leave" : `${item.category_label} Leave`;
}

export function adaptParentHome(response: ParentHomeResponse): ParentHomeData {
  const child = classDetails(response.student);
  const schedule = response.today_schedule.filter(p=>!p.cancelled);
  const nowMinutes = indiaMinutesNow();
  const current = schedule.find((slot) => {
    const starts = clockMinutes(slot.starts_at);
    const ends = clockMinutes(slot.ends_at);
    return starts !== undefined && ends !== undefined && starts <= nowMinutes && nowMinutes < ends;
  });
  const upcoming = schedule.find((slot) => (clockMinutes(slot.starts_at) ?? -1) > nowMinutes);
  const focus = current ?? upcoming ?? schedule.at(-1);
  const focusIndex = focus ? schedule.findIndex((slot) => slot.id === focus.id) : -1;
  const next = focusIndex >= 0 ? schedule[focusIndex + 1] : undefined;
  const leave = response.action_required;
  const attendance = Number(response.attendance.percentage);
  const hasAttendance = response.attendance.total > response.attendance.excused;
  const primaryContact = response.contacts.find((contact) => isHomeroomContact(contact.label));
  return {
    child,
    homeActions: response.home_actions ?? [],
    dayPlan:response.day_plan,
    ranking: adaptRanking(response.ranking),
    idCard: {
      studentName: child.name,
      avatarUrl: child.avatarUrl,
      className: response.student.current_enrollment.class_name,
      rollNumber: child.rollNumber,
      studentId: response.student.admission_number,
      termLabel: `${response.student.current_enrollment.term.name} - ${response.student.current_enrollment.term.academic_year}`,
      dateLabel: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(new Date()),
      attendancePercent: attendance,
      attendanceRecorded: hasAttendance,
      attendanceThreshold: response.semester_metrics.attendance_threshold ?? 85,
    },
    sibling: response.siblings[0]
      ? {
          id: response.siblings[0].id,
          name: response.siblings[0].user.display_name.split(" ")[0] ?? response.siblings[0].user.display_name,
          grade: `Grade ${response.siblings[0].current_enrollment.grade}`,
          section: response.siblings[0].current_enrollment.section,
        }
      : undefined,
    presence: response.campus_presence
      ? {
          status: response.campus_presence.direction === "in" ? "In School" : "Checked Out",
          detail: `${response.campus_presence.gate} swipe at ${formatTime(response.campus_presence.occurred_at)}`,
        }
      : { status: "Not confirmed", detail: "No gate event recorded today" },
    pendingLeave: leave
      ? {
          id: leave.id,
          title: compactRequestTitle(leave),
          submittedLabel: leave.submitted_at ? `Submitted ${formatDate(leave.submitted_at)}` : "Draft",
          summary: titleFromReason(leave.reason),
          durationLabel: `${leave.duration_days} ${leave.duration_days === 1 ? "Day" : "Days"} (${formatLeaveRange(leave)})`,
        }
      : undefined,
    unreadDiaryCount: response.diary_preview.filter((item) => !item.acknowledged).length,
    diarySender: response.diary_preview[0]?.author_name ?? "No new diary entries",
    currentPeriod: focus
      ? {
          number: focus.period_number,
          startsAt: formatTime(focus.starts_at),
          endsAt: formatTime(focus.ends_at),
          remainingLabel: current
            ? `${Math.max(1, (clockMinutes(focus.ends_at) ?? nowMinutes) - nowMinutes)} min remaining`
            : upcoming ? `Starts at ${formatTime(focus.starts_at)}` : "School day complete",
          subject: focus.display_title,
          topic: focus.subject?.short_name && focus.subject.short_name !== focus.display_title
            ? focus.subject.short_name
            : "Today's lesson",
          room: roomLabel(focus.room),
          teacher: focus.teacher?.name ?? "Class faculty",
          progressPercent: current
            ? Math.max(0, Math.min(100, Math.round((nowMinutes - (clockMinutes(focus.starts_at) ?? nowMinutes)) * 100 / Math.max(1, (clockMinutes(focus.ends_at) ?? nowMinutes + 1) - (clockMinutes(focus.starts_at) ?? nowMinutes)))))
            : upcoming ? 0 : 100,
        }
      : undefined,
    nextPeriod: next
      ? {
          number: next.period_number,
          subject: next.display_title,
          room: roomLabel(next.room),
          startsAt: formatTime(next.starts_at),
        }
      : undefined,
    homeworkItems: response.homework_items?.map((item) => ({ id: item.id, title: item.title, body: item.body, subject: item.subject_name, dueAt: item.due_at, completedAt: item.completed_at })),
    metrics: {
      attendance: hasAttendance ? `${attendance.toFixed(1)}%` : "N/A",
      attendanceStatus: !hasAttendance ? "Not recorded" : attendance >= (response.semester_metrics.attendance_threshold ?? 85) ? "Safe Zone" : "Needs Attention",
      attendanceTrend: response.semester_metrics.attendance_trend_percent,
      attendanceRank: response.semester_metrics.attendance_rank,
      attendanceCohortSize: response.semester_metrics.attendance_cohort_size,
      threshold: `School minimum: ${response.semester_metrics.attendance_threshold ?? 85}%`,
      periodsToday: response.semester_metrics.periods_today,
      dismissal: schedule.at(-1) ? formatTime(schedule.at(-1)?.ends_at) : "Not scheduled",
      homeworkTasks: response.semester_metrics.homework_due,
      homeworkTotal: response.semester_metrics.homework_total,
      homeworkRecent: response.semester_metrics.homework_recent,
      homeworkPrevious: response.semester_metrics.homework_previous,
      homeworkDetail: response.semester_metrics.homework_due ? "Due items in the class diary" : "Nothing currently due",
      duesStatus: response.semester_metrics.dues_status,
      duesDetail: response.semester_metrics.dues_status_scope === "display_only_demo" ? "Demo school account" : "School account status",
      termLabel: `${response.student.current_enrollment.term.name} (${response.student.current_enrollment.term.academic_year})`,
    },
    homeroomTeacher: primaryContact
      ? {
          name: primaryContact.name,
          availability: primaryContact.availability,
          phone: primaryContact.phone,
          email: primaryContact.email,
        }
      : { name: "Homeroom teacher", availability: "Contact details not published" },
    transport: { passLabel: "Transport module", pickupWindow: "Not configured" },
  };
}

function calendarStatus(record?: ApiAttendanceRecord): AttendanceCalendarStatus {
  if (!record) return "future";
  if (record.status === "absent") return "unexcused";
  if (record.status === "excused") return "excused";
  return "present";
}

function attendanceStreak(records: ApiAttendanceRecord[]) {
  let streak = 0;
  for (const record of [...records].sort((a, b) => b.date.localeCompare(a.date))) {
    if (["present", "late", "half_day"].includes(record.status)) streak += 1;
    else break;
  }
  return streak;
}

function attendanceTrend(records: ApiAttendanceRecord[]) {
  const ordered = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const sampleSize = Math.min(10, Math.floor(ordered.length / 2));
  if (sampleSize < 3) return undefined;

  const score = (items: ApiAttendanceRecord[]) => items.reduce((total, record) => {
    if (record.status === "present" || record.status === "late") return total + 1;
    if (record.status === "half_day") return total + 0.5;
    return total;
  }, 0) * 100 / items.length;

  return Math.round((
    score(ordered.slice(0, sampleSize)) -
    score(ordered.slice(sampleSize, sampleSize * 2))
  ) * 10) / 10;
}

export function adaptParentAttendance(response: ParentAttendanceResponse): ParentAttendanceData {
  const threshold = Number(response.term.threshold);
  const summary = response.summary;
  const todayIso = indiaDateToday();
  const monthDate = parseLocalDate(todayIso);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const records = new Map(response.calendar.map((item) => [item.date, item]));
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const monthRecords = response.calendar.filter((item) => item.date.startsWith(monthPrefix));
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const id = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(year, month, day).getDay();
    let status: AttendanceCalendarStatus = calendarStatus(records.get(id));
    if (!records.has(id) && id > todayIso) status = "future";
    else if (!records.has(id) && weekday === 0) status = "weekend";
    else if (!records.has(id)) status = "not_recorded";
    return { id, day, status, ariaLabel: `${formatDate(id)}, ${status}` };
  });
  const attended = summary.present + summary.late + summary.half_day * 0.5;
  const gate = response.latest_gate_event;
  const homeroomContact = response.contacts?.find((contact) => isHomeroomContact(contact.label));
  return {
    child: classDetails(response.student),
    ranking: adaptRanking(response.ranking),
    termLabel: `${response.term.name} - ${response.term.academic_year}`,
    aggregatePercent: Number(summary.percentage),
    trendPercent: attendanceTrend(response.calendar),
    safeCushionDays: safeBuffer(attended, summary.total, threshold),
    minimumPercent: threshold,
    stats: {
      attended,
      totalDays: summary.total,
      dailyRatePercent: Number(summary.percentage),
      activeStreakDays: attendanceStreak(response.calendar),
      streakDetail: "Live term record",
      excusedCount: summary.excused,
      excusedDetail: "Approved excusals",
      pendingCount: summary.absent,
      pendingDetail: summary.absent ? "Recorded absences" : "None recorded",
    },
    today: {
      checkInTime: formatTime(response.today?.check_in_at ?? gate?.occurred_at),
      checkInLocation: gate?.gate ?? "Campus gate",
      checkInSource: gate?.source ?? "Attendance register",
      checkInVerified: Boolean(response.today?.check_in_at || gate?.occurred_at),
      dismissalTime: formatTime(response.today?.check_out_at ?? response.expected_dismissal_at),
      dismissalDetail: response.today?.check_out_at
        ? "Recorded campus checkout"
        : response.expected_dismissal_at
          ? "Scheduled school dismissal"
          : "No dismissal schedule published",
    },
    month: {
      label: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(monthDate),
      summary: {
        present: monthRecords.filter((record) => record.status === "present" || record.status === "late").length,
        excused: monthRecords.filter((record) => record.status === "excused").length,
        unexcused: monthRecords.filter((record) => record.status === "absent").length,
      },
      days,
    },
    subjects: response.subjects.map((item) => {
      const percent = Number(item.percentage);
      return {
        id: item.id,
        name: item.subject.name,
        percent,
        status: percent >= 98 ? "Optimal" : percent >= 95 ? "Safe" : percent >= threshold + 3 ? "Good" : "Near Min",
        tone: percent >= 98 ? "excellent" : percent >= 95 ? "safe" : percent >= threshold + 3 ? "good" : "warning",
      };
    }),
    homeroomContact: homeroomContact
      ? {
          name: homeroomContact.name,
          phone: homeroomContact.phone,
          email: homeroomContact.email,
        }
      : undefined,
  };
}

export function adaptParentLeave(response: ParentLeaveRouteResponse): ParentLeaveData {
  const item = response.request;
  const document = item?.documents[0];
  const guardianAudit = item?.audit_log.find((entry) => entry.action === "authorized");
  return {
    child: classDetails(response.student),
    guardian: { name: "You", relationship: "Registered guardian" },
    canAuthorize: response.can_authorize,
    request: item
      ? {
          id: item.id,
          title: `Leave Application by ${response.student.user.display_name.split(" ")[0] ?? "Student"}`,
          submittedLabel: item.submitted_at ? `Submitted ${formatDate(item.submitted_at)}` : "Draft",
          category: item.category_label,
          durationLabel: `${item.duration_days} Calendar ${item.duration_days === 1 ? "Day" : "Days"}`,
          rangeLabel: formatLeaveRange(item),
          studentNote: item.reason,
          document: document
        ? {
            id: document.id,
            name: document.original_name,
            sizeLabel: `${Math.max(0.1, document.size_bytes / 1024 / 1024).toFixed(1)} MB`,
            canOpen: Boolean(document.file_url),
          }
            : undefined,
          initialGuardianRemark: guardianAudit?.note ?? "",
        }
      : undefined,
    academicYearLabel: `Academic Year ${response.student.current_enrollment.term.academic_year}`,
    history: response.history.slice(0, 5).map((history) => ({
      id: history.id,
      title: titleFromReason(history.reason),
      dateLabel: formatLeaveRange(history),
      durationLabel: `${history.duration_days} Calendar ${history.duration_days === 1 ? "Day" : "Days"}`,
      approvedBy: history.decided_by_name ?? history.guardian_authorized_by_name ?? history.status_label,
      kind: history.category === "medical" ? "medical" : "family",
    })),
  };
}

export function adaptParentDiary(response: ParentDiaryResponse): ParentDiaryData {
  const selected = parseLocalDate(response.date);
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
  const days = Array.from({ length: 6 }, (_, index) => {
    const value = new Date(monday);
    value.setDate(monday.getDate() + index);
    const id = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    return {
      id,
      weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(value),
      day: value.getDate(),
      isToday: id === indiaDateToday(),
    };
  });
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  const nowMinutes = indiaMinutesNow();
  const selectedToday = response.date === indiaDateToday();
  const current = selectedToday ? response.schedule.find((slot) => {
    const starts = clockMinutes(slot.starts_at);
    const ends = clockMinutes(slot.ends_at);
    return starts !== undefined && ends !== undefined && starts <= nowMinutes && nowMinutes < ends;
  }) : undefined;
  const upcoming = selectedToday
    ? response.schedule.find((slot) => (clockMinutes(slot.starts_at) ?? -1) > nowMinutes)
    : undefined;
  const focus = current ?? upcoming ?? (selectedToday ? response.schedule.at(-1) : response.schedule[0]);
  const requiredItems = response.items.filter((item) => item.requires_acknowledgement);
  const guardian = response.guardian;
  return {
    child: classDetails(response.student),
    termLabel: `${response.student.current_enrollment.term.name} - ${response.student.current_enrollment.term.academic_year}`,
    weekLabel: `${formatShortDate(response.date === days[0]?.id ? response.date : days[0]?.id ?? response.date)} - ${formatShortDate(`${saturday.getFullYear()}-${String(saturday.getMonth() + 1).padStart(2, "0")}-${String(saturday.getDate()).padStart(2, "0")}`)}`,
    dateHeading: new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(selected),
    selectedDayId: response.date,
    days,
    currentPeriod: focus
      ? {
          number: focus.period_number,
          stateLabel: current
            ? `Period ${focus.period_number} in Session`
            : upcoming ? "Next scheduled period" : selectedToday ? "School day complete" : "Schedule preview",
          dayRangeLabel: `${formatTime(response.schedule[0]?.starts_at)} - ${formatTime(response.schedule.at(-1)?.ends_at)}`,
          subject: focus.display_title,
          room: roomLabel(focus.room),
          teacher: focus.teacher?.name ?? "Class faculty",
          untilLabel: current ? `Until ${formatTime(focus.ends_at)}` : upcoming ? `Starts ${formatTime(focus.starts_at)}` : `${formatTime(focus.starts_at)} - ${formatTime(focus.ends_at)}`,
        }
      : undefined,
    packingItems: response.items
      .filter((item) => /\b(?:bring|pack|notebook|sheet|kit|uniform|material)\b/i.test(item.body))
      .map((item) => ({
        id: `diary-packing-${item.id}`,
        label: item.title,
        detail: item.subject?.short_name ?? item.item_type_label,
        status: item.requires_acknowledgement ? "required" as const : "normal" as const,
        packed: false,
      })),
    schedule: response.schedule.map((slot) => ({
      id: slot.id,
      period: slot.period_number,
      timeLabel: formatTime(slot.starts_at).replace(/\s(?:AM|PM)$/, ""),
      subject: slot.display_title,
      location: roomLabel(slot.room),
      teacher: slot.teacher?.name ?? "Class faculty",
      state: selectedToday && (clockMinutes(slot.ends_at) ?? Number.POSITIVE_INFINITY) <= nowMinutes
        ? "complete"
        : selectedToday && slot.id === current?.id ? "current" : undefined,
    })),
    diaryEntries: response.items.map((item) => ({
      id: item.id,
      subject: item.subject?.name ?? "Homeroom Notice",
      kind: item.item_type_label,
      tone: item.item_type === "homework" ? "primary" : item.requires_acknowledgement ? "danger" : "neutral",
      body: item.body,
      author: item.author_name,
      timeLabel: formatTime(item.published_at),
      verified: item.acknowledged,
    })),
    guardian: guardian
      ? {
          name: guardian.name,
          relationship: guardian.relationship.replace(/^./, (value) => value.toUpperCase()),
          verifiedId: guardian.verified_id,
        }
      : { name: "Signed-in guardian", relationship: "Guardian", verifiedId: "Verified session" },
    requiresAcknowledgement: requiredItems.length > 0,
    isAcknowledged: requiredItems.length > 0 && requiredItems.every((item) => item.acknowledged),
  };
}

function subjectGroup(code: string): AttendanceSubjectGroup {
  if (["ENG", "HIN"].includes(code)) return "language";
  if (code === "PED") return "activity";
  return "core";
}

function safeBufferNote(value: number, threshold: number): string {
  if (value <= 0) return `Minimum required: ${threshold}%`;
  return `+${value} ${value === 1 ? "class" : "classes"} safe buffer`;
}

export function adaptStudentAttendance(response: StudentAttendanceResponse): StudentAttendanceData {
  const summary = response.summary;
  const threshold = Number(response.term.threshold);
  const attended = summary.present + summary.late + summary.half_day * 0.5;
  const todayWeekday = ((parseLocalDate(indiaDateToday()).getDay() + 6) % 7) + 1;
  return {
    studentName: response.student.user.display_name,
    ranking: adaptRanking(response.ranking),
    avatarUrl: response.student.avatar_url || undefined,
    className: response.student.current_enrollment.class_name,
    rollNumber: String(response.student.current_enrollment.roll_number).padStart(2, "0"),
    studentId: response.student.admission_number,
    termLabel: `${response.term.name} (${response.term.academic_year})`,
    minimumPercent: threshold,
    aggregate: Number(summary.percentage),
    attended,
    held: summary.total,
    halfDays: summary.half_day,
    excused: summary.excused,
    unexcused: summary.absent,
    safeBuffer: safeBuffer(attended, summary.total, threshold),
    streak: response.ranking?.current_streak,
    leaders: response.ranking?.published ? response.ranking.leaders.map((leader) => ({ ...leader, percent: leader.percentage })) : undefined,
    currentRank: response.ranking?.published && response.ranking.current_rank !== null ? response.ranking.current_rank : undefined,
    rankingCohortSize: response.ranking?.cohort_size,
    rankingAsOf: response.ranking?.as_of ? formatShortDate(response.ranking.as_of) : undefined,
    rankingMethodology: response.ranking?.published ? response.ranking.methodology : undefined,
    subjects: response.subjects.map((item) => {
      const percent = Number(item.percentage);
      const safe = safeBuffer(item.classes_attended, item.classes_held, threshold);
      return {
        id: item.subject.code.toLowerCase(),
        name: item.subject.name,
        percent,
        attended: item.classes_attended,
        held: item.classes_held,
        status: percent >= threshold + 10 ? "Well Above Minimum" : percent >= threshold ? "Eligible" : "Below Minimum",
        note: safeBufferNote(safe, threshold),
        group: subjectGroup(item.subject.code),
        teacher: item.teacher?.name,
        location: item.room ? roomLabel(item.room) : undefined,
        nextClass: item.next_class
          ? `${item.next_class.weekday === todayWeekday ? "Today" : item.next_class.weekday_label} at ${formatTime(item.next_class.starts_at)}`
          : undefined,
      };
    }),
  };
}

export function adaptStudentHome(response: StudentHomeResponse): StudentHomeData {
  const nowMinutes = indiaMinutesNow();
  const schedule: StudentHomePeriod[] = response.today_schedule.filter(p=>!p.cancelled).map((slot) => {
    const starts = clockMinutes(slot.starts_at) ?? Number.POSITIVE_INFINITY;
    const ends = clockMinutes(slot.ends_at) ?? Number.POSITIVE_INFINITY;
    const state: StudentHomePeriod["state"] = starts <= nowMinutes && nowMinutes < ends
      ? "current"
      : ends <= nowMinutes ? "complete" : "upcoming";
    return {
      id: slot.id,
      period: slot.period_number,
      subject: slot.display_title,
      startsAt: formatTime(slot.starts_at),
      endsAt: formatTime(slot.ends_at),
      teacher: slot.teacher?.name ?? "Faculty assignment pending",
      room: roomLabel(slot.room),
      materials:slot.materials,
      state,
    };
  });
  const presence = response.campus_presence;
  const attendance = response.today_attendance;
  const dateLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseLocalDate(response.date));
  return {
    studentName: response.student.user.display_name,
    homeActions: response.home_actions ?? [],
    dayPlan:response.day_plan,
    avatarUrl: response.student.avatar_url || undefined,
    className: response.student.current_enrollment.class_name,
    rollNumber: String(response.student.current_enrollment.roll_number).padStart(2, "0"),
    studentId: response.student.admission_number,
    termLabel: `${response.term.name} - ${response.term.academic_year}`,
    dateLabel,
    presence: attendance || presence
      ? {
          label: attendance?.status === "absent" ? "Absent" : attendance?.status === "excused" ? "Excused absence" : presence?.direction === "out" ? "Checked out" : "Present",
          detail: presence
            ? `${presence.gate} ${presence.direction === "in" ? "entry" : "exit"} at ${formatTime(presence.occurred_at)}`
            : attendance?.check_in_at ? `Attendance marked at ${formatTime(attendance.check_in_at)}` : "Marked in the school attendance register",
          verified: Boolean(attendance || presence),
        }
      : { label: "Not recorded yet", detail: "Waiting for today's school attendance", verified: false },
    attendancePercent: Number(response.attendance.percentage),
    attendanceThreshold: Number(response.term.threshold),
    periodsToday: schedule.length,
    activeLeaveCount: response.active_leave_count,
    unreadNotifications: response.unread_notifications,
    schedule,
    diary: response.diary_preview.map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.body,
      label: `${item.item_type_label}${item.subject ? ` - ${item.subject.short_name}` : ""}`,
    })),
  };
}

function diaryKindLabel(item: ApiDiaryItem) {
  if (item.item_type === "note") return "Remark";
  if (item.item_type === "announcement") return "Notice";
  return item.item_type_label;
}

function diaryCatchUp(item: ApiDiaryItem) {
  return /\b(absent|missed|catch\s*up|catch-up|recap|covered|while away)\b/i.test(`${item.title} ${item.body}`);
}

function diaryItem(response: ApiDiaryItem): StudentDiaryItem {
  return {
    id: response.id,
    date: response.date,
    kind: response.item_type,
    kindLabel: diaryKindLabel(response),
    subject: response.subject?.name ?? "Homeroom",
    subjectShort: response.subject?.short_name ?? "Notice",
    title: response.title,
    body: response.body,
    author: response.author_name,
    dueLabel: relativeDueLabel(response.due_at),
    publishedLabel: `${formatShortDate(response.date)} - ${formatTime(response.published_at)}`,
    requiresAcknowledgement: response.requires_acknowledgement,
    acknowledged: response.acknowledged,
    isCatchUp: diaryCatchUp(response),
    notes: response.notes.map((note) => ({
      id: note.id,
      author: note.author_name,
      body: note.body,
      createdLabel: formatTime(note.created_at),
    })),
  };
}

export function adaptStudentDiary(response: StudentDiaryResponse): StudentDiaryData {
  const student = response.student;
  const today = indiaDateToday();
  const sortedItems = response.items
    .map(diaryItem)
    .sort((left, right) => {
      const leftPending = left.requiresAcknowledgement && !left.acknowledged ? 1 : 0;
      const rightPending = right.requiresAcknowledgement && !right.acknowledged ? 1 : 0;
      if (leftPending !== rightPending) return rightPending - leftPending;
      const leftToday = left.date === today ? 1 : 0;
      const rightToday = right.date === today ? 1 : 0;
      if (leftToday !== rightToday) return rightToday - leftToday;
      const leftDistance = Math.abs(parseLocalDate(left.date).getTime() - parseLocalDate(today).getTime());
      const rightDistance = Math.abs(parseLocalDate(right.date).getTime() - parseLocalDate(today).getTime());
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return right.date.localeCompare(left.date);
    });
  return {
    studentName: student.user.display_name,
    avatarUrl: student.avatar_url || undefined,
    className: student.current_enrollment.class_name,
    rollNumber: String(student.current_enrollment.roll_number).padStart(2, "0"),
    studentId: student.admission_number,
    termLabel: `${student.current_enrollment.term.name} - ${student.current_enrollment.term.academic_year}`,
    rangeLabel: `${formatShortDate(response.date_from)} - ${formatShortDate(response.date_to)}`,
    items: sortedItems,
  };
}

export function adaptStudentEligibility(response: StudentEligibilityResponse): StudentEligibilityData {
  const item = response.subject;
  const threshold = Number(response.policy.minimum_percentage);
  return {
    studentName: response.student.user.display_name.split(" ")[0] ?? response.student.user.display_name,
    className: response.student.current_enrollment.class_name,
    periodLabel: `${response.student.current_enrollment.term.name} - ${response.student.current_enrollment.term.academic_year}`,
    subjectName: item.subject.name,
    policyName: response.policy.name,
    policyText: response.policy.text,
    threshold,
    aggregate: Number(item.percentage),
    safeLeaves: safeBuffer(item.classes_attended, item.classes_held, threshold),
    attended: item.classes_attended,
    missed: Math.max(0, item.classes_held - item.classes_attended - item.classes_excused),
    exempted: item.classes_excused,
  };
}

const dayKeys: Record<number, SchoolDayKey> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
  7: "sun",
};

export function adaptTimetable(response: StudentTimetableResponse): TimetableDay[] {
  const selected = parseLocalDate(response.selected_date);
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
  const liveDays = response.days.map((day) => {
    const key = dayKeys[day.weekday] ?? "mon";
    const date = new Date(monday);
    date.setDate(monday.getDate() + day.weekday - 1);
    return {
      key,
      shortLabel: day.weekday_label.slice(0, 3).toUpperCase(),
      longLabel: day.weekday_label,
      date: date.getDate(),
      isoDate:day.periods[0]?.date??undefined,
      meta: `${day.periods.length} Periods`,
      periods: day.periods.map((slot) => ({
        id: slot.id,
        period: `P${slot.period_number}`,
        time: formatTime(slot.starts_at),
        endTime: formatTime(slot.ends_at),
        subject: slot.display_title,
        teacher: slot.teacher?.name,
        room: slot.room?.trim() ? roomLabel(slot.room) : undefined,
        detail: slot.teacher?.designation,
        materials:slot.materials,cancelled:slot.cancelled,flag:slot.cancelled?'Cancelled':slot.day_plan_id?'Updated plan':undefined,
        tone: slotTone(slot),
      })),
    } satisfies TimetableDay;
  });
  return liveDays.sort(
    (a, b) => Object.values(dayKeys).indexOf(a.key) - Object.values(dayKeys).indexOf(b.key),
  );
}

export function adaptWeekGrid(response: StudentTimetableResponse): WeekGridRow[] {
  return adaptTimetable(response).map((day) => {
    const cells = day.periods.map((period) => ({
      period: period.period,
      time: period.time,
      label: period.subject.split(/\s+/).slice(0, 2).join(" "),
      tone: period.tone,
      group: period.tone === "humanities" ? "humanities" as const : period.tone === "lab" ? "lab" as const : period.tone === "activity" ? "activity" as const : ["math", "science", "english"].includes(period.tone) ? "core" as const : "other" as const,
    }));
    return { day: day.key, label: day.longLabel.slice(0, 3), cells };
  });
}

function requestStages(item: ApiLeaveRequest): LeaveStatusStep[] {
  const submitted = item.audit_log.find((entry) => entry.action === "submitted");
  const clarification = [...item.audit_log].reverse().find((entry) => entry.action === "clarification_requested");
  const authorized = item.status !== "pending_guardian";
  const decided = ["school_approved", "school_rejected"].includes(item.status);
  return [
    {
      id: "submitted",
      title: "Request Submitted",
      detail: submitted?.created_at ? formatDate(submitted.created_at) : item.submitted_at ? formatDate(item.submitted_at) : "Submitted",
      state: "complete",
      note: `Submitted by ${item.requested_by_name}`,
    },
    {
      id: "parent",
      title: "Parent Sign-Off",
      detail: clarification?.actor_name
        ? `Clarification requested by ${clarification.actor_name}`
        : item.guardian_authorized_by_name ?? "Awaiting registered guardian",
      state: authorized ? "complete" : "active",
      badge: authorized ? "Verified" : clarification ? "Needs clarification" : "Awaiting",
      note: !authorized && clarification?.note ? clarification.note : undefined,
    },
    {
      id: "teacher",
      title: "Class Teacher Review",
      detail: item.decided_by_name ?? "Homeroom Advisor",
      state: decided ? "complete" : authorized ? "active" : "pending",
      badge: decided ? item.status_label : authorized ? "In Review" : undefined,
    },
    {
      id: "register",
      title: "Official Attendance Record",
      detail: "Excusal code syncs after school approval",
      state: item.status === "school_approved" ? "complete" : "pending",
    },
  ];
}

export function adaptStudentLeaveStatus(response: StudentLeaveStatusResponse): StudentLeaveStatusData {
  const active = response.active[0];
  const document = active?.documents.find((item) => Boolean(item.file_url));
  return {
    activeCount: response.active.length,
    requestId: active?.id ?? null,
    title: active ? titleFromReason(active.reason) : "",
    dates: active ? `${formatLeaveRange(active)} - Full School Days` : "",
    duration: active
      ? `${active.duration_days} ${active.duration_days === 1 ? "Day" : "Days"}`
      : "",
    stages: active ? requestStages(active) : [],
    documentName: document?.original_name,
    documentUrl: document?.file_url ?? undefined,
    history: response.history.slice(0, 5).map((item) => ({
      id: item.id,
      title: titleFromReason(item.reason),
      dates: formatLeaveRange(item),
      duration: `${item.duration_days} ${item.duration_days === 1 ? "Day" : "Days"}`,
      status: item.status,
      statusLabel: item.status_label,
      statusDetail: item.audit_log.at(-1)?.actor_name ?? item.requested_by_name,
    })),
  };
}
