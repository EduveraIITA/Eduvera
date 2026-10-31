import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useOptionalAuth } from "../auth/AuthContext";
import { campusDate } from "../activities/activityExperience";
import { portalReturnState } from "../navigation/portalReturnState";
import { applicationNow } from "../simulation/applicationTime";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { getTeachingSession, getTeachingSessions, openTeachingSession, sessionActionHref, sessionDateLabel, sessionHref, sessionTimeLabel, teachingDate, type TeachingSessionSelection } from "./api";
import { TeachingSessionWorkspace } from "./TeachingSessionWorkspace";
import "./teaching-sessions.css";

const accessLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
export function readTeachingSelection(params: URLSearchParams): TeachingSessionSelection | null | false {
  const session = params.get("session_id"), occurrence = params.get("occurrence_id"), classId = params.get("class_section_id"), period = params.get("period_number");
  const kinds = [params.has("session_id"), params.has("occurrence_id"), params.has("class_section_id") || params.has("period_number")].filter(Boolean).length;
  if (!kinds) return null;
  if (kinds !== 1) return false;
  if (session?.trim()) return { sessionId: session.trim() };
  if (occurrence?.trim()) return { occurrenceId: occurrence.trim() };
  const number = Number(period);
  return classId?.trim() && period && Number.isInteger(number) && number > 0 ? { classId: classId.trim(), period: number } : false;
}

export function TeachingSessionRoute() {
  const environment = useExecutionEnvironment(), manifest = useWorkspaceManifest(), auth = useOptionalAuth();
  const [params] = useSearchParams();
  const selection = readTeachingSelection(params);
  const title = selection ? "Session" : "Teaching sessions";
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title={title}><WorkspaceState state="unavailable" /></OperationsShell>;
  if (manifest.isPending) return <OperationsShell active="areas" title={title}><WorkspaceState state="loading" /></OperationsShell>;
  if (accessLost(manifest.error) || !manifest.data || !manifestMatchesEnvironment(manifest.data, environment)) return <OperationsShell active="areas" title={title}><WorkspaceState state={accessLost(manifest.error) ? "revoked" : "error"} error={manifest.error} onRetry={manifest.refetch} /></OperationsShell>;
  const date = params.get("date") ?? campusDate(applicationNow(), manifest.data.context.time_zone ?? "UTC");
  if (!teachingDate(date) || selection === false) return <OperationsShell active="areas" title={title} backTo="/areas/timetable"><p role="alert">This session link is incomplete. Open the current session from Timetable.</p><Link className="teaching-text-action" to="/areas/timetable">Open timetable</Link></OperationsShell>;
  const schoolId = manifest.data.context.institution_id, actorId = auth?.user?.id ?? manifest.data.context.actor_user_id ?? "session";
  const identity = JSON.stringify([schoolId, actorId, environment.mode, environment.mode === "simulation" ? environment.namespaceId : "live", environment.mode === "simulation" ? environment.runId : "live", selection, date]);
  return selection ? <SelectedTeachingSession key={identity} schoolId={schoolId} actorId={actorId} date={date} selection={selection} manifestReadError={Boolean(manifest.error)} /> : <TeachingSessionList key={identity} schoolId={schoolId} actorId={actorId} date={date} />;
}

