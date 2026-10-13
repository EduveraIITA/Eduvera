import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ApiLeaveRequest } from "../school/api";

export type SchoolLeaveDecision = "approve" | "reject";

interface PrincipalStudentLeaveViewProps {
  queue: ApiLeaveRequest[];
  selected: ApiLeaveRequest | null;
  requestedId?: string;
  busy?: boolean;
  error?: string;
  queuePending?: boolean;
  queueUnavailable?: boolean;
  onDecide: (decision: SchoolLeaveDecision, note: string) => Promise<void> | void;
}

const schoolTimezone = "Asia/Kolkata";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: schoolTimezone })
    .format(new Date(`${value}T12:00:00+05:30`));
}

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: schoolTimezone,
  }).format(new Date(value));
}

function formatRange(request: ApiLeaveRequest) {
  return request.starts_on === request.ends_on
    ? formatDate(request.starts_on)
    : `${formatDate(request.starts_on)} - ${formatDate(request.ends_on)}`;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function studentName(request: ApiLeaveRequest) {
  return request.student?.display_name || request.student?.name || "Student leave request";
}

function initials(request: ApiLeaveRequest) {
  return studentName(request).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function statusTone(status: string) {
  if (status === "authorized") return "pending";
  if (status === "school_approved") return "approved";
  if (["school_rejected", "declined"].includes(status)) return "rejected";
  return "neutral";
}

function LeaveQueue({ queue, selectedId, pending }: { queue: ApiLeaveRequest[]; selectedId?: string; pending: boolean }) {
  return (
    <section className="student-leave-queue" aria-labelledby="student-leave-queue-heading">
      <header>
        <div>
          <h2 id="student-leave-queue-heading">Awaiting decision</h2>
          <p>Guardian-authorised requests ready for school review.</p>
        </div>
        <strong aria-label={pending ? "Loading requests" : `${queue.length} ${queue.length === 1 ? "request" : "requests"}`}>{pending ? "…" : queue.length}</strong>
      </header>
      {pending ? <p className="student-leave-queue__empty" role="status">Loading requests…</p> : queue.length ? (
        <div className="student-leave-queue__rows">
          {queue.map((request) => (
            <Link
              key={request.id}
              className={request.id === selectedId ? "is-selected" : undefined}
              to={`/principal/student-leave?request=${encodeURIComponent(request.id)}`}
              aria-current={request.id === selectedId ? "true" : undefined}
            >
              <span className="student-leave-queue__avatar" aria-hidden="true">{initials(request)}</span>
              <span className="student-leave-queue__copy">
                <strong>{studentName(request)}</strong>
                <small>{request.class_name || request.student?.class_name || request.student?.admission_number || request.category_label}</small>
                <span>{formatRange(request)} · {request.duration_days} {request.duration_days === 1 ? "day" : "days"}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : <p className="student-leave-queue__empty"><Check size={18} aria-hidden="true" />No requests need a school decision.</p>}
    </section>
  );
}

function DecisionPanel({ request, busy, error, onDecide }: {
  request: ApiLeaveRequest;
  busy: boolean;
  error?: string;
  onDecide: PrincipalStudentLeaveViewProps["onDecide"];
}) {
  const [decision, setDecision] = useState<SchoolLeaveDecision | null>(null);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (decision) noteRef.current?.focus();
  }, [decision]);

  if (request.status !== "authorized") {
    return <div className={`student-leave-outcome student-leave-outcome--${statusTone(request.status)}`} role="status">
      {request.status === "school_approved" ? <Check size={18} aria-hidden="true" /> : <Clock3 size={18} aria-hidden="true" />}
      <span><strong>{request.status_label}</strong>{request.decided_by_name ? ` by ${request.decided_by_name}` : ""}{request.decided_at ? ` · ${formatDateTime(request.decided_at)}` : ""}</span>
    </div>;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!decision) return;
    await onDecide(decision, note.trim());
  };

  return (
    <section className="student-leave-decision" aria-labelledby="student-leave-decision-heading">
      <div className="student-leave-decision__heading">
        <ShieldCheck size={19} aria-hidden="true" />
        <div><h3 id="student-leave-decision-heading">School decision</h3><p>Guardian authority is confirmed. Review the dates and evidence before deciding.</p></div>
      </div>
      {!decision ? <div className="student-leave-decision__actions">
        <button type="button" className="student-leave-button student-leave-button--secondary" onClick={() => setDecision("reject")}><X size={17} />Not approve</button>
        <button type="button" className="student-leave-button student-leave-button--primary" onClick={() => setDecision("approve")}><Check size={17} />Approve leave</button>
      </div> : (
        <form onSubmit={(event) => void submit(event)}>
          <div className={`student-leave-review student-leave-review--${decision}`}>
            <strong>{decision === "approve" ? "Approve this leave?" : "Do not approve this leave?"}</strong>
            <p>{decision === "approve" ? "Applicable absent or unmarked instructional days will be recorded as excused. Existing present or late records stay unchanged." : "The family will see your decision and reason. Attendance records will not be changed."}</p>
          </div>
          <label htmlFor="student-leave-decision-note">{decision === "reject" ? "Reason" : "Note (optional)"}</label>
          <textarea
            ref={noteRef}
            id="student-leave-decision-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            required={decision === "reject"}
            placeholder={decision === "reject" ? "Explain why this request was not approved" : "Add a note for the family"}
          />
          {error ? <p className="student-leave-error" role="alert">{error}</p> : null}
          <div className="student-leave-decision__actions">
            <button type="button" className="student-leave-button student-leave-button--secondary" disabled={busy} onClick={() => { setDecision(null); setNote(""); }}>Cancel</button>
            <button type="submit" className={decision === "approve" ? "student-leave-button student-leave-button--primary" : "student-leave-button student-leave-button--danger"} disabled={busy || (decision === "reject" && note.trim().length < 4)}>
              {busy ? "Saving..." : decision === "approve" ? "Confirm approval" : "Confirm decision"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function LeaveDetail({ request, requestedId, busy, error, onDecide }: {
  request: ApiLeaveRequest;
  requestedId?: string;
  busy: boolean;
  error?: string;
  onDecide: PrincipalStudentLeaveViewProps["onDecide"];
}) {
  const detailRef = useRef<HTMLElement>(null);
  const evidence = useMemo(() => [
    { label: "Requested by", value: request.requested_by_name, detail: formatDateTime(request.submitted_at), icon: UserRound },
    { label: "Guardian authority", value: request.guardian_authorized_by_name || "Not recorded", detail: formatDateTime(request.guardian_authorized_at), icon: ShieldCheck },
  ], [request]);

  useEffect(() => {
    if (!requestedId || requestedId !== request.id) return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [request.id, requestedId]);

  return (
    <article ref={detailRef} id={`student-leave-request-${request.id}`} className="student-leave-detail" tabIndex={-1} aria-labelledby="student-leave-student-name">
      <header className="student-leave-detail__student">
        {request.student?.avatar_url ? <img src={request.student.avatar_url} alt="" /> : <span aria-hidden="true">{initials(request)}</span>}
        <div><h2 id="student-leave-student-name">{studentName(request)}</h2><p>{request.class_name || request.student?.class_name || "Current class"} · {request.student?.admission_number || "Student record"}</p></div>
        <em className={`student-leave-status student-leave-status--${statusTone(request.status)}`}>{request.status_label}</em>
      </header>

      <dl className="student-leave-detail__facts">
        <div><dt><CalendarDays size={15} aria-hidden="true" />Leave dates</dt><dd>{formatRange(request)}</dd><small>{request.duration_days} calendar {request.duration_days === 1 ? "day" : "days"}</small></div>
        <div><dt>Category</dt><dd>{request.category_label}</dd></div>
      </dl>

      <section className="student-leave-reason" aria-labelledby="student-leave-reason-heading">
        <h3 id="student-leave-reason-heading">Reason</h3>
        <p>{request.reason}</p>
      </section>

      <section className="student-leave-evidence" aria-labelledby="student-leave-evidence-heading">
        <h3 id="student-leave-evidence-heading">Checks</h3>
        <div className="student-leave-evidence__people">
          {evidence.map(({ label, value, detail, icon: Icon }) => <div key={label}><Icon size={17} aria-hidden="true" /><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></div>)}
        </div>
        <div className="student-leave-documents">
          <h4>Supporting files</h4>
          {request.documents.length ? request.documents.map((document) => <a key={document.id} href={document.file_url ?? undefined} target="_blank" rel="noreferrer"><FileText size={17} aria-hidden="true" /><span><strong>{document.original_name}</strong><small>{fileSize(document.size_bytes)}</small></span><ChevronRight size={16} aria-hidden="true" /></a>) : <p>No file attached.</p>}
        </div>
      </section>

      {request.audit_log.length ? <details className="student-leave-history"><summary>Request history <span>{request.audit_log.length}</span></summary><ol>{request.audit_log.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{entry.action_label}</strong><p>{entry.actor_name} · {formatDateTime(entry.created_at)}</p>{entry.note ? <small>{entry.note}</small> : null}</div></li>)}</ol></details> : null}
      <DecisionPanel key={`${request.id}:${request.status}`} request={request} busy={busy} error={error} onDecide={onDecide} />
    </article>
  );
}

export function PrincipalStudentLeaveView({ queue, selected, requestedId, busy = false, error, queuePending = false, queueUnavailable = false, onDecide }: PrincipalStudentLeaveViewProps) {
  return (
    <div className="principal-student-leave-page">
      <LeaveQueue queue={queue} selectedId={selected?.id} pending={queuePending} />
      {queueUnavailable ? <p className="student-leave-queue-warning" role="status">The decision queue could not refresh. The opened request is still available below.</p> : null}
      {selected ? <LeaveDetail request={selected} requestedId={requestedId} busy={busy} error={error} onDecide={onDecide} /> : requestedId ? <section className="student-leave-not-found" role="status"><FileText size={22} /><h2>Request not available</h2><p>It may be outside your school scope or no longer exist.</p><Link to="/principal/student-leave">Open the current queue</Link></section> : null}
    </div>
  );
}
