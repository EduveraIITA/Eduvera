import { ArrowUpRight, DatabaseZap } from "lucide-react";
import { Link } from "react-router-dom";
import { CampusKpiTimeSeries, formatKpiValue } from "./CampusKpiCharts";
import type { CampusKpiEvidenceDimension, CampusKpiMetric, CampusKpiResponse } from "./kpiApi";

const evidenceLabel: Record<CampusKpiEvidenceDimension, string> = {
  expected: "Plan",
  observed: "Observation",
  accepted: "Accepted record",
};

function sourceTimestamp(metric: CampusKpiMetric, timezone: string) {
  if (!metric.source_max_at) return null;
  const value = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(metric.source_max_at));
  return `Newest source timestamp ${value}`;
}

function qualityMessages(metric: CampusKpiMetric) {
  const messages: string[] = [];
  if (metric.availability === "unavailable") {
    messages.push(metric.unavailable_reason ?? "The configured sources do not support this measure for the selected period.");
  } else if (metric.availability === "partial") {
    messages.push(metric.unavailable_reason ?? "This measure uses partial source coverage for the selected period.");
  }
  if (metric.unknown_count > 0) messages.push(`${metric.unknown_count} source items remain unknown for this measure.`);
  return messages;
}

export function CampusKpiSeriesPage({ data }: { data: CampusKpiResponse }) {
  if (!data.metrics.length) return <div className="campus-kpi-state">
    <DatabaseZap size={25} aria-hidden="true" />
    <strong>No KPIs for this view yet</strong>
    <p>This page will populate when its campus operations and evidence sources are configured.</p>
  </div>;

  return <div className="campus-kpi-metrics">
    <div className="campus-kpi-series-intro"><div><span>{data.bucket.label} intervals</span><strong>{data.scope.campus_label}</strong></div><p>Gaps remain gaps when evidence is unavailable; they are never converted to zero.</p></div>
    {data.metrics.map((metric) => {
      const quality = qualityMessages(metric);
      const sourceTime = sourceTimestamp(metric, data.period.timezone);
      return <article key={metric.key} className={`campus-kpi-metric is-${metric.availability}`}>
        <header>
          <div><h3>{metric.label}</h3><p>{metric.description}</p></div>
          <div className="campus-kpi-metric__value"><strong>{formatKpiValue(metric.value, metric.unit)}</strong>
            {metric.availability !== "available" ? <span>{metric.availability === "partial" ? "Partial evidence" : "Unavailable"}</span> : null}
          </div>
        </header>
        {metric.numerator !== null && metric.denominator !== null ? <p className="campus-kpi-metric__basis">{metric.numerator} of {metric.denominator} recorded in the current value</p> : null}
        {quality.length ? <ul className="campus-kpi-metric__quality" aria-label={`${metric.label} evidence coverage`}>{quality.map((message) => <li key={message}>{message}</li>)}</ul> : null}
        <CampusKpiTimeSeries metric={metric} bucket={data.bucket} timezone={data.period.timezone} />
        <footer>
          <span>{metric.source_label}</span>
          <span>{metric.scope === "institution" ? "Institution-wide" : "Selected campus"}</span>
          {metric.evidence_dimensions.map((dimension) => <span key={dimension}>{evidenceLabel[dimension]}</span>)}
          {sourceTime ? <span>{sourceTime}</span> : null}
          {metric.target_path ? <Link to={metric.target_path} aria-label={`Open source for ${metric.label}`}>Open source <ArrowUpRight size={14} /></Link> : null}
        </footer>
      </article>})}
  </div>;
}
