import { Link } from "react-router-dom";
import { ComparisonBars, DonutChart } from "../analytics/AnalyticsCharts";
import type { PrincipalInsights } from "./api";
import { shortDate } from "./InsightCharts";

export function FollowupInsights({ data }: { data: PrincipalInsights }) {
  return <div className="analytics-sections">
    <section className="analytics-panel analytics-panel--wide"><header><h2>Open follow-ups</h2>{data.followups.overdue ? <span className="analytics-warning">{data.followups.overdue} overdue</span> : null}</header>
      <DonutChart label="Current follow-up status" unit="open follow-ups" slices={[
        { id: "awaiting", label: "Awaiting family reply", value: data.followups.awaiting, tone: "brand" },
        { id: "review", label: "School review", value: data.followups.review, tone: "warning" },
      ]} />
      <p className="analytics-note">{data.followups.resolved} resolved between {shortDate(data.period.start)} and {shortDate(data.period.end)}. Counts follow-ups, not unique students; resolution does not establish improved attendance.</p>
      <p className="analytics-note">{data.followups.details.length} shown of {data.followups.awaiting + data.followups.review} open follow-ups.</p>
      <ul className="insight-records">{data.followups.details.map(item => <li key={item.id}>
        <div><strong>{item.student_name}</strong>{item.overdue ? <span className="analytics-warning">Overdue</span> : null}</div>
        <p>{item.state === "in_review" ? "School review" : "Awaiting reply"} · Owner: {item.owner}</p>
        <Link className="analytics-module-link" to={`/principal/attendance?class_section_id=${item.class_id}&date=${item.attendance_date}`}>Open source register</Link>
      </li>)}</ul>
      <Link className="analytics-module-link" to="/principal#attendance-followups">Open follow-up conversations</Link>
    </section>
  </div>;
}

export function LearningReview({ data }: { data: PrincipalInsights }) {
  const assessments = data.learning.filter(item => item.assessed > 0);
  return <section className="analytics-panel">
    <header><h2>Results to review</h2></header>
    <div className="analytics-stat"><strong>{assessments.reduce((sum, item) => sum + item.below, 0)}</strong><span>scored results below {data.threshold}%</span></div>
    <p className="analytics-support">Latest result releases published in this review window.</p>
    {assessments.length ? <ComparisonBars label="Results below the review threshold" rows={assessments.map(item => ({ id: item.id, name: `${item.class_name} · ${item.subject}`, value: item.below / item.assessed * 100, detail: `${item.below} of ${item.assessed} scored results below ${data.threshold}% · ${item.title}`, tone: "warning" }))} /> : <p className="analytics-empty">No scored, published assessments in this window.</p>}
    <p className="analytics-note">Review threshold, not a pass/fail policy or topic mastery. A learner may appear in several assessments. Unlike the results average, this window uses publication dates, not assessment dates.</p>
    <details className="analytics-details"><summary>Assessment participation</summary><ul className="insight-records">{data.learning.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.class_name} · {item.assessed} of {item.roster} scored</p><p>Published {shortDate(item.published_at)}</p></li>)}</ul></details>
    <Link className="analytics-module-link" to="/principal/assessments">Open assessments</Link>
  </section>;
}
