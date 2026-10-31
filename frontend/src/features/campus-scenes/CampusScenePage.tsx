import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Pencil, RefreshCw } from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { useAuth } from "../auth/AuthContext";
import { CampusSceneOperations } from "../campus-view/CampusSceneOperations";
import { CampusPersonalJourney } from "../campus-view/CampusPersonalJourney";
import { CampusOperationalLayers } from "../campus-view/CampusOperationalLayers";
import type { CampusViewOverlay } from "../campus-view/types";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { SimulationSessionControls } from "../simulation/SimulationSessionControls";
import { CampusSceneEditorSession } from "./CampusSceneEditorSession";
import { CampusScenePublishedView } from "./CampusScenePublishedView";
import { getCampusSceneDirectory, getCampusScenePublished, getCampusSceneWorkspace, reopenCampusScene, type CampusSceneWorkspace, type SceneCampus } from "./api";
import type { CampusSceneDocument } from "./types";
import type { CampusSceneOperationsBridge } from "./sceneOperations.types";
import "./campus-scene-editor.css";
import "./campus-scene-page.css";

function SceneError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <section className="campus-scene-error" role="alert"><p>{error instanceof Error ? error.message : "This campus view could not be loaded. Try again."}</p><button type="button" className="campus-scene-button" onClick={onRetry}><RefreshCw size={17} />Try again</button></section>;
}
function SceneLoading() { return <div className="campus-scene-loading" role="status" aria-label="Loading campus view"><span /><span /><p>Loading your campus…</p></div>; }

function CampusSceneDraftSession({ workspace, opening, onReopen, ...props }: {
  workspace: CampusSceneWorkspace; opening: boolean; onReopen: () => void;
  schoolId: string; campusId: string; worldKey: string; onDirtyChange: (dirty: boolean) => void; onReload: () => void; onPublished: () => void; initialElementId?: string; initialPanel?: "source" | "review" | "places"; scopeBlocked?: boolean;
}) {
  // Background events can update the query cache, but only an explicit reload
  // replaces the editor's starting document and revision.
  const [snapshot] = useState(workspace);
  return snapshot.scene && !snapshot.scene.draft
    ? <section className="campus-scene-empty"><ProductIcon name="building" size={40} /><h2>Start the next version</h2><p>Your published campus stays available while you prepare and review a new draft.</p><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={opening} onClick={onReopen}>{opening ? "Opening draft…" : "Start a new draft"}</button></section>
    : <CampusSceneEditorSession workspace={snapshot} {...props} />;
}

type OperationalPanel = "spaces" | "timetable" | "activity" | "kpis";
interface CampusScenePageProps { backTo?: string; initialMode?: "view" | "edit"; overlay?: CampusViewOverlay | null; initialPanel?: OperationalPanel }

