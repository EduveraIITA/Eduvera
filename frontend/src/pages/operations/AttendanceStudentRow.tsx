import { useState } from "react";
import { Check, ChevronDown, MessageSquareText, X } from "lucide-react";
import type { AttendanceStatus, TeacherAttendanceResponse } from "../../features/operations/api";

const labels: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", late: "Late", excused: "Excused", half_day: "Half day",
};

export function AttendanceStudentRow({ student, status, remarks, disabled, conflict, onChange }: {
  student: TeacherAttendanceResponse["roster"][number];
  status: AttendanceStatus | null;
  remarks: string;
  disabled: boolean;
  conflict: boolean;
  onChange: (value: { status?: AttendanceStatus | null; remarks?: string }) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const isOther = status !== null && status !== "present" && status !== "absent";
  const showNote = noteOpen;
  const noteId = `attendance-note-${student.id}`;

  return (
    <article className={`roll-call-student${conflict ? " has-conflict" : ""}`} aria-label={student.name}>
      <div className="roll-call-student__identity">
        <span className="roll-call-avatar" aria-hidden="true">
          {student.avatar_url && failedAvatar !== student.avatar_url ? (
            <img src={student.avatar_url} alt="" loading="lazy" onError={() => setFailedAvatar(student.avatar_url)} />
          ) : student.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}
        </span>
        <div>
          <h3>{student.name}</h3>
          <p><span>Roll {String(student.roll_number).padStart(2, "0")}</span><span>{student.admission_number}</span></p>
          {conflict ? <small className="roll-call-conflict">Review concurrent change</small> : null}
        </div>
      </div>
      <button
        type="button"
        className={`roll-call-note-toggle${remarks ? " has-note" : ""}`}
        aria-label={`${showNote ? "Hide" : remarks ? "View" : "Add"} note for ${student.name}`}
        aria-expanded={showNote}
        aria-controls={showNote ? noteId : undefined}
        disabled={disabled && !remarks}
        onClick={() => setNoteOpen((open) => !open)}
      >
        <MessageSquareText size={18} />
      </button>
      <div className="roll-call-choices" role="group" aria-label={`Mark attendance for ${student.name}`}>
        <button type="button" className="roll-call-choice is-present" aria-pressed={status === "present"} disabled={disabled} onClick={() => onChange({ status: "present" })}>
          <Check size={16} /><span>Present</span>
        </button>
        <button type="button" className="roll-call-choice is-absent" aria-pressed={status === "absent"} disabled={disabled} onClick={() => onChange({ status: "absent" })}>
          <X size={16} /><span>Absent</span>
        </button>
        <div className={`roll-call-other${isOther ? ` is-selected is-${status}` : ""}${disabled ? " is-disabled" : ""}`}>
          <span aria-hidden="true">{isOther ? labels[status] : "More"}<ChevronDown size={14} /></span>
          <select
            aria-label={`Attendance status for ${student.name}`}
            disabled={disabled}
            value={status ?? ""}
            onChange={(event) => onChange({ status: event.target.value ? event.target.value as AttendanceStatus : null })}
          >
            <option value="">Not marked</option>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      {showNote ? (
        <label className="roll-call-note" id={noteId}>
          <span>Attendance note</span>
          <input autoFocus={noteOpen} disabled={disabled} aria-label={`Attendance remark for ${student.name}`} value={remarks} maxLength={500} placeholder="Add a short note (optional)" onChange={(event) => onChange({ remarks: event.target.value })} />
        </label>
      ) : null}
    </article>
  );
}
