/* eslint-disable */
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Flag,
  LoaderCircle,
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
  open: "New",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const actionLabels: Record<string, string> = {
  none: "No action recorded",
  no_action: "No further action",
  warning: "Warning issued",
  restrict: "Messaging restricted",
  escalate: "Escalated",
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
          <span className="chat-moderation__mark"><ShieldAlert size={21} /></span>
          <span>
            <strong id="moderation-title">Message reports</strong>
            <small>Private safeguarding queue for authorised school staff</small>
          </span>
          <button type="button" onClick={onClose} aria-label="Close moderation queue"><X size={20} /></button>
        </header>

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
          <aside className="chat-moderation__list" aria-label="Reports">
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
                <span>{filter === "active" ? "The active review queue is clear." : "No reports have this status."}</span>
                <button type="button" onClick={onRefresh}>Refresh</button>
              </div>
            ) : reports.map((report) => (
              <button
                type="button"
                key={report.id}
                className={report.id === selected?.id ? "chat-report-card is-selected" : "chat-report-card"}
                onClick={() => setSelectedId(report.id)}
              >
                <span className={"chat-report-status is-" + report.status}>{statusLabels[report.status]}</span>
                <strong>{report.sender_name || "Unknown sender"}</strong>
                <small>{report.reason}</small>
                <span><b>{reportTitle(report)}</b><time>{fullTime(report.created_at)}</time></span>
              </button>
            ))}
          </aside>

          <main className="chat-moderation__detail">
            {!selected ? (
              <div className="chat-moderation__placeholder">
                <Flag size={28} />
                <strong>Select a report</strong>
                <span>Report details and review actions will appear here.</span>
              </div>
            ) : (
              <>
                <section className="chat-review-summary">
                  <div>
                    <span className={"chat-report-status is-" + selected.status}>{statusLabels[selected.status]}</span>
                    <h3>{selected.reason}</h3>
                    <p>Reported by <b>{selected.reporter_name}</b> · {fullTime(selected.created_at)}</p>
                  </div>
                  <span className="chat-review-summary__conversation">{reportTitle(selected)}</span>
                </section>

                <blockquote className="chat-flagged-message">
                  <span><Flag size={15} fill="currentColor" /> Reported message</span>
                  <strong>{selected.sender_name}</strong>
                  <p>{selected.message_body || "Attachment or empty message"}</p>
                  <time>{fullTime(selected.message_created_at)}</time>
                </blockquote>

                <section className="chat-review-context">
                  <header><strong>Conversation context</strong><small>Messages immediately before the report</small></header>
                  <div>
                    {selected.context_messages.map((message) => (
                      <article key={message.id} className={message.is_flagged ? "is-flagged" : ""}>
                        <span><b>{message.sender_name}</b><time>{fullTime(message.created_at)}</time></span>
                        <p>{message.body || "Attachment"}</p>
                      </article>
                    ))}
                  </div>
                </section>

                {selected.status === "resolved" || selected.status === "dismissed" ? (
                  <section className="chat-review-outcome">
                    <CheckCircle2 size={19} />
                    <span>
                      <strong>{actionLabels[selected.action_taken] ?? "Review completed"}</strong>
                      <p>{selected.resolution_note || "No review note was recorded."}</p>
                      <small>{selected.assignee_name ? "Handled by " + selected.assignee_name + " · " : ""}{selected.resolved_at ? fullTime(selected.resolved_at) : ""}</small>
                    </span>
                  </section>
                ) : (
                  <section className="chat-review-controls">
                    <div className="chat-review-fields">
                      <label>
                        <span>Assigned reviewer</span>
                        {selected.can_assign ? (
                          <select value={assignee} onChange={(event) => setAssignee(event.target.value)} disabled={pending}>
                            <option value="">Take ownership myself</option>
                            {reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.name} · {reviewer.role === "admin" ? "Administrator" : "Staff"}</option>)}
                          </select>
                        ) : <strong>{selected.assignee_name || "Assigned to you"}</strong>}
                      </label>
                      <label className="chat-review-note">
                        <span>Private review note <b>Required for an outcome</b></span>
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          maxLength={1000}
                          rows={3}
                          placeholder="Record what was reviewed and why this action is appropriate…"
                        />
                      </label>
                    </div>

                    {selected.status === "open" ? (
                      <button type="button" className="chat-review-start" disabled={pending} onClick={() => update({ status: "under_review", note: note.trim() })}>
                        {pending ? <LoaderCircle className="chat-spin" size={17} /> : <UserCheck size={17} />}
                        Assign & start review
                      </button>
                    ) : null}

                    <div className="chat-review-actions">
                      <button type="button" disabled={!canAct} onClick={() => update({ status: "resolved", action: "no_action", note: note.trim() })}>
                        <CheckCircle2 size={17} /><span>Resolve</span>
                      </button>
                      <button type="button" disabled={!canAct} onClick={() => update({ action: "warning", note: note.trim() })}>
                        <AlertTriangle size={17} /><span>Issue warning</span>
                      </button>
                      <span className="chat-review-restrict">
                        <select aria-label="Restriction length" value={restrictionDays} onChange={(event) => setRestrictionDays(Number(event.target.value))}>
                          {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}
                        </select>
                        <button type="button" disabled={!canAct} onClick={() => update({ action: "restrict", note: note.trim(), restriction_days: restrictionDays })}>
                          <Ban size={17} /><span>Restrict messaging</span>
                        </button>
                      </span>
                      <button type="button" disabled={!canAct} onClick={() => update({ status: "under_review", action: "escalate", note: note.trim() })}>
                        <ShieldAlert size={17} /><span>Escalate</span>
                      </button>
                      <button type="button" className="is-dismiss" disabled={!canAct} onClick={() => update({ status: "dismissed", action: "no_action", note: note.trim() })}>
                        <X size={17} /><span>Dismiss</span>
                      </button>
                    </div>
                    {error ? <p className="chat-review-error">{error}</p> : null}
                    <p className="chat-review-disclaimer">Actions are audit logged. Reporters receive a completion notice, but private staff notes are never shared.</p>
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
