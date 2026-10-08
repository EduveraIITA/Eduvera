import { ChevronRight, CircleAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { canonicalInsightSearch, insightPath } from "../analytics/InsightNavigation";
import { numberLabel } from "../analytics/AnalyticsCharts";
import { money, shortDate } from "./InsightCharts";
import { useInsightReview } from "./useInsightReview";
import "./unified-insights.css";

export function InsightHighlights() {
  const query = useInsightReview(), [params] = useSearchParams();
  const path = (topic: string) => insightPath("principal", topic, canonicalInsightSearch(params.toString()));
  if (!query.allowed) return null;
  if (query.isPending) return <div className="insight-loading" role="status" aria-label="Loading attention summary"><span /><span /></div>;
  if (query.isError) return <div className="insight-inline-error" role="alert"><span>Attention summary unavailable.</span><button type="button" onClick={() => void query.refetch()}>Try again</button></div>;
  const data = query.data;
  if (!data) return null;
  const gaps = data.schedule.reduce((sum, day) => sum + day.unassigned, 0);
  return <section className="insight-highlights" aria-labelledby="insight-highlights-title">
    <header><h2 id="insight-highlights-title">For your attention</h2><span>As of {shortDate(data.operational_date)}</span></header>
    <div className="insight-highlight-rows">
      <Link to={path("review")}><CircleAlert size={19} aria-hidden="true" /><span><strong>{data.engagement.total ? `${numberLabel(data.engagement.total)} ${data.engagement.total === 1 ? "student" : "students"} to check in with` : "Attendance review"}</strong><small>{data.engagement.total ? `${data.engagement.without_followup} without an open follow-up` : "No declines meeting the review rules"} · {data.period.days}-day comparison to {shortDate(data.period.end)}</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
      {data.followups.overdue > 0 ? <Link to={path("followups")} className="insight-needs-attention"><CircleAlert size={19} aria-hidden="true" /><span><strong>{data.followups.overdue} overdue {data.followups.overdue === 1 ? "follow-up" : "follow-ups"}</strong><small>Review owners and next steps</small></span><ChevronRight size={17} aria-hidden="true" /></Link> : null}
      {gaps > 0 ? <Link to={path("operations")} className="insight-needs-attention"><CircleAlert size={19} aria-hidden="true" /><span><strong>{gaps} {gaps === 1 ? "period needs" : "periods need"} teacher coverage</strong><small>Next 7 days</small></span><ChevronRight size={17} aria-hidden="true" /></Link> : null}
    </div>
  </section>;
}

/** Same cached read model as the highlights; operational dates are explicit. */
export function OperationalSummaries() {
  const query = useInsightReview(), [params] = useSearchParams();
  const data = query.data;
  if (!query.allowed || query.isError || !data) return null;
  const path = (topic: string) => insightPath("principal", topic, canonicalInsightSearch(params.toString()));
  const planned = data.schedule.reduce((sum, day) => sum + day.planned, 0);
  const unassigned = data.schedule.reduce((sum, day) => sum + day.unassigned, 0);
  const balance = data.fees.reduce((sum, band) => sum + band.balance_paise, 0);
  const due = data.fees.reduce((sum, band) => sum + band.due_paise, 0);
  const paid = data.fees.reduce((sum, band) => sum + band.paid_paise, 0);
  return <section className="insight-current" aria-labelledby="insight-current-title">
    <header className="insight-section-heading"><h2 id="insight-current-title">School operations</h2><span>As of {shortDate(data.operational_date)}</span></header>
    <div className="analytics-summary">
      <Link className="analytics-panel analytics-summary-card" to={path("operations")} aria-label="Explore teaching coverage and deadlines">
        <header><h3>Teaching coverage</h3><ChevronRight size={18} aria-hidden="true" /></header>
        <div className="analytics-stat"><strong>{planned ? `${Math.round((planned - unassigned) / planned * 100)}%` : "—"}</strong><span>periods assigned</span></div>
        <div className="insight-coverage-week" aria-hidden="true">{data.schedule.map(day => <div key={day.date}><div><i style={{ height: `${day.planned ? (day.planned - day.unassigned) / day.planned * 100 : 0}%` }} /></div><span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span></div>)}</div>
        <p className="analytics-note">{planned - unassigned} of {planned} periods assigned · next 7 days</p>
        {data.deadlines.length ? <p className="analytics-note analytics-warning">{data.deadlines.length} class-days with overlapping deadlines</p> : null}
      </Link>
      <Link className="analytics-panel analytics-summary-card" to={path("finance")} aria-label="Explore fee balances">
        <header><h3>Fees due</h3><ChevronRight size={18} aria-hidden="true" /></header>
        <div className="analytics-stat"><strong>{money(balance)}</strong><span>outstanding</span></div>
        <p className="analytics-support">Against {money(due)} net fees due</p>
        {due > 0 ? <div className="analytics-register-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, paid / due * 100))}%` }} /></div> : null}
        <p className="analytics-note">{money(paid)} allocated · future instalments excluded</p>
      </Link>
    </div>
    <nav className="insight-topic-list" aria-label="More insights">
      <Link to={path("followups")}><span><strong>Family follow-ups</strong><small>{data.followups.awaiting + data.followups.review} open · {data.followups.overdue} overdue now</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
    </nav>
  </section>;
}
