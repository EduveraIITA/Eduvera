import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth, type Portal } from "../auth/AuthContext";
import { adaptStudentSummary } from "../school/adapters";
import { getAnalytics, type AnalyticsOverview, type AnalyticsPeriod } from "./api";
import { AssessmentProgress, AttendanceBreakdown, AttendanceData, AttendanceTrend, ComparisonBars, ScoreDistribution, numberLabel, percentageLabel, shortDate } from "./AnalyticsCharts";
import { AnalyticsSummary } from "./AnalyticsSummary";
import { InstitutionDetail, RegisterDetail } from "./InstitutionAnalytics";
import "./analytics.css";

function ModuleLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="analytics-module-link" to={to}>{children}<ArrowRight size={17} aria-hidden="true" /></Link>;
}

export type AnalyticsTopic = "attendance" | "results" | "progress" | "institution" | "registers";
type Comparison = "class" | "subject";
function ComparisonSwitch({ value, onChange }: { value: Comparison; onChange: (value: Comparison) => void }) {
  return <div className="analytics-comparison-switch" role="group" aria-label="Compare by">
    <button type="button" aria-pressed={value === "subject"} onClick={() => onChange("subject")}>By subject</button>
    <button type="button" aria-pressed={value === "class"} onClick={() => onChange("class")}>By class</button>
  </div>;
}
export function AnalyticsContent({ data, portal, topic = "attendance", comparison = "subject", onComparisonChange }: { data: AnalyticsOverview; portal: Portal; topic?: AnalyticsTopic; comparison?: Comparison; onComparisonChange?: (value: Comparison) => void }) {
  const family = portal === "parent" || portal === "student", attendance = data.attendance, results = data.assessments;
  const suffix = data.student ? `?student_id=${encodeURIComponent(data.student.id)}` : "";
  const attendanceSuffix = family ? suffix : `?${new URLSearchParams({ date: data.range.to, ...(data.selected_class_id ? { class_section_id: data.selected_class_id } : {}) })}`;
  const pendingReview = results?.pipeline.find(stage => stage.status === "submitted")?.count ?? 0;
  const scored = results?.subjects.reduce((n, subject) => n + subject.scored, 0) ?? 0;
  const other = results?.subjects.reduce((n, subject) => n + subject.other, 0) ?? 0;
  const below = attendance?.percentage !== null && attendance?.percentage !== undefined && attendance.percentage < data.term.attendance_threshold;
  const compareClass = !family && comparison === "class";
  const resultRows = (compareClass ? results?.classes : results?.subjects)?.map(subject => ({ id: subject.id, name: subject.name, value: subject.average,
    detail: `${subject.scored} scored ${subject.scored === 1 ? "result" : "results"}${subject.other ? ` · ${subject.other} without a score` : ""}` })) ?? [];
  const averageLabel = family ? "Personal average" : data.selected_class_id ? "Class average" : portal === "principal" ? "Institution average" : "Assigned-work average";
  return <>
    {!family && topic === "progress" && pendingReview > 0 ? <Link className="analytics-attention" to={`/${portal}/assessments?status=submitted`}><CircleAlert size={18} aria-hidden="true" /><span>{pendingReview} {pendingReview === 1 ? "assessment awaiting" : "assessments awaiting"} review</span><ArrowRight size={16} aria-hidden="true" /></Link> : null}
    {!attendance && !results ? <p className="analytics-empty">There is no attendance or assessment access in your current assignments.</p> : null}
    <div className="analytics-sections">
      {topic === "attendance" && attendance ? <section className="analytics-panel analytics-panel--trend" aria-labelledby="analytics-attendance-title">
        <header><h2 id="analytics-attendance-title">Recorded attendance</h2></header>
        <div className="analytics-stat"><strong>{percentageLabel(attendance.percentage)}</strong>{family && attendance.percentage !== null ? <span className={below ? "analytics-warning" : "analytics-positive"}>{below ? <CircleAlert size={15} aria-hidden="true" /> : null}{below ? "Below minimum" : "At or above minimum"}</span> : null}</div>
        <p className="analytics-support">{numberLabel(attendance.attended)} of {numberLabel(attendance.denominator)} {family ? "days" : "student-days"} attended</p>
        <AttendanceTrend attendance={attendance} monthly={data.range.period === "term"} minimum={family ? data.term.attendance_threshold : undefined} />
        <p className="analytics-note">Only recorded attendance counts. Missing records are not absences.</p>
        <details className="analytics-details"><summary>View chart data</summary><AttendanceData attendance={attendance} /></details>
        <ModuleLink to={`/${portal}/attendance${attendanceSuffix}`}>View attendance</ModuleLink>
      </section> : null}
      {topic === "attendance" && attendance ? <section className="analytics-panel" aria-labelledby="analytics-breakdown-title">
        <header><h2 id="analytics-breakdown-title">Recorded days</h2></header>
        <AttendanceBreakdown attendance={attendance} family={family} />
        <details className="analytics-details"><summary>How attendance is counted</summary>
          <p className="analytics-note">Late counts as present; half days count as ½. Excused records are excluded. {family ? "Overall attendance does not establish subject eligibility." : "A student-day is one student’s daily record, not one lesson."}</p>
        </details>
      </section> : null}
      {topic === "attendance" && attendance ? <section className="analytics-panel analytics-panel--wide" aria-labelledby="analytics-comparison-title">
        <header><h2 id="analytics-comparison-title">Attendance by {compareClass ? "class" : "subject"}</h2><span className="analytics-unit">0–100%</span></header>
        {!family && onComparisonChange ? <ComparisonSwitch value={comparison} onChange={onComparisonChange} /> : null}
        {compareClass ? <>{attendance.classes.length ? <ComparisonBars label="Class attendance comparison" rows={attendance.classes.map(cls => ({ id: cls.id, name: cls.name, value: cls.percentage,
          detail: cls.denominator ? `${numberLabel(cls.attended)} / ${numberLabel(cls.denominator)} student-days` : "No counted attendance" }))} /> : <p className="analytics-empty">No class attendance recorded within your current access.</p>}
          <p className="analytics-note">Daily attendance, not register completion.</p></> : <>
          {attendance.subjects.length ? <ComparisonBars label="Subject attendance comparison" rows={attendance.subjects.map(subject => ({ id: subject.id, name: subject.name, value: subject.percentage,
            detail: `${numberLabel(subject.attended)} / ${numberLabel(subject.counted)} ${family ? "lessons" : "student-lessons"}` }))} /> : <p className="analytics-empty">No subject attendance available for this period.</p>}
          <p className="analytics-note">Derived from recorded days and the effective timetable, not separately marked lesson attendance. Excused lessons are excluded.</p>
        </>}
      </section> : null}
      {topic === "results" && results ? <section className="analytics-panel analytics-panel--wide" aria-labelledby="analytics-results-title">
        <header><h2 id="analytics-results-title">Published results</h2><span className="analytics-unit">0–100%</span></header>
        <div className="analytics-stat"><strong>{percentageLabel(results.overall.average)}</strong><span className="analytics-unit">{averageLabel}</span></div>
        <p className="analytics-support">{scored ? `${numberLabel(scored)} scored ${scored === 1 ? "result" : "results"}${other ? ` · ${other} without a score` : ""}` : "No scored results in this period"}</p>
        {!family && onComparisonChange ? <ComparisonSwitch value={comparison} onChange={onComparisonChange} /> : null}
        {results.overall.average !== null ? <p className="analytics-benchmark"><i aria-hidden="true" />Marker: {averageLabel.toLowerCase()}</p> : null}
        {resultRows.length ? <ComparisonBars label={compareClass ? "Published class scores" : "Published subject scores"} rows={resultRows} reference={results.overall.average} /> : <p className="analytics-empty">Published assessment scores will appear here.</p>}
        <p className="analytics-note">Average marks as percentages · not an official term grade.</p>
        <p className="analytics-note">Subjects and classes may have different tests and sample sizes. These comparisons do not rank learners or teachers.</p>
        <details className="analytics-details"><summary>How scores are counted</summary><p className="analytics-note">Individual score percentages are equally weighted. Only the latest published results count, dated by when each assessment took place. Absent, exempt, withheld and unevaluated results are excluded, not treated as zero.</p></details>
        <ModuleLink to={`/${portal}/${family ? "results" : "assessments"}${suffix}`}>{family ? "View results & feedback" : "View assessments"}</ModuleLink>
      </section> : null}
      {topic === "results" && results && scored > 0 ? <section className="analytics-panel analytics-panel--wide" aria-labelledby="analytics-distribution-title">
        <header><h2 id="analytics-distribution-title">Behind the average</h2></header>
        <ScoreDistribution counts={results.overall.distribution} />
        <p className="analytics-note">Counts results, not unique students. These bands are not pass/fail rules.</p>
      </section> : null}
      {topic === "progress" && results && !family ? <section className="analytics-panel analytics-panel--wide" aria-labelledby="analytics-work-title">
        <header><h2 id="analytics-work-title">Assessment stages</h2></header>
        <AssessmentProgress pipeline={results.pipeline} />
        <p className="analytics-note">Current status of assessments dated in this period; undated drafts use their creation date.</p>
        <ModuleLink to={`/${portal}/assessments`}>Open assessment workspace</ModuleLink>
      </section> : null}
    </div>
  </>;
}

