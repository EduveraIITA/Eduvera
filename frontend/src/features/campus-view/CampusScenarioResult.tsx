import { ArrowRight, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CampusScenarioMetric, CampusScenarioRun } from "./scenarioApi";
import { useOptionalApplicationExecutionEnvironment } from "../simulation/ApplicationExecutionEnvironment";

function value(metric: CampusScenarioMetric, amount: number) {
  const rendered = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(amount);
  if (metric.unit === "percent") return `${rendered}%`;
  if (metric.unit === "minutes") return `${rendered} min`;
  return `${rendered} ${metric.unit.replaceAll("_", " ")}`;
}

function MetricComparison({ metric, calibrated }: { metric: CampusScenarioMetric; calibrated: boolean }) {
  const baselineP50 = metric.availability === "unavailable" ? null : metric.baseline.p50;
  const scenarioP50 = metric.availability === "unavailable" ? null : metric.scenario.p50;
  const delta = scenarioP50 === null || baselineP50 === null ? null : scenarioP50 - baselineP50;
  const rangeAvailable = metric.availability !== "unavailable" && metric.scenario.p10 !== null && metric.scenario.p90 !== null;
  return <li className={`campus-scenario-metric is-${metric.availability}`}>
    <header>
      <div><h4>{metric.label}</h4><p>{metric.explanation}</p></div>
      <strong aria-label={delta === null ? "Change unavailable" : `Change ${delta >= 0 ? "plus" : "minus"} ${value(metric, Math.abs(delta))}`}>{delta === null ? "Not comparable" : <>{delta > 0 ? "+" : ""}{value(metric, delta)}</>}</strong>
    </header>
    <dl>
      <div><dt>Baseline</dt><dd>{baselineP50 === null ? "Unavailable" : value(metric, baselineP50)}</dd></div>
      <div><dt>With change</dt><dd>{scenarioP50 === null ? "Unavailable" : value(metric, scenarioP50)}</dd></div>
    </dl>
    {calibrated && rangeAvailable ? <p className="campus-scenario-metric__range">P10–P90 estimate: {value(metric, metric.scenario.p10!)}–{value(metric, metric.scenario.p90!)}</p>
      : calibrated ? <p className="campus-scenario-metric__range is-unavailable">P10–P90 range unavailable{metric.unavailable_reason ? ` · ${metric.unavailable_reason}` : " for this metric"}.</p>
        : metric.availability === "unavailable" ? <p className="campus-scenario-metric__range is-unavailable">Estimate unavailable{metric.unavailable_reason ? ` · ${metric.unavailable_reason}` : "."}</p>
          : <p className="campus-scenario-metric__range is-unavailable">Point estimate from this snapshot. No calibrated uncertainty range was used.</p>}
  </li>;
}

export function CampusScenarioResult({ run, timezone, isDiscarding, onDiscard }: {
  run: CampusScenarioRun;
  timezone: string;
  isDiscarding: boolean;
  onDiscard: () => void;
}) {
  const applicationEnvironment = useOptionalApplicationExecutionEnvironment();
  const [runExpired, setRunExpired] = useState(false);
  const calibrated = run.uncertainty_status === "calibrated_ensemble";
  const canEnterApplication = run.projection_capabilities.application_parity === true
    && run.projection_capabilities.unsupported.length === 0
    && !runExpired;
  const entering = applicationEnvironment?.switchState === "switching";
  const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone });

  useEffect(() => {
    const remaining = new Date(run.expires_at).getTime() - Date.now();
    if (remaining <= 0) {
      const expiredTimer = window.setTimeout(() => setRunExpired(true), 0);
      return () => window.clearTimeout(expiredTimer);
    }
    const resetTimer = window.setTimeout(() => setRunExpired(false), 0);
    const timer = window.setTimeout(() => setRunExpired(true), Math.min(remaining + 50, 2_147_483_647));
    return () => {
      window.clearTimeout(resetTimer);
      window.clearTimeout(timer);
    };
  }, [run.expires_at]);

  if (run.status === "queued" || run.status === "running") return <div className="campus-scenario-running" role="status" aria-live="polite">
    <span aria-hidden="true" /><strong>Running isolated scenario</strong><p>{Math.max(0, Math.min(100, Math.round(run.progress)))}% complete. Live campus operations remain untouched.</p>
  </div>;
  if (run.status === "failed") return <div className="campus-scenario-failed" role="alert"><strong>Scenario could not be completed</strong><p>{run.failure_reason || "The isolated run stopped without changing live operations."}</p><button type="button" onClick={onDiscard}>Clear run</button></div>;

  return <div className="campus-scenario-result">
    <section className="campus-scenario-result__summary" aria-labelledby="campus-scenario-result-title">
      <span>Scenario comparison</span>
      <h3 id="campus-scenario-result-title">{run.intervention.target_label} unavailable</h3>
      <p>{run.horizon_days}-day view from the campus snapshot captured {dateTime.format(new Date(run.snapshot_at))}. Estimates are planning guidance, not facts about the future.</p>
      <div className="campus-scenario-safety"><ShieldCheck size={17} aria-hidden="true" /><p><strong>No live changes or messages.</strong> This run used an isolated snapshot with production writes, connectors and messaging disabled.</p></div>
      {canEnterApplication && applicationEnvironment ? <div className="campus-scenario-entry">
        <div><strong>Explore this virtual campus</strong><p>The same ThatCampus screens will use this isolated run until you return to Live.</p></div>
        <button type="button" disabled={entering} onClick={() => void applicationEnvironment.enterSimulation(run.id)}>
          {entering ? <LoaderCircle className="campus-scenario-entry__spinner" size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
          {entering ? "Entering…" : "Enter simulation"}
        </button>
      </div> : <div className="campus-scenario-results-only" role="note">
        <strong>Comparison only</strong>
        <p>This run does not contain every enabled app module, so it cannot replace your Live campus screens.</p>
      </div>}
    </section>

    <section aria-labelledby="campus-scenario-comparison-title">
      <div className="campus-kpi-section-heading"><div><span>Baseline vs alternative</span><h3 id="campus-scenario-comparison-title">Operational effect</h3></div><small>{calibrated ? "P50 estimate" : "Point estimate"}</small></div>
      {run.metrics.length ? <ul className="campus-scenario-metrics">{run.metrics.map((metric) => <MetricComparison key={metric.key} metric={metric} calibrated={calibrated} />)}</ul>
        : <p className="campus-kpi-empty">This scenario returned no supported KPI estimates.</p>}
    </section>

    <details className="campus-scenario-details">
      <summary>Assumptions and limits</summary>
      <div><h4>Assumptions</h4><ul>{run.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div><h4>Not modelled</h4>{run.unsupported_domains.length ? <ul>{run.unsupported_domains.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No additional unsupported domains were reported.</p>}</div>
      <p>Snapshot contains {run.source_snapshot.counts.sessions} sessions, {run.source_snapshot.counts.teachers} teachers, {run.source_snapshot.counts.spaces} spaces and {run.source_snapshot.counts.enrolments} enrolments.</p>
    </details>

    <footer className="campus-scenario-result__footer"><span>Automatically expires {dateTime.format(new Date(run.expires_at))}</span><button type="button" onClick={onDiscard} disabled={isDiscarding}><Trash2 size={16} aria-hidden="true" />{isDiscarding ? "Discarding…" : "Discard scenario"}</button></footer>
  </div>;
}