function CampusSceneCampus({ schoolId, campusId, worldKey, canEdit, initialEdit, dirty, onDirtyChange, campusContext, overlay, initialPanel, guidedStep, guidedElementId, onExpandedChange, contextNotice, expanded, scopeBlocked = false }: { campusContext: ReactNode; schoolId: string; campusId: string; worldKey: string; canEdit: boolean; initialEdit: boolean; dirty: boolean; onDirtyChange: (dirty: boolean) => void; overlay?: CampusViewOverlay | null; initialPanel?: OperationalPanel; guidedStep?: string; guidedElementId?: string; onExpandedChange: (expanded: boolean) => void; contextNotice?: ReactNode; expanded: boolean; scopeBlocked?: boolean }) {
  const [editing, setEditing] = useState(initialEdit && canEdit); const [reset, setReset] = useState(0);
  const [opening, setOpening] = useState(false); const [error, setError] = useState<unknown>(null);
  const reopenKey = useRef<{ revision: number; key: string } | null>(null);
  const queryClient = useQueryClient();
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const key = executionEnvironmentQueryKey(environment, ["campus-scenes", worldKey, schoolId, campusId]);
  const published = useQuery({ queryKey: [...key, "published"], queryFn: ({ signal }) => getCampusScenePublished(schoolId, campusId, signal), staleTime: 30_000, retry: false });
  const workspace = useQuery({ queryKey: [...key, "workspace"], queryFn: ({ signal }) => getCampusSceneWorkspace(schoolId, campusId, signal), enabled: editing && canEdit, refetchOnWindowFocus: false, staleTime: 0, retry: false });
  const reload = async () => { const result = await workspace.refetch(); if (!result.isError) { onDirtyChange(false); setReset(value => value + 1); } };
  const reopen = async () => {
    if (opening || !workspace.data?.scene) return; setOpening(true); setError(null);
    const revision = workspace.data.scene.revision;
    if (reopenKey.current?.revision !== revision) reopenKey.current = { revision, key: crypto.randomUUID() };
    try { await reopenCampusScene(schoolId, campusId, revision, reopenKey.current.key); await reload(); }
    catch (caught) { setError(caught); } finally { setOpening(false); }
  };
  const header = (action?: ReactNode) => <div className="campus-scene-page-actions" role="group" aria-label="Campus context"><div className="campus-scene-page-scope">{campusContext}</div>{action}</div>;
  const withOperations = (scene: CampusSceneDocument | null, render: (operations?: CampusSceneOperationsBridge) => ReactNode, allowed = canEdit && !scopeBlocked) => allowed
    ? <CampusSceneOperations schoolId={schoolId} campusId={campusId} scene={scene} overlay={overlay} initialPanel={initialPanel}>{render}</CampusSceneOperations>
    : render();
  if (editing) {
    if (workspace.isPending) return <>{header()}<SceneLoading /></>;
    if (workspace.isError && !workspace.data) return <>{header()}<SceneError error={workspace.error} onRetry={() => void workspace.refetch()} /></>;
    const data = workspace.data;
    if (!data) return <>{header()}<SceneLoading /></>;
    return <div className="campus-scene-page-content">
      {header(<button type="button" className="campus-scene-button" onClick={() => { if (!dirty || window.confirm("Return to the published campus view? Unsaved changes in this draft will be lost.")) { onDirtyChange(false); setEditing(false); } }}>View published campus</button>)}
      {error ? <SceneError error={error} onRetry={() => void reload()} /> : null}
      {workspace.isError ? <p role="alert" className="campus-scene-error">The latest draft could not be reloaded. Your current edits are still available below.</p> : null}
      <CampusSceneDraftSession initialElementId={guidedElementId} initialPanel={guidedElementId ? undefined : guidedStep === "layout" || guidedStep === "find" ? "source" : guidedStep === "share" ? "review" : guidedStep === "connect" ? "places" : undefined} key={reset} opening={opening || scopeBlocked || !canEdit} scopeBlocked={scopeBlocked || !canEdit || workspace.error instanceof ApiError && [401, 403, 404].includes(workspace.error.status)} onReopen={() => void reopen()} schoolId={schoolId} campusId={campusId} worldKey={worldKey} workspace={data} onDirtyChange={onDirtyChange} onReload={() => void reload()} onPublished={() => {
          // The accepted publication clears its draft. Drop old cached data before
          // allowing the next edit, so a quick reopen cannot mount that old draft.
          void queryClient.resetQueries({ queryKey: [...key, "workspace"], exact: true });
          void queryClient.resetQueries({ queryKey: [...key, "published"], exact: true }); setEditing(false);
        }} />
    </div>;
  }
  if (published.isPending) return <>{header()}<SceneLoading /></>;
  if (published.isError && !published.data) return <div className="campus-scene-page-content">{header()}{withOperations(null, operations => <>{operations?.controls}<SceneError error={published.error} onRetry={() => void published.refetch()} /></>)}</div>;
  const data = published.data;
  if (!data) return <>{header()}<SceneLoading /></>;
  const canManage = canEdit && data.can_edit && !scopeBlocked;
  const layoutNotice = published.isError ? <p className="campus-scene-error" role="alert">The latest campus layout could not be refreshed. The last loaded publication is shown below.</p> : null;
  const expandedContext = environment.mode === "simulation" || contextNotice || layoutNotice ? <><SimulationSessionControls schoolId={schoolId} />{contextNotice}{layoutNotice}</> : undefined;
  return <div className={`campus-scene-page-content${data.scene ? " campus-scene-page-content--published" : ""}`}>{header(data.scene && canManage ? <button type="button" className="campus-scene-button" aria-label="Edit campus view" onClick={() => setEditing(true)}><Pencil size={17} />Edit</button> : null)}
    {!expanded ? layoutNotice : null}
    <CampusOperationalLayers schoolId={schoolId} campusId={campusId} publication={data} onLayoutRefresh={() => void published.refetch()}>{campusLayers => <CampusPersonalJourney schoolId={schoolId} campusId={campusId} publication={data} blockedConnectorIds={campusLayers.blockedConnectorIds} routingAvailable={!campusLayers.layoutChanged}>{personal => withOperations(data.scene?.document ?? null, operations => data.scene
      ? <CampusScenePublishedView schoolId={schoolId} key={`${data.scene.id}:${data.scene.version}`} data={data} operations={operations} personal={personal} campusLayers={campusLayers} expandedContext={expandedContext} onExpandedChange={onExpandedChange} />
      : <>{personal.controls}{campusLayers.mapControls}{campusLayers.controls}{operations?.controls}<section className="campus-scene-empty"><ProductIcon name="building" size={40} /><h2>{canManage ? "Bring your campus to life" : "Your virtual campus is taking shape"}</h2><p>{canManage ? "Start with your campus name, an aerial image or a site plan. Shape the buildings, paths and green spaces, then invite everyone to explore." : "Your campus team has not published a virtual view yet. It will appear here when it is ready."}</p>{canManage ? <button type="button" className="campus-scene-button campus-scene-button--primary" onClick={() => setEditing(true)}>Create campus view</button> : null}</section></>, canManage)}</CampusPersonalJourney>}</CampusOperationalLayers>
  </div>;
}

