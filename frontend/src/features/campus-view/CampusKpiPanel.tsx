import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BarChart3, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { CampusKpiOverview } from "./CampusKpiOverview";
import { CampusKpiSeriesPage } from "./CampusKpiSeriesPage";
import { getCampusKpis } from "./kpiApi";
import type { CampusKpiPage, CampusKpiRange } from "./kpiApi";
import { useAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { campusDateFormatter } from "./campusSceneRecords";
import "./campus-kpi.css";

const pages: Array<{ id: CampusKpiPage; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "teaching", label: "Teaching" },
  { id: "movement", label: "Movement" },
  { id: "spaces", label: "Spaces" },
  { id: "coordination", label: "Coordination" },
  { id: "data_health", label: "Data health" },
];

const ranges: Array<{ id: CampusKpiRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "1y", label: "1y" },
];

interface CampusKpiPanelProps {
  schoolId: string;
  campusId?: string;
  timezone: string;
  rehearsalActive: boolean;
  returnFocus: HTMLElement | SVGElement | null;
  onClose: () => void;
}

export function CampusKpiPanel(props: CampusKpiPanelProps) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const authorized = Boolean(props.schoolId && auth.user?.active_school_id === props.schoolId && auth.memberships.some(member => member.school_id === props.schoolId && member.role === "admin"));
  if (!authorized || environment.mode === "simulation" && environment.unavailable) return <section role="alert"><p>Campus KPIs are unavailable in this context.</p><button type="button" onClick={props.onClose}>Close campus performance</button></section>;
  return <ActiveCampusKpiPanel key={`${executionEnvironmentIdentity(environment)}:${props.schoolId}:${props.campusId}`} {...props} />;
}

function ActiveCampusKpiPanel({ schoolId, campusId, timezone, rehearsalActive, returnFocus, onClose }: CampusKpiPanelProps) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [page, setPage] = useState<CampusKpiPage>("overview");
  const [range, setRange] = useState<CampusKpiRange>("today");
  const requestRange = page === "overview" ? "today" : range;
  const query = useQuery({
    queryKey: executionEnvironmentQueryKey(environment, ["campus-view", "kpis", schoolId, campusId ?? "all", page, requestRange]),
    queryFn: ({ signal }) => getCampusKpis(schoolId, { campusId, page, range: requestRange }, signal),
    enabled: Boolean(schoolId),
    staleTime: 30_000,
    refetchInterval: environment.mode === "live" && (page === "overview" || requestRange === "today") ? 60_000 : false,
    retry: false,
  });
  const time = useMemo(() => campusDateFormatter(timezone), [timezone]);

  const close = useCallback(() => {
    dialog.current?.close();
    onClose();
    window.setTimeout(() => returnFocus?.focus(), 0);
  }, [onClose, returnFocus]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    title.current?.focus();
    const cancel = (event: Event) => { event.preventDefault(); close(); };
    node.addEventListener("cancel", cancel);
    return () => {
      node.removeEventListener("cancel", cancel);
      if (node.open) node.close();
    };
  }, [close]);

  const selectPage = (nextPage: CampusKpiPage) => setPage(nextPage);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + pages.length) % pages.length;
    setPage(pages[next]!.id);
    tabRefs.current[next]?.focus();
  };
  const selectedPage = pages.find((item) => item.id === page)!;

  return <dialog ref={dialog} className="campus-map-panel campus-kpi-panel" aria-labelledby="campus-kpi-panel-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="campus-map-panel__surface campus-kpi-panel__surface">
      <span className="campus-map-panel__handle" aria-hidden="true" />
      <header>
        <div><span>Operational KPIs</span><h2 id="campus-kpi-panel-title" ref={title} tabIndex={-1}>Campus performance</h2>
          <p>{query.data ? `${query.data.scope.campus_label} · Updated ${time.format(new Date(query.data.generated_at))}` : "Source-backed operational measures"}</p></div>
        <button type="button" onClick={close} aria-label="Close campus performance"><X size={20} /></button>
      </header>

      {rehearsalActive ? <p className="campus-kpi-rehearsal" role="note">The rehearsal layer shown on the map is excluded. These KPIs use recorded school data only.</p> : null}

      <div className="campus-kpi-mode" role="group" aria-label="Campus performance mode">
        <span className="is-current">{environment.mode === "simulation" ? "Simulation performance" : "Live performance"}</span>
        <Link to="/more/simulation">Open Simulation</Link>
      </div>

      <div className="campus-kpi-navigation">
        <div className="campus-kpi-tabs" role="tablist" aria-label="Campus KPI pages">{pages.map((item, index) => <button
          key={item.id}
          ref={(node) => { tabRefs.current[index] = node; }}
          id={`campus-kpi-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={page === item.id}
          aria-controls="campus-kpi-page"
          tabIndex={page === item.id ? 0 : -1}
          onClick={() => selectPage(item.id)}
          onKeyDown={(event) => onTabKeyDown(event, index)}
        >{item.label}</button>)}</div>

        {page !== "overview" ? <div className="campus-kpi-range" role="group" aria-label="KPI history range">{ranges.map((item) => <button
          key={item.id}
          type="button"
          aria-pressed={range === item.id}
          onClick={() => setRange(item.id)}
        >{item.label}</button>)}</div> : null}
      </div>

      <div id="campus-kpi-page" role="tabpanel" aria-labelledby={`campus-kpi-tab-${page}`} tabIndex={0} className="campus-kpi-content">
        <h3 className="campus-map-sr-only">{selectedPage.label} KPIs</h3>
        {query.isPending ? <div className="campus-kpi-loading" aria-busy="true" aria-label="Loading campus KPIs"><span /><span /><span /></div>
          : query.isError ? <div className="campus-kpi-state" role="alert"><AlertCircle size={25} aria-hidden="true" /><strong>We couldn’t load campus KPIs</strong><p>The campus map is still available. Check the connection and try this panel again.</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></div>
            : query.data ? page === "overview" ? <CampusKpiOverview data={query.data} /> : <CampusKpiSeriesPage data={query.data} />
              : <div className="campus-kpi-state"><BarChart3 size={25} aria-hidden="true" /><strong>No KPI data returned</strong><p>Refresh after campus activity has been recorded.</p></div>}
      </div>
    </div>
  </dialog>;
}
