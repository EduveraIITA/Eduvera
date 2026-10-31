import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search, Settings2 } from "lucide-react";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { getFacilities, getFacilitiesOptions, getRepair, type RepairsFilter } from "./facilitiesApi";
import { FacilitiesEmpty, FacilitiesPages, FacilitiesReadError, repairDate, repairStateLabels, repairWaitLabels } from "./FacilitiesPrimitives";
import { FacilitiesSetupDialog } from "./FacilitiesSetupDialog";
import { RepairDetailView } from "./RepairDetailView";
import { RepairReportDialog } from "./RepairReportDialog";
import { RepairPhotoDialog } from "./RepairPhotoDialog";
import "./facilities.css";

export function FacilitiesWorkspaceRoute() {
  const environment = useExecutionEnvironment(), auth = useOptionalAuth(), manifest = useWorkspaceManifest();
  const shell = (body: ReactNode) => <OperationsShell active="areas" title="Repairs" backTo="/areas">{body}</OperationsShell>;
  if (environment.mode === "simulation" && environment.unavailable) return shell(<WorkspaceState state="unavailable" />);
  if (manifest.isPending) return shell(<WorkspaceState state="loading" />);
  if (manifest.error) return shell(<WorkspaceState state={manifest.error instanceof ApiError && manifest.error.status === 403 ? "revoked" : "error"} error={manifest.error} onRetry={manifest.refetch} />);
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment) || !manifest.data.areas.some(area => area.key === "facilities")) return shell(<WorkspaceState state="revoked" />);
  const actorId = auth?.user?.id ?? manifest.data.context.actor_user_id, schoolId = manifest.data.context.institution_id;
  if (!actorId || !schoolId) return shell(<WorkspaceState state="revoked" />);
  const key = JSON.stringify([schoolId, actorId, environment.mode, environment.mode === "simulation" ? environment.namespaceId : "live"]);
  return shell(<FacilitiesWorkspace key={key} schoolId={schoolId} actorId={actorId} timezone={manifest.data.context.time_zone ?? "UTC"} />);
}
const accessLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
export function FacilitiesWorkspace({ schoolId, actorId, timezone }: { schoolId: string; actorId: string; timezone: string }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), [params, setParams] = useSearchParams(), location = useLocation();
  const view = params.get("view") === "all" ? "all" : "mine", filter = params.get("state"), state: RepairsFilter = filter === "closed" || filter === "all" ? filter : "open";
  const search = params.get("search") ?? "", rawPage = Number(params.get("page")), page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage) || 1) : 1;
  const rawHistory = Number(params.get("history_page")), historyPage = Number.isFinite(rawHistory) ? Math.max(1, Math.floor(rawHistory) || 1) : 1, id = params.get("repair_id");
  const [reporting, setReporting] = useState(false), [setup, setSetup] = useState(false), [reportPhoto, setReportPhoto] = useState<{ id: string; file: File } | null>(null);
  const [notice, setNotice] = useState("");
  const reportRequested = params.get("report") === "1", holdingId = params.get("holding_id") || undefined, spaceId = params.get("space_id") || undefined;
  const needsContext = Boolean(reportRequested && (holdingId || spaceId));
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const root = executionEnvironmentQueryKey(environment, ["facilities", schoolId, actorId]);
  const list = useQuery({ queryKey: [...root, "list", view, state, search, page], queryFn: () => getFacilities(schoolId, { view, state, search, page }), enabled: !id });
  const detail = useQuery({ queryKey: [...root, "repair", id, historyPage], queryFn: () => getRepair(schoolId, id!, historyPage), enabled: Boolean(id) });
  const reportContext = useQuery({ queryKey: [...root, "report-context", holdingId ?? "none", spaceId ?? "none"],
    queryFn: ({ signal }) => getFacilitiesOptions(schoolId, "", 1, undefined, { ...(holdingId ? { holding_id: holdingId } : {}), ...(spaceId ? { space_id: spaceId } : {}) }, signal),
    enabled: !id && needsContext && Boolean(list.data?.can_report && list.data.settings.configured) && !readOnly, retry: false, staleTime: 15_000 });
  const change = (values: Record<string, string | undefined>, replace = false) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); setParams(next, { replace, state: location.state as unknown }); };
  const href = (repairId: string) => { const next = new URLSearchParams(params); next.set("repair_id", repairId); next.delete("history_page"); return `/areas/facilities?${next}`; };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: root, refetchType: "none" });
    await (id ? detail.refetch({ throwOnError: true }) : list.refetch({ throwOnError: true }));
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
  };
  const transferred = async () => {
    // A confirmed handoff has removed this actor's private access. Do not let
    // Back or another cached list briefly render the former repair snapshot.
    client.removeQueries({ queryKey: root });
    setNotice("Responsibility transferred. This repair is no longer in your current view.");
    change({ repair_id: undefined, history_page: undefined });
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
  };
  if (id) return <div className="facilities-workspace"><button type="button" className="is-text facilities-back" onClick={() => change({ repair_id: undefined, history_page: undefined })}><ChevronLeft size={18} aria-hidden="true" />Back to repairs</button>
    {detail.isPending ? <WorkspaceState state="loading" /> : !detail.data || accessLost(detail.error) ? <FacilitiesReadError error={detail.error} onRetry={() => void detail.refetch()} /> : <>
      {detail.error ? <p className="facilities-error" role="alert">This repair could not refresh. Actions are paused. <button className="is-text" type="button" onClick={() => void detail.refetch()}>Try again</button></p> : null}
      <RepairDetailView key={id} schoolId={schoolId} actorId={actorId} repair={detail.data} timezone={timezone} readOnly={Boolean(readOnly || detail.error)} refresh={refresh} historyPage={historyPage} onHistoryPage={value => change({ history_page: String(value) })} onTransferred={transferred} />
      {reportPhoto?.id === id && !readOnly && !detail.error ? <RepairPhotoDialog schoolId={schoolId} repair={detail.data} initialFile={reportPhoto.file} reportSaved refresh={refresh} onClose={() => setReportPhoto(null)} /> : null}
    </>}</div>;
  if (list.isPending) return <WorkspaceState state="loading" />;
  if (!list.data || accessLost(list.error)) return <div className="facilities-workspace"><FacilitiesReadError error={list.error} onRetry={() => void list.refetch()} /></div>;
  const data = list.data, disabled = Boolean(readOnly || list.error);
  const selected = reportContext.data?.selected;
  const contextConfirmed = !needsContext || Boolean(selected && (!holdingId || selected.holding?.id === holdingId) && (!spaceId || selected.place?.id === spaceId));
  const closeReport = () => { setReporting(false); change({ report: undefined, holding_id: undefined, space_id: undefined }, true); };
  return <div className="facilities-workspace">
    {notice ? <p className="facilities-saved" role="status">{notice}</p> : null}
    {needsContext && data.can_report && data.settings.configured && !disabled ? reportContext.isPending ? <p role="status">Loading the selected campus asset…</p> : reportContext.error || !contextConfirmed ? <p role="alert" className="facilities-error">The selected asset or place could not be confirmed. <button type="button" className="is-text" onClick={() => { change({ holding_id: undefined, space_id: undefined }, true); setReporting(true); }}>Start a report without this selection</button></p> : null : null}
    <header className="facilities-heading"><p className="facilities-caption">{data.totals.open} open{data.totals.awaiting_verification ? ` · ${data.totals.awaiting_verification} ready to check` : ""}</p>
      <div className="facilities-inline-actions">{data.settings.can_manage ? <button type="button" className="is-secondary facilities-icon-button" aria-label="Repair settings" disabled={disabled} onClick={() => setSetup(true)}><Settings2 size={19} aria-hidden="true" /></button> : null}
        {data.can_report && data.settings.configured ? <button type="button" disabled={disabled} onClick={() => setReporting(true)}><Plus size={18} aria-hidden="true" />Report problem</button> : null}</div>
    </header>
    {!data.settings.configured && data.can_report ? <FacilitiesEmpty title="Start with one responsible person" action={data.settings.can_manage && !readOnly ? <button type="button" disabled={Boolean(list.error)} onClick={() => setSetup(true)}>Set up repairs</button> : undefined}>{data.settings.can_manage ? "Choose who receives reports and who checks the repair. No inventory setup needed." : "Your campus needs to appoint a repair handler before reports can be received."}</FacilitiesEmpty> : <>
      {data.can_manage ? <nav className="facilities-tabs" aria-label="Repair views">{([{ id: "mine", label: "My repairs" }, { id: "all", label: "All repairs" }] as const).map(item => <button type="button" key={item.id} className="is-secondary" aria-pressed={data.view === item.id} onClick={() => change({ view: item.id, page: undefined })}>{item.label}</button>)}</nav> : null}
      <div className="facilities-filter"><RepairSearch key={search} initial={search} onSearch={value => change({ search: value || undefined, page: undefined })} /><label><span className="facilities-sr">Repair status</span><select value={state} onChange={event => change({ state: event.target.value, page: undefined })}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select></label></div>
      {list.error ? <p role="alert" className="facilities-error">The list could not refresh. Actions are paused. <button className="is-text" type="button" onClick={() => void list.refetch()}>Try again</button></p> : null}
      {data.repairs.length ? <ul className="facilities-list" aria-label="Repairs">{data.repairs.map(repair => <li key={repair.id}><Link className="facilities-entry" to={href(repair.id)}><ProductIcon name="facilities" size={28} /><span><strong>{repair.title}</strong><small>{repair.place?.label || repair.item?.label || repair.location_note}</small><small>{repair.handler.label}</small><span className="facilities-entry-meta"><span className={`facilities-status is-${repair.state}`}>{repairStateLabels[repair.state]}</span>{repair.wait_reason ? <small>Waiting for {repairWaitLabels[repair.wait_reason].toLowerCase()}</small> : null}{repair.expected_finish_at && !["closed", "awaiting_verification"].includes(repair.state) ? <small>Expected {repairDate(repair.expected_finish_at, timezone, false)}</small> : null}</span></span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul>
        : <FacilitiesEmpty title={search ? "No matching repairs" : !data.can_report && !data.can_manage ? "No assigned repairs" : state === "closed" ? "No closed repairs" : state === "all" ? "No repairs yet" : "No open repairs"}>{search ? "Try a different description of the problem." : !data.can_report && !data.can_manage ? "Work shared with you will appear here." : "A report keeps the problem, responsible person and progress together."}</FacilitiesEmpty>}
      <FacilitiesPages page={data.pagination.page} hasMore={data.pagination.page * data.pagination.page_size < data.pagination.total} onChange={next => change({ page: String(next) })} />
    </>}
    {setup ? <FacilitiesSetupDialog schoolId={schoolId} actorId={actorId} settings={data.settings} refresh={refresh} onClose={() => setSetup(false)} /> : null}
    {(reporting || reportRequested) && data.can_report && data.settings.configured && !disabled && contextConfirmed && !reportContext.error ? <RepairReportDialog key={`${holdingId ?? "none"}:${spaceId ?? "none"}`} schoolId={schoolId} actorId={actorId} settings={data.settings} canManage={data.can_manage} initialContext={needsContext ? selected : undefined} refresh={refresh} onClose={closeReport} onSaved={(repairId, file) => { setReporting(false); if (file) setReportPhoto({ id: repairId, file }); change({ repair_id: repairId, history_page: undefined, report: undefined, holding_id: undefined, space_id: undefined }, true); }} /> : null}
  </div>;
}
function RepairSearch({ initial, onSearch }: { initial: string; onSearch: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <form className="facilities-search" role="search" onSubmit={(event: FormEvent) => { event.preventDefault(); onSearch(value.trim()); }}><label className="facilities-sr" htmlFor="facilities-search">Find a problem</label><input id="facilities-search" type="search" maxLength={80} value={value} onChange={event => setValue(event.target.value)} placeholder="Find a problem" /><button type="submit" className="is-secondary facilities-icon-button" aria-label="Search repairs"><Search size={18} aria-hidden="true" /></button></form>;
}
export default FacilitiesWorkspaceRoute;
