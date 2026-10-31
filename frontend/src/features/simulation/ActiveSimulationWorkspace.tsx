import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CircleStop,
  Clock3,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { InfoSummary } from "../../components/InfoSummary";
import { useApplicationExecutionEnvironment } from "./ApplicationExecutionEnvironment";
import {
  simulationBehaviourFromRun,
  simulationBehaviourInput,
  SimulationBehaviourEditor,
  type SimulationBehaviourForm,
} from "./SimulationBehaviourEditor";
import { SimulationRunResources } from "./SimulationRunResources";
import { SimulationResourcePauseNotice } from "./SimulationResourcePauseNotice";
import { ScenarioEditorLinks } from "./ScenarioEditorLinks";
import { useSimulationExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";
import { focusSimulationHeading } from "./simulationFocus";
import {
  configureSimulationBehaviour,
  getSimulationRun,
  pauseSimulationRun,
  resumeSimulationRun,
  startSimulationRun,
  stopSimulationRun,
  updateSimulationDraft,
  type SimulationRunView,
} from "./simulationApi";

const SPEED_OPTIONS = [1, 5, 10, 20, 50, 100] as const;
const CHANGE_PAGE_SIZE = 3;

type DraftView = "edit" | "settings";
type ActiveView = "overview" | "results";
type SimulationView = DraftView | ActiveView;

function actionError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The simulation could not be updated. No Live record was changed.";
}

function statusLabel(status: SimulationRunView["status"]) {
  switch (status) {
    case "preparing": return "Preparing snapshot";
    case "draft": return "Scenario draft";
    case "running": return "Running";
    case "paused": return "Paused";
    case "stopped": return "Stopped";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}

function toLocalInputValue(instant: string | null) {
  if (!instant) return "";
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) return "";
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function toInstant(local: string, virtualNow: string) {
  if (!local) return null;
  const value = new Date(local);
  if (Number.isNaN(value.getTime())) throw new Error("Choose a valid end date and time.");
  const simulatedNow = new Date(virtualNow);
  if (Number.isNaN(simulatedNow.getTime()) || value.getTime() <= simulatedNow.getTime()) {
    throw new Error("The end date and time must be after the current simulated time.");
  }
  return value.toISOString();
}

function resolvedView(run: SimulationRunView, requested: string | null): SimulationView {
  if (run.status === "draft") {
    if (run.kind === "baseline") return "settings";
    return requested === "settings" ? "settings" : "edit";
  }
  if (["running", "paused", "stopped", "completed"].includes(run.status)) {
    return requested === "results" ? "results" : "overview";
  }
  return "overview";
}

function RunClock({ run }: { run: SimulationRunView }) {
  const formatter = useMemo(() => new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: run.clock.time_zone,
  }), [run.clock.time_zone]);

  return (
    <div className="simulation-active__clock">
      <Clock3 size={19} aria-hidden="true" />
      <div>
        <span>Virtual campus time</span>
        <strong>{formatter.format(new Date(run.clock.virtual_now))}</strong>
      </div>
      <span className="simulation-speed"><Gauge size={15} aria-hidden="true" /> {run.speed}×</span>
    </div>
  );
}

