import { useState } from "react";
import { BookOpenText, CheckCircle2, Clock3, Download, ExternalLink, FileText, MapPin, Plus, UsersRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { InfoSummary } from "../../components/InfoSummary";
import { portalReturnState } from "../navigation/portalReturnState";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LessonEditor } from "./LessonEditor";
import { MaterialEditor } from "./MaterialEditor";
import { WorkLinkEditor } from "./WorkLinkEditor";
import { sessionActionHref, sessionDateLabel, sessionTimeLabel, type SessionAction, type TeachingMaterial, type TeachingSessionDetail } from "./api";

function WebAddress({ href, children }: { href: string | null; children: React.ReactNode }) {
  let safe = false;
  try { safe = Boolean(href && ["https:", "http:"].includes(new URL(href).protocol)); } catch { /* Invalid source links are never made executable. */ }
  return safe ? <a className="teaching-text-action" href={href!} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={16} aria-hidden="true" /></a> : <p className="teaching-caption">This link is unavailable.</p>;
}
function Resource({ item, onReplace }: { item: TeachingMaterial; onReplace?: () => void }) {
  const downloadable = item.download_href?.startsWith("/api/v1/learning/sessions/") && !item.download_href.startsWith("//") && !item.source_content_omitted;
  return <article className="teaching-resource">
    <header><span aria-hidden="true">{item.kind === "file" ? <FileText size={19} /> : <BookOpenText size={19} />}</span><span><h3>{item.title}</h3><small>{item.shared ? "Shared with participants" : "Instructors only"}{item.original_name ? ` · ${item.original_name}` : ""}</small></span></header>
    {item.source_content_omitted ? <p className="teaching-caption">File content was not included in this simulation. Live content will not be opened.</p> : item.kind === "text" ? <pre className="teaching-code">{item.body}</pre> : item.kind === "link" ? <WebAddress href={item.url}>Open resource</WebAddress> : downloadable ? <a className="teaching-text-action" href={item.download_href!} download><Download size={17} aria-hidden="true" />Download{item.size_bytes !== null ? ` · ${Math.ceil(item.size_bytes / 1024)} KiB` : ""}</a> : <p className="teaching-caption">This file is currently unavailable.</p>}
    {item.replaces_material_id ? <p className="teaching-caption">Updated version · the original stays in history.</p> : null}
    {onReplace ? <button className="teaching-resource-version" type="button" onClick={onReplace}>New version</button> : null}
  </article>;
}

