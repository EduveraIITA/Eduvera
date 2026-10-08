/* eslint-disable */
// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
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
  standalone = false,
  staffView = false,
}: {
  queue?: ChatReportQueue;
  reviewers: ChatReportReviewer[];
  loading: boolean;
  pending: boolean;
  error?: string;
  loadError?: string;
  onClose?: () => void;
  onRefresh: () => void;
  onUpdate: (reportId: string, input: ChatReportUpdate) => void;
  standalone?: boolean;
  staffView?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [localFilter, setLocalFilter] = useState<ReportFilter>("active");
  const [localId, setLocalId] = useState("");
  const filter: ReportFilter = standalone ? (["resolved", "dismissed"].includes(params.get("report_status") ?? "") ? params.get("report_status") as ReportFilter : "active") : localFilter;
  const selectedId = standalone ? params.get("report") ?? "" : localId;
  const setSelectedId = (id: string) => {
    if (!standalone) { setLocalId(id); return; }
    setParams(current => { current.set("section", "message_reports"); if (id) current.set("report", id); else current.delete("report"); return current; });
  };
  const setFilter = (value: ReportFilter) => {
    if (!standalone) { setLocalFilter(value); setLocalId(""); return; }
    setParams(current => { current.set("report_status", value); current.delete("report"); return current; });
  };
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [restrictionDays, setRestrictionDays] = useState(7);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selectedId) detailRef.current?.focus({ preventScroll: true }); }, [selectedId]);
  const reports = useMemo(() => {
    const all = queue?.results ?? [];
    if (filter === "active") return all.filter((item) => item.status === "open" || item.status === "under_review");
    return all.filter((item) => item.status === filter);
  }, [filter, queue?.results]);
  // A selected report remains open after its status changes. Never silently open
  // a different case when the requested report is missing or no longer visible.
  const selected = queue?.results.find((item) => item.id === selectedId);
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
    <div className={standalone ? "chat-moderation-page" : "chat-picker-backdrop chat-moderation-backdrop"} role={standalone ? undefined : "presentation"} onMouseDown={(event) => {
      if (!standalone && event.target === event.currentTarget) onClose?.();
    }}>
      <section className={`${standalone ? "chat-moderation chat-moderation--standalone" : "chat-moderation"} chat-moderation--focused`} role={standalone ? "region" : "dialog"} aria-modal={standalone ? undefined : "true"} aria-labelledby="moderation-title">
        {standalone ? <h2 className="sr-only" id="moderation-title">{selectedId ? "Message report" : "Message reports"}</h2> : <header className="chat-moderation__header">
          {selectedId ? <button type="button" onClick={()=>setSelectedId("")} aria-label="Back to reports"><ArrowLeft size={20}/></button> : null}
          <strong id="moderation-title">{selectedId ? "Message report" : "Message reports"}</strong>
          <button type="button" onClick={onClose} aria-label="Close safeguarding queue"><X size={20}/></button>
        </header>}
        <p className="message-report-privacy"><LockKeyhole size={14}/>{staffView ? "Confidential · Assigned to you" : "Confidential · Authorised reviewers only"}</p>
        {!selectedId ? <div className="workspace-list-toolbar"><select aria-label="Report status" value={filter} onChange={event=>setFilter(event.target.value as ReportFilter)}>
          <option value="active">Active · {activeCount}</option><option value="resolved">Resolved · {queue?.summary.resolved ?? 0}</option><option value="dismissed">Dismissed · {queue?.summary.dismissed ?? 0}</option>
        </select></div> : null}

        <div className="chat-moderation__body">
          {!selectedId ? <section className="chat-moderation__list" aria-label="Safeguarding incidents">
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
                <span>{filter === "active" ? (staffView ? "You have no active assigned incidents." : "The active pastoral queue is clear.") : "No incidents have this status."}</span>
                <button type="button" onClick={onRefresh}>Refresh</button>
              </div>
            ) : reports.map((report) => (
              <button
                type="button"
                key={report.id}
                className="message-report-row"
                onClick={() => setSelectedId(report.id)}
              >
                <span className="message-report-row__copy"><strong>{report.sender_name || "Unknown sender"}</strong><span>{report.reason}</span><small>{reportTitle(report)} · {fullTime(report.created_at)}</small><span className={"chat-report-status is-" + report.status}>{statusLabels[report.status]}</span></span><ChevronRight size={18}/>
              </button>
            ))}
          </section> : <section ref={detailRef} tabIndex={-1} className="chat-moderation__detail" aria-label="Report details">
            {!selected ? (
              <div className="chat-moderation__placeholder">
                <strong>{loading ? "Loading report…" : loadError ? "Report could not be loaded" : "Report unavailable"}</strong>
                <span>{loadError || (!loading ? "It may no longer be assigned to you. Return to the report list or refresh." : "")}</span>
                {!loading ? <button type="button" onClick={onRefresh}>Refresh</button> : null}
              </div>
            ) : (
              <>
                <section className="chat-incident-dossier">
                  <header>
                    <span className="chat-incident-dossier__avatar">{personInitials(selected.sender_name)}</span>
                    <span>
                      <h2>{selected.sender_name}</h2>
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
                    <span><Flag size={14} /> Reported message</span>
                    <p>“{selected.message_body || "Attachment or empty message"}”</p>
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
                      <small>Review outcome</small>
                      <strong>{actionLabels[selected.action_taken] ?? "Review completed"}</strong>
                      <p>{selected.resolution_note || "No review note was recorded."}</p>
                      <em>{selected.assignee_name ? "Handled by " + selected.assignee_name + " · " : ""}{selected.resolved_at ? fullTime(selected.resolved_at) : ""}</em>
                    </span>
                  </section>
                ) : (
                  <section className="chat-review-controls">
                    <header>
                      <strong>Review &amp; action</strong>
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
                        <span>Review notes <b>Required</b></span>
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          maxLength={1000}
                          rows={4}
                          placeholder="Record student interview insights, parent contact status, or behavioural coaching plan…"
                        />
                      </label>
                    </div>

                    {selected.status === "open" ? (
                      <button type="button" className="chat-review-start" disabled={pending} onClick={() => update({ status: "under_review", note: note.trim() })}>
                        {pending ? <LoaderCircle className="chat-spin" size={17} /> : <UserCheck size={17} />}
                        Assign &amp; start review
                      </button>
                    ) : null}

                    <button type="button" className="chat-review-resolve" disabled={!canAct} onClick={() => update({ status: "resolved", action: "no_action", note: note.trim() })}>
                      <CheckCircle2 size={18} /> Resolve report
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
                    {error ? <p className="chat-review-error" role="alert">{error}</p> : null}
                    <p className="chat-review-disclaimer"><LockKeyhole size={13} /> Every action is recorded in the institutional pastoral ledger. Private staff notes are never shared with the reporter.</p>
                  </section>
                )}
              </>
            )}
          </section>}
        </div>
      </section>
    </div>
  );
}
