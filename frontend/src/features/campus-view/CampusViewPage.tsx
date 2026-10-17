import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Building2, CalendarDays, Clock3, Gauge, Layers3, List, MapPinned, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getCampusView } from "./api";
import { CampusFloorPlan } from "./CampusFloorPlan";
import { CampusKpiPanel } from "./CampusKpiPanel";
import { CampusMapPanel } from "./CampusMapPanel";
import type { CampusMapPanelMode } from "./CampusMapPanel";
import { CampusSpaceSheet } from "./CampusSpaceSheet";
import { floorOptions } from "./geometry";
import type { CampusScenarioTarget } from "./scenarioApi";
import type { CampusViewOverlay, CampusViewResponse, CampusViewSpace } from "./types";
import "./campus-view.css";

const EMPTY_SPACES: CampusViewSpace[] = [];
type CampusViewPanel = CampusMapPanelMode | "kpis";

function sourceLabel(kind: "mapped" | "generated_schematic") {
  return kind === "mapped" ? "Mapped" : "Schematic";
}

function CanvasBackControl() {
  return <Link className="campus-map-back" to="/principal/more" aria-label="Back to More"><ArrowLeft size={20} /></Link>;
}

export default function CampusViewPage({ overlay }: { overlay?: CampusViewOverlay | null }) {
  const auth = useAuth();
  const membership = auth.memberships.find((item) => item.role === "admin" && (!auth.user?.active_school_id || item.school_id === auth.user.active_school_id))
    ?? auth.memberships.find((item) => item.role === "admin");
  const schoolId = membership?.school_id ?? "";
  const [campusId, setCampusId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [selectedSpace, setSelectedSpace] = useState<CampusViewSpace | null>(null);
  const [panel, setPanel] = useState<CampusViewPanel | null>(null);
  const [panelTrigger, setPanelTrigger] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => new Date());
  const query = useQuery({
    queryKey: ["campus-view", schoolId, campusId],
    queryFn: ({ signal }) => getCampusView(schoolId, campusId || undefined, signal),
    enabled: Boolean(schoolId), staleTime: 15_000, refetchInterval: 30_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const data = query.data;
  const effectiveCampusId = campusId || data?.selected_campus_id || "";
  const floors = useMemo(() => floorOptions((data?.spaces ?? []).filter((space) => !effectiveCampusId || space.campus_id === effectiveCampusId)), [data?.spaces, effectiveCampusId]);
  const activeFloor = floors.find((floor) => floor.id === floorId) ?? floors[0];
  const spaces = activeFloor?.spaces ?? EMPTY_SPACES;
  const overlayZones = useMemo(() => overlay?.zones.filter((zone) => spaces.some((space) => space.id === zone.space_id)) ?? [], [overlay?.zones, spaces]);
  const selectedOverlay = selectedSpace ? overlayZones.find((zone) => zone.space_id === selectedSpace.id) : undefined;
  const roomObservationPoints = spaces
    .filter((space) => space.kind !== "gate")
    .reduce((count, space) => count + space.assertions.observed.length + space.assertions.accepted.length, 0);
  // Rehearsal zones also contain configured operational staff. Only the
  // effective schedule can define the number of classes currently expected.
  const currentExpectedSessions = data?.operations?.current_expected_sessions ?? 0;
  const expectedTeachers = data?.operations?.expected_teachers ?? 0;
  const gateEntries = data?.operations?.gate_movements.entries ?? 0;
  const gateScopeLabel = data?.operations?.gate_movements.scope === "institution" ? "institution gate-ins" : "accepted gate-ins";
  const currentCampus = data?.campuses.find((campus) => campus.id === effectiveCampusId);
  const scenarioTargets = useMemo(() => {
    const campusSpaces = (data?.spaces ?? []).filter((space) => !effectiveCampusId || space.campus_id === effectiveCampusId);
    const teachers = new Map<string, CampusScenarioTarget>();
    for (const space of campusSpaces) {
      for (const use of space.expected_now) {
        if (use.teacher) teachers.set(use.teacher.id, { id: use.teacher.id, label: use.teacher.label, detail: `${use.class_label} · ${use.subject_label || use.title}` });
      }
    }
    return {
      teachers: [...teachers.values()].sort((left, right) => left.label.localeCompare(right.label)),
      spaces: campusSpaces.map((space) => ({ id: space.id, label: space.name, detail: [space.floor_label, space.kind.replaceAll("_", " ")].filter(Boolean).join(" · ") })).sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true })),
    };
  }, [data?.spaces, effectiveCampusId]);
  const timeZone = currentCampus?.timezone || data?.school.timezone || "Asia/Kolkata";
  const clock = useMemo(() => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }), [timeZone]);
  const occurred = useMemo(() => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }), [timeZone]);
  const trail = useMemo(() => {
    const combined = [...(overlay?.activity ?? []), ...(data?.activity ?? [])];
    const activity = [...new Map(combined.map((item) => [item.id, item])).values()];
    const items: CampusViewResponse["activity"] = [
      ...(data?.signals ?? []).map((signal) => ({
      id: `signal:${signal.id}`, occurred_at: signal.occurred_at || data?.generated_at || now.toISOString(),
      title: signal.title || "Campus signal needs review", detail: signal.detail || "Cross-domain evidence needs an operator review.",
      state_dimension: "unknown" as const, source_label: "Institution-wide cross-check", target_path: signal.target_path,
      })),
      ...activity,
    ];
    const rank = (item: typeof items[number]) => item.id.startsWith("signal:") ? 0
      : item.state === "in_progress" ? 1
        : item.state_dimension === "accepted" || item.state_dimension === "observed" ? 2
          : item.state === "upcoming" ? 3 : item.state === "ended" ? 4 : 2;
    return items.sort((left, right) => {
      const difference = rank(left) - rank(right);
      if (difference) return difference;
      return left.state === "upcoming"
        ? Date.parse(left.occurred_at) - Date.parse(right.occurred_at)
        : Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
    });
  }, [data, now, overlay]);
  const timetableCount = useMemo(() => trail.filter((item) => item.spatial_claim === "expected_context_only"
    && (item.state === "in_progress" || item.state === "upcoming" || item.state === "ended")).length, [trail]);
  const closePanel = useCallback(() => setPanel(null), []);
  const selectFromPanel = useCallback((space: CampusViewSpace) => { setPanel(null); setSelectedSpace(space); }, []);

  if (!membership) return <OperationsShell portal="principal" active="more" title="Campus view" backTo="/principal/more"><section className="campus-view-access"><MapPinned size={28} /><h1>Admin access required</h1><p>Campus observability is available to institution administrators because it combines operational data across the school.</p></section></OperationsShell>;
  if (query.isPending) return <OperationsShell portal="principal" active="more" title="Campus view" backTo="/principal/more" layout="canvas"><div className="campus-map-page"><div className="campus-map-navigation"><CanvasBackControl /></div><ScreenLoading /></div></OperationsShell>;
  if (query.isError) return <OperationsShell portal="principal" active="more" title="Campus view" backTo="/principal/more" layout="canvas"><div className="campus-map-page"><div className="campus-map-navigation"><CanvasBackControl /></div><LiveRouteError error={query.error} onRetry={query.refetch} /></div></OperationsShell>;
  if (!data) return null;

  const openPanel = (mode: CampusViewPanel, trigger: HTMLElement) => { setPanelTrigger(trigger); setPanel(mode); };
  const resetKey = `${effectiveCampusId}:${activeFloor?.id ?? "none"}:${data.plan?.version ?? "no-plan"}`;

  return <OperationsShell portal="principal" active="more" title="Campus view" backTo="/principal/more" schoolName={membership.school_name} layout="canvas">
    <div className="campus-map-page">
      <h1 className="campus-map-sr-only">Campus view</h1>
      {spaces.length ? <CampusFloorPlan spaces={spaces} mappedElements={data.plan?.placement_kind === "configured_schematic" || data.plan?.source_kind === "mapped" ? data.plan.elements : undefined}
        overlayZones={overlayZones} selectedId={selectedSpace?.id} resetKey={resetKey} onSelect={setSelectedSpace} />
        : <div className="campus-map-empty"><MapPinned size={28} /><h1>No spaces on this level</h1><p>Add real rooms, labs and shared areas in Institute setup. Campus View stays unknown until evidence arrives.</p><Link to="/principal/administration?section=campus">Open campus setup</Link></div>}

      <div className="campus-map-navigation" aria-label="Campus map context">
        <CanvasBackControl />
        {data.campuses.length > 1 ? <label className="campus-map-campus-switch"><Building2 size={15} aria-hidden="true" /><select value={campusId || data.selected_campus_id || data.campuses[0]?.id || ""} onChange={(event) => { setCampusId(event.target.value); setFloorId(""); setSelectedSpace(null); }} aria-label="Campus">{data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.code || campus.name}</option>)}</select><small>{sourceLabel(data.plan?.source_kind ?? "generated_schematic")}</small></label>
          : <span className="campus-map-campus-code" aria-label={`${currentCampus?.name ?? data.school.name}, ${sourceLabel(data.plan?.source_kind ?? "generated_schematic")} plan`}><Building2 size={15} aria-hidden="true" /><strong>{currentCampus?.code || "MAIN"}</strong><small>{sourceLabel(data.plan?.source_kind ?? "generated_schematic")}</small></span>}
      </div>

      <div className="campus-map-status" aria-live="polite">
        {overlay ? <span className={`campus-map-status__badge is-${overlay.status}`}><Sparkles size={13} />{overlay.badge_label}</span> : <span className="campus-map-status__badge"><span className="campus-map-status__dot" />Current snapshot</span>}
        <small>Updated {clock.format(new Date(data.generated_at))}</small>
        <button type="button" onClick={() => void query.refetch()} aria-label="Refresh campus snapshot"><RefreshCw size={16} className={query.isFetching ? "is-spinning" : ""} /></button>
      </div>

      {floors.length > 1 ? <div className="campus-map-floor-switch" role="tablist" aria-label="Campus levels and room groups"><Layers3 size={15} aria-hidden="true" />{floors.map((floor) => <button key={floor.id} type="button" role="tab" aria-selected={floor.id === activeFloor?.id} onClick={() => { setFloorId(floor.id); setSelectedSpace(null); }}>{floor.label}</button>)}</div> : null}

      <div className="campus-map-summary" aria-label="Campus snapshot summary">
        <span><strong>{currentExpectedSessions}</strong><small>classes expected now</small></span>
        <span><strong>{expectedTeachers}</strong><small>teachers expected</small></span>
        <span><strong>{gateEntries}</strong><small>{gateScopeLabel}</small></span>
        <span><strong>{roomObservationPoints}</strong><small>space evidence</small></span>
      </div>

      <div className="campus-map-legend" aria-label="Campus evidence legend"><span><i className="is-expected" />Expected</span><span><i className="is-observed" />Current evidence</span><span><i className="is-review" />Review</span><span><i className="is-unknown" />Unknown</span></div>

      <div className="campus-map-actions">
        <button type="button" onClick={(event) => openPanel("spaces", event.currentTarget)}><List size={17} /><span>Spaces</span><b>{spaces.length}</b></button>
        <button type="button" onClick={(event) => openPanel("timetable", event.currentTarget)}><CalendarDays size={17} /><span>Timetable</span><b>{timetableCount}</b></button>
        <button type="button" onClick={(event) => openPanel("activity", event.currentTarget)}><Activity size={17} /><span>Activity</span><b>{trail.length}</b></button>
        <button type="button" onClick={(event) => openPanel("kpis", event.currentTarget)}><Gauge size={17} /><span>KPIs</span></button>
        <time dateTime={now.toISOString()}><Clock3 size={15} /><span>{clock.format(now)}</span></time>
      </div>
    </div>

    {panel === "kpis" ? <CampusKpiPanel schoolId={schoolId} campusId={effectiveCampusId || undefined} timezone={timeZone} rehearsalActive={Boolean(overlay)} scenarioTargets={scenarioTargets} returnFocus={panelTrigger} onClose={closePanel} />
      : panel ? <CampusMapPanel mode={panel} spaces={spaces} zones={overlayZones} activity={trail} formatTime={(date) => occurred.format(date)} formatClock={(date) => clock.format(date)} returnFocus={panelTrigger} onSelectSpace={selectFromPanel} onClose={closePanel} /> : null}
    {selectedSpace ? <CampusSpaceSheet space={selectedSpace} overlay={selectedOverlay} onClose={() => setSelectedSpace(null)} /> : null}
  </OperationsShell>;
}
