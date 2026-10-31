import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Copy,
  CircleStop,
  ExternalLink,
  LoaderCircle,
  Pause,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useApplicationExecutionEnvironment } from "./ApplicationExecutionEnvironment";
import { useExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";
import {
  compareSimulationRuns,
  duplicateSimulationRun,
  listSimulationRuns,
  listRetainedSimulationRuns,
  pauseSimulationRun,
  pinSimulationRun,
  resumeSimulationRun,
  startSimulationRun,
  stopSimulationRun,
  unpinSimulationRun,
  type SimulationComparison,
  type SimulationRunStatus,
  type SimulationRunView,
  type SimulationRunsResponse,
} from "./simulationApi";
import { focusSimulationHeading } from "./simulationFocus";
import { SimulationResourcePauseNotice } from "./SimulationResourcePauseNotice";
import { removalUnavailable, useSimulationRunRemoval } from "./useSimulationRunRemoval";

function statusLabel(status: SimulationRunStatus) {
  switch (status) {
    case "preparing": return "Preparing";
    case "draft": return "Draft";
    case "running": return "Running";
    case "paused": return "Paused";
    case "stopped": return "Stopped";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}

function runLabel(run: SimulationRunView) {
  return run.name.trim() || (run.kind === "baseline" ? "Campus baseline" : "Untitled scenario");
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The simulation action could not be completed.";
}

function idempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `simulation-duplicate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatDuration(durationMs: number) {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 60) return `${minutes} simulated min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ""} simulated`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d${remainingHours ? ` ${remainingHours}h` : ""} simulated`;
}

function formatMetric(value: number | string | null, unit: string) {
  if (value === null) return "Not available";
  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
    return unit === "percent" ? `${formatted}%` : `${formatted}${unit ? ` ${unit}` : ""}`;
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}

const HISTORY_PAGE_SIZE = 5;

function requestedPage(rawPage: string | null) {
  if (!rawPage || !/^[1-9]\d*$/u.test(rawPage)) return 1;
  const value = Number(rawPage);
  return Number.isSafeInteger(value) ? value : 1;
}

