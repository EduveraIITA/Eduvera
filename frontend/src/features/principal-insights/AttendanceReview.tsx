import { ChevronRight, MessageCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ComparisonBars, numberLabel, percentageLabel } from "../analytics/AnalyticsCharts";
import { canonicalInsightSearch, insightPath } from "../analytics/InsightNavigation";
import { FollowupInbox } from "../coordination/FollowupInbox";
import type { PrincipalInsights } from "./api";
import { shortDate } from "./InsightCharts";

export function AttendanceChecks({ data }: { data: PrincipalInsights }) {
  const [params, setParams] = useSearchParams();
  const needsFollowup = data.engagement.without_followup;
  // Start with people who have no open follow-up, not a second list of already-owned work.
  const missing = params.get("followup") === "all" ? false : params.get("followup") === "missing" || needsFollowup > 0;
  const students = missing ? data.engagement.without_followup_students : data.engagement.students;
  const total = missing ? needsFollowup : data.engagement.total;
  const search = canonicalInsightSearch(params.toString());
  return <div className="attendance-review">
    <div className="attendance-review__intro">
      <h2>{needsFollowup ? `${needsFollowup} ${needsFollowup === 1 ? "student may" : "students may"} need a check-in` : data.engagement.total ? "Follow-ups are already open" : "No attendance declines to review"}</h2>
      <p>{needsFollowup ? "Attendance has fallen, with no open follow-up yet." : data.engagement.total ? "Review the existing conversations before starting another." : "No declines meet the review rules. Missing records still need checking."}</p>
    </div>
    {needsFollowup < data.engagement.total ? <div className="analytics-comparison-switch" role="group" aria-label="Attendance review list">
      <button type="button" aria-pressed={missing} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set("followup", "missing"); return next; })}>No follow-up {needsFollowup}</button>
      <button type="button" aria-pressed={!missing} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set("followup", "all"); return next; })}>All {data.engagement.total}</button>
    </div> : null}
    {students.length ? <ul className="attendance-review__list">{students.map(student => <li key={student.id}>
      <Link to={insightPath("principal", `review/${encodeURIComponent(student.id)}`, search)} aria-label={`Review ${student.name}`} aria-describedby={`review-change-${student.id} review-rate-${student.id}`}>
        <span className="attendance-review__person"><strong>{student.name}</strong><small>{student.class_name}{!missing ? ` · ${student.open_followups ? "Follow-up open" : "No open follow-up"}` : ""}</small><span id={`review-change-${student.id}`}>Attendance down {numberLabel(Math.abs(student.change))} points</span></span>
        <span className="attendance-review__rate" id={`review-rate-${student.id}`}><strong>{percentageLabel(student.current)}</strong><small>from {percentageLabel(student.previous)}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </li>)}</ul> : total > 0 ? <p className="analytics-empty">The detailed list is unavailable. Refresh to try again.</p> : null}
    {total > students.length ? <p className="analytics-note">Showing {students.length} of {total}. Narrow by class to find more students.</p> : null}
    <Link className="insight-related-link" to={insightPath("principal", "recording", search)}><span><strong>Check missing attendance records</strong><small>{numberLabel(Math.max(0, data.attendance.expected - data.attendance.recorded))} student-days unrecorded in this review window</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
    <details className="analytics-details"><summary>Why these students?</summary><p className="analytics-note">Recorded attendance fell by at least 10 percentage points compared with the preceding {data.period.days} days. Each period needs at least 5 scored days and 80% recording completeness. This is a prompt to review, not a diagnosis or a disciplinary flag.</p><p className="analytics-note">Current period: {shortDate(data.period.start)} to {shortDate(data.period.end)}. Compared with {shortDate(data.period.baseline_start)} to {shortDate(data.period.baseline_end)}. Current enrolments and the effective timetable are used.</p></details>
  </div>;
}

export function AttendanceStudentReview({ data, studentId }: { data: PrincipalInsights; studentId: string }) {
  const student = [...data.engagement.students, ...data.engagement.without_followup_students].find(item => item.id === studentId);
  if (!student) return <p className="analytics-empty">This student is not in the current review list. Go back and check the class or review period.</p>;
  const register = `/principal/attendance?class_section_id=${student.class_id}&date=${data.period.end}`;
  return <div className="attendance-review">
    <div className="attendance-review__intro"><h2>{student.name}</h2><p>{student.class_name} · {student.open_followups ? "Follow-up already open" : "No open follow-up"}</p></div>
    <section className="analytics-panel">
      <header><h2>What changed</h2></header>
      <p className="attendance-review__change"><strong>{numberLabel(Math.abs(student.change))}</strong><span>percentage-point drop in recorded attendance</span></p>
      <ComparisonBars label="Student attendance comparison" rows={[
        { id: "previous", name: `${shortDate(data.period.baseline_start)} to ${shortDate(data.period.baseline_end)}`, value: student.previous, detail: `${numberLabel(student.previous_points)} of ${student.previous_scored} counted days attended`, tone: "muted" },
        { id: "current", name: `${shortDate(data.period.start)} to ${shortDate(data.period.end)}`, value: student.current, detail: `${numberLabel(student.points)} of ${student.scored} counted days attended`, tone: "warning" },
      ]} />
      {student.missing_homework > 0 ? <p className="analytics-note">No completion recorded for {student.missing_homework} homework items. Ask the teacher to confirm.</p> : null}
    </section>
    <section className="attendance-review__next">
      <h2>Next step</h2>
      <p>{student.open_followups ? "Check the existing follow-up and its owner before contacting the family again." : "Review the attendance with the class teacher. If clarification is needed, raise a follow-up from a saved absence, late arrival or half day."}</p>
      {student.open_followups ? <a className="attendance-review__action" href="#attendance-followups"><MessageCircle size={18} aria-hidden="true" />Review existing follow-up</a> : <Link className="attendance-review__action" to={register}>Review {student.class_name} register<ChevronRight size={18} aria-hidden="true" /></Link>}
    </section>
    {student.open_followups ? <FollowupInbox context="staff" studentId={student.id} /> : null}
    <details className="analytics-details"><summary>Evidence used</summary><p className="analytics-note">{student.recorded} of {student.expected} expected student-days recorded in the current window; {student.previous_recorded} of {student.previous_expected} in the previous window. Missing records are not absences. Half days count as half; excused records are excluded from the percentage. Missing homework completion records do not establish non-submission.</p></details>
  </div>;
}

export function RecordingCompleteness({ data }: { data: PrincipalInsights }) {
  return <section className="analytics-panel">
    <header><h2>Recording completeness</h2></header>
    <div className="analytics-stat"><strong>{percentageLabel(data.attendance.completeness)}</strong><span>expected student-days recorded</span></div>
    <p className="analytics-support">{numberLabel(data.attendance.recorded)} of {numberLabel(data.attendance.expected)} student-days</p>
    <ComparisonBars label="Class recording completeness" rows={data.attendance.classes.map(cls => ({ id: cls.id, name: cls.name, value: cls.completeness, detail: `${cls.recorded} / ${cls.expected} student-days recorded` }))} />
    <p className="analytics-note">Missing records are not absences. Uses current enrolments and the effective schedule, not a frozen historical cohort. This measures recorded student-days, not submitted registers.</p>
    <Link className="analytics-module-link" to={`/principal/attendance?date=${data.period.end}`}>Review attendance registers</Link>
  </section>;
}
