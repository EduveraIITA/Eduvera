import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Portal } from "../auth/AuthContext";
import type { AnalyticsOverview } from "./api";
import { AssessmentProgress, AttendanceTrend, ComparisonBars, numberLabel, percentageLabel } from "./AnalyticsCharts";
import { RegisterSummary } from "./InstitutionAnalytics";
import { insightPath } from "./InsightNavigation";

export function AnalyticsSummary({ data, portal, search }: { data: AnalyticsOverview; portal: Portal; search: string }) {
  const family = portal === "parent" || portal === "student";
  const attendance = data.attendance, results = data.assessments;
  const scored = results?.subjects.reduce((sum, subject) => sum + subject.scored, 0) ?? 0;
  const pending = results?.pipeline.filter(stage => stage.status === "submitted" || stage.status === "moderated").reduce((sum, stage) => sum + stage.count, 0) ?? 0;
  const path = (topic: string) => insightPath(portal, topic, search);
  return <div className="analytics-summary">
    {attendance ? <Link to={path("attendance")} className="analytics-panel analytics-summary-card analytics-summary-card--attendance" aria-label="Explore attendance">
      <header><h2>Attendance</h2><ChevronRight size={18} aria-hidden="true" /></header>
      <div className="analytics-stat"><strong>{percentageLabel(attendance.percentage)}</strong><span className="analytics-unit">recorded attendance</span></div>
      <AttendanceTrend attendance={attendance} monthly={data.range.period === "term"} compact />
      <p className="analytics-note">{numberLabel(attendance.attended)} of {numberLabel(attendance.denominator)} {family ? "days" : "student-days"} attended</p>
    </Link> : null}
    {portal === "principal" && data.registers ? <RegisterSummary data={data.registers} to={path("registers")} /> : null}
    {results ? <Link to={path("results")} className="analytics-panel analytics-summary-card" aria-label="Explore results">
      <header><h2>Results</h2><ChevronRight size={18} aria-hidden="true" /></header>
      <div className="analytics-stat"><strong>{percentageLabel(results.overall.average)}</strong><span className="analytics-unit">{family ? "Personal average" : data.selected_class_id ? "Class average" : portal === "principal" ? "Institution average" : "Assigned-work average"}</span></div>
      <p className="analytics-support">{numberLabel(scored)} scored results</p>
      {results.subjects.length ? <ComparisonBars label="Subject score preview" rows={results.subjects.slice(0, 3).map(subject => ({ id: subject.id, name: subject.name, value: subject.average, detail: "" }))} /> : <p className="analytics-empty">No published scores in this period.</p>}
      <p className="analytics-note">{results.subjects.length > 3 ? `${results.subjects.length} subjects · ` : ""}Averages, not term grades</p>
    </Link> : null}
    {!family && results ? <Link to={path("progress")} className="analytics-panel analytics-summary-card analytics-summary-card--progress" aria-label="Explore assessment progress">
      <header><h2>Assessment progress</h2><ChevronRight size={18} aria-hidden="true" /></header>
      <AssessmentProgress pipeline={results.pipeline} compact />
      {pending ? <p className="analytics-note analytics-warning">{pending} awaiting review or publication</p> : null}
    </Link> : null}
    {!attendance && !results ? <p className="analytics-empty">There is no attendance or assessment access in your current assignments.</p> : null}
  </div>;
}
