import { ThatCampusLoadingIcon as LoaderCircle } from "../../components/ThatCampusLoader";
import { useOptionalAuth } from "../auth/AuthContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, Camera, Cloud, CloudOff, FileInput, History, LockKeyhole, Pencil, RefreshCw, Save, Search, UnlockKeyhole, X } from "lucide-react";
import type { AttendanceCaptureSource, AttendanceRegister, AttendanceRegisterHistoryResponse, AttendanceStatus, TeacherAttendanceRecordInput, TeacherAttendanceResponse, TeacherAttendanceSaveInput } from "../operations/api";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import type { AttendanceWorkspaceResponsibility } from "../../pages/operations/AttendanceWorkspacePage";
import { CreateAttendanceFollowup } from "../coordination/CreateAttendanceFollowup";
import { AttendanceParticipantRow } from "./AttendanceParticipantRow";
import { PhotoAttendanceDialog } from "../../pages/operations/PhotoAttendanceDialog";
import { AttendanceDateControl } from "./AttendanceDateControl";
import { registerLifecycleLabel } from "./registerLifecycle";
import { useUnsavedChangesGuard, type UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { AttendanceRegisterView, AttendanceRegisterHeader, AttendanceRegisterProgress, AttendanceRegisterTools, AttendanceRegisterRoster, AttendanceRegisterFooter } from "./AttendanceRegisterView";
import "./academic-register.css";

function time(value: string | null) {
  if (!value) return "No lesson";
  const [hour = "0", minute = "00"] = value.split(":");
  const numeric = Number(hour);
  return `${numeric % 12 || 12}:${minute} ${numeric >= 12 ? "PM" : "AM"}`;
}

const statusLabels: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", late: "Late", excused: "Excused", half_day: "Half day",
};

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

interface AcademicAttendanceRegisterProps {
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
  onDecideEvidence?: (
    evidenceId: string,
    input: { decision: "accepted" | "rejected"; note: string; expected_revision: number; idempotency_key: string },
  ) => Promise<TeacherAttendanceResponse>;
  portal?: "teacher" | "principal";
  /** Canonical Attendance routes pass an explicit responsibility surface. */
  responsibility?: AttendanceWorkspaceResponsibility;
  /** The responsibility-composed Attendance Area owns the single shell. */
  embedded?: boolean;
  /** Explicit capability projection for photo capture/reference setup. */
  photoCaptureAllowed?: boolean;
  initialCaptureSource?: AttendanceCaptureSource;
  initialStudentId?: string;
  onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void;
}

