import { useId, useState } from "react";
import type { CampusKpiMetric, CampusKpiSeriesPoint, CampusKpiUnit, CampusKpiResponse } from "./kpiApi";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function formatKpiValue(value: number | null, unit: CampusKpiUnit) {
  if (value === null) return "Not enough evidence";
  const formatted = number.format(value);
  if (unit === "percent") return `${formatted}%`;
  if (unit === "minutes") return `${formatted} min`;
  return formatted;
}

function pointLabel(point: CampusKpiSeriesPoint, bucket: CampusKpiResponse["bucket"], timezone: string) {
  const options: Intl.DateTimeFormatOptions = bucket.kind === "day"
    ? { day: "numeric", month: "short", timeZone: timezone }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone };
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(point.bucket_start));
}

function axisPointLabel(point: CampusKpiSeriesPoint, bucket: CampusKpiResponse["bucket"], timezone: string) {
  const options: Intl.DateTimeFormatOptions = bucket.kind === "day"
    ? { day: "numeric", month: "short", timeZone: timezone }
    : bucket.kind === "hour"
      ? { day: "numeric", month: "short", hour: "numeric", timeZone: timezone }
      : { hour: "numeric", minute: "2-digit", timeZone: timezone };
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(point.bucket_start));
}

function sparseTickIndexes(length: number, maximum = 4) {
  if (length <= 0) return [];
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  return [...new Set(Array.from({ length: maximum }, (_, index) => Math.round(index * (length - 1) / (maximum - 1))))];
}

export function CampusKpiDonut({ label, unit, slices }: { label: string; unit: string; slices: NonNullable<CampusKpiResponse["overview"]>["composition"]["slices"] }) {
  const captionId = useId();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const circumference = 2 * Math.PI * 52;
  const segments = slices.map((slice, index) => {
    const start = slices.slice(0, index).reduce((sum, precedingSlice) => sum + precedingSlice.value, 0);
    return {
      ...slice,
      length: total ? slice.value / total * circumference : 0,
      offset: total ? start / total * circumference : 0,
    };
  });

  if (!total) return <p className="campus-kpi-empty">No current records for this breakdown.</p>;

  return <figure className="campus-kpi-donut" aria-labelledby={captionId}>
    <figcaption id={captionId} className="campus-map-sr-only">
      {label}: {total} {unit}. {slices.filter((slice) => slice.value > 0).map((slice) => `${slice.label}: ${slice.value}`).join("; ")}.
    </figcaption>
    <svg viewBox="0 0 144 144" aria-hidden="true">
      <circle cx="72" cy="72" r="52" className="campus-kpi-donut__track" />
      {segments.filter((slice) => slice.value > 0).map((slice) => <circle
        key={slice.key}
        cx="72"
        cy="72"
        r="52"
        className={`campus-kpi-donut__slice is-${slice.tone}`}
        strokeDasharray={`${slice.length} ${circumference - slice.length}`}
        strokeDashoffset={-slice.offset}
        transform="rotate(-90 72 72)"
      />)}
      <text x="72" y="70" textAnchor="middle" className="campus-kpi-donut__value">{number.format(total)}</text>
      <text x="72" y="88" textAnchor="middle" className="campus-kpi-donut__unit">{unit}</text>
    </svg>
    <ul aria-label={`${label} values`}>{slices.map((slice) => <li key={slice.key}>
      <i className={`is-${slice.tone}`} aria-hidden="true" />
      <span>{slice.label}</span>
      <strong>{number.format(slice.value)}</strong>
    </li>)}</ul>
  </figure>;
}

export function CampusKpiGateFlow({ entries, exits, bucket, timezone }: {
  entries: CampusKpiMetric;
  exits: CampusKpiMetric;
  bucket: CampusKpiResponse["bucket"];
  timezone: string;
}) {
  const captionId = useId();
  const exitByBucket = new Map(exits.series.map((point) => [point.bucket_start, point]));
  const points = entries.series.slice(-16).map((entry) => ({ entry, exit: exitByBucket.get(entry.bucket_start) }));
  const values = points.flatMap(({ entry, exit }) => [entry.value, exit?.value ?? null]).filter((value): value is number => value !== null);
  if (!values.length) return <p className="campus-kpi-empty">No accepted gate records in this period.</p>;
  const maximum = Math.max(1, ...values);
  const plotTop = 10;
  const plotBottom = 78;
  const groupWidth = 286 / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(7, groupWidth * .31));
  const barHeight = (value: number | null | undefined) => value === null || value === undefined ? 0 : value / maximum * (plotBottom - plotTop);
  const totalEntries = points.reduce((sum, point) => sum + (point.entry.value ?? 0), 0);
  const totalExits = points.reduce((sum, point) => sum + (point.exit?.value ?? 0), 0);
  const first = points[0]?.entry;
  const last = points.at(-1)?.entry;

  return <figure className="campus-kpi-gate-flow" aria-labelledby={captionId}>
    <figcaption id={captionId} className="campus-map-sr-only">
      Accepted gate records across the latest {points.length} {bucket.label.toLowerCase()} intervals: {totalEntries} entries and {totalExits} exits. These are point observations, not a current-presence count.
    </figcaption>
    <svg viewBox="0 0 320 104" aria-hidden="true">
      <line x1="24" x2="310" y1={plotBottom} y2={plotBottom} />
      {points.map(({ entry, exit }, index) => {
        const center = 24 + groupWidth * index + groupWidth / 2;
        const entryHeight = barHeight(entry.value);
        const exitHeight = barHeight(exit?.value);
        return <g key={entry.bucket_start}>
          <rect className="is-entry" x={center - barWidth - 1} y={plotBottom - entryHeight} width={barWidth} height={entryHeight} rx="2" />
          <rect className="is-exit" x={center + 1} y={plotBottom - exitHeight} width={barWidth} height={exitHeight} rx="2" />
        </g>;
      })}
      {first ? <text x="24" y="98">{pointLabel(first, bucket, timezone)}</text> : null}
      {last ? <text x="310" y="98" textAnchor="end">{pointLabel(last, bucket, timezone)}</text> : null}
    </svg>
    <ul aria-label="Accepted gate record totals"><li><i className="is-entry" /><span>Entries</span><strong>{number.format(totalEntries)}</strong></li><li><i className="is-exit" /><span>Exits</span><strong>{number.format(totalExits)}</strong></li></ul>
    <p>Accepted boundary observations · not current presence</p>
  </figure>;
}

