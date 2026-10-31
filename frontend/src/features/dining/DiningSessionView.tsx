import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import type { DiningAction, DiningSession } from "./diningApi";
import { DiningHistoryView, DiningPages, DiningSourceView, diningDate, diningIssueLabel, diningStateLabel } from "./DiningPrimitives";
import { DiningSessionDialog } from "./DiningSessionDialog";
import { DiningActionDialog, diningActionLabels } from "./DiningActionDialog";
import { DiningIssueReportDialog } from "./DiningIssueDialog";
import { DiningResponsibilityDialog } from "./DiningResponsibilityDialog";
import type { DiningPlanDate } from "./diningPlanApi";

export function DiningSessionView({ schoolId, actorId, session, planDate, timezone, readOnly, refresh, historyPage, issuesPage, onHistoryPage, onIssuesPage, issueHref, onIssueSaved, onTransferred, onMaterialized }: {
  schoolId: string; actorId: string; session: DiningSession; timezone: string; readOnly: boolean; refresh: () => Promise<unknown>;
  historyPage: number; issuesPage: number; onHistoryPage: (page: number) => void; onIssuesPage: (page: number) => void; issueHref: (id: string) => string; onIssueSaved: (id: string) => void;
  onTransferred: () => Promise<unknown>;
  planDate?: DiningPlanDate; onMaterialized?: (id: string) => void;
}) {
  const [edit, setEdit] = useState<"draft" | "publish" | "changes" | null>(null), [action, setAction] = useState<DiningAction | null>(null), [report, setReport] = useState(false), [responsibility, setResponsibility] = useState(false);
  const actions = readOnly ? [] : session.allowed_actions, lifecycle = (["open", "pause", "resume", "end", "cancel"] as DiningAction[]).filter(value => actions.includes(value));
  return <><section className="dining-summary" aria-label="Dated service summary">
    <header><h2>{session.label}</h2><span className={`dining-status is-${session.state}`}>{planDate?.cancelled_for_date ? "Cancelled for this date" : planDate ? session.operations_mode === "reference" ? "Menu and hours planned" : "Planned · not opened" : session.operations_mode === "reference" && session.state === "published" ? "Menu and hours published" : diningStateLabel(session.state)}</span></header>
    <p>{session.service.label}{session.place ? ` · ${session.place.label}` : ""}</p>
    {planDate ? <p className="dining-caption">{planDate.local_date} · From the published weekly menu. No serving has been recorded.</p> : null}
    {session.location_path?.length ? <p className="dining-caption">{session.location_path.filter(place => place.id !== session.place?.id).map(place => place.label).join(" · ")}</p> : null}
    <dl className="dining-facts"><div><dt>Serving availability</dt><dd>{planDate && !planDate.starts_at ? `${planDate.wall_times?.starts_at ?? "Unresolved"}–${planDate.wall_times?.ends_at ?? "Unresolved"} · local clock time${planDate.cancelled_for_date ? " · cancelled" : " · needs review"}` : `${diningDate(session.starts_at, timezone)} – ${diningDate(session.ends_at, timezone)}`}</dd></div><div><dt>{session.operations_mode === "native" ? "Operator" : "Menu coordinator"}</dt><dd>{session.operations_mode === "native" ? session.operator.label : session.coordinator.label}</dd></div></dl>
    <p className="dining-caption">{timezone} · Not a venue reservation.</p>{session.route_unavailable ? <p className="dining-warning">Responsibility needs review. A new recipient is not assumed.</p> : null}
    <div className="dining-inline">{actions.includes("publish") ? <button type="button" onClick={() => setEdit("publish")}>Review & publish</button> : null}{actions.includes("save") ? <button type="button" className="is-secondary" onClick={() => setEdit("draft")}>Edit draft</button> : null}{lifecycle.map((value, index) => <button key={value} type="button" className={index || value === "cancel" ? "is-secondary" : ""} onClick={() => setAction(value)}>{diningActionLabels[value]}</button>)}</div>
  </section>
  {planDate?.needs_time_resolution ? <p className="dining-warning">Clock time needs review for {planDate.local_date}: {planDate.wall_times?.starts_at}–{planDate.wall_times?.ends_at}{planDate.wall_times?.end_day_offset ? " next day" : ""} ({planDate.timezone}). No exact serving time is assumed. Change this date to resolve it.</p> : null}
  {session.menu_mode === "native" ? <section className="dining-section"><header><h3>Menu{session.state === "draft" ? " · draft" : ""}</h3>{actions.includes("publish_changes") ? <button type="button" className="is-text" onClick={() => setEdit("changes")}>{planDate ? "Change this date" : "Change menu & hours"}</button> : null}</header><p className="dining-menu">{session.menu_text || "No menu entered yet."}</p></section> : null}
  {session.source ? <DiningSourceView source={session.source} timezone={timezone} /> : null}
  {(session.count_total !== null || session.allowed_actions.some(value => value === "count" || value === "correct_count")) && session.operations_mode === "native" ? <section className="dining-section" aria-label="Serving records"><header><h3>Recorded serving total</h3>{actions.includes("count") ? <button type="button" onClick={() => setAction("count")}>Record total</button> : null}</header><p className="dining-count">{session.count_receipt_id ? session.count_total : "Not recorded"}</p><p className="dining-caption">Cumulative meals handed over · not named diners, occupancy or charges.</p>{actions.includes("correct_count") ? <button type="button" className="is-text dining-back" onClick={() => setAction("correct_count")}>Correct total</button> : null}</section> : null}
  {session.menu_mode === "reference" && actions.includes("publish_changes") ? <button type="button" className="is-text dining-back" onClick={() => setEdit("changes")}>Change serving hours</button> : null}
  {session.issues?.length || issuesPage > 1 || actions.includes("report_issue") ? <section className="dining-section"><header><h3>Shortages & problems</h3>{actions.includes("report_issue") ? <button type="button" className="is-secondary" onClick={() => setReport(true)}>Report shortage</button> : null}</header>{session.issues?.length ? <><ul className="dining-list">{session.issues.map(issue => <li key={issue.id}><Link className="dining-entry" to={issueHref(issue.id)}><ProductIcon name="dining" size={28} /><span><strong>{issue.title}</strong><small>{issue.handler.label} · {diningIssueLabel(issue.state)}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul><DiningPages page={issuesPage} hasMore={session.issues_pagination?.has_more ?? false} onChange={onIssuesPage} label="Shortage pages" /></> : <p className="dining-caption">No reports on this page.</p>}{!session.issues?.length ? <DiningPages page={issuesPage} hasMore={false} onChange={onIssuesPage} label="Shortage pages" /> : null}</section> : null}
  {actions.includes("reassign") ? <button type="button" className="is-text dining-back" onClick={() => setResponsibility(true)}>Change responsibility</button> : null}
  {session.history?.length || historyPage > 1 ? <><DiningHistoryView entries={session.history ?? []} timezone={timezone} /><DiningPages page={historyPage} hasMore={session.history_pagination?.has_more ?? false} onChange={onHistoryPage} label="Service history pages" /></> : null}
  {edit ? <DiningSessionDialog schoolId={schoolId} actorId={actorId} initial={session} {...(planDate ? { planDate } : {})} publish={edit === "publish"} timezone={timezone} refresh={refresh} onClose={() => setEdit(null)} onSaved={id => { setEdit(null); onMaterialized?.(id); }} /> : null}
  {action ? <DiningActionDialog key={action} schoolId={schoolId} actorId={actorId} initial={session} {...(planDate ? { planDate } : {})} action={action} timezone={timezone} refresh={refresh} onClose={() => setAction(null)} {...(onMaterialized ? { onSaved: onMaterialized } : {})} /> : null}
  {report ? <DiningIssueReportDialog schoolId={schoolId} actorId={actorId} initial={session} refresh={refresh} onClose={() => setReport(false)} onSaved={id => { setReport(false); onIssueSaved(id); }} /> : null}
  {responsibility ? <DiningResponsibilityDialog schoolId={schoolId} actorId={actorId} id={session.id} revision={session.revision} kind="session" refresh={onTransferred} onClose={() => setResponsibility(false)} /> : null}
  </>;
}
