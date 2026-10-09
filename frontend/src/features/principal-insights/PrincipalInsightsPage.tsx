import { useEffect, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { canonicalInsightSearch, insightPath } from "../analytics/InsightNavigation";
import { useInsightReview } from "./useInsightReview";
import { FollowupInsights, LearningReview } from "./InsightReviewDetails";
import { AttendanceChecks, AttendanceStudentReview, RecordingCompleteness } from "./AttendanceReview";
import { FeeInsights, TeachingInsights } from "./InsightOperationsDetails";
import { shortDate } from "./InsightCharts";
import "../analytics/analytics.css";
import "./unified-insights.css";

export type PrincipalInsightTopic = "review" | "recording" | "followups" | "learning-review" | "operations" | "finance";
const titles: Record<PrincipalInsightTopic, string> = {
  review: "Attendance review", recording: "Missing records", followups: "Family follow-ups", "learning-review": "Learning review", operations: "Coverage & deadlines", finance: "Fee balances",
};
export function PrincipalInsightsPage({ topic = "review" }: { topic?: PrincipalInsightTopic }) {
  const query = useInsightReview(), [params, setParams] = useSearchParams(), location = useLocation();
  const { studentId } = useParams<{ studentId: string }>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const review = topic === "review" || topic === "recording" || topic === "learning-review";
  const compactFilters = topic === "review" || topic === "recording";
  const search = canonicalInsightSearch(params.toString());
  const parentTopic = studentId || topic === "recording" ? "review" : params.get("via") === "attendance" || params.get("via") === "results" ? params.get("via")! : "";
  const backParams = new URLSearchParams(search);
  if (parentTopic !== "review") backParams.delete("via");
  const change = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(canonicalInsightSearch(previous.toString())); if (value) next.set(key, value); else next.delete(key); return next; });
  useEffect(() => { if (query.isSuccess && location.hash === "#principal-deadlines") document.getElementById("principal-deadlines")?.scrollIntoView?.({ block: "start" }); }, [query.isSuccess, location.hash]);
  return <OperationsShell portal="principal" active="insights" title={titles[topic]} backTo={insightPath("principal", parentTopic, backParams.toString())}>
    <div className="analytics-page">
      {topic === "operations" ? <Link className="analytics-refresh" to="/principal/teacher-feedback">Teacher feedback →</Link> : null}
      {!studentId ? <div className={`analytics-toolbar${compactFilters ? " insight-review-toolbar" : ""}`}>
        <label className="analytics-class-filter"><span className="analytics-sr-only">Class</span><select value={query.classId} onChange={event => change("class", event.target.value)}><option value="">All classes</option>{query.data?.classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}</select></label>
        {compactFilters ? <button className="analytics-refresh" type="button" aria-label="Review period" aria-expanded={filtersOpen} aria-controls="insight-review-filters" onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal size={18} aria-hidden="true" /></button> : null}
        <button className="analytics-refresh" type="button" aria-label="Refresh insights" disabled={query.isFetching || !query.allowed} onClick={() => void query.refetch()}><RefreshCw size={18} aria-hidden="true" /></button>
      </div> : null}
      {review && !studentId ? <div id="insight-review-filters" className="insight-review-filters" hidden={compactFilters && !filtersOpen}>
        <label>Review window<select value={query.days} onChange={event => change("insight_days", event.target.value)}><option value="14">Last 14 days</option><option value="28">Last 28 days</option><option value="56">Last 56 days</option></select></label>
        <label>Ending on<input type="date" value={query.date} max={schoolDateToday()} onChange={event => { if (event.target.value) change("date", event.target.value); }} /></label>
        {topic === "learning-review" ? <label>Review marks below<select value={query.threshold} onChange={event => change("insight_threshold", event.target.value)}>{[...new Set([40,50,60,query.threshold])].sort((a,b) => a-b).map(value => <option key={value} value={value}>{value}%</option>)}</select></label> : null}
      </div> : null}
      {!query.allowed ? <p role="alert">Institution administrator access is required.</p> : query.isPending ? <div className="insight-loading" role="status" aria-label="Loading insights"><span /><span /><span /></div>
        : query.isError ? <div className="analytics-error" role="alert"><p>These insights could not be loaded.</p><button type="button" onClick={() => void query.refetch()}>Try again</button>{query.classId ? <button type="button" onClick={() => change("class", "")}>Clear class filter</button> : null}</div>
          : query.data ? <>
            <div className="analytics-period-caption">{review ? `${shortDate(query.data.period.start)} to ${shortDate(query.data.period.end)}` : `As of ${shortDate(query.data.operational_date)}`}</div>
            {topic === "review" ? studentId ? <AttendanceStudentReview data={query.data} studentId={studentId} /> : <AttendanceChecks data={query.data} /> : topic === "recording" ? <RecordingCompleteness data={query.data} /> : topic === "followups" ? <FollowupInsights data={query.data} /> : topic === "learning-review" ? <LearningReview data={query.data} /> : topic === "operations" ? <TeachingInsights data={query.data} /> : <FeeInsights data={query.data} />}
            <p className="analytics-freshness">Updated {new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: query.data.timezone }).format(new Date(query.data.generated_at))}</p>
          </> : null}
    </div>
  </OperationsShell>;
}
