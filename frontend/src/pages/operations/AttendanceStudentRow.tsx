import { Children, useState, type ReactNode } from "react";
import { Check, ChevronDown, MessageSquareText, X } from "lucide-react";
import type { AttendanceStatus, TeacherAttendanceResponse } from "../../features/operations/api";

const labels: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", late: "Late", excused: "Excused", half_day: "Half day",
};

export interface AttendanceStudentRowStatusOption<TStatus extends string> {
  value: TStatus;
  label: string;
  tone?: "positive" | "negative";
}

interface AttendanceStudentIdentity {
  id: TeacherAttendanceResponse["roster"][number]["id"];
  name: TeacherAttendanceResponse["roster"][number]["name"];
  admission_number: TeacherAttendanceResponse["roster"][number]["admission_number"];
  avatar_url: TeacherAttendanceResponse["roster"][number]["avatar_url"] | null;
  roll_number?: TeacherAttendanceResponse["roster"][number]["roll_number"] | null;
}

export function AttendanceStudentRow<TStatus extends string = AttendanceStatus>({
  student,
  status,
  remarks,
  disabled,
  conflict,
  context,
  attention,
  children,
  statusOptions,
  quickStatuses,
  allowEmpty = true,
  emptyLabel = "Not marked",
  noteLabel = "Attendance note",
  onChange,
}: {
  student: AttendanceStudentIdentity;
  status: TStatus | null;
  remarks: string;
  disabled: boolean;
  conflict: boolean;
  context?: string;
  attention?: ReactNode;
  children?: ReactNode;
  statusOptions?: readonly AttendanceStudentRowStatusOption<TStatus>[];
  quickStatuses?: readonly AttendanceStudentRowStatusOption<TStatus>[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  noteLabel?: string;
  onChange: (value: { status?: TStatus | null; remarks?: string }) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const options = statusOptions ?? Object.entries(labels).map(([value, label]) => ({ value: value as TStatus, label }));
  const quick = quickStatuses ?? [
    { value: "present" as TStatus, label: labels.present, tone: "positive" as const },
    { value: "absent" as TStatus, label: labels.absent, tone: "negative" as const },
  ];
  const quickValues = new Set(quick.map((option) => option.value));
  const isOther = status !== null && !quickValues.has(status);
  const selectedLabel = options.find((option) => option.value === status)?.label ?? emptyLabel;
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
          <p>{student.roll_number !== undefined && student.roll_number !== null ? <span>Roll {String(student.roll_number).padStart(2, "0")}</span> : null}<span>{student.admission_number}</span>{context ? <span>{context}</span> : null}</p>
          {conflict ? <small className="roll-call-conflict">Review concurrent change</small> : null}
          {attention}
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
      <div className={`roll-call-choices has-${quick.length + 1}`} role="group" aria-label={`Mark attendance for ${student.name}`}>
        {quick.map((option) => <button key={option.value} type="button" className={`roll-call-choice is-${option.value} is-${option.tone ?? "neutral"}`} aria-pressed={status === option.value} disabled={disabled} onClick={() => onChange({ status: option.value })}>
          {option.tone === "negative" ? <X size={16} /> : <Check size={16} />}<span>{option.label}</span>
        </button>)}
        <div className={`roll-call-other${isOther ? ` is-selected is-${status}` : ""}${disabled ? " is-disabled" : ""}`}>
          <span aria-hidden="true">{isOther ? selectedLabel : "More"}<ChevronDown size={14} /></span>
          <select
            aria-label={`Attendance status for ${student.name}`}
            disabled={disabled}
            value={status ?? ""}
            onChange={(event) => onChange({ status: event.target.value ? event.target.value as TStatus : null })}
          >
            {allowEmpty ? <option value="">{emptyLabel}</option> : null}
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      {showNote ? (
        <label className="roll-call-note" id={noteId}>
          <span>{noteLabel}</span>
          <input autoFocus={noteOpen} disabled={disabled} aria-label={`Attendance remark for ${student.name}`} value={remarks} maxLength={500} placeholder="Add a short note (optional)" onChange={(event) => onChange({ remarks: event.target.value })} />
        </label>
      ) : null}
      {Children.toArray(children).length > 0 ? <div className="roll-call-student__details">{children}</div> : null}
    </article>
  );
}
