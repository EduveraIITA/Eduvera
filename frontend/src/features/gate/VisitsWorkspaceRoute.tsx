import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { IN_OUT_VISITS_PATH, IN_OUT_WORKSPACE_PATH } from "./gateRoutes";
import { getVisit, getVisits, type VisitDetail, type VisitsView } from "./visitApi";
import { VisitDetailView } from "./VisitDetailView";
import { VisitEditor } from "./VisitEditor";
import { VisitPages, VisitReadError, visitAccessLost, visitWindow } from "./VisitPrimitives";
import { getSharedVisit, getSharedVisits, getVisitSharingDiscovery } from "./visitSharingApi";
import { SharedVisitView } from "./SharedVisitView";
import "./visits.css";

export function WorkspaceVisitsRoute() {
  const environment = useExecutionEnvironment(), auth = useOptionalAuth(), manifest = useWorkspaceManifest();
  const area = manifest.data?.areas.find(item => item.surfaces.some(surface => surface.href === IN_OUT_VISITS_PATH));
  const backTo = area?.surfaces.some(surface => surface.href !== IN_OUT_VISITS_PATH) ? IN_OUT_WORKSPACE_PATH : "/areas";
  const shell = (body: ReactNode) => <OperationsShell active="areas" title="Visits" backTo={backTo}>{body}</OperationsShell>;
  if (environment.mode === "simulation" && environment.unavailable) return shell(<WorkspaceState state="unavailable" />);
  if (manifest.isPending) return shell(<WorkspaceState state="loading" />);
  if (manifest.error) return shell(<WorkspaceState state={manifest.error instanceof ApiError && manifest.error.status === 403 ? "revoked" : "error"} error={manifest.error} onRetry={manifest.refetch} />);
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment) || !manifest.data.areas.some(area => area.surfaces.some(surface => surface.href === IN_OUT_VISITS_PATH))) return shell(<WorkspaceState state="revoked" />);
  const schoolId = manifest.data.context.institution_id, actorId = auth?.user?.id ?? manifest.data.context.actor_user_id;
  if (!schoolId || !actorId) return shell(<WorkspaceState state="revoked" />);
  const key = JSON.stringify([schoolId, actorId, environment.mode, environment.mode === "simulation" ? environment.namespaceId : "live"]);
  return shell(<VisitsEntry key={key} schoolId={schoolId} actorId={actorId} timezone={manifest.data.context.time_zone ?? "UTC"} />);
}
function pageNumber(value: string | null) { const number = Number(value); return Number.isFinite(number) ? Math.max(1, Math.floor(number) || 1) : 1; }
export function VisitsEntry({ schoolId, actorId, timezone }: { schoolId: string; actorId: string; timezone: string }) {
  const world = useExecutionEnvironment(), [params, setParams] = useSearchParams(), direct = params.get("shared") === "1" && Boolean(params.get("visit"));
  const discovery = useQuery({ queryKey: executionEnvironmentQueryKey(world, ["gate-visits", schoolId, actorId, "discovery"]), queryFn: ({ signal }) => getVisitSharingDiscovery(schoolId, signal), enabled: !direct, retry: false });
  if (direct) return <SharedVisitsWorkspace schoolId={schoolId} actorId={actorId} />;
  if (discovery.isPending) return <WorkspaceState state="loading" />;
  if (discovery.error || !discovery.data) return <div className="visits-workspace"><VisitReadError error={discovery.error} onRetry={discovery.refetch} /></div>;
  const mode = !discovery.data.can_manage || params.get("shared") === "1" ? "shared" : "campus";
  return <>{discovery.data.can_manage && (discovery.data.has_shared || discovery.data.has_questions) && !params.get("visit") ? <div className="visits-workspace"><div className="visits-mode" aria-label="Visit view">{(["campus", "shared"] as const).map(value => <button key={value} type="button" className="is-secondary" aria-pressed={mode === value} onClick={() => { const next = new URLSearchParams(params); next.delete("visit"); next.delete("page"); if (value === "shared") next.set("shared", "1"); else next.delete("shared"); setParams(next); }}>{value === "campus" ? "Campus visits" : "Shared with me"}</button>)}</div></div> : null}{mode === "shared" ? <SharedVisitsWorkspace schoolId={schoolId} actorId={actorId} /> : <VisitsWorkspace schoolId={schoolId} actorId={actorId} timezone={timezone} />}</>;
}
export function SharedVisitsWorkspace({ schoolId, actorId }: { schoolId: string; actorId: string }) {
  const world = useExecutionEnvironment(), [params, setParams] = useSearchParams(), id = params.get("visit"), page = pageNumber(params.get("page"));
  const root = executionEnvironmentQueryKey(world, ["gate-visits", schoolId, actorId, "shared"]);
  const list = useQuery({ queryKey: [...root, "list", page], queryFn: ({ signal }) => getSharedVisits(schoolId, page, signal), enabled: !id, retry: false });
  const detail = useQuery({ queryKey: [...root, "detail", id], queryFn: ({ signal }) => getSharedVisit(schoolId, id!, signal), enabled: Boolean(id), retry: false });
  const readOnly = world.mode === "simulation" && (world.unavailable || world.runStatus === "stopped" || world.runStatus === "completed");
  const href = (visitId: string) => `${IN_OUT_VISITS_PATH}?${new URLSearchParams({ shared: "1", visit: visitId })}`;
  if (id) return <div className="visits-workspace"><button type="button" className="is-text visits-back" onClick={() => { const next = new URLSearchParams(params); next.delete("visit"); next.set("shared", "1"); setParams(next); }}><ChevronLeft size={18} aria-hidden="true" />Back to visits</button>{detail.isPending ? <WorkspaceState state="loading" /> : detail.error || !detail.data ? <VisitReadError error={detail.error} onRetry={detail.refetch} /> : <SharedVisitView key={`${id}:${detail.data.share.root_id}`} schoolId={schoolId} detail={detail.data} timezone={detail.data.timezone} disabled={Boolean(readOnly)} refresh={async () => { await detail.refetch({ throwOnError: true }); }} />}</div>;
  if (list.isPending) return <WorkspaceState state="loading" />;
  if (list.error || !list.data) return <div className="visits-workspace"><VisitReadError error={list.error} onRetry={list.refetch} /></div>;
  return <div className="visits-workspace"><p className="visits-caption">Shared with you</p>{list.data.visits.length ? <ul className="visits-list" aria-label="Shared visits">{list.data.visits.map(visit => <li key={visit.id}><Link to={href(visit.id)} className="visits-entry"><ProductIcon name="gate" size={28} /><span><span className="visits-entry-top"><strong>{visit.title}</strong><span className={`visits-status is-${visit.state}`}>{visit.state === "cancelled" ? "Cancelled" : "Confirmed"}</span></span><small>{visitWindow(visit, list.data.timezone)} · {visit.place.label}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <section className="visits-empty"><ProductIcon name="gate" size={36} /><h2>No shared visits</h2><p className="visits-caption">Current visits shared with you will appear here.</p></section>}<VisitPages page={list.data.pagination.page} hasNext={page < list.data.pagination.total_pages} busy={list.isFetching} onChange={value => { const next = new URLSearchParams(params); next.set("page", String(value)); setParams(next); }} /></div>;
}
export function VisitsWorkspace({ schoolId, actorId, timezone }: { schoolId: string; actorId: string; timezone: string }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), [params, setParams] = useSearchParams();
  const view: VisitsView = ["past", "cancelled", "all"].includes(params.get("view") ?? "") ? params.get("view") as VisitsView : "upcoming";
  const page = pageNumber(params.get("page")), search = params.get("search") ?? "", id = params.get("visit");
  const [creating, setCreating] = useState(false), [searchOpen, setSearchOpen] = useState(Boolean(search)), [notice, setNotice] = useState("");
  const root = executionEnvironmentQueryKey(environment, ["gate-visits", schoolId, actorId]);
  const list = useQuery({ queryKey: [...root, "list", view, search, page], queryFn: ({ signal }) => getVisits(schoolId, { view, search, page }, signal), enabled: !id, retry: false });
  const detail = useQuery({ queryKey: [...root, "detail", id], queryFn: ({ signal }) => getVisit(schoolId, id!, signal), enabled: Boolean(id), retry: false });
  const change = (values: Record<string, string | undefined>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const href = (visitId: string) => { const next = new URLSearchParams(params); next.set("visit", visitId); return `${IN_OUT_VISITS_PATH}?${next}`; };
  const readOnly = Boolean(environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed"));
  const saved = async (result: VisitDetail) => {
    await client.invalidateQueries({ queryKey: root, refetchType: "none" });
    client.setQueryData([...root, "detail", result.visit.id], result);
    setNotice("Visit saved."); setCreating(false); change({ visit: result.visit.id });
  };
  if (id) return <div className="visits-workspace"><button type="button" className="is-text visits-back" onClick={() => change({ visit: undefined })}><ChevronLeft size={18} aria-hidden="true" />Back to visits</button>
    {detail.isPending ? <WorkspaceState state="loading" /> : !detail.data || visitAccessLost(detail.error) ? <VisitReadError error={detail.error} onRetry={detail.refetch} /> : <>
      {notice ? <p className="visits-saved" role="status">{notice}</p> : null}{detail.error ? <p className="visits-error" role="alert">The visit could not refresh. Actions are paused. <button type="button" className="is-text" onClick={() => void detail.refetch()}>Try again</button></p> : null}
      <VisitDetailView key={id} schoolId={schoolId} actorId={actorId} detail={detail.data} timezone={timezone} disabled={readOnly || Boolean(detail.error)} onSaved={saved} />
    </>}
  </div>;
  if (list.isPending) return <WorkspaceState state="loading" />;
  if (!list.data || visitAccessLost(list.error)) return <div className="visits-workspace"><VisitReadError error={list.error} onRetry={list.refetch} /></div>;
  const data = list.data, disabled = readOnly || Boolean(list.error);
  return <div className="visits-workspace">
    <header className="visits-heading"><p className="visits-caption">{data.totals.upcoming} upcoming</p>{data.can_manage ? <button type="button" disabled={disabled} onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />Arrange visit</button> : null}</header>
    <div className="visits-filter"><label><span className="visits-sr">Show visits</span><select value={view} onChange={event => change({ view: event.target.value, page: undefined })}><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="cancelled">Cancelled</option><option value="all">All visits</option></select></label><button type="button" className="is-secondary" aria-expanded={searchOpen} aria-label={searchOpen ? "Close visit search" : "Find visit"} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) change({ search: undefined, page: undefined }); }}>{searchOpen ? <X size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}</button></div>
    {searchOpen ? <VisitSearch key={search} initial={search} onSearch={value => change({ search: value || undefined, page: undefined })} /> : null}
    {list.error ? <p className="visits-error" role="alert">Visits could not refresh. Actions are paused. <button type="button" className="is-text" onClick={() => void list.refetch()}>Try again</button></p> : null}
    {data.visits.length ? <ul className="visits-list" aria-label="Arranged visits">{data.visits.map(visit => <li key={visit.id}><Link to={href(visit.id)} className="visits-entry"><ProductIcon name="gate" size={28} /><span><span className="visits-entry-top"><strong>{visit.guest_label}</strong><span className={`visits-status is-${visit.state}`}>{visit.state === "cancelled" ? "Cancelled" : "Confirmed"}</span></span><small>{visit.title}{visit.party_size > 1 ? ` · ${visit.party_size} people` : ""}</small><small>{visitWindow(visit, data.timezone)} · {visit.place.label}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <section className="visits-empty"><ProductIcon name="gate" size={36} /><h2>{search ? "No matching visits" : view === "upcoming" ? "No upcoming visits" : "No visits here"}</h2><p className="visits-caption">Plan a guest or group visit without creating accounts.</p></section>}
    <VisitPages page={data.pagination.page} hasNext={data.pagination.page < data.pagination.total_pages} busy={list.isFetching} onChange={value => change({ page: String(value) })} />
    {creating && !disabled ? <VisitEditor schoolId={schoolId} actorId={actorId} onClose={() => setCreating(false)} onSaved={saved} /> : null}
  </div>;
}
function VisitSearch({ initial, onSearch }: { initial: string; onSearch: (value: string) => void }) {
  const [value, setValue] = useState(initial), input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <form className="visits-search" role="search" onSubmit={(event: FormEvent) => { event.preventDefault(); onSearch(value.trim()); }}><label className="visits-sr" htmlFor="visits-search">Find visit</label><input ref={input} id="visits-search" type="search" maxLength={80} value={value} onChange={event => setValue(event.target.value)} placeholder="Name or visit" /><button type="submit" className="is-secondary">Find</button></form>;
}