export function AcademicAttendanceRegister({
  data,
  date,
  onDateChange,
  onSave,
  onRefresh,
  onLock,
  onUnlock,
  onLoadHistory,
  onDecideEvidence,
  portal = "teacher",
  responsibility,
  embedded = false,
  photoCaptureAllowed,
  initialCaptureSource = "live_app",
  initialStudentId,
  onBeforeLeaveChange,
}: AcademicAttendanceRegisterProps) {
  const [baseline, setBaseline] = useState<AttendanceSnapshot>(() =>
    attendanceSnapshot(data),
  );
  const [records, setRecords] = useState<Record<string, EditableRecord>>(
    () => attendanceSnapshot(data).records,
  );
  const [search, setSearch] = useState(() => data.roster.find(student => student.id === initialStudentId)?.admission_number ?? "");
  const [rosterFilter, setRosterFilter] = useState<"all" | "unmarked" | "exceptions">("all");
  const [toolsOpen, setToolsOpen] = useState(Boolean(initialStudentId) || data.roster.length > 8);
  const [bulkReview, setBulkReview] = useState(false);
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
  const coordinatesAttendance = responsibility ? responsibility === "coordinate" : portal === "principal";
  const [editing, setEditing] = useState(!coordinatesAttendance || initialCaptureSource !== "live_app");
  const [photoSessionId, setPhotoSessionId] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<AttendanceCaptureSource>(initialCaptureSource);
  const [sourceReference, setSourceReference] = useState("");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [pendingEvidence, setPendingEvidence] = useState(() => data.pending_evidence ?? []);
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});
  const [evidenceBusy, setEvidenceBusy] = useState<string | null>(null);
  const saveAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const incomingSnapshot = useMemo(() => attendanceSnapshot(data), [data]);
  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);
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
  const awaitingAutomaticFinalization = activeBaseline.register.state === "submitted" && Boolean(activeBaseline.register.auto_finalize_at);
  const unavailable = data.availability?.can_mark === false;
  const capturePending = data.latest_capture?.status === "pending";
  const captureNeedsReview = data.latest_capture?.status === "quarantined";
  const roleAuth=useOptionalAuth();
  const roleMember=roleAuth?.memberships.find(m=>m.role==='staff');
  // The server remains authoritative. During auth bootstrap (and isolated
  // component tests) the calculated permission projection can be absent, so
  // only apply the client-side restriction once that projection is present.
  const hasCalculatedAccess=Array.isArray(roleMember?.permissions);
  const legacyPersonaPresentation = responsibility === undefined;
  const roleReadOnly=legacyPersonaPresentation && portal==='teacher' && hasCalculatedAccess && !roleMember.permissions?.includes('attendance.record');
  const photoChannelEnabled = data.attendance_scope !== "scheduled_session" || Boolean(data.capture_policy?.channels.includes("camera_assisted"));
  const canUsePhoto=photoChannelEnabled && (photoCaptureAllowed ?? (coordinatesAttendance || !hasCalculatedAccess || roleMember.permissions?.includes('photo.use')));
  const readOnly = roleReadOnly || isLocked || unavailable || !editing || (captureNeedsReview && !coordinatesAttendance);
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
    (!capturePending || dirty) &&
    (!(["paper", "office"] as AttendanceCaptureSource[]).includes(captureSource) || sourceReference.trim().length >= 3) &&
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
    setPendingEvidence(result.pending_evidence ?? []);
    saveAttempt.current = null;
  };

  const decideEvidence = async (evidenceId: string, decision: "accepted" | "rejected") => {
    if (!onDecideEvidence || evidenceBusy) return;
    if (dirty) {
      setError("Save or discard your register edits before reviewing a check-in.");
      return;
    }
    const note = evidenceNotes[evidenceId]?.trim() ?? "";
    if (note.length < 3) {
      setError("Add a brief verification note before deciding this check-in.");
      return;
    }
    setEvidenceBusy(evidenceId);
    setError("");
    try {
      const result = await onDecideEvidence(evidenceId, {
        decision,
        note,
        expected_revision: activeBaseline.register.revision,
        idempotency_key: newIdempotencyKey(),
      });
      setEvidenceNotes((current) => {
        const next = { ...current };
        delete next[evidenceId];
        return next;
      });
      applyServerResult(result, decision === "accepted" ? "Check-in accepted and attendance updated." : "Check-in rejected. The register was not changed.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The check-in decision could not be saved.");
      setState("error");
    } finally {
      setEvidenceBusy(null);
    }
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
        `${data.roster.length - markedCount} ${data.roster.length - markedCount === 1 ? "student still needs" : "students still need"} an attendance status.`,
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
      source: captureSource,
      source_reference: sourceReference.trim(),
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
        source: coordinatesAttendance ? captureSource : undefined,
        source_reference: coordinatesAttendance ? sourceReference.trim() : undefined,
      });
      const continuityMessage = result.latest_capture?.status === "pending"
        ? "Saved securely on this device. It has not reached the school register yet."
        : result.latest_capture?.status === "quarantined"
          ? "Observation received and held for attendance-desk review."
          : result.latest_capture?.status === "rejected"
            ? "The observation was rejected. Review it with the attendance desk."
            : null;
      applyServerResult(
        result,
        continuityMessage ?? (isCorrection
          ? "Attendance correction saved."
          : "Attendance register submitted."),
      );
      if (coordinatesAttendance && result.latest_capture?.status !== "quarantined") setEditing(false);
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
          "This register was finalized by school leadership. Your unsaved edits are still here.",
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
        "Finalize this submitted register? Teachers will not be able to change it until a principal reopens it for correction.",
      )
    )
      return;
    if (action === "unlock" && unlockReason.trim().length < 3) {
      setError("Add a reason before reopening this register.");
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
          ? "Register finalized."
          : "Register reopened for correction.",
      );
      setUnlockReason("");
      setShowUnlockReason(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `The register could not be ${action === "lock" ? "finalized" : "reopened"}.`,
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

  const confirmDiscard = useUnsavedChangesGuard(
    dirty,
    "Discard your unsaved attendance changes?",
  );
  useEffect(() => {
    onBeforeLeaveChange?.(confirmDiscard);
    return () => onBeforeLeaveChange?.(null);
  }, [confirmDiscard, onBeforeLeaveChange]);

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
  const automaticFinalizationMoment = formatRegisterMoment(activeBaseline.register.auto_finalize_at ?? null);
  const registerStateLabel = registerLifecycleLabel(activeBaseline.register.state);
  const footerMessage =
    state === "saved" && statusMessage
      ? statusMessage
      : dirty
        ? `${markedCount}/${data.roster.length} marked. ${changedCount} unsaved ${changedCount === 1 ? "change" : "changes"}.`
        : activeBaseline.register.state === "draft"
          ? `${markedCount} of ${data.roster.length} marked`
          : "All changes saved";
  const snapshotExpiry = formatRegisterMoment(data.continuity_snapshot.expires_at);

  const content = <AttendanceRegisterView>
        <AttendanceRegisterHeader
          title={data.session?.subject_name ?? data.class.name}
          context={[data.session ? `${data.class.name} · Period ${data.session.period_number} · ${time(data.session.starts_at)}–${time(data.session.ends_at)}` : `${data.roster.length} ${data.roster.length === 1 ? "student" : "students"}`, data.class.room ? /^room\b/i.test(data.class.room) ? data.class.room : `Room ${data.class.room}` : ""].filter(Boolean).join(" · ")}
          state={registerStateLabel}
          action={coordinatesAttendance && onLoadHistory ? <button type="button" aria-expanded={showHistory} onClick={toggleHistory}><History size={17} />{showHistory ? "Hide history" : "Change history"}</button> : undefined}
        />
        <AttendanceDateControl date={date} onChange={next => { if (!confirmDiscard()) return false; onDateChange(next); }} />
        <AttendanceRegisterProgress recorded={markedCount} total={data.roster.length}>
          <button type="button" className="attendance-register-action attendance-register-action--text" aria-expanded={toolsOpen} aria-controls="academic-attendance-tools" onClick={() => {
            if (toolsOpen) { setSearch(""); setRosterFilter("all"); }
            setToolsOpen(!toolsOpen);
          }}><Search size={17} />{toolsOpen ? "Hide find & filter" : "Find & filter"}</button>
          {editing ? <>
            {canUsePhoto ? <button className="attendance-register-action" type="button" disabled={busy || readOnly} onClick={() => setShowPhotoAttendance(true)}><Camera size={17} />Take from photo</button> : null}
            <button className="attendance-register-action" type="button" disabled={busy || readOnly || allMarked} onClick={() => setBulkReview(true)}><CheckCircle2 size={17} />{markedCount && !allMarked ? "Mark remaining present" : "Mark all present"}</button>
          </> : null}
        </AttendanceRegisterProgress>
        <details className="attendance-register-options">
          <InfoSummary>Register details</InfoSummary>
          <div>
            <p aria-label="Attendance status counts">{(data.attendance_scope === "scheduled_session" ? ["present", "absent", "late", "excused"] as const : ["present", "absent", "late", "excused", "half_day"] as const).map(status => `${counts[status]} ${statusLabels[status].toLowerCase()}`).join(" · ")} · {unmarkedCount} not recorded</p>
            <p>{activeBaseline.register.submitted_by_name ? `${isLocked ? "Finalized" : "Submitted"} by ${activeBaseline.register.submitted_by_name} · ` : ""}{registerMoment ? `${isLocked ? "Final" : "Submitted"} ${registerMoment}` : "Not submitted"}{!isLocked && automaticFinalizationMoment ? ` · Finalizes automatically ${automaticFinalizationMoment}` : ""} · Revision {activeBaseline.register.revision}</p>
            {data.attendance_scope !== "scheduled_session" && online && !data.latest_capture ? <p>This roster is cached securely for connection interruptions until {snapshotExpiry ?? "the snapshot expires"}.</p> : null}
          </div>
        </details>
        {coordinatesAttendance && onLock && onUnlock ? <div className="attendance-register-management" role="group" aria-label="Register management">
          {isLocked ? <button className="attendance-register-action" type="button" disabled={busy} aria-expanded={showUnlockReason} onClick={() => { setShowUnlockReason(current => !current); setError(""); }}><UnlockKeyhole size={17} />Reopen for correction</button> : activeBaseline.register.state === "submitted" && !activeBaseline.register.auto_finalize_at ? <button className="attendance-register-action" type="button" disabled={busy || dirty} onClick={() => void changeRegisterLock("lock")}><LockKeyhole size={17} />Finalize register</button> : null}
        </div> : null}

        {data.attendance_scope === "scheduled_session" && pendingEvidence.length ? (
          <section className="operations-panel attendance-evidence-review" aria-labelledby="attendance-evidence-review-heading">
            <header>
              <div>
                <span>Student check-ins</span>
                <h2 id="attendance-evidence-review-heading">Review before recording</h2>
              </div>
              <b>{pendingEvidence.length} pending</b>
            </header>
            <p>These observations stay separate from the register until an authorized staff member decides them.</p>
            <div className="attendance-evidence-review__list">
              {pendingEvidence.map((evidence) => (
                <article key={evidence.id}>
                  <div>
                    <strong>{evidence.student_name}</strong>
                    <small>{evidence.admission_number} · {evidence.capture_channel === "student_qr" ? "QR check-in" : evidence.capture_channel.replaceAll("_", " ")}</small>
                  </div>
                  <label>
                    Verification note
                    <input
                      value={evidenceNotes[evidence.id] ?? ""}
                      maxLength={500}
                      disabled={evidenceBusy === evidence.id}
                      onChange={(event) => setEvidenceNotes((current) => ({ ...current, [evidence.id]: event.target.value }))}
                      placeholder="Example: Student verified in class"
                    />
                  </label>
                  <div className="attendance-evidence-review__actions">
                    <button type="button" disabled={Boolean(evidenceBusy) || dirty} onClick={() => void decideEvidence(evidence.id, "rejected")}>
                      <X size={15} /> Reject
                    </button>
                    <button className="is-primary" type="button" disabled={Boolean(evidenceBusy) || dirty} onClick={() => void decideEvidence(evidence.id, "accepted")}>
                      {evidenceBusy === evidence.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Accept present
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {data.attendance_scope !== "scheduled_session" && (!online || data.latest_capture && ["pending", "quarantined", "rejected"].includes(data.latest_capture.status)) ? <section className={`attendance-continuity-status${!online ? " is-offline" : data.latest_capture?.status === "quarantined" ? " needs-review" : ""}`} role="status" aria-live="polite">
          {!online ? <CloudOff size={20} /> : data.latest_capture?.status === "quarantined" ? <AlertTriangle size={20} /> : <Cloud size={20} />}
          <div>
            <strong>{!online ? "Working offline" : data.latest_capture?.status === "pending" ? "Saved on this device — not submitted" : data.latest_capture?.status === "quarantined" ? "Attendance-desk review required" : "Observation rejected"}</strong>
            <p>{!online ? `Changes are encrypted on this device and will sync automatically. The downloaded roster is valid until ${snapshotExpiry ?? "its displayed expiry"}.` : data.latest_capture?.status === "pending" ? "Keep this device signed in. Sync will retry automatically when the connection returns." : data.latest_capture?.status === "quarantined" ? "The observation is preserved, but family attendance has not been changed." : "The observation was rejected. Review it with the attendance desk."}</p>
          </div>
        </section> : null}

        {unavailable ? <section className="operations-alert is-neutral" role="status"><CalendarDays size={20} /><div><strong>Read-only date</strong><p>{data.availability?.reason}</p></div></section> : null}
        {coordinatesAttendance && !isLocked && !unavailable ? <section className="roll-call-review-mode"><div><strong>{editing ? "Editing register" : awaitingAutomaticFinalization ? "Finalization scheduled" : responsibility ? "Register review" : "Principal review"}</strong></div><button type="button" disabled={busy} onClick={() => { if (editing) { if (!confirmDiscard()) return; setRecords(activeBaseline.records); setReason(""); setPhotoSessionId(null); } setEditing(!editing); }}>{editing ? "Cancel editing" : <><Pencil size={15} />{isCorrection ? "Make correction" : "Complete register"}</>}</button></section> : null}
        {coordinatesAttendance && editing && !isLocked && !unavailable ? <section className="attendance-capture-source" aria-labelledby="attendance-capture-source-heading">
          <div><FileInput size={20} /><span><strong id="attendance-capture-source-heading">Observation source</strong><small>The source remains attached to every attendance revision.</small></span></div>
          <div role="group" aria-label="Attendance observation source">{(["live_app", "paper", "office"] as const).map((source) => <button type="button" key={source} aria-pressed={captureSource === source} onClick={() => { setCaptureSource(source); setSourceReference(""); }}>{source === "live_app" ? "Live register" : source === "paper" ? "Paper sheet" : "Office entry"}</button>)}</div>
          {captureSource !== "live_app" ? <label>Source reference<input value={sourceReference} maxLength={160} onChange={(event) => setSourceReference(event.target.value)} placeholder={captureSource === "paper" ? "Example: Register book 7A, page 42" : "Example: Reception call log 184"} /><small>This entry will go to reconciliation before it changes published attendance.</small></label> : null}
        </section> : null}
        {coordinatesAttendance && isLocked && showUnlockReason ? (
          <section className="attendance-unlock-panel">
            <div>
              <strong>Reopen for correction</strong>
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
                Reopen register
              </button>
            </div>
          </section>
        ) : null}

        {coordinatesAttendance && showHistory ? (
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
                            {formatRegisterMoment(submission.created_at)} · {(submission.capture_source ?? "live_app").replace("_", " ")}
                            {submission.source_reference ? ` · ${submission.source_reference}` : ""}
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
              {state === "refreshing" ? <LoaderCircle size={16} /> : <RefreshCw size={16} />}
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
              <strong>This register is final</strong>
              <p>
                Attendance remains read-only until a principal reopens it for correction.
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

        <section aria-label="Class register">
          {toolsOpen ? <AttendanceRegisterTools id="academic-attendance-tools">
            <label>
              <span className="sr-only">Search student or roll number</span>
              <input
                type="search"
                aria-label="Search student or roll number"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Name or roll number"
              />
            </label>
            <select aria-label="Filter students" value={rosterFilter} onChange={event => setRosterFilter(event.target.value as typeof rosterFilter)}>
              {([
                ["all", "All students", data.roster.length],
                ["unmarked", "Not marked", unmarkedCount],
                ["exceptions", "Exceptions", exceptionCount],
              ] as const).map(([value, label, count]) => <option key={value} value={value}>{label} {count}</option>)}
            </select>
            {search ? <button className="attendance-register-action attendance-register-action--text" type="button" onClick={() => { setSearch(""); setRosterFilter("all"); }}>Clear search</button> : null}
          </AttendanceRegisterTools> : null}
          <AttendanceRegisterRoster>
            {list.map((student) => {
              const record = activeRecords[student.id];
              const hasConflict = mergeConflicts.includes(student.id);
              return (
                <AttendanceParticipantRow
                  key={student.id}
                  participant={{ ...student, identifier: student.admission_number }}
                  status={record?.status ?? null}
                  remarks={record?.remarks ?? ""}
                    disabled={busy || readOnly}
                  conflict={hasConflict}
                  statusOptions={data.attendance_scope === "scheduled_session" ? ([
                    { value: "present", label: "Present", tone: "positive" },
                    { value: "absent", label: "Absent", tone: "negative" },
                    { value: "late", label: "Late" },
                    { value: "excused", label: "Excused" },
                  ] as const) : undefined}
                  onChange={(value) => update(student.id, value)}
                />
              );
            })}
            {list.length === 0 ? <div className="roll-call-empty"><Search size={24} /><h3>{data.roster.length === 0 ? "No students enrolled" : "No students to show"}</h3><p>{search ? "Try a different name or roll number." : rosterFilter === "unmarked" ? "Every student has been marked." : "There are no students in this view."}</p>{search || rosterFilter !== "all" ? <button type="button" onClick={() => { setSearch(""); setRosterFilter("all"); }}>Show all students</button> : null}</div> : null}
          </AttendanceRegisterRoster>
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
        {bulkReview ? <PlannerDialog title="Mark remaining students present?" onClose={() => setBulkReview(false)}>
          <div className="activity-form">
            <p>This marks the {unmarkedCount} unrecorded {unmarkedCount === 1 ? "student" : "students"} in this register, including anyone hidden by Find & filter. Existing decisions stay unchanged.</p>
            <button className="attendance-register-action attendance-register-action--primary" type="button" disabled={busy || readOnly || allMarked} onClick={() => { markAllPresent(); setBulkReview(false); }}>Mark {unmarkedCount} present in draft</button>
          </div>
        </PlannerDialog> : null}
        {showPhotoAttendance ? (
          <PhotoAttendanceDialog
            classSectionId={data.class.id}
            date={date}
            sessionId={data.session?.id}
            periodLabel={data.session ? `${data.session.subject_name} · Period ${data.session.period_number}` : undefined}
            portal={coordinatesAttendance ? "principal" : "teacher"}
            onClose={() => setShowPhotoAttendance(false)}
            onApply={applyPhotoReview}
          />
        ) : null}
        <CreateAttendanceFollowup students={data.roster} date={date} />
        <AttendanceRegisterFooter status={<><span className={state === "error" ? "is-error" : ""}>
          {state === "saved" ? <Check size={15} aria-hidden="true" /> : null}
          {state === "saved" && statusMessage ? statusMessage : readOnly ? isLocked ? "Final register · Read only" : unavailable ? "Read-only date" : awaitingAutomaticFinalization ? "Submitted · Finalization scheduled" : "Reviewing class register" : footerMessage}
        </span>{state === "error" ? <span className="operations-error" role="alert">{error}</span> : null}</>}>
          {readOnly ? <Link className="attendance-register-action attendance-register-action--text" to={responsibility ? `/areas/attendance/${responsibility === "coordinate" ? "coordination" : "registers"}?date=${date}` : `/${portal}/attendance?date=${date}`}>All classes <ArrowRight size={16} /></Link> : <button
            className="attendance-register-action attendance-register-action--primary"
            type="button"
            disabled={!canSubmit}
            onClick={() => void save()}
          >
            {state === "saving" ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {state === "saving" ? online ? "Saving register..." : "Saving on device..." : coordinatesAttendance && captureSource !== "live_app" ? "Send for review" : !online ? "Save on device" : isCorrection ? "Save correction" : "Submit register"}
          </button>}
        </AttendanceRegisterFooter>
      </AttendanceRegisterView>;
  if (embedded) return content;
  return <OperationsShell
    portal={portal}
    active="attendance"
    title={data.session ? `${data.session.subject_name} attendance` : `${data.class.name} attendance`}
    subtitle={data.session ? `${data.class.name} · Period ${data.session.period_number} · ${time(data.session.starts_at)}–${time(data.session.ends_at)}` : `${data.class.term} - ${data.class.room}`}
    backTo={responsibility
      ? `/areas/attendance/${responsibility === "coordinate" ? "coordination" : "registers"}?date=${date}`
      : portal === "teacher"
        ? `/teacher/attendance?date=${date}`
        : `/principal/attendance?date=${date}`}
    beforeBack={confirmDiscard}
  >{content}</OperationsShell>;
}
