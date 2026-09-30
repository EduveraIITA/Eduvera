import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Camera,
  History,
  LockKeyhole,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Search,
  UnlockKeyhole,
  UserCheck,
  UsersRound,
} from "lucide-react";
import type {
  AttendanceRegister,
  AttendanceRegisterHistoryResponse,
  AttendanceStatus,
  TeacherAttendanceRecordInput,
  TeacherAttendanceResponse,
  TeacherAttendanceSaveInput,
  TeacherHomeResponse,
} from "../../features/operations/api";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "./OperationsShell";
import { FollowupInbox } from "../../features/coordination/FollowupInbox";
import { HomeActionDeck } from "../../features/home-actions/HomeActionDeck";
import { CreateAttendanceFollowup } from "../../features/coordination/CreateAttendanceFollowup";
import { TeacherDayPanel } from "../../features/day-plans/TeacherDayPage";
import { AttendanceStudentRow } from "./AttendanceStudentRow";
import { PhotoAttendanceDialog } from "./PhotoAttendanceDialog";
import "./attendance-register.css";
import "./attendance-workspace.css";

function time(value: string | null) {
  if (!value) return "No lesson";
  const [hour = "0", minute = "00"] = value.split(":");
  const numeric = Number(hour);
  return `${numeric % 12 || 12}:${minute} ${numeric >= 12 ? "PM" : "AM"}`;
}

const statusLabels: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
  half_day: "Half day",
};

