import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { AttendanceTrend, numberLabel, percentageLabel, shortDate } from "../analytics/AnalyticsCharts";
import { money } from "../principal-insights/InsightCharts";
import type { usePrincipalHomeQueries } from "./usePrincipalHomeQueries";
import "../analytics/analytics.css";

export function PrincipalSchoolPulse({ queries }: { queries: ReturnType<typeof usePrincipalHomeQueries> }) {
  const { analytics, review, allowed } = queries;
  if (!allowed) return null;
  const academic = analytics.isError ? undefined : analytics.data;
  const operations = review.isError ? undefined : review.data;
  const attendance = academic?.attendance;
  const results = academic?.assessments;
  const planned = operations?.schedule.reduce((sum, day) => sum + day.planned, 0) ?? 0;
  const unassigned = operations?.schedule.reduce((sum, day) => sum + day.unassigned, 0) ?? 0;
  const assigned = Math.max(0, planned - unassigned);
  const due = operations?.fees.reduce((sum, band) => sum + band.due_paise, 0) ?? 0;
  const outstanding = operations?.fees.reduce((sum, band) => sum + band.balance_paise, 0) ?? 0;
  const overdue = operations?.fees.filter(band => band.band !== "Due today").reduce((sum, band) => sum + band.balance_paise, 0) ?? 0;
  return <section className="principal-home__section principal-home__pulse" aria-labelledby="principal-pulse-title">
    <header><h2 id="principal-pulse-title">School pulse</h2></header>
    {analytics.isPending ? <div className="principal-home__pulse-loading" role="status" aria-label="Loading school pulse"><i /><i /></div> : null}
    {analytics.isError ? <div className="principal-home__group principal-home__notice" role="alert"><span>Attendance trends and results couldn’t load.</span><button type="button" onClick={() => void analytics.refetch()}>Retry school pulse</button></div> : null}
    <div className="principal-home__pulse-grid">
      {attendance ? <Link className="principal-home__metric principal-home__metric--attendance" to="/principal/insights/attendance?period=term" aria-label="Explore term attendance">
        <header><h3>Recorded attendance</h3><ChevronRight size={16} aria-hidden="true" /></header>
        <div className="principal-home__metric-value"><strong>{attendance.percentage === null ? "Not recorded" : percentageLabel(attendance.percentage)}</strong><span>This term</span></div>
        <AttendanceTrend attendance={attendance} monthly compact />
        <p>{numberLabel(attendance.attended)} of {numberLabel(attendance.denominator)} recorded student-days attended</p>
        <small>Through {shortDate(academic.range.to)} · unrecorded days excluded</small>
      </Link> : academic ? <p className="principal-home__notice">Attendance trends are unavailable in this scope.</p> : null}
      {results ? <Link className="principal-home__metric" to="/principal/insights/results?period=term" aria-label="Explore published result averages">
        <header><h3>Published results</h3><ChevronRight size={16} aria-hidden="true" /></header>
        <div className="principal-home__metric-value"><strong>{results.overall.average === null ? "No scores" : percentageLabel(results.overall.average)}</strong></div>
        <p>{numberLabel(results.overall.scored)} scored results</p>
        <small>Term average · through {shortDate(academic.range.to)}</small>
      </Link> : academic ? <p className="principal-home__notice">Published results are unavailable in this scope.</p> : null}
      {operations ? <Link className="principal-home__metric" to="/principal/insights/operations" aria-label="Explore next seven days of teaching coverage">
        <header><h3>Teacher coverage</h3><ChevronRight size={16} aria-hidden="true" /></header>
        <div className="principal-home__metric-value"><strong>{planned ? percentageLabel(assigned / planned * 100) : "No periods"}</strong></div>
        <p>{assigned} of {planned} periods assigned</p>
        <small>7 days from {shortDate(operations.operational_date)}</small>
        {unassigned ? <span className="principal-home__metric-warning">{unassigned} still unassigned</span> : null}
      </Link> : null}
      {operations ? <Link className="principal-home__metric principal-home__metric--fees" to="/principal/insights/finance" aria-label="Explore outstanding fee balances">
        <header><h3>Fees outstanding</h3><ChevronRight size={16} aria-hidden="true" /></header>
        <div className="principal-home__metric-value"><strong>{money(outstanding)}</strong>{overdue > 0 ? <span className="principal-home__metric-warning">{money(overdue)} overdue</span> : null}</div>
        <small>{due > 0 ? `Of ${money(due)} due by ${shortDate(operations.operational_date)}` : `No fees due as of ${shortDate(operations.operational_date)}`} · future instalments excluded</small>
      </Link> : review.isPending ? <p className="principal-home__notice">Loading coverage and fees…</p> : review.isError ? <p className="principal-home__notice">Coverage and fee balances are unavailable.</p> : null}
    </div>
  </section>;
}
