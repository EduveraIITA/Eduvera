/* eslint-disable */
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flag,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  ShieldAlert,
  UserCheck,
  X,
} from "lucide-react";
import type {
  ChatReport,
  ChatReportQueue,
  ChatReportReviewer,
  ChatReportStatus,
  ChatReportUpdate,
} from "./api";

type ReportFilter = "active" | "resolved" | "dismissed";

const statusLabels: Record<ChatReportStatus, string> = {
  open: "High priority",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const actionLabels: Record<string, string> = {
  none: "No action recorded",
  no_action: "Resolved with no further action",
  warning: "Formal warning issued",
  restrict: "Messaging access restricted",
  escalate: "Escalated to school leadership",
};

function fullTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function reportTitle(report: ChatReport) {
  return report.conversation_title || (report.conversation_kind === "direct" ? "Direct conversation" : "School group");
}

function caseCode(report: ChatReport) {
  return "CR-" + report.id.replaceAll("-", "").slice(-4).toUpperCase();
}

function personInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "SR";
}

export function ModerationDialog({
  queue,
  reviewers,
  loading,
  pending,
  error,
  loadError,
  onClose,
  onRefresh,
  onUpdate,
}: {
  queue?: ChatReportQueue;
  reviewers: ChatReportReviewer[];
  loading: boolean;
  pending: boolean;
  error?: string;
  loadError?: string;
  onClose: () => void;
  onRefresh: () => void;
  onUpdate: (reportId: string, input: ChatReportUpdate) => void;
}) {
  const [filter, setFilter] = useState<ReportFilter>("active");
  const [selectedId, setSelectedId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [restrictionDays, setRestrictionDays] = useState(7);
  const reports = useMemo(() => {
    const all = queue?.results ?? [];
    if (filter === "active") return all.filter((item) => item.status === "open" || item.status === "under_review");
    return all.filter((item) => item.status === filter);
  }, [filter, queue?.results]);
  const selected = reports.find((item) => item.id === selectedId) ?? reports[0];

  useEffect(() => {
    if (!reports.some((item) => item.id === selectedId)) setSelectedId(reports[0]?.id ?? "");
  }, [reports, selectedId]);
  useEffect(() => {
    setAssignee(selected?.assigned_to ?? "");
    setNote("");
    setRestrictionDays(7);
  }, [selected?.id]);

  const activeCount = (queue?.summary.open ?? 0) + (queue?.summary.under_review ?? 0);
  const canAct = Boolean(selected) && note.trim().length >= 3 && !pending;
  const assignment = selected?.can_assign ? { assigned_to: assignee || null } : {};
  const update = (input: ChatReportUpdate) => {
    if (!selected || pending) return;
    onUpdate(selected.id, { ...assignment, ...input });
  };

  return (
    <div className="chat-picker-backdrop chat-moderation-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="chat-moderation" role="dialog" aria-modal="true" aria-labelledby="moderation-title">
        <header className="chat-moderation__header">
          <span className="chat-moderation__brand">E</span>
          <span>
            <small>Cambridge Intl School</small>
            <strong id="moderation-title">Reports &amp; Safeguarding</strong>
          </span>
          <button type="button" onClick={onClose} aria-label="Close safeguarding queue"><X size={20} /></button>
        </header>

        <section className="chat-moderation__intro">
          <div className="chat-moderation__confidential">
            <LockKeyhole size={13} />
            <span>Confidential · Authorised pastoral access</span>
          </div>
          <div className="chat-moderation__heading">
            <span>
              <h2>Message Reports &amp;<br />Safeguarding</h2>
              <p>Review incidents, assign ownership and record a compliant outcome.</p>
            </span>
            <span className="chat-moderation__sla"><Clock3 size={14} /> Target &lt; 4h</span>
          </div>
        </section>

        <nav className="chat-moderation__tabs" aria-label="Report status">
          <button type="button" className={filter === "active" ? "is-active" : ""} onClick={() => setFilter("active")}>
            Active <b>{activeCount}</b>
          </button>
          <button type="button" className={filter === "resolved" ? "is-active" : ""} onClick={() => setFilter("resolved")}>
            Resolved <b>{queue?.summary.resolved ?? 0}</b>
          </button>
          <button type="button" className={filter === "dismissed" ? "is-active" : ""} onClick={() => setFilter("dismissed")}>
            Dismissed <b>{queue?.summary.dismissed ?? 0}</b>
          </button>
        </nav>

        <div className="chat-moderation__body">
          <aside className="chat-moderation__list" aria-label="Safeguarding incidents">
            <div className="chat-moderation__list-title">
              <span><ShieldAlert size={15} /> Incident queue</span>
              <small>{reports.length} case{reports.length === 1 ? "" : "s"}</small>
            </div>
            {loading ? (
              <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Loading reports…</span></div>
            ) : loadError ? (
              <div className="chat-moderation__empty is-error">
                <AlertTriangle size={25} />
                <strong>Reports could not be loaded</strong>
                <span>{loadError}</span>
                <button type="button" onClick={onRefresh}>Try again</button>
              </div>
            ) : !reports.length ? (
              <div className="chat-moderation__empty">
                <CheckCircle2 size={25} />
                <strong>No {filter} reports</strong>
                <span>{filter === "active" ? "The active pastoral queue is clear." : "No incidents have this status."}</span>
                <button type="button" onClick={onRefresh}>Refresh</button>
              </div>
            ) : reports.map((report) => (
              <button
                type="button"
                key={report.id}
                className={report.id === selected?.id ? "chat-report-card is-selected" : "chat-report-card"}
                onClick={() => setSelectedId(report.id)}
              >
                <span className="chat-report-card__top">
                  <span className={"chat-report-status is-" + report.status}>{statusLabels[report.status]}</span>
                  <b>#{caseCode(report)}</b>
                  <ChevronRight size={16} />
                </span>
                <span className="chat-report-card__person">
                  <i>{personInitials(report.sender_name)}</i>
                  <span><strong>{report.sender_name || "Unknown sender"}</strong><small>Reported by {report.reporter_name}</small></span>
                </span>
                <span className="chat-report-card__reason"><Flag size={13} /> {report.reason}</span>
                <blockquote>{report.message_body || "Attachment or empty message"}</blockquote>
                <span className="chat-report-card__bottom"><b>{reportTitle(report)}</b><time>{fullTime(report.created_at)}</time></span>
              </button>
            ))}
          </aside>

          <main className="chat-moderation__detail">
            {!selected ? (
              <div className="chat-moderation__placeholder">
                <Flag size={28} />
                <strong>Select an incident</strong>
                <span>The report dossier and resolution controls will appear here.</span>
              </div>
            ) : (
              <>
                <section className="chat-incident-dossier">
                  <header>
                    <span className="chat-incident-dossier__avatar">{personInitials(selected.sender_name)}</span>
                    <span>
                      <h3>{selected.sender_name}</h3>
                      <p>{reportTitle(selected)} · #{caseCode(selected)}</p>
                    </span>
                    <span className={"chat-report-status is-" + selected.status}>{statusLabels[selected.status]}</span>
                  </header>
                  <div className="chat-incident-dossier__meta">
                    <span><small>Flag category</small><b><Flag size={13} /> {selected.reason}</b></span>
                    <span><small>Report source</small><b>{selected.reporter_name} · Peer report</b></span>
                    <span><small>Reported</small><b><Clock3 size={13} /> {fullTime(selected.created_at)}</b></span>
                    <span><small>Channel</small><b>{selected.conversation_kind === "direct" ? "Direct message" : "Group message"}</b></span>
                  </div>
                  <blockquote className="chat-flagged-message">
                    <span><Flag size={14} fill="currentColor" /> Verbatim reported message</span>
                    <p>“{selected.message_body || "Attachment or empty message"}”</p>
                    <b>Flagged target</b>
                  </blockquote>
                </section>

                <section className="chat-review-context">
                  <header>
                    <span><MessageSquareText size={17} /><strong>Conversation context</strong></span>
                    <small>Preceding {Math.max(0, selected.context_messages.length - 1)} messages</small>
                  </header>
                  <div>
                    {selected.context_messages.map((message) => (
                      <article key={message.id} className={message.is_flagged ? "is-flagged" : ""}>
                        <span><b>{message.sender_name}</b><time>{fullTime(message.created_at)}</time></span>
                        <p>{message.body || "Attachment"}</p>
                        {message.is_flagged ? <em>Reported</em> : null}
                      </article>
                    ))}
                  </div>
                </section>

                {selected.status === "resolved" || selected.status === "dismissed" ? (
                  <section className="chat-review-outcome">
                    <CheckCircle2 size={21} />
                    <span>
                      <small>Compliance completed</small>
                      <strong>{actionLabels[selected.action_taken] ?? "Review completed"}</strong>
                      <p>{selected.resolution_note || "No review note was recorded."}</p>
                      <em>{selected.assignee_name ? "Handled by " + selected.assignee_name + " · " : ""}{selected.resolved_at ? fullTime(selected.resolved_at) : ""}</em>
                    </span>
                  </section>
                ) : (
                  <section className="chat-review-controls">
                    <header>
                      <span><strong>Resolution station</strong><small>Institutional safeguarding ledger</small></span>
                      <ShieldAlert size={18} />
                    </header>
                    <div className="chat-review-fields">
                      <label>
                        <span>Assigned pastoral reviewer</span>
                        {selected.can_assign ? (
                          <select value={assignee} onChange={(event) => setAssignee(event.target.value)} disabled={pending}>
                            <option value="">Take ownership myself</option>
                            {reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.name} · {reviewer.role === "admin" ? "Administrator" : "Staff"}</option>)}
                          </select>
                        ) : <strong className="chat-review-assignee"><UserCheck size={16} /> {selected.assignee_name || "Assigned to you"}</strong>}
                      </label>
                      <label className="chat-review-note">
                        <span>Pastoral observation &amp; action notes <b>Required</b></span>
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          maxLength={1000}
                          rows={4}
                          placeholder="Record student interview insights, parent contact status, or behavioural coaching plan…"
                        />
                      </label>
                    </div>

                    <div className="chat-review-suggestions" aria-label="Suggested note prompts">
                      <button type="button" onClick={() => setNote((value) => value ? value + " · Playful tone reviewed" : "Playful tone reviewed")}>+ Tone reviewed</button>
                      <button type="button" onClick={() => setNote((value) => value ? value + " · Parent briefed" : "Parent briefed")}>+ Parent briefed</button>
                      <button type="button" onClick={() => setNote((value) => value ? value + " · Restorative conversation scheduled" : "Restorative conversation scheduled")}>+ Restorative chat</button>
                    </div>

                    {selected.status === "open" ? (
                      <button type="button" className="chat-review-start" disabled={pending} onClick={() => update({ status: "under_review", note: note.trim() })}>
                        {pending ? <LoaderCircle className="chat-spin" size={17} /> : <UserCheck size={17} />}
                        Assign &amp; start pastoral review
                      </button>
                    ) : null}

                    <button type="button" className="chat-review-resolve" disabled={!canAct} onClick={() => update({ status: "resolved", action: "no_action", note: note.trim() })}>
                      <CheckCircle2 size={18} /> Resolve incident &amp; close ticket
                    </button>

                    <div className="chat-review-actions">
                      <button type="button" disabled={!canAct} onClick={() => update({ action: "warning", note: note.trim() })}>
                        <AlertTriangle size={16} /><span>Issue warning</span>
                      </button>
                      <span className="chat-review-restrict">
                        <select aria-label="Restriction length" value={restrictionDays} onChange={(event) => setRestrictionDays(Number(event.target.value))}>
                          {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days}d</option>)}
                        </select>
                        <button type="button" disabled={!canAct} onClick={() => update({ action: "restrict", note: note.trim(), restriction_days: restrictionDays })}>
                          <Ban size={16} /><span>Restrict chat</span>
                        </button>
                      </span>
                      <button type="button" disabled={!canAct} onClick={() => update({ status: "under_review", action: "escalate", note: note.trim() })}>
                        <ShieldAlert size={16} /><span>Escalate</span>
                      </button>
                      <button type="button" className="is-dismiss" disabled={!canAct} onClick={() => update({ status: "dismissed", action: "no_action", note: note.trim() })}>
                        <X size={16} /><span>Dismiss</span>
                      </button>
                    </div>
                    {error ? <p className="chat-review-error">{error}</p> : null}
                    <p className="chat-review-disclaimer"><LockKeyhole size={13} /> Every action is recorded in the institutional pastoral ledger. Private staff notes are never shared with the reporter.</p>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
