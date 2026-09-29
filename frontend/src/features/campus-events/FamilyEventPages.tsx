import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import type { ParentChildSummary, ParentPageAction } from "../../pages/parent/parentTypes";
import { StudentShell } from "../../pages/student/StudentShell";
import {
  CampusEventCard,
  EventEmptyState,
  EventStatusBadge,
  eventTypeLabels,
  formatEventDate,
} from "./EventPrimitives";
import { FamilyEventFinancePanel } from "./EventFinancePanels";
import type { CampusEventDto, ConsentStatus, EventFinanceParticipant, RsvpStatus } from "./types";
import "./campus-events.css";

function FamilyFrame({
  audience,
  child,
  onSelectChild,
  children,
}: {
  audience: "parent" | "student";
  child?: ParentChildSummary;
  onSelectChild?: (id: string) => ParentPageAction;
  children: ReactNode;
}) {
  return audience === "parent" ? (
    <ParentShell active="home" pageLabel="Events" child={child} onSelectChild={onSelectChild}>
      {children}
    </ParentShell>
  ) : (
    <StudentShell activeNav="launcher">{children}</StudentShell>
  );
}

export function FamilyEventListPage({
  audience,
  events,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  child,
  onSelectChild,
}: {
  audience: "parent" | "student";
  events: CampusEventDto[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  child?: ParentChildSummary;
  onSelectChild?: (id: string) => ParentPageAction;
}) {
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [now] = useState(() => Date.now());
  const visible = events.filter((event) =>
    view === "upcoming"
      ? event.status === "published" && new Date(event.ends_at).getTime() >= now
      : event.status === "completed" || event.status === "cancelled" || new Date(event.ends_at).getTime() < now,
  );
  const prefix = audience === "parent" ? "/parent" : "/student";
  const actionCount = events.filter((event) =>
    event.status === "published"
    && new Date(event.starts_at).getTime() > now
    && event.viewer_participants.some(
      (participant) =>
        (event.requires_rsvp && event.permissions.can_rsvp && participant.rsvp_status === "pending")
        || (audience === "parent" && event.requires_guardian_consent && (participant.consent_status === "pending" || participant.consent_readiness !== "ready")),
    ),
  ).length;

  return (
    <FamilyFrame audience={audience} child={child} onSelectChild={onSelectChild}>
      <div className="family-events-page">
        <section className="family-events-hero">
          <span>School life</span>
          <h1>Events & activities</h1>
          <p>Plans, consent and preparation for everything beyond the daily timetable.</p>
          <div>
            <strong>{events.filter((event) => event.status === "published" && new Date(event.ends_at).getTime() >= now).length}</strong>
            <span>upcoming</span>
            <strong>{actionCount}</strong>
            <span>need action</span>
          </div>
        </section>
        <div className="family-event-tabs" role="tablist" aria-label="Filter events">
          <button type="button" role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? "is-active" : ""} onClick={() => setView("upcoming")}>Upcoming</button>
          <button type="button" role="tab" aria-selected={view === "past"} className={view === "past" ? "is-active" : ""} onClick={() => setView("past")}>Past</button>
        </div>
        {visible.length ? (
          <div className="campus-event-list">
            {visible.map((event) => (
              <CampusEventCard
                key={event.id}
                event={event}
                to={`${prefix}/events/${event.id}${child ? `?student_id=${encodeURIComponent(child.id)}` : ""}`}
              />
            ))}
          </div>
        ) : (
          <EventEmptyState
            title={view === "upcoming" ? "No upcoming activities" : "No past activities"}
            detail={hasMore ? "More eligible events are available. Load the next page to continue this view." : "Eligible school events will appear here when they are published."}
          />
        )}
        {hasMore && onLoadMore ? <button className="campus-event-load-more" type="button" disabled={loadingMore} aria-busy={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading more events..." : "Load more events"}</button> : null}
      </div>
    </FamilyFrame>
  );
}

interface FamilyEventDetailProps {
  audience: "parent" | "student";
  event: CampusEventDto;
  finance?: EventFinanceParticipant;
  financeError?: unknown;
  child?: ParentChildSummary;
  selectedStudentId: string;
  onSelectChild?: (id: string) => ParentPageAction;
  onRsvp: (status: Extract<RsvpStatus, "accepted" | "declined">) => Promise<void>;
  onWithdraw: (reason: string, idempotencyKey: string) => Promise<void>;
  onConsent: (status: Extract<ConsentStatus, "granted" | "denied" | "withdrawn">, note: string) => Promise<void>;
  onChecklist: (itemId: string, completed: boolean) => Promise<void>;
}

export function FamilyEventDetailPage({
  audience,
  event,
  finance,
  financeError,
  child,
  selectedStudentId,
  onSelectChild,
  onRsvp,
  onWithdraw,
  onConsent,
  onChecklist,
}: FamilyEventDetailProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [now] = useState(() => Date.now());
  const participant = event.viewer_participants.find((item) => item.student_id === selectedStudentId) ?? event.viewer_participants[0];
  const prefix = audience === "parent" ? "/parent" : "/student";
  const completedIds = new Set(participant?.checklist_completed_item_ids ?? []);
  const responseWindowOpen = event.status === "published" && new Date(event.starts_at).getTime() > now;
  const withdrawn = finance?.participation_state === "withdrawn";
  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setMessage("");
    try {
      await action();
      setMessageTone("success");
      setMessage("Your event response has been saved.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The response could not be saved.");
    } finally {
      setPending(null);
    }
  };

  return (
    <FamilyFrame audience={audience} child={child} onSelectChild={onSelectChild}>
      <div className="family-event-detail">
        <nav className="campus-event-back">
          <Link to={`${prefix}/events${child ? `?student_id=${encodeURIComponent(child.id)}` : ""}`}><ArrowLeft size={17} />All events</Link>
        </nav>
        <section className={`family-event-detail-hero family-event-detail-hero--${event.event_type}`}>
          <div><span>{eventTypeLabels[event.event_type]}</span><EventStatusBadge status={event.status} /></div>
          <h1>{event.title}</h1>
          <p>{event.description}</p>
          <dl>
            <div><dt><Clock3 size={15} />When</dt><dd>{formatEventDate(event.starts_at)} to {formatEventDate(event.ends_at)}</dd></div>
            <div><dt><MapPin size={15} />Where</dt><dd>{event.venue}</dd></div>
          </dl>
        </section>
        {event.status === "cancelled" ? (
          <section className="campus-event-cancelled"><X size={19} /><div><strong>Event cancelled</strong><p>{event.cancellation_reason || "The school cancelled this activity."}</p></div></section>
        ) : null}
        {participant && event.status === "published" ? (
          <section className="family-event-response">
            <header><div><span>Participation</span><h2>{participant.student_name}</h2></div><span className={`family-event-response__state is-${withdrawn ? "withdrawn" : event.requires_rsvp ? participant.rsvp_status : "included"}`}>{withdrawn ? "Withdrawn" : event.requires_rsvp ? participant.rsvp_status : event.participation_requirement === "mandatory" ? "Mandatory" : "Included"}</span></header>
            {withdrawn ? <p className="family-event-readonly"><RotateCcw size={17} />This optional event place has been withdrawn and removed from the participation roster.</p> : event.requires_rsvp && !(audience === "student" && event.payment_required && !event.permissions.can_rsvp) ? (
              <div className="family-event-response__buttons">
                <button type="button" className={participant.rsvp_status === "accepted" ? "is-selected" : ""} disabled={!event.permissions.can_rsvp || pending !== null} onClick={() => void run("accept", () => onRsvp("accepted"))}><CheckCircle2 size={17} />Accept</button>
                <button type="button" className={participant.rsvp_status === "declined" ? "is-selected is-decline" : ""} disabled={!event.permissions.can_rsvp || pending !== null} onClick={() => void run("decline", () => onRsvp("declined"))}><X size={17} />Decline</button>
              </div>
            ) : (
              <p className="family-event-readonly"><UserCheck size={17} />{audience === "student" && event.payment_required && event.requires_rsvp ? "A linked guardian must accept or decline this paid event." : event.participation_requirement === "mandatory" ? "This activity is on the mandatory event roster." : "No RSVP is required for this activity."}</p>
            )}
            {event.requires_guardian_consent ? (
              <div className="family-event-consent">
                <div><ShieldCheck size={18} /><span><strong>Guardian consent</strong><small>Current status: {participant.consent_status}</small></span></div>
                {audience === "parent" && event.permissions.can_consent ? (
                  <div>
                    {participant.consent_status === "granted" ? <button type="button" className="is-decline" disabled={pending !== null} onClick={() => void run("withdraw", () => onConsent("withdrawn", ""))}>Withdraw consent</button> : <button type="button" disabled={pending !== null} onClick={() => void run("consent", () => onConsent("granted", ""))}>Grant consent</button>}
                    {participant.consent_status !== "granted" ? <button type="button" disabled={pending !== null} onClick={() => void run("deny", () => onConsent("denied", ""))}>Do not consent</button> : null}
                  </div>
                ) : (
                  <p>{audience === "student" ? "A linked guardian must record this decision." : participant.consent_readiness !== "ready" ? "Purpose-specific event consent authority is missing or expired." : "Consent changes are closed for this event."}</p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
        {message ? <p className={`campus-event-action-message${messageTone === "error" ? " is-error" : ""}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p> : null}
        {financeError ? <p className="campus-event-form-error" role="alert">The latest event-fee reconciliation could not be loaded. Retry before making a payment decision.</p> : null}
        {event.payment_required && participant ? finance ? <FamilyEventFinancePanel finance={finance} onWithdraw={onWithdraw} /> : <EventPaymentPanel event={event} participant={participant} /> : null}
        <section className="family-event-panel">
          <header><div><span>Programme</span><h2>Event schedule</h2></div><CalendarDays size={19} /></header>
          <div className="family-event-session-list">
            {event.sessions.map((session) => (
              <article key={session.id}><span>{new Date(session.starts_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span><div><strong>{session.title}</strong><small>{session.venue} · {session.session_type}{session.state === "locked" ? " · Register locked" : ""}</small></div><FamilySessionAttendance session={session} studentId={selectedStudentId} /></article>
            ))}
          </div>
        </section>
        {event.checklist.length && participant ? (
          <section className="family-event-panel">
            <header><div><span>Preparation</span><h2>What to bring</h2></div><b>{participant.checklist_completed}/{participant.checklist_total} marked packed</b></header>
            <div className="family-event-checklist">
              {event.checklist.map((item) => {
                const checked = completedIds.has(item.id);
                return <button type="button" key={item.id} aria-pressed={checked} className={checked ? "is-checked" : ""} disabled={pending !== null || !responseWindowOpen} title={!responseWindowOpen ? "Checklist updates close when the event starts." : undefined} onClick={() => void run(`check-${item.id}`, () => onChecklist(item.id, !checked))}><span>{checked ? <Check size={16} /> : null}</span><strong>{item.label}</strong><small>{item.required ? "Required" : "Optional"}</small></button>;
              })}
            </div>
            <p className="family-event-declaration">This is a family-declared packing checklist. The school does not verify items through this control.</p>
            {!responseWindowOpen ? <p className="family-event-readonly"><ShieldCheck size={16} />The preparation checklist is now read-only.</p> : null}
          </section>
        ) : null}
        <p className="campus-event-policy-note"><ShieldCheck size={15} />Event participation and event attendance are separate from the daily academic attendance record.</p>
      </div>
    </FamilyFrame>
  );
}

const attendanceLabels = {
  not_recorded: "Not recorded",
  present: "Present",
  late: "Late",
  excused: "Excused",
  no_show: "No-show",
  checked_out: "Checked out",
} as const;

function attendanceTime(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function FamilySessionAttendance({ session, studentId }: { session: CampusEventDto["sessions"][number]; studentId: string }) {
  if (session.attendance_mode === "none") return null;
  const attendance = session.viewer_attendance.find((item) => item.student_id === studentId);
  if (!attendance) return <div className="family-event-session-attendance is-neutral"><strong>Not recorded</strong></div>;
  if (!attendance.expected) return <div className="family-event-session-attendance is-neutral"><strong>Not on this session roster</strong></div>;
  const times = [attendance.checked_in_at ? `In ${attendanceTime(attendance.checked_in_at)}` : null, attendance.checked_out_at ? `Out ${attendanceTime(attendance.checked_out_at)}` : null].filter(Boolean).join(" · ");
  return <div className={`family-event-session-attendance is-${attendance.status}`}><strong>{attendanceLabels[attendance.status]}</strong>{times ? <small>{times}</small> : null}</div>;
}

function currency(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
}

function EventPaymentPanel({ event, participant }: { event: CampusEventDto; participant: CampusEventDto["viewer_participants"][number] }) {
  const total = participant.fee_invoice_id ? participant.payment_amount_paise : event.payment_amount_paise ?? participant.payment_amount_paise;
  const balance = participant.fee_invoice_id ? Math.max(0, total - participant.payment_paid_paise) : total;
  const status = participant.fee_invoice_id ? participant.fee_invoice_status : event.requires_rsvp && participant.rsvp_status !== "accepted" ? "Awaiting RSVP" : "Not invoiced";
  return (
    <section className="family-event-panel family-event-payment">
      <header><div><span>Event fee</span><h2>{participant.fee_invoice_status === "paid" ? "Payment recorded" : participant.fee_invoice_id ? "Payment due" : "Fee details"}</h2></div><b>{status}</b></header>
      <dl>
        <div><dt>Total</dt><dd>{currency(total)}</dd></div>
        <div><dt>Paid</dt><dd>{currency(participant.payment_paid_paise)}</dd></div>
        <div><dt>Balance</dt><dd>{currency(balance)}</dd></div>
        <div><dt>Due</dt><dd>{event.payment_due_on ? new Date(`${event.payment_due_on}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not set"}</dd></div>
      </dl>
      <p>{participant.fee_invoice_id ? "This amount is linked to the school finance ledger. Contact the school office for supported payment methods or reconciliation." : event.requires_rsvp && participant.rsvp_status !== "accepted" ? "Fee applies after acceptance. No invoice exists until the invitation is accepted." : "The school has not created the finance invoice yet. Contact the school office if this remains unresolved."}</p>
      {event.status === "cancelled" && participant.fee_invoice_id ? <p className="family-event-payment__warning">Your fee record remains in the school finance ledger. The school office will reconcile the balance for this cancelled event.</p> : null}
    </section>
  );
}