export default function CampusScenePage({ backTo = "/more", initialMode = "view", overlay, initialPanel }: CampusScenePageProps) {
  const auth = useAuth(); const environment = useOptionalExecutionEnvironment(); const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const schoolId = auth.user?.active_school_id ?? "";
  const membership = auth.memberships.find(member => member.school_id === schoolId);
  const requestedPanel = params.get("panel");
  const panel = initialPanel ?? (requestedPanel === "spaces" || requestedPanel === "timetable" || requestedPanel === "activity" || requestedPanel === "kpis" ? requestedPanel : undefined);
  const worldKey = executionEnvironmentIdentity(environment ?? LIVE_EXECUTION_ENVIRONMENT);
  const unavailable = environment?.mode === "simulation" && environment.unavailable;
  const directoryKey = unavailable ? ["campus-scenes-unavailable", worldKey] : executionEnvironmentQueryKey(environment ?? LIVE_EXECUTION_ENVIRONMENT, ["campus-scenes", worldKey, schoolId, "directory"]);
  const directory = useQuery({ queryKey: directoryKey, queryFn: ({ signal }) => getCampusSceneDirectory(schoolId, signal), enabled: Boolean(schoolId) && !unavailable, staleTime: 60_000, retry: false });
  const requested = params.get("campus_id");
  const [selectionMemory, setSelectionMemory] = useState<{ scope: string; requested: string | null; campus: SceneCampus } | null>(null);
  const selectionScope = `${worldKey}:${schoolId}:${auth.user?.id ?? "account"}`;
  const currentMemory = selectionMemory?.scope === selectionScope && selectionMemory.requested === requested ? selectionMemory : null;
  const selectedFresh = requested ? directory.data?.campuses.find(campus => campus.id === requested) : currentMemory ? directory.data?.campuses.find(campus => campus.id === currentMemory.campus.id) : directory.data?.campuses.find(campus => campus.is_primary) ?? directory.data?.campuses[0];
  if (selectedFresh && (!currentMemory || JSON.stringify(currentMemory.campus) !== JSON.stringify(selectedFresh))) setSelectionMemory({ scope: selectionScope, requested, campus: selectedFresh });
  const selected = selectedFresh ?? currentMemory?.campus;
  const mapPresentationScope = `${selectionScope}:${selected?.id ?? "unselected"}`;
  const [expandedScope, setExpandedScope] = useState<string | null>(null);
  const expanded = expandedScope === mapPresentationScope;
  const onExpandedChange = useCallback((value: boolean) => {
    setExpandedScope(current => value ? mapPresentationScope : current === mapPresentationScope ? null : current);
  }, [mapPresentationScope]);
  const directoryAuthorityBlocked = Boolean(directory.data && (!selectedFresh || !directory.data.can_edit)) || directory.error instanceof ApiError && [401, 403, 404].includes(directory.error.status);
  const campusContext = directory.data ? directory.data.campuses.length > 1 || !selected || !selectedFresh ? <label className="campus-scene-campus-choice"><span className="campus-scene-visually-hidden">Campus</span><select value={selected?.id ?? ""} onChange={event => { if (dirty && !window.confirm("Switch campuses? Unsaved changes in this draft will be lost.")) return; setDirty(false); const next = new URLSearchParams(params); next.set("campus_id", event.target.value); setParams(next); }}><option value="" disabled>Select a campus</option>{selected && !selectedFresh ? <option value={selected.id} disabled>{selected.name} · unavailable</option> : null}{directory.data.campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label> : <p className="campus-scene-campus-name">{selected.name}</p> : null;
  const guidedStep = params.get("setup") === "whole-campus" && ["find", "layout", "connect", "share"].includes(params.get("setup_step") ?? "") ? params.get("setup_step")! : undefined;
  const guidedElementId = guidedStep && (params.get("setup_element")?.length ?? 0) <= 120 ? params.get("setup_element") ?? undefined : undefined;
  const guideHref = `/more/setup/whole-campus?${new URLSearchParams({ ...(selected ? { campus_id: selected.id } : {}), step: guidedStep ?? "layout" })}`;
  const canLeave = () => !dirty || window.confirm("Leave this campus draft? Unsaved changes will be lost.");
  const contextNotice = directory.isError && directory.data || selected && !selectedFresh ? <p role="alert" className="campus-scene-error">{directoryAuthorityBlocked ? "Current campus access is unavailable. Your draft and any unconfirmed save are retained. Restore access before saving." : "The campus list could not refresh. Your current draft and review choices are retained."}<button type="button" className="campus-scene-button" onClick={() => void directory.refetch()}>Refresh campus access</button></p> : null;
  return <OperationsShell active="more" title="Virtual campus" layout={expanded ? "canvas" : "immersive"} schoolName={membership?.school_name} backTo={guidedStep ? guideHref : backTo} beforeBack={canLeave}>
    <div className={`campus-scene-page campus-scene-page--viewport${expanded ? " campus-scene-page--expanded" : ""}`}>
      {guidedStep ? <section className="campus-scene-setup-note" aria-label="Campus setup context"><div><strong>Build your campus, one part at a time</strong><p>Save this draft to continue later. Place links and operational details can grow with your campus.</p></div><Link className="campus-scene-button" to={guideHref} onClick={event => { if (!canLeave()) event.preventDefault(); }}>Return to setup guide</Link></section> : null}
      {!schoolId ? <section className="campus-scene-empty"><h2>Choose an institution</h2><p>Select your current institution to explore its campus.</p><Link className="campus-scene-button" to="/more">Open your workspace</Link></section>
        : unavailable ? <section className="campus-scene-error" role="alert"><p>This Simulation is unavailable. Return to its workspace to recover it before opening the campus view.</p><Link className="campus-scene-button" to="/more/simulation">Open Simulation</Link></section>
        : directory.isPending ? <SceneLoading />
        : directory.isError && !directory.data ? <SceneError error={directory.error} onRetry={() => void directory.refetch()} />
        : <>
          {!expanded ? contextNotice : null}
          {selected ? <CampusSceneCampus expanded={expanded} contextNotice={contextNotice} onExpandedChange={onExpandedChange} scopeBlocked={directoryAuthorityBlocked} guidedStep={guidedStep} guidedElementId={guidedElementId} campusContext={campusContext} key={`${worldKey}:${schoolId}:${auth.user?.id ?? "account"}:${selected.id}`} schoolId={schoolId} campusId={selected.id} worldKey={worldKey} canEdit={directory.data.can_edit && membership?.role === "admin"} initialEdit={initialMode === "edit" || params.get("edit") === "1"} dirty={dirty} onDirtyChange={setDirty} overlay={overlay} initialPanel={panel} /> : <>{campusContext}<section className="campus-scene-empty"><h2>{requested ? "Campus unavailable" : "No active campus yet"}</h2><p>{requested ? "Choose an available campus to continue." : "Add an active campus in institution setup before creating its virtual view."}</p>{directory.data.can_edit && membership?.role === "admin" ? <Link className="campus-scene-button" to="/more/setup/institution/campus">Open campus setup</Link> : null}</section></>}
        </>}
    </div>
  </OperationsShell>;
}