function ComparisonResult({
  comparison,
  headingRef,
  onBack,
}: {
  comparison: SimulationComparison;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const runNames = new Map(comparison.runs.map((run) => [run.run_id, run.name]));

  return (
    <section className="simulation-comparison simulation-comparison--focused" aria-labelledby="simulation-comparison-title">
      <button type="button" className="simulation-comparison__back" onClick={onBack}>
        Back to simulations
      </button>
      <header className="simulation-section-heading simulation-section-heading--row">
        <div>
          <p className="simulation-workspace__eyebrow">Comparison</p>
          <h2 id="simulation-comparison-title" ref={headingRef} tabIndex={-1}>Runs aligned at {formatDuration(comparison.duration_ms)}</h2>
        </div>
        <span className={`simulation-comparison__quality${comparison.controlled_snapshot ? " is-controlled" : ""}`}>
          {comparison.controlled_snapshot ? "Shared snapshot" : "Different snapshots"}
        </span>
      </header>

      {comparison.provenance_warning ? <p className="simulation-comparison__warning" role="note">{comparison.provenance_warning}</p> : null}
      {comparison.metrics.length > 0 ? (
        <div className="simulation-comparison__table-scroll" tabIndex={0} aria-label="Simulation comparison table">
          <table>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                {comparison.runs.map((run) => <th key={run.run_id} scope="col">{run.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {comparison.metrics.map((metric) => {
                const values = new Map(metric.values.map((value) => [value.run_id, value.value]));
                const deltas = new Map(metric.deltas_from_first.map((delta) => [delta.run_id, delta]));
                return (
                  <tr key={metric.key}>
                    <th scope="row">{metric.label ?? metric.key.replaceAll("_", " ")}</th>
                    {comparison.runs.map((run, index) => {
                      const delta = deltas.get(run.run_id);
                      return <td key={run.run_id} aria-label={`${runNames.get(run.run_id) ?? run.run_id}: ${formatMetric(values.get(run.run_id) ?? null, metric.unit)}`}>
                        <strong>{formatMetric(values.get(run.run_id) ?? null, metric.unit)}</strong>
                        {index > 0 && delta?.delta !== null && delta?.delta !== undefined ? <small>{delta.delta > 0 ? "+" : ""}{new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(delta.delta)} from first</small> : null}
                      </td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="simulation-comparison__empty">These runs have no common measured outcomes yet. Let them advance to a checkpoint, then compare again.</p>}
    </section>
  );
}

interface SimulationRunHistoryProps {
  schoolId: string;
  onLockedChange?: (locked: boolean) => void;
}

export function SimulationRunHistory({ schoolId, onLockedChange }: SimulationRunHistoryProps) {
  const environment = useExecutionEnvironment();
  const applicationEnvironment = useApplicationExecutionEnvironment();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState<{ catalogue: string; runIds: string[] }>({
    catalogue: "",
    runIds: [],
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [expandedActionsRunId, setExpandedActionsRunId] = useState<string | null>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const comparisonHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedPresentation = useRef<string | null>(null);

  const restoreContextActionFocus = (runId: string) => {
    window.requestAnimationFrame(() => {
      const trigger = document.getElementById(`simulation-run-more-${runId}`);
      if (trigger instanceof HTMLElement) trigger.focus();
      else focusSimulationHeading(historyHeadingRef.current);
    });
  };

  const listKey = executionEnvironmentQueryKey(environment, ["simulation-runs", schoolId]);
  const historyView = searchParams.get("view") === "history" && searchParams.get("manage") !== "storage";
  const comparisonMode = searchParams.get("select") === "compare";
  const rawPage = searchParams.get("page");
  const requested = requestedPage(rawPage);
  const runsQuery = useQuery({
    queryKey: [...listKey, "history"],
    queryFn: ({ signal }) => listSimulationRuns(schoolId, 10, signal),
    enabled: historyView,
    retry: false,
    refetchInterval: (query) => query.state.data?.results.some((run) => run.status === "running" || run.status === "preparing") ? 5_000 : false,
  });
  const savedQuery = useQuery({
    queryKey: [...listKey, "retained", requested],
    queryFn: ({ signal }) => listRetainedSimulationRuns(schoolId, requested, signal),
    enabled: !historyView,
    retry: false,
    refetchInterval: query => query.state.data?.results.some(run => run.status === "running" || run.status === "preparing") ? 5_000 : false,
  });
  const query = historyView ? runsQuery : savedQuery;
  const runs = query.data?.results ?? [];
  const pageCount = Math.max(1, historyView ? Math.ceil(runs.length / HISTORY_PAGE_SIZE) : savedQuery.data?.page.total_pages ?? 1);
  const page = Math.min(requested, pageCount);
  const pageRuns = historyView ? runs.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE) : runs;
  const selectableRunCatalogue = runs
    .filter((run) => run.available_actions.includes("compare"))
    .map((run) => run.id)
    .join("|");
  const selectableRunIds = new Set(selectableRunCatalogue ? selectableRunCatalogue.split("|") : []);
  // Saved pages are not the full catalogue: keep selections from other pages.
  const selected = selection.runIds.filter(id => historyView ? selectableRunIds.has(id) : !runs.some(run => run.id === id && !selectableRunIds.has(id)));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: listKey, refetchType: "none" });
    await queryClient.refetchQueries({ queryKey: listKey, type: "active" }, { throwOnError: true });
  };
  const removal = useSimulationRunRemoval({ schoolId, refresh, restoreFocus: restoreContextActionFocus });

  const control = useMutation({
    mutationFn: async ({ run, action }: { run: SimulationRunView; action: "start" | "pause" | "resume" | "stop" | "duplicate" | "pin" | "unpin" }) => {
      setLocalError(null);
      setLocalNotice(null);
      if (action === "start") return startSimulationRun(schoolId, run.id);
      if (action === "pause") return pauseSimulationRun(schoolId, run.id);
      if (action === "resume") return resumeSimulationRun(schoolId, run.id, { speed: run.speed });
      if (action === "pin") return pinSimulationRun(schoolId, run.id);
      if (action === "unpin") return unpinSimulationRun(schoolId, run.id);
      if (action === "duplicate") return duplicateSimulationRun(schoolId, run.id, {
        name: `Copy of ${runLabel(run)}`,
        kind: "scenario",
        speed: run.speed,
        end_at: run.clock.end_at,
        idempotency_key: idempotencyKey(),
      });
      return stopSimulationRun(schoolId, run.id);
    },
    onSuccess: async (result, variables) => {
      if (variables.action === "start") {
        queryClient.setQueriesData<SimulationRunsResponse>({ queryKey: listKey }, previous => previous ? { ...previous, results: previous.results.map(item => item.id === result.run.id ? result.run : item) } : previous);
        setLocalNotice(`${runLabel(result.run)} started. Open it to enter the simulation.`);
      }
      await queryClient.invalidateQueries({ queryKey: listKey });
      restoreContextActionFocus(variables.run.id);
    },
    onError: (error, variables) => {
      setLocalError(errorMessage(error));
      if (variables.action === "start") void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  const compare = useMutation({
    mutationFn: () => compareSimulationRuns(schoolId, { run_ids: selected }),
    onSuccess: () => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("compare", "1");
        return next;
      });
    },
    onError: (error) => setLocalError(errorMessage(error)),
  });
  useEffect(() => { onLockedChange?.(removal.locked || control.isPending || compare.isPending); }, [onLockedChange, removal.locked, control.isPending, compare.isPending]);

  const comparisonView = searchParams.get("compare") === "1" && Boolean(compare.data);

  useEffect(() => {
    if (!query.isSuccess || rawPage === null || rawPage === String(page)) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(page));
      return next;
    }, { replace: true });
  }, [page, rawPage, query.isSuccess, setSearchParams]);

  useEffect(() => {
    const requestedComparison = searchParams.get("compare");
    if (requestedComparison === null
      || (requestedComparison === "1" && (compare.data || compare.isPending))) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("compare");
      return next;
    }, { replace: true });
  }, [compare.data, compare.isPending, searchParams, setSearchParams]);

  useLayoutEffect(() => {
    if (removal.intent) { focusedPresentation.current = null; return; }
    const presentation = comparisonView ? "comparison" : `${historyView ? "history" : "saved"}:${page}`;
    if (focusedPresentation.current === presentation) return;
    focusedPresentation.current = presentation;
    focusSimulationHeading((comparisonView ? comparisonHeadingRef : historyHeadingRef).current);
  }, [comparisonView, page, historyView, removal.intent]);

  const moveToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), pageCount);
    setSelection({ catalogue: selectableRunCatalogue, runIds: selected });
    setExpandedActionsRunId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(clamped));
      return next;
    });
  };

  const backToHistory = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("compare");
      return next;
    });
    compare.reset();
  };

  const toggleSelected = (runId: string, checked: boolean) => {
    setLocalError(null);
    compare.reset();
    setSelection({
      catalogue: selectableRunCatalogue,
      runIds: checked
        ? selected.includes(runId) ? selected : [...selected, runId]
        : selected.filter((id) => id !== runId),
    });
  };

  const changeView = () => {
    setSelection({ catalogue: "", runIds: [] }); setExpandedActionsRunId(null); compare.reset();
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (historyView) next.delete("view"); else next.set("view", "history");
      for (const key of ["page", "compare", "select", "manage"]) next.delete(key);
      return next;
    });
  };
  const toggleCompareMode = () => {
    setSelection({ catalogue: "", runIds: [] }); compare.reset(); setExpandedActionsRunId(null);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (comparisonMode) next.delete("select"); else next.set("select", "compare");
      next.delete("compare"); return next;
    });
  };

  const openRun = async (run: SimulationRunView) => {
    setLocalError(null);
    try {
      const opened = await applicationEnvironment.enterSimulation(run.id);
      if (!opened) {
        setLocalError("We couldn't open this simulation. Your Live campus is unchanged. Try again from this run.");
      } else {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          for (const key of ["panel", "step", "page", "compare", "view", "changePage", "changesPage", "effectsPage"]) next.delete(key);
          return next;
        }, { replace: true });
      }
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  if (comparisonView && compare.data) {
    return (
      <section className="simulation-history simulation-history--comparison" aria-label="Simulation comparison">
        <ComparisonResult
          comparison={compare.data.comparison}
          headingRef={comparisonHeadingRef}
          onBack={backToHistory}
        />
      </section>
    );
  }

  return (
    <section className="simulation-history" aria-labelledby="simulation-history-title">
      <header className="simulation-section-heading simulation-section-heading--row">
        <div>
          <h2 id="simulation-history-title" ref={historyHeadingRef} tabIndex={-1}>{historyView ? "Run history" : "Saved simulations"}</h2>
          <p>{historyView ? "The latest ten runs, including removed simulations. History does not use a saved place." : "Open a simulation or manage its saved place. Live stays unchanged."}</p>
        </div>
        <button type="button" className="simulation-icon-button" aria-label="Refresh simulations" onClick={() => void removal.refreshOnly()} disabled={removal.busy || query.isFetching}>
          <RefreshCw className={query.isFetching ? "simulation-workspace__spinner" : undefined} size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="simulation-history__tools">
        <button type="button" className="simulation-text-button" disabled={removal.locked || control.isPending} onClick={changeView}>{historyView ? "Saved simulations" : "Run history"}</button>
        <button type="button" className="simulation-text-button" disabled={removal.locked || control.isPending || (!comparisonMode && runs.length === 0)} aria-pressed={comparisonMode} onClick={toggleCompareMode}>{comparisonMode ? "Cancel comparison" : "Compare runs"}</button>
      </div>
      {removal.notice ? <p role="status">{removal.notice}</p> : null}
      {removal.error ? <div className="simulation-workspace__error" role="alert"><p>{removal.error}</p><button type="button" className="simulation-text-button" disabled={removal.busy} onClick={() => void removal.refreshOnly()}>Refresh list</button></div> : null}
      {removal.intent && !runs.some(run => run.id === removal.intent?.runId) ? removal.confirmation : null}
      {query.isPending ? (
        <div className="simulation-history__state" aria-busy="true"><LoaderCircle className="simulation-workspace__spinner" size={22} aria-hidden="true" /><span>Loading simulations…</span></div>
      ) : query.isError && !removal.error ? (
        <div className="simulation-history__state is-error" role="alert"><strong>Simulations could not be loaded.</strong><button type="button" disabled={removal.busy} onClick={() => void removal.refreshOnly()}>Try again</button></div>
      ) : runs.length === 0 ? (
        <div className="simulation-history__empty">
          <BarChart3 size={23} aria-hidden="true" />
          <strong>{historyView ? "No simulations yet" : "No saved simulations"}</strong>
          <p>{historyView ? "Your latest ten baselines and scenarios will appear here." : "Create a new simulation when you are ready."}</p>
        </div>
      ) : (
        <ol className="simulation-run-list">
          {pageRuns.map((run) => {
            const comparable = run.available_actions.includes("compare");
            const busy = control.isPending || removal.locked;
            const removalReason = removalUnavailable(run);
            const removable = removalReason === null;
            const worldRemoved = Boolean(run.retention?.world_discarded_at || run.retention?.state === "deleted");
            const hasContextualActions = run.available_actions.some((action) =>
              action === "start" || action === "pause" || action === "resume" || action === "duplicate" || action === "stop"
              || action === "pin" || action === "unpin" || action === "remove") || removable;
            const actionsExpanded = expandedActionsRunId === run.id;
            return (
              <li key={run.id} className={`simulation-run-card${comparisonMode && comparable ? " is-selectable" : ""}`}>
                {comparisonMode && comparable ? <label className="simulation-run-card__select">
                  <input
                    type="checkbox"
                    checked={selected.includes(run.id)}
                    disabled={!comparable || (selected.length >= 10 && !selected.includes(run.id))}
                    onChange={(event) => toggleSelected(run.id, event.target.checked)}
                  />
                  <span className="sr-only">Select {runLabel(run)} for comparison</span>
                </label> : null}
                <div className="simulation-run-card__body">
                  <div className="simulation-run-card__title">
                    <div>
                      <span>{run.kind === "baseline" ? "Baseline" : "Scenario"}</span>
                      <h3>{runLabel(run)}</h3>
                    </div>
                    <span className={`simulation-status is-${run.status}`}>{worldRemoved ? "World removed" : statusLabel(run.status)}</span>
                  </div>
                  <dl>
                    <div><dt>Virtual date</dt><dd>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: run.clock.time_zone }).format(new Date(run.clock.virtual_now))}</dd></div>
                    <div><dt>Speed</dt><dd>{run.speed}×</dd></div>
                    <div><dt>Changes</dt><dd>{run.draft_changes.length}</dd></div>
                    {run.retention?.pinned ? <div><dt>Retention</dt><dd>Pinned</dd></div> : null}
                  </dl>
                  {worldRemoved ? <p className="simulation-run-card__context-note">Run history is kept. No saved place is used.</p> : null}
                  <SimulationResourcePauseNotice
                    canResume={run.available_actions.includes("resume")}
                    compact
                    resources={run.resources}
                  />
                  <div className="simulation-run-card__actions">
                    {run.can_open && run.available_actions.includes("open") ? <button type="button" disabled={busy || applicationEnvironment.switchState === "switching"} onClick={() => void openRun(run)}><ExternalLink size={16} aria-hidden="true" /> Open</button> : null}
                    {hasContextualActions ? (
                      <button
                        type="button"
                        id={`simulation-run-more-${run.id}`}
                        className="simulation-run-card__more"
                        aria-expanded={actionsExpanded}
                        aria-controls={`simulation-run-actions-${run.id}`}
                        disabled={busy || compare.isPending}
                        onClick={() => setExpandedActionsRunId(actionsExpanded ? null : run.id)}
                      >
                        More actions<span className="sr-only"> for {runLabel(run)}</span>
                      </button>
                    ) : null}
                  </div>
                  {actionsExpanded ? (
                    <div id={`simulation-run-actions-${run.id}`} className="simulation-run-card__actions simulation-run-card__actions--contextual" role="group" aria-label={`Actions for ${runLabel(run)}`}>
                      {run.available_actions.includes("start") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "start" }); }}><Play size={16} aria-hidden="true" /> Start saved simulation</button> : null}
                      {run.available_actions.includes("pause") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "pause" }); }}><Pause size={16} aria-hidden="true" /> Pause</button> : null}
                      {run.available_actions.includes("resume") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "resume" }); }}><Play size={16} aria-hidden="true" /> Resume</button> : null}
                      {run.available_actions.includes("duplicate") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "duplicate" }); }}><Copy size={16} aria-hidden="true" /> Duplicate</button> : null}
                      {run.available_actions.includes("pin") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "pin" }); }}><Pin size={16} aria-hidden="true" /> Pin retained world</button> : null}
                      {run.available_actions.includes("unpin") ? <button type="button" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "unpin" }); }}><PinOff size={16} aria-hidden="true" /> Use standard retention</button> : null}
                      {run.available_actions.includes("stop") && run.status !== "draft" ? <button type="button" className="is-danger" disabled={busy} onClick={() => { setExpandedActionsRunId(null); restoreContextActionFocus(run.id); control.mutate({ run, action: "stop" }); }}><CircleStop size={16} aria-hidden="true" /> Stop</button> : null}
                      {removable ? <button type="button" className="is-danger" disabled={busy || compare.isPending || applicationEnvironment.switchState === "switching"} onClick={() => removal.choose(run)}>{run.status === "draft" ? "Discard draft" : "Remove simulation"}</button> : null}
                      {!worldRemoved && removalReason ? <p className="simulation-run-card__context-note">{removalReason}</p> : null}
                      {run.available_actions.includes("pin") || run.available_actions.includes("unpin")
                        ? <p className="simulation-run-card__context-note">{run.retention?.pinned ? "Pinned worlds remain available until an administrator returns them to standard retention." : "Pin this terminal world to keep it beyond the standard retention window."}</p>
                        : run.available_actions.includes("duplicate") ? <p className="simulation-run-card__context-note">Duplicate starts a new draft from the same snapshot. Later changes and activity settings are not copied.</p> : null}
                    </div>
                  ) : null}
                  {removal.intent?.runId === run.id ? removal.confirmation : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {pageCount > 1 ? (
        <nav className="simulation-history__pagination" aria-label="Simulations pages">
          <button type="button" disabled={removal.locked || control.isPending || page === 1} onClick={() => moveToPage(page - 1)}>Previous</button>
          <span className="simulation-history__page-summary" aria-live="polite">Page {page} of {pageCount}</span>
          <button type="button" disabled={removal.locked || control.isPending || page === pageCount} onClick={() => moveToPage(page + 1)}>Next</button>
        </nav>
      ) : null}

      {localError ? <p className="simulation-workspace__error" role="alert">{localError}</p> : null}
      {localNotice ? <p role="status">{localNotice}</p> : null}
      {comparisonMode ? (
        <div className="simulation-compare-action">
          <div><strong>{selected.length} selected</strong><small>{selected.length < 2 ? "Select at least two comparable runs." : `${selected.length} runs will be aligned to their shared duration.`}</small></div>
          <button type="button" className="simulation-button simulation-button--secondary" disabled={selected.length < 2 || compare.isPending} onClick={() => compare.mutate()}>
            {compare.isPending ? <LoaderCircle className="simulation-workspace__spinner" size={18} aria-hidden="true" /> : <Scale size={18} aria-hidden="true" />}
            Compare selected
          </button>
        </div>
      ) : null}
    </section>
  );
}
