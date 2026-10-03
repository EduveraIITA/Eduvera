import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Edit3,
  LockKeyhole,
  MapPin,
  Send,
  ShieldCheck,
  UserCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ConsentAuthorityDialog } from "./ConsentAuthorityDialog";
import { OperationsEventFinancePanel } from "./EventFinancePanels";
import { EventStatusBadge, eventAudienceLabel, eventTypeLabels, formatEventDate } from "./EventPrimitives";
import type { CampusEventDto, EventFinanceParticipant, EventFinanceResponse, EventViewerParticipant } from "./types";
import "./campus-events.css";

type EventAction = "publish" | "complete" | "discard";

interface OperationsEventDetailProps {
  portal: "teacher" | "principal";
  schoolId: string;
  event: CampusEventDto;
  finance?: EventFinanceResponse;
  financeError?: unknown;
  onAction?: (action: EventAction) => Promise<void>;
  onCancel?: (internalReason: string, audienceNotice: string) => Promise<void>;
  onAuthorityChanged?: () => Promise<void>;
  onRecordRefund?: (studentId: string, input: { amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; reason: string; idempotency_key: string }) => Promise<void>;
}

export function OperationsEventDetailPage({ portal, schoolId, event, finance, financeError, onAction, onCancel, onAuthorityChanged, onRecordRefund }: OperationsEventDetailProps) {
  const [pending, setPending] = useState<EventAction | "cancel" | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelInternalReason, setCancelInternalReason] = useState("");
  const [cancelAudienceNotice, setCancelAudienceNotice] = useState("");
  const [authorityStudent, setAuthorityStudent] = useState<EventViewerParticipant | null>(null);
  const prefix = portal === "principal" ? "/principal" : "/teacher";
  const tracked = event.sessions.filter((session) => session.attendance_mode !== "none");
  const locked = tracked.filter((session) => session.state === "locked").length;

  const act = async (action: EventAction) => {
    if (!onAction) return;
    setPending(action);
    setMessage("");
    try {
      await onAction(action);
      setMessageTone("success");
      setMessage(action === "publish" ? "Event published to the eligible audience." : action === "complete" ? "Event completed and its records retained." : "Draft discarded.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setPending(null);
    }
  };

  const cancel = async () => {
    if (!onCancel || cancelInternalReason.trim().length < 3 || cancelAudienceNotice.trim().length < 3) return;
    setPending("cancel");
    setMessage("");
    try {
      await onCancel(cancelInternalReason.trim(), cancelAudienceNotice.trim());
      setCancelOpen(false);
      setMessageTone("success");
      setMessage(event.payment_required ? "Event cancelled. Linked invoices were credited; any received money is now queued for manual refund reconciliation." : "Event cancelled. The published audience will receive the update.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The event could not be cancelled.");
    } finally {
      setPending(null);
    }
  };

  return (
    <OperationsShell portal={portal} active="events" title={event.title} subtitle="Events & activities" backTo={`${prefix}/events`} contentHasHeading>
      <div className="campus-event-detail-page operations-stack">
        <section className={`campus-event-detail-hero campus-event-detail-hero--${event.event_type}`}>
          <div className="campus-event-detail-hero__copy">
            <div><span>{eventTypeLabels[event.event_type]}</span><EventStatusBadge status={event.status} /></div>
            <p>{event.description}</p>
            <dl>
              <div><dt><Clock3 size={15} />When</dt><dd>{formatEventDate(event.starts_at)} to {formatEventDate(event.ends_at)}</dd></div>
              <div><dt><MapPin size={15} />Where</dt><dd>{event.venue}</dd></div>
              <div><dt><UsersRound size={15} />Audience</dt><dd>{eventAudienceLabel(event)}</dd></div>
            </dl>
          </div>
          {event.permissions.can_edit || event.permissions.can_publish || event.permissions.can_complete || event.permissions.can_cancel ? (
            <div className="campus-event-detail-actions">
              {event.permissions.can_edit ? <Link className="campus-event-secondary" to={`${prefix}/events/${event.id}/edit`}><Edit3 size={16} />Edit draft</Link> : null}
              {event.permissions.can_publish ? <button className="campus-event-primary" type="button" disabled={pending !== null} onClick={() => void act("publish")}><Send size={16} />{pending === "publish" ? "Publishing..." : "Publish event"}</button> : null}
              {event.permissions.can_complete ? <button className="campus-event-primary" type="button" disabled={pending !== null} onClick={() => void act("complete")}><CheckCircle2 size={16} />{pending === "complete" ? "Completing..." : "Complete event"}</button> : null}
              {event.permissions.can_cancel ? <button className="campus-event-danger-link" type="button" onClick={() => setCancelOpen(true)}><XCircle size={16} />Cancel event</button> : null}
              {event.status === "draft" && event.permissions.can_edit ? <button className="campus-event-danger-link" type="button" disabled={pending !== null} onClick={() => void act("discard")}><XCircle size={16} />Discard draft</button> : null}
            </div>
          ) : null}
        </section>
        {message ? <p className={`campus-event-action-message${messageTone === "error" ? " is-error" : ""}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p> : null}
        {event.status === "cancelled" ? <section className="campus-event-cancelled"><AlertTriangle size={19} /><div><strong>This event was cancelled</strong><p><b>Family notice:</b> {event.cancellation_reason || "No family notice was recorded."}</p>{event.cancellation_internal_reason ? <p><b>Internal reason:</b> {event.cancellation_internal_reason}</p> : null}{event.permissions.can_view_finance_details && (finance?.counts.reconciliation_required ?? event.counts.finance_reconciliation_required) > 0 ? <p><b>{finance?.counts.reconciliation_required ?? event.counts.finance_reconciliation_required} fee {(finance?.counts.reconciliation_required ?? event.counts.finance_reconciliation_required) === 1 ? "record requires" : "records require"} a manual refund.</b> Invoice credits are already retained in the authoritative finance ledger.</p> : null}</div></section> : null}

        <section className="campus-event-metrics" aria-label="Event readiness">
          <article><span><UsersRound size={18} /></span><small>Participants</small><strong>{event.counts.participants}</strong><em>{event.counts.mandatory} mandatory</em></article>
          <article><span><UserCheck size={18} /></span><small>RSVP accepted</small><strong>{event.counts.rsvp_accepted}</strong><em>{event.requires_rsvp ? "Response tracking on" : "No RSVP required"}</em></article>
          <article><span><ShieldCheck size={18} /></span><small>Consent granted</small><strong>{event.counts.consent_granted}</strong><em>{event.requires_guardian_consent ? "Guardian decision required" : "Consent not required"}</em></article>
          <article><span><LockKeyhole size={18} /></span><small>Registers locked</small><strong>{locked}/{tracked.length}</strong><em>{tracked.length ? "Attendance sessions" : "No event attendance"}</em></article>
        </section>

        <section className="campus-event-detail-panel">
          <header><div><span>Event programme</span><h2>Sessions & attendance</h2></div><b>{event.sessions.length} {event.sessions.length === 1 ? "session" : "sessions"}</b></header>
          {event.sessions.length ? (
            <div className="campus-event-session-list">
              {event.sessions.map((session) => (
                <article key={session.id}>
                  <span className={`campus-event-session-icon is-${session.state}`}>{session.state === "locked" ? <LockKeyhole size={18} /> : <CalendarCheck2 size={18} />}</span>
                  <div><strong>{session.title}</strong><small>{formatEventDate(session.starts_at)} · {session.venue}</small><span>{session.attendance_mode === "none" ? "No attendance register" : `${session.counts.recorded}/${session.counts.recorded + session.counts.not_recorded} recorded · ${session.state}`}</span></div>
                  {session.attendance_mode !== "none" ? <Link className="campus-event-secondary" to={`${prefix}/events/${event.id}/sessions/${session.id}/attendance`}>{session.state === "locked" ? "Review register" : event.permissions.can_take_attendance ? "Open register" : "View register"}</Link> : null}
                </article>
              ))}
            </div>
          ) : <p className="campus-event-inline-empty">No programme sessions are scheduled for this event.</p>}
          {event.status === "published" && !event.permissions.can_complete && tracked.some((session) => session.state !== "locked") ? <p className="campus-event-policy-note"><LockKeyhole size={15} />Complete becomes available after every attendance-tracked session is locked.</p> : null}
        </section>

        {event.viewer_participants.length ? (
          <ParticipantReadiness
            event={event}
            finance={finance}
            portal={portal}
            onReviewAuthority={portal === "principal" ? setAuthorityStudent : undefined}
          />
        ) : null}
        {financeError && event.payment_required ? <p className="campus-event-form-error" role="alert">Finance reconciliation could not be loaded. Do not record an offline refund until the live ledger is available.</p> : null}
        {finance && onRecordRefund ? <OperationsEventFinancePanel finance={finance} onRecordRefund={onRecordRefund} /> : null}
        <p className="campus-event-policy-note"><ShieldCheck size={15} />Event participation and session attendance are separate records. This event has no direct impact on the academic attendance aggregate.</p>
      </div>

      {cancelOpen ? <CancelDialog paid={event.payment_required} internalReason={cancelInternalReason} audienceNotice={cancelAudienceNotice} busy={pending === "cancel"} onInternalReasonChange={setCancelInternalReason} onAudienceNoticeChange={setCancelAudienceNotice} onClose={() => setCancelOpen(false)} onConfirm={() => void cancel()} /> : null}
      {authorityStudent ? <ConsentAuthorityDialog schoolId={schoolId} studentId={authorityStudent.student_id} studentName={authorityStudent.student_name} onClose={() => setAuthorityStudent(null)} onChanged={onAuthorityChanged ?? (() => Promise.resolve())} /> : null}
    </OperationsShell>
  );
}

function ParticipantReadiness({ event, finance, portal, onReviewAuthority }: { event: CampusEventDto; finance?: EventFinanceResponse; portal: "teacher" | "principal"; onReviewAuthority?: (participant: EventViewerParticipant) => void }) {
  const financeByStudent = new Map(finance?.items.map((item) => [item.student_id, item]));
  return (
    <section className="campus-event-detail-panel">
      <header><div><span>Readiness</span><h2>{portal === "principal" ? "Participant status" : "Assigned participants"}</h2></div><b>{event.viewer_participants.length} shown</b></header>
      <div className="campus-event-participant-table">
        <div className="campus-event-participant-table__head"><span>Student</span><span>RSVP</span><span>Consent</span><span>Payment</span><span>Checklist</span></div>
        {event.viewer_participants.map((participant) => (
          <article key={participant.student_id}>
            <span><span className="campus-event-avatar">{participant.avatar_url ? <img src={participant.avatar_url} alt="" /> : participant.student_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><strong>{participant.student_name}</strong></span>
            <span>{event.requires_rsvp ? participant.rsvp_status : event.participation_requirement === "mandatory" ? "Mandatory" : "Included"}</span>
            <span>{participant.consent_readiness === "ready" || participant.consent_readiness === "not_required" ? participant.consent_status.replace("_", " ") : onReviewAuthority ? <button className="campus-authority-link" type="button" onClick={() => onReviewAuthority(participant)}>{participant.consent_readiness === "authority_expired" ? "Authority expired" : "Authority missing"}</button> : participant.consent_readiness === "authority_expired" ? "Authority expired" : "Authority missing"}</span>
            <span>{participantPaymentLabel(event, participant, financeByStudent.get(participant.student_id))}{event.permissions.can_view_finance_details && event.payment_required && !financeByStudent.has(participant.student_id) && (participant.fee_invoice_id || event.payment_amount_paise) ? <small>{formatMoney(participant.payment_paid_paise)} / {formatMoney(participant.fee_invoice_id ? participant.payment_amount_paise : event.payment_amount_paise ?? 0)}</small> : null}</span>
            <span>{participant.checklist_required ? `${participant.checklist_required_completed}/${participant.checklist_required} required` : "No required items"}<small>{participant.checklist_ready ? "Ready" : "Still to pack"}</small></span>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

function participantPaymentLabel(event: CampusEventDto, participant: EventViewerParticipant, finance?: EventFinanceParticipant) {
  if (!event.payment_required) return "Not required";
  if (finance) {
    return {
      not_required: "Not required",
      not_invoiced: "Not invoiced",
      collectible: "Payment pending",
      paid: "Paid",
      credited: "Invoice credited",
      refund_due: "Manual refund due",
      partially_refunded: "Refund partly recorded",
      refunded: "Refund recorded",
    }[finance.finance_state];
  }
  if (!event.permissions.can_view_finance_details) {
    return participant.payment_status === "paid" ? "Paid" : participant.payment_status === "pending" ? "Payment pending" : "Not required";
  }
  if (participant.fee_invoice_id) return participant.fee_invoice_status;
  return event.requires_rsvp && participant.rsvp_status !== "accepted" ? "Awaiting RSVP" : "Not invoiced";
}

function CancelDialog({ paid, internalReason, audienceNotice, busy, onInternalReasonChange, onAudienceNoticeChange, onClose, onConfirm }: { paid: boolean; internalReason: string; audienceNotice: string; busy: boolean; onInternalReasonChange: (value: string) => void; onAudienceNoticeChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="campus-event-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="campus-event-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-event-heading" onClick={(event) => event.stopPropagation()}>
        <span className="campus-event-modal__icon"><AlertTriangle size={20} /></span>
        <h2 id="cancel-event-heading">Cancel this event?</h2>
        <p>{paid ? "Families and assigned staff will be notified. Every linked invoice will receive an append-only credit. Money already received is not returned automatically and must be reconciled by the school office." : "Families and assigned staff will be notified. Existing attendance history remains available."}</p>
        <label>Internal cancellation reason<textarea autoFocus rows={3} value={internalReason} onChange={(event) => onInternalReasonChange(event.target.value)} placeholder="Operational reason retained for authorized staff" /></label>
        <label>Notice shown to families<textarea rows={3} value={audienceNotice} onChange={(event) => onAudienceNoticeChange(event.target.value)} placeholder="Clear, appropriate update for students and guardians" /></label>
        <p className="campus-event-policy-note"><ShieldCheck size={15} />Only the family notice is shown in parent and student views. The internal reason remains staff-only.</p>
        <div><button type="button" className="campus-event-secondary" onClick={onClose}>Keep event</button><button type="button" className="campus-event-danger" disabled={internalReason.trim().length < 3 || audienceNotice.trim().length < 3 || busy} onClick={onConfirm}>{busy ? "Cancelling..." : "Cancel event"}</button></div>
      </section>
    </div>
  );
}
