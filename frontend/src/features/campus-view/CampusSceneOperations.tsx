import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, Gauge, List, RefreshCw } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { useAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { projectSceneEvidence } from "../campus-scenes/sceneEvidence";
import type { CampusSceneDocument } from "../campus-scenes/types";
import type { CampusSceneOperationsBridge, SceneEvidenceLayer, SceneEvidenceRecord } from "../campus-scenes/sceneOperations.types";
import { getCampusView } from "./api";
import { campusMotionMatches } from "./campusMotion";
import { campusActivityTrail, campusDateFormatter, campusSceneRecords } from "./campusSceneRecords";
import { CampusEvidenceSheet } from "./CampusEvidenceSheet";
import { CampusMapPanel, type CampusMapPanelMode } from "./CampusMapPanel";
import { CampusKpiPanel } from "./CampusKpiPanel";
import { CampusSpaceSheet } from "./CampusSpaceSheet";
import type { CampusViewOverlay } from "./types";
import "./campus-view.css";

export type CampusSceneOperationsPanel = CampusMapPanelMode | "kpis";
interface Props {
  schoolId: string; campusId: string; scene: CampusSceneDocument | null;
  overlay?: CampusViewOverlay | null; initialPanel?: CampusSceneOperationsPanel;
  children: (bridge: CampusSceneOperationsBridge) => ReactNode;
}
const emptyBridge: CampusSceneOperationsBridge = { places: [], placesState: "unavailable", markersFor: () => [], unavailableFixtureIds: [], selectedSpaceId: null, selectedMarkerId: null, onSelectPlace: () => {}, onInspectPlace: () => {}, inspectionState: () => "unavailable", onSelectMarker: () => {}, mapControls: null, controls: null, dialogOpen: false, closeDialog: () => {} };

/** The physical campus remains usable even when operational access/data is absent. */
export function CampusSceneOperations(props: Props) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const authorized = Boolean(props.schoolId && auth.user?.active_school_id === props.schoolId && auth.memberships.some(member => member.school_id === props.schoolId && member.role === "admin"));
  if (!authorized) return props.children(emptyBridge);
  if (environment.mode === "simulation" && environment.unavailable) return props.children({ ...emptyBridge, controls: <p role="alert">Campus operations are unavailable until this Simulation is recovered.</p> });
  return <ActiveCampusSceneOperations key={`${executionEnvironmentIdentity(environment)}:${props.schoolId}:${props.campusId}`} {...props} />;
}