function seriesPaths(points: CampusKpiSeriesPoint[], maximum: number) {
  const x = (index: number) => points.length < 2 ? 160 : 18 + index * 284 / (points.length - 1);
  const y = (value: number) => 70 - Math.max(0, Math.min(maximum, value)) / maximum * 54;
  const segments: string[] = [];
  let current = "";
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? " L" : "M"}${x(index)},${y(point.value)}`;
  });
  if (current) segments.push(current);
  return { segments, x, y };
}

export function CampusKpiTimeSeries({ metric, bucket, timezone }: {
  metric: CampusKpiMetric;
  bucket: CampusKpiResponse["bucket"];
  timezone: string;
}) {
  const captionId = useId();
  const [showData, setShowData] = useState(false);
  const values = metric.series.flatMap((point) => point.value === null ? [] : [point.value]);
  const maximum = metric.unit === "percent" ? 100 : Math.max(1, ...values);
  const { segments, x, y } = seriesPaths(metric.series, maximum);
  const missing = metric.series.length - values.length;
  const xTicks = sparseTickIndexes(metric.series.length);
  const showPointMarkers = metric.series.length <= 48;
  const includeUnknownColumn = metric.unknown_count > 0 || metric.series.some((point) => point.unknown_count > 0);
  const firstPoint = metric.series[0];
  const lastPoint = metric.series.at(-1);
  const period = firstPoint && lastPoint
    ? ` from ${pointLabel(firstPoint, bucket, timezone)} through ${pointLabel(lastPoint, bucket, timezone)}`
    : "";
  const summary = values.length
    ? `${metric.label} across ${values.length} recorded ${bucket.label.toLowerCase()} intervals${period}${missing ? `, with ${missing} intervals lacking enough evidence` : ""}.`
    : `No recorded values for ${metric.label} in this range.`;

  return <div className="campus-kpi-series">
    <figure aria-labelledby={captionId}>
      <figcaption id={captionId} className="campus-map-sr-only">{summary}</figcaption>
      {values.length ? <svg viewBox="0 0 320 104" aria-hidden="true">
        {[0, maximum / 2, maximum].map((tick) => <g key={tick}>
          <line x1="18" x2="302" y1={y(tick)} y2={y(tick)} />
          <text x="14" y={y(tick) + 3} textAnchor="end">{number.format(tick)}{metric.unit === "percent" ? "%" : ""}</text>
        </g>)}
        {segments.map((path, index) => <path key={index} d={path} />)}
        {showPointMarkers ? metric.series.map((point, index) => point.value === null ? null : <circle className="campus-kpi-series__point" key={point.bucket_start} cx={x(index)} cy={y(point.value)} r="2.5" />) : null}
        {xTicks.map((index, position) => {
          const point = metric.series[index];
          if (!point) return null;
          const textAnchor = position === 0 ? "start" : position === xTicks.length - 1 ? "end" : "middle";
          return <text className="campus-kpi-series__x-tick" key={point.bucket_start} x={x(index)} y="96" textAnchor={textAnchor}>{axisPointLabel(point, bucket, timezone)}</text>;
        })}
      </svg> : <p className="campus-kpi-empty">No recorded values for this range.</p>}
    </figure>
    {metric.series.length ? <details onToggle={(event) => setShowData(event.currentTarget.open)}>
      <summary>View time-series data</summary>
      {showData ? <div className="campus-kpi-table-wrap"><table>
        <caption>{metric.label} by {bucket.label.toLowerCase()} interval</caption>
        <thead><tr><th scope="col">Interval</th><th scope="col">Value</th><th scope="col">Basis</th>{includeUnknownColumn ? <th scope="col">Unknown</th> : null}</tr></thead>
        <tbody>{metric.series.map((point) => <tr key={`${point.bucket_start}:${point.bucket_end}`}>
          <th scope="row">{pointLabel(point, bucket, timezone)}</th>
          <td>{formatKpiValue(point.value, metric.unit)}</td>
          <td>{point.numerator !== null && point.denominator !== null ? `${number.format(point.numerator)} / ${number.format(point.denominator)}` : "—"}</td>
          {includeUnknownColumn ? <td>{number.format(point.unknown_count)}</td> : null}
        </tr>)}</tbody>
      </table></div> : null}
    </details> : null}
  </div>;
}