export function TeacherHomePage({
  data,
  date,
  onDateChange,
}: {
  data: TeacherHomeResponse;
  date: string;
  onDateChange: (date: string) => void;
}) {
  const dueClasses = data.classes.filter((item) =>
    item.can_mark !== false || item.submission_status === "submitted" || item.submission_status === "locked"
  );
  const totals = dueClasses.reduce(
    (value, item) => ({
      students: value.students + Number(item.student_count),
      marked: value.marked + Number(item.marked_count),
      attending: value.attending + Number(item.attending_count),
    }),
    { students: 0, marked: 0, attending: 0 },
  );
  const submitted = dueClasses.filter(
    (item) =>
      item.submission_authorized !== false && (
        item.submission_status === "submitted" ||
        item.submission_status === "locked"
      ),
  ).length;
  return (
    <OperationsShell
      portal="teacher"
      active="home"
      title={`Good morning, ${data.teacher.name.split(" ")[0]}`}
      subtitle="Teaching operations"
    >
      <div className="operations-stack">
        <section className="operations-hero operations-hero--teacher">
          <div>
            <span>Teaching desk</span>
            <h2>
              {data.classes.length} scheduled{" "}
              {data.classes.length === 1 ? "class" : "classes"}
            </h2>
            <p>
              {data.classes.length
                ? "Take attendance for today’s lessons and accepted cover, then review any exceptions."
                : "No lesson or accepted cover requires attendance for this date."}
            </p>
          </div>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
        </section>
        <HomeActionDeck actions={data.home_actions ?? []} title="Your priority queue" />
        {dueClasses.length ? <section
          className="operations-metrics"
          aria-label="Teacher attendance summary"
        >
          <article>
            <span>
              <CalendarDays size={19} />
            </span>
            <small>Classes</small>
            <strong>{dueClasses.length}</strong>
            <em>{submitted} registers complete</em>
          </article>
          <article>
            <span>
              <UsersRound size={19} />
            </span>
            <small>Students</small>
            <strong>{totals.students}</strong>
            <em>Across today’s scheduled classes</em>
          </article>
          <article>
            <span>
              <ClipboardCheck size={19} />
            </span>
            <small>Marked</small>
            <strong>{totals.marked}</strong>
            <em>
              {totals.students
                ? Math.round((totals.marked * 100) / totals.students)
                : 0}
              % register coverage
            </em>
          </article>
          <article>
            <span>
              <UserCheck size={19} />
            </span>
            <small>Attending</small>
            <strong>{totals.attending}</strong>
            <em>Present, late, or half day</em>
          </article>
        </section> : null}
        <FollowupInbox context="staff" hideWithoutOpenFollowups />
        <TeacherDayPanel date={date} compact />
        {data.classes.length ? <section className="operations-panel">
          <header>
            <div>
              <span>Attendance register</span>
              <h2>Scheduled classes</h2>
            </div>
            <b>
              {submitted}/{dueClasses.length} submitted
            </b>
          </header>
          <div className="teacher-class-list">
            {data.classes.length ? (
              data.classes.map((item) => (
                <article key={item.class_section_id}>
                  <span className="teacher-class-list__time">
                    <strong>{time(item.starts_at)}</strong>
                    <small>{time(item.ends_at)}</small>
                  </span>
                  <span className="teacher-class-list__identity">
                    <strong>{item.class_name}</strong>
                    <small>
                      {item.subjects?.join(" - ") || "Published timetable"} -{" "}
                      {item.room_number || "Room pending"}
                    </small>
                  </span>
                  <span className={`submission-chip is-${item.submission_authorized === false || item.can_mark === false ? "upcoming" : item.submission_status}`}>
                    {item.submission_authorized !== false && item.submission_status === "submitted" ? (
                      <Check size={13} />
                    ) : item.submission_authorized !== false && item.submission_status === "locked" ? (
                      <LockKeyhole size={13} />
                    ) : null}
                    {item.submission_authorized === false ? "assignment mismatch" : item.can_mark === false ? "upcoming" : item.submission_status.replace("_", " ")}
                  </span>
                  <span className="teacher-class-list__counts">
                    <strong>
                      {item.marked_count}/{item.student_count}
                    </strong>
                    <small>marked</small>
                  </span>
                  {item.can_mark === false && !["submitted", "locked"].includes(item.submission_status) ? (
                    <span className="teacher-class-list__inactive">Opens on this date</span>
                  ) : (
                    <Link
                      className="operations-action-link"
                      to={`/teacher/attendance?class_section_id=${encodeURIComponent(item.class_section_id)}&date=${date}`}
                    >
                      {item.submission_authorized === false
                        ? "Resolve attendance"
                        : item.submission_status === "submitted" || item.submission_status === "locked"
                        ? "Review"
                        : "Take attendance"}
                      <ChevronRight size={17} />
                    </Link>
                  )}
                </article>
              ))
            ) : (
              <div className="operations-empty">
                <CalendarDays size={24} />
                <div>
                  <strong>No attendance due</strong>
                  <p>No scheduled lesson or accepted cover requires a class register for this date.</p>
                </div>
              </div>
            )}
          </div>
        </section> : null}
        <section className="operations-panel operations-schedule-preview">
          <header>
            <div>
              <span>Weekly view</span>
              <h2>Your timetable</h2>
            </div>
            <Link className="operations-action-link" to="/teacher/timetable">
              Open timetable <ArrowRight size={15} />
            </Link>
          </header>
          <div>
            {data.weekly_timetable.slice(0, 6).map((slot) => (
              <article key={slot.id}>
                <b>{slot.weekday_label.slice(0, 3)}</b>
                <span>
                  <strong>{slot.subject_name}</strong>
                  <small>
                    {slot.class_name} - {time(slot.starts_at)} - {slot.room}
                  </small>
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}

interface EditableRecord {
  student_id: string;
  status: AttendanceStatus | null;
  remarks: string;
}

interface AttendanceSnapshot {
  register: AttendanceRegister;
  records: Record<string, EditableRecord>;
}

type RegisterActionState =
  "idle" | "saving" | "refreshing" | "locking" | "saved" | "error";

function attendanceSnapshot(
  data: TeacherAttendanceResponse,
): AttendanceSnapshot {
  return {
    register: { ...data.register },
    records: Object.fromEntries(
      data.roster.map((student) => [
        student.id,
        {
          student_id: student.id,
          status: student.status,
          remarks: student.remarks ?? "",
        },
      ]),
    ),
  };
}

function sameRecord(
  first: EditableRecord | undefined,
  second: EditableRecord | undefined,
) {
  return (
    first?.status === second?.status &&
    first?.remarks.trim() === second?.remarks.trim()
  );
}

function recordsSignature(records: Record<string, EditableRecord>) {
  return JSON.stringify(
    Object.values(records)
      .sort((first, second) =>
        first.student_id.localeCompare(second.student_id),
      )
      .map(({ student_id, status, remarks }) => [
        student_id,
        status,
        remarks.trim(),
      ]),
  );
}

function registerSignature(register: AttendanceRegister) {
  return [
    register.state,
    register.revision,
    register.submitted_at,
    register.locked_at,
    register.reopened_at,
  ].join(":");
}

function formatRegisterMoment(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

interface TeacherAttendancePageProps {
  data: TeacherAttendanceResponse;
  date: string;
  onDateChange: (date: string) => void;
  onSave: (
    input: TeacherAttendanceSaveInput,
  ) => Promise<TeacherAttendanceResponse>;
  onRefresh: () => Promise<TeacherAttendanceResponse>;
  onLock?: () => Promise<TeacherAttendanceResponse>;
  onUnlock?: (reason: string) => Promise<TeacherAttendanceResponse>;
  onLoadHistory?: () => Promise<AttendanceRegisterHistoryResponse>;
  portal?: "teacher" | "principal";
}

export function TeacherAttendancePage({
  data,
  date,
  onDateChange,
  onSave,
  onRefresh,
  onLock,
  onUnlock,
  onLoadHistory,
  portal = "teacher",
}: TeacherAttendancePageProps) {
  const navigate = useNavigate();
  const [baseline, setBaseline] = useState<AttendanceSnapshot>(() =>
    attendanceSnapshot(data),
  );
  const [records, setRecords] = useState<Record<string, EditableRecord>>(
    () => attendanceSnapshot(data).records,
  );
  const [search, setSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<"all" | "unmarked" | "exceptions">("all");
  const [state, setState] = useState<RegisterActionState>("idle");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [reason, setReason] = useState("");
  const [unlockReason, setUnlockReason] = useState("");
  const [showUnlockReason, setShowUnlockReason] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] =
    useState<AttendanceRegisterHistoryResponse | null>(null);
  const [historyState, setHistoryState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [historyError, setHistoryError] = useState("");
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const [mergeConflicts, setMergeConflicts] = useState<string[]>([]);
  const [showPhotoAttendance, setShowPhotoAttendance] = useState(false);
  const [editing, setEditing] = useState(portal === "teacher");
  const [photoSessionId, setPhotoSessionId] = useState<string | null>(null);
  const saveAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const incomingSnapshot = useMemo(() => attendanceSnapshot(data), [data]);
  const localDirty =
    recordsSignature(records) !== recordsSignature(baseline.records);
  const incomingChanged =
    incomingSnapshot.register.revision >= baseline.register.revision &&
    registerSignature(incomingSnapshot.register) !==
    registerSignature(baseline.register);
  const usePassiveServerUpdate =
    incomingChanged && !localDirty && state !== "saving" && state !== "locking";
  const activeBaseline = usePassiveServerUpdate ? incomingSnapshot : baseline;
  const activeRecords = usePassiveServerUpdate
    ? incomingSnapshot.records
    : records;
  const dirty =
    recordsSignature(activeRecords) !==
    recordsSignature(activeBaseline.records);
  const changedCount = Object.keys(activeRecords).filter(
    (studentId) =>
      !sameRecord(activeRecords[studentId], activeBaseline.records[studentId]),
  ).length;
  const markedCount = Object.values(activeRecords).filter(
    (record) => record.status !== null,
  ).length;
  const allMarked =
    data.roster.length > 0 && markedCount === data.roster.length;
  const isLocked = activeBaseline.register.state === "locked";
  const unavailable = data.availability?.can_mark === false;
  const readOnly = isLocked || unavailable || !editing;
  const isCorrection =
    activeBaseline.register.submitted_at !== null ||
    activeBaseline.register.state !== "draft";
  const correctionReasonRequired = isCorrection && dirty;
  const busy =
    state === "saving" || state === "refreshing" || state === "locking";
  const canSubmit =
    !busy &&
    !readOnly &&
    allMarked &&
    (dirty || activeBaseline.register.state === "draft") &&
    (!correctionReasonRequired || reason.trim().length >= 3);
  const counts = Object.values(activeRecords).reduce<
    Record<AttendanceStatus, number>
  >(
    (result, record) => {
      if (record.status) result[record.status] += 1;
      return result;
    },
    { present: 0, absent: 0, late: 0, excused: 0, half_day: 0 },
  );
  const newerRegisterAvailable =
    remoteUpdate || (incomingChanged && !usePassiveServerUpdate);
  const list = data.roster.filter((student) => {
    const status = activeRecords[student.id]?.status;
    const matchesStatus = rosterFilter === "all" ||
      (rosterFilter === "unmarked" ? !status : Boolean(status && status !== "present"));
    return matchesStatus && `${student.name} ${student.roll_number} ${student.admission_number}`
      .toLowerCase().includes(search.trim().toLowerCase());
  });
  const unmarkedCount = data.roster.length - markedCount;
  const exceptionCount = markedCount - counts.present;

  const applyServerResult = (
    result: TeacherAttendanceResponse,
    message: string,
  ) => {
    const snapshot = attendanceSnapshot(result);
    setBaseline(snapshot);
    setRecords(snapshot.records);
    setReason("");
    setRemoteUpdate(false);
    setMergeConflicts([]);
    setHistory(null);
    setShowHistory(false);
    setError("");
    setStatusMessage(message);
    setState("saved");
    setPhotoSessionId(null);
    saveAttempt.current = null;
  };

  const update = (studentId: string, value: Partial<EditableRecord>) => {
    if (readOnly || busy) return;
    setBaseline(activeBaseline);
    setRecords({
      ...activeRecords,
      [studentId]: { ...activeRecords[studentId]!, ...value },
    });
    setMergeConflicts((current) => current.filter((id) => id !== studentId));
    setState("idle");
    setStatusMessage("");
    setError("");
  };

  const markAllPresent = () => {
    if (readOnly || busy) return;
    setBaseline(activeBaseline);
    setRecords(
      Object.fromEntries(
        data.roster.map((student) => [
          student.id,
          {
            ...(activeRecords[student.id] ?? {
              student_id: student.id,
              remarks: "",
            }),
            student_id: student.id,
            status: activeRecords[student.id]?.status ?? "present" as const,
          },
        ]),
      ),
    );
    setMergeConflicts([]);
    setPhotoSessionId(null);
    setState("idle");
    setStatusMessage("");
    setError("");
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!allMarked) {
      setError(
        `${data.roster.length - markedCount} students still need an attendance status.`,
      );
      setState("error");
      return;
    }
    if (correctionReasonRequired && reason.trim().length < 3) {
      setError("Add a brief reason before saving a correction.");
      setState("error");
      return;
    }
    const completeRecords = Object.values(
      activeRecords,
    ).map<TeacherAttendanceRecordInput>((record) => ({
      student_id: record.student_id,
      status: record.status!,
      remarks: record.remarks.trim(),
    }));
    const fingerprint = JSON.stringify({
      revision: activeBaseline.register.revision,
      reason: reason.trim(),
      records: completeRecords.sort((first, second) =>
        first.student_id.localeCompare(second.student_id),
      ),
    });
    if (saveAttempt.current?.fingerprint !== fingerprint) {
      saveAttempt.current = { fingerprint, key: newIdempotencyKey() };
    }
    setState("saving");
    setError("");
    setStatusMessage("");
    try {
      const result = await onSave({
        records: completeRecords,
        expected_revision: activeBaseline.register.revision,
        photo_session_id: photoSessionId ?? undefined,
        reason: reason.trim() || undefined,
        idempotency_key: saveAttempt.current.key,
      });
      applyServerResult(
        result,
        isCorrection
          ? "Attendance correction saved."
          : "Attendance register submitted.",
      );
      if (portal === "principal") setEditing(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setRemoteUpdate(true);
        setError(
          "This register changed after you opened it. Your edits are still here. Merge the latest version before retrying.",
        );
      } else if (
        requestError instanceof ApiError &&
        requestError.status === 423
      ) {
        setError(
          "This register was locked by school leadership. Your unsaved edits are still here.",
        );
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Attendance could not be submitted.",
        );
      }
      setState("error");
    }
  };

  const refreshLatest = async () => {
    setState("refreshing");
    setError("");
    try {
      const latest = await onRefresh();
      const server = attendanceSnapshot(latest);
      const merged: Record<string, EditableRecord> = {};
      const conflicts: string[] = [];
      for (const [studentId, serverRecord] of Object.entries(server.records)) {
        const originalRecord = activeBaseline.records[studentId];
        const localRecord =
          activeRecords[studentId] ?? originalRecord ?? serverRecord;
        const localChanged = !sameRecord(localRecord, originalRecord);
        const serverChanged = !sameRecord(serverRecord, originalRecord);
        if (
          localChanged &&
          serverChanged &&
          !sameRecord(localRecord, serverRecord)
        )
          conflicts.push(studentId);
        merged[studentId] = localChanged ? localRecord : serverRecord;
      }
      setBaseline(server);
      setRecords(merged);
      setRemoteUpdate(false);
      setMergeConflicts(conflicts);
      setStatusMessage(
        conflicts.length
          ? `${conflicts.length} edited ${conflicts.length === 1 ? "student was" : "students were"} also changed on the server. Your edits were kept for review.`
          : "Latest register merged. Your unsaved edits were kept.",
      );
      setState("idle");
      saveAttempt.current = null;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The latest register could not be loaded.",
      );
      setState("error");
    }
  };

  const changeRegisterLock = async (action: "lock" | "unlock") => {
    const operation = action === "lock" ? onLock : onUnlock;
    if (!operation) return;
    if (
      action === "lock" &&
      !window.confirm(
        "Lock this submitted register? Teachers will not be able to change it until a principal unlocks it.",
      )
    )
      return;
    if (action === "unlock" && unlockReason.trim().length < 3) {
      setError("Add a reason before unlocking this register.");
      setState("error");
      return;
    }
    setState("locking");
    setError("");
    try {
      const result =
        action === "lock"
          ? await onLock!()
          : await onUnlock!(unlockReason.trim());
      applyServerResult(
        result,
        action === "lock"
          ? "Register locked."
          : "Register unlocked for correction.",
      );
      setUnlockReason("");
      setShowUnlockReason(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `The register could not be ${action === "lock" ? "locked" : "unlocked"}.`,
      );
      setState("error");
    }
  };

  const loadHistory = useCallback(async () => {
    if (!onLoadHistory) return;
    setHistoryState("loading");
    setHistoryError("");
    try {
      setHistory(await onLoadHistory());
      setHistoryState("idle");
    } catch (requestError) {
      setHistoryError(
        requestError instanceof Error
          ? requestError.message
          : "Attendance history could not be loaded.",
      );
      setHistoryState("error");
    }
  }, [onLoadHistory]);

  useEffect(() => {
    if (!showHistory) return undefined;
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [incomingSnapshot.register.revision, loadHistory, showHistory]);

  const toggleHistory = () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
  };

  const confirmDiscard = () =>
    !dirty || window.confirm("Discard your unsaved attendance changes?");

  const applyPhotoReview = (
    reviewedRecords: TeacherAttendanceRecordInput[],
    sessionId: string,
  ) => {
    setBaseline(activeBaseline);
    setRecords(Object.fromEntries(reviewedRecords.map((record) => [
      record.student_id,
      {
        ...record,
        remarks: activeRecords[record.student_id]?.remarks ?? record.remarks,
      },
    ])));
    setPhotoSessionId(sessionId);
    setMergeConflicts([]);
    setRosterFilter("all");
    setState("idle");
    setError("");
    setStatusMessage("Photo review added to this draft. Submit the register to save it.");
  };
  const registerMoment = formatRegisterMoment(
    activeBaseline.register.locked_at ?? activeBaseline.register.submitted_at,
  );
  const registerStateLabel =
    activeBaseline.register.state === "draft"
      ? "Draft"
      : activeBaseline.register.state === "locked"
        ? "Locked"
        : "Submitted";
  const footerMessage =
    state === "saved" && statusMessage
      ? statusMessage
      : dirty
        ? `${markedCount}/${data.roster.length} marked. ${changedCount} unsaved ${changedCount === 1 ? "change" : "changes"}.`
        : activeBaseline.register.state === "draft"
          ? `${markedCount} of ${data.roster.length} marked`
          : "All changes saved";

  return (
    <OperationsShell
      portal={portal}
      active="attendance"
      title={`${data.class.name} attendance`}
      subtitle={`${data.class.term} - ${data.class.room}`}
      contentHasHeading
    >
      <div className="operations-stack roll-call-page">
        <section
          className="roll-call-summary"
        >
          <div className="roll-call-summary__top">
            <div className="roll-call-class-heading">
            <button
              className="roll-call-back"
              type="button"
              aria-label="Back to classes"
              onClick={() => {
                if (confirmDiscard())
                  void navigate(
                    portal === "teacher"
                      ? `/teacher/attendance?date=${date}`
                      : `/principal/attendance?date=${date}`,
                  );
              }}
            >
              <ArrowLeft size={17} />
            </button>
            <div>
              <h1>{data.class.name}</h1>
              <p><span>Attendance · {data.roster.length} students</span>{data.class.room ? <span>{/^room\b/i.test(data.class.room) ? data.class.room : `Room ${data.class.room}`}</span> : null}</p>
            </div>
            </div>
            <span
              className={`roll-call-state is-${activeBaseline.register.state}`}
            >
              {isLocked ? (
                <LockKeyhole size={14} />
              ) : (
                <ClipboardCheck size={14} />
              )}
              {registerStateLabel}
            </span>
          </div>
          <div className="roll-call-summary__context">
              <label className="roll-call-date">
                <CalendarDays size={18} aria-hidden="true" />
                <span className="sr-only">Register date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    if (event.target.value && confirmDiscard()) onDateChange(event.target.value);
                  }}
                />
              </label>
          </div>
          <div className="roll-call-totals" aria-label="Attendance status counts">
            {(["present", "absent", "late", "excused", "half_day"] as const).map((status) => (
              <div key={status} className={`is-${status}`}><strong>{counts[status]}</strong><span>{statusLabels[status]}</span></div>
            ))}
            <div className={allMarked ? "" : "is-incomplete"}><strong>{unmarkedCount}</strong><span>Unmarked</span></div>
          </div>
          {activeBaseline.register.submitted_at || portal === "principal" ? (
            <div className="roll-call-saved-details">
              <span>{activeBaseline.register.submitted_by_name ? `Submitted by ${activeBaseline.register.submitted_by_name} · ` : ""}{registerMoment ? `${isLocked ? "Locked" : "Submitted"} ${registerMoment}` : "Not submitted"} · Revision {activeBaseline.register.revision}</span>
              {portal === "principal" && onLock && onUnlock ? (
                <div className="roll-call-admin-actions" role="group" aria-label="Register management">
                  {onLoadHistory ? (
                    <button
                      type="button"
                      aria-expanded={showHistory}
                      onClick={() => void toggleHistory()}
                    >
                      <History size={17} />
                      {showHistory ? "Hide history" : "Change history"}
                    </button>
                  ) : null}
                  {isLocked ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-expanded={showUnlockReason}
                      onClick={() => {
                        setShowUnlockReason((current) => !current);
                        setError("");
                      }}
                    >
                      <UnlockKeyhole size={17} />
                      Unlock register
                    </button>
                  ) : activeBaseline.register.state === "submitted" ? (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        dirty ||
                        activeBaseline.register.state !== "submitted"
                      }
                      onClick={() => void changeRegisterLock("lock")}
                    >
                      <LockKeyhole size={17} />
                      Lock register
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {unavailable ? <section className="operations-alert is-neutral" role="status"><CalendarDays size={20} /><div><strong>Read-only date</strong><p>{data.availability?.reason}</p></div></section> : null}
        {portal === "principal" && !isLocked && !unavailable ? <section className="roll-call-review-mode"><div><strong>{editing ? "Editing register" : "Principal review"}</strong><p>{editing ? "Changes to a submitted register need a correction reason." : isCorrection ? "Check the record and its history, then lock it when reviewed." : "This class is awaiting submission. You can complete the register if needed."}</p></div><button type="button" disabled={busy} onClick={() => { if (editing) { if (!confirmDiscard()) return; setRecords(activeBaseline.records); setReason(""); setPhotoSessionId(null); } setEditing(!editing); }}>{editing ? "Cancel editing" : <><Pencil size={15} />{isCorrection ? "Make correction" : "Complete register"}</>}</button></section> : null}
        {portal === "principal" && isLocked && showUnlockReason ? (
          <section className="attendance-unlock-panel">
            <div>
              <strong>Unlock for correction</strong>
              <p>Record why this finalized register needs to be reopened.</p>
            </div>
            <label htmlFor="attendance-unlock-reason">
              Reason
              <textarea
                id="attendance-unlock-reason"
                value={unlockReason}
                minLength={3}
                maxLength={500}
                onChange={(event) => {
                  setUnlockReason(event.target.value);
                  setError("");
                }}
                placeholder="Example: Teacher reported an incorrect absence."
              />
            </label>
            <div className="attendance-unlock-panel__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowUnlockReason(false);
                  setUnlockReason("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || unlockReason.trim().length < 3}
                onClick={() => void changeRegisterLock("unlock")}
              >
                {state === "locking" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <UnlockKeyhole size={16} />
                )}
                Unlock register
              </button>
            </div>
          </section>
        ) : null}

        {portal === "principal" && showHistory ? (
          <section
            className="operations-panel attendance-history"
            aria-label="Attendance change history"
          >
            <header>
              <div>
                <span>Audit trail</span>
                <h2>Change history</h2>
              </div>
              <b>
                {history?.submissions.length ?? 0} saved{" "}
                {history?.submissions.length === 1 ? "revision" : "revisions"}
              </b>
            </header>
            {historyState === "loading" ? (
              <div className="attendance-history__state" role="status">
                <LoaderCircle className="spin" size={18} />
                Loading change history...
              </div>
            ) : null}
            {historyState === "error" ? (
              <div className="attendance-history__state is-error" role="alert">
                <AlertTriangle size={18} />
                {historyError}
                <button type="button" onClick={() => void loadHistory()}>
                  Try again
                </button>
              </div>
            ) : null}
            {historyState === "idle" && history?.submissions.length === 0 ? (
              <div className="attendance-history__state">
                <History size={18} />
                No attendance revisions have been saved for this date.
              </div>
            ) : null}
            {historyState === "idle" && history?.submissions.length ? (
              <div className="attendance-history__list">
                {history.submissions.map((submission) => {
                  const revisions = history.revisions.filter(
                    (revision) =>
                      revision.register_revision ===
                      submission.register_revision,
                  );
                  return (
                    <details key={submission.id}>
                      <summary>
                        <span>R{submission.register_revision}</span>
                        <span>
                          <strong>
                            {submission.changed_count}{" "}
                            {submission.changed_count === 1
                              ? "student record"
                              : "student records"}{" "}
                            changed
                          </strong>
                          <small>
                            {submission.submitted_by_name} -{" "}
                            {formatRegisterMoment(submission.created_at)}
                          </small>
                        </span>
                        <b>{submission.records_count} reviewed</b>
                      </summary>
                      <div>
                        {revisions.length ? (
                          revisions.map((revision) => (
                            <article key={revision.id}>
                              <span>
                                <strong>{revision.student_name}</strong>
                                <small>{revision.changed_by_name}</small>
                              </span>
                              <span className="attendance-history__change">
                                <b>
                                  {revision.previous_status
                                    ? statusLabels[revision.previous_status]
                                    : "Not marked"}
                                </b>
                                <ArrowRight size={14} />
                                <b>{statusLabels[revision.new_status]}</b>
                              </span>
                              <span>
                                <small>Reason</small>
                                <strong>{revision.reason}</strong>
                              </span>
                            </article>
                          ))
                        ) : (
                          <p>No attendance values changed in this save.</p>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {newerRegisterAvailable ? (
          <section
            className="operations-alert attendance-sync-alert"
            role="status"
          >
            <AlertTriangle size={20} />
            <div>
              <strong>A newer register is available</strong>
              <p>
                Your unsaved edits are still here. Merge the latest version
                before submitting again.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshLatest()}
            >
              <RefreshCw
                className={state === "refreshing" ? "spin" : ""}
                size={16}
              />
              Merge latest
            </button>
          </section>
        ) : null}
        {mergeConflicts.length ? (
          <section
            className="operations-alert attendance-sync-alert"
            role="alert"
          >
            <AlertTriangle size={20} />
            <div>
              <strong>
                Review {mergeConflicts.length} concurrent{" "}
                {mergeConflicts.length === 1 ? "change" : "changes"}
              </strong>
              <p>
                Highlighted students changed both here and on the server. Your
                local choices are still selected.
              </p>
            </div>
          </section>
        ) : null}
        {isLocked ? (
          <section className="operations-alert is-neutral" role="status">
            <LockKeyhole size={20} />
            <div>
              <strong>This register is locked</strong>
              <p>
                Attendance remains read-only until a principal unlocks it for
                correction.
              </p>
            </div>
          </section>
        ) : null}

        {photoSessionId ? (
          <section className="photo-draft-notice" role="status">
            <Camera size={19} />
            <div>
              <strong>Photo review added to this draft</strong>
              <p>The reviewed marks are not saved until you submit the class register.</p>
            </div>
            <button type="button" onClick={() => setShowPhotoAttendance(true)}>
              Review again
            </button>
          </section>
        ) : null}

        <section className="roll-call-register" aria-labelledby="roll-call-heading">
          <header className="roll-call-toolbar">
            <div className="roll-call-toolbar__title">
              <h2 id="roll-call-heading">Class register</h2>
              {editing ? <div className="roll-call-toolbar__actions">
                <button className="roll-call-photo" type="button" disabled={busy || readOnly} onClick={() => setShowPhotoAttendance(true)}>
                  <Camera size={17} /> Take from photo
                </button>
                <button className="roll-call-mark-all" type="button" disabled={busy || readOnly || allMarked} onClick={markAllPresent}>
                  <CheckCircle2 size={17} /> {markedCount && !allMarked ? "Mark remaining present" : "Mark all present"}
                </button>
              </div> : null}
            </div>
            <label className="roll-call-search">
              <Search size={18} />
              <input
                aria-label="Search student or roll number"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or roll number"
              />
            </label>
            <div className="roll-call-filters" role="group" aria-label="Filter students">
              {([
                ["all", "All students", data.roster.length],
                ["unmarked", "Not marked", unmarkedCount],
                ["exceptions", "Exceptions", exceptionCount],
              ] as const).map(([value, label, count]) => (
                <button key={value} type="button" aria-pressed={rosterFilter === value} onClick={() => setRosterFilter(value)}>{label}<span>{count}</span></button>
              ))}
            </div>
          </header>
          <div className="roll-call-roster">
            {list.map((student) => {
              const record = activeRecords[student.id];
              const hasConflict = mergeConflicts.includes(student.id);
              return (
                <AttendanceStudentRow
                  key={student.id}
                  student={student}
                  status={record?.status ?? null}
                  remarks={record?.remarks ?? ""}
                    disabled={busy || readOnly}
                  conflict={hasConflict}
                  onChange={(value) => update(student.id, value)}
                />
              );
            })}
            {list.length === 0 ? <div className="roll-call-empty"><Search size={24} /><h3>{data.roster.length === 0 ? "No students enrolled" : "No students to show"}</h3><p>{search ? "Try a different name or roll number." : rosterFilter === "unmarked" ? "Every student has been marked." : "There are no students in this view."}</p>{search || rosterFilter !== "all" ? <button type="button" onClick={() => { setSearch(""); setRosterFilter("all"); }}>Show all students</button> : null}</div> : null}
          </div>
          {correctionReasonRequired ? (
            <div className="attendance-correction-reason">
              <label htmlFor="attendance-correction-reason">
                Reason for correction
              </label>
              <textarea
                id="attendance-correction-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setState("idle");
                  setError("");
                }}
                minLength={3}
                maxLength={500}
                placeholder="Explain why the submitted register needs to change."
              />
              <small>
                This reason is stored in the attendance audit history.
              </small>
            </div>
          ) : null}
        </section>
        {showPhotoAttendance ? (
          <PhotoAttendanceDialog
            classSectionId={data.class.id}
            date={date}
            portal={portal}
            onClose={() => setShowPhotoAttendance(false)}
            onApply={applyPhotoReview}
          />
        ) : null}
        <CreateAttendanceFollowup students={data.roster} date={date} />
          <footer className="roll-call-submit-bar">
            <div className="roll-call-submit-bar__inner">
            <div className="roll-call-progress">
            <span
              className={state === "error" ? "is-error" : ""}
              aria-live="polite"
            >
              {state === "saved" ? <Check size={15} /> : null}
              {state === "saved" && statusMessage ? statusMessage : readOnly ? isLocked ? "Locked register · Read only" : unavailable ? "Read-only date" : "Reviewing class register" : footerMessage}
            </span>
            <progress value={markedCount} max={data.roster.length || 1} aria-label="Students marked" />
            </div>
            {readOnly ? <Link className="roll-call-review-return" to={`/${portal}/attendance?date=${date}`}>All classes <ArrowRight size={16} /></Link> : <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void save()}
            >
              {state === "saving" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Save size={17} />
              )}
              {state === "saving"
                ? "Saving register..."
                : isCorrection
                  ? "Save correction"
                  : "Submit register"}
            </button>}
            </div>
          {state === "error" ? (
            <p className="operations-error" role="alert">
              {error}
            </p>
          ) : null}
          </footer>
      </div>
    </OperationsShell>
  );
}

export function TeacherTimetablePage({ data }: { data: TeacherHomeResponse }) {
  const days = useMemo(() => {
    const grouped = new Map<string, TeacherHomeResponse["weekly_timetable"]>();
    for (const slot of data.weekly_timetable)
      grouped.set(slot.weekday_label, [
        ...(grouped.get(slot.weekday_label) ?? []),
        slot,
      ]);
    return [...grouped.entries()];
  }, [data.weekly_timetable]);
  return (
    <OperationsShell
      portal="teacher"
      active="timetable"
      title="My weekly timetable"
      subtitle={`${data.teacher.name} - Published schedule`}
    >
      <div className="operations-stack">
        <section className="operations-hero">
          <div>
            <span>Weekly teaching plan</span>
            <h2>{data.weekly_timetable.length} scheduled periods</h2>
            <p>
              Your live school timetable, grouped by teaching day and ordered by
              period.
            </p>
          </div>
        </section>
        <section className="teacher-week-grid">
          {days.map(([day, slots]) => (
            <article className="operations-panel" key={day}>
              <header>
                <div>
                  <span>Teaching day</span>
                  <h2>{day}</h2>
                </div>
                <b>{slots.length} periods</b>
              </header>
              <div>
                {slots.map((slot) => (
                  <section key={slot.id}>
                    <span>
                      <small>P{slot.period_number}</small>
                      <strong>{time(slot.starts_at)}</strong>
                    </span>
                    <i />
                    <span>
                      <strong>{slot.subject_name}</strong>
                      <small>
                        {slot.class_name} - {slot.room || "Room pending"}
                      </small>
                    </span>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </OperationsShell>
  );
}