export default function AnalyticsPage({ portal, topic }: { portal: Portal; topic?: AnalyticsTopic }) {
  const auth = useAuth(), [params, setParams] = useSearchParams();
  const family = portal === "parent" || portal === "student";
  const role = { principal: "admin", teacher: "staff", parent: "guardian", student: "student" }[portal];
  const membership = auth.memberships.find(item => item.role === role && item.school_id === auth.user?.active_school_id)
    ?? auth.memberships.find(item => item.role === role);
  const schoolId = membership?.school_id ?? "", studentId = family ? params.get("student_id") ?? undefined : undefined;
  const snapshot = topic === "institution";
  const classId = !family && !snapshot ? params.get("class") ?? undefined : undefined;
  const periodValue = params.get("period"), period: AnalyticsPeriod = periodValue === "30" || periodValue === "90" ? periodValue : "term";
  const query = useQuery({ queryKey: ["analytics", auth.user?.id, schoolId, portal, studentId, classId, period],
    queryFn: () => getAnalytics(schoolId, portal, period, studentId, classId), enabled: Boolean(schoolId), staleTime: 30_000 });
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const search = params.size ? `?${params}` : "";
  const backTo = topic ? `/${portal}/analytics${search}` : undefined;
  const title = topic ? { attendance: "Attendance trends", results: "Result analysis", progress: "Assessment progress", institution: "Institution snapshot", registers: "Register submission" }[topic] : "Analytics";
  const deniedTopic = query.data && (snapshot ? portal !== "principal" || !query.data.institution
    : topic === "registers" ? portal !== "principal" || !query.data.registers
      : topic === "attendance" ? !query.data.attendance : topic ? !query.data.assessments || (topic === "progress" && family) : false);
  const child = query.data?.student ? adaptStudentSummary(query.data.student) : undefined;
  const content = <div className="analytics-page">
    <div className="analytics-toolbar">
      {snapshot ? <span className="analytics-scope">Current institution</span> : !family && (query.data?.classes.length || classId) ? <label className="analytics-class-filter"><span className="analytics-sr-only">Class</span><select value={classId ?? ""} onChange={event => change("class", event.target.value)}><option value="">{portal === "principal" ? "All classes" : "My work"}</option>{query.data?.classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}</select></label>
        : <span className="analytics-scope">{query.data?.scope_label ?? (family ? "Learner overview" : portal === "principal" ? "School overview" : "Your assigned work")}</span>}
      {!snapshot ? <label className="analytics-select"><span className="analytics-sr-only">Analytics period</span><select value={period} onChange={event => change("period", event.target.value)}><option value="term">This term</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label> : null}
      <button type="button" className="analytics-refresh" aria-label="Refresh analytics" disabled={query.isFetching || !schoolId} onClick={() => void query.refetch()}><RefreshCw size={18} aria-hidden="true" /></button>
    </div>
    {!schoolId ? <p role="alert">Select an institution to open Analytics.</p>
      : query.isPending ? <p className="analytics-empty" role="status">Loading your overview…</p>
      : query.error ? <div role="alert" className="analytics-error"><p>Analytics could not be loaded. {query.error.message}</p><button type="button" onClick={() => void query.refetch()}>Try again</button>{classId ? <button type="button" onClick={() => change("class", "")}>Clear class filter</button> : null}</div>
      : query.data ? <><span className="analytics-sr-only" role="status">{query.isFetching ? "Updating analytics…" : "Analytics updated"}</span>
        <div className="analytics-period-caption"><span>{snapshot && query.data.institution ? `As of ${shortDate(query.data.institution.as_of)} ${query.data.institution.as_of.slice(0,4)}` : `${shortDate(query.data.range.from)} – ${shortDate(query.data.range.to)} ${query.data.range.to.slice(0, 4)}`}</span><span>{query.data.term.name}{!snapshot && query.data.range.capped ? " · Latest 366 days" : ""}</span></div>
        {deniedTopic ? <p className="analytics-empty">This topic is not available with your current access.</p>
          : snapshot && query.data.institution ? <InstitutionDetail data={query.data.institution} />
            : topic === "registers" && query.data.registers ? <RegisterDetail data={query.data.registers} />
              : topic ? <AnalyticsContent data={query.data} portal={portal} topic={topic} comparison={params.get("compare") === "class" ? "class" : "subject"} onComparisonChange={value => change("compare", value)} /> : <AnalyticsSummary data={query.data} portal={portal} search={search} />}
        <p className="analytics-freshness">Updated {new Date(query.data.generated_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {portal === "teacher" ? "Current assignments only" : family ? "Personal overview" : "Institution overview"}</p>
      </> : null}
  </div>;
  if (portal === "parent") return <ParentShell active="more" pageLabel={title} backTo={backTo} child={child} selectedChildId={studentId} institutionLevel={!child} onSelectChild={id => change("student_id", id)}>{content}</ParentShell>;
  if (portal === "student") return <StudentShell activeNav="launcher" variant="edura" pageTitle={title} backTo={backTo}>{content}</StudentShell>;
  return <OperationsShell portal={portal} active="more" title={title} backTo={backTo} schoolName={membership?.school_name}>{content}</OperationsShell>;
}