function ActiveCampusSceneOperations({ schoolId, campusId, scene, overlay, initialPanel, children }: Props) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [layer, setLayer] = useState<SceneEvidenceLayer>("none");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [panel, setPanel] = useState<CampusSceneOperationsPanel | null>(initialPanel ?? null);
  const [trigger, setTrigger] = useState<HTMLElement | SVGElement | null>(null);
  const [evidence, setEvidence] = useState<{ label: string; records: SceneEvidenceRecord[] } | null>(null);
  const query = useQuery({
    queryKey: executionEnvironmentQueryKey(environment, ["campus-view", schoolId, campusId]),
    queryFn: async ({ signal }) => {
      const result = await getCampusView(schoolId, campusId, signal);
      if (result.school.id !== schoolId || result.selected_campus_id !== campusId) throw new Error("The requested campus snapshot could not be confirmed.");
      return result;
    },
    enabled: Boolean(schoolId && campusId), staleTime: 15_000, refetchInterval: environment.mode === "live" ? 30_000 : false, retry: false,
  });
  const data = query.isError ? undefined : query.data;
  const spaces = useMemo(() => data?.spaces.filter(space => space.campus_id === campusId) ?? [], [data, campusId]);
  const places = useMemo(() => spaces.map(({ id, campus_id, parent_space_id, name, code, kind, capacity }) =>
    ({ id, campus_id, parent_space_id, name, code, kind, capacity })), [spaces]);
  const records = useMemo(() => data ? campusSceneRecords(data, campusId) : [], [data, campusId]);
  const trail = useMemo(() => data ? campusActivityTrail(data, overlay) : [], [data, overlay]);
  const zones = useMemo(() => overlay?.zones.filter(zone => spaces.some(space => space.id === zone.space_id)) ?? [], [overlay, spaces]);
  const timezone = data?.campuses.find(campus => campus.id === campusId)?.timezone || data?.school.timezone || "UTC";
  const clock = useMemo(() => campusDateFormatter(timezone), [timezone]);
  const occurred = useMemo(() => campusDateFormatter(timezone, true), [timezone]);
  const selectedSpace = spaces.find(space => space.id === inspectId);
  const projection = useMemo(() => scene ? projectSceneEvidence({ records, spaces, scene, campusId, layer }) : { markers: [], groups: [], unlocated: records.filter(record => record.dimension === layer) }, [records, spaces, scene, campusId, layer]);
  const closePanel = useCallback(() => setPanel(null), []);
  const closeEvidence = useCallback(() => { setEvidence(null); setSelectedMarkerId(null); }, []);
  const closePlace = useCallback(() => { setInspectId(null); window.setTimeout(() => trigger?.focus(), 0); }, [trigger]);
  const closeDialog = useCallback(() => {
    setPanel(null); setInspectId(null); setEvidence(null); setSelectedMarkerId(null);
    window.setTimeout(() => trigger?.focus(), 0);
  }, [trigger]);
  const rememberFocus = () => setTrigger(document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null);
  const onInspectPlace = (id: string) => { if (!spaces.some(space => space.id === id)) return; rememberFocus(); setSelectedSpaceId(id); setPanel(null); setEvidence(null); setSelectedMarkerId(null); setInspectId(id); };
  const onSelectMarker = (id: string) => {
    if (!scene) return;
    const element = scene.elements.find(item => `${layer}:${item.id}` === id);
    if (!element) return;
    const group = projectSceneEvidence({ records, spaces, scene, campusId, layer, floorId: element.kind === "room" ? element.floor_id : null }).groups.find(item => item.id === id);
    if (!group) return;
    rememberFocus(); setPanel(null); setInspectId(null); setSelectedMarkerId(id); setEvidence({ label: element.label, records: group.records });
  };
  const openPanel = (mode: CampusSceneOperationsPanel, element: HTMLElement) => { setTrigger(element); setEvidence(null); setInspectId(null); setSelectedMarkerId(null); setPanel(mode); };
  const layerControl = <select className="campus-scene-activity-layer" aria-label="Activity layer" value={layer} disabled={!data} onChange={event => { setLayer(event.target.value as SceneEvidenceLayer); closeEvidence(); }}>
    <option value="none">Layout only</option><option value="expected">Expected activity</option><option value="observed">Observations</option><option value="accepted">Accepted records</option><option value="unknown">Unknown state</option>
  </select>;
  const controls = <section className="campus-scene-operations" aria-label="Campus operations">
    <div className="campus-scene-operations__bar">
      {!scene ? <label>Activity layer{layerControl}</label> : null}
      <div className="campus-scene-operations__actions">
        <button type="button" disabled={!data} onClick={event => openPanel("spaces", event.currentTarget)}><List size={17} />Spaces</button>
        <button type="button" disabled={!data} onClick={event => openPanel("timetable", event.currentTarget)}><CalendarDays size={17} />Timetable</button>
        <button type="button" disabled={!data} onClick={event => openPanel("activity", event.currentTarget)}><Activity size={17} />Activity</button>
        <button type="button" onClick={event => openPanel("kpis", event.currentTarget)}><Gauge size={17} />KPIs</button>
      </div>
    </div>
    {query.isPending ? <p role="status">Loading campus operations…</p> : query.isError ? <p role="alert">Campus operations could not be loaded. The layout remains available. <button type="button" onClick={() => void query.refetch()}>Try again</button></p> : data ? <>
      <details><InfoSummary>Snapshot and evidence</InfoSummary><div className="campus-scene-operations__snapshot">
        <p>{overlay ? `${overlay.badge_label} · ` : ""}{environment.mode === "simulation" ? "Simulation snapshot" : "Current snapshot"} · <time dateTime={data.as_of}>{clock.format(new Date(data.as_of))}</time> · {timezone} <button type="button" onClick={() => void query.refetch()} aria-label="Refresh campus snapshot"><RefreshCw size={16} /></button></p>
        {data.operations ? <dl><div><dt>Activities expected now</dt><dd>{data.operations.current_expected_sessions}</dd></div><div><dt>Academic teachers expected</dt><dd>{data.operations.expected_teachers}</dd></div><div><dt>{data.operations.gate_movements.scope === "institution" ? "Institution gate entries" : "Campus gate entries"}</dt><dd>{data.operations.gate_movements.entries}</dd></div><div><dt>Historical space records</dt><dd>{records.filter(record => record.temporal === "historical" && record.spaceId).length}</dd></div></dl> : <p>Operational totals are unavailable.</p>}
        <p>Marker numbers count source records. Expected plans are not physical presence; point evidence is historical. Unknown does not mean empty.</p>
        {overlay ? <p>Rehearsal people remain separately labelled in place details and are excluded from operational KPIs.</p> : null}
      </div></details>
      {layer !== "none" ? <p className="campus-scene-operations__caption">{projection.markers.length} mapped {layer} groups{projection.unlocated.length ? <> · <button type="button" onClick={() => { rememberFocus(); setEvidence({ label: "Evidence without a mapped place", records: projection.unlocated }); }}>Inspect {projection.unlocated.length} unmapped records</button></> : null}</p> : null}
      {layer === "expected" ? <p className="campus-scene-operations__caption">Figures illustrate scheduled activity and mapped journeys; they are not tracked people or measured positions.</p> : null}
      {!scene ? <div className="campus-scene-operations__directory"><h2>Campus places</h2><p>Operational lists remain available while the physical layout is prepared.</p><ul>{spaces.slice(0, 8).map(space => <li key={space.id}><button type="button" onClick={() => onInspectPlace(space.id)}>{space.name}</button></li>)}</ul>{spaces.length > 8 ? <button type="button" onClick={event => openPanel("spaces", event.currentTarget)}>View all {spaces.length} places</button> : null}</div> : null}
    </> : null}
  </section>;
  const bridge: CampusSceneOperationsBridge = { controls, mapControls: scene ? layerControl : null, selectedSpaceId, selectedMarkerId, unavailableFixtureIds: [],
    places, placesState: query.isPending ? "loading" : data ? "available" : "unavailable",
    motion: data && campusMotionMatches(data.motion, schoolId, campusId, environment) ? data.motion : undefined,
    motionState: query.isPending ? "loading" : data && campusMotionMatches(data.motion, schoolId, campusId, environment) ? "available" : "unavailable",
    dialogOpen: Boolean(panel === "kpis" || panel && data || selectedSpace || evidence && data), closeDialog,
    inspectionState: id => query.isPending ? "loading" : spaces.some(space => space.id === id) ? "available" : "unavailable",
    markersFor: (visibleScene, floorId) => projectSceneEvidence({ records, spaces, scene: visibleScene, floorId, campusId, layer }).markers,
    onSelectPlace: id => setSelectedSpaceId(id && spaces.some(space => space.id === id) ? id : null), onInspectPlace, onSelectMarker,
  };
  return <>{children(bridge)}
    {panel === "kpis" ? <CampusKpiPanel schoolId={schoolId} campusId={campusId} timezone={timezone} rehearsalActive={Boolean(overlay)} returnFocus={trigger} onClose={closePanel} /> : panel && data ? <CampusMapPanel mode={panel} spaces={spaces} zones={zones} activity={trail} formatTime={date => occurred.format(date)} formatClock={date => clock.format(date)} returnFocus={trigger} onSelectSpace={space => onInspectPlace(space.id)} onClose={closePanel} /> : null}
    {selectedSpace ? <CampusSpaceSheet space={selectedSpace} overlay={zones.find(zone => zone.space_id === selectedSpace.id)} timezone={timezone} onClose={closePlace} /> : null}
    {evidence && data ? <CampusEvidenceSheet label={evidence.label} records={evidence.records} formatTime={date => occurred.format(date)} returnFocus={trigger} onClose={closeEvidence} onInspectPlace={onInspectPlace} /> : null}
  </>;
}
