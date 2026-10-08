import { Link } from "react-router-dom";
import { ComparisonBars, DonutChart } from "../analytics/AnalyticsCharts";
import type { PrincipalInsights } from "./api";
import { money, shortDate } from "./InsightCharts";

export function TeachingInsights({ data }: { data: PrincipalInsights }) {
  const planned = data.schedule.reduce((sum, item) => sum + item.planned, 0);
  const gaps = data.schedule.reduce((sum, item) => sum + item.unassigned, 0);
  return <div className="analytics-sections">
    <section className="analytics-panel"><header><h2>Teaching coverage</h2><span className="analytics-unit">Next 7 days</span></header>
      <DonutChart label="Scheduled teaching coverage" unit="periods" slices={[
        { id: "assigned", label: "Assigned", value: planned - gaps, tone: "positive" },
        { id: "unassigned", label: "Unassigned", value: gaps, tone: "warning" },
      ]} />
      <ComparisonBars label="Daily teaching coverage" rows={data.schedule.map(day => ({ id: day.date, name: shortDate(day.date), value: day.planned ? (day.planned - day.unassigned) / day.planned * 100 : null, detail: `${day.planned - day.unassigned} / ${day.planned} periods assigned`, tone: day.unassigned ? "warning" : "positive" }))} />
      <p className="analytics-note">{data.schedule.reduce((sum, item) => sum + item.cancelled, 0)} cancelled periods excluded. Assigned does not mean taught; unaccepted cover remains unassigned.</p>
      <Link className="analytics-module-link" to="/principal/timetable">Review timetable</Link>
    </section>
    <section className="analytics-panel" id="principal-deadlines"><header><h2>Overlapping deadlines</h2></header>
      <p className="analytics-support">Class-days with 3 or more homework or assessment deadlines in the next 7 days.</p>
      <ul className="insight-records">{data.deadlines.map(item => <li key={`${item.class_id}:${item.date}`}>
        <div><strong>{item.class_name}</strong><strong>{item.total} due</strong></div>
        <p>{shortDate(item.date)} · {item.homework} homework, {item.assessments} assessments</p>
      </li>)}</ul>
      {!data.deadlines.length ? <p className="analytics-empty">No overlapping deadlines meet this rule.</p> : null}
      <p className="analytics-note">Timing conflicts, not estimated hours or assignment difficulty.</p>
    </section>
  </div>;
}

export function FeeInsights({ data }: { data: PrincipalInsights }) {
  const due = data.fees.reduce((sum, band) => sum + band.due_paise, 0);
  const paid = data.fees.reduce((sum, band) => sum + band.paid_paise, 0);
  const balance = data.fees.reduce((sum, band) => sum + band.balance_paise, 0);
  const order = ["Due today", "1–30 days", "31–60 days", "61–90 days", "91+ days"];
  return <section className="analytics-panel">
    <header><h2>Outstanding fees</h2></header>
    <div className="analytics-stat"><strong>{money(balance)}</strong></div>
    <p className="analytics-support">{money(paid)} allocated against {money(due)} net fees due.</p>
    {data.fees.length ? <ComparisonBars label="Outstanding balance by age" unit="count" formatValue={money} rows={[...data.fees].sort((a,b) => order.indexOf(a.band) - order.indexOf(b.band)).map(band => ({ id: band.band, name: band.band, value: band.balance_paise, detail: `${money(band.paid_paise)} allocated against ${money(band.due_paise)} due` }))} /> : <p className="analytics-empty">No fee invoices are due.</p>}
    <p className="analytics-note">As of {shortDate(data.operational_date)}. Credits, allocated payments and refunds are included; future instalments are excluded. Amounts due today are not overdue.</p>
    <Link className="analytics-module-link" to="/principal/fees">Open fee ledger</Link>
  </section>;
}