function ScenarioChangeLog({ changes }: { changes: SimulationRunView["draft_changes"] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const totalPages = Math.max(1, Math.ceil(changes.length / CHANGE_PAGE_SIZE));
  const requestedPage = Number(searchParams.get("changesPage") ?? "1");
  const validRequestedPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const currentPage = Math.min(validRequestedPage, totalPages);
  const previousPage = useRef(currentPage);
  const pageStart = (currentPage - 1) * CHANGE_PAGE_SIZE;
  const visibleChanges = changes.slice(pageStart, pageStart + CHANGE_PAGE_SIZE);
  useEffect(() => {
    const rawPage = searchParams.get("changesPage");
    const canonicalPage = currentPage === 1 ? null : String(currentPage);
    if (rawPage === canonicalPage) return;
    const nextParams = new URLSearchParams(searchParams);
    if (canonicalPage) nextParams.set("changesPage", canonicalPage);
    else nextParams.delete("changesPage");
    setSearchParams(nextParams, { replace: true });
  }, [currentPage, searchParams, setSearchParams]);

  useLayoutEffect(() => {
    if (previousPage.current === currentPage) return;
    previousPage.current = currentPage;
    focusSimulationHeading(headingRef.current);
  }, [currentPage]);

  const changePage = (nextPage: number) => {
    const boundedPage = Math.max(1, Math.min(totalPages, nextPage));
    const nextParams = new URLSearchParams(searchParams);
    if (boundedPage === 1) nextParams.delete("changesPage");
    else nextParams.set("changesPage", String(boundedPage));
    setSearchParams(nextParams);
  };

  return (
    <div className="simulation-change-log">
      <h3 ref={headingRef} tabIndex={-1}>Scenario changes <span>{changes.length}</span></h3>
      {changes.length > 0 ? (
        <>
          <ol>
            {visibleChanges.map((change) => (
              <li key={change.id}>
                <span>{change.domain.replaceAll("_", " ")}</span>
                <strong>{change.summary}</strong>
              </li>
            ))}
          </ol>
          {totalPages > 1 ? (
            <nav className="simulation-pagination" aria-label="Scenario change pages">
              <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>
                <ArrowLeft size={15} aria-hidden="true" /> Previous
              </button>
              <span aria-live="polite">Page {currentPage} of {totalPages}</span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}>
                Next <ArrowRight size={15} aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <p>No scenario changes were recorded for this run.</p>
      )}
    </div>
  );
}

interface ScenarioEditorsProps {
  changes: SimulationRunView["draft_changes"];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onContinue: () => void;
}

function ScenarioEditors({ changes, headingRef, onContinue }: ScenarioEditorsProps) {
  return (
    <section className="simulation-draft" aria-labelledby="scenario-edit-title">
      <header className="simulation-section-heading">
        <div>
          <p className="simulation-workspace__eyebrow">Step 1 of 2</p>
          <h2 id="scenario-edit-title" ref={headingRef} tabIndex={-1}>Edit this isolated campus</h2>
          <p>Use the normal ThatCampus editors. Every saved change remains in this scenario and is recorded below.</p>
        </div>
      </header>
      <ScenarioEditorLinks />

      <ScenarioChangeLog changes={changes} />

      <div className="simulation-page-actions">
        <span />
        <button type="button" className="simulation-button simulation-button--primary" onClick={onContinue}>
          Continue to run settings <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function SimulationLimitations({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;
  return (
    <details className="simulation-limitations">
      <InfoSummary className="simulation-limitations__summary">
        <span>Not modelled in this run</span>{" "}<strong>{limitations.length}</strong>
      </InfoSummary>
      <p>These capabilities stay unavailable rather than showing Live data inside Simulation.</p>
      <ul>{limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </details>
  );
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function SimulationBehaviourSummary({ behaviour }: Pick<SimulationRunView, "behaviour">) {
  if (!behaviour) {
    return (
      <p className="simulation-behaviour-summary" role="note">
        Synthetic counterparts are passive. No administrator-approved activity policy was configured for this run.
      </p>
    );
  }
  const models = [
    {
      enabled: behaviour.attendance.enabled,
      label: "Routine attendance",
      detail: behaviour.attendance.enabled
        ? `${percent(behaviour.attendance.present)} present · ${percent(behaviour.attendance.late)} late · ${percent(behaviour.attendance.absent)} absent · ${percent(behaviour.attendance.excused)} excused · after ${behaviour.attendance.submission_delay_minutes} min`
        : "Passive",
    },
    {
      enabled: behaviour.coverage_offers.enabled,
      label: "Coverage Offers",
      detail: behaviour.coverage_offers.enabled
        ? `${percent(behaviour.coverage_offers.accepted)} accept · ${percent(behaviour.coverage_offers.declined)} decline · ${percent(behaviour.coverage_offers.no_response)} no response · after ${behaviour.coverage_offers.response_delay_minutes} min`
        : "Passive",
    },
    {
      enabled: behaviour.invigilation_offers.enabled,
      label: "Invigilation Offers",
      detail: behaviour.invigilation_offers.enabled
        ? `${percent(behaviour.invigilation_offers.accepted)} accept · ${percent(behaviour.invigilation_offers.declined)} decline · ${percent(behaviour.invigilation_offers.no_response)} no response · after ${behaviour.invigilation_offers.response_delay_minutes} min`
        : "Passive",
    },
  ];
  const activeCount = models.filter((model) => model.enabled).length;
  const configuredAt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(behaviour.provenance.configured_at));
  return (
    <details className="simulation-behaviour-summary">
      <summary><span>Synthetic activity models</span><strong>{activeCount} active</strong></summary>
      <ul>{models.map((model) => <li key={model.label} className={model.enabled ? "is-enabled" : undefined}><strong>{model.label}</strong><span>{model.detail}</span></li>)}</ul>
      <p>Approved {configuredAt} · Policy {behaviour.provenance.version_ref}</p>
    </details>
  );
}

interface ActiveSimulationWorkspaceProps {
  schoolId: string;
}

function SelectedActiveSimulationWorkspace({ schoolId }: ActiveSimulationWorkspaceProps) {
  const environment = useSimulationExecutionEnvironment();
  const applicationEnvironment = useApplicationExecutionEnvironment();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [hasEnd, setHasEnd] = useState<boolean | null>(null);
  const [endLocal, setEndLocal] = useState<string | null>(null);
  const [behaviour, setBehaviour] = useState<SimulationBehaviourForm | null>(null);
  const [behaviourEdited, setBehaviourEdited] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousFocusKey = useRef<string | null>(null);

  const runQueryKey = executionEnvironmentQueryKey(environment, ["simulation-run", schoolId, environment.runId]);
  const runQuery = useQuery({
    queryKey: runQueryKey,
    queryFn: ({ signal }) => getSimulationRun(schoolId, environment.runId, signal),
    retry: false,
    // Ordinary campus editors can add draft receipts while this workspace is away.
    // Refresh on return without polling drafts or replacing mounted local controls.
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "running" || status === "preparing" ? 2_000 : false;
    },
  });
  const run = runQuery.data?.run;
  const view = run ? resolvedView(run, searchParams.get("view")) : "overview";
  const selectedName = name ?? run?.name ?? "";
  const selectedSpeed = speed ?? run?.speed ?? 20;
  const selectedHasEnd = hasEnd ?? (run ? !run.clock.unbounded : false);
  const selectedEndLocal = endLocal ?? toLocalInputValue(run?.clock.end_at ?? null);
  const selectedBehaviour = behaviour ?? simulationBehaviourFromRun(run?.behaviour);

  const changeView = (next: SimulationView) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", next);
    setSearchParams(nextParams);
  };

  const focusKey = run ? `${run.id}:${view}` : null;
  useLayoutEffect(() => {
    if (!focusKey) return;
    if (previousFocusKey.current === focusKey) return;
    previousFocusKey.current = focusKey;
    focusSimulationHeading(viewHeadingRef.current);
  }, [focusKey]);

  const action = useMutation({
    mutationFn: async (type: "start" | "pause" | "resume" | "stop") => {
      setLocalError(null);
      if (type === "start") {
        if (!run) throw new Error("The isolated run is not ready yet.");
        const endAt = selectedHasEnd ? toInstant(selectedEndLocal, run.clock.virtual_now) : null;
        const draftUpdate: { name?: string; speed?: number; end_at?: string | null } = {};
        const normalizedName = selectedName.trim();
        if (name !== null && normalizedName && normalizedName !== run.name) draftUpdate.name = normalizedName;
        if (speed !== null && selectedSpeed !== run.speed) draftUpdate.speed = selectedSpeed;
        if (hasEnd !== null || endLocal !== null) draftUpdate.end_at = endAt;
        if (Object.keys(draftUpdate).length > 0) {
          await updateSimulationDraft(schoolId, environment.runId, draftUpdate);
        }
        if (behaviourEdited) {
          await configureSimulationBehaviour(schoolId, environment.runId, simulationBehaviourInput(selectedBehaviour));
        }
        return startSimulationRun(schoolId, environment.runId, {
          speed: selectedSpeed,
          end_at: endAt,
        });
      }
      if (type === "pause") return pauseSimulationRun(schoolId, environment.runId);
      if (type === "resume") return resumeSimulationRun(schoolId, environment.runId, { speed: selectedSpeed });
      return stopSimulationRun(schoolId, environment.runId);
    },
    onSuccess: async (result, type) => {
      queryClient.setQueryData(runQueryKey, result);
      if (type === "start") changeView("overview");
      await queryClient.invalidateQueries({ queryKey: runQueryKey });
    },
    onError: (error) => setLocalError(actionError(error)),
  });

  if (runQuery.isPending) {
    return (
      <div className="simulation-workspace">
        <section className="simulation-workspace__state" aria-busy="true" aria-label="Loading simulation">
          <LoaderCircle className="simulation-workspace__spinner" size={28} aria-hidden="true" />
          <h1>Opening the isolated campus</h1>
          <p>Loading its virtual clock, current state and controls.</p>
        </section>
      </div>
    );
  }

  if (runQuery.isError || !run) {
    return (
      <div className="simulation-workspace">
        <section className="simulation-workspace__state is-error" role="alert">
          <h1>This simulation could not be loaded</h1>
          <p>Live data has not been used as a fallback. Retry this isolated run or return to Live.</p>
          <div className="simulation-inline-actions">
            <button type="button" onClick={() => void runQuery.refetch()}><RefreshCw size={16} aria-hidden="true" /> Retry</button>
            <button type="button" onClick={() => void applicationEnvironment.returnToLive()}><RotateCcw size={16} aria-hidden="true" /> Return to Live</button>
          </div>
        </section>
      </div>
    );
  }

  const working = action.isPending || applicationEnvironment.switchState === "switching";
  const stopAndReturn = async () => {
    try {
      await action.mutateAsync("stop");
      window.setTimeout(() => void applicationEnvironment.returnToLive(), 0);
    } catch {
      // The mutation owns the actionable error message and leaves the isolated
      // environment selected for a safe retry.
    }
  };
  const snapshotLabel = run.snapshot
    ? `Snapshot ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.snapshot.captured_at))}`
    : "Snapshot is being prepared";
  const showResults = ["running", "paused", "stopped", "completed"].includes(run.status);

  return (
    <div className="simulation-workspace">
      <section className={`simulation-workspace__hero simulation-workspace__hero--active is-${run.status}`} aria-labelledby="active-simulation-title">
        <span className="simulation-workspace__hero-icon" aria-hidden="true"><CalendarClock size={25} /></span>
        <div className="simulation-workspace__hero-copy">
          <div className="simulation-active__status-row">
            <p className="simulation-workspace__eyebrow">{run.kind === "baseline" ? "Baseline simulation" : "Scenario simulation"}</p>
            <span className={`simulation-status is-${run.status}`}>{statusLabel(run.status)}</span>
          </div>
          <h1 id="active-simulation-title">{run.name}</h1>
          <p>{run.status === "draft"
            ? "This isolated world is paused while you shape the alternative reality."
            : "The whole administrator app is using this isolated world. Live campus operations continue separately."}</p>
        </div>
      </section>

      {run.status === "draft" && run.kind === "scenario" ? (
        <nav className="simulation-view-switcher" aria-label="Scenario setup steps">
          <button type="button" className={view === "edit" ? "is-active" : ""} aria-current={view === "edit" ? "step" : undefined} onClick={() => changeView("edit")}>1. Edit campus</button>
          <button type="button" className={view === "settings" ? "is-active" : ""} aria-current={view === "settings" ? "step" : undefined} onClick={() => changeView("settings")}>2. Run settings</button>
        </nav>
      ) : showResults ? (
        <nav className="simulation-view-switcher" aria-label="Simulation views">
          <button type="button" className={view === "overview" ? "is-active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={() => changeView("overview")}>Overview</button>
          <button type="button" className={view === "results" ? "is-active" : ""} aria-current={view === "results" ? "page" : undefined} onClick={() => changeView("results")}>Results</button>
        </nav>
      ) : null}

      <SimulationResourcePauseNotice
        canResume={run.available_actions.includes("resume")}
        resources={run.resources}
      />

      {run.status === "draft" && view === "edit" ? (
        <ScenarioEditors changes={run.draft_changes} headingRef={viewHeadingRef} onContinue={() => changeView("settings")} />
      ) : run.status === "draft" ? (
        <section className="simulation-run-controls" aria-labelledby="simulation-settings-title">
          <header className="simulation-section-heading simulation-section-heading--row">
            <div>
              <p className="simulation-workspace__eyebrow">{run.kind === "scenario" ? "Step 2 of 2" : "Run settings"}</p>
              <h2 id="simulation-settings-title" ref={viewHeadingRef} tabIndex={-1}>Run settings</h2>
              <p>Name this scenario, choose how quickly time advances, and optionally set an end or synthetic activity pattern.</p>
            </div>
            <span>{snapshotLabel}</span>
          </header>

          <form className="simulation-draft-controls" aria-busy={working} onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            action.mutate("start");
          }}>
            <label className="simulation-field">
              <span>Name <small>Optional to change</small></span>
              <input type="text" maxLength={120} value={selectedName} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="simulation-field">
              <span>Simulation speed</span>
              <select value={selectedSpeed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {SPEED_OPTIONS.map((option) => <option key={option} value={option}>{option}× speed</option>)}
              </select>
            </label>
            <fieldset className="simulation-end-setting">
              <legend>Run duration</legend>
              <label className="simulation-check-field">
                <input type="checkbox" checked={selectedHasEnd} onChange={(event) => setHasEnd(event.target.checked)} />
                <span><strong>Stop at a simulated date and time</strong><small>Otherwise it runs until you stop it.</small></span>
              </label>
              {selectedHasEnd ? <label className="simulation-field simulation-field--end"><span>End date and time <small>Device time</small></span><TemporalInput type="datetime-local" required value={selectedEndLocal} onChange={(event) => setEndLocal(event.target.value)} /></label> : null}
            </fieldset>
            <SimulationBehaviourEditor value={selectedBehaviour} onChange={(value) => {
              setBehaviour(value);
              setBehaviourEdited(true);
            }} />
            {localError ? <p className="simulation-workspace__error" role="alert">{localError}</p> : null}
            <div className="simulation-page-actions">
              {run.kind === "scenario" ? <button type="button" className="simulation-button simulation-button--quiet" disabled={working} onClick={() => changeView("edit")}><ArrowLeft size={17} aria-hidden="true" /> Back to editing</button> : <span />}
              <button type="submit" className="simulation-button simulation-button--primary" disabled={working}>
                {working ? <LoaderCircle className="simulation-workspace__spinner" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />} Run simulation
              </button>
            </div>
          </form>
        </section>
      ) : view === "results" ? (
        <section className="simulation-metrics" aria-labelledby="simulation-results-title">
          <header className="simulation-section-heading">
            <div>
              <p className="simulation-workspace__eyebrow">Results</p>
              <h2 id="simulation-results-title" ref={viewHeadingRef} tabIndex={-1}>Simulation results</h2>
              <p>Measurements from this isolated world at its latest checkpoint.</p>
            </div>
          </header>
          {run.metrics.length > 0 ? (
            <dl>{run.metrics.map((metric) => <div key={metric.key}><dt>{metric.label ?? metric.key.replaceAll("_", " ")}</dt><dd>{metric.value ?? "Not available"}{metric.value !== null && metric.unit ? <small> {metric.unit}</small> : null}</dd></div>)}</dl>
          ) : (
            <div className="simulation-history__empty">
              <BarChart3 size={23} aria-hidden="true" />
              <strong>No measured results yet</strong>
              <p>Let this world advance to another checkpoint, then return to Results.</p>
            </div>
          )}
          <SimulationRunResources schoolId={schoolId} runId={run.id} runStatus={run.status} />
          <ScenarioChangeLog changes={run.draft_changes} />
          <div className="simulation-page-actions">
            <button type="button" className="simulation-button simulation-button--quiet" onClick={() => changeView("overview")}><ArrowLeft size={17} aria-hidden="true" /> Back to overview</button>
            <span />
          </div>
        </section>
      ) : (
        <section className="simulation-run-controls" aria-labelledby="simulation-overview-title">
          <header className="simulation-section-heading simulation-section-heading--row">
            <div>
              <p className="simulation-workspace__eyebrow">Overview</p>
              <h2 id="simulation-overview-title" ref={viewHeadingRef} tabIndex={-1}>Simulation overview</h2>
              <p>{run.status === "preparing" ? "The isolated snapshot is still being prepared." : "Follow virtual time and manage this world without affecting Live."}</p>
            </div>
            <span>{snapshotLabel}</span>
          </header>

          <RunClock run={run} />

          <details className="simulation-isolation-details">
            <InfoSummary>Live remains unchanged</InfoSummary>
            <p>Messages, connectors, devices and operational writes are contained inside this run. Returning to Live does not stop a running simulation.</p>
          </details>
          <SimulationLimitations limitations={run.world?.limitations ?? []} />

          {run.status === "paused" ? (
            <label className="simulation-field simulation-run-controls__speed">
              <span>Resume at</span>
              <select value={selectedSpeed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {SPEED_OPTIONS.map((option) => <option key={option} value={option}>{option}× speed</option>)}
              </select>
            </label>
          ) : null}

          {run.failure_reason ? <p className="simulation-workspace__error" role="alert">{run.failure_reason}</p> : null}
          {localError ? <p className="simulation-workspace__error" role="alert">{localError}</p> : null}
          {run.status !== "preparing" && run.status !== "failed"
            ? <SimulationBehaviourSummary behaviour={run.behaviour} />
            : null}

          <div className="simulation-run-controls__actions">
            {run.can_open && run.status !== "preparing" && run.status !== "failed" ? <Link className="simulation-button simulation-button--primary" to="/today">{run.status === "stopped" || run.status === "completed" ? "Open frozen Today" : "Open Today"} <ArrowRight size={17} aria-hidden="true" /></Link> : null}
            {run.available_actions.includes("pause") ? <button type="button" className="simulation-button simulation-button--secondary" disabled={working} onClick={() => action.mutate("pause")}>
              <Pause size={18} aria-hidden="true" /> Pause
            </button> : null}
            {run.available_actions.includes("resume") ? <button type="button" className="simulation-button simulation-button--secondary" disabled={working} onClick={() => action.mutate("resume")}>
              <Play size={18} aria-hidden="true" /> Resume
            </button> : null}
            {run.available_actions.includes("stop") ? <button type="button" className="simulation-button simulation-button--danger" disabled={working} onClick={() => void stopAndReturn()}>
              <CircleStop size={18} aria-hidden="true" /> Stop simulation
            </button> : null}
            <button type="button" className="simulation-button simulation-button--quiet" disabled={working} onClick={() => void applicationEnvironment.returnToLive()}>
              <RotateCcw size={18} aria-hidden="true" /> Return to Live
            </button>
          </div>
          <p className="simulation-run-controls__note">Returning to Live only changes this administrator session. {run.status === "stopped" || run.status === "completed" ? "This retained world stays available as a read-only record." : "The run keeps its current state and can continue server-side."}</p>

          {showResults ? <div className="simulation-page-actions">
            <span />
            <button type="button" className="simulation-button simulation-button--secondary" onClick={() => changeView("results")}>View results <ArrowRight size={17} aria-hidden="true" /></button>
          </div> : null}
        </section>
      )}
    </div>
  );
}

export function ActiveSimulationWorkspace({ schoolId }: ActiveSimulationWorkspaceProps) {
  const environment = useSimulationExecutionEnvironment();
  return <SelectedActiveSimulationWorkspace key={environment.runId} schoolId={schoolId} />;
}
