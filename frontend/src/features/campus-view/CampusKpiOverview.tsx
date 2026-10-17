import { ArrowUpRight, CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { CampusKpiDonut, CampusKpiGateFlow, formatKpiValue } from "./CampusKpiCharts";
import type { CampusKpiAvailability, CampusKpiHeadline, CampusKpiMetric, CampusKpiResponse } from "./kpiApi";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function metricScope(metric: CampusKpiMetric) {
  return metric.scope === "institution" ? "Institution-wide" : "Selected campus";
}

function snapshotPeriod(data: CampusKpiResponse) {
  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: data.period.timezone,
  }).format(new Date(data.period.to));
  return `Today through ${time}`;
}

function headlineCoverage(availability: CampusKpiAvailability, metric?: CampusKpiMetric) {
  const labels: string[] = [];
  if (availability === "partial") labels.push("Partial evidence");
  if (availability === "unavailable") labels.push("Unavailable");
  if (metric && metric.unknown_count > 0) labels.push(`${metric.unknown_count} unknown`);
  return labels.join(" · ");
}

function secondaryValue(value: number | null, availability: CampusKpiAvailability) {
  if (value !== null) return number.format(value);
  return availability === "unavailable" ? "Unavailable" : "Not enough evidence";
}

export function CampusKpiOverview({ data }: { data: CampusKpiResponse }) {
  const overview = data.overview;
  const headlineKeys = overview?.headline_keys ?? [];
  const headlines = headlineKeys.flatMap((key) => {
    const metric = data.metrics.find((item) => item.key === key);
    return metric ? [metric] : [];
  });
  const fallbackMetrics = headlines.length ? headlines : data.metrics.slice(0, 4);
  const visibleHeadlines: Array<{ headline: CampusKpiHeadline; metric?: CampusKpiMetric }> = overview?.headlines?.length
    ? overview.headlines.map((headline) => ({
      headline,
      metric: data.metrics.find((metric) => metric.key === headline.key),
    }))
    : fallbackMetrics.map((metric) => ({
      headline: {
        key: metric.key,
        label: metric.label,
        value: metric.value,
        unit: metric.unit,
        availability: metric.availability,
        value_context: metric.value_context ?? "selected_period",
      },
      metric,
    }));
  const gateEntries = data.metrics.find((metric) => metric.key === "access.gate_entries_recorded");
  const gateExits = data.metrics.find((metric) => metric.key === "access.gate_exits_recorded");
  const incompleteMeasures = data.metrics.filter((metric) => metric.availability !== "available" || metric.unknown_count > 0);
  const overviewEvidenceState = overview?.evidence_state
    ?? (incompleteMeasures.some((metric) => metric.availability === "unavailable") ? "unavailable"
      : incompleteMeasures.length ? "partial" : "available");

  if (!overview && !data.metrics.length) return <div className="campus-kpi-state">
    <CircleAlert size={25} aria-hidden="true" />
    <strong>No campus KPIs are available yet</strong>
    <p>Values will appear when configured campus operations produce enough source records.</p>
  </div>;

  return <div className="campus-kpi-overview">
    {visibleHeadlines.length ? <section aria-labelledby="campus-kpi-snapshot-title">
      <div className="campus-kpi-section-heading"><div><span>{snapshotPeriod(data)}</span><h3 id="campus-kpi-snapshot-title">Campus snapshot</h3></div><small>{data.scope.campus_label}</small></div>
      <ul className="campus-kpi-headlines">{visibleHeadlines.map(({ headline, metric }) => {
        const coverage = headlineCoverage(headline.availability, metric);
        return <li key={headline.key} className={`is-${headline.availability}`}>
          <span>{headline.label}</span>
          <strong>{formatKpiValue(headline.value, headline.unit)}</strong>
          <small>{metric && metric.numerator !== null && metric.denominator !== null
            ? `${metric.numerator} of ${metric.denominator} · `
            : ""}{metric ? metricScope(metric) : data.scope.campus_id ? "Selected campus" : "Institution-wide"}</small>
          {coverage ? <small className="campus-kpi-headline__coverage">{coverage}</small> : null}
          {headline.secondary ? <div className={`campus-kpi-headline__secondary is-${headline.secondary.availability}`}>
            <span>{headline.secondary.label}</span>
            <strong>{secondaryValue(headline.secondary.value, headline.secondary.availability)}</strong>
          </div> : null}
        </li>;
      })}</ul>
    </section> : null}

    {overview?.composition ? <section aria-labelledby="campus-kpi-composition-title">
      <div className="campus-kpi-section-heading"><div><span>Evidence mix</span><h3 id="campus-kpi-composition-title">{overview.composition.label}</h3></div></div>
      <CampusKpiDonut label={overview.composition.label} unit={overview.composition.unit} slices={overview.composition.slices} />
    </section> : null}

    {gateEntries && gateExits ? <section aria-labelledby="campus-kpi-flow-title">
      <div className="campus-kpi-section-heading"><div><span>15-minute pulse</span><h3 id="campus-kpi-flow-title">Recorded gate flow</h3></div><small>Accepted evidence</small></div>
      <CampusKpiGateFlow entries={gateEntries} exits={gateExits} bucket={data.bucket} timezone={data.period.timezone} />
    </section> : null}

    <section aria-labelledby="campus-kpi-bottlenecks-title">
      <div className="campus-kpi-section-heading"><div><span>Needs attention</span><h3 id="campus-kpi-bottlenecks-title">Operational bottlenecks</h3></div><small>{overview?.bottlenecks.length ?? 0} current</small></div>
      {overview?.bottlenecks.length ? <div className="campus-kpi-table-wrap"><table className="campus-kpi-bottlenecks">
        <caption>Current source-backed campus bottlenecks</caption>
        <thead><tr><th scope="col">Bottleneck</th><th scope="col">State</th><th scope="col">Count</th></tr></thead>
        <tbody>{overview.bottlenecks.map((item) => <tr key={item.id} className={`is-${item.severity}`}>
          <th scope="row"><span>{item.label}</span><small>{item.detail}</small><em>{item.source_label} · {item.scope === "institution" ? "Institution-wide" : "Selected campus"}</em></th>
          <td><span className={`campus-kpi-bottleneck-state is-${item.severity}`}>{item.severity === "important" ? "Important" : "Review"}</span><small>{item.evidence_dimension}</small></td>
          <td><strong>{item.count}</strong>{item.target_path ? <Link to={item.target_path} aria-label={`Open ${item.label}`}><ArrowUpRight size={16} /></Link> : null}</td>
        </tr>)}</tbody>
      </table></div> : <div className={`campus-kpi-calm-state${overviewEvidenceState !== "available" ? " is-incomplete" : ""}`}>
        <strong>No bottlenecks recorded</strong>
        <p>Available records do not currently identify an actionable bottleneck. This is not an all-clear when evidence is missing or partial.</p>
        {overviewEvidenceState !== "available" ? <small>{incompleteMeasures.length
          ? `${incompleteMeasures.length} of ${data.metrics.length} snapshot measures have incomplete coverage.`
          : `Bottleneck source coverage is ${overviewEvidenceState}.`}</small> : null}
      </div>}
    </section>
  </div>;
}