export function TeachingSessionWorkspace({ data, schoolId, actorId, refresh, readError, historyPage, onHistoryPage, onAccessLost }: { data: TeachingSessionDetail; schoolId: string; actorId: string; refresh: () => Promise<TeachingSessionDetail>; readError: boolean; historyPage: number; onHistoryPage: (page: number) => void; onAccessLost: () => void }) {
  const environment = useExecutionEnvironment(), location = useLocation();
  const [editor, setEditor] = useState<"lesson" | "resource" | "work" | null>(null);
  const [replacing, setReplacing] = useState<TeachingMaterial | undefined>();
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const canManage = data.capabilities.can_manage && !readOnly && data.session.state !== "cancelled";
  const instructor = data.capabilities.can_read_preparation;
  const reported = data.lesson.state === "reported";
  const materials = data.materials.filter(item => item.shared || instructor);
  const replacedIds = new Set(materials.map(item => item.replaces_material_id).filter(Boolean));
  const currentMaterials = materials.filter(item => !replacedIds.has(item.id)), earlierMaterials = materials.filter(item => replacedIds.has(item.id));
  const origin = `${location.pathname}${location.search}`;
  const action = (item: SessionAction | null, className = "teaching-text-action") => {
    const href = sessionActionHref(item?.href);
    return item && href ? <Link className={className} to={href} state={portalReturnState(origin, href)}>{item.label}</Link> : null;
  };
  return <div className="teaching-sessions">
    {readError ? <p className="teaching-error" role="alert">This session could not refresh. Your open work is kept. <button onClick={() => void refresh().catch(() => undefined)}>Refresh session</button></p> : null}
    {readOnly ? <p className="teaching-caption" role="status">This simulation has ended. Its saved session is read-only.</p> : null}
    <section className="teaching-session-summary" aria-label="Session summary">
      <div className="teaching-session-status"><span><Clock3 size={16} aria-hidden="true" />{sessionDateLabel(data.session.date)} · {sessionTimeLabel(data.session.starts_at, data.session.timezone)}–{sessionTimeLabel(data.session.ends_at, data.session.timezone)}</span><strong>{data.session.state === "cancelled" ? "Cancelled" : reported ? <><CheckCircle2 size={16} aria-hidden="true" />Reported</> : instructor && data.lesson.state === "prepared" ? "Prepared" : "Scheduled"}</strong></div>
      <dl className="teaching-summary-facts"><div><dt><UsersRound size={16} aria-hidden="true" />Group</dt><dd>{data.session.group_label}</dd></div><div><dt><MapPin size={16} aria-hidden="true" />Place</dt><dd>{data.session.place_label || "Not assigned"}</dd></div><div><dt>Teacher</dt><dd>{data.session.teacher_name || "Not assigned"}{data.session.is_cover ? <small>Accepted cover{data.session.original_teacher_name ? ` · for ${data.session.original_teacher_name}` : ""}</small> : null}</dd></div></dl>
      {data.related.attendance || data.related.schedule ? <div className="teaching-summary-actions">{action(data.related.attendance, "teaching-primary-link")}{action(data.related.schedule)}</div> : null}
      {data.related.attendance?.grain === "daily_class" ? <p className="teaching-caption">Attendance is recorded for the day, not separately for this lesson.</p> : null}
      {data.availability_reason ? <p className="teaching-caption" role="status">{data.availability_reason}</p> : null}
    </section>
    {data.previous_lesson ? <section className="teaching-previous" aria-labelledby="previous-lesson-heading"><div><h2 id="previous-lesson-heading">Previously taught</h2><small>{sessionDateLabel(data.previous_lesson.date)}</small></div><strong>{data.previous_lesson.topic}</strong>{data.previous_lesson.learner_notes ? <p className="teaching-prose">{data.previous_lesson.learner_notes}</p> : null}{action({ href: data.previous_lesson.href, label: "Open previous lesson" })}</section> : null}
    <section className="teaching-session-section" aria-labelledby="session-lesson-heading">
      <header><h2 id="session-lesson-heading">Lesson record</h2>{canManage ? <button disabled={readError} onClick={() => setEditor("lesson")}>{reported ? "Correct" : "Record lesson"}</button> : null}</header>
      {reported || instructor && data.lesson.state === "prepared" ? <div className="teaching-lesson-record">{data.lesson.topic ? <h3>{data.lesson.topic}</h3> : null}{data.lesson.learner_notes ? <p className="teaching-prose">{data.lesson.learner_notes}</p> : null}<p className="teaching-caption">{reported ? `Instructor reported${data.lesson.reported_at ? ` · ${new Date(data.lesson.reported_at).toLocaleString()}` : ""}` : "Prepared privately · not reported as taught"}</p></div> : <p className="teaching-caption">No lesson has been reported yet.</p>}
      {instructor && data.lesson.preparation ? <details className="teaching-disclosure"><summary>Teacher preparation</summary><p className="teaching-prose">{data.lesson.preparation}</p><p className="teaching-caption">Private to authorized instructors.</p></details> : null}
      <details className="teaching-disclosure"><InfoSummary>What this record means</InfoSummary><p className="teaching-caption">The topic and learner notes are the instructor’s report. Attendance, assignment submission and teaching completion are separate records.</p></details>
    </section>
    <section className="teaching-session-section" aria-labelledby="session-resources-heading"><header><h2 id="session-resources-heading">Resources</h2>{canManage ? <button disabled={readError} onClick={() => { setReplacing(undefined); setEditor("resource"); }}><Plus size={17} aria-hidden="true" />Add</button> : null}</header>{currentMaterials.length ? <div className="teaching-resource-list">{currentMaterials.map(item => <Resource key={item.id} item={item} onReplace={canManage && !readError ? () => { setReplacing(item); setEditor("resource"); } : undefined} />)}</div> : <p className="teaching-caption">No shared resources yet.</p>}{earlierMaterials.length ? <details className="teaching-disclosure"><summary>Earlier resource versions · {earlierMaterials.length}</summary><div className="teaching-resource-list">{earlierMaterials.map(item => <Resource key={item.id} item={item} />)}</div></details> : null}</section>
    {data.related.assignments || data.related.practice || data.associated_work?.length || data.capabilities.can_link_work ? <section className="teaching-session-section" aria-labelledby="session-work-heading"><header><h2 id="session-work-heading">Learning work</h2>{canManage && data.capabilities.can_link_work ? <button disabled={readError} onClick={() => setEditor("work")}>Link work</button> : null}</header>{data.associated_work?.length ? <div className="teaching-session-list">{data.associated_work.map(item => { const href = sessionActionHref(item.href); return href ? <Link key={item.id} to={href} state={portalReturnState(origin, href)}><BookOpenText size={20} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.work_kind === "assignment" ? "Assignment" : "Practice"}{item.due_at ? ` · Due ${new Date(item.due_at).toLocaleDateString()}` : ""}</small></span></Link> : null; })}</div> : null}<div className="teaching-related-actions">{action(data.related.assignments)}{action(data.related.practice)}</div><p className="teaching-caption">Work opens with its own audience and reviewer permissions.</p></section> : null}
    {data.history.items.length ? <details className="teaching-disclosure teaching-history"><summary>Lesson history</summary><div>{data.history.items.filter(item => instructor || item.state === "reported").map(item => <article key={item.revision}><header><strong>{item.state === "reported" ? "Lesson reported" : "Preparation saved"}</strong><small>{item.actor_name} · {new Date(item.recorded_at).toLocaleString()}</small></header>{item.topic ? <p className="teaching-prose">{item.topic}</p> : null}{item.learner_notes ? <p className="teaching-prose">{item.learner_notes}</p> : null}{item.reason ? <p className="teaching-caption">Correction: {item.reason}</p> : null}{instructor && item.preparation ? <details><summary>Private preparation</summary><p className="teaching-prose">{item.preparation}</p></details> : null}</article>)}</div>{historyPage > 1 || data.history.has_more ? <nav className="teaching-actions" aria-label="Lesson history pages"><button disabled={historyPage <= 1} onClick={() => onHistoryPage(historyPage - 1)}>Newer</button><button disabled={!data.history.has_more} onClick={() => onHistoryPage(historyPage + 1)}>Earlier</button></nav> : null}</details> : null}
    {canManage && editor === "lesson" ? <LessonEditor data={data} refresh={refresh} onAccessLost={onAccessLost} onClose={() => setEditor(null)} /> : null}
    {canManage && editor === "resource" ? <MaterialEditor data={data} initial={replacing} refresh={refresh} onAccessLost={onAccessLost} onClose={() => { setEditor(null); setReplacing(undefined); }} /> : null}
    {canManage && data.capabilities.can_link_work && editor === "work" ? <WorkLinkEditor data={data} schoolId={schoolId} actorId={actorId} refresh={refresh} onAccessLost={onAccessLost} onClose={() => setEditor(null)} /> : null}
  </div>;
}
