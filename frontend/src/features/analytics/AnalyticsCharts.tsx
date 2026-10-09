import { useId } from "react";
import type { AnalyticsOverview, AttendanceMetric } from "./api";

export const numberLabel = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
export const percentageLabel = (value: number | null) => value === null ? "—" : `${numberLabel(value)}%`;
export function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function AttendanceTrend({ attendance, monthly, minimum, compact = false }: {
  attendance: {trend:Array<{date:string;end:string;percentage:number|null}>}; monthly: boolean; minimum?: number; compact?: boolean;
}) {
  const id = useId(), points = attendance.trend;
  const x = (index: number) => points.length === 1 ? 176 : 32 + index * 288 / (points.length - 1);
  const bottom = compact ? 78 : 146, top = compact ? 14 : 24;
  const y = (percentage: number) => bottom - Math.max(0, Math.min(100, percentage)) * (bottom - top) / 100;
  const dateLabel = (date: string) => monthly
    ? new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
    : shortDate(date);
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.percentage === null) { if (current.length) segments.push(current.join(" ")); current = []; }
    else current.push(`${current.length ? "L" : "M"}${x(index)},${y(point.percentage)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const first = points.find(point => point.percentage !== null), last = [...points].reverse().find(point => point.percentage !== null);
  const caption = first && last
    ? `${monthly ? "Monthly" : "Weekly"} attendance: ${percentageLabel(first.percentage)} for ${shortDate(first.date)}–${shortDate(first.end)}; ${percentageLabel(last.percentage)} for ${shortDate(last.date)}–${shortDate(last.end)}. Missing periods are gaps, not zero.`
    : "No attendance records in this period.";
  return <figure className={`analytics-trend${compact ? " analytics-trend--compact" : ""}`} aria-labelledby={id}>
    <figcaption id={id} className="analytics-sr-only">{caption}</figcaption>
    {first ? <svg viewBox={`0 0 344 ${compact ? 108 : 184}`} aria-hidden="true" className="analytics-trend__plot">
      {(compact ? [0, 100] : [0, 50, 100]).map(tick => <g key={tick}><line x1="32" x2="320" y1={y(tick)} y2={y(tick)} className="analytics-gridline" /><text x="26" y={y(tick) + 4} textAnchor="end" className="analytics-axis">{tick}{tick === 100 ? "%" : ""}</text></g>)}
      {minimum !== undefined && minimum > 0 ? <line x1="32" x2="320" y1={y(minimum)} y2={y(minimum)} className="analytics-minimum" /> : null}
      {segments.map((path, index) => <path key={index} d={path} className="analytics-trend__line" />)}
      {points.map((point, index) => <g key={point.date}>
        {point.percentage !== null ? <circle cx={x(index)} cy={y(point.percentage)} r="3.5" className="analytics-trend__point" /> : null}
        {(index === 0 || index === points.length - 1 || points.length <= 5 || index % Math.ceil(points.length / 4) === 0) ? <text x={x(index)} y={compact ? 101 : 171} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="analytics-axis">{dateLabel(point.date)}</text> : null}
      </g>)}
    </svg> : <p className="analytics-empty">No recorded attendance for this period.</p>}
    {first && !compact ? <div className="analytics-legend"><span><i className="analytics-legend__line" />{monthly ? "Monthly attendance" : "Weekly attendance"}</span>{minimum !== undefined && minimum > 0 ? <span><i className="analytics-legend__minimum" />Minimum {numberLabel(minimum)}%</span> : null}</div> : null}
  </figure>;
}

export function AttendanceData({ attendance }: { attendance: NonNullable<AnalyticsOverview["attendance"]> }) {
  return <div className="analytics-table-wrap"><table><caption>Attendance trend data</caption><thead><tr><th scope="col">Period</th><th scope="col">Attended / counted</th><th scope="col">Attendance</th></tr></thead><tbody>{attendance.trend.map(point => <tr key={point.date}><th scope="row">{shortDate(point.date)}–{shortDate(point.end)}</th><td>{numberLabel(point.attended)} / {point.denominator}</td><td>{percentageLabel(point.percentage)}</td></tr>)}</tbody></table></div>;
}

type DonutSlice = { id: string; label: string; value: number; tone: string };
export function DonutChart({ slices, label, unit }: { slices: DonutSlice[]; label: string; unit: string }) {
  const id = useId(), total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const circumference = 2 * Math.PI * 64;
  const segments = slices.map((slice, index) => {
    const length = total ? slice.value / total * circumference : 0;
    const offset = total ? slices.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / total * circumference : 0;
    return { ...slice, offset, length };
  });
  if (!total) return <p className="analytics-empty">No records for this breakdown.</p>;
  return <figure className="analytics-donut" aria-labelledby={id}>
    <figcaption id={id} className="analytics-sr-only">{label}: {total} {unit}. {slices.filter(slice => slice.value > 0).map(slice => `${slice.label}: ${slice.value}`).join("; ")}.</figcaption>
    <svg className="analytics-donut__plot" viewBox="0 0 176 176" aria-hidden="true">
      <circle cx="88" cy="88" r="64" className="analytics-donut__track" />
      {segments.filter(slice => slice.value > 0).map(slice => <circle key={slice.id} cx="88" cy="88" r="64" className={`analytics-donut__segment analytics-color--${slice.tone}`}
        strokeDasharray={`${slice.length} ${circumference - slice.length}`} strokeDashoffset={-slice.offset} transform="rotate(-90 88 88)" />)}
      <text x="88" y="88" textAnchor="middle" className="analytics-donut__total">{numberLabel(total)}</text>
      <text x="88" y="108" textAnchor="middle" className="analytics-donut__unit">{unit}</text>
    </svg>
    <ul className="analytics-donut__legend" aria-label={`${label} values`}>{slices.filter(slice => slice.value > 0).map(slice => <li key={slice.id}>
      <span className={`analytics-donut__swatch analytics-color--${slice.tone}`} aria-hidden="true" /><span>{slice.label}</span><strong>{numberLabel(slice.value)}</strong>
    </li>)}</ul>
  </figure>;
}

export function AttendanceBreakdown({ attendance, family }: { attendance: AttendanceMetric; family: boolean }) {
  return <DonutChart label="Recorded attendance breakdown" unit={family ? "days recorded" : "student-days"} slices={[
    { id: "present", label: "Present", value: attendance.present, tone: "positive" },
    { id: "late", label: "Late", value: attendance.late, tone: "brand" },
    { id: "half-day", label: "Half day", value: attendance.half_day, tone: "warning" },
    { id: "absent", label: "Absent", value: attendance.absent, tone: "danger" },
    { id: "excused", label: "Excused", value: attendance.excused, tone: "muted" },
  ]} />;
}

export function AssessmentProgress({ pipeline, compact = false }: { pipeline: NonNullable<AnalyticsOverview["assessments"]>["pipeline"]; compact?: boolean }) {
  const stages = compact ? [
    { id: "published", label: "Published", tone: "positive", statuses: ["published"] },
    { id: "open", label: "In progress", tone: "brand", statuses: ["draft", "scheduled", "marking", "submitted", "moderated"] },
    { id: "cancelled", label: "Cancelled", tone: "muted", statuses: ["cancelled"] },
  ] : [
    { id: "draft", label: "Draft", tone: "muted", statuses: ["draft"] },
    { id: "scheduled", label: "Scheduled", tone: "brand-soft", statuses: ["scheduled"] },
    { id: "marking", label: "Being marked", tone: "brand", statuses: ["marking"] },
    { id: "submitted", label: "Awaiting review", tone: "warning", statuses: ["submitted"] },
    { id: "moderated", label: "Ready to publish", tone: "warning-soft", statuses: ["moderated"] },
    { id: "published", label: "Published", tone: "positive", statuses: ["published"] },
    { id: "cancelled", label: "Cancelled", tone: "muted", statuses: ["cancelled"] },
  ];
  return <DonutChart label="Assessment stages" unit="assessments" slices={stages.map(stage => ({ ...stage,
    value: pipeline.filter(item => stage.statuses.includes(item.status)).reduce((sum, item) => sum + item.count, 0),
  }))} />;
}

export function ComparisonBars({ rows, label, unit = "percent", reference, formatValue }: {
  rows: Array<{ id: string; name: string; value: number | null; detail: string; tone?: "warning" | "positive" | "muted" }>;
  label: string; unit?: "percent" | "count"; reference?: number | null; formatValue?: (value: number) => string;
}) {
  const max = unit === "percent" ? 100 : Math.max(1, ...rows.map(row => row.value ?? 0));
  return <ul className="analytics-bars" aria-label={label}>{rows.map(row => <li key={row.id}>
    <div className="analytics-bars__label"><span>{row.name}</span><strong>{row.value !== null && formatValue ? formatValue(row.value) : unit === "percent" ? percentageLabel(row.value) : row.value === null ? "—" : numberLabel(row.value)}</strong></div>
    <div className={`analytics-bars__track${row.tone ? ` analytics-bars__track--${row.tone}` : ""}`} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, (row.value ?? 0) / max * 100))}%` }} />{reference !== null && reference !== undefined ? <i className="analytics-bars__reference" style={{ left: `${Math.max(0,Math.min(100,reference))}%` }} /> : null}</div>
    <small>{row.detail}</small>
  </li>)}</ul>;
}

export function ScoreDistribution({ counts }: { counts: number[] }) {
  const labels = ["<20", "20–<40", "40–<60", "60–<80", "80–100"];
  const maximum = Math.max(1, ...counts);
  if (!counts.some(value => value > 0)) return <p className="analytics-empty">No scored results in this period.</p>;
  return <figure className="analytics-distribution">
    <figcaption className="analytics-note">Scored results by percentage band</figcaption>
    <ul aria-label="Score distribution">{labels.map((label, index) => <li key={label} aria-label={`${label} percent: ${counts[index] ?? 0} results`}>
      <strong>{numberLabel(counts[index] ?? 0)}</strong>
      <div className="analytics-distribution__column" aria-hidden="true"><span style={{ height: `${(counts[index] ?? 0) / maximum * 100}%` }} /></div>
      <span className="analytics-distribution__label">{label}</span>
    </li>)}</ul>
  </figure>;
}