function TeachingSessionList({ schoolId, actorId, date }: { schoolId: string; actorId: string; date: string }) {
  const environment = useExecutionEnvironment(), [params, setParams] = useSearchParams(), location = useLocation();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["teaching-sessions", schoolId, actorId, "list", date, page]), queryFn: () => getTeachingSessions(date, page) });
  const change = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next); };
  return <OperationsShell active="areas" title="Teaching sessions" backTo={`/areas/timetable/schedule?date=${date}`}><div className="teaching-sessions">
    <label className="teaching-date">Session date<TemporalInput type="date" required value={date} onChange={event => { if (teachingDate(event.target.value)) change({ date: event.target.value, page: "" }); }} /></label>
    {query.isPending ? <WorkspaceState state="loading" /> : query.error || !query.data || query.data.date !== date ? <WorkspaceState state={accessLost(query.error) ? "revoked" : "error"} error={query.error} onRetry={query.refetch} /> : <>
      {query.data.items.length ? <div className="teaching-session-list">{query.data.items.map(item => {
        const href = sessionActionHref(item.href) ?? sessionHref(item.id, item.date);
        return <Link key={item.id} to={href} state={portalReturnState(`${location.pathname}${location.search}`, href)}><ProductIcon name="learning" size={28} /><span><strong>{item.title}</strong><small>{sessionTimeLabel(item.starts_at, item.timezone)}–{sessionTimeLabel(item.ends_at, item.timezone)} · {item.group_label}{item.place_label ? ` · ${item.place_label}` : ""}</small><small>{item.state === "cancelled" ? "Cancelled" : item.lesson_state === "reported" ? "Lesson reported" : item.lesson_state === "prepared" ? "Prepared" : item.teacher_name ?? "Teacher not assigned"}</small></span><ChevronRight size={18} aria-hidden="true" /></Link>;
      })}</div> : <section className="teaching-empty"><ProductIcon name="learning" size={32} /><h2>No teaching sessions for this date</h2><p className="teaching-caption">Your assigned sessions and shared learning records appear here. Scheduling a session does not grant teaching authority.</p><Link className="teaching-text-action" to={`/areas/timetable/schedule?date=${date}`}>Open timetable</Link></section>}
      {query.data.total_pages > 1 ? <nav className="teaching-actions" aria-label="Session pages"><button disabled={page <= 1} onClick={() => change({ page: String(page - 1) })}>Previous</button><span className="teaching-caption">{page} of {query.data.total_pages}</span><button disabled={page >= query.data.total_pages} onClick={() => change({ page: String(page + 1) })}>Next</button></nav> : null}
    </>}
  </div></OperationsShell>;
}

function SelectedTeachingSession({ schoolId, actorId, date, selection, manifestReadError }: { schoolId: string; actorId: string; date: string; selection: TeachingSessionSelection; manifestReadError: boolean }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), [params, setParams] = useSearchParams(), location = useLocation();
  const [revoked, setRevoked] = useState(false);
  const historyPage = Math.max(1, Number(params.get("history_page")) || 1);
  const root = executionEnvironmentQueryKey(environment, ["teaching-sessions", schoolId, actorId]);
  const query = useQuery({ queryKey: [...root, "detail", selection, date, historyPage], queryFn: () => "sessionId" in selection ? getTeachingSession(selection.sessionId, date, historyPage) : openTeachingSession(date, selection, historyPage) });
  const data = query.data;
  const valid = data && data.session.date === date && (!("sessionId" in selection) || data.session.id === selection.sessionId);
  const returnState: unknown = location.state;
  useEffect(() => {
    if (!data || !valid || "sessionId" in selection || query.error) return;
    const canonical = { sessionId: data.session.id };
    client.setQueryData([...root, "detail", canonical, date, historyPage], data);
    const next = new URLSearchParams(params); ["occurrence_id", "class_section_id", "period_number"].forEach(key => next.delete(key)); next.set("session_id", data.session.id); setParams(next, { replace: true, state: returnState });
  }, [data, valid, selection, query.error, client, date, historyPage, params, root, setParams, returnState]);
  const refresh = async () => {
    const result = await query.refetch({ throwOnError: true });
    if (!result.data || result.data.session.date !== date || result.data.session.id !== data?.session.id) throw new Error("The current session did not match this view.");
    await client.invalidateQueries({ queryKey: root, refetchType: "none" });
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
    return result.data;
  };
  const title = valid && !accessLost(query.error) && !revoked ? data.session.title : "Session";
  return <OperationsShell active="areas" title={title} backTo={`/areas/timetable/session?date=${date}`}>
    {query.isPending ? <WorkspaceState state="loading" /> : !valid || accessLost(query.error) || revoked ? <WorkspaceState state={accessLost(query.error) || revoked ? "revoked" : "error"} error={query.error} onRetry={async () => { const fresh = await query.refetch(); if (!fresh.error && fresh.data?.session.id === data?.session.id && fresh.data?.session.date === date) setRevoked(false); }} /> : <TeachingSessionWorkspace schoolId={schoolId} actorId={actorId} data={data} refresh={refresh} readError={Boolean(query.error) || manifestReadError} historyPage={historyPage} onAccessLost={() => setRevoked(true)} onHistoryPage={page => { const next = new URLSearchParams(params); next.set("history_page", String(page)); setParams(next); }} />}
    {!valid && !query.isPending ? <p className="teaching-caption">{sessionDateLabel(date)} · No other session was substituted.</p> : null}
  </OperationsShell>;
}
export default TeachingSessionRoute;
