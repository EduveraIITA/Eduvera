import { Children, useState, type ReactNode } from "react";
import { Check, ChevronDown, MessageSquareText, X } from "lucide-react";
import type { AttendanceStatus } from "../operations/api";
import "./attendance-participant.css";

const labels: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", late: "Late", excused: "Excused", half_day: "Half day",
};

export interface AttendanceParticipantStatusOption<TStatus extends string> {
  value: TStatus;
  label: string;
  tone?: "positive" | "negative";
}

export interface AttendanceParticipantIdentity {
  id: string;
  name: string;
  identifier?: string | null;
  avatar_url?: string | null;
  roll_number?: string | number | null;
}

export function AttendanceParticipantRow<TStatus extends string = AttendanceStatus>({
  participant,
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
  participant: AttendanceParticipantIdentity;
  status: TStatus | null;
  remarks: string;
  disabled: boolean;
  conflict: boolean;
  context?: string;
  attention?: ReactNode;
  children?: ReactNode;
  statusOptions?: readonly AttendanceParticipantStatusOption<TStatus>[];
  quickStatuses?: readonly AttendanceParticipantStatusOption<TStatus>[];
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
  const noteId = `attendance-note-${participant.id}`;
  return (
    <article className={`attendance-participant${conflict ? " has-conflict" : ""}`} aria-label={participant.name}>
      <div className="attendance-participant__identity">
        <span className="roll-call-avatar" aria-hidden="true">
          {participant.avatar_url && failedAvatar !== participant.avatar_url ? (
            <img src={participant.avatar_url} alt="" loading="lazy" onError={() => setFailedAvatar(participant.avatar_url ?? null)} />
          ) : participant.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}
        </span>
        <div>
          <h3>{participant.name}</h3>
          {participant.roll_number !== undefined && participant.roll_number !== null || participant.identifier || context ? <p>{participant.roll_number !== undefined && participant.roll_number !== null ? <span>Roll {String(participant.roll_number).padStart(2, "0")}</span> : null}{participant.identifier ? <span>{participant.identifier}</span> : null}{context ? <span>{context}</span> : null}</p> : null}
          {conflict ? <small className="roll-call-conflict">Review concurrent change</small> : null}
          {attention}
        </div>
      </div>
      <button
        type="button"
        className={`roll-call-note-toggle${remarks ? " has-note" : ""}`}
        aria-label={`${showNote ? "Hide" : remarks ? "View" : "Add"} note for ${participant.name}`}
        aria-expanded={showNote}
        aria-controls={showNote ? noteId : undefined}
        disabled={disabled && !remarks}
        onClick={() => setNoteOpen((open) => !open)}
      >
        <MessageSquareText size={18} />
      </button>
      <div className={`roll-call-choices has-${quick.length + 1}`} role="group" aria-label={`Mark attendance for ${participant.name}`}>
        {quick.map((option) => <button key={option.value} type="button" className={`roll-call-choice is-${option.value} is-${option.tone ?? "neutral"}`} aria-pressed={status === option.value} disabled={disabled} onClick={() => onChange({ status: option.value })}>
          {option.tone === "negative" ? <X size={16} /> : <Check size={16} />}<span>{option.label}</span>
        </button>)}
        <div className={`roll-call-other${isOther ? ` is-selected is-${status}` : ""}${disabled ? " is-disabled" : ""}`}>
          <span aria-hidden="true">{isOther ? selectedLabel : "More"}<ChevronDown size={14} /></span>
          <select
            aria-label={`Attendance status for ${participant.name}`}
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
          <input autoFocus={noteOpen} disabled={disabled} aria-label={`Attendance remark for ${participant.name}`} value={remarks} maxLength={500} placeholder="Add a short note (optional)" onChange={(event) => onChange({ remarks: event.target.value })} />
        </label>
      ) : null}
      {Children.toArray(children).length > 0 ? <div className="attendance-participant__details">{children}</div> : null}
    </article>
  );
}
